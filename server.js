"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let tokenPre = process.env.TOKEN_PRE || "hel_";

let Path = require("path");
let Crypto = require("crypto");

let Base62Token = require("base62-token");
let Coins = require("@root/merchant-wallet/lib/coins.json");
let Cors = require("./lib/cors.js");
let Wallet = require("@root/merchant-wallet").Wallet;

let dict = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let b62Token = Base62Token.create(dict);
let tokenLen = 30;
let tokenIdLen = 24;
let cors = Cors({ domains: ["*"], methods: ["GET"] });

let request = require("@root/request");
let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.enable("trust proxy");
server.use("/", app);

let dwhToken = process.env.DWH_TOKEN ?? "";
let dashWebhooker = process.env.DASH_WEBHOOKER ?? "";

let wallet = Wallet.create(Coins.dash);
let walletIndex = 0;

let xpubKey = process.env.XPUB_KEY;
if (!(xpubKey || "").startsWith("xpub")) {
    console.error("missing process.env.XPUB_KEY.");
    process.exit(1);
}

let Cache = require("./lib/cache.js").Cache;
let sleep = require("./lib/sleep.js").sleep;

function toWeb64(b) {
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function hash(val, n) {
    let h = Crypto.createHash("sha256").update(val).digest("base64");
    return toWeb64(h).slice(0, n);
}

let Db = {
    Addrs: {
        upsert: async function (paymentAddress) {
            if (Db._addrs[paymentAddress]) {
                return;
            }

            Db._addrs[paymentAddress] = {
                created_at: new Date().toISOString(),
                satoshis: 0,
                paid_at: null,
            };
        },
    },
    _addrs: {},
    // misnomer: this is also accounts
    Tokens: {
        get: async function (token) {
            let id = hash(token, tokenIdLen);
            return Db._tokens[id];
        },
        save: async function (account) {
            Db._tokens[account.id] = account;
        },
        generate: async function ({ address, satoshis }) {
            let token = b62Token.generate(tokenPre, tokenLen);
            let id = hash(token, tokenIdLen);
            let hardQuota = 0;
            let exp = new Date();

            // TODO put this logic somewhere easier to season-to-taste
            let mult = 100 * 1000 * 1000;
            // round down for network cost error
            let trial = 0.0009 * mult;
            let month = 0.009 * mult;
            let year = 0.09 * mult;
            if (satoshis > year) {
                hardQuota = 1000000;
                exp.setUTCMonth(exp.getUTCMonth() + 13);
            } else if (satoshis > month) {
                hardQuota = 10000;
                exp.setUTCDate(exp.getUTCDate() + 34);
            } else if (satoshis > trial) {
                hardQuota = 100;
                exp.setUTCHours(exp.getUTCHours() + 84);
            } else {
                hardQuota = 3;
                exp.setUTCSeconds(exp.getUTCSeconds() + 90);
            }

            Db._tokens[id] = {
                id: id,
                created_at: new Date().toISOString(),
                token: token,
                address_id: address,
                last_payment_at: new Date().toISOString(),
                last_payment_amount: satoshis,
                request_count: 0,
                request_quota: hardQuota,
                expires_at: exp,
            };

            return Db._tokens[id];
        },
    },
    _tokens: {},
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

app.post("/api/public/payment-addresses", async function (req, res) {
    let paymentAddr = await wallet.addrFromXPubKey(xpubKey, walletIndex);
    let amount = 0.001;
    let qrSvg = await wallet.qrFromXPubKey(xpubKey, walletIndex, amount, {
        format: "svg",
    });
    let svgB64 = Buffer.from(qrSvg, "utf8").toString("base64");
    let search = "";
    if (amount) {
        search = new URLSearchParams({
            amount: amount,
        }).toString();
    }

    let baseUrl = `https://${req.hostname}`;
    // TODO what if webhooking fails?
    let resp = await registerWebhook(baseUrl, paymentAddr);
    console.log("[DEBUG] register webhook", resp.body);

    // TODO save in addresses_tokens in DB
    walletIndex += 1;
    res.json({
        addr: paymentAddr,
        amount: amount,
        token_url: `${baseUrl}/api/public/payment-addresses/${paymentAddr}/token`,
        qr: {
            // not url safe because it will be used by data-uri
            src: `data:image/svg+xml;base64,${svgB64}`,
            api_src: `/api/payment-addresses/${paymentAddr}.svg?${search}`,
        },
    });
});

app.get(`/api/public/payment-addresses/:addr.svg`, async function (req, res) {
    let addr = req.params.addr;
    let amount = parseFloat(req.query.amount) || undefined;
    let qrSvg = wallet.qrFromAddr(addr, amount, { format: `svg` });
    res.headers[`Content-Type`] = `image/svg+xml`;
    res.end(qrSvg);
});

app.get(`/api/public/payment-addresses/:addr/token`, async function (req, res) {
    let paymentAddress = req.params.addr;

    // TODO check db first?

    let racers = [sleep(5000)];
    let promise = Cache.Addrs.waitFor(paymentAddress);
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

app.post("/api/addresses/:addr", async function (req, res) {
    let addr = req.params.addr;
    let baseUrl = `https://${req.hostname}`;
    let resp = await registerWebhook(baseUrl, addr);
    res.json(resp.body);
});

async function registerWebhook(baseUrl, paymentAddress) {
    let resp = await request({
        timeout: 5 * 1000,
        url: dashWebhooker,
        headers: {
            Authorization: `Bearer ${dwhToken}`,
        },
        json: {
            address: paymentAddress,
            url: `${baseUrl}/api/webhooks/dwh`,
        },
    });
    if (!resp.ok) {
        throw new Error("failed to register webhook");
    }

    await Db.Addrs.upsert(paymentAddress);
    Cache.Addrs.getOrCreate(paymentAddress);

    return resp.toJSON();
}

app.post("/api/webhooks/dwh", webhookAuth, async function (req, res) {
    let data = req.body;
    let result = {
        received_at: new Date().toISOString(),
        address: data.address,
        satoshis: data.satoshis,
    };

    if (!data.satoshis) {
        console.info(`Dash Payment Webhook Test (received 0 satoshis)`);
        res.json(result);
        return;
    }

    console.info(`Dash Payment Webhook:`);
    console.info(data);

    let promise = Cache.Addrs.getOrCreate(data.address);
    let account = await Db.Tokens.generate({
        address: data.address,
        satoshis: data.satoshis,
    });
    // TODO make sure we neuter this
    promise.resolve(account);

    res.json(result);
});

app.use("/api", cors);

app.use("/api/hello", tokenAuth);
app.get("/api/hello", async function (req, res) {
    let account = req.account;
    if (account.request_count > account.request_quota) {
        let err = new Error("generous quote exceeded");
        err.code = "PAYMENT_REQUIRED";
        err.status = 402;
        throw err;
    }
    req.account.request_count += 1;
    await Db.Tokens.save(req.account);

    res.json(req.account);
});

app.use("/api", function (err, req, res, next) {
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
}
