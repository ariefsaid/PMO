# Pipeline stage history — design + implementation plan

- **Issue:** #1638 · **Spec:** `docs/specs/pipeline-stage-history.spec.md` (FR/NFR/AC-PSH-###)
- **Ruling:** `docs/decisions.md` OD-GRILL-20261101 — "Pipeline dates (CRM-grade history)", "Reel differences (#1593)"
- **Migration number:** `0430` (Lane A holds 0430–0433 for #1638; this plan needs one file — 0431–0433 stay
  unused). `scripts/renumber-migration.sh` only if `npm run check:migrations` reports a collision. Files:
  `supabase/migrations/0448_pipeline_stage_history.sql`,
  `supabase/migrations/rollback/0448_pipeline_stage_history_down.sql`.
- **Executor routing (`docs/factory-workflow.md` § Executor routing):** the DB half adds a trigger that fires
  inside the win-SoD RPC `transition_project` and a new authority gate → **Director-dispatched per issue
  (money/SoD/auth tier)**, opus implementer for Tasks 1–22, on its own branch, shipped alone (not batched). The FE
  half (Tasks 23–40) is a bounded FE slice → Orca worker, sonnet `ui-implementer`, after the DB half merges to
  `dev` (it needs the regenerated types). Workers push branches only; the Director opens the PR.
- **Built on #1637 (board drag-and-drop, `docs/plans/2026-11-01-board-drag-drop.md`).** Branch the FE half from
  `dev` **after** #1637 has merged (or from `feat/board-dnd-1637` if it has not, rebasing before the PR). #1637
  adds `pages/sales-pipeline/DraggableSalesBoard.tsx`, `src/components/kanban/{BoardDnd.tsx,useOptimisticMoves.ts}`,
  `components/project-status/{projectTransitionCopy.ts,ProjectTransitionConfirm.tsx,WinDetailsFields.tsx}`, and an
  optional `drag` prop on `SalesKanbanBoard` that wraps each card in `DraggableCard`. This plan edits only the
  **card body** inside `DealCard` / `CompactDealCard` (Tasks 26, 28), so the two do not collide beyond a textual
  merge in `SalesKanbanBoard.tsx`; it adds no code to `DraggableSalesBoard` — a drop records its entry through
  the trigger, and the history refreshes through `invalidateProjectProjections` (Task 30), which #1637's
  `refreshBoard` and the status menu already call.
- **Review:** spec-reviewer + code-quality-reviewer + security-auditor (RLS, definer RPCs, the editor gate);
  design-reviewer Discover pass on `/sales` and the deal page (rich seed).

## 1. Design

### 1.1 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | New table `project_stage_entries` (one row per stage entry), not a view over `record_changes`. | `record_changes` holds recording time only and is append-only; the ruling needs a correctable business date (spec T6/T7). |
| D2 | Entries are appended by an **AFTER INSERT OR UPDATE OF status trigger on `projects`**, not by editing `transition_project`. | NFR-PSH-002: the 0236 body (win SoD) stays byte-identical. Every path that changes status — the RPC, the status menu, drag-and-drop (#1637), seed, the historical importer — records an entry with no extra code. The trigger has **no off switch** (no session flag): the import RPC writes through it too (Task 19). |
| D3 | Journey order is an explicit `position numeric` (append = max+1; add-skipped = midpoint between neighbours). Dates are validated *along* the journey, never used to order it. | A re-quote returns to an earlier stage; adding a skipped stage must land between two entries without renumbering. |
| D4 | The ordering rule ("never dated before the previous one") is a **constraint trigger** on the table (`23514`), `deferrable initially immediate`. | One enforcement point for the trigger, all RPCs and the backfill; the backfill defers it for its clamp step. |
| D5 | **No dated-move RPC and no date dialog on "Advance to".** A move is dated the org's today; backdating is "Change date" on the new entry, one click away on the same page. | The shipped write policy keeps a routine advance single-click with no confirm (AC-IXD-WP-004, `PipelineLens.writePolicy.test.tsx:97`); a dialog on every advance would break it and every sibling suite that clicks Advance. The ruling ("may backdate") is met by the re-date RPC. |
| D5a | **Win dated before earlier entries (spec FR-PSH-004a, OQ-PSH-9):** before appending the Signed entry, the trigger moves back every earlier *system-dated* entry (`redated_at is null and source in (origination, transition, backfill)`) that is later than the contract date, and marks it `redated_at`; if a *person-dated* entry is later, it raises `23514`. One helper `stage_entries_pull_back(project, date)`, also used when `contract_date` changes without a move. | ~30 shipped pgTAP wins, the AC-1011 e2e and client onboarding win with a contract date before the day the deal was entered (spec T17); refusing them would break the money path. A date a person chose is never moved silently. |
| D6 | Stage-date editor = `role_rank(auth_role()) >= 20` + active member + same org, in one helper `assert_stage_date_editor(org)`. FE projects it with the existing `can('transition','project')` (same set today, `policy.ts:223`). | Spec OQ-PSH-2. Rank is the one server definition (`0178…sql:638`). |
| D7 | Key-date sync lives in one internal function `stage_entry_set_date(entry, date)`: Signed → `contract_date` + `decided_at`; current Lost/Declined → `decided_at`. It locks the **project row first** (the same lock order as `transition_project`), then the entry. | FR-PSH-009; Signed and contract date can never diverge. The project lock serialises every journey write, so two concurrent re-dates of neighbouring entries cannot each pass the ordering check against the other's old date, and the lock order matches the trigger path (no deadlock). |
| D8 | `get_sales_pipeline()` / `get_win_rate()` read `stage_started_at` from the latest entry's `entered_on` (fallback `created_at`); bodies otherwise 0385 verbatim. Open cards get stage + date from that field (latest entry's stage = current status, invariant). Won/lost cards use `contract_date` / `decided_at` already on the project row. | NFR-PSH-004 — no per-card request; one definition of stage age (FR-PSH-015). |
| D9 | Audit = register the table in `record_history_config` (parent `project`) + a `record_history_visible` arm + `log_audit` in each correction RPC; the FE history registry learns the new entity (Task 30a). | FR-PSH-012 using the shipped patterns (`0281…sql:216-251`, `0076…sql:80`). The catalog gate `record_changes_catalog_gate.test.sql` fails without the visibility arm. |

Invariant (asserted by pgTAP in Task 20): for every project, the entry with the greatest `position` has
`stage = projects.status`. It holds because every status change appends and add-skipped only inserts *before*
an existing entry.

### 1.2 Data model

```
project_stage_entries
  id uuid pk · org_id uuid (from project) · project_id uuid → projects(id) on delete cascade
  stage project_status · entered_on date · position numeric · unique(project_id, position)
  source text ∈ {origination, transition, added, import, backfill}
  recorded_by uuid → profiles(id) on delete set null · recorded_at timestamptz default now()
  redated_at timestamptz null   -- set when entered_on is changed after the fact (drives "Date changed")
index (project_id, position desc)
RLS: FORCE; one SELECT policy (own org ∧ active member ∧ project visible); no client INSERT/UPDATE/DELETE grant
```

### 1.3 Server API (all `security definer`, `set search_path = public`)

| Function | Caller | Gate | Writes |
|---|---|---|---|
| `project_stage_entry_append()` | trigger on `projects` | — | appends one entry |
| `redate_stage_entry(p_entry_id, p_entered_on)` | authenticated | `assert_stage_date_editor` | entry date (+ key-date sync) + audit |
| `add_skipped_stage_entry(p_before_entry_id, p_stage, p_entered_on)` | authenticated | `assert_stage_date_editor` | new entry + audit |
| `import_project_stage_history(p_project_id, p_entries jsonb)` | authenticated (import) | `assert_stage_date_editor` | entries + status + audit |
| `backfill_project_stage_entries(p_project_id)` | migration / tests only | revoked from clients | entries |
| `stage_org_date(org, ts)` · `assert_stage_date_editor(org)` · `stage_entry_set_date(entry, date)` · `stage_entries_pull_back(project, date)` | internal | revoked from `public, anon, authenticated, service_role` | — |

Client-callable definers: **three** (`redate_stage_entry`, `add_skipped_stage_entry`, `import_project_stage_history`)
— each joins the 0178 retained-writer allow-list (Task 20).

### 1.4 FE

- `pmo-portal/components/salesPipeline.ts` — `STAGE_KEY_DATE_LABEL`, `daysBetweenDates`, `stageLine`.
- `pmo-portal/components/SalesKanbanBoard.tsx` — `DealStageLine` in both cards; `SignedPill` for on-hand.
- `pmo-portal/src/hooks/useDashboard.ts` — `toPipelineProject` carries `contract_date`, `decided_at`.
- `pmo-portal/src/lib/db/projectStageEntries.ts` (DAL) + `pmo-portal/src/lib/repositories/projectStages.ts`
  (registered as `repositories.projectStage`) + `pmo-portal/src/hooks/useProjectStageEntries.ts`.
