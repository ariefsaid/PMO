# Plan — Approval routing by budget (#803)

- **Spec:** `docs/specs/approval-routing-by-budget.spec.md` (FR-APR-001…041, NFR-APR-001…005, AC-APR-001…040)
- **ADR:** `docs/adr/0075-spend-approval-routing.md`
- **Tier:** money / SoD / approval → **Director-dispatched**, not the ADW (CLAUDE.md executor routing). Builder
  brief must carry `docs/money-path-primer.md`. Director runs the mutation battery (Tasks 12–15) before merge.
- **Migration:** `supabase/migrations/0243_spend_approval_routing.sql`. `dev` head is `0231`; `0232` (#770) and
  `0233` (#805) are in flight. On a collision run `scripts/renumber-migration.sh 0234 <next>` — never hand-rename.

## 0. Conventions for every task

- `WT=/Users/ariefsaid/Coding/PMO/.claude/worktrees/803-approval-routing` — the Director creates this worktree off
  `origin/dev` on branch `codex/803-approval-routing` and symlinks `pmo-portal/node_modules`. Builders run no git.
- Every DB command runs reset + test in **one** lock hold (a sibling reset between them corrupts the result):
  `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`
- Vitest runs under the test lock from `pmo-portal/`: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run <files>`.
  If the test lock is held > 3 min, skip the local run and let CI decide (go-live handoff rule).
- TDD: every behaviour task is a RED task (write the test, run it, see it fail for the stated reason) followed by
  a GREEN task. "Fails for the stated reason" is part of the verify step — a test that fails for a different
  reason (syntax, missing fixture) is not RED.
- AC id is the leading token of every pgTAP description and every `it(...)` / `test(...)` title.

## 1. Design (brainstorm outcome, one decision at a time)

1. **Where the rule lives.** One SQL function, `public.spend_approval_route(org, project, category, amount,
   currency, requester)`, SECURITY INVOKER, record-agnostic. `transition_procurement` enforces with it; the UI reads
   it through `get_procurement_approval_routes(uuid[])`; #775 and #788 call it later. *Rejected:* a TS copy of the
   rule (would drift), a SECURITY DEFINER resolver (new client-callable definer = 0178 allow-list change for a read).
2. **Where config lives.** One table `spend_approvers(org_id, project_id null|uuid, profile_id)`. Project row =
   project approver; null-project row = senior set. Admin-only insert/delete via RLS, active-member read, audit
   trigger, no UPDATE. *Rejected:* `projects.approver_id` + an org array column (two write/audit paths, an array has
   no FK). *Reuse:* the existing `orgAccounting` policy key and the Administration › Accounting panel.
3. **"Would exceed".** At approve time, per category line, under a per-line advisory lock. Budget = Active
   version lines (OD-BUDGET-1); used = Reserved (ADR-0034) ∪ Committed (OD-BUDGET-2) on the same project+category;
   request amount = greatest(header total, Σ line items) because app-raised requests keep `total_value = 0` until a
   quote is selected. New column `procurements.budget_category` (nullable) is the only schema the rule needs.
4. **Missing config.** No rows → OD-PROC-1 flat matrix (today's behaviour, zero regression). Configured but nobody
   eligible → project escalates to senior set; senior set falls to the flat matrix. Unknowable budget fit → senior set.
5. **Enforcement shape.** Additive block in `transition_procurement` after SoD-a/SoD-b, before the role matrix,
   inside the `Requested → Approved|Rejected` branch only. Admin break-glass preserved (OD-PROC-1, owner-locked).
   Named approvers must hold rank ≥ PM, so routing only narrows the matrix.
6. **Inputs frozen.** BEFORE UPDATE trigger refuses RLS-subject changes to project/category/total after Draft;
   `actor_bypasses_rls()` (0174 idiom) exempts definer paths such as quote selection.
7. **UI data flow.** No new React hook. The DAL attaches `approvalRoute` to `Requested` rows inside
   `listProcurements` and `getProcurementDetail` (one RPC per load). Consumers read `row.approvalRoute`:
   the detail page gates Approve/Reject + shows a note; the shared `pendingProcurementApprovals` selector filters
   every "awaiting you" list (inbox, approval section, two dashboard counts) with no call-site change. A failed or
   absent route falls back to the role matrix (FR-APR-035) — the server enforces either way. This also keeps the
   ~20 existing page tests (many render without a `QueryClientProvider`) untouched.
8. **Notifications (#788).** Not merged (no `AC-WFN` code on `dev`). Named seam only: #788 resolves recipients via
   `spend_approval_route` (FR-APR-040). No code here.

**Error handling.** Server refusals are 42501 with distinct messages (`approval routing: <reason> requires a named
approver`, `procurements.<col> cannot change after…`) so pgTAP pins the gate, not just the code. UI shows the
reason before the click, so the refusal is a backstop. RLS denials on config writes surface through the existing
`classifyMutationError`.

**Scaling risks surfaced.** (a) The "used" sum is per (project, category); at millions of rows it stays bounded
by one project's procurements via `procurements_project_idx` — add `(project_id, budget_category)` only if a
profile shows it. (b) Routes are computed per list load for `Requested` rows only; the ⌘K unpaged list pays one
RPC. (c) The line lock serializes approvals on one line only, never across lines.

**Duplicate logic avoided.** One rule (SQL), one FE predicate (`mayDecideRoutedApproval`) used by both the detail
page and the shared selector; budget basis reuses OD-BUDGET-1/2 + ADR-0034 status sets.

## 2. File map

| File | Change |
|---|---|
| `supabase/migrations/0243_spend_approval_routing.sql` | new (§1–§8) |
| `supabase/tests/spend_approvers_config.test.sql` | new — AC-APR-016/017/020 |
| `supabase/tests/spend_approval_classify.test.sql` | new — AC-APR-006/007/011/012/019 |
| `supabase/tests/spend_approval_enforce.test.sql` | new — AC-APR-001…005/008…010/013…015 |
| `supabase/tests/spend_approval_inputs_frozen.test.sql` | new — AC-APR-018 |
| `supabase/tests/spend_approval_line_lock.test.sql` | new — AC-APR-021 |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated (never hand-edited) |
| `pmo-portal/src/lib/procurement/approvalRoute.ts` (+ `.test.ts`) | new — types, predicate, note (AC-APR-030) |
| `pmo-portal/src/lib/db/approvalRoutes.ts` (+ `.test.ts`) | new — RPC DAL + attach (AC-APR-035) |
| `pmo-portal/src/lib/db/procurements.ts` | `approvalRoute` on `ProcurementWithRefs`; list attaches |
| `pmo-portal/src/lib/db/procurementLifecycle.ts` | detail attaches |
| `pmo-portal/src/lib/selectors/approvals.ts` (+ new `approvals.test.ts`) | routing-aware (AC-APR-032) |
| `pmo-portal/pages/ProcurementDetails.tsx` | gate + note + header-edit prop |
| `pmo-portal/pages/procurement/ProcurementDecisionZone.tsx` | `routeNote` prop |
| `pmo-portal/pages/__tests__/ProcurementDetails.approvalRoute.test.tsx` | new — AC-APR-031 |
| `pmo-portal/src/lib/db/procurementCrud.ts` (+ new `procurementCrud.budgetCategory.test.ts`) | AC-APR-033 |
| `pmo-portal/pages/procurement/budgetCategoryOptions.ts` | new — shared select options |
| `pmo-portal/pages/procurement/NewProcurementModal.tsx`, `ProcurementHeaderEdit.tsx` | category select |
| `pmo-portal/pages/procurement/__tests__/budgetCategoryForms.test.tsx` | new — AC-APR-037 |
| `pmo-portal/src/lib/db/spendApprovers.ts` (+ `.test.ts`) | new — AC-APR-036 |
| `pmo-portal/src/lib/repositories/{types,index}.ts`, `index.test.ts` | 3 `orgSettings` methods |
| `pmo-portal/pages/admin/SpendApprovers.tsx` (+ `.test.tsx`) | new — AC-APR-034 |
| `pmo-portal/pages/Administration.tsx` | mount the card |
| `pmo-portal/src/lib/i18n/launch-scope-routes.txt` | add the admin file |
| `pmo-portal/public/locales/{en,id}/common.json` | `procurementDetail.route.*`, `admin.spendApprovers.*` |
| `pmo-portal/e2e/AC-APR-040-routed-procurement-approval.spec.ts` | new — AC-APR-040 |

---

## Phase A — Database (TDD with pgTAP)

### Task 1 — RED: configuration contract (AC-APR-016, 017, 020)

Create `supabase/tests/spend_approvers_config.test.sql`:

```sql
-- spend_approvers_config.test.sql — #803 spend-approver configuration.
-- AC-APR-016 (Admin-only writes, rank floor, same-org, stamped org, no client created_by),
-- AC-APR-017 (audit), AC-APR-020 (org isolation). Migration: 0243_spend_approval_routing.sql.
begin;
select plan(14);

insert into organizations (id, name, default_currency) values
  ('02341000-0000-0000-0000-00000000000a', 'APR Cfg Org A', 'IDR'),
  ('02341000-0000-0000-0000-00000000000b', 'APR Cfg Org B', 'IDR');

insert into auth.users (id, email) values
  ('02341000-0000-0000-0000-0000000000a1', 'apr-cfg-admin@example.com'),
  ('02341000-0000-0000-0000-0000000000a2', 'apr-cfg-pm@example.com'),
  ('02341000-0000-0000-0000-0000000000a3', 'apr-cfg-fin@example.com'),
  ('02341000-0000-0000-0000-0000000000a4', 'apr-cfg-eng@example.com'),
  ('02341000-0000-0000-0000-0000000000b1', 'apr-cfg-admin-b@example.com'),
  ('02341000-0000-0000-0000-0000000000b2', 'apr-cfg-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('02341000-0000-0000-0000-0000000000a1','02341000-0000-0000-0000-00000000000a','Cfg Admin A','apr-cfg-admin@example.com','Admin','active'),
  ('02341000-0000-0000-0000-0000000000a2','02341000-0000-0000-0000-00000000000a','Cfg PM A','apr-cfg-pm@example.com','Project Manager','active'),
  ('02341000-0000-0000-0000-0000000000a3','02341000-0000-0000-0000-00000000000a','Cfg Finance A','apr-cfg-fin@example.com','Finance','active'),
  ('02341000-0000-0000-0000-0000000000a4','02341000-0000-0000-0000-00000000000a','Cfg Engineer A','apr-cfg-eng@example.com','Engineer','active'),
  ('02341000-0000-0000-0000-0000000000b1','02341000-0000-0000-0000-00000000000b','Cfg Admin B','apr-cfg-admin-b@example.com','Admin','active'),
  ('02341000-0000-0000-0000-0000000000b2','02341000-0000-0000-0000-00000000000b','Cfg PM B','apr-cfg-pm-b@example.com','Project Manager','active');

insert into projects (id, org_id, name, status) values
  ('02341000-0000-0000-0000-000000000101','02341000-0000-0000-0000-00000000000a','Cfg Project A','Ongoing Project'),
  ('02341000-0000-0000-0000-000000000102','02341000-0000-0000-0000-00000000000b','Cfg Project B','Ongoing Project');

-- ── as Admin A ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000a3') $$,
  'AC-APR-016: an active Admin adds a Finance user to the senior set');
select is(
  (select org_id from spend_approvers where profile_id = '02341000-0000-0000-0000-0000000000a3'),
  '02341000-0000-0000-0000-00000000000a'::uuid,
  'AC-APR-016: org_id is stamped from the caller, never sent');
select lives_ok(
  $$ insert into spend_approvers (project_id, profile_id)
     values ('02341000-0000-0000-0000-000000000101', '02341000-0000-0000-0000-0000000000a2') $$,
  'AC-APR-016: an active Admin names a PM as a project approver');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000a4') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a profile below approval rank (Engineer) cannot be named');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000b2') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a profile from another org cannot be named');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id)
     values ('02341000-0000-0000-0000-000000000102', '02341000-0000-0000-0000-0000000000a3') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a project from another org cannot be used');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id, created_by)
     values (null, '02341000-0000-0000-0000-0000000000a2', '02341000-0000-0000-0000-0000000000a2') $$,
  '42501', 'permission denied for table spend_approvers',
  'AC-APR-016: created_by is not client-writable');

-- ── as PM A ───────────────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from spend_approvers), 2,
  'AC-APR-016: an active member reads the org''s approvers');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000a2') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a non-Admin cannot add an approver');
delete from spend_approvers;  -- USING denies a non-Admin silently: 0 rows, no error
reset role;
select is((select count(*)::int from spend_approvers where org_id = '02341000-0000-0000-0000-00000000000a'), 2,
  'AC-APR-016: a non-Admin delete removes nothing');

-- ── as Admin B ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from spend_approvers), 0,
  'AC-APR-020: another org''s Admin sees none of org A''s approvers');

-- ── Admin A removes the senior-set row ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from spend_approvers where profile_id = '02341000-0000-0000-0000-0000000000a3';
reset role;

select is(
  (select count(*)::int from audit_events
    where action = 'spend_approver.add' and actor_id = '02341000-0000-0000-0000-0000000000a1'
      and detail->>'profile_id' = '02341000-0000-0000-0000-0000000000a3'),
  1, 'AC-APR-017: adding an approver is audited with the actor and the profile');
select is(
  (select count(*)::int from audit_events
    where action = 'spend_approver.remove' and actor_id = '02341000-0000-0000-0000-0000000000a1'
      and detail->>'profile_id' = '02341000-0000-0000-0000-0000000000a3'),
  1, 'AC-APR-017: removing an approver is audited with the actor and the profile');
select is((select count(*)::int from spend_approvers where org_id = '02341000-0000-0000-0000-00000000000a'), 1,
  'AC-APR-016: the Admin removal landed');

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approvers_config.test.sql'`
→ fails with `relation "spend_approvers" does not exist`.

### Task 2 — GREEN: migration §header, §1 column, §2 rank floor, §3 table

Create `supabase/migrations/0243_spend_approval_routing.sql`:

```sql
-- 0243_spend_approval_routing.sql — #803 approval routing by budget.
-- Spec: docs/specs/approval-routing-by-budget.spec.md · ADR-0075 · Plan: docs/plans/2026-10-06-approval-routing-by-budget.md
-- Proven by supabase/tests/spend_approvers_config.test.sql, spend_approval_classify.test.sql,
--   spend_approval_enforce.test.sql, spend_approval_inputs_frozen.test.sql, spend_approval_line_lock.test.sql.
--
-- Routing NARROWS OD-PROC-1; it never widens it. transition_procurement keeps 0180's active-member gate,
-- SoD-a, SoD-b and role matrix verbatim and gains ONE extra refusal (§7). With no spend_approvers rows the
-- behaviour is exactly 0180's.
--
-- §1 procurements.budget_category · §2 holds_spend_approval_authority · §3 spend_approvers (+RLS, stamp, audit)
-- §4 procurement_request_amount · §5 spend_approval_route (THE rule; #775/#788 reuse it)
-- §6 get_procurement_approval_routes (UI read) · §7 transition_procurement · §8 routing inputs frozen
--
-- ── REVERSE (manual, in this order — not `db reset`; prod data may exist) ───────────────────────────
--   drop trigger if exists procurements_routing_inputs_frozen on public.procurements;
--   drop function if exists public.assert_procurement_routing_inputs_frozen();
--   -- §7: re-create transition_procurement from THIS file's §7 text minus every line marked `0234`
--   --     (the five extra declare vars, the widened select-into, the routing block). What remains is
--   --     0180's body. Reverse by editing this text, never by "re-applying migration NNN".
--   drop function if exists public.get_procurement_approval_routes(uuid[]);
--   drop function if exists public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid);
--   drop function if exists public.procurement_request_amount(uuid);
--   drop table if exists public.spend_approvers;   -- drops its policies and triggers
--   drop function if exists public.audit_spend_approver_change();
--   drop function if exists public.holds_spend_approval_authority(user_role);
--   revoke insert (budget_category), update (budget_category) on public.procurements from authenticated;
--   alter table public.procurements drop column if exists budget_category;
--   (§2's role_rank grant is additive and harmless — leave it.)

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the routing input the schema lacked: which budget line a request spends against.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.procurements add column budget_category public.budget_category;
comment on column public.procurements.budget_category is
  '#803: the Active-budget category line this request spends against. Decides approval routing '
  '(spend_approval_route). NULL on a project request routes to the senior set (fit unknowable). '
  'Client-writable only while Draft/Rejected (§8).';
grant insert (budget_category) on public.procurements to authenticated;
grant update (budget_category) on public.procurements to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — approval rank as rank, not a role list (ADR-0070). ≥ Project Manager == today's OD-PROC-1 approver
-- population plus Admin, so a named approver always also passes the unchanged role matrix in §7.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.holds_spend_approval_authority(p_role user_role) returns boolean
  language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(public.role_rank(p_role) >= public.role_rank('Project Manager'), false)
$$;
revoke all on function public.holds_spend_approval_authority(user_role) from public, anon;
grant execute on function public.holds_spend_approval_authority(user_role) to authenticated;
-- The FE read path (§6) runs as the caller, so the caller must be able to execute role_rank.
grant execute on function public.role_rank(user_role) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — spend_approvers: project row = that project's approver; null project = the org's senior set.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.spend_approvers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id  uuid references public.projects(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) default auth.uid(),
  constraint spend_approvers_unique unique nulls not distinct (org_id, project_id, profile_id)
);
create index spend_approvers_org_project_idx on public.spend_approvers (org_id, project_id);

-- 0074 idiom: the caller's real org overrides the seed-org default. No client sends org_id.
create trigger spend_approvers_stamp_org_id
  before insert on public.spend_approvers
  for each row execute function public.stamp_org_id();

alter table public.spend_approvers enable row level security;
alter table public.spend_approvers force  row level security;

create policy spend_approvers_select on public.spend_approvers for select
  using (org_id = auth_org_id() and public.is_active_member());

create policy spend_approvers_insert on public.spend_approvers for insert
  with check (
    org_id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin'
    and exists (select 1 from public.profiles pf
                 where pf.id = spend_approvers.profile_id and pf.org_id = auth_org_id()
                   and pf.status = 'active' and public.holds_spend_approval_authority(pf.role))
    and (spend_approvers.project_id is null
         or exists (select 1 from public.projects p
                     where p.id = spend_approvers.project_id and p.org_id = auth_org_id()))
  );

create policy spend_approvers_delete on public.spend_approvers for delete
  using (org_id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin');

revoke all on public.spend_approvers from anon, authenticated;
grant select on public.spend_approvers to authenticated;
grant insert (project_id, profile_id) on public.spend_approvers to authenticated;
grant delete on public.spend_approvers to authenticated;

create or replace function public.audit_spend_approver_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('spend_approver.add', new.org_id, auth.uid(), new.id,
      jsonb_build_object('project_id', new.project_id, 'profile_id', new.profile_id));
    return new;
  end if;
  perform public.log_audit('spend_approver.remove', old.org_id, auth.uid(), old.id,
    jsonb_build_object('project_id', old.project_id, 'profile_id', old.profile_id));
  return old;
end; $$;
revoke all on function public.audit_spend_approver_change() from public, anon, authenticated;

create trigger spend_approvers_audit
  after insert or delete on public.spend_approvers
  for each row execute function public.audit_spend_approver_change();
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approvers_config.test.sql supabase/tests/0131_org_stamp_trigger.test.sql supabase/tests/0215_org_checks_after_stamp.test.sql supabase/tests/dead_authenticated_write_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`
→ all `ok`; 14/14 in the new file.

### Task 3 — RED: classification (AC-APR-006, 007, 011, 012, 019)

Create `supabase/tests/spend_approval_classify.test.sql`:

```sql
-- spend_approval_classify.test.sql — #803 "within budget" classification, read through the UI RPC.
-- AC-APR-006 (Reserved+Committed count), 007 (greater of header/items), 011 (no category),
-- 012 (currency), 019 (route + approvers + scoping). Migration: 0243_spend_approval_routing.sql.
begin;
select plan(16);

insert into organizations (id, name, default_currency) values
  ('02342000-0000-0000-0000-00000000000a', 'APR Cls Org A', 'IDR'),
  ('02342000-0000-0000-0000-00000000000b', 'APR Cls Org B', 'IDR');
insert into auth.users (id, email) values
  ('02342000-0000-0000-0000-0000000000a1', 'apr-cls-viewer@example.com'),
  ('02342000-0000-0000-0000-0000000000a2', 'apr-cls-pm-approver@example.com'),
  ('02342000-0000-0000-0000-0000000000a3', 'apr-cls-fin-senior@example.com'),
  ('02342000-0000-0000-0000-0000000000a4', 'apr-cls-exec-senior@example.com'),
  ('02342000-0000-0000-0000-0000000000a5', 'apr-cls-eng@example.com'),
  ('02342000-0000-0000-0000-0000000000b1', 'apr-cls-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02342000-0000-0000-0000-0000000000a1','02342000-0000-0000-0000-00000000000a','Cls PM Viewer','apr-cls-viewer@example.com','Project Manager','active'),
  ('02342000-0000-0000-0000-0000000000a2','02342000-0000-0000-0000-00000000000a','Cls PM Approver','apr-cls-pm-approver@example.com','Project Manager','active'),
  ('02342000-0000-0000-0000-0000000000a3','02342000-0000-0000-0000-00000000000a','Cls Finance Senior','apr-cls-fin-senior@example.com','Finance','active'),
  ('02342000-0000-0000-0000-0000000000a4','02342000-0000-0000-0000-00000000000a','Cls Exec Senior','apr-cls-exec-senior@example.com','Executive','active'),
  ('02342000-0000-0000-0000-0000000000a5','02342000-0000-0000-0000-00000000000a','Cls Engineer','apr-cls-eng@example.com','Engineer','active'),
  ('02342000-0000-0000-0000-0000000000b1','02342000-0000-0000-0000-00000000000b','Cls PM B','apr-cls-pm-b@example.com','Project Manager','active');

insert into projects (id, org_id, name, status) values
  ('02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-00000000000a','Cls Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02342000-0000-0000-0000-000000000201','02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000101','v1',1,'Active');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount, fiscal_year) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Materials',1000,'FY-A'),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Materials', 500,'FY-B'),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Labor',     300,null),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Equipment',1000,null);

insert into spend_approvers (org_id, project_id, profile_id) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a2'),
  ('02342000-0000-0000-0000-00000000000a',null,'02342000-0000-0000-0000-0000000000a3'),
  ('02342000-0000-0000-0000-00000000000a',null,'02342000-0000-0000-0000-0000000000a4');

-- id suffix: 3xx = already on the line (Reserved/Committed), 4xx = Requested under test.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category, currency) values
  ('02342000-0000-0000-0000-000000000301','02342000-0000-0000-0000-00000000000a','Labor reserved', '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Approved',100,'Labor','IDR'),
  ('02342000-0000-0000-0000-000000000302','02342000-0000-0000-0000-00000000000a','Labor paid',     '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Paid',    100,'Labor','IDR'),
  ('02342000-0000-0000-0000-000000000401','02342000-0000-0000-0000-00000000000a','Labor request',  '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',150,'Labor','IDR'),
  ('02342000-0000-0000-0000-000000000402','02342000-0000-0000-0000-00000000000a','Equipment items','02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',100,'Equipment','IDR'),
  ('02342000-0000-0000-0000-000000000403','02342000-0000-0000-0000-00000000000a','No category',    '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested', 10,null,'IDR'),
  ('02342000-0000-0000-0000-000000000404','02342000-0000-0000-0000-00000000000a','Euro request',   '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested', 10,'Materials','EUR'),
  ('02342000-0000-0000-0000-000000000405','02342000-0000-0000-0000-00000000000a','Materials fits', '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',600,'Materials','IDR'),
  ('02342000-0000-0000-0000-000000000406','02342000-0000-0000-0000-00000000000a','Overhead',       null,                                  '02342000-0000-0000-0000-0000000000a5','Requested', 50,null,'IDR');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000402','Generator', 3, 400);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02342000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-APR-006: Labor 300; Approved 100 + Paid 100 already on it; 150 more does not fit.
select is((select reason    from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000401']::uuid[])), 'exceeds_line',
  'AC-APR-006: Reserved and Committed spend both count against the line');
select is((select route     from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000401']::uuid[])), 'org',
  'AC-APR-006: an over-line request routes to the senior set');
select is((select line_used from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000401']::uuid[])), 200::numeric,
  'AC-APR-006: line used = Approved 100 + Paid 100');

-- AC-APR-007: header 100, items 3 x 400 = 1200 against an Equipment line of 1000.
select is((select request_amount from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000402']::uuid[])), 1200::numeric,
  'AC-APR-007: request amount is the greater of header total and line items');
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000402']::uuid[])), 'exceeds_line',
  'AC-APR-007: the line-item value is what is checked against the line');

-- AC-APR-011: project request with no category.
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000403']::uuid[])), 'no_category',
  'AC-APR-011: a project request with no budget category cannot be checked');
select is((select route  from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000403']::uuid[])), 'org',
  'AC-APR-011: so it routes to the senior set');

-- AC-APR-012: EUR request against an IDR budget.
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000404']::uuid[])), 'currency_mismatch',
  'AC-APR-012: a request in another currency cannot be checked against the line');

-- AC-APR-019: Materials 1000 (FY-A) + 500 (FY-B) = 1500; 600 fits; the project approver decides.
select is((select route       from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])), 'project',
  'AC-APR-019: a within-line project request routes to the project approver');
select is((select reason      from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])), 'within_budget',
  'AC-APR-019: reason within_budget');
select is((select line_budget from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])), 1500::numeric,
  'AC-APR-019: the line spans every fiscal year of the Active version');
select is((select approvers   from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])),
  '[{"id":"02342000-0000-0000-0000-0000000000a2","full_name":"Cls PM Approver"}]'::jsonb,
  'AC-APR-019: approvers = the named project approver');
select is((select reason    from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000406']::uuid[])), 'no_project',
  'AC-APR-019: an overhead request has reason no_project');
select is((select approvers from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000406']::uuid[])),
  '[{"id":"02342000-0000-0000-0000-0000000000a4","full_name":"Cls Exec Senior"},{"id":"02342000-0000-0000-0000-0000000000a3","full_name":"Cls Finance Senior"}]'::jsonb,
  'AC-APR-019: an overhead request names both senior-set members');
select is((select count(*)::int from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000301']::uuid[])), 0,
  'AC-APR-019: only Requested requests are routed');

set local request.jwt.claims = '{"sub":"02342000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405','02342000-0000-0000-0000-000000000406']::uuid[])), 0,
  'AC-APR-019: another org''s caller gets no routes for org A ids');

reset role;
select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_classify.test.sql'`
→ fails with `function get_procurement_approval_routes(uuid[]) does not exist`.

### Task 4 — GREEN: §4 request amount, §5 the rule, §6 the UI read

Append to `supabase/migrations/0243_spend_approval_routing.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — request amount = greater of header total and Σ line items (DD-APR-2). App-raised requests keep
-- total_value = 0 until a quote is selected, so header-only would route a large request as "within".
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_request_amount(p_procurement_id uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select greatest(p.total_value,
                  coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = p.id), 0))
    from public.procurements p
   where p.id = p_procurement_id
$$;
revoke all on function public.procurement_request_amount(uuid) from public, anon;
grant execute on function public.procurement_request_amount(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — THE rule (FR-APR-010…015). Record-agnostic so #775 (claims) calls it unchanged and #788 reads its
-- approver_ids as notification recipients. SECURITY INVOKER: under the UI it runs as the caller (RLS
-- scopes every read); under transition_procurement (definer) it runs as the owner, which is why every
-- read below filters org_id = p_org_id explicitly.
-- Eligibility = active profile (status — the caller path cannot read auth.users; the transition's own
-- assert_is_active_member() still refuses an out-of-band ban) + approval rank + not the requester.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.spend_approval_route(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_reason   text;
  v_budget   numeric;
  v_used     numeric;
  v_currency text;
  v_foreign  boolean;
  v_rows     int;
  v_eligible uuid[];
begin
  -- 1. Classify (DD-APR-2).
  if p_project_id is null then
    v_reason := 'no_project';
  elsif p_category is null then
    v_reason := 'no_category';
  else
    select v.currency into v_currency
      from public.budget_versions v
     where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active';
    if not found then
      v_reason := 'no_active_budget';
    else
      select coalesce(sum(li.budgeted_amount), 0) into v_budget
        from public.budget_line_items li
        join public.budget_versions v on v.id = li.budget_version_id
       where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active'
         and li.category = p_category;
      -- Reserved (ADR-0034) ∪ Committed (OD-BUDGET-2) on this line. The request being decided is
      -- 'Requested', so it is never in its own sum.
      select coalesce(sum(public.procurement_request_amount(pr.id)), 0),
             coalesce(bool_or(pr.currency is distinct from v_currency), false)
        into v_used, v_foreign
        from public.procurements pr
       where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category
         and pr.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid');
      if p_currency is distinct from v_currency or v_foreign then
        v_reason := 'currency_mismatch';
      elsif v_used + p_amount > v_budget then
        v_reason := 'exceeds_line';
      else
        v_reason := 'within_budget';
      end if;
    end if;
  end if;

  -- 2. Within budget → the project's approvers (FR-APR-012/013/014).
  if v_reason = 'within_budget' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    if v_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;  -- unconfigured
      return;
    elsif cardinality(v_eligible) > 0 then
      return query select 'project'::text, v_reason, v_eligible, v_budget, v_used;
      return;
    end if;
    -- configured, nobody eligible → escalate to the senior set (FR-APR-014)
  end if;

  -- 3. The senior set (FR-APR-012/015).
  select coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_eligible
    from public.spend_approvers sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the UI read (FR-APR-021): one call for every listed Requested request. SECURITY INVOKER — RLS on
-- procurements is the org boundary; an id the caller cannot see yields no row.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.get_procurement_approval_routes(p_ids uuid[])
returns table (procurement_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select p.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         a.amount, r.line_budget, r.line_used
    from public.procurements p
    cross join lateral (select public.procurement_request_amount(p.id) as amount) a
    cross join lateral public.spend_approval_route(p.org_id, p.project_id, p.budget_category,
                                                   a.amount, p.currency, p.requested_by_id) r
   where p.id = any (p_ids) and p.status = 'Requested'
$$;
revoke all on function public.get_procurement_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_procurement_approval_routes(uuid[]) to authenticated;
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_classify.test.sql supabase/tests/spend_approvers_config.test.sql'` → 16/16 and 14/14.

