'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createOutputResolver } = require('./gateway-core');

test('screenshot resolver accepts configured roots and rejects traversal', () => {
  const projectRoot = path.resolve('C:/workspace/mobile-project');
  const resolver = createOutputResolver(projectRoot, {
    scratchRoot: '.scratch/mobile-flow',
    artifactRoot: 'artifacts/mobile-flow',
    screenshotRoots: ['.scratch/mobile-flow', 'artifacts/mobile-flow']
  }, 'test gateway');

  assert.equal(
    resolver('.scratch/mobile-flow/session/screen.png'),
    path.resolve(projectRoot, '.scratch/mobile-flow/session/screen.png')
  );
  assert.throws(() => resolver('../outside.png'), /configured test gateway output roots/);
  assert.throws(() => resolver('artifacts/mobile-flow/screen.jpg'), /\.png extension/);
});