- `pmo-portal/src/hooks/useOrgToday.ts` — today as `YYYY-MM-DD` in the active timezone.
- `pmo-portal/src/hooks/projectQueryKeys.ts` — `'project-stage-entries'` joins `invalidateProjectProjections`, so
  every move path (deal page, status menu, #1637 drop) refreshes the history with no per-path code.
- `pmo-portal/src/components/history/{historyFields.ts,historyLabels.ts}` — the record-history registry learns
  `project_stage_entry` and the two audit actions (Task 30a).
- `pmo-portal/pages/project-detail/StageHistory.tsx` (list + edit affordances) and
  `pmo-portal/pages/project-detail/StageDateDialog.tsx` (date picker bounded by neighbours/today; nothing is
  written until the user presses "Save date"). Mounted in `PipelineLens.tsx` and, for on-hand projects,
  `ProjectDetail.tsx`. "Advance to" stays single-click (D5).
- `pmo-portal/src/lib/import/projectDescriptor.ts` — five optional stage-date columns (Lead date included) +
  post-create history call.

### 1.5 Scaling / risk notes

- Entry volume ≈ stage moves (single digits per deal); the `(project_id, position desc)` index serves both the
  lateral "latest entry" read and the history list. No hot path scans the table.
- Re-dating Signed moves `contract_date` (spec OQ-PSH-3); ERP documents already dispatched keep the old date.
- A win whose contract date is earlier than earlier entries moves the system-dated ones back (D5a); it is refused
  (`23514`) only when a person dated a later entry. The win forms (`PipelineLens` Won panel, #1637's
  `WinDetailsFields`) need no `min` — the refusal is rare and shows the server message via the existing error path.
- Drag-and-drop (#1637) records entries dated today via the trigger; correcting afterwards is the history's job.
- Seeded deals get one origination entry each, dated the seed run (seed inserts at the final status). The
  Discover pass re-dates a few on the rendered app to see non-trivial lines; no seed change in this issue.

## 2. Gates (every builder, before pushing — `CLAUDE.md` local final gate)

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
  supabase/tests/0029_project_win_path.test.sql \
  supabase/tests/0031_project_decided_at_preserved.test.sql \
  supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql \
  supabase/tests/client_starting_data_sequence.test.sql \
  supabase/tests/0236_project_declined_outcome.test.sql \
  supabase/tests/0057_sales_pipeline_attention.test.sql \
  supabase/tests/0261_pipeline_hides_archived.test.sql \
  supabase/tests/0385_dashboard_open_bids.test.sql \
  supabase/tests/0208_sales_pipeline_tax_treatment.test.sql \
  supabase/tests/record_changes_catalog_gate.test.sql \
  supabase/tests/record_history_read.test.sql \
  supabase/tests/0281_vendor_withholding_slips_rollback.test.sql \
  supabase/tests/0178_anon_executable_definers.test.sql \
  supabase/tests/0137_service_role_grants.test.sql \
  supabase/tests/0203_rls_active_member_composition.test.sql'
cd pmo-portal && ../scripts/e2e-local.sh AC-PSH-016 && ../scripts/e2e-local.sh AC-1011 && ../scripts/ux-proof.sh /sales
```

The 0029 / 0031 / 0170 / client-starting-data / 0236 files and the AC-1011 e2e are the **win-path regression
proof** (they win with past contract dates on deals created today — spec T17, D5a); they must stay green
unchanged. The 0385 / catalog-gate / 0281-rollback / 0178 files change on purpose (Tasks 13, 15, 20) and are
named here so their edits are run, not assumed. `0136_posture_b_side_mirror_droppable` inventories only
`*_erp_mirror` tables, so `project_stage_entries` does not enter it (no edit). i18n: every new key lands in both
`en` and `id` (`npm run check:i18n`, part of `check:guards`).

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
-- pipeline_stage_history_write.test.sql — #1638 stage entries: append, key dates, win pull-back, re-date,
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
Tasks 4, 5, 6, 8, 10 and 12 append more assertions; each raises the `plan(2)` above by the number it adds, and Task 12
adds the closing `select * from finish(); rollback;` (until then end the file with those two lines yourself).
Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/pipeline_stage_history_write.test.sql`
→ fails with `relation "project_stage_entries" does not exist`.

### Task 2 — migration §1: table, RLS, grants, date helper
Create `supabase/migrations/0448_pipeline_stage_history.sql`:
```sql
-- 0448_pipeline_stage_history.sql — #1638 CRM-grade pipeline stage history.
-- Spec: docs/specs/pipeline-stage-history.spec.md · Plan: docs/plans/2026-11-01-pipeline-stage-history.md
-- §1 table + RLS + grants · §2 ordering constraint + append trigger · §3 correction RPCs · §4 import RPC
-- §5 audit registration · §6 stage age reads (0385 bodies, lateral swapped) · §7 backfill · §8 self-assertion
-- transition_project (0236) is NOT modified (NFR-PSH-002).
-- Reversibility: rollback/0448_pipeline_stage_history_down.sql.

-- §1 ─────────────────────────────────────────────────────────────────────────────────────────────
create table public.project_stage_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  stage       project_status not null,
  entered_on  date not null,
  position    numeric not null,
  source      text not null check (source in ('origination','transition','added','import','backfill')),
  recorded_by uuid references public.profiles(id) on delete set null,
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
         and public.is_active_member()
         and exists (select 1 from public.projects p where p.id = project_stage_entries.project_id));
revoke all on table public.project_stage_entries from public, anon, authenticated;
grant select on table public.project_stage_entries to authenticated;
-- 0137_service_role_grants: every public base table keeps service_role DML (e2e fixtures use it).
grant select, insert, update, delete on table public.project_stage_entries to service_role;

-- A timestamp's calendar day in the org's timezone (mirrors native_org_today, 0275:113).
create or replace function public.stage_org_date(p_org uuid, p_at timestamptz) returns date
  language sql stable set search_path = public as $$
  select (p_at at time zone coalesce(
            (select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date
$$;
revoke all on function public.stage_org_date(uuid, timestamptz) from public, anon, authenticated;
```
(`stage_org_date` is revoked from `authenticated`: pgTAP assertions that call it must run after `reset role;`.)
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

-- Spec FR-PSH-004a / plan D5a: before a key date (contract date, decision date) lands on an entry, move back
-- every EARLIER entry dated after it that the system dated; refuse if a person dated one of them.
create or replace function public.stage_entries_pull_back(p_project_id uuid, p_before numeric, p_on date)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.project_stage_entries e
              where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on
                and (e.redated_at is not null or e.source in ('added','import'))) then   -- mut:pullback_person
    raise exception 'an earlier stage date set by a person is after %; change that stage date first', p_on
      using errcode = '23514';
  end if;
  update public.project_stage_entries e set entered_on = p_on, redated_at = now()
   where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on;
end; $$;
revoke all on function public.stage_entries_pull_back(uuid, numeric, date) from public, anon, authenticated, service_role;

create or replace function public.project_stage_entry_append() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_on  date;
  v_pos numeric;
  v_key public.project_stage_entries;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    -- Key dates changed without a move (seed.sql sets contract_date/decided_at AFTER inserting a won/lost
    -- row; seed.sql:310-314; stage_entry_set_date §3). Keep Signed = contract_date and the current
    -- Lost/Declined entry = decided_at.
    if new.contract_date is distinct from old.contract_date and new.contract_date is not null then
      select * into v_key from public.project_stage_entries
       where project_id = new.id and stage = 'Won, Pending KoM' order by position desc limit 1;
      if v_key.id is not null and v_key.entered_on is distinct from new.contract_date then
        perform public.stage_entries_pull_back(new.id, v_key.position, new.contract_date);
        update public.project_stage_entries set entered_on = new.contract_date where id = v_key.id;
      end if;
    end if;
    if new.decided_at is distinct from old.decided_at and new.decided_at is not null
       and new.status in ('Loss Tender','Declined') then
      select * into v_key from public.project_stage_entries
       where project_id = new.id order by position desc limit 1;
      v_on := public.stage_org_date(new.org_id, new.decided_at);
      if v_key.stage = new.status and v_key.entered_on is distinct from v_on then
        perform public.stage_entries_pull_back(new.id, v_key.position, v_on);
        update public.project_stage_entries set entered_on = v_on where id = v_key.id;
      end if;
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
  -- A win's contract date (or a decision date) can precede entries the system dated today (spec T17).
  perform public.stage_entries_pull_back(new.id, v_pos, v_on);
  insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
  values (new.org_id, new.id, new.status, v_on, v_pos,
          case when tg_op = 'INSERT' then 'origination' else 'transition' end, auth.uid());
  return null;
end; $$;
revoke all on function public.project_stage_entry_append() from public, anon, authenticated;
-- Created BEFORE the §7 backfill: CREATE TRIGGER locks projects against writes until commit, so no
-- project can appear between the backfill snapshot and the trigger. AFTER triggers fire in name order, so
-- `projects_zy_…` runs before the project's own `projects_zz_record_change`.
create trigger projects_zy_stage_entry
  after insert or update of status, contract_date, decided_at on public.projects
  for each row execute function public.project_stage_entry_append();
```
Verify GREEN (2 of 2): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`.

### Task 4 — failing pgTAP: key dates for Signed and Lost + the win pull-back (AC-PSH-002)
Append to the write test (`plan` +5). Projects are seeded as postgres, moved as the Executive; every
`stage_org_date` call runs after `reset role;` (it is revoked from `authenticated`, Task 2):
```sql
reset role;
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000012','16380000-0000-0000-0000-000000000001','PSH-3','PSH win','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000013','16380000-0000-0000-0000-000000000001','PSH-4','PSH lose','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000015','16380000-0000-0000-0000-000000000001','PSH-6','PSH late win','Leads','16380000-0000-0000-0000-0000000000a2'),
  ('16380000-0000-0000-0000-000000000016','16380000-0000-0000-0000-000000000001','PSH-7','PSH person-dated','Leads','16380000-0000-0000-0000-0000000000a2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000012','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000012','Quotation Submitted');
-- contract_value is 0 → the win SoD has nothing to ratify (0236 clause (i)).
select transition_project('16380000-0000-0000-0000-000000000012','Won, Pending KoM','PO-PSH-1', current_date);
select transition_project('16380000-0000-0000-0000-000000000013','Loss Tender');
-- Deal recorded after it was signed (spec T17): every earlier entry is dated today, the contract 10 days ago.
select transition_project('16380000-0000-0000-0000-000000000015','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000015','Quotation Submitted');
select transition_project('16380000-0000-0000-0000-000000000015','Won, Pending KoM','PO-PSH-2', current_date - 10);
select transition_project('16380000-0000-0000-0000-000000000016','PQ Submitted');
select transition_project('16380000-0000-0000-0000-000000000016','Quotation Submitted');
reset role;
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
    order by position desc limit 1), current_date,
  'AC-PSH-002: the Signed entry is dated with the contract date');
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000013'
    order by position desc limit 1),
  (select stage_org_date(org_id, decided_at) from projects where id = '16380000-0000-0000-0000-000000000013'),
  'AC-PSH-002: the Lost entry is dated with decided_at in the org timezone');
select results_eq(
  $$ select stage::text, entered_on, redated_at is not null from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000015' order by position $$,
  $$ values ('Leads', current_date - 10, true), ('PQ Submitted', current_date - 10, true),
            ('Quotation Submitted', current_date - 10, true), ('Won, Pending KoM', current_date - 10, false) $$,
  'AC-PSH-002: a win dated before system-dated entries moves them back to the contract date, marked');
-- A person dated the Quoted entry 2 days ago (as stage_entry_set_date would); a win dated before it is refused.
update project_stage_entries set entered_on = current_date - 2, redated_at = now()
 where project_id = '16380000-0000-0000-0000-000000000016' and stage = 'Quotation Submitted';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('16380000-0000-0000-0000-000000000016','Won, Pending KoM','PO-PSH-3', current_date - 5) $$,
  '23514', null, 'AC-PSH-002: a win dated before a stage date a person set is refused');
reset role;
update projects set contract_date = current_date - 1 where id = '16380000-0000-0000-0000-000000000012';
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000012'
     and stage = 'Won, Pending KoM'), current_date - 1,
  'AC-PSH-002: the Signed entry follows contract_date on any path (seed / server-side update)');
update projects set contract_date = current_date where id = '16380000-0000-0000-0000-000000000012';
set local role authenticated;
```
Verify: all five pass (Task 3 implements them) — this task pins the behaviour; if one is red, fix
`project_stage_entry_append` / `stage_entries_pull_back`, not the test. Mutation `mut:pullback_person` (Task 11)
must turn the refusal assertion red.

### Task 5 — failing pgTAP: a move is dated today; re-dates are bounded by both neighbours (AC-PSH-003)
Append (PM A, project `…011`, created 60 days ago; `plan` +4):
```sql
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_project('16380000-0000-0000-0000-000000000011','PQ Submitted');
reset role;
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000011'
    order by position desc limit 1),
  native_org_today('16380000-0000-0000-0000-000000000001'),
  'AC-PSH-003: a move is dated the org''s today');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select redate_stage_entry((select id from project_stage_entries
  where project_id = '16380000-0000-0000-0000-000000000011' and stage = 'PQ Submitted'), current_date - 20);
select is(
  (select entered_on from project_stage_entries where project_id = '16380000-0000-0000-0000-000000000011'
     and stage = 'PQ Submitted'), current_date - 20,
  'AC-PSH-003: an editor backdates the new entry');
select throws_ok(
  $$ select redate_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000011' and stage = 'Leads'), current_date - 10) $$,
  '23514', null, 'AC-PSH-003: an entry cannot be dated after the entry that follows it');
select throws_ok(
  $$ select redate_stage_entry((select id from project_stage_entries
       where project_id = '16380000-0000-0000-0000-000000000011' and stage = 'PQ Submitted'), current_date + 2) $$,
  '23514', null, 'AC-PSH-003: a future stage date is refused');
```
Verify RED: `function redate_stage_entry(uuid, date) does not exist` (and the first assertion green).

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

### Task 7 — migration §3a: editor gate, set-date core, `redate_stage_entry`
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
revoke all on function public.assert_stage_date_editor(uuid) from public, anon, authenticated, service_role;

-- The one place an entry's date changes; syncs the project's key dates (FR-PSH-009). No gate: callers gate.
create or replace function public.stage_entry_set_date(p_entry_id uuid, p_entered_on date)
  returns public.project_stage_entries
  language plpgsql security definer set search_path = public as $$
declare
  e       public.project_stage_entries;
  v_last  boolean;
  v_status project_status;
  v_project uuid;
begin
  -- Lock order = transition_project's: the project row first, then the entry. The project lock serialises
  -- every journey write, so the ordering check below never runs against a neighbour another transaction
  -- is changing (plan D7).
  select project_id into v_project from public.project_stage_entries where id = p_entry_id;
  if v_project is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  select status into v_status from public.projects where id = v_project for update;
  select * into e from public.project_stage_entries where id = p_entry_id for update;
  if p_entered_on is null or p_entered_on > public.native_org_today(e.org_id) then      -- mut:future
    raise exception 'a stage date cannot be in the future' using errcode = '23514';
  end if;
  update public.project_stage_entries
     set entered_on = p_entered_on, redated_at = now()
   where id = e.id;                                   -- project_stage_entries_order checks the neighbours
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
revoke all on function public.stage_entry_set_date(uuid, date) from public, anon, authenticated, service_role;

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
```
(No dated-move RPC — plan D5. The re-date of a Signed entry writes `contract_date`, which fires the §2 trigger's
key-date branch; that branch sees the entry already at the new date and does nothing.)
Verify GREEN: Tasks 4–6 assertions pass —
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`.

### Task 8 — failing pgTAP: add a skipped stage (AC-PSH-005)
Append (as postgres, a fresh project with a Leads → Tender journey):
```sql
reset role;
insert into projects (id, org_id, code, name, status, project_manager_id, created_at) values
  ('16380000-0000-0000-0000-000000000014','16380000-0000-0000-0000-000000000001','PSH-5','PSH skip','Leads',
   '16380000-0000-0000-0000-0000000000a2', now() - interval '90 days');
-- Simulate a skipped stage: jump the status as postgres (the trigger appends Tender at position 2, dated
-- today), then date that entry 40 days ago as a backfilled one.
update projects set status = 'Tender Submitted' where id = '16380000-0000-0000-0000-000000000014';
update project_stage_entries set entered_on = current_date - 40, source = 'backfill'
 where project_id = '16380000-0000-0000-0000-000000000014' and stage = 'Tender Submitted';
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
line), `mut:editor_org` (delete the line), `mut:order` (replace `s.entered_on < s.prev_on` with `false`),
`mut:future` (replace `p_entered_on > public.native_org_today(e.org_id)` with `false`),
`mut:pullback_person` (replace the whole `(e.redated_at is not null or …)` conjunct with `false`) —
edit the migration, run
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql'`,
confirm at least one AC-PSH-002/003/004/005/006 assertion goes **red**, then `git checkout -- supabase/migrations/0448_pipeline_stage_history.sql`.
Record the six red outputs in the branch hand-off (the Director copies them into the PR body).

### Task 12 — failing pgTAP: audit (AC-PSH-007)
Append (replacing the temporary `finish`/`rollback` lines):
```sql
reset role;
select ok(exists (select 1 from record_changes where entity_type = 'project_stage_entry'
   and parent_type = 'project' and parent_id = '16380000-0000-0000-0000-000000000012'
   and op = 'update' and changes -> 'entered_on' ->> 'new' = (current_date - 5)::text
   and actor_id = '16380000-0000-0000-0000-0000000000a3'),
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
Confirm `select plan(…)` at the top equals the number of assertions in the file: 2 (Task 1) + 5 (Task 4) +
4 (Task 5) + 4 (Task 6) + 4 (Task 8) + 7 (Task 10) + 4 (this task) = **30**.
Verify RED: the two `record_changes` assertions fail (table not registered).

### Task 13 — migration §5: register history capture + visibility arm; update the two catalog counts
```sql
-- §5 ─────────────────────────────────────────────────────────────────────────────────────────────
insert into public.record_history_config(entity_type,table_name,parent_type,parent_col,parent_via,captured,flag_cols,omit_cols) values
('project_stage_entry','project_stage_entries','project','project_id',null,
 '{"project_id":"ref","stage":"enum","entered_on":"date","source":"text","redated_at":"timestamp"}',
 '{}','{id,org_id,position,recorded_by,recorded_at}');
create trigger project_stage_entries_zz_record_change
  after insert or update on public.project_stage_entries
  for each row execute function public.record_change_capture();

-- The catalog gate (record_changes_catalog_gate.test.sql, AC-CHG-011) requires a visibility arm for every
-- registered entity. 0281's body verbatim plus one arm.
create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
begin
 case p_entity_type
  when 'project' then return exists(select 1 from public.projects where id=p_entity_id);
  when 'budget_version' then return exists(select 1 from public.budget_versions where id=p_entity_id);
  when 'budget_line_item' then return exists(select 1 from public.budget_line_items where id=p_entity_id);
  when 'work_order' then return exists(select 1 from public.work_orders where id=p_entity_id);
  when 'procurement' then return exists(select 1 from public.procurements where id=p_entity_id);
  when 'purchase_request' then return exists(select 1 from public.purchase_requests where id=p_entity_id);
  when 'rfq' then return exists(select 1 from public.rfqs where id=p_entity_id);
  when 'purchase_order' then return exists(select 1 from public.purchase_orders where id=p_entity_id);
  when 'payment' then return exists(select 1 from public.payments where id=p_entity_id);
  when 'task' then return exists(select 1 from public.tasks where id=p_entity_id);
  when 'company' then return exists(select 1 from public.companies where id=p_entity_id);
  when 'contact' then return exists(select 1 from public.contacts where id=p_entity_id);
  when 'sales_invoice' then return exists(select 1 from public.sales_invoices where id=p_entity_id);
  when 'procurement_invoice' then return exists(select 1 from public.procurement_invoices where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  when 'project_stage_entry' then return exists(select 1 from public.project_stage_entries where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
```
The sixteen arms above are `0281_vendor_withholding_slips.sql:231-246` verbatim. First confirm 0281 is still the
latest definition: `grep -l "function public.record_history_visible" supabase/migrations/*.sql | sort | tail -1`
must print 0281 (true at dev `b52aa48a1`); if a later file redefines it, copy that body instead.

Every column of the table is classified exactly once (captured 5 + omit 5 = the table's 10 columns) and every
captured kind is a known kind — the gate's other checks.

Two existing tests pin the registry size and change **because the registry grows by one** (not weakened):
- `supabase/tests/record_changes_catalog_gate.test.sql:77` — `16` → `17`, and the description
  `'AC-CHG-011 16 registered record types including …'` → `'AC-CHG-011 17 registered record types including PMO and ERP invoice mirrors, the two vendor-withholding-slip tables and pipeline stage entries'`.
- `supabase/tests/0281_vendor_withholding_slips_rollback.test.sql:81` — its inline 0281 rollback deletes two
  rows from the registry: `count(*)=14` → `count(*)=15` (the prior catalog now includes `project_stage_entry`).

Place §5 **after** §7 (backfill) in the file so the backfill does not flood `record_changes`; order the
sections in the file as §1 §2 §3 §4 §6 §7 §5 §8 and keep the header list as written.
Verify GREEN: whole write file plus the two edited gates —
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_write.test.sql supabase/tests/record_changes_catalog_gate.test.sql supabase/tests/0281_vendor_withholding_slips_rollback.test.sql supabase/tests/record_history_read.test.sql'`.

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
(`stale_count` is a top-level key of `get_win_rate`'s JSON, `0385…sql:118`; `get_sales_pipeline` returns
`{ …, 'projects': [ … ] }`, `0385…sql:199`.)
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
and leave `coalesce(stage_change.changed_at, p.created_at) as stage_started_at` unchanged (the fallback now
fires only for a row with no entry, which §8 asserts never exists). Re-issue 0385's grant lines
(`revoke all on function public.get_sales_pipeline() from public, anon;` /
`grant execute on function public.get_sales_pipeline() to authenticated;` — `create or replace` keeps
`get_win_rate`'s existing grants), end §6 with `notify pgrst, 'reload schema';`, and set the two comments to:
```sql
comment on function public.get_win_rate(date, date) is
  'Decided bids use decided_at; open bids use created_at for period conversion and the latest project_stage_entries.entered_on (#1638) for staleness. Security invoker reads remain RLS scoped.';
comment on function public.get_sales_pipeline() is
  'Open project rows include stage_started_at = the latest project_stage_entries.entered_on (#1638) at UTC midnight, falling back to created_at. Security invoker reads remain RLS scoped.';
```
`supabase/tests/0385_dashboard_open_bids.test.sql` (AC-1441) fakes stage age with synthetic `record_changes` rows,
which no longer drive it. Its goal-oracles (stale count = 2; a row's stage age is its last stage change; a row
with no change starts at creation) stay; only the **witness source** moves to the stage entries (spec FR-PSH-015):
- Replace its `insert into record_changes (…) values (… 104 …), (… 105 …);` block (lines 45-52) with
  ```sql
  update project_stage_entries set entered_on = current_date - 95
   where project_id = '38500000-0000-0000-0000-000000000104';
  update project_stage_entries set entered_on = current_date - 20
   where project_id = '38500000-0000-0000-0000-000000000105';
  ```
  and its comment with `-- Stage-age witnesses: each row's origination entry (#1638), re-dated as postgres.`
- The `'AC-1441: pipeline row uses the last recorded status change'` assertion's expected value becomes
  `((current_date - 95)::timestamp at time zone 'UTC')`, description `'AC-1441: pipeline row uses its latest stage entry date'`.
- The `'AC-1441: pipeline row without a status event falls back to project creation'` assertion's expected value
  becomes `((select stage_org_date(org_id, created_at) from projects where id = '38500000-0000-0000-0000-000000000106')::timestamp at time zone 'UTC')`,
  description `'AC-1441: a row never moved starts its stage on its creation day'`. `stage_org_date` is revoked from
  `authenticated`, so compute the expected value as postgres first:
  `reset role; create temp table psh_expected on commit drop as select stage_org_date(org_id, created_at) as d from projects where id = '38500000-0000-0000-0000-000000000106'; grant select on psh_expected to authenticated;`
  then re-set the role/claims and use `((select d from psh_expected)::timestamp at time zone 'UTC')`.
Verify GREEN:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_read.test.sql supabase/tests/0385_dashboard_open_bids.test.sql supabase/tests/0208_sales_pipeline_tax_treatment.test.sql supabase/tests/0057_sales_pipeline_attention.test.sql supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/0044_sales_pipeline_stages.test.sql'`.

### Task 16 — failing pgTAP: backfill (AC-PSH-009)
Create `supabase/tests/pipeline_stage_history_backfill.test.sql` (as postgres throughout — server-side inserts
are exempt from the origination guard, `0175_update_path_sod_class.sql:219-222`, which `seed.sql` relies on):
```sql
-- pipeline_stage_history_backfill.test.sql — #1638 AC-PSH-009 (backfill) + AC-PSH-010 (import RPC).
begin;
select plan(11);
insert into organizations (id, name) values ('16380000-0000-0000-0000-000000000004','PSH Backfill Org');
insert into projects (id, org_id, code, name, status, created_at, contract_date) values
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000004','PSH-BF1','PSH backfill',
   'Won, Pending KoM', now() - interval '120 days', current_date - 70),
  ('16380000-0000-0000-0000-000000000042','16380000-0000-0000-0000-000000000004','PSH-BF2','PSH clamp',
   'Won, Pending KoM', now() - interval '120 days', current_date - 100);
insert into projects (id, org_id, code, name, status, created_at, last_update) values
  ('16380000-0000-0000-0000-000000000043','16380000-0000-0000-0000-000000000004','PSH-BF3','PSH gap',
   'Negotiation', now() - interval '120 days', now() - interval '30 days');
-- Simulate pre-migration projects: no entries, recorded status changes only.
delete from project_stage_entries where project_id in
  ('16380000-0000-0000-0000-000000000040','16380000-0000-0000-0000-000000000042',
   '16380000-0000-0000-0000-000000000043');
insert into record_changes (org_id, entity_type, entity_id, op, changes, created_at) values
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000040','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days'),
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000042','update',
   '{"status":{"old":"Quotation Submitted","new":"Won, Pending KoM"}}', now() - interval '60 days'),
  -- 043's later move to Negotiation was never recorded.
  ('16380000-0000-0000-0000-000000000004','project','16380000-0000-0000-0000-000000000043','update',
   '{"status":{"old":"Leads","new":"Quotation Submitted"}}', now() - interval '90 days');
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
select is(backfill_project_stage_entries('16380000-0000-0000-0000-000000000043'), 1, 'AC-PSH-009: gap fixture backfilled');
select results_eq(
  $$ select stage::text, entered_on from project_stage_entries
      where project_id = '16380000-0000-0000-0000-000000000043' order by position $$,
  $$ values ('Leads', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '120 days')),
            ('Quotation Submitted', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '90 days')),
            ('Negotiation', stage_org_date('16380000-0000-0000-0000-000000000004', now() - interval '30 days')) $$,
  'AC-PSH-009: a move missing from record_changes is closed with the current status, dated last_update');
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
    -- record_changes can miss a move (rows written before 0260 registered a column, or deleted by hand): end the
    -- journey at the current status so §8's invariant (latest entry = status) holds on every org's data.
    if (select e.stage from public.project_stage_entries e where e.project_id = r.id
         order by e.position desc limit 1) is distinct from r.status then
      insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source)
      select r.org_id, r.id, r.status,
             case when r.status = 'Won, Pending KoM' and r.contract_date is not null then r.contract_date
                  when r.status in ('Loss Tender','Declined') and r.decided_at is not null
                    then public.stage_org_date(r.org_id, r.decided_at)
                  else public.stage_org_date(r.org_id, r.last_update) end,
             max(e.position) + 1, 'backfill'
        from public.project_stage_entries e where e.project_id = r.id;
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
Append to `pipeline_stage_history_backfill.test.sql` (the plan(11) above already counts these 4), then
`select * from finish(); rollback;`. Fixture first (as postgres) — the project is created **now**, exactly as the
in-app import creates it, so its origination entry is dated today and the past stage dates must still land:
```sql
insert into auth.users (id, email) values ('16380000-0000-0000-0000-0000000000d2','psh-imp@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000d2','16380000-0000-0000-0000-000000000004','PSH Imp','psh-imp@example.test','Project Manager','active');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('16380000-0000-0000-0000-000000000041','16380000-0000-0000-0000-000000000004','PSH-IMP','PSH import','Leads',
   '16380000-0000-0000-0000-0000000000d2');
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
select is((select entered_on from project_stage_entries
   where project_id = '16380000-0000-0000-0000-000000000041' and stage = 'Leads'), date '2026-07-01',
  'AC-PSH-010: with no Lead date, the lead takes the first imported date so the past dates can land');
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
-- p_entries: [{stage, entered_on}] in canonical order; an optional first {"stage":"Leads"} dates the lead.
-- It writes THROUGH the §2 trigger (no off switch): every stage but the last is inserted directly, the last one
-- is appended by the trigger when the status moves, then dated.
create or replace function public.import_project_stage_history(p_project_id uuid, p_entries jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_status project_status;
  v_count  int;
  v_n      int := jsonb_array_length(coalesce(p_entries, '[]'::jsonb));
  v_i      int := 0;
  v_idx    int;
  v_prev   int := 0;
  v_stage  project_status;
  v_on     date;
  v_lead   uuid;
  v_last   project_status;
  x        jsonb;
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
  select id into v_lead from public.project_stage_entries where project_id = p_project_id;
  for x in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_idx := array_position(public.pipeline_project_statuses(), x ->> 'stage');
    if v_idx is null or v_idx <= v_prev then                           -- pre-award only, canonical order
      raise exception 'imported stage % is not a pre-award stage in journey order', x ->> 'stage' using errcode = 'P0001';
    end if;
    v_prev  := v_idx;
    v_stage := (x ->> 'stage')::project_status;
    v_on    := (x ->> 'entered_on')::date;
    if v_on is null or v_on > public.native_org_today(v_org) then
      raise exception 'a stage date cannot be in the future' using errcode = '23514';
    end if;
    if v_i = 1 then
      -- The lead: its own date when given, else no later than the first imported date (spec FR-PSH-020).
      update public.project_stage_entries
         set entered_on = case when v_stage = 'Leads' then v_on else least(entered_on, v_on) end
       where id = v_lead;
    end if;
    continue when v_stage = 'Leads';
    if v_i < v_n then
      insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
      select v_org, p_project_id, v_stage, v_on, max(position) + 1, 'import', auth.uid()
        from public.project_stage_entries where project_id = p_project_id;
    else
      -- Pre-award stages carry no SoD; the move is an editor's and goes on the audit trail below. The trigger
      -- appends the entry dated today; date it and mark it imported.
      update public.projects set status = v_stage, last_update = now() where id = p_project_id;
      update public.project_stage_entries set entered_on = v_on, source = 'import'
       where project_id = p_project_id
         and position = (select max(position) from public.project_stage_entries where project_id = p_project_id);
    end if;
    v_last := v_stage;
  end loop;
  if v_last is not null then
    perform public.log_audit('project.transition', v_org, auth.uid(), p_project_id,
      jsonb_build_object('from', 'Leads', 'to', v_last::text, 'source', 'import', 'entries', p_entries));
  end if;
end; $$;
```
The status move skips `transition_project`'s one-step legal map on purpose: the row is a fresh lead, the target
is a pre-award stage, and the caller passed the same editor gate that may move it stage by stage. Dates are
checked by the §2 ordering constraint (and the client preview, Task 38).
Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/pipeline_stage_history_backfill.test.sql'`.

### Task 20 — migration §8: grants + closing self-assertion; invariant test
```sql
-- §8 ─────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.redate_stage_entry(uuid, date) from public, anon;
revoke all on function public.add_skipped_stage_entry(uuid, project_status, date) from public, anon;
revoke all on function public.import_project_stage_history(uuid, jsonb) from public, anon;
revoke all on function public.project_stage_entries_assert_order() from service_role;
revoke all on function public.project_stage_entry_append() from service_role;
revoke all on function public.backfill_project_stage_entries(uuid) from service_role;
grant execute on function public.redate_stage_entry(uuid, date) to authenticated;
grant execute on function public.add_skipped_stage_entry(uuid, project_status, date) to authenticated;
grant execute on function public.import_project_stage_history(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from public.projects p
              where p.status is distinct from (select e.stage from public.project_stage_entries e
                                                where e.project_id = p.id order by e.position desc limit 1)) then
    raise exception '0430: a project''s latest stage entry does not match its status';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
       ('projects_zy_stage_entry','project_stage_entries_order','project_stage_entries_zz_record_change')) <> 3 then
    raise exception '0430: stage history triggers missing';
  end if;
  if has_table_privilege('authenticated', 'public.project_stage_entries', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_stage_entries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_stage_entries', 'DELETE') then
    raise exception '0430: clients must not write project_stage_entries directly';
  end if;
  if has_function_privilege('authenticated', 'public.backfill_project_stage_entries(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.stage_entry_set_date(uuid, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_stage_date_editor(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.stage_entries_pull_back(uuid, numeric, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.redate_stage_entry(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.add_skipped_stage_entry(uuid, project_status, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.import_project_stage_history(uuid, jsonb)', 'EXECUTE') then
    raise exception '0430: internal stage functions must not be client-callable';
  end if;
end $$;
```
**0178 allow-list (CI trap).** `supabase/tests/0178_anon_executable_definers.test.sql` names every SECURITY
DEFINER writer `authenticated` may execute; a writer missing from it is reported by AC-ACL-004. Add the three
names to its `client_callable_rpc_names` insert list — `('redate_stage_entry'), ('add_skipped_stage_entry'),
('import_project_stage_history')` — raise both `104` literals (AC-ACL-002/003 counts and descriptions) by 3, and
add the amendment line after the last `⚑ AMENDED BY` comment:
`-- ⚑ AMENDED BY 0430 (#1638): redate_stage_entry, add_skipped_stage_entry and import_project_stage_history join the retained set (+3, count 107 on dev's 104, re-derived by hand from the list). Each re-asserts org, active membership and role rank >= Project Manager through assert_stage_date_editor; proven by pipeline_stage_history_write.test.sql.`
Re-count from the list at build time — if dev has moved past 104, use dev's number + 3. The trigger and internal
functions are revoked from every client role, so the sweep does not see them.
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
Create `supabase/migrations/rollback/0448_pipeline_stage_history_down.sql` in three exact steps:
```bash
cat > supabase/migrations/rollback/0448_pipeline_stage_history_down.sql <<'SQL'
-- 0448_pipeline_stage_history_down.sql — reverses 0430. Loses stage history; business rows untouched
-- (contract_date / decided_at keep whatever re-dates set them to; the audit trail keeps the old values).
begin;
drop trigger if exists projects_zy_stage_entry on public.projects;
drop function if exists public.import_project_stage_history(uuid, jsonb);
drop function if exists public.add_skipped_stage_entry(uuid, project_status, date);
drop function if exists public.redate_stage_entry(uuid, date);
drop function if exists public.stage_entry_set_date(uuid, date);
drop function if exists public.assert_stage_date_editor(uuid);
drop function if exists public.backfill_project_stage_entries(uuid);
drop function if exists public.project_stage_entry_append();
drop function if exists public.stage_entries_pull_back(uuid, numeric, date);
delete from public.record_history_config where entity_type = 'project_stage_entry';
delete from public.record_changes where entity_type = 'project_stage_entry';
drop table if exists public.project_stage_entries;
drop function if exists public.project_stage_entries_assert_order();
drop function if exists public.stage_org_date(uuid, timestamptz);
-- 0281's record_history_visible (no project_stage_entry arm), then 0385's two reads, verbatim:
SQL
sed -n '227,251p' supabase/migrations/0281_vendor_withholding_slips.sql >> supabase/migrations/rollback/0448_pipeline_stage_history_down.sql
sed -n '4,247p' supabase/migrations/0385_dashboard_open_bids_and_stale_win_rate.sql >> supabase/migrations/rollback/0448_pipeline_stage_history_down.sql
echo 'commit;' >> supabase/migrations/rollback/0448_pipeline_stage_history_down.sql
```
Open the result and check it reads straight through (0281 lines 227-251 are `record_history_visible` + its
revoke/grant; 0385 lines 4-247 are both functions, the grant lines, both comments and the `notify`).
Verify (throwaway; the local DB URL is the stack's fixed default; the final reset restores the schema):
```bash
cat > /tmp/psh_rollback_check.sql <<'SQL'
select to_regclass('public.project_stage_entries') is null,
       (select count(*) from public.record_history_config) = 16,
       position('record_changes' in pg_get_functiondef('public.get_sales_pipeline()'::regprocedure)) > 0,
       public.record_history_visible('project', gen_random_uuid()) is not null;
SQL
scripts/with-db-lock.sh bash -c 'DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres; supabase db reset \
  && psql "$DB" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0448_pipeline_stage_history_down.sql \
  && psql "$DB" -v ON_ERROR_STOP=1 -tA -f /tmp/psh_rollback_check.sql; supabase db reset'
```
→ one line `t|t|t|t` (table gone, registry back to 16, the 0385 read restored, visibility function intact).

### Task 22 — regenerate types; seed check; push the DB branch
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'
cd pmo-portal && npm run typecheck
```
Then confirm seeded deals got journeys:
`scripts/with-db-lock.sh psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -tAc 'select count(*) from projects p where not exists (select 1 from project_stage_entries e where e.project_id = p.id)'` → `0`.
Run the whole §2 pgTAP list once (one lock hold, after the reset above). Commit the DB half (migration, rollback,
three new pgTAP files, the four edited gate tests — `0385_dashboard_open_bids`, `record_changes_catalog_gate`,
`0281_vendor_withholding_slips_rollback`, `0178_anon_executable_definers` — and the types) and **push the branch**
(`git push -u origin <branch>`). No PR: the Director opens it, alone (money-path tier).

### Task 23 — failing Vitest: the stage line (AC-PSH-011)
Add to `pmo-portal/components/salesPipeline.test.ts`:
```ts
import { stageLine, daysBetweenDates, formatIsoDayMonth, STAGE_KEY_DATE_LABEL } from './salesPipeline';

describe('stageLine (#1638)', () => {
  it('AC-PSH-011: renders "<label> <dd Mon> · <n> d" for the latest entry', () => {
    expect(stageLine('Quotation Submitted', '2026-10-12', '2026-11-01', (k, d) => d)).toBe('Quoted 12 Oct · 20 d');
  });
  it('AC-PSH-011: a calendar date prints as that day in any browser timezone', () => {
    expect(formatIsoDayMonth('2026-10-12')).toBe('12 Oct');
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

/**
 * A 'YYYY-MM-DD' calendar date as "12 Oct". formatDayMonth formats in the BROWSER's timezone, so the Date must be
 * local midnight — `T00:00:00Z` would print the day before in any browser west of UTC (spec T15).
 */
export function formatIsoDayMonth(iso: string): string {
  return formatDayMonth(new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

/** The card's one line for the latest stage entry: "Quoted 12 Oct · 20 d" (FR-PSH-013). */
export function stageLine(status: string, enteredOn: string, todayIso: string, t: Translate): string {
  const [key, fallback] = STAGE_KEY_DATE_LABEL[status] ?? ['', status];
  const label = key ? t(key, fallback) : fallback;
  const day = enteredOn.slice(0, 10);
  return `${label} ${formatIsoDayMonth(day)} · ${daysBetweenDates(day, todayIso)} ${t('sales:stageDate.daysShort', 'd')}`;
}
```
Add the keys to `pmo-portal/public/locales/en/sales.json` under `"stageDate"` (values = the English defaults
above, plus `"daysShort": "d"`) and to `pmo-portal/public/locales/id/sales.json`
(`"lead": "Prospek"`, `"pq": "Prakualifikasi dikirim"`, `"quoted": "Penawaran"`, `"tender": "Tender dikirim"`,
`"negotiation": "Negosiasi"`, `"signed": "Ditandatangani"`, `"lost": "Kalah"`, `"declined": "Ditolak"`,
`"started": "Dimulai"`, `"onHold": "Ditunda"`, `"closedOut": "Ditutup"`, `"internal": "Internal"`, `"daysShort": "h"`).
Verify GREEN: `npx vitest run components/salesPipeline.test.ts` and `npm run check:guards` (locale parity).

### Task 25 — failing Vitest: card shows exactly one stage line (AC-PSH-011)
Add to `pmo-portal/components/SalesKanbanBoard.test.tsx` — it has no render helper; tests call
`render(<SalesKanbanBoard projects={…} onOpen={vi.fn()} />)` directly over the file's `projects` fixture array
(`projects[0]` = Quotation, `projects[2]` = Won, `projects[3]` = Lost):
```tsx
describe('SalesKanbanBoard stage line + Signed pill (#1638)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-11-01T05:00:00Z'), toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('AC-PSH-011: an open deal card shows one stage line for its latest entry', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[0], id: 'd1', stage_started_at: '2026-10-12T00:00:00+00:00' }]} onOpen={vi.fn()} />);
    const lines = screen.getAllByTestId('stage-line-d1');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('Quoted 12 Oct · 20 d');
  });
  it('AC-PSH-011: a lost deal dates its line from the decision', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[3], id: 'l9', decided_at: '2026-09-04T02:00:00+00:00' }]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('stage-line-l9')).toHaveTextContent('Lost 04 Sep · 58 d');
  });
});
```
(`toFake: ['Date']` freezes the clock without freezing React's timers. The fixture rows lack `stage_started_at`,
so existing tests render no stage line and stay unchanged.)
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
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';

/** #1638 FR-PSH-013 — one line for the latest stage entry; lost deals date from decided_at (an instant). */
const DealStageLine: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation();
  const today = useOrgToday();
  const lost = project.status === 'Loss Tender' || project.status === 'Declined';
  const enteredOn = lost
    ? (project.decided_at ? formatCalendarDayInTimeZone(new Date(project.decided_at), getActiveLocale().timezone) : undefined)
    : project.stage_started_at?.slice(0, 10);   // the RPC emits entered_on at UTC midnight (Task 15)
  if (!enteredOn) return null;
  return (
    <p data-testid={`stage-line-${project.id}`} className="text-xs text-muted-foreground tabular">
      {stageLine(project.status, enteredOn, today, (k, d) => t(k, d))}
    </p>
  );
};
```
`useOrgToday` — none exists in `src/hooks/` (only `pages/MyTasks.tsx:13` has a file-local `todayIso`); create
`pmo-portal/src/hooks/useOrgToday.ts`:
```ts
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
/** Today as 'YYYY-MM-DD' in the active org/user timezone (format.ts:60). */
export function useOrgToday(): string {
  return formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
}
```
(`formatCalendarDayInTimeZone` returns `YYYY-MM-DD`, `format.ts:60-70`. The active timezone is the user's
preference, falling back to the org's — `Asia/Jakarta` by default. A user whose timezone runs ahead of the org's can
pick "today" a few hours before the server's today; the server then refuses with `23514` and the dialog shows it.)
Render `<DealStageLine project={project} />` as the first child of the `space-y-1` body div in both `DealCard`
(`SalesKanbanBoard.tsx:69`) and `CompactDealCard` (`:127`), **only when** `!ON_HAND_STATUSES.includes(project.status)`.
These are the card bodies only; #1637's `drag` prop wraps the whole `DealCard` and does not touch them.
Verify GREEN: `npx vitest run components/SalesKanbanBoard.test.tsx`.

### Task 27 — failing Vitest: Signed pill (AC-PSH-012)
Inside the same `describe` as Task 25:
```tsx
  it('AC-PSH-012: a won deal shows a Signed pill with its contract date and no stage line', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[2], id: 'w1', contract_date: '2026-09-03', stage_started_at: '2026-09-03T00:00:00+00:00' }]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('signed-pill-w1')).toHaveTextContent('Signed 03 Sep');
    expect(screen.queryByTestId('stage-line-w1')).toBeNull();
  });
  it('AC-PSH-012: a won deal without a contract date shows "Signed" alone', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[2], id: 'w2', status: 'Ongoing Project', contract_date: null }]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('signed-pill-w2')).toHaveTextContent(/^Signed$/);
  });
```
(The Won column holds every `ON_HAND_STATUSES` value, `components/salesPipeline.ts:76`.)
Verify RED: `npx vitest run components/SalesKanbanBoard.test.tsx -t AC-PSH-012`.

### Task 28 — implement `SignedPill`
In `SalesKanbanBoard.tsx`:
```tsx
/** #1638 FR-PSH-014 (ruling bullet #1593) — won deals carry a Signed pill with the contract date. */
const SignedPill: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation();
  const label = t('sales:stageDate.signed', 'Signed');
  const date = project.contract_date ? formatIsoDayMonth(project.contract_date) : null;
  return (
    <Badge data-testid={`signed-pill-${project.id}`} className="w-fit px-1.5">
      {date ? `${label} ${date}` : label}
    </Badge>
  );
};
```
(import `formatIsoDayMonth` from `./salesPipeline`, `ON_HAND_STATUSES` from `@/src/lib/db/projectTransitions`).
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
import { listStageEntries, redateStageEntry, addSkippedStageEntry, importProjectStageHistory } from '../projectStageEntries';

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
    await importProjectStageHistory('p1', [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }]);
    expect(rpc.mock.calls).toEqual([
      ['redate_stage_entry', { p_entry_id: 'e1', p_entered_on: '2026-10-12' }],
      ['add_skipped_stage_entry', { p_before_entry_id: 'e2', p_stage: 'Quotation Submitted', p_entered_on: '2026-10-01' }],
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

/** #1638 — one stage a deal entered (supabase/migrations/0448_pipeline_stage_history.sql §1). */
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
  importHistory: dal.importProjectStageHistory,
};
```
Export the type next to it: `export type ProjectStageRepository = typeof projectStageRepository;`.
Register in `pmo-portal/src/lib/repositories/index.ts` (`import { projectStageRepository } from './projectStages';`
and `projectStage: projectStageRepository,` after `project: projectRepository,` at line 87) and in the
`Repositories` interface in `pmo-portal/src/lib/repositories/types.ts:99` (`import type { ProjectStageRepository } from './projectStages';`
beside the `RecordHistoryRepository` import at line 18, and `projectStage: ProjectStageRepository;` after the
`project` member).
`pmo-portal/src/hooks/useProjectStageEntries.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { invalidateProjectProjections } from '@/src/hooks/projectQueryKeys';
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
  // A re-date can move contract_date / decided_at (Signed / Lost), so every project projection refreshes.
  const settle = () => invalidateProjectProjections(qc, currentUser?.org_id);
  return {
    redate: useMutation({ mutationFn: (v: { entryId: string; enteredOn: string }) =>
      repositories.projectStage.redate(v.entryId, v.enteredOn), onSuccess: settle }),
    addSkipped: useMutation({ mutationFn: (v: { beforeEntryId: string; stage: ProjectStatus; enteredOn: string }) =>
      repositories.projectStage.addSkipped(v.beforeEntryId, v.stage, v.enteredOn), onSuccess: settle }),
  };
}
```
In `pmo-portal/src/hooks/projectQueryKeys.ts` add `'project-stage-entries'` to the root list in
`invalidateProjectProjections` (line 12). Every move path already calls it — the deal page's `runTransition`
(`PipelineLens.tsx:206`), the status menu, and #1637's drop — so a move refreshes the history with no per-path code.
Verify GREEN: `npx vitest run src/lib/db/__tests__/projectStageEntries.test.ts && npm run typecheck`.

### Task 30a — record-history registry learns the stage entry (FE mirror of Task 13)
The project's Record history now carries `project_stage_entry` events (parent `project`) and two audit codes. The
FE keeps its own copy of the registry (`src/components/history/historyFields.ts:1-5`), so add:
- `historyFields.ts` `FIELD_KINDS`: `project_stage_entry: { project_id: 'ref', stage: 'enum', entered_on: 'date', source: 'text', redated_at: 'timestamp' },`
- `historyLabels.ts` `kindLabels`: `project_stage_entry: t('history.kind.project_stage_entry', 'Stage entry'),`
- `historyLabels.ts` `fieldLabels`: `stage: t('history.field.stage', 'Stage'), entered_on: t('history.field.entered_on', 'Stage date'), source: t('history.field.source', 'Recorded by'), redated_at: t('history.field.redated_at', 'Date changed at'),`
  (skip any key `fieldLabels` already has — `grep -n "stage:\|entered_on:\|source:\|redated_at:" src/components/history/historyLabels.ts` first)
- `historyLabels.ts` `auditActionLabels`: `'project.stage_entry.redate': t('history.action.project_stage_entry_redate', 'Stage date changed'), 'project.stage_entry.add': t('history.action.project_stage_entry_add', 'Skipped stage added'),`
- the matching keys under `history.kind` / `history.field` / `history.action` in `public/locales/en/common.json`
  and `public/locales/id/common.json` (id: `Entri tahap`, `Tahap`, `Tanggal tahap`, `Dicatat oleh`,
  `Tanggal diubah pada`, `Tanggal tahap diubah`, `Tahap terlewat ditambahkan`).
Test first, in `src/components/history/__tests__/historyLabels.test.tsx` (same shape as its `FR-005 … billing_kind`
case at line 29):
```tsx
// add `kindLabels, auditActionLabels` to the file's existing `import { fieldLabels } from '../historyLabels';`
describe('#1638 stage entry history', () => {
  const translate = (key: string, options: { defaultValue?: string } | string) =>
    typeof options === 'string' ? options : options.defaultValue ?? key;
  it('AC-PSH-007: a stage entry is a known record kind with a dated stage field and labelled audit lines', () => {
    expect(FIELD_KINDS.project_stage_entry.entered_on).toBe('date');
    expect(kindLabels(translate as never).project_stage_entry).toBe('Stage entry');
    expect(auditActionLabels(translate as never)['project.stage_entry.redate']).toBe('Stage date changed');
    expect(id.history.kind.project_stage_entry).toBe('Entri tahap');
  });
});
```
Verify: `npx vitest run src/components/history/__tests__/historyLabels.test.tsx src/components/history/__tests__/RecordHistory.test.tsx && npm run check:i18n`.

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
// usePermission returns the predicate itself: (action, entity, ctx?) => boolean (src/auth/usePermission.tsx:20).
const { canEdit } = vi.hoisted(() => ({ canEdit: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => canEdit }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-01' }));

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
No i18n wrapper: `test/setup.ts:137-150` initialises a global i18next test instance, so `t` returns the English
defaults. `vi.hoisted` because `vi.mock` factories are hoisted above top-level consts (the repo's pattern,
`PipelineLens.writePolicy.test.tsx:24`).
Verify RED: module `../StageHistory` not found.

### Task 32 — implement `StageDateDialog` + `StageHistory`
`pmo-portal/pages/project-detail/StageDateDialog.tsx` — on the shared `EntityFormModal` / `TextField` /
`SelectField` primitives (same pattern as `MilestoneFormModal.tsx`). **Nothing is written until "Save date"**:
the only write is `onConfirm`, called from the form's submit.
```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, TextField, SelectField } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { STAGE_KEY_DATE_LABEL } from '@/components/salesPipeline';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

