# Plan — Apply a payment to invoices, for organisations without an ERP (#1415)

> Issue: #1415 (follows the finance restructure #1405; part of #806). Related: #784 (native revenue, migration 0275).
> Lane: **money path + SoD → ships alone** (own branch, own PR to `dev`, Opus security review, no batching).
> Migration slot: **0731 only** (+ `supabase/migrations/rollback/0731_payment_allocation_down.sql`). Branch `feat/1415-payment-allocation`.
> Prefix for the new acceptance criteria: `AC-NPA-###` (native payment allocation). Every command runs from the repo root unless it starts with `(cd pmo-portal && …)`.
> Read before building: `docs/money-path-primer.md`, ADR-0016/0017/0019, `supabase/migrations/0275_native_revenue.sql` §1/§2/§5, `0534_feature_enforcement.sql` (the LIVE bodies of `record_native_receipt`, `cancel_native_receipt`, `transition_native_sales_invoice`), `0497_equipment_project_actuals.sql` and `0498_invoice_pairs.sql` (the LIVE readers).

## 0. Owner ruling (binding, 2026-11-07)

For an org **without** an accounting system: allow **on-account receipts** (`sales_invoice_id` null) and a new **receipt-to-invoice allocation table** that **replaces** `native_invoice_settled`'s per-receipt sum; a payment is applied across one or more invoices from the payment drawer; server-enforced (RLS + SECURITY DEFINER RPC, over-allocation refused, `org_id` stamped); pgTAP + mutation checks; Opus security review. For an org **with** an ERP: Apply stays hidden; the ERP's allocation shows read-only.

## 1. What exists today (read, not assumed)

