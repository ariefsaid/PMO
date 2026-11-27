import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogueBase, catalogueHash } from './catalogueVersion';
import { catalogueBackend } from '../i18n';

function tmpLocales(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

describe('versioned language catalogues', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('the backend requests the versioned address of the build', () => {
    vi.stubEnv('VITE_CATALOGUE_BASE', '/catalogues/abc123def456');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    catalogueBackend.read!('id', 'common', vi.fn());
    expect(fetchMock).toHaveBeenCalledWith('/catalogues/abc123def456/id/common.json', expect.anything());
    vi.unstubAllGlobals();
  });

  it('a new build (changed catalogue content) gets a new address; an unchanged one keeps it', () => {
    const a = tmpLocales({ 'en/common.json': '{"a":"1"}', 'id/common.json': '{"a":"satu"}' });
    const same = tmpLocales({ 'en/common.json': '{"a":"1"}', 'id/common.json': '{"a":"satu"}' });
    const changed = tmpLocales({ 'en/common.json': '{"a":"2"}', 'id/common.json': '{"a":"satu"}' });
    expect(catalogueBase(a)).toBe(catalogueBase(same));
    expect(catalogueBase(a)).not.toBe(catalogueBase(changed));
    expect(catalogueBase(a)).toMatch(/^\/catalogues\/[0-9a-f]{12}$/);
  });

  it('the shipped catalogues hash to a stable non-empty address', () => {
    expect(catalogueHash(path.join(process.cwd(), 'public/locales'))).toMatch(/^[0-9a-f]{12}$/);
  });

  it('public/_headers caches versioned catalogues immutably and keeps /locales and index.html revalidating', () => {
    const text = fs.readFileSync(path.join(process.cwd(), 'public/_headers'), 'utf8');
    const rule = (pattern: string) => text.split('\n').reduce<string | null>((found, line, i, all) =>
      line.trim() === pattern ? (all[i + 1] ?? '').trim() : found, null);
    expect(rule('/catalogues/*')).toBe('Cache-Control: public, max-age=31536000, immutable');
    expect(rule('/locales/*')).toBe('Cache-Control: no-cache');
    expect(rule('/index.html')).toBe('Cache-Control: no-cache');
  });
});

describe('stale versioned catalogue address (tab kept open across a release)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('falls back once to /locales when the old address answers with HTML', async () => {
    vi.stubEnv('VITE_CATALOGUE_BASE', '/catalogues/oldhash00000');
    const fetchMock = vi.fn((url: string) =>
      url.startsWith('/catalogues/')
        ? Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token <')) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ greeting: 'Hello' }) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cb = vi.fn();
    catalogueBackend.read!('en', 'common', cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(null, { greeting: 'Hello' }));
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      '/catalogues/oldhash00000/en/common.json',
      '/locales/en/common.json',
    ]);
  });

  it('falls back on a failed versioned fetch, and reports an error when the fallback fails too (no loop)', async () => {
    vi.stubEnv('VITE_CATALOGUE_BASE', '/catalogues/oldhash00000');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    const cb = vi.fn();
    catalogueBackend.read!('en', 'common', cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(expect.any(Error), false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fall back when the base is already /locales', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    const cb = vi.fn();
    catalogueBackend.read!('en', 'common', cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
