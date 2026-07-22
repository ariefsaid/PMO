import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isExternalConnectEnabled } from './externalConnectEnabled.ts';

Deno.test('AC-IEM-001: unset and empty kill-switch values are enabled by default', () => {
  assertEquals(isExternalConnectEnabled(undefined), true);
  assertEquals(isExternalConnectEnabled(''), true);
  assertEquals(isExternalConnectEnabled('   '), true);
});

Deno.test('AC-IEM-001: only explicit false disables, case-insensitively and with whitespace', () => {
  assertEquals(isExternalConnectEnabled('false'), false);
  assertEquals(isExternalConnectEnabled(' FALSE '), false);
  assertEquals(isExternalConnectEnabled('FaLsE'), false);
  assertEquals(isExternalConnectEnabled('0'), true);
  assertEquals(isExternalConnectEnabled('off'), true);
  assertEquals(isExternalConnectEnabled('no'), true);
  assertEquals(isExternalConnectEnabled('true'), true);
  assertEquals(isExternalConnectEnabled('yes'), true);
  assertEquals(isExternalConnectEnabled('unexpected'), true);
});
