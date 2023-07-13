"use strict";

let Crypto = require("crypto");

let Base62Token = require("base62-token");
let Slonik = require("slonik");
let sql = Slonik.sql;

let dict = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let b62Token = Base62Token.create(dict);
let tokenLen = 30;
let tokenIdLen = 24;

function toWeb64(b) {
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function hash(val, n) {
  let h = Crypto.createHash("sha256").update(val).digest("base64");
  return toWeb64(h).slice(0, n);
}

exports.create = function (pool, { prefix }) {
  let Token = {};

  Token.generate = async function (
    walletIndex,
    payaddr,
    { email = null, phone = null, webhook = null }
  ) {
    let token = b62Token.generate(prefix, tokenLen);
    let id = hash(token, tokenIdLen);

    let row = {
      id,
      token,
      email,
      phone,
      webhook,
      soft_quota: 0,
      hard_quota: 0,
      stale_at: new Date(0).toISOString(),
      expires_at: new Date(0).toISOString(),
    };

    let insertToken = sql`
        INSERT INTO token (
            id,
            token,
            email,
            phone,
            webhook,
            soft_quota,
            hard_quota,
            stale_at,
            expires_at
        ) VALUES (
            ${row.id},
            ${row.token},
            ${row.email},
            ${row.phone},
            ${row.webhook},
            ${row.soft_quota},
            ${row.hard_quota},
            ${row.stale_at},
            ${row.expires_at}
        )
    `;

    let joinId = hash(`${walletIndex}:${token}`, tokenIdLen);
    let insertPayaddrToken = sql`
        INSERT INTO payaddr_token (
            id,
            payaddr_id,
            payaddr,
            token_id
        ) VALUES (
            ${joinId},
            ${walletIndex},
            ${payaddr},
            ${row.id}
        )
    `;

    await pool.query(insertToken);
    await pool.query(insertPayaddrToken);

    return row;
  };

  /**
   * @param {Object} opts
   * @param {String} opts.payaddr
   * @param {PlanQuota} opts.quota
   * @returns {Promise<Account>}
   */
  Token.reset = async function ({ payaddr, quota }) {
    let account = await Token._getByPayaddr(payaddr);

    //Db._tokens[id]
    let row = {
      id: account.id,
      token: account.token,
      soft_quota: quota.soft_quota,
      hard_quota: quota.hard_quota,
      stale_at: quota.stale.toISOString(),
      expires_at: quota.exp.toISOString(),
    };

    //Db._tokens[id] = row;
    await pool.query(sql`
            UPDATE
                token
            SET
                id = ${row.id},
                token = ${row.token},
                soft_quota = ${row.soft_quota},
                hard_quota = ${row.hard_quota},
                stale_at = ${row.stale_at},
                expires_at = ${row.expires_at}
            WHERE
                token = ${row.token}
        `);

    //@ts-ignore TODO
    return row;
  };
  Token._getByPayaddr = async function (payaddr) {
    return await pool.one(sql`
            SELECT
                token.id as id,
                token.token as token
            FROM
                token
            INNER JOIN
                payaddr_token ON token.id = payaddr_token.token_id
            INNER JOIN
                payaddr ON payaddr.id = payaddr_token.payaddr_id
            WHERE token.revoked_at IS NULL
                AND payaddr_token.payaddr = ${payaddr}
            ORDER BY
                payaddr.last_payment_at DESC
        `);
  };

  /**
   * @param {String} token
   * @returns {Promise<Account>}
   */
  Token.get = async function (token) {
    let id = hash(token, tokenIdLen);
    //return Db._tokens[id];
    let [row, count] = await Promise.all([Token._get(id), Token._getCount(id)]);

    if (row) {
      row.request_count = count;
    }
    return row;
  };
  /**
   * @param {String} id
   */
  Token._get = async function (id) {
    let query = sql`
            SELECT
                *
            FROM
                token
            WHERE token.revoked_at IS NULL
                AND id = ${id}
        `;
    return await pool.maybeOne(query);
  };
  /**
   * @param {String} id
   */
  Token._getCount = async function (id) {
    return await pool.maybeOneFirst(sql`
            SELECT
                count(token_id)
            FROM
                token_use
            WHERE
                token_id = ${id}
        `);
  };

  /**
   * @param {String} token
   */
  Token.getWithPayaddrs = async function (token) {
    let id = hash(token, tokenIdLen);
    //return Db._tokens[id];
    let [row, count, payaddrs] = await Promise.all([
      Token._get(id),
      Token._getCount(id),
      pool.any(sql`
                SELECT
                    payaddr_token.payaddr_id as id,
                    amount,
                    last_payment_at
                FROM
                    payaddr_token
                INNER JOIN
                    payaddr ON payaddr_token.payaddr_id = payaddr.id
                WHERE
                    token_id = ${id}
                ORDER BY
                    last_payment_at DESC
            `),
    ]);

    if (row) {
      row.request_count = count;
      if (payaddrs?.length) {
        row.amount = payaddrs[0].amount;
      }
    }
    return [row, payaddrs];
  };

  /**
   * @param {String} token
   * @param {Object} opts
   * @param {String} opts.resource
   */
  Token.touch = async function (token, { resource }) {
    if ("*" === token) {
      return;
    }
    let id = hash(token, tokenIdLen);
    if (!resource) {
      resource = "";
    }
    return await pool.query(sql`
            INSERT INTO token_use (
                id,
                token_id,
                resource
            ) VALUES (
                DEFAULT,
                ${id},
                ${resource}
            )
        `);
  };

  return Token;
};
