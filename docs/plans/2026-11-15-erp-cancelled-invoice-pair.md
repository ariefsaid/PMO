# ERP-cancelled invoice pair — implementation plan (#1696)

> **For agentic workers:** money tier. Director-dispatched, ships alone (no batch PR). Follow the Orca dispatch and TDD
> workflow (`docs/orca-dispatch.md`): write the named failing test, watch it fail for the stated reason, implement the
> minimum, rerun green. This is a planning artifact; do not build until the Director signs off.

**Goal:** On the Finance hub's "Invoices on both sides" card, flag every accepted invoice pair whose ERP invoice was
later cancelled in the ERP, say what that does to the figures, name the ERP replacement when one exists, and offer the
existing Undo.

**Architecture:** client-only. No migration, no new RPC, no change to any database function or to the ERP feed. The
server already has every fact the flag needs and already does the right thing when the person acts:

- the feed writes `erp_docstatus = 2`, `erp_cancelled_at` and `status = 'Cancelled'` on the ERP copy
  (`supabase/functions/_shared/erpFeedRevenue.ts` `revenueFieldPatch`, a cancel "always derives"; `erp_cancelled_at` is
  stamped by `0513_odoo_revenue_feed_apply.sql` for Odoo and the ERPNext mirror writer);
- every revenue reader excludes a cancelled ERP copy (`coalesce(si.erp_docstatus,1) <> 2 and si.erp_cancelled_at is null`,
  `0498_invoice_pairs.sql` §5) and every reader excludes a paired PMO copy (`paired_erp_invoice_id is null`, §4/§5);
- `unpair_invoice` (§10) does not look at the ERP copy's state, so Undo already works on a cancelled pair;
- after Undo, `invoice_pair_candidates` (§6) proposes the PMO copy against a live amendment if it matches, and never
  against the cancelled original (`e.erp_docstatus = 1 and e.erp_cancelled_at is null`).

So the change is: `listAcceptedInvoicePairs` (`pmo-portal/src/lib/db/revenue.ts`) reads the ERP copy's lifecycle and any
live amendment, and `InvoicePairReview` (`pmo-portal/src/components/integrations/InvoicePairReview.tsx`) shows the
cancelled pairs in their own section. A pgTAP file pins the server behaviour the screen's words rely on, so a later
change to the readers or to `unpair_invoice` cannot make the screen lie.

**Tech stack:** React 19 + TanStack Query, Supabase JS (PostgREST reads under RLS), Vitest/RTL, pgTAP.

**Spec:** `docs/specs/erp-connect-anytime.spec.md` §4.5 (FR-ECA-040, AC-ECA-030), extended by Task 1 with FR-ECA-043 and
AC-ECA-032..034.

## What breaks today (behaviour only)

Finance accepts a pair: PMO invoice PMO-N1 now counts as ERP invoice SI-E1, and the PMO copy stops counting. Later
someone cancels SI-E1 in the ERP (to correct it, or because the sale fell through). The next feed run marks SI-E1
cancelled, so it stops counting too. **The sale now counts nowhere:** project revenue, the receivable, the contract
draw-down and the management pack all drop the amount. The Finance hub still lists PMO-N1 under "1 invoice already
counts once ... counted as ERP invoice SI-E1", so the Finance person who checks the card is told the sale is counted when
it is not. If the ERP raised a replacement SI-E1-1, that replacement does count, but nothing tells the person that PMO-N1
should now point at it, and the replacement never appears as a proposal because PMO-N1 is still paired.

## What a person sees and does after this change

Who: an Admin or Finance user (the only roles that see the card; `can('pair_invoices','salesInvoice')`). Where:
`/finance`, card "Invoices on both sides".

1. A section **"ERP invoice cancelled"** appears above the "already counts once" list whenever at least one accepted pair
   points at a cancelled ERP invoice. It is not collapsed. Help text: "The ERP invoice these PMO invoices count as was
   cancelled in the ERP, so each sale below counts nowhere: not in revenue and not in receivables. If the sale still
   stands, undo the pair so the PMO invoice counts again. If the sale was cancelled, leave it as it is."
2. Each row reads `PMO-N1 · ERP invoice SI-E1 was cancelled · $11,100.00`, plus `· Replaced in the ERP by SI-E1-1` when a
   live amendment of SI-E1 exists, and an **Undo** button (accessible name "Undo PMO-N1").
3. Undo opens the existing confirmation with a body written for this case: "PMO-N1 goes back into revenue and
   receivables. ERP invoice SI-E1 is cancelled, so the sale counts once, as PMO-N1, until you pair it again." Confirm
   calls the existing `unpair_invoice`.
