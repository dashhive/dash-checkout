"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let dashWebhooker = process.env.DASH_WEBHOOKER ?? "";
let dwhToken = process.env.DWH_TOKEN ?? "";
let pgUrl = process.env.PG_CONNECTION_STRING;
let tokenPre = process.env.TOKEN_PRE || "hel_";

let Path = require("path");
let Crypto = require("crypto");

let Cors = require("./lib/cors.js");
let TableAddr = require("./lib/table-addr.js");
let TableToken = require("./lib/table-token.js");

let Coins = require("@root/merchant-wallet/lib/coins.json");
let request = require("@root/request");
let Slonik = require("slonik");
let Wallet = require("@root/merchant-wallet").Wallet;

let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.enable("trust proxy");
server.use("/", app);

let dbPool = Slonik.createPool(pgUrl);
let tableAddr = TableAddr.create(dbPool);
let tableToken = TableToken.create(dbPool, { prefix: tokenPre });

let cors = Cors({ domains: ["*"], methods: ["GET"] });

let wallet = Wallet.create(Coins.dash);

let xpubKey = process.env.XPUB_KEY;
if (!(xpubKey || "").startsWith("xpub")) {
    console.error("missing process.env.XPUB_KEY.");
    process.exit(1);
}

let Cache = require("./lib/cache.js").Cache;
let sleep = require("./lib/sleep.js").sleep;

let Db = {
    Addrs: tableAddr,
    // misnomer: this is also accounts
    Tokens: tableToken,
};

function webhookAuth(req, res, next) {
    // `Basic token` => `token`
    let auth = (req.headers.authorization || ``).split(" ")[1] || ``;
    let pass = Buffer.from(auth, "base64").toString("utf8").split(":")[1] || ``;
    if (!pass) {
        let err = new Error("no basic auth password");
        err.code = "UNAUTHORIZED";
        err.status = 401;
        throw err;
    }

    if (!secureCompare(dwhToken, pass)) {
        let err = new Error("invalid basic auth pass");
        err.code = "UNAUTHORIZED";
        err.status = 401;
        throw err;
    }

    next();
}

async function tokenAuth(req, res, next) {
    // `Token token` => `token`
    let token = (req.headers.authorization || ``).split(" ")[1] || ``;

    let account = await Db.Tokens.get(token);
    if (!account) {
        let err = new Error("invalid token");
        err.code = "UNAUTHORIZED";
        err.status = 401;
        throw err;
    }

    req.account = account;
    next();
}