interface StageDateDialogProps {
  title: string;
  /** Pre-filled value ('YYYY-MM-DD'); today when not given. */
  initialDate?: string;
  /** Inclusive bounds from the neighbouring entries; max defaults to today. */
  min?: string | null;
  max?: string | null;
  /** Only for "Add skipped stage": the pre-award stages the user may pick. */
  stageOptions?: readonly ProjectStatus[];
  onConfirm: (value: { enteredOn: string; stage?: ProjectStatus }) => Promise<void>;
  onClose: () => void;
}

export default function StageDateDialog({ title, initialDate, min, max, stageOptions, onConfirm, onClose }: StageDateDialogProps) {
  const { t } = useTranslation();
  const today = useOrgToday();
  const hi = max ?? today;
  const [value, setValue] = useState(initialDate ?? today);
  const [stage, setStage] = useState<string>(stageOptions?.[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const outOfRange = value === '' || (min != null && value < min) || value > hi;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (outOfRange) return;
    setSaving(true); setServerError(null);
    try {
      await onConfirm({ enteredOn: value, stage: stageOptions ? (stage as ProjectStatus) : undefined });
    } catch (err) {
      setServerError(classifyMutationError(err).detail);
    } finally {
      setSaving(false);
    }
  };
  return (
    <EntityFormModal open title={title} submitLabel={t('projectDetail.stageHistory.save', 'Save date')}
      onSubmit={(e) => void submit(e)} onClose={onClose} loading={saving} submitDisabled={outOfRange}
      dirty={value !== (initialDate ?? today)}>
      {stageOptions && (
        <SelectField label={t('projectDetail.stageHistory.stage', 'Stage')} value={stage} onChange={setStage}
          options={stageOptions.map((s) => ({ value: s, label: t(STAGE_KEY_DATE_LABEL[s][0], STAGE_KEY_DATE_LABEL[s][1]) }))} />
      )}
      <TextField type="date" label={t('projectDetail.stageHistory.date', 'Stage date')} value={value}
        onChange={(v) => { setValue(v); setServerError(null); }} min={min ?? undefined} max={hi}
        error={(outOfRange && value !== ''
          ? (min != null
              ? t('projectDetail.stageHistory.outOfRange', 'Pick a date between {{min}} and {{max}}', { min, max: hi })
              : t('projectDetail.stageHistory.notAfter', 'Pick a date on or before {{max}}', { max: hi }))
          : null) ?? serverError} />
    </EntityFormModal>
  );
}
```
(`SelectOption` is `{ value, label }`, `FormFields.tsx:355`; `EntityFormModal` renders `children` as the form body.)
Add a dialog test, `pmo-portal/pages/project-detail/__tests__/StageDateDialog.test.tsx`, owning the confirm step:
```tsx
it('AC-PSH-013: nothing is saved until Save date; an out-of-range date cannot be saved', async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(<StageDateDialog title="Change date" initialDate="2026-10-12" min="2026-10-01" max="2026-10-20"
    onConfirm={onConfirm} onClose={vi.fn()} />);
  const field = screen.getByLabelText('Stage date');
  await userEvent.clear(field);
  await userEvent.type(field, '2026-10-25');
  expect(screen.getByRole('button', { name: 'Save date' })).toBeDisabled();
  await userEvent.clear(field);
  await userEvent.type(field, '2026-10-05');
  expect(onConfirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Save date' }));
  expect(onConfirm).toHaveBeenCalledWith({ enteredOn: '2026-10-05', stage: undefined });
});
```
(mock `@/src/hooks/useOrgToday` to `'2026-11-01'` as in Task 31.)
`pmo-portal/pages/project-detail/StageHistory.tsx`:
```tsx
export default function StageHistory({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: entries = [], isLoading, error } = useProjectStageEntries(projectId);
  const { redate, addSkipped } = useStageEntryMutations(projectId);
  const may = usePermission();
  const canEdit = may('transition', 'project');              // same set as the server's editor rank (plan D6)
  const today = useOrgToday();
  const [editing, setEditing] = useState<{ kind: 'redate' | 'add'; index: number } | null>(null);
  // entries are newest-first: neighbours of entries[i] are entries[i+1] (earlier) and entries[i-1] (later).
  const boundsFor = (i: number, kind: 'redate' | 'add') => kind === 'redate'
    ? { min: entries[i + 1]?.entered_on ?? null, max: entries[i - 1]?.entered_on ?? today }
    : { min: entries[i + 1]?.entered_on ?? null, max: entries[i].entered_on };
  if (isLoading) return <ListState variant="loading" />;
  if (error) return <ListState variant="error" title={t('projectDetail.stageHistory.loadError', 'Stage history could not load')} />;
  return (
    <section aria-labelledby="stage-history-heading" className="space-y-2">
      <h2 id="stage-history-heading" className="text-sm font-semibold">{t('projectDetail.stageHistory.heading', 'Stage history')}</h2>
      <ol aria-label={t('projectDetail.stageHistory.listLabel', 'Stage history')} className="space-y-1">
        {entries.map((e, i) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{stageLabel(e.stage, t)} {formatIsoDayMonth(e.entered_on)}</span>
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
          title={editing.kind === 'redate' ? t('projectDetail.stageHistory.changeDate', 'Change date') : t('projectDetail.stageHistory.addSkipped', 'Add skipped stage')}
          initialDate={entries[editing.index].entered_on}
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
where `stageLabel(stage, t)` reads `STAGE_KEY_DATE_LABEL` and `formatIsoDayMonth` comes from `components/salesPipeline.ts`. Add every
`projectDetail.stageHistory.*` key to `public/locales/en/*.json` and `public/locales/id/*.json` in the namespace the
`projectDetail.pipeline.*` keys already live in: `public/locales/{en,id}/common.json` (`journeyHeading` lives
there), under `projectDetail.stageHistory`. id values: heading/listLabel `Riwayat tahap`, date `Tanggal tahap`,
outOfRange `Pilih tanggal antara {{min}} dan {{max}}`, system `Sistem`, redated `Tanggal diubah`, added
`Ditambahkan kemudian`, changeDate `Ubah tanggal`, addSkipped `Tambah tahap terlewat`, save `Simpan tanggal`,
salesHistory `Riwayat penjualan`, loadError `Riwayat tahap gagal dimuat`, stage `Tahap`, notAfter
`Pilih tanggal paling lambat {{max}}`.
Verify GREEN: `npx vitest run pages/project-detail/__tests__/StageHistory.test.tsx pages/project-detail/__tests__/StageDateDialog.test.tsx && npm run check:guards`.

### Task 33 — mount the history (+ sibling suites)
- `pmo-portal/pages/project-detail/PipelineLens.tsx`: render `<StageHistory projectId={project.id} />` as the last
  child **inside** the `projectJourney` section (`PipelineLens.tsx:301-310`, after `LifecycleStepper`). That const is
  rendered once per layout (`:338` mobile, `:358` desktop), so the history follows the journey on both.
- `pmo-portal/pages/project-detail/ProjectDetail.tsx`: for on-hand projects (`pipelineGroup === 'onHand'`, computed at
  line 91) render `{pipelineGroup === 'onHand' && <details className="mb-8"><summary className="text-sm font-semibold">{t('projectDetail.stageHistory.salesHistory','Sales history')}</summary><StageHistory projectId={project.id} /></details>}`
  directly after the `isPipelineRecord && …PipelineLens…` line (`:191`).
- **Sibling suites (CI trap).** Six suites render `PipelineLens` with `@tanstack/react-query` mocked down to
  `useQueryClient` and **no `QueryClientProvider`**, so a real `useQuery` inside `StageHistory` would throw:
  `PipelineLens.{erpLink,markwon,navigation,rbac,writePolicy}.test.tsx` and `wave5-c3-pr2.test.tsx` (all in
  `pages/project-detail/__tests__/`). Add to each, at line start beside its other `vi.mock` calls:
  ```tsx
  vi.mock('@/src/hooks/useProjectStageEntries', () => ({
    useProjectStageEntries: () => ({ data: [], isLoading: false, error: null }),
    useStageEntryMutations: () => ({ redate: { mutateAsync: vi.fn() }, addSkipped: { mutateAsync: vi.fn() } }),
  }));
  ```
  This is harness only — no assertion changes. The `ProjectDetail.*` suites and `PipelineLens.queryStatus` already
  wrap a `QueryClientProvider`; their repositories mock lacks `projectStage`, so the history renders its error
  state there, which none of them asserts against.
- Add one assertion to `PipelineLens.rbac.test.tsx` (its PM case, line ~89) that
  `screen.getByRole('heading', { name: 'Stage history' })` renders.
Verify (the 20 suites that render the lens or the detail page — found with
`grep -rlE "import (PipelineLens|ProjectDetail)( |,)" pages src components | grep '\.test\.'`):
`npx vitest run pages/project-detail/__tests__/PipelineLens pages/project-detail/__tests__/ProjectDetail pages/project-detail/__tests__/wave5-c3-pr2.test.tsx src/components/ui/__tests__/dealNounElim.test.tsx src/components/ui/__tests__/RecordActionZone.enforcement.test.tsx`.

### Task 34 — (removed) quotation proposal
Deferred with FR-PSH-019 / AC-PSH-014 (spec OQ-PSH-4): no quotation document exists, so a proposal would always be
today, which `StageDateDialog` already pre-fills. The outbound-quotation issue passes its issue date as
`initialDate` when opening "Change date" on the Quoted entry. Nothing to build; the number is kept so later task
numbers stay stable.

### Task 35 — (removed) dialog hint
Deferred with Task 34. Nothing to build.

### Task 36 — deal page: Advance stays single-click; the history follows every move
- **Do not** add a date dialog to "Advance to" (`PipelineLens.tsx:323`, `:390`) — plan D5, AC-IXD-WP-004
  (`PipelineLens.writePolicy.test.tsx:97`) stays green unchanged. The move is dated today by the trigger; the
  user backdates it with "Change date" on the newest history entry, directly below.
- `runTransition` already ends with `invalidateProjectProjections(queryClient, currentUser?.org_id)`
  (`PipelineLens.tsx:206`); Task 30 added `'project-stage-entries'` to that list, so the history refreshes after
  Advance, Mark won, Mark lost and Declined with no edit here. The Won panel's contract-date input needs no `min`
  (plan §1.5, D5a).
- Add one test to `PipelineLens.writePolicy.test.tsx`:
  `it('AC-PSH-013: a routine Advance refreshes the stage history', …)` — spy on the mocked `useQueryClient`'s
  `invalidateQueries` (the file mocks it at line 54; hoist the `vi.fn()` with `vi.hoisted` so the test can read it),
  click Advance, and `await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project-stage-entries', 'org-1'] }))`
  (`org-1` is the file's `useAuth` mock, line 52).
Verify: `npx vitest run pages/project-detail/__tests__/PipelineLens.writePolicy.test.tsx`.

### Task 37 — failing Vitest: import stage-date columns (AC-PSH-015)
In `pmo-portal/src/lib/import/__tests__/projectDescriptor.test.ts`. `validateRow` returns a sparse
`{ [fieldKey]: message }` map (`src/lib/import/types.ts:46`), so the errors are asserted on the offending column:
```ts
describe('#1638 stage dates', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('AC-PSH-015: stage dates out of order are rejected at preview, on the later column', () => {
    const d = makeProjectImportDescriptor([], []);
    expect(d.validateRow!({ name: 'X', status: 'Leads', pq_submitted_on: '2026-07-15', quoted_on: '2026-07-01' }))
      .toEqual({ quoted_on: 'Stage dates must not go backwards.' });
  });
  it('AC-PSH-015: a future stage date is rejected', () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T05:00:00Z'), toFake: ['Date'] });
    const d = makeProjectImportDescriptor([], []);
    expect(d.validateRow!({ name: 'X', status: 'Leads', quoted_on: '2026-11-03' }))
      .toEqual({ quoted_on: 'A stage date cannot be in the future.' });
  });
  it('AC-PSH-015: an Internal Project row cannot carry stage dates', () => {
    const d = makeProjectImportDescriptor([], []);
    expect(d.validateRow!({ name: 'X', status: 'Internal Project', quoted_on: '2026-07-01' }))
      .toEqual({ quoted_on: 'Only a lead can carry stage dates.' });
  });
  it('AC-PSH-015: in-order past dates pass and ride to the history call', () => {
    const d = makeProjectImportDescriptor([], []);
    const cells = { name: 'X', status: 'Leads', lead_on: '2026-06-20', pq_submitted_on: '2026-07-01', quoted_on: '2026-07-15' };
    expect(d.validateRow!(cells)).toEqual({});
    expect(d.toInput(cells)).toMatchObject({ lead_on: '2026-06-20', pq_submitted_on: '2026-07-01', quoted_on: '2026-07-15' });
  });
});
```
And one for the write order. The file already mocks repositories at lines 3-4
(`const { create } = vi.hoisted(…)`; `vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { create } } }))`);
widen both lines to `const { create, importHistory } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'new-id' }), importHistory: vi.fn() }));`
and `({ repositories: { project: { create }, projectStage: { importHistory } } })`:
```ts
it('AC-PSH-015: create writes the project, then its stage history, without the date columns on the project', async () => {
  const d = makeProjectImportDescriptor([], []);
  await d.create(d.toInput({ name: 'X', status: 'Leads', pq_submitted_on: '2026-07-01' }));
  expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ pq_submitted_on: expect.anything() }));
  expect(importHistory).toHaveBeenCalledWith('new-id', [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }]);
});
```
(The existing `'create delegates to repositories.project.create'` case, line 147, passes a row with no stage
cells, so `toInput` adds no keys and its exact-argument assertion stays green unchanged.)
Verify RED: `npx vitest run src/lib/import/__tests__/projectDescriptor.test.ts -t AC-PSH-015`.

### Task 38 — implement the import columns
In `pmo-portal/src/lib/import/projectDescriptor.ts`. `ImportField.key` and `validateRow`'s keys are typed
`keyof Input` and `create` receives only the `toInput` result (`types.ts:15-50`), so the date columns are fields of
an import-only input type that `create` strips:
```ts
import type { ImportStageDate } from '@/src/lib/db/projectStageEntries';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';

/** #1638 FR-PSH-020: one optional date column per pre-award stage, in canonical order. */
const STAGE_DATE_COLUMNS = [
  { key: 'lead_on', label: 'Lead date', stage: 'Leads' },
  { key: 'pq_submitted_on', label: 'PQ submitted date', stage: 'PQ Submitted' },
  { key: 'quoted_on', label: 'Quoted date', stage: 'Quotation Submitted' },
  { key: 'tender_sent_on', label: 'Tender sent date', stage: 'Tender Submitted' },
  { key: 'negotiation_on', label: 'Negotiation date', stage: 'Negotiation' },
] as const satisfies readonly { key: string; label: string; stage: ProjectStatus }[];
type StageDateKey = (typeof STAGE_DATE_COLUMNS)[number]['key'];
export type ProjectImportInput = CreateProjectInput & Partial<Record<StageDateKey, string>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function stageDatesOf(cells: Partial<Record<string, string>>): ImportStageDate[] {
  return STAGE_DATE_COLUMNS.flatMap((c) => {
    const v = cells[c.key]?.trim();
    return v ? [{ stage: c.stage, entered_on: v }] : [];
  });
}

/** Preview check (zero writes): keyed to the column the user must fix. */
function stageDateErrors(cells: Record<string, string>): Partial<Record<StageDateKey, string>> {
  const dated = STAGE_DATE_COLUMNS.filter((c) => cells[c.key]?.trim());
  if (dated.length === 0) return {};
  const first = dated[0].key;
  if (cells.status?.trim() !== 'Leads') return { [first]: 'Only a lead can carry stage dates.' };
  const today = formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
  for (let i = 0; i < dated.length; i++) {
    const v = cells[dated[i].key].trim();
    if (!ISO_DATE.test(v)) return { [dated[i].key]: 'Stage dates must be YYYY-MM-DD.' };
    if (v > today) return { [dated[i].key]: 'A stage date cannot be in the future.' };
    if (i > 0 && v < cells[dated[i - 1].key].trim()) return { [dated[i].key]: 'Stage dates must not go backwards.' };
  }
  return {};
}
```
- Change the factory's return type to `ImportDescriptor<ProjectImportInput>`.
- Add the five fields to `fields` after `end_date`:
  `...STAGE_DATE_COLUMNS.map((c) => ({ key: c.key, label: c.label, required: false, validate: () => null })),`
- `validateRow`: compute `const stageErrors = stageDateErrors(cells);` first; return `stageErrors` merged into the
  existing result on both paths — `if (value === null || value <= 0) return stageErrors;` and
  `return { ...stageErrors, ...errors };` at the end.
- `toInput`: add the stage cells to `base`:
  `...Object.fromEntries(STAGE_DATE_COLUMNS.flatMap((c) => (cells[c.key]?.trim() ? [[c.key, cells[c.key].trim()]] : []))),`
- `create`:
  ```ts
  create: async (input) => {
    const dated = stageDatesOf(input);
    const { lead_on: _l, pq_submitted_on: _p, quoted_on: _q, tender_sent_on: _t, negotiation_on: _n, ...project } = input;
    const row = await repositories.project.create(project as CreateProjectInput);
    if (dated.length > 0) await repositories.projectStage.importHistory(row.id, dated);
    return row;
  },
  ```
  (`eslint.config.js:120` ignores `^_` bindings, so the five discarded names lint clean.)
- The template download is built from `fields` (`src/lib/import/index.ts`), so the five columns appear in it.
- A row whose history call fails after the project row was created is reported as a failed row by the wizard;
  the project stays a plain lead (its origination entry) and the dates can be set from the deal page. The preview
  checks above make that path a server-only refusal (e.g. a concurrent edit).
Verify GREEN: `npx vitest run src/lib/import/__tests__/projectDescriptor.test.ts && npm run typecheck`.

### Task 39 — e2e journey (AC-PSH-016)
Create `pmo-portal/e2e/AC-PSH-016-stage-dates.spec.ts`:
```ts
// @e2e-isolation: self-isolated — creates its own deal (service-role insert) and deletes it afterwards.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { signIn, requireServiceRoleKey, openPipelineCard } from './helpers';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
// The seed org keeps the column default timezone (0198_locale_preference_columns.sql:24). Every date below is a
// calendar day in that zone, the same one the server's native_org_today uses — never a UTC day.
const ORG_TZ = 'Asia/Jakarta';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-PSH-016: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

const ID = randomUUID();
const NAME = `PSH journey ${ID.slice(0, 8)}`;
const orgDay = (daysAgo: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ }).format(new Date(Date.now() - daysAgo * 86_400_000));
const orgDayMonth = (daysAgo: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: ORG_TZ, day: '2-digit', month: 'short' })
    .format(new Date(Date.now() - daysAgo * 86_400_000));

test.beforeAll(async () => {
  const { error } = await admin.from('projects').insert({
    id: ID, org_id: ORG_ID, name: NAME, status: 'Leads', created_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`AC-PSH-016 seed failed: ${error.message}`);
  const { error: moveError } = await admin.from('projects').update({ status: 'PQ Submitted' }).eq('id', ID);
  if (moveError) throw new Error(`AC-PSH-016 seed move failed: ${moveError.message}`);
  const { error: dateError } = await admin.from('project_stage_entries').update({ entered_on: orgDay(30) })
    .eq('project_id', ID).eq('stage', 'PQ Submitted');
  if (dateError) throw new Error(`AC-PSH-016 seed date failed: ${dateError.message}`);
});
test.afterAll(async () => {
  await admin.from('record_changes').delete().eq('entity_id', ID);
  await admin.from('record_changes').delete().eq('parent_id', ID);
  await admin.from('projects').delete().eq('id', ID);   // cascades the stage entries
});

test('AC-PSH-016: a PM advances a deal, backdates the new stage on the deal page, and the card line follows', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/sales');
  await openPipelineCard(page, NAME);

  // Single click, no dialog (write policy AC-IXD-WP-004): the move is dated today.
  await page.getByRole('button', { name: /advance to/i }).click();
  const history = page.getByRole('list', { name: 'Stage history' });
  await expect(history.getByRole('listitem').first()).toContainText(`Quoted ${orgDayMonth(0)}`);

  await history.getByRole('listitem').first().getByRole('button', { name: 'Change date' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage date').fill(orgDay(12));
  await dialog.getByRole('button', { name: 'Save date' }).click();
  await expect(dialog).toBeHidden();
  await expect(history.getByRole('listitem').first()).toContainText(`Quoted ${orgDayMonth(12)}`);
  await expect(history.getByRole('listitem').first()).toContainText('Date changed');

  await page.goto('/sales');
  await expect(page.getByTestId(`stage-line-${ID}`)).toHaveText(`Quoted ${orgDayMonth(12)} · 12 d`);
});
```
(`openPipelineCard` waits for `/projects/<id>`, `e2e/helpers.ts:315-322`. The Playwright browser runs in the
runner's timezone; `formatIsoDayMonth` builds a local-midnight date, so the card prints the org day either way.)
Verify: `cd pmo-portal && ../scripts/e2e-local.sh AC-PSH-016` (and once `scripts/ci-e2e.sh <branch>` if the
Director asks — browser e2e otherwise runs on the PR to `main`).

### Task 40 — local final gate + UX proof
```bash
cd pmo-portal && npm run check:guards && npm run typecheck
npx eslint --max-warnings=0 components/salesPipeline.ts components/SalesKanbanBoard.tsx \
  src/hooks/useDashboard.ts src/lib/db/dashboard.ts src/lib/db/projectStageEntries.ts \
  src/lib/repositories/projectStages.ts src/lib/repositories/index.ts src/lib/repositories/types.ts \
  src/hooks/useProjectStageEntries.ts src/hooks/useOrgToday.ts src/hooks/projectQueryKeys.ts \
  src/components/history/historyFields.ts src/components/history/historyLabels.ts \
  pages/project-detail/StageHistory.tsx pages/project-detail/StageDateDialog.tsx \
  pages/project-detail/PipelineLens.tsx pages/project-detail/ProjectDetail.tsx src/lib/import/projectDescriptor.ts \
  e2e/AC-PSH-016-stage-dates.spec.ts
npx vitest run components/salesPipeline.test.ts components/SalesKanbanBoard.test.tsx \
  components/SalesKanbanBoard.bahasa.test.tsx src/lib/db/__tests__/projectStageEntries.test.ts \
  src/components/history/__tests__/historyLabels.test.tsx src/components/history/__tests__/RecordHistory.test.tsx \
  pages/project-detail/__tests__/StageHistory.test.tsx pages/project-detail/__tests__/StageDateDialog.test.tsx \
  pages/project-detail/__tests__/PipelineLens pages/project-detail/__tests__/ProjectDetail \
  pages/project-detail/__tests__/wave5-c3-pr2.test.tsx src/components/ui/__tests__/dealNounElim.test.tsx \
  src/components/ui/__tests__/RecordActionZone.enforcement.test.tsx \
  src/lib/import/__tests__/projectDescriptor.test.ts pages/sales-pipeline/__tests__/DraggableSalesBoard.test.tsx
../scripts/e2e-local.sh AC-PSH-016
../scripts/ux-proof.sh /sales
```
(`DraggableSalesBoard.test.tsx` is #1637's; it renders `SalesKanbanBoard`, so it is a sibling suite of Tasks 26/28.)
Plus captures of a deal page (open, re-quoted, won, lost) for the Director's rendered review. Commit the FE half
and push the branch; the Director opens the PR to `dev`.

## 4. Traceability

| AC | Owning test (layer) | Tasks | FR / NFR |
|---|---|---|---|
| AC-PSH-001 | `supabase/tests/pipeline_stage_history_write.test.sql` + invariant in `…_read.test.sql` (pgTAP) | 1, 3, 20 | FR-001, 002, 003 |
| AC-PSH-002 | `pipeline_stage_history_write.test.sql` (pgTAP) + `mut:pullback_person` | 3, 4, 11 | FR-004, 004a |
| AC-PSH-003 | `pipeline_stage_history_write.test.sql` (pgTAP) + `mut:future` | 5, 7, 11 | FR-005, 006, 008 |
| AC-PSH-004 | `pipeline_stage_history_write.test.sql` (pgTAP) | 6, 7 | FR-006, 008, 009 |
| AC-PSH-005 | `pipeline_stage_history_write.test.sql` (pgTAP) | 8, 9 | FR-007, 008 |
| AC-PSH-006 | `pipeline_stage_history_write.test.sql` (pgTAP) + mutation run | 2, 7, 10, 11, 20 | FR-010, 011, 018 · NFR-001, 003 |
| AC-PSH-007 | `pipeline_stage_history_write.test.sql` (pgTAP); FE labels in `historyLabels.test.tsx` | 7, 9, 12, 13, 30a | FR-012 |
| AC-PSH-008 | `supabase/tests/pipeline_stage_history_read.test.sql` (pgTAP); AC-1441 re-witnessed in `0385_dashboard_open_bids.test.sql` | 14, 15 | FR-015 · NFR-004 |
| AC-PSH-009 | `supabase/tests/pipeline_stage_history_backfill.test.sql` (pgTAP) | 16, 17 | FR-022 |
| AC-PSH-010 | `pipeline_stage_history_backfill.test.sql` (pgTAP) | 18, 19 | FR-020 |
| AC-PSH-011 | `components/salesPipeline.test.ts`, `components/SalesKanbanBoard.test.tsx` (Vitest) | 23–26 | FR-013 · NFR-006 |
| AC-PSH-012 | `components/SalesKanbanBoard.test.tsx` (Vitest) | 27, 28 | FR-014 |
| AC-PSH-013 | `pages/project-detail/__tests__/StageHistory.test.tsx` + `StageDateDialog.test.tsx` (Vitest) | 29–33, 36 | FR-016, 017 · NFR-007 |
| AC-PSH-014 | — deferred with FR-PSH-019 (outbound quotation issue) | 34, 35 (removed) | FR-019 |
| AC-PSH-015 | projects-import descriptor test (Vitest) | 37, 38 | FR-021 |
| AC-PSH-016 | `pmo-portal/e2e/AC-PSH-016-stage-dates.spec.ts` (Playwright) | 39 | FR-005, 006, 013, 016, 017 |
| NFR-PSH-002 | `0027`/`0028`/`0029`/`0031`/`0170`/`0236`/`client_starting_data_sequence` pgTAP + AC-1011 e2e stay green unchanged; `transition_project` absent from the diff | 3, 7, 20 | — |
| CI gates | `record_changes_catalog_gate` (17), `0281_…_rollback` (15), `0178_anon_executable_definers` (+3), `0137_service_role_grants`, `0203_rls_active_member_composition` | 2, 13, 20 | — |
| NFR-PSH-005 | rollback dry-run | 21 | — |

## 5. Open questions for the Director

Carried from the spec with their defaults (OQ-PSH-1…9). None blocks Tasks 1–22. Two are owner-class and should be
confirmed before the DB PR merges:
- **OQ-PSH-3** — re-dating Signed moves `contract_date`: it widens who can change a date that today only the win RPC
  writes (any stage-date editor, on any won deal in the org). Default: allowed, audited old → new.
- **OQ-PSH-9** — a win dated before earlier stage dates moves the system-dated entries back (D5a) instead of being
  refused. Default: move back + mark "Date changed"; refuse only over a date a person set.
