import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSourcemapStep } from '../../../../scripts/upload-sourcemaps.mjs';

const DEPLOY_WITH_CRED = {
  CF_PAGES: '1',
  CF_PAGES_BRANCH: 'production',
  CF_PAGES_COMMIT_SHA: 'abcdef1234567890',
  POSTHOG_CLI_API_KEY: 'k',
  POSTHOG_CLI_PROJECT_ID: '1',
};

function dist() {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(d, 'assets'));
  writeFileSync(join(d, 'assets/a.js'), '//');
  writeFileSync(join(d, 'assets/a.js.map'), '{}');
  return d;
}

describe('AC-PHO-011 upload step', () => {
  it('uploads then removes every .map from the deployed output', async () => {
    const d = dist();
    const calls: string[][] = [];
    const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async (args: string[]) => { calls.push(args); return 0; }, log: () => undefined });
    expect(code).toBe(0);
    expect(calls.map((c) => c[1])).toEqual(['inject', 'upload']);
    expect(calls[1]).toEqual(expect.arrayContaining(['--release-version', 'abcdef1']));
    expect(existsSync(join(d, 'assets/a.js.map'))).toBe(false);
  });
  const mapGone = (d: string) => !existsSync(join(d, 'assets/a.js.map'));
  const warn = (logs: string[]) => expect(logs.join('\n')).toMatch(/sourcemaps WARNING: /);

  it('a failed upload warns, returns 0 and serves no maps', async () => {
    const d = dist();
    const logs: string[] = [];
    const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async () => 1, log: (m: string) => logs.push(m) });
    expect(code).toBe(0);
    warn(logs);
    expect(logs.join('\n')).not.toMatch(/uploaded/);
    expect(mapGone(d)).toBe(true);
  });
  it('a failed inject warns, returns 0 and serves no maps', async () => {
    const d = dist();
    const logs: string[] = [];
    const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async (a: string[]) => (a[1] === 'inject' ? 1 : 0), log: (m: string) => logs.push(m) });
    expect(code).toBe(0);
    warn(logs);
    expect(mapGone(d)).toBe(true);
  });
  it('a CLI that throws warns, returns 0 and serves no maps', async () => {
    const d = dist();
    const logs: string[] = [];
    const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async () => { throw new Error('spawn'); }, log: (m: string) => logs.push(m) });
    expect(code).toBe(0);
    warn(logs);
    expect(mapGone(d)).toBe(true);
  });
  it('deploy build without credential warns, returns 0 and serves no maps', async () => {
    const d = dist();
    const logs: string[] = [];
    const code = await runSourcemapStep({ env: { CF_PAGES: '1', CF_PAGES_BRANCH: 'production', CF_PAGES_COMMIT_SHA: 'abcdef1234567890' }, distDir: d, run: async () => 0, log: (m: string) => logs.push(m) });
    expect(code).toBe(0);
    warn(logs);
    expect(mapGone(d)).toBe(true);
  });
  it('deploy build with missing sha warns, returns 0 and serves no maps', async () => {
    const d = dist();
    const logs: string[] = [];
    const { CF_PAGES_COMMIT_SHA: _sha, ...env } = DEPLOY_WITH_CRED;
    const code = await runSourcemapStep({ env, distDir: d, run: async () => 0, log: (m: string) => logs.push(m) });
    expect(code).toBe(0);
    warn(logs);
    expect(mapGone(d)).toBe(true);
  });
  it('deploy build with no maps warns and returns 0', async () => {
    const d = mkdtempSync(join(tmpdir(), 'dist-'));
    const logs: string[] = [];
    expect(await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async () => 0, log: (m: string) => logs.push(m) })).toBe(0);
    warn(logs);
  });
  it('non-deploy build exits 0 with a visible message and keeps its maps', async () => {
    const d = dist();
    const logs: string[] = [];
    expect(await runSourcemapStep({ env: {}, distDir: d, run: async () => 0, log: (m: string) => logs.push(m) })).toBe(0);
    expect(logs.join('\n')).toMatch(/skipped: not a deploy build/);
    expect(mapGone(d)).toBe(false);
  });
});
