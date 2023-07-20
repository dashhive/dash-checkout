"use strict";

let sleep = require("./sleep.js").sleep;

let Cache = {
  Addrs: {
    /**
     * @param {String} key
     */
    waitFor: function (key) {
      // MUST NOT be an 'async' tagged function
      // (must be able to return undefined)
      return Cache._addrs[key]?.promise;
    },
    /**
     * @param {Array<String>} addresses
     */
    getAny: function (addresses) {
      for (let address of addresses) {
        let info = Cache._addrs[address];
        if (info) {
          return info;
        }
      }
    },

    /**
     * @param {Array<String>} addresses
     * @param {Object} account
     * @param {String} account.ulid
     */
    getOrCreate: function (keys, value) {
      for (let key of keys) {
        let info = Cache._addrs[key];
        if (info) {
          return info.promise;
        }
      }

      let resolve;
      let promise = new Promise(function (_resolve) {
        // this is synchronous
        resolve = _resolve;
      });
      let now = Date.now();
      Object.assign(promise, {
        createdAt: now,
        resolve: resolve,
      });

      for (let key of keys) {
        Cache._addrs[key] = {
          value: value,
          promise: promise,
        };
      }

      promise.then(async function () {
        // TODO why 15s?
        // (longer that the frontend polls?)
        await sleep(15000, { unref: true });
        for (let key of keys) {
          delete Cache._addrs[key];
        }
      });

      return promise;
    },
    /**
     * @param {Array<String>} addresses
     * @param {Object} details
     */
    resolve: function (addresses, details) {
      let promise = Cache.Addrs.getAny(addresses);
      if (!promise) {
        console.warn(
          "warn: got webhook for address that could not be resolved"
        );
        console.warn(details);
        return;
      }

      promise.resolve(details);
    },
    clear: function () {
      // TODO
    },
  },
  /**
   * @type {Object.<String, Promise>}
   */
  _addrs: {},
};

exports.Cache = Cache;

// These are the tests for this module
if (require.main === module) {
  let addr = "X";
  let addrPromise = Cache.Addrs.waitFor(addr);
  if (addrPromise) {
    throw new Error(`Shouldn't have a promise yet...`);
  }
  addrPromise = Cache.Addrs.getOrCreate([addr]);
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
