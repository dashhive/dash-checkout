"use strict";

let MA = module.exports;

/**
 * @param {String} token
 * @param {String} webhook
 * @returns {Account}
 */
MA.create = function (token, webhook) {
  let d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 100);

  return {
    id: "*",
    token: token,
    email: "",
    phone: "",
    webhook: webhook,
    soft_quota: 0,
    hard_quota: 0,
    stale_at: null,
    expires_at: null,
    created_at: new Date(1000),
    reset_at: new Date(),
    revoked_at: null,
    request_count: 0,
  };
};
