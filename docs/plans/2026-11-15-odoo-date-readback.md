# Odoo ledger date read-back — implementation plan (#2290)

**Status: draft for owner sign-off. No build has started.** Money tier: Director-dispatched, ships alone with the three reviews (spec, code quality, security). Dev is the ceiling; no production step is part of this plan.

**Who / doing what / wrong outcome (the defect this plan fixes).** A person in an Odoo-connected organisation posts a vendor bill, a customer invoice, a vendor payment or a customer receipt whose date sits in a period the ledger has locked. Odoo accepts the post and moves the accounting date (bed evidence: `supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts` on `spike/accountants-desk-odoo-facts`, facts `V-ACD4.post-entry-dated-inside-lock`, `V-ACD4.post-untaxed-invoice-dated-inside-lock`, `V-ACD4.reversal-dated-inside-lock`). PMO keeps showing the date the person typed, so PMO's period totals and the ledger's disagree with no message. For a customer receipt it is worse: the shipped match refuses the posted receipt as "does not match the command", and the screen tells the person to record it again, which invites a second receipt for money that is already in the ledger.

**Executor note:** builders work in their own worktree off `origin/dev`, push branches only, and run the CLAUDE.md local gate (`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, `deno test` for touched edge functions, the touched pgTAP files under `scripts/with-db-lock.sh`). Bed tasks run under `scripts/with-odoo-lock.sh` (lock order `odoo → erpnext → db → test`). Prior art to read first: ADR-0048 (the ledger is the oracle), ADR-0058 (the fenced outbox), ADR-0082 (money header shape), `docs/money-path-primer.md`.

## 1. What is read back today (dev at `f5740e7e9`)

| Path | Sent date field | Read back | Compared with what was sent | Gap |
|---|---|---|---|---|
| Vendor bill | `invoice_date` (`pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts:87`, `today` when PMO had none) | `BILL_FIELDS` = name, state, move_type, amount_total, amount_residual, ref, invoice_date, currency_id, write_date (`pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts:352`); tax and product lines (`procurementAdapter.ts:368-369`) | Total only (`pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.ts:42`); cost account (`billReadBack.ts:43`) | The accounting `date` is never read. `invoice_date` and `ref` are mirrored as read (`billReadBack.ts:48-49`) but never compared. |
| Customer invoice | `invoice_date` (`pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts:119`), `ref` from `resolveClientReference` (`invoiceBody.ts:116`) | `MOVE_FIELDS` = name, state, move_type, partner_id, amount_untaxed/tax/total/residual, ref, invoice_date, currency_id, write_date (`pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts:50`); product lines (`revenueAdapter.ts:76-82`) | Total (`pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts:64`), cost and advance accounts (`invoiceReadBack.ts:65-66`) | The accounting `date` is never read. `invoice_date` and `ref` are mirrored (`invoiceReadBack.ts:78-79`) but never compared. |
| Vendor payment | `date` (`pmo-portal/src/lib/adapterSeam/odoo/purchase/paymentBody.ts:59`) | `PAYMENT_FIELDS` = name, state, payment_type, partner_type, amount, move_id, reconciled_bill_ids, write_date (`procurementAdapter.ts:422`); the bill's residual (`procurementAdapter.ts:479`) | Amount before settling (`procurementAdapter.ts:475`) | No date is read at all; the canonical (`procurementAdapter.ts:482-485`) carries none. |
| Customer receipt | `payment_date` on the register wizard (`revenueAdapter.ts:288`) or `date` on a direct create (`revenueAdapter.ts:297`) | `PAYMENT_FIELDS` include `date` (`revenueAdapter.ts:51`); the invoice is re-read after (`revenueAdapter.ts:197`) | `payment.date === expected.date` inside `paymentMatches` (`revenueAdapter.ts:149`) | A moved date fails the whole match and is refused as `receipt-does-not-match-command` (`revenueAdapter.ts:167,194`; the recovery path `revenueAdapter.ts:249` too) after Odoo has posted it. The canonical writes PMO's date (`revenueAdapter.ts:212`), never the ledger's. |
| Journal and reversal | — | No Odoo journal-entry or reversal command is shipped on dev: `grep -rn "move_type: 'entry'\|account.move.reversal" pmo-portal/src supabase/functions` (non-test) finds only fakes and fixtures. The accountant's desk is design-only (`origin/docs/accountants-desk-design-fwzy4j`). | — | This plan ships the shared comparison as a pure module with a contract test the desk's journal and reversal adapters must call (Task 9). |

`pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.ts:42` and `revenue/invoiceReadBack.ts:35` are where the start-point lines in the brief land: the bill total comparison and the invoice `InvoiceExpect` interface. The adapter registry `supabase/functions/adapter-dispatch/odooAdapters.ts:140` wires the procurement and revenue adapters; it reads nothing back itself and is not changed.

## 2. Design

**One rule, four call sites.** A new pure module `pmo-portal/src/lib/adapterSeam/odoo/ledgerReadBack.ts` compares what PMO sent with what the posted Odoo record says and returns the differences as codes. Each settle step (`settleBill`, `settleInvoice`, `settlePayment`, `settleReceipt`) reads Odoo's accounting `date` (the field the lock moves; `invoice_date` is the document date and is left as Odoo has it) and passes it with the sent values.

**What "hold" means here.** The document already exists and is posted in Odoo; PMO must not pretend it does not. So the command completes and the mirror writes the ledger's facts, and the record carries the attention code `ledger-date-differs` (or `ledger-reference-differs`). That is the hold:
- the screen shows the plain reason "Posted in the ledger on {ledger date}, not {sent date}. The period you chose is closed in the ledger." beside the ledger's date;
- a bill with any attention code is already not payable (`supabase/functions/adapter-dispatch/odooPaymentGate.ts:37`), so a re-dated bill holds its payment until a person looks;
- the outbox row is NOT moved to `held`: `held` means "PMO cannot tell whether Odoo already made it" (`pmo-portal/src/components/revenue/OdooOutcome.tsx:17`), which is false here and would stop the mirror write the issue asks for. (Owner question 1.)

**Where the ledger's date lives.** One nullable column `erp_posting_date date` on `procurement_invoices`, `sales_invoices`, `payments` and `incoming_payments`, written only by the mirror writers. The entered date stays as the person typed it (it is the document's own date); the screens show the ledger's date whenever `erp_posting_date` is set and differs. No column is recomputed.

**Totals.** The bill and invoice totals are already compared; the payment amount is checked before settling. This plan adds the reference comparison for bills and invoices and keeps the total checks where they are; it does not add a second total check.

**Receipts.** The date leaves `paymentMatches` (it is not identity: a lock moves it). Identity stays partner, amount, invoice and reconciliation. After adopt, a differing date is flagged, not refused. The recovery composite's date (`supabase/functions/adapter-dispatch/odooRevenueOutbox.ts:200`) stays as a PMO-side intent check and is untouched.

**Legacy outbox rows.** A bill or invoice row persisted before this ships has no stored sent date. Its read-back compares nothing for date and flags nothing (the shipped behaviour); it never invents an expectation. A new row stores `odoo_expected_date` and `odoo_expected_ref` beside `odoo_expected_total`, as derived keys outside the payload digest.

**Scale.** No extra Odoo request: `date` is added to reads that already happen. One column per table, no index (never filtered on).

## 3. Migration

`supabase/migrations/NNNN_odoo_ledger_posting_date.sql` + `supabase/migrations/rollback/NNNN_odoo_ledger_posting_date_down.sql`. NNNN is the next free number at build time (dev head is `0876`; `0877` if free; on collision use `scripts/renumber-migration.sh <old> <new>`). It adds four columns and widens one CHECK; it changes no function. Owner question 2 asks whether the columns are wanted or whether the ledger date may overwrite the entered date instead (no migration then for the date, but the CHECK still needs widening for the invoice code).

## 4. Tasks (test first; each 2–5 minutes)

### Task 1 — bed facts for payments (AC-ODR-006 discovery)

1.1. Append to `supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts` on a branch from `origin/spike/accountants-desk-odoo-facts`, inside the `V-ACD4` block after the `tax_lock_date` cases, a case that, with `fiscalyear_lock_date` set to `2025-01-31`, creates and posts an outbound supplier `account.payment` with `date: '2025-01-20'` and an inbound customer payment through `account.payment.register` with `payment_date: '2025-01-20'`, then reads `['date', 'state']` from the payment and `['date']` from its `move_id`:

```ts
const viewPay = async (id: number) => {
  const [p] = await odoo<Row[]>('account.payment', 'read', { ids: [id], fields: ['date', 'state', 'move_id'] });
  const [m] = p.move_id ? await odoo<Row[]>('account.move', 'read', { ids: [p.move_id[0]], fields: ['date'] }) : [null];
  return { paymentDate: p.date, moveDate: m?.date ?? null, state: p.state };
};
fact('V-ACD4.post-supplier-payment-dated-inside-lock', { asked: '2025-01-20', after: await viewPay(supplierPaymentId) });
fact('V-ACD4.post-customer-receipt-dated-inside-lock', { asked: '2025-01-20', after: await viewPay(customerPaymentId) });
```

1.2. With Director-granted bed access, run `scripts/with-odoo-lock.sh deno test --allow-env --allow-net --allow-read --allow-run supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts`. Record both facts in `docs/research/2026-11-15-odoo-lock-date-payments.md`: which of `account.payment.date` and `move_id.date` moved. **If neither moved, or the post was refused, stop and tell the Director:** the payment tasks (6, 7) change to "read and mirror only".

### Task 2 — the pure comparison (AC-ODR-001, AC-ODR-002)

2.1. Write `pmo-portal/src/lib/adapterSeam/odoo/ledgerReadBack.test.ts` first:

```ts
import { describe, expect, it } from 'vitest';
import { compareLedger } from './ledgerReadBack.ts';

describe('AC-ODR-001 a ledger date that differs from the sent date is named', () => {
  it('a moved date returns ledger-date-differs and the ledger date', () => {
    expect(compareLedger({ date: '2025-01-20', ref: 'INV-1' }, { date: '2025-02-01', ref: 'INV-1' }))
      .toEqual({ codes: ['ledger-date-differs'], postingDate: '2025-02-01' });
  });
  it('an equal date and reference return nothing', () => {
    expect(compareLedger({ date: '2025-01-20', ref: 'INV-1' }, { date: '2025-01-20', ref: 'INV-1' })).toEqual({ codes: [], postingDate: '2025-01-20' });
  });
  it('an unreadable ledger date is ledger-date-unreadable, never a match', () => {
    expect(compareLedger({ date: '2025-01-20' }, { date: false })).toEqual({ codes: ['ledger-date-unreadable'], postingDate: null });
  });
  it('no sent date (a legacy outbox row) compares no date', () => {
    expect(compareLedger({ date: null }, { date: '2025-02-01' })).toEqual({ codes: [], postingDate: '2025-02-01' });
  });
});

describe('AC-ODR-002 a reference Odoo changed is named', () => {
  it('a different ref returns ledger-reference-differs', () => {
    expect(compareLedger({ date: '2025-01-20', ref: 'INV-1' }, { date: '2025-01-20', ref: 'INV-2' }).codes).toEqual(['ledger-reference-differs']);
  });
  it('a ref PMO did not send is not compared', () => {
    expect(compareLedger({ date: '2025-01-20' }, { date: '2025-01-20', ref: 'anything' }).codes).toEqual([]);
  });
});
```

2.2. Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/ledgerReadBack.test.ts`; expect RED (module missing).

2.3. Create `pmo-portal/src/lib/adapterSeam/odoo/ledgerReadBack.ts`:

```ts
/**
 * What PMO sent against what the posted Odoo record says (#2290), pure. Odoo moves the accounting `date` of a post dated inside a
 * locked period instead of refusing it; the ledger is the oracle (ADR-0048), so its date is returned to be mirrored and the
 * difference is named for a person. Nothing is overwritten in Odoo or reversed.
 */
export type LedgerCode = 'ledger-date-differs' | 'ledger-date-unreadable' | 'ledger-reference-differs';
export interface LedgerSent { date: string | null; ref?: string | null }
export interface LedgerRead { date: unknown; ref?: unknown }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => (typeof v === 'string' && ISO.test(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function compareLedger(sent: LedgerSent, read: LedgerRead): { codes: LedgerCode[]; postingDate: string | null } {
  const postingDate = day(read.date);
  const codes: LedgerCode[] = [];
  if (sent.date !== null) {
    if (postingDate === null) codes.push('ledger-date-unreadable');
    else if (postingDate !== sent.date) codes.push('ledger-date-differs');
  }
  if (text(sent.ref ?? null) !== null && text(read.ref) !== text(sent.ref ?? null)) codes.push('ledger-reference-differs');
  return { codes, postingDate };
}
```

2.4. Rerun 2.2; expect GREEN.

### Task 3 — the bill read-back (AC-ODR-003)

3.1. In `pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.test.ts` add:

```ts
describe('AC-ODR-003 a bill Odoo re-dated is mirrored on the ledger date and needs attention', () => {
  it('flags ledger-date-differs and carries erp_posting_date', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, date: '2027-01-01' } }, { ...EXPECT, date: '2026-12-05', ref: 'INV-77' });
    expect(c).toMatchObject({ erp_posting_date: '2027-01-01', odoo_outcome: 'needs-attention', odoo_attention: ['ledger-date-differs'] });
  });
  it('an unmoved bill carries its posting date and no attention', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, date: '2026-12-05' } }, { ...EXPECT, date: '2026-12-05', ref: 'INV-77' });
    expect(c).toMatchObject({ erp_posting_date: '2026-12-05' });
    expect(c).not.toHaveProperty('odoo_outcome');
  });
});
```

3.2. Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/purchase/billReadBack.test.ts`; expect RED.

3.3. In `billReadBack.ts`: add `date?: unknown` to `BillRead['move']`; add `date?: string | null; ref?: string | null` to `BillExpect`; after line 43 add

```ts
  const ledger = compareLedger({ date: expect.date ?? null, ref: expect.ref ?? null }, { date: move.date, ref: move.ref });
  attention.push(...ledger.codes);
```

and add `erp_posting_date: ledger.postingDate,` to the returned record after `invoice_date`. Import `compareLedger` from `../ledgerReadBack.ts`. Rerun 3.2; expect GREEN (existing cases stay green: `EXPECT` has no date, so no date is compared).

3.4. In `procurementAdapter.ts:351-352` add `date?: unknown` to `BillRow` and `'date'` to `BILL_FIELDS`. In `pushBill` (`procurementAdapter.ts:390-393`) build the expectation from the body actually sent:

```ts
  const expect: BillExpect = { total: expectedBillTotal(input, ctx.taxes), costAccountId: ctx.costAccountId, date: String(body.invoice_date), ref: typeof body.ref === 'string' ? body.ref : null };
```

3.5. Persist it: in `supabase/functions/adapter-dispatch/odooMoneyOutbox.ts` `billCompositePayload` (`:114-117`) add `odoo_expected_date` and `odoo_expected_ref` from the dry-built body (call `buildBillBody(input, bill)` there and read `invoice_date`/`ref`); add both keys to `DERIVED_KEYS` (`:121`); extend `billExpectOf` (`:122-125`) to pass `date: typeof p.odoo_expected_date === 'string' ? p.odoo_expected_date : null, ref: typeof p.odoo_expected_ref === 'string' ? p.odoo_expected_ref : null`.

3.6. Add to `pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.test.ts` a case `AC-ODR-003 settleBill reads the accounting date` that makes the fake return `date: '2027-01-01'` for the posted bill and asserts the canonical's `odoo_attention` contains `ledger-date-differs`. Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/procurementAdapter.test.ts src/lib/adapterSeam/odoo/purchase/billReadBack.test.ts`; GREEN. Add an `AC-ODR-003` case to `supabase/functions/adapter-dispatch/odooMoneyOutbox.test.ts` asserting a new bill row persists `odoo_expected_date`/`odoo_expected_ref` and a legacy row without them yields `date: null`. Run `deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooMoneyOutbox.test.ts supabase/functions/adapter-dispatch/odooVendorPaymentGate.served.test.ts`.

### Task 4 — the invoice read-back (AC-ODR-004)

4.1. In `pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.test.ts` add `describe('AC-ODR-004 an invoice Odoo re-dated ...')` with a move carrying `date: '2027-01-01'` and expect `{ invoice_date: <as read>, erp_posting_date: '2027-01-01', odoo_attention: 'ledger-date-differs' }`, plus one with an equal date expecting `odoo_attention: null`. Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/revenue/invoiceReadBack.test.ts`; RED.

4.2. In `invoiceReadBack.ts`: add `date?: unknown` to `InvoiceRead['move']`; add `date?: string | null; ref?: string | null` to `InvoiceExpect` (`:27-34`); extend `InvoiceAttention` (`:35`) with `'ledger-date-differs' | 'ledger-date-unreadable' | 'ledger-reference-differs'`; compute `const ledger = compareLedger({ date: expect.date ?? null, ref: expect.ref ?? null }, { date: move.date, ref: move.ref });` and place the date codes in the one-reason order after `money-unreadable` and before `cost-account-missing` (a moved period is what a person should look at first once the money is readable):

```ts
  const attention: InvoiceAttention | null = !sane ? 'money-unreadable'
    : ledger.codes.includes('ledger-date-differs') ? 'ledger-date-differs'
    : ledger.codes.includes('ledger-date-unreadable') ? 'ledger-date-unreadable'
    : costAccount.outcome === 'needs-attention' ? 'cost-account-missing'
    : advanceAccount.outcome === 'needs-attention' ? 'advance-account-mismatch'
    : mismatch ? 'total-mismatch'
    : ledger.codes.includes('ledger-reference-differs') ? 'ledger-reference-differs'
    : costAccount.outcome === 'unreadable' || advanceAccount.outcome === 'unreadable' ? 'lines-unreadable'
    : null;
```

and add `erp_posting_date: ledger.postingDate,`. Rerun 4.1; GREEN.

4.3. `revenueAdapter.ts:47-50`: add `date?: unknown` to `MoveRow` and `'date'` to `MOVE_FIELDS`. In the invoice expectation at `supabase/functions/_shared/odooRevenueRefs.ts:354` add `date: input.invoiceDate, ref: resolveClientReference({ invoice: input.referenceNumber, workOrderPo: input.workOrderPoNumber, projectContractRef: input.projectContractRef })`, importing `resolveClientReference` from `pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts:51` (the same function the body uses at `invoiceBody.ts:116`, so the expectation is what was sent). In `supabase/functions/adapter-dispatch/odooRevenueOutbox.ts` add `odoo_expected_date`, `odoo_expected_ref` to `DERIVED_KEYS` (`:52-55`) and to `expectOf` (`:57-62`) exactly as Task 3.5.

4.4. Add to `pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.test.ts` `AC-ODR-004 settleInvoice reads the accounting date` (fake returns `date` moved; assert `odoo_attention: 'ledger-date-differs'`). Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/revenueAdapter.test.ts src/lib/adapterSeam/odoo/revenue/invoiceReadBack.test.ts`; GREEN.

### Task 5 — migration: the posting-date columns and the invoice attention code (AC-ODR-005)

5.1. Write `supabase/tests/odoo_ledger_posting_date.test.sql` first:

```sql
begin;
select plan(6);
select has_column('public', 'procurement_invoices', 'erp_posting_date', 'AC-ODR-005 bills carry the ledger posting date');
select has_column('public', 'sales_invoices', 'erp_posting_date', 'AC-ODR-005 invoices carry the ledger posting date');
select has_column('public', 'payments', 'erp_posting_date', 'AC-ODR-005 vendor payments carry the ledger posting date');
select has_column('public', 'incoming_payments', 'erp_posting_date', 'AC-ODR-005 receipts carry the ledger posting date');
select lives_ok($$ select 1 where 'ledger-date-differs' in (
  select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z-]+)''', 'g')) from pg_constraint where conname = 'sales_invoices_odoo_attention_check') $$,
  'AC-ODR-005 the invoice attention check names ledger-date-differs');
select is((select count(*)::int from pg_constraint where conname = 'sales_invoices_odoo_attention_check'
  and pg_get_constraintdef(oid) like '%ledger-reference-differs%' and pg_get_constraintdef(oid) like '%ledger-date-unreadable%'), 1,
  'AC-ODR-005 the invoice attention check names the other two ledger codes');
select * from finish();
rollback;
```

5.2. Run `scripts/with-db-lock.sh supabase test db supabase/tests/odoo_ledger_posting_date.test.sql`; RED.

5.3. Create `supabase/migrations/NNNN_odoo_ledger_posting_date.sql`:

```sql
-- #2290: the date the ledger posted on, as Odoo says it (ADR-0048). Written by the mirror writers only; the entered date is kept.
alter table public.procurement_invoices add column if not exists erp_posting_date date;
alter table public.sales_invoices      add column if not exists erp_posting_date date;
alter table public.payments            add column if not exists erp_posting_date date;
alter table public.incoming_payments   add column if not exists erp_posting_date date;
comment on column public.sales_invoices.erp_posting_date is 'The accounting date the ledger posted on (Odoo account.move.date); differs from invoice_date when the ledger moved it.';

alter table public.sales_invoices
  drop constraint sales_invoices_odoo_attention_check,
  add constraint sales_invoices_odoo_attention_check check (
    odoo_attention in (
      'total-mismatch', 'cost-account-missing', 'money-unreadable', 'lines-unreadable', 'advance-account-mismatch',
      'ledger-date-differs', 'ledger-date-unreadable', 'ledger-reference-differs'
    )
  );
```

and `supabase/migrations/rollback/NNNN_odoo_ledger_posting_date_down.sql`:

```sql
update public.sales_invoices set odoo_attention = null where odoo_attention like 'ledger-%';
alter table public.sales_invoices
  drop constraint sales_invoices_odoo_attention_check,
  add constraint sales_invoices_odoo_attention_check check (
    odoo_attention in ('total-mismatch', 'cost-account-missing', 'money-unreadable', 'lines-unreadable', 'advance-account-mismatch')
  );
alter table public.incoming_payments   drop column if exists erp_posting_date;
alter table public.payments            drop column if exists erp_posting_date;
alter table public.sales_invoices      drop column if exists erp_posting_date;
alter table public.procurement_invoices drop column if exists erp_posting_date;
```

5.4. Run as ONE lock hold: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/odoo_ledger_posting_date.test.sql supabase/tests/odoo_revenue_mirror_guard.test.sql supabase/tests/odoo_revenue_page_apply.test.sql supabase/tests/odoo_revenue_cursor_rewind.test.sql'`. The last three are every pgTAP file that names `odoo_attention`, the `sales_invoices_odoo_attention_check` constraint, or `apply_odoo_revenue_page` (the feed function that preserves `odoo_attention`, `supabase/migrations/0750_party_link_rereads_revenue.sql:59-62`); found with `grep -rlE "apply_odoo_revenue_page|odoo_attention|sales_invoices_odoo_attention_check" supabase/tests`. Re-run that grep at build time and add any new file. All GREEN.

5.5. Regenerate types: `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local --schema public > pmo-portal/src/lib/supabase/database.types.ts'`; `git diff --stat pmo-portal/src/lib/supabase/database.types.ts` must show only the four `erp_posting_date` columns (Row/Insert/Update). Run `npm run check:migrations` in `pmo-portal/`.

### Task 6 — vendor payment (AC-ODR-006)

6.1. In `pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.payment.test.ts` add `AC-ODR-006 a vendor payment Odoo re-dated is mirrored on the ledger date and needs attention`: the fake posts the payment with `date` moved to `2025-02-01` while the facts carry `date: '2025-01-20'`; assert the canonical has `erp_posting_date: '2025-02-01', odoo_outcome: 'needs-attention', odoo_attention: ['ledger-date-differs']`; and a second case with an unchanged date asserting no `odoo_outcome`. Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/procurementAdapter.payment.test.ts`; RED.

6.2. `procurementAdapter.ts:421-422`: add `date?: unknown` to `PaymentRow` and `'date'` to `PAYMENT_FIELDS` (Task 1 decides whether the moved field is the payment's `date` or `move_id.date`; if the latter, read `['date']` from `move_id` as `reconcilePayment` already reads move lines). Change `settlePayment(call, id, record, billRef)` to take `sentDate: string | null` and, in the adopt branch (`:477-486`), add

```ts
      const ledger = compareLedger({ date: sentDate }, { date: payment.date });
      ...
          erp_posting_date: ledger.postingDate,
          ...(ledger.codes.length ? { odoo_outcome: 'needs-attention', odoo_attention: ledger.codes } : {}),
```

Pass `facts.date ?? null` from the push caller (`:539`) and from `recoverPayment` (`persisted` facts; null on a legacy row). Rerun 6.1; GREEN.

### Task 7 — customer receipt (AC-ODR-007)

7.1. In `pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.receipt.test.ts` add `AC-ODR-007 a receipt Odoo re-dated is adopted, mirrored on the ledger date and flagged, never refused`: the fake returns the posted, reconciled payment with `date: '2025-02-01'` for an expected `2025-01-20`; assert the result is not a `commit-rejected` error, the canonical has `erp_posting_date: '2025-02-01'` and `odoo_attention: ['ledger-date-differs']`, and `date` stays `'2025-01-20'` (the entered date). Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/revenueAdapter.receipt.test.ts`; RED (today: `receipt-does-not-match-command`).

7.2. In `revenueAdapter.ts:144-150` remove `&& payment.date === expected.date` from `paymentMatches`. In `settleReceipt`'s return (`:207-223`) add

```ts
  const ledger = compareLedger({ date: facts.expected.date }, { date: payment.date });
  ...
      erp_posting_date: ledger.postingDate,
      ...(ledger.codes.length ? { odoo_attention: ledger.codes } : {}),
```

`paymentMatches` is also the recovery identity (`revenueAdapter.ts:249`): a recovered receipt Odoo re-dated is then adopted and flagged the same way, never refused. Add that case to the same test file. Rerun 7.1 and the whole file; every existing receipt case stays GREEN. If an existing case asserts a date mismatch is refused, it pinned the defect: rewrite it to AC-ODR-007's goal (adopted and flagged) and say so in the PR.

7.3. Recovery: `supabase/functions/adapter-dispatch/odooRevenueOutbox.ts:200` compares the stored probe date with the command's date (PMO-side intent only, no Odoo value). Leave it. Run `deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooInvoicePush.served.test.ts`.

### Task 8 — mirror writers write the ledger date (AC-ODR-008)

8.1. In `supabase/functions/adapter-dispatch/readModelWriters.odooBill.test.ts` and `readModelWriters.odooInvoice.test.ts` add one case each `AC-ODR-008 the mirror writes erp_posting_date from the canonical` asserting the patch sent to `procurement_invoices` / `sales_invoices` carries `erp_posting_date: '2027-01-01'`. Add the same for `payments` and `incoming_payments` in the writer tests that cover them (`grep -ln "upsertPaymentMirror\|incoming_payments" supabase/functions/adapter-dispatch/*.test.ts`). Run `deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/readModelWriters.odooBill.test.ts supabase/functions/adapter-dispatch/readModelWriters.odooInvoice.test.ts`; RED.

8.2. Add `erp_posting_date: (canonical.erp_posting_date as string | null | undefined) ?? null,` beside `invoice_date` in `supabase/functions/adapter-dispatch/readModel/procurement.ts:193` and `readModel/revenue.ts:66`, in `upsertPaymentMirror`'s patch (`readModel/procurement.ts:291-300`), and in the receipt writer's `incoming_payments` patch in `readModel/revenue.ts`. Only when the key is present: an ERPNext canonical has no `erp_posting_date`, so use `...('erp_posting_date' in canonical ? { erp_posting_date: canonical.erp_posting_date ?? null } : {})` to keep ERPNext writes byte-for-byte unchanged (the `readModel/revenue.ts:86` discipline). Rerun 8.1; GREEN.

### Task 9 — the journal and reversal contract (AC-ODR-009)

9.1. Add to `ledgerReadBack.test.ts`:

```ts
describe('AC-ODR-009 a journal entry or reversal posted on another date is named', () => {
  it('a reversal asked for 2025-01-15 that Odoo posts on 2025-02-01 is ledger-date-differs', () => {
    expect(compareLedger({ date: '2025-01-15', ref: 'Reversal of: MISC/2025/0001' }, { date: '2025-02-01', ref: 'Reversal of: MISC/2025/0001' }).codes).toEqual(['ledger-date-differs']);
  });
});
```

Run it (GREEN on Task 2's module: this is the contract, not new behaviour).

9.2. Append to `docs/specs/` for the accountant's desk (the spec file on `origin/docs/accountants-desk-design-fwzy4j`; if it has not landed on dev, add the line to this plan's PR description instead) one requirement: "When the desk posts a journal entry or a reversal through Odoo, the system shall read the posted move's `date` and `ref` back and pass them to `compareLedger`; a code holds the entry with the reason shown for AC-ODR-010." No code here: no journal command exists on dev.

### Task 10 — the reason a person reads (AC-ODR-010)

10.1. Write a failing test in `pmo-portal/src/components/revenue/OdooOutcome.test.tsx` (create if absent: `ls` first) `AC-ODR-010 a re-dated invoice says where the ledger posted it`: render `OdooOutcome` with `outcome={{ cls: 'needs-attention', reason: 'ledger-date-differs', ... }}` and `ledgerDate={{ sent: '2025-01-20', posted: '2025-02-01' }}`; assert the visible text contains "Posted in the ledger on" and the formatted `2025-02-01` (format through `pmo-portal/src/lib/format` date helper, the one `check:dates` accepts). Same in `pmo-portal/src/components/procurement/OdooOutcome.test.tsx` for a bill. Run `cd pmo-portal && npx vitest run src/components/revenue/OdooOutcome.test.tsx src/components/procurement/OdooOutcome.test.tsx`; RED.

10.2. Add to `REASON` in `pmo-portal/src/components/revenue/OdooOutcome.tsx:23-29` and `DEFAULT_REASON` in `pmo-portal/src/components/procurement/OdooOutcome.tsx:20-26`:

```ts
  'ledger-date-differs': 'Posted in the ledger on {{posted}}, not {{sent}}. The period you chose is closed in the ledger.',
  'ledger-date-unreadable': 'PMO could not read the date the ledger posted on.',
  'ledger-reference-differs': 'The reference in the ledger is not the one PMO sent.',
```

with the keys in `pmo-portal/public/locales/en/finance.json` (beside `:799-802`), `id/finance.json`, and the procurement namespace files; Indonesian: "Dicatat di buku besar pada {{posted}}, bukan {{sent}}. Periode yang Anda pilih sudah ditutup di buku besar." / "PMO tidak dapat membaca tanggal pencatatan di buku besar." / "Referensi di buku besar tidak sama dengan yang dikirim PMO." Pass `ledgerDate` from `pmo-portal/pages/sales-invoices/SalesInvoiceDetail.tsx` and `pmo-portal/pages/procurement/OdooCaseStatus.tsx` using the row's `erp_posting_date` and entered date. Rerun 10.1; GREEN. Run `npm run check:i18n && npm run check:plain-words && npm run check:dates` in `pmo-portal/`, then `scripts/ux-proof.sh` on `/sales-invoices` and `/procurement`.

10.3. The date column on the sales-invoice and bill lists shows the ledger's date when `erp_posting_date` is set and differs (one muted line "Ledger: {date}" under the entered date). Test in `pmo-portal/pages/sales-invoices/salesInvoiceColumns.test.tsx` (`ls` first): `AC-ODR-010 the list shows the ledger date under a moved invoice date`. RED → change `salesInvoiceColumns.tsx` → GREEN.

### Task 11 — the cross-stack proof (AC-ODR-011)

11.1. Add `supabase/functions/adapter-dispatch/odooLedgerDate.bed.test.ts`: on the Odoo bed with `fiscalyear_lock_date` set to a synthetic past date, push one bill and one invoice dated inside it through the shipped adapters (`createOdooProcurementAdapter`, `createOdooRevenueAdapter` with `bindCall`), assert the canonicals carry `erp_posting_date` equal to Odoo's `account.move.date` and the `ledger-date-differs` code; restore the lock in `finally`. Run `scripts/with-odoo-lock.sh deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooLedgerDate.bed.test.ts`; zero skips.

11.2. Final local gate (CLAUDE.md): `cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched files>`; the vitest files named in Tasks 2–4, 6, 7, 10; the deno files in Tasks 3, 7, 8; the pgTAP files in Task 5.4; `node scripts/affected-e2e.mjs` for the UI change. Mutation check (money tier): set `compareLedger` to `return { codes: [], postingDate: ... }`; Tasks 2, 3, 4, 6, 7 tests must go RED; restore.

## 5. Traceability (each AC has exactly one owning test)

| AC | Given / When / Then (short) | Owning layer | File | Task |
|---|---|---|---|---|
| AC-ODR-001 | sent date ≠ ledger `date` → `ledger-date-differs` + ledger date | Unit | `pmo-portal/src/lib/adapterSeam/odoo/ledgerReadBack.test.ts` (new) | 2 |
| AC-ODR-002 | sent ref ≠ ledger ref → `ledger-reference-differs` | Unit | same | 2 |
| AC-ODR-003 | re-dated bill → mirrored on ledger date, needs attention (payment blocked by the shipped gate) | Unit | `pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.test.ts` | 3 |
| AC-ODR-004 | re-dated invoice → `odoo_attention = ledger-date-differs`, ledger date mirrored | Unit | `pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.test.ts` | 4 |
| AC-ODR-005 | columns exist; invoice CHECK admits the three codes | pgTAP | `supabase/tests/odoo_ledger_posting_date.test.sql` (new) | 5 |
| AC-ODR-006 | re-dated vendor payment → ledger date, needs attention | Unit | `pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.payment.test.ts` | 6 |
| AC-ODR-007 | re-dated receipt → adopted and flagged, not refused | Unit | `pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.receipt.test.ts` | 7 |
| AC-ODR-008 | mirror writes `erp_posting_date`; ERPNext writes unchanged | Unit (Deno) | `supabase/functions/adapter-dispatch/readModelWriters.odooInvoice.test.ts` | 8 |
| AC-ODR-009 | journal / reversal contract | Unit | `pmo-portal/src/lib/adapterSeam/odoo/ledgerReadBack.test.ts` | 9 |
| AC-ODR-010 | screen states the ledger date in plain words | Unit (RTL) | `pmo-portal/src/components/revenue/OdooOutcome.test.tsx` | 10 |
| AC-ODR-011 | real Odoo lock re-dates; PMO mirrors and flags | Bed (Deno) | `supabase/functions/adapter-dispatch/odooLedgerDate.bed.test.ts` (new) | 11 |

## 6. Risks

- **The feed later re-reads an invoice.** `apply_odoo_revenue_page` keeps `odoo_attention` except `money-unreadable` (`supabase/migrations/0750_party_link_rereads_revenue.sql:59-62`), so the new code survives a sweep; it does not write `erp_posting_date`, so a later change in Odoo's date is not picked up. Accepted for this slice; the feed carrying `date` is a follow-up under #894.
- **Reference comparison noise.** Odoo may normalise a reference (whitespace). If Task 11 shows that, compare trimmed values; do not drop the check.
- **Legacy outbox rows** compare no date (Section 2). They are bounded by the outbox's retention, not open-ended.

## 7. Owner questions

1. **Hold = flag, not `held`.** The plan completes the command, mirrors the ledger's date and flags it (a bill's payment is then blocked by the shipped gate). It does not put the outbox row in `held`, because `held` tells a person "PMO cannot tell whether Odoo made it", which is untrue here. Agree?
2. **Migration NNNN (next free, likely 0877): a new `erp_posting_date` column on four tables.** The alternative is to overwrite the entered date with the ledger's, which loses what the person typed and needs no date column. Recommendation: the column. Approve?
3. **Should a re-dated invoice block recording its receipt**, as a re-dated bill blocks its payment? Today nothing blocks a receipt on an invoice with attention. Recommendation: no block (the money is already in the ledger), flag only.
4. **Reference differences:** flag (as planned) or ignore? Recommendation: flag; it is the same one-line reason pattern.
