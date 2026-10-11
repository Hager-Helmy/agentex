'use strict';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { fail };
