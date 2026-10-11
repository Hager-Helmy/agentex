'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scripts = __dirname;
const reference = fs.readFileSync(path.join(scripts, '../references/configuration.md'), 'utf8');
const example = JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/)[1]);

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentex-mobile-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));
  // A network tripwire: no offline validation test may contact a provider.
  fs.writeFileSync(path.join(root, 'offline.cjs'),
    "global.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };\n");
  return root;
}
function run(root, entry, args) {
  const result = spawnSync(process.execPath,
    ['--require', path.join(root, 'offline.cjs'), path.join(scripts, entry), ...args], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      // Do not inherit BrowserStack or any other user credentials.
      env: { SystemRoot: process.env.SystemRoot || '', PATH: process.env.PATH || '' }
    });
  assert.ifError(result.error);
  assert.equal(result.stderr, '');
  return { status: result.status, output: JSON.parse(result.stdout) };
}

test('documented config validates offline from a consumer cwd through both entrypoints', (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'config/mobile.json'), JSON.stringify(example));
  for (const entry of ['cli.js', 'session.js']) {
    const result = run(root, entry, ['--validate-config']);
    assert.equal(result.status, 0);
    assert.deepEqual(result.output, { ok: true, event: 'configurationValid', provider: 'browserstack', platform: 'android' });
  }
  assert.deepEqual(fs.readdirSync(root).sort(), ['config', 'offline.cjs']);
});

test('explicit complete config and platform override validate iOS without a device', (t) => {
  const root = project(t);
  const config = structuredClone(example);
  config.app = { bundleId: 'com.example.app', browserstackAppRef: 'bs://fixture' };
  fs.writeFileSync(path.join(root, 'config/ios.json'), JSON.stringify(config));
  const result = run(root, 'cli.js', ['--validate-config', '--config', 'config/ios.json', '--platform', 'ios']);
  assert.equal(result.status, 0);
  assert.equal(result.output.platform, 'ios');
});

test('missing selected config fails without falling back to the default', (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'config/mobile.json'), JSON.stringify(example));
  const result = run(root, 'cli.js', ['--validate-config', '--config', 'config/missing.json']);
  assert.equal(result.status, 1);
  assert.equal(result.output.ok, false);
});

test('invalid JSON and incompatible platform fail offline with the existing exit contract', (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'config/mobile.json'), '{');
  assert.equal(run(root, 'cli.js', ['--validate-config']).status, 1);
  fs.writeFileSync(path.join(root, 'config/mobile.json'), JSON.stringify(example));
  const result = run(root, 'cli.js', ['--validate-config', '--platform', 'ios']);
  assert.equal(result.status, 1);
  assert.equal(result.output.ok, false);
});
