# Plan part 3 — #775 phase B: adapter seam (Tasks S1–S19)

Part of [`2026-10-07-expense-claims-phase-b.md`](2026-10-07-expense-claims-phase-b.md). Conventions: §1.8 there.
All paths under `pmo-portal/src/lib/adapterSeam/erpnext/` unless stated. Run vitest from `pmo-portal/`:
`scripts/with-test-lock.sh npx vitest run <file>` (path relative to `pmo-portal/`; the lock script is at the repo
root — call it as `../scripts/with-test-lock.sh` from `pmo-portal/`).

Shared fixtures used by several tests below (copy them into each test file that needs them; do not import across
test files):

```ts
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
const ctx = { refs: {}, config: {} };
```

---

### S1 — Export the timestamptz epoch parser (refactor, no behaviour change)

`budgetPushKey.ts`: directly below `function activationEpochMs(...) { ... }` add:

```ts
/** The transport-independent epoch of a Postgres `timestamptz` in any rendering (PostgREST `…T10:00:00+00:00`,
 *  SQL `… 10:00:00+00`, an offset zone). Shared with `expensePostingKey.ts` so every deterministic key normalizes
 *  one instant the same way (#775 phase B). */
export const timestamptzEpochMs = activationEpochMs;
```

Verify: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/budgetPushKey.test.ts` → green.

### S2 — RED: posting key (AC-EXP-110)

Create `expensePostingKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract';
import { EXPENSE_JOURNAL_KEY_RE, expenseOutboxIdentity, expensePostingIdentity, expensePostingKey } from './expensePostingKey';

const CLAIM_UPPER = '0B7A8C2E-1111-4222-8333-444455556666';
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
// 2026-10-07T10:00:00.123Z
const EPOCH = '1791367200123';

describe('expensePostingKey (AC-EXP-110)', () => {
  it('AC-EXP-110 gives each posting its prefix and lowercases the subject', () => {
    const stamp = '2026-10-07T10:00:00.123+00:00';
    expect(expensePostingKey('approval', CLAIM_UPPER, stamp)).toBe(`expj:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('settlement', CLAIM, stamp)).toBe(`exps:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('approval-cancel', CLAIM, stamp)).toBe(`expx:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('claim-payment', CLAIM, stamp)).toBe(`expp:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('advance-payment', CLAIM, stamp)).toBe(`expa:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('advance-return', CLAIM, stamp)).toBe(`expr:${CLAIM}:${EPOCH}`);
  });

  it('AC-EXP-110 one instant in every transport spelling is one key', () => {
    const a = expensePostingKey('approval', CLAIM, '2026-10-07T10:00:00.123+00:00');
    expect(expensePostingKey('approval', CLAIM, '2026-10-07 10:00:00.123+00')).toBe(a);
    expect(expensePostingKey('approval', CLAIM, '2026-10-07T17:00:00.123+07:00')).toBe(a);
  });

  it('AC-EXP-110 refuses to derive a key from a missing or unparseable stamp', () => {
    expect(() => expensePostingKey('approval', CLAIM, null)).toThrow(AdapterError);
    expect(() => expensePostingKey('approval', CLAIM, 'yesterday')).toThrow(/unparseable state stamp/);
  });

  it('AC-EXP-110 identities: the cancel acts on the approval identity', () => {
    expect(expensePostingIdentity('claim-payment', CLAIM_UPPER)).toBe(`${CLAIM}:claim-payment`);
    expect(expenseOutboxIdentity('claim-payment', CLAIM)).toBe(`${CLAIM}:claim-payment`);
    expect(expenseOutboxIdentity('approval-cancel', CLAIM)).toBe(`${CLAIM}:approval`);
  });

  it('AC-EXP-110 the Journal Entry key pattern admits only PMO expense journal keys', () => {
    expect(EXPENSE_JOURNAL_KEY_RE.test(`expj:${CLAIM}:${EPOCH}`)).toBe(true);
    expect(EXPENSE_JOURNAL_KEY_RE.test(`exps:${CLAIM}:${EPOCH}`)).toBe(true);
    expect(EXPENSE_JOURNAL_KEY_RE.test(`expp:${CLAIM}:${EPOCH}`)).toBe(false);
    expect(EXPENSE_JOURNAL_KEY_RE.test('expense reclass for March')).toBe(false);
  });
});
```

Verify RED: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expensePostingKey.test.ts` →
fails: cannot resolve `./expensePostingKey`.

### S3 — GREEN: `expensePostingKey.ts`

```ts
/**
 * #775 phase B (DD-EXP-14, ADR-0059 §4, ADR-0081) — the deterministic idempotency key and identities of an expense
 * posting. `<prefix>:<subject uuid>:<state stamp epoch ms>`: the sweep re-derives the same key on every tick, so a
 * re-run lands on the same outbox row and the same ERP anchor. The stamp is normalized to epoch ms exactly like the
 * budget key (`timestamptzEpochMs`). Shape passes the served opaque-key guard's `<prefix>:<uuid>:<stamp>` form.
 */
import { AdapterError } from '../contract.ts';
import { timestamptzEpochMs } from './budgetPushKey.ts';

export type ExpensePosting =
  | 'approval'
  | 'claim-payment'
  | 'settlement'
  | 'advance-payment'
  | 'advance-return'
  | 'approval-cancel';

export const EXPENSE_POSTING_KEY_PREFIX: Readonly<Record<ExpensePosting, string>> = {
  approval: 'expj',
  settlement: 'exps',
  'approval-cancel': 'expx',
  'claim-payment': 'expp',
  'advance-payment': 'expa',
  'advance-return': 'expr',
};

/** The keys a PMO-posted Journal Entry carries in `user_remark` (the sweep's poll admits only these). */
export const EXPENSE_JOURNAL_KEY_RE = /^exp[js]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4,20}$/;

export function expensePostingKey(posting: ExpensePosting, subjectId: string, stateStamp: string | null | undefined): string {
  if (!stateStamp) {
    throw new AdapterError('commit-rejected', `expense posting ${posting}: no state stamp — the key cannot be derived`);
  }
  const epochMs = timestamptzEpochMs(stateStamp);
  if (!Number.isFinite(epochMs)) {
    throw new AdapterError('commit-rejected', `expense posting ${posting}: unparseable state stamp "${stateStamp}"`);
  }
  return `${EXPENSE_POSTING_KEY_PREFIX[posting]}:${subjectId.toLowerCase()}:${epochMs}`;
}

/** The side mirror's identity for a posting (`expense_posting_erp_mirror.posting_identity`, 0263 §3 CHECK). */
export function expensePostingIdentity(posting: ExpensePosting, subjectId: string): string {
  return `${subjectId.toLowerCase()}:${posting}`;
}

/** The outbox / external_refs identity: a cancel acts on the approval Journal Entry's own identity. */
export function expenseOutboxIdentity(posting: ExpensePosting, subjectId: string): string {
  return expensePostingIdentity(posting === 'approval-cancel' ? 'approval' : posting, subjectId);
}
```

Verify GREEN: same command → 5 passed.

### S4 — RED: kinds, domain, routing, company scope (AC-EXP-114)

Create `expenseKinds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DOCTYPE_REGISTRY, reissueOnInconclusiveAbsence } from './doctypeRegistry';
import {
  KIND_DOMAIN, KIND_MIRROR_TABLE, kindFromDoctype, kindFromDoctypeAndPaymentType, pollDiscriminatorForKind, sweepKindsForOrg,
} from './feedKinds';
import { isCompanyScopedKind } from './companyScope';
import { ERPNEXT_EXPENSES_DOMAIN } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';

const KINDS = ['expense-journal', 'expense-payment', 'expense-receipt'] as const;
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

describe('expense kinds (AC-EXP-114)', () => {
  it('AC-EXP-114 registers the three kinds with doctype, anchor and reissue policy', () => {
    expect(DOCTYPE_REGISTRY['expense-journal']).toEqual({
      doctype: 'Journal Entry', submittable: true, submitOnCreate: true, anchorField: 'user_remark', anchorMutable: false,
    });
    expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY['expense-journal'])).toBe(true);
    for (const kind of ['expense-payment', 'expense-receipt'] as const) {
      expect(DOCTYPE_REGISTRY[kind]).toEqual({ doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true });
      expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY[kind])).toBe(false);
    }
    for (const kind of KINDS) expect(DOCTYPE_BODIES[kind]).toBeDefined();
  });

  it('AC-EXP-114 maps them to the expenses domain, the side mirror and the company scope', () => {
    expect(ERPNEXT_EXPENSES_DOMAIN).toBe('expenses');
    for (const kind of KINDS) {
      expect(KIND_DOMAIN[kind]).toBe('expenses');
      expect(KIND_MIRROR_TABLE[kind]).toBe('expense_posting_erp_mirror');
      expect(isCompanyScopedKind(kind)).toBe(true);
    }
  });

  it('AC-EXP-114 leaves the Payment Entry reverse lookup as it was and routes Employee entries by party type', () => {
    expect(kindFromDoctype('Payment Entry')).toBe('incoming-payment');
    expect(kindFromDoctype('Journal Entry')).toBe('expense-journal');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Pay')).toBe('payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Receive')).toBe('incoming-payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Pay', 'Supplier')).toBe('payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Pay', 'Employee')).toBe('expense-payment');
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Receive', 'Employee')).toBe('expense-receipt');
  });

  it('AC-EXP-114 an org employing only expenses also polls the Employee master', () => {
    const kinds = sweepKindsForOrg(['expenses']).map((k) => k.kind).sort();
    expect(kinds).toEqual(['employee', 'expense-journal', 'expense-payment', 'expense-receipt']);
    expect(sweepKindsForOrg(['revenue']).map((k) => k.kind)).not.toContain('employee');
  });

  it('AC-EXP-114 poll discriminators keep Employee entries out of procurement/revenue and native journals out of expenses', () => {
    const pay = pollDiscriminatorForKind('payment')!;
    expect(pay.filters).toEqual([['party_type', '!=', 'Employee']]);
    expect(pay.admits({ party_type: 'Supplier' })).toBe(true);
    expect(pay.admits({ party_type: 'Employee' })).toBe(false);
    expect(pollDiscriminatorForKind('incoming-payment')!.admits({ party_type: 'Employee' })).toBe(false);
    const exp = pollDiscriminatorForKind('expense-payment')!;
    expect(exp.filters).toEqual([['party_type', '=', 'Employee']]);
    expect(exp.admits({ party_type: 'Supplier' })).toBe(false);
    const je = pollDiscriminatorForKind('expense-journal')!;
    expect(je.filters).toEqual([['user_remark', 'like', 'exp%']]);
    expect(je.fields).toEqual(['user_remark']);
    expect(je.admits({ user_remark: `expj:${CLAIM}:1791367200123` })).toBe(true);
    expect(je.admits({ user_remark: 'expense reclass' })).toBe(false);
    expect(pollDiscriminatorForKind('sales-invoice')).toBeNull();
  });
});
```

Verify RED: fails (unknown kinds / missing exports).

### S5 — GREEN: register the kinds (FR-EXP-113/114)

1. `doctypeRegistry.ts` — extend the union and the table:

```ts
// in `export type ErpDocKind = …` add, after `| 'budget'`:
  | 'expense-journal'
  | 'expense-payment'
  | 'expense-receipt';
