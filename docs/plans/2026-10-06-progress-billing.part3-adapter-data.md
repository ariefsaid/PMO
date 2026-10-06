# Plan #766 — part 3: adapter + FE data layer

> Part of [`2026-10-06-progress-billing.md`](2026-10-06-progress-billing.md). Tasks B1–B7, C1–C14. Requires part 2
> (migration 0250; types regenerated in A16). Next: [part 4](2026-10-06-progress-billing.part4-ui.md).

## Slice B — adapter

### Task B1 — test: claim → invoice lines (RED) · AC-PB-006

Create `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { progressClaimItems, type ProgressClaimRecord } from './progressClaimItems.ts';

const DP: ProgressClaimRecord = {
  id: 'claim-dp', kind: 'down_payment', project_id: 'proj-1', work_order_id: null,
  down_payment_amount: '200000.00', dp_recovery_amount: '0.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
const PROGRESS: ProgressClaimRecord = { ...DP, id: 'claim-1', kind: 'progress', down_payment_amount: null, dp_recovery_amount: '40000.00' };
const LINE = { item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: '4.000', rate: '50000.00' };

describe('progressClaimItems', () => {
  it('AC-PB-006 a down payment is one line on its down payment item at its amount', () => {
    expect(progressClaimItems(DP, [])).toEqual([{ item_code: 'DP-ITEM', qty: 1, rate: 200000 }]);
  });

  it('AC-PB-006 a progress claim is its lines plus a negative recovery line on the down payment item', () => {
    expect(progressClaimItems(PROGRESS, [LINE])).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
      { item_code: 'DP-ITEM', qty: 1, rate: -40000 },
    ]);
  });

  it('AC-PB-006 a progress claim that recovers nothing has no recovery line', () => {
    expect(progressClaimItems({ ...PROGRESS, dp_recovery_amount: '0.00', dp_item_code: null }, [LINE])).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
    ]);
  });

  it('AC-PB-006 a withdrawn claim cannot be invoiced', () => {
    expect(() => progressClaimItems({ ...PROGRESS, withdrawn_at: '2026-10-06T00:00:00Z' }, [LINE]))
      .toThrow('This progress claim was withdrawn, so no invoice can be raised for it');
  });

  it('AC-PB-006 a progress claim with no lines cannot be invoiced', () => {
    expect(() => progressClaimItems(PROGRESS, [])).toThrow('This progress claim has no quantity lines');
  });

  it('AC-PB-006 a recovery without a down payment item cannot be invoiced', () => {
    expect(() => progressClaimItems({ ...PROGRESS, dp_item_code: null }, [LINE]))
      .toThrow('This progress claim recovers a down payment but names no down payment item');
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/progressClaimItems.test.ts`
Expect: fails (module not found).

### Task B2 — `progressClaimItems.ts` (GREEN) · AC-PB-006

Create `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimItems.ts`:

```ts
/**
 * #766 / ADR-0077 — the Sales Invoice lines of a billing claim, built ONLY from the immutable claim rows.
 * A down payment is one line on the org's down-payment item; a progress claim is one line per claimed BoQ line
 * plus, when it recovers part of the down payment, one NEGATIVE-rate line on that same item. The item's ERPNext
 * income account is the customer-advance account, so that line debits the advance instead of revenue.
 * No account is ever sent — the body contract of `bodies/salesInvoice.ts` stands.
 */
import { AdapterError } from '../contract.ts';
import type { PmoLineItem } from './bodies/shared.ts';

export interface ProgressClaimRecord {
  id: string;
  kind: 'down_payment' | 'progress';
  project_id: string;
  work_order_id: string | null;
  down_payment_amount: number | string | null;
  dp_recovery_amount: number | string;
  dp_item_code: string | null;
  withdrawn_at: string | null;
}

export interface ProgressClaimLineRecord {
  item_code: string;
  description: string;
  unit: string;
  quantity: number | string;
  rate: number | string;
}

export function progressClaimItems(
  claim: ProgressClaimRecord,
  lines: readonly ProgressClaimLineRecord[],
): PmoLineItem[] {
  if (claim.withdrawn_at) {
    throw new AdapterError('commit-rejected', 'This progress claim was withdrawn, so no invoice can be raised for it');
  }
  if (claim.kind === 'down_payment') {
    if (!claim.dp_item_code || claim.down_payment_amount === null) {
      throw new AdapterError('commit-rejected', 'This down payment claim is incomplete');
    }
    return [{ item_code: claim.dp_item_code, qty: 1, rate: Number(claim.down_payment_amount) }];
  }
  if (lines.length === 0) throw new AdapterError('commit-rejected', 'This progress claim has no quantity lines');
  const items: PmoLineItem[] = lines.map((line) => ({
    item_code: line.item_code,
    qty: Number(line.quantity),
    rate: Number(line.rate),
    description: `${line.description} (${line.unit})`,
  }));
  const recovery = Number(claim.dp_recovery_amount);
  if (recovery > 0) {
    if (!claim.dp_item_code) {
      throw new AdapterError('commit-rejected', 'This progress claim recovers a down payment but names no down payment item');
    }
    items.push({ item_code: claim.dp_item_code, qty: 1, rate: -recovery });
  }
  return items;
}
```

Before writing, confirm the two imports resolve on `dev`: `grep -n "export class AdapterError" pmo-portal/src/lib/adapterSeam/contract.ts`
and `grep -n "export interface PmoLineItem" pmo-portal/src/lib/adapterSeam/erpnext/bodies/shared.ts`. If
`PmoLineItem` has no `description`, keep the field out of both this file and the B1/B3 expectations.

Verify GREEN: same command as B1. Expect: 6/6.

### Task B3 — test: the dispatch builds the claim invoice (RED) · AC-PB-006

