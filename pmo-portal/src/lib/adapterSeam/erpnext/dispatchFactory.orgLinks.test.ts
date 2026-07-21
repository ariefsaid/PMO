/**
 * dispatchFactory.orgLinks.test.ts — round-7 cross-family B10 (CROSS-TENANT procurement links).
 *
 * The revenue path has had an org pre-flight since Luna BLOCK 2 (`assertRevenueLinksSameOrg`), but the
 * PROCUREMENT path had none: `procurementId`/`vendorId`/`invoiceId` were never constrained by org, and
 * the service-role mirror writers then insert the CALLER's org_id alongside the client-supplied foreign
 * key (RLS does not protect a service-role write). A direct command carrying another tenant's known
 * `procurementId` therefore produced a REAL ERP document plus a PMO mirror row with cross-tenant
 * procurement links.
 *
 * The fixture is a GENUINE two-org row table keyed by `<table>:<id>` — each row carries its own real
 * org_id, so a cross-org id is distinguishable from a same-org one by the id ALONE (an org-blind mock
 * returning one canned org_id per table could not prove the fix).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import { ERPNEXT_TIER } from './adapter';

const ACTIVATED_BINDING = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' },
};

/** `<table>:<id>` -> the row's REAL org_id. org-1 is the caller; org-2 is a DIFFERENT tenant. */
const TWO_ORG_ROWS: Record<string, { org_id: string }> = {
  'procurements:proc-1': { org_id: 'org-1' },
  'procurements:proc-org2': { org_id: 'org-2' },
  'companies:vendor-1': { org_id: 'org-1' },
  'companies:vendor-org2': { org_id: 'org-2' },
  'procurement_invoices:vi-1': { org_id: 'org-1' },
  'procurement_invoices:vi-org2': { org_id: 'org-2' },
};

function serviceClient(): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        let filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => {
            filters = { ...filters, [col]: val };
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === 'external_org_bindings') return { data: ACTIVATED_BINDING, error: null };
            if (table === 'external_refs') return { data: null, error: null };
            if (table === 'procurements' && filters.id && !('org_id' in filters)) {
              // the org pre-flight's own `select('org_id').eq('id', …)` read
              return { data: TWO_ORG_ROWS[`procurements:${filters.id}`] ?? null, error: null };
            }
            return { data: TWO_ORG_ROWS[`${table}:${filters.id}`] ?? null, error: null };
          },
          // list reads (procurement_items / purchase_orders) resolve empty here
          then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  } as unknown as DispatchServiceClient;
}

function commandFor(record: Record<string, unknown>) {
  return { domain: 'procurement', operation: 'create' as const, record: { id: 'pmo-1', ...record } };
}

async function resolve(record: Record<string, unknown>, orgId = 'org-1', fetchImpl?: typeof fetch) {
  return resolveErpDispatchAdapter({
    serviceClient: serviceClient(),
    orgId,
    command: commandFor(record) as never,
    fetchImpl: fetchImpl ?? (vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch),
    apiKey: 'k',
    apiSecret: 's',
  });
}

describe('B10 — procurement commands get the SAME cross-org link pre-flight as revenue', () => {
  it('B10 — a procurementId owned by ANOTHER org is rejected BEFORE any ERP write', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolve({ erp_doc_kind: 'purchase-invoice', procurementId: 'proc-org2' }, 'org-1', fetchImpl),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B10 — a vendorId owned by ANOTHER org is rejected BEFORE any ERP write', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolve({ erp_doc_kind: 'quotation', procurementId: 'proc-1', vendorId: 'vendor-org2' }, 'org-1', fetchImpl),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B10 — an invoiceId owned by ANOTHER org is rejected BEFORE any ERP write (the payment case)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolve({ erp_doc_kind: 'payment', procurementId: 'proc-1', invoiceId: 'vi-org2' }, 'org-1', fetchImpl),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B10 — a link id that does not exist at all is rejected (fail closed, never a silent pass)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolve({ erp_doc_kind: 'purchase-invoice', procurementId: 'proc-nope' }, 'org-1', fetchImpl),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B10 — the pre-flight runs BEFORE ref resolution, so a PO command issues no ERP GET either', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolve({ erp_doc_kind: 'purchase-order', procurementId: 'proc-org2' }, 'org-1', fetchImpl),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B10 — same-org procurement links resolve normally: the adapter is built', async () => {
    const adapter = await resolve({ erp_doc_kind: 'payment', procurementId: 'proc-1', invoiceId: 'vi-1' });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('B10 — the SAME procurementId is accepted for the org that DOES own it (a real row check, not a canned answer)', async () => {
    const adapter = await resolve({ erp_doc_kind: 'purchase-invoice', procurementId: 'proc-org2' }, 'org-2');
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('B10 — a command carrying no procurement links at all is untouched (no lookup, no rejection)', async () => {
    const adapter = await resolve({ erp_doc_kind: 'supplier', name: 'Acme' });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });
});
