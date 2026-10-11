'use strict';

function buildCapabilities({ config, provider, platform, appReference }) {
  platform.validate(config);
  const capabilities = { ...platform.buildPlatformCapabilities(config),
    'appium:noReset': true, 'appium:forceAppLaunch': false, 'appium:shouldTerminateApp': false,
    // Runtime explicitly activates the configured app after the remote session is created.
    'appium:autoLaunch': false, 'appium:newCommandTimeout': config.runtime.newCommandTimeoutSeconds };
  return provider.augmentCapabilities(capabilities, { config, platform, appReference });
}

module.exports = { buildCapabilities };
