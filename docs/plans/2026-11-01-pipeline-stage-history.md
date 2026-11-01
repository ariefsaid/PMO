# Pipeline stage history — design + implementation plan

- **Issue:** #1638 · **Spec:** `docs/specs/pipeline-stage-history.spec.md` (FR/NFR/AC-PSH-###)
- **Ruling:** `docs/decisions.md` OD-GRILL-20261101 — "Pipeline dates (CRM-grade history)", "Reel differences (#1593)"
- **Migration number:** `<NNNN>` everywhere below — the coordinator assigns it at dispatch (`scripts/renumber-migration.sh`
  if it collides). Files: `supabase/migrations/<NNNN>_pipeline_stage_history.sql`,
  `supabase/migrations/rollback/<NNNN>_pipeline_stage_history_down.sql`.
- **Executor routing (`docs/factory-workflow.md` § Executor routing):** the DB half adds a wrapper over the
  win-SoD RPC `transition_project` and a new authority gate → **Director-dispatched per issue (money/SoD/auth
  tier)**, opus implementer for Tasks 1–22; the FE half (Tasks 23–39) is a bounded FE slice → Orca worker,
  sonnet `ui-implementer`, after the DB half merges to `dev` (it needs the regenerated types).
- **Review:** spec-reviewer + code-quality-reviewer + security-auditor (RLS, definer RPCs, the editor gate);
  design-reviewer Discover pass on `/sales` and the deal page (rich seed).

## 1. Design

### 1.1 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | New table `project_stage_entries` (one row per stage entry), not a view over `record_changes`. | `record_changes` holds recording time only and is append-only; the ruling needs a correctable business date (spec T6/T7). |
| D2 | Entries are appended by an **AFTER INSERT OR UPDATE OF status trigger on `projects`**, not by editing `transition_project`. | NFR-PSH-002: the 0236 body (win SoD) stays byte-identical. Every path that changes status — the RPC, drag-and-drop (#1593), seed, the historical importer — records an entry with no extra code. |
| D3 | Journey order is an explicit `position numeric` (append = max+1; add-skipped = midpoint between neighbours). Dates are validated *along* the journey, never used to order it. | A re-quote returns to an earlier stage; adding a skipped stage must land between two entries without renumbering. |
| D4 | The ordering rule ("never dated before the previous one") is a **constraint trigger** on the table (`23514`), `deferrable initially immediate`. | One enforcement point for the trigger, all RPCs and the backfill; the backfill defers it for its clamp step. |
| D5 | A dated move is a wrapper `advance_project_stage(...)` that `perform`s `transition_project(...)` unchanged, then re-dates the entry the trigger just appended — one transaction. | Atomic, no change to the SoD body, and `auth.uid()` / `auth_role()` read JWT claims so they are identical inside the nested definer call. |
| D6 | Stage-date editor = `role_rank(auth_role()) >= 20` + active member + same org, in one helper `assert_stage_date_editor(org)`. FE projects it with the existing `can('transition','project')` (same set today, `policy.ts:223`). | Spec OQ-PSH-2. Rank is the one server definition (`0178…sql:638`). |
| D7 | Key-date sync lives in one internal function `stage_entry_set_date(entry, date)`: Signed → `contract_date` + `decided_at`; current Lost/Declined → `decided_at`. | FR-PSH-009; Signed and contract date can never diverge. |
| D8 | `get_sales_pipeline()` / `get_win_rate()` read `stage_started_at` from the latest entry's `entered_on` (fallback `created_at`); bodies otherwise 0385 verbatim. Open cards get stage + date from that field (latest entry's stage = current status, invariant). Won/lost cards use `contract_date` / `decided_at` already on the project row. | NFR-PSH-004 — no per-card request; one definition of stage age (FR-PSH-015). |
| D9 | Audit = register the table in `record_history_config` (parent `project`) + `log_audit` in each correction RPC. | FR-PSH-012 using the shipped patterns (`0281…sql:216-224`, `0076…sql:80`). |

Invariant (asserted by pgTAP in Task 20): for every project, the entry with the greatest `position` has
`stage = projects.status`. It holds because every status change appends and add-skipped only inserts *before*
an existing entry.

### 1.2 Data model

```
project_stage_entries
  id uuid pk · org_id uuid (from project) · project_id uuid → projects(id) on delete cascade
  stage project_status · entered_on date · position numeric · unique(project_id, position)
  source text ∈ {origination, transition, added, import, backfill}
  recorded_by uuid → profiles(id) null · recorded_at timestamptz default now()
  redated_at timestamptz null   -- set when entered_on is changed after the fact (drives "Date changed")
index (project_id, position desc)
RLS: FORCE; one SELECT policy (own org ∧ project visible); no client INSERT/UPDATE/DELETE grant
```

### 1.3 Server API (all `security definer`, `set search_path = public`)

| Function | Caller | Gate | Writes |
|---|---|---|---|
| `project_stage_entry_append()` | trigger on `projects` | — | appends one entry |
| `advance_project_stage(p_id, p_to, p_entered_on, p_customer_contract_ref, p_contract_date)` | authenticated | `transition_project`'s gates + `assert_stage_date_editor` when dated | status (via RPC) + entry date |
| `redate_stage_entry(p_entry_id, p_entered_on)` | authenticated | `assert_stage_date_editor` | entry date (+ key-date sync) + audit |
| `add_skipped_stage_entry(p_before_entry_id, p_stage, p_entered_on)` | authenticated | `assert_stage_date_editor` | new entry + audit |
| `import_project_stage_history(p_project_id, p_entries jsonb)` | authenticated (import) | `assert_stage_date_editor` | entries + status + audit |
| `backfill_project_stage_entries(p_project_id)` | migration / tests only | revoked from clients | entries |
| `stage_org_date(org, ts)` · `assert_stage_date_editor(org)` · `stage_entry_set_date(entry, date)` | internal | revoked from clients | — |

### 1.4 FE

- `pmo-portal/components/salesPipeline.ts` — `STAGE_KEY_DATE_LABEL`, `daysBetweenDates`, `stageLine`.
- `pmo-portal/components/SalesKanbanBoard.tsx` — `DealStageLine` in both cards; `SignedPill` for on-hand.
- `pmo-portal/src/hooks/useDashboard.ts` — `toPipelineProject` carries `contract_date`, `decided_at`.
- `pmo-portal/src/lib/db/projectStageEntries.ts` (DAL) + `pmo-portal/src/lib/repositories/projectStages.ts`
  (registered as `repositories.projectStage`) + `pmo-portal/src/hooks/useProjectStageEntries.ts`.
- `pmo-portal/pages/project-detail/StageHistory.tsx` (list + edit affordances) and
  `pmo-portal/pages/project-detail/StageDateDialog.tsx` (date picker bounded by neighbours/today; also used for
  dated advance). Mounted in `PipelineLens.tsx` and, for on-hand projects, `ProjectDetail.tsx`.
- `pmo-portal/src/lib/import/projectDescriptor.ts` — five optional stage-date columns + post-create history call.

### 1.5 Scaling / risk notes

- Entry volume ≈ stage moves (single digits per deal); the `(project_id, position desc)` index serves both the
  lateral "latest entry" read and the history list. No hot path scans the table.
- Re-dating Signed moves `contract_date` (spec OQ-PSH-3); ERP documents already dispatched keep the old date.
- A win whose contract date is earlier than the previous entry is now refused (`23514`) — the Won panel sets the
  date input's `min` to the latest entry date so the user sees it before submitting (Task 36).
- Drag-and-drop (#1593) records entries dated today via the trigger; correcting afterwards is the history's job.

## 2. Gates (every builder, before the PR — `CLAUDE.md` local final gate)

```bash
cd pmo-portal && npm run check:guards && npm run typecheck
npx eslint --max-warnings=0 <touched files>
npx vitest run <directly touched test files>
cd .. && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db \
  supabase/tests/pipeline_stage_history_write.test.sql \
  supabase/tests/pipeline_stage_history_read.test.sql \
  supabase/tests/pipeline_stage_history_backfill.test.sql \
  supabase/tests/0027_project_transition_authz.test.sql \
  supabase/tests/0028_project_transition_legality.test.sql \
  supabase/tests/0057_sales_pipeline_attention.test.sql \
  supabase/tests/0261_pipeline_hides_archived.test.sql'
cd pmo-portal && ../scripts/e2e-local.sh AC-PSH-016 && ../scripts/ux-proof.sh /sales
```

Mutation checks (security-critical, must go red): Task 11 and Task 20 name them.

## 3. Tasks

Fixture convention for all pgTAP files: ids prefixed `16380000-0000-0000-0000-…`; org A `…000000000001`,
org B `…000000000002`; PM A `…0000000000a2`, Executive A `…0000000000a3`, Engineer A `…0000000000a4`,
disabled PM A `…0000000000a5`, PM B `…0000000000b2`; JWT switched with
`set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'` after `set local role authenticated`
(pattern: `supabase/tests/0027_project_transition_authz.test.sql:34-36`).

### Task 1 — failing pgTAP: append on create and on every move (AC-PSH-001)
Create `supabase/tests/pipeline_stage_history_write.test.sql`:
```sql
-- pipeline_stage_history_write.test.sql — #1638 stage entries: append, key dates, dated move, re-date,
-- add-skipped, authority, audit. Spec docs/specs/pipeline-stage-history.spec.md.
begin;
select plan(2);

insert into organizations (id, name) values
  ('16380000-0000-0000-0000-000000000001','PSH Org A'),
  ('16380000-0000-0000-0000-000000000002','PSH Org B');
insert into auth.users (id, email) values
  ('16380000-0000-0000-0000-0000000000a2','psh-pm-a@example.test'),
  ('16380000-0000-0000-0000-0000000000a3','psh-ex-a@example.test'),
  ('16380000-0000-0000-0000-0000000000a4','psh-en-a@example.test'),
  ('16380000-0000-0000-0000-0000000000a5','psh-dis-a@example.test'),
  ('16380000-0000-0000-0000-0000000000b2','psh-pm-b@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000a2','16380000-0000-0000-0000-000000000001','PSH PM A','psh-pm-a@example.test','Project Manager','active'),
  ('16380000-0000-0000-0000-0000000000a3','16380000-0000-0000-0000-000000000001','PSH Ex A','psh-ex-a@example.test','Executive','active'),
  ('16380000-0000-0000-0000-0000000000a4','16380000-0000-0000-0000-000000000001','PSH En A','psh-en-a@example.test','Engineer','active'),
  ('16380000-0000-0000-0000-0000000000a5','16380000-0000-0000-0000-000000000001','PSH Dis A','psh-dis-a@example.test','Project Manager','disabled'),
  ('16380000-0000-0000-0000-0000000000b2','16380000-0000-0000-0000-000000000002','PSH PM B','psh-pm-b@example.test','Project Manager','active');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000010','16380000-0000-0000-0000-000000000001','PSH-1','PSH journey','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000020','16380000-0000-0000-0000-000000000002','PSH-B','PSH org B','Leads','16380000-0000-0000-0000-0000000000b2');
-- Created 60 days ago so Task 5 has room to backdate after its origination entry.
insert into projects (id, org_id, code, name, status, project_manager_id, created_at) values
  ('16380000-0000-0000-0000-000000000011','16380000-0000-0000-0000-000000000001','PSH-2','PSH dated','Leads',
   '16380000-0000-0000-0000-0000000000a2', now() - interval '60 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000010','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000010','Quotation Submitted');
select transition_project('16380000-0000-0000-0000-000000000010','Tender Submitted');
select transition_project('16380000-0000-0000-0000-000000000010','Quotation Submitted');

select results_eq(
  $$ select stage::text, source from project_stage_entries
     where project_id = '16380000-0000-0000-0000-000000000010' order by position $$,
  $$ values ('Leads','origination'),('PQ Submitted','transition'),('Quotation Submitted','transition'),
            ('Tender Submitted','transition'),('Quotation Submitted','transition') $$,
  'AC-PSH-001: every stage entry is kept in journey order, including the re-quote');
select is(
  (select count(*)::int from project_stage_entries
    where project_id = '16380000-0000-0000-0000-000000000010' and recorded_by = '16380000-0000-0000-0000-0000000000a2'),
  4, 'AC-PSH-001: each move records who made it');
```
Tasks 4, 5, 6, 8, 10 and 12 append more assertions; each raises `plan(N)` by the number it adds, and Task 12
adds the closing `select * from finish(); rollback;` (until then end the file with those two lines yourself).
Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/pipeline_stage_history_write.test.sql`
→ fails with `relation "project_stage_entries" does not exist`.

### Task 2 — migration §1: table, RLS, grants, date helper
Create `supabase/migrations/<NNNN>_pipeline_stage_history.sql`:
```sql
-- <NNNN>_pipeline_stage_history.sql — #1638 CRM-grade pipeline stage history.
-- Spec: docs/specs/pipeline-stage-history.spec.md · Plan: docs/plans/2026-11-01-pipeline-stage-history.md
-- §1 table + RLS + grants · §2 ordering constraint + append trigger · §3 correction RPCs · §4 import RPC
-- §5 audit registration · §6 stage age reads (0385 bodies, lateral swapped) · §7 backfill · §8 self-assertion
-- transition_project (0236) is NOT modified (NFR-PSH-002).
-- Reversibility: rollback/<NNNN>_pipeline_stage_history_down.sql.

-- §1 ─────────────────────────────────────────────────────────────────────────────────────────────
create table public.project_stage_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  stage       project_status not null,
  entered_on  date not null,
  position    numeric not null,
  source      text not null check (source in ('origination','transition','added','import','backfill')),
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  redated_at  timestamptz,
  unique (project_id, position)
);
create index project_stage_entries_project_idx on public.project_stage_entries (project_id, position desc);
comment on table public.project_stage_entries is
  '#1638: one row per stage a deal entered; entered_on is the stage key date. Written only by the projects '
  'trigger and the stage RPCs; ordering rule enforced by project_stage_entries_order.';

