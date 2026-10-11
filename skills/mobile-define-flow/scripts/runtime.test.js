'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeConfig, flowConfiguration } = require('./config');
const { compose, platforms } = require('./registry');
const { buildCapabilities } = require('./capabilities');
const { SessionManager } = require('./session-manager');
const { createGateway, createOutputResolver } = require('./gateway-core');
const { BrowserStackProvider } = require('./providers/browserstack-provider');
const { ElementRefs } = require('./element-model');
const { parseArguments } = require('./cli');

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentex-mobile-flow-'));
test.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
fs.mkdirSync(path.join(projectRoot, '.scratch'));
// Synthetic configuration: no consumer files, credentials or device calls.
const raw = {
  "provider": "browserstack",
  "platform": "android",
  "device": {
    "name": "YOUR_BROWSERSTACK_DEVICE",
    "osVersion": "YOUR_OS_VERSION"
  },
  "app": {
    "package": "com.example.app",
    "browserstackAppRef": "bs://YOUR_UPLOADED_APP"
  },
  "runtime": {
    "newCommandTimeoutSeconds": 3600,
    "heartbeatSeconds": 45,
    "maxDumpElements": 300
  },
  "paths": {
    "specRoot": "test/mobile-suite1",
    "scratchRoot": ".scratch/mobile-define-flow",
    "artifactRoot": "artifacts/mobile-define-flow",
    "screenshotRoots": [
      ".scratch/mobile-define-flow",
      "artifacts/mobile-define-flow"
    ]
  },
  "safety": {
    "allowedOperations": [
      "status",
      "dump",
      "screenshot",
      "app.launch.target",
      "tap",
      "tap.coordinatesFallback",
      "typeNonSecret",
      "typeSecretFromAllowlistedEnv",
      "submitSecret",
      "beginManualAuth",
      "completeManualAuth",
      "resumeObservation",
      "swipe",
      "longpress",
      "button.back",
      "button.home",
      "wait",
      "close"
    ],
    "authentication": {
      "allowedMode": "manual",
      "secretEnvNames": []
    }
  },
  "browserstack": {
    "usernameEnv": "BROWSERSTACK_USERNAME",
    "accessKeyEnv": "BROWSERSTACK_ACCESS_KEY",
    "appUrlEnv": "BROWSERSTACK_APP_URL",
    "appCache": ".runtime/browserstack/app.json"
  }
};
const sources = {
  android: '<hierarchy><android.widget.Button package="test.app" text="Continue" resource-id="test.app:id/continue" clickable="true" enabled="true" bounds="[10,20][210,120]"/><android.widget.EditText password="true" text="hidden" focusable="true" bounds="[10,140][500,240]"/></hierarchy>',
  ios: '<AppiumAUT><XCUIElementTypeButton type="XCUIElementTypeButton" name="continue" label="Continue" enabled="true" visible="true" x="10" y="20" width="200" height="100"/><XCUIElementTypeSecureTextField value="hidden" name="hidden" label="hidden" enabled="true" visible="true" x="10" y="140" width="490" height="100"/></AppiumAUT>'
};
function configuration(platform = 'android') {
  const config = normalizeConfig(raw, { platform });
  config.app.package = 'test.app'; config.app.bundleId = 'test.app';
  config.paths.scratchRoot = '.scratch/mobile-flow-tests';
  config.paths.screenshotRoots.push(config.paths.scratchRoot);
  config.safety.authentication = { allowedMode: 'savedTestAccount', secretEnvNames: ['FLOW_TEST_SECRET', 'FLOW_TEST_OTP'], otpSecretName: 'FLOW_TEST_OTP' };
  return config;
}
function driverFixture(platform) {
  const calls = [];
  const driver = {
    sessionId: 'owned-session', calls,
    getPageSource: async () => { calls.push('source'); return sources[platform]; },
    getWindowSize: async () => ({ width: 1080, height: 2400 }),
    getCurrentPackage: async () => 'test.app',
    execute: async (name, args) => { calls.push([name, args]); return name === 'mobile: activeAppInfo' ? { bundleId: 'test.app' } : false; },
    $$: async (selector) => { calls.push(['selector', selector]); return [{ isDisplayed: async () => true, click: async () => calls.push('click') }]; },
    keys: async (text) => calls.push(['keys', text]),
    performActions: async (actions) => calls.push(['touch', actions]),
    activateApp: async (id) => calls.push(['activate', id]),
    saveScreenshot: async (output) => calls.push(['screenshot', output]),
    back: async () => calls.push('back'), pause: async () => {},
    deleteSession: async () => calls.push('delete')
  };
  return driver;
}
async function fixture(platformName = 'android', options = {}) {
  const config = configuration(platformName);
  options.configure?.(config);
  const { provider, platform } = compose(config);
  const driver = driverFixture(platformName);
  options.driver?.(driver);
  let captured;
  provider.preflight = async () => ({ appReference: 'bs://fixture', public: { deviceName: config.device.name, osVersion: config.device.osVersion } });
  provider.credentials = () => ({ username: 'fixture', accessKey: 'fixture' });
  const manager = new SessionManager({ projectRoot, config, provider, platform, noLaunch: options.noLaunch,
    remote: async (payload) => { captured = payload; return driver; } });
  const events = [];
  const gateway = createGateway({ projectRoot, platform, gatewayName: 'test', flowConfig: flowConfiguration(config, platform),
    argv: [], interactive: false, emit: (event) => events.push(event), createDriver: () => manager.create(),
    readyMetadata: () => manager.metadata(), assertTarget: (session) => manager.assertTarget(session), closeSession: () => manager.close() });
  await gateway.start();
  return { gateway, driver, config, provider, platform, manager, events, captured,
    command: (command) => gateway.handleCommand(command) };
}

