/**
 * Unit coverage for the pure guard behind scripts/check-edge-fn-test-binding.mjs's
 * "Deno.serve must be guarded by `import.meta.main`" assertion.
 *
 * SILENT-VACUOUSNESS CLASS (review round, 2026-07-28): C8 routed the 6 `import.meta.main`-guarded
 * functions (external-companies et al.) through `serveWithErrorReporting(...)` instead of a bare
 * `Deno.serve(...)`. This gate's original regex matched ONLY `Deno\.serve\s*\(` — after C8, none
 * of those 6 files contain that literal text any more, so the assertion's condition
 * (`/Deno\.serve\s*\(/.test(src) && !guarded`) can never be true again: it silently stopped
 * enforcing the guard it exists to protect, while itself staying green. "A fix that disarms a
 * neighbouring gate" — a new failure class, worth a regression test on its own.
 */
import { describe, it, expect } from 'vitest';
import { hasUnguardedServeCall } from '../../../../scripts/check-edge-fn-test-binding.mjs';

describe('hasUnguardedServeCall', () => {
  it('SILENT-VACUOUSNESS: an unguarded serveWithErrorReporting( call is caught (the post-C8 shape)', () => {
    const src = `serveWithErrorReporting('external-companies', handleCompaniesRequest);`;
    expect(hasUnguardedServeCall(src)).toBe(true);
  });

  it('a GUARDED serveWithErrorReporting( call (the shipped, correct shape) is not flagged', () => {
    const src = `
      if (import.meta.main) {
        serveWithErrorReporting('external-companies', handleCompaniesRequest);
      }
    `;
    expect(hasUnguardedServeCall(src)).toBe(false);
  });

  it('an unguarded bare Deno.serve( call is still caught (pre-C8 shape, regression guard)', () => {
    expect(hasUnguardedServeCall(`Deno.serve(async (req) => new Response('ok'));`)).toBe(true);
  });

  it('a guarded bare Deno.serve( call is still not flagged (pre-C8 shape, regression guard)', () => {
    const src = `
      if (import.meta.main) {
        Deno.serve(async (req) => new Response('ok'));
      }
    `;
    expect(hasUnguardedServeCall(src)).toBe(false);
  });

  it('a file with NEITHER serve call is not flagged (nothing to guard)', () => {
    expect(hasUnguardedServeCall(`export function handleCompaniesRequest(req) { return req; }`)).toBe(false);
  });
});
