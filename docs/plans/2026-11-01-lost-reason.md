# Plan: required reason when a deal is lost, and win/loss by reason and client (LR, #1577)

- **Spec:** `docs/specs/lost-reason.spec.md` (Draft 2026-11-01; DD-LR-1..8 and OQ-LR-1..3 carry the defaults this plan builds).
- **Grounds read at `origin/dev` b52aa48a:** `supabase/migrations/{0236_project_status_declined_rules,0385_dashboard_open_bids_and_stale_win_rate,0185_revoke_anon_authenticated_definer_writers,0075_explicit_api_grants}.sql`,
  pgTAP `0027/0030/0032/0236`, `pmo-portal/{components/ProjectStatusControl.tsx,pages/project-detail/PipelineLens.tsx,
  src/lib/db/{projectTransitions,dashboard,opportunity,projects}.ts,src/hooks/{useDashboard,projectQueryKeys,useProjectTransitions}.ts,
  src/components/dashboard/WinRateCard.tsx,src/components/ui/{FormFields,ConfirmDialog}.tsx}`, `docs/plans/2026-11-01-board-drag-drop.md`.
  Paths below are relative to `pmo-portal/` unless they start with `docs/`, `scripts/` or `supabase/`.
- **Executor:** Orca workers per `docs/orca-dispatch.md`. **S1 changes `transition_project`** (the money/SoD transition RPC,
  win branch untouched): per CLAUDE.md it is Director-dispatched per issue, and **S1 ships alone** (own PR, not batched);
  `security-auditor` at full depth on S1 + S2. S3-S6 are a normal FE lane.
- **Migration numbers (Lane A range 0430-0439):** `0437` (columns + `transition_project`), `0438` (`get_loss_breakdown`).
  `0439` is spare. Never hand-roll a renumber: `scripts/renumber-migration.sh`.
- **Order:** S1 -> S2 -> S3 are independent of #1637. S4 needs #1637's S2 on the base branch
  (`components/project-status/ProjectTransitionConfirm.tsx`). If it is absent: **stop and ask the Director**, never create a second confirm.
- **#1638 builds first (pipeline stage history, migrations 0430-0433).** Before writing any SQL: `git fetch origin && git rebase origin/dev`,
  then find the body you copy with
  `grep -lE "create (or replace )?function (public\.)?transition_project\(" supabase/migrations/*.sql | sort | tail -1`.
  At review time that is `0236_project_status_declined_rules.sql`, and #1638's plan keeps it so (its D2/NFR-PSH-002: a trigger, not an edit).
  If the command names a later file, copy THAT body and apply E1-E6 to it; never re-derive from 0236 when a newer body exists.
  #1638 also re-creates `get_win_rate` (its Task 15) with the same `decided` CTE; S2 copies the cohort from the latest `get_win_rate`
  the same way. #1638 adds `advance_project_stage`, which `perform`s the 4-argument `transition_project` call: it keeps working for
  every non-lost target and is refused for lost targets (spec "Interaction with #1638"); S1-T1 proves that.

## 0. Decisions this plan builds

| Ref | Built as |
|---|---|
| DD-LR-1 | nine keys: `price competitor scope_fit timing capacity relationship client_cancelled no_decision other`; optional note <= 500; `other` needs a note |
| DD-LR-2 | `projects.lost_reason`, `projects.lost_note` (no new table); key, note and status CHECKs (FR-LR-009) |
| DD-LR-3 | `transition_project(p_id, p_to, p_customer_contract_ref, p_contract_date, p_lost_reason, p_lost_note)`, `P0001` when missing |
| DD-LR-4 | revive clears the columns; audit detail keeps them |
| DD-LR-5 | no backfill; null = "Not recorded" |
| DD-LR-6 | new `get_loss_breakdown(p_from, p_to)`, invoker, counts only; `get_win_rate` untouched |

## 1. File map

