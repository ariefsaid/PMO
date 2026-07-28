/**
 * Unit coverage for the pure helpers behind scripts/check-edge-fn-error-reporting.mjs
 * (ADR-0066 §3, FR-OBS-001/002). This gate is what stops the 23rd edge function shipping
 * unwired — it must not be able to silently pass by scanning nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  checkFunctionSource,
  isRunAsMain,
} from '../../../../scripts/check-edge-fn-error-reporting.mjs';

const CLI = resolve(__dirname, '../../../../scripts/check-edge-fn-error-reporting.mjs');

/** Runs the CLI against a functions-root override, returning its exit code + combined output. */
function runCli(functionsDir: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [CLI], {
      env: { ...process.env, EDGE_FN_ERROR_REPORTING_FUNCTIONS_DIR: functionsDir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

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

  it('review round: flags globalThis.Deno.serve( too — the one evasion a future author would plausibly reach for', () => {
    const src = `
      serveWithErrorReporting('erpnext-sweep', handler);
      globalThis.Deno.serve(handler2);
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

describe('the CLI itself CAN go red (not just its pure helpers) — DoD: prove it', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('exits 1 and reports the gate scanned NOTHING when the functions dir has zero function directories (empty-input case)', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'edge-fn-gate-empty-'));
    tmpDirs.push(dir);

    const { status, output } = runCli(dir);

    expect(status).toBe(1);
    expect(output).toMatch(/0 edge-function directories found/);
    // The exact green-by-absence failure class this gate exists to prevent: must NOT print a
    // "0/0" success line.
    expect(output).not.toMatch(/✓ edge fns route through serveWithErrorReporting/);
  });

  it('exits 1 and names the specific file when a function\'s index.ts cannot be read (unreadable-file case), never silently skipping it', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'edge-fn-gate-unreadable-'));
    tmpDirs.push(dir);
    const fnDir = resolve(dir, 'erpnext-sweep');
    mkdirSync(fnDir);
    const indexPath = resolve(fnDir, 'index.ts');
    writeFileSync(indexPath, `serveWithErrorReporting('erpnext-sweep', handler);`);
    chmodSync(indexPath, 0o000); // unreadable

    try {
      const { status, output } = runCli(dir);
      expect(status).toBe(1);
      expect(output).toMatch(/erpnext-sweep\/index\.ts/);
      expect(output).toMatch(/could not read this file/);
    } finally {
      chmodSync(indexPath, 0o644); // restore so rmSync in afterEach can delete it
    }
  });

  it('exits 0 and reports N/N when every function in the (isolated) dir is correctly wired', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'edge-fn-gate-green-'));
    tmpDirs.push(dir);
    const fnDir = resolve(dir, 'health');
    mkdirSync(fnDir);
    writeFileSync(
      resolve(fnDir, 'index.ts'),
      `import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';\n` +
        `serveWithErrorReporting('health', (req) => new Response('ok'));\n`,
    );

    const { status, output } = runCli(dir);

    expect(status).toBe(0);
    expect(output).toMatch(/✓ edge fns route through serveWithErrorReporting \(1\/1\)/);
  });
});
