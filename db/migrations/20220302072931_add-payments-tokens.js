"use strict";

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    //let pkOpts = { deferrable: "deferred" };
    let pkOpts = {};

    await knex.schema.createTable("payaddr", function (table) {
        table.increments("id").primary({ primaryKey: true });
        //table.string("pubkeyhash", 34).notNullable();
        table.integer("amount").defaultTo(0);
        table.timestamp("last_payment_at", { useTz: false }).nullable();

        // timestamps
        table
            .timestamp("created_at", { useTz: false })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.timestamp("revoked_at", { useTz: false }).nullable();
    });

    await knex.schema.createTable("token", function (table) {
        table.string("id", 24).primary(pkOpts);
        table.string("token", 96).notNullable();

        // for notifications
        table.string("email").nullable();
        table.string("phone").nullable();
        table.string("webhook").nullable();
        //table.string("totp").nullable();

        // quota / limit / use info
        table.integer("soft_quota").notNullable().defaultTo(0);
        table.integer("hard_quota").notNullable().defaultTo(0);
        table.timestamp("stale_at", { useTz: false }).nullable();
        table.timestamp("expires_at", { useTz: false }).nullable();

        // timestamps
        table
            .timestamp("created_at", { useTz: false })
            .notNullable()
            .defaultTo(knex.fn.now());
        table
            .timestamp("reset_at", { useTz: false })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.timestamp("revoked_at", { useTz: false }).nullable();
    });

    // for quotas, rate limits, etc
    await knex.schema.createTable("token_use", function (table) {
        table.increments("id").primary({ primaryKey: true });

        table.string("token_id", 24).notNullable();
        // audit trail
        // ex: 'GET /api/hello'
        table.string("resource", 24).nullable();

        // timestamps
        table
            .timestamp("created_at", { useTz: false })
            .notNullable()
            .defaultTo(knex.fn.now());

        // foreign keys
        table.foreign("token_id").references("token.id").deferrable("deferred");
    });

    await knex.schema.createTable("payaddr_token", function (table) {
        table.string("id", 24).primary(pkOpts);
        table.integer("payaddr_id").unsigned().notNullable();
        table.string("token_id", 24).notNullable();

        // pubkeyhash
        table.string("payaddr", 34).notNullable();

        // timestamps
        table
            .timestamp("created_at", { useTz: false })
            .notNullable()
            .defaultTo(knex.fn.now());

        // foreign keys
        table
            .foreign("payaddr_id")
            .references("payaddr.id")
            .deferrable("deferred");
        table.foreign("token_id").references("token.id").deferrable("deferred");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    // TODO make this a deferrable tx
    await knex.transaction(async function (trx) {
        await knex.table("payaddr_token", function (table) {
            table.dropForeign(["payaddr_id", "token_id"]).transacting(trx);
        });
        await knex.schema.dropTable("payaddr_token").transacting(trx);

        await knex.table("token_use", function (table) {
            table.dropForeign(["token_id"]).transacting(trx);
        });
        await knex.schema.dropTable("token_use").transacting(trx);

        await knex.schema.dropTable("token").transacting(trx);
        await knex.schema.dropTable("payaddr").transacting(trx);
        await trx.commit().catch(trx.rollback);
    });
};
