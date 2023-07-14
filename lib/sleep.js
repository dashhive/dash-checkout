"use strict";

exports.sleep = async function sleep(delay, opts) {
  return await new Promise(function (resolve) {
    let timeout = setTimeout(resolve, delay);
    if (opts?.unref) {
      timeout.unref();
    }
  });
};
