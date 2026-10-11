'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AndroidPlatformAdapter } = require('./android-adapter');

test('Android source normalization preserves semantics and redacts password text', () => {
  const source = `
    <hierarchy>
      <android.widget.Button text="Continue" resource-id="com.example.app:id/continue"
        clickable="true" enabled="true" displayed="true" bounds="[10,20][210,120]" />
      <android.widget.EditText text="secret-value" password="true" focusable="true"
        enabled="true" displayed="true" bounds="[10,140][500,240]" />
    </hierarchy>`;

  const elements = new AndroidPlatformAdapter().normalizeSource(source);
  assert.equal(elements.length, 2);
  assert.equal(elements[0].role, 'button');
  assert.equal(elements[0].resourceId, 'com.example.app:id/continue');
  assert.equal(elements[1].text, '[REDACTED]');
  assert.equal(elements[1].label, '');
  assert.equal(elements[1].accessibilityId, '');
  assert.equal(elements[1].password, true);
});
