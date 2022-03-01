"use strict";

let sleep = require("./sleep.js").sleep;

let Cache = {
    Addrs: {
        waitFor: function (paymentAddress) {
            // MUST NOT be async
            // (must be able to return undefined)
            return Cache._addrs[paymentAddress];
        },
        getOrCreate: function (paymentAddress) {
            if (Cache._addrs[paymentAddress]) {
                return Cache._addrs[paymentAddress];
            }

            let resolve;
            let promise = new Promise(function (_resolve) {
                // this is synchronous
                resolve = _resolve;
            });
            promise.createdAt = Date.now();
            promise.resolve = resolve;

            Cache._addrs[paymentAddress] = promise;

            promise.then(async function () {
                // TODO why 15s?
                await sleep(15000, { unref: true });
                delete Cache._addrs[paymentAddress];
            });

            return promise;
        },
        clear: function () {
            // TODO
        },
    },
    _addrs: {},
};

exports.Cache = Cache;

if (require.main === module) {
    let addr = "X";
    let addrPromise = Cache.Addrs.waitFor(addr);
    if (addrPromise) {
        throw new Error(`Shouldn't have a promise yet...`);
    }
    addrPromise = Cache.Addrs.getOrCreate(addr);
    if (!addrPromise) {
        throw new Error(`Should have a promise`);
    }

    let addrPromise2 = Cache.Addrs.getOrCreate(addr);
    if (addrPromise !== addrPromise2) {
        throw new Error(`The same promise should be returned`);
    }

    addrPromise2 = Cache.Addrs.waitFor(addr);
    if (addrPromise !== addrPromise2) {
        throw new Error(`The same promise should be returned`);
    }
    addrPromise2.then(function (data) {
        console.info("Done:", data);
    });

    let result = {
        received_at: new Date().toISOString(),
        address: "X",
        satoshis: 0,
    };
    addrPromise.resolve(result);
}
