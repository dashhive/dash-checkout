"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  client: "pg",
  connection: process.env.PG_CONNECTION_STRING,
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: "./db/migrations",
    tableName: "knex_migrations",
  },
};