```
```ts
// in DOCTYPE_REGISTRY, after the `budget:` entry:
  // #775 phase B — expense postings (ADR-0059 Posture B, ADR-0081; spike 2026-10-07).
  // Journal Entry anchors on `user_remark`: it survives validate + submit + re-fetch verbatim, is REST-filterable,
  // and a post-submit PUT is refused (UpdateAfterSubmitError) ⇒ immutable ⇒ a probe miss is conclusive absence.
  // `user_remark` is `no_copy`, so an amend must re-stamp it — `adapter.ts` amendFrom does (AC-EXP-112).
  'expense-journal': { doctype: 'Journal Entry', submittable: true, submitOnCreate: true, anchorField: 'user_remark', anchorMutable: false },
  // Employee Payment Entries (Pay: claim cash part + advance payout; Receive: advance return). Same anchor and
  // C-1 policy as every Payment Entry kind: reference_no is mutable ⇒ composite probe, held on inconclusive.
  'expense-payment': { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
  'expense-receipt': { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
```

2. `adapter.ts` — below `ERPNEXT_BUDGET_DOMAIN`:

```ts
/** #775 phase B (ADR-0059 Posture B, ADR-0081): expense claims post their accounting consequence. Driven ONLY by
 *  the erpnext-sweep pass — adapter-dispatch deliberately has no route for this domain. */
export const ERPNEXT_EXPENSES_DOMAIN: PmoDomain = 'expenses';
```

3. `companyScope.ts` — add to `COMPANY_SCOPED_KINDS` after `'employee',`:

```ts
  'expense-journal',
  'expense-payment',
  'expense-receipt',
```

4. `feedKinds.ts`:

```ts
// KIND_DOMAIN's value type becomes:
export const KIND_DOMAIN: Record<ErpDocKind, 'companies' | 'procurement' | 'revenue' | 'timesheets' | 'budget' | 'expenses'> = {
// …existing entries unchanged, then after `budget: 'budget',`:
  // #775 phase B — expense postings (Posture B). Lifecycle-only inbound; never adopted (FR-EXP-113).
  'expense-journal': 'expenses',
  'expense-payment': 'expenses',
  'expense-receipt': 'expenses',
};
```
```ts
// KIND_MIRROR_TABLE, after `budget: 'budget_version_erp_mirror',`:
  // ⛔ NEVER `expense_claims`: PMO is the SoT for the claim; only the side mirror is a feed target.
  'expense-journal': 'expense_posting_erp_mirror',
  'expense-payment': 'expense_posting_erp_mirror',
  'expense-receipt': 'expense_posting_erp_mirror',
```

Replace the `DOCTYPE_TO_KIND` constant with:

```ts
/** Kinds that share a doctype with an earlier kind and are reached only through a discriminator
 *  (`kindFromDoctypeAndPaymentType`'s party type). Kept out of the plain reverse map so `kindFromDoctype` answers
 *  exactly as it did before they existed. */
const DISCRIMINATED_KINDS: ReadonlySet<ErpDocKind> = new Set<ErpDocKind>(['expense-payment', 'expense-receipt']);

/** Reverse doctype→kind lookup (built from the registry — one source of doctype names). */
const DOCTYPE_TO_KIND: Record<string, ErpDocKind> = Object.fromEntries(
  (Object.entries(DOCTYPE_REGISTRY) as Array<[ErpDocKind, { doctype: string }]>)
    .filter(([kind]) => !DISCRIMINATED_KINDS.has(kind))
    .map(([kind, entry]) => [entry.doctype, kind]),
);
```

Replace `kindFromDoctypeAndPaymentType` with:

```ts
/** Disambiguate an inbound Payment Entry by payment_type (FR-SAR-081) and, for an Employee party, route it to the
 *  expense kinds (FR-EXP-113): one doctype → four PMO kinds. */
export function kindFromDoctypeAndPaymentType(doctype: string, paymentType?: string, partyType?: string): ErpDocKind | undefined {
  if (doctype === 'Payment Entry') {
    if (partyType === 'Employee') {
      if (paymentType === 'Receive') return 'expense-receipt';
      if (paymentType === 'Pay') return 'expense-payment';
      return undefined;
    }
    if (paymentType === 'Receive') return 'incoming-payment';
    if (paymentType === 'Pay') return 'payment';
    return undefined; // unknown/absent payment_type → ack-and-skip (lossy hint, FR-SAR-083)
  }
  return kindFromDoctype(doctype); // Sales Invoice + every other doctype is unique
}
```

Replace `sweepKindsForOrg` with:

```ts
/** A master another domain also needs: the ERP Employee is polled for `timesheets` AND `expenses` (DD-EXP-21).
 *  Its feed domain stays `timesheets` (`KIND_DOMAIN`), so its `external_refs` namespace is unchanged. */
const KIND_ALSO_POLLED_FOR: Partial<Record<ErpDocKind, readonly string[]>> = { employee: ['expenses'] };

export function sweepKindsForOrg(ownedDomains: readonly string[]): Array<{ kind: ErpDocKind; doctype: string }> {
  const owned = new Set(ownedDomains);
  return SWEEP_DOCTYPES.filter(({ kind }) =>
    owned.has(KIND_DOMAIN[kind]) || (KIND_ALSO_POLLED_FOR[kind] ?? []).some((domain) => owned.has(domain)));
}
```

Append:

```ts
/** A poll's extra server-side filter + the per-row authority behind it (FR-EXP-113). `null` = no discriminator. */
export interface KindPollDiscriminator {
  filters: Array<[string, string, string]>;
  fields: string[];
  admits(row: Record<string, unknown>): boolean;
}

const EXPENSE_JOURNAL_KEY = /^exp[js]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4,20}$/;

/**
 * Payment Entry carries Supplier, Customer AND Employee parties. Before #775 phase B the procurement/revenue polls
 * read Employee entries too — a revenue-owned org would adopt an employee's cash return as a customer receipt.
 * The Journal Entry poll admits only PMO keys: native journals (payroll, depreciation) are never even listed.
 * The key pattern repeats `expensePostingKey.ts`'s EXPENSE_JOURNAL_KEY_RE (feedKinds must stay import-light).
 */
export function pollDiscriminatorForKind(kind: ErpDocKind): KindPollDiscriminator | null {
  if (kind === 'payment' || kind === 'incoming-payment') {
    return { filters: [['party_type', '!=', 'Employee']], fields: ['party_type'], admits: (row) => row.party_type !== 'Employee' };
  }
  if (kind === 'expense-payment' || kind === 'expense-receipt') {
    return { filters: [['party_type', '=', 'Employee']], fields: ['party_type'], admits: (row) => row.party_type === 'Employee' };
  }
  if (kind === 'expense-journal') {
    return {
      filters: [['user_remark', 'like', 'exp%']],
      fields: ['user_remark'],
      admits: (row) => typeof row.user_remark === 'string' && EXPENSE_JOURNAL_KEY.test(row.user_remark),
    };
  }
  return null;
}
```

5. `supabase/functions/erpnext-sweep/index.ts` — `FROM_DOC_FIELDS_BY_KIND` is `Record<ErpDocKind, …>` and must name the
   new kinds now (S9 creates the field lists). Add to its imports
   `import { EXPENSE_JOURNAL_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/expenseJournal.ts';`
   and `import { EXPENSE_PAYMENT_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/expensePayment.ts';`
   and after `employee: EMPLOYEE_FROM_DOC_FIELDS,`:

```ts
  'expense-journal': EXPENSE_JOURNAL_FROM_DOC_FIELDS,
  'expense-payment': EXPENSE_PAYMENT_FROM_DOC_FIELDS,
  'expense-receipt': EXPENSE_PAYMENT_FROM_DOC_FIELDS,
```

Do steps 1–4 now; step 5 after S9 (the field lists do not exist before it). `DOCTYPE_BODIES` entries are S9.
Verify after S9: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expenseKinds.test.ts src/lib/adapterSeam/erpnext/feedKinds.test.ts src/lib/adapterSeam/erpnext/companyScope.test.ts`
→ green; `npm run typecheck` → 0 errors.

### S6 — RED: Journal Entry body (AC-EXP-111)

Create `bodies/expenseJournal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdapterError } from '../../contract';
import { expenseJournalFromDoc, expenseJournalToBody } from './expenseJournal';

const ctx = { refs: {}, config: {} };
const approval = {
  id: 'c1', erp_doc_kind: 'expense-journal', posting: 'approval', company: 'PMO Smoke Co', posting_date: '2026-10-08',
  journal_rows: [
    { account: 'Travel Expenses - PSC', debit: '150.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
    { account: 'Meals - PSC', debit: '25.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
    { account: 'Employee Payable - PSC', credit: '175.00', party: 'HR-EMP-00002', project: 'PROJ-0001' },
  ],
};

describe('expenseJournalToBody (AC-EXP-111)', () => {
  it('AC-EXP-111 approval: debit rows carry project + cost center; the Employee row carries neither', () => {
    expect(expenseJournalToBody(approval, ctx)).toEqual({
      company: 'PMO Smoke Co', voucher_type: 'Journal Entry', posting_date: '2026-10-08',
      accounts: [
        { account: 'Travel Expenses - PSC', debit_in_account_currency: 150, project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Meals - PSC', debit_in_account_currency: 25, project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Employee Payable - PSC', credit_in_account_currency: 175, party_type: 'Employee', party: 'HR-EMP-00002' },
      ],
    });
  });

  it('AC-EXP-111 overhead approval: no project key at all', () => {
    const body = expenseJournalToBody({
      ...approval,
      journal_rows: [
        { account: 'Travel Expenses - PSC', debit: '10.00', project: null, cost_center: 'Main - PSC' },
        { account: 'Employee Payable - PSC', credit: '10.00', party: 'HR-EMP-00002' },
      ],
    }, ctx) as { accounts: Array<Record<string, unknown>> };
    expect(body.accounts[0]).toEqual({ account: 'Travel Expenses - PSC', debit_in_account_currency: 10, cost_center: 'Main - PSC' });
  });

  it('AC-EXP-111 settlement: the payable row references the approval Journal Entry', () => {
    const body = expenseJournalToBody({
      ...approval, posting: 'settlement',
      journal_rows: [
        { account: 'Employee Payable - PSC', debit: '50.00', party: 'HR-EMP-00002', reference_name: 'ACC-JV-2026-00002' },
        { account: 'Employee Advances - PSC', credit: '50.00', party: 'HR-EMP-00002' },
      ],
    }, ctx) as { accounts: Array<Record<string, unknown>> };
    expect(body.accounts).toEqual([
      { account: 'Employee Payable - PSC', debit_in_account_currency: 50, party_type: 'Employee', party: 'HR-EMP-00002',
        reference_type: 'Journal Entry', reference_name: 'ACC-JV-2026-00002' },
      { account: 'Employee Advances - PSC', credit_in_account_currency: 50, party_type: 'Employee', party: 'HR-EMP-00002' },
    ]);
  });

  it('AC-EXP-111 refuses an unbalanced, zero, short or malformed entry before any call', () => {
    const rows = (debit: string, credit: string) => ({ ...approval, journal_rows: [
      { account: 'A', debit, project: null, cost_center: null }, { account: 'B', credit, party: 'E' }] });
    expect(() => expenseJournalToBody(rows('10.00', '9.99'), ctx)).toThrow(/unbalanced/);
    expect(() => expenseJournalToBody(rows('0.00', '0.00'), ctx)).toThrow(/unbalanced/);
    expect(() => expenseJournalToBody(rows('1.5', '1.5'), ctx)).toThrow(AdapterError);
    expect(() => expenseJournalToBody({ ...approval, journal_rows: [approval.journal_rows[0]] }, ctx)).toThrow(/two rows/);
  });

  it('AC-EXP-111 fromDoc maps the lifecycle fields', () => {
    expect(expenseJournalFromDoc({ name: 'ACC-JV-2026-00002', docstatus: 1, modified: '2026-10-07 14:07:45', amended_from: null, user_remark: 'expj:x' }))
      .toEqual({ id: 'ACC-JV-2026-00002', erp_docstatus: 1, erp_modified: '2026-10-07 14:07:45', erp_amended_from: null, user_remark: 'expj:x' });
  });
});
```

Verify RED: fails to resolve `./expenseJournal`.

### S7 — GREEN: `bodies/expenseJournal.ts` (FR-EXP-107)

```ts
/**
 * #775 phase B — Journal Entry body for the `approval` and `settlement` postings. Shapes are the spike's
 * (2026-10-07 §1): expense rows carry `project` + `cost_center` (they reach the GL Entry verbatim, §4); Employee
 * party rows carry neither (ERPNext defaults their cost center). `user_remark` is NOT set here — `adapter.ts`
 * stampAnchor writes the idempotency key into it on create AND on amend.
 */
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

export interface ExpenseJournalRow {
  account: string;
  debit?: string;
  credit?: string;
  project?: string | null;
  cost_center?: string | null;
  /** The Employee party; its presence makes this a party row. */
  party?: string;
  /** A Journal Entry this row settles against (the settlement's payable row → the approval). */
  reference_name?: string | null;
}

const MONEY = /^\d{1,12}\.\d{2}$/;

function cents(value: string, account: string): bigint {
  if (!MONEY.test(value)) throw new AdapterError('commit-rejected', `expense journal: amount "${value}" on ${account} is not a 2-decimal figure`);
  return BigInt(value.replace('.', ''));
}

export function expenseJournalToBody(rec: PmoRecord, _ctx: ErpCtx): unknown {
  const rows = rec.journal_rows as ExpenseJournalRow[] | undefined;
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new AdapterError('commit-rejected', 'expense journal needs at least two rows');
  }
  let debit = 0n;
  let credit = 0n;
  const accounts = rows.map((row) => {
    const out: Record<string, unknown> = { account: row.account };
    if (row.debit) {
      debit += cents(row.debit, row.account);
      out.debit_in_account_currency = Number(row.debit);
    }
    if (row.credit) {
      credit += cents(row.credit, row.account);
      out.credit_in_account_currency = Number(row.credit);
    }
    if (row.party) {
      out.party_type = 'Employee';
      out.party = row.party;
      if (row.reference_name) {
        out.reference_type = 'Journal Entry';
        out.reference_name = row.reference_name;
      }
    } else {
      if (row.project) out.project = row.project;
      if (row.cost_center) out.cost_center = row.cost_center;
    }
    return out;
  });
  if (debit !== credit || debit === 0n) {
    throw new AdapterError('commit-rejected', `expense journal is unbalanced (debit ${debit} ≠ credit ${credit} cents, or zero)`);
  }
  return { company: rec.company, voucher_type: 'Journal Entry', posting_date: rec.posting_date, accounts };
}

export function expenseJournalFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    erp_docstatus: (d.docstatus as number | null | undefined) ?? null,
    erp_modified: (d.modified as string | null | undefined) ?? null,
    erp_amended_from: (d.amended_from as string | null | undefined) ?? null,
    user_remark: (d.user_remark as string | null | undefined) ?? null,
  };
}

