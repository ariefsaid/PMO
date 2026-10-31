# Billing kinds - implementation plan (#1471)

Spec: [`docs/specs/billing-kinds.spec.md`](../specs/billing-kinds.spec.md) (signed off in #1470). Decision: #1443 / bug #1046. Map: #1442.
Gate (from the issue): **money path**. Sol review + mutation checks + pgTAP for the kind-correction RPC. One PR to dev.
Role contract: `.claude/agents/eng-planner.md`. Executor: an Orca worker per `docs/orca-dispatch.md` (money-path tier, so Director-dispatched, never batched with other branches).

Everything below was checked against `origin/dev` at `e1576dcc5` (migration head `0407_role_scoped_bypass_predicate.sql`).

## Open questions (answer before dispatch, or accept the stated default)

**Director, 2026-10-31:** all four defaults accepted. Migration number: billing kinds takes 0408; document preview takes 0409 (re-check with `scripts/check-migration-collisions.sh` before the PR).

| # | Question | Default taken in this plan |
|---|---|---|
| Q1 | A link/assign call that **omits** the kind on an invoice that already carries `other`: keep `other`, or reset to `contract`? FR-002 says "omitted ⇒ Contract", but a silent flip changes a classification Finance chose. | **Keep the stored kind** (`coalesce(p_billing_kind, current)`). For every row that was never classified, stored = `contract`, so FR-002 holds. The UI always sends the kind, so only a legacy/other caller can hit this. |
| Q2 | Row-menu label for an already-linked adopted invoice stays **"Change project"** (existing tests and the AC-PFIN-016 journey use it) and the dialog gains the kind control. Native / PMO-authored linked invoices get a new item **"Change billing kind"** (project locked). OK, or one label "Change project or billing kind" everywhere? | Keep "Change project"; add "Change billing kind". Label-only, cheap to flip. |
| Q3 | AC-002 says margin = 700. Margin is derived in the FE (`deriveMargin`, `pmo-portal/src/lib/projectFinances.ts`) from `work_revenue` and `actuals.total`; SQL never returns a margin. | pgTAP (the owning layer) asserts the two inputs, 900 and 200, and that the contract fields are 600 / 400. 900 − 200 = 700 is the existing `deriveMargin` arithmetic, which this slice does not touch and whose existing test stays. If the Director wants margin asserted end to end, AC-010 (e2e) already reads revenue/margin before and after. |
| Q4 | AC-009's owning test is `pmo-portal/src/hooks/useRevenue.billingKinds.test.ts`; hook tests here use `renderHook` with a wrapper (existing sibling is `.tsx`). | Create it as `.test.tsx` (React.createElement wrapper would also work in `.ts`; either is fine, only the AC id in the title matters). |

## Spec deltas found while verifying (none change a requirement; builder must use the corrected fact)

1. The spec cites `get_project_finances` as defined in `0376_cost_attribution.sql`. The **live** definition is `supabase/migrations/0392_invoice_settlement_basis.sql` (it supersedes 0376). Base the new migration on 0392.
2. The spec says `SalesInvoices.tsx` "includes `SalesInvoiceFormModal`". It lives in `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx`; its validation types in `pmo-portal/pages/sales-invoices/invoiceDraftValidation.ts`.
3. The spec says `pmo-portal/src/lib/projectInvoicing.ts` "contains a contract-summary helper". At dev it is a 2-line file exporting only `REVENUE_STATUSES`. **Nothing to align; leave it untouched.** No second calculation authority exists in the FE: the only calculation is `get_project_finances`.
4. `sales_invoices` INSERT/UPDATE are **column-level** grants (`0176`, snapshot semantics: a column added later is *not* client-writable until granted). So `billing_kind` is born server-write-only; this plan adds **no** grant and asserts that (T3.4).
5. Connected creation does not insert the PMO row from the client. The FE dispatches a command; the PMO row is inserted by the service-role mirror writer `upsertSalesInvoiceMirror` in `supabase/functions/adapter-dispatch/readModelWriters.ts` (create branch, line ~721). That is the connected-creation seam for the kind, not `adapter-dispatch/index.ts`.

## Architecture decision

**No ADR.** The decision is a reversible column plus two narrow RPCs on an existing table, inside the repository/RPC/RLS patterns of ADR-0016/0017/0019. Record it as one entry in `docs/decisions.md` (**DD-BKIND-1**, T9.2), not an ADR. Nothing here is irreversible or cross-cutting beyond what ADR-0010/0017/0019 already rule.

### Design (one decision each)

- **D1 Storage.** `sales_invoices.billing_kind text not null default 'contract' check in ('contract','other')`. Not an enum type (an enum value cannot be dropped on rollback; a text check can). No index: every read is already scoped by `org_id + project_id` and a project has few invoices.
- **D2 One calculation authority.** `get_project_finances` is the only place contract billing is computed. Its `contract_rows` CTE gains `where i.billing_kind = 'contract'`. `inv`, `work`, settlement, outstanding, cash and margin inputs keep reading `invoice_rows` (both kinds) - so FR-007 holds by construction and a kind-only correction cannot move them.
- **D3 Excess contributors ride in the same RPC payload.** A new additive key `contract_excess` (`null` unless comparable contract billing exceeds a known contract value) carries the exact excess, the contract billing total and **every** contributing contract invoice (id, number, date, normalized contribution). It is built from the same `contract_rows` CTE in the same statement, so the list reconciles to `contract_billing` by construction (FR-009), cannot be truncated by PostgREST `max_rows` (one jsonb scalar, NFR-003), needs no second request / N+1, and is the same snapshot as the headline number. No separate contributors RPC, no pagination.
- **D4 Writes.** Three server paths, all `SECURITY DEFINER`, Admin/Finance + active member + caller org:
  - `assign_sales_invoice_project(p_si_id, p_project_id, p_billing_kind default null)` - adopted ERP invoices only (unchanged restriction); project + kind in **one** `UPDATE` so history gets one event carrying both.
  - `set_sales_invoice_billing_kind(p_si_id, p_billing_kind)` - **new**, kind only, any already-linked invoice (native, adopted, paid, authored); touches no other column; never touches the outbox.
  - `create_native_sales_invoice(..., p_billing_kind default null)` - kind in the same `INSERT`.
  Both replaced functions are `drop`ped and recreated with the new default parameter (a `create or replace` with a different argument list would leave the old overload callable and ambiguous for PostgREST). Old positional callers keep working through the default.
- **D5 Connected creation.** The command record gains optional `billingKind`; the mirror writer's create branch writes it **only if it is exactly `'contract'` or `'other'`** (anything else is ignored → column default). It is never put in an ERP body (`siToBody` picks fields explicitly; a test pins that). Update/transition/inbound-adopt branches do not mention the column, so an explicit PMO kind survives every ERP refresh (FR-012).
- **D6 Permissions.** Reuse the existing `assign_project` action on `salesInvoice` (`pmo-portal/src/auth/policy.ts:532`, `allow(REVENUE_WRITE)`). No new action; `can()` stays UX-only, the RPCs enforce.
- **D7 History.** `record_history_config.captured` for `sales_invoice` gains `"billing_kind":"enum"` (the catalog gate `record_changes_catalog_gate.test.sql` fails the build on an unclassified column). The generic trigger writes one old/new event and none when the value is unchanged. FE history field map + labels get the new column.
- **D8 Mirror guard.** `sales_invoices_native_mirror_guard` is re-created from the 0290 body with one extra line pinning `billing_kind` while ERP owns revenue, mirroring how 0290 treats `project_id` (`current_user <> 'postgres'`, i.e. only the definer RPCs may change it). Defence in depth; the column grant already blocks direct client writes.
- **D9 Raise-invoice affordance.** `ProjectSections.tsx:249` (`RaiseInvoiceAction`) reads `remaining_to_invoice`; it now sees the contract-only remainder, which is the intended fix (Other billing no longer hides "Raise invoice"). No code change; noted so the reviewer expects the behaviour change.

## Verified citations (all present at origin/dev)

| Cited | Where | Checked |
|---|---|---|
| `get_project_finances` (live) | `supabase/migrations/0392_invoice_settlement_basis.sql` L1–340; `contract_rows` L58–66; `contract_sum` L67–69; result keys L295–303 | read |
| `assign_sales_invoice_project(uuid,uuid)` | `supabase/migrations/0290_project_finances.sql` L76–112 | read |
| `sales_invoices_native_mirror_guard` (live) | `0290_project_finances.sql` L31–74 | read; no later `create function` (grep) |
| `fill_sales_invoice_project` | `0290_project_finances.sql` L187–212 | read |
| `create_native_sales_invoice(uuid,uuid,jsonb,uuid)` | `0275_native_revenue.sql` L189–307 (only definition) | read |
| `record_history_config` `sales_invoice` row | `0278_invoice_change_history.sql` L7–11; updated `0290` L114–117 | read |
| Catalog gate | `supabase/tests/record_changes_catalog_gate.test.sql` | read |
| Column-level grants | `0176_create_path_sod_residuals.sql` L118–128 | read |
| Mirror writer create branch | `supabase/functions/adapter-dispatch/readModelWriters.ts` L653–746 (`upsertSalesInvoiceMirror`) | read |
| Inbound adopt insert | `supabase/functions/_shared/erpnextFeedDeps.ts` L483 | read; never names the column |
| Command builder | `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts` (19 lines, leaf, Deno-importable) | read |
| ERP body | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts` `siToBody` | read; explicit field picks |
| DAL | `pmo-portal/src/lib/db/revenue.ts` (`SalesInvoiceRow` L10; `setSalesInvoiceProject` L308; `getProjectFinances` L~323) | read |
| Native DAL | `pmo-portal/src/lib/db/revenueNative.ts` `createNativeSalesInvoice` L74 | read |
| Native repo adapter | `pmo-portal/src/lib/repositories/revenueNative.ts` `createNativeInvoice` L33 | read |
| Repository wiring | `pmo-portal/src/lib/repositories/index.ts` L713–730; interface `types.ts` L531–578 | read |
| Hook | `pmo-portal/src/hooks/useRevenue.ts` `useAssignInvoiceProject` L229–252; `useRevenueMutations.create` L130 | read |
| Finance payload type + guard | `pmo-portal/src/lib/projectFinances.ts` (`ProjectFinances` L25, `AssignInvoiceProjectInput` L240, `isProjectFinances` L342) | read |
| Finance UI | `pmo-portal/pages/project-detail/ProjectFinancesSection.tsx` | read |
| Assignment dialog | `pmo-portal/src/components/InvoiceProjectModal.tsx` (+ `.test.tsx`) | read |
| Create form | `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx`, `invoiceDraftValidation.ts` (`FormValues` L24) | read |
| Page wiring | `pmo-portal/pages/SalesInvoices.tsx` L156, L508–516, L797–832 | read |
| Attribution predicate | `pmo-portal/src/lib/invoiceProjectAssignment.ts` `canAttributeInvoice` | read |
| Policy | `pmo-portal/src/auth/policy.ts` L38 (`assign_project`), L509–532 | read |
| History FE | `pmo-portal/src/components/history/historyFields.ts` L36–40, `historyLabels.ts`, `useHistoryEnumLabel.ts` | read |
| Invoice route | `pmo-portal/App.tsx` L222 `/sales-invoices/:invoiceId` | read |
| Select primitive | `pmo-portal/src/components/ui/FormFields.tsx` `SelectField` (has `helper`, `error`) | read |
| Retained-definer count | `supabase/tests/0178_anon_executable_definers.test.sql` (88 names, L142–L270) | read |
| Isolation denominator | `scripts/isolation-probe-denominator.json` (signature list ~L155, ~L181; class entries ~L380) | read |
| Native ACL test | `supabase/tests/0275_native_revenue_acl.test.sql` L9, L16, L23 (4-arg regprocedure) | read |
| Rollback pattern | `supabase/migrations/rollback/0290_project_finances_down.sql`, `supabase/tests/0290_project_finances_down_runner.sql`, `0290_project_finances_rollback.test.sql` | read |

`scripts/prior-art.sh billing_kind` and `'Remaining to invoice'`: no shipped prior art for a billing kind; the live calculation and write paths are the ones listed above (#786, #785 closed; #1046 open = this slice).

## Migration number

**0408** (`0408_billing_kinds.sql` + `rollback/0408_billing_kinds_down.sql`). No remote branch carries ≥0408 (checked all `origin/*` trees). The builder re-checks right before the PR: `scripts/check-migration-collisions.sh`; on collision `scripts/renumber-migration.sh 0408 <new>` (never hand-rename). Test file names that embed the number (`0408_billing_kinds_*`) are renumbered by that script.

## File map

| Action | Path |
|---|---|
| Create | `supabase/migrations/0408_billing_kinds.sql` |
| Create | `supabase/migrations/rollback/0408_billing_kinds_down.sql` |
| Create | `supabase/tests/billing_kinds.test.sql` |
| Create | `supabase/tests/billing_kinds_roles.test.sql` |
| Create | `supabase/tests/0408_billing_kinds_down_runner.sql` (generated from the down file) |
| Create | `supabase/tests/0408_billing_kinds_rollback.test.sql` |
| Modify | `supabase/tests/0178_anon_executable_definers.test.sql` (+1 name, count 88 → 89, amendment note) |
| Modify | `supabase/tests/0275_native_revenue_acl.test.sql` (5-arg signature, 3 places) |
| Modify | `scripts/isolation-probe-denominator.json` (new fn; changed signatures) |
| Create | `pmo-portal/src/lib/billingKind.ts` |
| Modify | `pmo-portal/src/lib/supabase/database.types.ts` |
| Modify | `pmo-portal/src/lib/db/revenue.ts` |
| Modify | `pmo-portal/src/lib/db/revenueNative.ts` |
| Modify | `pmo-portal/src/lib/repositories/revenueNative.ts`, `repositories/index.ts`, `repositories/types.ts` |
| Modify | `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts` |
| Modify | `supabase/functions/adapter-dispatch/readModelWriters.ts` |
| Modify | `pmo-portal/src/lib/projectFinances.ts` |
| Modify | `pmo-portal/src/hooks/useRevenue.ts` |
| Modify | `pmo-portal/src/components/InvoiceProjectModal.tsx` |
| Modify | `pmo-portal/pages/SalesInvoices.tsx` |
| Modify | `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx`, `invoiceDraftValidation.ts` |
| Modify | `pmo-portal/pages/project-detail/ProjectFinancesSection.tsx` |
| Modify | `pmo-portal/src/components/history/historyFields.ts`, `historyLabels.ts`, `useHistoryEnumLabel.ts` |
| Modify | `pmo-portal/public/locales/en/common.json`, `id/common.json`, `en/project.json`, `id/project.json` |
| Tests | see per-task lists and the traceability table |
| Docs | `docs/decisions.md` (DD-BKIND-1) |

## Conventions for every task

- Work in the issue's own worktree off `origin/dev`; branch `feat/billing-kinds`. DB commands only under the lock: `scripts/with-db-lock.sh <cmd>`. Reset and test in **one** hold: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`. Run `supabase` from the repo root.
- Test-first: write the test, run it, see it fail **for the stated reason**, then implement. Do not edit a pgTAP/Vitest assertion to match the code.
- Money assertions in pgTAP compare **as `numeric`** (`(...->>'x')::numeric`), never as text: the text form of a `numeric` depends on column scale.
- Test titles carry the AC id as the leading token (pgTAP descriptions and Vitest `it(...)`); supporting tests that are *not* an AC's owner lead with `FR-00x`/`NFR-00x` instead, so `grep -r AC-0xx` finds exactly one owner.
- Local gate before the PR (CLAUDE.md): `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched Vitest files only, touched pgTAP files only, `scripts/e2e-local.sh AC-010`, `scripts/ux-proof.sh` on touched routes. Never the full suite locally.
- No `Co-Authored-By`/attribution trailer; before push `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must find nothing.

---

## Phase 1 - Database (tasks T1–T10)

### T1 - Column, check, history classification, guard (AC-001)

**Files:** create `supabase/tests/billing_kinds.test.sql` (first block), create `supabase/migrations/0408_billing_kinds.sql` (§1).

- [ ] **T1.1 Write the failing test (AC-001, part 1).** Create `supabase/tests/billing_kinds.test.sql` with the shared fixture (reused by T2–T6) and the first assertions. Ids use the `0408…` prefix so they never collide with sibling tests. The fixture file is one transaction (`begin … rollback`), like the siblings.

```sql
begin;
create extension if not exists pgtap;
select plan(62);   -- recount in T6.3 if an assertion is added or dropped (pgTAP fails loudly on a mismatch)

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
insert into public.organizations (id,name) values
  ('04080000-0000-0000-0000-000000000001','Billing kinds org'),
  ('04080000-0000-0000-0000-000000000002','Billing kinds foreign org');
insert into auth.users (id,email) values
  ('04080000-0000-0000-0000-0000000000a1','bk-finance@example.test'),
  ('04080000-0000-0000-0000-0000000000a2','bk-admin@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('04080000-0000-0000-0000-0000000000a1','04080000-0000-0000-0000-000000000001','BK Finance','bk-finance@example.test','Finance','active'),
  ('04080000-0000-0000-0000-0000000000a2','04080000-0000-0000-0000-000000000001','BK Admin','bk-admin@example.test','Admin','active');
-- P1 main (contract 1000, exclusive, USD); P2 equality/other-only; P3 tax-basis; P4 spare (project change target)
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-000000000001','BK P1','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-1'),
 ('04080000-0000-0000-0000-0000000000d2','04080000-0000-0000-0000-000000000001','BK P2','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-2'),
 ('04080000-0000-0000-0000-0000000000d3','04080000-0000-0000-0000-000000000001','BK P3','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-3'),
 ('04080000-0000-0000-0000-0000000000d4','04080000-0000-0000-0000-000000000001','BK P4','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-4'),
 ('04080000-0000-0000-0000-0000000000d9','04080000-0000-0000-0000-000000000002','BK foreign','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-F');
-- Two invoices that OMIT the kind (the pre-existing / older-caller shape): one adopted ERP, one native.
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus) values
 ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1',
  'SI-BK-1','2026-01-01',400,0,'exclusive',0,'USD','Paid',1);
insert into public.sales_invoices (id,org_id,project_id,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,
                                   currency,status,native_lines,pmo_native,author_user_id,pmo_number) values
 ('04080000-0000-0000-0000-0000000000e2','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1',
  '2026-01-02',200,200,'exclusive',0,'USD','Unpaid','[{"description":"native"}]',true,'04080000-0000-0000-0000-0000000000a1','PMO-BK-1');

-- ── AC-001 ─────────────────────────────────────────────────────────────────────────────────────
select has_column('public','sales_invoices','billing_kind','AC-001 sales_invoices carries billing_kind');
select col_not_null('public','sales_invoices','billing_kind','AC-001 billing_kind is NOT NULL');
select is((select count(*)::int from public.sales_invoices
            where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2')
              and billing_kind = 'contract'), 2,
          'AC-001 adopted and native rows that omit the kind are Contract billing');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d1')->>'contract_invoiced')::numeric, 600::numeric,
          'AC-001 known contract total is unchanged for kind-less invoices');
select throws_ok($$insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,erp_docstatus,billing_kind)
                   values (gen_random_uuid(),'04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-BK-BAD',1,'exclusive',0,'USD','Unpaid',1,'bogus')$$,
                 '23514', null, 'AC-001 an invalid explicit kind is refused');
select throws_ok($$insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,erp_docstatus,billing_kind)
                   values (gen_random_uuid(),'04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-BK-NULL',1,'exclusive',0,'USD','Unpaid',1,null)$$,
                 '23502', null, 'AC-001 a null explicit kind is refused');
```
(The `get_project_finances` call needs an authenticated Finance claim; wrap the AC-001 money assertion and every later `get_project_finances` call with `set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}'; set local role authenticated;` … `reset role;` exactly as `supabase/tests/0290_project_finances_reads.test.sql` does. The `has_column`/constraint assertions run as the superuser.)

Verify it fails: `scripts/with-db-lock.sh supabase test db supabase/tests/billing_kinds.test.sql` → red, first failure "AC-001 sales_invoices carries billing_kind" (column missing).

- [ ] **T1.2 Implement migration §1.** Create `supabase/migrations/0408_billing_kinds.sql` starting with:

```sql
-- 0408_billing_kinds.sql - #1471: contract billing vs other billing on a project invoice (spec billing-kinds.spec.md).
-- Rollback: migrations/rollback/0408_billing_kinds_down.sql.

-- §1 storage. A text CHECK, not an enum type: an enum value cannot be dropped on rollback.
alter table public.sales_invoices
  add column billing_kind text not null default 'contract',
  add constraint sales_invoices_billing_kind_check check (billing_kind in ('contract','other'));
comment on column public.sales_invoices.billing_kind is
  '#1471 FR-001: PMO project attribution kind. contract = draws down the contract value; other = counts toward revenue and margin only. PMO metadata, never sent to the ERP. Written only by assign_sales_invoice_project / set_sales_invoice_billing_kind / create_native_sales_invoice / the mirror writer create branch.';

-- §2 history: classified once (catalog gate record_changes_catalog_gate.test.sql fails on an unclassified column).
update public.record_history_config
   set captured = captured || '{"billing_kind":"enum"}'::jsonb
 where entity_type = 'sales_invoice';
```
No grant statement: `authenticated` therefore has no INSERT/UPDATE on the new column (0176 snapshot semantics) - T3.4 proves it.

- [ ] **T1.3 Mirror guard.** Append §3 to the migration: re-create `public.sales_invoices_native_mirror_guard()` as a **verbatim copy** of `0290_project_finances.sql` lines 31–74 (`create or replace function … end; $$;`) with exactly one added line directly under the `project_id` line:

```sql
     or (new.billing_kind is distinct from old.billing_kind and current_user <> 'postgres') -- 0408 (#1471): only the definer RPCs change it
```
Extract the base mechanically, do not retype: `sed -n '31,74p' supabase/migrations/0290_project_finances.sql`. (The trigger binds by OID; `create or replace` keeps it.)

- [ ] **T1.4 Verify.** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds.test.sql supabase/tests/record_changes_catalog_gate.test.sql supabase/tests/0278_invoice_change_history.test.sql'` → the AC-001 assertions pass **except** the contract-total one still depends on T5 only if the fixture needs filtering - it does not (kind-less rows are all contract), so it is green now. The catalog gate must be green (proves `billing_kind` is classified exactly once). Commit: `feat(db): billing_kind column, check, history classification, guard pin (#1471)`.

### T2 - Assignment carries the kind atomically (FR-003, supports AC-001)

**Files:** extend `billing_kinds.test.sql`; extend migration §4.

- [ ] **T2.1 Failing tests** (append; titles lead with `FR-003`, and the invalid-kind assertion with `AC-001`):

```sql
-- adopted ERP invoice with no project, unlinked: the "link" path
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus) values
 ('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-000000000001',null,'SI-BK-3','2026-01-03',50,50,'exclusive',0,'USD','Unpaid',1);
insert into public.external_domain_ownership (org_id,external_tier,domain) values ('04080000-0000-0000-0000-000000000001','erpnext','revenue');
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id)
 values ('04080000-0000-0000-0000-000000000001','revenue','04080000-0000-0000-0000-0000000000e3','erpnext','SI-BK-3');
delete from public.record_changes where entity_type='sales_invoice' and entity_id='04080000-0000-0000-0000-0000000000e3';
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d1','bogus')$$,
                 '23514', null, 'AC-001 assignment refuses an invalid kind and saves nothing');
select is((select project_id from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), null::uuid,
          'AC-001 the refused assignment left the invoice unlinked');
select lives_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d1','other')$$,
                'FR-003 assignment saves project and kind in one call');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other',
          'FR-003 the chosen kind persisted with the project');
reset role;
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e3' and changes ? 'project_id' and changes ? 'billing_kind'), 1,
          'FR-003 project and kind land in ONE history event (atomic)');
-- omitted kind (older callers): a never-classified row stays contract; a classified row keeps its kind (Q1)
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4')$$,
                'FR-003 the two-argument form still works for older callers');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other',
          'FR-003 an omitted kind keeps the stored kind when the project changes');
reset role;
```
Run: red ("function … does not exist" for the 3-arg form).

- [ ] **T2.2 Implement migration §4.** Append: `drop function public.assign_sales_invoice_project(uuid,uuid);` then re-create from the verbatim body of `0290_project_finances.sql` lines 76–112 with these edits (extract with `sed -n '76,112p'`, then edit):

```diff
-create function public.assign_sales_invoice_project(p_si_id uuid,p_project_id uuid) returns void
+create function public.assign_sales_invoice_project(p_si_id uuid,p_project_id uuid,p_billing_kind text default null) returns void
 language plpgsql security definer set search_path = public as $$
-declare v_si public.sales_invoices; v_role public.user_role := public.auth_role();
+declare v_si public.sales_invoices; v_role public.user_role := public.auth_role(); v_kind text;
 begin
   perform public.assert_is_active_member();
   -- PFIN_ASSIGN_ROLE_CHECK: mutation target; keep this exact marker and predicate.
   if v_role is null or v_role not in ('Admin','Finance') then
     raise exception 'not authorized' using errcode = '42501';
   end if;
+  if p_billing_kind is not null and p_billing_kind not in ('contract','other') then
+    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
+  end if;
   select * into v_si from public.sales_invoices where id = p_si_id for update;
 ...unchanged through the work-order / claim conflict check...
-  if v_si.project_id is not distinct from p_project_id then return; end if;
-  update public.sales_invoices set project_id = p_project_id where id = p_si_id;
+  v_kind := coalesce(p_billing_kind, v_si.billing_kind);   -- Q1: omitted keeps the stored kind (contract for never-classified rows)
+  if v_si.project_id is not distinct from p_project_id and v_kind = v_si.billing_kind then return; end if;
+  update public.sales_invoices set project_id = p_project_id, billing_kind = v_kind where id = p_si_id;
 end $$;
-alter function public.assign_sales_invoice_project(uuid,uuid) owner to postgres;
-revoke all on function public.assign_sales_invoice_project(uuid,uuid) from public,anon,authenticated;
-grant execute on function public.assign_sales_invoice_project(uuid,uuid) to authenticated;
+alter function public.assign_sales_invoice_project(uuid,uuid,text) owner to postgres;
+revoke all on function public.assign_sales_invoice_project(uuid,uuid,text) from public,anon,authenticated;
+grant execute on function public.assign_sales_invoice_project(uuid,uuid,text) to authenticated;
```
Keep the `PFIN_ASSIGN_ROLE_CHECK` marker text unchanged (the mutation harness for 0290 keys on it).

- [ ] **T2.3 Verify.** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds.test.sql supabase/tests/0290_assign_invoice_project.test.sql supabase/tests/0290_project_finances_reads.test.sql supabase/tests/0290_project_invoice_backfill.test.sql'` → all green (the 0290 tests call the 2-arg form; they stay as-is and must pass untouched). Commit.

### T3 - Kind-only correction RPC (AC-006) and the column is not client-writable

**Files:** extend `billing_kinds.test.sql`; extend migration §5.

- [ ] **T3.1 Failing tests (AC-006).** The paid adopted invoice `…e1` and the native `…e2` from the fixture are the subjects. At this point T2's `external_domain_ownership` row is still in place, i.e. an ERP owns revenue, so these calls also exercise the mirror-guard pin from T1.3 (the definer RPC must pass it, a direct client write must not). Append:

```sql
-- snapshot of every column except the kind, to prove nothing else moved
create temp table bk_before as
  select id, to_jsonb(si) - 'billing_kind' as row_data from public.sales_invoices si
   where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2');
grant select on bk_before to authenticated;
create temp table bk_outbox_before as select count(*)::int n from public.external_command_outbox;
grant select on bk_outbox_before to authenticated;
delete from public.record_changes where entity_type='sales_invoice'
   and entity_id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2');

set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$,
                'AC-006 Finance corrects the kind of a PAID adopted invoice on the same project');
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e2','other')$$,
                'AC-006 Finance corrects the kind of a native invoice');
select is((select jsonb_object_agg(id::text, to_jsonb(si) - 'billing_kind') from public.sales_invoices si
            where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2')),
          (select jsonb_object_agg(id::text, row_data) from bk_before),
          'AC-006 project, money, state, receipts fields and authorship are untouched');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'), 1,
          'AC-006 exactly one history event exists for the correction');
select is((select changes->'billing_kind' from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'),
          '{"old":"contract","new":"other"}'::jsonb, 'AC-006 the event records old and new kind');
select is((select actor_id from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'),
          '04080000-0000-0000-0000-0000000000a1'::uuid, 'AC-006 the event is attributed to the operator');
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$,
                'AC-006 the identical save repeats without error');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'), 1,
          'AC-006 the repeat produced no duplicate event');
select is((select count(*)::int from public.external_command_outbox), (select n from bk_outbox_before),
          'AC-006 no ERP command was enqueued');
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','bogus')$$,
                 '23514', null, 'AC-006 an invalid kind is refused');
-- an invoice with no project cannot carry a kind
reset role;
insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,erp_docstatus)
 values ('04080000-0000-0000-0000-0000000000e5','04080000-0000-0000-0000-000000000001',null,'SI-BK-5',1,'exclusive',0,'USD','Unpaid',1);
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e5','other')$$,
                 '23514', null, 'AC-006 an unlinked invoice is refused (attribute a project first)');
reset role;
-- restore the two subjects to contract for the aggregate blocks that follow
update public.sales_invoices set billing_kind='contract' where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2');
```
(The restore `update` runs as the superuser; it fires a history row which later blocks do not count.)
Run: red ("function set_sales_invoice_billing_kind does not exist").

- [ ] **T3.2 Implement migration §5.**

```sql
-- §5 kind-only correction: any already-linked invoice (native, adopted, authored, paid). Changes ONE column; never
-- touches the outbox, the body, receipts, authorship or approval. Admin/Finance, active member, caller's org.
create function public.set_sales_invoice_billing_kind(p_si_id uuid, p_billing_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_si public.sales_invoices; v_role public.user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  -- BKIND_ROLE_CHECK: mutation target; keep this exact marker and predicate.
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_billing_kind is null or p_billing_kind not in ('contract','other') then
    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
  end if;
  -- org filter in the SELECT: a foreign or missing invoice is the same P0002 (no existence signal).
  select * into v_si from public.sales_invoices where id = p_si_id and org_id = public.auth_org_id() for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_si.project_id is null then
    raise exception 'attribute a project to the invoice before choosing its billing kind'
      using errcode = '23514', detail = 'billing-kind-needs-project';
  end if;
  if v_si.billing_kind = p_billing_kind then return; end if;   -- identical save: no write, no history event
  update public.sales_invoices set billing_kind = p_billing_kind where id = p_si_id;
end $$;
alter function public.set_sales_invoice_billing_kind(uuid,text) owner to postgres;
revoke all on function public.set_sales_invoice_billing_kind(uuid,text) from public,anon,authenticated;
grant execute on function public.set_sales_invoice_billing_kind(uuid,text) to authenticated;
comment on function public.set_sales_invoice_billing_kind(uuid,text) is
  '#1471 FR-004: PMO-only billing-kind correction of an already-linked sales invoice. Admin/Finance; no ERP command.';
```

- [ ] **T3.3 Verify.** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds.test.sql'` → green.

- [ ] **T3.4 Client roles cannot write the column directly** (supports AC-007; title leads `AC-007` but lives in the roles file, T7). Nothing to implement: the absence of a grant is the control. Written in T7.

- [ ] **T3.5 Mutation check for T3 (mandatory, money gate).** Scratch copy only; never commit. With the DB up and the migration applied:
  1. `sed -i.bak "s/v_role not in ('Admin','Finance')/false/" supabase/migrations/0408_billing_kinds.sql` - makes every role check in the new/replaced functions a no-op. Then `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds_roles.test.sql'` must go **red** on the Executive/PM/Engineer rows (needs T7; run this check after T7 and again here for the correction RPC alone).
  2. Delete the line `if v_si.billing_kind = p_billing_kind then return; end if;` → the "no duplicate event" assertion is **expected to stay green**, because `record_change_capture` already swallows an update that changes nothing. Record that result in the PR as "belt and braces, confirmed by mutation"; the early return only saves a needless write.
  3. Change `update public.sales_invoices set billing_kind = p_billing_kind where id = p_si_id` to also set `status='Paid'` → the "untouched fields" assertion must go **red**.
  4. Remove `and org_id = public.auth_org_id()` from the SELECT → the foreign-org assertion in T7 must go **red**.
  After each: `git checkout -- supabase/migrations/0408_billing_kinds.sql && rm -f supabase/migrations/0408_billing_kinds.sql.bak`. Paste the four red/green results into the PR body.

### T4 - Native creation carries the kind (AC-011)

**Files:** extend `billing_kinds.test.sql`; extend migration §6; modify `supabase/tests/0275_native_revenue_acl.test.sql`.

- [ ] **T4.1 Failing tests (AC-011).** The native create needs a customer, ERP not owning revenue, VAT-off project. Use a separate org-state block: ownership row from T2 makes the org ERP-owned, so create this block **before** T2's `external_domain_ownership` insert, or `delete` that row first. Append (after deleting the ownership row):

```sql
delete from public.external_domain_ownership where org_id='04080000-0000-0000-0000-000000000001' and domain='revenue';
insert into public.companies (id,org_id,name,type) values
 ('04080000-0000-0000-0000-0000000000c1','04080000-0000-0000-0000-000000000001','BK Customer','Client');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
create temp table bk_new_ids (k text primary key, id uuid);
grant all on bk_new_ids to authenticated;
insert into bk_new_ids select 'omitted', public.create_native_sales_invoice(
  '04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-0000000000c1',
  '[{"description":"line","qty":1,"rate":10}]'::jsonb);
insert into bk_new_ids select 'other', public.create_native_sales_invoice(
  '04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-0000000000c1',
  '[{"description":"line","qty":1,"rate":20}]'::jsonb, null, 'other');
select is((select billing_kind from public.sales_invoices where id=(select id from bk_new_ids where k='omitted')), 'contract',
          'AC-011 an omitted kind persists as Contract billing');
select is((select billing_kind from public.sales_invoices where id=(select id from bk_new_ids where k='other')), 'other',
          'AC-011 an explicit Other billing choice persists with the project');
select is((select project_id::text from public.sales_invoices where id=(select id from bk_new_ids where k='other')),
          '04080000-0000-0000-0000-0000000000d1', 'AC-011 the project is saved atomically with the kind');
select ok((select pmo_native and status='Draft' and author_user_id='04080000-0000-0000-0000-0000000000a1'
             from public.sales_invoices where id=(select id from bk_new_ids where k='other')),
          'AC-011 the native body contract is unchanged: Draft, PMO-native, authored by the caller');
select is((select count(*)::int from public.sales_invoice_authors where sales_invoice_id=(select id from bk_new_ids where k='other')), 1,
          'AC-011 the author set row is still written');
create temp table bk_count_before as select count(*)::int n from public.sales_invoices;
grant select on bk_count_before to authenticated;
select throws_ok($$select public.create_native_sales_invoice('04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-0000000000c1',
                   '[{"description":"line","qty":1,"rate":30}]'::jsonb, null, 'bogus')$$,
                 '23514', null, 'AC-011 an invalid kind is refused');
select is((select count(*)::int from public.sales_invoices), (select n from bk_count_before),
          'AC-011 the refused create left no partial invoice');
reset role;
```
Run: red (5-arg form missing). Also run the existing `0275_native_revenue_create.test.sql`: it must stay green after T4.2 (4-arg calls resolve through the default).

- [ ] **T4.2 Implement migration §6.** `drop function public.create_native_sales_invoice(uuid,uuid,jsonb,uuid);` then re-create from the verbatim `0275_native_revenue.sql` lines 189–307 (function through `comment on function`), extracted with `sed -n '189,307p'`, with exactly these edits:

```diff
 create or replace function public.create_native_sales_invoice(
   p_project_id    uuid,
   p_customer_id   uuid,
   p_lines         jsonb,
-  p_work_order_id uuid default null
+  p_work_order_id uuid default null,
+  p_billing_kind  text default null
 ) returns uuid
 ...
   if v_role is null or v_role not in ('Admin','Finance') then
     raise exception 'only Finance or an Admin can raise a customer invoice' using errcode = '42501';
   end if;
+  if p_billing_kind is not null and p_billing_kind not in ('contract','other') then
+    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
+  end if;
 ...
   insert into public.sales_invoices
     (id, org_id, project_id, customer_id, work_order_id, reference_number, native_lines, amount, currency,
-     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id)
+     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id,
+     billing_kind)
   values
     (v_id, v_org, p_project_id, p_customer_id, p_work_order_id,
      coalesce(nullif(btrim(v_wo_po), ''), nullif(btrim(v_contract), '')),
      v_lines, v_amount, v_currency,
-     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid);
+     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid,
+     coalesce(p_billing_kind, 'contract'));
```
and replace every `(uuid, uuid, jsonb, uuid)` in the trailing `revoke`/`grant`/`comment` with `(uuid, uuid, jsonb, uuid, text)`. The insert must grant nothing new: `create_native_sales_invoice` is definer, so its insert is not subject to the column grants. Keep the migration-0275-style assertion block: append a `do $$` that fails the migration if `has_function_privilege('anon', 'public.create_native_sales_invoice(uuid,uuid,jsonb,uuid,text)', 'execute')` or `'public.set_sales_invoice_billing_kind(uuid,text)'` or `'public.assign_sales_invoice_project(uuid,uuid,text)'` is true for `anon`, or false for `authenticated`, or `prosecdef` is false (same shape as `0275` §9 lines 880–905).

- [ ] **T4.3 Fix the ACL sibling.** In `supabase/tests/0275_native_revenue_acl.test.sql` replace the three occurrences of `'public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'` with `'public.create_native_sales_invoice(uuid,uuid,jsonb,uuid,text)'`. This is a signature rename of the object under test, not a weakened assertion: the three checks (anon cannot execute, authenticated can, definer + pinned `search_path`) still apply to the same function.

- [ ] **T4.4 Verify.** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds.test.sql supabase/tests/0275_native_revenue_create.test.sql supabase/tests/0275_native_revenue_acl.test.sql supabase/tests/0275_revenue_write_roles.test.sql supabase/tests/line_pricing_parity.test.sql supabase/tests/0283_vat_flag_unlock.test.sql'` → green. Commit.

### T5 - Contract aggregate and excess contributors (AC-002, AC-003, AC-005)

**Files:** extend `billing_kinds.test.sql`; extend migration §7.

- [ ] **T5.1 Failing tests (AC-002).** Fresh fixture on **P1** (re-seat: delete the §T1 rows' effect by using a new project to keep earlier blocks independent). Use project `…d5` (add to the fixture project list: contract 1000, exclusive, USD) plus the actuals mapping from `0290_project_finances_reads.test.sql` L66–80 (one mapped category, Labor, one snapshot row of 200):

```sql
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('04080000-0000-0000-0000-0000000000d5','04080000-0000-0000-0000-000000000001','BK P5','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-5');
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target) values
 ('04080000-0000-0000-0000-000000000001','Labor','ACC-BK-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d5','ACC-BK-LABOR','FY-2026',200,'2026-10-01',
  '04080000-0000-0000-0000-0000000000b1','2026-10-02');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f1','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d5','SI-BK-C1','2026-02-01',600,100,'exclusive',0,'USD','Unpaid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000f2','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d5','SI-BK-O1','2026-02-02',300,0,'exclusive',0,'USD','Paid',1,'other');
-- then as Finance:
select is((public.get_project_finances('…d5')->>'contract_invoiced')::numeric, 600::numeric, 'AC-002 contract invoiced counts only Contract billing');
select is((public.get_project_finances('…d5')->>'remaining_to_invoice')::numeric, 400::numeric, 'AC-002 remaining is contract value minus contract billing');
select is((select (b->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('…d5')->'invoices') b where b->>'currency'='USD'),
          900::numeric, 'AC-002 total invoiced retains both kinds');
select is((select (b->>'work_revenue')::numeric from jsonb_array_elements(public.get_project_finances('…d5')->'invoices') b where b->>'currency'='USD'),
          900::numeric, 'AC-002 billed-work revenue retains both kinds');
select is((public.get_project_finances('…d5')->'actuals'->>'total')::numeric, 200::numeric, 'AC-002 complete same-currency cost is 200, so margin inputs give 900 − 200 = 700');
select is((select (b->>'outstanding')::numeric from jsonb_array_elements(public.get_project_finances('…d5')->'invoices') b where b->>'currency'='USD'),
          100::numeric, 'AC-002 outstanding retains both kinds');
select is((select (b->>'settled')::numeric from jsonb_array_elements(public.get_project_finances('…d5')->'invoices') b where b->>'currency'='USD'),
          800::numeric, 'AC-002 settlement retains both kinds (500 + 300)');
select is(public.get_project_finances('…d5')->'contract_excess', 'null'::jsonb, 'AC-002 no excess while contract billing is within the contract');
```
(Replace `…d5` with the full uuid; every call is made as the authenticated Finance claim. `settled` = gross − outstanding per invoice: 600−100 + 300−0 = 800.) Verify what `work_revenue` equals by reading the `sales_invoice_work_billed` view (`supabase/migrations/0262_billing_by_work_order.sql`): for exclusive invoices with tax 0 and no work order, net = amount, which this fixture relies on; if the view differs, fix the fixture's expected number, never the SQL.
Run: red - `contract_invoiced` is 900 and `contract_excess` key is absent.

- [ ] **T5.2 Failing tests (AC-003, AC-005, excess).** Append three more fixtures:
  - **P2 (`…d2`, 1000):** `…f3` Other 300 Paid, `…f4` Draft Contract 500 (`status='Draft',erp_docstatus=0`), `…f5` Cancelled Other 200 (`status='Cancelled',erp_docstatus=2`). Assert `contract_invoiced = 0`, `remaining = 1000` (**AC-003** only-other + drafts/cancelled excluded; zero eligible contract billing gives remaining 1000). Then insert `…f6` Contract 1000 Unpaid on a new project `…d6` (contract 1000) → `contract_invoiced = 1000`, `remaining = 0` (**AC-003** exact equality) and `contract_excess` is JSON null.
  - **P3 (`…d3`, contract 1000 *exclusive*):** Contract invoice inclusive-basis `…f7` amount 1100 tax_amount 100 USD (normalizes to 1000 on the exclusive basis); Other invoice `…f8` EUR amount 50 `tax_treatment='inclusive'`. Assert `contract_invoiced = 1000`, `remaining = 0` (**AC-005** known contract rows normalize on the contract basis; Other billing in another currency does not affect the comparison), and that the `invoices` array still has a `EUR` bucket with `invoiced 50` (Other billing stays in its own revenue bucket). Then `update public.sales_invoices set currency='EUR' where id='…f7'` and assert `contract_invoiced`, `remaining_to_invoice` and `contract_excess` are all JSON null (**AC-005** an incomparable Contract billing row makes the comparison unavailable, no invented zero or excess).
  - **Excess (supports AC-004 data; FR-009):** project `…d7` (contract 1000): Contract `…f9` 700 Unpaid, Contract `…fa` 400 Paid, Other `…fb` 250, Draft contract `…fc` 90 (`Draft`), Cancelled contract `…fd` 90. Assert `remaining_to_invoice = -100`, `contract_excess->>'amount' = 100`, `contract_excess->>'contract_billing' = 1100`, `jsonb_array_length(contract_excess->'contributors') = 2`, the two contributor ids are exactly `…f9`/`…fa`, `sum(contribution) = 1100` over the contributors, none of `…fb/fc/fd` appear, ordering is `invoice_date desc, id` (set distinct dates and assert the first id), and `invoice_number` equals `si_number` for the adopted rows. Title these `FR-009 …` (the UI-owned AC-004 consumes this shape; the DB owner of the reconciliation is this FR-009 test, not an AC owner).
  Run: red.

- [ ] **T5.3 Implement migration §7.** `create or replace function public.get_project_finances(p_project_id uuid)` = **verbatim copy of `0392_invoice_settlement_basis.sql`** (all 340 lines including the trailing `revoke`/`grant`; `cp` it into the migration and edit - do not retype) with two hunks:

```diff
   ), contract_rows as (
-    select case when i.currency <> p.currency or p.tax_treatment not in ('inclusive','exclusive')
+    select i.id, i.si_number, i.pmo_number, i.invoice_date,
+           case when i.currency <> p.currency or p.tax_treatment not in ('inclusive','exclusive')
                      or i.tax_treatment not in ('inclusive','exclusive') or i.amount is null or i.tax_amount is null
                      or i.amount::text in ('NaN','Infinity','-Infinity') or i.tax_amount::text in ('NaN','Infinity','-Infinity')
                 then null
                 when i.tax_treatment = p.tax_treatment then i.amount
                 when p.tax_treatment = 'inclusive' then i.amount+i.tax_amount
                 else i.amount-i.tax_amount end as amount
-    from invoice_rows i cross join public.projects p where p.id = p_project_id
+    from invoice_rows i cross join public.projects p
+    -- #1471 FR-006: only Contract billing draws down the contract. `inv`, `work`, settlement, outstanding, cash and
+    -- margin inputs keep reading invoice_rows (both kinds), which is what makes FR-007 hold by construction.
+    where p.id = p_project_id and i.billing_kind = 'contract'
   ), contract_sum as (
```
and, in the final `jsonb_build_object`, directly after the `'remaining_to_invoice', …,` entry and before `'cash_received'`:

```sql
    -- #1471 FR-009: present only when comparable Contract billing exceeds a known contract value. Built from the same
    -- contract_rows as contract_invoiced, so the list reconciles to contract_billing by construction.
    'contract_excess',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                              or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                              or cs.amount is null or cs.amount <= p.contract_value then null
                      else jsonb_build_object(
                        'amount',(cs.amount-p.contract_value)::text,
                        'contract_billing',cs.amount::text,
                        'contributors',coalesce((select jsonb_agg(jsonb_build_object(
                            'invoice_id',r.id,'invoice_number',coalesce(r.si_number,r.pmo_number),
                            'invoice_date',r.invoice_date,'contribution',r.amount::text)
                          order by r.invoice_date desc nulls last,r.id) from contract_rows r where r.amount <> 0),'[]'::jsonb)) end,
```
`'contract_excess'` yields SQL NULL → JSON `null` inside `jsonb_build_object`; keep the function's `STABLE`, `SET search_path TO 'public','pg_temp'` header, security-invoker nature, and the `revoke all … from public,anon,authenticated; grant execute … to authenticated;` tail exactly as in 0392 (the function was not `SECURITY DEFINER` and must not become one: reads stay under RLS).

- [ ] **T5.4 Verify.** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds.test.sql supabase/tests/0290_project_finances_reads.test.sql supabase/tests/0315_project_receipt_cash.test.sql supabase/tests/0392_invoice_settlement_basis.test.sql'` (use `ls supabase/tests | grep -i "0392\|settlement\|project_finances\|cost_attribution"` and run every file that exercises `get_project_finances`; all must stay green untouched). Commit.

- [ ] **T5.5 Mutation checks for T5 (mandatory).** Scratch only, revert after each:
  1. Delete `and i.billing_kind = 'contract'` from `contract_rows` → AC-002/AC-003 assertions go **red**.
  2. In `inv`'s source change `from invoice_gross group by currency` to read only contract rows (add `where billing_kind='contract'` to `invoice_rows`) → the AC-002 "total invoiced retains both kinds" and the work-revenue assertion go **red** (proves FR-007).
  3. Change `cs.amount <= p.contract_value` to `cs.amount < p.contract_value` → the exact-equality block (AC-003) goes **red** by producing a zero-amount excess object.
  4. Change `where r.amount <> 0` to `where false` → the contributor assertions go **red**.

### T6 - ERP refresh and backfill keep the saved kind (AC-012)

**Files:** extend `billing_kinds.test.sql`.

- [ ] **T6.1 Tests (AC-012)** (no implementation task: the properties hold because no refresh path names the column; the test proves it and will fail if one ever does). Subject: an adopted invoice classified Other with no project (so `fill_sales_invoice_project` is eligible), plus the mirror-style update.

```sql
insert into public.sales_invoices (id,org_id,project_id,erp_project,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000fe','04080000-0000-0000-0000-000000000001',null,'ERP-BK','SI-BK-R','2026-03-01',70,70,'exclusive',0,'USD','Unpaid',1,'other');
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id)
 values ('04080000-0000-0000-0000-000000000001','revenue','04080000-0000-0000-0000-0000000000fe','erpnext','SI-BK-R');
set local request.jwt.claims = '{}';
set local role service_role;
-- what the mirror writer's update branch and the sweep do: refresh money/status, never name the kind
update public.sales_invoices set amount=75, erp_outstanding_amount=0, status='Paid', erp_modified=now() where id='04080000-0000-0000-0000-0000000000fe';
select ok(public.fill_sales_invoice_project('04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000fe',
                                            '04080000-0000-0000-0000-0000000000d1','ERP-BK'), 'AC-012 the project backfill links the invoice');
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000fe'), 'other',
          'AC-012 an explicitly saved Other billing kind survives ERP refresh and project backfill');
set local request.jwt.claims = '{}';
set local role service_role;
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,currency,status,erp_docstatus)
 values ('04080000-0000-0000-0000-0000000000ff','04080000-0000-0000-0000-000000000001',null,'SI-BK-NEW','2026-03-02',10,10,'exclusive',0,'USD','Unpaid',1);
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000ff'), 'contract',
          'AC-012 an unseen invoice defaults to Contract billing');
```
Run → green on first run (state this in the PR: AC-012 is a regression-proof, not a red-first test). Mutation check: add `billing_kind = 'contract'` to `fill_sales_invoice_project`'s `set` list in a scratch copy of 0290's function body appended to the migration → the AC-012 retention assertion goes **red**; revert.

- [ ] **T6.2 Edge-function companion tests (supporting; titles lead `FR-012`).** See T13 (the Deno test that the mirror writer's update branch and the inbound adopt insert never write the column).
- [ ] **T6.3 Finalize `select plan(N)`** in `billing_kinds.test.sql` to the exact number of assertions now in the file (count `^select (is|ok|lives_ok|throws_ok|has_column|col_not_null)` lines), run the file once more, commit: `test(db): billing kinds AC-001/002/003/005/006/011/012 (#1471)`.

### T7 - Role matrix and direct-write paths (AC-007)

**Files:** create `supabase/tests/billing_kinds_roles.test.sql`.

- [ ] **T7.1 Write the test.** Fixture = org/users/projects as in T1 plus these users (ids `04080000-0000-0000-0000-0000000000aN`): `a1` Finance, `a2` Admin, `a3` Executive, `a4` Project Manager, `a5` Engineer, `a6` Finance with `status='disabled'`, `a7` Finance in the foreign org. Invoices: adopted paid `…e1` (project `d1`, with a revenue `external_refs` row), native `…e2` (author `a1`), unlinked adopted `…e3` (with `external_refs`), foreign-org `…e9` (project `d9`); plus an over-contract project `d7` (contract 1000, Contract `…f9` 700 and `…fa` 400, Other `…fb` 250). `external_domain_ownership` revenue row present. Then:

```sql
select plan(35);
-- role switching is written out per block, as in supabase/tests/0290_assign_invoice_project.test.sql L84–L115

-- allowed: Finance and Admin
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, 'AC-007 Finance may correct a kind');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'), 'other', 'AC-007 the Finance correction persisted');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','contract')$$, 'AC-007 Admin may correct a kind');
select lives_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d1','other')$$, 'AC-007 Admin may link with a kind');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other', 'AC-007 the link carried the kind');
-- a kind correction on a native invoice leaves author, approval, status and money untouched
reset role;
create temp table bk_roles_before as select to_jsonb(si) - 'billing_kind' as row_data from public.sales_invoices si
 where id='04080000-0000-0000-0000-0000000000e2';
grant select on bk_roles_before to authenticated;
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e2','other')$$, 'AC-007 Finance may correct a native invoice kind');
select is((select to_jsonb(si) - 'billing_kind' from public.sales_invoices si where id='04080000-0000-0000-0000-0000000000e2'),
          (select row_data from bk_roles_before), 'AC-007 the native correction leaves author, approval, status and money untouched');

-- refused: Executive (a3), Project Manager (a4), Engineer (a5), inactive Finance (a6), each for BOTH writers, then state unchanged
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 Executive cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', null, 'AC-007 Executive cannot link with a kind');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 Project Manager cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', null, 'AC-007 Project Manager cannot link with a kind');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 Engineer cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', null, 'AC-007 Engineer cannot link with a kind');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 an inactive Finance member cannot set a kind');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4','other')$$, '42501', null, 'AC-007 an inactive Finance member cannot link with a kind');
reset role;
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, '42501', null, 'AC-007 anonymous cannot set a kind');

-- foreign org: the same P0002 as a missing invoice (no existence signal), for both writers and both directions
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$, 'P0002', null, 'AC-007 a foreign-org Finance user cannot reach this org''s invoice');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e9','other')$$, 'P0002', null, 'AC-007 this org''s Finance user cannot reach a foreign invoice');
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d9','other')$$, 'P0002', null, 'AC-007 a foreign project is refused');
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e9'), 'contract', 'AC-007 the refused foreign write left the foreign invoice unchanged');

-- direct-write paths: the missing column grant is the control
select ok(not has_column_privilege('authenticated','public.sales_invoices','billing_kind','UPDATE')
          and not has_column_privilege('authenticated','public.sales_invoices','billing_kind','INSERT')
          and not has_column_privilege('anon','public.sales_invoices','billing_kind','UPDATE')
          and not has_column_privilege('anon','public.sales_invoices','billing_kind','INSERT'), 'AC-007 no client role can write billing_kind directly');
set local role authenticated; set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update public.sales_invoices set billing_kind='other' where id='04080000-0000-0000-0000-0000000000e1'$$, '42501', null, 'AC-007 a direct UPDATE of the kind is refused for Finance');
select throws_ok($$insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,billing_kind)
                   values (gen_random_uuid(),'04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-DIRECT',1,'exclusive',0,'USD','Draft','other')$$,
                 '42501', null, 'AC-007 a direct INSERT naming the kind is refused for Finance');
reset role;
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'), 'contract', 'AC-007 refused writes left the invoice unchanged');

-- readers keep the existing revenue visibility (contributors ride get_project_finances)
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Finance reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Admin reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Executive reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'AC-007 Project Manager reads the contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('04080000-0000-0000-0000-0000000000d7')$$, '42501', null, 'AC-007 an Engineer cannot read project finances or contributors');
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('04080000-0000-0000-0000-0000000000d7')$$, 'P0002', null, 'AC-007 a foreign-org user cannot read this org''s contributors');
reset role;

-- function posture
select ok(not has_function_privilege('anon','public.set_sales_invoice_billing_kind(uuid,text)','execute')
          and has_function_privilege('authenticated','public.set_sales_invoice_billing_kind(uuid,text)','execute')
          and (select prosecdef and proconfig = array['search_path=public'] from pg_proc where oid='public.set_sales_invoice_billing_kind(uuid,text)'::regprocedure),
          'AC-007 the kind setter is a definer with a pinned search_path and no anon grant');
select * from finish();
rollback;
```
Count the `select` assertions and set `plan(N)` to match (the `35` above is a starting estimate; pgTAP fails loudly on a mismatch). Each fixture insert is spelled out in full when the file is built, copying the column lists used in T1/T5.

- [ ] **T7.2 Verify** red/green order: the file is written after T3/T5 so it is green on first run except where a control is genuinely missing - if any "refused" assertion passes for the wrong reason (e.g. 42501 from a missing function grant instead of the role check) tighten it with `throws_ok(…,'42501','not authorized',…)` where the function raises that message. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds_roles.test.sql'`.

- [ ] **T7.3 Mutation check (mandatory; this is the SoD/auth gate).** Scratch copy, revert each: (a) `v_role not in ('Admin','Finance')` → `false` in `set_sales_invoice_billing_kind` → Executive/PM/Engineer rows go **red**; (b) delete `perform public.assert_is_active_member();` from it → the inactive-Finance row goes **red**; (c) delete `and org_id = public.auth_org_id()` → the foreign-org row goes **red**; (d) `grant update (billing_kind) on public.sales_invoices to authenticated;` appended → the direct-write rows go **red**; (e) `v_role not in ('Admin','Finance')` → `false` in the replaced `assign_sales_invoice_project` → its role rows go **red**. Commit: `test(db): billing kind role matrix + mutation-proven (#1471)`.

### T8 - Cross-test amendments the new functions force

**Files:** modify `supabase/tests/0178_anon_executable_definers.test.sql`, `scripts/isolation-probe-denominator.json`, (verify) `scripts/isolation-probe.sh`.

- [ ] **T8.1 Retained client-callable definers.** In `0178_anon_executable_definers.test.sql`: add `('set_sales_invoice_billing_kind'),` to the `client_callable_rpc_names` list in alphabetical position (after `set_sales_invoice_...` neighbours; keep the list's order convention), change both `88` literals (L~258 and L~268) and the two description strings to `89`, and append an amendment paragraph to the header comment in the file's existing style: *"⚑ AMENDED BY 0408 (#1471): `set_sales_invoice_billing_kind` joins the retained set (+1, count 89). SECURITY DEFINER writer under a member's JWT; re-asserts active membership, Admin/Finance and the caller's org; paired with supabase/tests/billing_kinds_roles.test.sql (AC-007). `assign_sales_invoice_project` and `create_native_sales_invoice` changed signature only (proname unchanged)."* The count is derived by hand from the list (the file's own rule): `grep -c "^  ('" ` on the list must equal 89.
- [ ] **T8.2 Isolation denominator.** In `scripts/isolation-probe-denominator.json`: (a) in the signature list change `"assign_sales_invoice_project(uuid,uuid)"` → `"assign_sales_invoice_project(uuid,uuid,text)"` and `"create_native_sales_invoice(uuid,uuid,jsonb,uuid)"` → `"create_native_sales_invoice(uuid,uuid,jsonb,uuid,text)"`; add `"set_sales_invoice_billing_kind(uuid,text)"` next to `set_sales_invoice_efaktur`; (b) in the class entries add `{"name":"set_sales_invoice_billing_kind","class":"write","expect_denial":[{"http":403,"sqlstate":"42501"},{"http":500,"sqlstate":"P0002"}],"source":["supabase/migrations/0408_billing_kinds.sql:<line of the three raise statements>"]}` and refresh the `source` line numbers of the two replaced functions to their new line numbers in 0408 (the guard compares them). Keep the list sorted the way the file is.
- [ ] **T8.3 Probe script.** `scripts/isolation-probe.sh` L193 calls `assign_sales_invoice_project` with `p_si_id/p_project_id` only: still valid through the default; no change. Add a probe call for the new RPC only if the script's pattern at L190–195 is one line per class-`write` function with a fixture the script already holds (`$A_SI`, `$A_PROJECT`); if so add the analogous `set_sales_invoice_billing_kind` call with `{"p_si_id":"$A_SI","p_billing_kind":"other"}` expecting the same denial; otherwise `skip` with the same reason string the neighbours use.
- [ ] **T8.4 Verify.** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0178_anon_executable_definers.test.sql' && node scripts/check-isolation-denominator.mjs --self-test && node scripts/check-isolation-denominator.mjs` (the second needs the local DB; it must report no UNLISTED and no STALE entries). Commit.

### T9 - Rollback and DD entry

**Files:** create `supabase/migrations/rollback/0408_billing_kinds_down.sql`, `supabase/tests/0408_billing_kinds_down_runner.sql`, `supabase/tests/0408_billing_kinds_rollback.test.sql`; modify `docs/decisions.md`.

- [ ] **T9.1 Down migration (NFR-005).** Reversible and meaning-preserving: it **refuses** while any Other classification exists, with an explicit preservation instruction. Build the file mechanically so the restored bodies are exact copies, not retyped:

```bash
D=supabase/migrations/rollback/0408_billing_kinds_down.sql
cat > "$D" <<'SQL'
-- 0408_billing_kinds_down.sql - reverses 0408. Refuses while Other billing classifications exist: dropping the column
-- would silently turn them into contract drawdown. Export or reclassify them first.
do $$ begin
  if exists (select 1 from public.sales_invoices where billing_kind = 'other') then
    raise exception 'export or reclassify Other billing invoices before rolling back 0408 (billing_kind=other rows exist); rollback refused'
      using errcode = 'P0001';
  end if;
end $$;
drop function public.set_sales_invoice_billing_kind(uuid,text);
drop function public.create_native_sales_invoice(uuid,uuid,jsonb,uuid,text);
drop function public.assign_sales_invoice_project(uuid,uuid,text);
SQL
sed -n '189,307p' supabase/migrations/0275_native_revenue.sql >> "$D"   # create_native_sales_invoice(uuid,uuid,jsonb,uuid) + grants + comment
sed -n '76,112p'  supabase/migrations/0290_project_finances.sql  >> "$D"   # assign_sales_invoice_project(uuid,uuid) + owner/revoke/grant
sed -n '31,74p'   supabase/migrations/0290_project_finances.sql  >> "$D"   # sales_invoices_native_mirror_guard() as it was
cat supabase/migrations/0392_invoice_settlement_basis.sql        >> "$D"   # get_project_finances(uuid) as it was (create or replace + grants)
cat >> "$D" <<'SQL'
update public.record_history_config set captured = captured - 'billing_kind' where entity_type = 'sales_invoice';
alter table public.sales_invoices drop constraint sales_invoices_billing_kind_check, drop column billing_kind;
SQL
```
Order matters and is fixed above: functions that name `billing_kind` are replaced **before** the column is dropped. The history rows already written with a `billing_kind` change are left in place (audit; reachable only after a reclassification back to `contract`). Check by eye that the file contains no `$down$` or `$runner$` token (T9.1b embeds it) and that `0275`'s `create or replace function` line reads as the 4-argument signature.
- [ ] **T9.1b Down-runner (generated, not hand-written).**

```bash
{ printf '%s\n' '\if :{?bk_embedded}' '\else' 'create extension if not exists pgtap;' 'select plan(1);' \
    "select pass('NFR-005 rollback runner loads without executing the rollback');" 'select * from finish();' '\endif' \
    'create function pg_temp.run_bk_down() returns void language plpgsql as $runner$' 'begin execute $down$';
  cat supabase/migrations/rollback/0408_billing_kinds_down.sql;
  printf '%s\n' '$down$; end $runner$;'; } > supabase/tests/0408_billing_kinds_down_runner.sql
```
(Same shape as `0290_project_finances_down_runner.sql`; the down file must not contain the token `$down$` or `$runner$`.)
- [ ] **T9.1c Rollback test (titles lead `NFR-005`).** Copy the structure of `supabase/tests/0290_project_finances_rollback.test.sql`: minimal org/project/invoice fixture; insert an `other` invoice; `\set bk_embedded 1` + `\ir 0408_billing_kinds_down_runner.sql`; `throws_ok('select pg_temp.run_bk_down()','P0001',null,'NFR-005 rollback refuses while Other billing exists')`; `has_column(...billing_kind)` still true; then `update … set billing_kind='contract'`, run `select pg_temp.run_bk_down()` (`lives_ok`), and assert: column gone, the 2-arg `assign_sales_invoice_project`, 4-arg `create_native_sales_invoice` exist and the 3-/5-arg ones and `set_sales_invoice_billing_kind` do not (`to_regprocedure(...) is null`), `record_history_config` no longer has the key, and `get_project_finances` still callable.
- [ ] **T9.1d Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0408_billing_kinds_rollback.test.sql supabase/tests/0408_billing_kinds_down_runner.sql'`.
- [ ] **T9.2 Decision entry.** Append to `docs/decisions.md` a short `### DD-BKIND-1` entry (Director date 2026-10-31): the column + two RPC decision, contract aggregate reads only Contract billing, excess contributors ride the finance payload, omitted-kind-keeps-stored rule (Q1), rollback refuses while Other rows exist. Docs-only push rules apply to this file only if shipped alone; here it rides the build PR.
- [ ] **T9.3 Commit** `feat(db): billing kinds migration 0408 + rollback + tests (#1471)`.

### T10 - DB gate (one lock hold)

- [ ] `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/billing_kinds.test.sql supabase/tests/billing_kinds_roles.test.sql supabase/tests/0408_billing_kinds_rollback.test.sql supabase/tests/0408_billing_kinds_down_runner.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0275_native_revenue_acl.test.sql supabase/tests/0275_native_revenue_create.test.sql supabase/tests/0290_assign_invoice_project.test.sql supabase/tests/0290_project_finances_reads.test.sql supabase/tests/0290_project_invoice_backfill.test.sql supabase/tests/record_changes_catalog_gate.test.sql supabase/tests/0278_invoice_change_history.test.sql'` → all green. CI's `pgtap` job is the full proof; do not run the whole directory locally.

---

## Phase 2 - Transport, command and mirror writer (T11–T14)

### T11 - Shared type and DAL (FR-003/FR-004; supporting transport tests)

**Files:** create `pmo-portal/src/lib/billingKind.ts`; modify `pmo-portal/src/lib/db/revenue.ts`, `pmo-portal/src/lib/supabase/database.types.ts`; extend `pmo-portal/src/lib/db/projectFinances.test.ts`, `projectFinances.types.test.ts`.

- [ ] **T11.1 Create the shared leaf** `pmo-portal/src/lib/billingKind.ts`:

```ts
/** #1471: how an invoice's project attribution counts. `contract` draws down the contract value; `other` counts toward revenue and margin only. */
export const BILLING_KINDS = ['contract', 'other'] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];
export const DEFAULT_BILLING_KIND: BillingKind = 'contract';
export function isBillingKind(value: unknown): value is BillingKind {
  return value === 'contract' || value === 'other';
}
```
- [ ] **T11.2 Types.** Edit `database.types.ts` by hand (grep the three anchors): in `sales_invoices` `Row` add `billing_kind: string`, in `Insert`/`Update` add `billing_kind?: string` (alphabetical, after `author_user_id`); `assign_sales_invoice_project.Args` (L8259) → `{ p_billing_kind?: string; p_project_id: string; p_si_id: string }`; `create_native_sales_invoice.Args` (L8458) → add `p_billing_kind?: string`; add a new `set_sales_invoice_billing_kind: { Args: { p_billing_kind: string; p_si_id: string }; Returns: undefined }` entry in alphabetical position among the Functions. `get_project_finances` returns `Json`: no change.
- [ ] **T11.3 Failing tests** (add to `pmo-portal/src/lib/db/projectFinances.test.ts`, keep the existing AC-PFIN-010 test untouched - it pins that the 2-arg call sends exactly two params):

```ts
it('FR-003 assigns project and kind with the kind as a third RPC argument', async () => {
  h.rpc.mockResolvedValueOnce({ error: null });
  await setSalesInvoiceProject('invoice-1', 'project-1', 'other');
  expect(h.rpc).toHaveBeenCalledExactlyOnceWith('assign_sales_invoice_project',
    { p_si_id: 'invoice-1', p_project_id: 'project-1', p_billing_kind: 'other' });
});
it('FR-004 corrects only the kind through the narrow RPC', async () => {
  h.rpc.mockResolvedValueOnce({ error: null });
  await setSalesInvoiceBillingKind('invoice-1', 'contract');
  expect(h.rpc).toHaveBeenCalledExactlyOnceWith('set_sales_invoice_billing_kind',
    { p_si_id: 'invoice-1', p_billing_kind: 'contract' });
});
it('FR-004 surfaces a refusal with its SQLSTATE', async () => {
  h.rpc.mockResolvedValueOnce({ error: { message: 'not authorized', code: '42501' } });
  await expect(setSalesInvoiceBillingKind('invoice-1', 'other')).rejects.toMatchObject({ code: '42501' });
});
```
and in `projectFinances.types.test.ts` an `expectTypeOf<Database['public']['Functions']['set_sales_invoice_billing_kind']['Args']>()` assertion mirroring the existing assign one. Run: `cd pmo-portal && npx vitest run src/lib/db/projectFinances.test.ts src/lib/db/projectFinances.types.test.ts` → red.
- [ ] **T11.4 Implement** in `pmo-portal/src/lib/db/revenue.ts`: import `type BillingKind`; add `billing_kind: BillingKind;` to `SalesInvoiceRow` (after `author_user_id`, with a one-line doc comment; `select('*')` already returns it); change `setSalesInvoiceProject`:

```ts
export async function setSalesInvoiceProject(siId: string, projectId: string, billingKind?: BillingKind): Promise<void> {
  const { error } = await supabase.rpc('assign_sales_invoice_project', {
    p_si_id: siId,
    p_project_id: projectId,
    ...(billingKind ? { p_billing_kind: billingKind } : {}),
  });
  if (error) throwWrite(error);
}

