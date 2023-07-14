"use strict";

let Merchant = module.exports;

let masterTok = process.env.MASTER_TOKEN ?? "";
let pgUrl = process.env.PG_CONNECTION_STRING || "";
let tokenPre = process.env.TOKEN_PRE || "hel_";

let Crypto = require("crypto");

let MA = require("./lib/master-account.js");

// For the service itself
let TableAddr = require("./lib/table-addr.js");
let TableToken = require("./lib/table-token.js");

let Slonik = require("slonik");

//@ts-ignore - late assignment
let Db = {
  //@ts-ignore - fake out
  Addrs: TableAddr.create(null),
  //@ts-ignore - fake out
  Tokens: TableToken.create(null, { prefix: tokenPre }),
};

Slonik.createPool(pgUrl).then(function (pool) {
  let tableAddrs = TableAddr.create(pool);
  let tableTokens = TableToken.create(pool, { prefix: tokenPre });
  Db.Addrs = tableAddrs;
  Db.Tokens = tableTokens;
});

Merchant.Db = Db;

/**
 * @param {String} msg
 * @param {HttpErrorPartial} opts
 * @returns {HttpError}
 */
Merchant.E = function (msg, opts) {
  /** @type {HttpError} */
  //@ts-ignore
  let err = new Error(msg);
  err.code = opts.code;
  err.status = opts.status;

  return err;
};

/** @type {import('express').ErrorRequestHandler} */
Merchant.finalErrorHandler = async function (err, req, res, next) {
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
};

/**
 * @param {String} a
 * @param {String} b
 */
Merchant.secureCompare = function (a, b) {
  if (!a && !b) {
    throw new Error("[secure compare] reference string should not be empty");
  }

  if (a.length !== b.length) {
    return false;
  }

  return Crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * @param {String} expectedToken
 * @returns {import('express').Handler}
 */
Merchant.webhookAuth = function (expectedToken) {
  return function webhookAuth(req, res, next) {
    // `Basic token` => `token`
    let auth = (req.headers.authorization || ``).split(" ")[1] || ``;
    let pass = Buffer.from(auth, "base64").toString("utf8").split(":")[1] || ``;

    if (!pass) {
      throw Merchant.E("no basic auth password", {
        code: "UNAUTHORIZED",
        status: 401,
      });
    }

    if (!Merchant.secureCompare(expectedToken, pass)) {
      throw Merchant.E("invalid basic auth password", {
        code: "UNAUTHORIZED",
        status: 401,
      });
    }

    next();
  };
};

/** @type {import('express').Handler} */
Merchant.rParsePaymentWebhook = async function (req, res, next) {
  let p = req.body;

  console.log(`[DEBUG] received payment webhook`, JSON.stringify(p, null, 2));

  let date = new Date();
  let at = date.toISOString();

  /** @type {FullNodeWebhook} */
  let payment = {
    // TODO was this meant to go in `details`?
    received_at: at,
    address: p.address,
    addresses: p.addresses,
    event: p.event,
    instantsend: "txlock" === p.event,
    satoshis: p.satoshis,
    txid: p.txId || p.txid || p.transaction?.txId,
    txId: p.txId || p.txid || p.transaction?.txId,
  };

  if (!payment.satoshis) {
    console.info(`Dash Payment Webhook Test (received 0)`);
    // for loopback webhook setup test
    res.json(payment);
    return;
  }

  console.info(`Dash Payment Webhook:`);
  console.info(p);

  req.payment = payment;

  next();
};

/** @type {import('express').Handler} */
Merchant.rTokenAuth = async function (req, res, next) {
  // `Token token` => `token`
  let token = (req.headers.authorization || ``).split(" ")[1] || ``;
  let account;

  let isMasterAccount = Merchant.secureCompare(masterTok, token);
  if (isMasterAccount) {
    account = MA.create(masterTok, "TODO-self-webhook");
  } else {
    account = await Db.Tokens.get(token);
  }

  if (!account) {
    throw Merchant.E("invalid token", {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  req.token = token;
  req.account = account;
  next();
};