/** The list fields `expenseJournalFromDoc` reads (the sweep's poll requests exactly these, plus routing fields). */
export const EXPENSE_JOURNAL_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'user_remark'] as const;
```

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts` → 5 passed.

### S8 — RED: Payment Entry body (AC-EXP-113)

Create `bodies/expensePayment.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mirrorMoney } from '../moneyShape';
import { expensePaymentFromDoc, expensePaymentToBody } from './expensePayment';

const ctx = { refs: {}, config: {} };
const base = { id: 'c1', company: 'PMO Smoke Co', posting_date: '2026-10-08', party: 'HR-EMP-00002' };

describe('expensePaymentToBody (AC-EXP-113)', () => {
  it('AC-EXP-113 claim payment: explicit paid_from/paid_to, Employee party, one reference to the approval journal', () => {
    expect(expensePaymentToBody({ ...base, erp_doc_kind: 'expense-payment', posting: 'claim-payment', payment_type: 'Pay',
      paid_from: 'Cash - PSC', paid_to: 'Employee Payable - PSC', paid_amount: '100.00', approval_journal: 'ACC-JV-2026-00002' }, ctx))
      .toEqual({
        company: 'PMO Smoke Co', posting_date: '2026-10-08', payment_type: 'Pay', party_type: 'Employee', party: 'HR-EMP-00002',
        paid_from: 'Cash - PSC', paid_to: 'Employee Payable - PSC', paid_amount: 100, received_amount: 100,
        reference_date: '2026-10-08',
        references: [{ reference_doctype: 'Journal Entry', reference_name: 'ACC-JV-2026-00002', allocated_amount: 100 }],
      });
  });

  it('AC-EXP-113 advance payment and advance return carry no reference; the return is Receive from the advance account', () => {
    const pay = expensePaymentToBody({ ...base, erp_doc_kind: 'expense-payment', posting: 'advance-payment', payment_type: 'Pay',
      paid_from: 'Cash - PSC', paid_to: 'Employee Advances - PSC', paid_amount: '200.00', approval_journal: null }, ctx) as Record<string, unknown>;
    expect(pay.references).toEqual([]);
    expect(pay.paid_to).toBe('Employee Advances - PSC');
    const ret = expensePaymentToBody({ ...base, erp_doc_kind: 'expense-receipt', posting: 'advance-return', payment_type: 'Receive',
      paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', paid_amount: '20.00', approval_journal: null }, ctx) as Record<string, unknown>;
    expect(ret).toMatchObject({ payment_type: 'Receive', paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', references: [] });
  });

  it('AC-EXP-113 refuses a direction that contradicts the kind, a missing account, or a zero amount', () => {
    const ok = { ...base, erp_doc_kind: 'expense-receipt', posting: 'advance-return', payment_type: 'Receive',
      paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', paid_amount: '20.00', approval_journal: null };
    expect(() => expensePaymentToBody({ ...ok, payment_type: 'Pay' }, ctx)).toThrow(/direction/);
    expect(() => expensePaymentToBody({ ...ok, erp_doc_kind: 'expense-payment' }, ctx)).toThrow(/direction/);
    expect(() => expensePaymentToBody({ ...ok, paid_to: '' }, ctx)).toThrow(/paid_to/);
    expect(() => expensePaymentToBody({ ...ok, paid_amount: '0.00' }, ctx)).toThrow(/amount/);
  });

  it('AC-EXP-113 fromDoc maps name, lifecycle, reference_no and the paid amount', () => {
    expect(expensePaymentFromDoc({ name: 'ACC-PAY-2026-00233', docstatus: 1, modified: 'm', amended_from: null, reference_no: 'expp:x', paid_amount: 100 }))
      .toEqual({ id: 'ACC-PAY-2026-00233', erp_docstatus: 1, erp_modified: 'm', erp_amended_from: null, reference_number: 'expp:x', amount: mirrorMoney(100) });
  });
});
```

