'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { resolveCachePath, readAppCache, writeAppCache } = require('../app-cache');

class BrowserStackProvider {
  validate(config) {
    if (!config.browserstack) throw new Error('browserstack configuration is required.');
    if (typeof config.device.name !== 'string' || !config.device.name.trim() || typeof config.device.osVersion !== 'string' || !config.device.osVersion.trim()) throw new Error('BrowserStack requires device.name and device.osVersion.');
    if (config.runtime.heartbeatSeconds <= 0 || config.runtime.heartbeatSeconds >= 300) throw new Error('BrowserStack heartbeatSeconds must be between 1 and 299.');
  }
  secretEnvironmentNames(config) {
    const bs = config.browserstack;
    return [bs.usernameEnv || 'BROWSERSTACK_USERNAME', bs.accessKeyEnv || 'BROWSERSTACK_ACCESS_KEY'];
  }
  credentials(config) {
    const [usernameName, accessKeyName] = this.secretEnvironmentNames(config);
    const username = process.env[usernameName]?.trim();
    const accessKey = process.env[accessKeyName]?.trim();
    if (!username || !accessKey) throw new Error('Missing BrowserStack credentials. Configure the named environment variables locally.');
    return { username, accessKey };
  }
  async request(config, resource, options = {}) {
    const { username, accessKey } = this.credentials(config);
    const response = await fetch(`https://api-cloud.browserstack.com/app-automate/${resource}`, {
      ...options, headers: { Authorization: `Basic ${Buffer.from(`${username}:${accessKey}`).toString('base64')}` },
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`BrowserStack request failed (HTTP ${response.status}).`);
    return response.json();
  }
  resolveApp({ config, projectRoot }) {
    const bs = config.browserstack;
    let appUrl = process.env[bs.appUrlEnv || 'BROWSERSTACK_APP_URL']?.trim() || config.app.browserstackAppRef;
    if (!appUrl) {
      const cachePath = resolveCachePath(projectRoot, bs.appCache);
      if (fs.existsSync(cachePath)) {
        const cached = readAppCache(cachePath);
        if (cached.platform ? cached.platform !== config.platform : config.platform !== 'android') throw new Error('Uploaded app cache is for another platform. Upload the configured app.');
        if (config.app.path && cached.source !== config.app.path) throw new Error('Uploaded app cache does not match app.path. Upload the configured app.');
        appUrl = cached.appUrl;
      }
    }
    if (!/^bs:\/\/[A-Za-z0-9_-]+$/.test(appUrl || '')) throw new Error('No valid bs:// app reference. Use mobile:upload for the configured app.');
    return appUrl;
  }
  async devices({ config, platform }) {
    if (typeof config.device.name !== 'string' || !config.device.name.trim() || typeof config.device.osVersion !== 'string' || !config.device.osVersion.trim()) throw new Error('BrowserStack requires device.name and device.osVersion.');
    const devices = await this.request(config, 'devices.json');
    const matches = devices.filter((device) => device.device === config.device.name &&
      String(device.os_version) === config.device.osVersion && String(device.os).toLowerCase() === platform.platformName.toLowerCase());
    if (!matches.length) throw new Error('Configured device/platform/OS is not in the BrowserStack device catalog.');
    return matches;
  }
  async preflight(context) {
    try { createRequire(path.join(context.projectRoot, 'package.json')).resolve('webdriverio'); }
    catch { throw new Error('Missing project dependency: webdriverio.'); }
    this.credentials(context.config);
    const appReference = this.resolveApp(context);
    await this.devices(context);
    return { appReference, public: { deviceName: context.config.device.name, osVersion: context.config.device.osVersion,
      credentialsConfigured: true, availability: 'catalog-match; reservation occurs at session creation' } };
  }
  augmentCapabilities(capabilities, { config, appReference }) {
    const bs = config.browserstack;
    return { ...capabilities, 'appium:app': appReference,
      'bstack:options': { deviceName: config.device.name, osVersion: config.device.osVersion,
        deviceOrientation: 'portrait', projectName: bs.projectName, buildName: bs.buildName,
        sessionName: bs.sessionName || 'Interactive Mobile Define Flow', idleTimeout: 300,
        debug: false, video: false, networkLogs: false, deviceLogs: false, appiumLogs: false,
        maskCommands: 'setValues,getValues' } };
  }
  async createSession(context) {
    const { username, accessKey } = this.credentials(context.config);
    const remote = context.remote || createRequire(path.join(context.projectRoot, 'package.json'))('webdriverio').remote;
    return remote({ protocol: 'https', hostname: 'hub.browserstack.com', port: 443, path: '/wd/hub',
      user: username, key: accessKey, logLevel: 'silent', connectionRetryTimeout: 180000,
      connectionRetryCount: 0, capabilities: context.capabilities });
  }
  async closeSession({ driver }) { if (driver) await driver.deleteSession(); }
  async upload({ config, projectRoot }) {
    // Validate before reading the archive or issuing any provider request.
    resolveCachePath(projectRoot, config.browserstack.appCache);
    const appPath = path.resolve(projectRoot, config.app.path || '');
    if (!config.app.path || !fs.statSync(appPath).isFile()) throw new Error('app.path must identify an existing app archive.');
    const extensions = { android: ['.apk', '.aab'], ios: ['.ipa'] };
    if (!extensions[config.platform]?.includes(path.extname(appPath).toLowerCase())) throw new Error('App archive extension does not match the selected platform.');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(appPath)]), path.basename(appPath));
    const bs = config.browserstack;
    if (bs.customId) form.append('custom_id', bs.customId);
    const result = await this.request(config, 'upload', { method: 'POST', body: form });
    if (!/^bs:\/\/[A-Za-z0-9_-]+$/.test(result.app_url || '')) throw new Error('BrowserStack returned an invalid app reference.');
    const cachePath = writeAppCache(projectRoot, bs.appCache, { appUrl: result.app_url, source: config.app.path,
      platform: config.platform, uploadedAt: new Date().toISOString() });
    return { event: 'uploaded', cachePath: path.relative(projectRoot, cachePath) };
  }
}
module.exports = { BrowserStackProvider };
