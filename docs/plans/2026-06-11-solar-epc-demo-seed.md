# Plan — Solar EPC demo seed (`supabase/seed-demo-solar.sql`)

Date: 2026-06-11
Author: eng-planner
Feature slug: `solar-epc-demo-seed`
Plan file: `docs/plans/2026-06-11-solar-epc-demo-seed.md`

## 0. Context & scope

Owner-approved task: author ONE new idempotent SQL file `supabase/seed-demo-solar.sql` that
populates the **Supabase Cloud demo environment** with a believable **Solar Panel EPC** dataset:
the firm installs solar PV on factories / industrial complexes; per-project delivery flow is
**Engineering detail-design → Procurement of panels/inverters/mounting → field Construction**.

This is **demo-content work**, not behavior-change. The app's behavior (RPCs, RLS, triggers,
hooks) is already shipped and unchanged. There is therefore **no `docs/specs/*.spec.md`** and no
new `FR-`/`OBS-`/`NFR-` requirements — the owner's brief IS the requirement set. To keep the
plan's no-placeholder / traceable discipline, every data outcome the file must produce is captured
as a **`AC-DEMO-###`** acceptance gate (Given/When/Then) verified by a concrete SQL `select` or a
GoTrue login curl during local verification (Phase D). These ACs do NOT enter the app's pgTAP/e2e
oracle set — they are file-acceptance gates for this seed only.

**Hard boundaries (binding):**
- Write ONLY `supabase/seed-demo-solar.sql` (+ this plan, already under `docs/`). The OPTIONAL FE
  task (Phase E) touches `pmo-portal/src/auth/LoginPage.tsx` and a test — flagged separate, its own
  TDD, owner/Director may skip it.
- **NEVER modify `supabase/seed.sql`** (local pgTAP/e2e oracles depend on its exact numbers).
- The eng-planner writes only under `docs/`. The implementer writes the SQL file. The plan body
  below contains the **exact SQL** so the implementer transcribes, not invents.

### Why no ADR
This is data only: a separate seed file applied to one environment, reusing the existing schema,
RPCs, RLS and the `org_id` default seam. No architectural / irreversible / cross-cutting decision.
The reversibility contract is: the cloud demo DB is a throwaway demo environment; re-running the
file is idempotent, and a `supabase db reset`-equivalent (cloud reset) fully restores. No ADR.

### Architecture / existing-repo / performance lenses
- **Architecture:** the seed writes through the SAME seams the app uses — `org_id` is ALWAYS
  omitted (column default = Default Org `00000000-…-001`, the client-unspoofable seam, ADR-0011/0012).
  No new tables, no schema change, no RLS change. The file is pure `insert`/`update` DML inside one
  `begin`/`commit`, run by the DB superuser via `psql` (bypasses RLS by role, like seed.sql).
- **Existing-repo:** reuses seed-admin.sql's exact GoTrue insert shape (6 token columns = `''`),
  the budget Draft→items→Active flow (0001 partial-unique + 0005 `budget_line_items_draft_guard`
  trigger), and the static-doc-number convention (does NOT advance `procurement_doc_counters`,
  0006 comment lines 99-101). No duplicate logic introduced.
- **Performance:** ~6 projects, ~20 procurements, ~30 budget line items, ~10 tasks, a handful of
  timesheets — trivial row counts; no index/perf concern. The dataset is sized for a believable
  demo, not load.

### UUID namespace (collision-proof)
seed.sql owns: `4xxx` projects, `5xxx` budgets, `6xxx` procurements, `7xxx` timesheets,
`8xxx` tasks, `c0…001-005` companies, `a1–a5`+`b1–b4` profiles. This file uses a **distinct `d`-family
prefix** for ALL new business entities so it is also safely applicable on top of a full local seed
during Phase D verification:
- Companies: `cd000000-0000-0000-0000-0000000000XX`
- Projects: `d0000000-0000-0000-0000-0000000000XX`
- Budget versions: `d1000000-…`, budget line items use generated ids (no explicit id needed)
- Procurements: `d2000000-…`
- Tasks: `d3000000-…`
- Timesheets: `d4000000-…`
- Incidents / project_documents use generated ids.

The 5 SHARED personas keep their canonical seed.sql ids (`a1–a5`): inserted
`on conflict (id) do nothing` (so on cloud where only `a5` exists, `a1–a4` get created; locally
they already exist and are no-ops), then **renamed/titled via keyed UPDATE** so they get solar
identities. Acceptable that a local verification DB sees the personas renamed — that DB is reset to
the clean fixture at the end of Phase D (D6).

### The fictional firm
Internal company `c0000000-0000-0000-0000-000000000001` (today 'Acme Consulting Group' on cloud,
admin's FK already points at it) is renamed via UPDATE to **'Solaris Grid EPC'** (tasteful,
industry-plausible, not a real company). Admin profile renamed 'Sasha Okonkwo' / title
'Managing Director'... no — admin stays Admin role; see persona table in Task 4.

---

## 1. Personas (solar EPC identities, role unchanged)

| id (seed) | email | role (unchanged) | full_name | title | manager_id |
|---|---|---|---|---|---|
| a1 | exec@acme.test | Executive | Mara Lindqvist | Managing Director | (null — top) |
| a2 | pm@acme.test | Project Manager | Diego Salvatierra | Senior Project Manager | a1 |
| a3 | finance@acme.test | Finance | Priya Ramanathan | Finance Controller | a1 |
| a4 | engineer@acme.test | Engineer | Tomás Beck | Lead PV Engineer | a2 |
| a5 | admin@acme.test | Admin | Erin Adebayo | System Administrator | (null) |

manager chain: engineer(a4) → pm(a2) → exec(a1); finance(a3) → exec(a1). Set via post-insert
UPDATEs so no row references a not-yet-inserted manager (mirrors seed.sql lines 315-318).