test('bootstrap creates one BrowserStack provider with two platform adapters', () => {
  assert.deepEqual(Object.keys(platforms), ['android', 'ios']);
  assert.ok(compose(configuration()).provider instanceof BrowserStackProvider);
});
for (const [field, value, code] of [['provider', 'unknown', 'UNSUPPORTED_PROVIDER'], ['platform', 'unknown', 'INVALID_PLATFORM'], ['provider', 'local', 'UNSUPPORTED_PROVIDER']]) {
  test(`rejects invalid ${field} ${value}`, () => assert.throws(() => compose({ ...configuration(), [field]: value }), { code }));
}
test('local and legacy configuration are rejected without any fallback', () => {
  assert.throws(() => normalizeConfig({ ...raw, provider: 'local' }), { code: 'UNSUPPORTED_PROVIDER' });
  assert.throws(() => normalizeConfig({ ...raw, adbPath: 'retired' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => normalizeConfig({ ...raw, providers: {} }), { code: 'INVALID_CONFIG' });
  assert.throws(() => normalizeConfig({ ...raw, device: { ...raw.device, id: 'serial' } }), /remote device/);
});
test('configuration validates required identities and timing without creating sessions', () => {
  assert.throws(() => normalizeConfig({ ...raw, runtime: { heartbeatSeconds: -1 } }), /runtime/);
  const config = configuration('ios'); delete config.app.bundleId;
  assert.throws(() => compose(config), /bundleId/);
  const cloud = configuration(); cloud.runtime.heartbeatSeconds = 300;
  assert.throws(() => compose(cloud), /heartbeat/);
});
test('CLI rejects unknown arguments and preserves explicit selection', () => {
  assert.equal(parseArguments(['--platform', 'ios']).platform, 'ios');
  assert.throws(() => parseArguments(['--provider', 'local']), /Unknown/);
  assert.throws(() => parseArguments(['--device', 'serial']), /Unknown/);
  assert.throws(() => parseArguments(['--platform']), /requires/);
  assert.throws(() => parseArguments(['--capabilities', '{}']), /Unknown/);
});

for (const platformName of ['android', 'ios']) {
  test(`BrowserStack + ${platformName}: capabilities, shared commands, one owner`, async (t) => {
    const f = await fixture(platformName); t.after(() => f.gateway.close());
    const caps = f.captured.capabilities;
    assert.equal(caps.platformName, f.platform.platformName);
    assert.equal(caps['appium:automationName'], f.platform.automationName);
    assert.equal(caps['appium:autoLaunch'], false); assert.equal(caps['appium:noReset'], true);
    assert.equal(caps['appium:appPackage'] || caps['appium:bundleId'], 'test.app');
    assert.equal(caps['appium:app'], 'bs://fixture'); assert.equal(caps['appium:udid'], undefined);
    assert.equal(caps['bstack:options'].video, false); assert.equal(caps['bstack:options'].appiumLogs, false);
    assert.equal(f.captured.hostname, 'hub.browserstack.com');
    assert.equal(f.captured.protocol, 'https');
    assert.equal(f.captured.logLevel, 'silent');
    assert.equal(f.events[0].sessionId, undefined);
    const dump = await f.command({ action: 'dump' });
    assert.equal(dump.elements[0].role, 'button');
    assert.equal(dump.elements[1].text, '[REDACTED]');
    assert.ok(!JSON.stringify(dump).includes('hidden'));
    await f.command({ action: 'tap', target: dump.elements[0].ref });
    await assert.rejects(f.command({ action: 'tap', target: dump.elements[0].ref }), /fresh/);
    await f.command({ action: 'dump' });
    await f.command({ action: 'type', text: 'disposable' });
    assert.ok(f.driver.calls.some((call) => call[0] === 'keys' && call[1] === 'disposable'));
    await f.command({ action: 'dump' });
    await f.command({ action: 'swipe', from: { x: 50, y: 200 }, to: { x: 50, y: 30 } });
    await f.command({ action: 'screenshot', output: '.scratch/mobile-flow-tests/screen.png' });
    await f.command({ action: 'close' }); await f.command({ action: 'close' });
    assert.equal(f.driver.calls.filter((call) => call === 'delete').length, 1);
  });
}
test('refs from previous dumps cannot alias a new element', () => {
  const refs = new ElementRefs(); const element = { enabled: true };
  const old = refs.replace([element])[0].ref; const current = refs.replace([element])[0].ref;
  assert.notEqual(old, current); assert.throws(() => refs.get(old), /stale/);
  refs.invalidate(); assert.throws(() => refs.get(current), /fresh/);
});
test('failed UI mutations invalidate refs before the driver call', async (t) => {
  const f = await fixture(); t.after(() => f.gateway.close());
  const dump = await f.command({ action: 'dump' });
  f.driver.$$ = async () => { throw new Error('transport failed'); };
  await assert.rejects(f.command({ action: 'tap', target: dump.elements[0].ref }), /transport/);
  await assert.rejects(f.command({ action: 'tap', target: dump.elements[0].ref }), /fresh/);
});
test('iOS Back is structured unsupported; Home is a real platform operation', async (t) => {
  const f = await fixture('ios'); t.after(() => f.gateway.close());
  await f.command({ action: 'dump' });
  await assert.rejects(f.command({ action: 'back' }), { code: 'UNSUPPORTED_OPERATION' });
  await f.command({ action: 'dump' }); await f.command({ action: 'home' });
  assert.ok(f.driver.calls.some((call) => call[0] === 'mobile: pressButton' && call[1].name === 'home'));
});
test('remote Android supports no-launch and Back/Home navigation', async (t) => {
  const f = await fixture('android', { noLaunch: true }); t.after(() => f.gateway.close());
  assert.ok(!f.driver.calls.some((call) => call[0] === 'activate'));
  await f.command({ action: 'dump' }); await f.command({ action: 'back' });
  await f.command({ action: 'dump' }); await f.command({ action: 'home' });
  assert.ok(f.driver.calls.includes('back'));
  assert.ok(f.driver.calls.some((call) => call[0] === 'mobile: pressKey' && call[1].keycode === 3));
});
test('screenshot verifies foreground before capture', async (t) => {
  const f = await fixture(); t.after(() => f.gateway.close());
  f.driver.getCurrentPackage = async () => 'other.app';
  await assert.rejects(f.command({ action: 'screenshot', output: '.scratch/mobile-flow-tests/screen.png' }), /foreground/);
  assert.ok(!f.driver.calls.some((call) => call[0] === 'screenshot'));
});
test('allowed operations and coordinate fallback are enforced', async (t) => {
  const f = await fixture('android', { configure: (config) => { config.safety.allowedOperations = config.safety.allowedOperations.filter((op) => op !== 'tap.coordinatesFallback'); } });
  t.after(() => f.gateway.close());
  await assert.rejects(f.command({ action: 'install' }), /allowlisted/);
  const dump = await f.command({ action: 'dump' }); f.driver.$$ = async () => [];
  await assert.rejects(f.command({ action: 'tap', target: dump.elements[0].ref }), /allowlisted/);
});

for (const platformName of ['android', 'ios']) {
  test(`${platformName} secret invariants: authorization, redaction, blocked observations, safe submission`, async (t) => {
    process.env.FLOW_TEST_SECRET = 'fixture-password'; t.after(() => delete process.env.FLOW_TEST_SECRET);
    const f = await fixture(platformName); t.after(() => f.gateway.close());
    const dump = await f.command({ action: 'dump' });
    await assert.rejects(f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_SECRET' }), /confirmAuth/);
    await assert.rejects(f.command({ action: 'typeSecret', secretName: 'NOT_ALLOWED', confirmAuth: true }), /allowlisted/);
    await assert.rejects(f.command({ action: 'type', text: 'prefix-fixture-password' }), /configured secret/);
    await f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_SECRET', confirmAuth: true });
    const sourceCount = f.driver.calls.filter((call) => call === 'source').length;
    await f.command({ action: 'status' });
    for (const action of ['dump', 'screenshot', 'tap', 'type', 'home']) await assert.rejects(f.command({ action }), /blocked/);
    assert.equal(f.driver.calls.filter((call) => call === 'source').length, sourceCount);
    await assert.rejects(f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true }), /Wait/);
    await f.command({ action: 'wait', milliseconds: 2000 });
    let now = 10000; t.mock.method(Date, 'now', () => now);
    await f.command({ action: 'submitSecret', target: dump.elements[0].ref, confirmAuth: true });
    now += 3000;
    await assert.rejects(f.command({ action: 'resumeObservation' }), /confirmSecretScreenCleared/);
    await f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true });
    await f.command({ action: 'dump' });
    assert.ok(!JSON.stringify(f.events).includes('fixture-password'));
  });
}
test('partial secret-entry failure keeps observation blocked', async (t) => {
  process.env.FLOW_TEST_SECRET = 'fixture-password'; t.after(() => delete process.env.FLOW_TEST_SECRET);
  const f = await fixture(); t.after(() => f.gateway.close());
  await f.command({ action: 'dump' }); f.driver.keys = async () => { throw new Error('fixture-password'); };
  await assert.rejects(f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_SECRET', confirmAuth: true }), (error) => !error.message.includes('fixture-password'));
  await assert.rejects(f.command({ action: 'dump' }), /blocked/);
});
test('authentication mode and owned-session identity gate secret injection', async (t) => {
  const f = await fixture('android', { configure: (config) => { config.safety.authentication.allowedMode = 'manual'; } });
  t.after(() => f.gateway.close()); await f.command({ action: 'dump' });
  await assert.rejects(f.command({ action: 'typeSecret', confirmAuth: true }), /disabled/);
  f.driver.sessionId = 'unexpected-session';
  await assert.rejects(f.manager.assertTarget(f.driver), /owned session/);
});
test('session creation failure and activation failure clean up exactly once', async () => {
  for (const phase of ['creation', 'activation']) {
    const config = configuration(); const { platform } = compose(config); let closes = 0; let deletes = 0;
    const driver = { sessionId: 'id', activateApp: async () => { throw new Error('activation failed'); }, deleteSession: async () => { deletes++; } };
    const provider = { preflight: async () => ({ public: {} }), augmentCapabilities: (caps) => caps,
      createSession: async () => { if (phase === 'creation') throw new Error('creation failed'); return driver; },
      closeSession: async ({ driver }) => { closes++; if (driver) await driver.deleteSession(); } };
    const manager = new SessionManager({ config, provider, platform, projectRoot });
    await assert.rejects(manager.create(), /failed/); await manager.close();
    assert.equal(closes, 1); assert.equal(deletes, phase === 'activation' ? 1 : 0);
  }
});
test('failed remote deletion is reported and never retried by a second owner', async (t) => {
  const f = await fixture(); let deletes = 0;
  f.driver.deleteSession = async () => { deletes++; throw new Error('delete failed'); };
  await assert.rejects(f.gateway.close(), /delete failed/);
  await assert.rejects(f.gateway.close(), /delete failed/);
  assert.equal(deletes, 1);
});

test('cancellation while remote creation is pending deletes the late session once', async () => {
  const config = configuration(); const { platform } = compose(config);
  let release, entered, deletes = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const creating = new Promise((resolve) => { entered = resolve; });
  const provider = { preflight: async () => ({ public: {} }), augmentCapabilities: (caps) => caps,
    createSession: async () => { entered(); return pending; },
    closeSession: async ({ driver }) => { if (driver) await driver.deleteSession(); } };
  const manager = new SessionManager({ config, provider, platform, projectRoot });
  const creation = manager.create();
  await creating; await manager.close();
  release({ deleteSession: async () => { deletes++; } });
  await assert.rejects(creation, /cancelled/); await manager.close();
  assert.equal(deletes, 1); assert.equal(manager.driver, undefined);
});
test('output root cannot escape project; traversal stays blocked', () => {
  assert.throws(() => createOutputResolver(projectRoot, { screenshotRoots: ['../outside'] }, 'test'), /subdirectories/);
  const resolver = createOutputResolver(projectRoot, { screenshotRoots: ['.scratch/mobile-flow-tests'] }, 'test');
  assert.throws(() => resolver('.scratch/mobile-flow-tests/../../escape.png'), /output roots/);
});

test('Android and iOS capability generation stays separate and deterministic', () => {
  for (const name of ['android', 'ios']) {
    const config = configuration(name); const { provider, platform } = compose(config);
    const args = { config, provider, platform, appReference: 'bs://fixture' };
    const caps = buildCapabilities(args);
    assert.deepEqual(caps, buildCapabilities(args));
    assert.equal(caps['appium:xcodeOrgId'], undefined); assert.equal(caps['appium:udid'], undefined);
    assert.equal(caps['appium:appPackage'], name === 'android' ? 'test.app' : undefined);
    assert.equal(caps['appium:bundleId'], name === 'ios' ? 'test.app' : undefined);
  }
});
test('provider catalog validation includes platform and OS, not just the device label', async () => {
  const provider = new BrowserStackProvider();
  const config = configuration('ios');
  const platform = platforms.ios();
  provider.request = async () => [{ device: config.device.name, os_version: config.device.osVersion, os: 'android' }];
  await assert.rejects(provider.devices({ config, platform }), /catalog/);
  provider.request = async () => [{ device: config.device.name, os_version: config.device.osVersion, os: 'ios' }];
  assert.equal((await provider.devices({ config, platform })).length, 1);
});
test('app references reject malformed URLs and caches from another platform', (t) => {
  const cacheRoot = path.join(projectRoot, '.runtime/browserstack');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(cacheRoot, 'cache-test-'));
  t.after(() => { fs.unlinkSync(path.join(directory, 'app.json')); fs.rmdirSync(directory); });
  const config = configuration('ios');
  config.browserstack.appCache = path.relative(projectRoot, path.join(directory, 'app.json'));
  config.browserstack.appUrlEnv = 'FLOW_TEST_APP_URL';
  delete config.app.browserstackAppRef; // Exercise cache fallback, not the direct reference.
  const provider = new BrowserStackProvider();
  fs.writeFileSync(path.join(directory, 'app.json'), JSON.stringify({ platform: 'android', appUrl: 'bs://wrong-platform', source: 'fixture.apk' }));
  assert.throws(() => provider.resolveApp({ config, projectRoot }), /another platform/);
  config.app.browserstackAppRef = 'https://invalid.example/app.ipa';
  assert.throws(() => provider.resolveApp({ config, projectRoot }), /valid bs/);
  config.app.browserstackAppRef = 'bs://ios-fixture';
  assert.equal(provider.resolveApp({ config, projectRoot }), 'bs://ios-fixture');
});
test('fixed test OTP still needs explicit authorization and clearance', async (t) => {
  process.env.FLOW_TEST_OTP = 'fixture-otp'; t.after(() => delete process.env.FLOW_TEST_OTP);
  const f = await fixture('ios'); t.after(() => f.gateway.close());
  await f.command({ action: 'dump' });
  await assert.rejects(f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_OTP' }), /confirmAuth/);
  let now = 10000; t.mock.method(Date, 'now', () => now);
  await f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_OTP', confirmAuth: true });
  await assert.rejects(f.command({ action: 'dump' }), /blocked/);
  now += 3000;
  await f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true });
  await f.command({ action: 'dump' });
});
test('secret entry rejects another foreground app before injecting', async (t) => {
  process.env.FLOW_TEST_SECRET = 'fixture-password'; t.after(() => delete process.env.FLOW_TEST_SECRET);
  const f = await fixture(); t.after(() => f.gateway.close());
  await f.command({ action: 'dump' }); f.driver.getCurrentPackage = async () => 'other.app';
  await assert.rejects(f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_SECRET', confirmAuth: true }), /foreground/);
  assert.ok(!f.driver.calls.some((call) => call[0] === 'keys'));
});

test('BrowserStack config rejects invalid device, app reference and unsupported platform', () => {
  for (const device of [{}, { name: 'Phone', osVersion: 16 }, { name: ' ', osVersion: '16' }]) {
    assert.throws(() => compose(normalizeConfig({ ...raw, device })), /device.name and device.osVersion/);
  }
  assert.throws(() => normalizeConfig({ ...raw, app: { ...raw.app, browserstackAppRef: 'https://example.test/app.apk' } }), /bs:\/\//);
  assert.throws(() => compose(normalizeConfig({ ...raw, platform: 'windows' })), { code: 'INVALID_PLATFORM' });
  const defaults = structuredClone(raw); delete defaults.provider; delete defaults.runtime;
  const normalized = normalizeConfig(defaults);
  assert.equal(normalized.provider, 'browserstack'); assert.equal(normalized.runtime.heartbeatSeconds, 45);
});

test('screenshots cannot bypass secret observation protection', async (t) => {
  process.env.FLOW_TEST_SECRET = 'fixture-password'; t.after(() => delete process.env.FLOW_TEST_SECRET);
  const f = await fixture(); t.after(() => f.gateway.close());
  await f.command({ action: 'dump' });
  await f.command({ action: 'typeSecret', secretName: 'FLOW_TEST_SECRET', confirmAuth: true });
  await assert.rejects(f.command({ action: 'screenshot', output: '.scratch/mobile-flow-tests/secret.png' }), /blocked/);
  assert.ok(!f.driver.calls.some((call) => call[0] === 'screenshot'));
});


for (const platformName of ['android', 'ios']) {
  test(`${platformName}: foreground and session checks gate all UI reads/mutations`, async (t) => {
    const f = await fixture(platformName); t.after(() => f.gateway.close());
    const originalForeground = f.platform.foregroundApp.bind(f.platform);
    const commands = [
      { action: 'dump' }, { action: 'tap', target: '' }, { action: 'type', text: 'disposable' },
      { action: 'tapPoint', point: { x: 10, y: 10 }, reason: 'noAccessibleElement' },
      { action: 'swipe', from: { x: 10, y: 20 }, to: { x: 10, y: 10 } },
      { action: 'longpress', target: '' }, { action: 'back' }, { action: 'home' }
    ];
    for (const reason of ['foreground', 'session']) {
      for (const command of commands) {
        f.platform.foregroundApp = originalForeground; f.driver.sessionId = 'owned-session';
        const dump = await f.command({ action: 'dump' });
        const before = f.driver.calls.length;
        if (reason === 'foreground') f.platform.foregroundApp = async () => 'other.app';
        else f.driver.sessionId = 'unexpected';
        await assert.rejects(f.command({ ...command, ...(command.target !== undefined ? { target: dump.elements[0].ref } : {}) }),
          reason === 'foreground' ? /foreground/ : /owned session/);
        assert.equal(f.driver.calls.length, before, 'no source, selector, typing or gesture after rejection');
        f.platform.foregroundApp = originalForeground; f.driver.sessionId = 'owned-session';
        await assert.rejects(f.command({ action: 'tap', target: dump.elements[0].ref }), /fresh/);
      }
    }
    await f.command({ action: 'dump' });
    await f.command({ action: 'type', text: 'disposable' });
    assert.ok(f.driver.calls.some((c) => c[0] === 'keys'));
  });

  test(`${platformName}: manual authentication blocks observations until confirmed completion and clearance`, async (t) => {
    const f = await fixture(platformName, { configure: (c) => { c.safety.authentication.allowedMode = 'manual'; } });
    t.after(() => f.gateway.close());
    await assert.rejects(f.command({ action: 'completeManualAuth', confirmAuth: true, confirmSubmitted: true }), /No manual/);
    await assert.rejects(f.command({ action: 'beginManualAuth', confirmAuth: true }), /safe dump/);
    const dump = await f.command({ action: 'dump' });
    await assert.rejects(f.command({ action: 'beginManualAuth' }), /confirmAuth/);
    const originalForeground = f.platform.foregroundApp.bind(f.platform);
    f.platform.foregroundApp = async () => 'other.app';
    await assert.rejects(f.command({ action: 'beginManualAuth', confirmAuth: true }), /foreground/);
    f.platform.foregroundApp = originalForeground;
    const began = await f.command({ action: 'beginManualAuth', confirmAuth: true });
    assert.equal(began.observationBlocked, true);
    const sourceCount = f.driver.calls.filter((c) => c === 'source').length;
    for (const action of ['dump', 'screenshot', 'tap', 'tapPoint', 'type', 'swipe', 'longpress', 'back', 'home', 'launch', 'typeSecret', 'beginManualAuth']) {
      await assert.rejects(f.command({ action, target: dump.elements[0].ref, output: '.scratch/mobile-flow-tests/secret.png' }), /blocked/);
    }
    await assert.rejects(f.command({ action: 'submitSecret', target: 'ENTER', confirmAuth: true }), /only after typeSecret/);
    await assert.rejects(f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true }), /Wait/);
    const status = await f.command({ action: 'status' });
    assert.equal(status.observationBlocked, true); assert.equal(status.currentPackage, undefined);
    assert.equal(f.driver.calls.filter((c) => c === 'source').length, sourceCount);
    assert.ok(!f.driver.calls.some((c) => c[0] === 'keys' || c[0] === 'screenshot'));
    for (const flags of [{}, { confirmAuth: true }, { confirmSubmitted: true }]) {
      await assert.rejects(f.command({ action: 'completeManualAuth', ...flags }), /confirmAuth=true and confirmSubmitted=true/);
    }
    let now = 10000; t.mock.method(Date, 'now', () => now);
    f.platform.foregroundApp = async () => 'other.app';
    await assert.rejects(f.command({ action: 'completeManualAuth', confirmAuth: true, confirmSubmitted: true }), /foreground/);
    f.platform.foregroundApp = originalForeground;
    await f.command({ action: 'completeManualAuth', confirmAuth: true, confirmSubmitted: true });
    await assert.rejects(f.command({ action: 'completeManualAuth', confirmAuth: true, confirmSubmitted: true }), /already confirmed/);
    await assert.rejects(f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true }), /Wait/);
    now += 3000;
    await assert.rejects(f.command({ action: 'resumeObservation' }), /confirmSecretScreenCleared/);
    f.platform.foregroundApp = async () => 'other.app';
    await assert.rejects(f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true }), /foreground/);
    await assert.rejects(f.command({ action: 'dump' }), /blocked/);
    f.platform.foregroundApp = originalForeground;
    await f.command({ action: 'resumeObservation', confirmSecretScreenCleared: true });
    await assert.rejects(f.command({ action: 'tap', target: dump.elements[0].ref }), /fresh/);
    await f.command({ action: 'dump' });
    await f.command({ action: 'beginManualAuth', confirmAuth: true });
    await f.command({ action: 'close' }); // Cancellation stays possible while blocked.
    await assert.rejects(f.command({ action: 'dump' }), /closed/);
  });

  test(`${platformName}: manual authentication requires policy and action authorization`, async (t) => {
    const disabled = await fixture(platformName, { configure: (c) => { c.safety.authentication.allowedMode = 'disabled'; } });
    t.after(() => disabled.gateway.close());
    await disabled.command({ action: 'dump' });
    await assert.rejects(disabled.command({ action: 'beginManualAuth', confirmAuth: true }), /disabled/);
    const forbidden = await fixture(platformName, { configure: (c) => {
      c.safety.allowedOperations = c.safety.allowedOperations.filter((op) => op !== 'beginManualAuth');
    } });
    t.after(() => forbidden.gateway.close());
    await forbidden.command({ action: 'dump' });
    await assert.rejects(forbidden.command({ action: 'beginManualAuth', confirmAuth: true }), /allowlisted/);
  });

  test(`${platformName}: replay uses the open session; closing is final and idempotent`, async () => {
    const f = await fixture(platformName);
    for (let replay = 0; replay < 2; replay++) {
      const dump = await f.command({ action: 'dump' });
      await f.command({ action: 'tap', target: dump.elements[0].ref });
    }
    assert.equal(f.driver.calls.filter((c) => c === 'delete').length, 0);
    await f.command({ action: 'close' }); await f.command({ action: 'close' });
    assert.equal(f.driver.calls.filter((c) => c === 'delete').length, 1);
    await assert.rejects(f.command({ action: 'dump' }), /closed/);
    await assert.rejects(f.manager.create(), /cannot be restarted/);
  });
}
