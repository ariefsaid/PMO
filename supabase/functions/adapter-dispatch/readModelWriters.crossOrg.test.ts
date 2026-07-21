// readModelWriters.crossOrg.test.ts — round-7 cross-family B10, the WRITER half.
//
// The dispatch pre-flight (`dispatchFactory.assertCommandLinksSameOrg`) refuses a cross-org link before
// any ERP write, but the mirror writers are ALSO reachable without it: the sweep's recovery path
// reconstructs a command from the frozen outbox payload and finalizes it directly. These writers run as
// SERVICE ROLE — RLS does not protect them — and used to copy the command's `procurementId`/`vendorId`/
// `invoiceId` straight into an insert stamped with the CALLER's org_id, producing a PMO row with
// cross-tenant procurement links. The revenue writers have had this guard since Luna SF7/BLOCK 11; this
// is the same defence-in-depth for procurement.
//
// The fixture is a GENUINE two-org row table keyed by `<table>:<id>` (each row carries its own real
// org_id), so a cross-org id is distinguishable from a same-org one by the id ALONE.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.crossOrg.test.ts

import { getReadModelWriter } from './readModelWriters.ts';

const TWO_ORG_ROWS: Record<string, { org_id: string }> = {
  'procurements:proc-1': { org_id: 'org-1' },
  'procurements:proc-org2': { org_id: 'org-2' },
  'companies:vendor-1': { org_id: 'org-1' },
  'companies:vendor-org2': { org_id: 'org-2' },
  'procurement_invoices:vi-1': { org_id: 'org-1' },
  'procurement_invoices:vi-org2': { org_id: 'org-2' },
};

function makeClient() {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  function selectChain(table: string) {
    let filters: Record<string, string> = {};
    const chain = {
      eq(column: string, value: string) {
        filters = { ...filters, [column]: value };
        return chain;
      },
      async maybeSingle() {
        return { data: TWO_ORG_ROWS[`${table}:${filters.id}`] ?? null, error: null };
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        resolve({ data: [], error: null });
      },
    };
    return chain;
  }
  const client = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          inserts.push({ table, row: row as Record<string, unknown> });
          return { error: null };
        },
        upsert: async () => ({ error: null }),
        update: () => {
          const chain = { eq: () => chain, then: (r: (v: { error: null }) => void) => r({ error: null }) };
          return chain;
        },
        select: (_columns: string) => selectChain(table),
      };
    },
  };
  return { client, inserts };
}

const CANONICAL_PI = {
  id: 'pmo-pi-1',
  vi_number: 'ACC-PINV-2026-00001',
  amount: '1000.00',
  erp_outstanding_amount: '1000.00',
  erp_docstatus: 1,
  erp_modified: '2026-07-20 09:00:00.000000',
};

async function mirror(record: Record<string, unknown>, canonical: Record<string, unknown> = CANONICAL_PI) {
  const { client, inserts } = makeClient();
  const writer = getReadModelWriter('procurement');
  await writer.upsert(
    { serviceClient: client as never, orgId: 'org-1' },
    canonical as never,
    { domain: 'procurement', operation: 'create', record } as never,
  );
  return inserts;
}

async function expectCrossOrgRejection(record: Record<string, unknown>, canonical?: Record<string, unknown>): Promise<void> {
  let code: unknown;
  try {
    await mirror(record, canonical);
  } catch (err) {
    code = (err as { code?: string }).code;
  }
  if (code !== 'cross-org-link-rejected') {
    throw new Error(`expected a cross-org-link-rejected throw, got code=${String(code)}`);
  }
}

Deno.test('B10: a purchase-invoice mirror with ANOTHER org\'s procurementId is refused (no cross-tenant FK row)', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'purchase-invoice', procurementId: 'proc-org2' });
});

Deno.test('B10: a payment mirror with ANOTHER org\'s invoiceId is refused', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'payment', procurementId: 'proc-1', invoiceId: 'vi-org2' });
});

Deno.test('B10: a quotation mirror with ANOTHER org\'s vendorId is refused', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'quotation', procurementId: 'proc-1', vendorId: 'vendor-org2' });
});

Deno.test('B10: a purchase-request mirror with ANOTHER org\'s procurementId is refused (the non-money kinds too)', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'purchase-request', procurementId: 'proc-org2' }, {
    id: 'pmo-pr-1', pr_number: 'MAT-MR-2026-00001', amount: '10.00', erp_docstatus: 1, erp_modified: '2026-07-20 09:00:00.000000',
  });
});

Deno.test('B10: a purchase-order mirror with ANOTHER org\'s procurementId is refused', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'purchase-order', procurementId: 'proc-org2' }, {
    id: 'pmo-po-1', po_number: 'PUR-ORD-2026-00001', amount: '10.00', erp_docstatus: 1, erp_modified: '2026-07-20 09:00:00.000000',
  });
});

Deno.test('B10: a goods-receipt mirror with ANOTHER org\'s procurementId is refused', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'goods-receipt', procurementId: 'proc-org2' }, {
    id: 'pmo-gr-1', gr_number: 'MAT-PRE-2026-00001', erp_docstatus: 1, erp_modified: '2026-07-20 09:00:00.000000',
  });
});

Deno.test('B10: a procurementId that does not exist at all is refused (fail closed, never a raw FK error)', async () => {
  await expectCrossOrgRejection({ erp_doc_kind: 'purchase-invoice', procurementId: 'proc-nope' });
});

Deno.test('B10: SAME-org procurement links mirror normally (the guard checks the row, not a canned answer)', async () => {
  const inserts = await mirror({ erp_doc_kind: 'payment', procurementId: 'proc-1', invoiceId: 'vi-1', date: '2026-07-20' }, {
    id: 'pmo-pay-1', pay_number: 'ACC-PAY-2026-00001', amount: '1000.00', erp_docstatus: 1, erp_modified: '2026-07-20 09:00:00.000000',
  });
  const payment = inserts.find((i) => i.table === 'payments');
  if (!payment) throw new Error('expected a payments insert for same-org links');
  if (payment.row.procurement_id !== 'proc-1' || payment.row.invoice_id !== 'vi-1') {
    throw new Error(`expected the own-org links to be written verbatim, got ${JSON.stringify(payment.row)}`);
  }
});