Password for all 5 = `Passw0rd!dev` (public demo credential, documented in `.env.example`).

---

## 2. Companies

Rename the existing internal company; insert client (factories / industrial complexes) + vendor
(panel / inverter / mounting suppliers) companies under the `cd…` namespace.

| id | name | type |
|---|---|---|
| c0…001 (UPDATE) | Solaris Grid EPC | Internal |
| cd…01 | Meridian Steelworks | Client |
| cd…02 | Cascade Foods Processing | Client |
| cd…03 | Atlas Chemicals Plant | Client |
| cd…04 | Harbor Logistics Park | Client |
| cd…05 | SunVolt Modules Co. | Vendor (panels) |
| cd…06 | VoltEdge Inverters | Vendor (inverters) |
| cd…07 | RackMount Structures | Vendor (mounting/steel) |
| cd…08 | CableCore Electrical | Vendor (cabling/BoS) |

---

## 3. Project portfolio (lifecycle spread)

| id | code | name | status | client | contract_value | budget cohere |
|---|---|---|---|---|---|---|
| d0…01 | SP-2401 | Meridian Steelworks 4.2 MW Rooftop PV | Ongoing Project | cd…01 | 5,250,000 | budget ~4.5M, healthy |
| d0…02 | SP-2402 | Cascade Foods 6.0 MW Ground-Mount PV | Ongoing Project | cd…02 | 7,800,000 | budget ~6.9M, **near/over** (at-risk) |
| d0…03 | SP-2403 | Atlas Chemicals 2.8 MW Carport PV | Close Out | cd…03 | 3,600,000 | budget ~3.0M, completed |
| d0…04 | SP-2404 | Harbor Logistics 5.5 MW Rooftop PV | Negotiation | cd…04 | 6,400,000 | tender budget |
| d0…05 | SP-2405 | Northgate Mills Rooftop PV | Tender Submitted | cd…01 | 4,100,000 | tender budget |
| d0…06 | SP-2406 | Riverside Plastics PV Feasibility | PQ Submitted | cd…02 | 2,900,000 | tender budget |
| d0…07 | SP-2407 | Eastport Cold Storage Solar Scoping | Leads | cd…03 | 1,800,000 | tender budget |
| d0…08 | SP-2408 | Westfield Cannery PV Bid | Loss Tender | cd…04 | 3,200,000 | tender budget, decided_at only |

Won/Ongoing/Close-Out projects (`d0…01/02/03`) get `customer_contract_ref` + `contract_date` +
`decided_at` backfilled. Loss Tender (`d0…08`) gets `decided_at` only (null customer fields,
mirrors seed.sql lines 392-396). Pipeline projects (`d0…04/05/06/07`) get none. `start_date`/
`end_date` set on the three on-hand projects; null on pipeline.

The two flagship mid-delivery installs are **d0…01 (healthy)** and **d0…02 (at-risk)**.

---

## 4. SQL outline & data-integrity rules (the file MUST satisfy)

The file structure mirrors seed-admin.sql's header + seed.sql's body ordering:

```
\set ON_ERROR_STOP on
set search_path = public, extensions;
begin;
-- §A companies (UPDATE c…001 name; insert cd… clients+vendors on conflict do nothing)
-- §B auth.users (a1–a5 on conflict do nothing) + auth.identities (on conflict do nothing)
-- §C profiles (a1–a5 on conflict do nothing) + UPDATE name/title/company on all 5 + manager_id chain
-- §D projects (d0…01–08) on conflict (id) do nothing
-- §E budgets: per project insert version(s) Draft → insert line items → UPDATE to Active
-- §F procurements (d2…) on conflict do nothing + items + quotations(one is_selected) + receipts/invoices + UPDATE doc#/approver
-- §G tasks (d3…) ENG→PROC→CONST + task_dependencies
-- §H timesheets (d4…) current-week relative + entries
-- §I incident_reports + project_documents (engineering docs)
-- §J project win/loss backfill UPDATEs
commit;
```

**Integrity rules (verified against schema + seed.sql) the implementer MUST honor:**
1. **Budget flow:** insert `budget_versions` as `'Draft'` → insert `budget_line_items` → `update
   budget_versions set status='Active'`. The 0005 `budget_line_items_draft_guard` trigger rejects
   line-item inserts on a non-Draft version. **Exactly ONE Active version per project** (0001
   partial-unique `budget_versions_one_active_idx`). Every project carries one Active version with
   ≥1 line item. Archived prior versions are allowed (use distinct `version` ints per project).
2. **Timesheets:** `week_start_date` MUST be a Monday (0001 `week_is_monday` CHECK,
   `extract(dow)=1`). Use `date_trunc('week', current_date)::date` for current week and
   `(date_trunc('week', current_date) - interval '7 days')::date` for prior week, exactly like
   seed.sql lines 341/351. Timesheet entries' `entry_date` = that Monday `+ N` days.
3. **Quotations:** at most ONE `is_selected = true` per procurement (0001 partial-unique
   `procurement_quotations_one_selected_idx`). Non-selected quotes use `false`.
4. **auth.users:** the 6 token text columns (`confirmation_token`, `recovery_token`, `email_change`,
   `email_change_token_new`, `email_change_token_current`, `reauthentication_token`) MUST be `''`
   (empty string, NOT NULL) or GoTrue sign-in breaks. Matching `auth.identities` row required with
   `provider='email'`, `provider_id = email`, `identity_data` carrying `sub` + `email`.
5. **Won/Ongoing/Close-Out** projects get `customer_contract_ref` + `contract_date` + `decided_at`;
   **Loss Tender** gets `decided_at` only (customer fields null).
