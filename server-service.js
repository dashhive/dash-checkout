"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

let Service = module.exports;

let Merchant = require("./merchant.js");
let HooksDb = require("./lib/hooks-db.js").create({});
let MerchantHooks = require("./webhooks.js").create({
  defaultWebhookTimeout: 5 * 1000,
  Db: HooksDb,
});

let app = require("@root/async-router").Router();
let request = require("@root/request");

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

// For the full node
let fullNodeWebhook = process.env.DASH_WEBHOOKER ?? "";
let dwhToken = process.env.DWH_TOKEN ?? "";

/** @type {import('express').Handler} */
async function rRegisterMerchantWebhook(req, res) {
  let serviceBaseUrl = `https://${req.hostname}`;
  let targetAddress = req.body.address;
  let merchantUrl = req.body.url;

  /** @type {HookRequest} */
  let merchantHookReq = {
    data: {
      url: merchantUrl,
      address: targetAddress,
    },
    account: req.account,
    apiUsername: "dpy",
    apiToken: req.token,
  };

  // url, address
  let result = await MerchantHooks.register(merchantHookReq);

  /** @type {HookRequestData} */
  let fullNodeHookRequestData = {
    address: targetAddress,
    url: `${serviceBaseUrl}/api/full-node-webhooks/dwh`,
  };
  let whReq = {
    timeout: 5 * 1000,
    url: fullNodeWebhook,
    headers: { authorization: `Bearer ${dwhToken}` },
    json: fullNodeHookRequestData,
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

  res.json(result);
}

/** @type {import('express').Handler} */
async function rRelayWebhook(req, res) {
  let payment = req.payment;

  // TODO - capture error for retry
  MerchantHooks.send(payment.address, payment);

  res.json({
    address: payment.address,
    satoshis: payment.satoshis,
  });
}

// All notifications from the full node will be received here.
// Then they will be relayed to the appropriate host.
app.post(
  "/api/full-node-webhooks/dwh",
  Merchant.webhookAuth(dwhToken),
  Merchant.rParsePaymentWebhook,
  rRelayWebhook
);

// For providing the service (even to myself)
app.use("/api/webhooks", Merchant.rTokenAuth);
app.post("/api/webhooks", rRegisterMerchantWebhook);

Service.routes = app;