alter table public.project_stage_entries enable row level security;
alter table public.project_stage_entries force row level security;
create policy project_stage_entries_select on public.project_stage_entries
  for select to authenticated
  using (org_id = public.auth_org_id()
         and exists (select 1 from public.projects p where p.id = project_stage_entries.project_id));
revoke all on table public.project_stage_entries from public, anon, authenticated;
grant select on table public.project_stage_entries to authenticated;

-- A timestamp's calendar day in the org's timezone (mirrors native_org_today, 0275:113).
create or replace function public.stage_org_date(p_org uuid, p_at timestamptz) returns date
  language sql stable set search_path = public as $$
  select (p_at at time zone coalesce(
            (select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date
$$;
revoke all on function public.stage_org_date(uuid, timestamptz) from public, anon, authenticated;
```
Verify: `scripts/with-db-lock.sh supabase db reset` exits 0 (Task 1 still red: no entries yet).

### Task 3 — migration §2: ordering constraint + append trigger (AC-PSH-001 green)
Append to the migration:
```sql
-- §2 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.project_stage_entries_assert_order() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from (
      select entered_on, lag(entered_on) over (order by position) as prev_on
      from public.project_stage_entries where project_id = new.project_id
    ) s
    where s.prev_on is not null and s.entered_on < s.prev_on        -- mut:order
  ) then
    raise exception 'a stage date cannot be earlier than the stage before it in the journey'
      using errcode = '23514';
  end if;
  return null;
end; $$;
revoke all on function public.project_stage_entries_assert_order() from public, anon, authenticated;
create constraint trigger project_stage_entries_order
  after insert or update of entered_on, position on public.project_stage_entries
  deferrable initially immediate
  for each row execute function public.project_stage_entries_assert_order();

create or replace function public.project_stage_entry_append() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_on  date;
  v_pos numeric;
begin
  -- import_project_stage_history (§4) writes its own entries, then moves the status: no duplicate.
  if current_setting('pmo.stage_entry_suppress', true) = new.id::text then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    -- Key dates changed without a move (seed.sql sets contract_date/decided_at AFTER inserting a won/lost
    -- row; seed.sql:310-314). Keep Signed = contract_date and the current Lost/Declined entry = decided_at.
    if new.contract_date is distinct from old.contract_date and new.contract_date is not null then
      update public.project_stage_entries set entered_on = new.contract_date
       where project_id = new.id and stage = 'Won, Pending KoM' and entered_on is distinct from new.contract_date;
    end if;
    if new.decided_at is distinct from old.decided_at and new.decided_at is not null
       and new.status in ('Loss Tender','Declined') then
      update public.project_stage_entries e set entered_on = public.stage_org_date(new.org_id, new.decided_at)
       where e.project_id = new.id and e.stage = new.status
         and e.position = (select max(position) from public.project_stage_entries where project_id = new.id)
         and e.entered_on is distinct from public.stage_org_date(new.org_id, new.decided_at);
    end if;
    return null;
  end if;
  v_on := case
    when new.status = 'Won, Pending KoM' and new.contract_date is not null then new.contract_date
    when new.status in ('Loss Tender','Declined') and new.decided_at is not null
      then public.stage_org_date(new.org_id, new.decided_at)
    when tg_op = 'INSERT' then public.stage_org_date(new.org_id, coalesce(new.created_at, now()))
    else public.stage_org_date(new.org_id, now())
  end;
  select coalesce(max(position), 0) + 1 into v_pos
    from public.project_stage_entries where project_id = new.id;
  insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
  values (new.org_id, new.id, new.status, v_on, v_pos,
          case when tg_op = 'INSERT' then 'origination' else 'transition' end, auth.uid());
  return null;
end; $$;
revoke all on function public.project_stage_entry_append() from public, anon, authenticated;
-- Created BEFORE the §7 backfill: CREATE TRIGGER locks projects against writes until commit, so no
-- project can appear between the backfill snapshot and the trigger.
create trigger projects_zy_stage_entry
  after insert or update of status, contract_date, decided_at on public.projects
  for each row execute function public.project_stage_entry_append();
```
Verify GREEN (2 of 2): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`.

### Task 4 — failing pgTAP: key dates for Signed and Lost (AC-PSH-002)
Append to the write test, as postgres (`reset role;`) to seed the win witness, then as the Executive:
```sql
reset role;
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000012','16380000-0000-0000-0000-000000000001','PSH-3','PSH win','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000013','16380000-0000-0000-0000-000000000001','PSH-4','PSH lose','Leads','16380000-0000-0000-0000-0000000000a2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000012','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000012','Quotation Submitted');
-- contract_value is 0 → the win SoD has nothing to ratify (0236 clause (i)).
select transition_project('16380000-0000-0000-0000-000000000012','Won, Pending KoM','PO-PSH-1', current_date);
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
    order by position desc limit 1), current_date,
  'AC-PSH-002: the Signed entry is dated with the contract date');
select transition_project('16380000-0000-0000-0000-000000000013','Loss Tender');
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000013'
    order by position desc limit 1),
  (select stage_org_date(org_id, decided_at) from projects where id = '16380000-0000-0000-0000-000000000013'),
  'AC-PSH-002: the Lost entry is dated with decided_at in the org timezone');
reset role;
update projects set contract_date = current_date - 1 where id = '16380000-0000-0000-0000-000000000012';
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
     and stage = 'Won, Pending KoM'), current_date - 1,
  'AC-PSH-002: the Signed entry follows contract_date on any path (seed / server-side update)');
update projects set contract_date = current_date where id = '16380000-0000-0000-0000-000000000012';
set local role authenticated;
```
Verify: all three pass (Task 3 implements them) — this task pins the behaviour; if one is red, fix
`project_stage_entry_append`, not the test.

### Task 5 — failing pgTAP: dated move (AC-PSH-003)
Append (PM A, project `…011`):
```sql
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select advance_project_stage('16380000-0000-0000-0000-000000000011','PQ Submitted', current_date - 20);
select advance_project_stage('16380000-0000-0000-0000-000000000011','Quotation Submitted', current_date - 10);
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000011'
    order by position desc limit 1), current_date - 10,
  'AC-PSH-003: a dated move dates the new entry with the chosen date');
select throws_ok(
  $$ select advance_project_stage('16380000-0000-0000-0000-000000000011','Tender Submitted', current_date - 11) $$,
  '23514', null, 'AC-PSH-003: a move dated before the previous entry is refused');
select is((select status::text from projects where id = '16380000-0000-0000-0000-000000000011'),
  'Quotation Submitted', 'AC-PSH-003: the refused move left the status unchanged');
select throws_ok(
  $$ select advance_project_stage('16380000-0000-0000-0000-000000000011','Tender Submitted', current_date + 2) $$,
  '23514', null, 'AC-PSH-003: a future stage date is refused');
```
Verify RED: `function advance_project_stage(...) does not exist`.

### Task 6 — failing pgTAP: re-date + Signed sync (AC-PSH-004)
Append (Executive A, project `…012` from Task 4 — journey Leads, PQ, Quotation, Signed(today); seed the earlier
dates as postgres first so there is room to move):
```sql
reset role;
update project_stage_entries set entered_on = current_date - 30
 where project_id = '16380000-0000-0000-0000-000000000012' and stage <> 'Won, Pending KoM';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select redate_stage_entry(
  (select id from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
     and stage = 'Won, Pending KoM'), current_date - 5);
select results_eq(
  $$ select e.entered_on, p.contract_date, p.decided_at::date
       from project_stage_entries e join projects p on p.id = e.project_id
      where e.project_id = '16380000-0000-0000-0000-000000000012' and e.stage = 'Won, Pending KoM' $$,
  $$ values (current_date - 5, current_date - 5, current_date - 5) $$,
  'AC-PSH-004: re-dating Signed moves the entry, contract_date and decided_at together');
select isnt((select redated_at from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
   and stage = 'Won, Pending KoM'), null, 'AC-PSH-004: a re-dated entry is marked');
select throws_ok(
  $$ select redate_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000012' and stage = 'Won, Pending KoM'), current_date - 31) $$,
  '23514', null, 'AC-PSH-004: re-dating before the previous entry is refused');
select is((select contract_date from projects where id = '16380000-0000-0000-0000-000000000012'),
  current_date - 5, 'AC-PSH-004: the refused re-date changed nothing');
```
Verify RED: `function redate_stage_entry(uuid, date) does not exist`.

### Task 7 — migration §3a: editor gate, set-date core, `redate_stage_entry`, `advance_project_stage`
Append to the migration:
```sql
-- §3 ─────────────────────────────────────────────────────────────────────────────────────────────
-- Spec OQ-PSH-2: "Project admin and above, including PMs" = role rank >= Project Manager (20).
create or replace function public.assert_stage_date_editor(p_org uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if p_org is distinct from public.auth_org_id()                                   -- mut:editor_org
     or not public.is_active_member()                                              -- mut:editor_active
     or not coalesce(public.role_rank(public.auth_role()) >= 20, false) then       -- mut:editor_rank
    raise exception 'not authorized' using errcode = '42501';
  end if;
end; $$;
revoke all on function public.assert_stage_date_editor(uuid) from public, anon, authenticated;

-- The one place an entry's date changes; syncs the project's key dates (FR-PSH-009). No gate: callers gate.
create or replace function public.stage_entry_set_date(p_entry_id uuid, p_entered_on date)
  returns public.project_stage_entries
  language plpgsql security definer set search_path = public as $$
declare
  e       public.project_stage_entries;
  v_last  boolean;
  v_status project_status;
begin
  select * into e from public.project_stage_entries where id = p_entry_id for update;
  if e.id is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  if p_entered_on is null or p_entered_on > public.native_org_today(e.org_id) then      -- mut:future
    raise exception 'a stage date cannot be in the future' using errcode = '23514';
  end if;
  update public.project_stage_entries
     set entered_on = p_entered_on, redated_at = now()
   where id = e.id;                                   -- project_stage_entries_order checks the neighbours
  select status into v_status from public.projects where id = e.project_id for update;
  v_last := not exists (select 1 from public.project_stage_entries x
                         where x.project_id = e.project_id and x.position > e.position);
  if e.stage = 'Won, Pending KoM' then
    update public.projects
       set contract_date = p_entered_on, decided_at = p_entered_on::timestamptz, last_update = now()
     where id = e.project_id;
  elsif e.stage in ('Loss Tender','Declined') and v_last and v_status = e.stage then
    -- Local midnight, so stage_org_date(decided_at) gives back exactly p_entered_on in every timezone.
    update public.projects
       set decided_at = p_entered_on::timestamp at time zone coalesce(
             (select o.default_timezone from public.organizations o where o.id = e.org_id), 'UTC'),
           last_update = now()
     where id = e.project_id;
  end if;
  return e;   -- the row as it was BEFORE the change (callers audit old -> new)
end; $$;
revoke all on function public.stage_entry_set_date(uuid, date) from public, anon, authenticated;

create or replace function public.redate_stage_entry(p_entry_id uuid, p_entered_on date) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  old   public.project_stage_entries;
begin
  select org_id into v_org from public.project_stage_entries where id = p_entry_id;
  if v_org is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  perform public.assert_stage_date_editor(v_org);
  old := public.stage_entry_set_date(p_entry_id, p_entered_on);
  perform public.log_audit('project.stage_entry.redate', v_org, auth.uid(), old.project_id,
    jsonb_build_object('entry_id', old.id, 'stage', old.stage::text,
                       'from', old.entered_on, 'to', p_entered_on));
end; $$;

create or replace function public.advance_project_stage(
  p_id uuid, p_to project_status, p_entered_on date default null,
  p_customer_contract_ref text default null, p_contract_date date default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_entry uuid;
  old     public.project_stage_entries;
begin
  -- Every gate of the move (org, active member, role, legal map, win SoD) stays in transition_project.
  perform public.transition_project(p_id, p_to, p_customer_contract_ref, p_contract_date);
  if p_entered_on is null or p_to = 'Won, Pending KoM' then
    return;                                        -- Signed is dated by the contract date (FR-PSH-004)
  end if;
  select org_id into v_org from public.projects where id = p_id;
  perform public.assert_stage_date_editor(v_org);
  select id into v_entry from public.project_stage_entries
   where project_id = p_id order by position desc limit 1;
  old := public.stage_entry_set_date(v_entry, p_entered_on);
  update public.project_stage_entries set redated_at = null where id = v_entry;  -- chosen at the move, not a correction
  perform public.log_audit('project.stage_entry.redate', v_org, auth.uid(), p_id,
    jsonb_build_object('entry_id', v_entry, 'stage', p_to::text, 'from', old.entered_on, 'to', p_entered_on,
                       'at_move', true));
end; $$;
```
Verify GREEN: Tasks 4–6 assertions pass —
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`.

### Task 8 — failing pgTAP: add a skipped stage (AC-PSH-005)
Append (as postgres, a fresh project with a Leads → Tender journey):
```sql
reset role;
insert into projects (id, org_id, code, name, status, project_manager_id, created_at) values
  ('16380000-0000-0000-0000-000000000014','16380000-0000-0000-0000-000000000001','PSH-5','PSH skip','Leads',
   '16380000-0000-0000-0000-0000000000a2', now() - interval '90 days');
insert into project_stage_entries (org_id, project_id, stage, entered_on, position, source)
values ('16380000-0000-0000-0000-000000000001','16380000-0000-0000-0000-000000000014','Tender Submitted', current_date - 40, 2, 'backfill');
-- Move the status without the trigger appending a duplicate (the same flag §4 uses).
select set_config('pmo.stage_entry_suppress', '16380000-0000-0000-0000-000000000014', true);
update projects set status = 'Tender Submitted' where id = '16380000-0000-0000-0000-000000000014';
select set_config('pmo.stage_entry_suppress', '', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select add_skipped_stage_entry(
  (select id from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000014' and position = 2),
  'Quotation Submitted', current_date - 60);
select results_eq(
  $$ select stage::text, source from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000014' order by position $$,
  $$ values ('Leads','origination'),('Quotation Submitted','added'),('Tender Submitted','backfill') $$,
  'AC-PSH-005: a skipped stage is inserted between its neighbours');
select is((select status::text from projects where id = '16380000-0000-0000-0000-000000000014'),
  'Tender Submitted', 'AC-PSH-005: adding a skipped stage never changes the status');
select throws_ok(
  $$ select add_skipped_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000014' and position = 2), 'PQ Submitted', current_date - 39) $$,
  '23514', null, 'AC-PSH-005: a skipped stage dated after the next entry is refused');
select throws_ok(
  $$ select add_skipped_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000014' and position = 2), 'Won, Pending KoM', current_date - 50) $$,
  'P0001', null, 'AC-PSH-005: only a pre-award stage can be added');
```
Verify RED: `function add_skipped_stage_entry(...) does not exist`.

### Task 9 — migration §3b: `add_skipped_stage_entry`
```sql
create or replace function public.add_skipped_stage_entry(
  p_before_entry_id uuid, p_stage project_status, p_entered_on date) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  nxt   public.project_stage_entries;
  v_prev numeric;
  v_id   uuid;
begin
  select * into nxt from public.project_stage_entries where id = p_before_entry_id;
  if nxt.id is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  perform public.assert_stage_date_editor(nxt.org_id);
  perform 1 from public.projects where id = nxt.project_id for update;          -- serialize journey edits
  if p_stage::text <> all(public.pipeline_project_statuses()) then             -- mut:preaward
    raise exception 'only a pre-award stage can be added to the history' using errcode = 'P0001';
  end if;
  if p_entered_on is null or p_entered_on > public.native_org_today(nxt.org_id) then
    raise exception 'a stage date cannot be in the future' using errcode = '23514';
  end if;
  select coalesce(max(position), 0) into v_prev from public.project_stage_entries
   where project_id = nxt.project_id and position < nxt.position;
  insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
  values (nxt.org_id, nxt.project_id, p_stage, p_entered_on, (v_prev + nxt.position) / 2, 'added', auth.uid())
  returning id into v_id;                                        -- project_stage_entries_order checks both sides
  perform public.log_audit('project.stage_entry.add', nxt.org_id, auth.uid(), nxt.project_id,
    jsonb_build_object('entry_id', v_id, 'stage', p_stage::text, 'entered_on', p_entered_on,
                       'before_entry_id', nxt.id));
  return v_id;
end; $$;
```
(`pipeline_project_statuses()` is the shipped list of the five open stages, used by 0385:61.)
Verify GREEN: Task 8 assertions pass (same command as Task 7).

### Task 10 — failing pgTAP: authority and direct writes (AC-PSH-006)
Append:
```sql
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select redate_stage_entry((select id from project_stage_entries
  where project_id = '16380000-0000-0000-0000-000000000010' order by position limit 1), current_date) $$,
  '42501', null, 'AC-PSH-006: an Engineer cannot re-date a stage');
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select redate_stage_entry((select id from project_stage_entries
  where project_id = '16380000-0000-0000-0000-000000000010' order by position limit 1), current_date) $$,
  '42501', null, 'AC-PSH-006: a disabled PM cannot re-date a stage');
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$ select redate_stage_entry(
  (select id from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000010' limit 1), current_date) $$,
  '42501', null, 'AC-PSH-006: an org-B PM cannot re-date an org-A entry (the definer finds it; the gate refuses)');
select is((select count(*)::int from project_stage_entries
  where project_id = '16380000-0000-0000-0000-000000000010'), 0, 'AC-PSH-006: org-B reads zero org-A entries');
select throws_ok($$ insert into project_stage_entries (org_id, project_id, stage, entered_on, position, source)
  values ('16380000-0000-0000-0000-000000000002','16380000-0000-0000-0000-000000000020','PQ Submitted', current_date, 9, 'added') $$,
  '42501', null, 'AC-PSH-006: a direct INSERT is refused');
select throws_ok($$ update project_stage_entries set entered_on = current_date
  where project_id = '16380000-0000-0000-0000-000000000020' $$,
  '42501', null, 'AC-PSH-006: a direct UPDATE is refused');
select throws_ok($$ delete from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000020' $$,
  '42501', null, 'AC-PSH-006: a direct DELETE is refused');
```
Verify: all pass (Task 2 grants + Task 7 gate).

### Task 11 — mutation check of the editor gate (no code kept)
For each marker in turn — `mut:editor_rank` (change `>= 20` to `>= 10`), `mut:editor_active` (delete the
line), `mut:editor_org` (delete the line), `mut:order` (replace `s.entered_on < s.prev_on` with `false`) —
edit the migration, run
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`,
confirm at least one AC-PSH-003/004/005/006 assertion goes **red**, then `git checkout -- supabase/migrations/<NNNN>_pipeline_stage_history.sql`.
Record the four red outputs in the PR body.

### Task 12 — failing pgTAP: audit (AC-PSH-007)
Append (replacing the temporary `finish`/`rollback` lines):
```sql
reset role;
select ok(exists (select 1 from record_changes where entity_type = 'project_stage_entry'
   and parent_type = 'project' and parent_id = '16380000-0000-0000-0000-000000000012'
   and op = 'update' and changes ? 'entered_on'),
  'AC-PSH-007: a re-date is in record_changes under the project');
select ok(exists (select 1 from record_changes where entity_type = 'project_stage_entry'
   and parent_id = '16380000-0000-0000-0000-000000000014' and op = 'insert'),
  'AC-PSH-007: an added stage is in record_changes under the project');
select ok(exists (select 1 from audit_events where action = 'project.stage_entry.redate'
   and actor_id = '16380000-0000-0000-0000-0000000000a3' and entity_id = '16380000-0000-0000-0000-000000000012'
   and detail->>'to' = (current_date - 5)::text),
  'AC-PSH-007: the re-date is on the audit trail with actor and new date');
select ok(exists (select 1 from audit_events where action = 'project.stage_entry.add'
   and entity_id = '16380000-0000-0000-0000-000000000014'),
  'AC-PSH-007: the added stage is on the audit trail');
select * from finish();
rollback;
```
Confirm `select plan(N)` at the top equals the number of assertions in the file.
Verify RED: the two `record_changes` assertions fail (table not registered).

### Task 13 — migration §5: register history capture
```sql
-- §5 ─────────────────────────────────────────────────────────────────────────────────────────────
insert into public.record_history_config(entity_type,table_name,parent_type,parent_col,parent_via,captured,flag_cols,omit_cols) values
('project_stage_entry','project_stage_entries','project','project_id',null,
 '{"project_id":"ref","stage":"enum","entered_on":"date","source":"text","redated_at":"timestamp"}',
 '{}','{id,org_id,position,recorded_by,recorded_at}');
create trigger project_stage_entries_zz_record_change
  after insert or update on public.project_stage_entries
  for each row execute function public.record_change_capture();
```
Place §5 **after** §7 (backfill) in the file so the backfill does not flood `record_changes`; order the
sections in the file as §1 §2 §3 §4 §6 §7 §5 §8 and keep the header list as written.
Verify GREEN: whole write file passes —
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`.

### Task 14 — failing pgTAP: stage age from the business date (AC-PSH-008)
Create `supabase/tests/pipeline_stage_history_read.test.sql`:
```sql
-- pipeline_stage_history_read.test.sql — #1638 AC-PSH-008: stage age = latest entry's entered_on.
begin;
select plan(3);
insert into organizations (id, name) values ('16380000-0000-0000-0000-000000000003','PSH Read Org');
insert into auth.users (id, email) values ('16380000-0000-0000-0000-0000000000c2','psh-read@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000c2','16380000-0000-0000-0000-000000000003','PSH Read','psh-read@example.test','Executive','active');
insert into projects (id, org_id, code, name, status, created_at) values
  ('16380000-0000-0000-0000-000000000030','16380000-0000-0000-0000-000000000003','PSH-R','PSH read','Leads', now() - interval '200 days');
update projects set status = 'PQ Submitted' where id = '16380000-0000-0000-0000-000000000030';
update project_stage_entries set entered_on = current_date - 100
 where project_id = '16380000-0000-0000-0000-000000000030' and stage = 'PQ Submitted';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is(
  ((get_sales_pipeline())::jsonb -> 'projects' -> 0 ->> 'stage_started_at')::date, current_date - 100,
  'AC-PSH-008: get_sales_pipeline stage_started_at is the latest entry date');
select is(((get_win_rate())::jsonb ->> 'stale_count')::int, 1,
  'AC-PSH-008: get_win_rate counts the backdated bid as stale');
select is(
  ((get_sales_pipeline())::jsonb -> 'projects' -> 0 ->> 'status'), 'PQ Submitted',
  'AC-PSH-008: the latest entry stage is the current status');
select * from finish();
rollback;
```
Before writing the `stale_count` path, read `0385…sql:66-80` to confirm the JSON key name and nesting; use the
exact path that body emits.
Verify RED: the first assertion returns the `record_changes` time (today), not `current_date - 100`.

### Task 15 — migration §6: re-create the two reads
Copy `public.get_win_rate(date, date)` (0385 lines 4 → end of that function) and
`public.get_sales_pipeline()` (0385 lines 135 → its closing `$$;`) **verbatim** into §6, then in each replace the
`left join lateral ( select rc.created_at as changed_at from record_changes rc … limit 1 ) stage_change on true`
block (0385:49-60 and 0385:162-173) with:
```sql
    left join lateral (
      select (e.entered_on::timestamp at time zone 'UTC') as changed_at
      from project_stage_entries e
      where e.project_id = p.id
      order by e.position desc
      limit 1
    ) stage_change on true
```
and leave `coalesce(stage_change.changed_at, p.created_at) as stage_started_at` unchanged. Re-issue 0385's
`revoke`/`grant` lines for both functions and update the two `comment on function` texts to:
`'… stage_started_at is the latest project_stage_entries.entered_on (#1638), falling back to created_at …'`.
Verify GREEN:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_read.test.sql supabase/tests/0057_sales_pipeline_attention.test.sql supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/0044_sales_pipeline_stages.test.sql'`.

### Task 16 — failing pgTAP: backfill (AC-PSH-009)
Create `supabase/tests/pipeline_stage_history_backfill.test.sql` (as postgres throughout — server-side inserts
are exempt from the origination guard, `0175_update_path_sod_class.sql:219-222`, which `seed.sql` relies on):
```sql
-- pipeline_stage_history_backfill.test.sql — #1638 AC-PSH-009 (backfill) + AC-PSH-010 (import RPC).
begin;
select plan(8);
insert into organizations (id, name) values ('16380000-0000-0000-0000-000000000004','PSH Backfill Org');
insert into projects (id, org_id, code, name, status, created_at, contract_date) values
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000004','PSH-BF1','PSH backfill',
   'Won, Pending KoM', now() - interval '120 days', current_date - 70),
  ('16380000-0000-0000-0000-000000000042','16380000-0000-0000-0000-000000000004','PSH-BF2','PSH clamp',
   'Won, Pending KoM', now() - interval '120 days', current_date - 100);
-- Simulate pre-migration projects: no entries, recorded status changes only.
delete from project_stage_entries where project_id in
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000042');
insert into record_changes (org_id, entity_type, entity_id, op, changes, created_at) values
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000040'), 1,
  'AC-PSH-009: one project backfilled');
select results_eq(
  $$ select stage::text, entered_on, source from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000040' order by position $$,
  $$ values ('Leads', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '120 days'), 'backfill'),
            ('Quotation Submitted', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '90 days'), 'backfill'),
            ('Won, Pending KoM', current_date - 70, 'backfill') $$,
  'AC-PSH-009: start + each recorded change, Signed dated by contract_date');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000040'), 0,
  'AC-PSH-009: a project that already has a journey is left alone');
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000042'), 1, 'AC-PSH-009: clamp fixture backfilled');
select results_eq(
  $$ select entered_on from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000042' order by position $$,
  $$ values (stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '120 days')),
            (current_date - 100), (current_date - 100) $$,
  'AC-PSH-009: an earlier contract date clamps the entries before it, so dates never go backwards');
-- (AC-PSH-010 assertions appended by Task 18, then finish/rollback.)
```
In the clamp fixture the Quotation change (90 days ago) is later than the contract date (100 days ago), so the
suffix-minimum clamp brings it down to the contract date; the Leads entry (120 days ago) is already earlier and
stays.
Verify RED: `function backfill_project_stage_entries(uuid) does not exist`.

### Task 17 — migration §7: backfill function + run it
```sql
-- §7 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.backfill_project_stage_entries(p_project_id uuid default null) returns int
  language plpgsql security definer set search_path = public as $$
declare
  r   public.projects;
  v_n int := 0;
begin
  set constraints public.project_stage_entries_order deferred;
  for r in select p.* from public.projects p
            where (p_project_id is null or p.id = p_project_id)
              and not exists (select 1 from public.project_stage_entries e where e.project_id = p.id)
  loop
    insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source)
    select r.org_id, r.id,
           coalesce((select (rc.changes -> 'status' ->> 'old')::project_status
                       from public.record_changes rc
                      where rc.org_id = r.org_id and rc.entity_type = 'project' and rc.entity_id = r.id
                        and rc.op = 'update' and rc.changes ? 'status'
                      order by rc.seq limit 1), r.status),
           public.stage_org_date(r.org_id, r.created_at), 1, 'backfill';
    insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by, recorded_at)
    select r.org_id, r.id, (rc.changes -> 'status' ->> 'new')::project_status,
           public.stage_org_date(r.org_id, rc.created_at), 1 + row_number() over (order by rc.seq),
           'backfill', rc.actor_id, rc.created_at
      from public.record_changes rc
     where rc.org_id = r.org_id and rc.entity_type = 'project' and rc.entity_id = r.id
       and rc.op = 'update' and rc.changes ? 'status';
    -- Key dates (FR-PSH-004).
    update public.project_stage_entries e set entered_on = r.contract_date
     where e.project_id = r.id and e.stage = 'Won, Pending KoM' and r.contract_date is not null;
    if r.status in ('Loss Tender','Declined') and r.decided_at is not null then
      update public.project_stage_entries e set entered_on = public.stage_org_date(r.org_id, r.decided_at)
       where e.project_id = r.id
         and e.position = (select max(position) from public.project_stage_entries where project_id = r.id);
    end if;
    -- Clamp backwards so dates never decrease along the journey (suffix minimum).
    update public.project_stage_entries e set entered_on = s.clamped
      from (select id, min(entered_on) over (order by position desc
                                              rows between unbounded preceding and current row) as clamped
              from public.project_stage_entries where project_id = r.id) s
     where e.id = s.id and e.entered_on <> s.clamped;
    v_n := v_n + 1;
  end loop;
  set constraints public.project_stage_entries_order immediate;
  return v_n;
end; $$;
revoke all on function public.backfill_project_stage_entries(uuid) from public, anon, authenticated;

select public.backfill_project_stage_entries();
```
Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_backfill.test.sql'`.

### Task 18 — failing pgTAP: import RPC (AC-PSH-010)
Append to `pipeline_stage_history_backfill.test.sql` (the plan(8) above already counts these 3), then
`select * from finish(); rollback;`. Fixture first (as postgres):
```sql
insert into auth.users (id, email) values ('16380000-0000-0000-0000-0000000000d2','psh-imp@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000d2','16380000-0000-0000-0000-000000000004','PSH Imp','psh-imp@example.test','Project Manager','active');
insert into projects (id, org_id, code, name, status, project_manager_id, created_at) values
  ('16380000-0000-0000-0000-000000000041','16380000-0000-0000-0000-000000000004','PSH-IMP','PSH import','Leads',
   '16380000-0000-0000-0000-0000000000d2', '2026-06-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000d2","role":"authenticated"}';
```
then:
```sql
select import_project_stage_history('16380000-0000-0000-0000-000000000041',
  '[{"stage":"PQ Submitted","entered_on":"2026-07-01"},{"stage":"Quotation Submitted","entered_on":"2026-07-15"}]');
select results_eq($$ select stage::text, source from project_stage_entries
   where project_id = '16380000-0000-0000-0000-000000000041' order by position $$,
  $$ values ('Leads','origination'),('PQ Submitted','import'),('Quotation Submitted','import') $$,
  'AC-PSH-010: import records one entry per dated stage');
select is((select status::text from projects where id = '16380000-0000-0000-0000-000000000041'),
  'Quotation Submitted', 'AC-PSH-010: the project lands at the latest dated stage');
select throws_ok($$ select import_project_stage_history('16380000-0000-0000-0000-000000000041',
  '[{"stage":"PQ Submitted","entered_on":"2026-07-01"}]') $$, 'P0001', null,
  'AC-PSH-010: a second import call is refused');
```
Verify RED: function does not exist.

### Task 19 — migration §4: `import_project_stage_history`
```sql
-- §4 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.import_project_stage_history(p_project_id uuid, p_entries jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_status project_status;
  v_count  int;
  x        jsonb;
  v_pos    numeric := 1;
  v_last   project_status;
begin
  select org_id, status into v_org, v_status from public.projects where id = p_project_id for update;
  if v_org is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  perform public.assert_stage_date_editor(v_org);
  select count(*) into v_count from public.project_stage_entries where project_id = p_project_id;
  if v_status <> 'Leads' or v_count <> 1 then                         -- idempotent: only a fresh Leads row
    raise exception 'stage history can be imported only into a new lead' using errcode = 'P0001';
  end if;
  for x in select * from jsonb_array_elements(p_entries) loop
    if (x ->> 'stage') <> all(public.pipeline_project_statuses()) or (x ->> 'stage') = 'Leads' then
      raise exception 'imported stage % is not a pre-award stage after Leads', x ->> 'stage' using errcode = 'P0001';
    end if;
    if (x ->> 'entered_on')::date > public.native_org_today(v_org) then
      raise exception 'a stage date cannot be in the future' using errcode = '23514';
    end if;
    v_pos := v_pos + 1;
    insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
    values (v_org, p_project_id, (x ->> 'stage')::project_status, (x ->> 'entered_on')::date, v_pos, 'import', auth.uid());
    v_last := (x ->> 'stage')::project_status;
  end loop;
  if v_last is not null then
    -- Pre-award stages only (no SoD on these). The transaction-local flag stops the append trigger (§2)
    -- adding a duplicate entry for this one project; it is cleared straight after.
    perform set_config('pmo.stage_entry_suppress', p_project_id::text, true);
    update public.projects set status = v_last, last_update = now() where id = p_project_id;
    perform set_config('pmo.stage_entry_suppress', '', true);
    perform public.log_audit('project.transition', v_org, auth.uid(), p_project_id,
      jsonb_build_object('from', 'Leads', 'to', v_last::text, 'source', 'import', 'entries', p_entries));
  end if;
end; $$;
```
The stage order inside `p_entries` is validated by the §2 ordering constraint (dates) — canonical stage order is
the import preview's job (Task 38). The suppress flag is set by `set_config` only inside definer functions; a
client cannot reach `set_config` through the API (it is not in an exposed schema), and the flag only ever
*suppresses* an append for one id inside the same transaction.
Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_backfill.test.sql'`.

### Task 20 — migration §8: grants + closing self-assertion; invariant test
```sql
-- §8 ─────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.redate_stage_entry(uuid, date) from public, anon;
revoke all on function public.add_skipped_stage_entry(uuid, project_status, date) from public, anon;
revoke all on function public.advance_project_stage(uuid, project_status, date, text, date) from public, anon;
revoke all on function public.import_project_stage_history(uuid, jsonb) from public, anon;
grant execute on function public.redate_stage_entry(uuid, date) to authenticated;
grant execute on function public.add_skipped_stage_entry(uuid, project_status, date) to authenticated;
grant execute on function public.advance_project_stage(uuid, project_status, date, text, date) to authenticated;
grant execute on function public.import_project_stage_history(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from public.projects p
              where p.status is distinct from (select e.stage from public.project_stage_entries e
                                                where e.project_id = p.id order by e.position desc limit 1)) then
    raise exception '<NNNN>: a project''s latest stage entry does not match its status';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
       ('projects_zy_stage_entry','project_stage_entries_order','project_stage_entries_zz_record_change')) <> 3 then
    raise exception '<NNNN>: stage history triggers missing';
  end if;
  if has_table_privilege('authenticated', 'public.project_stage_entries', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_stage_entries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_stage_entries', 'DELETE') then
    raise exception '<NNNN>: clients must not write project_stage_entries directly';
  end if;
  if has_function_privilege('authenticated', 'public.backfill_project_stage_entries(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.stage_entry_set_date(uuid, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_stage_date_editor(uuid)', 'EXECUTE') then
    raise exception '<NNNN>: internal stage functions must not be client-callable';
  end if;
end $$;
```
Add to `pipeline_stage_history_read.test.sql` (plan +1):
```sql
select is((select count(*)::int from projects p where p.status is distinct from
  (select e.stage from project_stage_entries e where e.project_id = p.id order by e.position desc limit 1)), 0,
  'AC-PSH-001: every project''s latest stage entry is its current status');
```
(run as `reset role;` before it). Mutation: remove `grant select` line in §1 → AC-PSH-006 read assertions go
red; restore.
Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql supabase/tests/pipeline_stage_history_read.test.sql supabase/tests/pipeline_stage_history_backfill.test.sql supabase/tests/0027_project_transition_authz.test.sql supabase/tests/0028_project_transition_legality.test.sql'`.

### Task 21 — rollback script
Create `supabase/migrations/rollback/<NNNN>_pipeline_stage_history_down.sql`:
```sql
-- <NNNN>_pipeline_stage_history_down.sql — reverses <NNNN>. Loses stage history; business rows untouched.
begin;
drop trigger if exists projects_zy_stage_entry on public.projects;
drop function if exists public.import_project_stage_history(uuid, jsonb);
drop function if exists public.advance_project_stage(uuid, project_status, date, text, date);
drop function if exists public.add_skipped_stage_entry(uuid, project_status, date);
drop function if exists public.redate_stage_entry(uuid, date);
drop function if exists public.stage_entry_set_date(uuid, date);
drop function if exists public.assert_stage_date_editor(uuid);
drop function if exists public.backfill_project_stage_entries(uuid);
drop function if exists public.project_stage_entry_append();
delete from public.record_history_config where entity_type = 'project_stage_entry';
delete from public.record_changes where entity_type = 'project_stage_entry';
drop table if exists public.project_stage_entries;
drop function if exists public.project_stage_entries_assert_order();
drop function if exists public.stage_org_date(uuid, timestamptz);
-- Restore 0385's reads: paste 0385's get_win_rate and get_sales_pipeline definitions, grants and comments verbatim.
commit;
```
Paste the two 0385 function bodies (unchanged originals) in place of the last comment.
Verify (throwaway): `scripts/with-db-lock.sh bash -c 'supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d \")" -f supabase/migrations/rollback/<NNNN>_pipeline_stage_history_down.sql && supabase test db supabase/tests/0057_sales_pipeline_attention.test.sql && supabase db reset'`.

### Task 22 — regenerate types; seed check
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'
cd pmo-portal && npm run typecheck
```
Then confirm seeded deals got journeys: `scripts/with-db-lock.sh bash -c "psql \"\$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')\" -c 'select count(*) from projects p where not exists (select 1 from project_stage_entries e where e.project_id = p.id)'"` → `0`.
Commit the DB half (migration, rollback, three pgTAP files, types). PR → `dev`.

### Task 23 — failing Vitest: the stage line (AC-PSH-011)
Add to `pmo-portal/components/salesPipeline.test.ts`:
```ts
import { stageLine, daysBetweenDates, STAGE_KEY_DATE_LABEL } from './salesPipeline';

describe('stageLine (#1638)', () => {
  it('AC-PSH-011: renders "<label> <dd Mon> · <n> d" for the latest entry', () => {
    expect(stageLine('Quotation Submitted', '2026-10-12', '2026-11-01', (k, d) => d)).toBe('Quoted 12 Oct · 20 d');
  });
  it('AC-PSH-011: day count is calendar days, never negative', () => {
    expect(daysBetweenDates('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetweenDates('2026-11-01', '2026-11-01')).toBe(0);
    expect(daysBetweenDates('2026-11-02', '2026-11-01')).toBe(0);
  });
  it('AC-PSH-011: every project status has a key-date label', () => {
    for (const s of ['Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation','Won, Pending KoM',
      'Loss Tender','Declined','Ongoing Project','On Hold','Close Out','Internal Project']) {
      expect(STAGE_KEY_DATE_LABEL[s]).toBeDefined();
    }
  });
});
```
Verify RED: `cd pmo-portal && npx vitest run components/salesPipeline.test.ts`.

### Task 24 — implement the helpers + locale keys
In `pmo-portal/components/salesPipeline.ts` add:
```ts
import { formatDayMonth } from '@/src/lib/format';

/** #1638 — key-date label per stage: [i18n key, English default]. Spec §3. */
export const STAGE_KEY_DATE_LABEL: Record<string, readonly [string, string]> = {
  'Leads': ['sales:stageDate.lead', 'Lead'],
  'PQ Submitted': ['sales:stageDate.pq', 'Pre-qual sent'],
  'Quotation Submitted': ['sales:stageDate.quoted', 'Quoted'],
  'Tender Submitted': ['sales:stageDate.tender', 'Tender sent'],
  'Negotiation': ['sales:stageDate.negotiation', 'Negotiation'],
  'Won, Pending KoM': ['sales:stageDate.signed', 'Signed'],
  'Loss Tender': ['sales:stageDate.lost', 'Lost'],
  'Declined': ['sales:stageDate.declined', 'Declined'],
  'Ongoing Project': ['sales:stageDate.started', 'Started'],
  'On Hold': ['sales:stageDate.onHold', 'On hold'],
  'Close Out': ['sales:stageDate.closedOut', 'Closed out'],
  'Internal Project': ['sales:stageDate.internal', 'Internal'],
};

/** Whole calendar days from `fromIso` to `toIso` (both 'YYYY-MM-DD'); 0 when from is after to. */
export function daysBetweenDates(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

type Translate = (key: string, defaultValue: string) => string;

/** The card's one line for the latest stage entry: "Quoted 12 Oct · 20 d" (FR-PSH-013). */
export function stageLine(status: string, enteredOn: string, todayIso: string, t: Translate): string {
  const [key, fallback] = STAGE_KEY_DATE_LABEL[status] ?? ['', status];
  const label = key ? t(key, fallback) : fallback;
  const date = formatDayMonth(new Date(`${enteredOn.slice(0, 10)}T00:00:00Z`));
  return `${label} ${date} · ${daysBetweenDates(enteredOn.slice(0, 10), todayIso)} ${t('sales:stageDate.daysShort', 'd')}`;
}
```
Add the keys to `pmo-portal/public/locales/en/sales.json` under `"stageDate"` (values = the English defaults
above, plus `"daysShort": "d"`) and to `pmo-portal/public/locales/id/sales.json`
(`"lead": "Prospek"`, `"pq": "Prakualifikasi dikirim"`, `"quoted": "Penawaran"`, `"tender": "Tender dikirim"`,
`"negotiation": "Negosiasi"`, `"signed": "Ditandatangani"`, `"lost": "Kalah"`, `"declined": "Ditolak"`,
`"started": "Dimulai"`, `"onHold": "Ditunda"`, `"closedOut": "Ditutup"`, `"internal": "Internal"`, `"daysShort": "h"`).
Verify GREEN: `npx vitest run components/salesPipeline.test.ts` and `npm run check:guards` (locale parity).

### Task 25 — failing Vitest: card shows exactly one stage line (AC-PSH-011)
Add to `pmo-portal/components/SalesKanbanBoard.test.tsx` (reuse that file's render helper and fixture builder):
```tsx
it('AC-PSH-011: an open deal card shows one stage line for its latest entry', () => {
  vi.useFakeTimers({ now: new Date('2026-11-01T05:00:00Z') });
  renderBoard([makeDeal({ id: 'd1', status: 'Quotation Submitted', stage_started_at: '2026-10-12' })]);
  const lines = screen.getAllByTestId('stage-line-d1');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toHaveTextContent('Quoted 12 Oct · 20 d');
  vi.useRealTimers();
});
```
If the file names its helpers differently, use its existing ones (read the top 60 lines first); do not add a new
render harness.
Verify RED: `npx vitest run components/SalesKanbanBoard.test.tsx -t AC-PSH-011`.

### Task 26 — implement `DealStageLine` + `contract_date`/`decided_at` on rows
In `pmo-portal/src/lib/db/dashboard.ts` `PipelineProject` (after `stage_started_at?: string;`, line 178) add:
```ts
  /** #1638: won deals — the Signed date. Projected by toPipelineProject for the Won column. */
  contract_date?: string | null;
  /** #1638: lost/declined deals — the decision instant. Projected by toPipelineProject for the Lost column. */
  decided_at?: string | null;
```
In `pmo-portal/src/hooks/useDashboard.ts` `toPipelineProject` (line 78) add `contract_date: row.contract_date,`
and `decided_at: row.decided_at,` after `last_update`.
In `pmo-portal/components/SalesKanbanBoard.tsx` add above `DealCard`:
```tsx
import { stageLine } from './salesPipeline';
import { useOrgToday } from '@/src/hooks/useOrgToday';

/** #1638 FR-PSH-013 — one line for the latest stage entry; lost deals date from decided_at. */
const DealStageLine: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation();
  const today = useOrgToday();
  const lost = project.status === 'Loss Tender' || project.status === 'Declined';
  const enteredOn = lost ? project.decided_at?.slice(0, 10) : project.stage_started_at?.slice(0, 10);
  if (!enteredOn) return null;
  return (
    <p data-testid={`stage-line-${project.id}`} className="text-xs text-muted-foreground tabular">
      {stageLine(project.status, enteredOn, today, (k, d) => t(k, d))}
    </p>
  );
};
```
`useOrgToday` — check `pmo-portal/src/hooks/` for an existing org-local today hook first
(`grep -rn "Today" pmo-portal/src/hooks/*.ts`); if none, create `pmo-portal/src/hooks/useOrgToday.ts`:
```ts
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
/** Today as 'YYYY-MM-DD' in the active org/user timezone (format.ts:60). */
export function useOrgToday(): string {
  return formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
}
```
(confirm `formatCalendarDayInTimeZone` returns `YYYY-MM-DD` by reading `format.ts:55-75`; if it returns a display
string, build the ISO date with `Intl.DateTimeFormat('en-CA', { timeZone })` instead).
Render `<DealStageLine project={project} />` as the first child of the `space-y-1` body div in both `DealCard`
(line ~69) and `CompactDealCard` (line ~127), **only when** `!ON_HAND_STATUSES.includes(project.status)`.
Verify GREEN: `npx vitest run components/SalesKanbanBoard.test.tsx`.

### Task 27 — failing Vitest: Signed pill (AC-PSH-012)
```tsx
it('AC-PSH-012: a won deal shows a Signed pill with its contract date and no stage line', () => {
  renderBoard([makeDeal({ id: 'w1', status: 'Won, Pending KoM', contract_date: '2026-09-03' })]);
  expect(screen.getByTestId('signed-pill-w1')).toHaveTextContent('Signed 03 Sep');
  expect(screen.queryByTestId('stage-line-w1')).toBeNull();
});
it('AC-PSH-012: a won deal without a contract date shows "Signed" alone', () => {
  renderBoard([makeDeal({ id: 'w2', status: 'Ongoing Project', contract_date: null })]);
  expect(screen.getByTestId('signed-pill-w2')).toHaveTextContent(/^Signed$/);
});
```
Verify RED: `npx vitest run components/SalesKanbanBoard.test.tsx -t AC-PSH-012`.

### Task 28 — implement `SignedPill`
In `SalesKanbanBoard.tsx`:
```tsx
/** #1593/#1638 FR-PSH-014 — won deals carry a Signed pill with the contract date. */
const SignedPill: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation();
  const label = t('sales:stageDate.signed', 'Signed');
  const date = project.contract_date
    ? formatDayMonth(new Date(`${project.contract_date.slice(0, 10)}T00:00:00Z`))
    : null;
  return (
    <Badge data-testid={`signed-pill-${project.id}`} className="w-fit px-1.5">
      {date ? `${label} ${date}` : label}
    </Badge>
  );
};
```
(import `formatDayMonth` from `@/src/lib/format`, `ON_HAND_STATUSES` from `@/src/lib/db/projectTransitions`).
Render `{ON_HAND_STATUSES.includes(project.status) ? <SignedPill project={project} /> : <DealStageLine project={project} />}`
in both cards (replacing Task 26's conditional).
Verify GREEN: `npx vitest run components/SalesKanbanBoard.test.tsx components/SalesKanbanBoard.bahasa.test.tsx`.

### Task 29 — failing Vitest: DAL + repository
Create `pmo-portal/src/lib/db/__tests__/projectStageEntries.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const rpc = vi.fn();
const order = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ order: (...a: unknown[]) => order(...a) }) }) }),
  },
}));
import { listStageEntries, redateStageEntry, addSkippedStageEntry, advanceProjectStage, importProjectStageHistory } from '../projectStageEntries';

