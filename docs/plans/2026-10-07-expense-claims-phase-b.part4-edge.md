# Plan part 4 — #775 phase B: edge functions (Tasks E1–E17)

Part of [`2026-10-07-expense-claims-phase-b.md`](2026-10-07-expense-claims-phase-b.md). Conventions: §1.8 there.
Deno commands use the CI invocation (`scripts/deno-test-edge-fns.sh`):

- a function's test: `cd supabase/functions/<fn> && deno test <file> --config deno.json --allow-env --allow-net --allow-read`
- a `_shared` test: `cd supabase/functions/erpnext-sweep && deno test ../_shared/<file> --config deno.json --allow-env --allow-net --allow-read`

---

### E1 — adapter-dispatch refuses the `expenses` domain (AC-EXP-123, FR-EXP-103)

Create `supabase/functions/adapter-dispatch/expensesRefused.test.ts`:

```ts
// AC-EXP-123 [Deno, served handler] — no client can originate an expense posting (ADR-0081): adapter-dispatch has
// no `expenses` route, so a well-formed command from an authenticated Finance user is refused before any outbox
// or ERP call. Guards against someone "helpfully" adding the domain to ADAPTER_REGISTRY / isErpDomain.
import { assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => {
  handler = h;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG = '00000000-0000-4000-8000-000000000a01';
const USER = '00000000-0000-4000-8000-000000000a02';
const CLAIM = '00000000-0000-4000-8000-000000000a03';

Deno.test('AC-EXP-123 an expenses command is refused with UNSUPPORTED_DOMAIN before any outbox or ERP call', async () => {
  const jwt = await auth.mintJwt({ sub: USER });
  const result = await withFetchMock([{
    label: 'expenses refused',
    response: (call: FetchCall) => {
      if (call.url.pathname === '/rest/v1/profiles') return jsonResponse({ org_id: ORG });
      if (call.url.pathname.startsWith('/rest/v1/')) return jsonResponse(null);
      throw new Error(`unexpected ${call.method} ${call.url.pathname}`);
    },
  }], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'expenses', operation: 'create', idempotencyKey: `expj:${CLAIM}:1791367200123`,
        record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval' } }),
    }));
    return { status: res.status, body: await res.json(), calls };
  });
  assertEquals(result.status, 400, JSON.stringify(result.body));
  assertEquals((result.body as { error?: string }).error, 'UNSUPPORTED_DOMAIN');
  assertEquals(result.calls.filter((c) => c.url.pathname.includes('external_command_outbox') || c.url.pathname.startsWith('/api/resource/')).length, 0);
});
```

Verify: `cd supabase/functions/adapter-dispatch && deno test expensesRefused.test.ts --config deno.json --allow-env --allow-net --allow-read`
→ 1 passed (the guard holds by construction — this test pins it).
**Mutation M11 (do not commit):** in `adapter-dispatch/index.ts` add
`[ERPNEXT_EXPENSES_DOMAIN]: resolveErpAdapter,` to `ADAPTER_REGISTRY` (import the constant) → the test is red; revert.

### E2 — The `expenses` role rule is delegated to the gate (AC-EXP-125, FR-EXP-104)

Create `supabase/functions/adapter-dispatch/authGuard.expenses.test.ts`:

```ts
// AC-EXP-125 [Deno] — the sweep re-authorizes expense replays with checkErpnextCommandAuthorization. The ROLE half
// is delegated to expense_posting_for_push (0270 §5 re-checks the recorded actor's current role); the ACTIVE half
// and the kind/domain check still apply here.
import { assertEquals } from '@std/assert';
import { checkErpnextCommandAuthorization } from './authGuard.ts';

const client = (role: string, active: boolean) => ({
  rpc: async (fn: string) => {
    if (fn === 'domain_owned_by_tier') return { data: true, error: null };
    if (fn === 'actor_authorization_state') return { data: { role, active }, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  },
});
const cmd = { domain: 'expenses', operation: 'create', record: { id: 'claim-1:approval', erp_doc_kind: 'expense-journal' } };

Deno.test('AC-EXP-125 an active Project Manager approver passes the role half (delegated to the DB gate)', async () => {
  assertEquals((await checkErpnextCommandAuthorization(client('Project Manager', true), 'org-1', 'u-1', cmd)).ok, true);
});
Deno.test('AC-EXP-125 an inactive actor is refused', async () => {
  const r = await checkErpnextCommandAuthorization(client('Finance', false), 'org-1', 'u-1', cmd);
  assertEquals([r.ok, r.status], [false, 403]);
});
Deno.test('AC-EXP-125 a kind of another domain is refused', async () => {
  const r = await checkErpnextCommandAuthorization(client('Finance', true), 'org-1', 'u-1', { ...cmd, record: { id: 'x', erp_doc_kind: 'payment' } });
  assertEquals([r.ok, r.status], [false, 422]);
});
```

Verify RED: test 1 fails (`role "Project Manager" not authorized for a "expenses" money write`).
GREEN: `supabase/functions/adapter-dispatch/authGuard.ts` — `const ROLE_RULE_DELEGATED_TO_DB_GATE = new Set(['timesheets']);` →

```ts
// #775 phase B: `expenses` — the approver (approval rank) or payer (Finance/Admin) is re-checked by
// expense_posting_for_push (0270 §5) against the recorded actor's CURRENT role before every fresh posting.
const ROLE_RULE_DELEGATED_TO_DB_GATE = new Set(['timesheets', 'expenses']);
```

Verify GREEN: same command → 3 passed.

### E3 — RED: the `expenses` read-model writer (AC-EXP-124)

Create `supabase/functions/adapter-dispatch/readModelWriters.expenses.test.ts`:

```ts
// AC-EXP-124 [Deno] — a landed expense posting marks its intent pushed; a landed cancel also tombstones the approval.
import { assertEquals, assertRejects } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

function fake() {
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Array<[string, string]> }> = [];
  const client = {
    from(table: string) {
      return {
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
        update(patch: Record<string, unknown>) {
          const entry = { table, patch, filters: [] as Array<[string, string]> };
          updates.push(entry);
          const chain = {
            eq(column: string, value: string) { entry.filters.push([column, value]); return chain; },
            then(resolve: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
          };
          return chain;
        },
      };
    },
    rpc: async () => ({ error: null }),
  };
  return { client, updates };
}

Deno.test('AC-EXP-124 a landed posting marks its intent pushed with the ERP name', async () => {
  const f = fake();
  await getReadModelWriter('expenses').upsert({ serviceClient: f.client as never, orgId: 'org-1' },
    { id: 'ACC-JV-2026-00002', erp_docstatus: 1, erp_modified: 'm1' },
    { domain: 'expenses', operation: 'create',
      record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval', posting_identity: `${CLAIM}:approval` } });
  assertEquals(f.updates.length, 1);
  assertEquals(f.updates[0].table, 'expense_posting_erp_mirror');
  assertEquals([f.updates[0].patch.push_state, f.updates[0].patch.erp_name, f.updates[0].patch.erp_docstatus], ['pushed', 'ACC-JV-2026-00002', 1]);
  assertEquals(f.updates[0].filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval`]]);
});

Deno.test('AC-EXP-124 a landed cancel marks the cancel pushed and the approval cancelled', async () => {
  const f = fake();
  await getReadModelWriter('expenses').upsert({ serviceClient: f.client as never, orgId: 'org-1' },
    { id: 'ACC-JV-2026-00002', erp_docstatus: 2, erp_modified: 'm2' },
    { domain: 'expenses', operation: 'transition',
      record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` } });
  assertEquals(f.updates.length, 2);
  assertEquals(f.updates[1].filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval`]]);
  assertEquals(f.updates[1].patch.erp_docstatus, 2);
  assertEquals(typeof f.updates[1].patch.erp_cancelled_at, 'string');
});

