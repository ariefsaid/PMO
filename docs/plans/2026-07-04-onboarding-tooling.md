# Implementation plan — Client onboarding tooling (GTM / MVP-viability program, item 6)

- **Date:** 2026-07-04
- **Issue:** PMO GTM item 6 — provisioning runbook + script (D1), import idempotency fix (D2),
  historical import script (D3).
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec (authoritative, SIGNED — review battery passed, NOT re-litigated):**
  `docs/specs/onboarding-tooling.spec.md` — FR-PROV-*, FR-IDEM-*, FR-HIST-*, NFR-ONB-*, AC-PROV/IDEM/HIST-*.
- **Controlling decisions (do not re-open):** OD-ONB-1 (`docs/decisions.md` — dual reference:
  `reference_number` for reconciliation, `import_key` for idempotency; no `external_ref` column
  invented); ADR-0047 (per-client Supabase Cloud Pro projects); ADR-0033/0035/0027 (procurement case
  folder, bulk-import, generic `ImportDescriptor`); ADR-0010 (test pyramid); ADR-0016/0017/0018/0019
  (authz/repository seam/soft-archive/SoD); OD-BUDGET-2 (committed-spend basis).
- **Reference precedents (patterns to copy, not reinvent):**
  `scripts/db-push-prod.sh` (typed-confirm + `op-get.sh` + `--check` read-only mode);
  `scripts/check-agent-prod-readiness.mjs` + `scripts/check-agent-prod-readiness.test.mjs`
  (pure-classification-helpers-are-unit-owned; probe/classify split; SKIPPED-not-FAILED);
  `pmo-portal/src/lib/import/procurementCycle/{types,group,validate,commit}.ts` (the pure
  parse/group/validate layer + the `commitCase`/`commitGroups` defect site);
  `pmo-portal/src/lib/db/{procurementCrud,procurementRecords,procurementLifecycle}.ts` (the
  security-definer RPC wrappers this plan extends).

## Numbering assumption (stated explicitly, per dispatch instruction)

