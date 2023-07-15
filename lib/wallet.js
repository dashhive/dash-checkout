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
  let seed = await DashPhrase.toSeed(phrase, salt);
  let hdKey = DashHd.fromSeed(seed);

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

Wallet.toId = async function (hdkey) {
  let idBytes = await DashHd.toIdBytes(hdkey);

  let id = DashHd.utils.bytesToBase64Url(idBytes);
  let idBase32Crock = base32crockford.encode(idBytes);
  let idHex = DashKeys.utils.bytesToHex(idBytes);
  let idInt64 = BigInt(`0x${idHex}`);

  console.info(id);
  console.info(idBase32Crock);
  console.info(idHex);
  console.info(idInt64);
};

async function main() {
  let phrase = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
  let salt = "TREZOR";
  let hdkey = await Wallet.fromPhrase(phrase, salt);
  await Wallet.toId(hdkey);

  let hdpath = "m/44'/5'/0'/0";
  let xprvKey = await DashHd.derivePath(hdkey, hdpath);
  await Wallet.toId(xprvKey);
}

main().catch(function (e) {
  console.error(e);
});
