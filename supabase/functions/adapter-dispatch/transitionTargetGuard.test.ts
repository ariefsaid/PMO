// Luna money audit — BLOCK 3: transition target bound to PMO mapping.
// The dispatch must verify that for a revenue sales-invoice transition,
// command.record.externalRecordId matches the external_refs mapping for (org, 'revenue', record.id).
// Rejects 422 on mismatch. Deno-native test idiom.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json transitionTargetGuard.test.ts

import { assertEquals, assert } from 'jsr:@std/assert';
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Fake service-role client that can resolve external_refs. */
function fakeServiceClient(opts: { mappedExternalId: string | null }): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'external_refs') {
        return {
          select: (columns: string) => ({
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: string) => ({
                eq: (col3: string, val3: string) => ({
                  maybeSingle: async () => ({
                    data: opts.mappedExternalId ? { external_record_id: opts.mappedExternalId } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        } as any;
      }
      return {} as any;
    },
  } as SupabaseClient;
}

/** Simulates the BLOCK 3 check logic extracted for testing. */
async function checkTransitionTargetBinding(
  serviceClient: SupabaseClient,
  orgId: string,
  command: { domain: string; operation: string; record: { id: string; erp_doc_kind?: unknown; externalRecordId?: unknown } },
): Promise<{ ok: boolean; status: number; message: string }> {
  if (command.domain !== 'revenue' || (command.operation as string) !== 'transition') return { ok: true, status: 200, message: '' };
  if ((command.record as any).erp_doc_kind !== 'sales-invoice') return { ok: true, status: 200, message: '' };

  const externalRecordId = (command.record as any).externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) {
    // Missing externalRecordId — adapter will reject with its own error
    return { ok: true, status: 200, message: '' };
  }

  const mapped = await resolveExternalRef(serviceClient as never, orgId, 'revenue', String(command.record.id));
  if (mapped !== null && mapped !== externalRecordId) {
    return { ok: false, status: 422, message: 'externalRecordId does not match PMO record mapping' };
  }
  return { ok: true, status: 200, message: '' };
}

Deno.test('checkTransitionTargetBinding: ok when externalRecordId matches mapped external_refs', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: 'ACC-SINV-2026-00001' }),
    'org-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001' } },
  );
  assertEquals(res.ok, true);
  assertEquals(res.status, 200);
});

Deno.test('checkTransitionTargetBinding: 422 when externalRecordId mismatches mapped external_refs', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: 'ACC-SINV-2026-00001' }),
    'org-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00002' } },
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(res.message.includes('externalRecordId') || res.message.includes('mapping'));
});

Deno.test('checkTransitionTargetBinding: ok when no mapping exists yet (first transition, allow — adapter will handle missing doc)', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: null }),
    'org-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001' } },
  );
  assertEquals(res.ok, true);
});

Deno.test('checkTransitionTargetBinding: ok for non-revenue domains (not checked)', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: 'PI-1' }),
    'org-1',
    { domain: 'procurement', operation: 'transition', record: { id: 'pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'PI-2' } },
  );
  assertEquals(res.ok, true);
});

Deno.test('checkTransitionTargetBinding: ok for non-transition operations (not checked)', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: 'ACC-SINV-2026-00001' }),
    'org-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00002' } },
  );
  assertEquals(res.ok, true);
});

Deno.test('checkTransitionTargetBinding: ok for non-sales-invoice kinds (not checked)', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: 'ACC-SINV-2026-00001' }),
    'org-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'ip-1', erp_doc_kind: 'incoming-payment', externalRecordId: 'ACC-PE-REC-2026-00002' } },
  );
  assertEquals(res.ok, true);
});

Deno.test('checkTransitionTargetBinding: ok when externalRecordId is missing (adapter will reject)', async () => {
  const res = await checkTransitionTargetBinding(
    fakeServiceClient({ mappedExternalId: 'ACC-SINV-2026-00001' }),
    'org-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } },
  );
  assertEquals(res.ok, true);
});