/** #1471 FR-004: PMO-only billing-kind correction of an already-linked invoice (Admin/Finance, RPC-enforced). */
export async function setSalesInvoiceBillingKind(siId: string, billingKind: BillingKind): Promise<void> {
  const { error } = await supabase.rpc('set_sales_invoice_billing_kind', { p_si_id: siId, p_billing_kind: billingKind });
  if (error) throwWrite(error);
}
```
(`SalesInvoiceRow.billing_kind` is required: run `npm run typecheck` and fix every literal that builds a `SalesInvoiceRow` - most test factories cast, the rest get `billing_kind: 'contract'`.)
- [ ] **T11.5 Verify:** `cd pmo-portal && npx vitest run src/lib/db/projectFinances.test.ts src/lib/db/projectFinances.types.test.ts src/lib/db/revenue.test.ts && npm run typecheck`. Commit.

### T12 - Repository seam and native create (AC-014 transport; supporting)

**Files:** modify `pmo-portal/src/lib/db/revenueNative.ts`, `src/lib/repositories/revenueNative.ts`, `repositories/index.ts`, `repositories/types.ts`; extend `src/lib/db/revenueNative.test.ts`, `src/lib/repositories/revenue.native.transport.test.ts`.

- [ ] **T12.1 Failing tests.**
  - `revenueNative.test.ts`: `it('FR-003 sends the billing kind to create_native_sales_invoice when chosen, and nothing when omitted', …)` - call `createNativeSalesInvoice({ projectId, customerId, lines, billingKind: 'other' })` and assert the rpc args include `p_billing_kind: 'other'`; without `billingKind` assert the args object has no `p_billing_kind` key (`not.toHaveProperty`). Follow the neighbouring AC-NAR-001 tests' setup.
  - `revenue.native.transport.test.ts` (real repository → DAL → faked `supabase.rpc`): `it('FR-003 carries billingKind through repositories.revenue.createInvoice into the native RPC', …)`, asserting `p_billing_kind: 'other'` reaches `create_native_sales_invoice`; and a `setBillingKind`/`setProject` pair asserting `repositories.revenue.setBillingKind('si','other')` → `set_sales_invoice_billing_kind` and `repositories.revenue.setProject('si','p','other')` → third arg.
  Run: red (type errors/undefined methods).
- [ ] **T12.2 Implement.** `revenueNative.ts`: add `billingKind?: BillingKind` to `NativeInvoiceInput` (doc: "chosen beside the project; omitted = Contract billing, server default") and `...(input.billingKind ? { p_billing_kind: input.billingKind } : {})` to the `supabase.rpc('create_native_sales_invoice', …)` args. `repositories/revenueNative.ts` `createNativeInvoice`: pass `...(input.billingKind ? { billingKind: input.billingKind } : {})`. `repositories/types.ts` `RevenueRepository`: add `billingKind?: BillingKind` to `createInvoice`'s input type (L534), change `setProject(siId: string, projectId: string, billingKind?: BillingKind): Promise<void>` (L576) and add `setBillingKind(siId: string, billingKind: BillingKind): Promise<void>;`. `repositories/index.ts` (the `revenue` object, L720): `setProject: (siId, projectId, billingKind) => wrap(() => billingKind === undefined ? setSalesInvoiceProject(siId, projectId) : setSalesInvoiceProject(siId, projectId, billingKind)),` and `setBillingKind: (siId, billingKind) => wrap(() => setSalesInvoiceBillingKind(siId, billingKind)),` (add both imports from `../db/revenue`). Fix any typed fake `RevenueRepository` that typecheck flags.
- [ ] **T12.3 Verify:** `cd pmo-portal && npx vitest run src/lib/db/revenueNative.test.ts src/lib/repositories/revenue.native.transport.test.ts src/lib/repositories/revenue.native.test.ts src/lib/repositories/revenue.external.test.ts && npm run typecheck`. Commit.

### T13 - Connected creation and ERP refresh seams (FR-012; supporting)

**Files:** modify `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts`, `supabase/functions/adapter-dispatch/readModelWriters.ts`; extend `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts`, `supabase/functions/adapter-dispatch/readModelWriters.test.ts`; (verify only) `supabase/functions/_shared/erpnextFeedDeps.ts`.

- [ ] **T13.1 Failing tests.**
  - `bodies.test.ts` (next to the `siToBody` case at L40, reusing its `record`/`CTX`): `it('FR-012 never sends the billing kind to the ERP', () => { const body = JSON.stringify(siToBody({ ...record, billingKind: 'other' }, { ...CTX, refs: { customer: 'Customer' } })); expect(body).not.toMatch(/billing/i); })`.
  - `readModelWriters.test.ts` next to the AC-PFIN-003 create test (L226): three Deno tests, titles leading `FR-012`: (1) create with `record.billingKind: 'other'` → the insert row has `billing_kind: 'other'`; (2) create with `billingKind: 'bogus'` and with none → the insert row has **no** `billing_kind` key (column default applies; a bad value must not abort a mirror after the ERP document exists); (3) an `update` operation (`operation: 'update'`, `canonical` with new amount/outstanding) → the `.update(...)` patch has no `billing_kind` key even when `record.billingKind` is present.
  - A `salesInvoiceCommand` unit: `salesInvoiceCreateFields({ customerId:'c', items:[], projectId:'p', billingKind:'other' })` returns `billingKind: 'other'` alongside `erp_doc_kind: 'sales-invoice'` (add to the existing command-builder test; find it with `ls pmo-portal/src/lib/adapterSeam/erpnext | grep -i salesInvoiceCommand`; if none, create `salesInvoiceCommand.test.ts`).
  Run: `cd supabase/functions && deno test adapter-dispatch/readModelWriters.test.ts` (see the repo's deno invocation in `.githooks/pre-commit`) → red on (1); `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` → the body test is already green (it is a guard); say so in the PR.
- [ ] **T13.2 Implement.** `salesInvoiceCommand.ts` (keep it an import-free leaf, so inline the union): in `SalesInvoiceCreateInput` add `/** #1471: how this invoice's project attribution counts; omitted = contract. PMO metadata, never an ERP field. */ billingKind?: 'contract' | 'other';`. `readModelWriters.ts` create branch (L704 and the insert at L721): extend the destructured `record` type with `billingKind?: unknown`, compute

```ts
    // #1471 (D5): only the two known kinds are written; anything else is ignored so a bad value cannot abort the mirror
    // after the ERP document already exists. Update/transition branches never mention the column (FR-012).
    const billingKind = record.billingKind === 'contract' || record.billingKind === 'other' ? record.billingKind : null;
