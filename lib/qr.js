"use strict";

let Qr = module.exports;

let QrCode = require("qrcode-svg");

/**
 * @typedef QrOpts
 * @property {String} [background]
 * @property {String} [color]
 * @property {"M" | "L" | "H" | "Q"} [ecl]
 * @property {Number} [height]
 * @property {Number} [indent]
 * @property {Number} [padding]
 * @property {"full" | "mini" | "micro"} [size]
 * @property {Number} [width]
 */

/**
 * @param {String} data
 * @param {QrOpts} opts
 */
Qr._create = function (data, opts) {
  let qrOpts = {
    content: data,
    padding: opts?.padding || 4,
    width: opts?.width || 256,
    height: opts?.height || 256,
    color: opts?.color || "#000000",
    background: opts?.background || "#ffffff",
    ecl: opts?.ecl || "M",
  };

  return new QrCode(qrOpts);
};

/**
 * @param {String} data
 * @param {QrOpts} [opts]
 */
Qr.toSvg = function (data, opts) {
  let qrcode = Qr._create(data, opts);
  return qrcode.svg();
};

/**
 * @typedef DashUrlOpts
 * @prop {String?} [xpub]
 * @prop {String} address
 * @prop {Array<Number>?} [denoms]
 * @prop {Number?} [amount]
 * @prop {String?} [nickname]
 */

/**
 * @param {DashUrlOpts} opts
 */
Qr.toUrl = function toUrl({ xpub, address, denoms, amount, nickname }) {
  if (!address) {
    address = "";
  }

  // TODO tdash, et al
  let coinScheme = "dash";
  let query = {};
  if (xpub) {
    query.xpub = xpub;
  }
  if (denoms?.length) {
    query.denoms = denoms.join(",");
  }
  if (nickname) {
    query.suggested_nickname = nickname;
  }
  if (amount) {
    query.amount = amount;
  }

  //@ts-ignore - query can actually be Record<String,String|Number|Bool>
  let search = new URLSearchParams(query).toString();

  // impossible compatibility? (should be allowed either way)
  //let slashes = "//";
  let slashes = "";
  let content = `${coinScheme}:${slashes}${address}?${search}`;
  return content;
};
