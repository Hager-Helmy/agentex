'use strict';

const { buildCapabilities } = require('./capabilities');

class SessionManager {
  constructor({ config, provider, platform, projectRoot, remote, noLaunch = false }) {
    Object.assign(this, { config, provider, platform, projectRoot, remote, noLaunch });
  }
  async check() {
    this.platform.validate(this.config);
    this.preflight = await this.provider.preflight(this);
    return { provider: this.config.provider, platform: this.config.platform, ...this.preflight.public };
  }
  async create() {
    if (this.started) throw new Error('This runtime owns one session and cannot be restarted.');
    this.started = true;
    try {
      await this.check();
      const capabilities = buildCapabilities({ ...this, ...this.preflight });
      this.driver = await this.provider.createSession({ ...this, capabilities });
      if (this.closed) {
        const driver = this.driver;
        this.driver = undefined;
        await this.provider.closeSession({ driver, config: this.config });
        throw new Error('Session creation was cancelled.');
      }
      this.sessionId = this.driver.sessionId;
      if (!this.noLaunch) await this.driver.activateApp(this.platform.appId(this.config));
      if (this.closed) throw new Error('Session creation was cancelled.');
      return this.driver;
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }
  async assertTarget(driver) {
    if (!this.driver || driver !== this.driver || driver.sessionId !== this.sessionId) throw new Error('The owned session is no longer valid.');
    if (await this.platform.foregroundApp(driver) !== this.platform.appId(this.config)) throw new Error('The configured app is not in the foreground.');
  }
  metadata() {
    return { provider: this.config.provider, platform: this.config.platform, ...this.preflight.public,
      autoLaunch: !this.noLaunch };
  }
  close() {
    if (!this.closePromise) {
      this.closed = true;
      const driver = this.driver;
      this.driver = undefined;
      this.closePromise = this.provider.closeSession({ driver, config: this.config });
    }
    return this.closePromise;
  }
}
module.exports = { SessionManager };