beforeEach(() => { rpc.mockReset(); order.mockReset(); });

describe('projectStageEntries DAL (#1638)', () => {
  it('lists a project journey newest-first by position', async () => {
    order.mockResolvedValue({ data: [{ id: 'e2' }, { id: 'e1' }], error: null });
    await expect(listStageEntries('p1')).resolves.toEqual([{ id: 'e2' }, { id: 'e1' }]);
    expect(order).toHaveBeenCalledWith('position', { ascending: false });
  });
  it('never sends org_id to the stage RPCs', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await redateStageEntry('e1', '2026-10-12');
    await addSkippedStageEntry('e2', 'Quotation Submitted', '2026-10-01');
    await advanceProjectStage('p1', 'Quotation Submitted', '2026-10-12');
    await importProjectStageHistory('p1', [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }]);
    expect(rpc.mock.calls).toEqual([
      ['redate_stage_entry', { p_entry_id: 'e1', p_entered_on: '2026-10-12' }],
      ['add_skipped_stage_entry', { p_before_entry_id: 'e2', p_stage: 'Quotation Submitted', p_entered_on: '2026-10-01' }],
      ['advance_project_stage', { p_id: 'p1', p_to: 'Quotation Submitted', p_entered_on: '2026-10-12' }],
      ['import_project_stage_history', { p_project_id: 'p1', p_entries: [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }] }],
    ]);
  });
  it('surfaces an RPC refusal as an AppError with its code', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'a stage date cannot be earlier…' } });
    await expect(redateStageEntry('e1', '2026-01-01')).rejects.toMatchObject({ code: '23514' });
  });
});
```
Verify RED: `npx vitest run src/lib/db/__tests__/projectStageEntries.test.ts`.

### Task 30 — implement DAL, repository, hook
`pmo-portal/src/lib/db/projectStageEntries.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import type { ProjectStatus } from './projectTransitions';

