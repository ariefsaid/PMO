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
  it('a failed upload returns non-zero, keeps nothing claimed', async () => {
    const d = dist();
    const logs: string[] = [];
    const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async () => 1, log: (m: string) => logs.push(m) });
    expect(code).not.toBe(0);
    expect(logs.join('\n')).not.toMatch(/uploaded/);
  });
  it('deploy build without credential exits non-zero; fork/CI build exits 0 with a visible message', async () => {
    const logs: string[] = [];
    expect(await runSourcemapStep({ env: { CF_PAGES: '1', CF_PAGES_BRANCH: 'production' }, distDir: dist(), run: async () => 0, log: (m: string) => logs.push(m) })).not.toBe(0);
    expect(await runSourcemapStep({ env: {}, distDir: dist(), run: async () => 0, log: (m: string) => logs.push(m) })).toBe(0);
    expect(logs.join('\n')).toMatch(/skipped: not a deploy build/);
  });
});
