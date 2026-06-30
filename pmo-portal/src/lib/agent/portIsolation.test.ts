/**
 * AC-AR-011: no module outside src/lib/agent/runtime/ imports a concrete adapter.
 * NFR-AR-SEC-007: port isolation — callers depend only on port.ts, not adapters.
 */
import { it, expect } from 'vitest';
import { execSync } from 'node:child_process';

it('AC-AR-011 no module outside src/lib/agent/runtime/ imports a concrete adapter (pmoNativeRuntime)', () => {
  let hits: string;
  try {
    // rg exits 1 when no matches found — pass condition.
    // Exclude runtime/ itself (that's where the adapter lives) and the contract test
    // (which is the designated exerciser of the adapter under test).
    hits = execSync(
      "rg -l \"from ['\\\"].*pmoNativeRuntime\" --glob '!src/lib/agent/runtime/**' --glob '!**/portIsolation.test.ts' --glob '!**/port.contract.test.ts' .",
      { cwd: process.cwd() },
    ).toString();
  } catch {
    hits = '';
  }
  expect(hits.trim()).toBe('');
});