/** #1638 — one stage a deal entered (supabase/migrations/<NNNN>_pipeline_stage_history.sql §1). */
export interface StageEntry {
  id: string;
  project_id: string;
  stage: ProjectStatus;
  entered_on: string;
  position: number;
  source: 'origination' | 'transition' | 'added' | 'import' | 'backfill';
  recorded_at: string;
  redated_at: string | null;
  recorder: { full_name: string } | null;
}
export interface ImportStageDate { stage: ProjectStatus; entered_on: string }

/** Journey newest-first. org_id is never sent — RLS scopes rows. */
export async function listStageEntries(projectId: string): Promise<StageEntry[]> {
  const { data, error } = await supabase
    .from('project_stage_entries')
    .select('id, project_id, stage, entered_on, position, source, recorded_at, redated_at, recorder:profiles!project_stage_entries_recorded_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('position', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as StageEntry[];
}

export async function redateStageEntry(entryId: string, enteredOn: string): Promise<void> {
  const { error } = await supabase.rpc('redate_stage_entry', { p_entry_id: entryId, p_entered_on: enteredOn });
  if (error) throw toAppError(error);
}

export async function addSkippedStageEntry(beforeEntryId: string, stage: ProjectStatus, enteredOn: string): Promise<void> {
  const { error } = await supabase.rpc('add_skipped_stage_entry', {
    p_before_entry_id: beforeEntryId, p_stage: stage, p_entered_on: enteredOn,
  });
  if (error) throw toAppError(error);
}

/** A stage move dated by the user (FR-PSH-005). Won keeps using repositories.project.transition. */
export async function advanceProjectStage(id: string, to: ProjectStatus, enteredOn: string): Promise<void> {
  const { error } = await supabase.rpc('advance_project_stage', { p_id: id, p_to: to, p_entered_on: enteredOn });
  if (error) throw toAppError(error);
}

export async function importProjectStageHistory(projectId: string, entries: ImportStageDate[]): Promise<void> {
  const { error } = await supabase.rpc('import_project_stage_history', { p_project_id: projectId, p_entries: entries });
  if (error) throw toAppError(error);
}
```
(If the mock's `from()` chain in Task 29 cannot match `select(...).eq(...).order(...)` exactly, adjust the
**mock** shape only, never the assertions.)
`pmo-portal/src/lib/repositories/projectStages.ts`:
```ts
import * as dal from '@/src/lib/db/projectStageEntries';
export const projectStageRepository = {
  list: dal.listStageEntries,
  redate: dal.redateStageEntry,
  addSkipped: dal.addSkippedStageEntry,
  advance: dal.advanceProjectStage,
  importHistory: dal.importProjectStageHistory,
};
```
Register in `pmo-portal/src/lib/repositories/index.ts` (`import { projectStageRepository } from './projectStages';`
and `projectStage: projectStageRepository,` next to `project: projectRepository,` at line 88; add the type to the
`Repositories` contract the same way `recordHistoryRepository` is typed — follow that entry exactly).
`pmo-portal/src/hooks/useProjectStageEntries.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/AuthContext';
import { repositories } from '@/src/lib/repositories';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

export function useProjectStageEntries(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-stage-entries', orgId, projectId],
    queryFn: () => repositories.projectStage.list(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

export function useStageEntryMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const settle = async () => {
    await qc.invalidateQueries({ queryKey: ['project-stage-entries', orgId, projectId] });
    await qc.invalidateQueries({ queryKey: ['sales-pipeline', orgId] });
    await qc.invalidateQueries({ queryKey: ['won-deals', orgId] });
    await qc.invalidateQueries({ queryKey: ['lost-deals', orgId] });
    await qc.invalidateQueries({ queryKey: ['project', orgId, projectId] });
  };
  return {
    redate: useMutation({ mutationFn: (v: { entryId: string; enteredOn: string }) =>
      repositories.projectStage.redate(v.entryId, v.enteredOn), onSuccess: settle }),
    addSkipped: useMutation({ mutationFn: (v: { beforeEntryId: string; stage: ProjectStatus; enteredOn: string }) =>
      repositories.projectStage.addSkipped(v.beforeEntryId, v.stage, v.enteredOn), onSuccess: settle }),
  };
}
```
Verify GREEN: `npx vitest run src/lib/db/__tests__/projectStageEntries.test.ts && npm run typecheck`.

### Task 31 — failing Vitest: deal-page history (AC-PSH-013)
Create `pmo-portal/pages/project-detail/__tests__/StageHistory.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StageHistory from '../StageHistory';

const entries = [
  { id: 'e4', project_id: 'p1', stage: 'Quotation Submitted', entered_on: '2026-10-12', position: 4, source: 'transition',
    recorded_at: '2026-10-12T03:00:00Z', redated_at: '2026-10-20T03:00:00Z', recorder: { full_name: 'Pat Manager' } },
  { id: 'e3', project_id: 'p1', stage: 'Tender Submitted', entered_on: '2026-10-01', position: 3, source: 'transition',
    recorded_at: '2026-10-01T03:00:00Z', redated_at: null, recorder: { full_name: 'Pat Manager' } },
  { id: 'e2', project_id: 'p1', stage: 'Quotation Submitted', entered_on: '2026-09-10', position: 2, source: 'transition',
    recorded_at: '2026-09-10T03:00:00Z', redated_at: null, recorder: null },
  { id: 'e1', project_id: 'p1', stage: 'Leads', entered_on: '2026-08-01', position: 1, source: 'origination',
    recorded_at: '2026-08-01T03:00:00Z', redated_at: null, recorder: null },
] as const;

vi.mock('@/src/hooks/useProjectStageEntries', () => ({
  useProjectStageEntries: () => ({ data: entries, isLoading: false, error: null }),
  useStageEntryMutations: () => ({ redate: { mutateAsync: vi.fn() }, addSkipped: { mutateAsync: vi.fn() } }),
}));
const canEdit = vi.fn();
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => ({ can: canEdit }) }));