function secureCompare(a, b) {
    if (!a && !b) {
        throw new Error(
            "[secure compare] reference string should not be empty"
        );
    }

    if (a.length !== b.length) {
        return false;
    }

    return Crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

app.use(
    "/api",
    bodyParser.json({
        limit: "100kb",
        strict: true,
    })
);

let Plans = {
    trial: { amount: 0.001 },
    monthly: { amount: 0.01 },
    yearly: { amount: 0.1 },
};
Plans.getQuota = function (amount) {
    // TODO move into business logic
    let hardQuota = 0;
    let softQuota = 0;
    let stale = new Date();
    let exp = new Date();

    let mult = 100 * 1000 * 1000;
    // round down for network cost error
    let trial = 0.0009 * mult;
    let month = 0.009 * mult;
    let year = 0.09 * mult;
    if (amount > year) {
        hardQuota = 1100000;
        softQuota = 1000000;
        stale.setUTCMonth(exp.getUTCMonth() + 12);
        exp.setUTCMonth(exp.getUTCMonth() + 13);
    } else if (amount > month) {
        hardQuota = 11000;
        softQuota = 10000;
        stale.setUTCDate(exp.getUTCDate() + 30);
        exp.setUTCDate(exp.getUTCDate() + 34);
    } else if (amount > trial) {
        //hardQuota = 100;
        //stale.setUTCHours(exp.getUTCHours() + 24);
        //exp.setUTCHours(exp.getUTCHours() + 72);
        hardQuota = 11;
        softQuota = 10;
        stale.setUTCSeconds(exp.getUTCSeconds() + 30);
        exp.setUTCSeconds(exp.getUTCSeconds() + 60);
    } else {
        softQuota = 2;
        hardQuota = 3;
        stale.setUTCSeconds(exp.getUTCSeconds() + 600);
        exp.setUTCSeconds(exp.getUTCSeconds() + 3600);
    }

    return {
        hard: hardQuota,
        soft: softQuota,
        stale: stale,
        exp: exp,
    };
};

function mustBeFresh(account) {
    let warnings = [];
    let plentiful = account.request_soft_quota > account.request_count;
    if (!plentiful) {
        let available = account.hard_quota > account.request_count;
        if (!available) {
            // TODO give payaddr / payaddr url?
            let err = new Error("generous quota exceeded");
            err.code = "PAYMENT_REQUIRED";
            err.status = 402;
            throw err;
        }
        let remaining = account.hard_quota - account.request_count;
        warnings.push({
            status: 402,
            code: "W_QUOTA",
            message: `This token's quota has almost been met. Payment will be required within ${remaining} requests.`,
            requests_remaining: remaining,
        });
    }

    let exp = new Date(account.expires_at).valueOf();
    let now = Date.now();
    let stale = new Date(account.stale_at).valueOf();
    let fresh = stale > now;
    if (!fresh) {
        let usable = exp > now;
        if (!usable) {
            let err = new Error("generous expiration exceeded");
            err.code = "PAYMENT_REQUIRED";
            err.status = 402;
            throw err;
        }
        let expiresIn = Math.floor((exp - now) / 1000);
        //let inDays = expiresIn % (24 * 60 * 60);
        // TODO 10d 2h 5m
        warnings.push({
            status: 402,
            code: "W_EXPIRY",
            message: `This token is about to expire. Payment will be required on ${account.expires_at} (in ${expiresIn}s).`,
            details: {
                expires_at: account.expires_at,
                expires_in: expiresIn,
            },
        });
    }

    return warnings;
}

app.post("/api/public/account/:plan", async function (req, res) {
    let planName = req.params.plan;
    let accountToken = req.body.token || null;
    let email = req.body.email || null;
    let phone = req.body.phone || null;
    let webhook = req.body.webhook || null;
    let contact = { email, phone, webhook };

    let plan = Plans[planName];
    if (!plan) {
        let err = new Error(`'${plan}' is not a valid billing plan`);
        err.code = "E_INVALID_PLAN";
        err.status = 400;
        throw err;
    }

    let account;
    let walletIndex;
    let payaddrs;
    if (accountToken) {
        [account, payaddrs] = await Db.Tokens.getWithPayaddrs(accountToken);
    }
    if (account && payaddrs[0]) {
        let latestPayaddr = payaddrs[0];
        walletIndex = latestPayaddr.id;
    } else {
        walletIndex = await Db.Addrs.next();
    }

    let payaddr = await wallet.addrFromXPubKey(xpubKey, walletIndex);
    if (!account) {
        account = await Db.Tokens.generate(walletIndex, payaddr, contact);
    }

    let baseUrl = `https://${req.hostname}`;
    let resp = await registerWebhook(baseUrl, account, payaddr);
    console.log("[DEBUG] register webhook", resp.body);

    let qrSvg = await wallet.qrFromXPubKey(xpubKey, walletIndex, plan.amount, {
        format: "svg",
    });
    let svgB64 = Buffer.from(qrSvg, "utf8").toString("base64");
    let search = "";
    if (plan.amount) {
        search = new URLSearchParams({
            amount: plan.amount,
        }).toString();
    }

    res.json({
        payaddr: payaddr,
        amount: plan.amount,
        token: account.token,
        status_url: `${baseUrl}/api/public/account/${account.token}/status`,
        qr: {
            // not url safe because it will be used by data-uri
            src: `data:image/svg+xml;base64,${svgB64}`,
            api_src: `/api/payment-addresses/${payaddr}.svg?${search}`,
        },
    });
});

app.get(`/api/public/payment-addresses/:addr.svg`, async function (req, res) {
    // TODO use :token rather than :addr
    // (and give a good error about how to do generic addresses)
    let addr = req.params.addr;
    let amount = parseFloat(req.query.amount) || undefined;
    let qrSvg = wallet.qrFromAddr(addr, amount, { format: `svg` });
    res.headers[`Content-Type`] = `image/svg+xml`;
    res.end(qrSvg);
});

app.get(`/api/public/account/:token/status`, async function (req, res) {
    let token = req.params.token;

    let [account, payaddrs] = await Db.Tokens.getWithPayaddrs(token);
    //console.log("debug", account, payaddrs);
    if (payaddrs[0]?.amount && payaddrs[0]?.last_payment_at) {
        try {
            mustBeFresh(account);
            res.json(account);
            return;
        } catch (e) {
            // ignore
        }
    }

    let racers = [sleep(5000)];
    let promise = Cache.Addrs.waitFor(token);
    if (promise) {
        racers.push(promise);
    }
    let details = await Promise.race(racers);

    if (!details) {
        details = {
            // TODO what if there's nothing?
            status: "pending",
        };
    }
    res.json(details);
});

/*
app.post("/api/addresses/:addr", async function (req, res) {
    let addr = req.params.addr;
    let baseUrl = `https://${req.hostname}`;
    let resp = await registerWebhook(baseUrl, addr);
    res.json(resp.body);
});
*/

async function registerWebhook(baseUrl, account, payaddr) {
    let whReq = {
        timeout: 5 * 1000,
        url: dashWebhooker,
        headers: {
            Authorization: `Bearer ${dwhToken}`,
        },
        json: {
            address: payaddr,
            url: `${baseUrl}/api/webhooks/dwh`,
        },
    };
    let resp = await request(whReq);
    if (!resp.ok) {
        console.error();
        console.error("Failed resp:", resp.toJSON());
        console.error(whReq);
        console.error(resp.toJSON());
        console.error();
        throw new Error("failed to register webhook");
    }

    Cache.Addrs.getOrCreate(payaddr, account);

    return resp.toJSON();
}

app.post("/api/webhooks/dwh", webhookAuth, async function (req, res) {
    let data = req.body;
    let result = {
        received_at: new Date().toISOString(),
        address: data.address,
        satoshis: data.satoshis,
    };
    let amount = data.satoshis;

    if (!result.satoshis) {
        console.info(`Dash Payment Webhook Test (received 0)`);
        res.json(result);
        return;
    }

    console.info(`Dash Payment Webhook:`);
    console.info(data);

    let promise = Cache.Addrs.get(data.address);
    if (!promise) {
        console.warn(
            `[warn] received webhook for an address we're not listening to ${data.address}`
        );
        res.statusCode = 400;
        res.json({
            message: `not listening for '${data.address}'`,
        });
        return;
    }

    await Db.Addrs.receive({ payaddr: data.address, amount });

    // TODO create "billing cycle" units or some such
    let quota = Plans.getQuota(amount);
    let account = await Db.Tokens.reset({
        payaddr: data.address,
        quota,
    });
    account.amount = data.satoshis;
    // TODO make sure we neuter this
    promise.resolve(account);

    res.json(result);
});

app.use("/api", cors);

app.use("/api/hello", tokenAuth);
app.get("/api/hello", async function (req, res) {
    let account = req.account;

    account.request_count += 1;
    let warnings = mustBeFresh(account);
    await Db.Tokens.touch(account.token, { resource: `req.method req.url` });
    //await Db.Tokens.save(req.account);

    // TODO wrap
    let result = Object.assign(
        {
            warnings: warnings,
        },
        req.account
    );
    res.json(result);
});

app.use("/api", async function (err, req, res, next) {
    if (!err.status) {
        err.status = 500;
    }
    if (err.status >= 500) {
        console.error("Fail:");
        console.error(err.stack);
    }

    res.statusCode = err.status;
    res.json({
        status: err.status,
        code: err.code,
        message: err.message,
    });
});

let publicHtml = Path.join(__dirname, "public");
app.use("/", express.static(publicHtml), { dotfiles: "ignore" });

module.exports = server;

if (require.main === module) {
    let PORT = process.env.PORT || 3274; // DASH
    let Http = require("http");
    let httpServer = Http.createServer(server);

    httpServer.listen(PORT, function () {
        console.info(`Listening on`, httpServer.address());
    });
    // TODO httpServer.close(); dbPool.end();
}