Create `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { siFromDoc, siToBody } from './bodies/salesInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';
const CLAIM: Row = {
  id: 'claim-1', org_id: ORG, kind: 'progress', project_id: 'proj-1', work_order_id: null,
  down_payment_amount: null, dp_recovery_amount: '40000.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
// Deliberately out of BoQ order: the resolver must sort by boq_item_id so every resolution is identical.
const LINES: Row[] = [
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-b', item_code: 'STATION', description: 'Station build', unit: 'unit', quantity: '1.000', rate: '100000.00' },
  { org_id: ORG, claim_id: 'claim-1', boq_item_id: 'boq-a', item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: '4.000', rate: '50000.00' },
];
const EVIDENCE: Row[] = [{ id: 'ev-1', org_id: ORG, claim_id: 'claim-1' }];

/** PostgREST boundary fake: enforces filters and selected columns (a missing column throws). */
function serviceClient(claim: Row | null, evidence: Row[] = EVIDENCE): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-09-01', config: { project_map: { 'proj-1': 'ERP-PROJ-001', 'proj-2': 'ERP-PROJ-002' } } }],
    companies: [{ id: 'cust-1', org_id: ORG }, { id: 'cust-2', org_id: ORG }],
    external_refs: [
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-1', external_record_id: 'Customer:Synthetic Customer' },
      { org_id: ORG, domain: 'companies', pmo_record_id: 'cust-2', external_record_id: 'Customer:Other Customer' },
    ],
    projects: [
      { id: 'proj-1', org_id: ORG, client_id: 'cust-1', customer_contract_ref: null, contract_date: null },
      { id: 'proj-2', org_id: ORG, client_id: 'cust-1', customer_contract_ref: null, contract_date: null },
    ],
    work_orders: [{ id: 'wo-1', org_id: ORG, client_po_number: 'WO-PO-001', order_date: '2026-09-01' }],
    sales_invoices: [],
    progress_claims: claim ? [claim] : [],
    progress_claim_lines: LINES,
    progress_claim_evidence: evidence,
  };
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, string> = {};
          let orderBy: string | null = null;
          const matches = () => {
            const found = (rows[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
            return orderBy === null ? found : [...found].sort((a, b) => String(a[orderBy as string]).localeCompare(String(b[orderBy as string])));
          };
          const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
            if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
            return [col, row[col]];
          }));
          const chain = {
            eq(col: string, val: string) { filters[col] = val; return chain; },
            order(col: string) { orderBy = col; return chain; },
            limit() { return chain; },
            gt() { return chain; },
            async maybeSingle() { const row = matches()[0]; return { data: row ? pick(row) : null, error: null }; },
            then(resolve: (value: { data: Row[]; error: null }) => void) { resolve({ data: matches().map(pick), error: null }); },
          };
          return chain;
        },
      };
    },
  } as unknown as DispatchServiceClient;
}

function command(record: Row, operation: AdapterCommand['operation'] = 'create'): AdapterCommand {
  return {
    domain: 'revenue', operation, idempotencyKey: 'pb-test-key',
    record: { id: 'claim-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', ...record },
  };
}

function erpFetch() {
  const sent: { body: Row } = { body: {} };
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(url)).pathname === '/api/resource/Item' && init?.method === 'GET') {
      return Response.json({ data: ['SURVEY', 'STATION', 'DP-ITEM', 'OWN-ITEM'].map((name) => ({ name, item_name: name, disabled: 0, is_sales_item: 1, is_purchase_item: 0 })) });
    }
    sent.body = JSON.parse(String(init?.body)) as Row;
    return new Response(JSON.stringify({ data: { name: 'SYNTHETIC-SI-766', ...sent.body, docstatus: 0 } }), { status: 200 });
  });
  return { sent, fetchImpl };
}

async function push(record: Row, claim: Row | null = CLAIM) {
  const cmd = command(record);
  const { sent, fetchImpl } = erpFetch();
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(claim), orgId: ORG, command: cmd,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  await adapter.commit(cmd);
  return { body: sent.body, command: cmd };
}

/** Synchronous on purpose: the caller attaches `.rejects` in the same tick, so no rejection goes unhandled. */
function refused(cmd: AdapterCommand, claim: Row | null = CLAIM, evidence: Row[] = EVIDENCE) {
  const { fetchImpl } = erpFetch();
  const attempt = resolveErpDispatchAdapter({
    serviceClient: serviceClient(claim, evidence), orgId: ORG, command: cmd,
    fetchImpl: fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
  });
  return { attempt, fetchImpl };
}

const digest = (cmd: AdapterCommand) => canonicalCommandDigest({ domain: cmd.domain, operation: cmd.operation, record: cmd.record });

describe('billing claim invoice (AC-PB-006)', () => {
  it('AC-PB-006 builds a progress invoice from the claim lines in BoQ order plus the recovery line', async () => {
    const { body } = await push({});
    expect(body.items).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
      { item_code: 'STATION', qty: 1, rate: 100000, description: 'Station build (unit)' },
      { item_code: 'DP-ITEM', qty: 1, rate: -40000 },
    ]);
  });

  it('AC-PB-006 builds a down payment invoice as one line on the claim item', async () => {
    const { body } = await push({}, { ...CLAIM, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00' });
    expect(body.items).toEqual([{ item_code: 'DP-ITEM', qty: 1, rate: 200000 }]);
  });

  it('AC-PB-006 replaces caller-supplied lines with the claim lines', async () => {
    const { body } = await push({ items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] });
    expect((body.items as Row[]).map((item) => item.item_code)).toEqual(['SURVEY', 'STATION', 'DP-ITEM']);
  });

  it.each([
    ['another project', { projectId: 'proj-2' }, 'The invoice project must be the progress claim project'],
    ['another customer', { customerId: 'cust-2' }, 'The invoice customer must be the project client'],
  ])('AC-PB-006 refuses %s before any ERP call', async (_label, record, message) => {
    const { attempt, fetchImpl } = refused(command(record));
    await expect(attempt).rejects.toMatchObject({ code: 'commit-rejected', message });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 refuses a claim without evidence before any ERP call', async () => {
    const { attempt, fetchImpl } = refused(command({}), CLAIM, []);
    await expect(attempt).rejects.toMatchObject({
      code: 'commit-rejected',
      message: "Attach the billing evidence (for example the progress report or the client's acceptance) before raising this invoice",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 refuses to rebuild a claim invoice body on update', async () => {
    const { attempt, fetchImpl } = refused(command({ externalRecordId: 'SYNTHETIC-SI-766' }, 'update'));
    await expect(attempt).rejects.toMatchObject({
      code: 'commit-rejected',
      message: 'A progress claim invoice cannot be edited or amended from PMO — cancel the invoice and raise a new claim',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 refuses a withdrawn claim before any ERP call', async () => {
    const { attempt, fetchImpl } = refused(command({}), { ...CLAIM, withdrawn_at: '2026-10-06T00:00:00Z' });
    await expect(attempt).rejects.toThrow('This progress claim was withdrawn, so no invoice can be raised for it');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-PB-006 derives the identical outbox digest on every resolution', async () => {
    const first = await push({});
    const second = await push({ items: [{ item_code: 'OWN-ITEM', qty: 9, rate: 9 }] });
    expect(await digest(second.command)).toBe(await digest(first.command));
  });

  it('AC-PB-006 takes the client PO from the claim work order', async () => {
    const { body } = await push({}, { ...CLAIM, work_order_id: 'wo-1' });
    expect(body.po_no).toBe('WO-PO-001');
    expect(body.po_date).toBe('2026-09-01');
  });

  it('AC-PB-006 leaves an invoice that is not a claim on the caller lines', async () => {
    const { body } = await push({ items: [{ item_code: 'OWN-ITEM', qty: 2, rate: 10 }] }, null);
    expect(body.items).toEqual([{ item_code: 'OWN-ITEM', qty: 2, rate: 10 }]);
  });
});
```

The fake mirrors `salesInvoicePo.test.ts`'s service-client fake; if `resolveErpDispatchAdapter` on `dev` reads
another table or column first, add that row to `rows` (the fake throws a named error telling you which).

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts`
Expect: claim-specific cases fail; the non-claim case passes.

### Task B4 — dispatch resolver (GREEN) · AC-PB-006

Edit `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`:

1. Add to the imports at the top:
   ```ts
   import { progressClaimItems, type ProgressClaimLineRecord, type ProgressClaimRecord } from './progressClaimItems.ts';
   ```
2. Replace
   `type LinkField = 'customerId' | 'projectId' | 'salesInvoiceId' | 'procurementId' | 'vendorId' | 'invoiceId';`
   with
   `type LinkField = 'customerId' | 'projectId' | 'salesInvoiceId' | 'workOrderId' | 'procurementId' | 'vendorId' | 'invoiceId';`
3. In `LINK_TABLE`, after `salesInvoiceId: 'sales_invoices',` add `  workOrderId: 'work_orders',`.
4. In `DOMAIN_LINK_FIELDS`, replace `revenue: ['customerId', 'projectId', 'salesInvoiceId'],` with
   `revenue: ['customerId', 'projectId', 'salesInvoiceId', 'workOrderId'],`.
5. In `resolveSalesInvoicePo`, replace `const workOrderId = nonblank(invoice?.work_order_id);` with
   ```ts
   // #766: a claim invoice has no mirror row yet on its first push; its work order rides on the record.
   const workOrderId = nonblank(invoice?.work_order_id) ?? nonblank(record.workOrderId);
   ```
6. Immediately above `export async function resolveErpDispatchAdapter`, add:
   ```ts
   /**
    * #766 / ADR-0077 — a Sales Invoice whose PMO record id is a billing claim's id IS that claim's invoice.
    * Its lines come from the claim alone and are rebuilt on EVERY resolution (a sweep recovery re-derives the
    * identical payload and digest); the caller's project and customer must be the claim's; the claim must carry
    * evidence (the outbox fence is the database half of this rule); and nothing but a create may build its
    * body — a wrong claim invoice is cancelled and a new claim raised (DD-PBL-7).
    */
   const MAX_CLAIM_LINES = 500;
   async function resolveProgressClaimInvoice(deps: ErpDispatchFactoryDeps): Promise<void> {
     const record = deps.command.record as Record<string, unknown>;
     if (record.erp_doc_kind !== 'sales-invoice') return;
     if (!buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: record.verb } })) return;
     if (typeof record.id !== 'string' || !record.id) return;
     const { data: claimData, error } = await deps.serviceClient.from('progress_claims')
       .select('id,kind,project_id,work_order_id,down_payment_amount,dp_recovery_amount,dp_item_code,withdrawn_at')
       .eq('org_id', deps.orgId).eq('id', record.id).maybeSingle();
     if (error) throw new AppError(error.message, error.code);
     if (!claimData) return;
     const claim = claimData as ProgressClaimRecord;
     if (deps.command.operation !== 'create') {
       throw new AppError('A progress claim invoice cannot be edited or amended from PMO — cancel the invoice and raise a new claim', 'commit-rejected');
     }
     if (record.projectId !== claim.project_id) {
       throw new AppError('The invoice project must be the progress claim project', 'commit-rejected');
     }
     const { data: project, error: projectError } = await deps.serviceClient.from('projects')
       .select('client_id').eq('org_id', deps.orgId).eq('id', claim.project_id).maybeSingle();
     if (projectError) throw new AppError(projectError.message, projectError.code);
     const clientId = (project as { client_id?: string | null } | null)?.client_id ?? null;
     if (!clientId || record.customerId !== clientId) {
       throw new AppError('The invoice customer must be the project client', 'commit-rejected');
     }
     const { data: evidence, error: evidenceError } = await deps.serviceClient.from('progress_claim_evidence')
       .select('id').eq('org_id', deps.orgId).eq('claim_id', claim.id).limit(1);
     if (evidenceError) throw new AppError(evidenceError.message, evidenceError.code);
     if (!Array.isArray(evidence) || evidence.length === 0) {
       throw new AppError("Attach the billing evidence (for example the progress report or the client's acceptance) before raising this invoice", 'commit-rejected');
     }
     let lines: ProgressClaimLineRecord[] = [];
     if (claim.kind === 'progress') {
       const { data, error: linesError } = await deps.serviceClient.from('progress_claim_lines')
         .select('item_code,description,unit,quantity,rate')
         .eq('org_id', deps.orgId).eq('claim_id', claim.id)
         .order('boq_item_id', { ascending: true }).limit(MAX_CLAIM_LINES + 1);
       if (linesError) throw new AppError(linesError.message, linesError.code);
       lines = (data ?? []) as ProgressClaimLineRecord[];
       if (lines.length > MAX_CLAIM_LINES) {
         throw new AppError(`A progress claim may have at most ${MAX_CLAIM_LINES} lines`, 'commit-rejected');
       }
     }
     record.items = progressClaimItems(claim, lines);
     record.workOrderId = claim.work_order_id;
   }
   ```
7. In `resolveErpDispatchAdapter`, directly after `await assertCommandLinksSameOrg(deps);` add
   `  await resolveProgressClaimInvoice(deps);`.

`ErpDispatchFactoryDeps`, `AppError`, `buildsSalesInvoiceBody` and `nonblank` are the names already used in this
file on `dev` (`grep -n "buildsSalesInvoiceBody\|function nonblank\|interface ErpDispatchFactoryDeps" pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`).

Verify GREEN:
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts src/lib/adapterSeam/erpnext/progressClaimItems.test.ts src/lib/adapterSeam/erpnext/salesInvoicePo.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.test.ts
```
Expect: all pass. Mutation checks (do not commit): delete `record.items = progressClaimItems(claim, lines);` →
three AC-PB-006 cases red; delete the evidence `if` block → the no-evidence case red; revert each.