### Task 5 — RED: enforcement (AC-APR-001…005, 008…010, 013…015)

Create `supabase/tests/spend_approval_enforce.test.sql`:

```sql
-- spend_approval_enforce.test.sql — #803 transition_procurement enforces the route.
-- Orgs: A (configured), C (no config → flat), D (senior set whose only member is disabled).
-- Migration: 0243_spend_approval_routing.sql §7.
begin;
select plan(19);

insert into organizations (id, name, default_currency) values
  ('02343000-0000-0000-0000-00000000000a','APR Enf Org A','IDR'),
  ('02343000-0000-0000-0000-00000000000c','APR Enf Org C','IDR'),
  ('02343000-0000-0000-0000-00000000000d','APR Enf Org D','IDR');
insert into auth.users (id, email) values
  ('02343000-0000-0000-0000-0000000000a0','apr-enf-admin@example.com'),
  ('02343000-0000-0000-0000-0000000000a1','apr-enf-pm-a@example.com'),
  ('02343000-0000-0000-0000-0000000000a2','apr-enf-pm-b@example.com'),
  ('02343000-0000-0000-0000-0000000000a3','apr-enf-fin-x@example.com'),
  ('02343000-0000-0000-0000-0000000000a4','apr-enf-exec-y@example.com'),
  ('02343000-0000-0000-0000-0000000000a5','apr-enf-fin-z@example.com'),
  ('02343000-0000-0000-0000-0000000000a6','apr-enf-eng-r@example.com'),
  ('02343000-0000-0000-0000-0000000000c1','apr-enf-pm-c@example.com'),
  ('02343000-0000-0000-0000-0000000000c2','apr-enf-eng-c@example.com'),
  ('02343000-0000-0000-0000-0000000000c3','apr-enf-eng-c2@example.com'),
  ('02343000-0000-0000-0000-0000000000d1','apr-enf-pm-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d2','apr-enf-fin-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d3','apr-enf-eng-d@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02343000-0000-0000-0000-0000000000a0','02343000-0000-0000-0000-00000000000a','Enf Admin','apr-enf-admin@example.com','Admin','active'),
  ('02343000-0000-0000-0000-0000000000a1','02343000-0000-0000-0000-00000000000a','Enf PM A','apr-enf-pm-a@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000a2','02343000-0000-0000-0000-00000000000a','Enf PM B','apr-enf-pm-b@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000a3','02343000-0000-0000-0000-00000000000a','Enf Fin X','apr-enf-fin-x@example.com','Finance','active'),
  ('02343000-0000-0000-0000-0000000000a4','02343000-0000-0000-0000-00000000000a','Enf Exec Y','apr-enf-exec-y@example.com','Executive','active'),
  ('02343000-0000-0000-0000-0000000000a5','02343000-0000-0000-0000-00000000000a','Enf Fin Z','apr-enf-fin-z@example.com','Finance','active'),
  ('02343000-0000-0000-0000-0000000000a6','02343000-0000-0000-0000-00000000000a','Enf Eng R','apr-enf-eng-r@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000c1','02343000-0000-0000-0000-00000000000c','Enf PM C','apr-enf-pm-c@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000c2','02343000-0000-0000-0000-00000000000c','Enf Eng C','apr-enf-eng-c@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000c3','02343000-0000-0000-0000-00000000000c','Enf Eng C2','apr-enf-eng-c2@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000d1','02343000-0000-0000-0000-00000000000d','Enf PM D','apr-enf-pm-d@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000d2','02343000-0000-0000-0000-00000000000d','Enf Fin D','apr-enf-fin-d@example.com','Finance','disabled'),
  ('02343000-0000-0000-0000-0000000000d3','02343000-0000-0000-0000-00000000000d','Enf Eng D','apr-enf-eng-d@example.com','Engineer','active');

insert into projects (id, org_id, name, status) values
  ('02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-00000000000a','Enf Project P','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-00000000000a','Enf Project Q','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000103','02343000-0000-0000-0000-00000000000c','Enf Project C','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02343000-0000-0000-0000-000000000201','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000101','v1',1,'Active'),
  ('02343000-0000-0000-0000-000000000202','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000102','v1',1,'Active');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000201','Materials',1000),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000202','Materials',1000);

-- Org A: PM A approves for P and Q; senior set = Fin X + Exec Y. Org D: senior set = disabled Fin D.
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a',null,'02343000-0000-0000-0000-0000000000a3'),
  ('02343000-0000-0000-0000-00000000000a',null,'02343000-0000-0000-0000-0000000000a4'),
  ('02343000-0000-0000-0000-00000000000d',null,'02343000-0000-0000-0000-0000000000d2');

insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02343000-0000-0000-0000-000000000401','02343000-0000-0000-0000-00000000000a','E1 fits',      '02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a6','Requested',400,'Materials'),
  ('02343000-0000-0000-0000-000000000402','02343000-0000-0000-0000-00000000000a','E2 over',      '02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a6','Requested',700,'Materials'),
  ('02343000-0000-0000-0000-000000000403','02343000-0000-0000-0000-00000000000a','E3 overhead',  null,                                  '02343000-0000-0000-0000-0000000000a6','Requested', 50,null),
  ('02343000-0000-0000-0000-000000000404','02343000-0000-0000-0000-00000000000a','E4 by approver','02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a1','Requested', 10,'Materials'),
  ('02343000-0000-0000-0000-000000000405','02343000-0000-0000-0000-00000000000a','E5 reject',    '02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a6','Requested', 20,'Materials'),
  ('02343000-0000-0000-0000-000000000406','02343000-0000-0000-0000-00000000000a','E6 admin',     '02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a6','Requested', 30,'Materials'),
  ('02343000-0000-0000-0000-000000000407','02343000-0000-0000-0000-00000000000c','EC1 flat',     '02343000-0000-0000-0000-000000000103','02343000-0000-0000-0000-0000000000c2','Requested', 10,'Materials'),
  ('02343000-0000-0000-0000-000000000408','02343000-0000-0000-0000-00000000000c','EC2 flat eng', '02343000-0000-0000-0000-000000000103','02343000-0000-0000-0000-0000000000c2','Requested', 10,'Materials'),
  ('02343000-0000-0000-0000-000000000409','02343000-0000-0000-0000-00000000000d','ED1 overhead', null,                                  '02343000-0000-0000-0000-0000000000d3','Requested',  5,null);

set local role authenticated;

-- E1 (400 of 1000, within) — PM B is not named; PM A is.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000401','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-APR-002: an approver-rank PM who is not named cannot approve a routed request');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000401','Approved') $$,
  'AC-APR-001: the named project approver approves a within-budget request');

-- E2 (700; 400 now Approved on the line → 1100 > 1000).
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000402','Approved') $$,
  '42501', 'approval routing: exceeds_line requires a named approver',
  'AC-APR-003: the project approver cannot approve spend that would exceed the line');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000402','Approved') $$,
  'AC-APR-003: a senior-set member approves the over-line request');

-- E3 overhead.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000403','Approved') $$,
  '42501', 'approval routing: no_project requires a named approver',
  'AC-APR-004: a Finance user outside the senior set cannot approve overhead');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000403','Approved') $$,
  'AC-APR-005: the second senior-set member alone approves overhead');

-- E4: the only project approver raised it → escalates to the senior set.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000404','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-APR-009: when the project approver is the requester, a non-senior Finance user cannot approve');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000404','Approved') $$,
  'AC-APR-009: the request escalates and a senior-set member approves');

-- E5: Reject follows the route.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000405','Rejected') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-APR-013: a non-named PM cannot reject a routed request');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000405','Rejected') $$,
  'AC-APR-013: the named approver rejects');

-- E6: Admin break-glass.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a0","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000406','Approved') $$,
  'AC-APR-014: an Admin may still decide a routed request (OD-PROC-1 break-glass)');

-- Org C: nothing configured → flat matrix.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000407','Approved') $$,
  'AC-APR-008: with no configuration any PM approves (flat matrix)');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000408','Approved') $$,
  '42501', 'not authorized for transition Requested -> Approved',
  'AC-APR-008: the role matrix still refuses an Engineer');

-- Org D: only senior-set member disabled → flat matrix.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000409','Approved') $$,
  'AC-APR-010: a senior set with nobody active falls back to the flat matrix');

reset role;

select is((select approved_by_id from procurements where id = '02343000-0000-0000-0000-000000000401'),
  '02343000-0000-0000-0000-0000000000a1'::uuid, 'AC-APR-001: approved_by_id is the named approver');
select is((select status::text from procurements where id = '02343000-0000-0000-0000-000000000403'), 'Approved',
  'AC-APR-005: one signature from the set is enough');
select is((select status::text from procurements where id = '02343000-0000-0000-0000-000000000405'), 'Rejected',
  'AC-APR-013: the rejection landed');
select is(
  (select detail - 'to' - 'break_glass' - 'budget_category' from audit_events
    where action = 'procurement.approval_route' and entity_id = '02343000-0000-0000-0000-000000000401'),
  '{"route":"project","reason":"within_budget","request_amount":400,"line_budget":1000,"line_used":0}'::jsonb,
  'AC-APR-015: the approval records its route, reason and the line figures');
select is(
  (select detail->>'break_glass' from audit_events
    where action = 'procurement.approval_route' and entity_id = '02343000-0000-0000-0000-000000000406'),
  'true', 'AC-APR-014: the Admin decision is marked break_glass in the audit');

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_enforce.test.sql'`
→ AC-APR-002/003(first)/004/009(first)/013(first) fail with "no exception raised" or "caught: 42501 not authorized…"
(the non-named Finance user is admitted by the flat matrix); AC-APR-015/014 audit assertions fail (no row).

### Task 6 — RED: line lock (AC-APR-021)

Create `supabase/tests/spend_approval_line_lock.test.sql`:

```sql
-- spend_approval_line_lock.test.sql — #803 FR-APR-018: approvals on one (project, category) line are
-- serialized. A second, genuinely concurrent session (dblink — the 0151 idiom) holds the line lock; the
-- approval must WAIT for it (55P03 under lock_timeout). Delete the lock in §7 and this goes red.
-- password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
begin;
select plan(3);
create extension if not exists dblink;

insert into organizations (id, name, default_currency) values ('02345000-0000-0000-0000-00000000000a','APR Lock Org','IDR');
insert into auth.users (id, email) values
  ('02345000-0000-0000-0000-0000000000a1','apr-lock-pm@example.com'),
  ('02345000-0000-0000-0000-0000000000a2','apr-lock-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02345000-0000-0000-0000-0000000000a1','02345000-0000-0000-0000-00000000000a','Lock PM','apr-lock-pm@example.com','Project Manager','active'),
  ('02345000-0000-0000-0000-0000000000a2','02345000-0000-0000-0000-00000000000a','Lock Eng','apr-lock-eng@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values
  ('02345000-0000-0000-0000-000000000101','02345000-0000-0000-0000-00000000000a','Lock Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02345000-0000-0000-0000-000000000201','02345000-0000-0000-0000-00000000000a','02345000-0000-0000-0000-000000000101','v1',1,'Active');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02345000-0000-0000-0000-00000000000a','02345000-0000-0000-0000-000000000201','Materials',1000);
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02345000-0000-0000-0000-00000000000a','02345000-0000-0000-0000-000000000101','02345000-0000-0000-0000-0000000000a1');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02345000-0000-0000-0000-000000000401','02345000-0000-0000-0000-00000000000a','Locked line','02345000-0000-0000-0000-000000000101','02345000-0000-0000-0000-0000000000a2','Requested',100,'Materials');

select dblink_connect('apr_line', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('apr_line', 'begin');
select ok(
  (select count(*)::int from dblink('apr_line', format($q$select pg_advisory_xact_lock(%s)$q$,
     hashtextextended('spend-line:02345000-0000-0000-0000-000000000101:Materials', 0))) as t(a text)) = 1,
  'AC-APR-021: a second session holds the Materials line lock');

set local lock_timeout = '200ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02345000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02345000-0000-0000-0000-000000000401','Approved') $$,
  '55P03', 'canceling statement due to lock timeout',
  'AC-APR-021: an approval on a locked line waits for the lock');
reset role;

select dblink_exec('apr_line', 'commit');
select dblink_disconnect('apr_line');
set local lock_timeout = 0;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02345000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02345000-0000-0000-0000-000000000401','Approved') $$,
  'AC-APR-021: once the other session ends the same approval proceeds');
reset role;

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_line_lock.test.sql'`
→ assertion 2 fails "no exception raised" (nothing takes the lock yet).

### Task 7 — GREEN: §7 `transition_procurement` (0180 body + routing block)

