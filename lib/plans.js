"use strict";

/**
 * @typedef {Object} Planner
 * @property {PlanQuotaGetter} getQuota
 * @property {Record<String, PlanTier>} tiers
 */
let Plan = module.exports;

let Merchant = require("../merchant.js");

/**
 * @typedef {Object} PlanTier
 * @property {Number} amount
 * @property {Number} hard_quota
 * @property {Number} soft_quota
 * @property {Number} [hard_duration_months]
 * @property {Number} [soft_duration_months]
 * @property {Number} [hard_duration_days]
 * @property {Number} [soft_duration_days]
 * @property {Number} [hard_duration_hours]
 * @property {Number} [soft_duration_hours]
 * @property {Number} [hard_duration]
 * @property {Number} [soft_duration]
 */
Plan.tiers = {
  once: {
    amount: 0.001,
    hard_quota: 3,
    soft_quota: 2,
    soft_duration: 30, // 600
    hard_duration: 60, // 3600
  },
  trial: {
    amount: 0.001,
    hard_quota: 110,
    soft_quota: 100,
    soft_duration_hours: 24,
    hard_duration_hours: 72,
  },
  monthly: {
    amount: 0.01,
    hard_quota: 11000,
    soft_quota: 10000,
    soft_duration_days: 30,
    hard_duration_days: 34,
  },
  yearly: {
    amount: 0.1,
    hard_quota: 1100000,
    solf_quota: 1000000,
    soft_duration_months: 12,
    hard_duration_months: 13,
  },
};

/**
 * @typedef {Function} PlanQuotaGetter
 * @param {Number} amount
 * @returns {PlanQuota}
 */

/*
 * @param {Number} amount
 * @returns {PlanQuota}
 */
Plan.getQuota = function (amount) {
  // TODO move into business logic
  let hardQuota = 0;
  let softQuota = 0;
  let stale = new Date();
  let exp = new Date();

  let mult = 100 * 1000 * 1000;
  // round down for network cost error
  let trial = 0.0009 * mult;
  let month = 0.009 * mult;
  let year = 0.09 * mult;
  if (amount > year) {
    hardQuota = Plan.tiers.yearly.hard_quota;
    softQuota = Plan.tiers.yearly.soft_quota;
    stale.setUTCMonth(
      exp.getUTCMonth() + Plan.tiers.yearly.soft_duration_months
    );
    exp.setUTCMonth(exp.getUTCMonth() + Plan.tiers.yearly.hard_duration_months);
  } else if (amount > month) {
    hardQuota = Plan.tiers.monthly.hard_quota;
    softQuota = Plan.tiers.monthly.soft_quota;
    stale.setUTCDate(exp.getUTCDate() + Plan.tiers.monthly.soft_duration_days);
    exp.setUTCDate(exp.getUTCDate() + Plan.tiers.monthly.hard_duration_days);
  } else if (amount > trial) {
    hardQuota = Plan.tiers.trial.hard_quota;
    softQuota = Plan.tiers.trial.soft_quota;
    stale.setUTCHours(exp.getUTCHours() + Plan.tiers.trial.soft_duration_hours);
    exp.setUTCHours(exp.getUTCHours() + Plan.tiers.trial.hard_duration_hours);
  } else {
    hardQuota = Plan.tiers.once.hard_quota;
    softQuota = Plan.tiers.once.soft_quota;
    stale.setUTCSeconds(exp.getUTCSeconds() + Plan.tiers.once.soft_duration);
    exp.setUTCSeconds(exp.getUTCSeconds() + Plan.tiers.once.hard_duration);
  }

  return {
    hard_quota: hardQuota,
    soft_quota: softQuota,
    stale: stale,
    exp: exp,
  };
};

/**
 * @param {Account} account
 * @throws
 */
Plan.mustBeFresh = function (account) {
  let warnings = [];
  let warning = null;

  warning = checkExpiry(account);
  if (warning) {
    warnings.push(warning);
  }

  warning = checkQuotas(account);
  if (warning) {
    warnings.push(warning);
  }

  return warnings;
};

/**
 * @param {Account} account
 * @returns {QuotaWarn?}
 * @throws
 */
function checkExpiry(account) {
  let exp = new Date(account.expires_at || "").valueOf();
  let now = Date.now();
  let stale = new Date(account.stale_at || "").valueOf();

  let warning = null;
  let fresh = false;
  if (account.stale_at) {
    fresh = stale > now;

    let expiresIn;
    if (exp) {
      expiresIn = Math.floor((exp - now) / 1000);
      //let inDays = expiresIn % (24 * 60 * 60);
      // TODO 10d 2h 5m
    }

    warning = {
      status: 402,
      code: "W_EXPIRY",
      message: `This token is about to expire. Payment will be required on ${account.expires_at} (in ${expiresIn}s).`,
      details: {
        expires_at: account.expires_at,
        expires_in: expiresIn,
      },
    };
  }

  if (!fresh && account.expires_at) {
    let usable = exp > now;
    if (!usable) {
      throw Merchant.E("generous expiration exceeded", {
        code: "PAYMENT_REQUIRED",
        status: 402,
      });
    }
    return warning;
  }

  return warning;
}

/**
 * @param {Account} account
 * @returns {QuotaWarn?}
 * @throws
 */
function checkQuotas(account) {
  let warning = null;

  // Check for soft quota and hard quota
  let plentiful = false;
  if (account.soft_quota) {
    let remaining = account.hard_quota - account.request_count;

    plentiful = account.soft_quota > account.request_count;
    warning = {
      status: 402,
      code: "W_QUOTA",
      message: `This token's quota has almost been met. Payment will be required within ${remaining} requests.`,
      requests_remaining: remaining,
    };
  }

  if (!plentiful && account.hard_quota) {
    let available = account.hard_quota > account.request_count;
    if (!available) {
      // TODO give payaddr / payaddr url?
      throw Merchant.E("generous quota exceeded", {
        code: "PAYMENT_REQUIRED",
        status: 402,
      });
    }

    return warning;
  }

  return warning;
}
