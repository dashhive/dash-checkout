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
let Wallet = require("@root/merchant-wallet").Wallet;

let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.enable("trust proxy");
server.use("/", app);

let cors = Cors({ domains: ["*"], methods: ["GET"] });

//@ts-ignore
let Coins = require("@root/merchant-wallet/lib/coins.json");
let wallet = Wallet.create(Coins.dash);

let xpubKey = process.env.XPUB_KEY;
if (!(xpubKey || "").startsWith("xpub")) {
  console.error("missing process.env.XPUB_KEY.");
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
      amount: plan.amount.toString(),
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
}

/** @type {import('express').Handler} */
async function genSvgFromAddr(req, res) {
  // TODO use :token rather than :addr
  // (and give a good error about how to do generic addresses)
  let addr = req.params.addr;
  //@ts-ignore
  let amount = parseFloat(req.query.amount || "") || undefined;
  let qrSvg = wallet.qrFromAddr(addr, amount, { format: `svg` });
  res.setHeader(`Content-Type`, `image/svg+xml`);
  res.end(qrSvg);
}

/*
app.post("/api/addresses/:addr", async function (req, res) {
    let addr = req.params.addr;
    let baseUrl = `https://${req.hostname}`;
    let resp = await registerWebhook(baseUrl, addr);
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

  let [account, payaddrs] = await Db.Tokens.getWithPayaddrs(token);
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
  } else {
    details.status = "complete";
  }
  res.json(details);
}

// Note: In this I am acting as a client (to myself)
/**
 * @param {String} baseUrl
 * @param {Account} account
 * @param {String} payaddr
 */
async function registerWebhook(baseUrl, account, payaddr) {
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
      address: payaddr,
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

  Cache.Addrs.getOrCreate(payaddr, account);

  return resp.toJSON();
}

/** @type {import('express').Handler} */
async function rUpdatePaymentStatus(req, res) {
  let payment = req.payment;
  let amount = payment.satoshis;

  let promise = Cache.Addrs.get(payment.address);
  if (!promise) {
    console.warn(
      `[warn] received webhook for an address we're not listening to ${payment.address}`
    );
    res.statusCode = 400;
    res.json({
      message: `not listening for '${payment.address}'`,
    });
    return;
  }

  await Db.Addrs.receive({ payaddr: payment.address, amount });

  // TODO create "billing cycle" units or some such
  let quota = Plans.getQuota(amount);
  let account = await Db.Tokens.reset({
    payaddr: payment.address,
    quota,
  });
  account.amount = payment.satoshis;
  // TODO make sure we neuter this
  Cache.Addrs.resolve(payment.address, account);

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
app.get(`/api/public/payment-addresses/:addr.svg`, genSvgFromAddr);
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
  let PORT = process.env.PORT || 3274; // DASH
  let Http = require("http");
  let httpServer = Http.createServer(server);

  httpServer.listen(PORT, function () {
    console.info(`Listening on`, httpServer.address());
  });
  // TODO httpServer.close(); dbPool.end();
}
