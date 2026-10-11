'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./errors');

function normalizeConfig(raw, overrides = {}) {
  const config = structuredClone(raw);
  config.provider = config.provider || 'browserstack';
  if (config.provider !== 'browserstack') throw fail('UNSUPPORTED_PROVIDER', 'Only BrowserStack App Automate is supported.');
  for (const key of ['providers', 'platforms', 'backend', 'adbPath', 'deviceSelection', 'appId', 'activity']) {
    if (config[key] !== undefined) throw fail('INVALID_CONFIG', `Retired configuration field: ${key}. Use the BrowserStack-only schema.`);
  }
  if (overrides.provider !== undefined || overrides.deviceId !== undefined) throw fail('INVALID_CONFIG', 'Provider selection and device pinning are not supported.');
  config.platform = overrides.platform || config.platform;
  config.app ||= {};
  config.device ||= {};
  config.browserstack ||= {};
  config.runtime = { newCommandTimeoutSeconds: 3600, heartbeatSeconds: 45, maxDumpElements: 300, ...config.runtime };
  if (config.device.id !== undefined || config.device.requireExactlyOneOnline !== undefined) throw fail('INVALID_CONFIG', 'Configure the remote device by name and osVersion.');
  if (config.app.browserstackAppRef !== undefined && !/^bs:\/\/[A-Za-z0-9_-]+$/.test(config.app.browserstackAppRef)) throw fail('INVALID_CONFIG', 'app.browserstackAppRef must be a bs:// reference.');
  if (config.app.reference !== undefined) throw fail('INVALID_CONFIG', 'Use app.browserstackAppRef instead of app.reference.');
  for (const name of ['heartbeatSeconds', 'newCommandTimeoutSeconds', 'maxDumpElements']) {
    const value = config.runtime[name];
    if (!Number.isInteger(value) || value < (name === 'heartbeatSeconds' ? 0 : 1)) throw new Error(`runtime.${name} is invalid.`);
  }
  if (!config.safety || !Array.isArray(config.safety.allowedOperations)) throw new Error('safety.allowedOperations is required.');
  for (const name of ['specRoot', 'scratchRoot', 'artifactRoot']) {
    if (typeof config.paths?.[name] !== 'string' || !config.paths[name]) throw new Error(`paths.${name} is required.`);
    const relative = path.normalize(config.paths[name]);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error(`paths.${name} must remain inside the project.`);
  }
  return config;
}

function loadConfig(projectRoot, options = {}) {
  return normalizeConfig(JSON.parse(fs.readFileSync(path.resolve(projectRoot, options.configPath || 'config/mobile.json'), 'utf8')), options);
}

function flowConfiguration(config, platform) {
  return { appId: platform.appId(config), activity: config.app.activity, ...config.paths,
    allowedOperations: config.safety.allowedOperations, authentication: config.safety.authentication,
    maxDumpElements: config.runtime.maxDumpElements };
}

module.exports = { normalizeConfig, loadConfig, flowConfiguration };