6. **Procurement doc numbers** (`PR-YYMMDD####`, `PO-…`, `VQ-…`, `GR-…`, `VI-…`) are STATIC
   hand-written fixture strings set via UPDATE/insert — they do NOT call
   `next_procurement_doc_number` and do NOT advance `procurement_doc_counters` (0006 lines 99-101).
7. **SoD realism:** `approved_by_id ≠ requested_by_id`; on any row meant to demo "Mark as Paid",
   the payer (finance a3) ≠ approver. Mirror seed.sql's SoD comments.
8. **manager_id** chain via post-insert UPDATEs (engineer→pm→exec; finance→exec).
9. **org_id ALWAYS omitted** on every insert (column default = Default Org).
10. **E→P→C ordering** modeled via `task_dependencies` (the app has no phase concept): every
    `PROC —` task depends on the project's `ENG —` task; every `CONST —` task depends on the
    `PROC —` task. Task names prefixed `ENG — `, `PROC — `, `CONST — `.
11. **Committed spend < budget** on healthy projects so dashboards look healthy; ONE project
    (d0…02) intentionally has committed procurement spend (Ordered..Paid) near/over its Active
    budget so the at-risk surface renders.
12. **Idempotency:** all inserts `on conflict (<key>) do nothing`; all renames/backfills are keyed
    UPDATEs (naturally idempotent). Budget `update … set status='Active'` is idempotent. The whole
    file is re-runnable. NOTE: budget-version inserts are `on conflict (id) do nothing` AND the
    `update … set status='Active'` runs unconditionally — on a second run the version already
    exists + is already Active, so the line-item inserts (also `on conflict` on a deterministic key)
    and the Active-update are no-ops. To make line items idempotent without a natural unique key,
    give each `budget_line_items` row an explicit `id` in the `d1…` namespace and
    `on conflict (id) do nothing` (id is the PK).

---

## 5. Acceptance gates (`AC-DEMO-###`) — Given/When/Then, verified in Phase D

- **AC-DEMO-001 (personas):** Given the file applied, When `select count(*) from profiles where
  email like '%@acme.test' and id in (a1..a5)`, Then 5 rows, each with a solar title (no
  'Acme Consulting').
- **AC-DEMO-002 (login):** Given the file applied to local, When a GoTrue password grant is POSTed
  for `exec@acme.test` and `engineer@acme.test` with `Passw0rd!dev`, Then both return a 200 +
  `access_token`.
- **AC-DEMO-003 (firm rename):** Given applied, When `select name,type from companies where
  id='c0…001'`, Then `('Solaris Grid EPC','Internal')`.
- **AC-DEMO-004 (lifecycle spread):** Given applied, When `select status, count(*) from projects
  where id in (d0…01..08) group by status`, Then statuses cover Ongoing Project(2), Close Out(1),
  Negotiation(1), Tender Submitted(1), PQ Submitted(1), Leads(1), Loss Tender(1).
- **AC-DEMO-005 (one Active budget/project):** Given applied, When checking each `d0…` project has
  exactly one Active `budget_versions` row with ≥1 line item, Then true for all 8.
- **AC-DEMO-006 (selected-quote uniqueness):** Given applied, When `select procurement_id,
  count(*) from procurement_quotations where is_selected group by procurement_id having count(*)>1`,
  Then 0 rows.
- **AC-DEMO-007 (full procure-to-pay trail):** Given applied, When inspecting the Paid procurement
  on d0…02, Then it has pr_number+po_number+a selected VQ+a GR receipt+a Paid invoice, and
  `approved_by_id ≠ requested_by_id`, and the Paid invoice's would-be payer (a3) ≠ approver.
- **AC-DEMO-008 (E→P→C dependencies):** Given applied, When inspecting tasks for d0…01, Then every
  `PROC —` task depends on an `ENG —` task and every `CONST —` task depends on a `PROC —` task
  (rows in `task_dependencies`).
- **AC-DEMO-009 (current-week timesheets):** Given applied, When `select week_start_date from
  timesheets where id in (d4…)`, Then each equals `date_trunc('week', current_date)::date` (or the
  prior Monday for the one Submitted sheet), satisfying `week_is_monday`.
- **AC-DEMO-010 (at-risk project):** Given applied, When summing Active-budget budgeted_amount vs
  committed procurement total_value (status in Ordered..Paid) for d0…02, Then committed ≥ ~90% of
  budget (at-risk surfaces render); for d0…01 committed < budget (healthy).
- **AC-DEMO-011 (idempotency):** Given the file applied once, When applied a SECOND time, Then it
  completes with no error and all `select count(*)` figures from AC-DEMO-001/004/005/006 are
  UNCHANGED.
- **AC-DEMO-012 (incident present):** Given applied, When `select count(*) from incident_reports
  where location like '%' and reported_by = a4`, Then ≥1 row tied to a flagship project site.
- **AC-DEMO-013 (engineering docs):** Given applied, When `select count(*) from project_documents
  where project_id in (d0…01,d0…02) and category='Engineering'`, Then ≥1 doc per flagship with a
  status in (Issued, Approved) and a believable title (Single Line Diagram / Structural Analysis
  Report / Detail Design Package / Capacity Study).

---

## 6. Tasks (bite-sized; each names its AC + verify command)

> The implementer writes `supabase/seed-demo-solar.sql` incrementally. Because a partial SQL file
> cannot be run mid-build, per-task "verify" is a **transcription check** (grep the fragment landed)
> until Phase D, where the WHOLE file is applied + the `AC-DEMO-###` content asserts run. Each task
> states the exact text to add. Run all `supabase`/`psql` commands **from the repo root**
> `/Users/ariefsaid/Coding/PMO`.

