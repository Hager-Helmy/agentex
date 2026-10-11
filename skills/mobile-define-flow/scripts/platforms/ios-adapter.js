'use strict';

const { sourceNodes, xpathLiteral, resolveUnique } = require('./source-utils');
const { fail } = require('../errors');

class IOSPlatformAdapter {
  platformName = 'iOS';
  automationName = 'XCUITest';
  validate(config) {
    if (typeof config.app.bundleId !== 'string' || !config.app.bundleId.trim()) throw new Error('iOS requires app.bundleId.');
  }
  appId(config) { return config.app.bundleId; }
  buildPlatformCapabilities(config) {
    return { platformName: this.platformName, 'appium:automationName': this.automationName,
      'appium:bundleId': config.app.bundleId, 'appium:skipLogCapture': true,
      'appium:disableAutomaticScreenshots': true };
  }
  normalizeSource(source) {
    return sourceNodes(source).flatMap(({ tag, attributes: a }) => {
      if (!tag.startsWith('XCUIElementType') || a.visible === 'false') return [];
      const [x, y, width, height] = [a.x, a.y, a.width, a.height].map(Number);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
      const type = a.type || tag;
      const password = type === 'XCUIElementTypeSecureTextField';
      const roles = { Button: 'button', TextField: 'text field', SecureTextField: 'text field', TextView: 'text field',
        StaticText: 'text', Image: 'image', Switch: 'switch', ScrollView: 'scrollable area', Cell: 'cell' };
      const role = roles[type.replace('XCUIElementType', '')] || type.replace('XCUIElementType', '');
      if (!a.label && !a.name && !a.value && !roles[type.replace('XCUIElementType', '')]) return [];
      return [{ role, label: password ? '' : a.label || a.name || '',
        text: password && a.value ? '[REDACTED]' : a.value || '', accessibilityId: password ? '' : a.name || '',
        enabled: a.enabled !== 'false', visible: true, password,
        clickable: ['button', 'cell', 'switch'].includes(role), focusable: role === 'text field',
        scrollable: role === 'scrollable area', className: type,
        bounds: { left: x, top: y, right: x + width, bottom: y + height } }];
    });
  }
  resolveElement(driver, element) {
    const selectors = [];
    if (element.accessibilityId) selectors.push(`~${element.accessibilityId}`);
    if (element.label && !element.password) selectors.push(`//*[@label=${xpathLiteral(element.label)}]`);
    return resolveUnique(driver, selectors);
  }
  async foregroundApp(driver) { return (await driver.execute('mobile: activeAppInfo', {})).bundleId; }
  back() { throw fail('UNSUPPORTED_OPERATION', 'iOS has no global Back action. Dump and tap the visible in-app navigation control.'); }
  home(driver) { return driver.execute('mobile: pressButton', { name: 'home' }); }
}

module.exports = { IOSPlatformAdapter };