### Task B5 — Deno test: the mirror records the claim's work order (RED) · AC-PB-013

Append to `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts`:

```ts
Deno.test({
  name: 'AC-PB-013 a created claim invoice mirror carries the claim work order',
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-1' }, work_orders: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1', callerUserId: 'user-author-1' },
      { id: 'pmo-claim-1', si_number: 'ACC-SINV-2026-00766', amount: '160000.00', erp_outstanding_amount: '160000.00', erp_docstatus: 0, erp_modified: '2026-10-06 10:00:00.000000', currency: 'IDR', tax_amount: '0.00' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-claim-1', projectId: 'proj-1', customerId: 'cust-1', workOrderId: 'wo-1', erp_doc_kind: 'sales-invoice' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'sales_invoices');
    assert(insertCall !== undefined, 'expected an insert into sales_invoices');
    assertEquals((insertCall!.args[0] as Record<string, unknown>).work_order_id, 'wo-1');
  },
});

Deno.test({
  name: 'AC-PB-013 a created invoice that names no work order writes no work_order_id key',
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1', callerUserId: 'user-author-1' },
      { id: 'pmo-si-766', si_number: 'ACC-SINV-2026-00767', amount: '1000.00', erp_outstanding_amount: '1000.00', erp_docstatus: 0, erp_modified: '2026-10-06 10:00:00.000000', currency: 'IDR', tax_amount: '0.00' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-766', projectId: 'proj-1', customerId: 'cust-1', erp_doc_kind: 'sales-invoice' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'sales_invoices');
    assert(insertCall !== undefined, 'expected an insert into sales_invoices');
    assertEquals('work_order_id' in (insertCall!.args[0] as Record<string, unknown>), false);
  },
});
```

`makeFakeClient`, `getReadModelWriter`, `assert` and `assertEquals` are already imported at the top of that file.

Verify RED: `cd supabase/functions/adapter-dispatch && deno test --allow-all readModelWriters.money.test.ts`
Expect: the first new test fails; the second passes.

### Task B6 — mirror writer (GREEN) · AC-PB-013

In `supabase/functions/adapter-dispatch/readModelWriters.ts`, inside `upsertSalesInvoiceMirror`'s
`if (command.operation === 'create') {` block:
1. Replace `const record = command.record as { projectId?: string; customerId?: string };` with
   `const record = command.record as { projectId?: string; customerId?: string; workOrderId?: string | null };`
2. After `const projectId = await resolveLinkOrNull(ctx, 'projects', record.projectId);` add
   ```ts
   // #766: a claim invoice records the work order it bills (the dispatch set it from the claim). The
   // same-project trigger (0193 §10) re-checks it; an absent work order writes no key at all.
   const workOrderId = await resolveLinkOrNull(ctx, 'work_orders', record.workOrderId);
   ```
3. In the `.insert({ … })` object, after `customer_id: customerId,` add
   `      ...(workOrderId ? { work_order_id: workOrderId } : {}),`

If `resolveLinkOrNull` is typed to a table union, add `'work_orders'` to that union in the same file.

Verify GREEN: `cd supabase/functions/adapter-dispatch && deno test --allow-all readModelWriters.money.test.ts` — Expect: all pass.

### Task B7 — Slice B gate

```bash
cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck && npm run typecheck:edge \
  && npx eslint --max-warnings=0 src/lib/adapterSeam/erpnext/progressClaimItems.ts src/lib/adapterSeam/erpnext/progressClaimItems.test.ts src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.ts \
  && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
cd ../supabase/functions/adapter-dispatch && deno test --allow-all
cd ../../.. && node scripts/check-edge-fn-test-binding.mjs
```
Expect: all green.

---

## Slice C (part 1) — helpers, DAL, repository, hooks, policy, Admin setting

### Task C1 — test: pure billing helpers (RED) · AC-PB-016

Create `pmo-portal/src/lib/progressBilling.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fromCents, pctOf, toCents } from '@/src/lib/reports/managementPack';
import { claimNet, prefillFromAssessment, remainingQuantity, suggestedRecoveryPct, summarizeBilling } from './progressBilling';

const FACTS = {
  currency: 'IDR', contractNet: 1_000_000, workBilled: 200_000, dpBilled: 200_000,
  dpRecovered: 40_000, notSubmitted: 40_000, assessment: null,
  claimedByBoqItem: { b1: 5 }, assessedByBoqItem: {},
};

describe('progress billing helpers', () => {
  it('AC-PB-016 down payment held and contract not yet billed are exact', () => {
    expect(summarizeBilling(FACTS)).toMatchObject({ dpHeld: 160_000, remaining: 800_000 });
    expect(summarizeBilling({ ...FACTS, contractNet: 0.3, workBilled: 0.1 }).remaining).toBe(0.2);
  });

  it('AC-PB-016 nothing is clamped: billing past the contract and over-recovery read negative', () => {
    expect(summarizeBilling({ ...FACTS, workBilled: 1_100_000, dpRecovered: 250_000 })).toMatchObject({ remaining: -100_000, dpHeld: -50_000 });
  });

  it("AC-PB-016 assessed to date is the management pack's recognised figure and the gap is assessed less billed", () => {
    const summary = summarizeBilling({ ...FACTS, assessment: { month: '2026-10-01', pctComplete: 60 } });
    expect(summary.assessedToDate).toBe(fromCents(pctOf(toCents(1_000_000), 60)));
    expect(summary.assessedToDate).toBe(600_000);
    expect(summary.unbilledWork).toBe(400_000);
  });

  it('AC-PB-016 without an assessment there is no assessed figure and no gap — never 0', () => {
    expect(summarizeBilling(FACTS)).toMatchObject({ assessedToDate: null, unbilledWork: null });
  });

  it('AC-PB-016 billing ahead of the assessment reads a negative gap', () => {
    expect(summarizeBilling({ ...FACTS, assessment: { month: '2026-10-01', pctComplete: 10 } }).unbilledWork).toBe(-100_000);
  });

  it('AC-PB-016 remaining quantity is exact to 3 decimals and negative when over-claimed', () => {
    expect(remainingQuantity(10, 4.125)).toBe(5.875);
    expect(remainingQuantity(10, 12)).toBe(-2);
    expect(remainingQuantity(0.3, 0.1)).toBe(0.2);
  });

  it('AC-PB-016 the proportional percentage is DP / contract x 100 to 3 decimals', () => {
    expect(suggestedRecoveryPct(200_000, 1_000_000)).toBe(20);
    expect(suggestedRecoveryPct(100_000, 300_000)).toBe(33.333);
    expect(suggestedRecoveryPct(200_000, 0)).toBeNull();
    expect(suggestedRecoveryPct(0, 1_000_000)).toBeNull();
    expect(suggestedRecoveryPct(2_000_000, 1_000_000)).toBe(100);
  });

  it('AC-PB-016 a claim net is gross less recovery in cents', () => {
    expect(claimNet(200_000, 40_000)).toBe(160_000);
    expect(claimNet(0.3, 0.1)).toBe(0.2);
  });

  it('AC-PB-016 the assessment pre-fill is assessed less claimed, omitting lines not above zero', () => {
    expect(prefillFromAssessment(['b1', 'b2', 'b3'], { b1: 6, b2: 1, b3: 0.3 }, { b1: 4, b2: 3, b3: 0.1 })).toEqual({ b1: 2, b3: 0.2 });
    expect(prefillFromAssessment(['b1'], {}, { b1: 1 })).toEqual({});
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/progressBilling.test.ts` — Expect: module not found.

