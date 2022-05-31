"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

let pgUrl = process.env.PG_CONNECTION_STRING;
let tokenPre = process.env.TOKEN_PRE || "hel_";
let xpubKey = process.env.XPUB_KEY;

let TableAddr = require("../lib/table-addr.js");
let TableToken = require("../lib/table-token.js");

let Wallet = require("@root/merchant-wallet").Wallet;
let Coins = require("@root/merchant-wallet/lib/coins.json");

let Slonik = require("slonik");

async function main() {
  let wallet = Wallet.create(Coins.dash);

  let dbPool = Slonik.createPool(pgUrl);

  let Addr = TableAddr.create(dbPool);
  let Token = TableToken.create(dbPool, { prefix: tokenPre });

  let walletIndex = await Addr.next();

  let payaddr = await wallet.addrFromXPubKey(xpubKey, walletIndex);
  await Token.generate(walletIndex, payaddr, { email: null });

  let now = Date.now();
  await Token.reset({
    payaddr: payaddr,
    quota: {
      hard_quota: 11,
      soft_quota: 10,
      stale: new Date(now + 15 * 60 * 1000),
      exp: new Date(now + 20 * 60 * 1000),
    },
  });

  dbPool.end();
}

main();
