"use strict";

let HooksDb = module.exports;

let defaultStaleAge = 15 * 60 * 1000;

/**
 * @typedef {Object} HookDb
 * @property {HookDataAdd} add
 * @property {HookDataGet} get
 */

/**
 * @typedef {Object} HookDbOpts
 * @property {Number} [staleAge] - how long to keep webhook in memory (in ms)
 */

/**
 * @typedef {Function} HookDataAdd
 * @param {HookTarget} hook
 * @returns {Promise<void>}
 */

/**
 * @typedef {Function} HookDataGet
 * @param {String} address - human-friendly (ish) network payment address
 * @returns {Promise<HookTarget>}
 */

/**
 * @param {HookDbOpts} opts
 * @returns {HookDb}
 */
HooksDb.create = function ({ staleAge = defaultStaleAge }) {
  let hooksDb = {};
  /** @type {Record<String,Array<HookTarget>>} */
  let registeredAddresses = {};

  /**
   * @param {Base58Check} address
   * @returns {Promise<Array<HookTarget>?>}
   */
  hooksDb.get = async function (address) {
    return registeredAddresses[address];
  };

  /**
   * @param {P2PKH} p2pkh
   * @returns {Promise<Array<HookTarget>?>}
   */
  hooksDb.getByPubKeyHash = async function (p2pkh) {
    return registeredAddresses[p2pkh];
  };

  hooksDb.all = async function () {
    return registeredAddresses;
  };

  /** @param {HookTarget} hook */
  hooksDb.add = async function (hook) {
    if (registeredAddresses[hook.address]) {
      registeredAddresses[hook.address].push(hook);
      return;
    }

    let hooks = [hook];
    registeredAddresses[hook.address] = hooks;
    registeredAddresses[hook.pubKeyHash] = hooks;
  };

  hooksDb.cleanup = async function () {
    let freshtime = Date.now() - staleAge;
    Object.keys(registeredAddresses).forEach(function (key) {
      registeredAddresses[key] = registeredAddresses[key].filter(function (
        hook
      ) {
        let isFresh = hook.ts > freshtime;
        if (!isFresh) {
          console.log("[DEBUG] delete", hook);
          return false;
        }
        return true;
      });

      if (!registeredAddresses[key].length) {
        delete registeredAddresses[key];
      }
    });
  };

  return hooksDb;
};
