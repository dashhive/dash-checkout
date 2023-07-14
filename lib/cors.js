"use strict";

module.exports = function cors(opts = {}) {
  if (!opts.domains) {
    opts.domains = [];
  }

  if (!opts.methods) {
    opts.methods = ["GET", "POST"];
  }

  if (!opts.headers) {
    opts.headers = [
      "Accept",
      "Content-Type",
      "Content-Length",
      "Accept-Encoding",
      "X-CSRF-Token",
      "Authorization",
    ];
  }

  return async function _cors(req, res, next) {
    let isHttps = (req.headers.origin || "")
      .toLowerCase()
      .startsWith("https://");
    let origin = (req.headers.origin || "")
      .toLowerCase()
      .replace(/https?:\/\//, "");
    let hostParts = origin.split(":");
    let hostname = hostParts[0] || "";
    let port = hostParts[1] || "";

    function matches(domain) {
      if (domain === hostname) {
        return true;
      }

      // *.example.com => .example.com
      if ("*." === domain.slice(0, 2)) {
        // .example.com
        // evilexample.com WILL NOT match
        let root = domain.slice(1);
        if (hostname.endsWith(root)) {
          return true;
        }
      }
    }

    if (!opts.domains.some(matches)) {
      next();
      return;
    }

    if ((port || !isHttps) && "localhost" !== hostname) {
      next();
      return;
    }

    // remember Origin may be a more top-level domain than you think
    // (it can be modified by window.document.domain in the browser)
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    //res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Methods", opts.methods.join(", "));
    res.setHeader("Access-Control-Allow-Headers", opts.headers.join(", "));
    if ("OPTIONS" === req.method.toUpperCase()) {
      res.end();
      return;
    }

    next();
  };
};
