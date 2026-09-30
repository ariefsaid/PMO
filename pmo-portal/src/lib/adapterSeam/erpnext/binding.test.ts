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
  SUPPORTED_VERSION_MAJORS, activationReadPermScope, probeActivationReadPermissions, type ReadPermScope,
  ACTIVATION_CALL_TIMEOUT_MS, ACTIVATION_PROBE_CONCURRENCY, ACTIVATION_PROBE_TOTAL_BUDGET_MS,
} from './binding.ts';
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

  it('an org that owns no domain yet still probes the ledgers (the sweep reads them for every activated org)', () => {
    expect(activationReadPermScope([]).doctypes).toEqual(['GL Entry', 'Payment Ledger Entry']);
  });

  it('probeActivationReadPermissions uses the handshake budget: a retryable 503 gets ONE attempt per probe', async () => {
    const fetchImpl = fetchDeps(async () => jsonResponse(503, { exc_type: 'ServiceUnavailable' }));
    await expect(probeActivationReadPermissions({
      fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', ownedDomains: [],
    })).rejects.toMatchObject({ code: 'external-unreachable' });
    // The two ledger probes run concurrently; neither is retried.
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => new URL(c[0] as string).pathname);
    expect(urls.sort()).toEqual(['/api/resource/GL%20Entry', '/api/resource/Payment%20Ledger%20Entry']);
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
      // One attempt per probe: the two ledger probes, never a retry of either.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
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