4. After Undo, the lists reload. If SI-E1-1 is a clear match, PMO-N1 → SI-E1-1 appears in the proposals table and the
   person presses "Count each once" as today. If there is no match, PMO-N1 appears under "Still counted as PMO
   invoices" with "No matching ERP invoice".
5. A cancelled pair no longer appears in, or adds to the count of, the "already counts once" list.

Nothing is written automatically: the screen never unpairs or re-pairs on its own (PD-ECA-10, a person decides).

## Migration

None. The client already reads `si_number`, `erp_docstatus`, `erp_cancelled_at` and `erp_amended_from` on
`sales_invoices` under the caller's RLS (`revenue.ts` row type lines 48-51, 134-137; the `.is('erp_cancelled_at', null)`
read at line 433). Task 2's pgTAP asserts that read path for a Finance caller. If the owner chooses the "acknowledge"
option in Owner questions Q2, that needs a migration `NNNN_invoice_pair_cancel_ack.sql` (number to be reserved at build
time: re-check `git ls-tree -r --name-only origin/dev supabase/migrations`) and a plan revision; it is out of scope here.

## Global constraints

- Money tier: ships alone, Director-dispatched. No production deploy.
- No change to any database function, view, trigger, RLS policy or edge function. If a task finds it needs one, stop and
  return to the Director: the plan then needs Task 12's "every test file that names that function" run, and a revision.
- No `package-lock.json` change. Repo is public: fixtures use example names and `example.test` addresses only.
- DB commands run under `scripts/with-db-lock.sh` from the repo root; no `db reset` (no migration or seed change).

## Tasks

### Task 1 — spec rows (docs, 3 min)

Edit `docs/specs/erp-connect-anytime.spec.md` §4.5. After the FR-ECA-040 bullet add:

```markdown
- **FR-ECA-043** — While an accepted pair's ERP invoice is cancelled in the ERP (docstatus 2 or a cancel time), the
  system SHALL show that pair to Admin and Finance as "ERP invoice cancelled", apart from the pairs that count once,
  SHALL name a live ERP amendment of that invoice when one exists, and SHALL offer the existing undo. The system SHALL
  NOT unpair or re-pair on its own.
```

After the AC-ECA-031 bullet add:

```markdown
- **AC-ECA-032 (FR-043; P)** — Given an accepted pair, when the ERP invoice is cancelled in the ERP, then the pair is
  kept, the sale counts in no revenue figure, Finance can read the cancellation and any amendment, and Finance can undo
  the pair, after which the PMO invoice counts again and is proposed against a matching live amendment.
- **AC-ECA-033 (FR-043; U)** — Given the accepted pairs, when one points at a cancelled ERP invoice, then the review
  screen lists it under "ERP invoice cancelled" with the ERP number, any replacement and an undo, and not under the
  pairs that count once.
- **AC-ECA-034 (FR-043; U)** — Given the paired PMO copies, when the accepted pairs are read, then each carries whether
  its ERP invoice is cancelled and the number of a live amendment, read under the caller's RLS.
```

Verify: `grep -c "AC-ECA-03[234]" docs/specs/erp-connect-anytime.spec.md` prints `3`.

### Task 2 — pgTAP: pin the server behaviour (AC-ECA-032), 5 min

Create `supabase/tests/invoice_pairs_erp_cancelled.test.sql`. This is a characterisation test of shipped behaviour: it
should pass on first run. Then prove it binds (step 2.3).

