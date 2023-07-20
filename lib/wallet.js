"use strict";

let Wallet = module.exports;

let Crypto = require("node:crypto");

let DashPhrase = require("dashphrase");
let DashKeys = require("dashkeys");
let DashHd = require("dashhd");
let base32crockford = require("@scure/base").base32crockford;

DashHd.toIdBytes = async function (hdkey) {
  let xpubBytes = await DashHd.toXPubBytes(hdkey);

  let hashBuffer = await Crypto.subtle.digest("SHA-256", xpubBytes);
  let idBuffer = hashBuffer.slice(0, 8);
  let idBytes = new Uint8Array(idBuffer);

  return idBytes;
};

DashHd.toId = async function (hdkey) {
  let idBytes = await DashHd.toIdBytes(hdkey);
  let id = DashHd.utils.bytesToBase64Url(bytes);

  return id;
};

// TODO expose utils
if (!DashHd.utils) {
  DashHd.utils = {};
}
DashHd.utils.bytesToBase64Url = function (bytes) {
  let bins = [];

  for (let i = 0; i < bytes.length; i += 1) {
    let b = bytes[i];
    let s = String.fromCodePoint(b);
    bins.push(s);
  }

  let str = bins.join("");
  let b64 = btoa(str);
  let b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  return b64url;
};

Wallet.fromPhrase = async function (phrase, salt) {
  let seedBytes = await DashPhrase.toSeed(phrase, salt);
  //let seed = DashKeys.utils.bytesToHex(seedBytes);
  // console.log('Seed', seed);
  let hdKey = DashHd.fromSeed(seedBytes);

  return hdKey;
};

Wallet.phraseToSeed = async function (phrase, salt) {
  let seed = await DashPhrase.toSeed(phrase, salt);

  return seed;
};

Wallet.seedToWallet = async function (seed) {
  let hdKey = DashHd.fromSeed(seed);

  return hdKey;
};

Wallet.xkeyToHdKey = async function (xkey) {
  let hdkey = await DashHd.fromXKey(xkey);

  return hdkey;
};

/**
 * @param {DashHd.HDWallet} walletKey
 * @returns {Promise<String>}
 */
Wallet.toId = async function (walletKey) {
  let idBytes = await DashHd.toIdBytes(walletKey);
  let id = DashHd.utils.bytesToBase64Url(idBytes);

  return id;
};

/**
 * @param {DashHd.HDWallet} walletKey
 */
Wallet.toIds = async function (walletKey) {
  let idBytes = await DashHd.toIdBytes(walletKey);

  let id = DashHd.utils.bytesToBase64Url(idBytes);
  let idBase32Crock = base32crockford.encode(idBytes);
  let idHex = DashKeys.utils.bytesToHex(idBytes);
  let idInt64 = BigInt(`0x${idHex}`);

  return {
    id,
    idBase32Crock,
    idHex,
    idInt64,
  };
};

/**
 * @param {DashHd.HDWallet} walletKey
 * @param {Number} accountIndex
 * @returns {Promise<DashHd.HDXKey>}
 */
Wallet.toXPrvKey = async function getXPrv(walletKey, accountIndex) {
  //let walletKey = await Wallet.fromPhrase(walletPhrase);

  let accountKey = await walletKey.deriveAccount(accountIndex);
  let xprvKey = await accountKey.deriveXKey(DashHd.RECEIVE);

  //let addressKey = await xprvKey.deriveAddress(index);

  return xprvKey;
};

/**
 * @param {DashHd.HDWallet} walletKey
 * @param {Number} accountIndex
 * @returns {Promise<DashHd.HDXKey>}
 */
Wallet.toXPubKey = async function (walletKey, accountIndex) {
  //let walletKey = await Wallet.fromPhrase(walletPhrase);

  let accountKey = await walletKey.deriveAccount(accountIndex);
  let xprvKey = await accountKey.deriveXKey(DashHd.RECEIVE);

  //let xpub = DashHd.toXPub(xprvKey);
  xprvKey.privateKey = null;
  let xpubKey = xprvKey;

  return xpubKey;
};

/**
 * @param {DashHd.HDWallet} walletKey
 * @param {Number} accountIndex
 * @returns {Promise<String>}
 */
Wallet.toXPub = async function (walletKey, accountIndex) {
  //let walletKey = await Wallet.fromPhrase(walletPhrase);

  let accountKey = await walletKey.deriveAccount(accountIndex);
  let xprvKey = await accountKey.deriveXKey(DashHd.RECEIVE);
  let xpub = DashHd.toXPub(xprvKey);

  return xpub;
};

// TODO
// Storage.getNextAccountIndex()
// Storage.getUnusedAddresses(100)
// Api.checkAddresses(addresses)
// Storage.setAddressesPending(addresses)
// Storage.setAddressesUsed(addresses)

async function main() {
  console.info();
  console.info("Wallet ID:");
  let phrase = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
  let salt = "TREZOR";
  let hdkey = await Wallet.fromPhrase(phrase, salt);
  let ids = await Wallet.toIds(hdkey);
  console.info(JSON.stringify(ids, null, 2));

  console.info();
  console.info("Customer XPub ID:");
  let hdpath = "m/44'/5'/0'/0";
  let xprvKey = await DashHd.derivePath(hdkey, hdpath);
  ids = await Wallet.toIds(xprvKey);
  console.info(JSON.stringify(ids, null, 2));

  console.info();
}

if (require.main === module) {
  main().catch(function (e) {
    console.error(e);
  });
}