| Fact | Deciding artifact |
|---|---|
| A native receipt is an `incoming_payments` row, `pmo_native = true`, written only by `record_native_receipt`; it names exactly one invoice. | 0275 §1 constraint `incoming_payments_pmo_native_shape` = `not pmo_native or (ip_number is null and erp_docstatus is null and sales_invoice_id is not null)`; live body in 0534. |
| An invoice's settled figure is `Σ amount` of live native receipts citing it. `native_invoice_restate` writes `erp_outstanding_amount`, `overpaid_amount`, `status` from it under the invoice row lock. | `native_invoice_settled(uuid,uuid)` (0275 §2). Its ONLY SQL callers: `native_invoice_restate` and `transition_native_sales_invoice` (0534 body, "cancel receipts first" guard). Nothing in `pmo-portal/` or edge functions calls it (grep scope: `supabase/`, `pmo-portal/src`, `pmo-portal/pages`, `pmo-portal/e2e`, `supabase/functions`, `scripts`, `docs`; it appears in `database.types.ts` only). |
| Over-payment of one invoice is allowed on the direct path (DD-NAR-17: `overpaid_amount`). | `record_native_receipt` body. |
| ERP receipts carry their allocation as `allocation_details jsonb` (`[]` = on account, `null` = unknown), mirrored read-only by the feed. | 0301; `pmo-portal/src/lib/revenue/receiptAllocation.ts` (`receiptAllocations`, `knownUnappliedCash`, `displayAllocations`). |
| The payment drawer (#1405) is the `<Drawer>` in `pmo-portal/pages/IncomingPayments.tsx` (≈L413–455): totals, "Not yet applied", "Invoices settled" list; row menu offers only Cancel. | file read. |
| Revenue write roles: Admin + Finance. FE `may('create','incomingPayment')` = `REVENUE_WRITE`. | `pmo-portal/src/auth/policy.ts` `incomingPayment`; 0275 §8. |
| Other SQL readers that treat a native receipt's `sales_invoice_id` as THE invoice link (these go wrong the moment a receipt is on account or split): **`project_mapped_actuals`, `project_mapped_actuals_all`** (0497: `candidate_receipt_ids` native branch, `receipt_facts.native_si`, contribution = `received_amount`), **`invoice_pair_candidates`, `list_unpaired_native_invoices`** (0498: `not exists (… ip.sales_invoice_id = n.id and ip.cancelled_at is null)`). `0315/0376/0392/0410` carry superseded copies. | `grep -n "sales_invoice_id" supabase/migrations/0497* 0498*`. **Task 0 confirms each is the live body via `pg_get_functiondef`, because the migrations are history, `pg_proc` is the decider.** |
| FE readers keyed on the 1:1 link: `listIncomingPayments({salesInvoiceId})` (`revenue.ts:379`), `SalesInvoices.tsx:191,604`, `IncomingPayments.tsx:117`, `displayAllocations` (native branch). | grep. |

## 2. Design decisions (one line of why each)

**D1 — Allocation table is the only authority for "what settles an invoice" on native receipts.** `incoming_payments.sales_invoice_id` on a native receipt becomes a non-authoritative *origin* pointer ("recorded from this invoice"), still written by `record_native_receipt`, never read for settlement. Why: two sources of truth is the bug class this repo has paid for repeatedly; leaving the column (instead of nulling) keeps the mirror guard, the audit trail and every ERP-path reader untouched.

**D2 — `record_native_receipt` keeps its signature and meaning** (receipt + settle one invoice, overpay allowed, DD-NAR-17) but now also inserts one allocation row for the full amount. The new **apply** path is stricter than the direct path: no over-allocation (owner ruling). So `overpaid_amount` still arises only from the direct path. No grant change (same signature).

**D3 — New RPCs (three), all `SECURITY DEFINER`, `search_path = public`, `revoke … from public, anon`, `grant execute … to authenticated`:**
- `record_native_on_account_receipt(p_customer_id uuid, p_amount numeric, p_received_amount numeric, p_withheld_amount numeric, p_withholding_slip_number text, p_date date, p_receipt_id uuid default null) returns uuid` — receipt with no invoice; `p_receipt_id` is the client-minted idempotency key (a replay with the same id and same payload returns it; same id, different payload → `request-id-reused`).
- `apply_native_receipt(p_receipt_id uuid, p_allocations jsonb, p_request_id uuid) returns uuid[]` — the owner's "apply across one or more invoices".
- `unapply_native_allocation(p_allocation_id uuid) returns void` — reversal.

**D4 — Unapply is IN scope.** Name what breaks without it: a Finance user applies 5 000 to the wrong invoice; the only undo is cancelling the whole receipt (new receipt number, re-keyed withholding slip, lost payment date) and the invoice stays falsely Paid until then. Reversal is soft (`reversed_at`), audited, restates the invoice. Cancel of a receipt reverses all its live allocations in the same transaction.

**D5 — Cash/withholding split is stored on each allocation** (`cash_amount`, `withheld_amount`, `cash + withheld = amount`). Why: project cash attribution (0497) uses *cash received*, not gross, and a partly-applied receipt with withholding has no other honest answer. Rule at apply time: share = `round(amount × received / receipt.amount, 2)`; when an allocation consumes the receipt's whole remaining unapplied amount, `cash_amount = receipt.received − Σ prior live cash_amount` (remainder rule), so a fully-applied receipt's cash sums to `received_amount` exactly. Unapply returns its shares to the pool.

**D6 — Over-allocation is refused at two layers:** the RPC (under row locks) and a `BEFORE INSERT` trigger on the allocation table (defence for any other writer, incl. `service_role`). A trigger on `incoming_payments` refuses lowering a native receipt's `amount` below its live allocations.

**D7 — Same currency only.** Receipt currency must equal invoice currency (no FX in v1; the money seam is 0187). Same customer. Same org.

**D8 — On-account cash is not project cash.** Matches the ERP precedent (`allocation_details = []` is excluded from project receipts in 0497). Project cash for a native receipt = Σ live allocations' `cash_amount` on that project's invoices.

**D9 — FE gate is `may('create','incomingPayment')`** (the same Admin+Finance set as recording a receipt), not a new policy action: a new action buys a policy-matrix test for no behavioural difference. RLS/RPC stay the authority (ADR-0016).

## 3. Migration 0731 — `supabase/migrations/0731_payment_allocation.sql`

Header comment cites this plan, #1415, rollback path. Sections:

### §1 — constraint change
```sql
alter table public.incoming_payments drop constraint incoming_payments_pmo_native_shape;
alter table public.incoming_payments add constraint incoming_payments_pmo_native_shape check (
  not pmo_native or (ip_number is null and erp_docstatus is null and customer_id is not null));
```
Existing native rows all have `customer_id` (record_native_receipt stamps it from the invoice), so the new check validates. (Task 0 proves with `select count(*) … where pmo_native and customer_id is null` = 0 on local seed, and adds a `do $$` assertion in the migration itself.)

### §2 — the table
```sql
create table public.incoming_payment_allocations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  incoming_payment_id uuid not null references public.incoming_payments(id) on delete restrict,
  sales_invoice_id   uuid not null references public.sales_invoices(id) on delete restrict,
  amount             numeric(14,2) not null check (amount > 0),
  cash_amount        numeric(14,2) not null check (cash_amount >= 0),
  withheld_amount    numeric(14,2) not null check (withheld_amount >= 0),
  currency           text not null,
  request_id         uuid not null,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  reversed_at        timestamptz,
  reversed_by        uuid references public.profiles(id),
  constraint ipa_split check (cash_amount + withheld_amount = amount),
  constraint ipa_reversal_pair check (reversed_at is not null or reversed_by is null),   -- a backfilled reversal has no actor
  constraint ipa_request_uniq unique (incoming_payment_id, request_id, sales_invoice_id)
);
create index ipa_invoice_live_idx on public.incoming_payment_allocations (org_id, sales_invoice_id) where reversed_at is null;
create index ipa_receipt_live_idx on public.incoming_payment_allocations (incoming_payment_id) where reversed_at is null;
create trigger incoming_payment_allocations_stamp_org_id
  before insert on public.incoming_payment_allocations for each row execute function public.stamp_org_id();   -- 0074 pattern
alter table public.incoming_payment_allocations enable row level security;
alter table public.incoming_payment_allocations force row level security;
revoke all on public.incoming_payment_allocations from public, anon, authenticated;
grant select on public.incoming_payment_allocations to authenticated;
grant select, insert, update, delete on public.incoming_payment_allocations to service_role;   -- pgTAP 0137 catalog backstop
create policy ipa_select on public.incoming_payment_allocations for select
  using (org_id = auth_org_id() and is_active_member());      -- same read set as incoming_payments_select (0350/0646 init-plan form)
-- NO insert/update/delete policy for authenticated: writes exist only inside the three definer RPCs.
```
Match the `(select auth_org_id())` init-plan form used since 0646 if that is the live convention (Task 0 reads `pg_policies` for `incoming_payments_select` and copies its exact predicate). Copy the `authenticated` read predicate from the receipts table so a role that cannot read receipts cannot read allocations (Engineer: 0350).

`ipa_consistency` — `BEFORE INSERT` trigger, `SECURITY DEFINER`, no client EXECUTE:
- `new.org_id = receipt.org_id = invoice.org_id` (else `42501`);
- receipt `pmo_native`, invoice `pmo_native`, `receipt.customer_id = invoice.customer_id`, `receipt.currency = invoice.currency = new.currency`;
- `Σ live amount of this receipt + new.amount <= receipt.amount` (else `23514`, detail `allocation-exceeds-receipt`).

`incoming_payments_amount_covers_allocations` — `BEFORE UPDATE OF amount` on `incoming_payments`: if `new.amount < Σ live allocations` → `23514`.

### §3 — `native_invoice_settled` replaced (same signature, so grants survive; re-issue the revoke)
```sql
create or replace function public.native_invoice_settled(p_org uuid, p_si_id uuid) returns numeric
  language sql stable set search_path = public as $$
  select coalesce(sum(a.amount), 0) from public.incoming_payment_allocations a
   where a.org_id = p_org and a.sales_invoice_id = p_si_id and a.reversed_at is null
$$;
revoke all on function public.native_invoice_settled(uuid, uuid) from public, anon, authenticated;
```
Callers `native_invoice_restate` and `transition_native_sales_invoice` need **no text change** (they call the function) — they are re-proven by tests, not edited. Receipt cancellation reverses allocations (`reversed_at`), so no join to `incoming_payments` is needed in the sum.

### §4 — backfill, with a self-check inside the migration
```sql
create or replace function public.native_receipt_allocations_backfill() returns int
  language sql security definer set search_path = public as $$
  with ins as (
  insert into incoming_payment_allocations
    (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id,
     created_at, reversed_at, reversed_by)
  select ip.org_id, ip.id, ip.sales_invoice_id, ip.amount, ip.received_amount, ip.withheld_amount, ip.currency,
         ip.id,                                   -- request_id: the receipt's own id (deterministic, replay-safe)
         ip.created_at, ip.cancelled_at, null::uuid
  from incoming_payments ip where ip.pmo_native and ip.sales_invoice_id is not null
  on conflict on constraint ipa_request_uniq do nothing returning 1)
  select count(*)::int from ins
$$;
```
A backfilled reversal has no actor, which `ipa_reversal_pair` allows (`reversed_by` only with `reversed_at`). The function is `revoke … from public, anon, authenticated`; it is called once in the migration and kept (idempotent) so the pgTAP before/after test can re-run it.

Then, in the migration itself:
```sql
do $$ declare v_bad int; begin
  select count(*) into v_bad from (
    select si.id,
           coalesce((select sum(ip.amount) from incoming_payments ip
                      where ip.org_id = si.org_id and ip.sales_invoice_id = si.id and ip.pmo_native and ip.cancelled_at is null), 0) as legacy,
           public.native_invoice_settled(si.org_id, si.id) as migrated
      from sales_invoices si where si.pmo_native) x
   where x.legacy is distinct from x.migrated;
  if v_bad > 0 then raise exception '0731: % PMO invoice(s) settle differently after backfill', v_bad; end if;
end $$;
```
A mismatch aborts the migration. The legacy expression is the verbatim pre-0731 `native_invoice_settled` body.

### §5 — RPC bodies (`record_native_receipt`, `cancel_native_receipt` re-created from the 0534 text; three new)

Every definer body starts, in this order (SECURITY comment as in 0275): `assert_is_active_member()` → `assert_feature_on(auth_org_id(), 'revenue')` → role check `auth_role() in ('Admin','Finance')` (42501) → org-row `FOR SHARE` (serialises with an ERP take-over, same lock as `cancel_native_receipt`) → `domain_externally_owned(org,'revenue')` ⇒ `42501 / erp-owns-revenue` → row locks → validations → writes → `log_audit`.

**Lock order (documented in the header, asserted by a pgTAP prosrc test like `0275_native_revenue_serialise`):** org row (share) → invoices **ascending by id** → receipt. `record_native_receipt` (one invoice, new receipt) and `unapply` (one invoice) stay consistent with it.

**`record_native_receipt`** — body unchanged except: after the receipt insert, `insert into incoming_payment_allocations (…) values (…, v_amount, v_received, v_withheld, v_si.currency, v_id)` then `native_invoice_restate` (as today).

**`record_native_on_account_receipt`** — customer must exist in the caller's org and be a client company (re-use the check `create_native_sales_invoice` makes; Task reads it); amount/withheld/received/date validation copied from `record_native_receipt` (same detail codes: `receipt-amount-invalid`, `withheld-amount-invalid`, `receipt-split-mismatch`, `withholding-slip-missing`, `payment-date-missing`, `payment-date-future`; the "before invoice date" rule has no invoice, so is omitted); insert `incoming_payments (… customer_id, sales_invoice_id null, pmo_native true, pmo_number RCV…)`; idempotency by `p_receipt_id` (`insert … on conflict (id) do nothing`, then compare payload else `request-id-reused`; also refuse if the existing id belongs to another org — return `not authorized`, never reveal). Returns the id. Audit `incoming_payment.on_account`.

**`apply_native_receipt(p_receipt_id, p_allocations, p_request_id)`**:
1. gates above; `p_allocations` must be a JSON array of 1..50 `{invoice_id uuid, amount numeric}`; `invoice_id`s distinct (`allocation-duplicate-invoice`); each amount `> 0`, `< 1e12`, 2 dp (`allocation-amount-invalid`).
2. Lock all named invoices `order by id for update` — ids not found or not in caller's org ⇒ one generic `P0002` ("invoice not found") for both, never distinguishing another org's id.
3. Lock the receipt `for update`; refuse unless same org, `pmo_native`, `cancelled_at is null`, `status = 'Paid'` (`receipt-not-applicable`).
4. **Idempotency:** if any live-or-reversed row exists for `(receipt, p_request_id)`: same set of `(invoice, amount)` ⇒ return its ids, no write; else `request-id-reused`.
5. Per invoice: `pmo_native`, `status = 'Unpaid'` (`invoice-not-receivable`), same customer as receipt (`allocation-client-mismatch`), same currency (`allocation-currency-mismatch`).
6. Over-allocation: `Σ requested <= receipt.amount − Σ live allocations` (`allocation-exceeds-unapplied`) and for each invoice `amount <= gross − native_invoice_settled(...)` computed fresh under the lock (`allocation-exceeds-balance`). **Both inequalities are inclusive.** The balance uses the recomputed figure, never the stored `erp_outstanding_amount`.
7. Compute `cash_amount` per D5, insert rows (`request_id = p_request_id`), `native_invoice_restate` per invoice (ascending), `log_audit('incoming_payment.apply', …, jsonb_build_object('receipt', …, 'allocations', …))`.

**`unapply_native_allocation(p_allocation_id)`**: gates; read allocation to find its invoice; lock invoice, then receipt; re-read the allocation `for update`, refuse if already reversed (`allocation-already-reversed`); set `reversed_at = now(), reversed_by = auth.uid()`; restate the invoice; audit `incoming_payment.unapply`. Refuses if the receipt is cancelled (already reversed).

**`cancel_native_receipt`** — as 0534, but instead of locking one invoice it locks the receipt's live-allocation invoice set ascending, then the receipt; re-reads the allocation set under the receipt lock and, if it grew since the unlocked read, raises `40001` (client retries) rather than restating a stale set; stamps `cancelled_at` and `reversed_at/by` on every live allocation; restates each invoice; audit unchanged plus `allocations_reversed`.

### §6 — readers updated in the same migration (re-created from the LIVE `pg_get_functiondef` text; only the receipt-link predicates change)
- `project_mapped_actuals`, `project_mapped_actuals_all` (0497): native branch of `candidate_receipt_ids` joins `incoming_payment_allocations a on a.incoming_payment_id = ip.id and a.reversed_at is null` to `target_invoices`; the native contribution becomes `Σ a.cash_amount` per allocation (not the receipt's `received_amount`); `receipt_facts` validity checks for native rows apply to the allocation (currency = invoice currency, invoice lifecycle valid, `cash + withheld = amount`). On-account (no live allocation) ⇒ not project cash (D8). A native receipt split over two projects' invoices contributes to each project exactly its allocation cash.
- `invoice_pair_candidates`, `list_unpaired_native_invoices` (0498): `not exists (select 1 from incoming_payment_allocations a where a.org_id = n.org_id and a.sales_invoice_id = n.id and a.reversed_at is null)` replaces the `incoming_payments` probe (pairing refuses an invoice that has anything applied).
- `transition_native_sales_invoice`: unchanged text; test proves "cancel receipts first" now fires on an allocation-settled invoice.
- Anything else Task 0 finds: `grep -n "pmo_native" supabase/migrations/*.sql` limited to functions whose `pg_get_functiondef` mentions `incoming_payments`: `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%incoming_payments%' order by 1;` — the plan's list is the grep result; this query is the decider and the task adds any function it returns that this plan omits.

### §7 — grants assertion block (as 0275 §9)
`do $$` asserts: the three new RPCs + `record_native_receipt`/`cancel_native_receipt` are SECURITY DEFINER, `anon` cannot execute, `authenticated` can; `native_receipt_allocations_backfill`, `ipa_consistency`, the amount trigger function are executable by no client role; `authenticated` has no INSERT/UPDATE/DELETE on the allocation table; `service_role` has full DML.

### Rollback `supabase/migrations/rollback/0731_payment_allocation_down.sql`
Guard first: raise if any live native receipt is on account or partly applied or split across invoices, or any allocation row has `request_id <> incoming_payment_id` and cannot be mapped 1:1 (message: unapply/cancel them first). Then: drop the three RPCs, triggers, the amount trigger; re-create `native_invoice_settled`, `record_native_receipt`, `cancel_native_receipt`, `project_mapped_actuals(_all)`, `invoice_pair_candidates`, `list_unpaired_native_invoices` from their pre-0731 text (extracted with `git show origin/dev:supabase/migrations/<n>.sql | sed -n '<range>p'` — read the file raw first, RTK can mangle `git show rev:path`); re-add `sales_invoice_id is not null` to the constraint; drop the table. `0731_payment_allocation_rollback.test.sql` proves the guard fires with a split receipt and the round trip leaves balances identical.

## 4. Tasks (TDD: each pgTAP file is written and seen RED before the SQL it covers)

Locks: every DB command via `scripts/with-db-lock.sh`; reset+test in ONE hold. Gate on output body, grep `Parse errors`.

**Task 0 — Read the deciders (no edits).** Against local DB: `\sf` / `pg_get_functiondef` for the 6 functions above; the pg_proc query in §3§6; `pg_policies` for `incoming_payments`; `role_table_grants` for `incoming_payments` (can `authenticated` UPDATE `amount`/`cancelled_at`? if yes, D6's amount trigger is load-bearing, if no it is belt-and-braces; record which in the migration comment); native rows with null `customer_id` = 0. Verify: output pasted in the report.

**Task 1 — RED: schema/ACL test.** `supabase/tests/0731_payment_allocation_schema.test.sql`: table + columns, `ipa_split`/amount `check`s reject bad rows (`throws_ok 23514`), partial indexes exist, RLS enabled and forced, `authenticated` has SELECT only, `anon` nothing, `service_role` has INSERT/SELECT/UPDATE/DELETE (`has_table_privilege`, AC-NPA-009), a member of org B reads zero of org A's rows, org A Engineer reads zero (if the receipts read set excludes Engineer), constraint no longer demands `sales_invoice_id`. Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0731_payment_allocation_schema.test.sql` fails (no table).

**Task 2 — RED: backfill test (before/after).** `0731_payment_allocation_backfill.test.sql` (AC-NPA-006). Seeds legacy-shaped data directly (as 0275 tests do): invoice A with two part receipts, invoice B with an over-paying receipt (settled > gross), invoice C with one live and one cancelled receipt, invoice D untouched. Captures `legacy_settled`, `erp_outstanding_amount`, `overpaid_amount`, `status` per invoice into a temp table; `delete from incoming_payment_allocations`; `select native_receipt_allocations_backfill()`; asserts `native_invoice_settled` equals the captured legacy figure for every invoice, that re-running the backfill inserts 0 rows (idempotent), cancelled receipt's allocation has `reversed_at`, then `native_invoice_restate` on each invoice leaves outstanding/overpaid/status **equal to the captured before-values**. Expected RED until Task 4.

**Task 3 — RED: apply/refusal test.** `0731_payment_allocation_apply.test.sql` (AC-NPA-001..005): on-account receipt for customer X (no invoice, `unapplied = amount`); apply 60/40 over invoices I1 (gross 60) and I2 (gross 100): I1 Paid, I2 outstanding 60, receipt fully applied, audit rows written; `throws_ok` (SQLSTATE **and** detail) for: Σ > unapplied; one amount > open balance (and the exact-equal boundary succeeds); amount 0 / negative / 3 dp; duplicate invoice ids; other customer's invoice; other currency; non-native invoice; Draft/Paid/Cancelled invoice; cancelled receipt; ERP-owned org (flip `domain_externally_owned` the way 0275_erp_path does) for all three RPCs; other org's receipt id and other org's invoice id both give the SAME generic error; roles PM/Executive/Engineer/anon refused, Admin and Finance allowed; inactive member refused; feature off ⇒ `feature_off`; idempotent replay returns the same ids and leaves row counts unchanged; same `request_id` with a different payload ⇒ `request-id-reused`; with-holding receipt: `Σ cash_amount = received_amount` after full application, remainder rule exercised with 3 allocations of awkward cents; `org_id` of every new row = caller's org even if the client JSON tries to include `org_id`.

**Task 4 — GREEN: write migration §1–§5.** Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0731_payment_allocation_schema.test.sql supabase/tests/0731_payment_allocation_backfill.test.sql supabase/tests/0731_payment_allocation_apply.test.sql'` all green.

**Task 5 — RED→GREEN: reversal test.** `0731_payment_allocation_unapply_cancel.test.sql` (AC-NPA-007): unapply one of two allocations restates only that invoice (Paid → Unpaid, outstanding back, receipt unapplied returns); double unapply refused; cancel receipt reverses every live allocation and restates all invoices; `transition_native_sales_invoice(…,'Cancelled')` on an allocation-settled Unpaid invoice refused `invoice-has-receipts`, allowed after unapply; audits for each; prosrc assertion that all three RPCs and cancel take `organizations … for share` before the ownership read and lock invoices `order by` id (the prosrc/`pgrowlocks` pattern of `0275_native_revenue_serialise.test.sql`; read that file first). Needs §5 cancel/unapply; if Task 4 already contains them this goes straight GREEN.

**Task 6 — RED→GREEN: readers test.** `0731_payment_allocation_readers.test.sql` (AC-NPA-008): a native receipt of 100 (cash 90 + withheld 10) split 60/40 over a project-P invoice and a project-Q invoice ⇒ `project_mapped_actuals(P)` receipt cash 54.00, `(Q)` 36.00 (remainder rule on the last), on-account receipt contributes to neither; unapply moves it out; `invoice_pair_candidates` / `list_unpaired_native_invoices` exclude an invoice with a live allocation and re-include after unapply. Compare with the pre-0731 figure for a 1:1 receipt (unchanged: before/after equality on the existing seed receipts). Edit migration §6 until green.

**Task 7 — RED→GREEN: DB-level guard test.** `0731_payment_allocation_guards.test.sql`: as `service_role` / superuser-bypassing-RPC raw INSERT of an over-allocation is refused by `ipa_consistency`; raw insert across orgs/customers/currencies refused; `update incoming_payments set amount = <below allocated>` refused.

**Task 8 — Rollback test.** `0731_payment_allocation_rollback.test.sql` (pattern: `0275_native_revenue_rollback_guard.test.sql`): guard fires on a split/on-account receipt; with only 1:1 receipts the down script runs and balances are identical before and after. Verify by running the down script inside the test transaction.

**Task 9 — Re-prove neighbours (grep-scoped, not narrow).** Run every pgTAP file that matches `grep -l "incoming_payments\|native_invoice_settled\|record_native_receipt\|cancel_native_receipt\|project_mapped_actuals\|invoice_pair_candidates\|list_unpaired_native_invoices\|incoming_payment_allocations" supabase/tests/*.sql` plus the known traps: `0137_service_role_grants`, `0136_*`, `0178_anon_executable_definers` (read its allow-list/count comments; the new RPCs are NOT anon-executable so the anon count is unchanged — if the "retained client-callable RPC" list test fails because three new authenticated RPCs exist, amend it the way 0687 did, with a dated note, not by loosening the assertion), `0275_*` (all ten files), the 0497/0498 test files. Verify: one lock hold, paste pass counts, grep `Parse errors`.

**Task 10 — Isolation denominator.** Add `incoming_payment_allocations` to `tables` (`has_org: true`, `b_read: "own-org-only"`, `by_id: "applicable"`) and the three RPCs to `definer_functions` and `rpcs` in `scripts/isolation-probe-denominator.json` (copy the shape of `record_native_receipt`'s entries; `class: write`, `expect_denial 403/42501`), and cases in `scripts/isolation-probe.sh` beside `record_native_receipt` (L292–295). Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/check-isolation-denominator.mjs'` and `node scripts/check-isolation-denominator.mjs --self-test`. (Do not run the 30-minute `check-isolation-denominator.test.mjs` locally — CI does.)

**Task 11 — Regenerate types.** `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts` (under the lock, local stack). Verify: the diff adds the table and the three RPCs only.

**Task 12 — FE repository (vitest first).** `pmo-portal/src/lib/db/revenueNative.ts`: add `NativeAllocationInput = { invoiceId: string; amount: number }`; `recordNativeOnAccountReceipt(input)` (mints and passes `p_receipt_id` once per form open), `applyNativeReceipt({ receiptId, allocations, requestId })`, `unapplyNativeAllocation(id)`; extend `NATIVE_REVENUE_REFUSALS` with `allocation-exceeds-unapplied, allocation-exceeds-balance, allocation-amount-invalid, allocation-duplicate-invoice, allocation-client-mismatch, allocation-currency-mismatch, allocation-already-reversed, receipt-not-applicable, request-id-reused`. `pmo-portal/src/lib/db/revenue.ts`: `IncomingPaymentRow` gains `allocations?: NativeAllocation[]` (embed `allocations:incoming_payment_allocations(id,sales_invoice_id,amount,cash_amount,withheld_amount,currency,reversed_at)` in `INCOMING_PAYMENT_SELECT`, live rows only mapped into the row); `listIncomingPayments({salesInvoiceId})` adds the allocation path next to the existing `sales_invoice_id` and `allocation_details` paths (`incoming_payment_allocations!inner` filter, or two reads merged — pick what PostgREST allows and note it in the test). Tests: `pmo-portal/src/lib/db/revenueNative.test.ts` (new RPCs: params, error → code by `details`, no id ⇒ error), `revenue.lists.test.ts`. Verify: `(cd pmo-portal && scripts/with-test-lock.sh npx vitest run src/lib/db/revenueNative.test.ts src/lib/db/revenue.lists.test.ts)` — wrap per the Mac load rule (`../scripts/with-test-lock.sh`).

**Task 13 — FE pure logic (vitest first).** `pmo-portal/src/lib/revenue/receiptAllocation.ts`: `displayAllocations` native branch now reads `row.allocations` (live) → `ReceiptAllocation[]`; `[]` when none (on account); `knownUnappliedCash` for native = `amount − Σ allocations` (use integer cents, as the file does). Keep the ERP branch byte-identical. Tests in `receiptAllocation.test.ts`: native on-account ⇒ unapplied = amount; partial; fully applied ⇒ 0; ERP unchanged (`null`/`[]` semantics); rounding.

**Task 14 — FE drawer Apply flow (vitest first).** New `pmo-portal/pages/incoming-payments/ApplyReceiptForm.tsx` (uses `EntityFormModal`/`useEntityForm`, `Combobox` for invoices, `TextField` amounts, `FieldError`; strictly DESIGN.md tokens): rows of {invoice, amount}, "Fill balance" per row, a running "Left to apply" figure; candidate invoices = this receipt's customer, native, `Unpaid`, same currency, open balance `> 0` (from the already-loaded `useSalesInvoices`); Submit disabled while Σ > unapplied or any row > its balance or empty (UX only; server refuses regardless). `requestId` minted with `crypto.randomUUID()` when the form opens and reused on retry (`useCommandIntentMap` is the existing pattern in this page; follow it). Errors via `classifyMutationError(err, nativeRevenueHeadlines(t))` — extend `nativeRevenueHeadlines` with the new codes. `IncomingPayments.tsx` drawer: show **Apply to invoices** when `native && panelPayment.pmo_native && !panelPayment.cancelled_at && may('create','incomingPayment') && unapplied > 0`; each live allocation row gets **Unapply** (`may('create',…)`, `ConfirmDialog`). New mutation hooks beside `useRevenueMutations` (`applyReceipt`, `unapplyAllocation`) invalidate the receipts, invoices and finance-position query keys the cancel mutation already invalidates (copy that list). The record-receipt modal (`IncomingPaymentFormModal.tsx`) gains an **On account** mode when no invoice is chosen (customer required) → `recordNativeOnAccountReceipt`. **ERP orgs (`!native` or `!pmo_native`):** no Apply, no Unapply, no On-account mode; the "Invoices settled" list keeps showing `allocation_details` read-only, with one caption `finance:receivables.allocatedInErp` ("Allocated in your accounting system; read-only here."). Tests: `pages/__tests__/IncomingPayments.native.test.tsx` (extend), new `pages/incoming-payments/ApplyReceiptForm.test.tsx`, `pages/__tests__/IncomingPayments.fin5.test.tsx` (ERP: Apply absent, allocations rendered, caption). AC-NPA-010/011/012.

**Task 15 — Neighbour FE.** `SalesInvoices.tsx:191,604` (invoice → its receipts) also match `payment.allocations` live rows; invoice drawer shows the allocation amount, not the whole receipt amount, for a split receipt (`SalesInvoiceEvidence.tsx` — read it first). Run the sibling suites that mock these: `grep -l "listIncomingPayments\|useIncomingPayments\|displayAllocations\|revenueNative" pmo-portal/**/*.test.*` — at least `SalesInvoices.fin2.test.tsx`, `SalesInvoices.deepLink.test.tsx`, `ReceivablesPage.test.tsx`, `financePosition.test.ts`. Dashboard "collected" (`listPaidPaymentFacts`) is unchanged on purpose: on-account cash is cash.

**Task 16 — i18n.** Add keys to BOTH `pmo-portal/public/locales/en/finance.json` and `…/id/finance.json` (namespace `finance`, under `receipts.apply.*` and `receivables.*`): `apply.title, apply.action, apply.fillBalance, apply.leftToApply, apply.invoiceCol, apply.amountCol, apply.addInvoice, apply.noOpenInvoices, apply.submit, unapply.action, unapply.confirmTitle, unapply.confirmBody, onAccount.mode, onAccount.customer, allocatedInErp`, and one headline per new refusal code (`refusal.allocationExceedsUnapplied`, `…Balance`, `…ClientMismatch`, `…CurrencyMismatch`, `…AmountInvalid`, `…DuplicateInvoice`, `…AlreadyReversed`, `receiptNotApplicable`, `requestIdReused`). Indonesian copy written for a finance user, no jargon. Verify: the repo's locale-parity test (`npx vitest run` on the i18n parity file — find with `grep -rl "locales/id" pmo-portal/src --include=*.test.*`).

**Task 17 — E2E (one curated journey).** `pmo-portal/e2e/AC-NPA-001-apply-payment-to-invoices.spec.ts` (read `docs/e2e-parallel-conventions.md` first; tag `@e2e-isolation`; no `process.env.CI` gate): as Finance in a no-ERP org: approve two invoices for one client → record an on-account receipt → open its drawer → Apply across both (one in full, one partly) → assert the goal: invoices show Paid / reduced balance, receipt shows "Not yet applied" 0 / remainder, and Unapply restores one invoice. Also assert an over-allocation attempt is refused with the wording from i18n. Run: `scripts/e2e-local.sh AC-NPA-001`, then `node scripts/affected-e2e.mjs` for the UI touch (`--run`; it refuses >40 locally). Existing receipt/invoice specs that visit the changed drawer run through `affected-e2e`.

**Task 18 — Mutation checks (apply + restore INSIDE ONE lock hold; never release with a mutated DB).** For each, edit the migration function in a scratch copy applied via `psql` inside `with-db-lock.sh bash -c '… && supabase test db <file>; restore'`, expect RED, restore, expect GREEN. The pattern: `scripts/with-db-lock.sh bash -c 'supabase db reset && cp migration /tmp/m.orig && sed … && supabase db reset && supabase test db FILE; rc=$?; cp /tmp/m.orig migration; supabase db reset; exit $rc'` (no backticks in the shell string):
1. `apply_native_receipt`: drop the `Σ requested <= unapplied` check ⇒ `0731_…_apply` red (over-apply).
2. Drop the per-invoice `<= open balance` check ⇒ red.
3. Drop the org assertion on the receipt/invoice (cross-org id) ⇒ red.
4. Replace the role gate with `true` ⇒ PM/Exec/Engineer cases red.
5. Remove the `domain_externally_owned` refusal in `apply` and in `on_account` ⇒ ERP-org cases red.
6. Remove `for update` on invoices (prosrc test) ⇒ lock-order test red.
7. `native_invoice_settled` back to summing `incoming_payments.amount` ⇒ backfill/apply/readers tests red.
8. Remove the idempotency lookup ⇒ replay test red (double rows).
9. Remove `ipa_consistency`'s sum check ⇒ guards test red. Remove the currency check ⇒ red.
10. `cancel_native_receipt` forgets to reverse allocations ⇒ unapply_cancel test red.
11. Remove the remainder rule in the cash split ⇒ withholding-sum test red.
FE: set the `may()` gate to `true` ⇒ the role test in Task 14 red; remove the `native` condition ⇒ ERP test red.

**Task 19 — Local final gate (paste output bodies).** In `pmo-portal/`: `npm run check:guards`; `npm run typecheck` (under `../scripts/with-test-lock.sh`); `npx eslint --max-warnings=0 <touched files>`; the directly touched vitest files only (Tasks 12–16; never the full suite, never `--changed`); `node scripts/affected-e2e.mjs`; `../scripts/ux-proof.sh /incoming-payments` (and `/sales-invoices`); pgTAP touched/neighbour files from Task 9 under the lock. Then `git log --format=%B origin/dev..HEAD | grep -qi co-authored` finds nothing.

**Task 20 — Review and ship.** Reviews per CLAUDE.md step 5: spec-reviewer, code-quality-reviewer, **security-auditor on Opus** (brief it with: lock order, the generic not-found for cross-org ids, `ipa_consistency` as the second layer, the service-role path, replay semantics, ERP-take-over serialisation, the project-cash reader change; detail of any finding goes to `docs/private/reviews/`, not the repo). Ships alone: its own PR to `dev`, merge with a merge commit. No push to `main`/production.

## 5. Acceptance criteria (Given/When/Then; owning layer = the lowest sufficient one, ADR-0010)

| AC | Given / When / Then | Owner |
|---|---|---|
| AC-NPA-001 | Given an org with no ERP, When Finance records a receipt for a customer with no invoice, Then it exists with `sales_invoice_id` null, no allocation, and "Not yet applied" equals its amount. | pgTAP apply file |
| AC-NPA-002 | Given an on-account receipt of 100 and two Unpaid invoices of 60 and 100 for the same client, When Finance applies 60 and 40, Then invoice 1 is Paid, invoice 2 owes 60, the receipt has 0 left, and each balance is restated under lock. | pgTAP apply file; the user journey is also e2e (AC-NPA-001 spec) |
| AC-NPA-003 | Given a receipt with 100 unapplied, When anyone asks to apply more than 100 in total, or more than an invoice's open balance to it, Then the server refuses with the stable code and nothing changes; exactly equal succeeds. | pgTAP apply file |
| AC-NPA-004 | Given any of: another org's receipt/invoice, another client's invoice, another currency, a non-native/Draft/Paid/Cancelled invoice, a cancelled receipt, a PM/Executive/Engineer, an inactive member, an org whose ERP owns revenue, the feature off — When apply/on-account/unapply is called, Then it is refused and no row is written; cross-org ids are indistinguishable from missing ones. | pgTAP apply + acl |
| AC-NPA-005 | Given an apply that succeeded, When the same request id and payload is replayed, Then the same allocation ids return and balances do not move; a different payload under that id is refused. | pgTAP apply file |
| AC-NPA-006 | Given receipts recorded before this change (live, cancelled, over-paying), When the migration backfills allocations, Then every invoice's settled figure, outstanding, overpaid and status are exactly what they were. | pgTAP backfill file |
| AC-NPA-007 | Given an applied receipt, When one allocation is unapplied or the receipt is cancelled, Then only the affected invoices are restated (Paid reopens) and the unapplied amount returns; an invoice with live allocations cannot be cancelled. | pgTAP unapply_cancel file |
| AC-NPA-008 | Given a native receipt split across two projects' invoices, When project cash and invoice pairing read it, Then each project gets exactly its allocation's cash, on-account cash belongs to no project, and an invoice with a live allocation is not offered for pairing. | pgTAP readers file |
| AC-NPA-009 | Given the new table, Then RLS is forced, authenticated can only read their org's rows, anon nothing, no client can write directly, service_role keeps DML, and a direct over-allocation insert is refused by the table itself. | pgTAP schema + guards files |
| AC-NPA-010 | Given a no-ERP org and a Finance/Admin user viewing a native receipt with money left, When the drawer opens, Then Apply is offered; for other roles, a cancelled or fully-applied receipt it is not. | Vitest `IncomingPayments.native.test.tsx` |
| AC-NPA-011 | Given an org with an ERP, When the drawer opens, Then there is no Apply/Unapply/On-account, and the ERP's allocation rows show read-only with the caption. | Vitest `IncomingPayments.fin5.test.tsx` |
| AC-NPA-012 | Given a server refusal, When the form shows it, Then the headline is keyed on the stable detail code in the user's language, and the form keeps the user's entries. | Vitest `ApplyReceiptForm.test.tsx` |
| AC-NPA-013 | Given en and id locales, Then every new key exists in both. | existing i18n parity test |

Traceability: each `it(...)`/pgTAP description starts with its `AC-NPA-###`; the e2e file is `e2e/AC-NPA-001-apply-payment-to-invoices.spec.ts`.

## 6. Open questions

None blocking. Defaults taken (change on request): same-currency only (no FX); apply refuses over-allocation while the direct invoice-first receipt still allows overpay (DD-NAR-17 unchanged); on-account cash is not attributed to any project until applied; at most 50 invoices per apply; FE gate reuses `create incomingPayment`.