### Task 1 — File header + transaction envelope  (no AC; structural)
Create `supabase/seed-demo-solar.sql` with the run-instruction comment block (copy seed-admin.sql
lines 1-8 style, retargeted to this file + the solar dataset), then:
```sql
\set ON_ERROR_STOP on
set search_path = public, extensions;
begin;
-- (body added by later tasks)
commit;
```
Run instructions in the header comment (exact):
```
-- . supabase/op.prod.env && \
--   psql "$(~/.local/bin/op-get.sh "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")" -f supabase/seed-demo-solar.sql
```
Verify: `rg -n "ON_ERROR_STOP|^begin;|^commit;" supabase/seed-demo-solar.sql` shows all three.

### Task 2 — §A companies  (AC-DEMO-003)
Inside the txn, before `commit;`, add:
```sql
-- §A companies — rename the internal firm to the solar EPC; add solar clients/vendors.
update companies set name = 'Solaris Grid EPC', type = 'Internal'
  where id = 'c0000000-0000-0000-0000-000000000001';
insert into companies (id, name, type) values
  ('cd000000-0000-0000-0000-000000000001','Meridian Steelworks','Client'),
  ('cd000000-0000-0000-0000-000000000002','Cascade Foods Processing','Client'),
  ('cd000000-0000-0000-0000-000000000003','Atlas Chemicals Plant','Client'),
  ('cd000000-0000-0000-0000-000000000004','Harbor Logistics Park','Client'),
  ('cd000000-0000-0000-0000-000000000005','SunVolt Modules Co.','Vendor'),
  ('cd000000-0000-0000-0000-000000000006','VoltEdge Inverters','Vendor'),
  ('cd000000-0000-0000-0000-000000000007','RackMount Structures','Vendor'),
  ('cd000000-0000-0000-0000-000000000008','CableCore Electrical','Vendor')
on conflict (id) do nothing;
```
Verify: `rg -n "Solaris Grid EPC|SunVolt Modules" supabase/seed-demo-solar.sql`.

### Task 3 — §B auth.users + auth.identities for a1–a5  (AC-DEMO-002)
Add the 5-row `insert into auth.users (...) values (...) on conflict (id) do nothing;` block
(EXACT column list + `''` for all 6 token columns, copied from seed.sql lines 22-87 but ONLY rows
a1–a5; do NOT include b1–b4). Then the matching `insert into auth.identities (...) on conflict
(provider_id, provider) do nothing;` for a1–a5 (copy seed.sql lines 90-117, a1–a5 only).
Use ids `00000000-0000-0000-0000-0000000000a1` … `a5` and emails exec@/pm@/finance@/engineer@/
admin@acme.test.
Verify: `rg -c "0000000000a[1-5]'" supabase/seed-demo-solar.sql` returns ≥10 (5 users + 5 identities
reference each id at least once).

### Task 4 — §C profiles insert + solar-identity UPDATEs + manager chain  (AC-DEMO-001)
Add `insert into profiles (id, company_id, full_name, email, role, title, location, skills,
utilization) values (...) on conflict (id) do nothing;` for a1–a5 using the canonical roles
(Executive/Project Manager/Finance/Engineer/Admin), company_id `c0…001`, and the solar names/titles
from §1. Because cloud already has a5 with the old name, follow the insert with **keyed UPDATEs**
that set the solar `full_name` + `title` + `company_id` on ALL FIVE (so an already-present row gets
the solar identity):
```sql
update profiles set full_name='Mara Lindqvist',  title='Managing Director',        company_id='c0000000-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-0000000000a1';
update profiles set full_name='Diego Salvatierra',title='Senior Project Manager',    company_id='c0000000-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-0000000000a2';
update profiles set full_name='Priya Ramanathan', title='Finance Controller',        company_id='c0000000-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-0000000000a3';
update profiles set full_name='Tomás Beck',       title='Lead PV Engineer',          company_id='c0000000-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-0000000000a4';
update profiles set full_name='Erin Adebayo',     title='System Administrator',      company_id='c0000000-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-0000000000a5';
-- manager chain (post-insert UPDATE so no forward FK)
update profiles set manager_id='00000000-0000-0000-0000-0000000000a2' where id='00000000-0000-0000-0000-0000000000a4'; -- engineer→pm
update profiles set manager_id='00000000-0000-0000-0000-0000000000a1' where id in ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3'); -- pm,finance→exec
```
Verify: `rg -n "Mara Lindqvist|Lead PV Engineer|manager_id='00000000-0000-0000-0000-0000000000a1'" supabase/seed-demo-solar.sql`.

### Task 5 — §D projects (8 rows, no decided fields yet)  (AC-DEMO-004)
Add `insert into projects (id, code, name, status, client_id, project_manager_id, contract_value,
budget, spent, start_date, end_date) values (...) on conflict (id) do nothing;` with the 8 rows
from §3 (project_manager_id = a2 on all; start/end set on d0…01/02/03 only, null elsewhere; `budget`
= the Active-budget total each project will sum to; `spent` left 0 — derived/DEFERRED). Statuses:
2× 'Ongoing Project', 1× 'Close Out', 1× 'Negotiation', 1× 'Tender Submitted', 1× 'PQ Submitted',
1× 'Leads', 1× 'Loss Tender' (EXACT enum spellings incl. comma-free 'Loss Tender').
Verify: `rg -c "d0000000-0000-0000-0000-0000000000" supabase/seed-demo-solar.sql` ≥ 8 in §D block;
`rg -n "Ongoing Project|Close Out|Loss Tender|Negotiation" supabase/seed-demo-solar.sql`.

