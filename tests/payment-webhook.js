"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

let dwhToken = process.env.DWH_TOKEN ?? "";

let request = require("@root/request");

async function main() {
    let payaddr = "XsxrNsatujzMMVnM36wFHXvPxgJvw43xX9";
    let baseUrl = `http://localhost:3274`;

    let satoshis = 100101;
    let auth64 = Buffer.from(`dwh:${dwhToken}`).toString("base64");
    let resp = await request({
        url: `${baseUrl}/api/webhooks/dwh`,
        timeout: 5 * 1000,
        headers: {
            Authorization: `Basic ${auth64}`,
        },
        json: {
            address: payaddr,
            satoshis: satoshis,
        },
    });
    if (resp.ok && satoshis === resp.body.satoshis) {
        console.info("PASS");
        return;
    }

    console.error("Fail:");
    console.error(resp.toJSON().body);
}

main();
