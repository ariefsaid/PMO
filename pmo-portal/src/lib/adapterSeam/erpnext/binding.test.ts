/**
 * AC-ENA-073 — erpnext/binding.ts: the v15 version handshake gates activation (FR-ENA-012). A
 * matched `version_major` fills `config` from one `GET Company/<name>` (R9 §6.2); a mismatch leaves
 * `activatedAt` null (money commands are refused as config-rejected by the dispatch factory, 2.13).
 *
 * AC-ENA-084 (task 8.8) — `assertErpReadPermissions`: the integration user must have full READ perms
 * on the flipped doctypes + aging reports, or the feed silently under-syncs (R13). A probe at
 * activation; a failure refuses activation (warn). PMO RLS stays the user-facing authority.
 */
import { describe, expect, it, vi } from 'vitest';
import { activateBinding, assertErpReadPermissions, type ReadPermScope } from './binding.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetchDeps(fetchImpl: (url: string) => Promise<Response>) {
  return vi.fn(fetchImpl) as unknown as typeof fetch;
}

describe('erpnext/binding', () => {
  it('AC-ENA-073 a v15 handshake activates the binding and fills config from one GET Company/<name>', async () => {
    const fetchImpl = fetchDeps(async (url) => {
      if (url.includes('/api/method/frappe.utils.change_log.get_versions')) {
        return jsonResponse(200, { erpnext: { version: '15.94.3' } });
      }
      if (url.includes('/api/resource/Company/PMO%20Smoke%20Co')) {
        return jsonResponse(200, {
          name: 'PMO Smoke Co',
          default_payable_account: 'Creditors - PSC',
          default_cash_account: 'Cash - PSC',
          default_bank_account: null,
          default_expense_account: 'Cost of Goods Sold - PSC',
          cost_center: 'Main - PSC',
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const result = await activateBinding(
      { fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co' },
      () => '2026-07-11T00:00:00.000Z',
    );

    expect(result.versionMajor).toBe(15);
    expect(result.activatedAt).toBe('2026-07-11T00:00:00.000Z');
    expect(result.config).toMatchObject({
      company: 'PMO Smoke Co',
      default_payable_account: 'Creditors - PSC',
      default_cash_account: 'Cash - PSC',
      default_bank_account: null,
      default_expense_account: 'Cost of Goods Sold - PSC',
      cost_center: 'Main - PSC',
    });
  });

  it('AC-ENA-073 a v16 handshake leaves the binding un-activated (activatedAt stays null)', async () => {
    const fetchImpl = fetchDeps(async () => jsonResponse(200, { erpnext: { version: '16.2.0' } }));
    const result = await activateBinding({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co' });
    expect(result.versionMajor).toBe(16);
    expect(result.activatedAt).toBeNull();
  });

  it('AC-ENA-073 a v14 handshake leaves the binding un-activated (activatedAt stays null)', async () => {
    const fetchImpl = fetchDeps(async () => jsonResponse(200, { erpnext: { version: '14.30.1' } }));
    const result = await activateBinding({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co' });
    expect(result.versionMajor).toBe(14);
    expect(result.activatedAt).toBeNull();
  });

  it('AC-ENA-073 a version mismatch never fetches Company defaults (config stays empty)', async () => {
    const fetchImpl = fetchDeps(async (url) => {
      if (url.includes('get_versions')) return jsonResponse(200, { erpnext: { version: '16.2.0' } });
      throw new Error(`unexpected fetch to ${url} — Company defaults must not be fetched on a version mismatch`);
    });
    const result = await activateBinding({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co' });
    expect(result.config).toEqual({});
  });
});

describe('erpnext/binding — assertErpReadPermissions (AC-ENA-084, task 8.8, R13)', () => {
  const scope: ReadPermScope = {
    doctypes: ['Purchase Invoice', 'Payment Entry', 'Supplier'],
    reportNames: ['Accounts Payable'],
  };
  const client = { fetchImpl: undefined as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };

  function permFetch(responses: Array<(url: string) => Response | undefined>) {
    return fetchDeps((url) => {
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

  it('AC-ENA-084 activateBinding refuses activation (activatedAt null) when the read-perm probe fails', async () => {
    const fetchImpl = fetchDeps((url) => {
      if (url.includes('get_versions')) return jsonResponse(200, { erpnext: { version: '15.94.3' } });
      if (url.includes('/api/resource/Company/PMO%20Smoke%20Co')) return jsonResponse(200, { name: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' });
      if (url.includes('/api/resource/Purchase%20Invoice?')) return jsonResponse(403, { exc_type: 'PermissionError', message: 'Not permitted' });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await activateBinding(
      { fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co', readPermScope: { doctypes: ['Purchase Invoice'] } },
      () => '2026-07-11T00:00:00.000Z',
    );
    expect(result.versionMajor).toBe(15);
    expect(result.activatedAt).toBeNull();
    expect(result.permissionFailure).toMatchObject({ kind: 'doctype', name: 'Purchase Invoice' });
  });

  it('AC-ENA-084 activateBinding activates when the read-perm probe passes (backward-compat: no scope ⇒ no probe)', async () => {
    const fetchImpl = fetchDeps((url) => {
      if (url.includes('get_versions')) return jsonResponse(200, { erpnext: { version: '15.94.3' } });
      if (url.includes('/api/resource/Company/PMO%20Smoke%20Co')) return jsonResponse(200, { name: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' });
      if (url.includes('/api/resource/Purchase%20Invoice?')) return jsonResponse(200, { data: [] });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await activateBinding(
      { fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co', readPermScope: { doctypes: ['Purchase Invoice'] } },
      () => '2026-07-11T00:00:00.000Z',
    );
    expect(result.activatedAt).toBe('2026-07-11T00:00:00.000Z');
    expect(result.permissionFailure).toBeUndefined();
  });
});
