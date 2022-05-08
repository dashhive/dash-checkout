"use strict";

let Slonik = require("slonik");
let sql = Slonik.sql;

exports.create = function (pool) {
    let Payaddr = {};

    // This helps keep track of the xpubkey increment
    Payaddr.next = async function () {
        let index = await pool
            .oneFirst(
                sql`
                    INSERT INTO payaddr (
                        id
                    ) VALUES (
                        DEFAULT
                    )
                    RETURNING id
                `
            )
            .catch(async function (err) {
                if ("UniqueIntegrityConstraintViolationError" !== err.name) {
                    throw err;
                }
            });
        return index;
    };
    /*
    Payaddr._upsert = async function (payaddr) {
        if (Payaddr._addrs[payaddr]) {
            return;
        }

        Payaddr._addrs[payaddr] = {
            created_at: new Date().toISOString(),
            satoshis: 0,
            // last_payment_at
            paid_at: null,
        };
    };
    Payaddr._addrs: {},
    */
    Payaddr.receive = async function ({ payaddr, amount }) {
        await pool.query(sql`
            UPDATE
                payaddr
            SET
                amount = ${amount},
                last_payment_at = NOW()
        `);
    };
    Payaddr.get = async function (payaddr) {
        let row = await pool.one(
            sql`SELECT * FROM payaddr WHERE id = ${payaddr.id}`
        );
        return row;
    };

    return Payaddr;
};
