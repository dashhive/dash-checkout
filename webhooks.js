"use strict";

let Hooks = module.exports;

let Crypto = require("crypto");

let DashKeys = require("dashkeys");
let request = require("./lib/request.js");

//@ts-ignore TODO
Hooks.create = function ({ defaultWebhookTimeout = 5 * 1000, Db }) {
  let hooks = {};

  /**
   * @param {HookRequest} hookReq
   * @returns {Promise<HookRequestData>}
   */
  hooks.register = async function ({ data, account, apiUsername, apiToken }) {
    let url;
    try {
      url = new URL(data.url);
    } catch (e) {
      throw new Error(`BAD_REQUEST: invalid webhook url '${data.url}'`);
    }
    //@ts-ignore TODO
    if (account?.hostnames) {
      //@ts-ignore TODO
      if (!account.hostnames.includes(url.hostname)) {
        throw new Error(`BAD_REQUEST: untrusted hostname '${url.hostname}'`);
      }
    }
    if ("https:" !== url.protocol) {
      throw new Error(`BAD_REQUEST: insecure webhook url '${url.protocol}'`);
    }

    let addr;
    try {
      addr = await DashKeys.decode(data.address);
    } catch (e) {
      throw new Error("BAD_REQUEST: invalid dash address");
    }

    // fn: test that valid auth succeeds
    if (!url.username) {
      url.username = apiUsername;
    }
    if (!url.password) {
      url.password = apiToken;
    }

    // Test Merchant's Webhook (no payment)
    // Expect 200 OK
    await request({
      timeout: defaultWebhookTimeout,
      url: data.url,
      auth: {
        username: url.username,
        password: url.password,
      },
      json: {
        address: data.address,
        satoshis: 0,
      },
    })
      //@ts-ignore TODO
      .then(function (resp) {
        if (!resp.ok) {
          throw new Error(
            `BAD_REQUEST: webhook test did not respond with 2xx OK: ${resp.statusCode}`
          );
        }
        if (0 !== resp.body.satoshis) {
          throw new Error(
            `BAD_REQUEST: webhook test did not respond with Content-Type: application/json and '{ "satoshis": 0 }'`
          );
        }
        return resp;
      })
      .catch(
        /** @param {Error} e */
        function (e) {
          if (e.message.startsWith("BAD_REQUEST:")) {
            throw e;
          }
          throw new Error(
            `BAD_REQUEST: webhook test failed network connection: ${e.message}`
          );
        }
      );

    // Test Merchant's Webhook (invalid auth)
    // Expect NOT OK
    await request({
      timeout: defaultWebhookTimeout,
      url: data.url,
      auth: {
        username: Crypto.randomUUID(),
        password: Crypto.randomUUID(),
      },
      json: { address: data.address, satoshis: 0 },
    })
      //@ts-ignore TODO
      .then(function (resp) {
        if (resp.ok) {
          throw new Error(
            "BAD_REQUEST: unauthenticated webhook test did not fail"
          );
        }
      });

    /** @type {HookTarget} */
    let hookDbData = {
      ts: Date.now(),
      address: data.address,
      pubKeyHash: addr.pubKeyHash,
      username: url.username,
      password: url.password,
      url: data.url,
    };
    await Db.add(hookDbData);

    let all = await Db.all();
    //@ts-ignore
    console.log("DEBUG", addr.pubKeyHash || "", all);

    if (url.password) {
      let prefix = url.password.slice(0, 4);
      let mask = "*".repeat(url.password.length - 6);
      let last2 = url.password.slice(-2);
      url.password = `${prefix}${mask}${last2}`;
    }

    // TODO set this on an weak-ref interval?
    // TODO don't wait for cleanup to respond?
    await Db.cleanup();

    return {
      url: url.toString(),
      address: data.address,
    };
  };

  /**
   * @param {String} payaddr - The Base58Check address
   * @param {FullNodeWebhook} payment
   */
  hooks.send = async function (payaddr, { event, txid, satoshis, p2pkh }) {
    /** @type {Array<HookTarget>?} */
    let hooks;
    if (p2pkh) {
      hooks = await Db.getByPubKeyHash(p2pkh);
    } else {
      hooks = await Db.get(payaddr);
    }
    if (!hooks) {
      return;
    }

    let evname = event;
    let out = {
      satoshis: satoshis,
    };
    let tx = {
      hash: txid,
    };

    console.info(`[${evname}] Target: ${out.satoshis} => ${payaddr}`);

    // TODO
    await mapPromise(
      hooks,
      /** @param {HookTarget} hook */
      async function (hook) {
        /** @type {FullNodeWebhook} */
        let paymentData = {
          txid: tx.hash,
          event: evname,
          instantsend: "txlock" === event,
          address: hook.address,
          // TODO duffs
          satoshis: out.satoshis,
        };

        let hookReq = {
          timeout: defaultWebhookTimeout,
          auth: {
            username: hook.username,
            password: hook.password,
          },
          url: hook.url,
          json: paymentData,
        };

        console.log("DEBEUG hookREq", hookReq);
        await request(hookReq).then(
          //@ts-ignore TODO
          function (resp) {
            if (resp.ok) {
              return resp;
            }

            console.error(`[${evname}] not OK:`);
            console.error(resp.toJSON());
            throw new Error("bad response from webhook");
          }
        );
      }
    );
  };

  return hooks;
};

//@ts-ignore
async function mapPromise(arr, fn) {
  //@ts-ignore
  let results = [];
  //@ts-ignore
  await arr.reduce(async function (promise, el, i) {
    await promise;
    let result = await fn(el, i, arr);
    results.push(result);
  }, Promise.resolve());
  //@ts-ignore
  return results;
}