Append to the migration. Body is 0180's **verbatim** except the lines marked `-- 0234`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — transition_procurement: 0180's body VERBATIM plus the lines marked `0234`. Order is load-bearing:
-- active-member gate → org → legality → SoD-a → SoD-b → ROUTING (new) → role matrix. Routing sits AFTER
-- SoD-a so the requester is refused by SoD whoever is named, and BEFORE the matrix so it only narrows.
-- create-or-replace keeps the existing ACL (0185 revoked anon; authenticated EXECUTE unchanged).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_project     uuid;                    -- 0234
  v_category    public.budget_category;  -- 0234
  v_currency    text;                    -- 0234
  v_amount      numeric;                 -- 0234
  v_route       record;                  -- 0234
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id,
         project_id, budget_category, currency                       -- 0234
    into v_from, v_org, v_requester, v_approver,
         v_project, v_category, v_currency                           -- 0234
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-approve (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-pay (OD-PROC-8).
  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0234 (#803, FR-APR-010…019): approval routing by budget. Narrows who may decide; never widens.
  -- The line lock serializes concurrent approvals on one (project, category) so two cannot both spend
  -- the same headroom (FR-APR-018). The classify statement below runs AFTER the lock is held, so its
  -- snapshot sees any approval that committed while we waited (READ COMMITTED, volatile caller).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') then                         -- 0234
    if v_project is not null and v_category is not null then                               -- 0234
      perform pg_advisory_xact_lock(                                                       -- 0234
        hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0)); -- 0234
    end if;                                                                                -- 0234
    v_amount := public.procurement_request_amount(p_id);                                   -- 0234
    select * into v_route                                                                  -- 0234
      from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester); -- 0234
    -- coalesce: a NULL here must refuse, never pass (an `if` on NULL does not fire).      -- 0234
    if v_route.route <> 'flat' and not v_is_admin                                          -- 0234
       and not coalesce(v_uid = any (v_route.approver_ids), false) then                    -- 0234
      raise exception 'approval routing: % requires a named approver', v_route.reason     -- 0234
        using errcode = '42501';                                                           -- 0234
    end if;                                                                                -- 0234
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,             -- 0234
      jsonb_build_object(                                                                  -- 0234
        'to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,                -- 0234
        'request_amount', v_amount, 'line_budget', v_route.line_budget,                    -- 0234
        'line_used', v_route.line_used, 'budget_category', v_category::text,               -- 0234
        'break_glass', (v_route.route <> 'flat' and v_is_admin                             -- 0234
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));    -- 0234
  end if;                                                                                  -- 0234

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- Atomic single update: + FR-FIN-DEBT-002 vendor_invoiced_at stamp (fires ONLY on →'Vendor Invoiced',
  -- coalesce so a re-entry can't blank it; mirrors the approved_by_id/pr_number conditional stamps).
  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to = 'Vendor Invoiced' then now() else vendor_invoiced_at end,
    updated_at         = now()
  where id = p_id;

  -- FR-PR-016 / OQ-3: write the just-minted number onto the owning RECORD row (idempotent per [PD-3]).
  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_requests pr
                        where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_orders po
                        where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    insert into public.payments (procurement_id, pay_number, status, date, amount)
    select p_id, next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date, p.total_value
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id);
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;
```

Before saving, diff the non-`0234` lines against `supabase/migrations/0180_rpc_active_member_gate.sql` lines
648–778 by eye: the only differences allowed are the `-- 0234` lines and the two removed comment lines about
`v_from`/`v_org` at 0180:773–774.

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_enforce.test.sql supabase/tests/spend_approval_line_lock.test.sql supabase/tests/0013_procurement_transition_tenant.test.sql supabase/tests/0014_procurement_role_gate.test.sql supabase/tests/0015_procurement_sod.test.sql supabase/tests/0016_procurement_mint_atomicity.test.sql supabase/tests/0017_procurement_ref_uniqueness.test.sql supabase/tests/0019_procurement_orgid_anon.test.sql supabase/tests/0020_procurement_committed_contract.test.sql supabase/tests/0045_procurement_rls_hardening.test.sql supabase/tests/0055_authz_hardening.test.sql supabase/tests/0059_vendor_invoiced_at.test.sql supabase/tests/0080_transition_records.test.sql supabase/tests/0107_capture_vendor_invoice_atomic.test.sql supabase/tests/0167_create_path_sod_class.test.sql supabase/tests/0169_create_path_sod_residuals.test.sql supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/0173_rpc_active_member_gate.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`
→ every file `ok`; 19/19 enforce, 3/3 lock. A red pre-existing file means §7 drifted from 0180 — fix the body, never the test.

### Task 8 — RED: routing inputs frozen (AC-APR-018)

Create `supabase/tests/spend_approval_inputs_frozen.test.sql`:

```sql
-- spend_approval_inputs_frozen.test.sql — #803 FR-APR-020: once submitted, the inputs approval routing
-- decided on cannot be changed by a client; the server's quote selection still can change the total.
begin;
select plan(8);

insert into organizations (id, name, default_currency) values ('02344000-0000-0000-0000-00000000000a','APR Frz Org','IDR');
insert into auth.users (id, email) values
  ('02344000-0000-0000-0000-0000000000a1','apr-frz-pm@example.com'),
  ('02344000-0000-0000-0000-0000000000a2','apr-frz-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02344000-0000-0000-0000-0000000000a1','02344000-0000-0000-0000-00000000000a','Frz PM','apr-frz-pm@example.com','Project Manager','active'),
  ('02344000-0000-0000-0000-0000000000a2','02344000-0000-0000-0000-00000000000a','Frz Eng','apr-frz-eng@example.com','Engineer','active');
insert into companies (id, org_id, name, type) values
  ('02344000-0000-0000-0000-0000000000b1','02344000-0000-0000-0000-00000000000a','Frz Vendor','Vendor');
insert into projects (id, org_id, name, status) values
  ('02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-00000000000a','Frz P1','Ongoing Project'),
  ('02344000-0000-0000-0000-000000000102','02344000-0000-0000-0000-00000000000a','Frz P2','Ongoing Project');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02344000-0000-0000-0000-000000000401','02344000-0000-0000-0000-00000000000a','Submitted','02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-0000000000a2','Requested',    100,'Materials'),
  ('02344000-0000-0000-0000-000000000402','02344000-0000-0000-0000-00000000000a','Draft',    '02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-0000000000a2','Draft',        100,'Materials'),
  ('02344000-0000-0000-0000-000000000403','02344000-0000-0000-0000-00000000000a','Quoting',  '02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-0000000000a2','Vendor Quoted',100,'Materials');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount) values
  ('02344000-0000-0000-0000-0000000000c1','02344000-0000-0000-0000-00000000000a','02344000-0000-0000-0000-000000000403','02344000-0000-0000-0000-0000000000b1',250);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02344000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$ update procurements set project_id = '02344000-0000-0000-0000-000000000102' where id = '02344000-0000-0000-0000-000000000401' $$,
  '42501', 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it',
  'AC-APR-018: the project of a submitted request is fixed');
select throws_ok($$ update procurements set budget_category = 'Labor' where id = '02344000-0000-0000-0000-000000000401' $$,
  '42501', 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it',
  'AC-APR-018: the budget category of a submitted request is fixed');
select throws_ok($$ update procurements set total_value = 999 where id = '02344000-0000-0000-0000-000000000401' $$,
  '42501', 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it',
  'AC-APR-018: the header total of a submitted request is fixed');
select lives_ok($$ update procurements set title = 'Renamed' where id = '02344000-0000-0000-0000-000000000401' $$,
  'AC-APR-018: a non-routing column is still editable');
select lives_ok($$ update procurements set project_id = '02344000-0000-0000-0000-000000000102' where id = '02344000-0000-0000-0000-000000000402' $$,
  'AC-APR-018: a Draft request''s project is still editable');
select lives_ok($$ select select_procurement_quote('02344000-0000-0000-0000-0000000000c1') $$,
  'AC-APR-018: quote selection (server path) still runs');
reset role;

select is((select project_id from procurements where id = '02344000-0000-0000-0000-000000000402'),
  '02344000-0000-0000-0000-000000000102'::uuid, 'AC-APR-018: the Draft edit landed');
select is((select total_value from procurements where id = '02344000-0000-0000-0000-000000000403'), 250::numeric,
  'AC-APR-018: quote selection set the total');

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_inputs_frozen.test.sql'`
→ assertions 1–3 fail "no exception raised".

### Task 9 — GREEN: §8 inputs frozen

Append to the migration:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — FR-APR-020: once submitted, the routing inputs are fixed for every RLS-subject caller. Server
-- paths (SECURITY DEFINER owned by a BYPASSRLS role — select_procurement_quote, the importer, the ERP
-- read-model writers) are exempt through actor_bypasses_rls(), the 0174 idiom. Rejected is editable
-- because the requester reworks it back to Draft.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() or old.status in ('Draft','Rejected') then
    return new;
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it'
      using errcode = '42501';
  end if;
  if new.budget_category is distinct from old.budget_category then
    raise exception 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it'
      using errcode = '42501';
  end if;
  if new.total_value is distinct from old.total_value then
    raise exception 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.assert_procurement_routing_inputs_frozen() from public, anon, authenticated;

create trigger procurements_routing_inputs_frozen
  before update on public.procurements
  for each row execute function public.assert_procurement_routing_inputs_frozen();
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approval_inputs_frozen.test.sql supabase/tests/0045_procurement_rls_hardening.test.sql supabase/tests/0020_procurement_committed_contract.test.sql supabase/tests/0107_capture_vendor_invoice_atomic.test.sql supabase/tests/0080_transition_records.test.sql'` → all `ok`, 8/8.

### Task 10 — Regenerate types + full new-suite run (one hold)

```bash
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && supabase test db supabase/tests/spend_approvers_config.test.sql supabase/tests/spend_approval_classify.test.sql supabase/tests/spend_approval_enforce.test.sql supabase/tests/spend_approval_inputs_frozen.test.sql supabase/tests/spend_approval_line_lock.test.sql'
```

**Verify:** `grep -n "budget_category: Database" "$WT/pmo-portal/src/lib/supabase/database.types.ts" | head -3` shows the
new `procurements` column; `grep -n "get_procurement_approval_routes\|spend_approvers: {" "$WT/pmo-portal/src/lib/supabase/database.types.ts"` returns both;
all five pgTAP files `ok` (14 + 16 + 19 + 8 + 3 = 60 assertions).

### Task 11 — Prior suites that read the catalog (one hold)

```bash
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0131_org_stamp_trigger.test.sql supabase/tests/0215_org_checks_after_stamp.test.sql supabase/tests/dead_authenticated_write_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/0002_tenant_isolation.test.sql'
```

**Verify:** all `ok`. (CI's `pgtap` job runs the whole suite on the PR; this is the targeted local proof.)

### Tasks 12–15 — Mutation battery (money path; Director runs or witnesses)

Each: make the one edit to `supabase/migrations/0243_spend_approval_routing.sql`, run the command, confirm the
named assertion goes **red for the stated reason**, restore the exact original text, re-run to green.
Command template: `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <file>'`.

| Task | Mutation (edit) | File | Must go red |
|---|---|---|---|
| 12a | §7: change `and not coalesce(v_uid = any (v_route.approver_ids), false) then` to `and false then` | enforce | AC-APR-002, 003 (first), 004, 009 (first), 013 (first) |
| 12b | §7: delete the two lines `perform pg_advisory_xact_lock(` / `hashtextextended(...)` (leave the `if/end if` with `null;`) | line_lock | AC-APR-021 assertion 2 |
| 13a | §5: change the status list to `('Ordered','Received','Vendor Invoiced','Paid')` | classify | AC-APR-006 (all three) |
| 13b | §4: replace the `greatest(...)` expression with `p.total_value` | classify | AC-APR-007 (both) |
| 14a | §5: delete `sa.profile_id is distinct from p_requester_id and` in the **project** filter | enforce | AC-APR-009 (second) |
| 14b | §5: delete `and pf.status = 'active'` in the **senior-set** filter | enforce | AC-APR-010 |
| 15a | §8: delete the `total_value` `if … end if;` block | inputs_frozen | AC-APR-018 assertion 3 |
| 15b | §3: delete `and auth_role() = 'Admin'` from `spend_approvers_insert` | config | AC-APR-016 "a non-Admin cannot add an approver" |

**Verify:** record, per row, the failing assertion text and the restored-green run. A mutation that stays green is a
dead oracle — strengthen the test (not the mutation) and re-run.

---

## Phase B — Front end: the routing read

### Task 16 — RED: pure routing module (AC-APR-030)

Create `pmo-portal/src/lib/procurement/approvalRoute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { mayDecideRoutedApproval, approvalRouteNote, type ApprovalRoute } from './approvalRoute';

// Minimal t: returns the fallback, interpolating {{x}} from the options object.
const t = ((key: string, opt?: string | Record<string, string>) => {
  if (typeof opt === 'string') return opt;
  const o = opt ?? {};
  return (o.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => o[k] ?? '');
}) as unknown as TFunction;

const route = (over: Partial<ApprovalRoute> = {}): ApprovalRoute => ({
  procurementId: 'p1',
  route: 'project',
  reason: 'within_budget',
  approvers: [{ id: 'u-a', fullName: 'Ana Approver' }],
  requestAmount: 400,
  lineBudget: 1000,
  lineUsed: 0,
  ...over,
});

describe('AC-APR-030 mayDecideRoutedApproval', () => {
  it('AC-APR-030: no route adds no restriction (FR-APR-035)', () => {
    expect(mayDecideRoutedApproval(undefined, 'u-x', false)).toBe(true);
  });
  it('AC-APR-030: a flat route adds no restriction', () => {
    expect(mayDecideRoutedApproval(route({ route: 'flat', approvers: [] }), 'u-x', false)).toBe(true);
  });
  it('AC-APR-030: a named approver may decide', () => {
    expect(mayDecideRoutedApproval(route(), 'u-a', false)).toBe(true);
  });
  it('AC-APR-030: an un-named viewer may not', () => {
    expect(mayDecideRoutedApproval(route(), 'u-x', false)).toBe(false);
  });
  it('AC-APR-030: a viewer with no id may not', () => {
    expect(mayDecideRoutedApproval(route(), undefined, false)).toBe(false);
  });
  it('AC-APR-030: an Admin keeps break-glass', () => {
    expect(mayDecideRoutedApproval(route(), 'u-x', true)).toBe(true);
  });
});

describe('AC-APR-030 approvalRouteNote', () => {
  it('AC-APR-030: names the approver and the within-budget line', () => {
    expect(approvalRouteNote(route(), 'Materials', t)).toBe(
      "Approval for this request is routed to Ana Approver: it is within the project's Materials budget.",
    );
  });
  it('AC-APR-030: joins a senior set with "or" and states overhead', () => {
    const r = route({
      route: 'org',
      reason: 'no_project',
      approvers: [{ id: 'u-1', fullName: 'Ena' }, { id: 'u-2', fullName: 'Fin' }],
    });
    expect(approvalRouteNote(r, null, t)).toBe(
      'Approval for this request is routed to Ena or Fin: it is overhead spend, not charged to a project.',
    );
  });
  it('AC-APR-030: an escalated within-budget request says the project approver cannot act', () => {
    expect(approvalRouteNote(route({ route: 'org' }), 'Materials', t)).toContain(
      "the project's own approver cannot approve it.",
    );
  });
  it('AC-APR-030: over-line names the category', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'exceeds_line' }), 'Labor', t)).toContain(
      "would take the project's Labor budget over its limit",
    );
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/procurement/approvalRoute.test.ts` → fails: cannot resolve `./approvalRoute`.

### Task 17 — GREEN: `approvalRoute.ts`

Create `pmo-portal/src/lib/procurement/approvalRoute.ts`:

```ts
import type { TFunction } from 'i18next';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

/**
 * #803 approval routing — the FE mirror of `public.spend_approval_route` (migration 0234, ADR-0075).
 * UX ONLY (ADR-0016): `transition_procurement` is the authority. Pure — no I/O, no React.
 */
export type ApprovalRouteKind = 'project' | 'org' | 'flat';

export type ApprovalRouteReason =
  | 'within_budget'
  | 'no_project'
  | 'no_category'
  | 'no_active_budget'
  | 'currency_mismatch'
  | 'exceeds_line';

export interface ApprovalRouteApprover {
  id: string;
  fullName: string;
}

export interface ApprovalRoute {
  procurementId: string;
  route: ApprovalRouteKind;
  reason: ApprovalRouteReason;
  approvers: ApprovalRouteApprover[];
  requestAmount: number;
  lineBudget: number | null;
  lineUsed: number | null;
}

/**
 * May this viewer decide (approve/reject) as far as ROUTING is concerned? The OD-PROC-1 role matrix and
 * SoD-a are separate gates the caller still applies. No route (not Requested, or the read failed) adds
 * no restriction (FR-APR-035) — the server enforces either way.
 */
export function mayDecideRoutedApproval(
  route: ApprovalRoute | null | undefined,
  userId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (!route || route.route === 'flat') return true;
  if (isAdmin) return true;
  return Boolean(userId) && route.approvers.some((a) => a.id === userId);
}

/** One line telling a viewer who is not routed this request who decides it, and why (FR-APR-031). */
export function approvalRouteNote(route: ApprovalRoute, category: string | null, t: TFunction): string {
  const names = route.approvers
    .map((a) => a.fullName)
    .join(t('procurementDetail.route.nameJoiner', ' or '));
  const cat = category ? budgetCategoryLabel(category, t) : '';
  let why: string;
  if (route.route === 'org' && route.reason === 'within_budget') {
    why = t('procurementDetail.route.why.escalated', "the project's own approver cannot approve it.");
  } else if (route.reason === 'within_budget') {
    why = t('procurementDetail.route.why.withinBudget', {
      defaultValue: "it is within the project's {{category}} budget.",
      category: cat,
    });
  } else if (route.reason === 'exceeds_line') {
    why = t('procurementDetail.route.why.exceedsLine', {
      defaultValue: "it would take the project's {{category}} budget over its limit.",
      category: cat,
    });
  } else if (route.reason === 'no_project') {
    why = t('procurementDetail.route.why.noProject', 'it is overhead spend, not charged to a project.');
  } else if (route.reason === 'no_category') {
    why = t(
      'procurementDetail.route.why.noCategory',
      'it has no budget category, so it cannot be checked against the project budget.',
    );
  } else if (route.reason === 'no_active_budget') {
    why = t('procurementDetail.route.why.noActiveBudget', 'the project has no active budget.');
  } else {
    why = t(
      'procurementDetail.route.why.currencyMismatch',
      "its currency differs from the project budget's currency.",
    );
  }
  return t('procurementDetail.route.note', {
    defaultValue: 'Approval for this request is routed to {{names}}: {{why}}',
    names,
    why,
  });
}
```

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/procurement/approvalRoute.test.ts` → 10 passed.

### Task 18 — RED: route DAL (AC-APR-035)

Create `pmo-portal/src/lib/db/approvalRoutes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getProcurementApprovalRoutes, attachApprovalRoutes } from './approvalRoutes';