| File | Change | Slice |
|---|---|---|
| `supabase/migrations/0437_lost_reason.sql` | new | S1 |
| `supabase/migrations/rollback/0437_lost_reason_down.sql` | new | S1 |
| `supabase/tests/0437_lost_reason.test.sql` | new | S1 |
| `supabase/tests/0030_project_loss_path.test.sql`, `0236_project_declined_outcome.test.sql` | pass a reason | S1 |
| `scripts/isolation-probe-denominator.json` | definer entry `transition_project(uuid,project_status,text,date)` -> `transition_project(uuid,project_status,text,date,text,text)` | S1 |
| `supabase/migrations/0438_loss_breakdown.sql`, `rollback/0438_loss_breakdown_down.sql` | new | S2 |
| `supabase/tests/0438_loss_breakdown.test.sql` | new | S2 |
| `src/lib/supabase/database.types.ts` | regenerated | S3 |
| `src/lib/lostReasons.ts` (+ `.test.ts`) | new: keys, validity, i18n key map | S3 |
| `src/lib/db/projectTransitions.ts` (+ test) | `TransitionProjectOpts` gains `lostReason`, `lostNote`; RPC wrapper sends them | S3 |
| `src/lib/db/dashboard.ts`, `src/hooks/useDashboard.ts` | `getLossBreakdown`, `useLossBreakdown` | S3 |
| `src/hooks/projectQueryKeys.ts` | `'loss-breakdown'` root | S3 |
| `public/locales/{en,id}/lostReason.json`; `src/lib/i18n/index.ts` (`NAMESPACES` += `'lostReason'`); `test/bahasa.tsx` (load the namespace) | new namespace | S3 |
| `src/lib/db/dashboard.test.ts`, `src/hooks/useProjectTransitions.test.ts`, `src/lib/db/projectTransitions.test.ts` | new cases | S3 |
| `components/project-status/LostReasonFields.tsx` | new | S4 |
| `components/project-status/ProjectTransitionConfirm.tsx` | extend (from #1637) | S4 |
| `components/ProjectStatusControl.tsx` (+ existing `ProjectStatusControl.test.tsx:257-267` steps) | commit passes the reason | S4 |
| `pages/project-detail/PipelineLens.tsx` (+ existing `__tests__/PipelineLens.writePolicy.test.tsx:126,138` steps) | two confirms + reason line | S4 |
| `pages/sales-pipeline/DraggableSalesBoard.tsx` (+ #1637's `AC-DND-006` steps in `__tests__/DraggableSalesBoard.test.tsx`) | commit passes the reason (from #1637) | S4 |
| `src/components/dashboard/LossBreakdown.tsx` (+ test); `WinRateCard.tsx` | new block | S5 |
| `test/companyDashboardHarness.tsx` + the 7 test files that mock `@/src/hooks/useDashboard` and render the tile (S5-T3 sweep) | add `useLossBreakdown` to the mock factory | S5 |
| `e2e/AC-LR-017-lost-reason.spec.ts` | new | S6 |

## 2. Gate evidence (every slice; CLAUDE.md local final gate)

From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`,
`npx vitest run <directly touched test files>` (never the full suite). DB slices additionally, from the repo root, in ONE lock hold:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <touched files>'`. Sibling-mock grep before each FE slice:
`grep -rln "vi.mock(.*\(ProjectStatusControl\|PipelineLens\|WinRateCard\|useDashboard\|projectTransitions\)" pmo-portal --include=*.test.* | grep -v node_modules`
and run every file it returns. Report command + pass counts in `worker_done`.

CI traps pre-checked: **0137** (no new table, so nothing to grant; the assertion that every public base table grants
service_role INSERT is unaffected); **0136** (no side-mirror table added); **0178** (`transition_project` keeps its name,
so the retained-definer allow-list count is unchanged; the re-created function must have `anon`/`public` EXECUTE revoked, S1-T4;
`get_loss_breakdown` is `security invoker`, not a definer, and is NOT added to the allow-list); i18n parity (`npm run check:i18n`).
**Isolation denominator guard** (CI `pgtap` job, `.github/workflows/ci.yml:403-406`): it compares every SECURITY DEFINER
`regprocedure` against `scripts/isolation-probe-denominator.json` in both directions, so the new 6-argument signature is an
UNLISTED surface and the old 4-argument entry is STALE until S1 swaps the one line (`:400`). `get_loss_breakdown` is not a definer
and is not listed. **`scripts/pmo-load.test.mjs:72`** parses the transition map from the latest file matching
`create or replace function (public\.)?transition_project\(`: S1 therefore re-creates the function with `create or replace`
(after the drop), so that test reads 0437's map, not a stale one.

---

## S1: columns + `transition_project` (ships alone; money-path-adjacent)

### S1-T1 Failing pgTAP: `supabase/tests/0437_lost_reason.test.sql` (5 min)

Fixtures: one org, one PM (Project Manager), four projects (Negotiation, Tender Submitted, Leads, PQ Submitted). The role gate is
unchanged and stays proven by 0027 (S1-T5), so no Engineer fixture is needed here.
```sql
-- 0437_lost_reason.test.sql — #1577
-- AC-LR-001..007. Isolated org; UUID prefix 04370000-…
begin;
select plan(24);   -- 23 when #1638 is not on the base branch (drop the advance_project_stage assertion)

insert into organizations (id, name) values ('04370000-0000-0000-0000-000000000001', 'Lost Reason Org (0437)');
insert into auth.users (id, email) values ('04370000-0000-0000-0000-0000000000a1', 'pm@lostreason0437.example');
insert into profiles (id, org_id, full_name, email, role) values
  ('04370000-0000-0000-0000-0000000000a1', '04370000-0000-0000-0000-000000000001',
   'PM 0437', 'pm@lostreason0437.example', 'Project Manager');
insert into projects (id, org_id, code, name, status, project_manager_id, contract_value, tax_treatment, tax_amount) values
  ('04370000-0000-0000-0000-000000000101','04370000-0000-0000-0000-000000000001','L-A','A','Negotiation','04370000-0000-0000-0000-0000000000a1',0,'exclusive',0),
  ('04370000-0000-0000-0000-000000000102','04370000-0000-0000-0000-000000000001','L-B','B','Tender Submitted','04370000-0000-0000-0000-0000000000a1',0,'exclusive',0),
  ('04370000-0000-0000-0000-000000000103','04370000-0000-0000-0000-000000000001','L-C','C','Leads','04370000-0000-0000-0000-0000000000a1',0,'exclusive',0),
  ('04370000-0000-0000-0000-000000000104','04370000-0000-0000-0000-000000000001','L-D','D','PQ Submitted','04370000-0000-0000-0000-0000000000a1',0,'exclusive',0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"04370000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-LR-001
select lives_ok($$ select transition_project('04370000-0000-0000-0000-000000000101','Loss Tender',null,null,'price','Undercut by 8%') $$,
  'AC-LR-001: Negotiation -> Loss Tender with a reason succeeds');
select is((select lost_reason || '|' || lost_note from projects where id='04370000-0000-0000-0000-000000000101'),
  'price|Undercut by 8%', 'AC-LR-001: reason and note stored');
-- audit_events is readable by own-org Admin/Operator only (0076), so read it as the table owner.
reset role;
select is((select detail ->> 'lost_reason' from audit_events where action='project.transition'
            and entity_id='04370000-0000-0000-0000-000000000101' order by created_at desc limit 1),
  'price', 'AC-LR-001: audit detail carries the reason');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04370000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-LR-002 (null / blank / unknown, both lost statuses)
select throws_ok($$ select transition_project('04370000-0000-0000-0000-000000000102','Loss Tender') $$,
  'P0001', null, 'AC-LR-002: Loss Tender without a reason is refused');
select throws_ok($$ select transition_project('04370000-0000-0000-0000-000000000102','Declined',null,null,'  ') $$,
  'P0001', null, 'AC-LR-002: blank reason refused');
select throws_ok($$ select transition_project('04370000-0000-0000-0000-000000000102','Declined',null,null,'bogus') $$,
  'P0001', null, 'AC-LR-002: unknown reason key refused');
select is((select status::text from projects where id='04370000-0000-0000-0000-000000000102'),
  'Tender Submitted', 'AC-LR-002: refused call left the project unchanged');

-- AC-LR-003
select throws_ok($$ select transition_project('04370000-0000-0000-0000-000000000102','Loss Tender',null,null,'other',' ') $$,
  'P0001', null, 'AC-LR-003: other without a note refused');
select lives_ok($$ select transition_project('04370000-0000-0000-0000-000000000102','Loss Tender',null,null,'other','Client merged') $$,
  'AC-LR-003: other with a note succeeds');
select throws_ok($$ select transition_project('04370000-0000-0000-0000-000000000103','Declined',null,null,'price', repeat('x',501)) $$,
  'P0001', null, 'AC-LR-003: a note over 500 characters is refused');

-- AC-LR-004 revive clears, audit keeps, re-lose stores fresh
select lives_ok($$ select transition_project('04370000-0000-0000-0000-000000000103','Declined',null,null,'capacity',null) $$,
  'AC-LR-004: Leads -> Declined with capacity');
select lives_ok($$ select transition_project('04370000-0000-0000-0000-000000000103','Negotiation') $$,
  'AC-LR-004: Declined -> Negotiation (revive)');
select is((select lost_reason is null and lost_note is null from projects where id='04370000-0000-0000-0000-000000000103'),
  true, 'AC-LR-004: revive cleared the reason and note');
reset role;
select is((select count(*)::int from audit_events where action='project.transition'
            and entity_id='04370000-0000-0000-0000-000000000103' and detail ->> 'lost_reason' = 'capacity'),
  1, 'AC-LR-004: the earlier reason is still in its audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04370000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ select transition_project('04370000-0000-0000-0000-000000000103','Loss Tender',null,null,'timing',null) $$,
  'AC-LR-004: re-losing the revived deal succeeds');
select is((select lost_reason from projects where id='04370000-0000-0000-0000-000000000103'),
  'timing', 'AC-LR-004: the re-loss stores the new reason');

-- AC-LR-005 a reason passed with a non-lost target is never stored
select lives_ok($$ select transition_project('04370000-0000-0000-0000-000000000104','Quotation Submitted',null,null,'price','x') $$,
  'AC-LR-005: non-lost target with a stray reason succeeds');
select is((select lost_reason is null from projects where id='04370000-0000-0000-0000-000000000104'),
  true, 'AC-LR-005: stray reason not stored');

-- AC-LR-007 authenticated cannot write the columns directly
select throws_ok($$ update projects set lost_reason = 'price' where id='04370000-0000-0000-0000-000000000104' $$,
  '42501', null, 'AC-LR-007: direct UPDATE of lost_reason is denied');
select throws_ok($$ insert into projects (id, org_id, code, name, status, lost_reason)
    values ('04370000-0000-0000-0000-000000000199','04370000-0000-0000-0000-000000000001','L-X','X','Leads','price') $$,
  '42501', null, 'AC-LR-007: an INSERT naming lost_reason is denied (column-granted INSERT, 0173)');
-- #1638 only (skip and use plan(23) if `advance_project_stage` does not exist): the dated-move wrapper cannot lose a deal.
select throws_ok($$ select advance_project_stage('04370000-0000-0000-0000-000000000104','Loss Tender', current_date) $$,
  'P0001', null, 'AC-LR-007: advance_project_stage cannot reach the lost group without a reason');

reset role;
select throws_ok($$ update projects set lost_reason = 'price' where id='04370000-0000-0000-0000-000000000104' $$,
  '23514', null, 'AC-LR-007 (FR-LR-009): even the owner cannot put a reason on an open deal');
select ok(not has_function_privilege('anon', 'public.transition_project(uuid,project_status,text,date,text,text)', 'execute'),
  'AC-LR-007: anon cannot execute transition_project');
select ok(has_function_privilege('authenticated', 'public.transition_project(uuid,project_status,text,date,text,text)', 'execute'),
  'AC-LR-007: authenticated can execute transition_project');
select * from finish();
rollback;
```
Adjust `plan(N)` to the final assertion count (24 as drafted: count the assertion `select`s).
When the `advance_project_stage` line runs, AC-LR-005 has already moved project 104 to `Quotation Submitted`, and
`Quotation Submitted -> Loss Tender` is legal, so the P0001 it gets is the reason check, not the transition map.
Run it first (RED): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0437_lost_reason.test.sql'` fails (no such columns).

### S1-T2 AC-LR-006 pgTAP updates (3 min)
- `supabase/tests/0030_project_loss_path.test.sql:28` -> `transition_project('00300000-…0010','Loss Tender',null,null,'price',null)`.
- `supabase/tests/0236_project_declined_outcome.test.sql:33-41`: append `,null,null,'scope_fit',null` to each of the five legal
  `lives_ok(... ,'Declined') ...)` calls. The three illegal calls (`:49-55`) and the revive (`:58`, to `Negotiation`) stay as they are:
  the map check runs before the reason check and raises the same `P0001`.
- `0027` (cross-org, role-gate) and `0032` (anon) fail on authorization before the reason check, so they stay untouched; they are re-run in S1-T5.
- Every other pgTAP call of `transition_project` targets a non-lost status (swept: `grep -rnE "transition_project\([^)]*'(Loss Tender|Declined)'" supabase/tests`
  returns only 0027, 0030, 0032 and 0236), so no other test file changes.

### S1-T3 Migration `supabase/migrations/0437_lost_reason.sql` (10 min)

Header comment (public repo: describe what and why, no weakness language):
```sql
-- 0437_lost_reason.sql — #1577: a reason is required when a deal is lost or declined.
--   AC-LR-001..007. projects gains lost_reason / lost_note (nullable: historic losses stay "Not recorded").
--   transition_project gains p_lost_reason / p_lost_note. Body is 0236's VERBATIM except the six marked edits (⚑ 0437).
--   A reason exists only on a lost or declined deal (projects_lost_reason_status_check).
-- Reversibility: rollback/0437_lost_reason_down.sql restores 0236's function and drops the columns.

alter table public.projects
  add column lost_reason text,
  add column lost_note   text,
  add constraint projects_lost_reason_check check (lost_reason is null or lost_reason in
    ('price','competitor','scope_fit','timing','capacity','relationship','client_cancelled','no_decision','other')),
  add constraint projects_lost_note_check check (lost_note is null or (lost_reason is not null and char_length(lost_note) <= 500)),
  add constraint projects_lost_reason_status_check check (
    (lost_reason is null and lost_note is null) or status in ('Loss Tender','Declined'));
-- No UPDATE or INSERT grant is added: 0075 lists the updatable columns and 0173 the insertable ones explicitly, so
-- authenticated cannot write these directly. Existing rows are all null, so the constraints validate on apply.

drop function public.transition_project(uuid, project_status, text, date);
```
Then the function. **Build it from the latest body by copy, not by retyping** (`$SRC` = the file the header's #1638 command names;
`0236_project_status_declined_rules.sql` at review time):
```bash
cd <worktree root>
SRC=$(grep -lE "create (or replace )?function (public\.)?transition_project\(" supabase/migrations/*.sql | sort | tail -1)
test "$SRC" != supabase/migrations/0437_lost_reason.sql || echo "STOP: run this before 0437 has its function"
sed -nE '/^create or replace function (public\.)?transition_project\(/,/^end; \$\$;/p' "$SRC" >> supabase/migrations/0437_lost_reason.sql
# then apply ONLY edits E1-E6 to the appended function
```
Apply exactly these six edits to the copied function (everything else byte-identical, including every SECURITY comment):

- **E1 signature:** `create or replace function transition_project(` (or `… public.transition_project(` in a newer `$SRC`) becomes `create or replace function public.transition_project(`
  (keep `or replace`: `scripts/pmo-load.test.mjs:78` finds the latest map by that phrase) and the parameter list becomes
  `p_id uuid, p_to project_status, p_customer_contract_ref text default null, p_contract_date date default null,`
  `p_lost_reason text default null, p_lost_note text default null)`.
- **E2 declare**, after `v_role user_role := auth_role();` add
  `v_reason text := nullif(btrim(p_lost_reason), '');  -- ⚑ 0437` and `v_note text := nullif(btrim(p_lost_note), '');  -- ⚑ 0437`.
- **E3 validation**, immediately after the "Transition-map legality" `if ... raise exception 'illegal transition ...' end if;` and before `-- Branch on the target`:
```sql
  -- ⚑ 0437 (#1577, FR-LR-002/003): a lost or declined deal must say why. The role, org, membership and legality
  -- checks above run first, so an unauthorized or illegal call still gets its own error.
  if p_to in ('Loss Tender','Declined') then
    if v_reason is null or not (v_reason = any (array['price','competitor','scope_fit','timing','capacity',
         'relationship','client_cancelled','no_decision','other'])) then
      raise exception 'a reason is required when a deal is lost or declined' using errcode = 'P0001';
    end if;
    if v_reason = 'other' and v_note is null then
      raise exception 'a note is required when the reason is other' using errcode = 'P0001';
    end if;
    if char_length(v_note) > 500 then
      raise exception 'the note is limited to 500 characters' using errcode = 'P0001';
    end if;
  end if;
```
- **E4 loss branch** (`elsif p_to in ('Loss Tender','Declined') then`, 0236:167-172): after the line `decided_at  = now(),` insert
  `lost_reason = v_reason,  -- ⚑ 0437` and `lost_note   = v_note,    -- ⚑ 0437`.
- **E5 else (ordinary) branch** (0236:173-177): after the line `status      = p_to,` insert
  `lost_reason = null,  -- ⚑ 0437 FR-LR-005: a revived deal is no longer lost` and `lost_note   = null,  -- ⚑ 0437`.
  FR-LR-006: a stray reason on a non-lost target is never read. The win branch is untouched: a win is never legal from the
  lost group (Lost -> Negotiation only), and `projects_lost_reason_status_check` would refuse a won row carrying a reason.
- **E6 audit detail**, append two keys inside `jsonb_build_object(...)`:
  `'lost_reason', case when p_to in ('Loss Tender','Declined') then v_reason end,`
  `'lost_note',   case when p_to in ('Loss Tender','Declined') then v_note end`.

Then privileges (the old signature's ACL went with the drop; mirror 0008:150-152):
```sql
revoke all     on function public.transition_project(uuid, project_status, text, date, text, text) from public;
grant  execute on function public.transition_project(uuid, project_status, text, date, text, text) to   authenticated;
revoke execute on function public.transition_project(uuid, project_status, text, date, text, text) from anon;
```
Verify the body diff shows only E1-E6:
`diff <(sed -nE '/^create or replace function (public\.)?transition_project\(/,/^end; \$\$;/p' "$SRC") <(sed -n '/^create or replace function public\.transition_project(/,/^end; \$\$;/p' supabase/migrations/0437_lost_reason.sql)`.
Then swap the definer line in `scripts/isolation-probe-denominator.json` (`:400`):
`"transition_project(uuid,project_status,text,date)",` -> `"transition_project(uuid,project_status,text,date,text,text)",` (keep the list order).

### S1-T4 Rollback `supabase/migrations/rollback/0437_lost_reason_down.sql` (3 min)
`drop function public.transition_project(uuid, project_status, text, date, text, text);` then the `$SRC` function body verbatim
(`create or replace function transition_project(...)` copied the same way), then the same three grant lines with the 4-argument signature,
then `alter table public.projects drop constraint projects_lost_reason_status_check, drop constraint projects_lost_note_check, drop constraint projects_lost_reason_check, drop column lost_note, drop column lost_reason;`.
If #1638 is on the base branch its `advance_project_stage` keeps working across both directions: it calls `transition_project` by
name with four arguments, which resolves to either signature (plpgsql bodies hold no dependency on the dropped one).

### S1-T5 Green + siblings (5 min)
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0437_lost_reason.test.sql supabase/tests/0030_project_loss_path.test.sql supabase/tests/0236_project_declined_outcome.test.sql supabase/tests/0027_project_transition_authz.test.sql supabase/tests/0028_project_transition_legality.test.sql supabase/tests/0029_project_win_path.test.sql supabase/tests/0031_project_decided_at_preserved.test.sql supabase/tests/0032_pipeline_stage_config_rls.test.sql supabase/tests/0033_project_direct_update_revoked.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql supabase/tests/0176_witness_must_be_active.test.sql'`
(the win/SoD files prove the win branch is unchanged: FR-LR-007). If #1638 is on the base branch, append its
`supabase/tests/pipeline_stage_history_write.test.sql` to the same command, and in that file append `,null,null,'price',null` to its one
lost call (`transition_project('16380000-0000-0000-0000-000000000013','Loss Tender')`, #1638 plan Task 4): a step change, the
AC-PSH-002 date oracle is untouched; grep that file and its siblings `pipeline_stage_history_*.test.sql` for any other lost call.
Append `&& node scripts/check-isolation-denominator.mjs` inside the same `bash -c '…'` (it reads the freshly reset DB; green = the manifest swap is right). All green.
Then `node --test scripts/pmo-load.test.mjs scripts/check-isolation-denominator.test.mjs` (AC-CSD-014 reads 0437's map; the manifest still parses) and `npm run check:migrations` (from `pmo-portal/`, no number collision).

### S1-T6 Mutation check (3 min)
Temporarily edit the migration's E3 condition to `if false then` and re-run 0437: AC-LR-002/003 must go RED. Revert. Record in the report.
Commit: `feat(db): lost reason required on lost/declined transitions (#1577)`.

---

## S2: `get_loss_breakdown`

### S2-T1 Failing pgTAP `supabase/tests/0438_loss_breakdown.test.sql` (5 min)
Oracle fixtures (org A, prefix `04380000-…`; client names fixed so tie order is deterministic): clients C1 "Acme Client", C2 "Zeta Client".
Projects (status / client / reason / decided_at): W1 Ongoing C1 - 2026-01-10; W2 Ongoing C1 - 2026-02-05; L1 Loss Tender C1 price 2026-01-15;
L2 Loss Tender C2 price 2026-02-10; L3 Loss Tender C2 competitor 2026-02-12; D1 Declined C2 capacity 2026-02-14;
D2 Declined C1 price 2026-03-01; L4 Loss Tender C2 null (historic) decided_at null. Org B: one Loss Tender `price` 2026-01-20.
Insert as the table owner (before `set local role`) with 0236's project column set plus `client_id`, `lost_reason`, `decided_at`
(`project_manager_id` = org A's PM, so the PM's RLS read covers every row); companies as `insert into companies (id, org_id, name, type) values (…, 'Client')`
(the shape every pgTAP file uses). The FR-LR-009 CHECK allows `lost_reason` only on the Loss Tender / Declined fixtures, which is all this list sets.
Org B: one org, one PM profile, one `Client` company, one project. Run as org A's PM; assertion 8 switches `request.jwt.claims` to org B's PM.
Assertions (`plan(8)`):
1. `AC-LR-008` all-time `by_reason` equals, in order: `price` losses 2 declined 1; `capacity` 0/1; `competitor` 1/0; `null` 1/0. Compare `jsonb`:
   `select is(get_loss_breakdown() -> 'by_reason', '[{"reason":"price","losses_count":2,"declined_count":1}, … ]'::json)` (use `::jsonb` on both sides).
2. `AC-LR-008` org B's deal is absent (total of all counts = 7, not 8).
3. `AC-LR-008` all-time `by_client` equals `[Acme Client wins 2 losses 1, Zeta Client wins 0 losses 3]` (D1/D2 excluded).
4. `AC-LR-009` window `('2026-02-01','2026-02-28')` `by_reason` = `capacity 0/1, competitor 1/0, price 1/0` (L4 undated and L1/D2 outside excluded).
5. `AC-LR-009` same window `by_client` = `[Zeta Client 0/2, Acme Client 1/0]`.
6. `AC-LR-009` same window: the sum of all `by_reason` counts (3: L2, L3, D1) equals `get_win_rate('2026-02-01','2026-02-28')`'s `losses_count + declined_count` (2 + 1), so both read the same cohort.
7. `AC-LR-007` `has_function_privilege('anon','public.get_loss_breakdown(date,date)','execute')` is false; `authenticated` true.
8. `NFR-LR-002` as an org-B user the result contains only org B's row.
RED first (function absent).

### S2-T2 Migration `supabase/migrations/0438_loss_breakdown.sql` (5 min)
```sql
-- 0438_loss_breakdown.sql — #1577: loss counts by reason and by client for the win-rate tile.
-- security invoker (RLS scopes the org, like get_win_rate). Cohort and window = get_win_rate's decided cohort (0385;
-- #1638 re-creates get_win_rate with the same decided CTE: copy the three where-lines from the latest body).
create or replace function public.get_loss_breakdown(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with decided as (
    select p.status, p.client_id, p.lost_reason from projects p
    where ((p_from is null and p_to is null) or p.decided_at is not null)
      and (p_from is null or p.decided_at >= p_from)
      and (p_to   is null or p.decided_at <  (p_to + 1)::timestamptz)
  ),
  reasons as (
    select lost_reason as reason,
           (count(*) filter (where status = 'Loss Tender'))::int as losses_count,
           (count(*) filter (where status = 'Declined'))::int    as declined_count
    from decided where status in ('Loss Tender','Declined') group by lost_reason
  ),
  clients as (
    select d.client_id, c.name as client_name,
           (count(*) filter (where d.status::text = any(on_hand_project_statuses())))::int as wins_count,
           (count(*) filter (where d.status = 'Loss Tender'))::int as losses_count
    from decided d left join companies c on c.id = d.client_id
    where d.status::text = any(on_hand_project_statuses()) or d.status = 'Loss Tender'
    group by d.client_id, c.name
  )
  select json_build_object(
    'by_reason', coalesce((select json_agg(json_build_object('reason', reason, 'losses_count', losses_count,
                    'declined_count', declined_count) order by losses_count + declined_count desc, reason nulls last)
                  from reasons), '[]'::json),
    'by_client', coalesce((select json_agg(json_build_object('client_id', client_id, 'client_name', client_name,
                    'wins_count', wins_count, 'losses_count', losses_count)
                    order by wins_count + losses_count desc, client_name nulls last, client_id)
                  from (select * from clients
                        order by wins_count + losses_count desc, client_name nulls last, client_id limit 10) top), '[]'::json)
  );
$$;
revoke all     on function public.get_loss_breakdown(date, date) from public;
revoke execute on function public.get_loss_breakdown(date, date) from anon;
grant  execute on function public.get_loss_breakdown(date, date) to authenticated;
```
Rollback `rollback/0438_loss_breakdown_down.sql`: `drop function if exists public.get_loss_breakdown(date, date);`.

### S2-T3 Green (3 min)
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0438_loss_breakdown.test.sql supabase/tests/0437_lost_reason.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0040_win_rate_all_time.test.sql supabase/tests/0041_win_rate_timeframe.test.sql'`.
Commit: `feat(db): get_loss_breakdown (#1577)`.

---

## S3: FE data layer (no UI yet)

### S3-T1 Regenerate types (3 min)
After S1+S2 applied locally: `cd <worktree root> && supabase gen types typescript --local > /tmp/db.types.ts` then update
`pmo-portal/src/lib/supabase/database.types.ts` by taking only the hunks for `projects` (`lost_reason`, `lost_note` in Row/Insert/Update),
`transition_project` Args (`p_lost_note?: string`, `p_lost_reason?: string`) and `get_loss_breakdown` (Args `p_from?`, `p_to?`; Returns `Json`).
If the whole-file diff is larger than those hunks, keep only those hunks (do not reformat the file). `npm run typecheck`.

### S3-T2 Failing unit test + model `src/lib/lostReasons.ts` (5 min)
Test `src/lib/lostReasons.test.ts` (title tags `AC-LR-016`, `FR-LR-014`): the key list equals the nine keys in order; `lostReasonValid(null,'')` false;
`lostReasonValid('price','')` true; `lostReasonValid('other','  ')` false; `lostReasonValid('other','why')` true; `lostReasonValid('bogus','')` false;
`lostReasonValid('price','x'.repeat(501))` false; `lostReasonLabel((_k, d) => d, k)` returns the DD-LR-1 English label for each key and
"Not recorded" for `null`; and every key has an entry in `public/locales/en/lostReason.json` `reasons` and `public/locales/id/lostReason.json`
(read both with `fs.readFileSync`; fail if any key is missing).
```ts
// src/lib/lostReasons.ts — the nine stored keys (mirror of projects_lost_reason_check in 0437) and the one validity rule.
export const LOST_REASON_KEYS = [
  'price', 'competitor', 'scope_fit', 'timing', 'capacity', 'relationship', 'client_cancelled', 'no_decision', 'other',
] as const;
export type LostReasonKey = (typeof LOST_REASON_KEYS)[number];
export const LOST_NOTE_MAX = 500;

export function isLostReasonKey(v: string | null | undefined): v is LostReasonKey {
  return !!v && (LOST_REASON_KEYS as readonly string[]).includes(v);
}

/** One rule for all three call sites; the RPC re-enforces it (FR-LR-002/003). */
export function lostReasonValid(reason: string | null | undefined, note: string | null | undefined): boolean {
  if (!isLostReasonKey(reason)) return false;
  const n = (note ?? '').trim();
  if (n.length > LOST_NOTE_MAX) return false;
  return reason !== 'other' || n.length > 0;
}

type T = (key: string, defaultValue: string) => string;
/** The one label source (FR-LR-014). Literal keys + English defaults: unit tests run with empty catalogues
 *  (test/setup.ts:137-155) and the i18n completeness gate reads literal t() calls. null = "Not recorded". */
export function lostReasonLabel(t: T, key: string | null | undefined): string {
  switch (key) {
    case 'price': return t('lostReason:reasons.price', 'Price');
    case 'competitor': return t('lostReason:reasons.competitor', 'Lost to a competitor');
    case 'scope_fit': return t('lostReason:reasons.scope_fit', 'Scope or fit');
    case 'timing': return t('lostReason:reasons.timing', 'Timing');
    case 'capacity': return t('lostReason:reasons.capacity', 'Our capacity');
    case 'relationship': return t('lostReason:reasons.relationship', 'Relationship');
    case 'client_cancelled': return t('lostReason:reasons.client_cancelled', 'Client cancelled or postponed');
    case 'no_decision': return t('lostReason:reasons.no_decision', 'No decision from the client');
    case 'other': return t('lostReason:reasons.other', 'Other');
    default: return t('lostReason:notRecorded', 'Not recorded');
  }
}
```
Every call site passes its own `t` (from `useTranslation`); the `lostReason:` prefix makes the namespace explicit whatever the caller's default.

### S3-T3 i18n namespace (5 min)
`public/locales/en/lostReason.json`:
```json
{
  "field": { "reason": "Reason", "choose": "Choose a reason", "note": "Note", "noteOptional": "Note (optional)", "noteRequired": "Note (required for Other)", "noteHelp": "Up to 500 characters." },
  "reasons": {
    "price": "Price", "competitor": "Lost to a competitor", "scope_fit": "Scope or fit", "timing": "Timing", "capacity": "Our capacity",
    "relationship": "Relationship", "client_cancelled": "Client cancelled or postponed", "no_decision": "No decision from the client", "other": "Other"
  },
  "notRecorded": "Not recorded",
  "deal": { "label": "Lost reason", "noteLabel": "Note" },
  "breakdown": {
    "reasonsTitle": "Why deals were lost", "clientsTitle": "Win and loss by client", "none": "No lost deals in this period.",
    "lostCount": "{{n}} lost", "declinedCount": "{{n}} declined", "wonLost": "{{won}} won, {{lost}} lost",
    "unknownClient": "Unknown client", "errorTitle": "Couldn't load the loss breakdown", "retry": "Try again"
  }
}
```
`public/locales/id/lostReason.json` (same key tree): field: "Alasan" / "Pilih alasan" / "Catatan" / "Catatan (opsional)" / "Catatan (wajib untuk Lainnya)" / "Maksimal 500 karakter.";
reasons: "Harga" / "Kalah dari kompetitor" / "Lingkup atau kecocokan" / "Waktu" / "Kapasitas kami" / "Hubungan" / "Klien membatalkan atau menunda" / "Klien belum memutuskan" / "Lainnya";
notRecorded "Belum dicatat"; deal "Alasan kalah" / "Catatan"; breakdown "Mengapa deal kalah" / "Menang dan kalah per klien" / "Tidak ada deal kalah pada periode ini." /
"{{n}} kalah" / "{{n}} ditolak" / "{{won}} menang, {{lost}} kalah" / "Klien tidak dikenal" / "Rincian kalah gagal dimuat" / "Coba lagi".
(House style: common borrowed term where Indonesian apps use it; keep "deal".)
Register the namespace: append `'lostReason'` to `NAMESPACES` in `src/lib/i18n/index.ts:15` (an unlisted namespace is never fetched, so
`lostReason:` keys would render English in Indonesian). In `test/bahasa.tsx` add `EN_LOST_REASON`/`ID_LOST_REASON` reads and a
`lostReason` entry in both resource maps (same pattern as `project`), so AC-LR-016 can render Indonesian.
Verify: `npm run check:i18n` (if it reports an orphaned or unextracted key, follow its message; never add an allowlist entry for
a key this work owns); the S3-T2 test goes green; `npx vitest run src/lib/i18n/i18n.test.ts`.

### S3-T4 DAL + RPC wrapper (5 min)
Failing test first in `src/lib/db/projectTransitions.test.ts` (existing mock style): `transitionProject('p1','Loss Tender',{lostReason:'price',lostNote:'n'})` calls
`supabase.rpc('transition_project', { p_id:'p1', p_to:'Loss Tender', p_customer_contract_ref: undefined, p_contract_date: undefined, p_lost_reason:'price', p_lost_note:'n' })`;
and the existing win/ordinary cases stay unchanged (`toHaveBeenCalledWith`/`toEqual` treat an `undefined` key as absent; only a
`toStrictEqual` would need the two keys, and none is expected: check with `grep -n toStrictEqual src/lib/db/projectTransitions.test.ts`).
Implement in `src/lib/db/projectTransitions.ts`:
```ts
export interface TransitionProjectOpts {
  customerContractRef?: string;
  contractDate?: string;
  /** Required by the server for Loss Tender / Declined (one of LOST_REASON_KEYS). */
  lostReason?: string;
  lostNote?: string;
}
// transitionProject: add to the rpc args
//   p_lost_reason: opts?.lostReason,
//   p_lost_note: opts?.lostNote?.trim() || undefined,
```
No column-list change is needed: the deal page's `project` comes from `useProject` -> `getProject` (`src/lib/db/projects.ts:67,241`,
`select('*, …')`), so `lost_reason`/`lost_note` arrive with the regenerated `ProjectRow` type. `OPPORTUNITY_COLUMNS` is not used by `PipelineLens`.
`src/lib/db/dashboard.ts`:
```ts
export interface LossBreakdown {
  by_reason: Array<{ reason: string | null; losses_count: number; declined_count: number }>;
  by_client: Array<{ client_id: string | null; client_name: string | null; wins_count: number; losses_count: number }>;
}
export async function getLossBreakdown(from?: Date, to?: Date): Promise<LossBreakdown> {
  // same date-key handling as getWinRate (:209-216): copy its p_from / p_to derivation lines verbatim
  const { data, error } = await supabase.rpc('get_loss_breakdown', { p_from, p_to });
  if (error) throw new Error(error.message);
  return data as unknown as LossBreakdown;
}
```
`src/hooks/useDashboard.ts`:
```ts
export function useLossBreakdown(range: WinRateRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<LossBreakdown>({
    queryKey: ['loss-breakdown', orgId, range.key],
    queryFn: () => getLossBreakdown(range.from, range.to),
    enabled: Boolean(orgId),
  });
}
```
`src/hooks/projectQueryKeys.ts:12`: add `'loss-breakdown'` to the root list. Extend `src/hooks/useProjectTransitions.test.ts:171` roots array with `'loss-breakdown'` (FR-LR-035) -- write that assertion first, red, then add the root.
Tests: `src/lib/db/dashboard.test.ts` gets a `getLossBreakdown` case mirroring the `getWinRate` one (args pass-through, error throws).
Verify: `npx vitest run src/lib/lostReasons.test.ts src/lib/db/projectTransitions.test.ts src/lib/db/dashboard.test.ts src/hooks/useProjectTransitions.test.ts src/hooks/useDashboard.test.tsx` and `npm run typecheck`.
Commit: `feat(fe): lost reason data layer (#1577)`.

---

## S4: capture UI, three call sites + deal-page display (depends on #1637 S2 being on the base branch)

Precondition check (do not skip): `test -f pmo-portal/components/project-status/ProjectTransitionConfirm.tsx || echo STOP`.

### S4-T1 Failing test + `components/project-status/LostReasonFields.tsx` (5 min)
Tested through the menu in S4-T2 (AC-LR-010); this file is presentational. It reuses `SelectField` and `TextArea` from `@/src/components/ui` (`FormFields.tsx:315,384`).
```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextArea } from '@/src/components/ui';
import { LOST_REASON_KEYS, LOST_NOTE_MAX, lostReasonLabel } from '@/src/lib/lostReasons';

export interface LostReasonValue { reason: string; note: string }

export const LostReasonFields: React.FC<{ value: LostReasonValue; onChange: (v: LostReasonValue) => void; idPrefix: string }> = ({ value, onChange, idPrefix }) => {
  const { t } = useTranslation('lostReason');
  return (
    <div className="mt-3 grid gap-2" data-testid="lost-reason-fields">
      <SelectField
        id={`${idPrefix}-lost-reason`}
        label={t('field.reason', 'Reason')}
        required
        value={value.reason}
        placeholder={t('field.choose', 'Choose a reason')}
        onChange={(reason) => onChange({ ...value, reason })}
        options={LOST_REASON_KEYS.map((k) => ({ value: k, label: lostReasonLabel(t, k) }))}
      />
      <TextArea
        id={`${idPrefix}-lost-note`}
        label={value.reason === 'other' ? t('field.noteRequired', 'Note (required for Other)') : t('field.noteOptional', 'Note (optional)')}
        required={value.reason === 'other'}
        maxLength={LOST_NOTE_MAX}
        helper={t('field.noteHelp', 'Up to 500 characters.')}
        value={value.note}
        onChange={(note) => onChange({ ...value, note })}
      />
    </div>
  );
};
```
`TextArea` (`FormFields.tsx:304-315`) and `SelectField` (`:362-384`) take `label`, `value`, `onChange(value)`, `required`, `helper`, and pass
other native attributes (`id`, `maxLength`) through; `SelectField` has `placeholder`. If `npm run typecheck` refuses `t` for
`lostReasonLabel`'s `T` parameter, pass `(k, d) => String(t(k, d))`; do not widen `T`.

### S4-T2 Extend `ProjectTransitionConfirm` and the status menu (AC-LR-010, 10 min)
Failing test first: new `components/ProjectStatusControl.lostReason.test.tsx` (copy the render/mocks header of `components/ProjectStatusControl.test.tsx`, which mocks `@/src/hooks/useProjectTransitions` with two names only; do not add names).
Cases (titles lead with `AC-LR-010`): choosing `Loss Tender` opens "Mark project as lost" with a reason select whose value is empty and the "Mark lost" button disabled;
select "Price" -> enabled; select "Other" with empty note -> disabled, type a note -> enabled; Confirm calls `mutateAsync` with
`{ id, to: 'Loss Tender', opts: { lostReason: 'price', lostNote: undefined } }`; choosing a non-lost target shows no reason field (FR-LR-015); the server error path (`mutateAsync` rejects) toasts "Status change failed" with the message (AC-LR-013).
Implement in `components/project-status/ProjectTransitionConfirm.tsx` (the #1637 version, S2-T3 of its plan):
- Add `const lostTarget = (choice ?? [target]).some((s) => projectStatusGroup(s as never) === 'lost');`, local `const [lost, setLost] = useState<LostReasonValue>({ reason: '', note: '' })`.
- Render `<LostReasonFields idPrefix="confirm" value={lost} onChange={setLost} />` below the description (and below the radio choice, when present) **only if** `lostTarget`.
- `confirmDisabled={(!!choice && !picked) || (lostTarget && !lostReasonValid(lost.reason, lost.note))}`.
- Change the callback to `onConfirm: (to: ProjectStatus, lost?: LostReasonValue) => void`, called `onConfirm(choice ? (picked as ProjectStatus) : target, lostTarget ? lost : undefined)`.
In `components/ProjectStatusControl.tsx` (as #1637 S2-T4 leaves it): the render becomes
`onConfirm={(_to, lost) => void commitConfirm(lost)}`, and `commitConfirm = async (lost?: LostReasonValue) => {…}` passes
`opts: lost ? { lostReason: lost.reason, lostNote: lost.note.trim() || undefined } : undefined` to its `mutation.mutateAsync` call
(today `:151`, `opts: undefined`). Non-lost targets still send `opts: undefined`.
Existing tests: `npx vitest run components/ProjectStatusControl.test.tsx components/ProjectStatusControl.lostReason.test.tsx`.
`ProjectStatusControl.test.tsx:257-267` confirms a `Loss Tender` move and expects `opts: undefined`: add the "choose Price" step
before the click and expect `opts: { lostReason: 'price', lostNote: undefined }`. That is the deliberate contract change of this
issue (BDD rule: the goal, "the deal moves to Loss Tender", stays the oracle). Every other existing assertion passes unchanged.

### S4-T3 Deal page: two confirms + reason line (AC-LR-011, 013, 014; 10 min)
Failing test: `pages/project-detail/__tests__/PipelineLens.lostReason.test.tsx` (copy render/mocks from `PipelineLens.writePolicy.test.tsx`). Cases:
"Mark lost" confirm shows the picker, Confirm disabled until valid, sends `transition(project.id, 'Loss Tender', { lostReason, lostNote })`;
"Decline to bid" likewise with `'Declined'`; a rejected transition shows the existing inline error (`error` state, `PipelineLens.tsx:107`) and the deal stays; a lost deal with `lost_reason='price'`, `lost_note='x'` shows "Price" and "x" in the Decision area; historic lost shows "Not recorded"; an open deal shows neither.
Implement in `pages/project-detail/PipelineLens.tsx`:
- `const [lost, setLost] = useState<LostReasonValue>({ reason: '', note: '' })`, reset when `confirmAction` changes.
- Both `ConfirmDialog`s: `description` becomes a fragment `<><p>{existing text}</p><LostReasonFields idPrefix="lens" value={lost} onChange={setLost} /></>`; add `confirmDisabled={!lostReasonValid(lost.reason, lost.note)}`.
- `runTransition(to, opts?)` (`:185-195`) already forwards `opts` to `repositories.project.transition`; widen its inline `opts` type to
  `TransitionProjectOpts` and update the comment at `:192-193` ("a loss passes exactly two args") to "only the win and loss paths carry opts".
  Call `runTransition('Loss Tender', { lostReason: lost.reason, lostNote: lost.note.trim() || undefined })` (and the same for `'Declined'`).
  #1638 Task 36 also edits `runTransition` (extracts `afterMove`, adds `runDatedTransition`) and keeps Loss/Decline on `runTransition`:
  rebase first and apply this change to whatever `runTransition` is on the base branch.
- Reason line: in the `isTerminal` stats branch (`:282-292`) when `project.status` is `Loss Tender` or `Declined`, add a tile
  `{ label: t('lostReason:deal.label','Lost reason'), value: lostReasonLabel(t, project.lost_reason) }` and, when `project.lost_note`,
  render it as a muted line beneath the stat row (`<p data-testid="lost-note" className="text-xs text-muted-foreground">`). Open deals add nothing (FR-LR-021).
Existing tests: `PipelineLens.writePolicy.test.tsx:126` and `:138` expect `transitionProject` called with `('d1', 'Loss Tender')` /
`('d1', 'Declined')`: add the "choose a reason" step and expect the third argument `{ lostReason: …, lostNote: undefined }` (the same
deliberate contract change as S4-T2). Then run every `pages/project-detail/__tests__/PipelineLens.*.test.tsx`, `wave5-c3-pr2.test.tsx`,
`ProjectDetail.lens.test.tsx`, `ProjectDetail.prewin.test.tsx`, `PipelineLens.rbac.test.tsx`; change steps only where a lost confirm now needs a reason.

### S4-T4 Drag path (AC-LR-012, 5 min)
In #1637's `pages/sales-pipeline/DraggableSalesBoard.tsx` the Lost-column confirm is `<ProjectTransitionConfirm target="Loss Tender" choice={options} …onConfirm={(to) => …}>`.
Failing test in a new `pages/sales-pipeline/__tests__/DraggableSalesBoard.lostReason.test.tsx` (reuse #1637's `DraggableSalesBoard.test.tsx` harness and its `BoardDnd` seam): drop a Tender deal on Lost, pick Declined + reason "Our capacity", Confirm -> `mutateAsync` receives `{ id, to: 'Declined', opts: { lostReason: 'capacity', lostNote: undefined } }`; Confirm stays disabled with a choice but no reason.
Implement: #1637's render `onConfirm={(to) => void commit(pending.project, to)}` becomes
`onConfirm={(to, lost) => void commit(pending.project, to, lost ? { lostReason: lost.reason, lostNote: lost.note.trim() || undefined } : undefined)}`
(`commit`'s third parameter is the opts the win modal already passes).
Existing test: #1637's `AC-DND-006` (Tender -> Lost, pick Declined, confirm -> `to: 'Declined'`) now needs a reason before Confirm enables:
add the "choose a reason" step; its goal (`to: 'Declined'`) stays the oracle.
Verify: `npx vitest run pages/sales-pipeline/__tests__ components/project-status`. Commit: `feat(fe): lost reason picker on menu, deal page and drag (#1577)`.

---

## S5: the breakdown block in the win-rate tile

### S5-T1 Failing test `src/components/dashboard/__tests__/LossBreakdown.test.tsx` (5 min)
Mock `@/src/hooks/useDashboard`'s `useLossBreakdown` (pattern: `WinRateCard.test.tsx`). Cases (titles lead with the AC):
`AC-LR-015` rows render in given order with label, "{{n}} lost" and "{{n}} declined" (only when > 0), the `reason: null` row renders "Not recorded", clients render "{{won}} won, {{lost}} lost", `client_name: null` renders "Unknown client";
empty `by_reason` shows "No lost deals in this period." and omits the client list when `by_client` is empty; `isError` shows the retry button and clicking it calls `refetch`; while loading renders nothing (no flash).
`AC-LR-016`: wrap in `BahasaProvider` from `test/bahasa.tsx` (default locale `id`; S3-T3 added `lostReason` to it) and assert "Harga",
"Belum dicatat", "Mengapa deal kalah"; `AC-LR-018` (tile half): `expect((await axe(container)).violations).toEqual([])` with `import { axe } from 'jest-axe'`, as
`pages/MasterData.a11y.test.tsx:26` does.

### S5-T2 `src/components/dashboard/LossBreakdown.tsx` (8 min)
```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLossBreakdown, type WinRateRange } from '@/src/hooks/useDashboard';
import { Button } from '@/src/components/ui';
import { lostReasonLabel } from '@/src/lib/lostReasons';

export const LossBreakdown: React.FC<{ range: WinRateRange }> = ({ range }) => {
  const { t } = useTranslation('lostReason');
  const { data, isError, isPending, refetch } = useLossBreakdown(range);
  if (isPending) return null;
  if (isError || !data) {
    return (
      <div data-testid="loss-breakdown-error" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {t('breakdown.errorTitle', "Couldn't load the loss breakdown")}
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>{t('breakdown.retry', 'Try again')}</Button>
      </div>
    );
  }
  const max = Math.max(1, ...data.by_reason.map((r) => r.losses_count + r.declined_count));
  return (
    <div data-testid="loss-breakdown" className="mt-4 grid gap-4 border-t border-border pt-3">
      <section aria-label={t('breakdown.reasonsTitle', 'Why deals were lost')}>
        <h4 className="mb-2 text-xs font-semibold">{t('breakdown.reasonsTitle', 'Why deals were lost')}</h4>
        {data.by_reason.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('breakdown.none', 'No lost deals in this period.')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {data.by_reason.map((r) => {
              const total = r.losses_count + r.declined_count;
              return (
                <li key={r.reason ?? 'not-recorded'} className="grid gap-0.5" data-testid={`loss-reason-${r.reason ?? 'not_recorded'}`}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span>{lostReasonLabel(t, r.reason)}</span>
                    <span className="tabular text-muted-foreground">
                      {[r.losses_count > 0 && t('breakdown.lostCount', '{{n}} lost', { n: r.losses_count }),
                        r.declined_count > 0 && t('breakdown.declinedCount', '{{n}} declined', { n: r.declined_count })]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(total / max) * 100}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {data.by_client.length > 0 && (
        <section aria-label={t('breakdown.clientsTitle', 'Win and loss by client')}>
          <h4 className="mb-2 text-xs font-semibold">{t('breakdown.clientsTitle', 'Win and loss by client')}</h4>
          <ul className="grid gap-1 text-xs">
            {data.by_client.map((c) => (
              <li key={c.client_id ?? 'unknown'} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{c.client_name ?? t('breakdown.unknownClient', 'Unknown client')}</span>
                <span className="shrink-0 tabular text-muted-foreground">
                  {t('breakdown.wonLost', '{{won}} won, {{lost}} lost', { won: c.wins_count, lost: c.losses_count })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
```
Use only DESIGN.md tokens already used in `WinRateCard.tsx` (`bg-primary`, `bg-secondary`, `text-muted-foreground`, `border-border`).

### S5-T3 Mount in `WinRateCard.tsx` (3 min)
In the non-error, `hasBids` branch and the empty branch, after `{declinedNote}` render `<LossBreakdown range={activeRange} />`
(the empty-bids branch matters: a window with only declined deals still has a breakdown). Not in the `isError` branch.
Sibling mocks (a `vi.mock('@/src/hooks/useDashboard', () => ({…}))` factory without `useLossBreakdown` makes the import
`undefined`, and every test that renders the tile throws). Sweep, from `pmo-portal/`:
`grep -rl "vi.mock('@/src/hooks/useDashboard'" --include='*.test.tsx' --include='*Harness.tsx' . | grep -v node_modules | xargs grep -lE "WinRateCard|CompanyDashboard|ExecutiveDashboard|companyDashboardHarness|<Dashboard"`
At review time it returns `test/companyDashboardHarness.tsx` (shared factory, `:54`) and `pages/ExecutiveDashboard.test.tsx`,
`pages/__tests__/Dashboard.drillthrough.test.tsx`, `pages/__tests__/ExecutiveDashboard.figures.test.tsx`,
`src/components/dashboard/WinRateCard.test.tsx`, `src/components/dashboard/__tests__/WinRateCard.error.test.tsx`,
`src/components/dashboard/hub/company/CompanyDashboard.honesty.test.tsx`, `src/components/dashboard/hub/company/CompanyDashboard.rulings.test.tsx`.
In each factory add `useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() })` (renders nothing,
so their assertions are unaffected). Then run every test that renders the tile, mocked or not:
`grep -rlE "WinRateCard|CompanyDashboard|ExecutiveDashboard|companyDashboardHarness" --include='*.test.tsx' . | grep -v node_modules` (16 files at review time).
If `npm run check:dashboard-tiles` objects (it guards tile registration), the block is inside the existing tile, not a new tile: adjust nothing but report the output.
Verify: `npx vitest run <the files above> src/components/dashboard/__tests__/LossBreakdown.test.tsx`; `npm run check:guards`.
Commit: `feat(fe): win/loss by reason and client under the win-rate tile (#1577)`.

---

## S6: e2e journey, rendered proof, final gate

### S6-T1 `e2e/AC-LR-017-lost-reason.spec.ts` (10 min)
Read `docs/e2e-parallel-conventions.md` first. Header:
`// @e2e-isolation: self-isolated — creates its own uniquely named deal via service role, loses it, deletes it; no shared seed row is moved.`
Fixture shape = `e2e/AC-010-billing-kinds.spec.ts:19-40` (ORG_ID `00000000-0000-0000-0000-000000000001`, `requireServiceRoleKey()` from `./helpers`,
throw if absent, never skip): `beforeEach` inserts `{ id, org_id: ORG_ID, name: 'LR 1577 ' + runId, status: 'Negotiation', currency: 'USD',
contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0 }`; `afterEach` deletes `record_changes` for the id, then the project (a 23503 names
the next referencing table to add to the cleanup; never skip the delete).
Journey as an **Executive** (`signIn(page, 'exec@acme.test')`; the Company dashboard at `/` is the Executive hub, `App.tsx:172`, and Executive
passes the transition role gate): `page.goto('/projects/' + id)`, click the deal page's "Mark lost" button, assert `page.getByRole('dialog').getByRole('button', { name: 'Mark lost' })` is disabled
(the open button and the confirm share the label, so scope to the dialog),
select "Price" in the "Reason" select, confirm; reload and assert the "Lost reason" tile reads "Price"; `page.goto('/')` and assert
`getByTestId('loss-reason-price')` is visible and contains text matching `/\d+ lost/`.
Axe (AC-LR-018, confirm half): `new AxeBuilder({ page }).include('[role="dialog"]').analyze()` while the confirm is open, `violations` equal `[]`
(`@axe-core/playwright`). Do not gate on `process.env.CI`.
Run: `scripts/e2e-local.sh AC-LR-017` (use `--reset` only because this branch adds migrations, under the lock).

### S6-T2 Rendered proof (5 min)
`scripts/ux-proof.sh` on the Company dashboard route and a lost + an open deal page (the reason picker open at a mobile and a desktop width). Director does the one rendered review; fixes route back to one fix round (review-loop cap).

### S6-T3 Final gate and report
Repeat §2 with all touched files. Pre-push: `git log --format=%B origin/dev..HEAD | grep -qi co-authored && echo STOP`.
Report: branch, head SHA, commands + pass counts, deviations.

## 3. Deploy note (NFR-LR-009)

Back to front: `0437`+`0438` (DB), then the FE. Until the FE lands, a user on the old bundle who marks a deal lost sees the
server message "a reason is required when a deal is lost or declined" and the deal stays open; a reload picks up the picker.
No shim, no data loss. S1 can merge to `dev` before S4 only if the Director accepts that window on `dev` (it is the same window prod sees
between the DB push and the FE push); otherwise hold S1 and merge S1-S4 back to back.

## 4. Review routing

S1 and S2: `security-auditor` full depth (changed definer, new invoker read), `spec-reviewer`, `code-quality-reviewer`. S3-S6: `spec-reviewer`,
`code-quality-reviewer`, `security-auditor` quick confirm (no auth/RLS change in the FE), `design-reviewer` once for S4/S5.
No other plan or spec is edited. #1637's plan/spec stay as written; this plan extends their `ProjectTransitionConfirm`.

## 5. Traceability (AC -> owning test)

| AC | Test |
|---|---|
| AC-LR-001..005, 007 | `supabase/tests/0437_lost_reason.test.sql` |
| AC-LR-006 | `0027 0028 0029 0030 0031 0032 0033 0236` re-run (S1-T5) |
| AC-LR-008, 009 | `supabase/tests/0438_loss_breakdown.test.sql` |
| AC-LR-010, 013 (menu) | `components/ProjectStatusControl.lostReason.test.tsx` |
| AC-LR-011, 013 (deal page), 014 | `pages/project-detail/__tests__/PipelineLens.lostReason.test.tsx` |
| AC-LR-012 | `pages/sales-pipeline/__tests__/DraggableSalesBoard.lostReason.test.tsx` |
| AC-LR-015, 016, 018 (tile) | `src/components/dashboard/__tests__/LossBreakdown.test.tsx` (+ `src/lib/lostReasons.test.ts` for key parity and labels) |
| AC-LR-017, 018 (confirm) | `e2e/AC-LR-017-lost-reason.spec.ts` |
