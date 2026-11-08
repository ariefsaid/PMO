// Unit tests for the bench-host guard the serial e2e helpers share (#1359).
/**
 * The serial e2e helpers create ERPNext records straight on the bench. These tests pin the contract
 * from #1359:
 *  - a bench host that is not local is REFUSED before any fetch leaves the process;
 *  - the localhost spellings a local run may legitimately use (IPv6 loopback, any letter case,
 *    DNS-root-qualified `localhost.`) are all recognised as local — no behaviour change for local runs;
 *  - the explicit remote opt-in (`E2E_ALLOW_REMOTE_ERP=1`, exactly) lets a run target a remote bench
 *    on purpose, and its cleanup then also deletes the ERP Projects the run created;
 *  - with no opt-in, cleanup behaves exactly as before (it must not gain bench DELETEs on local runs).
 *
 * Lives in `test/` (like `e2eSignIn.test.ts`) because the vitest projects exclude `e2e/**`; the
 * guard module itself sits beside the helpers it protects, in `e2e/serial/`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertLocalBenchUrl, isLocalBenchHost, remoteErpAllowed } from '../e2e/serial/_benchGuard';

const REMOTE_BENCH = 'https://erp.client.example.com:8080';

/** A SupabaseClient stand-in that absorbs every query chain and records the method names it saw. */
function fakeAdmin(): { admin: SupabaseClient; calls: string[] } {
  const calls: string[] = [];
  const proxy = new Proxy({}, {
    get: (_target, prop: string | symbol) => {
      if (prop === 'then') {
        return (onFulfilled: (value: unknown) => unknown) => Promise.resolve(onFulfilled({ data: [], error: null }));
      }
      return (..._args: unknown[]) => {
        calls.push(String(prop));
        return proxy;
      };
    },
  });
  return { admin: proxy as unknown as SupabaseClient, calls };
}

/** Stub `env` in, then hand back a FRESH module instance reading exactly that env. */
async function importHelpersWithEnv(env: Record<string, string>, moduleName: string) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import(moduleName);
}

const TSP = '../e2e/serial/_tspHelpers';
const BUD = '../e2e/serial/_budHelpers';
const SAR = '../e2e/serial/_sarHelpers';
const EXP = '../e2e/serial/_expHelpers';

/** fetch mock whose every response is an OK bench answer with an empty data payload. */
function okFetchMock(): ReturnType<typeof vi.fn<(url: string | URL, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>> {
  return vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }));
}

function deleteCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
    .map(([url]) => String(url));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('_benchGuard — local-host recognition', () => {
  it('accepts the plain local bench hosts', () => {
    expect(isLocalBenchHost('localhost')).toBe(true);
    expect(isLocalBenchHost('127.0.0.1')).toBe(true);
    expect(isLocalBenchHost('host.docker.internal')).toBe(true);
  });

  it('still recognises localhost written in IPv6, uppercase or root-qualified form', () => {
    expect(isLocalBenchHost('[::1]')).toBe(true);
    expect(isLocalBenchHost('::1')).toBe(true);
    expect(isLocalBenchHost('LOCALHOST')).toBe(true);
    expect(isLocalBenchHost('localhost.')).toBe(true);
    expect(assertLocalBenchUrl('http://[::1]:8080', {})).toBeUndefined();
    expect(assertLocalBenchUrl('http://LOCALHOST:8080', {})).toBeUndefined();
    expect(assertLocalBenchUrl('http://localhost.:8080', {})).toBeUndefined();
  });

  it('refuses non-local hosts', () => {
    expect(isLocalBenchHost('erp.client.example.com')).toBe(false);
    expect(isLocalBenchHost('10.1.2.3')).toBe(false);
    expect(isLocalBenchHost('localhost.attacker.example')).toBe(false);
    expect(isLocalBenchHost('')).toBe(false);
  });
});

describe('_benchGuard — the refusal', () => {
  it('refuses a remote bench host before anything else happens', () => {
    expect(() => assertLocalBenchUrl(REMOTE_BENCH, {})).toThrow(/refusing non-local ERP bench host/);
  });

  it('permits every local bench host with no opt-in', () => {
    for (const url of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', 'http://host.docker.internal:8080']) {
      expect(assertLocalBenchUrl(url, {})).toBeUndefined();
    }
  });

  it('permits a remote bench host only under the exact opt-in', () => {
    expect(assertLocalBenchUrl(REMOTE_BENCH, { E2E_ALLOW_REMOTE_ERP: '1' })).toBeUndefined();
    for (const notOne of ['true', 'yes', '0', '']) {
      expect(() => assertLocalBenchUrl(REMOTE_BENCH, { E2E_ALLOW_REMOTE_ERP: notOne })).toThrow(/refusing non-local ERP bench host/);
    }
  });

  it('refuses a bench value that does not even parse as a URL', () => {
    expect(() => assertLocalBenchUrl('not a url', {})).toThrow(/does not parse/);
  });

  it('reads the opt-in from the ambient process env', () => {
    expect(remoteErpAllowed()).toBe(false);
    vi.stubEnv('E2E_ALLOW_REMOTE_ERP', '1');
    expect(remoteErpAllowed()).toBe(true);
  });
});