const rpcRow = {
  procurement_id: 'p-req',
  route: 'project',
  reason: 'within_budget',
  approvers: [{ id: 'u-a', full_name: 'Ana Approver' }],
  request_amount: '400.00',
  line_budget: '1000.00',
  line_used: '0',
};

beforeEach(() => h.rpc.mockReset());

describe('AC-APR-035 approval-route DAL', () => {
  it('AC-APR-035: calls the RPC with the ids, maps rows, never sends org_id', async () => {
    h.rpc.mockResolvedValue({ data: [rpcRow], error: null });
    const out = await getProcurementApprovalRoutes(['p-req']);
    expect(h.rpc).toHaveBeenCalledWith('get_procurement_approval_routes', { p_ids: ['p-req'] });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
    expect(out).toEqual([
      {
        procurementId: 'p-req',
        route: 'project',
        reason: 'within_budget',
        approvers: [{ id: 'u-a', fullName: 'Ana Approver' }],
        requestAmount: 400,
        lineBudget: 1000,
        lineUsed: 0,
      },
    ]);
  });

  it('AC-APR-035: no ids means no call', async () => {
    expect(await getProcurementApprovalRoutes([])).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('AC-APR-035: attaches routes to Requested rows only, in one call', async () => {
    h.rpc.mockResolvedValue({ data: [rpcRow], error: null });
    const out = await attachApprovalRoutes([
      { id: 'p-req', status: 'Requested' },
      { id: 'p-draft', status: 'Draft' },
    ]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('get_procurement_approval_routes', { p_ids: ['p-req'] });
    expect(out[0].approvalRoute?.approvers[0].fullName).toBe('Ana Approver');
    expect(out[1].approvalRoute).toBeUndefined();
  });

  it('AC-APR-035: a failed read leaves rows unrouted (role-matrix fallback, FR-APR-035)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });
    const out = await attachApprovalRoutes([{ id: 'p-req', status: 'Requested' }]);
    expect(out[0].approvalRoute).toBeUndefined();
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/approvalRoutes.test.ts` → cannot resolve `./approvalRoutes`.

### Task 19 — GREEN: `approvalRoutes.ts`

Create `pmo-portal/src/lib/db/approvalRoutes.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

interface RouteRpcRow {
  procurement_id: string;
  route: ApprovalRoute['route'];
  reason: ApprovalRoute['reason'];
  approvers: { id: string; full_name: string }[] | null;
  request_amount: number | string;
  line_budget: number | string | null;
  line_used: number | string | null;
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

/**
 * #803 FR-APR-021 — one RPC for every listed request. org_id is NEVER sent: the RPC is SECURITY INVOKER
 * and procurements RLS is the org boundary.
 */
export async function getProcurementApprovalRoutes(ids: string[]): Promise<ApprovalRoute[]> {
  if (ids.length === 0) return [];
  const { data, error } = (await supabase.rpc('get_procurement_approval_routes', { p_ids: ids })) as unknown as {
    data: RouteRpcRow[] | null;
    error: { message: string; code?: string } | null;
  };
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    procurementId: r.procurement_id,
    route: r.route,
    reason: r.reason,
    approvers: (r.approvers ?? []).map((a) => ({ id: a.id, fullName: a.full_name })),
    requestAmount: Number(r.request_amount),
    lineBudget: num(r.line_budget),
    lineUsed: num(r.line_used),
  }));
}

/**
 * Attach each Requested row's route (FR-APR-030/032), one RPC for the whole page (NFR-APR-003).
 * ponytail: a failed read leaves rows unrouted — the UI then applies the OD-PROC-1 role matrix
 * (FR-APR-035) while transition_procurement still enforces routing, so this degrades the hint, never
 * the control. Ceiling: a persistent RPC failure shows Approve to people the server will refuse.
 */
export async function attachApprovalRoutes<T extends { id: string; status: string }>(
  rows: T[],
): Promise<(T & { approvalRoute?: ApprovalRoute })[]> {
  const ids = rows.filter((r) => r.status === 'Requested').map((r) => r.id);
  if (ids.length === 0) return rows;
  let routes: ApprovalRoute[];
  try {
    routes = await getProcurementApprovalRoutes(ids);
  } catch {
    return rows;
  }
  const byId = new Map(routes.map((r) => [r.procurementId, r]));
  return rows.map((r) => {
    const route = byId.get(r.id);
    return route ? { ...r, approvalRoute: route } : r;
  });
}
```

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/approvalRoutes.test.ts` → 4 passed.

### Task 20 — Wire the attach into list + detail reads

1. `pmo-portal/src/lib/db/procurements.ts`
   - Add imports under the existing ones:
     ```ts
     import { attachApprovalRoutes } from './approvalRoutes';
     import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';
     ```
   - In `ProcurementWithRefs` add a member after `requested_by`:
     ```ts
       /** #803: present only on a Requested row whose route was read (see attachApprovalRoutes). */
       approvalRoute?: ApprovalRoute;
     ```
   - In `listProcurements` replace `return (data ?? []) as unknown as ProcurementWithRefs[];` with
     ```ts
       return attachApprovalRoutes((data ?? []) as unknown as ProcurementWithRefs[]);
     ```
     (`listProcurementsByVendor` is unchanged — the company history offers no approval.)
2. `pmo-portal/src/lib/db/procurementLifecycle.ts`
   - Add `import { attachApprovalRoutes } from './approvalRoutes';` under line 3.
   - In `getProcurementDetail` replace `return data as unknown as ProcurementDetail;` with
     ```ts
       const [withRoute] = await attachApprovalRoutes([data as unknown as ProcurementDetail]);
       return withRoute;
     ```

**Verify:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/procurements.test.ts src/lib/db/procurementLifecycle.test.ts src/lib/db/approvalRoutes.test.ts && ../scripts/with-test-lock.sh npm run typecheck`
→ green, zero type errors. (Existing DAL mocks without `rpc` exercise the fallback path; they must stay green
unchanged.)

### Task 21 — RED: routing-aware "awaiting you" (AC-APR-032)

Create `pmo-portal/src/lib/selectors/approvals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pendingProcurementApprovals } from './approvals';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

const routed = (ids: string[], kind: ApprovalRoute['route'] = 'project'): ApprovalRoute => ({
  procurementId: 'x',
  route: kind,
  reason: 'within_budget',
  approvers: ids.map((id) => ({ id, fullName: id })),
  requestAmount: 1,
  lineBudget: 10,
  lineUsed: 0,
});
const row = (id: string, approvalRoute?: ApprovalRoute, over: Record<string, unknown> = {}) =>
  ({ id, status: 'Requested', requested_by_id: 'u-req', approvalRoute, ...over }) as unknown as ProcurementWithRefs;

describe('AC-APR-032 awaiting-you respects approval routing', () => {
  it('AC-APR-032: keeps requests routed to me, flat, or unrouted; drops ones routed to someone else', () => {
    const list = [
      row('mine', routed(['u-me'])),
      row('theirs', routed(['u-other'])),
      row('flat', routed([], 'flat')),
      row('unrouted'),
    ];
    expect(pendingProcurementApprovals(list, 'u-me').map((r) => r.id)).toEqual(['mine', 'flat', 'unrouted']);
  });

  it('AC-APR-032: still drops my own requests (SoD-a) and non-Requested rows', () => {
    const list = [row('own', undefined, { requested_by_id: 'u-me' }), row('draft', undefined, { status: 'Draft' })];
    expect(pendingProcurementApprovals(list, 'u-me')).toEqual([]);
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/selectors/approvals.test.ts`
→ first test fails: received `['mine','theirs','flat','unrouted']`.

### Task 22 — GREEN: selector

Replace the body of `pmo-portal/src/lib/selectors/approvals.ts` with:

```ts
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { mayDecideRoutedApproval } from '@/src/lib/procurement/approvalRoute';

/**
 * The pending-procurement-approval predicate, hoisted to ONE place (Wave-6 H7).
 * A PR is awaiting the viewer's decision when it is `Requested`, was NOT raised by the viewer (SoD-a),
 * and — #803 — its approval route is flat/unread or names the viewer. Admin break-glass is deliberately
 * NOT applied here: a request routed to named people is not "awaiting" an Admin (DD-APR-5); the Admin
 * still decides it from the request page. UX-only; transition_procurement is the authority.
 * Returns a new array (never mutates input); tolerant of null/undefined.
 */
export function pendingProcurementApprovals(
  list: ProcurementWithRefs[] | null | undefined,
  selfId: string | null | undefined,
): ProcurementWithRefs[] {
  return (list ?? []).filter(
    (p) =>
      p.status === 'Requested' &&
      p.requested_by_id !== selfId &&
      mayDecideRoutedApproval(p.approvalRoute, selfId, false),
  );
}
```

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/selectors/approvals.test.ts pages/__tests__/Approvals.inbox.test.tsx pages/Approvals.test.tsx src/components/dashboard/AwaitingApprovalTile.test.tsx pages/ExecutiveDashboard.test.tsx pages/approvals/__tests__/ProcurementApprovalRow.test.tsx`
→ all green (existing fixtures carry no `approvalRoute`, so their behaviour is unchanged).

### Task 23 — RED: detail page gate + note (AC-APR-031)

Create `pmo-portal/pages/__tests__/ProcurementDetails.approvalRoute.test.tsx` by copying lines 1–169 of
`pmo-portal/pages/__tests__/ProcurementDetails.sodCopy.test.tsx` (the mocks, `base` fixture, `renderPage`,
`beforeEach`) verbatim, changing only the header comment to:

```ts
/**
 * AC-APR-031 — #803 approval routing on the request page. UX only (ADR-0016): who is offered
 * Approve/Reject on a Requested request, and the one-line note naming who decides and why.
 */
```

then appending:

```tsx
const routedTo = (id: string, fullName: string) => ({
  procurementId: 'proc-sod-001',
  route: 'project' as const,
  reason: 'within_budget' as const,
  approvers: [{ id, fullName }],
  requestAmount: 25000,
  lineBudget: 100000,
  lineUsed: 0,
});

describe('AC-APR-031 approval routing on the request page', () => {
  it('AC-APR-031: a Finance viewer the request is not routed to sees the note and no Approve/Reject', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = { ...base, status: 'Requested', budget_category: 'Materials', approvalRoute: routedTo('u-pm2', 'Pia Approver') };
    renderPage();
    expect(screen.getByTestId('approval-route-note').textContent).toBe(
      "Approval for this request is routed to Pia Approver: it is within the project's Materials budget.",
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('AC-APR-031: the named approver is offered Approve and sees no note', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = { ...base, status: 'Requested', budget_category: 'Materials', approvalRoute: routedTo('u-finance', 'Fay Finance') };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByTestId('approval-route-note')).not.toBeInTheDocument();
  });

  it('AC-APR-031: with no route the role matrix decides (fallback, FR-APR-035)', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('AC-APR-031: an Admin who is not named keeps break-glass', () => {
    mockRole = 'Admin';
    mockUserId = 'u-admin';
    detailState.data = { ...base, status: 'Requested', budget_category: 'Materials', approvalRoute: routedTo('u-pm2', 'Pia Approver') };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/ProcurementDetails.approvalRoute.test.tsx`
→ tests 1 fails (no `approval-route-note`; Approve present); tests 2–4 pass already (expected — they pin no-regression).

### Task 24 — GREEN: `ProcurementDecisionZone` note slot

In `pmo-portal/pages/procurement/ProcurementDecisionZone.tsx`:
1. In `ProcurementDecisionZoneProps`, after `gateMsg: string | null;` add:
   ```ts
     /** #803 FR-APR-031: who decides this routed request, and why — shown to a viewer who may not. */
     routeNote?: string | null;
   ```
2. In the destructuring, after `gateMsg,` add `routeNote = null,`.
3. Replace `const showReadyHint = !gateMsg && actions.length > 0 && !(isDraft && isRequester);` with
   ```ts
     const showReadyHint = !gateMsg && !routeNote && actions.length > 0 && !(isDraft && isRequester);
   ```
4. Directly after the `) : null}` that closes the `gateMsg ? … : showReadyHint ? …` block, insert:
   ```tsx
             {routeNote && (
               <p data-testid="approval-route-note" className="text-[13px] text-muted-foreground">
                 {routeNote}
               </p>
             )}
   ```

### Task 25 — GREEN: `ProcurementDetails` gate + note

In `pmo-portal/pages/ProcurementDetails.tsx`:
1. Add import after the `usePermission` import (line 33):
   `import { mayDecideRoutedApproval, approvalRouteNote } from '@/src/lib/procurement/approvalRoute';`
2. In `allowedActions`, add a last parameter after `t: TFunction,`:
   ```ts
     /** #803: false when the request is routed to named approvers who do not include the viewer. */
     routeAllows: boolean = true,
   ```
   and change the two conditions
   `if (legal('Approved') && canApproveReject(role) && !isRequester) {` →
   `if (legal('Approved') && canApproveReject(role) && !isRequester && routeAllows) {`
   `if (legal('Rejected') && canApproveReject(role) && !isRequester) {` →
   `if (legal('Rejected') && canApproveReject(role) && !isRequester && routeAllows) {`
3. Replace `const actions = sortActions(allowedActions(p.status, role, isRequester, isApprover, t));` with:
   ```ts
     // #803 (FR-APR-030/031/035): routing narrows who may decide. UX only — transition_procurement enforces.
     const routeAllows = mayDecideRoutedApproval(p.approvalRoute, currentUser?.id, realRole === 'Admin');
     const routeNote =
       p.approvalRoute && !routeAllows && !isRequester
         ? approvalRouteNote(p.approvalRoute, p.budget_category, t)
         : null;
     const actions = sortActions(allowedActions(p.status, role, isRequester, isApprover, t, routeAllows));
   ```
4. In the `<ProcurementDecisionZone … />` props, after `gateMsg={gateMsg}` add `routeNote={routeNote}`.

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/ProcurementDetails.approvalRoute.test.tsx pages/__tests__/ProcurementDetails.sodCopy.test.tsx pages/__tests__/ProcurementDetails.writePolicy.test.tsx pages/__tests__/ProcurementDetails.stepper.test.tsx pages/ProcurementDetails.test.tsx && ../scripts/with-test-lock.sh npm run typecheck`
→ 4/4 new, existing green, zero type errors.

### Task 26 — i18n: route note keys (en + id)

In `pmo-portal/public/locales/en/common.json`, inside the top-level `"procurementDetail"` object, add:

```json
"route": {
  "note": "Approval for this request is routed to {{names}}: {{why}}",
  "nameJoiner": " or ",
  "why": {
    "withinBudget": "it is within the project's {{category}} budget.",
    "exceedsLine": "it would take the project's {{category}} budget over its limit.",
    "noProject": "it is overhead spend, not charged to a project.",
    "noCategory": "it has no budget category, so it cannot be checked against the project budget.",
    "noActiveBudget": "the project has no active budget.",
    "currencyMismatch": "its currency differs from the project budget's currency.",
    "escalated": "the project's own approver cannot approve it."
  }
}
```

In `pmo-portal/public/locales/id/common.json`, inside `"procurementDetail"`, add:

```json
"route": {
  "note": "Persetujuan permintaan ini diarahkan ke {{names}}: {{why}}",
  "nameJoiner": " atau ",
  "why": {
    "withinBudget": "permintaan ini masih dalam anggaran {{category}} proyek.",
    "exceedsLine": "permintaan ini akan melampaui batas anggaran {{category}} proyek.",
    "noProject": "ini pengeluaran overhead, tidak dibebankan ke proyek.",
    "noCategory": "kategori anggarannya belum diisi, jadi tidak dapat dicek terhadap anggaran proyek.",
    "noActiveBudget": "proyek belum memiliki anggaran aktif.",
    "currencyMismatch": "mata uangnya berbeda dari mata uang anggaran proyek.",
    "escalated": "penyetuju proyek tidak dapat menyetujui permintaan ini."
  }
}
```

**Verify:** `cd "$WT/pmo-portal" && npm run check:i18n && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/ProcurementDetails.approvalRoute.test.tsx src/lib/procurement/approvalRoute.test.ts` → green.

---

## Phase C — Budget category on the request forms

### Task 27 — RED: DAL carries the category (AC-APR-033)

Create `pmo-portal/src/lib/db/procurementCrud.budgetCategory.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ inserted: null as unknown, updated: null as unknown }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        h.inserted = row;
        return { select: () => ({ single: async () => ({ data: { id: 'p1' }, error: null }) }) };
      },
      update: (row: unknown) => {
        h.updated = row;
        return { eq: () => ({ select: async () => ({ data: [{ id: 'p1' }], error: null }) }) };
      },
    }),
  },
}));

