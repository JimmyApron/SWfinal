const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('./step09-diagnose.cjs');
test('diagnostic reports invalid key category without returning arbitrary response text', () => {
  const result = classify({ message: 'Invalid API key secret-not-to-log', details: 'private', code: 'PGRST301' });
  assert.deepEqual(result, { code: 'PGRST301', category: 'invalid_api_key' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('arbitrary error codes and JWT-like values are not emitted', () => {
  assert.deepEqual(classify({ code: 'eyJ.secret.token', message: 'some private value' }), { code: null, category: 'unclassified' });
});
test('response without an error code does not invent one', () => {
  assert.deepEqual(classify({ message: 'Invalid API key' }), { code: null, category: 'invalid_api_key' });
});
