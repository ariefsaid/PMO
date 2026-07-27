/**
 * Unit coverage for the pure helpers behind scripts/check-edge-fn-error-reporting.mjs
 * (ADR-0066 §3, FR-OBS-001/002). This gate is what stops the 23rd edge function shipping
 * unwired — it must not be able to silently pass by scanning nothing.
 */
import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import {
  checkFunctionSource,
  isRunAsMain,
} from '../../../../scripts/check-edge-fn-error-reporting.mjs';

describe('isRunAsMain — percent-encoding-safe entrypoint check (mirrors check-dashboard-tiles.mjs)', () => {
  it('a path containing a space still matches (the failure the house pattern guards against)', () => {
    const argv1 = '/tmp/my project/scripts/check-edge-fn-error-reporting.mjs';
    const realImportMetaUrl = pathToFileURL(argv1).href;
    expect(isRunAsMain(realImportMetaUrl, argv1)).toBe(true);
  });

  it('proves the OLD buggy comparison (`file://${argv1}`) would have failed on that same path', () => {
    const argv1 = '/tmp/my project/scripts/check-edge-fn-error-reporting.mjs';
    const realImportMetaUrl = pathToFileURL(argv1).href;
    expect(realImportMetaUrl === `file://${argv1}`).toBe(false);
  });

  it('a normal path with no special characters still matches', () => {
    const argv1 = '/repo/scripts/check-edge-fn-error-reporting.mjs';
    expect(isRunAsMain(pathToFileURL(argv1).href, argv1)).toBe(true);
  });

  it('a DIFFERENT script being executed does not match (imported-as-a-module case)', () => {
    const argv1 = '/repo/pmo-portal/node_modules/.bin/vitest';
    expect(isRunAsMain(pathToFileURL('/repo/scripts/check-edge-fn-error-reporting.mjs').href, argv1)).toBe(false);
  });
});

describe('checkFunctionSource — the gate CAN go red', () => {
  it('flags a function with no serveWithErrorReporting call at all', () => {
    const src = `Deno.serve(async (req) => new Response('ok'));`;
    const failures = checkFunctionSource('erpnext-sweep', src);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toMatch(/serveWithErrorReporting/);
  });

  it('flags a bare Deno.serve( left alongside serveWithErrorReporting (bypass path)', () => {
    const src = `
      serveWithErrorReporting('erpnext-sweep', handler);
      Deno.serve(handler2);
    `;
    const failures = checkFunctionSource('erpnext-sweep', src);
    expect(failures.some((f) => /bare Deno\.serve/.test(f))).toBe(true);
  });

  it('flags a copy-pasted function name (misattributes every error)', () => {
    const src = `serveWithErrorReporting('erpnext-onboard', async (req) => new Response('ok'));`;
    const failures = checkFunctionSource('erpnext-sweep', src);
    expect(failures.some((f) => /OWN name/.test(f))).toBe(true);
  });

  it('passes a correctly wired function with zero failures', () => {
    const src = `
      import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
      serveWithErrorReporting('erpnext-sweep', async (req: Request): Promise<Response> => {
        return new Response('ok');
      });
    `;
    expect(checkFunctionSource('erpnext-sweep', src)).toEqual([]);
  });

  it('passes an import.meta.main-guarded function wired with its own name', () => {
    const src = `
      if (import.meta.main) {
        serveWithErrorReporting('external-companies', handleCompaniesRequest);
      }
    `;
    expect(checkFunctionSource('external-companies', src)).toEqual([]);
  });
});