describe('StageHistory (#1638)', () => {
  it('AC-PSH-013: lists every entry newest-first, including the re-quote, with date and recorder', () => {
    canEdit.mockReturnValue(true);
    render(<StageHistory projectId="p1" />);
    const items = within(screen.getByRole('list', { name: /stage history/i })).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Quoted 12 Oct');
    expect(items[0]).toHaveTextContent('Date changed');
    expect(items[2]).toHaveTextContent('Quoted 10 Sep');
    expect(items[0]).toHaveTextContent('Pat Manager');
  });
  it('AC-PSH-013: an editor gets Change date and Add skipped stage', () => {
    canEdit.mockReturnValue(true);
    render(<StageHistory projectId="p1" />);
    expect(screen.getAllByRole('button', { name: /change date/i })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /add skipped stage/i }).length).toBeGreaterThan(0);
  });
  it('AC-PSH-013: a non-editor sees the same history read-only', () => {
    canEdit.mockReturnValue(false);
    render(<StageHistory projectId="p1" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /change date/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add skipped stage/i })).toBeNull();
  });
});
```
Read `pmo-portal/src/auth/usePermission.ts` first and shape the `usePermission` mock to its real return type.
Wrap renders in the repo's i18n test provider if the sibling tests in that folder do (copy their wrapper).
Verify RED: module `../StageHistory` not found.

### Task 32 — implement `StageDateDialog` + `StageHistory`
`pmo-portal/pages/project-detail/StageDateDialog.tsx` — a modal built on the shared `EntityFormModal` /
`TextField` primitives (same pattern as `MilestoneFormModal.tsx`):
```tsx
interface StageDateDialogProps {
  open: boolean;
  title: string;
  /** Pre-filled value ('YYYY-MM-DD'); today when not given. */
  initialDate?: string;
  /** Shown under the field when the value was proposed from a document (FR-PSH-019). */
  proposedFrom?: string | null;
  /** Inclusive bounds from the neighbouring entries; max defaults to today. */
  min?: string | null;
  max?: string | null;
  /** Only for "Add skipped stage": the pre-award stages the user may pick. */
  stageOptions?: readonly ProjectStatus[];
  onConfirm: (value: { enteredOn: string; stage?: ProjectStatus }) => Promise<void>;
  onClose: () => void;
}
```
Body: `<TextField type="date" label={t('projectDetail.stageHistory.date','Stage date')} min={min} max={max ?? today} …/>`,
optional `SelectField` for `stageOptions`, client check `min <= value <= max` with `FieldError`
(`t('projectDetail.stageHistory.outOfRange','Pick a date between {{min}} and {{max}}')`), server refusal shown via
`classifyMutationError`.
`pmo-portal/pages/project-detail/StageHistory.tsx`:
```tsx
export default function StageHistory({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: entries = [], isLoading, error } = useProjectStageEntries(projectId);
  const { redate, addSkipped } = useStageEntryMutations(projectId);
  const may = usePermission();
  const canEdit = may.can('transition', 'project');          // same set as the server's editor rank (plan D6)
  const today = useOrgToday();
  const [editing, setEditing] = useState<{ kind: 'redate' | 'add'; index: number } | null>(null);
  // entries are newest-first: neighbours of entries[i] are entries[i+1] (earlier) and entries[i-1] (later).
  const boundsFor = (i: number, kind: 'redate' | 'add') => kind === 'redate'
    ? { min: entries[i + 1]?.entered_on ?? null, max: entries[i - 1]?.entered_on ?? today }
    : { min: entries[i + 1]?.entered_on ?? null, max: entries[i].entered_on };
  if (isLoading) return <ListState state="loading" />;
  if (error) return <ListState state="error" />;
  return (
    <section aria-labelledby="stage-history-heading" className="space-y-2">
      <h2 id="stage-history-heading" className="text-sm font-semibold">{t('projectDetail.stageHistory.heading', 'Stage history')}</h2>
      <ol aria-label={t('projectDetail.stageHistory.listLabel', 'Stage history')} className="space-y-1">
        {entries.map((e, i) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{stageLabel(e.stage, t)} {formatDayMonth(new Date(`${e.entered_on}T00:00:00Z`))}</span>
            <span className="text-muted-foreground">{e.recorder?.full_name ?? t('projectDetail.stageHistory.system', 'System')} · {formatInstantDate(e.recorded_at)}</span>
            {e.redated_at && <Badge>{t('projectDetail.stageHistory.redated', 'Date changed')}</Badge>}
            {e.source === 'added' && <Badge>{t('projectDetail.stageHistory.added', 'Added later')}</Badge>}
            {canEdit && <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'redate', index: i })}>{t('projectDetail.stageHistory.changeDate', 'Change date')}</Button>}
            {canEdit && i < entries.length - 1 && <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'add', index: i })}>{t('projectDetail.stageHistory.addSkipped', 'Add skipped stage')}</Button>}
          </li>
        ))}
      </ol>
      {editing && (
        <StageDateDialog
          open
          title={editing.kind === 'redate' ? t('projectDetail.stageHistory.changeDate', 'Change date') : t('projectDetail.stageHistory.addSkipped', 'Add skipped stage')}
          initialDate={editing.kind === 'redate' ? entries[editing.index].entered_on : entries[editing.index].entered_on}
          {...boundsFor(editing.index, editing.kind)}
          stageOptions={editing.kind === 'add' ? PIPELINE_STATUSES as ProjectStatus[] : undefined}
          onConfirm={async ({ enteredOn, stage }) => {
            const entry = entries[editing.index];
            if (editing.kind === 'redate') await redate.mutateAsync({ entryId: entry.id, enteredOn });
            else await addSkipped.mutateAsync({ beforeEntryId: entry.id, stage: stage!, enteredOn });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
```
where `stageLabel(stage, t)` reads `STAGE_KEY_DATE_LABEL` from `components/salesPipeline.ts`. Add every
`projectDetail.stageHistory.*` key to `public/locales/en/*.json` and `public/locales/id/*.json` in the namespace the
`projectDetail.pipeline.*` keys already live in (find it with `grep -rl '"journeyHeading"' pmo-portal/public/locales`).
Verify GREEN: `npx vitest run pages/project-detail/__tests__/StageHistory.test.tsx && npm run check:guards`.

### Task 33 — mount the history
- `pmo-portal/pages/project-detail/PipelineLens.tsx`: render `<StageHistory projectId={project.id} />` directly
  below the `projectJourney` section (line ~310) inside the same column.
- `pmo-portal/pages/project-detail/ProjectDetail.tsx`: for on-hand projects (`pipelineGroup === 'onHand'`, line 92
  computes the group) render `<details className="mb-8"><summary>{t('projectDetail.stageHistory.salesHistory','Sales history')}</summary><StageHistory projectId={project.id} /></details>`
  next to line 191.
Add one assertion to the existing PipelineLens test file
(`grep -rl "PipelineLens" pmo-portal/pages/project-detail/__tests__`) that the "Stage history" heading renders.
Verify: `npx vitest run <that PipelineLens test file> pages/project-detail/__tests__/StageHistory.test.tsx`.

### Task 34 — failing Vitest: quotation proposes the Quoted date (AC-PSH-014)
Add to `pmo-portal/components/salesPipeline.test.ts`:
```ts
import { proposeStageDate } from './salesPipeline';
it('AC-PSH-014: moving to Quotation Submitted proposes the quotation issue date', () => {
  expect(proposeStageDate('Quotation Submitted', { quotationIssuedOn: '2026-10-10' }, '2026-11-01'))
    .toEqual({ date: '2026-10-10', source: 'quotation' });
});
it('AC-PSH-014: without a quotation, or for another stage, today is proposed', () => {
  expect(proposeStageDate('Quotation Submitted', {}, '2026-11-01')).toEqual({ date: '2026-11-01', source: 'today' });
  expect(proposeStageDate('Tender Submitted', { quotationIssuedOn: '2026-10-10' }, '2026-11-01'))
    .toEqual({ date: '2026-11-01', source: 'today' });
});
```
And in `StageHistory.test.tsx`-sibling `pmo-portal/pages/project-detail/__tests__/StageDateDialog.test.tsx`:
```tsx
it('AC-PSH-014: the dialog shows the proposed date and says where it came from', () => {
  render(<StageDateDialog open title="Move to Quoted" initialDate="2026-10-10" proposedFrom="quotation"
    onConfirm={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Stage date')).toHaveValue('2026-10-10');
  expect(screen.getByText(/proposed from the quotation/i)).toBeInTheDocument();
});
```
Verify RED: `npx vitest run components/salesPipeline.test.ts pages/project-detail/__tests__/StageDateDialog.test.tsx`.

### Task 35 — implement `proposeStageDate` + dialog hint
In `components/salesPipeline.ts`:
```ts
export interface StageDateSources { quotationIssuedOn?: string | null }
/** FR-PSH-019 seam: the document that proposes a stage's key date. Only Quoted has one today. */
export function proposeStageDate(
  to: string, sources: StageDateSources, todayIso: string,
): { date: string; source: 'quotation' | 'today' } {
  if (to === 'Quotation Submitted' && sources.quotationIssuedOn) {
    return { date: sources.quotationIssuedOn.slice(0, 10), source: 'quotation' };
  }
  return { date: todayIso, source: 'today' };
}
```
In `StageDateDialog`, when `proposedFrom === 'quotation'`, render under the field
`<p className="text-xs text-muted-foreground">{t('projectDetail.stageHistory.proposedQuotation','Proposed from the quotation document')}</p>`.
Verify GREEN: same command as Task 34.

### Task 36 — dated advance on the deal page
In `PipelineLens.tsx`:
- Replace both `onClick={() => void runTransition(nextStage)}` (lines 323 and 390) with
  `onClick={() => setAdvanceTo(nextStage)}` and add state `const [advanceTo, setAdvanceTo] = useState<string | null>(null);`.
- Render, when `advanceTo`, a `StageDateDialog` with `title={`${t('projectDetail.pipeline.advanceTo','Advance to')} ${NEXT_PIPELINE_LABEL[advanceTo] ?? advanceTo}`}`,
  `initialDate={proposeStageDate(advanceTo, {}, today).date}`, `min={latestEntry?.entered_on ?? null}`, `max={today}`
  where `latestEntry = useProjectStageEntries(project.id).data?.[0]`, and `onConfirm={({ enteredOn }) => runDatedTransition(advanceTo, enteredOn)}`.
- Add `runDatedTransition(to, enteredOn)` = `runTransition`'s body with the RPC line replaced by
  `await repositories.projectStage.advance(project.id, to as never, enteredOn);` plus
  `await queryClient.invalidateQueries({ queryKey: ['project-stage-entries', currentUser?.org_id, project.id] });`.
  Extract the shared invalidation + toast tail of `runTransition` (lines 196–215) into a local `afterMove(to, erpPending)`
  used by both, so nothing is duplicated.
- Won panel: set the contract-date input's `min={latestEntry?.entered_on}` (the server refuses earlier — plan §1.5).
- Loss / Decline confirms keep calling `runTransition` (dated today; correct afterwards in the history).
Update the existing PipelineLens advance test (same file as Task 33) so its journey clicks Advance, confirms the
dialog, and asserts `repositories.projectStage.advance` was called with today — the goal (deal moved) is unchanged;
only the deliberate new confirm step is added (BDD rule, `CLAUDE.md`).
Verify: `npx vitest run <PipelineLens test file> pages/project-detail/__tests__/StageDateDialog.test.tsx && npm run typecheck`.

### Task 37 — failing Vitest: import stage-date columns (AC-PSH-015)
In the existing projects-import descriptor test (`grep -rl makeProjectImportDescriptor pmo-portal/src --include=*.test.ts`):
```ts
it('AC-PSH-015: stage dates out of order are rejected at preview', () => {
  const d = makeProjectImportDescriptor([], []);
  expect(d.validateRow!({ name: 'X', status: 'Leads', quoted_on: '2026-07-01', pq_submitted_on: '2026-07-15' }))
    .toContain('Stage dates must not go backwards');
});
it('AC-PSH-015: a future stage date is rejected', () => {
  vi.useFakeTimers({ now: new Date('2026-11-01T05:00:00Z') });
  const d = makeProjectImportDescriptor([], []);
  expect(d.validateRow!({ name: 'X', status: 'Leads', quoted_on: '2026-11-03' })).toContain('cannot be in the future');
  vi.useRealTimers();
});
it('AC-PSH-015: an Internal Project row cannot carry stage dates', () => {
  const d = makeProjectImportDescriptor([], []);
  expect(d.validateRow!({ name: 'X', status: 'Internal Project', quoted_on: '2026-07-01' }))
    .toContain('Only a lead can carry stage dates');
});
it('AC-PSH-015: in-order past dates pass and are kept for the history call', () => {
  const d = makeProjectImportDescriptor([], []);
  expect(d.validateRow!({ name: 'X', status: 'Leads', pq_submitted_on: '2026-07-01', quoted_on: '2026-07-15' })).toBeNull();
});
```
Match `validateRow`'s real return shape (read `projectDescriptor.ts:107-121` — it returns `string | null` or an
array; adapt `toContain`/`toBeNull` to it, not the other way round).
Verify RED: `npx vitest run <that test file> -t AC-PSH-015`.

### Task 38 — implement the import columns
In `projectDescriptor.ts`:
```ts
/** #1638 FR-PSH-020: one optional date column per pre-award stage after Leads, in canonical order. */
const STAGE_DATE_COLUMNS = [
  { key: 'pq_submitted_on', label: 'PQ submitted date', stage: 'PQ Submitted' },
  { key: 'quoted_on', label: 'Quoted date', stage: 'Quotation Submitted' },
  { key: 'tender_sent_on', label: 'Tender sent date', stage: 'Tender Submitted' },
  { key: 'negotiation_on', label: 'Negotiation date', stage: 'Negotiation' },
] as const satisfies readonly { key: string; label: string; stage: ProjectStatus }[];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function stageDatesOf(cells: Record<string, string | undefined>): ImportStageDate[] {
  return STAGE_DATE_COLUMNS.flatMap((c) => {
    const v = cells[c.key]?.trim();
    return v ? [{ stage: c.stage, entered_on: v }] : [];
  });
}

function stageDatesError(cells: Record<string, string | undefined>, todayIso: string): string | null {
  const dated = stageDatesOf(cells);
  if (dated.length === 0) return null;
  if (cells.status?.trim() !== 'Leads') return 'Only a lead can carry stage dates.';
  if (dated.some((d) => !ISO_DATE.test(d.entered_on))) return 'Stage dates must be YYYY-MM-DD.';
  if (dated.some((d) => d.entered_on > todayIso)) return 'A stage date cannot be in the future.';
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].entered_on < dated[i - 1].entered_on) return 'Stage dates must not go backwards.';
  }
  return null;
}
```
- Add the four fields to `fields` (each `required: false, validate: () => null`) after `end_date`.
- In `validateRow`, return `stageDatesError(cells, todayIso())` before the existing tax checks, where `todayIso()` is
  the same org-local helper as Task 26 (`formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone)`).
- Change `create` to:
  ```ts
  create: async (input, cells) => {
    const row = await repositories.project.create(input);
    const dated = stageDatesOf(cells ?? {});
    if (dated.length > 0) await repositories.projectStage.importHistory(row.id, dated);
    return row;
  },
  ```
  If `ImportDescriptor.create` does not receive the raw cells (`pmo-portal/src/lib/import/types.ts`), carry
  `stage_dates` on the `toInput` result instead: widen the descriptor's input type to
  `CreateProjectInput & { stage_dates?: ImportStageDate[] }`, strip it before `repositories.project.create`, and pass
  it to `importHistory`. The leads date stays the row's creation (origination entry).
- Add the four columns to the template download the descriptor feeds (it is generated from `fields`; confirm by
  reading `pmo-portal/src/lib/import/index.ts`).
Verify GREEN: `npx vitest run <descriptor test file>`.

### Task 39 — e2e journey (AC-PSH-016)
Create `pmo-portal/e2e/AC-PSH-016-stage-dates.spec.ts`:
```ts
// @e2e-isolation: self-isolated — owns one fresh deal (service-role insert) and deletes it afterwards.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { signIn, requireServiceRoleKey, openPipelineCard } from './helpers';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-PSH-016: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

