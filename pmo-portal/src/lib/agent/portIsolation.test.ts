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
      "rg -l \"from ['\\\"].*pmoNativeRuntime\" --glob '!src/lib/agent/runtime/**' --glob '!**/portIsolation.test.ts' --glob '!**/port.contract.test.ts' --glob '!**/pmoNativeRuntime.test.ts' .",
      { cwd: process.cwd() },
    ).toString();
  } catch {
    hits = '';
  }
  expect(hits.trim()).toBe('');
});

it('AC-MC-017 DeputyContext gains no modelClient member under the ModelClient rename', () => {
  // Type-level assertion: DeputyContext (runtime/port.ts) must have exactly its
  // documented members. This mirrors the ADR-0041 invariant this file already
  // exists to protect, now re-asserted for the renamed anthropic->modelClient seam.
  type Keys = keyof import('./runtime/port').DeputyContext;
  const allowedKeys: Record<Keys, true> = { jwt: true, userId: true, orgId: true, supabase: true };
  // If DeputyContext ever gains a `modelClient` (or any other) member, this object
  // literal fails to typecheck (excess/missing property) — a compile-time proof,
  // not just a runtime grep.
  expect(Object.keys(allowedKeys)).toEqual(['jwt', 'userId', 'orgId', 'supabase']);
});
