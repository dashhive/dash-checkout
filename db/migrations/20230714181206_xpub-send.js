"use strict";

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.transaction(async function (trx) {
    await knex.schema
      .createTable("wallet", function (table) {
        table.specificType("id", "varchar").primary({ primaryKey: true }); // int8/int64

        // (optionally) store the wallet in the database
        table
          .enum("secret_type", ["phrase", "seed", "xprv"], {
            useNative: true,
            enumName: "secret_type_enum",
          })
          .nullable();
        table.string("secret").nullable();

        addTs(table);
      })
      .transacting(trx);

    await knex.schema
      .createTable("account", function (table) {
        table.specificType("ulid", "char(34)").primary({ primaryKey: true });

        table.specificType("wallet_id", "char(11)").notNullable(); // int8/int64
        // note: this should scale with a write lock - creating a billing account is rare
        table.specificType("index", "serial").notNullable(); // int4/int32
        table.specificType("xpub", "char(111)").notNullable();

        // int4/int32
        table.specificType("soft_quota", "integer").notNullable().defaultTo(0);
        table.specificType("hard_quota", "integer").notNullable().defaultTo(0);

        // for paid features
        table.timestamp("stale_at", { useTz: false }).nullable();
        table.timestamp("expires_at", { useTz: false }).nullable();

        // for notifications
        table.string("email").nullable();
        table.string("phone").nullable();
        table.string("webhook").nullable();

        addTs(table);

        // foreign keys
        table
          .foreign("wallet_id")
          .references("wallet.id")
          .deferrable("deferred");
      })
      .transacting(trx);
    await knex
      .raw(`ALTER SEQUENCE "account_index_seq" MINVALUE 1`)
      .transacting(trx);
    await knex
      .raw(`ALTER SEQUENCE "account_index_seq" RESTART WITH 1`)
      .transacting(trx);

    await knex.schema
      .createTable("base62_token", function (table) {
        // lookup by 'id' to protect against timing attack
        table.specificType("hash_id", "char(24)").primary({ primaryKey: true });
        table.specificType("token", "char(40)").notNullable();
        table.specificType("account_ulid", "char(34)").notNullable();

        // TODO stale_at, expires_at
        table.timestamp("revoked_at", { useTz: false }).nullable();

        table
          .foreign("account_ulid")
          .references("account.ulid")
          .deferrable("deferred");

        addTs(table);
      })
      .transacting(trx);

    // for quotas, rate limits, etc
    await knex.schema
      .createTable("base62_token_use", function (table) {
        table.specificType("id", "serial").primary({ primaryKey: true });

        table.specificType("base62_token_hash_id", "char(24)").notNullable();

        // audit trail
        // ex: 'GET /api/hello'
        table.specificType("resource", "varchar").nullable();

        // foreign keys
        table
          .foreign("base62_token_hash_id")
          .references("base62_token.hash_id")
          .deferrable("deferred");

        // timestamps
        table
          .timestamp("created_at", { useTz: false })
          .notNullable()
          .defaultTo(knex.fn.now());
      })
      .transacting(trx);

    await knex.schema
      .createTable("payment", function (table) {
        table.specificType("ulid", "char(34)").primary({ primaryKey: true });
        table.specificType("account_ulid", "char(34)").notNullable();
        table.specificType("satoshis", "bigint").notNullable(); // int8/int64

        // foreign keys
        table
          .foreign("account_ulid")
          .references("account.ulid")
          .deferrable("deferred");

        // timestamps
        table
          .timestamp("created_at", { useTz: false })
          .notNullable()
          .defaultTo(knex.fn.now());
        table.timestamp("paid_at", { useTz: false });
      })
      .transacting(trx);

    await knex.schema
      .createTable("address_cache", function (table) {
        table.specificType("address", "char(34)").primary({ primaryKey: true });
        table.specificType("wallet_id", "char(11)").notNullable(); // int8/int64
        table.specificType("account_ulid", "char(34)").notNullable();
        table.specificType("address_index", "integer").notNullable(); // int4/int32
        table.specificType("payment_ulid", "char(34)").notNullable();

        addTs(table);

        // foreign keys
        table
          .foreign("account_ulid")
          .references("account.ulid")
          .deferrable("deferred");
        table
          .foreign("payment_ulid")
          .references("payment.ulid")
          .deferrable("deferred");
      })
      .transacting(trx);

    await knex.schema
      .createTable("coin_cache", function (table) {
        table.specificType("ulid", "char(34)").primary({ primaryKey: true });
        table.specificType("address", "char(34)").notNullable();
        //     10.000 000 00 // 10 DASH (near int32 max)
        //     1,000,000,000
        // 10,000.000 000 00 // 10,000 DASH (high, but realistic - well beyond int32)
        // 1,000,000,000,000
        table.specificType("satoshis", "bigint").notNullable(); // int8/int64
        //table.specificType("output_index", "smallint").index(); // int2/int16
        //table.specificType("tx_id", "char(64)").index(); 32 bytes

        addTs(table);
      })
      .transacting(trx);

    function addTs(table) {
      // timestamps
      table
        .timestamp("created_at", { useTz: false })
        .notNullable()
        .defaultTo(knex.fn.now());
      table
        .timestamp("updated_at", { useTz: false })
        .notNullable()
        .defaultTo(knex.fn.now());
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.transaction(async function (trx) {
    await knex.table("payment", function (table) {
      table.dropForeign(["account_ulid"]).transacting(trx);
    });
    await knex.schema.dropTable("payment").transacting(trx);

    await knex.table("address_cache", function (table) {
      table.dropForeign(["account_ulid"]).transacting(trx);
      table.dropForeign(["payment_ulid"]).transacting(trx);
    });
    await knex.schema.dropTable("address_cache").transacting(trx);

    await knex.table("base62_token_use", function (table) {
      table.dropForeign(["base62_token_hash_id"]).transacting(trx);
    });
    await knex.schema.dropTable("base62_token_use").transacting(trx);

    await knex.table("base62_token", function (table) {
      table.dropForeign(["account_ulid"]).transacting(trx);
    });
    await knex.schema.dropTable("base62_token").transacting(trx);

    await knex.table("account", function (table) {
      table.dropForeign(["wallet_id"]).transacting(trx);
    });
    await knex.schema.dropTable("account").transacting(trx);

    await knex.schema.dropTable("wallet").transacting(trx);
    await knex.raw("DROP TYPE secret_type_enum").transacting(trx);

    await knex.schema.dropTable("coin_cache").transacting(trx);

    await trx.commit().catch(trx.rollback);
  });
};
