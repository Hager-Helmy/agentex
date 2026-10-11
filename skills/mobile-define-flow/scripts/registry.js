'use strict';

const { BrowserStackProvider } = require('./providers/browserstack-provider');
const { AndroidPlatformAdapter } = require('./platforms/android-adapter');
const { IOSPlatformAdapter } = require('./platforms/ios-adapter');
const { fail } = require('./errors');

const platforms = Object.freeze({ android: () => new AndroidPlatformAdapter(), ios: () => new IOSPlatformAdapter() });

function select(registry, key, kind) {
  if (!Object.hasOwn(registry, key)) throw fail(`INVALID_${kind.toUpperCase()}`, `Unsupported ${kind}: ${key}`);
  return registry[key]();
}
function compose(config) {
  if (config.provider !== 'browserstack') throw fail('UNSUPPORTED_PROVIDER', 'Only BrowserStack App Automate is supported.');
  const provider = new BrowserStackProvider();
  const platform = select(platforms, config.platform, 'platform');
  platform.validate(config);
  provider.validate(config);
  return { provider, platform };
}
module.exports = { platforms, compose };