```sql
-- invoice_pairs_erp_cancelled.test.sql — #1696 (AC-ECA-032): an accepted pair whose ERP invoice is later cancelled in the
-- ERP. Pins what the review screen tells the person: the pair is kept, the sale counts nowhere, Finance can read the
-- cancellation and the amendment, undo works, and the PMO invoice is then proposed against the live amendment.
-- Functions exercised (unchanged): accept_invoice_pairs, unpair_invoice, propose_invoice_pairs, get_project_finances.
begin;
select plan(10);

-- ── fixture (a server load: no JWT) ──────────────────────────────────────────────────────────────
insert into public.organizations (id, name) values ('16960000-0000-0000-0000-000000000001', 'Cancelled pair org');
insert into auth.users (id, email) values
  ('16960000-0000-0000-0000-0000000000a1', 'cpair-fin@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('16960000-0000-0000-0000-0000000000a1', '16960000-0000-0000-0000-000000000001', 'Cpair Finance', 'cpair-fin@example.test', 'Finance', 'active');
insert into public.companies (id, org_id, name, type) values
  ('16960000-0000-0000-0000-0000000000f1', '16960000-0000-0000-0000-000000000001', 'Cpair Client', 'Client');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                             tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('16960000-0000-0000-0000-0000000000c1', '16960000-0000-0000-0000-000000000001', 'Cpair P', 'Ongoing Project', 'USD',
   1000000, 'exclusive', 0, 0, 1, 1, false, '16960000-0000-0000-0000-0000000000f1', '16960000-0000-0000-0000-0000000000a1');
insert into public.external_domain_ownership (org_id, external_tier, domain) values
  ('16960000-0000-0000-0000-000000000001', 'erpnext', 'revenue');
-- N1: PMO-raised (10,000 + 1,100 tax, exclusive). E1: the same sale brought in from the ERP (11,100 inclusive).
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, reference_number,
                                   native_lines, pmo_native, author_user_id, pmo_number) values
  ('16960000-0000-0000-0000-0000000005a1', '16960000-0000-0000-0000-000000000001', '16960000-0000-0000-0000-0000000000c1',
   '16960000-0000-0000-0000-0000000000f1', '2026-03-10', 10000, 11100, 'exclusive', 1100, 'USD', 'Unpaid', 'PO-7',
   '[{"description":"n1"}]', true, '16960000-0000-0000-0000-0000000000a1', 'PMO-N1');
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                                   erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus, reference_number) values
  ('16960000-0000-0000-0000-0000000005e1', '16960000-0000-0000-0000-000000000001', null, '16960000-0000-0000-0000-0000000000f1',
   'SI-E1', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, 'PO-7');

-- ── accept ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"16960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.accept_invoice_pairs('[{"pmo":"16960000-0000-0000-0000-0000000005a1","erp":"16960000-0000-0000-0000-0000000005e1"}]'::jsonb), 1,
          'AC-ECA-032 Finance accepts the pair');
select is((public.get_project_finances('16960000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 11100::numeric,
          'AC-ECA-032 after accept the sale counts once, as the ERP invoice');

-- ── the ERP cancels E1 and raises the amendment E1-1 (the feed writes as the service role) ──────────
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update public.sales_invoices set erp_docstatus = 2, erp_cancelled_at = now(), status = 'Cancelled'
 where id = '16960000-0000-0000-0000-0000000005e1';
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount,
                                   erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus,
                                   reference_number, erp_amended_from) values
  ('16960000-0000-0000-0000-0000000005e2', '16960000-0000-0000-0000-000000000001', null, '16960000-0000-0000-0000-0000000000f1',
   'SI-E1-1', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, 'PO-7', 'SI-E1');
select is((select paired_erp_invoice_id from public.sales_invoices where id = '16960000-0000-0000-0000-0000000005a1'),
          '16960000-0000-0000-0000-0000000005e1'::uuid, 'AC-ECA-032 the cancel keeps the pair: nothing unpairs on its own');

set local role authenticated;
set local request.jwt.claims = '{"sub":"16960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('16960000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 0::numeric,
          'AC-ECA-032 with the ERP invoice cancelled the paired sale counts nowhere (what the flag warns about)');
select is((select count(*)::int from public.sales_invoices
            where (id = '16960000-0000-0000-0000-0000000005e1' and erp_docstatus = 2 and erp_cancelled_at is not null)
               or (id = '16960000-0000-0000-0000-0000000005e2' and erp_amended_from = 'SI-E1' and erp_docstatus = 1)), 2,
          'AC-ECA-034 Finance can read the cancellation and the amendment the screen shows');
select is((select count(*)::int from public.propose_invoice_pairs()
            where pmo_invoice_id = '16960000-0000-0000-0000-0000000005a1'), 0,
          'AC-ECA-032 a paired PMO invoice is not proposed again while it is paired');

-- ── undo, then re-pair with the amendment ────────────────────────────────────────────────────────
select lives_ok($$select public.unpair_invoice('16960000-0000-0000-0000-0000000005a1')$$,
                'AC-ECA-032 Finance can undo a pair whose ERP invoice is cancelled');
select is((public.get_project_finances('16960000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 10000::numeric,
          'AC-ECA-032 after undo the PMO invoice counts again');
select is((select count(*)::int from public.propose_invoice_pairs()
            where pmo_invoice_id = '16960000-0000-0000-0000-0000000005a1'
              and erp_invoice_id = '16960000-0000-0000-0000-0000000005e2' and not ambiguous), 1,
          'AC-ECA-032 after undo the PMO invoice is proposed against the live amendment only');
select is(public.accept_invoice_pairs('[{"pmo":"16960000-0000-0000-0000-0000000005a1","erp":"16960000-0000-0000-0000-0000000005e2"}]'::jsonb), 1,
          'AC-ECA-032 Finance pairs it with the amendment');

select * from finish();
rollback;
```

2.1 Run from the repo root:
`scripts/with-db-lock.sh supabase test db supabase/tests/invoice_pairs_erp_cancelled.test.sql`
Expected: `ok 1 .. ok 10`, `All tests successful`. Read the output body, not the exit code.