### Task 6 — §E budgets for the 3 on-hand projects (Draft→items→Active)  (AC-DEMO-005, AC-DEMO-010)
For d0…01, d0…02, d0…03 add one Active budget each (and ONE Archived prior version on d0…01 for
realism). Use explicit `id` on every `budget_line_items` row (PK in the `d1…` namespace, e.g.
`d1000000-0000-0000-0000-0000000001XX`) so re-runs are idempotent via `on conflict (id) do nothing`.
Line items use the 7 fixed categories where sensible (Labor / Materials / Subcontractors / Equipment
/ Permits & Fees / Overheads / Contingency). Budget totals: d0…01 ≈ 4,500,000 (vs 5.25M contract →
~14% margin); d0…02 ≈ 6,900,000 (vs 7.8M → ~11.5%); d0…03 ≈ 3,000,000 (vs 3.6M).
Pattern (exact ordering):
```sql
insert into budget_versions (id, project_id, version, name, status) values
  ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('d1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001',2,'Revised Budget','Draft'),
  ('d1000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000002',1,'Initial Budget','Draft'),
  ('d1000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000003',1,'Initial Budget','Draft')
on conflict (id) do nothing;
insert into budget_line_items (id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  -- d0…01 Revised (sums 4,500,000): Materials=panels, Equipment=inverters, Subcontractors=mounting, Labor, Permits, Contingency
  ('d1000000-0000-0000-0000-000000000101','d1000000-0000-0000-0000-000000000002','Materials','PV modules — 7,800× 540W panels',2400000,1300000),
  ('d1000000-0000-0000-0000-000000000102','d1000000-0000-0000-0000-000000000002','Equipment','String inverters & combiner boxes',700000,300000),
  ('d1000000-0000-0000-0000-000000000103','d1000000-0000-0000-0000-000000000002','Subcontractors','Roof mounting structures & install',650000,250000),
  ('d1000000-0000-0000-0000-000000000104','d1000000-0000-0000-0000-000000000002','Labor','Engineering & site supervision',400000,180000),
  ('d1000000-0000-0000-0000-000000000105','d1000000-0000-0000-0000-000000000002','Permits & Fees','Grid connection & permits',150000,90000),
  ('d1000000-0000-0000-0000-000000000106','d1000000-0000-0000-0000-000000000002','Contingency','Reserve',200000,0),
  -- d0…02 (sums 6,900,000) — at-risk: actuals run high
  ('d1000000-0000-0000-0000-000000000201','d1000000-0000-0000-0000-000000000003','Materials','PV modules — 11,200× 540W panels',3600000,3400000),
  ('d1000000-0000-0000-0000-000000000202','d1000000-0000-0000-0000-000000000003','Equipment','Central inverters & transformers',1300000,1250000),
  ('d1000000-0000-0000-0000-000000000203','d1000000-0000-0000-0000-000000000003','Subcontractors','Ground-mount piling & racking',1100000,1050000),
  ('d1000000-0000-0000-0000-000000000204','d1000000-0000-0000-0000-000000000003','Labor','Engineering & construction crew',500000,470000),
  ('d1000000-0000-0000-0000-000000000205','d1000000-0000-0000-0000-000000000003','Permits & Fees','Environmental & grid permits',200000,180000),
  ('d1000000-0000-0000-0000-000000000206','d1000000-0000-0000-0000-000000000003','Contingency','Reserve',200000,40000),
  -- d0…03 Close Out (sums 3,000,000)
  ('d1000000-0000-0000-0000-000000000301','d1000000-0000-0000-0000-000000000004','Materials','PV modules — 5,200× 540W panels',1500000,1500000),
  ('d1000000-0000-0000-0000-000000000302','d1000000-0000-0000-0000-000000000004','Equipment','Carport inverters',600000,600000),
  ('d1000000-0000-0000-0000-000000000303','d1000000-0000-0000-0000-000000000004','Subcontractors','Carport steel structures',650000,650000),
  ('d1000000-0000-0000-0000-000000000304','d1000000-0000-0000-0000-000000000004','Labor','Engineering & install',200000,200000),
  ('d1000000-0000-0000-0000-000000000305','d1000000-0000-0000-0000-000000000004','Contingency','Reserve',50000,0)
on conflict (id) do nothing;
update budget_versions set status='Active'
  where id in ('d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000004');
```
Verify: `rg -n "budget_line_items_draft_guard|status='Active'|budgeted_amount" supabase/seed-demo-solar.sql`
shows the Active-update lands AFTER the line-item insert; `rg -c "d1000000-" supabase/seed-demo-solar.sql` ≥ 20.

### Task 7 — §E budgets for the 5 pipeline/loss projects (Draft→item→Active)  (AC-DEMO-005)
Add one Active budget + ≥1 line item each for d0…04/05/06/07/08 (tender-prep stubs;
budgeted_amount ≈ contract_value for pipeline so they're margin-neutral, mirroring seed.sql's P011
pattern; Loss d0…08 a small Labor stub). Versions `d1000000-…0005` through `…0009`; line items
`d1000000-…401`…`801`. Follow Draft→insert-item→`update … set status='Active'`.
Verify: after this task EVERY `d0…` project has exactly one Active version (proven fully in Phase D
AC-DEMO-005). `rg -c "Tender Budget|Pipeline Budget" supabase/seed-demo-solar.sql` ≥ 5.

### Task 8 — §F procurements headers (panels/inverters/mounting/cabling)  (AC-DEMO-004 spread)
Add `insert into procurements (id, code, title, project_id, requested_by_id, status, total_value,
vendor_id, created_at) values (...) on conflict (id) do nothing;`. Use the `d2…` namespace. Spread
statuses across the flagship projects so the procurement list shows the full lifecycle:
- d0…01 (healthy flagship): one **Paid** (panels, vendor cd…05), one **Ordered** (inverters, cd…06),
  one **Vendor Quoted** (mounting, no vendor yet), one **Approved** (cabling).
- d0…02 (at-risk flagship): one **Paid** (panels, cd…05, large), one **Ordered** (inverters, cd…06),
  one **Received** (mounting, cd…07), one **Requested** (cabling, requested by a4 engineer).