const ID = randomUUID();
const NAME = `PSH journey ${ID.slice(0, 8)}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };

test.beforeAll(async () => {
  const { error } = await admin.from('projects').insert({
    id: ID, org_id: ORG_ID, name: NAME, status: 'Leads', created_at: daysAgo(60).toISOString(),
  });
  if (error) throw new Error(`AC-PSH-016 seed failed: ${error.message}`);
  const { error: moveError } = await admin.from('projects').update({ status: 'PQ Submitted' }).eq('id', ID);
  if (moveError) throw new Error(`AC-PSH-016 seed move failed: ${moveError.message}`);
  await admin.from('project_stage_entries').update({ entered_on: iso(daysAgo(30)) })
    .eq('project_id', ID).eq('stage', 'PQ Submitted');
});
test.afterAll(async () => {
  await admin.from('record_changes').delete().eq('entity_id', ID);
  await admin.from('projects').delete().eq('id', ID);
});

test('AC-PSH-016: a PM moves a deal with a past date, sees it on the card, and corrects it on the deal page', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/sales');
  await openPipelineCard(page, NAME);

  await page.getByRole('button', { name: /advance to/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage date').fill(iso(daysAgo(10)));
  await dialog.getByRole('button', { name: /confirm|save|move/i }).click();

  const history = page.getByRole('list', { name: /stage history/i });
  await expect(history.getByRole('listitem').first()).toContainText('Quoted');

  await history.getByRole('listitem').first().getByRole('button', { name: /change date/i }).click();
  await page.getByRole('dialog').getByLabel('Stage date').fill(iso(daysAgo(12)));
  await page.getByRole('dialog').getByRole('button', { name: /confirm|save/i }).click();
  await expect(history.getByRole('listitem').first()).toContainText('Date changed');

  await page.goto('/sales');
  await expect(page.getByTestId(`stage-line-${ID}`)).toHaveText(/^Quoted \d{2} \w{3} · 12 d$/u);
});
```
Replace the two `name: /confirm|save|move/i` matchers with the exact confirm label Task 32 gives the dialog. If `openPipelineCard` opens a workspace tab rather than the
route, follow `AC-1441-won-pipeline.spec.ts`'s use of it.
Verify: `cd pmo-portal && ../scripts/e2e-local.sh AC-PSH-016` (and once `scripts/ci-e2e.sh <branch>` if the
Director asks — browser e2e otherwise runs on the PR to `main`).