### Task C2 — `progressBilling.ts` (GREEN) · AC-PB-016

Create `pmo-portal/src/lib/progressBilling.ts`:

```ts
import { fromCents, pctOf, toCents } from '@/src/lib/reports/managementPack';

/**
 * #766 — pure progress-billing arithmetic for the Billing tab. Figures arrive from `get_project_billing` net
 * of tax in the project's currency. Balances are derived in integer cents and never clamped (DD-PBL-9).
 * ⚑ Assessed to date and the gap use the management pack's own `pctOf`, so they ARE the pack's recognised to
 * date and unbilled for the current month — one formula, not two.
 */
export interface ProjectBillingFacts {
  currency: string;
  contractNet: number;
  workBilled: number;
  dpBilled: number;
  dpRecovered: number;
  notSubmitted: number;
  /** The latest assessment up to the org's current month, or null when none has been recorded. */
  assessment: { month: string; pctComplete: number } | null;
  /** Claimed quantity per BoQ line across live claims. */
  claimedByBoqItem: Record<string, number>;
  /** Quantity done to date per BoQ line in the latest assessment (absent = not measured). */
  assessedByBoqItem: Record<string, number>;
}

export interface ProjectBillingSummary extends ProjectBillingFacts {
  /** Down payment invoiced − recovered. */
  dpHeld: number;
  /** Net contract − billed to date. */
  remaining: number;
  /** Latest assessment % × net contract; null without an assessment. */
  assessedToDate: number | null;
  /** Assessed − billed ("work done, not yet billed"); null without an assessment. */
  unbilledWork: number | null;
}

const milli = (value: number): number => Math.round(value * 1000);

export function summarizeBilling(facts: ProjectBillingFacts): ProjectBillingSummary {
  const assessedCents = facts.assessment && facts.contractNet >= 0
    ? pctOf(toCents(facts.contractNet), facts.assessment.pctComplete)
    : null;
  return {
    ...facts,
    dpHeld: fromCents(toCents(facts.dpBilled) - toCents(facts.dpRecovered)),
    remaining: fromCents(toCents(facts.contractNet) - toCents(facts.workBilled)),
    assessedToDate: assessedCents === null ? null : fromCents(assessedCents),
    unbilledWork: assessedCents === null ? null : fromCents(assessedCents - toCents(facts.workBilled)),
  };
}

export function claimNet(gross: number, recovery: number): number {
  return fromCents(toCents(gross) - toCents(recovery));
}

export function remainingQuantity(boqQuantity: number, claimed: number): number {
  return (milli(boqQuantity) - milli(claimed)) / 1000;
}

/** DP ÷ contract × 100 to 3 decimals, capped at 100; null when either side is not positive. */
export function suggestedRecoveryPct(dpAmount: number, contractNet: number): number | null {
  if (!(dpAmount > 0) || !(contractNet > 0)) return null;
  return Math.min(100, Math.round((dpAmount / contractNet) * 100_000) / 1000);
}

/** Assessed − claimed per line (FR-PB-025), only where that is above zero. A pre-fill, not a rule. */
export function prefillFromAssessment(
  lineIds: readonly string[],
  assessed: Record<string, number>,
  claimed: Record<string, number>,
): Record<string, number> {
  const fill: Record<string, number> = {};
  for (const id of lineIds) {
    if (assessed[id] === undefined) continue;
    const left = milli(assessed[id]) - milli(claimed[id] ?? 0);
    if (left > 0) fill[id] = left / 1000;
  }
  return fill;
}
```

If `managementPack.ts`'s `pctOf` takes a different argument order or a `Cents` brand, adjust the two call sites
and the C1 expectation together — they must keep calling the pack's function, never a copy.

Verify GREEN: same command as C1. Expect: 9/9.

### Task C3 — test: billing DAL (RED) · AC-PB-008, AC-PB-009, AC-PB-019, AC-PB-020

Create `pmo-portal/src/lib/db/progressBilling.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import { attachClaimEvidence, createProgressClaim, getProjectBilling, recordProgressAssessment } from './progressBilling';

beforeEach(() => vi.clearAllMocks());

describe('progress billing DAL', () => {
  it('AC-PB-008 maps the billing summary, with the latest assessment and per-line quantities', async () => {
    h.rpc.mockResolvedValue({ data: {
      currency: 'IDR', contract_net: '1000000.00', work_billed: 200000, dp_billed: 200000, dp_recovered: 40000, not_submitted: 40000,
      assessment: { month: '2026-10-01', pct_complete: '60.00' },
      boq: [{ boq_item_id: 'b1', claimed_quantity: '5.000', assessed_quantity: '6.000' }, { boq_item_id: 'b2', claimed_quantity: 0, assessed_quantity: null }],
    }, error: null });
    expect(await getProjectBilling('p1')).toEqual({
      currency: 'IDR', contractNet: 1_000_000, workBilled: 200_000, dpBilled: 200_000, dpRecovered: 40_000, notSubmitted: 40_000,
      assessment: { month: '2026-10-01', pctComplete: 60 },
      claimedByBoqItem: { b1: 5, b2: 0 }, assessedByBoqItem: { b1: 6 },
    });
    expect(h.rpc).toHaveBeenCalledWith('get_project_billing', { p_project_id: 'p1' });
  });

  it('AC-PB-008 no assessment maps to null, never 0%', async () => {
    h.rpc.mockResolvedValue({ data: { currency: 'IDR', contract_net: 1, work_billed: 0, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: null, boq: [] }, error: null });
    expect((await getProjectBilling('p1'))?.assessment).toBeNull();
  });

  it('AC-PB-008 an invisible project is null, never a zero summary', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getProjectBilling('p1')).toBeNull();
  });

  it('AC-PB-008 a malformed summary is an error, never a fabricated figure', async () => {
    h.rpc.mockResolvedValue({ data: { currency: 'IDR', contract_net: 1, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: null, boq: [] }, error: null });
    await expect(getProjectBilling('p1')).rejects.toMatchObject({ code: 'billing-malformed' });
  });

  it('AC-PB-009 a billing claim sends quantities and scope, never money', async () => {
    h.rpc.mockResolvedValue({ data: 'claim-1', error: null });
    expect(await createProgressClaim({ projectId: 'p1', kind: 'progress', workOrderId: 'wo-1', lines: [{ boqItemId: 'b1', quantity: 4 }], recoverRemaining: true })).toBe('claim-1');
    expect(h.rpc).toHaveBeenCalledWith('create_progress_claim', { p_project_id: 'p1', p_kind: 'progress', p_work_order_id: 'wo-1', p_lines: [{ boq_item_id: 'b1', quantity: 4 }], p_recover_remaining: true });
  });

  it('AC-PB-009 a down payment claim sends amount and percentage only, and no work order when none is chosen', async () => {
    h.rpc.mockResolvedValue({ data: 'claim-2', error: null });
    await createProgressClaim({ projectId: 'p1', kind: 'down_payment', workOrderId: null, downPaymentAmount: 200000, recoveryPct: 20 });
    expect(h.rpc).toHaveBeenCalledWith('create_progress_claim', { p_project_id: 'p1', p_kind: 'down_payment', p_down_payment_amount: 200000, p_recovery_pct: 20 });
  });

  it('AC-PB-019 an assessment sends every line and the month, and returns the derived percent', async () => {
    h.rpc.mockResolvedValue({ data: '40.00', error: null });
    expect(await recordProgressAssessment({ projectId: 'p1', month: '2026-09-01', quantities: [{ boqItemId: 'b1', quantityToDate: 6 }, { boqItemId: 'b2', quantityToDate: 0 }], note: null })).toBe(40);
    expect(h.rpc).toHaveBeenCalledWith('record_progress_assessment', { p_project_id: 'p1', p_month: '2026-09-01', p_quantities: [{ boq_item_id: 'b1', quantity_to_date: 6 }, { boq_item_id: 'b2', quantity_to_date: 0 }] });
  });

  it('AC-PB-020 attaching evidence names the claim and the document', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await attachClaimEvidence('claim-1', 'doc-1');
    expect(h.rpc).toHaveBeenCalledWith('attach_claim_evidence', { p_claim_id: 'claim-1', p_document_id: 'doc-1' });
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/progressBilling.test.ts` — Expect: module not found.

