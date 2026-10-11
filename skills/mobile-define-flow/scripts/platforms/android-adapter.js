'use strict';

const { sourceNodes, decodeXml, xpathLiteral, resolveUnique } = require('./source-utils');

class AndroidPlatformAdapter {
  platformName = 'Android';
  automationName = 'UiAutomator2';
  validate(config) {
    if (typeof config.app.package !== 'string' || !config.app.package.trim()) throw new Error('Android requires app.package.');
  }
  appId(config) { return config.app.package; }
  buildPlatformCapabilities(config) {
    return { platformName: this.platformName, 'appium:automationName': this.automationName,
      'appium:appPackage': config.app.package,
      ...(config.app.activity ? { 'appium:appActivity': config.app.activity } : {}),
      'appium:skipLogcatCapture': true };
  }
  normalizeSource(source) {
    return sourceNodes(source).flatMap(({ tag, attributes: a }) => {
      const boundsMatch = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(a.bounds || '');
      if (!boundsMatch || a.displayed === 'false') return [];
      const [left, top, right, bottom] = boundsMatch.slice(1).map(Number);
      if (right <= left || bottom <= top) return [];
      if (!(a.text || a['content-desc'] || a['resource-id'] || a.clickable === 'true' || a.focusable === 'true' || a.scrollable === 'true')) return [];
      const className = a.class || tag;
      const roles = [[/EditText/i, 'text field'], [/CheckBox/i, 'checkbox'], [/RadioButton/i, 'radio button'],
        [/Button/i, 'button'], [/Switch/i, 'switch'], [/Image/i, 'image'], [/TextView/i, 'text']];
      const password = a.password === 'true';
      return [{ role: roles.find(([pattern]) => pattern.test(className))?.[1] || (a.scrollable === 'true' ? 'scrollable area' : className.split('.').pop()),
        text: password && a.text ? '[REDACTED]' : a.text || '',
        label: password ? '' : a['content-desc'] || a.text || '',
        accessibilityId: password ? '' : a['content-desc'] || '',
        contentDescription: password ? '' : a['content-desc'] || '', resourceId: a['resource-id'] || '',
        clickable: a.clickable === 'true', focusable: a.focusable === 'true', scrollable: a.scrollable === 'true',
        enabled: a.enabled !== 'false', visible: true, password, className, bounds: { left, top, right, bottom } }];
    });
  }
  resolveElement(driver, element) {
    const selectors = [];
    if (element.resourceId) selectors.push(`id=${element.resourceId}`);
    if (element.accessibilityId) selectors.push(`~${element.accessibilityId}`);
    if (element.text && !element.password) selectors.push(`//*[@text=${xpathLiteral(element.text)}]`);
    return resolveUnique(driver, selectors);
  }
  async foregroundApp(driver, source) {
    if (source) return decodeXml(/\bpackage="([^"]+)"/.exec(source)?.[1] || '');
    return driver.getCurrentPackage();
  }
  back(driver) { return driver.back(); }
  home(driver) { return driver.execute('mobile: pressKey', { keycode: 3 }); }
}

module.exports = { AndroidPlatformAdapter };