import { createProcurement, updateProcurementHeader } from './procurementCrud';

beforeEach(() => {
  h.inserted = null;
  h.updated = null;
});

describe('AC-APR-033 budget category is carried on create and header edit', () => {
  it('AC-APR-033: create sends budget_category and never org_id', async () => {
    await createProcurement({ title: 'Cable', projectId: 'pr1', vendorId: null, budgetCategory: 'Materials' }, 'u1');
    expect(h.inserted).toMatchObject({ budget_category: 'Materials', project_id: 'pr1' });
    expect(JSON.stringify(h.inserted)).not.toContain('org_id');
  });

  it('AC-APR-033: create without a category leaves the column unset', async () => {
    await createProcurement({ title: 'Cable', projectId: null, vendorId: null }, 'u1');
    expect(h.inserted).not.toHaveProperty('budget_category');
  });

  it('AC-APR-033: header edit sends a cleared category as null', async () => {
    await updateProcurementHeader('p1', { title: 'Cable', projectId: 'pr1', vendorId: null, budgetCategory: null });
    expect(h.updated).toMatchObject({ budget_category: null });
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/procurementCrud.budgetCategory.test.ts`
→ test 1 fails (`budget_category` absent); test 3 fails (absent).

### Task 28 — GREEN: `procurementCrud.ts`

In `pmo-portal/src/lib/db/procurementCrud.ts`:
1. Add `import type { BudgetCategory } from '@/src/lib/budget/categoryAccountMap';` under the existing imports.
2. In `NewProcurementInput`, after `vendorId: string | null;` add:
   ```ts
     /** #803: the budget line this request spends against — decides approval routing. */
     budgetCategory?: BudgetCategory | null;
   ```
3. In `createProcurement`'s `.insert({...})`, after `vendor_id: input.vendorId,` add:
   ```ts
         ...(input.budgetCategory !== undefined ? { budget_category: input.budgetCategory } : {}),
   ```
4. In `ProcurementHeaderPatch`, after `vendorId: string | null;` add:
   ```ts
     /** #803: sent only when the editor changed it; `null` clears it. */
     budgetCategory?: BudgetCategory | null;
   ```
5. In `updateProcurementHeader`'s `.update({...})`, after `vendor_id: patch.vendorId,` add:
   ```ts
         ...(patch.budgetCategory !== undefined ? { budget_category: patch.budgetCategory } : {}),
   ```

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/procurementCrud.budgetCategory.test.ts src/lib/db/procurementCrud.test.ts` → green.

### Task 29 — RED: form selects (AC-APR-037)

Create `pmo-portal/pages/procurement/__tests__/budgetCategoryForms.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out', sub: 'PRJ-1' }] }),
  useVendorOptions: () => ({ data: [] }),
}));

import { NewProcurementModal } from '../NewProcurementModal';
import { ProcurementHeaderEdit } from '../ProcurementHeaderEdit';

function renderNew() {
  const onCreate = vi.fn().mockResolvedValue({ id: 'pc-new' });
  render(
    <ToastProvider>
      <NewProcurementModal onClose={vi.fn()} onCreate={onCreate} onCreated={vi.fn()} onError={vi.fn()} />
    </ToastProvider>,
  );
  return onCreate;
}

describe('AC-APR-037 budget category on the request forms', () => {
  it('AC-APR-037: a chosen category is passed to onCreate', async () => {
    const onCreate = renderNew();
    await userEvent.type(screen.getByLabelText(/title/i), 'Cable');
    await userEvent.selectOptions(screen.getByLabelText('Budget category'), 'Materials');
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ budgetCategory: 'Materials' });
  });

  it('AC-APR-037: "No category" omits the field', async () => {
    const onCreate = renderNew();
    await userEvent.type(screen.getByLabelText(/title/i), 'Cable');
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('budgetCategory');
  });

  it('AC-APR-037: the Draft header edit sends a cleared category as null', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ProcurementHeaderEdit
          title="Cable"
          projectId="proj-1"
          projectName="HQ Fit-Out"
          vendorId={null}
          vendorName={null}
          budgetCategory="Materials"
          onSave={onSave}
          onError={vi.fn()}
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText('Budget category'), '');
    await userEvent.click(screen.getByRole('button', { name: /save request/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ budgetCategory: null })));
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/procurement/__tests__/budgetCategoryForms.test.tsx`
→ fails: unable to find a label "Budget category".

### Task 30 — GREEN: shared options + both forms

1. Create `pmo-portal/pages/procurement/budgetCategoryOptions.ts`:
   ```ts
   import { Constants } from '@/src/lib/supabase/database.types';

   /** #803 FR-APR-033: the request forms' optional budget-category select ('' = "No category"). */
   export const BUDGET_CATEGORY_OPTIONS = [
     { value: '', label: 'No category' },
     ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: c })),
   ];

   export const BUDGET_CATEGORY_HELPER =
     "Decides who approves: spend within the project's budget for this category goes to the project approver.";
   ```
2. `pmo-portal/pages/procurement/NewProcurementModal.tsx`:
   - add `SelectField,` to the `@/src/components/ui` import list;
   - add imports: `import type { BudgetCategory } from '@/src/lib/budget/categoryAccountMap';` and
     `import { BUDGET_CATEGORY_OPTIONS, BUDGET_CATEGORY_HELPER } from './budgetCategoryOptions';`
   - `FormValues`: add `budgetCategory: string;`
   - `initialValues`: `{ title: '', projectId: initialProjectId, vendorId: null, budgetCategory: '' }`
   - in `onCreate({...})` after `vendorId: values.vendorId,` add
     `...(values.budgetCategory ? { budgetCategory: values.budgetCategory as BudgetCategory } : {}),`
   - after the Vendor `<Combobox … />` add:
     ```tsx
               <SelectField
                 id="new-pr-budget-category"
                 label="Budget category"
                 value={form.values.budgetCategory}
                 onChange={(v) => form.setValue('budgetCategory', v)}
                 options={BUDGET_CATEGORY_OPTIONS}
                 helper={BUDGET_CATEGORY_HELPER}
               />
     ```
3. `pmo-portal/pages/procurement/ProcurementHeaderEdit.tsx`:
   - add `SelectField,` to the ui import; add the same two imports as above;
   - `FormValues`: add `budgetCategory: string;`
   - props interface: add `budgetCategory?: BudgetCategory | null;` after `vendorName`; destructure
     `budgetCategory = null,` after `vendorName,`
   - `initialValues: { title, projectId, vendorId, budgetCategory: budgetCategory ?? '' }` and
     `reset({ title, projectId, vendorId, budgetCategory: budgetCategory ?? '' });`
   - in `onSave({...})` after `vendorId: values.vendorId,` add
     ```ts
               // Sent only when changed, so an untouched form saves exactly what it did before #803.
               ...(values.budgetCategory !== (budgetCategory ?? '')
                 ? { budgetCategory: (values.budgetCategory || null) as BudgetCategory | null }
                 : {}),
     ```
   - after the Vendor `<Combobox … />` add the same `<SelectField>` with `id="pr-header-edit-budget-category"`.
4. `pmo-portal/pages/ProcurementDetails.tsx`: in `<ProcurementHeaderEdit …>` after `vendorName={p.vendor?.name ?? null}`
   add `budgetCategory={p.budget_category}`.

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/procurement/__tests__/budgetCategoryForms.test.tsx pages/procurement/NewProcurementModal.test.tsx pages/procurement/ProcurementHeaderEdit.test.tsx pages/__tests__/EntityFormReadiness.f8.test.tsx pages/project-detail/__tests__/ProcurementTab.newrequest.test.tsx && ../scripts/with-test-lock.sh npm run typecheck`
→ 3/3 new; existing exact-payload tests unchanged and green.

---

## Phase D — Admin configuration surface

### Task 31 — RED: spend-approver DAL (AC-APR-036)

Create `pmo-portal/src/lib/db/spendApprovers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: { data: null as unknown, error: null as unknown },
}));
vi.mock('@/src/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  const rec = (name: string) => (...args: unknown[]) => {
    h.calls.push([name, ...args]);
    return chain;
  };
  Object.assign(chain, {
    select: rec('select'),
    insert: rec('insert'),
    delete: rec('delete'),
    eq: rec('eq'),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(h.result).then(resolve),
  });
  return {
    supabase: {
      from: (table: string) => {
        h.calls.push(['from', table]);
        return chain;
      },
    },
  };
});

import { listSpendApprovers, addSpendApprover, removeSpendApprover } from './spendApprovers';

beforeEach(() => {
  h.calls.length = 0;
  h.result = { data: null, error: null };
});