Deno.test('AC-EXP-124 a command without a posting identity throws', async () => {
  const f = fake();
  await assertRejects(() => getReadModelWriter('expenses').upsert({ serviceClient: f.client as never, orgId: 'org-1' },
    { id: 'X' }, { domain: 'expenses', operation: 'create', record: { id: CLAIM, erp_doc_kind: 'expense-journal' } }));
});
```

Verify RED: `no read-model writer registered for domain "expenses"`.

### E4 — GREEN: `expensesWriter` (FR-EXP-115)

`supabase/functions/adapter-dispatch/readModelWriters.ts` — above `export const READ_MODEL_WRITERS`:

```ts
/**
 * #775 phase B (ADR-0059 §6, ADR-0081) — the expense side mirror. The intent row exists already (0270 trigger);
 * a landed posting marks it `pushed` with the ERP name. A landed `approval-cancel` also stamps the approval row
 * cancelled, so the feed's later tombstone of that Journal Entry is recognised as PMO's own (no notice).
 * Keyed on (org_id, posting_identity) — never `id` (the L-1 lesson: the mirror's own uuid is not the PMO key).
 */
const expensesWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const rec = command.record as { posting?: unknown; posting_identity?: unknown };
    const identity = typeof rec.posting_identity === 'string' ? rec.posting_identity : '';
    if (!identity) throw new AppError('expense posting command carries no posting identity', 'commit-rejected');
    const erpModified = (canonical.erp_modified as string | null | undefined) ?? null;
    const now = new Date().toISOString();
    const write = async (postingIdentity: string, patch: Record<string, unknown>): Promise<void> => {
      const { error } = await (ctx.serviceClient.from('expense_posting_erp_mirror').update(patch)
        .eq('org_id', ctx.orgId).eq('posting_identity', postingIdentity) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>);
      if (error) throw new AppError(`expense_posting_erp_mirror write failed: ${error.message}`, 'DISPATCH_FAILED');
    };
    await write(identity, {
      push_state: 'pushed', push_error: null, erp_name: String(canonical.id), pushed_at: now,
      erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null, erp_modified: erpModified,
    });
    if (rec.posting === 'approval-cancel') {
      await write(identity.replace(/:approval-cancel$/, ':approval'), { erp_docstatus: 2, erp_cancelled_at: now, erp_modified: erpModified });
    }
  },
};
```

and in `READ_MODEL_WRITERS` after `timesheets: timesheetsWriter,`:

```ts
  // #775 phase B — the expense posting side mirror (ADR-0081). Additive.
  expenses: expensesWriter,
```

Verify GREEN: `cd supabase/functions/adapter-dispatch && deno test readModelWriters.expenses.test.ts --config deno.json --allow-env --allow-net --allow-read` → 3 passed.

### E5 — RED: inbound feed — never adopt, desk-cancel notice (AC-EXP-126)

Create `supabase/functions/_shared/erpnextFeedDeps.expenses.test.ts`:

```ts
// AC-EXP-126 [Deno] — the expense kinds are lifecycle-only inbound (FR-EXP-113): a native ERP document is never
// adopted (no mirror row, no external_refs claim); a cancel of a posted approval raises a notice unless PMO's own
// approval-cancel did it.
import { assertEquals } from '@std/assert';
import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import { terminalApplyReason } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedErrorPolicy.ts';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