Verify RED: fails to resolve `./expensePayment`.

### S9 — GREEN: `bodies/expensePayment.ts` + body wiring (FR-EXP-107)

```ts
/**
 * #775 phase B — Employee Payment Entry body (claim cash part, advance payout, advance return). Spike 2026-10-07 §3:
 * ERPNext GUESSES `paid_to`/`paid_from` from the employee's ledger history (or falls back to Creditors) when they
 * are omitted, so both are ALWAYS sent. `reference_date` is always sent because a Bank-typed `paid_from` needs it
 * with `reference_no` (the anchor `adapter.ts` stamps). With no HRMS, Journal Entry is the only valid reference doctype.
 */
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';

const MONEY = /^\d{1,12}\.\d{2}$/;

function required(rec: PmoRecord, field: string): string {
  const value = rec[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdapterError('commit-rejected', `expense payment: ${field} is required`);
  }
  return value;
}

export function expensePaymentToBody(rec: PmoRecord, _ctx: ErpCtx): unknown {
  const expected = rec.erp_doc_kind === 'expense-receipt' ? 'Receive' : 'Pay';
  if (rec.payment_type !== expected) {
    throw new AdapterError('commit-rejected', `expense payment: direction ${String(rec.payment_type)} contradicts kind ${String(rec.erp_doc_kind)}`);
  }
  const amountText = required(rec, 'paid_amount');
  if (!MONEY.test(amountText) || Number(amountText) <= 0) {
    throw new AdapterError('commit-rejected', `expense payment: amount "${amountText}" must be a positive 2-decimal figure`);
  }
  const amount = Number(amountText);
  const postingDate = required(rec, 'posting_date');
  const journal = typeof rec.approval_journal === 'string' && rec.approval_journal ? rec.approval_journal : null;
  return {
    company: required(rec, 'company'),
    posting_date: postingDate,
    payment_type: expected,
    party_type: 'Employee',
    party: required(rec, 'party'),
    paid_from: required(rec, 'paid_from'),
    paid_to: required(rec, 'paid_to'),
    paid_amount: amount,
    received_amount: amount,
    reference_date: postingDate,
    references: journal ? [{ reference_doctype: 'Journal Entry', reference_name: journal, allocated_amount: amount }] : [],
  };
}

export function expensePaymentFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    erp_docstatus: (d.docstatus as number | null | undefined) ?? null,
    erp_modified: (d.modified as string | null | undefined) ?? null,
    erp_amended_from: (d.amended_from as string | null | undefined) ?? null,
    reference_number: (d.reference_no as string | null | undefined) ?? null,
    amount: mirrorMoney(d.paid_amount),
  };
}

export const EXPENSE_PAYMENT_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'reference_no', 'paid_amount'] as const;
```

`doctypeBodies.ts` — add imports and, after the `budget:` entry:

```ts
import { expenseJournalToBody, expenseJournalFromDoc } from './bodies/expenseJournal.ts';
import { expensePaymentToBody, expensePaymentFromDoc } from './bodies/expensePayment.ts';
```
```ts
  // #775 phase B — expense postings (spike 2026-10-07). One body per doctype; the posting rides on the record.
  'expense-journal': { toBody: expenseJournalToBody, fromDoc: expenseJournalFromDoc },
  'expense-payment': { toBody: expensePaymentToBody, fromDoc: expensePaymentFromDoc },
  'expense-receipt': { toBody: expensePaymentToBody, fromDoc: expensePaymentFromDoc },
```

Now do S5 step 5. Verify GREEN:
`../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/expensePayment.test.ts src/lib/adapterSeam/erpnext/expenseKinds.test.ts src/lib/adapterSeam/erpnext/feedKinds.test.ts src/lib/adapterSeam/erpnext/companyScope.test.ts src/lib/adapterSeam/erpnext/doctypeBodies.test.ts src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts`
→ green; `npm run typecheck` → 0; `cd ../supabase/functions/erpnext-sweep && deno check index.ts` → clean.

### S10 — Amend re-stamps `user_remark` (AC-EXP-112, FR-EXP-108)

Create `adapter.expenseJournalAmend.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';

const KEY = 'expj:0b7a8c2e-1111-4222-8333-444455556666:1791367200123';

describe('expense journal amend (AC-EXP-112)', () => {
  it('AC-EXP-112 the amended Journal Entry carries amended_from AND the key in user_remark (ERPNext does not copy it)', async () => {
    const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method: init?.method ?? 'GET', body });
      if (init?.method === 'PUT' && body?.docstatus === 2) return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002', docstatus: 2 }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002-1' }));
      if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002-1', docstatus: 1 }));
      return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002-1', docstatus: 1, amended_from: 'ACC-JV-2026-00002', user_remark: KEY }));
    };
    const adapter = createErpAdapter({
      client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
      doctypeBodies: DOCTYPE_BODIES,
      ctx: { refs: {}, config: {} },
    });
    await adapter.commit({
      domain: 'expenses',
      operation: 'transition',
      idempotencyKey: KEY,
      record: {
        id: 'claim-1', erp_doc_kind: 'expense-journal', verb: 'amend', externalRecordId: 'ACC-JV-2026-00002',
        company: 'PMO Smoke Co', posting_date: '2026-10-08',
        journal_rows: [
          { account: 'Travel Expenses - PSC', debit: '10.00', project: null, cost_center: null },
          { account: 'Employee Payable - PSC', credit: '10.00', party: 'HR-EMP-00002' },
        ],
      },
    });
    const create = calls.find((c) => c.method === 'POST');
    expect(create?.body).toMatchObject({ amended_from: 'ACC-JV-2026-00002', user_remark: KEY, voucher_type: 'Journal Entry' });
  });
});
```

Verify: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/adapter.expenseJournalAmend.test.ts`
→ passes on the S5 registry entry (the amend path already stamps the anchor). **Mutation (do not commit):** set
`'expense-journal'`'s `anchorField` to `null` in `doctypeRegistry.ts` → this test red; revert → green.

### S11 — RED: account rule (AC-EXP-118)

Create `expenseAccountRules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXPENSE_ACCOUNT_KEYS, expenseAccountProblem, isExpenseAccountKey, type ErpAccountFacts } from './expenseAccountRules';