- d0…03 (Close Out): one **Paid** (panels), one **Paid** (carport steel).
- d0…04 (Negotiation): one **Draft** (early scoping RFQ).
Total_value figures chosen so d0…02's Ordered..Paid committed sum ≈ 6,300,000 (≈ 91% of its
6,900,000 budget → at-risk), while d0…01's Ordered..Paid sum ≈ 2,900,000 (≈ 64% of 4,500,000 →
healthy). requested_by_id = a2 except the d0…02 Requested row (a4).
Verify: `rg -c "d2000000-" supabase/seed-demo-solar.sql` ≥ 11; `rg -n "'Paid'|'Ordered'|'Vendor Quoted'|'Received'|'Requested'|'Approved'|'Draft'" supabase/seed-demo-solar.sql`.

### Task 9 — §F procurement_items for each procurement  (AC-DEMO-010 amounts)
Add `insert into procurement_items (procurement_id, name, description, quantity, rate) values (...)`
(generated ids — no PK collision risk on re-run because… NOTE: `procurement_items` has no natural
unique key, so to keep idempotency give each row an explicit `id` in `d2…` namespace + `on conflict
(id) do nothing`). Quantities × rates should sum to each procurement's `total_value` (panel counts ×
unit rate, inverter counts, mounting lots, cable lots). Believable: 540W panels @ ~$280; string
inverters @ ~$4,500; central inverters @ ~$85,000; mounting per kW.
Verify: `rg -c "procurement_items" supabase/seed-demo-solar.sql` ≥ 1 and `rg -n "540W|inverter|mounting|cabling" supabase/seed-demo-solar.sql`.

### Task 10 — §F quotations (one is_selected per procurement) + VQ numbers  (AC-DEMO-006)
Add `insert into procurement_quotations (id, procurement_id, vendor_id, reference, total_amount,
received_date, is_selected, vq_number) values (...) on conflict (id) do nothing;` (explicit `d2…`
ids). For procurements at Vendor Quoted give 2 quotes both `false`; for Quote Selected / Ordered /
Received / Vendor Invoiced / Paid give the selected vendor quote `is_selected=true` with a static
`vq_number='VQ-YYMMDD####'`. NEVER two `true` for the same procurement.
Verify: `rg -c "is_selected" supabase/seed-demo-solar.sql` and (Phase D) AC-DEMO-006 select = 0 rows.

