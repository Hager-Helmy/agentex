'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserStackProvider } = require('./browserstack-provider');
const { resolveCachePath, readAppCache } = require('../app-cache');

function fixture(t, platform = 'android') {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agentex-cache-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project'); fs.mkdirSync(projectRoot);
  const appPath = platform === 'ios' ? 'fixture.ipa' : 'fixture.apk';
  fs.writeFileSync(path.join(projectRoot, appPath), 'synthetic archive');
  const config = { platform, app: { path: appPath }, browserstack: {
    appCache: `.runtime/browserstack/${platform}/app.json`, appUrlEnv: 'UNUSED_CACHE_FIXTURE_APP_URL'
  } };
  const provider = new BrowserStackProvider(); let requests = 0;
  provider.request = async () => { requests++; return { app_url: 'bs://fixture' }; };
  return { sandbox, projectRoot, config, provider, requests: () => requests };
}
for (const platform of ['android', 'ios']) {
  test(`${platform}: upload writes and replaces only a recognized cache; round-trip resolves`, async (t) => {
    const f = fixture(t, platform);
    const first = await f.provider.upload(f);
    assert.equal(first.cachePath, path.normalize(f.config.browserstack.appCache));
    const destination = path.join(f.projectRoot, first.cachePath);
    assert.equal(readAppCache(destination).platform, platform);
    assert.equal(f.provider.resolveApp(f), 'bs://fixture');
    f.provider.request = async () => ({ app_url: 'bs://updated' });
    await f.provider.upload(f);
    assert.equal(f.provider.resolveApp(f), 'bs://updated');
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['app.json']);
  });
  test(`${platform}: unsafe cache destinations are rejected before upload`, async (t) => {
    const f = fixture(t, platform);
    for (const destination of [
      '../outside.json', path.join(f.sandbox, 'outside.json'), '/tmp/outside.json',
      'C:\\outside.json', 'C:outside.json', 'package.json', '.runtime/browserstack-other/app.json',
      '.runtime/browserstack/../../package.json', '.runtime/browserstack', '.runtime/browserstack/app.txt', '', null
    ]) {
      f.config.browserstack.appCache = destination;
      await assert.rejects(f.provider.upload(f), /relative JSON path/);
    }
    assert.equal(f.requests(), 0);
    assert.deepEqual(fs.readdirSync(f.projectRoot), [f.config.app.path]);
  });
  test(`${platform}: unrelated JSON is never overwritten`, async (t) => {
    const f = fixture(t, platform);
    const destination = path.join(f.projectRoot, f.config.browserstack.appCache);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const original = '{"name":"consumer-project"}'; fs.writeFileSync(destination, original);
    await assert.rejects(f.provider.upload(f), /not an app upload cache/);
    assert.equal(fs.readFileSync(destination, 'utf8'), original); assert.equal(f.requests(), 0);
  });
  test(`${platform}: destination is revalidated after the mocked upload`, async (t) => {
    const f = fixture(t, platform);
    const destination = path.join(f.projectRoot, f.config.browserstack.appCache);
    f.provider.request = async () => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, '{"name":"appeared-during-upload"}');
      return { app_url: 'bs://fixture' };
    };
    await assert.rejects(f.provider.upload(f), /not an app upload cache/);
    assert.equal(JSON.parse(fs.readFileSync(destination)).name, 'appeared-during-upload');
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['app.json']);
  });
  test(`${platform}: junction/symlink parents cannot redirect cache reads or uploads`, async (t) => {
    const f = fixture(t, platform);
    const outside = path.join(f.sandbox, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.projectRoot, '.runtime'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.provider.upload(f), /symbolic links or junctions/);
    assert.throws(() => f.provider.resolveApp(f), /symbolic links or junctions/);
    assert.equal(f.requests(), 0); assert.deepEqual(fs.readdirSync(outside), []);
  });
  test(`${platform}: hard-linked cache files are rejected without modifying their other name`, async (t) => {
    const f = fixture(t, platform);
    const outside = path.join(f.sandbox, 'outside.json');
    const content = JSON.stringify({ appUrl: 'bs://original', source: f.config.app.path, platform });
    fs.writeFileSync(outside, content);
    const destination = path.join(f.projectRoot, f.config.browserstack.appCache);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.linkSync(outside, destination);
    await assert.rejects(f.provider.upload(f), /single-link file/);
    assert.equal(f.requests(), 0); assert.equal(fs.readFileSync(outside, 'utf8'), content);
  });
  test(`${platform}: invalid upload responses and network failures do not replace an existing cache`, async (t) => {
    const f = fixture(t, platform); await f.provider.upload(f);
    const destination = path.join(f.projectRoot, f.config.browserstack.appCache);
    const original = fs.readFileSync(destination, 'utf8');
    f.provider.request = async () => ({ app_url: 'https://invalid.example' });
    await assert.rejects(f.provider.upload(f), /invalid app reference/);
    f.provider.request = async () => { throw new Error('synthetic network failure'); };
    await assert.rejects(f.provider.upload(f), /synthetic network failure/);
    assert.equal(fs.readFileSync(destination, 'utf8'), original);
  });
}
test('legacy Android cache remains readable; it is rejected for iOS', (t) => {
  const f = fixture(t);
  const destination = resolveCachePath(f.projectRoot, f.config.browserstack.appCache);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify({ appUrl: 'bs://legacy', source: f.config.app.path }));
  assert.equal(f.provider.resolveApp(f), 'bs://legacy');
  f.config.platform = 'ios'; assert.throws(() => f.provider.resolveApp(f), /another platform/);
});
