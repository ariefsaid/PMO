/**
 * AC-ENA-073 — erpnext/binding.ts: the v15 version handshake gates activation (FR-ENA-012). A
 * matched `version_major` fills `config` from one `GET Company/<name>` (R9 §6.2); a mismatch leaves
 * `activatedAt` null (money commands are refused as config-rejected by the dispatch factory, 2.13).
 */
import { describe, expect, it, vi } from 'vitest';
import { activateBinding } from './binding.ts';

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
