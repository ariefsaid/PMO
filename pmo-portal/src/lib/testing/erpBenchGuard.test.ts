// Unit tests for the #1359 ERPNext bench guard every ERPNext-writing serial e2e helper/spec routes
// its bench URL through (src/lib/testing/erpBenchGuard.ts). No bench, dev server or DB is needed.
//
// #1359: the serial e2e helpers create ERPNext Projects directly at ERPNEXT_BENCH_URL. A run pointed
// at a real ERPNext used to leave PMO-E2E-* Projects behind (cleanup only removed the PMO side), so
// the guard refuses any non-local bench host unless E2E_ALLOW_REMOTE_ERP=1 is explicitly set — and
// when it is, cleanup also deletes the ERP Projects the helpers created (tracked here at seed time).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BENCH_URL_VAR,
  E2E_ALLOW_REMOTE_ERP,
  SITE_URL_VAR,
  benchAuthHeaders,
  benchUrl,
  benchUrlOrEmpty,
  deleteErpProject,
  deleteTrackedErpProjects,
  forgetErpProjects,
  guardBenchUrl,
  isLocalBenchHost,
  siteUrl,
  siteUrlOrEmpty,
  trackErpProject,
  trackedErpProjects,
} from './erpBenchGuard';

const MANAGED_ENV_KEYS = [
  BENCH_URL_VAR,
  SITE_URL_VAR,
  'ERPNEXT_BENCH_API_KEY',
  'ERPNEXT_BENCH_API_SECRET',
  E2E_ALLOW_REMOTE_ERP,
];

let savedEnv: Array<[string, string | undefined]>;
let savedFetch: typeof globalThis.fetch;

function stubFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);
  globalThis.fetch = mock as unknown as typeof globalThis.fetch;
  return mock;
}

beforeEach(() => {
  savedEnv = MANAGED_ENV_KEYS.map((key) => [key, process.env[key]] as [string, string | undefined]);
  savedFetch = globalThis.fetch;
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
  forgetErpProjects();
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = savedFetch;
  forgetErpProjects();
});

describe('guardBenchUrl (#1359)', () => {
  it('passes the local bench hosts through verbatim: localhost / 127.0.0.1 / host.docker.internal', () => {
    for (const url of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://HOST.DOCKER.INTERNAL:8080']) {
      expect(guardBenchUrl(url), url).toBe(url);
    }
    expect(isLocalBenchHost(new URL('http://localhost:8080').hostname)).toBe(true);
    expect(isLocalBenchHost(new URL('http://127.0.0.1:8080').hostname)).toBe(true);
    expect(isLocalBenchHost(new URL('http://host.docker.internal:8080').hostname)).toBe(true);
    expect(isLocalBenchHost(new URL('http://erp.example.com').hostname)).toBe(false);
  });

  it('accepts IPv6 loopback [::1] as local (N1 — the WHATWG parser keeps the brackets)', () => {
    expect(guardBenchUrl('http://[::1]:8080')).toBe('http://[::1]:8080');
    expect(isLocalBenchHost(new URL('http://[::1]:8080').hostname)).toBe(true);
    // a remote IPv6 host stays refused — only loopback is local
    expect(() => guardBenchUrl('http://[2001:db8::1]:8080')).toThrowError(/E2E_ALLOW_REMOTE_ERP/);
  });

  it('falls back to the local default when the env var is unset', () => {
    expect(benchUrl()).toBe('http://localhost:8080');
    expect(siteUrl()).toBe('http://host.docker.internal:8080');
  });

  it('returns the empty string for an unset/empty URL (specs that skip when no bench is configured)', () => {
    expect(guardBenchUrl(undefined)).toBe('');
    expect(guardBenchUrl('')).toBe('');
    expect(guardBenchUrl('   ')).toBe('');
  });

  it('siteUrlOrEmpty keeps the no-bench skip while still guarding a configured site URL', () => {
    expect(siteUrlOrEmpty()).toBe('');
    process.env[SITE_URL_VAR] = 'http://host.docker.internal:8080';
    expect(siteUrlOrEmpty()).toBe('http://host.docker.internal:8080');
    process.env[SITE_URL_VAR] = 'http://erp.example.com:8080';
    expect(() => siteUrlOrEmpty()).toThrowError(/ERPNEXT_SITE_URL/);
  });

  it('benchUrlOrEmpty keeps the no-bench skip while still guarding a configured bench URL', () => {
    expect(benchUrlOrEmpty()).toBe('');
    process.env[BENCH_URL_VAR] = 'http://localhost:8080';
    expect(benchUrlOrEmpty()).toBe('http://localhost:8080');
    process.env[BENCH_URL_VAR] = 'http://erp.example.com:8080';
    expect(() => benchUrlOrEmpty()).toThrowError(/ERPNEXT_BENCH_URL/);
  });

  it('benchAuthHeaders is the single source of the bench token header', () => {
    expect(benchAuthHeaders()).toEqual({ Authorization: 'token :' });
    process.env.ERPNEXT_BENCH_API_KEY = 'test-key';
    process.env.ERPNEXT_BENCH_API_SECRET = 'test-secret';
    expect(benchAuthHeaders()).toEqual({ Authorization: 'token test-key:test-secret' });
  });

  it('refuses a remote bench host, naming the variable and the opt-in', () => {
    process.env[BENCH_URL_VAR] = 'http://erp.example.com:8080';
    expect(() => benchUrl()).toThrowError(/ERPNEXT_BENCH_URL/);
    expect(() => benchUrl()).toThrowError(/E2E_ALLOW_REMOTE_ERP/);
    expect(() => guardBenchUrl('https://erp.example.com')).toThrowError(/erp\.example\.com/);
  });

  it('refuses a remote ERPNEXT_SITE_URL too — the served functions write to the same bench', () => {
    process.env[SITE_URL_VAR] = 'http://erp.example.com:8080';
    expect(() => siteUrl()).toThrowError(/ERPNEXT_SITE_URL/);
    expect(() => siteUrl()).toThrowError(/E2E_ALLOW_REMOTE_ERP/);
  });

  it('refuses a value that is not a URL at all', () => {
    expect(() => guardBenchUrl('not a url')).toThrowError(/not a valid URL/);
  });

  it('lets a remote host through only under the explicit opt-in', () => {
    process.env[BENCH_URL_VAR] = 'http://erp.example.com:8080';
    expect(() => benchUrl()).toThrowError(/E2E_ALLOW_REMOTE_ERP/);

    process.env[E2E_ALLOW_REMOTE_ERP] = '1';
    expect(benchUrl()).toBe('http://erp.example.com:8080');
    // the opt-in never weakens the local pass-through
    process.env[BENCH_URL_VAR] = 'http://localhost:8080';
    expect(benchUrl()).toBe('http://localhost:8080');
  });

  it('treats any opt-in value other than "1" as NOT opted in', () => {
    process.env[BENCH_URL_VAR] = 'http://erp.example.com:8080';
    for (const value of ['0', 'true', 'yes', '']) {
      process.env[E2E_ALLOW_REMOTE_ERP] = value;
      expect(() => benchUrl(), `opt-in value ${JSON.stringify(value)} must not unlock a remote bench`).toThrowError(
        /E2E_ALLOW_REMOTE_ERP/,
      );
    }
  });
});