function fakeClient(rows: Record<string, unknown[]>) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const builder = (table: string, op: string, payload?: unknown) => {
    calls.push({ table, op, payload });
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'is', 'in', 'contains', 'limit', 'order', 'select']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: op === 'select' ? (rows[table] ?? []) : null, error: null }).then(resolve);
    return chain;
  };
  const client = {
    from: (table: string) => ({
      select: () => builder(table, 'select'),
      insert: (p: unknown) => builder(table, 'insert', p),
      update: (p: unknown) => builder(table, 'update', p),
      upsert: (p: unknown) => builder(table, 'upsert', p),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
  return { client, calls };
}

Deno.test('AC-EXP-126 a native Journal Entry is not adopted: no claim strategy, a terminal code, no writes', async () => {
  const f = fakeClient({});
  const deps = createErpFeedDeps(f.client as never, 'org-1', 'expense-journal');
  assertEquals('adoptAtomically' in deps, false);
  let code: string | undefined;
  try {
    await deps.mintMirror({ id: 'ACC-JV-2026-00099' } as never, Date.now());
  } catch (err) {
    code = (err as { code?: string }).code;
  }
  assertEquals(code, 'native-expense-posting-not-adopted');
  assertEquals(terminalApplyReason({ code }), 'native-expense-posting-not-adopted');
  assertEquals(f.calls.filter((c) => c.op === 'insert' || c.op === 'upsert').length, 0);
});

Deno.test('AC-EXP-126 PMO\'s own cancel of an approval raises no notice', async () => {
  const f = fakeClient({ expense_posting_erp_mirror: [{ id: 'cancel-intent' }], profiles: [{ id: 'admin-1' }] });
  await createErpFeedDeps(f.client as never, 'org-1', 'expense-journal').tombstoneMirror(`${CLAIM}:approval`, '2026-10-08 10:00:00');
  assertEquals(f.calls.some((c) => c.table === 'notifications' && c.op === 'insert'), false);
});

Deno.test('AC-EXP-126 a desk cancel of a posted approval raises expense-posting-desk-cancelled', async () => {
  const f = fakeClient({ profiles: [{ id: 'admin-1' }] });
  await createErpFeedDeps(f.client as never, 'org-1', 'expense-journal').tombstoneMirror(`${CLAIM}:approval`, '2026-10-08 10:00:00');
  const insert = f.calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assertEquals(JSON.stringify(insert?.payload ?? '').includes('expense-posting-desk-cancelled'), true);
});
```

Verify RED: `cd supabase/functions/erpnext-sweep && deno test ../_shared/erpnextFeedDeps.expenses.test.ts --config deno.json --allow-env --allow-net --allow-read`
→ test 1 fails (`adoptAtomically` present; procurement-inbound code), test 3 fails (no notice).

### E6 — GREEN: feed deps + terminal code (FR-EXP-113)

1. `pmo-portal/src/lib/adapterSeam/erpnext/feedErrorPolicy.ts` — in `TERMINAL_APPLY_REASONS` add
   `'native-expense-posting-not-adopted',` after `'native-timesheet-not-adopted',`, and add to the header bullet list:
   `*   • \`native-expense-posting-not-adopted\` (FR-EXP-113) — a Journal/Employee Payment Entry PMO did not post;`.
2. `supabase/functions/_shared/erpnextFeedDeps.ts`:
   - `pmoRecordLookupColumn`: add as the first line of the body
     `if (KIND_DOMAIN[kind] === 'expenses') return 'posting_identity';`
   - the adopt strategy spread: `...(kind === 'timesheet' || kind === 'budget' ? {} : {` →
     `...(kind === 'timesheet' || kind === 'budget' || KIND_DOMAIN[kind] === 'expenses' ? {} : {` and add to the comment
     above it: `// #775 phase B — the expense kinds take the IDENTICAL exclusion (never adopt, FR-EXP-113).`
   - `tombstoneMirror`: after the `if (kind === 'budget') { … }` block add
     ```ts
      // #775 phase B (FR-EXP-113) — a posted expense document cancelled in ERPNext. PMO's own approval-cancel is
      // expected and silent; anything else is a human acting in a headless ERP and must be surfaced.
      if (KIND_DOMAIN[kind] === 'expenses') {
        await surfaceExpenseDeskCancelUnlessOurs(serviceClient, orgId, pmoRecordId);
      }
     ```
   - `mintMirrorRow`: directly above the `if (domain === 'revenue') {` line add
     ```ts
  // #775 phase B (FR-EXP-113, DD-EXP-19) — never adopt. An unmapped Journal Entry / Employee Payment Entry was not
  // posted by PMO (payroll, a manual entry): mint nothing, raise no notice (these are normal ERP activity), and
  // throw the classified terminal code so the feed acks and moves on.
  if (domain === 'expenses') {
    throw new AppError(
      `native ERPNext document "${String(canonical.id ?? '')}" is not adopted — PMO posts expense entries itself (FR-EXP-113)`,
      'native-expense-posting-not-adopted',
    );
  }
     ```
   - `isPmoSoTKind`: `return kind === 'timesheet' || kind === 'budget';` →
     `return kind === 'timesheet' || kind === 'budget' || KIND_DOMAIN[kind] === 'expenses';`
   - append, below `surfaceActionRequired`:
     ```ts
/** #775 phase B — raise `expense-posting-desk-cancelled` unless PMO queued this cancel itself. Only an approval
 *  can be cancelled by PMO (`<claim>:approval-cancel`); a cancel of any other posting is never PMO's. */
async function surfaceExpenseDeskCancelUnlessOurs(serviceClient: SupabaseClient, orgId: string, postingIdentity: string): Promise<void> {
  if (postingIdentity.endsWith(':approval')) {
    const { data, error } = await serviceClient.from('expense_posting_erp_mirror').select('id')
      .eq('org_id', orgId).eq('posting_identity', `${postingIdentity}-cancel`).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (data) return;
  }
  await surfaceActionRequired(serviceClient, orgId, 'expense-posting-desk-cancelled', { postingIdentity });
}
     ```

Verify GREEN: the E5 command → 3 passed; `cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read` → green.
**Mutation M14 (do not commit):** remove `|| KIND_DOMAIN[kind] === 'expenses'` from the adopt-strategy condition →
E5 test 1 red; revert.

### E7 — Webhook routes Employee Payment Entries (AC-EXP-114, FR-EXP-113)

1. RED — append to `pmo-portal/src/lib/adapterSeam/erpnext/expenseKinds.test.ts` (add the two imports at the top):

```ts
import { decodeErpWebhookEvent } from './webhookEvent';
import { terminalApplyReason } from './feedErrorPolicy';

describe('expense kinds inbound (AC-EXP-114)', () => {
  it('AC-EXP-114 a webhook for an Employee Payment Entry decodes to the expense kind; a Customer one is unchanged', () => {
    expect(decodeErpWebhookEvent({ doctype: 'Payment Entry', name: 'PE-9', payment_type: 'Receive', party_type: 'Employee' })?.kind)
      .toBe('expense-receipt');
    expect(decodeErpWebhookEvent({ doctype: 'Payment Entry', name: 'PE-8', payment_type: 'Receive', party_type: 'Customer' })?.kind)
      .toBe('incoming-payment');
  });
  it('AC-EXP-114 the never-adopt code is terminal (acked, not retried)', () => {
    expect(terminalApplyReason({ code: 'native-expense-posting-not-adopted' })).toBe('native-expense-posting-not-adopted');
  });
});
```

Verify RED: the first case returns `incoming-payment` for the Employee entry.

2. GREEN — `pmo-portal/src/lib/adapterSeam/erpnext/webhookEvent.ts`, in `decodeErpWebhookEvent` replace

```ts
  const paymentType = doctype === 'Payment Entry' ? str(fieldOf(payload, 'payment_type')) : undefined;
  const kind = doctype === 'Payment Entry'
    ? kindFromDoctypeAndPaymentType(doctype, paymentType ?? undefined)
    : kindFromDoctype(doctype);
```
with
```ts
  const paymentType = doctype === 'Payment Entry' ? str(fieldOf(payload, 'payment_type')) : undefined;
  // #775 phase B: an Employee party routes to the expense kinds (FR-EXP-113), never to procurement/revenue.
  const partyType = doctype === 'Payment Entry' ? str(fieldOf(payload, 'party_type')) : undefined;
  const kind = doctype === 'Payment Entry'
    ? kindFromDoctypeAndPaymentType(doctype, paymentType ?? undefined, partyType ?? undefined)
    : kindFromDoctype(doctype);
```

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expenseKinds.test.ts src/lib/adapterSeam/erpnext/webhookEvent.test.ts` (from `pmo-portal/`) → green.

### E8 — RED: sweep poll discriminators (AC-EXP-122)

Create `supabase/functions/erpnext-sweep/expensePollDiscriminators.test.ts`:

```ts
// AC-EXP-122 [Deno] — the sweep's per-kind poll filters (FR-EXP-113). Payment Entry carries Supplier, Customer AND
// Employee parties; Journal Entry is shared with every native ledger entry.
// Verify: cd supabase/functions/erpnext-sweep && deno test expensePollDiscriminators.test.ts --config deno.json --allow-env --allow-net --allow-read
import { assertEquals } from '@std/assert';

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { pollFiltersForKind, sweepFieldsForKind } = await import('./index.ts');

const CO = 'PMO Smoke Co';
const KEY = 'expj:0b7a8c2e-1111-4222-8333-444455556666:1791367200123';

Deno.test('AC-EXP-122 procurement and revenue Payment Entry polls exclude Employee entries', () => {
  const pay = pollFiltersForKind('payment', CO)!;
  assertEquals(pay.extraFilters, [['payment_type', '=', 'Pay'], ['party_type', '!=', 'Employee'], ['company', '=', CO]]);
  assertEquals(pay.admits({ payment_type: 'Pay', party_type: 'Employee', company: CO }), false);
  assertEquals(pay.admits({ payment_type: 'Pay', party_type: 'Supplier', company: CO }), true);
  const rec = pollFiltersForKind('incoming-payment', CO)!;
  assertEquals(rec.extraFilters, [['payment_type', '=', 'Receive'], ['party_type', '!=', 'Employee'], ['company', '=', CO]]);
  assertEquals(rec.admits({ payment_type: 'Receive', party_type: 'Employee', company: CO }), false);
});

Deno.test('AC-EXP-122 expense Payment Entry polls admit only Employee entries in their direction', () => {
  const p = pollFiltersForKind('expense-payment', CO)!;
  assertEquals(p.extraFilters, [['payment_type', '=', 'Pay'], ['party_type', '=', 'Employee'], ['company', '=', CO]]);
  assertEquals(p.admits({ payment_type: 'Pay', party_type: 'Employee', company: CO }), true);
  assertEquals(p.admits({ payment_type: 'Receive', party_type: 'Employee', company: CO }), false);
  assertEquals(pollFiltersForKind('expense-receipt', CO)!.extraFilters[0], ['payment_type', '=', 'Receive']);
});

Deno.test('AC-EXP-122 the Journal Entry poll admits only PMO expense keys of this company', () => {
  const j = pollFiltersForKind('expense-journal', CO)!;
  assertEquals(j.extraFilters, [['user_remark', 'like', 'exp%'], ['company', '=', CO]]);
  assertEquals(j.admits({ user_remark: KEY, company: CO }), true);
  assertEquals(j.admits({ user_remark: 'expense reclass', company: CO }), false);
  assertEquals(j.admits({ user_remark: KEY, company: 'Other Co' }), false);
  assertEquals(pollFiltersForKind('expense-journal', null), null);
});

Deno.test('AC-EXP-122 each poll requests the fields its filters read', () => {
  assertEquals(sweepFieldsForKind('payment').includes('party_type'), true);
  assertEquals(sweepFieldsForKind('expense-payment').includes('party_type'), true);
  const je = sweepFieldsForKind('expense-journal');
  assertEquals(['user_remark', 'company', 'docstatus', 'modified'].every((f) => je.includes(f)), true);
});
```

Verify RED: `pollFiltersForKind` is not exported.

### E9 — GREEN: sweep poll wiring (FR-EXP-113)

`supabase/functions/erpnext-sweep/index.ts`:

1. Imports — add `pollDiscriminatorForKind` to the existing import from `…/erpnext/feedKinds.ts` (or add
   `import { pollDiscriminatorForKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';`), and
   `import type { ErpFilter } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';` if not imported.
2. `PAYMENT_TYPE_BY_KIND` — add
   ```ts
  // #775 phase B — the Employee Payment Entry kinds poll their own direction.
  'expense-payment': 'Pay',
  'expense-receipt': 'Receive',
   ```
3. `sweepFieldsForKind` — after `if (PAYMENT_TYPE_BY_KIND[kind]) fields.add('payment_type');` add
   `for (const field of pollDiscriminatorForKind(kind)?.fields ?? []) fields.add(field);`
4. Add, below `PAYMENT_TYPE_BY_KIND`:

```ts
/**
 * The ONE definition of a kind's poll scope: payment direction (BLOCK A1) + party/key discriminator (#775 phase B,
 * FR-EXP-113) + company (WIRE 3). `extraFilters` is the server-side optimization; `admits` is the per-row authority.
 * `null` = UNSCOPEABLE (a company-scoped kind on a binding with no company) — the caller skips the kind.
 * Exported for direct unit testing (AC-EXP-122).
 */
export function pollFiltersForKind(
  kind: ErpDocKind,
  bindingCompany: string | null,
): { extraFilters: ErpFilter[]; admits: (row: Record<string, unknown>) => boolean } | null {
  const companyFilters = companyDocFilters(kind, bindingCompany);
  if (companyFilters === null) return null;
  const paymentType = PAYMENT_TYPE_BY_KIND[kind];
  const discriminator = pollDiscriminatorForKind(kind);
  return {
    extraFilters: [
      ...(paymentType ? ([['payment_type', '=', paymentType]] as ErpFilter[]) : []),
      ...((discriminator?.filters ?? []) as ErpFilter[]),
      ...(companyFilters as ErpFilter[]),
    ],
    admits: (row) =>
      (paymentType ? row.payment_type === paymentType : true)
      && (discriminator ? discriminator.admits(row) : true)
      && admitsDocForBindingCompany(kind, row, bindingCompany),
  };
}
```

5. In `sweepOrgDoctypesLive`: replace
   `const companyFilters = companyDocFilters(kind, org.company || null);` / `if (companyFilters === null) {` with
   `const poll = pollFiltersForKind(kind, org.company || null);` / `if (poll === null) {` (keep the console.error and
   `continue` inside unchanged); delete the line `const paymentType = PAYMENT_TYPE_BY_KIND[kind];`; replace the
   `extraFilters: [ …paymentType…, ...companyFilters, ],` property with `extraFilters: poll.extraFilters,`; and replace
   the `inFlightAnchorFilter(` third argument (the `(row) => (paymentType ? … ) && admitsDocForBindingCompany(…)` arrow)
   with `poll.admits`. Nothing else in the loop changes.

Verify GREEN: `cd supabase/functions/erpnext-sweep && deno test expensePollDiscriminators.test.ts paymentTypeByKind.test.ts --config deno.json --allow-env --allow-net --allow-read && deno check index.ts`
→ green, clean. **Mutation M13 (do not commit):** in `feedKinds.ts` make the `payment`/`incoming-payment` branch return
`null` → AC-EXP-122 test 1 red; revert.

### E10 — RED: the sweep pass (AC-EXP-121)

Create `supabase/functions/erpnext-sweep/expensePostingBackstop.test.ts`:

```ts
// AC-EXP-121 [Deno] — the ONLY originator of expense postings (ADR-0081): replay before re-deciding, gate, resolve,
// drive; per-row containment. Pure module, fake deps.
import { assertEquals } from '@std/assert';
import { reconcileOrgExpensePostings, type ExpenseBackstopDeps, type ExpenseIntentRow } from './expensePostingBackstop.ts';

const row = (id: string): ExpenseIntentRow => ({ id, posting: 'approval', posting_identity: `c-${id}:approval`, claim_id: `c-${id}`,
  return_id: null, state_stamp: '2026-10-07T10:00:00+00:00', push_state: 'pending', push_error: null });

function deps(rows: ExpenseIntentRow[], over: Partial<ExpenseBackstopDeps> = {}) {
  const log: string[] = [];
  const base: ExpenseBackstopDeps = {
    listPending: async () => rows,
    findOutbox: async () => null,
    replay: async (r) => { log.push(`replay:${r.id}`); },
    assertGate: async (r) => ({ ok: true, truth: { mirror_id: r.id } as never }),
    resolve: async () => ({ outcome: 'ready', refs: {} as never }),
    recordOutcome: async (r, o) => { log.push(`record:${r.id}:${o.state}:${o.reason ?? ''}:${o.erpName ?? ''}`); },
    driveFresh: async (r) => { log.push(`drive:${r.id}`); },
  };
  return { deps: { ...base, ...over }, log };
}

Deno.test('AC-EXP-121 a gate refusal is recorded failed and nothing is driven', async () => {
  const d = deps([row('1')], { assertGate: async () => ({ ok: false, reason: 'expense-posting-actor-inactive' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['record:1:failed:expense-posting-actor-inactive:']);
  assertEquals([r.refused, r.driven], [1, 0]);
});

Deno.test('AC-EXP-121 a resolver refusal is recorded failed with its code', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'refuse', code: 'employee-unlinked', message: 'no link' }) });
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['record:1:failed:employee-unlinked: no link:']);
});

Deno.test('AC-EXP-121 a wait leaves the intent untouched', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([d.log, r.waiting], [[], 1]);
});

Deno.test('AC-EXP-121 already-done is recorded pushed with the ERP name', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'already-done', erpName: 'ACC-JV-2026-00002' }) });
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['record:1:pushed::ACC-JV-2026-00002']);
});

Deno.test('AC-EXP-121 a ready intent is driven once', async () => {
  const d = deps([row('1')]);
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([d.log, r.driven], [['drive:1'], 1]);
});

Deno.test('AC-EXP-121 an intent with an outbox row is replayed from its frozen payload, never re-decided', async () => {
  const d = deps([row('1')], {
    findOutbox: async () => ({ id: 'ob-1', state: 'failed' }),
    assertGate: async () => { throw new Error('gate must not run for a replay'); },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([d.log, r.replayed], [['replay:1'], 1]);
});

Deno.test('AC-EXP-121 a row that throws is recorded and the queue drains', async () => {
  const d = deps([row('1'), row('2')], {
    assertGate: async (r) => { if (r.id === '1') throw new Error('db down'); return { ok: true, truth: {} as never }; },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(r.errors, [{ intentId: '1', error: 'db down' }]);
  assertEquals(d.log, ['drive:2']);
});
```

Verify RED: cannot resolve `./expensePostingBackstop.ts`.

### E11 — GREEN: `supabase/functions/erpnext-sweep/expensePostingBackstop.ts` (FR-EXP-103/104/106/110)

```ts
/**
 * erpnext-sweep/expensePostingBackstop.ts (#775 phase B, ADR-0081) — the ONLY originator of expense postings.
 * Pure orchestration over injected deps (Deno- and Vitest-importable; no Deno/supabase-js symbol here), wired
 * live by index.ts (`expensePostingBackstopDepsLive`), the timesheetBackstop.ts shape.
 *
 * Per intent, oldest first:
 *  1. an outbox row already exists for its key → REPLAY it from the frozen payload (the outbox owns recovery;
 *     re-deciding could change a body whose digest is already bound — idempotency-key-payload-mismatch);
 *  2. else re-assert the DB gate (status, stamp, recorded actor's CURRENT standing) — refusal = failed;
 *  3. resolve references — refuse = failed; wait = untouched; already-done = pushed;
 *  4. drive a fresh command through dispatchMoneyWrite.
 * NEW-3 per-row containment: a throw is recorded and the rest of the queue still drains.
 * What is never re-driven (pushed, held, ERP-cancelled) is excluded by the live listPending QUERY.
 */
import type { ExpenseGateTruth, ExpenseResolvedRefs } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts';
import type { ExpenseResolution } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts';

/** NFR-EXP-013 — bounded per org per tick (index-served), equal to the timesheet/budget twins. */
export const EXPENSE_BACKSTOP_TICK_LIMIT = 200;

export interface ExpenseIntentRow {
  id: string;
  posting: string;
  posting_identity: string;
  claim_id: string;
  return_id: string | null;
  state_stamp: string;
  push_state: string;
  push_error: string | null;
}

export interface ExpenseOutboxRef {
  id: string;
  state: string;
}

export type ExpenseGateOutcome = { ok: true; truth: ExpenseGateTruth } | { ok: false; reason: string };

export interface ExpenseOutcome {
  state: 'failed' | 'held' | 'pushed';
  reason: string | null;
  erpName?: string | null;
}

export interface ExpenseBackstopDeps {
  listPending(orgId: string, limit: number): Promise<ExpenseIntentRow[]>;
  findOutbox(row: ExpenseIntentRow): Promise<ExpenseOutboxRef | null>;
  replay(row: ExpenseIntentRow, outbox: ExpenseOutboxRef): Promise<void>;
  assertGate(row: ExpenseIntentRow): Promise<ExpenseGateOutcome>;
  resolve(truth: ExpenseGateTruth): Promise<ExpenseResolution>;
  recordOutcome(row: ExpenseIntentRow, outcome: ExpenseOutcome): Promise<void>;
  driveFresh(row: ExpenseIntentRow, truth: ExpenseGateTruth, refs: ExpenseResolvedRefs): Promise<void>;
}

export interface ReconcileOrgExpensePostingsResult {
  driven: number;
  replayed: number;
  waiting: number;
  refused: number;
  errors: Array<{ intentId: string; error: string }>;
}

export async function reconcileOrgExpensePostings(
  deps: ExpenseBackstopDeps,
  org: { orgId: string },
): Promise<ReconcileOrgExpensePostingsResult> {
  const result: ReconcileOrgExpensePostingsResult = { driven: 0, replayed: 0, waiting: 0, refused: 0, errors: [] };
  for (const row of await deps.listPending(org.orgId, EXPENSE_BACKSTOP_TICK_LIMIT)) {
    try {
      const outbox = await deps.findOutbox(row);
      if (outbox) {
        await deps.replay(row, outbox);
        result.replayed += 1;
        continue;
      }
      const gate = await deps.assertGate(row);
      if (!gate.ok) {
        await deps.recordOutcome(row, { state: 'failed', reason: gate.reason });
        result.refused += 1;
        continue;
      }
      const resolution = await deps.resolve(gate.truth);
      if (resolution.outcome === 'wait') {
        result.waiting += 1;
        continue;
      }
      if (resolution.outcome === 'refuse') {
        await deps.recordOutcome(row, { state: 'failed', reason: `${resolution.code}: ${resolution.message}` });
        result.refused += 1;
        continue;
      }
      if (resolution.outcome === 'already-done') {
        await deps.recordOutcome(row, { state: 'pushed', reason: null, erpName: resolution.erpName });
        continue;
      }
      await deps.driveFresh(row, gate.truth, resolution.refs);
      result.driven += 1;
    } catch (err) {
      result.errors.push({ intentId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
```

Verify GREEN: `cd supabase/functions/erpnext-sweep && deno test expensePostingBackstop.test.ts --config deno.json --allow-env --allow-net --allow-read` → 7 passed.

### E12 — Refactors with no behaviour change (shared helpers)

1. `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` — add, above `resolveTimesheetRefs`:

```ts
/** The PMO user's CONFIRMED ERP Employee (FR-TSP-051; reused by #775 phase B, FR-EXP-106). `proposed` is never
 *  authoritative; the org filter is in the query; the ERP name comes from `external_refs`, never a mirror column. */
export type ConfirmedEmployeeLookup =
  | { status: 'no-link' }
  | { status: 'no-ref'; employeeId: string }
  | { status: 'ok'; employee: string };

export async function lookupConfirmedErpEmployee(
  serviceClient: DispatchServiceClient,
  orgId: string,
  profileId: string,
): Promise<ConfirmedEmployeeLookup> {
  const { data, error } = await serviceClient
    .from('erp_employees')
    .select('id, employee_number, org_id')
    .eq('org_id', orgId)
    .eq('profile_id', profileId)
    .eq('link_state', 'confirmed')
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const employeeId = (data as { id?: string } | null)?.id;
  if (!employeeId) return { status: 'no-link' };
  const external = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'timesheets', employeeId);
  if (!external) return { status: 'no-ref', employeeId };
  return { status: 'ok', employee: external.startsWith('Employee:') ? external.slice('Employee:'.length) : external };
}
```

   In `resolveTimesheetRefs`, replace the block from `const { data: employeeRow, error: employeeError } = await deps.serviceClient`
   through `: employeeExternalId;` (the `refs.employee = …` assignment) with:

```ts
  const lookup = await lookupConfirmedErpEmployee(deps.serviceClient, deps.orgId, record.user_id ?? '');
  if (lookup.status === 'no-link') {
    throw new AppError(
      `no confirmed erp_employees link for user '${record.user_id ?? ''}' — an Admin must confirm it`,
      'employee-unlinked',
    );
  }
  if (lookup.status === 'no-ref') {
    throw new AppError(`employee '${lookup.employeeId}' has no external_refs mapping`, 'employee-unlinked');
  }
  refs.employee = lookup.employee;
```

   Verify: `../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory` (from `pmo-portal/`) → green (same messages, same codes).

2. `supabase/functions/erpnext-sweep/index.ts` — split `buildReconcileDepsLive`:
   - Add a new exported function directly below it:
     ```ts
/**
 * The money-write deps for ONE command, given its actor and outbox identity — the body `buildReconcileDepsLive`
 * always had, extracted so the expense pass (#775 phase B) can drive a FRESH command through the identical
 * outbox/probe/fence/re-authorization machinery. `persistPayload` is set only for a fresh command: it makes the
 * outbox INSERT carry the payload and the recorded actor (a recovery row already has both).
 */
export async function buildMoneyWriteDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  args: { command: AdapterCommand; actorUserId: string | null; outboxRecordId: string; persistPayload: boolean },
  cache?: ErpAuthPairCache,
): Promise<DispatchMoneyWriteDeps> {
     ```
     Its body is `buildReconcileDepsLive`'s body from the line `const kind = payload.erp_doc_kind;` through its final
     `return { adapter, command, … };`, MOVED verbatim, with these substitutions only: first line
     `const payload = args.command.record as Record<string, unknown>;` and `const command = args.command;`;
     `rowExtra.operation` → `args.command.operation as 'create' | 'update' | 'transition'`;
     `rowExtra.actor_user_id` → `args.actorUserId`; `row.pmoRecordId` → `args.outboxRecordId`; `row.id` (in the
     reissue refusal message) → `args.outboxRecordId`; the `const command: AdapterCommand = {…}` block is deleted
     (it moves to the caller); and `createDbMoneyOutboxDeps({` gains, as its last property,
     `...(args.persistPayload ? { payload, actorUserId: args.actorUserId ?? undefined } : {}),`.
   - `buildReconcileDepsLive` keeps everything up to and including `await assertBudgetSweepGate(serviceClient, org, payload, cache);`
     and then ends with:
     ```ts
  const command: AdapterCommand = {
    domain: row.domain as AdapterCommand['domain'],
    operation: rowExtra.operation,
    record: payload as AdapterCommand['record'],
    idempotencyKey: row.idempotencyKey,
  };
  return buildMoneyWriteDepsLive(serviceClient, org,
    { command, actorUserId: rowExtra.actor_user_id, outboxRecordId: row.pmoRecordId, persistPayload: false }, cache);
}
     ```
   - Generalize the outbox finder: rename `findTimesheetOutboxRow`'s body into
     `async function findOutboxRowByKey(serviceClient: SupabaseClient, orgId: string, domain: string, pmoRecordId: string, idempotencyKey: string): Promise<OutboxRow | null>`
     (its `.eq('domain', ERPNEXT_TIMESHEETS_DOMAIN)` becomes `.eq('domain', domain)`), and make
     `findTimesheetOutboxRow(serviceClient, orgId, timesheetId, key)` a one-line call
     `return findOutboxRowByKey(serviceClient, orgId, ERPNEXT_TIMESHEETS_DOMAIN, timesheetId, key);`.

   Verify (no behaviour change):
   `cd supabase/functions/erpnext-sweep && deno check index.ts && deno test . --config deno.json --allow-env --allow-net --allow-read`
   → the same pass count as before this task (run it once BEFORE the edit and note the number).

### E13 — Wire pass (7) in the sweep (FR-EXP-103..111, FR-EXP-115)

`supabase/functions/erpnext-sweep/index.ts`:

1. Imports (add to existing import lines where the module is already imported):

```ts
import { ERPNEXT_EXPENSES_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { buildExpensePostingCommand, type ExpenseGateTruth } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts';
import { resolveExpensePosting, type ExpenseResolveDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts';
import { expenseOutboxIdentity, expensePostingKey, type ExpensePosting } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingKey.ts';
import type { ErpAccountFacts } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.ts';
import { lookupConfirmedErpEmployee } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { getDoc, ErpError, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { reconcileOrgExpensePostings, type ExpenseBackstopDeps, type ExpenseIntentRow, type ExpenseOutcome } from './expensePostingBackstop.ts';
```

2. `reconcileOrgOutbox` — directly after `if (candidate.domain === ERPNEXT_TIMESHEETS_DOMAIN) continue;` add:

```ts
    // #775 phase B (ADR-0081): `expenses` is owned by pass (7) ALONE — it replays its own outbox rows (the same
    // dispatchMoneyWrite) after checking the intent, so driving them here too would burn 0131's attempt budget 2×.
    if (candidate.domain === ERPNEXT_EXPENSES_DOMAIN) continue;
```

3. `buildOutboxProbe`'s `probeErpByPaymentComposite(probeDeps, idempotencyKey, {` object — add as its last property:
   `journalNames: Array.isArray(payload.je_names) ? (payload.je_names as string[]) : undefined,`

4. Add below `reconcileOrgTimesheetPushesLive`:

```ts
// ────────────────────────────────────────────────────────────────────────────────────────────────
// (7) #775 phase B — the expense posting pass, the ONLY originator of expense postings (ADR-0081).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The composite probe's claim-window floor, ERP `creation` format (`YYYY-MM-DD HH:MM:SS`), 1 minute back. */
function expenseProbeWindowStart(nowMs: number = Date.now()): string {
  return new Date(nowMs - 60_000).toISOString().replace('T', ' ').slice(0, 19);
}

/** The live reads `resolveExpensePosting` needs (FR-EXP-106). ERP reads use the probe budget (one attempt, tight
 *  deadline) — this runs before the outbox claim, so a slow ERP fails the attempt instead of hanging the tick. */
function expenseResolveDepsLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): ExpenseResolveDeps {
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
  let erpClient: ErpClientDeps | null = null;
  const client = async (): Promise<ErpClientDeps> => {
    if (!erpClient) {
      const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
      erpClient = withProbeBudget({ fetchImpl: fetch, apiKey, apiSecret, baseUrl: org.siteUrl });
    }
    return erpClient;
  };
  const getOrNull = async (doctype: string, name: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await getDoc(await client(), doctype, name)) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof ErpError && err.status === 404) return null;
      throw err;
    }
  };
  return {
    readBinding: async () => ({
      company: text(org.company),
      cashAccount: text(org.config.default_cash_account) ?? text(org.config.default_bank_account),
      costCenter: text(org.config.cost_center),
      projectMap: (org.config.project_map as Record<string, string> | undefined) ?? {},
      defaultPayableAccount: text(org.config.default_payable_account),
    }),
    readConfirmedEmployee: async (profileId) => {
      const lookup = await lookupConfirmedErpEmployee(serviceClient as never, org.orgId, profileId);
      return lookup.status === 'ok' ? lookup.employee : null;
    },
    readAccountMap: async () => {
      const { data, error } = await serviceClient.from('expense_account_map').select('account_key, erp_account').eq('org_id', org.orgId);
      if (error) throw new AppError(error.message, error.code);
      return Object.fromEntries(((data as Array<{ account_key: string; erp_account: string }> | null) ?? [])
        .map((r) => [r.account_key, r.erp_account]));
    },
    readApprovalPosting: async (claimId) => {
      const { data, error } = await serviceClient.from('expense_posting_erp_mirror')
        .select('push_state, erp_name, erp_cancelled_at')
        .eq('org_id', org.orgId).eq('posting_identity', `${claimId}:approval`).maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      return (data as { push_state: string; erp_name: string | null; erp_cancelled_at: string | null } | null) ?? null;
    },
    readErpAccounts: async (names) => {
      const facts: ErpAccountFacts[] = [];
      for (const name of names) {
        const doc = await getOrNull('Account', name);
        if (doc) facts.push({ ...doc, name } as ErpAccountFacts);
      }
      return facts;
    },
    readErpCompanyCurrency: async (company) => text((await getOrNull('Company', company))?.default_currency),
    readErpJournalDocstatus: async (name) => {
      const doc = await getOrNull(DOCTYPE_REGISTRY['expense-journal'].doctype, name);
      return typeof doc?.docstatus === 'number' ? doc.docstatus : null;
    },
  };
}

/** The live deps of pass (7). `eligibleOutboxIds` is 0131's eligibility set, read once per pass. */
export function expensePostingBackstopDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  eligibleOutboxIds: ReadonlySet<string>,
  cache?: ErpAuthPairCache,
): ExpenseBackstopDeps {
  // Compare-and-set: only a pending/failed, not-cancelled intent moves (a concurrent landing stays `pushed`).
  // The notice is deduplicated by surfaceActionRequired against an unread one for the same posting and reason.
  const recordOutcome = async (row: ExpenseIntentRow, outcome: ExpenseOutcome): Promise<void> => {
    const patch: Record<string, unknown> = { push_state: outcome.state, push_error: outcome.reason };
    if (outcome.state === 'pushed') {
      patch.erp_name = outcome.erpName ?? null;
      patch.pushed_at = new Date().toISOString();
    }
    const { error } = await serviceClient.from('expense_posting_erp_mirror').update(patch)
      .eq('org_id', org.orgId).eq('id', row.id).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null);
    if (error) throw new AppError(error.message, error.code);
    if (outcome.state !== 'pushed') {
      await surfaceActionRequired(serviceClient, org.orgId, outcome.state === 'held' ? 'expense-posting-held' : 'expense-posting-failed',
        { postingIdentity: row.posting_identity, reason: outcome.reason });
    }
  };
  const classify = (err: unknown): ExpenseOutcome => {
    const code = (err as { code?: unknown } | null)?.code;
    return {
      state: code === 'command-held' ? 'held' : 'failed',
      reason: typeof code === 'string' ? code : err instanceof Error ? err.message : String(err),
    };
  };
  return {
    listPending: async (orgId, limit) => {
      const { data, error } = await serviceClient.from('expense_posting_erp_mirror')
        .select('id, posting, posting_identity, claim_id, return_id, state_stamp, push_state, push_error')
        .eq('org_id', orgId).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null)
        .order('created_at', { ascending: true }).limit(limit);
      if (error) throw new AppError(error.message, error.code);
      return (data as ExpenseIntentRow[] | null) ?? [];
    },
    findOutbox: (row) => {
      const posting = row.posting as ExpensePosting;
      const subject = row.return_id ?? row.claim_id;
      return findOutboxRowByKey(serviceClient, org.orgId, ERPNEXT_EXPENSES_DOMAIN,
        expenseOutboxIdentity(posting, subject), expensePostingKey(posting, subject, row.state_stamp));
    },
    replay: async (row, ref) => {
      const outbox = ref as OutboxRow;
      if (!eligibleOutboxIds.has(outbox.id)) {
        if (outbox.state === 'committing' || outbox.state === 'quarantined') return; // not due yet (0131)
        await recordOutcome(row, {
          state: 'held',
          reason: outbox.state === 'confirmed' ? 'expense-posting-mirror-diverged' : 'expense-posting-attempts-exhausted',
        });
        return;
      }
      try {
        await dispatchMoneyWrite(await buildReconcileDepsLive(serviceClient, org, outbox, cache));
      } catch (err) {
        await recordOutcome(row, classify(err));
      }
    },
    assertGate: async (row) => {
      const { data, error } = await serviceClient.rpc('expense_posting_for_push', { p_org_id: org.orgId, p_mirror_id: row.id });
      if (error) {
        if (error.code === 'P0001' || error.code === 'P0002' || error.code === '42501') return { ok: false, reason: error.message };
        throw new AppError(error.message, error.code);
      }
      return { ok: true, truth: data as ExpenseGateTruth };
    },
    resolve: (truth) => resolveExpensePosting(truth, expenseResolveDepsLive(serviceClient, org, cache)),
    recordOutcome,
    driveFresh: async (row, truth, refs) => {
      const built = buildExpensePostingCommand(truth, refs, expenseProbeWindowStart());
      const auth = await checkErpnextCommandAuthorization(serviceClient as never, org.orgId, truth.actor_id, {
        domain: ERPNEXT_EXPENSES_DOMAIN, operation: built.operation,
        record: { id: built.outboxIdentity, erp_doc_kind: built.record.erp_doc_kind },
      });
      if (!auth.ok) {
        await recordOutcome(row, { state: 'failed', reason: auth.message });
        return;
      }
      const command: AdapterCommand = {
        domain: ERPNEXT_EXPENSES_DOMAIN, operation: built.operation,
        record: built.record as AdapterCommand['record'], idempotencyKey: built.idempotencyKey,
      };
      try {
        await dispatchMoneyWrite(await buildMoneyWriteDepsLive(serviceClient, org,
          { command, actorUserId: truth.actor_id, outboxRecordId: built.outboxIdentity, persistPayload: true }, cache));
      } catch (err) {
        await recordOutcome(row, classify(err));
      }
    },
  };
}

/** Pass (7), domain-gated (an org that has not employed `expenses` has nothing to post). */
async function reconcileOrgExpensePostingsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<{ driven: number; error?: string }> {
  if (!org.ownedDomains.includes(ERPNEXT_EXPENSES_DOMAIN)) return { driven: 0 };
  try {
    const eligibleOutboxIds = new Set(
      (await listCandidatesLive(serviceClient)(org.orgId)).filter((c) => c.domain === ERPNEXT_EXPENSES_DOMAIN).map((c) => c.id),
    );
    const result = await reconcileOrgExpensePostings(
      expensePostingBackstopDepsLive(serviceClient, org, eligibleOutboxIds, cache),
      { orgId: org.orgId },
    );
    for (const e of result.errors) {
      console.warn(`[erpnext-sweep] org ${org.orgId} expense intent ${e.intentId}: ${e.error}`);
    }
    return {
      driven: result.driven + result.replayed,
      error: result.errors.length ? `${result.errors.length} expense intent(s) failed` : undefined,
    };
  } catch (err) {
    return { driven: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
```

5. `ErpSweepCycleDeps` — after `reconcileOrgTimesheetPushes?: …;` add:

```ts
  /** #775 phase B (ADR-0081) — pass (7), the only originator of expense postings. Optional so the existing cycle
   *  tests stay byte-for-byte; the live wiring always supplies it. */
  reconcileOrgExpensePostings?: (org: OrgBinding) => Promise<{ driven: number; error?: string }>;
```

   `runErpSweepCycle` — after the `(6)` block add:

```ts
    // (7) #775 phase B — expense postings, LAST: an approval posted by this pass reaches the GL mirror on the next
    // tick's (3). Same try/catch shape as its siblings.
    if (deps.reconcileOrgExpensePostings) {
      try {
        const r = await deps.reconcileOrgExpensePostings(org);
        if (r.error) errors.push(`expenses:${r.error}`);
      } catch (err) {
        errors.push(`expenses:${err instanceof Error ? err.message : String(err)}`);
      }
    }
```

   The live `runErpSweepCycle({…})` call — after `reconcileOrgTimesheetPushes: (org) => …,` add
   `reconcileOrgExpensePostings: (org) => reconcileOrgExpensePostingsLive(serviceClient, org, erpAuth),`.

Verify: `cd supabase/functions/erpnext-sweep && deno check index.ts && deno test . --config deno.json --allow-env --allow-net --allow-read`
→ clean and green; `bash scripts/deno-boot-smoke-edge-fns.sh` (repo root) → passes.

### E14 — RED: Admin account map actions (AC-EXP-120)

Append to `supabase/functions/external-set-company/setup.test.ts` (add `restCall` to its existing
`../_shared/testing/edgeTestKit.ts` import list):

```ts
const ACCOUNT = (name: string, over: Record<string, unknown> = {}) => jsonResponse({ data: {
  name, company: "Example Company", root_type: "Liability", account_type: "Payable", is_group: 0, disabled: 0, account_currency: "IDR", ...over,
} });
const companyRoute = erp("erp.example.test", "/api/resource/Company/Example%20Company",
  () => jsonResponse({ data: { name: "Example Company", default_currency: "IDR" } }));
const mapWrite = (method: string) => ({ label: `expense_account_map ${method}`, method, pathname: "/rest/v1/expense_account_map",
  response: () => jsonResponse(null, { status: method === "POST" ? 201 : 204 }) });

Deno.test("AC-EXP-120 an Admin cannot map the supplier payable account (Creditors) as employee payable", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute,
    erp("erp.example.test", "/api/resource/Account/Creditors%20-%20EX", () => ACCOUNT("Creditors - EX")),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account",
      accountKey: "employee_payable", erpAccount: "Creditors - EX" }));
    return { status: res.status, text: await res.text(), calls };
  });
  assertEquals(result.status, 422);
  assertEquals(result.text.includes("supplier payable"), true);
  assertEquals(restCall(result.calls, "expense_account_map").length, 0);
});

Deno.test("AC-EXP-120 an Admin cannot map an untyped advance account", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute,
    erp("erp.example.test", "/api/resource/Account/Advances%20-%20EX", () => ACCOUNT("Advances - EX", { root_type: "Asset", account_type: "" })),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account",
      accountKey: "employee_advance", erpAccount: "Advances - EX" }));
    return { status: res.status, calls };
  });
  assertEquals(result.status, 422);
  assertEquals(restCall(result.calls, "expense_account_map").length, 0);
});

Deno.test("AC-EXP-120 a valid account is upserted with the actor and audited", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute, mapWrite("POST"),
    erp("erp.example.test", "/api/resource/Account/Employee%20Payable%20-%20EX", () => ACCOUNT("Employee Payable - EX")),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account",
      accountKey: "employee_payable", erpAccount: " Employee Payable - EX " }));
    return { status: res.status, calls };
  });
  assertEquals(result.status, 200);
  const write = restCall(result.calls, "expense_account_map", "POST")[0];
  assertEquals((write.bodyJson as Record<string, unknown>).account_key, "employee_payable");
  assertEquals((write.bodyJson as Record<string, unknown>).erp_account, "Employee Payable - EX");
  assertEquals((write.bodyJson as Record<string, unknown>).updated_by, "admin-1");
  assertEquals(rpcCall(result.calls, "log_audit").length, 1);
});

Deno.test("AC-EXP-120 clear-expense-account deletes the key", async () => {
  const result = await withFetchMock([...base(), mapWrite("DELETE")], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "clear-expense-account", accountKey: "Meals" }));
    return { status: res.status, calls };
  });
  assertEquals(result.status, 200);
  const del = restCall(result.calls, "expense_account_map", "DELETE")[0];
  assertEquals(del.url.searchParams.get("account_key"), "eq.Meals");
  assertEquals(del.url.searchParams.get("org_id"), "eq.org-1");
});

Deno.test("AC-EXP-120 a Project Manager is refused and an unknown key is a bad request", async () => {
  const pm = await withFetchMock([...base("Project Manager")], async () =>
    (await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account", accountKey: "Meals", erpAccount: "Meals - EX" }))).status);
  assertEquals(pm, 403);
  const bogus = await withFetchMock([...base()], async () =>
    (await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account", accountKey: "Bogus", erpAccount: "X" }))).status);
  assertEquals(bogus, 400);
});
```

Verify RED: `cd supabase/functions/external-set-company && deno test setup.test.ts --config deno.json --allow-env --allow-net --allow-read`
→ the five new tests fail (`Unknown ERP setup action` → 400).

### E15 — GREEN: `save-expense-account` / `clear-expense-account` (FR-EXP-112, DD-EXP-16)

`supabase/functions/external-set-company/setup.ts`:

1. Imports — change the client import to include `ErpError`:
   `import { createDoc, type ErpClientDeps, ErpError, getDoc, listDocsByFilters } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts";`
   and add
   `import { expenseAccountProblem, isExpenseAccountKey, type ErpAccountFacts } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.ts";`
2. `ErpSetupBody` — add `accountKey?: string;` and `erpAccount?: string;`.
3. In `applyErpSetup`, directly before `if (body.setupAction === "readiness") return await readErpSetup(ctx);` add:

```ts
  if (body.setupAction === "save-expense-account") return await saveExpenseAccount(body, ctx);
  if (body.setupAction === "clear-expense-account") return await clearExpenseAccount(body, ctx);
```

4. Append:

```ts
/** #775 phase B (FR-EXP-112, DD-EXP-16) — the ONLY writer of expense_account_map. Reads the account and the company
 *  currency from ERPNext and applies the shared rule; a refusal writes nothing. */
async function saveExpenseAccount(body: ErpSetupBody, ctx: ErpSetupContext) {
  if (!isExpenseAccountKey(body.accountKey)) throw new AppError("Choose an expense account key", "BAD_REQUEST");
  const name = typeof body.erpAccount === "string" ? body.erpAccount.trim() : "";
  if (!name || name.length > 140) throw new AppError("An ERP account is required", "BAD_REQUEST");
  let account: Record<string, unknown> | null = null;
  try {
    account = await getDoc(ctx.client, "Account", name) as Record<string, unknown>;
  } catch (err) {
    if (!(err instanceof ErpError && err.status === 404)) throw err;
  }
  const company = await getDoc(ctx.client, "Company", ctx.company) as Record<string, unknown>;
  const problem = expenseAccountProblem(body.accountKey, account ? ({ ...account, name } as ErpAccountFacts) : null, {
    company: ctx.company,
    companyCurrency: typeof company.default_currency === "string" ? company.default_currency : null,
    defaultPayableAccount: typeof ctx.config.default_payable_account === "string" ? ctx.config.default_payable_account : null,
  });
  if (problem) throw new AppError(problem, "config-rejected");
  const { error } = await ctx.serviceClient.from("expense_account_map").upsert(
    { org_id: ctx.orgId, account_key: body.accountKey, erp_account: name, updated_by: ctx.actorId, updated_at: new Date().toISOString() },
    { onConflict: "org_id,account_key" },
  );
  if (error) throw new AppError(error.message, error.code);
  await auditExpenseAccount(ctx, { key: body.accountKey, account: name });
  return { ok: true };
}

async function clearExpenseAccount(body: ErpSetupBody, ctx: ErpSetupContext) {
  if (!isExpenseAccountKey(body.accountKey)) throw new AppError("Choose an expense account key", "BAD_REQUEST");
  const { error } = await ctx.serviceClient.from("expense_account_map").delete()
    .eq("org_id", ctx.orgId).eq("account_key", body.accountKey);
  if (error) throw new AppError(error.message, error.code);
  await auditExpenseAccount(ctx, { key: body.accountKey, account: null });
  return { ok: true };
}

async function auditExpenseAccount(ctx: ErpSetupContext, detail: Record<string, unknown>) {
  const { error } = await ctx.serviceClient.rpc("log_audit", {
    p_action: "integration.expense_account_map",
    p_org_id: ctx.orgId,
    p_actor_id: ctx.actorId,
    p_entity_id: null,
    p_detail: detail,
  });
  if (error) throw new AppError(error.message, error.code);
}
```

Verify GREEN: the E14 command → all setup tests green (the existing AC-SETUP tests included).
**Mutation M12 (do not commit):** replace `if (problem) throw …` with `if (problem && false) throw …` → the two
refusal tests red; revert.

### E16 — Edge regression

From the repo root: `bash scripts/deno-test-edge-fns.sh` → green; `node scripts/check-edge-fn-test-binding.mjs` →
PASS; `bash scripts/deno-boot-smoke-edge-fns.sh` → PASS. From `pmo-portal/`: `npm run typecheck` → 0.

### E17 — Commit part 4

Record M11–M14 in the PR body. Commit:
`feat(expenses): sweep pass posts expense claims to ERPNext; Admin account map action (#775 phase B)`.

Next: [part 5 — UI](2026-10-07-expense-claims-phase-b.part5-ui.md).
