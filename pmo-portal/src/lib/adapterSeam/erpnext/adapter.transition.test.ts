/**
 * erpnext/adapter.ts — commit() operation:'transition' (task 4.4, FR-ENA-044/117). `create` already
 * does the R9 two-step (insert->submit->re-fetch, task 2.12) for every submittable kind, so a fresh
 * 'transition' command is for an ALREADY-CREATED doc: `verb:'submit'` PUTs `{docstatus:1}` on the
 * caller-resolved `externalRecordId`, fires `afterSubmitHook` (FR-ENA-003 seam parity with create),
 * then re-fetches (the R9 §5 stale-status trap applies here too — never trust the PUT response body)
 * and maps the canonical record via the kind's `DOCTYPE_BODIES.fromDoc`. A separate file from
 * `adapter.test.ts` (task 2.12's shipped suite) so this additive slice-4 behavior never edits that
 * file (merge-coordination discipline).
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../contract.ts';
import { createErpAdapter, type ErpAdapterDeps } from './adapter.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function baseDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, overrides: Partial<ErpAdapterDeps> = {}): ErpAdapterDeps {
  return {
    client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
    doctypeBodies: {
      'purchase-request': { toBody: () => ({}), fromDoc: (doc) => ({ id: 'placeholder', pr_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }) },
    },
    ctx: { refs: {}, config: { company: 'PMO Smoke Co' } },
    ...overrides,
  };
}

describe('erpnext/adapter — commit() transition, verb:submit (task 4.4)', () => {
  it('FR-ENA-044/117 PUTs {docstatus:1} on the resolved externalRecordId, then re-fetches (never trusts the PUT body)', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1, status: 'Draft' });
      return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1 });
    };
    const adapter = createErpAdapter(baseDeps(fetchImpl));
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'submit' },
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(calls[0].body).toEqual({ docstatus: 1 });
    expect(result.externalRecordId).toBe('MAT-REQ-2026-00001');
    expect(result.canonical).toMatchObject({ id: 'pmo-mr-1', pr_number: 'MAT-REQ-2026-00001', erp_docstatus: 1 });
  });

  it('fires afterSubmitHook right after the submit PUT, before the re-fetch (FR-ENA-003 parity with create)', async () => {
    const order: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        order.push('submit');
        return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1 });
      }
      order.push('refetch');
      return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1 });
    };
    const afterSubmitHook = vi.fn(async () => {
      order.push('hook');
    });
    const adapter = createErpAdapter(baseDeps(fetchImpl, { afterSubmitHook }));
    await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'submit' },
    });
    expect(order).toEqual(['submit', 'hook', 'refetch']);
  });

  it('rejects a transition with no externalRecordId (nothing to submit) as commit-rejected', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', verb: 'submit' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('rejects an unsupported verb (only submit is wired this slice — cancel/amend land in slices 5/6) — loud, never a silent no-op', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'cancel' } }),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it('rejects a transition for a kind with no DOCTYPE_BODIES entry (loud, never a silent no-op)', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {}), { doctypeBodies: {} }));
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'submit' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});