describe('ERP Project tracking + opted-in cleanup (#1359)', () => {
  it('tracks every project the helpers create, in order', () => {
    expect(trackedErpProjects()).toEqual([]);
    trackErpProject('PROJ-0001');
    trackErpProject('PROJ-0002');
    trackErpProject('PROJ-0001'); // a re-seed must not double-track
    expect(trackedErpProjects()).toEqual(['PROJ-0001', 'PROJ-0002']);
  });

  it('when opted in, cleanup DELETEs every tracked Project over the bench REST API and clears the ledger', async () => {
    process.env[BENCH_URL_VAR] = 'http://127.0.0.1:8080';
    process.env.ERPNEXT_BENCH_API_KEY = 'test-key';
    process.env.ERPNEXT_BENCH_API_SECRET = 'test-secret';
    process.env[E2E_ALLOW_REMOTE_ERP] = '1';
    const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));
    trackErpProject('PROJ-0001');
    trackErpProject('PROJ-0002');

    const result = await deleteTrackedErpProjects();

    expect(result.deleted).toEqual(['PROJ-0001', 'PROJ-0002']);
    expect(result.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/api/resource/Project/PROJ-0001');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('DELETE');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: 'token test-key:test-secret',
    });
    expect(trackedErpProjects()).toEqual([]);
  });

  it('without the opt-in, cleanup deletes nothing (and still clears the per-run ledger)', async () => {
    process.env[BENCH_URL_VAR] = 'http://erp.example.com:8080';
    const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));
    trackErpProject('PROJ-0003');

    const result = await deleteTrackedErpProjects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(trackedErpProjects()).toEqual([]);
  });

  it('collects per-project failures instead of throwing — teardown must never mask the test result', async () => {
    process.env[BENCH_URL_VAR] = 'http://localhost:8080';
    process.env[E2E_ALLOW_REMOTE_ERP] = '1';
    stubFetch(async (input) => {
      const url = String(input);
      return url.endsWith('/PROJ-BAD')
        ? new Response('blocked by links', { status: 403 })
        : new Response('{}', { status: 200 });
    });
    trackErpProject('PROJ-OK');
    trackErpProject('PROJ-BAD');

    const result = await deleteTrackedErpProjects();

    expect(result.deleted).toEqual(['PROJ-OK']);
    expect(result.failed).toEqual(['PROJ-BAD']);
  });

  it('deleteErpProject URL-encodes the document name', async () => {
    process.env[BENCH_URL_VAR] = 'http://localhost:8080';
    process.env[E2E_ALLOW_REMOTE_ERP] = '1';
    const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));
    await deleteErpProject('PROJ 009');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/api/resource/Project/PROJ%20009');
  });
});
