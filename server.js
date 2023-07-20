"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// SECURITY remove immediately
let walletPhrase = process.env.WALLET_PHRASE || "";
process.env.WALLET_PHRASE = "";

let Wallet = require("./lib/wallet.js");
let walletId = "";
/** @type {import('dashhd').HDWallet} */
let walletKey;

let Merchant = require("./merchant.js");
let Db = Merchant.Db;

let WORST_DENOMS = [
  /*jshint ignore:start*/
  10_000_000_00, 1_000_000_00, 100_000_00, 10_000_00, 1_000_00,
  /*jshint ignore:end*/
];
let NATURAL_DENOMS = [
  /*jshint ignore:start*/
  // 10.0
  10_000_000_00,
  // 1.0
  5_000_000_00, 2_000_000_00, 1_000_000_00,
  // 0.1
  500_000_00, 200_000_00, 100_000_00,
  // 0.01
  50_000_00, 20_000_00, 10_000_00,
  // 0.001
  5_000_00, 2_000_00, 1_000_00,
  /*jshint ignore:end*/
];

async function initWallet() {
  walletKey = await Wallet.fromPhrase(walletPhrase);
  walletPhrase = "";
  walletId = await Wallet.toId(walletKey);
  await Db.Accounts._setWalletId({ id: walletId }).catch(function (e) {
    console.error(e);
    process.exit(1);
  });
}
// TODO initialize in merchant?
setTimeout(initWallet, 500);

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let merchantTok = process.env.MERCHANT_TOKEN ?? "";
let webhookBaseUrl = process.env.WEBHOOK_BASE_URL ?? "";

//let apiBaseUrl = process.env.WEBHOOK_BASE_URL ?? "";

let Path = require("path");

let Cors = require("./lib/cors.js");

let request = require("@root/request");
let DashHd = require("dashhd");
let Qr = require("./lib/qr.js");

let ULID = require("ulid");
let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.enable("trust proxy");
server.use("/", app);

let cors = Cors({ domains: ["*"], methods: ["GET"] });

// // TODO use wallet phrase (or root hd key)
// let xpubKey = process.env.XPUB_KEY || "";
// if (!xpubKey) {
//   console.error("missing process.env.XPUB_KEY");
//   process.exit(1);
// }
// if (!xpubKey.startsWith("xpub")) {
//   console.error("wrong format for process.env.XPUB_KEY");
//   process.exit(1);
// }

let Cache = require("./lib/cache.js").Cache;
let sleep = require("./lib/sleep.js").sleep;

let Plans = require("./lib/plans.js");

/**
 * @param {Account} account
 * @returns {QuotaWarn?}
 * @throws
 */

/** @type {import('express').Handler} */
async function rPlansList(req, res) {
  res.json(Plans.tiers);
}

/** @type {import('express').Handler} */
async function rOrderApiAccess(req, res) {
  let planName = req.params.plan;
  let base62Token = req.body.token || null;
  let email = req.body.email || null;
  let phone = req.body.phone || null;
  let webhook = req.body.webhook || null;
  // TODO
  //let contact = { email, phone, webhook };

  /** @type {import('./lib/plans.js').PlanTier} */
  let plan;
  //@ts-ignore
  plan = Plans.tiers[planName];
  if (!plan) {
    throw Merchant.E(`'${plan}' is not a valid billing plan`, {
      code: "E_INVALID_PLAN",
      status: 400,
    });
  }

  let xpubKey;
  let account;
  if (base62Token) {
    account = await Db.Accounts.getByToken(base62Token);
    if (!account) {
      throw new Error("bad token");
    }
  } else {
    // TODO generate the next 100 addresses as confirmed 0
    account = await Db.Accounts.next({ walletId });
    xpubKey = await Wallet.toXPubKey(walletKey, account.index);
    account.xpub = await DashHd.toXPub(xpubKey);
    await Db.Accounts.setXPub(account);

    let tokenPre = process.env.TOKEN_PRE || "hel_";
    base62Token = await Db.Accounts.createToken(tokenPre, account, {
      email,
      phone,
      webhook,
    });
  }
  console.log(`[DEBUG] account.index`, account.index);
  if (!xpubKey) {
    xpubKey = await DashHd.fromXKey(account.xpub);
  }

  let MIN_STAMP_VALUE = 800;
  let value = toSats(plan.amount);
  value += MIN_STAMP_VALUE;

  let [nextIndex, addresses, denoms] = await Wallet._getNextAddresses(
    account,
    xpubKey,
    value
  );

  // TODO mark addresses used in database
  let groupUlid = ULID.ulid();

  // TODO prevent domain fronting
  // (static caddy configs are _mostly_ safe)
  let baseUrl = `https://${req.hostname}`;

  let resp = await registerWebhook(baseUrl, groupUlid, account, addresses);
  console.log("[DEBUG] register webhook", resp.body);

  let amount = toDash(value);
  let xpub = await DashHd.toXPub(xpubKey);
  let nextAddress = addresses[0];
  let content = Qr.toUrl({
    address: nextAddress,
    i: nextIndex,
    xpub: xpub,
    amount: amount,
    denoms: denoms,
    // TODO gravatar url
    // picture:
    nickname: req.hostname,
    // product_url: "/plans/hello-basic",
  });
  let qrSvg = Qr.toSvg(content);
  let svgB64 = Buffer.from(qrSvg, "utf8").toString("base64");
  let search = "";
  if (plan.amount) {
    search = new URLSearchParams({
      amount: plan.amount.toString(),
    }).toString();
  }

  let result = {
    xpub: xpub,
    denoms: denoms,
    addresses: addresses,
    address: nextAddress,
    payaddr: nextAddress,
    amount: plan.amount,
    token: base62Token,
    status_url: `${baseUrl}/api/account/payment-status/${groupUlid}`,
    qr: {
      // not url-safe because it will be used by data-uri
      src: `data:image/svg+xml;base64,${svgB64}`,
      api_src: `/api/payment-addresses/${nextAddress}.svg?${search}`,
    },
  };
  res.json(result);
}

