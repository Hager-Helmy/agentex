'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const gatewayPath = path.join(__dirname, 'gateway-core.js');

function run({ platform, cause, deletionFails, late = false }) {
  const code = `
    const { runGateway } = require(${JSON.stringify(gatewayPath)});
    let tick;
    if (${JSON.stringify(cause)} === 'heartbeat') {
      global.setInterval = callback => { tick = callback; return 1; };
      global.clearInterval = () => {};
    }
    let deletes = 0;
    process.on('exit', () => console.log(JSON.stringify({ deletes })));
    const pending = runGateway({
      projectRoot: process.cwd(), gatewayName: 'offline lifecycle fixture',
      flowConfig: { appId: 'test.app', scratchRoot: '.scratch/fixture', artifactRoot: 'artifacts/fixture', allowedOperations: ['close'] },
      platform: { automationName: ${JSON.stringify(platform)} },
      interactive: ${cause === 'eof'}, argv: [], heartbeatSeconds: ${cause === 'heartbeat' ? 1 : 0},
      createDriver: async () => {
        if (${late}) await new Promise(resolve => setTimeout(resolve, 20));
        return { getWindowSize: async () => { throw new Error('PRIVATE_HEARTBEAT_DETAIL'); } };
      },
      closeSession: async () => { deletes++; if (${deletionFails}) throw new Error('PRIVATE_DELETE_DETAIL'); }
    });
    if (${late}) process.emit('SIGTERM');
    pending.then(() => {
      if (${late}) return;
      if (${JSON.stringify(cause)} === 'signal') process.emit('SIGTERM');
      if (${JSON.stringify(cause)} === 'heartbeat') tick();
    });
  `;
  const result = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', input: '', timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot || '', PATH: process.env.PATH || '' }
  });
  assert.ifError(result.error);
  assert.equal(result.stderr, '', 'no unhandled rejection or raw driver error');
  assert.ok(!result.stdout.includes('PRIVATE_'), 'driver details are not emitted');
  return { status: result.status, events: result.stdout.trim().split('\n').map(line => JSON.parse(line)) };
}
for (const platform of ['UiAutomator2', 'XCUITest']) {
  for (const cause of ['signal', 'heartbeat', 'eof']) {
    for (const deletionFails of [false, true]) {
      test(`${platform}: ${cause} cleanup ${deletionFails ? 'failure is reported' : 'succeeds'} exactly once`, () => {
        const { status, events } = run({ platform, cause, deletionFails });
        assert.equal(status, deletionFails || cause === 'heartbeat' ? 1 : 0);
        assert.equal(events.filter(e => e.event === 'cleanupError').length, deletionFails ? 1 : 0);
        assert.equal(events.filter(e => e.event === 'heartbeatError').length, cause === 'heartbeat' ? 1 : 0);
        assert.equal(events.at(-1).deletes, 1);
      });
    }
  }
  test(`${platform}: SIGTERM during creation cleans up the late session`, () => {
    const { status, events } = run({ platform, cause: 'signal', deletionFails: false, late: true });
    assert.equal(status, 0); assert.equal(events.at(-1).deletes, 1);
  });
}
