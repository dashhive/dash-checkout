"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

let Merchant = require("./merchant.js");
let Db = Merchant.Db;

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

let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.enable("trust proxy");
server.use("/", app);

let cors = Cors({ domains: ["*"], methods: ["GET"] });

let xpubKey = process.env.XPUB_KEY || "";
if (!xpubKey) {
  console.error("missing process.env.XPUB_KEY");
  process.exit(1);
}
if (!xpubKey.startsWith("xpub")) {
  console.error("wrong format for process.env.XPUB_KEY");
  process.exit(1);
}

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
  let accountToken = req.body.token || null;
  let email = req.body.email || null;
  let phone = req.body.phone || null;
  let webhook = req.body.webhook || null;
  let contact = { email, phone, webhook };

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

  let account;
  let accountIndex;
  let payaddrs;
  if (accountToken) {
    [account, payaddrs] = await Db.Tokens.getWithPayAddrs(accountToken);
  }
  if (account && payaddrs[0]) {
    let latestPayAddr = payaddrs[0];
    accountIndex = latestPayAddr.id;
  } else {
    accountIndex = await Db.Addrs.next();
  }
  console.log(`[DEBUG] accountIndex`, accountIndex);

  //let XPUB_DEPTH_FULL_AUDIT = 2;
  let XPUB_DEPTH_AUDIT = 3;
  let XPUB_DEPTH_SHARE = 4;
  let contactXPub = await DashHd.fromXKey(xpubKey, { bip32: true, xkey: "" });
  if (XPUB_DEPTH_AUDIT === contactXPub.depth) {
    contactXPub = DashHd.deriveChild(
      contactXPub,
      DashHd.RECEIVE,
      DashHd.PUBLIC
    );
  }
  if (XPUB_DEPTH_SHARE !== contactXPub.depth) {
    throw new Error("xpub is not bip44 compatible");
  }
  //let xpubStr = DashHd.toXPub(contactXPub);

  let FIRST_ADDRESS = 0;
  let payAddrKey = await contactXPub.deriveAddress(FIRST_ADDRESS);
  let payAddr = await DashHd.toAddr(payAddrKey.publicKey);
  if (!account) {
    account = await Db.Tokens.generate(accountIndex, payAddr, contact);
  }

  // TODO prevent domain fronting
  let baseUrl = `https://${req.hostname}`;
  let resp = await registerWebhook(baseUrl, account, [payAddr]);
  console.log("[DEBUG] register webhook", resp.body);

  let MIN_STAMP_VALUE = 800;
  let value = toSats(plan.amount);
  value += MIN_STAMP_VALUE;

  let amount = toDash(value);
  // TODO: DIP: Agent should warn user if URL is not expected?
  let content = Qr.toUrl({
    address: payAddr,
    xpub: contactXPub,
    amount: amount,
    nickname: "Hello API",
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

  res.json({
    addresses: [payAddr],
    address: payAddr,
    payaddr: payAddr,
    amount: plan.amount,
    token: account.token,
    status_url: `${baseUrl}/api/public/account/${account.token}/status`,
    qr: {
      // not url-safe because it will be used by data-uri
      src: `data:image/svg+xml;base64,${svgB64}`,
      api_src: `/api/payment-addresses/${payAddr}.svg?${search}`,
    },
  });
}

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

/*
app.post("/api/addresses/:addr", async function (req, res) {
    let addr = req.params.addr;
    let baseUrl = `https://${req.hostname}`;
    let resp = await registerWebhook(baseUrl, [addr]);
    res.json(resp.body);
});
*/

/**
 * The browser client polls here to know when to remove the "Pay Me" qr code
 *
 * @type {import('express').Handler}
 */
async function rCheckTokenStatus(req, res) {
  let token = req.params.token;

  let [account, payaddrs] = await Db.Tokens.getWithPayAddrs(token);
  //console.log("debug", account, payaddrs);
  if (payaddrs[0]?.amount && payaddrs[0]?.last_payment_at) {
    try {
      Plans.mustBeFresh(account);
      res.json(account);
      return;
    } catch (e) {
      // ignore
    }
  }

  let racers = [];
  let sleeper = sleep(5000);
  racers.push(sleeper);

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
  } else {
    details.status = "complete";
  }
  res.json(details);
}

// Note: In this I am acting as a client (to myself)
/**
 * @param {String} baseUrl
 * @param {Account} account
 * @param {Array<String>} addresses
 */
async function registerWebhook(baseUrl, account, addresses) {
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
      url: `${baseUrl}/api/webhooks/payment-accepted`,
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

  Cache.Addrs.getOrCreate(addresses, account);

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

  let indexes = [1, 2, 3, 4, 5, 14, 15, 16, 17, 18, 19];
  await Db.Addrs.receive({ indexes, satoshis });

  // TODO create "billing cycle" units or some such
  let address = payment.addresses[0];
  let quota = Plans.getQuota(satoshis);
  let account = await Db.Tokens.reset({
    payaddr: address,
    quota,
  });
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
  "/api/webhooks/payment-accepted",
  Merchant.webhookAuth(merchantTok),
  Merchant.rParsePaymentWebhook,
  rUpdatePaymentStatus
);

app.use("/api", cors);

// Ordering stuff
app.get("/api/public/plans", rPlansList);
app.post("/api/public/account/:plan", rOrderApiAccess);
//app.get(`/api/public/payment-addresses/:addr.svg`, genSvgFromAddr);
app.get(`/api/public/account/:token/status`, rCheckTokenStatus);

// Protected API Access
app.use("/api/hello", Merchant.rTokenAuth);
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