Wallet._getNextAddresses = async function (account, xpubKey, value) {
  let nextIndex = 0;
  let prevPayment = await Db.Accounts.getPrevPayment(account);
  if (prevPayment) {
    nextIndex = prevPayment.index + 1;
  }

  // calculate how many addresses may be needed
  // and mark addresses that may be used as reserved
  let lastIndex = nextIndex;
  {
    let worstValue = value;
    for (let denom of WORST_DENOMS) {
      for (;;) {
        if (worstValue < denom) {
          break;
        }
        worstValue -= denom;
        lastIndex += 1;
      }
    }
  }

  let addresses = [];
  let curIndex = nextIndex;
  for (; curIndex < lastIndex; curIndex += 1) {
    let nextAddrKey = await xpubKey.deriveAddress(curIndex);
    let nextAddress = await DashHd.toAddr(nextAddrKey.publicKey);
    addresses.push(nextAddress);
  }
  // TODO check for sparse-use addresses in cache, and externally
  // addresses

  let denoms = [];
  {
    let naturalValue = value;
    for (let denom of NATURAL_DENOMS) {
      let amount = toDash(denom);
      for (;;) {
        if (naturalValue < denom) {
          break;
        }
        naturalValue -= denom;
        denoms.push(amount);
      }
    }
  }

  return [nextIndex, addresses, denoms];
};

/**
 * @param {Number} sats
 */
function toDash(sats) {
  let dash = sats / 100000000;
  let dashStr = dash.toFixed(8);
  dash = parseFloat(dashStr);
  return dash;
}

/**
 * @param {Number} dash
 */
function toSats(dash) {
  let sats = dash * 100000000;
  sats = Math.round(sats);
  return sats;
}

///** @type {import('express').Handler} */
//async function genSvgFromAddr(req, res) {
//  // TODO use :token rather than :addr
//  // (and give a good error about how to do generic addresses)
//  let addr = req.params.addr;
//  //@ts-ignore
//  let amount = parseFloat(req.query.amount || "") || undefined;
//  let qrSvg = wallet.qrFromAddr(addr, amount, { format: `svg` });
//  res.setHeader(`Content-Type`, `image/svg+xml`);
//  res.end(qrSvg);
//}

/**
 * The browser client polls here to know when to remove the "Pay Me" qr code
 *
 * @type {import('express').Handler}
 */
async function rCheckPaymentStatus(req, res) {
  let account = req.account;

  let prevPayment = await Db.Accounts.getPrevPayment(account);
  if (prevPayment?.amount) {
    let requestCount = await Db.Accounts.getRequestCount(account);
    Object.assign(account, { request_count: requestCount });
    try {
      Plans.mustBeFresh(account);
      res.json(account);
      return;
    } catch (e) {
      // ignore
    }
  }

  let nonce = req.params.nonce;
  let result = await respondOrPend(nonce);
  res.json(result);
}