describe('AC-APR-036 spend-approver DAL', () => {
  it('AC-APR-036: lists and maps rows, senior set first', async () => {
    h.result = {
      data: [
        { id: 'sa-2', project_id: 'p1', profile_id: 'u2', project: { name: 'HQ' }, profile: { full_name: 'Pat' } },
        { id: 'sa-1', project_id: null, profile_id: 'u1', project: null, profile: { full_name: 'Fiona' } },
      ],
      error: null,
    };
    expect(await listSpendApprovers()).toEqual([
      { id: 'sa-1', projectId: null, projectName: null, profileId: 'u1', fullName: 'Fiona' },
      { id: 'sa-2', projectId: 'p1', projectName: 'HQ', profileId: 'u2', fullName: 'Pat' },
    ]);
    expect(h.calls).toContainEqual(['from', 'spend_approvers']);
  });

  it('AC-APR-036: add sends profile_id and project_id, never org_id', async () => {
    h.result = { data: [{ id: 'sa-9' }], error: null };
    await addSpendApprover('u-exec', null);
    expect(h.calls).toContainEqual(['insert', { profile_id: 'u-exec', project_id: null }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
  });

  it('AC-APR-036: remove deletes by id', async () => {
    h.result = { data: [{ id: 'sa-1' }], error: null };
    await removeSpendApprover('sa-1');
    expect(h.calls).toContainEqual(['delete']);
    expect(h.calls).toContainEqual(['eq', 'id', 'sa-1']);
  });

  it('AC-APR-036: a write that lands nothing throws 42501', async () => {
    h.result = { data: [], error: null };
    await expect(addSpendApprover('u-exec', null)).rejects.toMatchObject({ code: '42501' });
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/spendApprovers.test.ts` → cannot resolve `./spendApprovers`.

### Task 32 — GREEN: DAL + repository methods

1. Create `pmo-portal/src/lib/db/spendApprovers.ts`:
   ```ts
   import { supabase } from '@/src/lib/supabase/client';
   import { AppError, assertWriteLanded } from '@/src/lib/appError';

   /** #803 — one row of `spend_approvers`: a project approver, or (projectId null) a senior-set member. */
   export interface SpendApproverRow {
     id: string;
     projectId: string | null;
     projectName: string | null;
     profileId: string;
     fullName: string;
   }

   interface RawRow {
     id: string;
     project_id: string | null;
     profile_id: string;
     project: { name: string } | null;
     profile: { full_name: string } | null;
   }

   // spend_approvers has TWO FKs to profiles (profile_id, created_by): the embed names its constraint.
   const SELECT =
     'id, project_id, profile_id, project:projects(name), profile:profiles!spend_approvers_profile_id_fkey(full_name)';

   /** Every active member reads (RLS). org_id is NEVER sent. Senior set first, then by project, then name. */
   export async function listSpendApprovers(): Promise<SpendApproverRow[]> {
     const { data, error } = await supabase.from('spend_approvers').select(SELECT);
     if (error) throw new AppError(error.message, error.code);
     return ((data ?? []) as unknown as RawRow[])
       .map((r) => ({
         id: r.id,
         projectId: r.project_id,
         projectName: r.project?.name ?? null,
         profileId: r.profile_id,
         fullName: r.profile?.full_name ?? '',
       }))
       .sort(
         (a, b) =>
           (a.projectName ?? '').localeCompare(b.projectName ?? '') || a.fullName.localeCompare(b.fullName),
       );
   }

   /** Admin-only (RLS). `projectId` null = the overhead/over-budget set. org_id is stamped server-side. */
   export async function addSpendApprover(profileId: string, projectId: string | null): Promise<void> {
     const { data, error } = await supabase
       .from('spend_approvers')
       .insert({ profile_id: profileId, project_id: projectId })
       .select('id');
     if (error) throw new AppError(error.message, error.code);
     assertWriteLanded(data, 'The approver was not added. Only an Admin can change spend approvers.');
   }

   /** Admin-only (RLS). A USING denial deletes nothing silently — assertWriteLanded makes it loud (#541). */
   export async function removeSpendApprover(id: string): Promise<void> {
     const { data, error } = await supabase.from('spend_approvers').delete().eq('id', id).select('id');
     if (error) throw new AppError(error.message, error.code);
     assertWriteLanded(data, 'The approver was not removed. Only an Admin can change spend approvers.');
   }
   ```
2. `pmo-portal/src/lib/repositories/types.ts`: add `import type { SpendApproverRow } from '@/src/lib/db/spendApprovers';`
   with the other type imports, and inside `OrgSettingsRepository` after `setTaxDefault(...)`:
   ```ts
     /** #803: the org's spend approvers (senior set + project approvers); every active member reads. */
     listSpendApprovers(): Promise<SpendApproverRow[]>;
     /** #803, Admin-only (RLS): name an approver — `projectId` null = the overhead/over-budget set. */
     addSpendApprover(profileId: string, projectId: string | null): Promise<void>;
     /** #803, Admin-only (RLS): remove one approver row. */
     removeSpendApprover(id: string): Promise<void>;
   ```
3. `pmo-portal/src/lib/repositories/index.ts`: add
   `import { listSpendApprovers, addSpendApprover, removeSpendApprover } from '@/src/lib/db/spendApprovers';`
   with the other DAL imports, and in `const orgSettings` after `setTaxDefault: …,`:
   ```ts
     listSpendApprovers: () => wrap(() => listSpendApprovers()),
     addSpendApprover: (profileId, projectId) => wrap(() => addSpendApprover(profileId, projectId)),
     removeSpendApprover: (id) => wrap(() => removeSpendApprover(id)),
   ```
4. `pmo-portal/src/lib/repositories/index.test.ts` line 195 — the exhaustive seam contract (ADR-0017) changes
   deliberately; replace the expected list with:
   ```ts
       expect(Object.keys(repositories.orgSettings).sort()).toEqual(['addSpendApprover', 'getProjectNumberPattern', 'getTaxDefault', 'listSpendApprovers', 'removeSpendApprover', 'setProjectNumberPattern', 'setTaxDefault'].sort());
   ```
   and change the test title to `'orgSettings exposes its expected methods (OD-TAX-1 0207; #803 spend approvers 0234)'`.

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/spendApprovers.test.ts src/lib/repositories/index.test.ts && ../scripts/with-test-lock.sh npm run typecheck` → green.

### Task 33 — RED: admin card (AC-APR-034)

Create `pmo-portal/pages/admin/SpendApprovers.test.tsx`:

```tsx
/**
 * AC-APR-034 — Administration › Spend approvers (#803). Admin-only writes, mirrored by
 * can('manage','orgAccounting'); UX only — the spend_approvers RLS is the authority (ADR-0016).
 * Idiom copied from OrgTaxDefault.test.tsx (react-query + repository seam mocked directly).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { listSpendApprovers, addSpendApprover, removeSpendApprover, listOrgProfiles } = vi.hoisted(() => ({
  listSpendApprovers: vi.fn(),
  addSpendApprover: vi.fn(),
  removeSpendApprover: vi.fn(),
  listOrgProfiles: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgSettings: { listSpendApprovers, addSpendApprover, removeSpendApprover },
    profile: { listOrgProfiles },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-admin', org_id: 'org-1' } }),
}));
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'p-1', label: 'HQ Fit-Out' }] }),
}));

import SpendApprovers from './SpendApprovers';

const renderPanel = (role: Role) => {
  realRole = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <SpendApprovers />
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listSpendApprovers.mockReset().mockResolvedValue([
    { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-fin', fullName: 'Fiona Finance' },
    { id: 'sa-2', projectId: 'p-1', projectName: 'HQ Fit-Out', profileId: 'u-pm', fullName: 'Pat PM' },
  ]);
  addSpendApprover.mockReset().mockResolvedValue(undefined);
  removeSpendApprover.mockReset().mockResolvedValue(undefined);
  listOrgProfiles.mockReset().mockResolvedValue([
    { id: 'u-exec', full_name: 'Eve Exec', role: 'Executive', status: 'active' },
    { id: 'u-eng', full_name: 'Eli Eng', role: 'Engineer', status: 'active' },
    { id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' },
  ]);
});

describe('AC-APR-034 Spend approvers admin card', () => {
  it('AC-APR-034: lists the senior set and the project approvers', async () => {
    renderPanel('Admin');
    expect(await screen.findByText('Fiona Finance')).toBeInTheDocument();
    expect(screen.getByText('Pat PM')).toBeInTheDocument();
    expect(screen.getByText('HQ Fit-Out')).toBeInTheDocument();
  });

  it('AC-APR-034: a non-Admin sees names but no add/remove controls', async () => {
    renderPanel('Finance');
    await screen.findByText('Fiona Finance');
    expect(screen.queryByRole('button', { name: /add overhead approver/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove/i })).not.toBeInTheDocument();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });

  it('AC-APR-034: an Admin removes an approver through a confirm', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Fiona Finance' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeSpendApprover).toHaveBeenCalledWith('sa-1'));
  });

  it('AC-APR-034: an Admin adds an overhead approver; only active approval-rank people are offered', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: /add overhead approver/i }));
    const person = await screen.findByLabelText('Person');
    await waitFor(() =>
      expect(within(person).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Select a person…',
        'Eve Exec',
      ]),
    );
    await userEvent.selectOptions(person, 'u-exec');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addSpendApprover).toHaveBeenCalledWith('u-exec', null));
  });
});
```

**Verify (RED):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/admin/SpendApprovers.test.tsx` → cannot resolve `./SpendApprovers`.

### Task 34 — GREEN: `SpendApprovers.tsx`

Create `pmo-portal/pages/admin/SpendApprovers.tsx`:

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Combobox,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
  FormSection,
  ListState,
  SelectField,
  useEntityForm,
  useToast,
  type ComboboxOption,
  type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import type { SpendApproverRow } from '@/src/lib/db/spendApprovers';

/**
 * Administration › Spend approvers (#803, migration 0234, ADR-0075). Spend charged to a project and
 * within its budget line goes to that project's approver; overhead and over-line spend goes to the
 * overhead set. Any one listed approver decides (DD-APR-1). Admin-only writes, gated on
 * can('manage','orgAccounting') — UX only; the spend_approvers RLS is the authority (ADR-0016).
 */
const SpendApprovers: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState<'org' | 'project' | null>(null);
  const [removing, setRemoving] = useState<SpendApproverRow | null>(null);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const listKey = ['spend-approvers', orgId] as const;
  const { data, isPending, isError, refetch } = useQuery<SpendApproverRow[]>({
    queryKey: listKey,
    queryFn: () => repositories.orgSettings.listSpendApprovers(),
    enabled: Boolean(orgId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: listKey });
  const addMutation = useMutation({
    mutationFn: (v: { profileId: string; projectId: string | null }) =>
      repositories.orgSettings.addSpendApprover(v.profileId, v.projectId),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => repositories.orgSettings.removeSpendApprover(id),
    onSuccess: invalidate,
  });

  const orgRows = useMemo(() => (data ?? []).filter((r) => r.projectId === null), [data]);
  const projectRows = useMemo(() => (data ?? []).filter((r) => r.projectId !== null), [data]);

  const onRemoveConfirm = async () => {
    if (!removing) return;
    try {
      await removeMutation.mutateAsync(removing.id);
      toast(t('admin.spendApprovers.toast.removed', 'Approver removed'), removing.fullName, 'success');
      setRemoving(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const renderRows = (rows: SpendApproverRow[]) =>
    rows.length === 0 ? (
      <p className="text-[13px] text-muted-foreground">
        {t('admin.spendApprovers.empty', 'Nobody listed — the standard role rules apply.')}
      </p>
    ) : (
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13.5px]">
            <span className="min-w-0">
              <span className="font-medium">{r.fullName}</span>
              {r.projectName && <span className="ml-2 text-muted-foreground">{r.projectName}</span>}
            </span>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                {t('admin.spendApprovers.remove', { defaultValue: 'Remove {{name}}', name: r.fullName })}
              </Button>
            )}
          </li>
        ))}
      </ul>
    );

  const openAdd = (mode: 'org' | 'project') => {
    setSaveError(null);
    setAdding(mode);
  };

  return (
    <section id="spend-approvers" aria-label={t('admin.spendApprovers.title', 'Spend approvers')}>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
        {t('admin.spendApprovers.title', 'Spend approvers')}
      </h2>
      <p className="mt-1 max-w-[68ch] text-[13px] text-muted-foreground">
        {t(
          'admin.spendApprovers.description',
          "Who approves purchase requests. Spend charged to a project and within its budget line goes to that project's approver; overhead, and spend that would exceed the budget line, goes to the overhead approvers. Any one listed approver can approve. With nobody listed, the standard role rules apply.",
        )}
      </p>
      {isError ? (
        <ListState
          variant="error"
          title={t('admin.spendApprovers.loadError.title', "Couldn't load spend approvers")}
          sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          retryLabel={t('admin.retry', 'Retry')}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <ListState variant="loading" rows={2} testId="spend-approvers-loading" />
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">
                {t('admin.spendApprovers.orgSet.title', 'Overhead and over-budget approvers')}
              </h3>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => openAdd('org')}>
                  {t('admin.spendApprovers.addOrg', 'Add overhead approver')}
                </Button>
              )}
            </div>
            {renderRows(orgRows)}
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">
                {t('admin.spendApprovers.projectSet.title', 'Project approvers')}
              </h3>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => openAdd('project')}>
                  {t('admin.spendApprovers.addProject', 'Add project approver')}
                </Button>
              )}
            </div>
            {renderRows(projectRows)}
          </div>
          {!canManage && (
            <p className="text-[13px] text-muted-foreground">
              {t('admin.spendApprovers.adminOnly', 'Only an Admin can change this.')}
            </p>
          )}
        </div>
      )}

      {adding && (
        <AddApproverModal
          mode={adding}
          submitError={saveError}
          onClose={() => setAdding(null)}
          onSubmit={async (profileId, projectId) => {
            try {
              await addMutation.mutateAsync({ profileId, projectId });
              toast(t('admin.spendApprovers.toast.added', 'Approver added'), '', 'success');
              setAdding(null);
            } catch (err) {
              const { headline, detail } = classifyMutationError(err);
              setSaveError({ headline, detail });
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!removing}
        tone="destructive"
        title={
          removing
            ? t('admin.spendApprovers.confirm.title', { defaultValue: 'Remove {{name}}?', name: removing.fullName })
            : ''
        }
        description={t(
          'admin.spendApprovers.confirm.description',
          'They will no longer approve these requests. Requests already decided are unchanged.',
        )}
        confirmLabel={t('admin.spendApprovers.confirm.confirm', 'Remove')}
        loading={removeMutation.isPending}
        onConfirm={onRemoveConfirm}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
};

interface AddValues {
  profileId: string;
  projectId: string | null;
}

interface AddApproverModalProps {
  mode: 'org' | 'project';
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (profileId: string, projectId: string | null) => Promise<void>;
}

const AddApproverModal: React.FC<AddApproverModalProps> = ({ mode, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const { data: people } = useQuery({
    queryKey: ['spend-approver-people', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId),
  });
  // UX mirror of the RLS rank floor (ADR-0070): the same predicate that offers the Approve button.
  const personOptions = useMemo(
    () =>
      (people ?? [])
        .filter((p) => p.status === 'active' && can('transition', 'procurement', { realRole: p.role as never }))
        .map((p) => ({ value: p.id, label: p.full_name })),
    [people],
  );
  const { data: projectOptions } = useProjectOptions();
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => projectOptions ?? [],
    [projectOptions],
  );

  const form = useEntityForm<AddValues>({
    initialValues: { profileId: '', projectId: null },
    validate: (v) => {
      const errors: Partial<Record<keyof AddValues, string>> = {};
      if (!v.profileId) errors.profileId = t('admin.spendApprovers.form.personRequired', 'Choose a person.');
      if (mode === 'project' && !v.projectId) {
        errors.projectId = t('admin.spendApprovers.form.projectRequired', 'Choose a project.');
      }
      return errors;
    },
    idPrefix: 'spend-approver-form',
    requiredFields: mode === 'project' ? ['profileId', 'projectId'] : ['profileId'],
    module: 'spend-approvers',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      await onSubmit(v.profileId, mode === 'project' ? v.projectId : null);
    });
  };

  return (
    <EntityFormModal
      open
      title={
        mode === 'project'
          ? t('admin.spendApprovers.form.projectTitle', 'Add a project approver')
          : t('admin.spendApprovers.form.orgTitle', 'Add an overhead approver')
      }
      subtitle={t('admin.spendApprovers.form.subtitle', 'Any one listed approver can approve a request.')}
      submitLabel={t('admin.spendApprovers.form.save', 'Add')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
    >
      <FormSection legend={t('admin.spendApprovers.form.legend', 'Approver')}>
        <FormGrid>
          {mode === 'project' && (
            <Combobox
              label={t('admin.spendApprovers.form.project', 'Project')}
              noun="project"
              placeholder={t('admin.spendApprovers.form.projectPlaceholder', 'Select a project…')}
              value={form.values.projectId}
              onChange={(v) => form.setValue('projectId', v)}
              loadOptions={loadProjects}
            />
          )}
          <SelectField
            id="spend-approver-person"
            label={t('admin.spendApprovers.form.person', 'Person')}
            value={form.values.profileId}
            onChange={(v) => form.setValue('profileId', v)}
            options={personOptions}
            placeholder={t('admin.spendApprovers.form.personPlaceholder', 'Select a person…')}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default SpendApprovers;
```

**Verify (GREEN):** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/admin/SpendApprovers.test.tsx && ../scripts/with-test-lock.sh npm run typecheck` → 4/4, zero type errors.

### Task 35 — Mount + i18n + launch scope

1. `pmo-portal/pages/Administration.tsx`: add `import SpendApprovers from './admin/SpendApprovers';` after the
   `OrgTaxDefault` import (line 16), and in the `'accounting'` case insert `<SpendApprovers />` on the line after
   `<OrgTaxDefault />`.
2. `pmo-portal/src/lib/i18n/launch-scope-routes.txt` line 136: append ` pages/admin/SpendApprovers.tsx` after
   `pages/admin/BudgetAccountMap.tsx`.
3. `pmo-portal/public/locales/en/common.json`, inside the top-level `"admin"` object, add:
   ```json
   "spendApprovers": {
     "title": "Spend approvers",
     "description": "Who approves purchase requests. Spend charged to a project and within its budget line goes to that project's approver; overhead, and spend that would exceed the budget line, goes to the overhead approvers. Any one listed approver can approve. With nobody listed, the standard role rules apply.",
     "orgSet": { "title": "Overhead and over-budget approvers" },
     "projectSet": { "title": "Project approvers" },
     "addOrg": "Add overhead approver",
     "addProject": "Add project approver",
     "remove": "Remove {{name}}",
     "empty": "Nobody listed — the standard role rules apply.",
     "adminOnly": "Only an Admin can change this.",
     "loadError": { "title": "Couldn't load spend approvers" },
     "toast": { "added": "Approver added", "removed": "Approver removed" },
     "confirm": {
       "title": "Remove {{name}}?",
       "description": "They will no longer approve these requests. Requests already decided are unchanged.",
       "confirm": "Remove"
     },
     "form": {
       "orgTitle": "Add an overhead approver",
       "projectTitle": "Add a project approver",
       "subtitle": "Any one listed approver can approve a request.",
       "legend": "Approver",
       "person": "Person",
       "personPlaceholder": "Select a person…",
       "personRequired": "Choose a person.",
       "project": "Project",
       "projectPlaceholder": "Select a project…",
       "projectRequired": "Choose a project.",
       "save": "Add"
     }
   }
   ```
4. `pmo-portal/public/locales/id/common.json`, inside `"admin"`, add:
   ```json
   "spendApprovers": {
     "title": "Penyetuju pengeluaran",
     "description": "Siapa yang menyetujui permintaan pembelian. Pengeluaran yang dibebankan ke proyek dan masih dalam pos anggarannya disetujui oleh penyetuju proyek tersebut; overhead, dan pengeluaran yang akan melampaui pos anggaran, disetujui oleh penyetuju overhead. Cukup satu penyetuju yang terdaftar untuk menyetujui. Jika belum ada yang terdaftar, aturan peran standar berlaku.",
     "orgSet": { "title": "Penyetuju overhead dan lebih anggaran" },
     "projectSet": { "title": "Penyetuju proyek" },
     "addOrg": "Tambah penyetuju overhead",
     "addProject": "Tambah penyetuju proyek",
     "remove": "Hapus {{name}}",
     "empty": "Belum ada — aturan peran standar berlaku.",
     "adminOnly": "Hanya Admin yang dapat mengubah ini.",
     "loadError": { "title": "Gagal memuat penyetuju pengeluaran" },
     "toast": { "added": "Penyetuju ditambahkan", "removed": "Penyetuju dihapus" },
     "confirm": {
       "title": "Hapus {{name}}?",
       "description": "Mereka tidak lagi menyetujui permintaan ini. Permintaan yang sudah diputuskan tidak berubah.",
       "confirm": "Hapus"
     },
     "form": {
       "orgTitle": "Tambah penyetuju overhead",
       "projectTitle": "Tambah penyetuju proyek",
       "subtitle": "Cukup satu penyetuju yang terdaftar untuk menyetujui permintaan.",
       "legend": "Penyetuju",
       "person": "Orang",
       "personPlaceholder": "Pilih orang…",
       "personRequired": "Pilih orang.",
       "project": "Proyek",
       "projectPlaceholder": "Pilih proyek…",
       "projectRequired": "Pilih proyek.",
       "save": "Tambah"
     }
   }
   ```

**Verify:** `cd "$WT/pmo-portal" && npm run check:i18n && ../scripts/with-test-lock.sh npx vitest run pages/admin/SpendApprovers.test.tsx pages/__tests__/Administration*.test.tsx pages/Administration*.test.tsx`
→ green. If an existing Administration test fails **only** because its `@/src/lib/repositories` mock lacks the
three new `orgSettings` methods, add `listSpendApprovers: vi.fn().mockResolvedValue([]), addSpendApprover: vi.fn(),
removeSpendApprover: vi.fn()` to that mock's `orgSettings` object (a mock completion, not an assertion change).

---

## Phase E — Acceptance + gates

### Task 36 — E2E journey (AC-APR-040)

Create `pmo-portal/e2e/AC-APR-040-routed-procurement-approval.spec.ts`:

```ts
// @e2e-isolation: self-isolated — creates its own uniquely-named project, Active budget, purchase request and project-level approver row each run, and deletes them afterwards; touches no shared seed row.
/**
 * AC-APR-040 — approval routing by budget (#803): the one cross-stack journey. The route the server
 * enforces (pgTAP AC-APR-001/002) is what the person in front of the request sees.
 * Goal oracle: a PM who is NOT the project's named approver is told who decides and offered no
 * Approve; the named approver approves and the request becomes Approved.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4'; // the requester
const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3'; // the named project approver
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(90_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let procurementId = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-APR-040 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const tag = `APR-040 ${Date.now()}`;

  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-APR-040 fixture project: ${project.error.message}`);
  projectId = project.data.id;

  const version = await admin
    .from('budget_versions')
    .insert({ org_id: ORG_ID, project_id: projectId, name: tag, version: 1, status: 'Active' })
    .select('id')
    .single();
  if (version.error) throw new Error(`AC-APR-040 fixture budget version: ${version.error.message}`);

  const line = await admin
    .from('budget_line_items')
    .insert({ org_id: ORG_ID, budget_version_id: version.data.id, category: 'Materials', budgeted_amount: 1_000_000 });
  if (line.error) throw new Error(`AC-APR-040 fixture budget line: ${line.error.message}`);

  const approver = await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: FINANCE_ID });
  if (approver.error) throw new Error(`AC-APR-040 fixture approver: ${approver.error.message}`);

  const pr = await admin
    .from('procurements')
    .insert({
      org_id: ORG_ID,
      title: `${tag} cable`,
      project_id: projectId,
      requested_by_id: ENGINEER_ID,
      status: 'Requested',
      total_value: 400_000,
      budget_category: 'Materials',
    })
    .select('id')
    .single();
  if (pr.error) throw new Error(`AC-APR-040 fixture procurement: ${pr.error.message}`);
  procurementId = pr.data.id;
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => {
    if (e) throw new Error(`AC-APR-040 cleanup ${step}: ${e.message}`);
  };
  if (procurementId) {
    fail('events', (await admin.from('procurement_status_events').delete().eq('procurement_id', procurementId)).error);
    fail('procurement', (await admin.from('procurements').delete().eq('id', procurementId)).error);
  }
  if (projectId) {
    fail('approvers', (await admin.from('spend_approvers').delete().eq('project_id', projectId)).error);
    const versions = await admin.from('budget_versions').select('id').eq('project_id', projectId);
    for (const v of versions.data ?? []) {
      fail('lines', (await admin.from('budget_line_items').delete().eq('budget_version_id', v.id)).error);
    }
    fail('versions', (await admin.from('budget_versions').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  }
  procurementId = '';
  projectId = '';
});

test('AC-APR-040 a within-budget request is decided by the project approver, and only by them', async ({ page }) => {
  // A PM who is not the named approver: told who decides, offered no Approve.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/procurement/${procurementId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', { timeout: 10_000 });
  await expect(page.getByTestId('approval-route-note')).toContainText('Priya Ramanathan');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // The named approver decides it.
  await signIn(page, 'finance@acme.test');
  await page.goto(`/procurement/${procurementId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });
});
```

**Verify:** `cd "$WT" && scripts/e2e-local.sh AC-APR-040` → 1 passed. Then
`cd "$WT/pmo-portal" && bash ../scripts/check-e2e-isolation.sh` → clean.

### Task 37 — Local final gate (before the PR)

```bash
cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npm run typecheck
cd "$WT/pmo-portal" && npx eslint --max-warnings=0 src/lib/procurement/approvalRoute.ts src/lib/procurement/approvalRoute.test.ts src/lib/db/approvalRoutes.ts src/lib/db/approvalRoutes.test.ts src/lib/db/procurements.ts src/lib/db/procurementLifecycle.ts src/lib/selectors/approvals.ts src/lib/selectors/approvals.test.ts pages/ProcurementDetails.tsx pages/procurement/ProcurementDecisionZone.tsx pages/__tests__/ProcurementDetails.approvalRoute.test.tsx src/lib/db/procurementCrud.ts src/lib/db/procurementCrud.budgetCategory.test.ts pages/procurement/budgetCategoryOptions.ts pages/procurement/NewProcurementModal.tsx pages/procurement/ProcurementHeaderEdit.tsx pages/procurement/__tests__/budgetCategoryForms.test.tsx src/lib/db/spendApprovers.ts src/lib/db/spendApprovers.test.ts src/lib/repositories/types.ts src/lib/repositories/index.ts src/lib/repositories/index.test.ts pages/admin/SpendApprovers.tsx pages/admin/SpendApprovers.test.tsx pages/Administration.tsx e2e/AC-APR-040-routed-procurement-approval.spec.ts
cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev --coverage
cd "$WT/pmo-portal" && npm run check:i18n && npm run check:guards
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/spend_approvers_config.test.sql supabase/tests/spend_approval_classify.test.sql supabase/tests/spend_approval_enforce.test.sql supabase/tests/spend_approval_inputs_frozen.test.sql supabase/tests/spend_approval_line_lock.test.sql supabase/tests/0015_procurement_sod.test.sql supabase/tests/0045_procurement_rls_hardening.test.sql supabase/tests/0173_rpc_active_member_gate.test.sql supabase/tests/0178_anon_executable_definers.test.sql'
cd "$WT" && scripts/e2e-local.sh AC-816 && scripts/e2e-local.sh AC-APR-040
```

**Verify:** every command exits clean; coverage ≥ 80 % on changed lines from the actual report; AC-816 (the
procure-to-pay journey) still green proves the unconfigured seed org behaves as before. UI render pass (light/dark,
1440/375) over `/procurement/<routed id>` and `/administration/accounting`, plus
`.claude/skills/impeccable/scripts/impeccable detect pages/admin/SpendApprovers.tsx pages/procurement/ProcurementDecisionZone.tsx`.

---

## 3. Task → AC map

| Task | AC | Layer |
|---|---|---|
| 1–2 | AC-APR-016, 017, 020 | pgTAP |
| 3–4 | AC-APR-006, 007, 011, 012, 019 | pgTAP |
| 5, 7 | AC-APR-001, 002, 003, 004, 005, 008, 009, 010, 013, 014, 015 | pgTAP |
| 6, 7 | AC-APR-021 | pgTAP |
| 8–9 | AC-APR-018 | pgTAP |
| 10–11 | (types regen; catalog-guard regression) | — |
| 12–15 | mutation battery over AC-APR-002/003/004/006/007/009/010/013/016/018/021 | pgTAP |
| 16–17 | AC-APR-030 | Unit |
| 18–20 | AC-APR-035 | Unit |
| 21–22 | AC-APR-032 | Unit |
| 23–26 | AC-APR-031 | Unit (RTL) |
| 27–28 | AC-APR-033 | Unit |
| 29–30 | AC-APR-037 | Unit (RTL) |
| 31–32 | AC-APR-036 | Unit |
| 33–35 | AC-APR-034 | Unit (RTL) |
| 36 | AC-APR-040 | E2E |
| 37 | all (gate) | — |

## 4. Risks to watch during the build

- **§7 drift from 0180.** The only allowed differences are `-- 0234` lines. Any pre-existing procurement pgTAP file
  going red in Task 7 means the body drifted — fix the body.
- **`role_rank` EXECUTE.** §2 grants it to `authenticated` because the UI path runs as the caller. If Task 4's
  classify test fails with `permission denied for function role_rank`, the grant line is missing.
- **e2e fixture deletes.** If a project/version delete in `afterEach` is refused by a trigger, the cleanup throws by
  name; fix the order, do not swallow the error.
- **Mutation 12b** leaves `if … then null; end if;` — make sure the `if` block still compiles before running.
