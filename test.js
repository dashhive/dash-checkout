"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

let pgUrl = process.env.PG_CONNECTION_STRING;

let Slonik = require("slonik");
let sql = Slonik.sql;

async function main() {
    let pool = Slonik.createPool(pgUrl);

    let payaddr = {
        id: "h",
        pubkeyhash: "X",
        satoshis: 0,
    };
    await pool
        .query(
            sql`
              INSERT INTO payaddr (
                  id,
                  pubkeyhash,
                  satoshis
              ) VALUES (
                  ${payaddr.id},
                  ${payaddr.pubkeyhash},
                  ${payaddr.satoshis}
              )
            `
        )
        .catch(async function (err) {
            if ("UniqueIntegrityConstraintViolationError" !== err.name) {
                throw err;
            }
            let row = await pool.one(
                sql`SELECT * FROM payaddr WHERE id = ${payaddr.id}`
            );
            console.log(row);
        });
    await pool.end();
}

main().catch(function (err) {
    console.error("Fail:");
    console.error(err);
});