### Task C4 — billing DAL (GREEN)

Create `pmo-portal/src/lib/db/progressBilling.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ProjectBillingFacts } from '@/src/lib/progressBilling';

/**
 * Progress-billing DAL (#766, migration 0250). BoQ lines are RLS-scoped table writes; an assessment goes
 * through the INVOKER `record_progress_assessment` (#765's rule); billing claims and evidence go ONLY through
 * definer RPCs (no client write grant exists); the summary is the INVOKER `get_project_billing`.
 * org_id is never sent from the client.
 */
export type BoqItemRow = Tables<'boq_items'>;
export type ProgressClaimRow = Tables<'progress_claims'>;
export type ProgressClaimLineRow = Tables<'progress_claim_lines'>;

export interface ClaimEvidenceRef {
  id: string;
  document_id: string;
  document_status: string;
  document_revision: string | null;
}

export interface ProgressClaimWithInvoice extends ProgressClaimRow {
  lines: ProgressClaimLineRow[];
  evidence: ClaimEvidenceRef[];
  /** The claim's invoice mirror (id = claim id), or null when not yet raised. */
  invoice: { si_number: string | null; status: string; amount: number | null } | null;
}

export interface BoqItemInput {
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  workOrderId: string | null;
}

export interface ProgressClaimInput {
  projectId: string;
  kind: 'down_payment' | 'progress';
  workOrderId: string | null;
  lines?: Array<{ boqItemId: string; quantity: number }>;
  downPaymentAmount?: number;
  recoveryPct?: number;
  recoverRemaining?: boolean;
}

export interface ProgressAssessmentInput {
  projectId: string;
  /** First day of the month, `YYYY-MM-01`. */
  month: string;
  /** Every BoQ line, with its quantity done to date (0 for none). */
  quantities: Array<{ boqItemId: string; quantityToDate: number }>;
  note: string | null;
}

/** Claims shown per project. A project bills monthly; 500 is years of claims and below PostgREST's 1000. */
const CLAIM_LIST_LIMIT = 500;

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

export async function listBoqItems(projectId: string): Promise<BoqItemRow[]> {
  const { data, error } = await supabase.from('boq_items').select('*')
    .eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) fail(error);
  return data ?? [];
}

export async function createBoqItem(projectId: string, input: BoqItemInput): Promise<BoqItemRow> {
  const { data, error } = await supabase.from('boq_items').insert({
    project_id: projectId, item_code: input.itemCode, description: input.description, unit: input.unit,
    quantity: input.quantity, rate: input.rate, work_order_id: input.workOrderId,
  }).select().single();
  if (error) fail(error);
  return data as BoqItemRow;
}

export async function updateBoqItem(id: string, input: BoqItemInput): Promise<void> {
  const { data, error } = await supabase.from('boq_items').update({
    item_code: input.itemCode, description: input.description, unit: input.unit,
    quantity: input.quantity, rate: input.rate, work_order_id: input.workOrderId,
  }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Bill of quantities line not found or you do not have permission to edit it.');
}

export async function deleteBoqItem(id: string): Promise<void> {
  const { data, error } = await supabase.from('boq_items').delete().eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Bill of quantities line not found or you do not have permission to delete it.');
}

export async function listProjectClaims(projectId: string): Promise<ProgressClaimWithInvoice[]> {
  const { data, error } = await supabase.from('progress_claims')
    .select('*, lines:progress_claim_lines(*), evidence:progress_claim_evidence(id,document_id,document_status,document_revision)')
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(CLAIM_LIST_LIMIT);
  if (error) fail(error);
  const claims = (data ?? []) as Array<ProgressClaimRow & { lines: ProgressClaimLineRow[]; evidence: ClaimEvidenceRef[] }>;
  if (claims.length === 0) return [];
  const { data: invoices, error: invoiceError } = await supabase.from('sales_invoices')
    .select('id,si_number,status,amount').in('id', claims.map((claim) => claim.id));
  if (invoiceError) fail(invoiceError);
  const byId = new Map((invoices ?? []).map((invoice) => [invoice.id, invoice]));
  return claims.map((claim) => {
    const invoice = byId.get(claim.id);
    return { ...claim, invoice: invoice ? { si_number: invoice.si_number, status: invoice.status, amount: invoice.amount } : null };
  });
}

/** Sends only what a person decides; the server copies rates and computes the recovery (DD-PBL-5). */
export async function createProgressClaim(input: ProgressClaimInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_progress_claim', {
    p_project_id: input.projectId,
    p_kind: input.kind,
    ...(input.workOrderId ? { p_work_order_id: input.workOrderId } : {}),
    ...(input.lines ? { p_lines: input.lines.map((line) => ({ boq_item_id: line.boqItemId, quantity: line.quantity })) } : {}),
    ...(input.downPaymentAmount !== undefined ? { p_down_payment_amount: input.downPaymentAmount } : {}),
    ...(input.recoveryPct !== undefined ? { p_recovery_pct: input.recoveryPct } : {}),
    ...(input.recoverRemaining !== undefined ? { p_recover_remaining: input.recoverRemaining } : {}),
  });
  if (error) fail(error);
  return data as string;
}

export async function withdrawProgressClaim(id: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_progress_claim', { p_id: id });
  if (error) fail(error);
}

export async function attachClaimEvidence(claimId: string, documentId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_claim_evidence', { p_claim_id: claimId, p_document_id: documentId });
  if (error) fail(error);
}

/** Returns the month's derived percent complete (DD-PBL-3). */
export async function recordProgressAssessment(input: ProgressAssessmentInput): Promise<number> {
  const { data, error } = await supabase.rpc('record_progress_assessment', {
    p_project_id: input.projectId,
    p_month: input.month,
    p_quantities: input.quantities.map((line) => ({ boq_item_id: line.boqItemId, quantity_to_date: line.quantityToDate })),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) fail(error);
  return Number(data);
}

export async function getProjectBilling(projectId: string): Promise<ProjectBillingFacts | null> {
  const { data, error } = await supabase.rpc('get_project_billing', { p_project_id: projectId });
  if (error) fail(error);
  if (data === null || data === undefined) return null;
  const raw = data as Record<string, unknown>;
  const num = (key: string): number => {
    const value = Number(raw[key]);
    if (raw[key] === null || raw[key] === undefined || !Number.isFinite(value)) {
      throw new AppError(`billing summary is missing ${key}`, 'billing-malformed');
    }
    return value;
  };
  const boq = Array.isArray(raw.boq)
    ? (raw.boq as Array<{ boq_item_id: string; claimed_quantity: unknown; assessed_quantity: unknown }>)
    : null;
  if (typeof raw.currency !== 'string' || boq === null) throw new AppError('billing summary is malformed', 'billing-malformed');
  const rawAssessment = raw.assessment as { month?: unknown; pct_complete?: unknown } | null | undefined;
  let assessment: ProjectBillingFacts['assessment'] = null;
  if (rawAssessment !== null && rawAssessment !== undefined) {
    const pct = Number(rawAssessment.pct_complete);
    if (typeof rawAssessment.month !== 'string' || !Number.isFinite(pct)) {
      throw new AppError('billing summary has a malformed assessment', 'billing-malformed');
    }
    assessment = { month: rawAssessment.month, pctComplete: pct };
  }
  return {
    currency: raw.currency,
    contractNet: num('contract_net'),
    workBilled: num('work_billed'),
    dpBilled: num('dp_billed'),
    dpRecovered: num('dp_recovered'),
    notSubmitted: num('not_submitted'),
    assessment,
    claimedByBoqItem: Object.fromEntries(boq.map((line) => [line.boq_item_id, Number(line.claimed_quantity)])),
    assessedByBoqItem: Object.fromEntries(boq
      .filter((line) => line.assessed_quantity !== null && line.assessed_quantity !== undefined)
      .map((line) => [line.boq_item_id, Number(line.assessed_quantity)])),
  };
}
```

Verify GREEN: same command as C3. Expect: 8/8.

