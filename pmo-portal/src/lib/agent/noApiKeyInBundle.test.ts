/**
 * AC-AR-010: no ANTHROPIC_API_KEY literal appears anywhere under pmo-portal/.
 * NFR-AR-SEC-001: the key lives only in the agent-chat function secret.
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
