/**
 * AC-ENA-073/AC-EAC-116 — erpnext/binding.ts: the version handshake helpers (FR-ENA-012). The
 * ACTIVATION semantics used to live here too (`activateBinding`); they are the
 * `activate_external_binding` RPC's job now (migration 0216) — that twin was deleted with its tests
 * (review #650). What remains and is tested: the handshake parse + its budget, the supported-major
 * set, and the Company-defaults mapper consumed by `external-set-company`.
 *
 * AC-ENA-074 (task 8.8, #656) — the activation read-permission probe: the integration user must be able
 * to READ the doctypes of the org's owned domains + the ledgers, or the feed silently under-syncs (R13);
 * plus the probe's concurrency and total time budget. PMO RLS stays the user-facing authority.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertErpReadPermissions, fetchErpVersionMajor, companyDefaultsFromDoc,
  SUPPORTED_VERSION_MAJORS, ACTIVATION_STATEMENT_DOCTYPES, activationReadPermScope, probeActivationReadPermissions, type ReadPermScope,
  ACTIVATION_CALL_TIMEOUT_MS, ACTIVATION_PROBE_CONCURRENCY, ACTIVATION_PROBE_TOTAL_BUDGET_MS,
  parseStatementVersionProfile, fetchStatementVersionProfile,
} from './binding.ts';
import type { StatementVersionProfile } from './statementMetadata.ts';
import { DEFAULT_INVOKE_TIMEOUT_MS } from '../../supabase/invokeWithTimeout.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetchDeps(fetchImpl: (url: string) => Promise<Response>) {
  return vi.fn(fetchImpl) as unknown as typeof fetch;
}

describe('erpnext/binding', () => {
  it('AC-EAC-116 SUPPORTED_VERSION_MAJORS is exactly [15, 16] (DD-OPS-10: bench v15, RIS v16)', () => {
    expect([...SUPPORTED_VERSION_MAJORS]).toEqual([15, 16]);
  });

  it('AC-EAC-116 fetchErpVersionMajor is budget-bounded: a hung site aborts at the 5s handshake deadline', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const hanging = (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return; // no deadline wired → hangs forever (the RED state)
          if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        });
      const fetchImpl = vi.fn(hanging) as unknown as typeof fetch;
      const pending = fetchErpVersionMajor({
        fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com',
      });
      // Attach BOTH handlers before the clock moves: the deadline rejects `pending` inside
      // advanceTimersByTimeAsync, and a rejection nobody has subscribed to yet is an unhandled
      // rejection that fails the whole vitest run even though every assertion passes.
      pending.catch(() => undefined).finally(() => { settled = true; });
      const rejection = expect(pending).rejects.toMatchObject({ code: 'external-unreachable' });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      // The deadline is 5_000ms — NOT the client default (120s). The clock stops here, so the only
      // way the rejection can arrive is the 5s deadline (a missing one would leave this await hanging
      // until the test times out). A hung Company-selection activation cannot outwait the edge-fn budget.
      await rejection;
      expect(fetchImpl).toHaveBeenCalledTimes(1); // maxRetries 0 — the single attempt IS the budget
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-EAC-116 fetchErpVersionMajor does NOT retry a retryable handshake response (maxRetries 0)', async () => {
    const fetchImpl = fetchDeps(async () => jsonResponse(500, { exc_type: 'InternalServerError' }));
    await expect(
      fetchErpVersionMajor({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com' }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    // The default idempotent budget is 3 retries (4 attempts); the handshake gets exactly one.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('#655 fetchErpVersionMajor refuses a redirected handshake (never followed, not retried)', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 301, headers: { Location: 'https://elsewhere.example/' } })) as unknown as typeof fetch;
    await expect(
      fetchErpVersionMajor({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com' }),
    ).rejects.toMatchObject({ code: 'external-unreachable', status: 301 });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as RequestInit).redirect).toBe('manual');
  });

  it('AC-EAC-116 fetchErpVersionMajor parses the major from the handshake', async () => {
    for (const [version, major] of [['15.94.3', 15], ['16.33.0', 16], ['14.30.1', 14]] as const) {
      const fetchImpl = fetchDeps(async () => jsonResponse(200, { erpnext: { version } }));
      await expect(
        fetchErpVersionMajor({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com' }),
      ).resolves.toBe(major);
    }
  });

  it('AC-EAC-116 companyDefaultsFromDoc bounds each default to a 1-140-char string — anything else maps to null', () => {
    // ERPNext Link fields are <=140 chars; a longer, non-string, or empty value is never a usable
    // account default — it maps to null ("no default"), never a guessed or malformed account.
    expect(companyDefaultsFromDoc({
      default_payable_account: 42,
      default_cash_account: { name: 'Cash - A' },
      default_bank_account: ['Bank - A'], // an array HAS a 1-140 .length — only typeof 'string' keeps it out
      default_expense_account: '',
      cost_center: 'y'.repeat(200),
    }, 'ACME')).toEqual({
      company: 'ACME',
      default_payable_account: null,
      default_cash_account: null,
      default_bank_account: null,
      default_expense_account: null,
      cost_center: null,
    });
    // 140 is exactly the ERPNext Link limit — kept; 200 is over — null.
    expect(companyDefaultsFromDoc({ cost_center: 'y'.repeat(140) }, 'ACME').cost_center).toBe('y'.repeat(140));
  });

  it('AC-EAC-116 companyDefaultsFromDoc maps the five Company account defaults, null when absent', () => {
    expect(companyDefaultsFromDoc({ default_payable_account: 'Creditors - A' }, 'ACME')).toEqual({
      company: 'ACME',
      default_payable_account: 'Creditors - A',
      default_cash_account: null,
      default_bank_account: null,
      default_expense_account: null,
      cost_center: null,
    });
  });
});

describe('erpnext/binding — assertErpReadPermissions (AC-ENA-074, task 8.8, R13)', () => {
  const scope: ReadPermScope = {
    doctypes: ['Purchase Invoice', 'Payment Entry', 'Supplier'],
    reportNames: ['Accounts Payable'],
  };
  const client = { fetchImpl: undefined as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };

  function permFetch(responses: Array<(url: string) => Response | undefined>) {
    return fetchDeps(async (url) => {
      for (const r of responses) {
        const res = r(url);
        if (res) return res;
      }
      throw new Error(`unexpected URL ${url}`);
    });
  }

  it('AC-ENA-074 returns no failures when every doctype + report is readable', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Payment%20Entry?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Supplier?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Report/Accounts%20Payable') ? jsonResponse(200, { name: 'Accounts Payable' }) : undefined,
    ]);
    const failures = await assertErpReadPermissions({ ...client, fetchImpl }, scope);
    expect(failures).toEqual([]);
  });

  it('AC-ENA-074 returns EVERY doctype the user cannot read (401/403/404), not just the first — refuse activation naming them all', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(200, { data: [] }) : undefined,
      // Payment Entry: the integration user lacks read — Frappe returns 403 + an exc_type.
      (url) => url.includes('/api/resource/Payment%20Entry?') ? jsonResponse(403, { exc_type: 'PermissionError', _server_messages: '[]', message: 'Not permitted' }) : undefined,
      // The probe keeps going past a failure: Supplier is ALSO unreadable.
      (url) => url.includes('/api/resource/Supplier?') ? jsonResponse(401, { exc_type: 'AuthenticationError', message: 'Not allowed' }) : undefined,
      (url) => url.includes('/api/resource/Report/Accounts%20Payable') ? jsonResponse(200, { name: 'Accounts Payable' }) : undefined,
    ]);
    const failures = await assertErpReadPermissions({ ...client, fetchImpl }, scope);
    expect(failures.map((f) => [f.kind, f.name])).toEqual([['doctype', 'Payment Entry'], ['doctype', 'Supplier']]);
    expect(failures[0].error).toMatch(/PermissionError|Not permitted|403/);
  });

  it('AC-ENA-074 returns a report failure when an aging report is not readable', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Payment%20Entry?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Supplier?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Report/Accounts%20Payable') ? jsonResponse(404, { exc_type: 'DoesNotExistError', message: 'Report not found' }) : undefined,
    ]);
    const failures = await assertErpReadPermissions({ ...client, fetchImpl }, scope);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ kind: 'report', name: 'Accounts Payable' });
  });

  it('#656 an unreachable site (5xx) is NOT reported as a missing permission — it throws external-unreachable', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(503, { exc_type: 'ServiceUnavailable' }) : undefined,
    ]);
    await expect(assertErpReadPermissions({ ...client, fetchImpl, maxRetries: 0 }, scope))
      .rejects.toMatchObject({ code: 'external-unreachable' });
  });

  it('#656 each doctype probe lists at most ONE row (limit_page_length=0 would mean "every row" in Frappe)', async () => {
    const fetchImpl = fetchDeps(async () => jsonResponse(200, { data: [] }));
    await assertErpReadPermissions({ ...client, fetchImpl }, { doctypes: ['GL Entry'] });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('limit_page_length')).toBe('1');
  });
});

describe('erpnext/binding — the activation read-permission scope + budget (#656)', () => {
  it('probes the owned domains\' doctypes (deduped) plus the two ledgers the sweep always reads — never unowned ones, never reports', () => {
    const scope = activationReadPermScope(['procurement']);
    expect(scope.doctypes).toEqual(expect.arrayContaining([
      'Material Request', 'Request for Quotation', 'Supplier Quotation', 'Purchase Order', 'Purchase Receipt',
      'Purchase Invoice', 'Payment Entry', 'GL Entry', 'Payment Ledger Entry',
    ]));
    expect(scope.doctypes).not.toContain('Timesheet');
    expect(scope.doctypes).not.toContain('Employee');
    expect(scope.doctypes).not.toContain('Sales Invoice');
    expect(new Set(scope.doctypes).size).toBe(scope.doctypes.length);
    expect(scope.reportNames ?? []).toEqual([]);
  });

  it('Payment Entry (shared by two kinds) is probed once when both money domains are owned', () => {
    const scope = activationReadPermScope(['procurement', 'revenue']);
    expect(scope.doctypes.filter((d) => d === 'Payment Entry')).toHaveLength(1);
  });

  it('pins the exact statement-related activation permission set', () => {
    expect(ACTIVATION_STATEMENT_DOCTYPES).toEqual([
      'Company', 'Accounts Settings', 'Currency', 'Finance Book', 'Fiscal Year',
    ]);
    const scope = activationReadPermScope([]).doctypes;
    expect(scope).toEqual(expect.arrayContaining(['GL Entry', 'Payment Ledger Entry', 'Account', ...ACTIVATION_STATEMENT_DOCTYPES]));
    expect(scope).not.toContain('System Settings');
  });

  it('probeActivationReadPermissions uses the handshake budget: a retryable 503 gets ONE attempt per probe', async () => {
    const fetchImpl = fetchDeps(async () => jsonResponse(503, { exc_type: 'ServiceUnavailable' }));
    await expect(probeActivationReadPermissions({
      fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', ownedDomains: [],
    })).rejects.toMatchObject({ code: 'external-unreachable' });
    // Source and ledger probes are individually single-attempt; the first failed batch is aborted.
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => new URL(c[0] as string).pathname);
    expect(urls).toEqual(expect.arrayContaining(['/api/resource/GL%20Entry', '/api/resource/Payment%20Ledger%20Entry', '/api/resource/Account', '/api/resource/Company']));
  });

  it('probeActivationReadPermissions uses the handshake budget: a hung probe aborts at 5s', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
      })) as unknown as typeof fetch;
      const pending = probeActivationReadPermissions({
        fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', ownedDomains: [],
      });
      pending.catch(() => undefined).finally(() => { settled = true; });
      const rejection = expect(pending).rejects.toMatchObject({ code: 'external-unreachable' });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      // The clock stops at 5s: only the per-call deadline can produce this rejection.
      await rejection;
      // A failed request aborts the in-flight batch; none of its calls is retried.
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

// #656 security review — the probe must finish (or give up) before the browser does, so the Admin never
// sees "failed" while the server goes on to activate.
describe('erpnext/binding — the activation probe time budget (#656)', () => {
  /** A fetch whose every answer takes `ms` (honouring abort), tracking how many are in flight at once. */
  function slowFetch(ms: number) {
    const stats = { inFlight: 0, maxInFlight: 0, aborted: 0 };
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      let done = false;
      const t = setTimeout(() => { done = true; stats.inFlight -= 1; resolve(jsonResponse(200, { data: [] })); }, ms);
      init?.signal?.addEventListener('abort', () => {
        if (done) return;
        done = true; clearTimeout(t); stats.inFlight -= 1; stats.aborted += 1; reject(init.signal?.reason ?? new Error('aborted'));
      });
    })) as unknown as typeof fetch;
    return { fetchImpl, stats };
  }

  it('Company lookup + handshake + the whole probe fit inside the browser\'s invoke timeout, with margin', () => {
    // Worst case: Company lookup and handshake each burn their full per-call deadline, then the probe
    // burns its full total budget. The remaining margin covers the database round trips.
    const worstCase = 2 * ACTIVATION_CALL_TIMEOUT_MS + ACTIVATION_PROBE_TOTAL_BUDGET_MS;
    expect(DEFAULT_INVOKE_TIMEOUT_MS - worstCase).toBeGreaterThanOrEqual(2_000);
  });

  it('runs probes concurrently, never more than the concurrency limit at once', async () => {
    const { fetchImpl, stats } = slowFetch(10);
    const failures = await probeActivationReadPermissions({
      fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', ownedDomains: ['procurement'],
    });
    expect(failures).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(activationReadPermScope(['procurement']).doctypes.length);
    expect(stats.maxInFlight).toBe(ACTIVATION_PROBE_CONCURRENCY);
  });

  it('a slow site exceeds the total budget → external-unreachable at the cap, and in-flight probes are aborted', async () => {
    vi.useFakeTimers();
    try {
      // Each probe answers inside its own 5s deadline, but 9 of them, 4 at a time, need ~3 rounds.
      const { fetchImpl, stats } = slowFetch(3_000);
      let settled = false;
      const pending = probeActivationReadPermissions({
        fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', ownedDomains: ['procurement'],
      });
      pending.catch(() => undefined).finally(() => { settled = true; });
      const rejection = expect(pending).rejects.toMatchObject({ code: 'external-unreachable' });

      await vi.advanceTimersByTimeAsync(ACTIVATION_PROBE_TOTAL_BUDGET_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      // The clock stops at the cap (the third round would need 9s): only the total budget can reject here.
      await rejection;
      expect(stats.aborted).toBeGreaterThan(0);
      expect(stats.inFlight).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('erpnext/binding — strict statement version profile handshake', () => {
  const directProfile = { erpnext: { version: '16.33.0' }, frappe: { version: '16.31.0' } };
  const expectedProfile = { erpVersion: '16.33.0', frappeVersion: '16.31.0' };

  function failureOf(body: unknown): unknown {
    try {
      parseStatementVersionProfile(body);
    } catch (error) {
      return error;
    }
    throw new Error('expected version profile parsing to reject');
  }

  it('parses exactly the two supported versions from direct or message app maps and ignores unrelated metadata', () => {
    expect(parseStatementVersionProfile({
      ...directProfile,
      erpnext: { version: '16.33.0', title: { ignored: true }, branch: 7 },
      frappe: { version: '16.31.0', commit: ['ignored'] },
      unused_app: null,
      python_version: { ignored: true },
    })).toEqual(expectedProfile);
    expect(parseStatementVersionProfile({
      message: {
        ...directProfile,
        custom_app: ['ignored'],
        installed_apps: 'unused framework value',
      },
      framework_version: false,
    })).toEqual(expectedProfile);
  });

  it('rejects malformed consumed maps and inherited required properties with static safe errors', () => {
    const inheritedVersion = Object.create({ version: '16.33.0' }) as object;
    const inheritedErpnext = Object.create({ erpnext: { version: '16.33.0' }, frappe: { version: '16.31.0' } }) as object;
    const cases: Array<[string, unknown]> = [
      ['null body', null], ['array body', []], ['scalar body', 'synthetic-canary-scalar'],
      ['error-shaped body', { exc_type: 'synthetic-canary-error', message: 'synthetic-canary-detail' }],
      ['data fallback is not accepted', { data: directProfile }],
      ['nested message wrapper is not traversed', { message: { message: directProfile } }],
      ['missing erpnext', { frappe: { version: '16.31.0' } }],
      ['missing frappe', { erpnext: { version: '16.33.0' } }],
      ['null app', { erpnext: null, frappe: { version: '16.31.0' } }],
      ['array app', { erpnext: [], frappe: { version: '16.31.0' } }],
      ['missing version', { erpnext: {}, frappe: { version: '16.31.0' } }],
      ['null version', { erpnext: { version: null }, frappe: { version: '16.31.0' } }],
      ['numeric version', { erpnext: { version: 16.33 }, frappe: { version: '16.31.0' } }],
      ['blank version', { erpnext: { version: '' }, frappe: { version: '16.31.0' } }],
      ['whitespace-only version', { erpnext: { version: '   ' }, frappe: { version: '16.31.0' } }],
      ['inherited version', { erpnext: inheritedVersion, frappe: { version: '16.31.0' } }],
      ['inherited app keys', inheritedErpnext],
      ['partial wrapped map', { message: { frappe: { version: '16.31.0' } } }],
    ];
    for (const [label, body] of cases) {
      const error = failureOf(body) as Error & { code?: string; details?: string };
      expect(error, label).toMatchObject({ name: 'AppError', code: 'commit-rejected', message: 'Malformed statement version profile response' });
      expect(`${error.message} ${error.details ?? ''} ${String(error)} ${JSON.stringify(error)}`).not.toMatch(/synthetic-canary/);
    }
  });

  it('rejects ambiguous direct and message maps even when matching, and never reveals either payload', () => {
    const cases = [
      ...['16.31.0', 'synthetic-canary-conflict'].map((wrappedFrappeVersion) => ({
        erpnext: { version: '16.33.0' },
        frappe: { version: '16.31.0' },
        message: { erpnext: { version: '16.33.0' }, frappe: { version: wrappedFrappeVersion } },
        marker: 'synthetic-canary-envelope',
      })),
      { erpnext: { version: '16.33.0' }, message: { frappe: { version: '16.31.0' } }, marker: 'synthetic-canary-matching-partial' },
    ];

    for (const body of cases) {
      const error = failureOf(body) as Error & { code?: string; details?: string };
      expect(error).toMatchObject({ name: 'AppError', code: 'commit-rejected', message: 'Ambiguous statement version profile response' });
      expect(`${error.message} ${error.details ?? ''} ${String(error)} ${JSON.stringify(error)}`).not.toMatch(/synthetic-canary/);
    }
  });

  it('rejects every non-exact but well-shaped version pair as unsupported without exposing values', () => {
    const pairs = [
      ['16.32.0', '16.31.0'], ['16.33.0', '16.30.0'], ['17.33.0', '17.31.0'],
      ['16.33', '16.31.0'], ['16.33.0.1', '16.31.0'], [' 16.33.0', '16.31.0'],
      ['16.33.0 ', '16.31.0'], ['16.33.0-beta.1', '16.31.0'], ['16.33.0+build', '16.31.0'],
    ];
    for (const [erpVersion, frappeVersion] of pairs) {
      const body = { erpnext: { version: erpVersion }, frappe: { version: frappeVersion }, marker: 'synthetic-canary-version' };
      const error = failureOf(body) as Error & { code?: string; details?: string };
      expect(error).toMatchObject({ name: 'AppError', code: 'config-rejected', message: 'Unsupported statement version profile' });
      expect(`${error.message} ${error.details ?? ''} ${String(error)} ${JSON.stringify(error)}`).not.toMatch(/synthetic-canary/);
    }
  });

  it('fetches the ordinary RPC once through the shared client with auth, manual redirect, no body, and a copied bounded client', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { message: directProfile })) as unknown as typeof fetch;
    const rateLimiter = { acquire: vi.fn(async () => {}) };
    const deps = {
      fetchImpl, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: 'https://erp.example.com',
      maxRetries: 4, timeoutMs: 9_000, sleep: vi.fn(async () => {}), rateLimiter,
    };
    const unchanged = { ...deps };
    const profile: StatementVersionProfile = await fetchStatementVersionProfile(deps);
    expect(profile).toEqual(expectedProfile);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(url).toBe('https://erp.example.com/api/method/frappe.utils.change_log.get_versions');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).Authorization).toBe('token synthetic-key:synthetic-secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(rateLimiter.acquire).toHaveBeenCalledTimes(1);
    expect(deps).toEqual(unchanged);
    const metadataProfile: StatementVersionProfile = profile;
    expect(metadataProfile).toBe(profile);
  });

  it('uses the smaller positive caller deadline, preserving rate limiter and client dependencies', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      })) as unknown as typeof fetch;
      const deps = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com', timeoutMs: 1_250, maxRetries: 8 };
      const pending = fetchStatementVersionProfile(deps);
      let settled = false;
      let outcome: unknown;
      const observed = pending.then(
        () => { settled = true; outcome = { resolvedUnexpectedly: true }; },
        (error: unknown) => { settled = true; outcome = error; },
      );
      await vi.advanceTimersByTimeAsync(1_249);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await observed;
      expect(outcome).toMatchObject({ name: 'ErpError', code: 'external-unreachable', status: 0 });
      expect(deps.timeoutMs).toBe(1_250);
      expect(deps.maxRetries).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a hanging request at the 5-second default deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      })) as unknown as typeof fetch;
      const pending = fetchStatementVersionProfile({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' });
      let settled = false;
      let outcome: unknown;
      const observed = pending.then(
        () => { settled = true; outcome = { resolvedUnexpectedly: true }; },
        (error: unknown) => { settled = true; outcome = error; },
      );
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await observed;
      expect(outcome).toMatchObject({ code: 'external-unreachable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry HTTP throttles, server failures, redirects, or network failures and returns safe classified errors', async () => {
    const cases: Array<{ response?: Response; failure?: Error; expected: Record<string, unknown> }> = [
      { response: jsonResponse(429, { message: 'synthetic-canary-http' }), expected: { code: 'external-unreachable', status: 429, retryable: true } },
      { response: jsonResponse(403, { message: 'synthetic-canary-forbidden' }), expected: { code: 'commit-rejected', status: 403, retryable: true } },
      { response: jsonResponse(503, { exception: 'synthetic-canary-upstream' }), expected: { code: 'external-unreachable', status: 503, retryable: true } },
      { response: new Response(null, { status: 302, headers: { Location: 'https://other.example/' } }), expected: { code: 'external-unreachable', status: 302, retryable: false } },
      { failure: new Error('synthetic-canary-network'), expected: { code: 'external-unreachable', status: 0, retryable: true } },
    ];
    for (const testCase of cases) {
      const fetchImpl = vi.fn(async () => {
        if (testCase.failure) throw testCase.failure;
        return testCase.response!;
      }) as unknown as typeof fetch;
      const deps = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com', maxRetries: 7, sleep: vi.fn(async () => {}) };
      let caught: (Error & { code?: string; status?: number; retryable?: boolean; details?: string }) | undefined;
      try { await fetchStatementVersionProfile(deps); } catch (error) { caught = error as typeof caught; }
      expect(caught).toMatchObject({ name: 'ErpError', message: 'ERPNext version handshake failed', ...testCase.expected });
      expect(`${caught?.message} ${caught?.details ?? ''} ${String(caught)} ${JSON.stringify(caught)}`).not.toMatch(/synthetic-canary/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(deps.sleep).not.toHaveBeenCalled();
    }
  });

  it('keeps malformed HTTP-200 payload errors distinct and safe from transport wrapping', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { message: 'synthetic-canary-malformed' })) as unknown as typeof fetch;
    await expect(fetchStatementVersionProfile({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' }))
      .rejects.toMatchObject({ name: 'AppError', code: 'commit-rejected', message: 'Malformed statement version profile response' });
  });

  it('rejects nonsensical caller deadlines safely without issuing a request', async () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '500'] as unknown[]) {
      const fetchImpl = vi.fn(async () => jsonResponse(200, directProfile)) as unknown as typeof fetch;
      await expect(fetchStatementVersionProfile({
        fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com', timeoutMs,
      } as never)).rejects.toMatchObject({ name: 'AppError', code: 'config-rejected', message: 'Invalid statement version handshake deadline' });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});
