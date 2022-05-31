/**
 * @typedef {Object} Account
 * @property {Number} [amount] - TODO what what?
 * @property {String} id
 * @property {String} token
 * @property {String} email
 * @property {String} phone
 * @property {String} webhook
 * @property {Number} soft_quota
 * @property {Number} hard_quota
 * @property {Date?} stale_at
 * @property {Date?} expires_at
 * @property {Date} created_at
 * @property {Date?} reset_at
 * @property {Date?} revoked_at
 * @property {Number} request_count
 */

/**
 * @typedef {String} Base58Check
 */

/**
 * @typedef {Function} ErrorHandler
 * @param {Error} err
 */

/**
 * @typedef {String} P2PKH
 */

/**
 * @typedef {Object} HookRequest
 * @property {HookRequestData} data
 * @property {Object} [account]
 * @property {String} apiUsername
 * @property {String} apiToken
 */

/**
 * @typedef {Object} HookRequestData
 * @property {String} url - the webhook to call back to
 * @property {String} address - the Base58Check address
 */

/**
 * @typedef {Object} HookTarget
 * @property {Number} ts - created at timestamp in ms
 * @property {String} address - BIP 32 (human-readable) address
 * @property {String} pubKeyHash - raw P2PKH address (no version)
 * @property {String} username - used for the webhook's Basic Auth
 * @property {String} password - (same as above)
 * @property {String} url - the url to contact
 */

/**
 * @typedef {Error & HttpErrorPartial} HttpError
 */

/**
 * @typedef {Object} HttpErrorPartial
 * @property {String} code - semi-human-readable code, like E_UNKNOWN_ERROR
 * @property {Number} status - the HTTP status code
 */

//
// Demo Merchant Types
//

/**
 * @typedef {Object} PlanQuota
 * @property {Number} hard_quota
 * @property {Number} soft_quota
 * @property {Date} stale
 * @property {Date} exp
 */

/**
 * @typedef {Object} QuotaWarn
 * @property {String} code - semi-human-readable code, like E_UNKNOWN_ERROR
 * @property {any} [details]
 * @property {String} message - a developer friendly message
 * @property {Number} [requests_remaining]
 * @property {Number} status - the HTTP status code
 */

//
//
// Service Types
//
//

/**
 * @typedef {Object} FullNodeWebhook
 * @property {String} address
 * @property {String} event - Name of the event (i.e. "txlock")
 * @property {Boolean} instantsend - Should always be true (for Dash at least)
 * @property {String} [p2pkh]
 * @property {String} [received_at]
 * @property {Number} satoshis
 * @property {String} txid - TX "Script" Hash
 */
