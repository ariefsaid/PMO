/**
 * AC-ENA-073/AC-EAC-116 — erpnext/binding.ts: the version handshake helpers (FR-ENA-012). The
 * ACTIVATION semantics used to live here too (`activateBinding`); they are the
 * `activate_external_binding` RPC's job now (migration 0216) — that twin was deleted with its tests
 * (review #650). What remains and is tested: the handshake parse + its budget, the supported-major
 * set, and the Company-defaults mapper consumed by `external-set-company`.
 *
 * AC-ENA-084 (task 8.8) — `assertErpReadPermissions`: the integration user must have full READ perms
 * on the flipped doctypes + aging reports, or the feed silently under-syncs (R13). PMO RLS stays the
 * user-facing authority.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertErpReadPermissions, fetchErpVersionMajor, companyDefaultsFromDoc,
  SUPPORTED_VERSION_MAJORS, type ReadPermScope,
} from './binding.ts';

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
      }).finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(5_000);

      // The deadline is 5_000ms — NOT the client default (120s), so the handshake must already
      // be settled here. A hung Company-selection activation cannot outwait the edge-fn budget.
      expect(settled).toBe(true);
      await expect(pending).rejects.toMatchObject({ code: 'external-unreachable' });
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
      default_bank_account: '',
      default_expense_account: 'x'.repeat(200),
      cost_center: 'y'.repeat(140),
    }, 'ACME')).toEqual({
      company: 'ACME',
      default_payable_account: null,
      default_cash_account: null,
      default_bank_account: null,
      default_expense_account: null,
      cost_center: 'y'.repeat(140), // the 140-char boundary is exactly the ERPNext Link limit — kept
    });
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

describe('erpnext/binding — assertErpReadPermissions (AC-ENA-084, task 8.8, R13)', () => {
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

  it('AC-ENA-084 returns null when every doctype + report is readable', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Payment%20Entry?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Supplier?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Report/Accounts%20Payable') ? jsonResponse(200, { name: 'Accounts Payable' }) : undefined,
    ]);
    const failure = await assertErpReadPermissions({ ...client, fetchImpl }, scope);
    expect(failure).toBeNull();
  });

  it('AC-ENA-084 returns the FIRST doctype failure (a 403 ⇒ the user lacks read perm; refuse activation)', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(200, { data: [] }) : undefined,
      // Payment Entry: the integration user lacks read — Frappe returns 403 + an exc_type.
      (url) => url.includes('/api/resource/Payment%20Entry?') ? jsonResponse(403, { exc_type: 'PermissionError', _server_messages: '[]', message: 'Not permitted' }) : undefined,
    ]);
    const failure = await assertErpReadPermissions({ ...client, fetchImpl }, scope);
    expect(failure).not.toBeNull();
    expect(failure).toMatchObject({ kind: 'doctype', name: 'Payment Entry' });
    expect(failure!.error).toMatch(/PermissionError|Not permitted|403/);
  });

  it('AC-ENA-084 returns a report failure when an aging report is not readable', async () => {
    const fetchImpl = permFetch([
      (url) => url.includes('/api/resource/Purchase%20Invoice?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Payment%20Entry?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Supplier?') ? jsonResponse(200, { data: [] }) : undefined,
      (url) => url.includes('/api/resource/Report/Accounts%20Payable') ? jsonResponse(404, { exc_type: 'DoesNotExistError', message: 'Report not found' }) : undefined,
    ]);
    const failure = await assertErpReadPermissions({ ...client, fetchImpl }, scope);
    expect(failure).not.toBeNull();
    expect(failure).toMatchObject({ kind: 'report', name: 'Accounts Payable' });
  });
});