```
and add `...(billingKind ? { billing_kind: billingKind } : {}),` to the insert object next to `...(workOrderId ? … )`.
- [ ] **T13.3 Verify** `erpnextFeedDeps.ts` L483 insert and the update patch at L~730 name no `billing_kind` (the Deno tests cover the writer; `grep -n billing_kind supabase/functions -r` must show only the create-branch line). Run `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext` + the deno test + `npm run check:edge-test-binding`. Commit.

### T14 - Finance payload types and parser (supports AC-004/013; FR-009/010)

**Files:** modify `pmo-portal/src/lib/projectFinances.ts`, `pmo-portal/src/lib/db/revenue.ts` (`getProjectFinances`); extend `pmo-portal/src/lib/projectFinances.test.ts`, `src/lib/db/projectFinances.test.ts`.

- [ ] **T14.1 Failing tests** (`projectFinances.test.ts`, leading `FR-009`):

```ts
describe('parseContractExcess (FR-009/FR-010)', () => {
  const contributor = (id: string, contribution: string) => ({ invoice_id: id, invoice_number: `SI-${id}`, invoice_date: '2026-02-01', contribution });
  it('FR-009 is null while remaining is zero, positive or unknown', () => {
    for (const remaining of ['0.00', '400.00', null]) expect(parseContractExcess(null, remaining)).toBeNull();
  });
  it('FR-009 is known when the contributors reconcile exactly to the contract billing', () => {
    const raw = { amount: '100.00', contract_billing: '1100.00', contributors: [contributor('a', '700.00'), contributor('b', '400.00')] };
    expect(parseContractExcess(raw, '-100.00')).toEqual({ state: 'known', amount: '100.00', contractBilling: '1100.00',
      contributors: raw.contributors });
  });
  it('FR-009 derives the excess from remaining and says the detail is incomplete when contributors do not reconcile', () => {
    const raw = { amount: '100.00', contract_billing: '1100.00', contributors: [contributor('a', '700.00')] };
    expect(parseContractExcess(raw, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
  });
  it('FR-009 never shows a bare negative: a missing or malformed object still yields the derived excess', () => {
    expect(parseContractExcess(undefined, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
    expect(parseContractExcess({ amount: 'x' }, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
  });
  it('FR-009 refuses an excess whose amount disagrees with remaining', () => {
    const raw = { amount: '50.00', contract_billing: '1050.00', contributors: [contributor('a', '1050.00')] };
    expect(parseContractExcess(raw, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
  });
});
```
and in `src/lib/db/projectFinances.test.ts` a DAL test: `getProjectFinances` returns `contract_excess` parsed (known) for a payload with `remaining_to_invoice: '-100.00'` and a reconciling `contract_excess`, and `contract_excess: null` for a payload without the key and with `remaining_to_invoice: null`. Run → red.
- [ ] **T14.2 Implement** in `projectFinances.ts` (uses the existing `moneyUnits`/`moneyText`; all arithmetic in `bigint` cents, no floats - NFR-002):

```ts
export interface ContractExcessContributor {
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  /** Normalized contribution on the contract's tax basis (exact decimal text). */
  contribution: ExactMoney;
}
export type ContractExcess =
  | { state: 'known'; amount: ExactMoney; contractBilling: ExactMoney; contributors: ContractExcessContributor[] }
  | { state: 'incomplete'; amount: ExactMoney };

/** The excess is always derived from `remaining_to_invoice` (so a negative is never shown bare); the contributor
 *  detail is trusted only if it reconciles exactly to the contract billing and to that excess. */
export function parseContractExcess(raw: unknown, remaining: ExactMoney | null): ContractExcess | null {
  const remainingUnits = moneyUnits(remaining);
  if (remainingUnits === null || remainingUnits >= 0n) return null;
  const amount = moneyText(-remainingUnits);
  const incomplete: ContractExcess = { state: 'incomplete', amount };
  if (!isRecord(raw) || typeof raw.amount !== 'string' || typeof raw.contract_billing !== 'string'
      || !Array.isArray(raw.contributors)) return incomplete;
  if (moneyUnits(raw.amount) !== -remainingUnits) return incomplete;
  const billing = moneyUnits(raw.contract_billing);
  const contributors: ContractExcessContributor[] = [];
  let sum = 0n;
  for (const c of raw.contributors) {
    if (!isRecord(c) || typeof c.invoice_id !== 'string' || typeof c.contribution !== 'string') return incomplete;
    const units = moneyUnits(c.contribution);
    if (units === null) return incomplete;
    sum += units;
    contributors.push({ invoice_id: c.invoice_id,
      invoice_number: typeof c.invoice_number === 'string' ? c.invoice_number : null,
      invoice_date: typeof c.invoice_date === 'string' ? c.invoice_date : null, contribution: c.contribution });
  }
  if (billing === null || sum !== billing || contributors.length === 0) return incomplete;
  return { state: 'known', amount, contractBilling: raw.contract_billing, contributors };
}
```
Add `contract_excess?: ContractExcess | null;` to `ProjectFinances`. In `revenue.ts` `getProjectFinances`: widen the cast type with `contract_excess?: unknown` and return `{ ...payload, cash_received: …, contract_excess: parseContractExcess(payload.contract_excess, payload.remaining_to_invoice) }` (import `parseContractExcess`). `isProjectFinances` is unchanged: it must keep accepting payloads from before 0408 (no key).
- [ ] **T14.3 Verify:** `cd pmo-portal && npx vitest run src/lib/projectFinances.test.ts src/lib/db/projectFinances.test.ts && npm run typecheck`. Commit.

---

## Phase 3 - Frontend (T15–T20)

### T15 - Cache refresh (AC-009)

**Files:** modify `pmo-portal/src/hooks/useRevenue.ts`, `pmo-portal/src/lib/projectFinances.ts` (`AssignInvoiceProjectInput`); create `pmo-portal/src/hooks/useRevenue.billingKinds.test.tsx`.

- [ ] **T15.1 Failing test (AC-009)** - new file modelled on `useRevenue.assignProject.test.tsx` (same hoisted mocks, plus `setBillingKind: vi.fn()` on the mocked repository). Titles lead `AC-009`:
  1. same project, kind change → `mutateAsync({ siId:'invoice-A', projectId:'project-A', oldProjectId:'project-A', billingKind:'other' })`: `setBillingKind` called with `('invoice-A','other')`, `setProject` **not** called; then `['project-finances','org-A','project-A']`, `['salesInvoices','org-A']`, `['salesInvoice','org-A','invoice-A']`, `['revenueByProject','org-A']`, `['record-history','org-A','sales_invoice','invoice-A']` and `['record-history','org-A','project','project-A']` are all invalidated (seed each key with `setQueryData`, assert `getQueryState(key)?.isInvalidated`), while `['project-finances','org-B','project-A']` is not.
  2. project change with kind → `setProject` called with `('invoice-A','project-new','other')`, old and new project finances invalidated.
  3. project change without a kind → `setProject` called with exactly `('invoice-A','project-new')` (so the existing AC-PFIN-010 assertion keeps passing).
  4. a rejected kind correction leaves cached finance un-invalidated (mirrors AC-PFIN-010's rejection case).
  5. no ERP dispatch: assert the mocked `createInvoice`/dispatch-bearing methods were never called and that the mocked repository has no other method invoked.
  Run → red.
- [ ] **T15.2 Implement.** `AssignInvoiceProjectInput` (projectFinances.ts L240) gains `billingKind?: BillingKind;`. `useAssignInvoiceProject`'s `mutationFn`:

```ts
mutationFn: ({ siId, projectId, oldProjectId, billingKind }: AssignInvoiceProjectInput) => {
  // Same project + a kind: the narrow correction (works for native, authored and paid invoices too, FR-004).
  if (billingKind !== undefined && oldProjectId === projectId) return repositories.revenue.setBillingKind(siId, billingKind);
  return billingKind === undefined
    ? repositories.revenue.setProject(siId, projectId)
    : repositories.revenue.setProject(siId, projectId, billingKind);
},
```
`onSuccess` is unchanged: `projectIds` is already a de-duplicated set of old/new, so a same-project correction refreshes that project exactly once. In `useRevenueMutations.create`, widen the `mutationFn` input type with `billingKind?: BillingKind` (the spread already forwards it to `createInvoice`).
- [ ] **T15.3 Verify:** `cd pmo-portal && npx vitest run src/hooks/useRevenue.billingKinds.test.tsx src/hooks/useRevenue.assignProject.test.tsx src/hooks/useRevenue.nativeDrafts.test.tsx && npm run typecheck`. Commit.

### T16 - Assignment dialog (AC-008)

**Files:** modify `pmo-portal/src/components/InvoiceProjectModal.tsx`, `pmo-portal/pages/SalesInvoices.tsx`; extend `pmo-portal/src/components/InvoiceProjectModal.test.tsx`, `pmo-portal/pages/__tests__/SalesInvoices.assignProject.test.tsx`.

- [ ] **T16.1 Failing tests (AC-008)** in `InvoiceProjectModal.test.tsx` (existing `renderModal`/`invoice` helpers; extend `invoice(projectId, kind = 'contract')` to set `billing_kind`; update the existing `onSave` call assertions to the new `(projectId, billingKind)` arity - this is the deliberate behaviour change, the goal assertions are unchanged):
  1. `AC-008 offers both billing kinds with an explanation and defaults a new choice to Contract billing`: `getByRole('combobox', { name: 'Billing kind' })` has options "Contract billing" and "Other billing"; initial value `contract`; its accessible description contains the contract explanation; switching to Other changes the description to the other explanation.
  2. `AC-008 shows the saved kind when editing` (`invoice('project-1','other')` → value `other`).
  3. `AC-008 a kind-only change enables Save and saves without the project-change confirmation`: linked invoice, change only the kind → "Save project" enabled → click → `onSave` called with `('project-1','other')`, no confirm dialog shown, `onClose` called.
  4. `AC-008 Save stays disabled when neither project nor kind changed`.
  5. `AC-008 blocks a duplicate submit while saving`: `onSave` returns a never-resolving promise; double-click Save → called once.
  6. `AC-008 failure retains the project and kind and lets the user retry`: first `onSave` rejects `new AppError('boom','42501')` (use the module the page uses via `classifyMutationError`); the dialog stays open with the alert, the project combobox and kind select keep their values, the second click calls `onSave` again.
  7. `AC-008 cancel persists nothing`: change the kind, press Cancel/Escape → discard confirm → discard → `onSave` never called.
  8. `AC-008 locks the project for a native or PMO-authored invoice` (`projectLocked` true): the project combobox is disabled, the kind select enabled, save sends `(invoice.project_id, kind)`.
  9. `AC-008` Indonesian catalogue test: extend the existing AC-PFIN-009 locale test (or add a sibling) to assert the Indonesian labels render for the kind control and no raw `invoiceProject.kind.*` key shows; `axe` clean.
  Run → red. Page test `SalesInvoices.assignProject.test.tsx` L114: update the expected `mutateAsync` payload to include `billingKind`/the saved kind (deliberate), and add `FR-004`: a native linked invoice shows the row action "Change billing kind" and not "Change project"; an unlinked native shows neither.
- [ ] **T16.2 Implement `InvoiceProjectModal.tsx`.** Props: `onSave: (projectId: string, billingKind: BillingKind) => Promise<void>`; new `projectLocked?: boolean`. State: `useEntityForm({ initialValues: { projectId: invoice.project_id ?? '', billingKind: invoice.billing_kind ?? DEFAULT_BILLING_KIND }, … })`. `unchanged = projectId === invoice.project_id && billingKind === (invoice.billing_kind ?? DEFAULT_BILLING_KIND)`. In `onSubmit` the project-change confirm applies **only** when the project changes: `if (invoice.project_id && form.values.projectId !== invoice.project_id) setConfirming(true); else await save();`. `save` calls `await onSave(form.values.projectId, form.values.billingKind)`. Render, inside the existing `FormGrid`, after the project `Combobox` (give the Combobox `disabled={busy || projectLocked}`):

```tsx
<SelectField
  id={form.fieldProps('billingKind').id}
  label={t('invoiceProject.kind.label', 'Billing kind')}
  value={form.values.billingKind}
  disabled={busy}
  options={[
    { value: 'contract', label: t('invoiceProject.kind.contract', 'Contract billing') },
    { value: 'other', label: t('invoiceProject.kind.other', 'Other billing') },
  ]}
  helper={form.values.billingKind === 'contract'
    ? t('invoiceProject.kind.contractHelp', 'Counts against the contract: reduces Remaining to invoice, and counts toward revenue and margin.')
    : t('invoiceProject.kind.otherHelp', 'Licences, reimbursables and work outside the contract: counts toward revenue and margin, never reduces Remaining to invoice.')}
  onChange={(value) => form.setValue('billingKind', value as BillingKind)}
/>
```
(`SelectField` is exported from `@/src/components/ui`; confirm the `helper` renders as `aria-describedby`, `FieldShell` in `FormFields.tsx` does that for the other fields.) Title/submit label stay "Change project"/"Assign project"/"Save project" when the project is editable; when `projectLocked`, title = `t('invoiceProject.changeKind','Change billing kind')`, submit label `t('invoiceProject.saveKind','Save billing kind')`. `requiredFields` stays `['projectId']`. Add `SelectField` to the `@/src/components/ui` import.
- [ ] **T16.3 Wire the page** (`pages/SalesInvoices.tsx`). Row menu (L508): keep the existing block for `canAttributeInvoice(inv)`; add directly after it:

```tsx
    else if (may('assign_project', 'salesInvoice') && inv.project_id) {
      items.push({ label: t('invoiceProject.changeKind', 'Change billing kind'), onClick: () => setProjectTarget(inv) });
    }
```
(use `else if` on the existing `if`). The modal element (L817) gains `projectLocked={!canAttributeInvoice(projectTarget)}` and:

```tsx
onSave={async (projectId, billingKind) => {
  await assignProject.mutateAsync({ siId: projectTarget.id, projectId, oldProjectId: projectTarget.project_id, billingKind });
}}
```
- [ ] **T16.4 Verify:** `cd pmo-portal && npx vitest run src/components/InvoiceProjectModal.test.tsx pages/__tests__/SalesInvoices.assignProject.test.tsx pages/__tests__/SalesInvoices.native.test.tsx && npm run typecheck && npx eslint --max-warnings=0 src/components/InvoiceProjectModal.tsx pages/SalesInvoices.tsx`. Commit.

### T17 - Invoice creation form (AC-014)

**Files:** modify `pmo-portal/pages/sales-invoices/invoiceDraftValidation.ts`, `SalesInvoiceFormModal.tsx`, `pmo-portal/pages/SalesInvoices.tsx`; extend `pmo-portal/pages/__tests__/SalesInvoices.createForm.test.tsx`.

- [ ] **T17.1 Failing tests (AC-014)** in `SalesInvoices.createForm.test.tsx` (reuse its hoisted mocks: `createMutate`, `projectOptions`, `revenueMode` for native and ERP):
  1. `AC-014 the billing kind control appears once a project is chosen and defaults to Contract billing` (not present before a project is selected).
  2. `AC-014 submits the chosen kind with the project` (native mode): pick customer, project, line, choose "Other billing", submit → `createMutate` called with `expect.objectContaining({ projectId: 'proj-1', billingKind: 'other' })`.
  3. `AC-014 submits Contract billing by default` → `billingKind: 'contract'`.
  4. `AC-014 connected (ERP) creation carries the kind too` (`revenueMode = 'erp'`, project optional): with a project → `billingKind` present; without a project → the call has **no** `billingKind` key.
  5. `AC-014 a failed create keeps the project, kind and lines and allows retry` (mockRejectedValueOnce, then resolved).
  6. `AC-014 cancel writes nothing` (`createMutate` not called).
  Run → red.
- [ ] **T17.2 Implement.** `invoiceDraftValidation.ts`: `FormValues` gains `billingKind: BillingKind` (no validation rule: the control only offers valid values). `SalesInvoiceFormModal.tsx`: `initialValues` gets `billingKind: DEFAULT_BILLING_KIND`; the `onCreate` input type (L25) gains `billingKind?: BillingKind`; in `handleSubmit` build `const input = { customerId, projectId, lineItems, ...(values.projectId ? { billingKind: values.billingKind } : {}) };`; render a `SelectField` (same options and helper copy as T16, keys `financeCopy.billingKind.*`) in the `FormGrid` immediately after the project `Combobox`, only when `projectField.value` is truthy. `SalesInvoices.tsx` `onCreate` (L801): pass `billingKind: input.billingKind` into `create.mutateAsync`.
- [ ] **T17.3 Verify:** `cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.createForm.test.tsx pages/__tests__/SalesInvoices.native.test.tsx pages/__tests__/SalesInvoices.commandIntent.test.tsx && npm run typecheck`. Commit.

### T18 - Finance section (AC-004, AC-013)

**Files:** modify `pmo-portal/pages/project-detail/ProjectFinancesSection.tsx`; extend `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx`.

- [ ] **T18.1 Failing tests.** In `ProjectFinancesSection.test.tsx` (existing mock of `useProjectFinances`; add `contract_excess` to the fixture payloads). Titles lead with the owning ID:
  - `AC-004 says "Invoiced above contract by 100" with both contract invoices, never a bare negative`: payload `contract_invoiced:'1100.00'`, `remaining_to_invoice:'-100.00'`, `contract_excess` = known with contributors `a` 700 and `b` 400 (and the payload `invoices` carrying 1,350 total so Other billing 250 is in revenue only). Assert: text `Invoiced above contract by 100` present; `queryByText('-100')`/`'−100'` absent and no "Remaining to invoice" field; two links with accessible names containing `SI-a`/`SI-b` whose `href` is `/sales-invoices/<id>`; each row shows its contribution; the visible contributions total 1,100 (700 + 400 asserted as formatted cells); no Other/draft/cancelled invoice id appears.
  - `AC-004 derives the excess and explains missing detail when the contributor list cannot be verified` (`contract_excess` incomplete): headline still shown from remaining; a message "Invoice details are unavailable; retry" with the existing Retry button calling `refetch`; no list.
  - `AC-013 shows distinct loading, error-with-retry, empty and unavailable states`: (a) pending → `role=status` loading, no zeros; (b) error → `role=alert` + Retry calls `refetch`; (c) no invoices → the existing one-line no-invoices copy and no excess/remaining; (d) `remaining_to_invoice: null` with invoices → the explained unavailable line ("Contract comparison unavailable …") and no "0", no "Invoiced above contract".
  Run → red for the excess/unavailable parts (loading/error/empty already pass: keep them in the same test so the AC has one owning file).
- [ ] **T18.2 Implement.** In the `hasInvoices && onHand` block (L~140) replace the two `field(...)` calls:

```tsx
{data.contract_excess
  ? <div className="min-w-0 sm:col-span-3" data-testid="contract-excess">
      <p role="status" className="text-sm font-semibold tabular-nums">
        {t('projectFinances.excessTitle', 'Invoiced above contract by {{amount}}', { amount: money(data.contract_excess.amount, project.currency) })}
      </p>
      {data.contract_excess.state === 'known'
        ? <ul className="mt-2 min-w-0 divide-y divide-border/70 text-sm" aria-label={t('projectFinances.excessInvoices', 'Contract invoices behind the excess')}>
            {data.contract_excess.contributors.map((c) => (
              <li key={c.invoice_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5">
                <Link className="min-w-0 break-words font-medium text-primary-text underline underline-offset-2" to={`/sales-invoices/${c.invoice_id}`}>
                  {c.invoice_number ?? t('projectFinances.excessInvoiceNoNumber', 'Invoice')}
                </Link>
                <span className="tabular-nums">{money(c.contribution, project.currency)}</span>
              </li>))}
          </ul>
        : <p className="mt-1 text-xs text-muted-foreground">
            {t('projectFinances.excessDetailUnavailable', 'The invoices behind this excess could not be verified.')}{' '}
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('projectFinances.retry', 'Retry')}</Button>
          </p>}
    </div>
  : <>
      {field(t('projectFinances.contractInvoiced', 'Invoiced against contract'), money(data.contract_invoiced, project.currency))}
      {data.remaining_to_invoice === null
        ? <p className="text-xs text-muted-foreground sm:col-span-3" data-testid="contract-comparison-unavailable">
            {t('projectFinances.contractComparisonUnavailable', 'Contract comparison unavailable: the contract value is not recorded, or a contract invoice cannot be compared (currency or tax basis).')}
          </p>
        : field(t('projectFinances.remaining', 'Remaining to invoice'), money(data.remaining_to_invoice, project.currency))}
    </>}
```
(`Link` and `Button` are already imported. `money(...)` formats via `formatExactMoney`, i.e. exact decimal, locale-aware. If `contract_invoiced` is null and `remaining_to_invoice` is null the first `field(...)` already renders nothing: that is the pre-existing "unknown figure is left out" rule, now followed by the explanation.) Do not add any `Number()`/float arithmetic anywhere in this file.
- [ ] **T18.3 Verify:** `cd pmo-portal && npx vitest run pages/project-detail/ProjectFinancesSection.test.tsx pages/project-detail/__tests__/ProjectMoneyPosition.parity.test.tsx pages/project-detail/__tests__/ProjectSections.drawdown.test.tsx && npm run typecheck && npx eslint --max-warnings=0 pages/project-detail/ProjectFinancesSection.tsx`. Commit.

### T19 - History presentation (FR-005; supporting)

**Files:** modify `pmo-portal/src/components/history/historyFields.ts`, `historyLabels.ts`, `useHistoryEnumLabel.ts`; extend `pmo-portal/src/components/history/__tests__/historyLabels.test.ts`.

- [ ] **T19.1 Failing test** (`FR-005`): the sales-invoice field map classifies `billing_kind` as `'enum'`; the label for field `billing_kind` is "Billing kind"; the enum label for value `other` is "Other billing" and for `contract` "Contract billing"; a record-history row with `{ billing_kind: { old: 'contract', new: 'other' } }` renders both labels (follow the pattern of the existing `withheld_pph_type` assertions in that test file).
- [ ] **T19.2 Implement:** `historyFields.ts` `sales_invoice` map gains `billing_kind: 'enum'`; `historyLabels.ts` field table gains `billing_kind: t('history.field.billing_kind', 'Billing kind')`; `useHistoryEnumLabel.ts` adds, alongside the `pph_type` branch: `if (column === 'billing_kind') { if (value === 'contract') return t('history.billingKind.contract', 'Contract billing'); if (value === 'other') return t('history.billingKind.other', 'Other billing'); }`.
- [ ] **T19.3 Verify:** `cd pmo-portal && npx vitest run src/components/history && npm run typecheck`. Commit.

### T20 - Translations (NFR-004)

**Files:** modify `pmo-portal/public/locales/{en,id}/common.json`, `{en,id}/project.json`.

- [ ] **T20.1** Add (English first, then Bahasa; same key set in both files or `npm run check:i18n` fails):
  - `common.json` → `invoiceProject.kind.{label,contract,other,contractHelp,otherHelp}`, `invoiceProject.{changeKind,saveKind}`; `financeCopy.billingKind.{label,contract,other,contractHelp,otherHelp}`; `history.field.billing_kind`, `history.billingKind.{contract,other}`.
  - `project.json` → `projectFinances.{excessTitle,excessInvoices,excessInvoiceNoNumber,excessDetailUnavailable,contractComparisonUnavailable}`.
  English values are exactly the fallbacks written in T16–T19. Bahasa: "Jenis penagihan" / "Penagihan kontrak" / "Penagihan lainnya" / "Dihitung terhadap kontrak: mengurangi Sisa untuk ditagih, dan dihitung dalam pendapatan serta margin." / "Lisensi, penggantian biaya, dan pekerjaan di luar kontrak: dihitung dalam pendapatan dan margin, tidak pernah mengurangi Sisa untuk ditagih." / "Ubah jenis penagihan" / "Simpan jenis penagihan" / "Ditagihkan melebihi kontrak sebesar {{amount}}" / "Tagihan kontrak di balik kelebihan ini" / "Tagihan" / "Rincian tagihan di balik kelebihan ini tidak dapat diverifikasi." / "Perbandingan kontrak tidak tersedia: nilai kontrak belum dicatat, atau tagihan kontrak tidak dapat dibandingkan (mata uang atau dasar pajak)." (The builder reuses the catalogue's existing term for "Remaining to invoice": `Sisa untuk ditagih` appears at `project.json:153` for another surface - use whichever string the same screen's `projectFinances.remaining` already uses in `id/project.json`.)
- [ ] **T20.2 Verify:** `cd pmo-portal && npm run check:i18n`, plus the Indonesian assertions in T16/T18 tests. Commit.

---

## Phase 4 - End to end, proof and ship (T21–T23)

### T21 - E2E journey (AC-010)

**Files:** create `pmo-portal/e2e/AC-010-billing-kinds.spec.ts`. Read `docs/e2e-parallel-conventions.md` first (isolation tag, guard polarity). First line: `// @e2e-isolation: self-isolated - owns its project/invoices/refs and cleans them up.` Model on `pmo-portal/e2e/AC-PFIN-016-project-finances.spec.ts` (service-role fixture via `requireServiceRoleKey()`, signs in as Finance with the shared `signIn` helper, throws instead of skipping when the key is missing, deletes its rows in reverse-FK order in `afterEach`).

- [ ] **T21.1 Journey (the user's real path, asserting the goal):**
  1. Fixture (service role, unique names): a project (contract 1000, exclusive, USD, status "Ongoing Project") and two adopted ERP invoices linked to it, each with a revenue `external_refs` row, both left at the default kind: **P**, status Paid, amount 500 (the licence fee), and **Q**, status Unpaid, amount 900. Contract billing = 1400 > 1000, so the section shows an excess of 400 listing P and Q.
  2. Finance opens the project's finances section: sees "Invoiced above contract by 400" listing both invoices; records revenue/margin text for later comparison (the section's `Invoiced` / `Billed-work revenue` values).
  3. Finance opens Receivables, finds P's row, opens its menu → "Change project" → sets "Billing kind" to "Other billing" → Save (no project change, so no confirm step).
  4. Back on the project finances (and after `page.reload()`): "Remaining to invoice" now shows 100 (1000 − 900), the "Invoiced above contract" block is gone, **and** the `Invoiced` and `Billed-work revenue` figures equal the pre-correction values (kind changes only the contract comparison).
  5. DB check (service role): `sales_invoices.billing_kind = 'other'` for P; exactly one `record_changes` row for P with `changes.billing_kind`; **no** `external_command_outbox` row for P's id; the adapter-dispatch endpoint was never called (route spy as in AC-PFIN-016).
- [ ] **T21.2 Run** `scripts/e2e-local.sh AC-010` (add `--reset` only because this branch adds a migration: `scripts/e2e-local.sh --reset AC-010`). CI's `integration` job runs it on the PR to main; per the 2026-10-30 rule the dev PR does not.

### T22 - Rendered proof and a11y

- [ ] `scripts/ux-proof.sh` on the touched routes: `/finance/receivables` (dialog open, both modes), the project detail finances tab with an excess and with an unavailable comparison, and the create-invoice dialog. Check: the kind control wraps at 360px, the helper text is not truncated, the contributor list wraps, keyboard operation of the select and the links, `axe` clean. One review pass, one fix round (UI/redesign lane rule); screenshots to the owner.

### T23 - Final gate, review, ship

- [ ] **Local gate (touched files only):** `cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <every touched .ts/.tsx>` then the touched Vitest files (listed in T11–T19), touched pgTAP (T10 chain), `scripts/e2e-local.sh --reset AC-010`, `scripts/ux-proof.sh`. Plus `bash scripts/check-migration-collisions.sh` (renumber if it reports a collision).
- [ ] **Reviews:** `spec-reviewer`, `code-quality-reviewer`, `security-auditor` (money path + new definer RPCs: the reviewer gets T3.5/T5.5/T7.3 mutation results), then **Sol** review per the issue gate. UI step 6 (design-reviewer discover/graduate) applies to the three FE surfaces.
- [ ] **Push** branch only (`git log --format=%B origin/dev..HEAD | grep -qi co-authored` first). Director opens the dev PR (money path ships alone, never batched). CI `verify` + `pgtap` + both unit shards decide the merge; browser e2e runs on the release PR to main. Production is a separate owner-gated step; this slice's migration `0408` is additive and default-compatible, so a front-to-back deploy order (DB → edge function → FE) is safe at every intermediate step: the old FE keeps working against the new DB (default kind, 2-arg calls, extra payload key ignored), and the new FE never calls the new RPCs before the DB has them in a normal deploy.
- [ ] **Update the pinned Roadmap (#1571)** and close the issue's tickets in the same session as the merge.

---

## Traceability: every AC → its one owning test

| AC | Owning layer | Owning test (title leads with the AC id) | Task |
|---|---|---|---|
| AC-001 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T1, T2 (invalid-kind assertion) |
| AC-002 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T5 |
| AC-003 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T5 |
| AC-004 | unit | `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` | T18 (data shape proved by the `FR-009` pgTAP block in T5 and `parseContractExcess` tests in T14, neither is an AC owner) |
| AC-005 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T5 |
| AC-006 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T3 |
| AC-007 | pgTAP | `supabase/tests/billing_kinds_roles.test.sql` | T7 |
| AC-008 | unit | `pmo-portal/src/components/InvoiceProjectModal.test.tsx` | T16 |
| AC-009 | unit | `pmo-portal/src/hooks/useRevenue.billingKinds.test.tsx` (spec path `.test.ts`, see Q4) | T15 |
| AC-010 | e2e | `pmo-portal/e2e/AC-010-billing-kinds.spec.ts` | T21 |
| AC-011 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T4 |
| AC-012 | pgTAP | `supabase/tests/billing_kinds.test.sql` | T6 |
| AC-013 | unit | `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` | T18 |
| AC-014 | unit | `pmo-portal/pages/__tests__/SalesInvoices.createForm.test.tsx` | T17 |

Requirement coverage beyond ACs (supporting tests carry `FR-`/`NFR-` ids, not AC ids): FR-001 (T1 check constraint), FR-002 (T1, T2 Q1), FR-003 (T2 pgTAP; T11/T12 transport; AC-008, AC-014 UI), FR-004 (T3), FR-005 (T3 history events, T15 caches, T19 presentation), FR-006/007/008 (T5), FR-009 (T5 data, T14 parser, AC-004 UI), FR-010 (T18 AC-013), FR-011 (AC-008, AC-014, AC-013), FR-012 (AC-012 + T13), NFR-001 (AC-007 + T3.5/T7.3), NFR-002 (T14: `bigint` cents, no floats; SQL `numeric`), NFR-003 (D3: one scalar payload, no N+1), NFR-004 (T16–T20), NFR-005 (T9 rollback test).

## Money-path checklist (what the Sol/security review should see evidence for)

1. **Duplicate money:** none possible - no outbox write in any new path (AC-006 asserts outbox count unchanged; T13 asserts the kind never reaches an ERP body).
2. **Wrong-document adoption:** untouched - no probe/adopt code changes; the inbound adopt insert (`erpnextFeedDeps.ts:483`) gets the column default.
3. **Separation of duties:** the kind setter changes one column; AC-006 asserts `author_user_id`, `approved_by_id`, `status` and every other column unchanged; it is not an authorship event (it does not call `claim_sales_invoice_author` or touch `sales_invoice_authors`).
4. **Tenancy:** org filter inside the SELECT of the new RPC (foreign = missing), `org_id` never accepted from the client, service-role mirror writer inserts under its own `ctx.orgId`; AC-007 foreign-org rows.
5. **Wrong number on screen:** one aggregate, exact `numeric` text transport, FE arithmetic in `bigint` cents only to verify reconciliation; never a bare negative; unavailable states explained.
6. **Fail closed:** invalid kind → 23514 with `detail='billing-kind-invalid'`; mirror writer ignores an invalid kind rather than aborting after the ERP document exists (documented, tested).
7. **Mutation checks recorded:** T3.5, T5.5, T6.1, T7.3 - results pasted into the PR.