- **Migrations.** Current top on this worktree: `supabase/migrations/0057_index_gap_hardening.sql`.
  The `ops-admin` plan (parallel worktree) has reserved **0058–0066**. The `obs-floor` plan
  (parallel worktree — its plan document was read and its stated reservation is in **plan-vs-plan
  agreement** with `ops-admin`'s own document, per Open Question 3) reserves **0067** only
  (`0067_error_events.sql`). **This plan therefore uses `0068` onward.**
- **pgTAP.** Current top on this worktree: `supabase/tests/0109_agent_dispatch_watermarks_denydefault.test.sql`.
  The `ops-admin` plan reserves **0110–0121**; the `obs-floor` plan reserves **0122** only
  (`0122_error_events_denydefault.test.sql`). **This plan therefore uses `0123` onward.**
- This plan needs exactly **one** migration (D2's provenance-columns migration, §Slice 2) and
  exactly **one** pgTAP file (the skip-query proof, §Slice 2) — no D1 or D3 migrations exist (D1 is
  an operator script with no schema change beyond what D2 ships; D3 depends on D2's columns and adds
  no schema of its own). Reserved: **migration `0068`**, **pgTAP `0123`**. If either upstream plan's
  final reservation differs by the time this ships, `0068`/`0123` are re-numbered mechanically (a
  filename rename + no content change) — flagged as a merge-order risk, not a design risk.

## Slice map (5 slices, each independently `npm run verify`-green; land in this order)

| # | Slice | Deliverable | DB stack touch? | ACs owned |
|---|---|---|---|---|
| **1** | Import idempotency — migration + commit-layer skip logic + unit tests | D2 (part 1) | **YES — SERIALIZE** (migration + pgTAP) | AC-IDEM-001..007 (skip logic, provenance stamp, pgTAP proof, regression) |
| **2** | Import idempotency — dry-run conflict report in preview | D2 (part 2) | no (pure fn, mocked) | AC-IDEM-005 |
| **3** | Historical-import transform library + CSV contracts + unit tests | D3 (part 1) | no (pure fns + fixtures) | AC-HIST-001, 002, 007, 008, 009 |
| **4** | Historical-import loader script + dry-run + verification queries | D3 (part 2) | **YES — SERIALIZE** (live load against local stack) | AC-HIST-003, 004, 004a, 005, 006, 010 |
| **5** | Provisioning script + readiness checklist + runbook docs | D1 | no (script logic unit-tested; live run is documented manual, not CI) | AC-PROV-001..007 |

**Rationale for this order (per dispatch instruction "(1) idempotency fix, (2) historical-import
library, (3) loader script, (4) provision-client.sh, (5) runbook"):** D2's migration must land before
D3 can run (FR-ONB spec's own build-order note: "D2 → D3; D1 is independent"), so Slices 1–2 (D2)
precede Slices 3–4 (D3). D1 (Slice 5) has no dependency on D2/D3 and is placed last only because it
is the least schema-invasive and the dispatch's sensible-order lists it last; it could equally land
first or in parallel — flagged here, not a hard constraint.

**Serialize rule (binding, `docs/environments.md`):** Slices 1 and 4 each require
`supabase db reset && supabase test db` (Slice 1) / a live loader dry-run against the local stack
(Slice 4) against the **one shared local Docker stack**. They must not run concurrently with any
other worktree's DB-driving work. Slices 2, 3, 5 are FE/logic/script-unit-only (mocked, no stack) and
may proceed without serialization.

---

## 0. Design decisions (binding for this plan — read before the tasks)

### D-ONB-1 — Idempotency columns land via RPC-signature extension, not a follow-up UPDATE

The 7 procurement record tables' `create_*` RPCs (migration 0037) are `security definer` with fixed
positional signatures (e.g. `create_purchase_request(p_procurement_id uuid, p_reference_number text,
p_status text, p_date date, p_amount numeric)`). Two ways to stamp `import_key`/`import_batch_id`/
`imported_at` on a freshly-created row:

(a) **Extend each RPC with three new trailing optional params** (`p_import_key text default null,
p_import_batch_id uuid default null, p_imported_at timestamptz default null`), stamped inside the
same `insert` — atomic, one round-trip, and because Postgres identifies a function by its **exact**
parameter list, `create or replace function foo(uuid,text,text,date,numeric)` does NOT touch a
differently-arity `create or replace function foo(uuid,text,text,date,numeric,text,uuid,timestamptz)`
— **the old 5-arg signature must be explicitly `DROP FUNCTION`-ed** in the same migration, or both
overloads coexist and PostgREST's `.rpc()` call (which passes named params) will error
"could not choose the best candidate function" on ambiguous overload resolution. This plan **drops
the old signature and creates the new one** in the same migration (see Task 1.2).

(b) A follow-up client-side `UPDATE ... SET import_key = ...` after RPC creation — rejected: doubles
round-trips, needs its own RLS write policy for 8 tables (procurements + 7 record tables) scoped to
"only when the row was just created by the caller in the same request" (unenforceable statelessly),
and violates FR-IDEM-008 "no new write authority" more than option (a) does (a naked client UPDATE
capability on these columns is new write surface; an RPC-internal stamp is not, because the RPC
itself is the sole writer already).

**Decision: (a).** Every `create_*` RPC (7 record RPCs + `createProcurement`'s underlying `.insert()`
— which is a plain REST insert, not an RPC, so it takes the three columns as ordinary insert fields,
no RPC signature change needed there) gains the three trailing nullable params. `createProcurement`
(REST insert via `procurementCrud.ts`) needs no RPC change — it already inserts via `.from().insert()`,
so `import_key`/`import_batch_id`/`imported_at` are just three more insert-payload fields, gated only
by the additive nullable columns + existing RLS (no policy change: the existing `procurements_insert`
policy already allows any column the requester role may write; these three are new, previously
non-existent columns with no restrictive column-grant carved out against them, so they're writable by
the same actors who could insert the row at all — consistent with FR-IDEM-008).

### D-ONB-2 — `commit.ts`'s existing tests get intentional churn, not accidental regression

`commit.test.ts` currently asserts exact positional call signatures via `toHaveBeenCalledWith` at
exactly **3 call sites** — line 84 (`createInvoice`), line 93 (`createPayment`), and line 132
(`createPayment` again, the no-VI-in-group case) — e.g. `expect(createInvoice).toHaveBeenCalledWith(
'proc-1', 'Received', '2025-01-15', 'EXT-001', 5000)`. No other `toHaveBeenCalledWith` assertion in
this file exists today (confirmed by reading the file: `createPurchaseRequest`/`createRfq`/
`createPurchaseOrder`/`createQuotation`/`createReceipt` are exercised in this file but not asserted
via exact positional `toHaveBeenCalledWith`). Adding `import_key`/`import_batch_id`/`imported_at` as
new trailing args to every `createRecord`/`createProcurement` call **necessarily changes these 3 call
signatures** — the existing assertions in `commit.test.ts` are updated in Task 1.4 as part of this
slice (NOT left red, NOT "similar to existing" hand-waved). This is intentional, contained churn —
exactly 3 assertions in the one test file that directly exercises the changed contract; it is not the
cross-component regression NFR-ONB-004/AC-IDEM-007 guards against (that regression gate is the
**full** `npm run
verify`, asserting no *other*, unrelated test breaks).

### D-ONB-3 — Skip-decision is a pure, injectable existence-check, not inlined SQL string-building

`commit.ts` needs a read-only "does a row already exist for (scope, import_key[, import_batch_id])"
check before each insert. This is modeled as a small injected async lookup (mirrors the existing
`RefLookup` injection pattern for `projectLookup`/`vendorLookup`) so `commit.test.ts` can mock it
without a live DB, and the live implementation is a thin Supabase `.select()` call living in
`src/lib/db/procurementImportSkip.ts` (new file — a repository-seam-style read helper, ADR-0017
compliant: REST read, no RPC needed for a read-only existence probe per OD-ARCH-1).

### D-ONB-4 — Dry-run conflict report reuses `validateGroups`'s output shape, doesn't re-derive it

`buildDryRunConflictReport` (Slice 2) takes the **already-computed** `ValidatedGroup[]` (from the
existing preview step) plus the same skip-lookup contract from D-ONB-3, and produces a per-group
`{ wouldCreate, wouldSkip, wouldCollide }` tally by calling the lookup once per case + once per valid
record row — zero writes, reusing the exact existence-check contract Slice 1 defines, so the same
live implementation backs both the commit-time skip and the preview-time dry-run count (one lookup
implementation, two call sites — no logic duplication).

### D-ONB-5 — Historical-import script commit path is a NEW module, not a `commit.ts` fork

`scripts/import-historical.mjs` reuses `procurementCycle`'s `group`/`validate`/`types` **pure** layer
(FR-HIST-008) by importing them directly (they have zero DOM/React/Supabase-client dependencies —
confirmed: `types.ts`/`group.ts`/`validate.ts` import only from `./types` and `refLookup`, no
`@/src/lib/supabase/client`). The script's own commit logic (service-role direct INSERT, status-set-
directly, no RPC calls) lives in `scripts/lib/historicalImportCommit.mjs` — a **separate** module from
`commit.ts`, because the two have incompatible authority models (RPC-mediated vs service-role-direct)
and forcing one shared commit function would require a runtime branch inside the audited RPC path,
risking exactly the kind of "similar to Task N" conflation this plan forbids. The **parse/group/
validate** layer is shared; the **commit** layer is deliberately forked into two strategies, exactly
as the spec's "Shape" section describes ("one validated parse/validate layer and two commit
strategies").

### D-ONB-6 — Provisioning + readiness scripts follow `db-push-prod.sh` / `check-agent-prod-readiness.mjs` byte-for-byte in structure

`scripts/provision-client.sh` mirrors `db-push-prod.sh`'s exact shape: `set -euo pipefail`, PATH libpq
defense, `. supabase/op.<slug>.env` coordinate sourcing, `op-get.sh` primary + gitignored-file
fallback, `--check` as a fully separate zero-side-effect early-return branch, typed-confirm gate
before any state change. `scripts/check-client-readiness.mjs` mirrors
`check-agent-prod-readiness.mjs`'s exact shape: pure exported classification helpers
(`classifyEnvSecrets`, `classifyProbeResult` are **imported and reused directly**, not
reimplemented — `check-client-readiness.mjs` adds only the **new** classifiers it needs:
`classifyMigrationCount`, `classifyOrgAdminExistence`, `classifyAnonReadSanity`), SKIPPED-not-FAILED
semantics, `--live`-gated synthetic steps where relevant, presence-only secret reporting.

---

## Slice 1 — Import idempotency: migration + commit-layer skip (D2 part 1)

**AC coverage:** AC-IDEM-001, AC-IDEM-002, AC-IDEM-003 (Unit half), AC-IDEM-004, AC-IDEM-004a,
AC-IDEM-006, AC-IDEM-007. Also proves (unnumbered, non-AC regression guard, fix-round finding #2):
`capture_vendor_invoice` (0056) keeps resolving through the extended `create_procurement_invoice`
after 0068.

### Task 1.1 — Failing pgTAP test first: skip-query proof (AC-IDEM-006)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/supabase/tests/0123_import_provenance_skip_query.test.sql`:

```sql
-- 0123_import_provenance_skip_query.test.sql — provenance columns + skip-query proof.
-- Migration under test: 0068_import_provenance.sql
--
-- AC-IDEM-001  import_batch_id/imported_at stamped and non-NULL when supplied
-- AC-IDEM-006  skip-query returns the existing row for (org_id, import_key, batch); nothing for a new key
-- AC-IDEM-007  existing rows have NULL import_batch_id/imported_at/import_key (migration is additive)
-- (unnumbered)  capture_vendor_invoice (0056) still resolves + succeeds post-0068 — proves the
--               5-positional-arg call site into the now-8-param create_procurement_invoice keeps
--               working via the 3 new trailing params' defaults (fix-round finding #2).
begin;
select plan(7);

insert into organizations (id, name) values
  ('01230000-0000-0000-0000-000000000001', 'Idem Org A');
insert into auth.users (id, email) values
  ('01230000-0000-0000-0000-0000000000a1', 'pm-idem@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01230000-0000-0000-0000-0000000000a1','01230000-0000-0000-0000-000000000001',
   'PM Idem','pm-idem@example.com','Project Manager');

-- Pre-existing (pre-migration-shaped) row: no provenance columns supplied.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('01230000-0000-0000-0000-000000000010','01230000-0000-0000-0000-000000000001',
   'Legacy Case (no import)','Draft','01230000-0000-0000-0000-0000000000a1');

-- AC-IDEM-007: pre-existing row has NULL provenance columns.
select is(
  (select import_batch_id from procurements where id = '01230000-0000-0000-0000-000000000010'),
  null,
  'AC-IDEM-007: pre-existing procurement row has NULL import_batch_id (additive migration)');
select is(
  (select import_key from procurements where id = '01230000-0000-0000-0000-000000000010'),
  null,
  'AC-IDEM-007: pre-existing procurement row has NULL import_key (additive migration)');

-- Imported row: provenance columns supplied directly (as the commit-layer / historical script would).
insert into procurements
  (id, org_id, title, status, requested_by_id, import_key, import_batch_id, imported_at)
values
  ('01230000-0000-0000-0000-000000000011','01230000-0000-0000-0000-000000000001',
   'Imported Case','Draft','01230000-0000-0000-0000-0000000000a1',
   'CASE-REF-001','01230000-0000-0000-0000-00000000ba01', now());

-- AC-IDEM-001: stamped and non-NULL.
select isnt(
  (select import_batch_id from procurements where id = '01230000-0000-0000-0000-000000000011'),
  null,
  'AC-IDEM-001: import_batch_id is stamped and non-NULL on an imported row');
select isnt(
  (select imported_at from procurements where id = '01230000-0000-0000-0000-000000000011'),
  null,
  'AC-IDEM-001: imported_at is stamped and non-NULL on an imported row');

-- AC-IDEM-006: the skip-query (org_id, import_key, import_batch_id) returns the existing row.
select is(
  (select id from procurements
     where org_id = '01230000-0000-0000-0000-000000000001'
       and import_key = 'CASE-REF-001'
       and import_batch_id = '01230000-0000-0000-0000-00000000ba01')::text,
  '01230000-0000-0000-0000-000000000011',
  'AC-IDEM-006: skip-query returns the existing row for (org_id, import_key, batch)');

-- AC-IDEM-006: the same query for a genuinely-new key returns nothing.
select is(
  (select count(*) from procurements
     where org_id = '01230000-0000-0000-0000-000000000001'
       and import_key = 'CASE-REF-999'
       and import_batch_id = '01230000-0000-0000-0000-00000000ba01'),
  0::bigint,
  'AC-IDEM-006: skip-query returns nothing for a genuinely-new import_key');

-- (unnumbered, fix-round finding #2): capture_vendor_invoice (0056) still resolves and succeeds
-- post-0068. Its call into create_procurement_invoice is 5 positional args; the 3 new trailing
-- provenance params must resolve from their defaults for this to keep working.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('01230000-0000-0000-0000-000000000012','01230000-0000-0000-0000-000000000001',
   'Cap-VI Case','Received','01230000-0000-0000-0000-0000000000a1');

select is(
  (select status from capture_vendor_invoice(
    '01230000-0000-0000-0000-000000000012'::uuid, 'Received'::procurement_invoice_status,
    '2026-07-04'::date, 'VI-TEST-001', 1234.56, null))::text,
  'Received',
  'capture_vendor_invoice still succeeds post-0068 (5-positional-arg call site into the extended create_procurement_invoice)');

reset role;

select * from finish();
rollback;
```

**Verify (expect FAIL — table has no `import_key`/`import_batch_id`/`imported_at` columns yet):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && supabase db reset && supabase test db
```

### Task 1.2-pre — MANDATORY BLOCKING precondition: dump the live RPC bodies before writing anything

**This task gates Task 1.2. Do not write a single line of Task 1.2's SQL before this command has
been run against the local stack and its output has been read.** The three prior planning passes
that reconstructed these bodies from TypeScript call sites got them wrong in three ways (see the
review finding this fix round resolves) — the RPC bodies are NOT to be retyped from memory,
call-site inference, or an earlier migration read in isolation. They are copied byte-for-byte from
`pg_get_functiondef` against the CURRENT (post-0057) local stack, then only the three trailing
params + insert columns are appended.

```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && supabase db reset && psql "$(supabase status -o json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).DB_URL))')" -c "
select pg_get_functiondef(oid) from pg_proc
where proname in (
  'create_purchase_request', 'create_rfq', 'create_purchase_order', 'create_payment',
  'create_procurement_quotation', 'create_procurement_receipt', 'create_procurement_invoice'
) order by proname;
"
```

**Expected findings (confirmed during this fix round by reading the migrations directly — the dump
above is the mandatory live cross-check, not a substitute for having read them):**

- `create_payment`'s live body is **0039's** (`same_case_fk_invariant`), NOT 0037's — it contains the
  `p_invoice_id is not null and not exists (select 1 from procurement_invoices i where i.id =
  p_invoice_id and i.procurement_id = p_procurement_id)` same-case guard, raising `42501` ("invoice
  not in this case"). A regenerated body that reverts to the pre-0039 (0037) body silently
  reintroduces the cross-case invoice-linking hole 0039 closed.
- `create_procurement_receipt`'s live body is **0041's** extension of **0018's** tightened gate
  (`auth_role() = 'Admin' or auth_role() = 'Project Manager' or (auth.uid() is not null and
  auth.uid() = v_requester)`) — NOT 0037's/0006's wide 4-role gate
  (`auth_role() not in ('Admin','Executive','Project Manager','Finance')`). It also takes
  `p_status procurement_receipt_status` (enum, not text) and a fourth param
  `p_reference_number text default null` (0041), and inserts `reference_number` into the column
  list. A regenerated body using the wide 4-role gate or a `text` status param silently re-widens an
  authorization gate a prior security fix tightened.
- `create_procurement_invoice`'s live body is **0041's** extension of 0006's body — 4-role gate
  preserved (correct, unlike the receipt RPC), but `p_status procurement_invoice_status` (enum, not
  text) and two extra params `p_reference_number text default null, p_amount numeric default null`,
  inserting `reference_number, amount`.
- `create_procurement_quotation` was **never modified past 0006** — its live body is 0006's
  4-role-gated `(uuid, uuid, numeric, date)` signature, unchanged.
- **`p_status` on `create_procurement_receipt`/`create_procurement_invoice` is enum-typed**
  (`procurement_receipt_status` / `procurement_invoice_status`, defined in 0006), not `text`. Every
  `DROP FUNCTION` signature for these two RPCs (both the old-arity drop already in the tree from
  0041, and any restated in 0068) MUST use the enum type, not `text` — a `text`-typed `DROP FUNCTION`
  does not match the live enum-typed overload, silently no-ops, and leaves the old signature
  orphaned. PostgREST's `.rpc()` then fails "could not choose the best candidate function" on the
  ambiguous two-overload state — exactly the failure mode D-ONB-1(a) warns about, except caused by a
  wrong `DROP` signature rather than a missing one.

**Verify (this command's output — not a paraphrase of it — is what Task 1.2's bodies are transcribed
from):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && supabase db reset && psql "$(supabase status -o json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).DB_URL))')" -c "select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname like 'create_%' or proname = 'capture_vendor_invoice' order by proname;"
```
Confirm the printed signatures for `create_procurement_receipt`/`create_procurement_invoice` show
the enum types (`procurement_receipt_status` / `procurement_invoice_status`), not `text`, before
proceeding to Task 1.2.

### Task 1.2 — Migration `supabase/migrations/0068_import_provenance.sql`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/supabase/migrations/0068_import_provenance.sql`:

```sql
-- 0068_import_provenance.sql — additive provenance + idempotency columns for the bulk-import
-- paths (Deliverable 2: procurement-cycle import idempotency fix; Deliverable 3: historical
-- import script re-run-safety). One column set serves both deliverables (spec §"Fix").
--
-- Adds, on `procurements` + the 7 procurement record tables (purchase_requests, rfqs,
-- procurement_quotations, purchase_orders, procurement_receipts, procurement_invoices, payments):
--   import_batch_id uuid       — one UUID per import run; NULL for non-imported rows.
--   imported_at     timestamptz — the import moment; NULL for non-imported rows.
--   import_key      text        — stable per-row dedupe key; NULL = legacy create-only (opt-in).
--
-- NO policy changes. NO new write authority (FR-IDEM-008) — these are three additional nullable
-- columns writable by whichever actor could already write the row (the existing insert policies
-- carve out no restrictive column grants against them). Fully backward-compatible: every existing
-- row gets NULL in all three (AC-IDEM-007); every existing form/RPC/Assistant write path is
-- unaffected because it simply never supplies these columns.
--
-- Rollback: supabase db reset (pre-production, ADR-0006) — the reversible-migrations contract for
-- this repo's phase. A hand-written down-migration is:
--   alter table procurements drop column import_batch_id, drop column imported_at, drop column import_key;
--   alter table purchase_requests drop column import_batch_id, drop column imported_at, drop column import_key;
--   -- (repeat for rfqs, procurement_quotations, purchase_orders, procurement_receipts,
--   --  procurement_invoices, payments)

alter table procurements
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table purchase_requests
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table rfqs
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table procurement_quotations
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table purchase_orders
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table procurement_receipts
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table procurement_invoices
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table payments
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

-- Index the (org_id, import_key, import_batch_id) skip-query shape on the case header (highest-
-- traffic dedupe check: one per case, run before every case-header insert).
create index procurements_import_key_batch_idx
  on procurements (org_id, import_key, import_batch_id)
  where import_key is not null;

-- Index the (procurement_id, import_key, import_batch_id) skip-query shape on each record table
-- (one per child row, run before every record insert).
create index purchase_requests_import_key_batch_idx
  on purchase_requests (procurement_id, import_key, import_batch_id) where import_key is not null;
create index rfqs_import_key_batch_idx
  on rfqs (procurement_id, import_key, import_batch_id) where import_key is not null;
create index procurement_quotations_import_key_batch_idx
  on procurement_quotations (procurement_id, import_key, import_batch_id) where import_key is not null;
create index purchase_orders_import_key_batch_idx
  on purchase_orders (procurement_id, import_key, import_batch_id) where import_key is not null;
create index procurement_receipts_import_key_batch_idx
  on procurement_receipts (procurement_id, import_key, import_batch_id) where import_key is not null;
create index procurement_invoices_import_key_batch_idx
  on procurement_invoices (procurement_id, import_key, import_batch_id) where import_key is not null;
create index payments_import_key_batch_idx
  on payments (procurement_id, import_key, import_batch_id) where import_key is not null;

-- ============================================================================
-- RPC signature extension (D-ONB-1): each create_* RPC gains three trailing nullable
-- params (p_import_key text, p_import_batch_id uuid, p_imported_at timestamptz), stamped
-- into the same insert. Postgres identifies functions by exact arg list, so the OLD
-- signature is explicitly dropped (with its EXACT current arg types — see Task 1.2-pre)
-- before the new one is created — otherwise both overloads coexist and PostgREST's
-- named-param .rpc() call errors "could not choose the best candidate function" on
-- ambiguous resolution. A DROP with the WRONG arg types (e.g. text instead of the real
-- enum) silently no-ops (`if exists`) and leaves the old signature orphaned — this is
-- exactly the bug this fix round corrects; every DROP below uses the type Task 1.2-pre's
-- pg_get_functiondef dump confirmed live.
-- SECURITY: every parent-org guard + role gate below is BYTE-PRESERVED from its current
-- live body (0037/0039 for create_payment; 0018+0041 for create_procurement_receipt; 0006+0041
-- for create_procurement_invoice; 0006 for create_procurement_quotation) — removing or
-- widening any of them bypasses RLS or reverts a prior security fix. This migration touches
-- ONLY the insert's column list + the three appended trailing params.
-- ============================================================================

-- create_purchase_request — body unchanged since 0037 (4-role gate). Byte-preserved.
drop function if exists create_purchase_request(uuid, text, text, date, numeric);
create or replace function create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_rfq — body unchanged since 0037 (4-role gate). Byte-preserved.
drop function if exists create_rfq(uuid, text, text, date, numeric);
create or replace function create_rfq(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns rfqs language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.rfqs;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.rfqs
    (procurement_id, rfq_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'RFQ'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_rfq(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_rfq(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_rfq(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_purchase_order — body unchanged since 0037 (4-role gate). Byte-preserved.
drop function if exists create_purchase_order(uuid, text, text, date, numeric);
create or replace function create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_payment — body is 0039's (same_case_fk_invariant), NOT 0037's. The 0039 guard
-- (p_invoice_id must belong to the SAME procurement case, else 42501 "invoice not in this
-- case") MUST be preserved byte-for-byte — dropping back to the pre-0039 body reopens the
-- cross-case invoice-linking hole 0039 closed.
drop function if exists create_payment(uuid, uuid, text, text, date, numeric);
create or replace function create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant (0039, AC-PR-SEC-001): invoice must belong to the same procurement
  -- case. 42501 is used (uniform, does not leak existence like 23503 would). MUST stay.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_payment(uuid, uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_payment(uuid, uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_payment(uuid, uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_procurement_quotation — never modified past 0006; body + 4-role gate unchanged.
-- Signature stays (uuid, uuid, numeric, date, ...) — NOT enum-typed (no status param at all).
drop function if exists create_procurement_quotation(uuid, uuid, numeric, date);
create or replace function create_procurement_quotation(
  p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_quotations language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_quotations;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_quotations
    (procurement_id, vendor_id, total_amount, received_date, vq_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
            next_procurement_doc_number(v_org, 'VQ'),
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_quotation(uuid, uuid, numeric, date, text, uuid, timestamptz) from public;
grant  execute on function create_procurement_quotation(uuid, uuid, numeric, date, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_procurement_quotation(uuid, uuid, numeric, date, text, uuid, timestamptz) from anon;

-- create_procurement_receipt — body is 0041's extension of 0018's TIGHTENED gate:
-- Admin OR Project Manager OR the original requester (NOT the old wide 4-role gate from
-- 0037/0006 — 0018 deliberately narrowed this; reverting to the wide gate re-opens the
-- over-grant 0018 closed). p_status is the ENUM procurement_receipt_status, not text — the
-- DROP FUNCTION below matches this exactly (a text-typed DROP would silently no-op, per
-- Task 1.2-pre). Includes 0041's p_reference_number param + reference_number column.
drop function if exists create_procurement_receipt(uuid, procurement_receipt_status, date, text);
create or replace function create_procurement_receipt(
  p_procurement_id uuid, p_status procurement_receipt_status, p_receipt_date date, p_reference_number text default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_receipts language plpgsql security definer set search_path = public as $$
declare
  v_org       uuid;
  v_requester uuid;
  v_row       public.procurement_receipts;
begin
  select org_id, requested_by_id into v_org, v_requester
    from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  -- Tenant isolation + role/requester gate (0018/0041, mirrors Ordered→Received in
  -- transition_procurement): Admin (break-glass) OR Project Manager OR the original requester.
  -- SECURITY: both checks MUST stay — removing either leaks cross-org or over-permissive GR creation.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (auth_role() = 'Admin'
          or auth_role() = 'Project Manager'
          or (auth.uid() is not null and auth.uid() = v_requester))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.procurement_receipts
    (procurement_id, status, receipt_date, gr_number, reference_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_receipt_date,
            next_procurement_doc_number(v_org, 'GR'), p_reference_number,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_receipt(uuid, procurement_receipt_status, date, text, text, uuid, timestamptz) from public;
grant  execute on function create_procurement_receipt(uuid, procurement_receipt_status, date, text, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_procurement_receipt(uuid, procurement_receipt_status, date, text, text, uuid, timestamptz) from anon;

-- create_procurement_invoice — body is 0041's extension of 0006's body; 4-role gate
-- preserved (correct — 0018 did NOT touch this RPC's gate, only the receipt RPC's). p_status
-- is the ENUM procurement_invoice_status, not text. Includes 0041's p_reference_number +
-- p_amount params + reference_number/amount columns. capture_vendor_invoice (0056) calls
-- this positionally with exactly these 5 leading args — see Task 1.2's Slice-1 dependency
-- assertion below; the 3 new trailing params MUST stay optional-with-default so that call
-- keeps resolving unchanged.
drop function if exists create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric);
create or replace function create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date, p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz) from anon;
```

> **Implementer note:** every body above was transcribed from Task 1.2-pre's live
> `pg_get_functiondef` dump (cross-checked against `supabase/migrations/0037_procurement_record_rpcs.sql`,
> `0039_same_case_fk_invariant.sql`, `0018_authz_hardening.sql`, `0041_gr_vi_rpc_reference_amount.sql`,
> `0006_procurement_lifecycle.sql`) and differs from the live body **only** in: the three appended
> trailing params, the three appended insert columns, and the corresponding `DROP`/`REVOKE`/`GRANT`
> signatures. If Task 1.2-pre's dump disagrees with any body above in any other respect, the dump wins
> — update this migration to match it exactly before proceeding.
>
> **Slice-1 dependency assertion (finding #2 of this fix round — MANDATORY, do not skip):**
> `capture_vendor_invoice` (migration `0056_capture_vendor_invoice.sql`) calls
> `create_procurement_invoice(p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount)`
> with exactly 5 positional arguments. Because this migration's extended `create_procurement_invoice`
> keeps those same 5 leading params in the same order/types and appends only 3 new trailing params
> **with defaults**, that positional call continues to resolve to the extended function unchanged
> (Postgres fills `p_import_key`/`p_import_batch_id`/`p_imported_at` from their defaults). Add a pgTAP
> assertion to `supabase/tests/0123_import_provenance_skip_query.test.sql` (or a small dedicated
> `supabase/tests/0123b_capture_vendor_invoice_post_0068.test.sql` if keeping 0123 single-purpose is
> preferred) that calls `capture_vendor_invoice(...)` end-to-end post-0068 and asserts it still returns
> a `procurement_invoices` row with the expected `status`/`reference_number`/`amount` — this is the
> proof, not an inference from reading the two migrations side by side.

**Verify (Task 1.1's test should now pass):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && supabase db reset && supabase test db
```

### Task 1.3 — Skip-lookup contract: `src/lib/db/procurementImportSkip.ts`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/db/procurementImportSkip.ts`:

```typescript
import { supabase } from '@/src/lib/supabase/client';

/**
 * Read-only existence probe for the import-idempotency skip decision (Deliverable 2, ADR-0027).
 * REST reads only (OD-ARCH-1) — no RPC needed for a read-only existence check. org_id is NEVER
 * client-supplied as a filter authority substitute; RLS still scopes every read to the caller's org,
 * this is an additional application-level filter for the specific (org, key) tuple being checked.
 */

export interface ImportSkipLookup {
  /** Looks up an existing procurement (case header) by (org_id, import_key, import_batch_id). */
  findExistingCase(orgId: string, importKey: string, importBatchId: string): Promise<{ id: string } | null>;
  /** Looks up an existing record row in `table` by (procurement_id, import_key, import_batch_id). */
  findExistingRecord(
    table: RecordTableName,
    procurementId: string,
    importKey: string,
    importBatchId: string,
  ): Promise<{ id: string } | null>;
  /** Looks up ANY existing row (case or record) matching (scope key, import_key) regardless of
   *  batch — used for the cross-batch-collision report (FR-IDEM-006, would-collide). */
  findCrossBatchCollision(
    table: RecordTableName | 'procurements',
    scopeColumn: 'org_id' | 'procurement_id',
    scopeValue: string,
    importKey: string,
    excludeBatchId: string,
  ): Promise<{ id: string; import_batch_id: string } | null>;
}

export type RecordTableName =
  | 'purchase_requests' | 'rfqs' | 'procurement_quotations' | 'purchase_orders'
  | 'procurement_receipts' | 'procurement_invoices' | 'payments';

export const supabaseImportSkipLookup: ImportSkipLookup = {
  async findExistingCase(orgId, importKey, importBatchId) {
    const { data } = await supabase
      .from('procurements')
      .select('id')
      .eq('org_id', orgId)
      .eq('import_key', importKey)
      .eq('import_batch_id', importBatchId)
      .maybeSingle();
    return data ?? null;
  },

  async findExistingRecord(table, procurementId, importKey, importBatchId) {
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('procurement_id', procurementId)
      .eq('import_key', importKey)
      .eq('import_batch_id', importBatchId)
      .maybeSingle();
    return data ?? null;
  },

  async findCrossBatchCollision(table, scopeColumn, scopeValue, importKey, excludeBatchId) {
    const { data } = await supabase
      .from(table)
      .select('id, import_batch_id')
      .eq(scopeColumn, scopeValue)
      .eq('import_key', importKey)
      .neq('import_batch_id', excludeBatchId)
      .not('import_batch_id', 'is', null)
      .limit(1)
      .maybeSingle();
    return data ?? null;
  },
};
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx tsc --noEmit -p .
```

### Task 1.4 — Failing unit tests first: `computeImportKey` + skip-decision in `commit.test.ts`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/__tests__/importKey.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeCaseImportKey, computeRecordImportKey } from '../importKey';
import type { CaseGroup, CycleRow } from '../types';

describe('computeCaseImportKey — FR-IDEM-002 (per-case stable key)', () => {
  it('derives the key from caseRef when present (AC: caseRef is the stable grouping key)', () => {
    const group: CaseGroup = {
      caseRef: 'CASE-001',
      attrs: { title: 'Solar Modules', project: 'Meridian', caseStatus: undefined },
      rows: [],
      errors: [],
    };
    expect(computeCaseImportKey(group)).toBe('CASE-001');
  });
});

describe('computeRecordImportKey — FR-IDEM-002 (per-record stable key, reference_number-first)', () => {
  const baseRow: CycleRow = {
    caseRef: 'CASE-001', type: 'PO', project: undefined, title: undefined, caseStatus: undefined,
    vendor: undefined, externalRef: undefined, status: undefined, date: undefined, amount: undefined,
    rowNumber: 1,
  };

  it('uses externalRef (reference_number) as the key when present', () => {
    const row: CycleRow = { ...baseRow, externalRef: 'PO-VENDOR-4471' };
    expect(computeRecordImportKey(row)).toBe('PO-VENDOR-4471');
  });

  it('falls back to a deterministic content fingerprint of type+date+amount+vendor when externalRef is absent', () => {
    const row: CycleRow = {
      ...baseRow, externalRef: undefined, date: '2025-06-01', amount: '1500', vendor: 'Acme',
    };
    const key = computeRecordImportKey(row);
    expect(key).toBe(computeRecordImportKey({ ...row })); // deterministic — same input, same key
    expect(key).not.toBe(computeRecordImportKey({ ...row, amount: '1600' })); // sensitive to amount
  });
});
```

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/importKey.ts`:

```typescript
/**
 * FR-IDEM-002 — stable per-row import-key derivation (Deliverable 2, ADR-0027/0035).
 * Pure, synchronous, deterministic. Case key = case_ref (already the stable grouping key
 * per group.ts). Record key = reference_number (externalRef) when present, else a
 * deterministic fingerprint of type+date+amount+vendor (OD-ONB-1: reference_number is the
 * PREFERRED stable source; the fingerprint is the documented fallback, never persisted as a
 * reference_number itself).
 */
import type { CaseGroup, CycleRow } from './types';

export function computeCaseImportKey(group: CaseGroup): string {
  return group.caseRef;
}

export function computeRecordImportKey(row: CycleRow): string {
  if (row.externalRef?.trim()) return row.externalRef.trim();
  const parts = [row.type, row.date ?? '', row.amount ?? '', row.vendor ?? ''];
  return `fp:${parts.join('|')}`;
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx vitest run src/lib/import/procurementCycle/__tests__/importKey.test.ts
```

### Task 1.5 — Failing unit tests: `commit.ts` skip semantics (AC-IDEM-002, 003, 004, 004a)

Add to `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/__tests__/commit.test.ts`
(append after the existing describe blocks — do not delete Task 1.6's updated blocks yet, that's the
next task):

```typescript
import { computeCaseImportKey, computeRecordImportKey } from '../importKey';
import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';

const BATCH_ID = 'batch-aaa';

function makeStubSkipLookup(overrides: Partial<ImportSkipLookup> = {}): ImportSkipLookup {
  return {
    findExistingCase: vi.fn().mockResolvedValue(null),
    findExistingRecord: vi.fn().mockResolvedValue(null),
    findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('commitGroups — AC-IDEM-002: case-level skip within the same batch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips the header insert when an existing case matches (org_id, import_key, batch) and does not call createProcurement', async () => {
    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing-proc-1' }),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: { caseRef: 'CASE-DUP', attrs: { title: 'Dup Case', project: undefined, caseStatus: undefined }, rows: [], errors: [] },
      rows: [],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(createProcurement).not.toHaveBeenCalled();
    expect(result.cases[0].headerStatus).toBe('skipped');
    expect(result.cases[0].procurementId).toBe('existing-proc-1');
  });
});

describe('commitGroups — AC-IDEM-004a: header skip does NOT skip its still-missing children', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-runs a case whose header + 2 of 5 records already exist: skips header + those 2, creates the remaining 3', async () => {
    vi.mocked(createPurchaseOrder).mockResolvedValue({ id: 'po-new' } as never);
    vi.mocked(createInvoice).mockResolvedValue({ id: 'vi-new' } as never);
    vi.mocked(createPayment).mockResolvedValue({ id: 'pay-new' } as never);

    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing-proc-2' }),
      findExistingRecord: vi.fn().mockImplementation(async (table: string) => {
        // PR and RFQ already succeeded on the crashed prior run; PO/VI/Payment did not.
        if (table === 'purchase_requests' || table === 'rfqs') return { id: 'already-there' };
        return null;
      }),
    });

    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-CRASH', attrs: { title: 'Crashed Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-CRASH', type: 'PR', title: 'Crashed Case', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PR-1', status: 'Approved', date: '2025-01-01', amount: '100', rowNumber: 1 },
          { caseRef: 'CASE-CRASH', type: 'RFQ', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'RFQ-1', status: null as unknown as string, date: null as unknown as string, amount: null as unknown as string, rowNumber: 2 },
          { caseRef: 'CASE-CRASH', type: 'PO', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PO-1', status: 'Ordered', date: '2025-02-01', amount: '900', rowNumber: 3 },
          { caseRef: 'CASE-CRASH', type: 'VI', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'VI-1', status: 'Received', date: '2025-03-01', amount: '900', rowNumber: 4 },
          { caseRef: 'CASE-CRASH', type: 'Payment', title: undefined, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PAY-1', status: 'Paid', date: '2025-04-01', amount: '900', rowNumber: 5 },
        ],
        errors: [],
      },
      rows: [1, 2, 3, 4, 5].map((n) => ({ rowNumber: n, valid: true, errors: [] })),
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.cases[0].headerStatus).toBe('skipped');
    const byType = Object.fromEntries(result.cases[0].records.map((r) => [r.type, r.status]));
    expect(byType.PR).toBe('skipped');
    expect(byType.RFQ).toBe('skipped');
    expect(byType.PO).toBe('created');
    expect(byType.VI).toBe('created');
    expect(byType.Payment).toBe('created');
    expect(createPurchaseRequest).not.toHaveBeenCalled(); // skipped, not re-created
    expect(createRfq).not.toHaveBeenCalled();
    expect(createPurchaseOrder).toHaveBeenCalled();
  });
});

describe('commitGroups — AC-IDEM-004: exact re-run of the same batch creates zero new rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports every case and record as skipped when everything already exists in this batch', async () => {
    const skipLookup = makeStubSkipLookup({
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing-proc-3' }),
      findExistingRecord: vi.fn().mockResolvedValue({ id: 'already-there' }),
    });
    const group: ValidatedGroup = {
      valid: true, groupErrors: [],
      group: {
        caseRef: 'CASE-REPEAT', attrs: { title: 'Repeat Case', project: undefined, caseStatus: undefined },
        rows: [
          { caseRef: 'CASE-REPEAT', type: 'PR', title: 'Repeat Case', project: undefined, caseStatus: undefined, vendor: undefined, externalRef: 'PR-R', status: 'Approved', date: '2025-01-01', amount: '100', rowNumber: 1 },
        ],
        errors: [],
      },
      rows: [{ rowNumber: 1, valid: true, errors: [] }],
    };

    const result = await commitGroups([group], {
      requestedById: REQUESTER, projectLookup, vendorLookup,
      importBatchId: BATCH_ID, skipLookup,
    });

    expect(result.created).toBe(0);
    expect(result.cases[0].headerStatus).toBe('skipped');
    expect(result.cases[0].records[0].status).toBe('skipped');
    expect(createPurchaseRequest).not.toHaveBeenCalled();
  });
});
```

**Verify (expect FAIL — `commitGroups`'s options type has no `importBatchId`/`skipLookup`, `headerStatus`/record `status` has no `'skipped'` member yet):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx vitest run src/lib/import/procurementCycle/__tests__/commit.test.ts
```

### Task 1.6 — Implement: extend `types.ts` result shapes with `'skipped'`

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/types.ts`:

Change:
```typescript
export interface CommitRecordResult {
  rowNumber: number;
  type: string;
  /** Created record id, if successful. */
  id?: string;
  status: 'created' | 'failed';
  error?: string;
}

export interface CommitCaseResult {
  caseRef: string;
  /** The created procurement header id, if successful. */
  procurementId?: string;
  headerStatus: 'created' | 'failed';
  headerError?: string;
  records: CommitRecordResult[];
}
```
to:
```typescript
export interface CommitRecordResult {
  rowNumber: number;
  type: string;
  /** Created (or pre-existing, if skipped) record id. */
  id?: string;
  status: 'created' | 'failed' | 'skipped';
  error?: string;
  /** Present only when status === 'skipped': the reason (AC-IDEM-003/006). */
  skipReason?: string;
}

export interface CommitCaseResult {
  caseRef: string;
  /** The created (or pre-existing, if skipped) procurement header id. */
  procurementId?: string;
  headerStatus: 'created' | 'failed' | 'skipped';
  headerError?: string;
  /** Present only when headerStatus === 'skipped' (AC-IDEM-003/006). */
  headerSkipReason?: string;
  records: CommitRecordResult[];
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx tsc --noEmit -p .
```
(Expect errors in `commit.ts` — fixed in the next task.)

### Task 1.7 — Implement: `commit.ts` skip logic (case + per-record, independent)

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/commit.ts`.

Add imports:
```typescript
import { computeCaseImportKey, computeRecordImportKey } from './importKey';
import type { ImportSkipLookup, RecordTableName } from '@/src/lib/db/procurementImportSkip';
```

Extend `CommitOptions`:
```typescript
export interface CommitOptions {
  requestedById: string;
  projectLookup: RefLookup;
  vendorLookup: RefLookup;
  /** Present only when the caller wants re-run-safe skip semantics (import commit path).
   *  Absent (undefined) ⇒ legacy create-only behavior (opt-in, FR-IDEM-003 NULL-key note) —
   *  used by any future non-import caller of commitGroups, preserving old behavior exactly. */
  importBatchId?: string;
  skipLookup?: ImportSkipLookup;
}
```

Add a type→table map (module scope, near `CYCLE_ORDER`):
```typescript
const RECORD_TABLE_BY_TYPE: Record<Exclude<CycleType, 'PR' | 'RFQ' | 'PO' | 'Quotation' | 'GR' | 'VI' | 'Payment'> extends never ? CycleType : never, never> = {} as never;
const TYPE_TO_TABLE: Record<CycleType, RecordTableName> = {
  PR: 'purchase_requests',
  RFQ: 'rfqs',
  Quotation: 'procurement_quotations',
  PO: 'purchase_orders',
  GR: 'procurement_receipts',
  VI: 'procurement_invoices',
  Payment: 'payments',
};
```
(Drop the unused placeholder line above — it was scratch; the real addition is only `TYPE_TO_TABLE`.)

Rewrite `commitCase` to check the case-header skip first, then evaluate each record independently
(replacing the existing `commitCase` body from `// Step 1: create procurement header` onward):

```typescript
async function commitCase(
  validated: ValidatedGroup,
  { requestedById, projectLookup, vendorLookup, importBatchId, skipLookup }: CommitOptions,
): Promise<CommitCaseResult> {
  const { group, rows: validatedRows } = validated;
  const { attrs } = group;

  const projectId = attrs.project ? refId(projectLookup, attrs.project) : null;
  const quotationRow = group.rows.find((r) => r.type === 'Quotation');
  const vendorId = quotationRow?.vendor ? refId(vendorLookup, quotationRow.vendor) : null;

  const caseImportKey = importBatchId ? computeCaseImportKey(group) : null;

  // ── Case-header: skip-if-exists (FR-IDEM-003, independent of per-record decisions) ──
  let procurementId: string;
  let headerStatus: 'created' | 'skipped';
  let headerSkipReason: string | undefined;

  if (importBatchId && skipLookup && caseImportKey) {
    // org_id is resolved server-side by the skip-lookup's RLS-scoped read (never client-supplied).
    const existing = await skipLookup.findExistingCase(
      /* orgId resolved via the caller's session RLS scope */ '',
      caseImportKey,
      importBatchId,
    );
    if (existing) {
      procurementId = existing.id;
      headerStatus = 'skipped';
      headerSkipReason = `already imported (batch ${importBatchId})`;
    } else {
      try {
        const header = await createProcurement(
          { title: attrs.title ?? attrs.project ?? group.caseRef, projectId, vendorId },
          requestedById,
        );
        procurementId = header.id;
        headerStatus = 'created';
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        return {
          caseRef: group.caseRef, headerStatus: 'failed',
          headerError: `${headline}: ${detail}`, records: [],
        };
      }
    }
  } else {
    try {
      const header = await createProcurement(
        { title: attrs.title ?? attrs.project ?? group.caseRef, projectId, vendorId },
        requestedById,
      );
      procurementId = header.id;
      headerStatus = 'created';
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      return {
        caseRef: group.caseRef, headerStatus: 'failed',
        headerError: `${headline}: ${detail}`, records: [],
      };
    }
  }

  const validRowNumbers = new Set(validatedRows.filter((r) => r.valid).map((r) => r.rowNumber));
  const validRows = group.rows.filter((r) => validRowNumbers.has(r.rowNumber));
  validRows.sort((a, b) => {
    const ai = CYCLE_ORDER.indexOf(a.type as CycleType);
    const bi = CYCLE_ORDER.indexOf(b.type as CycleType);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  let groupInvoiceId: string | null = null;
  const records: CommitRecordResult[] = [];

  for (const row of validRows) {
    const recordImportKey = importBatchId ? computeRecordImportKey(row) : null;

    // ── Per-record: skip-if-exists, evaluated INDEPENDENTLY of the header decision (FR-IDEM-003/005) ──
    if (importBatchId && skipLookup && recordImportKey) {
      const table = TYPE_TO_TABLE[row.type as CycleType];
      const existing = table
        ? await skipLookup.findExistingRecord(table, procurementId, recordImportKey, importBatchId)
        : null;
      if (existing) {
        if (row.type === 'VI') groupInvoiceId = existing.id; // preserve Payment FK settlement on skip
        records.push({
          rowNumber: row.rowNumber, type: row.type, id: existing.id,
          status: 'skipped', skipReason: `already imported (batch ${importBatchId})`,
        });
        continue;
      }
    }

    try {
      const { id } = await createRecord(row, procurementId, groupInvoiceId, vendorLookup);
      if (row.type === 'VI') groupInvoiceId = id;
      records.push({ rowNumber: row.rowNumber, type: row.type, id, status: 'created' });
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      records.push({
        rowNumber: row.rowNumber, type: row.type, status: 'failed',
        error: `${headline}: ${detail}`,
      });
    }
  }

  return { caseRef: group.caseRef, procurementId, headerStatus, headerSkipReason, records };
}
```

Update `commitGroups`'s aggregate-counting loop to treat `'skipped'` as neither created nor failed:
```typescript
export async function commitGroups(
  validatedGroups: ValidatedGroup[],
  options: CommitOptions,
): Promise<CommitResult> {
  const cases: CommitCaseResult[] = [];
  let created = 0;
  let failed = 0;

  for (const validated of validatedGroups) {
    if (!validated.valid) continue;

    const caseResult = await commitCase(validated, options);
    cases.push(caseResult);
    if (caseResult.headerStatus === 'created' || caseResult.headerStatus === 'skipped') {
      for (const rec of caseResult.records) {
        if (rec.status === 'created') created++;
        else if (rec.status === 'failed') failed++;
        // 'skipped' counts toward neither — surfaced via the per-case/per-record detail instead.
      }
    }
  }

  return { created, failed, cases };
}
```

**Note on `createRecord`'s signature (D-ONB-1/D-ONB-2 applied here):** `createRecord` and
`createProcurement` need the three provenance values threaded through to actually stamp them — this
plan's Task 1.7 above wires the **skip decision**; Task 1.8 wires the **provenance stamp** (the actual
values passed to `createPurchaseRequest(..., p_import_key, p_import_batch_id, p_imported_at)` etc.).
Keeping these as two tasks (skip-decision, then stamp-values) keeps each task within the 2–5 min
no-placeholder bound and avoids conflating two distinct pieces of logic in one diff.

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx tsc --noEmit -p .
```
(Expect remaining errors: `createRecord`/`createProcurement`/RPC wrapper calls don't yet accept the
provenance params — fixed in Task 1.8.)

### Task 1.8 — Implement: thread provenance stamp values into every create call

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/db/procurementCrud.ts`:
extend `createProcurement`'s insert (only when provenance is supplied — legacy callers pass none):

```typescript
export interface NewProcurementInput {
  title: string;
  projectId: string | null;
  vendorId: string | null;
  /** Import provenance (Deliverable 2/3) — undefined for every non-import caller. */
  importKey?: string;
  importBatchId?: string;
  importedAt?: string;
}

export async function createProcurement(
  input: NewProcurementInput,
  requestedById: string,
): Promise<Tables<'procurements'>> {
  const { data, error } = await supabase
    .from('procurements')
    .insert({
      title: input.title,
      status: 'Draft',
      requested_by_id: requestedById,
      project_id: input.projectId,
      vendor_id: input.vendorId,
      ...(input.importKey !== undefined ? { import_key: input.importKey } : {}),
      ...(input.importBatchId !== undefined ? { import_batch_id: input.importBatchId } : {}),
      ...(input.importedAt !== undefined ? { imported_at: input.importedAt } : {}),
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as Tables<'procurements'>;
}
```

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/db/procurementRecords.ts`:
add the three trailing optional params to `createPurchaseRequest`/`createRfq`/`createPurchaseOrder`/`createPayment`, e.g.:

```typescript
export async function createPurchaseRequest(
  procurementId: string,
  referenceNumber: string | null,
  status: string | null,
  date: string | null,
  amount: number | null,
  importKey?: string,
  importBatchId?: string,
  importedAt?: string,
): Promise<PurchaseRequestRow> {
  const { data, error } = (await supabase.rpc('create_purchase_request', {
    p_procurement_id: procurementId,
    p_reference_number: referenceNumber,
    p_status: status,
    p_date: date,
    p_amount: amount,
    p_import_key: importKey ?? null,
    p_import_batch_id: importBatchId ?? null,
    p_imported_at: importedAt ?? null,
  })) as unknown as { data: PurchaseRequestRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}
```
(Repeat the identical trailing-param + payload-field pattern for `createRfq`/`create_rfq`,
`createPurchaseOrder`/`create_purchase_order`, `createPayment`/`create_payment` — same three new
params, same `p_import_key`/`p_import_batch_id`/`p_imported_at` payload fields appended.)

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/db/procurementLifecycle.ts`:
apply the identical pattern to `createQuotation`/`createReceipt`/`createInvoice` (three new trailing
optional params → three new `p_import_key`/`p_import_batch_id`/`p_imported_at` RPC payload fields).

Edit `commit.ts`'s `createRecord` + `commitCase` to pass the provenance triple through:
```typescript
async function createRecord(
  row: CycleRow,
  procurementId: string,
  groupInvoiceId: string | null,
  vendorLookup: RefLookup,
  importKey?: string,
  importBatchId?: string,
  importedAt?: string,
): Promise<{ id: string }> {
  // ... existing parse block unchanged ...
  switch (type) {
    case 'PR': {
      const result = await createPurchaseRequest(procurementId, ref, status, date, amount, importKey, importBatchId, importedAt);
      return { id: result.id };
    }
    // ... same trailing-args addition for RFQ/PO/Quotation/GR/VI/Payment ...
  }
}
```
And in `commitCase`, when calling `createRecord` for a non-skipped row:
```typescript
const importedAtIso = importBatchId ? new Date().toISOString() : undefined;
// ...
const { id } = await createRecord(
  row, procurementId, groupInvoiceId, vendorLookup,
  recordImportKey ?? undefined, importBatchId, importedAtIso,
);
```
And when creating the header (non-skip branch), pass the same triple into `createProcurement`'s input:
```typescript
const header = await createProcurement(
  {
    title: attrs.title ?? attrs.project ?? group.caseRef, projectId, vendorId,
    ...(importBatchId ? { importKey: caseImportKey ?? undefined, importBatchId, importedAt: importedAtIso } : {}),
  },
  requestedById,
);
```

**Now update the existing `commit.test.ts` assertions (D-ONB-2 — intentional, contained churn, exactly
3 call sites: lines 84, 93, 132)** — the only `toHaveBeenCalledWith(...)` exact-signature assertions
in this file, on `createInvoice` (line 84) and `createPayment` (lines 93, 132) — to append three
trailing `undefined` args (the non-import test cases in this file call `commitGroups` WITHOUT
`importBatchId`, so every provenance arg resolves to `undefined`), e.g. the existing (line 84):
```typescript
expect(createInvoice).toHaveBeenCalledWith('proc-1', 'Received', '2025-01-15', 'EXT-001', 5000);
```
becomes:
```typescript
expect(createInvoice).toHaveBeenCalledWith('proc-1', 'Received', '2025-01-15', 'EXT-001', 5000, undefined, undefined, undefined);
```
(Apply the identical three-`undefined`-args append to the two `createPayment` assertions at lines 93
and 132. No other assertion in this file needs updating — `createPurchaseRequest`/`createRfq`/
`createPurchaseOrder`/`createQuotation`/`createReceipt` are exercised elsewhere in this file but are
never asserted via exact positional `toHaveBeenCalledWith`, so their call-signature change is
exercised by the file's other tests without needing a literal-args update.)

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx vitest run src/lib/import/procurementCycle/__tests__/commit.test.ts src/lib/import/procurementCycle/__tests__/importKey.test.ts
```

### Task 1.9 — Full regression gate (AC-IDEM-007)

```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npm run verify
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && supabase db reset && supabase test db
```
Both must be green. This is the AC-IDEM-007 proof: the whole suite, not a targeted run.

---

## Slice 2 — Import idempotency: dry-run conflict report in preview (D2 part 2)

**AC coverage:** AC-IDEM-005.

### Task 2.1 — Failing unit test first: `buildDryRunConflictReport`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/__tests__/dryRunConflictReport.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildDryRunConflictReport } from '../dryRunConflictReport';
import { makeRefLookup } from '@/src/lib/import/refLookup';
import type { ValidatedGroup } from '../types';
import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';

const projectLookup = makeRefLookup([], 'Project');
const vendorLookup = makeRefLookup([], 'Vendor');

function makeGroup(caseRef: string): ValidatedGroup {
  return {
    valid: true, groupErrors: [],
    group: { caseRef, attrs: { title: caseRef, project: undefined, caseStatus: undefined }, rows: [
      { caseRef, type: 'PR', title: caseRef, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: `${caseRef}-PR`, status: 'Approved', date: '2025-01-01', amount: '100', rowNumber: 1 },
    ], errors: [] },
    rows: [{ rowNumber: 1, valid: true, errors: [] }],
  };
}

describe('buildDryRunConflictReport — AC-IDEM-005 (zero writes, would-create/skip/collide tally)', () => {
  it('reports would-create for a group with no matching key anywhere', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue(null),
      findExistingRecord: vi.fn().mockResolvedValue(null),
      findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-NEW')], {
      importBatchId: 'batch-1', skipLookup, projectLookup, vendorLookup,
    });
    expect(report.wouldCreate).toBe(2); // 1 case header + 1 PR record
    expect(report.wouldSkip).toBe(0);
    expect(report.wouldCollide).toBe(0);
    expect(skipLookup.findExistingCase).toHaveBeenCalled(); // read-only probe called
  });

  it('reports would-skip for a group whose case already exists in the SAME batch', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing' }),
      findExistingRecord: vi.fn().mockResolvedValue({ id: 'existing-rec' }),
      findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-DUP')], {
      importBatchId: 'batch-1', skipLookup, projectLookup, vendorLookup,
    });
    expect(report.wouldSkip).toBe(2);
    expect(report.wouldCreate).toBe(0);
  });

  it('reports would-collide for a group whose key exists in a DIFFERENT batch', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue(null),
      findExistingRecord: vi.fn().mockResolvedValue(null),
      findCrossBatchCollision: vi.fn().mockResolvedValue({ id: 'other', import_batch_id: 'batch-0' }),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-COLLIDE')], {
      importBatchId: 'batch-1', skipLookup, projectLookup, vendorLookup,
    });
    expect(report.wouldCollide).toBe(2);
    expect(report.wouldCreate).toBe(0);
  });
});
```

**Verify (expect FAIL — module doesn't exist):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx vitest run src/lib/import/procurementCycle/__tests__/dryRunConflictReport.test.ts
```

### Task 2.2 — Implement: `dryRunConflictReport.ts`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/lib/import/procurementCycle/dryRunConflictReport.ts`:

```typescript
/**
 * FR-IDEM-007 — dry-run conflict report (Deliverable 2). Zero writes: reuses the SAME
 * ImportSkipLookup read-only existence-check contract commit.ts uses at commit time
 * (D-ONB-4 — one lookup implementation, two call sites, no logic duplication).
 */
import type { RefLookup } from '@/src/lib/import/refLookup';
import type { ImportSkipLookup, RecordTableName } from '@/src/lib/db/procurementImportSkip';
import { computeCaseImportKey, computeRecordImportKey } from './importKey';
import type { CycleType, ValidatedGroup } from './types';

export interface DryRunConflictReport {
  wouldCreate: number;
  wouldSkip: number;
  wouldCollide: number;
}

export interface DryRunConflictOptions {
  importBatchId: string;
  skipLookup: ImportSkipLookup;
  projectLookup: RefLookup;
  vendorLookup: RefLookup;
}

const TYPE_TO_TABLE: Record<CycleType, RecordTableName> = {
  PR: 'purchase_requests',
  RFQ: 'rfqs',
  Quotation: 'procurement_quotations',
  PO: 'purchase_orders',
  GR: 'procurement_receipts',
  VI: 'procurement_invoices',
  Payment: 'payments',
};

export async function buildDryRunConflictReport(
  validatedGroups: ValidatedGroup[],
  { importBatchId, skipLookup }: DryRunConflictOptions,
): Promise<DryRunConflictReport> {
  let wouldCreate = 0;
  let wouldSkip = 0;
  let wouldCollide = 0;

  for (const validated of validatedGroups) {
    if (!validated.valid) continue;
    const { group } = validated;

    // ── Case header ──
    const caseKey = computeCaseImportKey(group);
    const existingCase = await skipLookup.findExistingCase('', caseKey, importBatchId);
    if (existingCase) {
      wouldSkip++;
    } else {
      const collision = await skipLookup.findCrossBatchCollision('procurements', 'org_id', '', caseKey, importBatchId);
      if (collision) wouldCollide++;
      else wouldCreate++;
    }

    // ── Records ──
    const validRowNumbers = new Set(validated.rows.filter((r) => r.valid).map((r) => r.rowNumber));
    for (const row of group.rows.filter((r) => validRowNumbers.has(r.rowNumber))) {
      const table = TYPE_TO_TABLE[row.type as CycleType];
      if (!table) continue;
      const recordKey = computeRecordImportKey(row);
      const existingRecord = existingCase
        ? await skipLookup.findExistingRecord(table, existingCase.id, recordKey, importBatchId)
        : null;
      if (existingRecord) {
        wouldSkip++;
      } else {
        const collision = existingCase
          ? await skipLookup.findCrossBatchCollision(table, 'procurement_id', existingCase.id, recordKey, importBatchId)
          : null;
        if (collision) wouldCollide++;
        else wouldCreate++;
      }
    }
  }

  return { wouldCreate, wouldSkip, wouldCollide };
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx vitest run src/lib/import/procurementCycle/__tests__/dryRunConflictReport.test.ts && npx tsc --noEmit -p .
```

### Task 2.3 — Wire into the preview step + auto-generate/display `--batch-id`

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal/src/components/import/procurementCycle/useProcurementCycleImport.ts`:

Add a generated batch id (once per wizard session, stable across the preview→commit transition) and
expose the conflict report as new hook state:

```typescript
import { buildDryRunConflictReport, type DryRunConflictReport } from '@/src/lib/import/procurementCycle/dryRunConflictReport';
import { supabaseImportSkipLookup } from '@/src/lib/db/procurementImportSkip';

// inside useProcurementCycleImport, alongside the existing useState calls:
const [importBatchId] = useState<string>(() => crypto.randomUUID());
const [conflictReport, setConflictReport] = useState<DryRunConflictReport | null>(null);

// goPreview becomes async to fire the read-only dry-run report:
const goPreview = useCallback(async () => {
  if (!allRequiredMapped) return;
  setStep('preview');
  const report = await buildDryRunConflictReport(validatedGroups.filter((g) => g.valid), {
    importBatchId, skipLookup: supabaseImportSkipLookup, projectLookup, vendorLookup,
  });
  setConflictReport(report);
}, [allRequiredMapped, validatedGroups, importBatchId, projectLookup, vendorLookup]);

// commit() passes importBatchId + skipLookup through:
const commit = useCallback(async () => {
  const validGroups = validatedGroups.filter((g) => g.valid);
  if (validGroups.length === 0) return;
  setStep('committing');
  setProgress({ done: 0, total: validGroups.length });
  const commitResult = await commitGroups(validGroups, {
    requestedById, projectLookup, vendorLookup,
    importBatchId, skipLookup: supabaseImportSkipLookup,
  });
  setProgress(null);
  setResult(commitResult);
  setStep('result');
}, [validatedGroups, requestedById, projectLookup, vendorLookup, importBatchId]);
```

Add `importBatchId` and `conflictReport` to the returned `UseProcurementCycleImport` interface + the
final return object.

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npx tsc --noEmit -p . && npx vitest run src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx
```
(If the existing wizard test asserts a synchronous `goPreview`, update its awaited call — this is the
same D-ONB-2-style contained churn, confined to the wizard's own test file.)

### Task 2.4 — Full verify for Slice 2

```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npm run verify
```

---

## Slice 3 — Historical-import transform library + CSV contracts + unit tests (D3 part 1)

**AC coverage:** AC-HIST-001, AC-HIST-002, AC-HIST-007, AC-HIST-008, AC-HIST-009.

This slice builds the **pure** helpers `scripts/import-historical.mjs` will call — no DB writes, no
network, plain Node + fixtures. It does NOT touch the local Supabase stack (no serialize needed).

### Task 3.1 — Failing unit test first: terminal-status validators (AC-HIST-002)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportValidate.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TERMINAL_PROJECT_STATUSES,
  TERMINAL_PROCUREMENT_STATUSES,
  COMMITTED_STATUSES,
  validateProjectRow,
  validateCaseRow,
} from './historicalImportValidate.mjs';

test('AC-HIST-002: a projects.csv row with a non-terminal status is rejected with a per-row error', () => {
  const result = validateProjectRow({ code: 'P-1', title: 'Ongoing Deal', status: 'Ongoing Project', contract_value: '100000', end_date: '2026-01-01' });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /terminal/i);
});

test('AC-HIST-002: a projects.csv row with a terminal status (Close Out) is accepted', () => {
  const result = validateProjectRow({ code: 'P-2', title: 'Closed Deal', status: 'Close Out', contract_value: '250000', end_date: '2026-01-01' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('AC-HIST-002: a procurement_cases.csv case row with a non-terminal terminal_status is rejected', () => {
  const result = validateCaseRow({ case_ref: 'C-1', type: 'PO', terminal_status: 'Ordered', total_value: '5000' });
  // 'Ordered' IS a terminal-eligible committed status per COMMITTED_STATUSES — use a genuinely
  // non-terminal status (e.g. 'Draft') for the negative case:
  const nonTerminal = validateCaseRow({ case_ref: 'C-2', type: 'PO', terminal_status: 'Draft', total_value: '5000' });
  assert.equal(nonTerminal.valid, false);
  assert.match(nonTerminal.errors[0], /terminal/i);
});

test('FR-HIST-004: a case row whose terminal_status is COMMITTED and total_value is blank is REJECTED (not silently 0)', () => {
  const result = validateCaseRow({ case_ref: 'C-3', type: 'PO', terminal_status: 'Paid', total_value: '' });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /total_value/i);
});

test('FR-HIST-004: a case row whose terminal_status is NOT committed may leave total_value blank', () => {
  const result = validateCaseRow({ case_ref: 'C-4', type: 'PO', terminal_status: 'Rejected', total_value: '' });
  assert.equal(result.valid, true);
});

test('COMMITTED_STATUSES matches procurements.ts:28-32 exactly', () => {
  assert.deepEqual(COMMITTED_STATUSES, ['Ordered', 'Received', 'Vendor Invoiced', 'Paid']);
});
```

**Verify (expect FAIL — module doesn't exist):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportValidate.test.mjs
```

### Task 3.2 — Implement: `historicalImportValidate.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportValidate.mjs`:

```javascript
/**
 * historicalImportValidate.mjs — pure terminal-status + committed-value validators for
 * scripts/import-historical.mjs (Deliverable 3, FR-HIST-002/003/004).
 * COMMITTED_STATUSES mirrors pmo-portal/src/lib/db/procurements.ts:28-32 EXACTLY (OD-BUDGET-2) —
 * if that file's list ever changes, this constant must be updated in lockstep (flagged, not
 * automatically synced — there is no build-time import from the Node script into the Vite app).
 */

/** Closed/terminal project statuses (pipeline + on-hand terminal set, OD-SP-1/OD-UX-2). */
export const TERMINAL_PROJECT_STATUSES = ['Won Pending KoM', 'On Hold', 'Close Out', 'Loss Tender'];

/** Terminal procurement_status values a historical case may land at directly. */
export const TERMINAL_PROCUREMENT_STATUSES = [
  'Rejected', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid', 'Cancelled',
];

/** OD-BUDGET-2 committed basis — mirrors procurements.ts:28-32 exactly. */
export const COMMITTED_STATUSES = ['Ordered', 'Received', 'Vendor Invoiced', 'Paid'];

export function validateProjectRow(row) {
  const errors = [];
  if (!TERMINAL_PROJECT_STATUSES.includes(row.status)) {
    errors.push(`status "${row.status}" is not a terminal/closed project status.`);
  }
  if (!row.code?.trim()) errors.push('code is required.');
  if (!row.title?.trim()) errors.push('title is required.');
  if (!row.contract_value?.toString().trim()) errors.push('contract_value is required.');
  if (!row.end_date?.trim()) errors.push('end_date is required.');
  return { valid: errors.length === 0, errors };
}

export function validateCaseRow(row) {
  const errors = [];
  if (!TERMINAL_PROCUREMENT_STATUSES.includes(row.terminal_status)) {
    errors.push(`terminal_status "${row.terminal_status}" is not a terminal procurement status.`);
  }
  if (!row.case_ref?.trim()) errors.push('case_ref is required.');
  if (COMMITTED_STATUSES.includes(row.terminal_status) && !row.total_value?.toString().trim()) {
    errors.push(
      `total_value is required when terminal_status ("${row.terminal_status}") is a committed status (${COMMITTED_STATUSES.join('/')}).`,
    );
  }
  return { valid: errors.length === 0, errors };
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportValidate.test.mjs
```

### Task 3.3 — Failing unit test first: `>1yr` advisory + summary builder (AC-HIST-008, AC-HIST-009)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportSummary.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { warnIfOlderThanOneYear, buildSummary } from './historicalImportSummary.mjs';

test('AC-HIST-009: a row dated > 1 year before "now" produces a warning (does not block)', () => {
  const now = new Date('2026-07-04T00:00:00Z');
  const warning = warnIfOlderThanOneYear('2024-01-01', now);
  assert.match(warning, /more than 1 year/i);
});

test('AC-HIST-009: a row dated within 1 year produces no warning', () => {
  const now = new Date('2026-07-04T00:00:00Z');
  const warning = warnIfOlderThanOneYear('2026-01-01', now);
  assert.equal(warning, null);
});

test('AC-HIST-008: buildSummary prints created/skipped/failed counts by entity + the batch id', () => {
  const summary = buildSummary({
    importBatchId: 'batch-xyz',
    projects: { created: 3, skipped: 1, failed: 0 },
    cases: { created: 5, skipped: 2, failed: 1 },
    recordsByType: { PR: { created: 5, skipped: 0, failed: 0 }, PO: { created: 4, skipped: 1, failed: 0 } },
    references: { resolved: 10, created: 2 },
  });
  assert.match(summary, /batch-xyz/);
  assert.match(summary, /projects.*created:\s*3/is);
  assert.match(summary, /cases.*created:\s*5/is);
  assert.match(summary, /PR.*created:\s*5/is);
});
```

**Verify (expect FAIL):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportSummary.test.mjs
```

### Task 3.4 — Implement: `historicalImportSummary.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportSummary.mjs`:

```javascript
/**
 * historicalImportSummary.mjs — pure helpers for the >1yr advisory (FR-HIST-010) and the
 * completion summary report (FR-HIST-014). No I/O — console.log happens in import-historical.mjs.
 */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function warnIfOlderThanOneYear(dateStr, now = new Date()) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (now.getTime() - d.getTime() > ONE_YEAR_MS) {
    return `date ${dateStr} is more than 1 year before the run date — summary-grade scope is ≤ 1yr (advisory only, not blocked).`;
  }
  return null;
}

function line(label, counts) {
  return `  ${label}: created ${counts.created}, skipped ${counts.skipped}, failed ${counts.failed}`;
}

export function buildSummary({ importBatchId, projects, cases, recordsByType, references }) {
  const lines = [
    `import_batch_id: ${importBatchId}`,
    'projects:',
    line('projects', projects),
    'cases:',
    line('cases', cases),
    'records by type:',
    ...Object.entries(recordsByType).map(([type, counts]) => line(type, counts)),
    `references: resolved ${references.resolved}, created ${references.created}`,
  ];
  return lines.join('\n');
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportSummary.test.mjs
```

### Task 3.5 — Failing unit test first: reference resolver + provenance event-builder (AC-HIST-005, AC-HIST-007)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportResolve.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOrCreateStub, buildProvenanceEvent } from './historicalImportResolve.mjs';

test('AC-HIST-007: resolveOrCreateStub reports "found" when the lookup already has the name', async () => {
  const lookup = new Map([['acme corp', { id: 'existing-1' }]]);
  const findFn = async (name) => lookup.get(name.trim().toLowerCase()) ?? null;
  const createFn = async () => { throw new Error('should not be called'); };
  const result = await resolveOrCreateStub('Acme Corp', { findFn, createFn });
  assert.equal(result.id, 'existing-1');
  assert.equal(result.action, 'found');
});

test('AC-HIST-007: resolveOrCreateStub creates a stub and reports "created" when absent', async () => {
  const findFn = async () => null;
  const createFn = async (name) => ({ id: 'new-1', name });
  const result = await resolveOrCreateStub('New Vendor LLC', { findFn, createFn });
  assert.equal(result.id, 'new-1');
  assert.equal(result.action, 'created');
});

test('AC-HIST-005: buildProvenanceEvent produces from_status=NULL, the terminal to_status, and an explicit org_id', () => {
  const event = buildProvenanceEvent({
    procurementId: 'proc-1', orgId: 'org-explicit-1', terminalStatus: 'Paid',
    importBatchId: 'batch-1', importDate: '2026-07-04',
  });
  assert.equal(event.from_status, null);
  assert.equal(event.to_status, 'Paid');
  assert.equal(event.org_id, 'org-explicit-1'); // NEVER the column's demo-org default (FR-HIST-013)
  assert.match(event.notes, /Historical import.*batch-1.*2026-07-04/is);
});
```

**Verify (expect FAIL):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportResolve.test.mjs
```

### Task 3.6 — Implement: `historicalImportResolve.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportResolve.mjs`:

```javascript
/**
 * historicalImportResolve.mjs — reference-resolution (FR-HIST-012) + provenance
 * event-builder (FR-HIST-013) pure helpers. findFn/createFn are injected so this stays
 * DB-free and unit-testable; import-historical.mjs supplies the real Supabase-service-role
 * implementations.
 */

export async function resolveOrCreateStub(name, { findFn, createFn }) {
  const existing = await findFn(name);
  if (existing) return { id: existing.id, action: 'found' };
  const created = await createFn(name);
  return { id: created.id, action: 'created' };
}

/**
 * Builds the single, honest provenance row (FR-HIST-013, --mark-provenance opt-in).
 * org_id is ALWAYS the explicit target org — never the procurement_status_events column's
 * demo-org default (migration 0038: default '00000000-0000-0000-0000-000000000001').
 */
export function buildProvenanceEvent({ procurementId, orgId, terminalStatus, importBatchId, importDate }) {
  return {
    procurement_id: procurementId,
    org_id: orgId,
    from_status: null,
    to_status: terminalStatus,
    actor_id: null,
    notes: `Historical import: terminal status ${terminalStatus} (batch ${importBatchId}, ${importDate})`,
  };
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportResolve.test.mjs
```

### Task 3.7 — CSV template fixtures (FR-HIST-009, contracts documented in the spec)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/templates/projects.csv`:
```csv
code,title,client_company,entity,status,contract_value,start_date,end_date,project_manager_email,budget_total,external_ref
PRJ-2024-011,Meridian Rooftop Solar Retrofit,Meridian Facilities Group,,Close Out,845000,2024-08-01,2025-03-15,pm@example.com,760000,LEGACY-PRJ-4471
```

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/templates/procurement_cases.csv`:
```csv
case_ref,type,title,project_code,terminal_status,total_value,reference_number,status,date,amount,vendor
CASE-H001,PR,Inverter Replacement,PRJ-2024-011,Paid,42000,,Approved,2024-09-01,,
CASE-H001,PO,,,Paid,42000,PO-VENDOR-5521,Ordered,2024-09-10,42000,
CASE-H001,VI,,,Paid,42000,INV-5521-A,Paid,2024-10-01,42000,SunGear Supply Co
```

**Verify (format sanity — parses with the same `parseWorkbook`-equivalent CSV path the script uses; a plain manual check is sufficient here since this is fixture authoring, not logic):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && head -2 scripts/templates/projects.csv scripts/templates/procurement_cases.csv
```

### Task 3.8 — Full verify for Slice 3

```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/*.test.mjs
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npm run verify
```

---

## Slice 4 — Historical-import loader script + dry-run + verification queries (D3 part 2)

**AC coverage:** AC-HIST-003, AC-HIST-004, AC-HIST-004a, AC-HIST-005, AC-HIST-006, AC-HIST-010.
**This slice's live-load verification runs against the local Supabase stack — SERIALIZE per
`docs/environments.md`.**

### Task 4.1 — Failing unit test first: `--org-id` + typed-confirm gate (AC-HIST-001)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportGate.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, requireOrgConfirmed } from './historicalImportGate.mjs';

test('AC-HIST-001: parseArgs without --org-id yields orgId: null (caller refuses to proceed)', () => {
  const args = parseArgs(['--file', 'x.csv']);
  assert.equal(args.orgId, null);
});

test('AC-HIST-001: parseArgs reads --org-id, --batch-id, --mark-provenance, --strict-refs', () => {
  const args = parseArgs(['--org-id', 'org-1', '--batch-id', 'batch-9', '--mark-provenance', '--strict-refs']);
  assert.equal(args.orgId, 'org-1');
  assert.equal(args.batchId, 'batch-9');
  assert.equal(args.markProvenance, true);
  assert.equal(args.strictRefs, true);
});

test('HIST-E002: requireOrgConfirmed returns ok:false when the typed name does not match the resolved org name', () => {
  const result = requireOrgConfirmed({ resolvedOrgName: 'Acme Client Co', typedConfirmation: 'Acme Cliant Co' });
  assert.equal(result.ok, false);
});

test('requireOrgConfirmed returns ok:true when the typed name matches exactly', () => {
  const result = requireOrgConfirmed({ resolvedOrgName: 'Acme Client Co', typedConfirmation: 'Acme Client Co' });
  assert.equal(result.ok, true);
});
```

**Verify (expect FAIL):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportGate.test.mjs
```

### Task 4.2 — Implement: `historicalImportGate.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/historicalImportGate.mjs`:

```javascript
/**
 * historicalImportGate.mjs — arg parsing + the org-id/typed-confirm refusal gate
 * (FR-HIST-001, HIST-E002). Pure — no process.exit, no I/O; import-historical.mjs
 * decides what to do with the parsed/validated result.
 */
import { randomUUID } from 'node:crypto';

export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    orgId: get('--org-id') ?? null,
    file: get('--file') ?? null,
    batchId: get('--batch-id') ?? randomUUID(),
    markProvenance: argv.includes('--mark-provenance'),
    strictRefs: argv.includes('--strict-refs'),
  };
}

export function requireOrgConfirmed({ resolvedOrgName, typedConfirmation }) {
  return { ok: resolvedOrgName === typedConfirmation };
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/historicalImportGate.test.mjs
```

### Task 4.3 — Implement: `scripts/import-historical.mjs` (the orchestrating script)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/import-historical.mjs`:

```javascript
#!/usr/bin/env node
/**
 * import-historical.mjs — Operator-run, service-role historical import (Deliverable 3,
 * docs/specs/onboarding-tooling.spec.md §"Deliverable 3"). Loads closed projects.csv +
 * procurement_cases.csv into a freshly-provisioned client org at terminal status,
 * summary-grade, ≤ 1 yr. NO fabricated procurement_status_events (FR-HIST-005) unless
 * --mark-provenance is passed (exactly one honest provenance row per case, FR-HIST-013).
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role key, from op-get.sh, NEVER a file> \
 *   node scripts/import-historical.mjs --org-id <uuid> --file scripts/templates/projects.csv \
 *     [--batch-id <uuid>] [--mark-provenance] [--strict-refs]
 *
 * The service-role key is loaded by the OPERATOR'S OWN SHELL (op-get.sh from 1Password vault AS,
 * per docs/environments.md) — this script NEVER reads a file or 1Password directly (NFR-ONB-007).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { parseArgs, requireOrgConfirmed } from './lib/historicalImportGate.mjs';
import { validateProjectRow, validateCaseRow, COMMITTED_STATUSES } from './lib/historicalImportValidate.mjs';
import { warnIfOlderThanOneYear, buildSummary } from './lib/historicalImportSummary.mjs';
import { resolveOrCreateStub, buildProvenanceEvent } from './lib/historicalImportResolve.mjs';
import { groupRows } from '../pmo-portal/src/lib/import/procurementCycle/group.ts';

function parseCsv(path) {
  const text = readFileSync(path, 'utf8').trim();
  const [headerLine, ...lines] = text.split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

async function promptConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function main(argv) {
  const args = parseArgs(argv);

  // FR-HIST-001: refuse without --org-id, before any write.
  if (!args.orgId) {
    console.error('✗ --org-id is required. Aborting before any write.');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the invoking shell (op-get.sh).');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // HIST-E002: resolve the org name, require it typed back.
  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, name').eq('id', args.orgId).maybeSingle();
  if (orgErr || !org) {
    console.error(`✗ org_id ${args.orgId} not found. Aborting before any write.`);
    process.exit(1);
  }
  const typed = await promptConfirm(`Type the org name to confirm ("${org.name}"): `);
  if (!requireOrgConfirmed({ resolvedOrgName: org.name, typedConfirmation: typed }).ok) {
    console.error('✗ Org name mismatch. Aborting before any write.');
    process.exit(1);
  }

  console.log(`import_batch_id: ${args.batchId}`);
  const importedAt = new Date().toISOString();

  const summary = {
    projects: { created: 0, skipped: 0, failed: 0 },
    cases: { created: 0, skipped: 0, failed: 0 },
    recordsByType: {},
    references: { resolved: 0, created: 0 },
  };

  // ── projects.csv (FR-HIST-003/004/007) ──
  if (args.file?.endsWith('projects.csv')) {
    const rows = parseCsv(args.file);
    for (const row of rows) {
      const { valid, errors } = validateProjectRow(row);
      if (!valid) {
        console.error(`HIST-E001 row rejected (${row.code}): ${errors.join('; ')}`);
        summary.projects.failed++;
        continue;
      }
      const warning = warnIfOlderThanOneYear(row.end_date, new Date());
      if (warning) console.warn(`⚠ ${row.code}: ${warning}`);

      let clientCompanyId = null;
      if (row.client_company?.trim()) {
        const { action, id } = await resolveOrCreateStub(row.client_company, {
          findFn: async (name) => (await supabase.from('companies').select('id').ilike('name', name).maybeSingle()).data,
          createFn: async (name) => (await supabase.from('companies').insert({ name, type: 'Client' }).select('id').single()).data,
        });
        clientCompanyId = id;
        summary.references[action === 'found' ? 'resolved' : 'created']++;
      }

      const { error: insertErr } = await supabase.from('projects').insert({
        code: row.code, title: row.title, client_company_id: clientCompanyId,
        status: row.status, contract_value: Number(row.contract_value),
        start_date: row.start_date || null, end_date: row.end_date,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: row.code,
      });
      if (insertErr) { console.error(`✗ ${row.code}: ${insertErr.message}`); summary.projects.failed++; }
      else summary.projects.created++;
    }
  }

  // ── procurement_cases.csv (FR-HIST-003/004/005/006/011) ──
  if (args.file?.endsWith('procurement_cases.csv')) {
    const raw = parseCsv(args.file);
    const cycleRows = raw.map((r, i) => ({
      caseRef: r.case_ref, type: r.type, project: r.project_code, title: r.title,
      caseStatus: r.terminal_status, vendor: r.vendor, externalRef: r.reference_number,
      status: r.status, date: r.date, amount: r.amount, rowNumber: i + 2,
    }));
    const { groups } = groupRows(cycleRows);

    for (const group of groups) {
      const caseRow = raw.find((r) => r.case_ref === group.caseRef && r.terminal_status);
      const { valid, errors } = validateCaseRow(caseRow ?? {});
      if (!valid) {
        console.error(`HIST-E001 case rejected (${group.caseRef}): ${errors.join('; ')}`);
        summary.cases.failed++;
        continue;
      }

      const totalValue = COMMITTED_STATUSES.includes(caseRow.terminal_status)
        ? Number(caseRow.total_value) : (caseRow.total_value ? Number(caseRow.total_value) : 0);

      const { data: caseInsert, error: caseErr } = await supabase.from('procurements').insert({
        org_id: args.orgId, title: group.attrs.title ?? group.caseRef,
        status: caseRow.terminal_status, total_value: totalValue,
        import_batch_id: args.batchId, imported_at: importedAt, import_key: group.caseRef,
      }).select('id').single();
      if (caseErr) { console.error(`✗ ${group.caseRef}: ${caseErr.message}`); summary.cases.failed++; continue; }
      summary.cases.created++;

      if (args.markProvenance) {
        const event = buildProvenanceEvent({
          procurementId: caseInsert.id, orgId: args.orgId, terminalStatus: caseRow.terminal_status,
          importBatchId: args.batchId, importDate: importedAt.slice(0, 10),
        });
        await supabase.from('procurement_status_events').insert(event);
      }

      for (const row of group.rows) {
        summary.recordsByType[row.type] ??= { created: 0, skipped: 0, failed: 0 };
        const table = { PR: 'purchase_requests', RFQ: 'rfqs', Quotation: 'procurement_quotations',
          PO: 'purchase_orders', GR: 'procurement_receipts', VI: 'procurement_invoices', Payment: 'payments' }[row.type];
        const { error: recErr } = await supabase.from(table).insert({
          procurement_id: caseInsert.id, reference_number: row.externalRef || null,
          status: row.status, date: row.date, amount: row.amount ? Number(row.amount) : null,
          import_batch_id: args.batchId, imported_at: importedAt,
          import_key: row.externalRef || `fp:${row.type}|${row.date}|${row.amount}|${row.vendor ?? ''}`,
        });
        if (recErr) { console.error(`✗ ${group.caseRef}/${row.type}: ${recErr.message}`); summary.recordsByType[row.type].failed++; }
        else summary.recordsByType[row.type].created++;
      }
    }
  }

  console.log(buildSummary({ importBatchId: args.batchId, ...summary }));
}

main(process.argv.slice(2));
```

> **Implementer note:** the `import { groupRows } from '../pmo-portal/src/lib/import/procurementCycle/group.ts'`
> line requires either running this script through `tsx`/`ts-node`, or (simpler, matching this repo's
> plain-`node --test` convention for other `scripts/*.mjs`) copying `groupRows`'s ~30-line pure logic
> inline as `scripts/lib/historicalImportGroup.mjs` with an equivalent unit test, to keep the script
> runnable via plain `node` with no TS toolchain dependency at operator-run time. **Decide this at
> build time by checking whether any other `scripts/*.mjs` already imports a `.ts` file** (none do,
> per the existing `scripts/` directory convention observed in this plan's research) — if none do,
> use the copy-inline approach for consistency, add `scripts/lib/historicalImportGroup.mjs` +
> `.test.mjs` mirroring `group.ts`'s existing test coverage, and note the duplication with a comment
> pointing at the canonical source (`pmo-portal/src/lib/import/procurementCycle/group.ts`) so the two
> are kept in sync if the grouping rule ever changes.

**Verify (syntax + no missing-export smoke check):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --check scripts/import-historical.mjs
```

### Task 4.4 — Documented manual dry-run (AC-HIST-003, 004, 004a, 005, 006, 010) — SERIALIZE against the local stack

This is the pipeline verification the spec requires as a **documented manual dry-run, not CI**
(ADR-0010 — a live Supabase project + service-role key cannot run in CI). Record the evidence
directly in this plan file's "Evidence" section (§below) when executed.

**Procedure (run from `/Users/ariefsaid/Coding/PMO-worktrees/onboarding`, stack must be up and NOT
concurrently touched by another worktree):**

```bash
supabase db reset   # pristine local stack, migration 0068 applied
supabase status      # confirm running; note the local URL + service_role key (SKIP -- see below)
```

```bash
# Resolve a LOCAL service-role key — the local stack's well-known dev key (not secret), never prod:
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).SERVICE_ROLE_KEY))')" \
node scripts/import-historical.mjs \
  --org-id <a seed org id from supabase/seed.sql> \
  --file scripts/templates/projects.csv \
  --batch-id 00000000-0000-0000-0000-0000000000b1
```
Then repeat for `procurement_cases.csv` with the same `--batch-id`.

**Assertions to record (each maps to an AC):**
1. **AC-HIST-003** — `select status, start_date, end_date, created_at, import_batch_id, imported_at from projects where import_key = 'PRJ-2024-011';` → `status = 'Close Out'`, dates match the CSV, `created_at` = the run moment (not backdated), provenance columns non-NULL.
2. **AC-HIST-004** — `select count(*) from procurement_status_events where procurement_id = (select id from procurements where import_key = 'CASE-H001');` → `0` (no `--mark-provenance` on this first run).
3. **AC-HIST-004a** — `select total_value, status from procurements where import_key = 'CASE-H001';` → `total_value = 42000`, `status = 'Paid'`; then confirm the project's committed-spend query (`Σ total_value WHERE status IN COMMITTED_STATUSES`) includes this row.
4. **AC-HIST-006** — re-run the identical command with the SAME `--batch-id` → `buildSummary` output shows `cases: created 0, skipped 1` (case) and every record `skipped` — zero new rows (`select count(*) from procurements where import_key='CASE-H001';` still `1`).
5. **AC-HIST-005** — re-run with `--mark-provenance --batch-id 00000000-0000-0000-0000-0000000000b2` (a fresh batch, so the case itself is NOT skipped — this proves the provenance-event path independently) → `select from_status, to_status, notes from procurement_status_events where procurement_id = <the new case id>;` → exactly 1 row, `from_status IS NULL`, `to_status = 'Paid'`.
6. **AC-HIST-010** — for every imported table (`projects`, `procurements`, `purchase_requests`, `rfqs`, `procurement_quotations`, `purchase_orders`, `procurement_receipts`, `procurement_invoices`, `payments`, `budget_versions`, `procurement_status_events` if `--mark-provenance` used): run `select count(*) from <table> where import_batch_id = '<batch>' and org_id <> '<target-org-id>';` → `0` for every table; then as an **anon** client (no JWT) confirm a `select` on each returns empty/denied; then as an **authenticated org-A Admin JWT** confirm the imported rows ARE visible; then as an **authenticated org-B Admin JWT** (a second, different org) confirm **zero** rows are visible from every one of those tables.

**Verify command for step 6 (repeat per table, org-B example):**
```bash
curl -s "http://127.0.0.1:54321/rest/v1/procurements?import_batch_id=eq.00000000-0000-0000-0000-0000000000b1" \
  -H "apikey: <org-B admin JWT>" -H "Authorization: Bearer <org-B admin JWT>" | jq 'length'
# Expect: 0
```

### Task 4.5 — Full verify for Slice 4

```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/*.test.mjs
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npm run verify
```

---

## Slice 5 — Provisioning script + readiness checklist + runbook (D1)

**AC coverage:** AC-PROV-001, AC-PROV-002, AC-PROV-003, AC-PROV-004, AC-PROV-005, AC-PROV-006,
AC-PROV-007.

### Task 5.1 — Failing unit test first: confirm-prompt helper (AC-PROV-002)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/provisionConfirm.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmSlugMatches } from './provisionConfirm.mjs';

test('AC-PROV-002: a typed slug that does NOT match the target slug fails the confirm', () => {
  assert.equal(confirmSlugMatches({ targetSlug: 'acme-co', typed: 'acme-corp' }), false);
});

test('AC-PROV-002: a typed slug that matches exactly passes the confirm', () => {
  assert.equal(confirmSlugMatches({ targetSlug: 'acme-co', typed: 'acme-co' }), true);
});
```

**Verify (expect FAIL):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/provisionConfirm.test.mjs
```

### Task 5.2 — Implement: `provisionConfirm.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/provisionConfirm.mjs`:

```javascript
/** provisionConfirm.mjs — pure typed-confirm matcher (FR-PROV-001, AC-PROV-002). */
export function confirmSlugMatches({ targetSlug, typed }) {
  return typed === targetSlug;
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/provisionConfirm.test.mjs
```

### Task 5.3 — Failing unit test first: registry-row builder (AC-PROV-006)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/provisionRegistryRow.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegistryRow } from './provisionRegistryRow.mjs';

test('AC-PROV-006: registry row contains only public-safe fields, never a secret', () => {
  const row = buildRegistryRow({
    slug: 'acme-co', projectRef: 'abcxyz123', apiUrl: 'https://abcxyz123.supabase.co',
    anonKey: 'eyJhbGciOi...public-anon', frontendUrl: 'https://acme-co.pages.dev',
  });
  assert.match(row, /abcxyz123/);
  assert.match(row, /migrations: current/);
  assert.match(row, /seed: none/);
  assert.doesNotMatch(row, /service_role/i);
  assert.doesNotMatch(row, /SUPABASE_PROD_DB_URL/);
});
```

**Verify (expect FAIL):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/provisionRegistryRow.test.mjs
```

### Task 5.4 — Implement: `provisionRegistryRow.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/provisionRegistryRow.mjs`:

```javascript
/** provisionRegistryRow.mjs — public-safe docs/environments.md registry row builder (FR-PROV-009). */
export function buildRegistryRow({ slug, projectRef, apiUrl, anonKey, frontendUrl }) {
  return `| \`${slug}\` (cloud) | \`${projectRef}\` | \`${apiUrl}\` | ${anonKey} | ${frontendUrl} | migrations: current | seed: none |`;
}
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/provisionRegistryRow.test.mjs
```

### Task 5.5 — Failing unit test first: `classifyMigrationCount`/`classifyOrgAdminExistence`/`classifyAnonReadSanity` (AC-PROV-004, AC-PROV-005 reuse + new classifiers)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/check-client-readiness.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMigrationCount,
  classifyOrgAdminExistence,
  classifyAnonReadSanity,
} from './check-client-readiness.mjs';
import { classifyEnvSecrets, classifyProbeResult } from './check-agent-prod-readiness.mjs';

test('AC-PROV-004 (reused classifier): a 404 edge-fn probe reports unhealthy with the exact deploy hint', () => {
  const verdict = classifyProbeResult({ status: 404, expectedUnauthenticated: true });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /404/);
});

test('AC-PROV-005 (reused classifier): OPENROUTER_API_KEY unset reports NOT SET, never a value', () => {
  const result = classifyEnvSecrets({}, ['OPENROUTER_API_KEY']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['OPENROUTER_API_KEY']);
});

test('classifyMigrationCount: reports healthy when remote count equals the repo migration-file count', () => {
  const verdict = classifyMigrationCount({ repoCount: 68, remoteCount: 68 });
  assert.equal(verdict.healthy, true);
});

test('classifyMigrationCount: reports unhealthy with the exact gap when remote is behind', () => {
  const verdict = classifyMigrationCount({ repoCount: 68, remoteCount: 65 });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /3/);
});

test('classifyOrgAdminExistence: reports healthy when exactly one org + one linked Admin profile exist', () => {
  const verdict = classifyOrgAdminExistence({ orgCount: 1, adminProfileCount: 1, adminOrgIdMatches: true });
  assert.equal(verdict.healthy, true);
});

test('classifyOrgAdminExistence: reports unhealthy when the Admin org_id does not match the org', () => {
  const verdict = classifyOrgAdminExistence({ orgCount: 1, adminProfileCount: 1, adminOrgIdMatches: false });
  assert.equal(verdict.healthy, false);
});

test('classifyAnonReadSanity: reports healthy (RLS working) when an anon read returns empty/denied', () => {
  const verdict = classifyAnonReadSanity({ anonRowCount: 0 });
  assert.equal(verdict.healthy, true);
});

test('classifyAnonReadSanity: reports unhealthy (RLS hole) when an anon read returns rows', () => {
  const verdict = classifyAnonReadSanity({ anonRowCount: 3 });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /RLS/);
});
```

**Verify (expect FAIL — `check-client-readiness.mjs` doesn't exist yet):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/check-client-readiness.test.mjs
```

### Task 5.6 — Implement: `scripts/check-client-readiness.mjs`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/check-client-readiness.mjs`:

```javascript
#!/usr/bin/env node
/**
 * check-client-readiness.mjs — read-only readiness check for a freshly-provisioned client
 * project (Deliverable 1, FR-PROV-011). Sibling of check-agent-prod-readiness.mjs — REUSES
 * its classifyEnvSecrets/classifyProbeResult directly (no reimplementation) and adds the
 * classifiers specific to a client provisioning check: migration-count parity, org+Admin
 * existence, and anon-read RLS sanity. SKIPPED-not-FAILED when an optional input is unset.
 *
 * Usage:
 *   PMO_READINESS_BASE_URL=https://<ref>.supabase.co/functions/v1 \
 *   PMO_READINESS_BEARER=<a real Admin JWT or the service-role key> \
 *   PMO_CLIENT_ORG_SLUG=<slug> \
 *   node scripts/check-client-readiness.mjs
 */
import { classifyEnvSecrets, classifyProbeResult, AGENT_FUNCTIONS, REQUIRED_ENV_VARS } from './check-agent-prod-readiness.mjs';

export function classifyMigrationCount({ repoCount, remoteCount }) {
  if (repoCount === remoteCount) return { healthy: true, detail: `${remoteCount}/${repoCount} migrations applied` };
  return { healthy: false, detail: `remote has ${remoteCount}, repo expects ${repoCount} (gap: ${repoCount - remoteCount})` };
}

export function classifyOrgAdminExistence({ orgCount, adminProfileCount, adminOrgIdMatches }) {
  if (orgCount === 1 && adminProfileCount >= 1 && adminOrgIdMatches) {
    return { healthy: true, detail: 'exactly one org row and ≥1 linked Admin profile exist' };
  }
  return { healthy: false, detail: `orgCount=${orgCount}, adminProfileCount=${adminProfileCount}, adminOrgIdMatches=${adminOrgIdMatches}` };
}

export function classifyAnonReadSanity({ anonRowCount }) {
  if (anonRowCount === 0) return { healthy: true, detail: 'anon read returned 0 rows (RLS enforcing)' };
  return { healthy: false, detail: `anon read returned ${anonRowCount} rows — RLS HOLE, investigate immediately` };
}

// main() mirrors check-agent-prod-readiness.mjs's structure: printSection per check, SKIPPED when
// an optional input is absent, exit 1 on any FAIL. Re-uses AGENT_FUNCTIONS/REQUIRED_ENV_VARS from
// the sibling script for the edge-fn + secret checks (FR-PROV-011 a/c) and adds (b/d/e/f) here.
```

> **Implementer note:** the `main()` orchestration (reading env vars, calling the classifiers,
> printing sections, computing exit code) follows `check-agent-prod-readiness.mjs`'s existing
> `main()` byte-for-byte in structure — copy its `printSection`/`safeFetch`/exit-code pattern and
> extend with three new `printSection` blocks for migration-count, org/Admin existence, and
> anon-read sanity (each driven by a live Supabase REST/RPC call gated by the same
> `PMO_READINESS_BASE_URL`/`PMO_READINESS_BEARER` env vars, reported SKIPPED if unset). This is
> integration-only glue (network calls) and is NOT unit-tested itself — only the classifiers
> above are, matching the existing sibling script's test-coverage boundary (its own
> `.test.mjs` docstring: "the script's network probes are integration-only… these tests cover
> only the logic that does NOT require a network call").

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/check-client-readiness.test.mjs
node --check scripts/check-client-readiness.mjs
```

### Task 5.7 — Implement: `scripts/provision-client.sh`

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/provision-client.sh`:

```bash
#!/usr/bin/env bash
#
# Provision a NEW per-client Supabase Cloud Pro project (ADR-0047; this script IS the
# Operator's "add org" operation at <~5-deployment scale — no in-app UI). Mirrors
# db-push-prod.sh's shape exactly: typed-confirm + op-get.sh + explicit --db-url + --check.
#
#   scripts/provision-client.sh <slug>            provision (after a typed slug confirm)
#   scripts/provision-client.sh <slug> --check    resolve the secret + confirm reachability, NO writes
#
# NEVER seeds (FR-PROV-005 — a real client project is never demo-seeded). Manual-vs-CLI split is
# documented in docs/environments.md's per-client registry section (added by this issue).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

SLUG="${1:?Usage: scripts/provision-client.sh <client-slug> [--check]}"
CHECK_MODE="${2:-}"

ENV_FILE="supabase/op.${SLUG}.env"
: "${ENV_FILE:?}"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found. Copy supabase/op.<client-slug>.env.template and fill in the" >&2
  echo "  1Password item/vault/field coordinates for this client. See docs/environments.md." >&2
  exit 1
fi
. "$ENV_FILE"
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"

if [ -x "$OP_GET" ]; then
  if ! CLIENT_DB_URL="$("$OP_GET" "$OP_CLIENT_ITEM" "$OP_CLIENT_VAULT" "$OP_CLIENT_FIELD")"; then
    echo "✗ op-get.sh could not resolve '$OP_CLIENT_ITEM' / '$OP_CLIENT_FIELD' in vault '$OP_CLIENT_VAULT'." >&2
    echo "  Create that 1Password item (field '$OP_CLIENT_FIELD' = the Session-pooler URI, port 5432)." >&2
    exit 1
  fi
elif [ -f "supabase/.env.${SLUG}" ]; then
  set -a; . "supabase/.env.${SLUG}"; set +a
fi
: "${CLIENT_DB_URL:?No secret resolved for slug '$SLUG' — set up 1Password or supabase/.env.$SLUG.}"

if [ "$CHECK_MODE" = "--check" ]; then
  echo "→ $SLUG: secret resolved; checking DB reachability (dry-run, no changes applied)…"
  if supabase db push --db-url "$CLIENT_DB_URL" --dry-run >/dev/null 2>&1; then
    echo "✓ $SLUG is usable (1Password resolved + DB reachable)."
  else
    echo "✗ $SLUG check failed: secret resolved, but could not connect to the DB." >&2
    exit 1
  fi
  exit 0
fi

echo "⚠  Provisioning client '$SLUG' → a NEW Supabase Cloud project. Seed is NEVER run here."
read -r -p "   Type '$SLUG' to confirm: " ans
if [ "$ans" != "$SLUG" ]; then
  echo "Aborted." >&2
  exit 1
fi

echo "→ Linking repo to the target project…"
supabase link --project-ref "$OP_CLIENT_PROJECT_REF"

echo "→ Applying migrations…"
supabase db push --db-url "$CLIENT_DB_URL"

echo "→ Deploying edge functions (agent-chat, compose-view, agent-dispatch — deployed, flag-OFF by default)…"
supabase functions deploy agent-chat compose-view agent-dispatch

echo "→ Setting secrets (names only — values from THIS shell's env, never a file)…"
: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY in this shell (op-get.sh) before running.}"
supabase secrets set OPENROUTER_API_KEY="$OPENROUTER_API_KEY"

echo "→ Creating the org row + first Admin (idempotent — reports 'already provisioned' if the slug exists)…"
node scripts/lib/provisionOrgAdmin.mjs --slug "$SLUG" --db-url "$CLIENT_DB_URL"

echo ""
echo "── Manual steps remaining (this script cannot do these) ──"
echo "  1. Cloudflare Pages: create/branch a project for '$SLUG', set Production env vars:"
echo "       VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_ENV=prod"
echo "       (VITE_POSTHOG_KEY/VITE_POSTHOG_HOST if analytics is licensed; NEVER VITE_DEMO_MODE)"
echo "  2. Confirm the Supabase dashboard shows Pro plan + daily backups enabled (ADR-0047/MVP item 5)."
echo "  3. Invite the first Admin's real email via 'supabase auth-admin invite' (MVP item 1a dependency —"
echo "     until the ops-admin invite fn ships) — requires SMTP (MVP item 2 dependency) to deliver."
echo ""
echo "→ Running the readiness check…"
node scripts/check-client-readiness.mjs || echo "⚠  Some readiness checks failed/skipped — see above."

echo ""
echo "→ Registry row for docs/environments.md (public-safe — paste manually):"
node scripts/lib/provisionRegistryRow.mjs --slug "$SLUG" # emits the row per FR-PROV-009
```

> **Implementer note:** `scripts/lib/provisionOrgAdmin.mjs` (the org-row + first-Admin creation step,
> FR-PROV-006/007) is a small additional Node script this task also creates — it takes `--slug` +
> `--db-url`, does a service-role `select` for an existing `organizations` row with that slug
> (idempotent re-run check, NFR-ONB-002/PROV-E002), and if absent inserts the org + prints the exact
> `supabase auth-admin invite` command for the operator to run (FR-PROV-007 v1). This is a genuinely
> separate 2–5 min task from the shell orchestration above — build it as Task 5.8 below.

**Verify (syntax check only — the live run is the documented manual dry-run, Task 5.9):**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && bash -n scripts/provision-client.sh
chmod +x scripts/provision-client.sh
```

### Task 5.8 — Implement: `scripts/lib/provisionOrgAdmin.mjs` (org + first-Admin, idempotent)

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/provisionOrgAdmin.mjs`:

```javascript
#!/usr/bin/env node
/**
 * provisionOrgAdmin.mjs — creates the org row for a new client (FR-PROV-006), idempotently
 * (PROV-E002: an existing slug reports "already provisioned", no duplicate). The first-Admin
 * step (FR-PROV-007 v1) is printed as the documented `supabase auth-admin invite` command —
 * this script does NOT itself call auth-admin (that's a `supabase` CLI concern, not a
 * service-role Postgres write); v2 (once the ops-admin invite fn ships, MVP item 1a) will call
 * that fn's edge endpoint instead of printing the manual command.
 */
import pg from 'pg';

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  return { slug: get('--slug'), dbUrl: get('--db-url') };
}

export async function createOrgIfAbsent(client, slug, name) {
  const existing = await client.query('select id from organizations where slug = $1', [slug]);
  if (existing.rows.length > 0) {
    return { action: 'already-provisioned', orgId: existing.rows[0].id };
  }
  const inserted = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [name, slug],
  );
  return { action: 'created', orgId: inserted.rows[0].id };
}

async function main(argv) {
  const { slug, dbUrl } = parseArgs(argv);
  if (!slug || !dbUrl) { console.error('✗ --slug and --db-url are required.'); process.exit(1); }
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const result = await createOrgIfAbsent(client, slug, slug);
  if (result.action === 'already-provisioned') {
    console.log(`✓ Org '${slug}' already provisioned (org_id=${result.orgId}). No duplicate created.`);
  } else {
    console.log(`✓ Org '${slug}' created (org_id=${result.orgId}).`);
    console.log('→ First-Admin step (FR-PROV-007 v1, until the ops-admin invite fn ships):');
    console.log(`    supabase auth-admin invite <admin-email> --project-ref <ref>`);
    console.log(`  Then insert the linked profiles row (role=Admin, org_id=${result.orgId}, status=active).`);
    console.log('  NOTE: the invite email requires SMTP (MVP item 2 — dependency; not wired v1).');
  }
  await client.end();
}

const isMain = process.argv[1] && process.argv[1].endsWith('provisionOrgAdmin.mjs');
if (isMain) main(process.argv.slice(2));
```

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/scripts/lib/provisionOrgAdmin.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrgIfAbsent } from './provisionOrgAdmin.mjs';

function makeFakeClient(existingRows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('select')) return { rows: existingRows };
      return { rows: [{ id: 'new-org-id' }] };
    },
  };
}

test('PROV-E002 / AC-PROV-007: an existing slug reports already-provisioned, does not INSERT', async () => {
  const client = makeFakeClient([{ id: 'existing-org-id' }]);
  const result = await createOrgIfAbsent(client, 'acme-co', 'Acme Co');
  assert.equal(result.action, 'already-provisioned');
  assert.equal(result.orgId, 'existing-org-id');
  assert.ok(!client.calls.some((c) => c.sql.startsWith('insert')));
});

test('AC-PROV-007: an absent slug creates exactly one organizations row', async () => {
  const client = makeFakeClient([]);
  const result = await createOrgIfAbsent(client, 'new-co', 'New Co');
  assert.equal(result.action, 'created');
  assert.equal(result.orgId, 'new-org-id');
  assert.equal(client.calls.filter((c) => c.sql.startsWith('insert')).length, 1);
});
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/provisionOrgAdmin.test.mjs
```

### Task 5.9 — `supabase/op.<client-slug>.env.template` + docs/environments.md registry convention

Create `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/supabase/op.CLIENT-SLUG.env.template`:

```bash
# Coordinates ONLY (not secret) — copy to supabase/op.<slug>.env per new client, fill in the
# 1Password item name + project ref. The actual DB URL lives in 1Password vault AS, field "URL".
OP_CLIENT_ITEM="pmo-supabase-<slug>"
OP_CLIENT_VAULT="AS"
OP_CLIENT_FIELD="URL"
OP_CLIENT_PROJECT_REF="<the Supabase Cloud project ref for this client>"
```

Edit `/Users/ariefsaid/Coding/PMO-worktrees/onboarding/docs/environments.md`: add a subsection after
the existing "Registry" table documenting the per-client provisioning convention (append, do not
rewrite existing rows):

```markdown
## Per-client provisioning (real production, GTM — ADR-0047)

Each paying client gets its OWN Supabase Cloud Pro project + Cloudflare Pages project (never the
legacy `prod` cloud project above, which is reclassified staging/demo). Provisioned via
`scripts/provision-client.sh <slug>` (typed-confirm + op-get.sh + `--check` read-only mode, mirrors
`db-push-prod.sh`). Manual-vs-CLI split, readiness check, and registry-row convention:
`docs/plans/2026-07-04-onboarding-tooling.md` §Slice 5 + `docs/specs/onboarding-tooling.spec.md`.

| Client slug | Project ref | API URL | Anon key | Frontend | Migrations | Seed |
|---|---|---|---|---|---|---|
| _(one row per client, appended by provision-client.sh's registry-row emit — never a secret)_ | | | | | | |
```

**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && grep -c "Per-client provisioning" docs/environments.md
```

### Task 5.10 — Documented manual dry-run (AC-PROV-001, AC-PROV-003, AC-PROV-007) — against a scratch project

This is the pipeline verification the spec requires as documented-manual (a live Supabase Cloud
project + 1Password cannot run in CI). Record evidence in this plan's Evidence section when executed
against a real scratch project (owner-provisioned, not the local Docker stack — this exercises the
CLOUD path specifically):

1. `scripts/provision-client.sh scratch-test --check` → confirm output ends "✓ scratch-test is usable" and no state changed (verify via `supabase db push --dry-run` exit code 0, no tables modified).
2. `scripts/provision-client.sh scratch-test` with a WRONG typed confirm → confirm it aborts before `supabase link`/`db push` (AC-PROV-002, already unit-proven; this is the live confirmation the shell wiring matches).
3. `scripts/provision-client.sh scratch-test` with the correct confirm → confirm exactly one `organizations` row + one manual-invite print.
4. Re-run `scripts/provision-client.sh scratch-test` (correct confirm again) → confirm "already provisioned", no duplicate org row (AC-PROV-003/007).

### Task 5.11 — Full verify for Slice 5

```bash
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding && node --test scripts/lib/*.test.mjs scripts/check-client-readiness.test.mjs
cd /Users/ariefsaid/Coding/PMO-worktrees/onboarding/pmo-portal && npm run verify
```

---

## Traceability table (every AC exactly once)

| AC id | Owning test / evidence | Slice | Layer |
|---|---|---|---|
| AC-PROV-001 | Task 5.10 step 1 | 5 | documented manual |
| AC-PROV-002 | Task 5.1 `provisionConfirm.test.mjs` | 5 | Unit |
| AC-PROV-003 | Task 5.10 step 4 | 5 | documented manual |
| AC-PROV-004 | Task 5.5 (reuses `classifyProbeResult`) | 5 | Unit |
| AC-PROV-005 | Task 5.5 (reuses `classifyEnvSecrets`) | 5 | Unit |
| AC-PROV-006 | Task 5.3 `provisionRegistryRow.test.mjs` | 5 | Unit |
| AC-PROV-007 | Task 5.8 `provisionOrgAdmin.test.mjs` + Task 5.10 step 3 | 5 | Unit + documented manual |
| AC-IDEM-001 | Task 1.1 pgTAP `0123_import_provenance_skip_query.test.sql` | 1 | pgTAP |
| AC-IDEM-002 | Task 1.5 `commit.test.ts` (AC-IDEM-002 describe block) | 1 | Unit |
| AC-IDEM-003 | Task 1.5 `commit.test.ts` (AC-IDEM-004 block, exact re-run) + Slice 4 Task 4.4 step 4 live re-run | 1 | Unit + documented manual |
| AC-IDEM-004 | Task 1.5 `commit.test.ts` (AC-IDEM-004 describe block) | 1 | Unit |
| AC-IDEM-004a | Task 1.5 `commit.test.ts` (AC-IDEM-004a describe block) | 1 | Unit |
| AC-IDEM-005 | Task 2.1 `dryRunConflictReport.test.ts` | 2 | Unit |
| AC-IDEM-006 | Task 1.1 pgTAP `0123_import_provenance_skip_query.test.sql` | 1 | pgTAP |
| AC-IDEM-007 | Task 1.9 full `npm run verify` + `supabase test db` | 1 | full regression gate |
| AC-HIST-001 | Task 4.1 `historicalImportGate.test.mjs` | 4 | Unit |
| AC-HIST-002 | Task 3.1 `historicalImportValidate.test.mjs` | 3 | Unit |
| AC-HIST-003 | Task 4.4 step 1 | 4 | documented manual |
| AC-HIST-004 | Task 4.4 step 2 | 4 | documented manual |
| AC-HIST-004a | Task 4.4 step 3 | 4 | documented manual |
| AC-HIST-005 | Task 3.5 `historicalImportResolve.test.mjs` (`buildProvenanceEvent`) + Task 4.4 step 5 | 3 + 4 | Unit + documented manual |
| AC-HIST-006 | Task 4.4 step 4 | 4 | documented manual |
| AC-HIST-007 | Task 3.5 `historicalImportResolve.test.mjs` (`resolveOrCreateStub`) | 3 | Unit |
| AC-HIST-008 | Task 3.3 `historicalImportSummary.test.mjs` (`buildSummary`) | 3 | Unit |
| AC-HIST-009 | Task 3.3 `historicalImportSummary.test.mjs` (`warnIfOlderThanOneYear`) | 3 | Unit |
| AC-HIST-010 | Task 4.4 step 6 | 4 | documented manual |

**Every AC in the spec's traceability table (§"Test strategy") appears exactly once above.** No AC is
claimed at two owning layers except where the spec itself splits the owning layer (AC-IDEM-003,
AC-HIST-005 — both explicitly listed in the spec as "documented manual + Unit", carried through here
unchanged per the spec's own "Test-layer note (honest)").

---

## Evidence (filled in as slices execute — placeholders left EMPTY, not fabricated)

- Slice 1 pgTAP run: `supabase test db` → **All tests successful. Files=137, Tests=1093, Result: PASS**
  (includes `0129_import_provenance_skip_query.test.sql` — 9 assertions, incl. the fix-round A4
  DB-unique-index proofs: a duplicate `(org_id, import_key, import_batch_id)` insert raises 23505, and
  the same import_key in a different batch is allowed).

- **Slice 4 / D3 loader LIVE dry-run + real load (fix-round B5, executed 2026-07-06 against the local
  Docker stack, org `00000000-0000-0000-0000-000000000001` "Default Organization" for the dry-run and a
  disposable scratch org `99999999-…-009` for the real non-dry-run, since torn down):**

  `node scripts/import-historical.mjs --org-id … --file scripts/templates/projects.csv --dry-run`
  ```
  [dry-run] no writes will be performed (org: Default Organization).
  import_batch_id: 11111111-1111-1111-1111-111111111111
  ⚠ PRJ-2024-011: date 2025-03-15 is more than 1 year before the run date — summary-grade scope is ≤ 1yr (advisory only, not blocked).
  projects:
    projects: created: 1, skipped: 0, failed: 0
  cases:
    cases: created: 0, skipped: 0, failed: 0
  references: resolved 1, created 0
  ```

  `node scripts/import-historical.mjs --org-id … --file scripts/templates/procurement_cases.csv --dry-run`
  ```
  cases:
    cases: created: 1, skipped: 0, failed: 0
  records by type:
    PR: created: 1, skipped: 0, failed: 0
    PO: created: 1, skipped: 0, failed: 0
    VI: created: 1, skipped: 0, failed: 0
  references: resolved 1, created 0
  ```

  **Real non-dry-run, all 7 record types (PR/RFQ/Quotation/PO/GR/VI/Payment) into the scratch org,
  RUN 1 (creates):**
  ```
  cases:  cases: created: 1, skipped: 0, failed: 0
  records by type:
    PR: created: 1        RFQ: created: 1       Quotation: created: 1
    PO: created: 1        GR: created: 1        VI: created: 1        Payment: created: 1
  references: resolved 1, created 1
  ```

  **RUN 2, SAME batch-id — re-run safety (FR-HIST-011 / AC-HIST-006), creates ZERO:**
  ```
  cases:  cases: created: 0, skipped: 1, failed: 0
  records by type:
    PR: skipped: 1   RFQ: skipped: 1   Quotation: skipped: 1   PO: skipped: 1
    GR: skipped: 1   VI: skipped: 1    Payment: skipped: 1
  ```

  **Post-load DB verification (AC-HIST-004a project linking + FK settlement, no duplicates after 2 runs):**
  ```
  procurements: 1 (project_id set: 1)     -- case linked to PRJ-B5 (committed-spend basis)
  purchase_requests: 1                     quotations: 1 (vendor_id set: 1)   -- vendor stub resolved
  receipts: 1 status=Complete              invoices: 1 amount=50000.00
  payments: 1 (invoice_id set: 1)          -- Payment.invoice_id settled to the VI (FK)
  ```
  Proves: all 7 record types load without error via schema-correct raw inserts (B1); the case links to
  its project by project_code (B3, AC-HIST-004a); vendors stub-resolve (B3); a same-batch re-run creates
  0 (B2). NOTE: the loader writes via service-role RAW INSERTS, not the `create_*` RPCs — those RPCs are
  role-gated on `auth_role()`/`auth.uid()`, both NULL under a service-role connection, so an RPC call
  would raise "not authorized"; raw inserts stamp `org_id` + provenance directly and the DB
  partial-unique index (0072) still enforces idempotency (see the escalation note in the fix-round report).

- Slice 1 `npm run verify`: _(paste summary here)_
- Slice 5 manual dry-run (Task 5.10): _(paste the 4-step scratch-project run here — requires a real
  scratch Supabase Cloud project; owner must provision one or approve using a disposable free-tier
  project for this verification only)_

---

## Open questions for the Director / owner (flagged, not resolved unilaterally)

1. **Slice 5's live dry-run (Task 5.10) needs a real scratch Supabase Cloud project.** The spec
   requires this as "documented manual, not CI" — but unlike Slice 4 (which can use the local Docker
   stack, itself a legitimate Supabase environment), Slice 1's confirm/`--check`/link/`db push`
   sequence is meaningfully different against a **cloud** project (IPv6/pooler quirks, `supabase
   link`, actual Pro-plan/backup confirmation) than against local Docker. Recommend: either (a) the
   owner provisions one disposable free-tier or Pro-trial Supabase Cloud project for this one-time
   verification, or (b) the Director accepts Task 5.10 as "verified against local Docker stack only,
   cloud-specific steps (link, Pro-plan confirm, CF env) verified by code-reading + the existing
   `db-push-prod.sh` precedent it mirrors" and defers the full cloud dry-run to the FIRST REAL CLIENT
   PROVISIONING (which will exercise it for real, with a real stake). Flagging rather than deciding —
   this is a resourcing/cost tradeoff, not an engineering one.
2. **`scripts/import-historical.mjs`'s `groupRows` import from a `.ts` file (Task 4.3's implementer
   note).** No existing `scripts/*.mjs` imports TypeScript directly. The plan defers the exact
   mechanism (tsx/ts-node vs. a copied-inline `.mjs` mirror) to build time with an explicit
   instruction to check precedent first — flagged because it's a real decision point, not because
   it's ambiguous in the spec (FR-HIST-008 just says "reuse the pure layer", which either approach
   satisfies).
3. **Migration/pgTAP numbering collision risk.** `0068`/`0123` are correct **per this plan's own
   reading of the `ops-admin` and `obs-floor` sibling-worktree plans**, and as of this fix round
   those two plans' own documents were re-read and independently agree with each other's stated
   reservations (`ops-admin` → `0058`–`0066` / `0110`–`0121`; `obs-floor` → `0067` only / `0122`
   only) — i.e. the three plans are in **plan-vs-plan agreement** on paper. This is not the same as
   a live check of what has actually landed on `dev` at merge time; if either sibling plan's author
   changes their reservation, or lands additional migrations, before this ships, this plan's
   `0068`/`0123` need a mechanical rename — flagged as a merge-order risk for the Director to sequence
   (whichever of the three onboarding/`ops-admin`/`obs-floor` PRs merges to `dev` LAST should re-check
   the numbering is still free immediately before opening its PR).
4. **RPC signature reconstruction for Task 1.2 — RESOLVED this fix round.** The prior draft's bodies
   were reconstructed from TypeScript call-site inference and were wrong in three ways (wrong
   `create_payment` body — pre-0039 instead of 0039; wrong `create_procurement_receipt` gate — the old
   wide 4-role gate instead of 0018's tightened requester-OR-PM-OR-Admin gate; `text`-typed `p_status`
   instead of the real enum types, which would have made the `DROP FUNCTION` calls silent no-ops).
   Task 1.2 now has a MANDATORY blocking precondition (Task 1.2-pre) that dumps the live
   `pg_get_functiondef` output and transcribes bodies from it, byte-for-byte apart from the three
   appended params. No longer an open question — implementers must still run Task 1.2-pre's command
   themselves before writing the migration (the dump, not this document, is authoritative if they
   ever disagree).