### Task 11 — §F receipts + invoices + doc-number/approver UPDATEs (full P2P trail)  (AC-DEMO-007)
For the Ordered..Paid rows add `procurement_receipts` (GR#, status Partial/Complete) and for Paid
rows `procurement_invoices` (VI#, status Paid). Use explicit `d2…` ids + `on conflict (id) do
nothing`. Then keyed UPDATEs stamping static `pr_number`/`po_number`/`approved_by_id` on each row:
approver MUST differ from requester (e.g. requester a2 → approver a3/finance or a1/exec; on the
Paid d0…02 row set approver = a1 so the payer a3 ≠ approver, demonstrating SoD-b). On at least one
Paid row also set `vendor_invoiced_at = now() - interval '14 days'` (0022 finance-debt demo column).
Verify: `rg -n "procurement_receipts|procurement_invoices|pr_number|approved_by_id|vendor_invoiced_at" supabase/seed-demo-solar.sql`; (Phase D) AC-DEMO-007.

### Task 12 — §G tasks ENG→PROC→CONST + dependencies  (AC-DEMO-008)
For the two flagship projects (d0…01, d0…02) add `insert into tasks (id, project_id, name,
start_date, end_date, assignee_id, status) values (...) on conflict (id) do nothing;` in the `d3…`
namespace, grouped:
- `ENG — Detail Design Package` (Done on d0…01, Done on d0…02)
- `ENG — Single Line Diagram` (Done)
- `PROC — Panel & Inverter Procurement` (In Progress)
- `PROC — Mounting Structure Procurement` (In Progress)
- `CONST — Roof/Ground Mounting Install` (To Do on d0…01; In Progress on d0…02)
- `CONST — Electrical Termination & Commissioning` (To Do)
assignee_id = a4 (engineer) on ENG/CONST, a2 (pm) acceptable on PROC. Then `insert into
task_dependencies (task_id, depends_on_id) values (...) on conflict (task_id, depends_on_id) do
nothing;` enforcing each PROC depends on an ENG task and each CONST depends on a PROC task.
Verify: `rg -n "ENG — |PROC — |CONST — |task_dependencies" supabase/seed-demo-solar.sql`;
(Phase D) AC-DEMO-008.

### Task 13 — §H timesheets (current week, relative dates) + entries  (AC-DEMO-009)
Add 2–3 current-week Draft timesheets (engineer a4, pm a2) and ONE prior-week Submitted sheet (use
a4 or a2 — DO NOT reuse seed.sql's b-actors). `d4…` ids. `week_start_date` =
`date_trunc('week', current_date)::date` (current) / `(date_trunc('week', current_date) - interval
'7 days')::date` (prior). Entries against flagship projects with solar notes
('Site survey at Meridian rooftop', 'Inverter commissioning at Cascade', etc.); `entry_date` =
Monday `+ N`. `on conflict (id) do nothing` on timesheets; explicit-id + `on conflict (id) do
nothing` on entries.
Verify: `rg -n "date_trunc\('week', current_date\)" supabase/seed-demo-solar.sql`; (Phase D)
AC-DEMO-009.

### Task 14 — §I incidents + engineering project_documents  (AC-DEMO-012, AC-DEMO-013)
Add ≥1 `incident_reports` row (e.g. 'Near Miss' at a flagship site, reported_by a4) and ≥1
`project_documents` row per flagship with `category='Engineering'`, status Issued/Approved, and
titles from {Single Line Diagram, Structural Analysis Report, Detail Design Package, Capacity
Study}. Explicit `d…` ids + `on conflict (id) do nothing` where the table has only a generated PK
(incidents/project_documents — give explicit ids for idempotency).
Verify: `rg -n "incident_reports|Single Line Diagram|Structural Analysis|Detail Design Package" supabase/seed-demo-solar.sql`; (Phase D) AC-DEMO-012/013.

### Task 15 — §J win/loss backfill UPDATEs  (AC-DEMO-004 decided-fields)
Add keyed UPDATEs:
```sql
-- Won/Ongoing/Close-Out: customer PO ref + contract_date + decided_at
update projects set customer_contract_ref='MSW-PO-2401', contract_date='2024-01-15', decided_at='2024-01-15T00:00:00Z' where id='d0000000-0000-0000-0000-000000000001';
update projects set customer_contract_ref='CFP-PO-2402', contract_date='2024-02-10', decided_at='2024-02-10T00:00:00Z' where id='d0000000-0000-0000-0000-000000000002';
update projects set customer_contract_ref='ACP-PO-2403', contract_date='2023-11-05', decided_at='2023-11-05T00:00:00Z' where id='d0000000-0000-0000-0000-000000000003';
-- Loss Tender: decided_at only (customer fields stay null)
update projects set decided_at='2024-03-20T00:00:00Z' where id='d0000000-0000-0000-0000-000000000008';
```
Verify: `rg -n "customer_contract_ref|decided_at" supabase/seed-demo-solar.sql`.

---

## 7. Phase D — Local verification protocol (run from repo root `/Users/ariefsaid/Coding/PMO`)

> Goal: prove the file applies cleanly, is idempotent, satisfies every AC-DEMO, and DOES NOT
> pollute the clean local fixture (restore at the end). The cloud apply is OWNER-GATED and NOT part
> of this protocol.

**D1 — clean baseline.** Ensure the local stack is up, then reset to the clean seed.sql fixture:
```
supabase status >/dev/null 2>&1 || supabase start
supabase db reset
```

**D2 — first apply.** Apply the demo file to the LOCAL db using the local connection string
(NOT op-get / NOT prod). Get the local URL from `supabase status` (the "DB URL", typically
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`):
```
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/seed-demo-solar.sql
```
Expect: ends with `COMMIT`, no error.

**D3 — content assertions (AC-DEMO-001/003/004/005/006/007/008/009/010/012/013).** Run one psql
batch capturing counts:
```
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At <<'SQL'
-- AC-DEMO-003
select 'firm', name||'/'||type from companies where id='c0000000-0000-0000-0000-000000000001';
-- AC-DEMO-001
select 'personas', count(*) from profiles where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a5') and title is not null;
-- AC-DEMO-004
select 'status:'||status, count(*) from projects where code like 'SP-24%' group by status order by status;
-- AC-DEMO-005 (each demo project: exactly one Active version w/ >=1 line item)
select 'active_budget_ok', bool_and(c=1) from (
  select p.id, count(*) filter (where v.status='Active') c
  from projects p join budget_versions v on v.project_id=p.id
  where p.code like 'SP-24%' group by p.id) t;
select 'active_has_items', bool_and(exists(select 1 from budget_line_items li where li.budget_version_id=v.id))
  from budget_versions v join projects p on p.id=v.project_id where p.code like 'SP-24%' and v.status='Active';
-- AC-DEMO-006
select 'multi_selected_quotes', count(*) from (select procurement_id from procurement_quotations where is_selected group by procurement_id having count(*)>1) x;
-- AC-DEMO-010 (committed Ordered..Paid vs Active budget per flagship)
select 'committed_'||p.code, sum(pr.total_value) filter (where pr.status in ('Ordered','Received','Vendor Invoiced','Paid')),
       (select sum(li.budgeted_amount) from budget_versions v join budget_line_items li on li.budget_version_id=v.id where v.project_id=p.id and v.status='Active')
  from projects p left join procurements pr on pr.project_id=p.id
  where p.id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002') group by p.code;
-- AC-DEMO-008 (every PROC depends on an ENG; every CONST depends on a PROC — flagship d0…01)
select 'proc_dep_eng', bool_and(exists(select 1 from task_dependencies d join tasks e on e.id=d.depends_on_id where d.task_id=t.id and e.name like 'ENG — %'))
  from tasks t where t.project_id='d0000000-0000-0000-0000-000000000001' and t.name like 'PROC — %';
select 'const_dep_proc', bool_and(exists(select 1 from task_dependencies d join tasks pp on pp.id=d.depends_on_id where d.task_id=t.id and pp.name like 'PROC — %'))
  from tasks t where t.project_id='d0000000-0000-0000-0000-000000000001' and t.name like 'CONST — %';
-- AC-DEMO-009 (timesheet weeks are Mondays = current or prior week)
select 'ts_mondays', bool_and(extract(dow from week_start_date)=1) from timesheets where id::text like 'd4%';
-- AC-DEMO-012
select 'incidents', count(*) from incident_reports where reported_by='00000000-0000-0000-0000-0000000000a4';
-- AC-DEMO-013
select 'eng_docs', count(*) from project_documents where category='Engineering' and project_id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002');
SQL
```
Expected: firm=`Solaris Grid EPC/Internal`; personas=5; the 8 statuses present (Ongoing Project=2,
others=1); active_budget_ok=`t`; active_has_items=`t`; multi_selected_quotes=0; committed for
d0…02 ≈ 6.3M against ~6.9M budget (≥90%) and d0…01 ≈ 2,360,000 / 52.4% against ~4.5M (<70%); proc_dep_eng=`t`;
const_dep_proc=`t`; ts_mondays=`t`; incidents≥1; eng_docs≥2.

**D4 — login smoke (AC-DEMO-002).** Get the local anon key + API URL from `supabase status`
("API URL" typically `http://127.0.0.1:54321`, "anon key"). For exec@ and engineer@:
```
curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"exec@acme.test","password":"Passw0rd!dev"}' | rg -o '"access_token"' && echo EXEC_OK
curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"engineer@acme.test","password":"Passw0rd!dev"}' | rg -o '"access_token"' && echo ENG_OK
```
Expected: both print `"access_token"` + the OK marker.

**D5 — idempotency (AC-DEMO-011).** Re-apply the file and re-run the D3 batch; figures must be
IDENTICAL and the apply must exit 0:
```
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/seed-demo-solar.sql && echo SECOND_APPLY_OK
# then re-run the D3 SQL batch and diff the output against the first run
```
Expected: `SECOND_APPLY_OK`; D3 counts unchanged.

**D6 — restore the clean fixture (MANDATORY).** Wipe demo data + persona renames so the local DB is
back to the pristine seed.sql state and pgTAP/e2e are NOT polluted:
```
supabase db reset
```
(`db reset` re-applies migrations + seed.sql from scratch — the demo rows and persona renames are
gone.) Optionally confirm: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c
"select name from companies where id='c0000000-0000-0000-0000-000000000001'"` returns
`Acme Consulting Group` again.

**D7 — guardrail check.** Confirm seed.sql was NOT touched: `git status --porcelain supabase/seed.sql`
prints nothing.

---

## 8. Phase E (OPTIONAL, owner/Director may skip) — surface all 5 personas in the demo panel

> Separate, optional, FE change. The current `LoginPage.tsx` demo panel (lines 83-84, 203-226)
> hardcodes ONLY `admin@acme.test` with one "Use demo login" fill button. To let a demo viewer try
> each role, list all 5 personas. This is a FE behavior change → it needs its own failing test FIRST
> (repo TDD rule). Flagged OPTIONAL because the seed task is complete without it (admin@ already
> works); do only on owner/Director approval.

**E1 (RED) — write the failing test.** Add/extend a test for `LoginPage` (co-locate per repo
convention; check for an existing `LoginPage.test.tsx`/`.spec.tsx` under `pmo-portal/src/auth/`
first — if none, create `pmo-portal/src/auth/LoginPage.test.tsx`). Test title MUST name a new AC,
e.g. `it('AC-DEMO-014: demo panel lists all five role personas with one-click fill', …)`. Render
`<LoginPage/>` with `import.meta.env.DEV` truthy (or stub `VITE_DEMO_MODE`), assert 5 buttons whose
accessible names include exec@/pm@/finance@/engineer@/admin@acme.test, click the exec@ one, assert
the email input now holds `exec@acme.test` and password `Passw0rd!dev`. Run:
`cd pmo-portal && npm test -- LoginPage` → expect FAIL (only admin@ exists today).

**E2 (GREEN) — implement.** In `LoginPage.tsx` replace the single `DEMO_EMAIL` constant with a
`DEMO_PERSONAS` array (`{label, email}` for the 5 roles; shared `DEMO_PASSWORD`), and render the
panel (lines 205-226) as a list of fill buttons (one per persona) that set
`email/password`. Keep the existing DESIGN.md tokens (no new gray-*/raw-hex/shadow utilities).
Run: `cd pmo-portal && npm test -- LoginPage` → PASS; then `npm run typecheck` (0 errors) and
`npm run lint -- --max-warnings=0`.

**E3 — coverage gate.** `cd pmo-portal && npm test -- --coverage LoginPage` → changed lines ≥80%.

> This FE change is delivered by the **implementer** under TDD, NOT by eng-planner. eng-planner does
> not write source/tests.

---

## 9. Traceability table

| Task | Section | AC covered |
|---|---|---|
| 1 | header/envelope | (structural) |
| 2 | §A companies | AC-DEMO-003 |
| 3 | §B auth users/identities | AC-DEMO-002 |
| 4 | §C profiles | AC-DEMO-001 |
| 5 | §D projects | AC-DEMO-004 |
| 6 | §E budgets (on-hand) | AC-DEMO-005, AC-DEMO-010 |
| 7 | §E budgets (pipeline/loss) | AC-DEMO-005 |
| 8 | §F procurement headers | AC-DEMO-004, AC-DEMO-010 |
| 9 | §F procurement items | AC-DEMO-010 |
| 10 | §F quotations | AC-DEMO-006 |
| 11 | §F receipts/invoices/doc# | AC-DEMO-007 |
| 12 | §G tasks + deps | AC-DEMO-008 |
| 13 | §H timesheets | AC-DEMO-009 |
| 14 | §I incidents/docs | AC-DEMO-012, AC-DEMO-013 |
| 15 | §J win/loss backfill | AC-DEMO-004 |
| D5 | (whole file, 2nd run) | AC-DEMO-011 |
| E1–E3 | LoginPage (OPTIONAL FE) | AC-DEMO-014 |

---

## 10. Hand-back

After Phase D passes (and optional Phase E), the file is ready. **The CLOUD apply is OWNER-GATED.**
Hand back to the Director; the owner approves the cloud run:
```
. supabase/op.prod.env && \
  psql "$(~/.local/bin/op-get.sh "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")" -f supabase/seed-demo-solar.sql
```
Do NOT run this without explicit owner approval (production-data write, charter checkpoint).

## 11. Open questions for the Director
1. **Firm name** — proposed 'Solaris Grid EPC'. Owner said "your call"; flag if a different name is
   preferred before cloud apply (the name is a single UPDATE, trivially changed).
2. **Optional FE persona panel (Phase E)** — build now, or defer? It changes login UX and needs its
   own PR/tests; admin@ already works without it.
3. **Cloud `op.prod.env` vars** — the header reuses `$OP_PROD_ITEM/$OP_PROD_VAULT/$OP_PROD_FIELD`
   exactly as seed-admin.sql. Confirm `supabase/op.prod.env` still exports those three (unverified
   here — read-only on code; it's referenced by seed-admin.sql so assumed current).