### Task 40 — local final gate + UX proof
```bash
cd pmo-portal && npm run check:guards && npm run typecheck
npx eslint --max-warnings=0 components/salesPipeline.ts components/SalesKanbanBoard.tsx \
  src/hooks/useDashboard.ts src/lib/db/dashboard.ts src/lib/db/projectStageEntries.ts \
  src/lib/repositories/projectStages.ts src/lib/repositories/index.ts src/hooks/useProjectStageEntries.ts \
  src/hooks/useOrgToday.ts pages/project-detail/StageHistory.tsx pages/project-detail/StageDateDialog.tsx \
  pages/project-detail/PipelineLens.tsx pages/project-detail/ProjectDetail.tsx src/lib/import/projectDescriptor.ts \
  e2e/AC-PSH-016-stage-dates.spec.ts
npx vitest run components/salesPipeline.test.ts components/SalesKanbanBoard.test.tsx \
  components/SalesKanbanBoard.bahasa.test.tsx src/lib/db/__tests__/projectStageEntries.test.ts \
  pages/project-detail/__tests__/StageHistory.test.tsx pages/project-detail/__tests__/StageDateDialog.test.tsx \
  <PipelineLens test file> <descriptor test file>
../scripts/e2e-local.sh AC-PSH-016
../scripts/ux-proof.sh /sales
```
plus captures of a deal page (open, re-quoted, won, lost) for the Director's rendered review. Commit the FE half;
PR → `dev`.