2.2 If assertion 2 or 8 reports a different `invoiced` figure, the fixture is wrong, not the server: the existing
`supabase/tests/invoice_pairs.test.sql` §3/§4 shows a PMO copy counts its net `amount` (10,000) and an ERP copy its
inclusive `amount` (11,100) in `invoiced`. Fix the fixture's expectation only if the trace shows that rule; never bend
assertion 4 (the zero) or 9 (the proposal).

2.3 Mutation check (do not commit): in the test file, change the cancel `update` to `erp_docstatus = 1, erp_cancelled_at
= null`. Rerun 2.1: assertion 4 must fail (`have: 11100`) and assertion 9 must fail (E1 and E1-1 both candidates →
ambiguous). Revert the edit; rerun 2.1 green.

### Task 3 — DAL test: cancelled pair (AC-ECA-034), red, 4 min

In `pmo-portal/src/lib/db/revenue.pairs.test.ts`, replace the expected object in the existing
`'listAcceptedInvoicePairs reads PMO copies that now count as an ERP invoice, with the ERP number'` test with:

```ts
    expect(rows).toEqual([{ pmoInvoiceId: 'n1', pmoNumber: 'PMO-1', amount: 11100, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z',
      erpNumber: 'SI-1', erpCancelled: false, erpReplacedBy: null }]);
    expect(h.inCalls).not.toContainEqual(['erp_amended_from', expect.anything()]);
```

and add, inside the same `describe`:

```ts
  it('AC-ECA-034 listAcceptedInvoicePairs flags a pair whose ERP invoice was cancelled and names its live amendment', async () => {
    h.pages = [
      [
        { id: 'n1', pmo_number: 'PMO-1', amount: 11100, currency: 'IDR', paired_at: '2026-11-02T01:00:00Z', paired_erp_invoice_id: 'e1' },
        { id: 'n2', pmo_number: 'PMO-2', amount: 500, currency: 'IDR', paired_at: '2026-11-01T01:00:00Z', paired_erp_invoice_id: 'e2' },
        { id: 'n3', pmo_number: 'PMO-3', amount: 700, currency: 'IDR', paired_at: '2026-10-31T01:00:00Z', paired_erp_invoice_id: 'e3' },
      ],
      [
        { id: 'e1', si_number: 'SI-1', erp_docstatus: 2, erp_cancelled_at: '2026-11-10T03:00:00Z' },
        { id: 'e2', si_number: 'SI-2', erp_docstatus: 2, erp_cancelled_at: null },
        { id: 'e3', si_number: 'SI-3', erp_docstatus: 1, erp_cancelled_at: null },
      ],
      [
        { si_number: 'SI-1-1', erp_amended_from: 'SI-1', erp_docstatus: 1, erp_cancelled_at: null },
        { si_number: 'SI-2-1', erp_amended_from: 'SI-2', erp_docstatus: 2, erp_cancelled_at: '2026-11-11T03:00:00Z' },
      ],
    ];

    const rows = await listAcceptedInvoicePairs();

    expect(h.inCalls).toContainEqual(['erp_amended_from', ['SI-1', 'SI-2']]);
    expect(rows.map((r) => [r.pmoNumber, r.erpNumber, r.erpCancelled, r.erpReplacedBy])).toEqual([
      ['PMO-1', 'SI-1', true, 'SI-1-1'],
      ['PMO-2', 'SI-2', true, null],   // docstatus 2 alone is a cancel; a cancelled amendment is no replacement
      ['PMO-3', 'SI-3', false, null],
    ]);
  });
```

Run from `pmo-portal/`: `npx vitest run src/lib/db/revenue.pairs.test.ts`. Expected red: both tests fail on the missing
`erpCancelled`/`erpReplacedBy` fields and the missing `erp_amended_from` read.

### Task 4 — DAL: read the ERP lifecycle and the amendment (AC-ECA-034), green, 5 min

In `pmo-portal/src/lib/db/revenue.ts`:

4.1 Extend the interface:

```ts
export interface AcceptedInvoicePair {
  pmoInvoiceId: string;
  pmoNumber: string | null;
  amount: number;
  currency: string;
  pairedAt: string;
  erpNumber: string | null;
  /** The ERP invoice this PMO copy counts as was cancelled in the ERP, so the sale counts nowhere (#1696). */
  erpCancelled: boolean;
  /** The number of a live ERP amendment of that cancelled invoice, if the ERP raised one. */
  erpReplacedBy: string | null;
}
```

4.2 Replace `erpInvoiceNumbers` with:

```ts
type ErpLifecycle = { si_number: string | null; erp_docstatus: number | null; erp_cancelled_at: string | null };
/** The same rule every revenue reader uses to drop an ERP invoice (0498 §5): docstatus 2 or a cancel time. */
const erpIsCancelled = (r: Pick<ErpLifecycle, 'erp_docstatus' | 'erp_cancelled_at'>) =>
  r.erp_docstatus === 2 || r.erp_cancelled_at != null;

/**
 * The ERP invoices behind a set of paired PMO copies: number and lifecycle. Two reads, not an embed: PostgREST cannot
 * resolve the self-referencing paired_erp_invoice_id relationship (a hint by constraint name finds nothing, one by column
 * name walks the wrong direction). RLS scopes the rows to the caller's org.
 */
async function erpInvoiceStates(ids: string[]): Promise<Map<string, ErpLifecycle>> {
  const states = new Map<string, ErpLifecycle>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('sales_invoices')
      .select('id, si_number, erp_docstatus, erp_cancelled_at').in('id', ids.slice(i, i + 100));
    if (error) throwWrite(error);
    for (const r of (data ?? []) as Array<ErpLifecycle & { id: string }>) states.set(r.id, r);
  }
  return states;
}

/** Live ERP amendments of the given cancelled ERP invoice numbers, keyed by the number they amend. */
async function liveAmendments(cancelledNumbers: string[]): Promise<Map<string, string>> {
  const byOriginal = new Map<string, string>();
  for (let i = 0; i < cancelledNumbers.length; i += 100) {
    const { data, error } = await supabase.from('sales_invoices')
      .select('si_number, erp_amended_from, erp_docstatus, erp_cancelled_at')
      .in('erp_amended_from', cancelledNumbers.slice(i, i + 100));
    if (error) throwWrite(error);
    for (const r of (data ?? []) as Array<ErpLifecycle & { erp_amended_from: string }>) {
      if (!erpIsCancelled(r) && r.si_number) byOriginal.set(r.erp_amended_from, r.si_number);
    }
  }
  return byOriginal;
}
```

4.3 Replace the body of `listAcceptedInvoicePairs` after the `rows` read with:

```ts
  const states = await erpInvoiceStates([...new Set(rows.map((r) => r.paired_erp_invoice_id))]);
  const cancelledNumbers = [...new Set([...states.values()]
    .filter(erpIsCancelled).map((s) => s.si_number).filter((n): n is string => Boolean(n)))];
  const amendments = cancelledNumbers.length > 0 ? await liveAmendments(cancelledNumbers) : new Map<string, string>();
  return rows.map((r) => {
    const erp = states.get(r.paired_erp_invoice_id);
    const cancelled = erp ? erpIsCancelled(erp) : false;
    return {
      pmoInvoiceId: r.id, pmoNumber: r.pmo_number, amount: Number(r.amount ?? 0), currency: r.currency,
      pairedAt: r.paired_at, erpNumber: erp?.si_number ?? null, erpCancelled: cancelled,
      erpReplacedBy: cancelled && erp?.si_number ? amendments.get(erp.si_number) ?? null : null,
    };
  });
```

and update its doc comment to: `/** PMO invoices paired with an ERP invoice, newest first, with whether that ERP invoice was since cancelled (#1696). */`

4.4 `grep -rn "erpInvoiceNumbers" pmo-portal/src` must print nothing (no other caller; delete, do not keep both).
Run from `pmo-portal/`: `npx vitest run src/lib/db/revenue.pairs.test.ts` — green.

4.5 The repository contract re-exports the type: run `grep -n "AcceptedInvoicePair" src/lib/repositories/contracts/revenue.ts src/lib/repositories/revenue.ts`
from `pmo-portal/`; if either declares its own copy of the shape instead of importing it, make it import the DAL type.

### Task 5 — UI test: the cancelled section (AC-ECA-033), red, 5 min

Append to `pmo-portal/src/components/integrations/InvoicePairReview.test.tsx`:

