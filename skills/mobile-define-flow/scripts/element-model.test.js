'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ElementRefs } = require('./element-model');

test('ElementRefs assigns monotonic semantic refs to normalized elements', () => {
  const elements = new ElementRefs().replace([{ enabled: true }, { enabled: true }]);
  assert.equal(elements[0].ref, '@e1');
  assert.equal(elements[1].ref, '@e2');
});