## 4. Traceability

| AC | Owning test (layer) | Tasks | FR / NFR |
|---|---|---|---|
| AC-PSH-001 | `supabase/tests/pipeline_stage_history_write.test.sql` + invariant in `…_read.test.sql` (pgTAP) | 1, 3, 20 | FR-001, 002, 003 |
| AC-PSH-002 | `pipeline_stage_history_write.test.sql` (pgTAP) | 3, 4 | FR-004 |
| AC-PSH-003 | `pipeline_stage_history_write.test.sql` (pgTAP) | 5, 7 | FR-005, 008 |
| AC-PSH-004 | `pipeline_stage_history_write.test.sql` (pgTAP) | 6, 7 | FR-006, 008, 009 |
| AC-PSH-005 | `pipeline_stage_history_write.test.sql` (pgTAP) | 8, 9 | FR-007, 008 |
| AC-PSH-006 | `pipeline_stage_history_write.test.sql` (pgTAP) + mutation run | 2, 7, 10, 11, 20 | FR-010, 011, 018 · NFR-001, 003 |
| AC-PSH-007 | `pipeline_stage_history_write.test.sql` (pgTAP) | 7, 9, 12, 13 | FR-012 |
| AC-PSH-008 | `supabase/tests/pipeline_stage_history_read.test.sql` (pgTAP) | 14, 15 | FR-015 · NFR-004 |
| AC-PSH-009 | `supabase/tests/pipeline_stage_history_backfill.test.sql` (pgTAP) | 16, 17 | FR-022 |
| AC-PSH-010 | `pipeline_stage_history_backfill.test.sql` (pgTAP) | 18, 19 | FR-020 |
| AC-PSH-011 | `components/salesPipeline.test.ts`, `components/SalesKanbanBoard.test.tsx` (Vitest) | 23–26 | FR-013 · NFR-006 |
| AC-PSH-012 | `components/SalesKanbanBoard.test.tsx` (Vitest) | 27, 28 | FR-014 |
| AC-PSH-013 | `pages/project-detail/__tests__/StageHistory.test.tsx` (Vitest) | 29–33 | FR-016, 017 · NFR-007 |
| AC-PSH-014 | `components/salesPipeline.test.ts`, `pages/project-detail/__tests__/StageDateDialog.test.tsx` (Vitest) | 34–36 | FR-019 |
| AC-PSH-015 | projects-import descriptor test (Vitest) | 37, 38 | FR-021 |
| AC-PSH-016 | `pmo-portal/e2e/AC-PSH-016-stage-dates.spec.ts` (Playwright) | 39 | FR-005, 013, 016, 017 |
| NFR-PSH-002 | `0027_project_transition_authz` + `0028_project_transition_legality` stay green; `transition_project` absent from the diff | 7, 20 | — |
| NFR-PSH-005 | rollback dry-run | 21 | — |

## 5. Open questions for the Director

Carried from the spec with their defaults (OQ-PSH-1…8). None blocks Tasks 1–22; OQ-PSH-3 (Signed re-date moves
`contract_date`) is the one to confirm with the owner before the DB PR merges, because it widens who can change a
date that today only the win RPC writes.