const ctx = { company: 'PMO Smoke Co', companyCurrency: 'IDR', defaultPayableAccount: 'Creditors - PSC' };
const acct = (over: Partial<ErpAccountFacts>): ErpAccountFacts =>
  ({ name: 'X - PSC', root_type: 'Expense', account_type: '', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR', ...over });

describe('expenseAccountProblem (AC-EXP-118)', () => {
  it('AC-EXP-118 accepts the spike accounts', () => {
    expect(expenseAccountProblem('employee_payable', acct({ name: 'Spike Employee Payable - PSC', root_type: 'Liability', account_type: 'Payable' }), ctx)).toBeNull();
    expect(expenseAccountProblem('employee_advance', acct({ name: 'Employee Advances - PSC', root_type: 'Asset', account_type: 'Payable' }), ctx)).toBeNull();
    expect(expenseAccountProblem('Travel', acct({ name: 'Travel Expenses - PSC' }), ctx)).toBeNull();
  });

  it('AC-EXP-118 refuses the supplier payable account (Creditors) as employee payable', () => {
    expect(expenseAccountProblem('employee_payable', acct({ name: 'Creditors - PSC', root_type: 'Liability', account_type: 'Payable' }), ctx))
      .toMatch(/supplier payable/);
    expect(expenseAccountProblem('employee_payable', acct({ name: 'Any - PSC', root_type: 'Liability', account_type: 'Payable' }),
      { ...ctx, defaultPayableAccount: null })).toMatch(/cannot confirm/);
  });

  it('AC-EXP-118 refuses an untyped advance account and wrong root types', () => {
    expect(expenseAccountProblem('employee_advance', acct({ root_type: 'Asset', account_type: '' }), ctx)).toMatch(/Asset account of type Payable/);
    expect(expenseAccountProblem('employee_payable', acct({ root_type: 'Liability', account_type: '' }), ctx)).toMatch(/Liability account of type Payable/);
    expect(expenseAccountProblem('Meals', acct({ root_type: 'Asset' }), ctx)).toMatch(/Expense account/);
  });

  it('AC-EXP-118 refuses a missing, group, disabled, other-company or foreign-currency account', () => {
    expect(expenseAccountProblem('Travel', null, ctx)).toMatch(/does not exist/);
    expect(expenseAccountProblem('Travel', acct({ is_group: 1 }), ctx)).toMatch(/group/);
    expect(expenseAccountProblem('Travel', acct({ disabled: 1 }), ctx)).toMatch(/disabled/);
    expect(expenseAccountProblem('Travel', acct({ company: 'Other Co' }), ctx)).toMatch(/another company/);
    expect(expenseAccountProblem('Travel', acct({ account_currency: 'USD' }), ctx)).toMatch(/USD/);
  });

  it('AC-EXP-118 the keys are the two party keys plus every expense type', () => {
    expect(EXPENSE_ACCOUNT_KEYS).toEqual(['employee_payable', 'employee_advance', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other']);
    expect(isExpenseAccountKey('Meals')).toBe(true);
    expect(isExpenseAccountKey('Bogus')).toBe(false);
  });
});
```

Verify RED: cannot resolve `./expenseAccountRules`.

### S12 — GREEN: `expenseAccountRules.ts` (FR-EXP-112)

```ts
/**
 * #775 phase B — FR-EXP-112 / DD-EXP-16: which ERPNext account may back each expense posting key. ONE rule, run by
 * `external-set-company` when an Admin saves the map AND by the sweep before every posting (an account can be
 * re-typed in ERPNext after it was mapped). Spike 2026-10-07 §3d/§7: ERPNext ACCEPTS the supplier control account
 * `Creditors` and an untyped advance account (no Payment Ledger rows ⇒ no open-item trail), so PMO refuses both.
 * Fail closed: when the company's default payable account is unknown, nothing can be accepted as employee payable.
 */
export const EXPENSE_ACCOUNT_KEYS = ['employee_payable', 'employee_advance', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other'] as const;
export type ExpenseAccountKey = (typeof EXPENSE_ACCOUNT_KEYS)[number];

export function isExpenseAccountKey(value: unknown): value is ExpenseAccountKey {
  return typeof value === 'string' && (EXPENSE_ACCOUNT_KEYS as readonly string[]).includes(value);
}

/** The Account fields the rule reads (one `getDoc('Account', name)` returns all of them). */
export interface ErpAccountFacts {
  name: string;
  root_type?: unknown;
  account_type?: unknown;
  is_group?: unknown;
  disabled?: unknown;
  company?: unknown;
  account_currency?: unknown;
}

export interface ExpenseAccountContext {
  company: string;
  companyCurrency: string | null;
  defaultPayableAccount: string | null;
}

/** `null` = acceptable; otherwise a client-safe sentence naming the account and the rule it breaks. */
export function expenseAccountProblem(key: ExpenseAccountKey, account: ErpAccountFacts | null, ctx: ExpenseAccountContext): string | null {
  if (!account) return `${key}: the account does not exist in ERPNext`;
  if (account.company !== ctx.company) return `${key}: ${account.name} belongs to another company`;
  if (Number(account.is_group) === 1) return `${key}: ${account.name} is a group account; choose a ledger account`;
  if (Number(account.disabled) === 1) return `${key}: ${account.name} is disabled`;
  if (ctx.companyCurrency && typeof account.account_currency === 'string' && account.account_currency
      && account.account_currency !== ctx.companyCurrency) {
    return `${key}: ${account.name} is kept in ${account.account_currency}, not ${ctx.companyCurrency}`;
  }
  if (key === 'employee_payable') {
    if (account.root_type !== 'Liability' || account.account_type !== 'Payable') {
      return `employee_payable: ${account.name} must be a Liability account of type Payable`;
    }
    if (!ctx.defaultPayableAccount) {
      return 'employee_payable: PMO cannot confirm this is not the supplier payable account — the company has no default payable account';
    }
    if (account.name === ctx.defaultPayableAccount) {
      return `employee_payable: ${account.name} is the company's supplier payable account; use a separate employee payable account`;
    }
    return null;
  }
  if (key === 'employee_advance') {
    if (account.root_type !== 'Asset' || account.account_type !== 'Payable') {
      return `employee_advance: ${account.name} must be an Asset account of type Payable`;
    }
    return null;
  }
  if (account.root_type !== 'Expense') return `${key}: ${account.name} must be an Expense account`;
  return null;
}
```

Verify GREEN: 5 passed. **Mutations (do not commit):** M8 delete the `account.name === ctx.defaultPayableAccount` branch →
the Creditors test red; M9 change the advance rule to `account.root_type !== 'Asset'` only → the untyped-advance test
red. Revert both → green.

### S13 — RED: resolver (AC-EXP-115)

Create `expensePostingResolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ErpAccountFacts } from './expenseAccountRules';
import type { ExpenseGateTruth } from './expensePostingCommand';
import type { ExpensePosting } from './expensePostingKey';
import { resolveExpensePosting, type ExpenseResolveDeps } from './expensePostingResolve';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
const ACCOUNTS: Record<string, ErpAccountFacts> = {
  'Employee Payable - PSC': { name: 'Employee Payable - PSC', root_type: 'Liability', account_type: 'Payable', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Creditors - PSC': { name: 'Creditors - PSC', root_type: 'Liability', account_type: 'Payable', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Employee Advances - PSC': { name: 'Employee Advances - PSC', root_type: 'Asset', account_type: 'Payable', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Travel Expenses - PSC': { name: 'Travel Expenses - PSC', root_type: 'Expense', account_type: '', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Meals - PSC': { name: 'Meals - PSC', root_type: 'Expense', account_type: '', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
};

function truth(posting: ExpensePosting, over: Partial<ExpenseGateTruth> = {}): ExpenseGateTruth {
  return {
    mirror_id: 'm1', posting, posting_identity: `${CLAIM}:${posting}`, subject_id: CLAIM, claim_id: CLAIM,
    claim_number: 'EXP-2610070001', claimant_id: 'user-e1', project_id: 'proj-1', currency: 'IDR', amount: '175.00',
    lines: [{ expense_type: 'Meals', amount: '25.00' }, { expense_type: 'Travel', amount: '150.00' }],
    state_stamp: '2026-10-07T10:00:00+00:00', posting_date: '2026-10-07', approval_posting_exists: true, actor_id: 'user-pm',
    ...over,
  };
}

function deps(over: Partial<ExpenseResolveDeps> = {}): ExpenseResolveDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: ExpenseResolveDeps = {
    readBinding: async () => { calls.push('binding'); return { company: 'PMO Smoke Co', cashAccount: 'Cash - PSC', costCenter: 'Main - PSC', projectMap: { 'proj-1': 'PROJ-0001' }, defaultPayableAccount: 'Creditors - PSC' }; },
    readConfirmedEmployee: async () => { calls.push('employee'); return 'HR-EMP-00002'; },
    readAccountMap: async () => { calls.push('map'); return { employee_payable: 'Employee Payable - PSC', employee_advance: 'Employee Advances - PSC', Travel: 'Travel Expenses - PSC', Meals: 'Meals - PSC' }; },
    readApprovalPosting: async () => { calls.push('approval'); return { push_state: 'pushed', erp_name: 'ACC-JV-2026-00002', erp_cancelled_at: null }; },
    readErpAccounts: async (names) => { calls.push('accounts'); return names.map((n) => ACCOUNTS[n]).filter(Boolean); },
    readErpCompanyCurrency: async () => { calls.push('currency'); return 'IDR'; },
    readErpJournalDocstatus: async () => { calls.push('docstatus'); return 1; },
  };
  return { ...base, ...over, calls };
}

describe('resolveExpensePosting (AC-EXP-115)', () => {
  it('AC-EXP-115 approval: ready with exactly the accounts it needs', async () => {
    expect(await resolveExpensePosting(truth('approval'), deps())).toEqual({ outcome: 'ready', refs: {
      company: 'PMO Smoke Co', employee: 'HR-EMP-00002', payableAccount: 'Employee Payable - PSC', advanceAccount: null,
      expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: 'PROJ-0001', costCenter: 'Main - PSC',
      cashAccount: 'Cash - PSC', approvalJournal: null } });
  });

  it('AC-EXP-115 refusals, each named, each before any ERP read', async () => {
    const unlinked = deps({ readConfirmedEmployee: async () => null });
    expect(await resolveExpensePosting(truth('approval'), unlinked)).toMatchObject({ outcome: 'refuse', code: 'employee-unlinked' });
    expect(unlinked.calls).not.toContain('accounts');
    expect(await resolveExpensePosting(truth('approval'), deps({ readAccountMap: async () => ({ employee_payable: 'Employee Payable - PSC', Travel: 'Travel Expenses - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-account-unmapped', message: expect.stringContaining('Meals') });
    expect(await resolveExpensePosting(truth('approval'), deps({ readBinding: async () => ({ company: 'PMO Smoke Co', cashAccount: 'Cash - PSC', costCenter: null, projectMap: {}, defaultPayableAccount: 'Creditors - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'project-unmapped' });
    expect(await resolveExpensePosting(truth('advance-payment'), deps({ readBinding: async () => ({ company: 'PMO Smoke Co', cashAccount: null, costCenter: null, projectMap: {}, defaultPayableAccount: 'Creditors - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-cash-account-unconfigured' });
    expect(await resolveExpensePosting(truth('approval'), deps({ readBinding: async () => ({ company: null, cashAccount: null, costCenter: null, projectMap: {}, defaultPayableAccount: null }) })))
      .toMatchObject({ outcome: 'refuse', code: 'config-rejected' });
  });

  it('AC-EXP-115 refuses Creditors as employee payable and a currency the company does not keep', async () => {
    expect(await resolveExpensePosting(truth('claim-payment'), deps({ readAccountMap: async () => ({ employee_payable: 'Creditors - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-account-invalid', message: expect.stringContaining('supplier payable') });
    expect(await resolveExpensePosting(truth('approval'), deps({ readErpCompanyCurrency: async () => 'USD' })))
      .toMatchObject({ outcome: 'refuse', code: 'config-rejected' });
  });

  it('AC-EXP-115 a payment waits for its approval journal, then references it', async () => {
    expect(await resolveExpensePosting(truth('claim-payment'), deps({ readApprovalPosting: async () => ({ push_state: 'pending', erp_name: null, erp_cancelled_at: null }) })))
      .toEqual({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' });
    const ready = await resolveExpensePosting(truth('claim-payment'), deps());
    expect(ready).toMatchObject({ outcome: 'ready', refs: { approvalJournal: 'ACC-JV-2026-00002', payableAccount: 'Employee Payable - PSC', cashAccount: 'Cash - PSC' } });
    expect(await resolveExpensePosting(truth('settlement'), deps({ readApprovalPosting: async () => ({ push_state: 'pushed', erp_name: 'ACC-JV-2026-00002', erp_cancelled_at: '2026-10-08T00:00:00Z' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-approval-journal-cancelled' });
  });

  it('AC-EXP-115 no approval intent (approved before employment): no reference, no read of it', async () => {
    const d = deps();
    expect(await resolveExpensePosting(truth('settlement', { approval_posting_exists: false }), d))
      .toMatchObject({ outcome: 'ready', refs: { approvalJournal: null, advanceAccount: 'Employee Advances - PSC' } });
    expect(d.calls).not.toContain('approval');
  });

  it('AC-EXP-115 cancel: waits for the approval, is done when ERPNext already cancelled it, else cancels it', async () => {
    expect(await resolveExpensePosting(truth('approval-cancel'), deps({ readApprovalPosting: async () => ({ push_state: 'failed', erp_name: null, erp_cancelled_at: null }) })))
      .toEqual({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' });
    expect(await resolveExpensePosting(truth('approval-cancel'), deps({ readErpJournalDocstatus: async () => 2 })))
      .toEqual({ outcome: 'already-done', erpName: 'ACC-JV-2026-00002' });
    expect(await resolveExpensePosting(truth('approval-cancel'), deps()))
      .toMatchObject({ outcome: 'ready', refs: { approvalJournal: 'ACC-JV-2026-00002' } });
  });
});
```

Verify RED: cannot resolve `./expensePostingResolve` / `./expensePostingCommand`.

### S14 — GREEN: `expensePostingResolve.ts` + the shared types (FR-EXP-106/110/111)

First create `expensePostingCommand.ts` with only the types (S16 adds the builder):

```ts
/**
 * #775 phase B — the expense posting command: gate truth + resolved refs → the frozen outbox payload (DD-EXP-15).
 */
import type { ExpensePosting } from './expensePostingKey.ts';

/** What `expense_posting_for_push` (0263 §5) returns — DB truth, never a payload. */
export interface ExpenseGateTruth {
  mirror_id: string;
  posting: ExpensePosting;
  posting_identity: string;
  subject_id: string;
  claim_id: string;
  claim_number: string | null;
  claimant_id: string;
  project_id: string | null;
  currency: string;
  amount: string;
  lines: Array<{ expense_type: string; amount: string }>;
  state_stamp: string;
  posting_date: string;
  approval_posting_exists: boolean;
  actor_id: string;
}

/** Everything a posting body needs, resolved before the outbox row exists. `null` = not needed by this posting. */
export interface ExpenseResolvedRefs {
  company: string;
  employee: string | null;
  payableAccount: string | null;
  advanceAccount: string | null;
  expenseAccounts: Record<string, string>;
  erpProject: string | null;
  costCenter: string | null;
  cashAccount: string | null;
  approvalJournal: string | null;
}
```

Then `expensePostingResolve.ts`:

```ts
/**
 * #775 phase B — FR-EXP-106/110/111: resolve every reference an expense posting needs, BEFORE the outbox row exists
 * (DD-EXP-15), fail closed. Pure orchestration over injected reads so it is Vitest- and Deno-importable; the sweep
 * wires the live reads (erpnext-sweep/index.ts `expenseResolveDepsLive`).
 * Outcomes: `ready` (drive it), `wait` (a dependency has not posted yet — leave the intent untouched), `refuse`
 * (record failed with the named code), `already-done` (a cancel ERPNext already shows — record pushed).
 */
import { expenseAccountProblem, type ErpAccountFacts, type ExpenseAccountKey } from './expenseAccountRules.ts';
import type { ExpenseGateTruth, ExpenseResolvedRefs } from './expensePostingCommand.ts';

export interface ExpenseBindingFacts {
  company: string | null;
  /** `default_cash_account ?? default_bank_account` of the binding (the account supplier payments use). */
  cashAccount: string | null;
  costCenter: string | null;
  projectMap: Record<string, string>;
  /** The company's supplier payable account (`Creditors`), from the binding config. */
  defaultPayableAccount: string | null;
}

export interface ExpenseApprovalPostingFacts {
  push_state: string;
  erp_name: string | null;
  erp_cancelled_at: string | null;
}

export interface ExpenseResolveDeps {
  readBinding(): Promise<ExpenseBindingFacts>;
  /** The claimant's CONFIRMED ERP Employee name (P3b link, 0148), or null. */
  readConfirmedEmployee(profileId: string): Promise<string | null>;
  readAccountMap(): Promise<Partial<Record<ExpenseAccountKey, string>>>;
  readApprovalPosting(claimId: string): Promise<ExpenseApprovalPostingFacts | null>;
  /** One fact row per account that exists; a missing account is simply absent. */
  readErpAccounts(names: string[]): Promise<ErpAccountFacts[]>;
  readErpCompanyCurrency(company: string): Promise<string | null>;
  readErpJournalDocstatus(name: string): Promise<number | null>;
}

export type ExpenseResolution =
  | { outcome: 'ready'; refs: ExpenseResolvedRefs }
  | { outcome: 'wait'; reason: string }
  | { outcome: 'refuse'; code: string; message: string }
  | { outcome: 'already-done'; erpName: string };

const refuse = (code: string, message: string): ExpenseResolution => ({ outcome: 'refuse', code, message });
const NOT_POSTED: ExpenseResolution = { outcome: 'wait', reason: 'expense-approval-journal-not-posted' };

/** The account keys a posting needs (FR-EXP-106). */
export function accountKeysFor(truth: ExpenseGateTruth): ExpenseAccountKey[] {
  switch (truth.posting) {
    case 'approval':
      return ['employee_payable', ...Array.from(new Set(truth.lines.map((l) => l.expense_type as ExpenseAccountKey)))];
    case 'settlement':
      return ['employee_payable', 'employee_advance'];
    case 'claim-payment':
      return ['employee_payable'];
    case 'advance-payment':
    case 'advance-return':
      return ['employee_advance'];
    case 'approval-cancel':
      return [];
  }
}

export async function resolveExpensePosting(truth: ExpenseGateTruth, deps: ExpenseResolveDeps): Promise<ExpenseResolution> {
  const binding = await deps.readBinding();
  if (!binding.company) return refuse('config-rejected', 'the ERPNext binding names no company');

  if (truth.posting === 'approval-cancel') {
    const approval = await deps.readApprovalPosting(truth.claim_id);
    if (!approval || approval.push_state !== 'pushed' || !approval.erp_name) return NOT_POSTED;
    if ((await deps.readErpJournalDocstatus(approval.erp_name)) === 2) return { outcome: 'already-done', erpName: approval.erp_name };
    return { outcome: 'ready', refs: {
      company: binding.company, employee: null, payableAccount: null, advanceAccount: null, expenseAccounts: {},
      erpProject: null, costCenter: null, cashAccount: null, approvalJournal: approval.erp_name } };
  }

  const isPaymentEntry = truth.posting === 'claim-payment' || truth.posting === 'advance-payment' || truth.posting === 'advance-return';
  if (isPaymentEntry && !binding.cashAccount) {
    return refuse('expense-cash-account-unconfigured', 'the ERPNext binding has no default cash or bank account');
  }
  const employee = await deps.readConfirmedEmployee(truth.claimant_id);
  if (!employee) return refuse('employee-unlinked', 'the claimant has no confirmed ERPNext employee link — an Admin must confirm it');

  const keys = accountKeysFor(truth);
  const map = await deps.readAccountMap();
  const missing = keys.filter((key) => !map[key]);
  if (missing.length > 0) {
    return refuse('expense-account-unmapped', `map these accounts in Administration › Accounting: ${missing.join(', ')}`);
  }

  let erpProject: string | null = null;
  if (truth.posting === 'approval' && truth.project_id) {
    erpProject = binding.projectMap[truth.project_id] ?? null;
    if (!erpProject) return refuse('project-unmapped', 'the claim’s project is not linked to an ERPNext project');
  }

  let approvalJournal: string | null = null;
  if ((truth.posting === 'claim-payment' || truth.posting === 'settlement') && truth.approval_posting_exists) {
    const approval = await deps.readApprovalPosting(truth.claim_id);
    if (!approval || approval.push_state !== 'pushed' || !approval.erp_name) return NOT_POSTED;
    if (approval.erp_cancelled_at) {
      return refuse('expense-approval-journal-cancelled', 'the approval journal entry was cancelled in ERPNext');
    }
    approvalJournal = approval.erp_name;
  }

  const companyCurrency = await deps.readErpCompanyCurrency(binding.company);
  if (!companyCurrency) return refuse('config-rejected', 'ERPNext states no default currency for the company');
  if (companyCurrency !== truth.currency) {
    return refuse('config-rejected', `the claim is in ${truth.currency} but the ERPNext company keeps its books in ${companyCurrency}`);
  }
  const facts = await deps.readErpAccounts(Array.from(new Set(keys.map((key) => map[key] as string))));
  for (const key of keys) {
    const problem = expenseAccountProblem(key, facts.find((f) => f.name === map[key]) ?? null, {
      company: binding.company, companyCurrency, defaultPayableAccount: binding.defaultPayableAccount,
    });
    if (problem) return refuse('expense-account-invalid', problem);
  }

  const expenseAccounts: Record<string, string> = {};
  for (const key of keys) if (key !== 'employee_payable' && key !== 'employee_advance') expenseAccounts[key] = map[key] as string;
  return { outcome: 'ready', refs: {
    company: binding.company,
    employee,
    payableAccount: keys.includes('employee_payable') ? (map.employee_payable as string) : null,
    advanceAccount: keys.includes('employee_advance') ? (map.employee_advance as string) : null,
    expenseAccounts,
    erpProject,
    costCenter: binding.costCenter,
    cashAccount: binding.cashAccount,
    approvalJournal,
  } };
}
```

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts` → 6 passed.
**Mutation (do not commit):** M10 delete the `if (approval.erp_cancelled_at)` branch → test 4 red; revert.

### S15 — RED: command builder (AC-EXP-117) and the cancel transition (AC-EXP-127)

Create `expensePostingCommand.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildExpensePostingCommand, type ExpenseGateTruth, type ExpenseResolvedRefs } from './expensePostingCommand';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
const STAMP = '2026-10-07T10:00:00.123+00:00';
const EPOCH = '1791367200123';
const AFTER = '2026-10-07 09:59:00';
const t = (over: Partial<ExpenseGateTruth>): ExpenseGateTruth => ({
  mirror_id: 'm1', posting: 'approval', posting_identity: `${CLAIM}:approval`, subject_id: CLAIM, claim_id: CLAIM,
  claim_number: 'EXP-2610070001', claimant_id: 'u-e1', project_id: 'p1', currency: 'IDR', amount: '175.00',
  lines: [{ expense_type: 'Meals', amount: '25.00' }, { expense_type: 'Travel', amount: '150.00' }],
  state_stamp: STAMP, posting_date: '2026-10-07', approval_posting_exists: true, actor_id: 'u-pm', ...over,
});
const r: ExpenseResolvedRefs = {
  company: 'PMO Smoke Co', employee: 'HR-EMP-00002', payableAccount: 'Employee Payable - PSC', advanceAccount: 'Employee Advances - PSC',
  expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: 'PROJ-0001', costCenter: 'Main - PSC',
  cashAccount: 'Cash - PSC', approvalJournal: 'ACC-JV-2026-00002',
};

describe('buildExpensePostingCommand (AC-EXP-117)', () => {
  it('AC-EXP-117 approval → expense-journal create, frozen journal rows', () => {
    const cmd = buildExpensePostingCommand(t({}), { ...r, approvalJournal: null }, AFTER);
    expect(cmd).toMatchObject({ domain: 'expenses', operation: 'create', idempotencyKey: `expj:${CLAIM}:${EPOCH}`, outboxIdentity: `${CLAIM}:approval` });
    expect(cmd.record).toEqual({
      id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval', posting_identity: `${CLAIM}:approval`, outbox_identity: `${CLAIM}:approval`,
      claim_id: CLAIM, company: 'PMO Smoke Co', posting_date: '2026-10-07', currency: 'IDR',
      journal_rows: [
        { account: 'Meals - PSC', debit: '25.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Travel Expenses - PSC', debit: '150.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Employee Payable - PSC', credit: '175.00', party: 'HR-EMP-00002' },
      ],
    });
  });

  it('AC-EXP-117 settlement → payable row references the approval', () => {
    const cmd = buildExpensePostingCommand(t({ posting: 'settlement', posting_identity: `${CLAIM}:settlement`, amount: '50.00' }), r, AFTER);
    expect(cmd.idempotencyKey).toBe(`exps:${CLAIM}:${EPOCH}`);
    expect(cmd.record.journal_rows).toEqual([
      { account: 'Employee Payable - PSC', debit: '50.00', party: 'HR-EMP-00002', reference_name: 'ACC-JV-2026-00002' },
      { account: 'Employee Advances - PSC', credit: '50.00', party: 'HR-EMP-00002' },
    ]);
  });

  it('AC-EXP-117 claim payment → expense-payment with the composite-probe fields frozen in', () => {
    const cmd = buildExpensePostingCommand(t({ posting: 'claim-payment', posting_identity: `${CLAIM}:claim-payment`, amount: '100.00' }), r, AFTER);
    expect(cmd.idempotencyKey).toBe(`expp:${CLAIM}:${EPOCH}`);
    expect(cmd.record).toMatchObject({
      erp_doc_kind: 'expense-payment', payment_type: 'Pay', party_type: 'Employee', party: 'HR-EMP-00002',
      paid_from: 'Cash - PSC', paid_to: 'Employee Payable - PSC', paid_amount: '100.00', approval_journal: 'ACC-JV-2026-00002',
      je_names: ['ACC-JV-2026-00002'], pi_names: [], si_names: [], created_after: AFTER,
    });
  });

  it('AC-EXP-117 advance return → expense-receipt, subject = the return row', () => {
    const RET = '9c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff';
    const cmd = buildExpensePostingCommand(t({ posting: 'advance-return', posting_identity: `${RET}:advance-return`, subject_id: RET, amount: '20.00' }), r, AFTER);
    expect(cmd).toMatchObject({ outboxIdentity: `${RET}:advance-return`, idempotencyKey: `expr:${RET}:${EPOCH}` });
    expect(cmd.record).toMatchObject({ id: RET, erp_doc_kind: 'expense-receipt', payment_type: 'Receive',
      paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', je_names: [] });
  });

  it('AC-EXP-117 approval cancel → transition cancel on the approval document, on the approval identity', () => {
    const cmd = buildExpensePostingCommand(t({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }), r, AFTER);
    expect(cmd).toMatchObject({ operation: 'transition', outboxIdentity: `${CLAIM}:approval`, idempotencyKey: `expx:${CLAIM}:${EPOCH}` });
    expect(cmd.record).toMatchObject({ erp_doc_kind: 'expense-journal', verb: 'cancel', externalRecordId: 'ACC-JV-2026-00002', posting_identity: `${CLAIM}:approval-cancel` });
  });

  it('AC-EXP-117 refuses to build when a needed reference is missing', () => {
    expect(() => buildExpensePostingCommand(t({}), { ...r, employee: null }, AFTER)).toThrow(/ERPNext employee/);
    expect(() => buildExpensePostingCommand(t({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }), { ...r, approvalJournal: null }, AFTER))
      .toThrow(/approval journal/);
  });
});

describe('expense approval cancel through the adapter (AC-EXP-127)', () => {
  it('AC-EXP-127 issues exactly one PUT {docstatus:2} on the approval Journal Entry, then re-reads it', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002', docstatus: 2, modified: 'm2' }));
    };
    const cmd = buildExpensePostingCommand(t({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }), r, AFTER);
    const adapter = createErpAdapter({
      client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
      doctypeBodies: DOCTYPE_BODIES, ctx: { refs: {}, config: {} },
    });
    const result = await adapter.commit({ domain: cmd.domain, operation: cmd.operation, record: cmd.record, idempotencyKey: cmd.idempotencyKey });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(calls[0].url).toContain('/api/resource/Journal%20Entry/ACC-JV-2026-00002');
    expect(calls[0].body).toEqual({ docstatus: 2 });
    expect(result.canonical).toMatchObject({ erp_docstatus: 2 });
  });
});
```

Verify RED: `buildExpensePostingCommand` is not exported.

### S16 — GREEN: the builder (FR-EXP-105/110/111)

Append to `expensePostingCommand.ts` (add the imports at the top of the file):

```ts
import { AdapterError } from '../contract.ts';
import type { ErpDocKind } from './doctypeRegistry.ts';
import { expenseOutboxIdentity, expensePostingKey } from './expensePostingKey.ts';
import type { ExpenseJournalRow } from './bodies/expenseJournal.ts';

export const EXPENSE_KIND_BY_POSTING: Readonly<Record<ExpensePosting, ErpDocKind>> = {
  approval: 'expense-journal',
  settlement: 'expense-journal',
  'approval-cancel': 'expense-journal',
  'claim-payment': 'expense-payment',
  'advance-payment': 'expense-payment',
  'advance-return': 'expense-receipt',
};

export interface ExpensePostingCommand {
  domain: 'expenses';
  operation: 'create' | 'transition';
  idempotencyKey: string;
  /** The outbox / external_refs identity (the cancel uses the approval's). */
  outboxIdentity: string;
  record: { id: string; erp_doc_kind: ErpDocKind } & Record<string, unknown>;
}

function need(value: string | null | undefined, what: string): string {
  if (!value) throw new AdapterError('commit-rejected', `expense posting: ${what} is not resolved`);
  return value;
}

/**
 * Build the command whose `record` is persisted VERBATIM as the outbox payload (digest-bound, replayed by recovery).
 * `createdAfter` is the composite probe's claim-window floor (`YYYY-MM-DD HH:MM:SS`); it is excluded from the digest.
 */
export function buildExpensePostingCommand(truth: ExpenseGateTruth, refs: ExpenseResolvedRefs, createdAfter: string): ExpensePostingCommand {
  const kind = EXPENSE_KIND_BY_POSTING[truth.posting];
  const idempotencyKey = expensePostingKey(truth.posting, truth.subject_id, truth.state_stamp);
  const outboxIdentity = expenseOutboxIdentity(truth.posting, truth.subject_id);
  const base = {
    id: truth.subject_id.toLowerCase(), erp_doc_kind: kind, posting: truth.posting, posting_identity: truth.posting_identity,
    outbox_identity: outboxIdentity, claim_id: truth.claim_id, company: refs.company, posting_date: truth.posting_date,
    currency: truth.currency,
  };
  const create = (record: Record<string, unknown>): ExpensePostingCommand =>
    ({ domain: 'expenses', operation: 'create', idempotencyKey, outboxIdentity, record: { ...base, ...record } });

  switch (truth.posting) {
    case 'approval': {
      const employee = need(refs.employee, 'the ERPNext employee');
      const rows: ExpenseJournalRow[] = truth.lines.map((line) => ({
        account: need(refs.expenseAccounts[line.expense_type], `the ${line.expense_type} expense account`),
        debit: line.amount, project: refs.erpProject, cost_center: refs.costCenter,
      }));
      rows.push({ account: need(refs.payableAccount, 'the employee payable account'), credit: truth.amount, party: employee });
      return create({ journal_rows: rows });
    }
    case 'settlement': {
      const employee = need(refs.employee, 'the ERPNext employee');
      const payableRow: ExpenseJournalRow = { account: need(refs.payableAccount, 'the employee payable account'), debit: truth.amount, party: employee };
      if (refs.approvalJournal) payableRow.reference_name = refs.approvalJournal;
      return create({ journal_rows: [
        payableRow,
        { account: need(refs.advanceAccount, 'the employee advance account'), credit: truth.amount, party: employee },
      ] });
    }
    case 'claim-payment':
    case 'advance-payment':
    case 'advance-return': {
      const employee = need(refs.employee, 'the ERPNext employee');
      const cash = need(refs.cashAccount, 'the cash or bank account');
      const receive = truth.posting === 'advance-return';
      const partyAccount = truth.posting === 'claim-payment'
        ? need(refs.payableAccount, 'the employee payable account')
        : need(refs.advanceAccount, 'the employee advance account');
      const journal = truth.posting === 'claim-payment' ? refs.approvalJournal : null;
      return create({
        payment_type: receive ? 'Receive' : 'Pay', party_type: 'Employee', party: employee,
        paid_from: receive ? partyAccount : cash, paid_to: receive ? cash : partyAccount, paid_amount: truth.amount,
        approval_journal: journal,
        // ADR-0058 C-1 composite-probe inputs, frozen with the command (read back by buildOutboxProbe).
        je_names: journal ? [journal] : [], pi_names: [], si_names: [], created_after: createdAfter,
      });
    }
    case 'approval-cancel':
      return {
        domain: 'expenses', operation: 'transition', idempotencyKey, outboxIdentity,
        record: { ...base, verb: 'cancel', externalRecordId: need(refs.approvalJournal, 'the approval journal entry') },
      };
  }
}
```

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts` → 7 passed.

### S17 — RED: Employee composite probe (AC-EXP-116)

Create `recoveryProbe.employee.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { probeErpByPaymentComposite } from './recoveryProbe';
import type { ErpClientDeps } from './client';

function client(docs: Record<string, Record<string, unknown>>, compositeNames: string[]): ErpClientDeps {
  const fetchImpl = async (url: string) => {
    if (url.includes('filters=')) {
      const filters = decodeURIComponent(url);
      const names = filters.includes('"reference_no","like"') ? [] : compositeNames;
      return new Response(JSON.stringify({ data: names.map((name) => ({ name })) }));
    }
    const name = decodeURIComponent(url.split('/').pop()!.split('?')[0]);
    return new Response(JSON.stringify(docs[name]));
  };
  return { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' };
}
const deps = (c: ErpClientDeps) => ({ client: c, doctype: 'Payment Entry', anchorField: 'reference_no', pmoRecordId: 'claim-1:claim-payment',
  fromDoc: (doc: unknown) => ({ id: String((doc as { name: string }).name) }) });
const input = (over: Record<string, unknown> = {}) => ({ partyType: 'Employee', party: 'HR-EMP-00002', paidAmount: '100.00', piNames: [], siNames: [],
  createdAfter: '2026-10-07 09:59:00', paymentType: 'Pay' as const, journalNames: ['ACC-JV-2026-00002'], ...over });

describe('Employee composite probe (AC-EXP-116)', () => {
  it('AC-EXP-116 adopts the unique candidate citing the approval journal', async () => {
    const c = client({
      'PE-1': { name: 'PE-1', references: [{ reference_name: 'ACC-JV-2026-00002' }] },
      'PE-2': { name: 'PE-2', references: [{ reference_name: 'ACC-JV-2026-00009' }] },
    }, ['PE-1', 'PE-2']);
    expect(await probeErpByPaymentComposite(deps(c), 'expp:x', input())).toEqual({ externalRecordId: 'PE-1', canonical: { id: 'claim-1:claim-payment' } });
  });

  it('AC-EXP-116 with no journal to cite, adopts only a unique no-reference candidate', async () => {
    const c = client({ 'PE-3': { name: 'PE-3', references: [] }, 'PE-4': { name: 'PE-4', references: [{ reference_name: 'X' }] } }, ['PE-3', 'PE-4']);
    expect(await probeErpByPaymentComposite(deps(c), 'expa:x', input({ journalNames: [] }))).toEqual({ externalRecordId: 'PE-3', canonical: { id: 'claim-1:claim-payment' } });
  });

  it('AC-EXP-116 two matching candidates are inconclusive (held, never adopted)', async () => {
    const c = client({ 'PE-5': { name: 'PE-5', references: [] }, 'PE-6': { name: 'PE-6', references: [] } }, ['PE-5', 'PE-6']);
    expect(await probeErpByPaymentComposite(deps(c), 'expa:x', input({ journalNames: [] }))).toBeNull();
  });

  it('AC-EXP-116 a Supplier probe with no cited invoice still matches nothing (unchanged)', async () => {
    const c = client({ 'PE-7': { name: 'PE-7', references: [] } }, ['PE-7']);
    expect(await probeErpByPaymentComposite(deps(c), 'k', input({ partyType: 'Supplier', journalNames: undefined }))).toBeNull();
  });
});
```

Verify RED: test 2 and 3 fail (the no-reference candidate is never matched) and TypeScript flags `journalNames`.

### S18 — GREEN: probe + discriminator maps (FR-EXP-105)

`recoveryProbe.ts`:
1. In `ErpPaymentCompositeInput` add, after `allocatedAmount?`:

```ts
  /** #775 phase B — an Employee Payment Entry's cited Journal Entries (the approval it settles). Empty ⇒ the
   *  posting cites none (an advance payment/return), so only a candidate with NO references can be ours. Read
   *  ONLY when `partyType === 'Employee'`; every Supplier/Customer probe is byte-for-byte unchanged. */
  journalNames?: string[];
```

2. In `probeErpByPaymentComposite`'s `for (const name of names)` loop, insert as the first statements after
   `const references = …;`:

```ts
    if (input.partyType === 'Employee') {
      const journals = input.journalNames ?? [];
      const cites = journals.length === 0
        ? references.length === 0
        : references.some((r) => journals.includes(String(r.reference_name)));
      if (cites) matches.push({ name, doc });
      continue;
    }
```

`dispatchFactory.ts` — in `PAYMENT_TYPE_BY_KIND` add `'expense-payment': 'Pay', 'expense-receipt': 'Receive',`.

Verify GREEN:
`../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/recoveryProbe.employee.test.ts src/lib/adapterSeam/erpnext/recoveryProbe.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.test.ts`
→ green.

### S19 — Part 3 gate

From `pmo-portal/`: `npm run typecheck` (0), `npx eslint --max-warnings=0 src/lib/adapterSeam/erpnext`,
`../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam` (green). Commit:
`feat(expenses): ERPNext expense posting kinds, bodies, resolver and command (#775 phase B)`.

Next: [part 4 — edge functions](2026-10-07-expense-claims-phase-b.part4-edge.md).
