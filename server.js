"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let Crypto = require("crypto");

let request = require("@root/request");
let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.enable("trust proxy");
server.use("/", app);

let dwhToken = process.env.DWH_TOKEN ?? "";
let dashAddress = process.env.DASH_ADDRESS ?? "";
let dashWebhooker = process.env.DASH_WEBHOOKER ?? "";

function auth(req, res, next) {
    // `Basic token` => `token`
    let auth = (req.headers.authorization || ``).split(" ")[1] || ``;
    let pass = Buffer.from(auth, "base64").toString("utf8").split(":")[1] || ``;
    if (!pass) {
        throw new Error("no basic auth password");
    }

    if (!secureCompare(dwhToken, pass)) {
        throw new Error("invalid basic auth pass");
    }

    next();
}

function secureCompare(a, b) {
    if (!a && !b) {
        throw new Error(
            "[secure compare] reference string should not be empty"
        );
    }

    if (a.length !== b.length) {
        return false;
    }

    return Crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

app.use(
    "/api",
    bodyParser.json({
        limit: "100kb",
        strict: true,
    })
);

app.post("/api/addresses", async function (req, res) {
    let resp = await request({
        timeout: 5 * 1000,
        url: dashWebhooker,
        headers: {
            Authorization: `Bearer ${dwhToken}`,
        },
        json: {
            address: dashAddress,
            url: `https://${req.hostname}/api/webhooks/dwh`,
        },
    });
    res.json(resp.body);
});

app.post("/api/webhooks/dwh", auth, async function (req, res) {
    let data = req.body;

    if (!data.satoshis) {
        console.info(`Dash Payment Webhook Test (received 0 satoshis)`);
        res.json({ address: data.address, satoshis: data.satoshis });
        return;
    }

    console.info(`Dash Payment Webhook:`);
    console.info(data);
    res.json({ address: data.address, satoshis: data.satoshis });
});

app.use("/api", function (err, req, res, next) {
    res.statusCode = 400;
    res.json({
        status: err.status,
        code: err.code,
        message: err.message,
    });
});

module.exports = server;

if (require.main === module) {
    let PORT = process.env.PORT || 3274; // DASH
    let Http = require("http");
    let httpServer = Http.createServer(server);

    httpServer.listen(PORT, function () {
        console.info(`Listening on`, httpServer.address());
    });
}