### Task C5 — test: org down-payment item DAL (RED) · AC-PB-011

Create `pmo-portal/src/lib/db/orgs.downPaymentItem.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), eq: vi.fn(), from: vi.fn(),
  result: { data: [{ id: 'org-1', down_payment_item: 'DP-ITEM' }] as unknown[], error: null as null | { message: string } } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgDownPaymentItem, setOrgDownPaymentItem } from './orgs';
beforeEach(() => {
  vi.clearAllMocks();
  h.result.error = null;
  h.result.data = [{ id: 'org-1', down_payment_item: 'DP-ITEM' }];
  const builder = { select: h.select, update: h.update, eq: h.eq, limit: () => builder,
    then: (resolve: (value: typeof h.result) => unknown) => resolve(h.result) };
  h.from.mockReturnValue(builder); h.select.mockReturnValue(builder);
  h.update.mockReturnValue(builder); h.eq.mockReturnValue(builder);
});
it('AC-PB-011 reads the RLS-scoped down payment item', async () => {
  expect(await getOrgDownPaymentItem()).toBe('DP-ITEM');
  expect(h.select).toHaveBeenCalledWith('down_payment_item');
});
it('AC-PB-011 writes only that column to the one readable org', async () => {
  await setOrgDownPaymentItem(' DP-ITEM-2 ');
  expect(h.update).toHaveBeenCalledWith({ down_payment_item: 'DP-ITEM-2' });
  expect(h.eq).toHaveBeenCalledWith('id', 'org-1');
});
it('AC-PB-011 an item code over 140 characters makes no write', async () => {
  await expect(setOrgDownPaymentItem('x'.repeat(141))).rejects.toThrow(/140/);
  expect(h.update).not.toHaveBeenCalled();
});
it('AC-PB-011 a write RLS filtered to nothing is reported, not silently accepted', async () => {
  h.update.mockImplementation(() => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }));
  await expect(setOrgDownPaymentItem('DP-ITEM')).rejects.toThrow('Only an Admin can change the down payment item.');
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/orgs.downPaymentItem.test.ts` — Expect: import fails.

### Task C6 — org down-payment item DAL (GREEN) · AC-PB-011

Append to `pmo-portal/src/lib/db/orgs.ts` (it already imports `supabase`, `AppError` and `assertWriteLanded` for
the withholding-account pair; add any that are missing):

```ts
/** #766 — the ERPNext item that bills and recovers down payments (its income account is the advance account). */
export async function getOrgDownPaymentItem(): Promise<string | null> {
  const { data, error } = await supabase.from('organizations').select('down_payment_item').limit(1);
  if (error) throw new AppError(error.message, error.code);
  return data?.[0]?.down_payment_item ?? null;
}

/** Admin-only (RLS + column grant, 0250 §1); audited server-side. */
export async function setOrgDownPaymentItem(item: string | null): Promise<void> {
  const value = item?.trim() || null;
  if (value && value.length > 140) throw new Error('The down payment item code must be at most 140 characters.');
  const visible = await supabase.from('organizations').select('id');
  if (visible.error) throw new AppError(visible.error.message, visible.error.code);
  if (visible.data?.length !== 1) throw new Error('Exactly one organization must be readable to change its down payment item.');
  const { data, error } = await supabase.from('organizations').update({ down_payment_item: value })
    .eq('id', visible.data[0].id).select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, 'Only an Admin can change the down payment item.');
}
```

Verify GREEN: same command as C5. Expect: 4/4.

### Task C7 — test: repository (RED) · AC-PB-009, AC-PB-019

Create `pmo-portal/src/lib/repositories/progressBilling.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ clearOwnershipCache: vi.fn(), setDomainOwnership: vi.fn(), routeDomainWrite: vi.fn() }));
vi.mock('@/src/lib/db/progressBilling', () => ({
  listBoqItems: vi.fn(), createBoqItem: vi.fn(), updateBoqItem: vi.fn(), deleteBoqItem: vi.fn(),
  listProjectClaims: vi.fn(), createProgressClaim: vi.fn(), withdrawProgressClaim: vi.fn(), getProjectBilling: vi.fn(),
  attachClaimEvidence: vi.fn(), recordProgressAssessment: vi.fn(),
}));
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import * as dal from '@/src/lib/db/progressBilling';
import { repositories } from '@/src/lib/repositories';
import { AppError } from '@/src/lib/appError';

beforeEach(() => vi.clearAllMocks());

describe('progressBilling repository', () => {
  it('AC-PB-009 raising dispatches a sales-invoice create whose record id is the claim id', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    vi.mocked(dispatchDomainCommand).mockResolvedValue({ externalRecordId: 'ACC-SINV-1', canonical: { id: 'claim-1', si_number: 'ACC-SINV-1' } } as never);
    const result = await repositories.progressBilling.raiseInvoice(
      { claimId: 'claim-1', projectId: 'proj-1', customerId: 'cust-1' }, { id: 'session-intent', idempotencyKey: 'key-1' });
    expect(dispatchDomainCommand).toHaveBeenCalledWith('revenue', 'create',
      { erp_doc_kind: 'sales-invoice', projectId: 'proj-1', customerId: 'cust-1', id: 'claim-1' }, { idempotencyKey: 'key-1' });
    expect(result).toEqual({ id: 'claim-1', si_number: 'ACC-SINV-1' });
  });

  it('AC-PB-009 raising is refused without an ERP connection and never dispatches', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('pmo');
    await expect(repositories.progressBilling.raiseInvoice({ claimId: 'claim-1', projectId: 'proj-1', customerId: 'cust-1' }))
      .rejects.toBeInstanceOf(AppError);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('AC-PB-009 creating a claim passes the input to the claim RPC', async () => {
    vi.mocked(dal.createProgressClaim).mockResolvedValue('claim-2');
    const input = { projectId: 'proj-1', kind: 'progress' as const, workOrderId: null, lines: [{ boqItemId: 'b1', quantity: 4 }], recoverRemaining: false };
    expect(await repositories.progressBilling.createClaim(input)).toBe('claim-2');
    expect(dal.createProgressClaim).toHaveBeenCalledWith(input);
  });

  it('AC-PB-019 an assessment never dispatches anything', async () => {
    vi.mocked(dal.recordProgressAssessment).mockResolvedValue(40);
    expect(await repositories.progressBilling.recordAssessment({ projectId: 'proj-1', month: '2026-09-01', quantities: [], note: null })).toBe(40);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
});
```

In `pmo-portal/src/lib/repositories/index.test.ts`:
- In the `exposes one repository per entity` list, add `'progressBilling'` (the assertion sorts both sides).
- In the `orgSettings exposes its expected methods` list, add `'getDownPaymentItem'` and `'setDownPaymentItem'`.

