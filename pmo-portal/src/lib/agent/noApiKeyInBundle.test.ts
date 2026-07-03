/**
 * AC-AR-010 / AC-MC-010: no ANTHROPIC_API_KEY or OPENROUTER_API_KEY literal appears
 * anywhere under pmo-portal/.
 * NFR-AR-SEC-001 / NFR-MC-SEC-001: keys live only in the respective edge-function secret.
 */
import { it, expect } from 'vitest';
import { runNegativeGrep } from './testGrep';

it('AC-AR-010 no ANTHROPIC_API_KEY literal appears anywhere under pmo-portal/', () => {
  // Exclude this test file itself (the key appears here only inside the grep argument string).
  const matches = runNegativeGrep('ANTHROPIC_API_KEY', {
    cwd: process.cwd(),
    excludeGlobs: ['noApiKeyInBundle.test.ts'],
  });
  expect(matches.trim()).toBe('');
});

it('AC-MC-010 no OPENROUTER_API_KEY literal appears anywhere under pmo-portal/', () => {
  const matches = runNegativeGrep('OPENROUTER_API_KEY', {
    cwd: process.cwd(),
    excludeGlobs: ['noApiKeyInBundle.test.ts'],
  });
  expect(matches.trim()).toBe('');
});