```tsx
const pair = (n: number, extra: Record<string, unknown> = {}) => ({
  pmoInvoiceId: `n${n}`, pmoNumber: `PMO-${n}`, amount: 1000 * n, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z',
  erpNumber: `SI-${n}`, erpCancelled: false, erpReplacedBy: null, ...extra,
});

it('AC-ECA-033 a pair whose ERP invoice was cancelled is flagged on its own, with its replacement, and not counted as done', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([
    pair(1, { erpCancelled: true, erpReplacedBy: 'SI-1-1' }),
    pair(2, { erpCancelled: true }),
    pair(3),
  ]);
  mount();

  const flagged = await screen.findByRole('region', { name: 'ERP invoice cancelled' });
  expect(flagged).toHaveTextContent('so each sale below counts nowhere');
  expect(within(flagged).getByText('PMO-1')).toBeInTheDocument();
  expect(flagged).toHaveTextContent('ERP invoice SI-1 was cancelled');
  expect(flagged).toHaveTextContent('Replaced in the ERP by SI-1-1');
  expect(flagged).toHaveTextContent('ERP invoice SI-2 was cancelled');
  expect(within(flagged).queryByText('PMO-3')).not.toBeInTheDocument();
  expect(within(flagged).getByRole('button', { name: 'Undo PMO-2' })).toBeVisible();
  // the done list counts only the pair that really counts once
  expect(screen.getByText('1 invoice already counts once')).toBeInTheDocument();
});

it('AC-ECA-033 undoing a cancelled pair says the sale will count as the PMO invoice, then unpairs it', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: true })]);
  mount();

  const flagged = await screen.findByRole('region', { name: 'ERP invoice cancelled' });
  fireEvent.click(within(flagged).getByRole('button', { name: 'Undo PMO-1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count PMO-1 on its own again?' });
  expect(dialog).toHaveTextContent('ERP invoice SI-1 is cancelled, so the sale counts once, as PMO-1, until you pair it again.');
  expect(h.unpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));

  await waitFor(() => expect(h.unpairInvoice).toHaveBeenCalledWith('n1'));
  expect(await screen.findByRole('status')).toHaveTextContent('PMO-1 counts on its own again.');
});

it('AC-ECA-033 the cancelled section stays hidden while no pair points at a cancelled ERP invoice', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(3)]);
  mount();

  expect(await screen.findByText('1 invoice already counts once')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'ERP invoice cancelled' })).not.toBeInTheDocument();
});
```

Run from `pmo-portal/`: `npx vitest run src/components/integrations/InvoicePairReview.test.tsx`. Expected red: the
three new tests fail (no "ERP invoice cancelled" region); every existing test stays green.

### Task 6 — UI: render the cancelled section (AC-ECA-033), green, 5 min

In `pmo-portal/src/components/integrations/InvoicePairReview.tsx`:

6.1 Replace `const done = accepted.data ?? [];` with:

```tsx
  const allAccepted = accepted.data ?? [];
  // #1696: a pair whose ERP invoice was cancelled in the ERP counts nowhere; it is shown apart, never as "counts once".
  const cancelledPairs = allAccepted.filter((d) => d.erpCancelled);
  const done = allAccepted.filter((d) => !d.erpCancelled);
```

and add `cancelledPairs.length` to the self-hide sum:
`if (clear.length + ambiguous.length + stillPmo.length + cancelledPairs.length + done.length + failed.length === 0 && !notice) return null;`

6.2 Insert immediately before the `{done.length > 0 && (` block:

```tsx
      {cancelledPairs.length > 0 && (
        <section aria-label={t('invoicePairs.erpCancelled.title', 'ERP invoice cancelled')}>
          <h3 className='font-medium'>{t('invoicePairs.erpCancelled.title', 'ERP invoice cancelled')}</h3>
          <p className='mt-1 text-muted-foreground'>
            {t('invoicePairs.erpCancelled.help', 'The ERP invoice these PMO invoices count as was cancelled in the ERP, so each sale below counts nowhere: not in revenue and not in receivables. If the sale still stands, undo the pair so the PMO invoice counts again. If the sale was cancelled, leave it as it is.')}
          </p>
          <ul className='mt-2 divide-y divide-border'>
            {cancelledPairs.map((d) => (
              <li key={d.pmoInvoiceId} className='flex flex-wrap items-center justify-between gap-2 py-1.5'>
                <span>
                  <span>{d.pmoNumber ?? '-'}</span>
                  <span className='text-muted-foreground'>
                    {' · '}{t('invoicePairs.erpCancelled.row', 'ERP invoice {{number}} was cancelled', { number: d.erpNumber ?? '-' })}
                    {' · '}{money(d.amount, d.currency)}
                    {d.erpReplacedBy && <>{' · '}{t('invoicePairs.erpCancelled.replacedBy', 'Replaced in the ERP by {{number}}', { number: d.erpReplacedBy })}</>}
                  </span>
                </span>
                <Button
                  size='sm' variant='outline'
                  aria-label={t('invoicePairs.undoFor', 'Undo {{number}}', { number: d.pmoNumber ?? '-' })}
                  onClick={() => setUndoing(d)}
                >
                  {t('invoicePairs.undo', 'Undo')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
```

6.3 In the undo `ConfirmDialog`, replace the `description` prop with:

```tsx
        description={undoing?.erpCancelled
          ? t('invoicePairs.undoBodyCancelled', '{{number}} goes back into revenue and receivables. ERP invoice {{erp}} is cancelled, so the sale counts once, as {{number}}, until you pair it again.', { number: undoing.pmoNumber ?? '-', erp: undoing.erpNumber ?? '-' })
          : t('invoicePairs.undoBody', 'The PMO invoice goes back into revenue and receivables. The ERP invoice {{erp}} stays, so if both count, the sale shows twice until you pair them again.', { erp: undoing?.erpNumber ?? '-' })}
```