/**
 * @param {String} nonce
 */
async function respondOrPend(nonce) {
  let delay = 5000;
  let racers = [];
  let sleeper = sleep(delay);
  racers.push(sleeper);

  let promise = Cache.Addrs.waitFor(nonce);
  if (promise) {
    racers.push(promise);
  }
  let details = await Promise.race(racers);

  if (!details) {
    details = { status: "pending" };
  } else {
    details.status = "complete";
  }

  return details;
}

// Note: In this I am acting as a client (to myself)
/**
 * @param {String} baseUrl
 * @param {String} nonce
 * @param {Account} account
 * @param {Array<String>} addresses
 */
async function registerWebhook(baseUrl, state, account, addresses) {
  // TODO
  // 1. save owner url and addr to database
  // 2. register ourself as hook
  // 3. relay on receipt
  // 4. poll as fallback?
  let registrationReq = {
    timeout: 5 * 1000,
    url: `${webhookBaseUrl}/api/webhooks`,
    headers: {
      Authorization: `Bearer ${merchantTok}`,
    },
    json: {
      addresses: addresses,
      address: addresses[0],
      url: `${baseUrl}/api/webhooks/payment-accepted/${state}`,
    },
  };
  let resp = await request(registrationReq);

  if (!resp.ok) {
    console.error();
    console.error("Failed resp:", resp.toJSON());
    console.error(registrationReq);
    console.error(resp.toJSON());
    console.error();
    throw new Error("failed to register webhook");
  }

  Cache.Addrs.getOrCreate(addresses, state, account);

  return resp.toJSON();
}

/** @type {import('express').Handler} */
async function rUpdatePaymentStatus(req, res) {
  let payment = req.payment;
  let addresses = payment.addresses;
  let satoshis = payment.satoshis;

  let promise = Cache.Addrs.getAny(addresses);
  if (!promise) {
    console.warn(
      `[warn] received webhook for an address we're not listening to ${addresses}`
    );
    res.statusCode = 400;
    res.json({
      message: `not listening for '${addresses}'`,
    });
    return;
  }

  // TODO lookup addresses to find associated account

  let len = payment?.transaction?.outputs?.length;
  if (!len) {
    throw new Error("invalid payment: no outputs");
  }

  let account = await Db.Accounts.receive(payment);

  // TODO create "billing cycle" units or some such
  let address = payment.addresses[0];
  let quota = Plans.getQuota(satoshis);
  await Db.Accounts.recharge(account, quota);
  account.amount = payment.satoshis;
  // TODO make sure we neuter this
  Cache.Addrs.resolve(payment.addresses, account);

  res.json(payment);
}

/** @type {import('express').Handler} */
async function getHelloStuff(req, res) {
  let account = req.account;

  account.request_count += 1;
  let warnings = Plans.mustBeFresh(account);
  await Db.Tokens.touch(account.token, {
    resource: `${req.method} ${req.url}`,
  });
  //await Db.Tokens.save(req.account);

  // TODO wrap
  let result = Object.assign(
    {
      warnings: warnings,
    },
    req.account
  );
  res.json(result);
}

app.use("/api", bodyParser.json({ limit: "100kb", strict: true }));

// As a merchant using the service
app.post(
  "/api/webhooks/payment-accepted/:state",
  Merchant.webhookAuth(merchantTok),
  Merchant.rParsePaymentWebhook,
  rUpdatePaymentStatus
);

app.use("/api", cors);

// Ordering stuff
app.get("/api/public/plans", rPlansList);
app.post("/api/public/account/:plan", rOrderApiAccess);
//app.get(`/api/public/payment-addresses/:addr.svg`, genSvgFromAddr);

// Protected API Access
app.use("/api/", Merchant.rTokenAuth);
app.get(`/api/account/payment-status/:nonce`, rCheckPaymentStatus);
app.get("/api/hello", getHelloStuff);

app.use("/", require("./server-service.js").routes);

// Default API Error Handler
app.use("/api", Merchant.finalErrorHandler);

// Public Site
let publicHtml = Path.join(__dirname, "public");
app.use("/", express.static(publicHtml, { dotfiles: "ignore" }));

module.exports = server;

if (require.main === module) {
  let PORT = process.env.PORT || 3225; // DACK
  let Http = require("http");
  let httpServer = Http.createServer(server);

  httpServer.listen(PORT, function () {
    console.info(`Listening on`, httpServer.address());
  });
  // TODO httpServer.close(); dbPool.end();
}
