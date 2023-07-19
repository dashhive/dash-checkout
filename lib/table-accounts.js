"use strict";

let Crypto = require("crypto");

let Base62Token = require("base62-token");
let dict = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let b62Token = Base62Token.create(dict);
const TOKEN_LEN = 30;
const TOKEN_ID_LEN = 24;

let Slonik = require("slonik");
let sql = Slonik.sql;
let ULID = require("ulid");

/**
 * @param {Slonik.DatabasePoolConnection} pool
 */
exports.create = function (pool) {
  let Accounts = {};

  /**
   * For tracking wallet relationships
   * @param {Object} wallet
   * @param {String} wallet.id
   */
  Accounts._setWalletId = async function (wallet) {
    let insertAccount = sql.unsafe`
        INSERT INTO wallet (
            id
        ) VALUES (
            ${wallet.id}
        ) ON CONFLICT DO NOTHING
    `;

    await pool.query(insertAccount);
  };

  /**
   * This helps keep track of the xpubKey increment
   * @param {Object} account
   * @param {String} [account.ulid]
   * @param {String} account.walletId
   */
  Accounts.next = async function (account) {
    let ulid = account.ulid || ULID.ulid();
    let xpub = "";
    let insertAccount = sql.unsafe`
        INSERT INTO account (
            ulid,
            wallet_id,
            index,
            xpub
        ) VALUES (
            ${ulid},
            ${account.walletId},
            DEFAULT,
            ${xpub}
        )
        RETURNING index
    `;

    let index = await pool.oneFirst(insertAccount);

    let newAccount = {
      ulid: ulid,
      walletId: account.walletId,
      index: index,
      xpub: "",
    };

    return newAccount;
  };

  /**
   * Sets the XPub to the Account
   * @param {Object} account
   * @param {String} account.ulid
   * @param {String} account.xpub
   */
  Accounts.setXPub = async function (account) {
    let setXPub = sql.unsafe`
        UPDATE
            account
        SET
            xpub = ${account.xpub}
        WHERE
            ulid = ${account.ulid}
    `;

    await pool.query(setXPub);
  };

  /**
   * Sets the XPub to the Account
   * @param {Object} account
   * @param {String} account.ulid
   */
  Accounts.getPrevPayment = async function (account) {
    let setXPub = sql.unsafe`
        SELECT
            index
        FROM
            payment
        WHERE
            account_ulid = ${account.ulid}
        ORDER BY
            updated_at DESC
        LIMIT 1
    `;

    let index = await pool.maybeOneFirst(setXPub);
    if (null === index) {
      index = -1;
    }

    return index;
  };

  /**
   * @param {String} prefix
   * @param {Object} account
   * @param {Number} account.index
   * @param {String} account.ulid
   * @param {Object} contact
   * @param {String?} contact.email
   * @param {String?} contact.phone
   * @param {String?} contact.webhook
   * @returns {Promise<String>} - token
   */
  Accounts.createToken = async function (
    prefix,
    account,
    { email = null, phone = null, webhook = null }
  ) {
    let token = b62Token.generate(prefix, TOKEN_LEN);
    let hashId = hash(token, TOKEN_ID_LEN);

    let insertToken = sql.unsafe`
        INSERT INTO base62_token (
            hash_id,
            token,
            account_ulid
        ) VALUES (
            ${hashId},
            ${token},
            ${account.ulid}
        )
    `;
    await pool.query(insertToken);

    return token;
  };

  /**
   * @param {String} token
   */
  Accounts.getByToken = async function (token) {
    let hashId = hash(token, TOKEN_ID_LEN);

    // let account = await pool.any
    let account = await pool.maybeOne(sql.unsafe`
        SELECT
            account.ulid as ulid,
            account.wallet_id as wallet_id,
            account.index as index,
            account.xpub as xpub
        FROM
            base62_token
        INNER JOIN
            account ON base62_token.account_ulid = account.ulid
        WHERE
            base62_token.hash_id = ${hashId}
        ORDER BY
            base62_token.created_at DESC
    `);

    return account;
  };

  return Accounts;
};

/**
 * @param {String} base64
 */
function toWeb64(base64) {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * @param {String|Buffer|Uint8Array} bytes
 * @param {Number} length
 */
function hash(bytes, length) {
  let hash = Crypto.createHash("sha256");
  hash.update(bytes);

  let str = hash.digest("base64");
  str = toWeb64(str);
  str = str.slice(0, length);
  return str;
}