Run from `pmo-portal/`: `npx vitest run src/components/integrations/InvoicePairReview.test.tsx src/components/integrations/InvoicePairReview.floor.test.tsx` — green.

### Task 7 — translations, 3 min

Add under `"invoicePairs"` in `pmo-portal/public/locales/en/administration.json`:

```json
    "erpCancelled": {
      "title": "ERP invoice cancelled",
      "help": "The ERP invoice these PMO invoices count as was cancelled in the ERP, so each sale below counts nowhere: not in revenue and not in receivables. If the sale still stands, undo the pair so the PMO invoice counts again. If the sale was cancelled, leave it as it is.",
      "row": "ERP invoice {{number}} was cancelled",
      "replacedBy": "Replaced in the ERP by {{number}}"
    },
    "undoBodyCancelled": "{{number}} goes back into revenue and receivables. ERP invoice {{erp}} is cancelled, so the sale counts once, as {{number}}, until you pair it again.",
```

and under `"invoicePairs"` in `pmo-portal/public/locales/id/administration.json`:

```json
    "erpCancelled": {
      "title": "Faktur ERP dibatalkan",
      "help": "Faktur ERP yang menjadi hitungan faktur PMO ini telah dibatalkan di ERP, sehingga setiap penjualan di bawah tidak terhitung di mana pun: tidak di pendapatan dan tidak di piutang. Jika penjualan masih berlaku, batalkan pasangan agar faktur PMO terhitung lagi. Jika penjualan memang dibatalkan, biarkan apa adanya.",
      "row": "Faktur ERP {{number}} dibatalkan",
      "replacedBy": "Diganti di ERP oleh {{number}}"
    },
    "undoBodyCancelled": "{{number}} kembali masuk ke pendapatan dan piutang. Faktur ERP {{erp}} dibatalkan, sehingga penjualan terhitung sekali, sebagai {{number}}, sampai Anda memasangkannya lagi.",
```

Verify from `pmo-portal/`: `npm run check:i18n && npm run check:plain-words` — both pass. If `check:plain-words` flags a
word, change the wording in the JSON, the component default and the Task 5 test together, keeping the meaning.

### Task 8 — the e2e journey still holds, 4 min

The only e2e that renders this card is `pmo-portal/e2e/serial/AC-ECA-051-connect-erp-with-data.spec.ts` (region
"Invoices on both sides"). No new e2e: AC-ECA-033/034 are unit-owned and AC-ECA-032 is pgTAP-owned (ADR-0010, lowest
sufficient layer); the seed has no cancelled paired invoice. Run from the repo root:
`scripts/e2e-local.sh AC-ECA-051` — green. Then from `pmo-portal/`: `node scripts/affected-e2e.mjs` and run any spec it
lists with `--run`.

### Task 9 — rendered proof, 4 min

Seed one cancelled pair on the local stack for the capture only (not committed): as the local Finance user, accept a
seeded pair on `/finance`, then from the repo root

```sh
DB_URL="$(supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
scripts/with-db-lock.sh psql "$DB_URL" -c "update public.sales_invoices set erp_docstatus = 2, erp_cancelled_at = now(), status = 'Cancelled' where id = (select paired_erp_invoice_id from public.sales_invoices where paired_erp_invoice_id is not null limit 1)"
```

Then `scripts/ux-proof.sh /finance` — clean (no small text, no word-count growth beyond the new section). Attach the
capture of the card at 1440 px and 390 px to the PR for the Director's rendered review.

### Task 10 — glossary, 2 min

`docs/glossary.md` has no invoice-pair entry yet (`grep -n -i "pair" docs/glossary.md` prints nothing at plan time). Add,
in its alphabetical place: "**Invoice pair** — a PMO-raised invoice linked by Finance to the same invoice in the ERP, so
the sale counts once, as the ERP copy (FR-ECA-040)." and "**Cancelled pair** —
an accepted pair whose ERP invoice was later cancelled in the ERP. The sale counts nowhere until a person undoes the pair
(the PMO invoice counts again) or leaves it (the sale was cancelled)."

### Task 11 — local final gate, 5 min

From `pmo-portal/`:

```sh
npm run check:guards
npm run typecheck
npx eslint --max-warnings=0 src/lib/db/revenue.ts src/lib/db/revenue.pairs.test.ts \
  src/components/integrations/InvoicePairReview.tsx src/components/integrations/InvoicePairReview.test.tsx
npx vitest run src/lib/db/revenue.pairs.test.ts src/components/integrations/InvoicePairReview.test.tsx \
  src/components/integrations/InvoicePairReview.floor.test.tsx src/lib/db/revenue.test.ts src/lib/db/revenue.lists.test.ts
npx vitest run --coverage --coverage.include=src/lib/db/revenue.ts --coverage.include=src/components/integrations/InvoicePairReview.tsx \
  src/lib/db/revenue.pairs.test.ts src/components/integrations/InvoicePairReview.test.tsx
```