The mocked module paths and the `dispatchCreate` call shape follow `src/lib/repositories/workOrder.test.ts` and the
existing sales-invoice repository test on `dev`; if `dispatchCreate` passes its arguments differently there, copy
that shape into the first expectation.

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/progressBilling.test.ts src/lib/repositories/index.test.ts`
Expect: fails.

### Task C8 — repository (GREEN) · AC-PB-009

In `pmo-portal/src/lib/repositories/types.ts`:
1. Add at the top with the other type imports:
   ```ts
   import type {
     BoqItemInput, BoqItemRow, ProgressAssessmentInput, ProgressClaimInput, ProgressClaimWithInvoice,
   } from '@/src/lib/db/progressBilling';
   import type { ProjectBillingFacts } from '@/src/lib/progressBilling';
   ```
2. After the `WorkOrderRepository` interface add:
   ```ts
   /** Progress billing (#766): BoQ, assessments (operational), billing claims + evidence, the summary. */
   export interface ProgressBillingRepository {
     listBoq(projectId: string): Promise<BoqItemRow[]>;
     createBoq(projectId: string, input: BoqItemInput): Promise<BoqItemRow>;
     updateBoq(id: string, input: BoqItemInput): Promise<void>;
     deleteBoq(id: string): Promise<void>;
     /** Records the month's quantities done to date; returns the derived percent. Never reaches the ERP. */
     recordAssessment(input: ProgressAssessmentInput): Promise<number>;
     listClaims(projectId: string): Promise<ProgressClaimWithInvoice[]>;
     /** Returns the new claim id. The server computes gross and recovery. */
     createClaim(input: ProgressClaimInput): Promise<string>;
     attachEvidence(claimId: string, documentId: string): Promise<void>;
     withdrawClaim(id: string): Promise<void>;
     /** Raise the claim's ERP invoice; the claim id IS the invoice's PMO record id (ADR-0077). */
     raiseInvoice(claim: { claimId: string; projectId: string; customerId: string }, intent?: CommandIntent): Promise<{ id: string; si_number: string }>;
     /** Null when the project is invisible — never a zero summary. */
     summary(projectId: string): Promise<ProjectBillingFacts | null>;
   }
   ```
3. In `interface Repositories`, after `workOrder: WorkOrderRepository;` add `  progressBilling: ProgressBillingRepository;`.
4. In `interface OrgSettingsRepository`, after `setWithholdingAccount(account: string | null): Promise<void>;` add:
   ```ts
     getDownPaymentItem(): Promise<string | null>;
     setDownPaymentItem(item: string | null): Promise<void>;
   ```

In `pmo-portal/src/lib/repositories/index.ts`:
1. Add `getOrgDownPaymentItem,` and `setOrgDownPaymentItem,` to the existing import list from `'@/src/lib/db/orgs'`.
2. Add:
   ```ts
   import {
     listBoqItems, createBoqItem, updateBoqItem, deleteBoqItem, recordProgressAssessment,
     listProjectClaims, createProgressClaim, attachClaimEvidence, withdrawProgressClaim, getProjectBilling,
   } from '@/src/lib/db/progressBilling';
   ```
3. Add `ProgressBillingRepository` to the `import type { … } from './types'` list and to the `export type { … }` list.
4. After the `const workOrder: WorkOrderRepository = { … };` block add:
   ```ts
   /**
    * Progress billing (#766). Assessments are operational and never dispatch. Raising a billing claim's invoice
    * dispatches a sales-invoice CREATE whose record id is the CLAIM id, so the outbox's one-in-flight-per-record
    * rule makes a claim mint at most one ERP invoice. The body is built server-side from the claim.
    */
   const progressBilling: ProgressBillingRepository = {
     listBoq: (projectId) => wrap(() => listBoqItems(projectId)),
     createBoq: (projectId, input) => wrap(() => createBoqItem(projectId, input)),
     updateBoq: (id, input) => wrap(() => updateBoqItem(id, input)),
     deleteBoq: (id) => wrap(() => deleteBoqItem(id)),
     recordAssessment: (input) => wrap(() => recordProgressAssessment(input)),
     listClaims: (projectId) => wrap(() => listProjectClaims(projectId)),
     createClaim: (input) => wrap(() => createProgressClaim(input)),
     attachEvidence: (claimId, documentId) => wrap(() => attachClaimEvidence(claimId, documentId)),
     withdrawClaim: (id) => wrap(() => withdrawProgressClaim(id)),
     raiseInvoice: (claim, intent) =>
       routeDomainWrite('revenue') === 'external'
         ? dispatchCreate(
             'revenue',
             { erp_doc_kind: 'sales-invoice', projectId: claim.projectId, customerId: claim.customerId },
             { id: claim.claimId, idempotencyKey: intent?.idempotencyKey ?? crypto.randomUUID() },
           ).then((res) => ({ id: String(res.canonical.id), si_number: String(res.canonical.si_number ?? '') }))
         : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),
     summary: (projectId) => wrap(() => getProjectBilling(projectId)),
   };
   ```
5. In `const orgSettings`, after the `setWithholdingAccount` line add:
   ```ts
     getDownPaymentItem: () => wrap(() => getOrgDownPaymentItem()),
     setDownPaymentItem: (item) => wrap(() => setOrgDownPaymentItem(item)),
   ```
6. In `export const repositories`, after `workOrder,` add `  progressBilling,`.

Verify GREEN: same command as C7. Expect: all pass.

### Task C9 — test: hooks (RED) · AC-PB-008, AC-PB-019

Create `pmo-portal/src/hooks/useProgressBilling.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const h = vi.hoisted(() => ({ withdrawClaim: vi.fn(), raiseInvoice: vi.fn(), recordAssessment: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { progressBilling: {
  withdrawClaim: h.withdrawClaim, raiseInvoice: h.raiseInvoice, recordAssessment: h.recordAssessment,
} } }));
import { useProgressBillingMutations } from './useProgressBilling';

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useProgressBillingMutations('p1'), { wrapper });
  const keys = () => spy.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
  return { result, keys };
}

