"use strict";

let Slonik = require("slonik");
let sql = Slonik.sql;

/**
 * @param {Slonik.DatabasePoolConnection} pool
 */
exports.create = function (pool) {
  let PayAddr = {};

  // This helps keep track of the xpubkey increment
  PayAddr.next = async function () {
    let insertPayInfo = sql.unsafe`
        INSERT INTO payaddr (
            id
        ) VALUES (
            DEFAULT
        )
        RETURNING id
    `;

    let index = await pool.oneFirst(insertPayInfo);
    /*
    .catch(async function (err) {
      if ("UniqueIntegrityConstraintViolationError" !== err.name) {
        throw err;
      }
    });
    */

    return index;
  };

  /*
    PayAddr._upsert = async function (payaddr) {
        if (PayAddr._addrs[payaddr]) {
            return;
        }

        PayAddr._addrs[payaddr] = {
            created_at: new Date().toISOString(),
            satoshis: 0,
            // last_payment_at
            paid_at: null,
        };
    };
    PayAddr._addrs: {},
  */

  /**
   * @param {Object} opts
   * @param {Array<Number>} opts.indexes
   * @param {Number} opts.satoshis
   */
  PayAddr.receive = async function ({ indexes, satoshis }) {
    let ids = sql.array(indexes, sql.fragment`int[]`);
    let updateAmount = sql.unsafe`
        UPDATE
            payaddr
        SET
            amount = ${satoshis},
            last_payment_at = NOW()
        WHERE
            id = ANY(${ids})
    `;

    await pool.query(updateAmount);
  };

  /**
   * @param {Object} opts
   * @param {Number} opts.id
   */
  PayAddr.get = async function ({ id }) {
    let selectPayInfo = sql.unsafe`SELECT * FROM payaddr WHERE id = ${id}`;
    let row = await pool.one(selectPayInfo);

    return row;
  };

  return PayAddr;
};
