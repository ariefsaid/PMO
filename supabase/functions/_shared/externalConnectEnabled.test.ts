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
  // Disable is deliberately LIBERAL: a break-glass control must not silently stay on because an
  // operator reached for a reasonable false-y value under incident pressure.
  assertEquals(isExternalConnectEnabled('0'), false);
  assertEquals(isExternalConnectEnabled('off'), false);
  assertEquals(isExternalConnectEnabled('OFF'), false);
  assertEquals(isExternalConnectEnabled('no'), false);
  assertEquals(isExternalConnectEnabled(' Disabled '), false);
  // Enable stays strict: only affirmative or unrecognised values keep it on (default-ON, FR-IEM-003).
  assertEquals(isExternalConnectEnabled('true'), true);
  assertEquals(isExternalConnectEnabled('yes'), true);
  assertEquals(isExternalConnectEnabled('1'), true);
  assertEquals(isExternalConnectEnabled('flase'), true);
  assertEquals(isExternalConnectEnabled('unexpected'), true);
});