describe('useProgressBillingMutations', () => {
  it('AC-PB-008 a claim write refreshes the claims, the bill of quantities and the billing summary', async () => {
    h.withdrawClaim.mockResolvedValue(undefined);
    const { result, keys } = setup();
    await act(async () => { await result.current.withdrawClaim.mutateAsync('k1'); });
    expect(keys()).toEqual(expect.arrayContaining([
      JSON.stringify(['boq-items', 'org-1', 'p1']),
      JSON.stringify(['progress-claims', 'org-1', 'p1']),
      JSON.stringify(['project-billing', 'org-1', 'p1']),
    ]));
  });

  it('AC-PB-009 a failed raise still refreshes the claims — the ERP may have committed before the error', async () => {
    h.raiseInvoice.mockRejectedValue(new Error('ERP unreachable'));
    const { result, keys } = setup();
    await act(async () => {
      await expect(result.current.raiseInvoice.mutateAsync({ claimId: 'k1', customerId: 'c1' })).rejects.toThrow('ERP unreachable');
    });
    expect(keys()).toContain(JSON.stringify(['progress-claims', 'org-1', 'p1']));
    expect(h.raiseInvoice).toHaveBeenCalledWith({ claimId: 'k1', projectId: 'p1', customerId: 'c1' }, undefined);
  });

  it('AC-PB-019 an assessment refreshes the billing summary and the management pack', async () => {
    h.recordAssessment.mockResolvedValue(40);
    const { result, keys } = setup();
    await act(async () => { await result.current.recordAssessment.mutateAsync({ month: '2026-09-01', quantities: [], note: null }); });
    expect(h.recordAssessment).toHaveBeenCalledWith({ projectId: 'p1', month: '2026-09-01', quantities: [], note: null });
    expect(keys()).toEqual(expect.arrayContaining([JSON.stringify(['project-billing', 'org-1', 'p1']), JSON.stringify(['managementPack'])]));
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/hooks/useProgressBilling.test.tsx` — Expect: module not found.

### Task C10 — hooks (GREEN) · AC-PB-008

Create `pmo-portal/src/hooks/useProgressBilling.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { BoqItemInput, ProgressAssessmentInput, ProgressClaimInput } from '@/src/lib/db/progressBilling';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** Progress billing reads + writes for one project (#766). Keys carry org_id + project_id. */
export function useBoqItems(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['boq-items', orgId, projectId], queryFn: () => repositories.progressBilling.listBoq(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

export function useProjectClaims(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['progress-claims', orgId, projectId], queryFn: () => repositories.progressBilling.listClaims(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

/** Resolves to null for an invisible project — the card renders that as an error, never as zeros. */
export function useProjectBilling(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['project-billing', orgId, projectId], queryFn: () => repositories.progressBilling.summary(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

/**
 * Every write refreshes the BoQ, the claims and the summary — one view of one fact. An assessment also
 * refreshes the management pack (it reads the same percent). Raising refreshes on SETTLE: a lost response can
 * still mean the ERP committed the invoice.
 */
export function useProgressBillingMutations(projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['boq-items', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['progress-claims', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['project-billing', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['salesInvoices'] });
  };
  const createBoq = useMutation({ mutationFn: (input: BoqItemInput) => repositories.progressBilling.createBoq(projectId, input), onSuccess: invalidate });
  const updateBoq = useMutation({ mutationFn: ({ id, input }: { id: string; input: BoqItemInput }) => repositories.progressBilling.updateBoq(id, input), onSuccess: invalidate });
  const deleteBoq = useMutation({ mutationFn: (id: string) => repositories.progressBilling.deleteBoq(id), onSuccess: invalidate });
  const recordAssessment = useMutation({
    mutationFn: (input: Omit<ProgressAssessmentInput, 'projectId'>) => repositories.progressBilling.recordAssessment({ ...input, projectId }),
    onSuccess: () => { invalidate(); void qc.invalidateQueries({ queryKey: ['managementPack'] }); },
  });
  const createClaim = useMutation({ mutationFn: (input: Omit<ProgressClaimInput, 'projectId'>) => repositories.progressBilling.createClaim({ ...input, projectId }), onSuccess: invalidate });
  const attachEvidence = useMutation({
    mutationFn: ({ claimId, documentId }: { claimId: string; documentId: string }) => repositories.progressBilling.attachEvidence(claimId, documentId),
    onSuccess: invalidate,
  });
  const withdrawClaim = useMutation({ mutationFn: (id: string) => repositories.progressBilling.withdrawClaim(id), onSuccess: invalidate });
  const raiseInvoice = useMutation({
    mutationFn: ({ claimId, customerId, intent }: { claimId: string; customerId: string; intent?: CommandIntent }) =>
      repositories.progressBilling.raiseInvoice({ claimId, projectId, customerId }, intent),
    onSettled: invalidate,
  });
  return { createBoq, updateBoq, deleteBoq, recordAssessment, createClaim, attachEvidence, withdrawClaim, raiseInvoice };
}
```

`['managementPack']` is the prefix of #765's `useManagementPack` query key; confirm with
`grep -n "queryKey" pmo-portal/src/hooks/useManagementPack.ts`.

Verify GREEN: same command as C9. Expect: 3/3.

### Task C11 — test: policy (RED) · AC-PB-008

Create `pmo-portal/src/auth/policy.progressBilling.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const as = (realRole: Role) => ({ realRole });

describe('progress billing policy', () => {
  it.each([['Admin', true], ['Executive', true], ['Project Manager', true], ['Finance', true], ['Engineer', false]] as const)(
    'AC-PB-008 %s maintains the bill of quantities and sees billing: %s', (role, allowed) => {
      expect(can('create', 'boqItem', as(role))).toBe(allowed);
      expect(can('edit', 'boqItem', as(role))).toBe(allowed);
      expect(can('delete', 'boqItem', as(role))).toBe(allowed);
      expect(can('view', 'progressClaim', as(role))).toBe(allowed);
    });

  it.each([['Admin', true], ['Finance', true], ['Executive', false], ['Project Manager', false], ['Engineer', false]] as const)(
    'AC-PB-008 %s creates, evidences, raises and withdraws billing claims: %s', (role, allowed) => {
      expect(can('create', 'progressClaim', as(role))).toBe(allowed);
      expect(can('transition', 'progressClaim', as(role))).toBe(allowed);
    });

  it("AC-PB-008 assessing reuses #765's rule: the project's own PM, or Finance rank and above", () => {
    const record = { project_manager_id: 'pm-1' };
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', currentUserId: 'pm-1', record })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', currentUserId: 'pm-2', record })).toBe(false);
    expect(can('edit', 'projectProgress', { realRole: 'Finance', currentUserId: 'f-1', record })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Engineer', currentUserId: 'pm-1', record })).toBe(false);
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/auth/policy.progressBilling.test.ts` — Expect: the first two fail.

### Task C12 — policy (GREEN) · AC-PB-008

In `pmo-portal/src/auth/policy.ts`:
1. In the `Entity` union, after `  | 'workOrder'` add `  | 'boqItem'` and `  | 'progressClaim'`.
2. In `POLICY`, after the `workOrder: { … },` entry add:
   ```ts
     /** Bill of quantities (#766) — mirrors 0250's boq_items policies: the work-order writer set. */
     boqItem: {
       view: allow(MASTER_DATA),
       create: allow(MASTER_DATA),
       edit: allow(MASTER_DATA),
       delete: allow(MASTER_DATA),
     },
     /**
      * Billing claims (#766). view = the revenue read set; create (raise included) and transition (evidence,
      * withdraw) = REVENUE_WRITE, mirroring the claim RPCs and the dispatch's revenue money-write roles.
      * Assessing progress is #765's `projectProgress.edit`, unchanged. The server is the authority.
      */
     progressClaim: {
       view: allow(MASTER_DATA),
       create: allow(REVENUE_WRITE),
       transition: allow(REVENUE_WRITE),
     },
   ```

`MASTER_DATA` must equal Admin/Executive/Project Manager/Finance and `REVENUE_WRITE` Admin/Finance on `dev`
(`grep -n "const MASTER_DATA\|const REVENUE_WRITE" pmo-portal/src/auth/policy.ts`). If either differs, state the
four (or two) roles explicitly with `allow([...])` rather than reusing a set that says something else.

Verify GREEN: same command as C11. Expect: pass.

### Task C13 — test: Admin setting (RED) · AC-PB-011

Create `pmo-portal/pages/admin/OrgDownPaymentItem.test.tsx`:

```tsx
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getDownPaymentItem: h.get, setDownPaymentItem: h.set } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgDownPaymentItem from './OrgDownPaymentItem';
beforeEach(() => { vi.clearAllMocks(); h.canManage = true; h.get.mockResolvedValue(null); h.set.mockResolvedValue(undefined); });
function renderSetting() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgDownPaymentItem /></ToastProvider>
  </QueryClientProvider>);
}
it('AC-PB-011 an Admin sets the down payment item', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Down payment item'), 'PB-DOWN-PAYMENT');
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(h.set).toHaveBeenCalledWith('PB-DOWN-PAYMENT');
});
it('AC-PB-011 Finance reads the item but has no writer', async () => {
  h.canManage = false; h.get.mockResolvedValue('PB-DOWN-PAYMENT');
  renderSetting();
  expect(await screen.findByText('PB-DOWN-PAYMENT')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
});
it('AC-PB-011 a refused write keeps the value editable and shows why', async () => {
  h.set.mockRejectedValue(new Error('Only an Admin can change the down payment item.'));
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Down payment item'), 'PB-DOWN-PAYMENT');
  await user.click(screen.getByRole('button', { name: 'Save item' }));
  expect(await screen.findByText('Only an Admin can change the down payment item.')).toBeInTheDocument();
  expect(screen.getByLabelText('Down payment item')).toHaveValue('PB-DOWN-PAYMENT');
});
it('AC-PB-011 a failed read offers retry and no writer', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue('PB-DOWN-PAYMENT');
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the down payment item")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByLabelText('Down payment item')).toHaveValue('PB-DOWN-PAYMENT');
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/admin/OrgDownPaymentItem.test.tsx` — Expect: module not found.

### Task C14 — Admin setting (GREEN) · AC-PB-011

Create `pmo-portal/pages/admin/OrgDownPaymentItem.tsx` (English-only, as its sibling `OrgWithholdingAccount`):

```tsx
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, TextField, ListState, FieldError, useToast } from '@/src/components/ui';

const ITEM_QUERY_KEY = 'org-down-payment-item';

/** #766 / ADR-0077 — the ERPNext item used to bill and recover down payments. Its Item Default income account
 *  must be the customer-advance (liability) account; PMO cannot see that, so the helper says it. */
export default function OrgDownPaymentItem() {
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const queryKey = [ITEM_QUERY_KEY, currentUser?.org_id];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getDownPaymentItem(), enabled: !!currentUser });
  useEffect(() => { if (query.isSuccess) setDraft(query.data ?? ''); }, [query.data, query.isSuccess]);
  const mutation = useMutation({ mutationFn: (value: string | null) => repositories.orgSettings.setDownPaymentItem(value),
    onSuccess: () => { void qc.invalidateQueries({ queryKey }); toast('Down payment item saved', undefined, 'success'); },
    onError: (err) => { const classified = classifyMutationError(err); setError(classified.detail || classified.headline); },
  });
  return <section aria-labelledby="down-payment-item-heading">
    <h2 id="down-payment-item-heading" className="text-[15px] font-semibold">Down payments</h2>
    <p className="mt-1 text-[13px] text-muted-foreground">The ERPNext item used to bill a down payment and to recover it from billing claims. In ERPNext its income account must be the customer-advance account, or down payments will book as revenue.</p>
    <div className="mt-3 max-w-md">
      {query.isError ? <ListState variant="error" title="Couldn't load the down payment item" onRetry={() => void query.refetch()} />
        : query.isPending ? <ListState variant="loading" rows={1} />
        : canManage ? <form onSubmit={(event) => { event.preventDefault(); setError(undefined); mutation.mutate(draft.trim() || null); }} className="space-y-3">
          <TextField label="Down payment item" value={draft} onChange={setDraft} maxLength={140}
            disabled={mutation.isPending} helper="Enter the exact ERPNext item code. Leave blank to turn down payment billing off." />
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" variant="outline" disabled={mutation.isPending || draft.trim() === (query.data ?? '')}>Save item</Button>
        </form> : <p className="text-[13px]">{query.data ?? 'Not configured'}<span className="ml-2 text-muted-foreground">Only an Admin can change this.</span></p>}
    </div>
  </section>;
}
```

Mirror `pages/admin/OrgWithholdingAccount.tsx` on `dev` for the exact `TextField`/`ListState`/`toast` signatures; the
labels and strings above are the contract the test binds to.

In `pmo-portal/pages/Administration.tsx`: add `import OrgDownPaymentItem from './admin/OrgDownPaymentItem';` next to
the `OrgWithholdingAccount` import, and render `<OrgDownPaymentItem />` on the line after `<OrgWithholdingAccount />`.

Verify GREEN: same command as C13. Expect: 4/4.