describe('_benchGuard — the helpers actually consult the guard', () => {
  it('_tspHelpers bench fns refuse a remote bench without issuing any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const helpers = await importHelpersWithEnv({ ERPNEXT_BENCH_URL: REMOTE_BENCH }, TSP);
    await expect(helpers.benchPost('Project', { project_name: 'x' })).rejects.toThrow(/refusing non-local ERP bench host/);
    await expect(helpers.benchGet('/api/resource/Project')).rejects.toThrow(/refusing non-local ERP bench host/);
    await expect(helpers.benchPut('Project', 'PROJ-1', {})).rejects.toThrow(/refusing non-local ERP bench host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('_budHelpers bench fns refuse a remote bench without issuing any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bud = await importHelpersWithEnv({ ERPNEXT_BENCH_URL: REMOTE_BENCH }, BUD);
    await expect(bud.benchPost('Project', { project_name: 'x' })).rejects.toThrow(/refusing non-local ERP bench host/);
    await expect(bud.benchSubmit('Budget', 'BUD-1')).rejects.toThrow(/refusing non-local ERP bench host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('_sarHelpers seedSAR refuses a remote bench before any DB write or fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { admin, calls } = fakeAdmin();
    const sar = await importHelpersWithEnv({ ERPNEXT_SITE_URL: REMOTE_BENCH }, SAR);
    await expect(sar.seedSAR(admin, 'guardtest')).rejects.toThrow(/refusing non-local ERP bench host/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('the opt-in really lets the helpers write: _tspHelpers.benchPost reaches the bench', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { name: 'PROJ-1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const helpers = await importHelpersWithEnv({ ERPNEXT_BENCH_URL: REMOTE_BENCH, E2E_ALLOW_REMOTE_ERP: '1' }, TSP);
    await expect(helpers.benchPost('Project', { project_name: 'x' })).resolves.toEqual({ name: 'PROJ-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/resource/Project');
  });
});

describe('_benchGuard — opt-in cleanup deletes the ERP Projects the run created', () => {
  const tspSeed = {
    suffix: 'guardtest',
    projectAId: 'a', projectBId: 'b',
    erpProjectA: 'PROJ-A', erpProjectB: 'PROJ-B',
    employeeRowId: 'e',
    timesheetIds: [],
  };

  it('cleanupTsp deletes its ERP Projects only under the opt-in', async () => {
    const fetchMock = okFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const helpers = await importHelpersWithEnv({ E2E_ALLOW_REMOTE_ERP: '1' }, TSP);
    await helpers.cleanupTsp(fakeAdmin().admin, tspSeed);
    expect(deleteCalls(fetchMock)).toEqual([
      'http://localhost:8080/api/resource/Project/PROJ-A',
      'http://localhost:8080/api/resource/Project/PROJ-B',
    ]);
  });

  it('cleanupTsp without the opt-in keeps the old behaviour (no bench DELETEs)', async () => {
    const fetchMock = okFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const helpers = await importHelpersWithEnv({}, TSP);
    await helpers.cleanupTsp(fakeAdmin().admin, tspSeed);
    expect(deleteCalls(fetchMock)).toEqual([]);
  });

  it('cleanupBud deletes its ERP Project only under the opt-in', async () => {
    const fetchMock = okFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const bud = await importHelpersWithEnv({ E2E_ALLOW_REMOTE_ERP: '1' }, BUD);
    await bud.cleanupBud(fakeAdmin().admin, {
      suffix: 'guardtest', projectId: 'p', erpProject: 'PROJ-BUD',
      versionIds: [], prior: { categoryMap: [], binding: null },
    } as never);
    expect(deleteCalls(fetchMock)).toEqual(['http://localhost:8080/api/resource/Project/PROJ-BUD']);
  });

  it('cleanupExp deletes its ERP Project only under the opt-in', async () => {
    const fetchMock = okFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const exp = await importHelpersWithEnv({ E2E_ALLOW_REMOTE_ERP: '1' }, EXP);
    await exp.cleanupExp(fakeAdmin().admin, {
      projectId: 'p', erpProject: 'PROJ-EXP', employee: 'HR-EMP-00001', employeeRowId: 'e', previousBinding: null,
    }, []);
    expect(deleteCalls(fetchMock)).toEqual(['http://localhost:8080/api/resource/Project/PROJ-EXP']);
  });
});
