/**
 * erpnext/dispatchFactory.ts (task 2.13): resolves the per-org erpnext adapter, mirroring the ClickUp
 * dispatch-factory pattern. Reads the ALREADY-ACTIVATED `external_org_bindings` row (the version
 * handshake runs at bind-create/refresh time, FR-ENA-012 — not per-dispatch); `activated_at === null`
 * is refused `config-rejected` (a version mismatch, or never activated) BEFORE any command reaches
 * the adapter.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../appError.ts';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { ERPNEXT_TIER } from './adapter.ts';

function serviceClientReturning(row: unknown): DispatchServiceClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as DispatchServiceClient;
}

const ACTIVATED_ROW = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' },
};

describe('erpnext/dispatchFactory', () => {
  it('resolves a tier="erpnext" adapter from an ACTIVATED binding row', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(ACTIVATED_ROW),
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('throws BINDING_NOT_ACTIVATED/config-rejected when activated_at is null (a version mismatch or never-activated binding)', async () => {
    const row = { ...ACTIVATED_ROW, activated_at: null };
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: serviceClientReturning(row),
        orgId: 'org-1',
        command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'config-rejected' });
  });

  it('throws when no binding row exists for the org', async () => {
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: serviceClientReturning(null),
        orgId: 'org-1',
        command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('never leaks a secret into the adapter deps beyond the passed-in apiKey/apiSecret (never reads secret_ref itself)', async () => {
    const row = { ...ACTIVATED_ROW, secret_ref: 'vault/AS/erpnext-org-1' };
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(row),
      orgId: 'org-1',
      command: { domain: 'companies', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'supplier' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    // resolving succeeds using ONLY the passed-in creds — no attempt to read/interpret secret_ref here.
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('threads afterSubmitHook into the adapter (FR-ENA-003 after-submit-before-mirror seam, task 2.14)', async () => {
    const afterSubmitHook = vi.fn(async () => {});
    let putCalled = false;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001' }), { status: 200 });
      if (init?.method === 'PUT') {
        putCalled = true;
        return new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001', docstatus: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001', docstatus: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(ACTIVATED_ROW),
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order', items: [{ item_code: 'X', qty: 1 }] } },
      fetchImpl,
      apiKey: 'k',
      apiSecret: 's',
      afterSubmitHook,
      doctypeBodies: { 'purchase-order': { toBody: (rec) => ({ items: rec.items }), fromDoc: () => ({ id: 'placeholder' }) } },
    });
    await adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order', items: [{ item_code: 'X', qty: 1 }] } });
    expect(putCalled).toBe(true);
    expect(afterSubmitHook).toHaveBeenCalledTimes(1);
  });
});
