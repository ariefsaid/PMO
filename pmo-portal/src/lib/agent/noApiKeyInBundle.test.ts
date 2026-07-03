/**
 * AC-AR-010 / AC-MC-010: no ANTHROPIC_API_KEY or OPENROUTER_API_KEY literal appears
 * anywhere under pmo-portal/.
 * NFR-AR-SEC-001 / NFR-MC-SEC-001: keys live only in the respective edge-function secret.
 */
import { it, expect } from 'vitest';
import { execSync } from 'node:child_process';

it('AC-AR-010 no ANTHROPIC_API_KEY literal appears anywhere under pmo-portal/', () => {
  // ripgrep from pmo-portal/; exit code 1 = no matches (the pass condition).
  // Exclude this test file itself (the key appears here only inside rg's argument string).
  let matches: string;
  try {
    matches = execSync(
      "rg -l --glob '!**/noApiKeyInBundle.test.ts' ANTHROPIC_API_KEY .",
      { cwd: process.cwd() },
    ).toString();
  } catch {
    // rg exits 1 when no matches found — that's the pass condition.
    matches = '';
  }
  expect(matches.trim()).toBe('');
});

it('AC-MC-010 no OPENROUTER_API_KEY literal appears anywhere under pmo-portal/', () => {
  let matches: string;
  try {
    matches = execSync(
      "rg -l --glob '!**/noApiKeyInBundle.test.ts' OPENROUTER_API_KEY .",
      { cwd: process.cwd() },
    ).toString();
  } catch {
    matches = '';
  }
  expect(matches.trim()).toBe('');
});