Changed lines ≥ 80 % covered. Every command's output body reads clean.

### Task 12 — every test that names the pairing functions, 5 min

No database function changes in this plan, but the new pgTAP file sits beside the pairing suite and the money tier asks
for the neighbours to be proven unaffected. Run from the repo root, one lock hold:

```sh
scripts/with-db-lock.sh supabase test db \
  supabase/tests/invoice_pairs_erp_cancelled.test.sql \
  supabase/tests/invoice_pairs.test.sql \
  supabase/tests/0498_invoice_pairs_rollback.test.sql \
  supabase/tests/0731_payment_allocation_readers.test.sql \
  supabase/tests/0731_payment_allocation_rollback.test.sql \
  supabase/tests/connect_party_link_revenue_reread.test.sql \
  supabase/tests/0178_anon_executable_definers.test.sql
```

This is the list from `grep -lE "invoice_pair_candidates|propose_invoice_pairs|list_unpaired_native_invoices|accept_invoice_pairs|unpair_invoice|paired_erp_invoice_id|an invoice is paired only by accepting|cannot be changed in PMO|not an unambiguous match" supabase/tests/*.sql`;
re-run that grep first and add any new file it prints (the `_down_runner.sql` files are loaded by the rollback tests, not
run directly). All green. If a builder did change a database function after all, this task is mandatory, not a check.

### Task 13 — reviews and ship

Three reviewers (spec, code quality, security: the read is RLS-scoped, no new write path, no new grant). Director's one
rendered review of `/finance` from Task 9's captures. Then `release-engineer`: branch → commit → push → one PR to `dev`
that ships alone, `Closes #1696`. No merge without Director approval; no production.

## Traceability

| AC | What it proves | Owning layer | Owning test |
|---|---|---|---|
| AC-ECA-032 | Cancel keeps the pair; sale counts nowhere; undo works; PMO copy then proposed against the live amendment | Integration (pgTAP) | `supabase/tests/invoice_pairs_erp_cancelled.test.sql` |
| AC-ECA-033 | Review screen flags cancelled pairs apart, names the replacement, offers undo with its own wording; hidden when none | Unit (Vitest/RTL) | `pmo-portal/src/components/integrations/InvoicePairReview.test.tsx` |
| AC-ECA-034 | Accepted-pair read carries the cancel flag and live amendment (docstatus-2-only cancel; cancelled amendment ignored) | Unit (Vitest) | `pmo-portal/src/lib/db/revenue.pairs.test.ts` |
| AC-ECA-030 (existing) | Unchanged count-once journey | Integration + e2e | `supabase/tests/invoice_pairs.test.sql`, `pmo-portal/e2e/serial/AC-ECA-051-connect-erp-with-data.spec.ts` |

## Owner questions

1. **Should the screen do more than flag?** This plan flags and offers the existing Undo; the person then accepts the
   amendment from the proposal list as today. A one-step "Move to SI-E1-1" button would re-pair in one action but needs
   a new definer RPC (money-path, its own pgTAP). Recommendation: flag + Undo now; one-step move only if Finance asks.
2. **Leave it, or acknowledge it?** When the sale really was cancelled, "leave it" is correct (it should count nowhere),
   but the row stays flagged for ever. An "Acknowledge" that hides it needs a stored decision: a migration
   `NNNN_invoice_pair_cancel_ack.sql` (number reserved at build time) and a plan revision. Recommendation: no
   acknowledge for now; reconsider if the list grows.
3. **The PMO copy of a really cancelled sale stays frozen.** While the ERP owns revenue, a PMO invoice cannot be
   cancelled in PMO, and a paired one cannot change at all. Is "leave it paired to the cancelled ERP invoice" the
   accepted way to record a voided sale, or should the voided PMO copy be cancellable once its ERP twin is cancelled?
4. **Tell someone when it happens?** The feed could raise an action-required notice to Finance when it cancels a paired
   ERP invoice (`surfaceActionRequired`, as the withholding review does). That edits the feed (money path). This plan
   does not; the flag waits on the Finance hub. Should a notice ship with it, or later?
5. **Amendment matching across ERPs.** "Replaced by" uses the ERP's `amended_from` link (ERPNext sets it). An Odoo
   reversal-and-reissue leaves it empty, so no replacement is named and the person relies on the proposal list after
   Undo. Acceptable for this slice?
