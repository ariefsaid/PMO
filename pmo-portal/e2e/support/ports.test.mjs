import test from 'node:test';
import assert from 'node:assert/strict';
import { portFromEnv } from './ports.mjs';

test('portFromEnv falls back when the variable is unset or empty', () => {
  assert.equal(portFromEnv('E2E_PORT', 3000, {}), 3000);
  assert.equal(portFromEnv('E2E_PORT', 3000, { E2E_PORT: '' }), 3000);
});

test('portFromEnv reads a valid port', () => {
  assert.equal(portFromEnv('E2E_PORT', 3000, { E2E_PORT: '4123' }), 4123);
});

test('portFromEnv rejects non-ports', () => {
  for (const bad of ['abc', '0', '65536', '30.5', '-1']) {
    assert.throws(() => portFromEnv('E2E_PORT', 3000, { E2E_PORT: bad }), /E2E_PORT must be a port number/);
  }
});
