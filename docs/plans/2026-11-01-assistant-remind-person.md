# Assistant "Remind this person" - implementation plan (#1639)

Spec: [`docs/specs/assistant-remind-person.spec.md`](../specs/assistant-remind-person.spec.md) (Draft, 2026-11-01; owner ruling
OD-GRILL-20261101 "Assistant reminders (#1594)"). Map #791. Role contract: `.claude/agents/eng-planner.md`.
Gate: **auth-adjacent** (a new cross-user write through a SECURITY DEFINER RPC). Not a money path. Executor:
Director-dispatched Orca workers (`docs/orca-dispatch.md`), one worker per slice, each slice its own branch.
**S1 (the RPC) ships alone**, and S2 waits for S1 on `dev` (S2's handler calls the S1 RPC).
Everything cited was checked against `origin/dev` at `6440a961` (migration head `0426_imprest_approval_route.sql`; the
0178 retained-RPC count is **104**, `supabase/tests/0178_anon_executable_definers.test.sql:306`). A path marked
**(new)** does not exist yet. The migration number is left as the literal `<NNNN>` for the coordinator to assign.

## Open questions (each has the default this plan takes)

The spec's OQ-1..7 carry their recommended defaults here (cap 20, rolling 24 h, on-request chip, no free text, any
active member, de-duplication from anyone, 10 per chip). Found while planning:

| # | Question | Default taken | Slice |
|---|---|---|---|
| PQ-1 | Two senders reminding the same task at the same moment could both pass the de-duplication check. | The send RPC also takes a per-task transaction lock, in ascending task-id order, so the second sender sees the first sender's row (`already_reminded`). Ascending order prevents lock-order deadlocks. | S1 |
| PQ-2 | Which "today" decides overdue on the server? | The **sender's** zone (profile, else org default, else UTC), the same rule `whats_overdue` uses (DD-AIN-1, `overdue.ts:60`), so the server agrees with the list the sender saw. | S1 |
| PQ-3 | Does the approve path need a `can()` preflight? | No new `can()` entity: `getPermissionCheck` returns `null` for `remind_overdue` (its `default` arm, `handler.ts:574-588`), so the approve path still re-derives org and role (`handler.ts:1717-1736`) and the RPC is the only authority (ADR-0016: `can()` is UX only; there is no FE button to gate). | S2 |
| PQ-4 | The offer line (FR-RMD-031) must appear only when the tool is registered. | `whats_overdue` becomes `makeWhatsOverdueAction({ offerReminders })`; the handler passes the kill-switch value. The exported `whatsOverdueAction` keeps `offerReminders: false`, so every existing import and test is unchanged. | S2 |

## Architecture

### Design decisions

1. **Reuse the shipped inbox, not a new channel.** The recipient's notification is written by the existing internal
   helper `notify_workflow_user` (`supabase/migrations/0237_workflow_notifications.sql:13-25`), which already refuses
   another org's user, an inactive member and the acting user. The bell already routes `metadata.entity.type = 'task'`
   to My tasks (`pmo-portal/src/components/shell/NotificationBell.tsx:63-68`). No UI change.
2. **The recipient is derived, never supplied.** The tool takes an optional task name; `prepare` resolves task ids from
   the caller's own `whats_overdue` facts; the approved value carries task ids; the RPC reads each task's
   `assignee_id`. A model or client cannot address an arbitrary user.
3. **One shared check, two RPCs.** `task_reminder_check` (internal, no client grant) holds every rule;
   `preview_task_reminders` (read, no writes) lets `prepare` show only eligible reminders and the remaining allowance;
   `send_task_reminders` re-runs the same check at send time, under locks, and writes. The preview is advisory; the send
   is the authority.
4. **A ledger table for the cap and de-duplication.** `task_reminders` (org, sender, recipient, task, time). The
   notifications table has no sender column and must stay owner-private, so it cannot count a sender's sends.
5. **Coarse tool for a weak selector (ADR-0079 §1).** `remind_overdue` with no arguments covers "remind whoever is
   late", so the model needs one call with no ids. The prompt skill and the server-written offer line steer it; the
   eval is the proof (ADR-0052).

### Data flow

```
user: "remind whoever is late"
  -> model calls remind_overdue {}                                  (handler.ts:1036 propose branch)
  -> validate -> prepare (caller JWT):
       loadOverdueFacts(ctx)  -> tasks with assigneeId != caller     (overdue.ts, RLS-scoped)
       rpc preview_task_reminders(task ids) -> eligible + remaining (definer, read-only)
  -> needs-approval chip: "Send 2 reminders: <name> - <task> (due 2 Oct); ..."   stream ends
user approves
  -> validatePrepared(replayed value) -> deputy re-auth (org, role) -> run
  -> rpc send_task_reminders(task ids)  (definer: active sender, locks, check, cap, ledger insert, notify_workflow_user)
  -> per-task outcomes back to the model; recipient's bell shows "Reminder: a task is overdue" -> My tasks
```

### Slice map

| Slice | Branch | Contents | ACs |
|---|---|---|---|
| S1 | `feat/1639-s1-task-reminders-rpc` | migration, rollback, pgTAP, 0178, denominator, types | AC-RMD-001..012 |
| S2 | `feat/1639-s2-remind-overdue-action` | action module, schema, overdue offer line, handler registration, prompt, Vitest | AC-RMD-013..019, 023 |
| S3 | same branch as S2 | eval suite, `noProposal` scorer, fixture README | AC-RMD-020..022 |
| S4 | same branch as S2 | curated e2e | AC-RMD-024 |

## Conventions every task follows

- pgTAP files are self-contained: `begin; create extension if not exists pgtap; select plan(N);` ...
  `select * from finish(); rollback;`. Vitest next to the agent tests in `pmo-portal/src/lib/agent/`. The AC tag is the
  leading token of every pgTAP description, `it(...)` and `test(...)` title.
- DB commands under the lock, reset and test in one hold:
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<file>.test.sql'` (repo root).
- Function ACL (hosted-grants lesson, 0185/0210): every function ends with `revoke all ... from public, anon;`,
  internals also `from authenticated`; client RPCs then `grant execute ... to authenticated`. The migration ends with a
  closing self-assertion block that raises if the ACL shape is wrong.
- Public repo: fixtures use the synthetic prefix `16390000-...` and `@example.com`; role-shaped display names only.
- Local final gate per slice (CLAUDE.md, from `pmo-portal/`): `npm run check:guards`, `npm run typecheck`,
  `npx eslint --max-warnings=0 <touched files>`, the touched test files only. Commits are conventional with no
  attribution trailers; before every push `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must NOT match.

---

## S1 - Ledger and RPCs (`supabase/migrations/<NNNN>_task_reminders.sql`) - ships alone

### S1.1 Failing test first: the shared fixture and AC-RMD-001 (3 min)

Create `supabase/tests/task_reminders.test.sql` **(new)**:

```sql
-- task_reminders.test.sql — AC-RMD-001..012 (#1639). Each rule has a case that changes the outcome when the rule is
-- removed (mutation-check: comment out a rule in task_reminder_check and its case goes red).
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name) values
  ('16390000-0000-0000-0000-00000000000a', 'RMD Org A'),
  ('16390000-0000-0000-0000-00000000000b', 'RMD Org B');
insert into auth.users (id, email) values
  ('16390000-0000-0000-0000-0000000000a1', 'rmd-pm@example.com'),
  ('16390000-0000-0000-0000-0000000000a2', 'rmd-eng@example.com'),
  ('16390000-0000-0000-0000-0000000000a3', 'rmd-disabled@example.com'),
  ('16390000-0000-0000-0000-0000000000a4', 'rmd-banned@example.com'),
  ('16390000-0000-0000-0000-0000000000a5', 'rmd-pm2@example.com'),
  ('16390000-0000-0000-0000-0000000000b1', 'rmd-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status, timezone) values
  ('16390000-0000-0000-0000-0000000000a1', '16390000-0000-0000-0000-00000000000a', 'Project manager', 'rmd-pm@example.com', 'Project Manager', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a2', '16390000-0000-0000-0000-00000000000a', 'Site engineer', 'rmd-eng@example.com', 'Engineer', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a3', '16390000-0000-0000-0000-00000000000a', 'Disabled member', 'rmd-disabled@example.com', 'Engineer', 'disabled', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a4', '16390000-0000-0000-0000-00000000000a', 'Banned member', 'rmd-banned@example.com', 'Engineer', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a5', '16390000-0000-0000-0000-00000000000a', 'Second manager', 'rmd-pm2@example.com', 'Project Manager', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000b1', '16390000-0000-0000-0000-00000000000b', 'Org B member', 'rmd-b@example.com', 'Engineer', 'active', 'UTC');
update auth.users set banned_until = now() + interval '1 day' where id = '16390000-0000-0000-0000-0000000000a4';

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('16390000-0000-0000-0000-0000000000c1', '16390000-0000-0000-0000-00000000000a', 'RMD Proj A', 'Ongoing Project', date '2026-01-01', date '2027-12-31'),
  ('16390000-0000-0000-0000-0000000000c2', '16390000-0000-0000-0000-00000000000b', 'RMD Proj B', 'Ongoing Project', date '2026-01-01', date '2027-12-31');

-- Inserted as the table owner (auth.uid() is null), so the 0237 assignment trigger writes no notification.
-- t1/t10/t11 overdue -> site engineer; t2 overdue -> PM (self); t3 org B; t4 disabled; t5 banned; t6 Done;
-- t7 due today; t9 unassigned.
insert into tasks (id, org_id, project_id, name, status, end_date, assignee_id) values
  ('16390000-0000-0000-0000-0000000000d1', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD late pour', 'In Progress', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-0000000000d2', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD own task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a1'),
  ('16390000-0000-0000-0000-0000000000d3', '16390000-0000-0000-0000-00000000000b', '16390000-0000-0000-0000-0000000000c2', 'RMD org B task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000b1'),
  ('16390000-0000-0000-0000-0000000000d4', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD disabled task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a3'),
  ('16390000-0000-0000-0000-0000000000d5', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD banned task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a4'),
  ('16390000-0000-0000-0000-0000000000d6', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD done task', 'Done', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-0000000000d7', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD due today', 'To Do', (now() at time zone 'UTC')::date, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-0000000000d9', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD unassigned', 'Blocked', (now() at time zone 'UTC')::date - 3, null),
  ('16390000-0000-0000-0000-000000000d10', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD cap task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-000000000d11', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD preview task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2');

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
-- outcomes of a send/preview result, ordered by task id (the RPC processes ids in ascending order)
create function pg_temp.outcomes(r jsonb) returns text[] language sql immutable as $$
  select array_agg(i->>'outcome' order by i->>'task_id') from jsonb_array_elements(r->'items') i $$;
-- reminder notifications an owner holds (read as the table owner, outside RLS)
create function pg_temp.reminders_for(p uuid) returns int language sql stable as $$
  select count(*)::int from notifications where owner_id = p and title = 'Reminder: a task is overdue' $$;

-- AC-RMD-001
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d1'::uuid])), array['sent'],
  'AC-RMD-001 a reminder for an overdue task assigned to an active colleague is sent');
reset role;
select is((select count(*)::int from notifications where owner_id = '16390000-0000-0000-0000-0000000000a2'
            and title = 'Reminder: a task is overdue' and metadata->'entity'->>'type' = 'task'
            and metadata->'entity'->>'id' = '16390000-0000-0000-0000-0000000000d1'), 1,
  'AC-RMD-001 the assignee has one reminder notification that opens the task');
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from task_reminders where task_id = '16390000-0000-0000-0000-0000000000d1'
            and recipient_id = '16390000-0000-0000-0000-0000000000a2'), 1,
  'AC-RMD-001 the sender reads one ledger row naming recipient and task');
```

Close the file with `select * from finish(); rollback;` for now. Run (expect RED: `send_task_reminders` does not exist):
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/task_reminders.test.sql'`.

### S1.2 The ledger table (3 min)

Create `supabase/migrations/<NNNN>_task_reminders.sql` **(new)**:

```sql
-- <NNNN>_task_reminders.sql — assistant "Remind this person" (#1639, OD-GRILL-20261101; spec assistant-remind-person).
-- A sender-readable ledger + one internal rule function + two client RPCs. The recipient's in-app notification is
-- written by the shipped helper notify_workflow_user (0237), which is reused, not re-derived.
-- Reverse (also supabase/migrations/rollback/<NNNN>_task_reminders_down.sql):
--   drop function if exists public.send_task_reminders(uuid[]);
--   drop function if exists public.preview_task_reminders(uuid[]);
--   drop function if exists public.task_reminder_check(uuid, uuid, uuid);
--   drop function if exists public.task_reminder_daily_cap();
--   drop table if exists public.task_reminders;

create table public.task_reminders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  sender_id    uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  created_at   timestamptz not null default now()
);
comment on table public.task_reminders is
  'FR-RMD-014/016/020 — one row per reminder sent. Written only by send_task_reminders (SECURITY DEFINER), which sets '
  'org_id from the caller''s org explicitly; readable only by its sender in their org.';
create index task_reminders_sender_recent_idx    on public.task_reminders (sender_id, created_at desc);
create index task_reminders_task_recipient_idx   on public.task_reminders (task_id, recipient_id, created_at desc);

alter table public.task_reminders enable row level security;
alter table public.task_reminders force row level security;
create policy task_reminders_select on public.task_reminders for select
  using (sender_id = auth.uid() and org_id = auth_org_id());
revoke all on public.task_reminders from public, anon, authenticated;
grant select on public.task_reminders to authenticated;
```

### S1.3 The internal rule function and the cap (4 min)

Append to the migration:

```sql
-- FR-RMD-014 / OQ-1: the per-sender cap over a rolling 24 hours (OQ-2). One place, read by both RPCs.
create or replace function public.task_reminder_daily_cap() returns integer
  language sql immutable set search_path = public as $$ select 20 $$;

-- FR-RMD-012: every send rule, in one place. SECURITY DEFINER because it reads profiles/auth.users rows RLS hides.
-- ⚑ MIRRORS tasks_select (0002_rls.sql:91: org-scoped, active members): a task is reachable here only in the caller's
-- org, and both callers assert the caller is an active member first. If tasks_select narrows, narrow this too.
create or replace function public.task_reminder_check(p_sender uuid, p_org uuid, p_task uuid)
  returns table (outcome text, recipient_id uuid, task_name text, due_date date)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t record;
  v_today date;
begin
  select k.name, k.status, k.end_date, k.assignee_id, k.archived_at, k.tombstoned_at
    into t from public.tasks k where k.id = p_task and k.org_id = p_org;
  if not found or t.archived_at is not null or t.tombstoned_at is not null then
    return query select 'not_found'::text, null::uuid, null::text, null::date; return;
  end if;
  -- PQ-2 / DD-AIN-1: "today" in the sender's zone, else the org's, else UTC.
  select (now() at time zone coalesce(nullif(p.timezone, ''), o.default_timezone, 'UTC'))::date into v_today
    from public.profiles p join public.organizations o on o.id = p.org_id where p.id = p_sender;
  if t.status not in ('To Do', 'In Progress', 'Blocked') or t.end_date is null or t.end_date >= v_today then
    return query select 'not_overdue'::text, null::uuid, t.name::text, t.end_date; return;
  end if;
  if t.assignee_id is null then
    return query select 'no_assignee'::text, null::uuid, t.name::text, t.end_date; return;
  end if;
  if t.assignee_id = p_sender then
    return query select 'self'::text, null::uuid, t.name::text, t.end_date; return;
  end if;
  if not exists (select 1 from public.profiles r where r.id = t.assignee_id and r.org_id = p_org)
     or not public.is_active_member(t.assignee_id) then
    return query select 'recipient_inactive'::text, null::uuid, t.name::text, t.end_date; return;
  end if;
  -- OQ-6: one reminder per task and recipient per window, from anyone.
  if exists (select 1 from public.task_reminders x
              where x.task_id = p_task and x.recipient_id = t.assignee_id and x.created_at > now() - interval '24 hours') then
    return query select 'already_reminded'::text, t.assignee_id, t.name::text, t.end_date; return;
  end if;
  return query select 'eligible'::text, t.assignee_id, t.name::text, t.end_date;
end $$;

revoke all on function public.task_reminder_daily_cap() from public, anon, authenticated;
revoke all on function public.task_reminder_check(uuid, uuid, uuid) from public, anon, authenticated;
```

### S1.4 `preview_task_reminders` (3 min)

```sql
-- FR-RMD-018: the same checks, no writes. Returns {remaining, items:[{task_id, outcome, task_name, due_date, recipient_name}]}.
create or replace function public.preview_task_reminders(p_task_ids uuid[]) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_used int;
  v_items jsonb := '[]'::jsonb;
  v_id uuid;
  c record;
begin
  perform public.assert_is_active_member();
  if coalesce(cardinality(p_task_ids), 0) not between 1 and 10 then
    raise exception 'between 1 and 10 tasks may be reminded at once' using errcode = '22023';
  end if;
  select count(*) into v_used from public.task_reminders
   where sender_id = v_me and created_at > now() - interval '24 hours';
  foreach v_id in array (select array_agg(distinct x order by x) from unnest(p_task_ids) x) loop
    select * into c from public.task_reminder_check(v_me, v_org, v_id);
    v_items := v_items || jsonb_build_object(
      'task_id', v_id, 'outcome', c.outcome, 'task_name', c.task_name, 'due_date', c.due_date,
      'recipient_name', case when c.outcome = 'eligible'
                             then (select p.full_name from public.profiles p where p.id = c.recipient_id) end);
  end loop;
  return jsonb_build_object('remaining', greatest(public.task_reminder_daily_cap() - v_used, 0), 'items', v_items);
end $$;
revoke all on function public.preview_task_reminders(uuid[]) from public, anon;
grant execute on function public.preview_task_reminders(uuid[]) to authenticated;
```

### S1.5 `send_task_reminders` (4 min)

```sql
-- FR-RMD-010..017. Item-level refusals are outcomes, never exceptions (FR-RMD-013); only the caller gate (42501) and the
-- batch size (22023) raise.
create or replace function public.send_task_reminders(p_task_ids uuid[]) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_used int;
  v_out jsonb := '[]'::jsonb;
  v_sender text;
  v_id uuid;
  c record;
begin
  perform public.assert_is_active_member();
  if coalesce(cardinality(p_task_ids), 0) not between 1 and 10 then
    raise exception 'between 1 and 10 tasks may be reminded at once' using errcode = '22023';
  end if;
  -- FR-RMD-014: serialise this sender's sends so the cap count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('task_reminders:sender:' || v_me::text, 0));
  select count(*) into v_used from public.task_reminders
   where sender_id = v_me and created_at > now() - interval '24 hours';
  select coalesce(nullif(btrim(p.full_name), ''), 'A colleague') into v_sender from public.profiles p where p.id = v_me;

  foreach v_id in array (select array_agg(distinct x order by x) from unnest(p_task_ids) x) loop
    -- PQ-1: per-task lock, taken in ascending id order, so concurrent senders de-duplicate without deadlock.
    perform pg_advisory_xact_lock(hashtextextended('task_reminders:task:' || v_id::text, 0));
    select * into c from public.task_reminder_check(v_me, v_org, v_id);
    if c.outcome <> 'eligible' then
      v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', c.outcome);
      continue;
    end if;
    if v_used >= public.task_reminder_daily_cap() then
      v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', 'daily_limit');
      continue;
    end if;
    insert into public.task_reminders (org_id, sender_id, recipient_id, task_id)
      values (v_org, v_me, c.recipient_id, v_id);
    -- FR-RMD-017: server-written text; notify_workflow_user re-checks org, active membership and not-self.
    perform public.notify_workflow_user(v_org, c.recipient_id, 'Reminder: a task is overdue',
      v_sender || ' reminded you: "' || c.task_name || '" was due ' || to_char(c.due_date, 'FMDD Mon YYYY') || '.',
      'info', 'task', v_id, c.task_name);
    v_used := v_used + 1;
    v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', 'sent');
  end loop;
  return jsonb_build_object('remaining', greatest(public.task_reminder_daily_cap() - v_used, 0), 'items', v_out);
end $$;
revoke all on function public.send_task_reminders(uuid[]) from public, anon;
grant execute on function public.send_task_reminders(uuid[]) to authenticated;
```

### S1.6 Closing self-assertion and rollback file (3 min)

Append to the migration:

```sql
do $$
declare v text;
begin
  foreach v in array array['public.preview_task_reminders(uuid[])', 'public.send_task_reminders(uuid[])'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or not has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '<NNNN>: % ACL is not the intended shape', v;
    end if;
  end loop;
  foreach v in array array['public.task_reminder_check(uuid, uuid, uuid)', 'public.task_reminder_daily_cap()'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '<NNNN>: internal % is client-executable', v;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.task_reminders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.task_reminders', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '<NNNN>: task_reminders ACL is not the intended shape';
  end if;
end $$;
```

Create `supabase/migrations/rollback/<NNNN>_task_reminders_down.sql` **(new)** = the header's five `drop` lines,
uncommented, in that order. Re-run the S1.1 command: the three AC-RMD-001 cases go GREEN.

### S1.7 Rule cases AC-RMD-002..008 (4 min)

Insert before `finish()` in `task_reminders.test.sql`:

```sql
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d2'::uuid])), array['self'],
  'AC-RMD-002 the sender is never reminded about their own task');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d3'::uuid])), array['not_found'],
  'AC-RMD-003 another org''s task is not found');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d4'::uuid,
                                                     '16390000-0000-0000-0000-0000000000d5'::uuid])),
  array['recipient_inactive', 'recipient_inactive'], 'AC-RMD-004 disabled and banned assignees are not reminded');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d6'::uuid,
                                                     '16390000-0000-0000-0000-0000000000d7'::uuid,
                                                     '16390000-0000-0000-0000-0000000000d9'::uuid])),
  array['not_overdue', 'not_overdue', 'no_assignee'], 'AC-RMD-008 done or due-today tasks are not overdue; unassigned has no recipient');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a5');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d1'::uuid])), array['already_reminded'],
  'AC-RMD-006 a second sender within 24 hours does not repeat the reminder');
reset role;
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a2'), 1,
  'AC-RMD-006 the assignee still holds exactly one reminder');
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000b1'), 0,
  'AC-RMD-003 the other org''s assignee received nothing');
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a3') + pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a4'), 0,
  'AC-RMD-004 inactive assignees received nothing');
```

### S1.8 Cap, sender gate, batch size (4 min)

```sql
-- AC-RMD-005: 20 sends by the second manager in the last hour (as owner; the Done task keeps them off the target task)
insert into task_reminders (org_id, sender_id, recipient_id, task_id, created_at)
select '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000a5',
       '16390000-0000-0000-0000-0000000000a2', '16390000-0000-0000-0000-0000000000d6', now() - interval '1 hour'
  from generate_series(1, 20);
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a5');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-000000000d10'::uuid])), array['daily_limit'],
  'AC-RMD-005 the 21st reminder in 24 hours is refused');
reset role;
update task_reminders set created_at = now() - interval '25 hours'
 where sender_id = '16390000-0000-0000-0000-0000000000a5';
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a5');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-000000000d10'::uuid])), array['sent'],
  'AC-RMD-005 reminders older than 24 hours do not count');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a3');
select throws_ok($$ select send_task_reminders(array['16390000-0000-0000-0000-0000000000d1'::uuid]) $$, '42501', null,
  'AC-RMD-007 a disabled sender is refused');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select throws_ok($$ select send_task_reminders((select array_agg(gen_random_uuid()) from generate_series(1, 11))) $$, '22023', null,
  'AC-RMD-011 more than 10 tasks is refused');
select throws_ok($$ select send_task_reminders(array[]::uuid[]) $$, '22023', null, 'AC-RMD-011 an empty batch is refused');
```

### S1.9 Ledger visibility and ACL (4 min)

```sql
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from task_reminders), 0, 'AC-RMD-009 the recipient does not read the sender''s ledger');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from task_reminders), 0, 'AC-RMD-009 another org reads no ledger rows');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into task_reminders (org_id, sender_id, recipient_id, task_id) values
  ('16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000a1', '16390000-0000-0000-0000-0000000000a2',
   '16390000-0000-0000-0000-0000000000d1') $$, '42501', null, 'AC-RMD-009 no client inserts a ledger row');
select throws_ok($$ update task_reminders set created_at = now() - interval '2 days' $$, '42501', null,
  'AC-RMD-009 no client rewrites a ledger row');
select throws_ok($$ delete from task_reminders $$, '42501', null, 'AC-RMD-009 no client deletes a ledger row');
reset role;
select ok(not has_function_privilege('anon', p, 'EXECUTE'), 'AC-RMD-010 anon cannot execute ' || p)
  from unnest(array['public.send_task_reminders(uuid[])', 'public.preview_task_reminders(uuid[])']) p;
select ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-RMD-010 authenticated may execute ' || p)
  from unnest(array['public.send_task_reminders(uuid[])', 'public.preview_task_reminders(uuid[])']) p;
select ok(not has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-RMD-010 authenticated cannot execute internal ' || p)
  from unnest(array['public.task_reminder_check(uuid, uuid, uuid)', 'public.task_reminder_daily_cap()']) p;
```

### S1.10 Preview writes nothing (3 min)

The preview is read-only, so each assertion calls it inline (no temp table under the `authenticated` role):

```sql
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is(pg_temp.outcomes(preview_task_reminders(array['16390000-0000-0000-0000-000000000d11'::uuid, '16390000-0000-0000-0000-0000000000d2'::uuid])),
  array['self', 'eligible'], 'AC-RMD-012 preview reports the same outcomes as send');
select is((select i->>'recipient_name'
             from jsonb_array_elements(preview_task_reminders(array['16390000-0000-0000-0000-000000000d11'::uuid])->'items') i),
  'Site engineer', 'AC-RMD-012 preview names the eligible recipient');
select is((preview_task_reminders(array['16390000-0000-0000-0000-000000000d11'::uuid])->>'remaining')::int, 19,
  'AC-RMD-012 preview reports the remaining allowance');
select is((select count(*)::int from task_reminders where task_id = '16390000-0000-0000-0000-000000000d11'), 0,
  'AC-RMD-012 preview writes no ledger row');
reset role;
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a2'), 2,
  'AC-RMD-012 preview writes no notification (only the two real sends exist)');
```

`self` sorts before `eligible` because `...0000000000d2` < `...000000000d11` as text. The two real sends to the site
engineer are AC-RMD-001's and AC-RMD-005's second call; the 19 is 20 minus AC-RMD-001's one send by this sender.
`plan(32)` = S1.1 3 + S1.7 8 + S1.8 5 + S1.9 11 (5 single cases + 3 `unnest` lines yielding 2 each) + S1.10 5.
Run the S1.1 command; all 32 GREEN.
**Mutation check:** comment out the `t.assignee_id = p_sender` arm and re-run: AC-RMD-002 must go RED (it would read
`sent`); restore. Repeat for the `is_active_member` arm (AC-RMD-004) and the cap arm (AC-RMD-005).

### S1.11 0178 allow-list, isolation denominator, types (4 min)

- `supabase/tests/0178_anon_executable_definers.test.sql`: add `('preview_task_reminders')` and `('send_task_reminders')`
  to `client_callable_rpc_names` (sorted); add the header note
  `-- ⚑ AMENDED BY <NNNN> (#1639): preview_task_reminders and send_task_reminders join the retained set (+2, count 106). Each
  -- asserts active membership and the caller's org in its body; proven by supabase/tests/task_reminders.test.sql.`;
  change both hard-coded counts `104` to `106` (lines 306 and 316 at `6440a961`). Re-derive by hand after any rebase.
- `scripts/isolation-probe-denominator.json`: add to `tables`
  `{"table":"task_reminders","has_org":true,"pk":"id","columns":"*","b_read":"own-org-only","by_id":"applicable"}`;
  to `definer_functions` `"preview_task_reminders(uuid[])"`, `"send_task_reminders(uuid[])"`,
  `"task_reminder_check(uuid,uuid,uuid)"`; to `rpcs`
  `{"name":"send_task_reminders","class":"write","expect_denial":[{"http":403,"sqlstate":"42501"}],"source":["supabase/migrations/<NNNN>_task_reminders.sql:<line of assert_is_active_member in send>"]}` and the same for
  `preview_task_reminders` with `"class":"read"`. Run `node scripts/check-isolation-denominator.mjs` and fix until clean;
  then `node scripts/check-isolation-denominator.mjs --self-test`.
- Types: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.

### S1.12 Slice gate and commit (3 min)

1. `scripts/check-migration-collisions.sh && scripts/check-migration-collisions.sh --self-test`
2. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/task_reminders.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0237_workflow_notifications.test.sql'`
3. `node scripts/check-isolation-denominator.mjs && node scripts/check-isolation-denominator.mjs --self-test`
4. From `pmo-portal/`: `npm run check:guards && npm run typecheck`.

Commit `feat(agent): server-enforced task reminders ledger and RPCs (#1639 S1)`. PR to `dev`; security-auditor reviews
(new cross-user write).

---

## S2 - The `remind_overdue` action (after S1 is on `dev`)

### S2.1 Failing test first: prepare picks only other people's tasks (AC-RMD-013) (4 min)

Create `pmo-portal/src/lib/agent/remindOverdue.test.ts` **(new)**:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  prepareRemindOverdue, validatePreparedReminders, runRemindOverdue, REMINDER_BATCH_CAP,
} from '../../../../supabase/functions/agent-chat/remindOverdue';
import { fakeSupabase, type FakeCall } from './testing/fakeSupabase';

const NOW = new Date('2026-10-06T03:00:00Z');
const P1 = '11111111-1111-4111-8111-111111111111';
const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = (client: unknown) => ({ jwt: '', userId: 'u-me', orgId: 'org-1', role: 'Project Manager', supabase: client as never });

type TaskRow = { id: string; name: string; end_date: string; project_id: string; assignee_id: string | null };
function world(tasks: TaskRow[]) {
  return (c: FakeCall) => {
    if (c.table === 'profiles' && c.columns === 'timezone') return { data: { timezone: 'UTC' }, error: null };
    if (c.table === 'profiles') return { data: [{ id: 'u-2', full_name: 'Site engineer' }, { id: 'u-3', full_name: 'Planner' }], error: null };
    if (c.table === 'organizations') return { data: { default_timezone: 'UTC', default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
    if (c.table === 'org_features') return { data: { enabled: false }, error: null };
    if (c.table === 'projects' && c.columns === 'id') return { data: [{ id: P1 }], error: null };
    if (c.table === 'projects') return { data: [{ id: P1, name: 'Harbor Tower' }], error: null };
    if (c.table === 'tasks') return { data: tasks, error: null };
    return { data: [], error: null };
  };
}
const eligible = (ids: string[], remaining = 20) => ({
  data: { remaining, items: ids.map((id) => ({ task_id: id, outcome: 'eligible', recipient_name: 'Site engineer', task_name: 'x', due_date: '2026-10-01' })) },
  error: null,
});
const TASKS: TaskRow[] = [
  { id: T(1), name: 'Pour foundation', end_date: '2026-10-01', project_id: P1, assignee_id: 'u-2' },
  { id: T(2), name: 'My own task', end_date: '2026-10-02', project_id: P1, assignee_id: 'u-me' },
  { id: T(3), name: 'Nobody owns this', end_date: '2026-10-02', project_id: P1, assignee_id: null },
  { id: T(4), name: 'Rebar check', end_date: '2026-10-03', project_id: P1, assignee_id: 'u-3' },
];

describe('prepareRemindOverdue (#1639)', () => {
  it('AC-RMD-013 with no argument proposes exactly the overdue tasks assigned to other people', async () => {
    const { client } = fakeSupabase(world(TASKS));
    client.rpc.mockResolvedValueOnce(eligible([T(1), T(4)]) as never);
    const out = await prepareRemindOverdue({}, ctx(client), NOW);
    expect(client.rpc).toHaveBeenCalledWith('preview_task_reminders', { p_task_ids: [T(1), T(4)] });
    expect(out.ok && out.value.reminders.map((r) => r.taskId)).toEqual([T(1), T(4)]);
    expect(out.ok && out.summary).toMatch(/^Send 2 reminders: Site engineer — Pour foundation/);
  });
});
```

Run (RED: module missing): from `pmo-portal/`, `npx vitest run src/lib/agent/remindOverdue.test.ts`.

### S2.2 Carry the assignee id on overdue facts (3 min)

`supabase/functions/agent-chat/overdue.ts`:

- `OverdueTask` (`overdue.ts:27-31`): add `assigneeId?: string | null;` (optional, so every literal `OverdueFacts` in
  existing tests still typechecks).
- In the task mapping (`overdue.ts:138-146`) add `assigneeId: task.assignee_id,` after `assigneeName`.
- `buildOverdueModelResult` (`overdue.ts:202`): `tasks: facts.tasks.map(({ id: _id, assigneeId: _assigneeId, ...task }) => task),`
  so the model receipt keeps its shape (ids stay server-side). Update `OverdueModelResult.tasks` to
  `Array<Omit<OverdueTask, 'id' | 'assigneeId'>>`.
- `OverdueFacts` (`overdue.ts:35-47`): add `callerId?: string;` and set `callerId: ctx.userId` in the return at
  `overdue.ts:147`.

Run `npx vitest run src/lib/agent/overdue.test.tsx src/lib/agent/handlerOverdue.test.ts` (still GREEN: shape unchanged).

### S2.3 The input schema (2 min)

`supabase/functions/agent-chat/schema.ts`, after `WHATS_OVERDUE_SCHEMA` (`schema.ts:210-215`):

```ts
/** remind_overdue (#1639) — the model's REQUEST; the server resolves recipients from the caller's overdue tasks. */
export const REMIND_OVERDUE_SCHEMA = {
  type: 'object' as const,
  required: [] as string[],
  additionalProperties: false,
  properties: {
    task: { type: 'string', maxLength: 200, description: 'Optional: the overdue task the user named. Omit to remind everyone whose overdue task is shown.' },
  },
};
```

### S2.4 The action module (5 min)

Create `supabase/functions/agent-chat/remindOverdue.ts` **(new)**:

```ts
/**
 * remind_overdue (#1639, OD-GRILL-20261101) — one coarse confirmed write: remind the people whose overdue tasks the caller
 * can see. The model supplies at most a task name; recipients are derived on the server (the send RPC re-derives them
 * from each task row). ADR-0079 §2: prepared before the chip; the approved value is what runs.
 */
import type { AgentAction, DeputyContext, PrepareResult } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { loadOverdueFacts, OVERDUE_TIMEOUT_MS } from './overdue.ts';
import { REMIND_OVERDUE_SCHEMA } from './schema.ts';
import { asRpc, UUID_RE, withTimeout } from './looseClient.ts';
import { formatShortDate } from './agentFormat.ts';

export const REMINDER_BATCH_CAP = 10; // FR-RMD-007 / OQ-7, = the send RPC's batch limit
const SUMMARY_LISTED = 3;

export interface RemindRequest { task?: string }
export interface PreparedReminder { taskId: string; taskName: string; recipientName: string; dueDate: string }
export interface PreparedReminders { kind: 'prepared-reminders'; reminders: PreparedReminder[] }
type Outcome = 'eligible' | 'sent' | 'not_found' | 'not_overdue' | 'no_assignee' | 'self' | 'recipient_inactive' | 'already_reminded' | 'daily_limit';
interface RpcItem { task_id: string; outcome: Outcome; recipient_name?: string | null }
interface RpcResult { remaining: number; items: RpcItem[] }

const refuse = (error: string, extra: Record<string, unknown> = {}): PrepareResult => ({ ok: false, error: { error, ...extra } });

export function validateRemindRequest(input: unknown): { ok: true; value: RemindRequest } | { ok: false; error: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  if (Object.keys(i).some((k) => k !== 'task')) return { ok: false, error: 'only "task" may be given' };
  if (i.task === undefined) return { ok: true, value: {} };
  if (typeof i.task !== 'string' || !i.task.trim() || i.task.length > 200) return { ok: false, error: 'task must be a short name' };
  return { ok: true, value: { task: i.task.trim() } };
}

export async function prepareRemindOverdue(input: RemindRequest, ctx: DeputyContext, now: Date = new Date()): Promise<PrepareResult> {
  const rpc = asRpc(ctx.supabase);
  if (!rpc) return refuse('Reminders are not available right now.');
  const facts = await withTimeout(loadOverdueFacts(ctx, now), OVERDUE_TIMEOUT_MS);
  let pool = facts.tasks.filter((t) => t.assigneeId && t.assigneeId !== ctx.userId); // FR-RMD-002, never self
  if (input.task) {
    const needle = input.task.toLowerCase();
    pool = pool.filter((t) => t.name.toLowerCase().includes(needle));
    if (pool.length === 0) return refuse(`No overdue task named "${input.task}" belongs to someone else.`);
    if (pool.length > 1) {
      return refuse('Which task should I send a reminder for?', {
        needs: 'choice',
        candidates: pool.slice(0, 8).map((t) => ({ id: t.name, label: `${t.name}${t.assigneeName ? ` — ${t.assigneeName}` : ''}` })),
      });
    }
  }
  if (pool.length === 0) return refuse('Every overdue task shown is yours or has no assignee, so there is nobody to remind.');
  pool = pool.slice(0, REMINDER_BATCH_CAP); // already oldest-due first (overdue.ts sort)

  const { data, error } = await withTimeout(rpc.rpc('preview_task_reminders', { p_task_ids: pool.map((t) => t.id) }), OVERDUE_TIMEOUT_MS);
  if (error || !data) return refuse('Reminders could not be checked right now.');
  const preview = data as RpcResult;
  const ok = new Map(preview.items.filter((i) => i.outcome === 'eligible').map((i) => [i.task_id, i.recipient_name ?? 'a colleague']));
  const eligible = pool.filter((t) => ok.has(t.id));
  if (eligible.length === 0) return refuse('Nobody can be reminded: these people were already reminded today or are no longer active.');
  if (preview.remaining <= 0) return refuse('You have reached today\'s reminder limit. Try again tomorrow.');
  const chosen = eligible.slice(0, preview.remaining); // FR-RMD-006
  const left = eligible.length - chosen.length;

  const reminders: PreparedReminder[] = chosen.map((t) => ({
    taskId: t.id, taskName: t.name, recipientName: ok.get(t.id)!, dueDate: t.dueDate,
  }));
  const listed = reminders.slice(0, SUMMARY_LISTED)
    .map((r) => `${r.recipientName} — ${r.taskName} (due ${formatShortDate(r.dueDate)})`).join('; ');
  const more = reminders.length > SUMMARY_LISTED ? `; and ${reminders.length - SUMMARY_LISTED} more` : '';
  const capped = left > 0 ? ` ${left} left out: daily reminder limit.` : '';
  const n = reminders.length;
  return {
    ok: true,
    value: { kind: 'prepared-reminders', reminders } satisfies PreparedReminders,
    summary: `Send ${n} reminder${n === 1 ? '' : 's'}: ${listed}${more}.${capped}`,
  };
}

/** AC-RMD-016: allow-list rebuild of the replayed approved value. */
export function validatePreparedReminders(input: unknown): { ok: true; value: PreparedReminders } | { ok: false; error: string } {
  const v = input as Partial<PreparedReminders> | null;
  if (!v || typeof v !== 'object' || Object.keys(v).some((k) => k !== 'kind' && k !== 'reminders')) return { ok: false, error: 'bad shape' };
  if (v.kind !== 'prepared-reminders' || !Array.isArray(v.reminders)) return { ok: false, error: 'bad shape' };
  if (v.reminders.length < 1 || v.reminders.length > REMINDER_BATCH_CAP) return { ok: false, error: 'between 1 and 10 reminders' };
  const seen = new Set<string>();
  const reminders: PreparedReminder[] = [];
  for (const r of v.reminders as unknown[]) {
    const x = r as Record<string, unknown>;
    if (!x || Object.keys(x).some((k) => !['taskId', 'taskName', 'recipientName', 'dueDate'].includes(k))) return { ok: false, error: 'bad reminder' };
    if (typeof x.taskId !== 'string' || !UUID_RE.test(x.taskId) || seen.has(x.taskId)) return { ok: false, error: 'bad task id' };
    if (typeof x.taskName !== 'string' || typeof x.recipientName !== 'string' || typeof x.dueDate !== 'string') return { ok: false, error: 'bad reminder' };
    seen.add(x.taskId);
    reminders.push({ taskId: x.taskId, taskName: x.taskName, recipientName: x.recipientName, dueDate: x.dueDate });
  }
  return { ok: true, value: { kind: 'prepared-reminders', reminders } };
}

/** AC-RMD-017: sends task ids only; the RPC derives every recipient and enforces every rule. */
export async function runRemindOverdue(input: unknown, ctx: DeputyContext): Promise<unknown> {
  const v = validatePreparedReminders(input);
  if (v.ok === false) return { error: v.error };
  const rpc = asRpc(ctx.supabase);
  if (!rpc) return { error: 'Reminders are not available right now.' };
  const { data, error } = await withTimeout(
    rpc.rpc('send_task_reminders', { p_task_ids: v.value.reminders.map((r) => r.taskId) }), OVERDUE_TIMEOUT_MS,
  );
  if (error || !data) return { error: 'The reminders could not be sent right now.', code: (error as { code?: string } | null)?.code };
  const result = data as RpcResult;
  const byId = new Map(v.value.reminders.map((r) => [r.taskId, r]));
  return {
    ok: true,
    sent: result.items.filter((i) => i.outcome === 'sent').map((i) => byId.get(i.task_id)?.recipientName ?? 'a colleague'),
    skipped: result.items.filter((i) => i.outcome !== 'sent').map((i) => ({ task: byId.get(i.task_id)?.taskName ?? null, reason: i.outcome })),
    remainingToday: result.remaining,
    note: 'Say who was reminded in one short sentence. Mention any skipped task and why in plain words.',
  };
}

export const remindOverdueAction: AgentAction & {
  validate: typeof validateRemindRequest;
  summarize: (i: unknown) => string;
} = {
  name: 'remind_overdue',
  description:
    'Remind the people whose overdue tasks the user can see (or the one task the user named). Sends an in-app reminder to each assignee after the user confirms. Never reminds the user themself.',
  inputSchema: REMIND_OVERDUE_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  needsApproval: () => true,
  validate: validateRemindRequest,
  prepare: (input, ctx) => prepareRemindOverdue(input as RemindRequest, ctx),
  validatePrepared: validatePreparedReminders,
  // Only reached if a caller bypasses `prepare` — the handler always uses prepare's summary.
  summarize: () => 'Send reminders about overdue tasks.',
  run: runRemindOverdue,
};
```

Run the S2.1 test: GREEN.

### S2.5 Remaining prepare / validate / run cases (AC-RMD-014..017) (5 min)

Append to `remindOverdue.test.ts`:

```ts
  it('AC-RMD-014 a task name matching two remindable tasks returns candidates and no chip', async () => {
    const { client } = fakeSupabase(world([
      { ...TASKS[0], name: 'Pour slab A' }, { ...TASKS[3], name: 'Pour slab B' },
    ]));
    const out = await prepareRemindOverdue({ task: 'pour' }, ctx(client), NOW);
    expect(out).toMatchObject({ ok: false, error: { needs: 'choice' } });
    expect(out.ok === false && (out.error.candidates as unknown[])).toHaveLength(2);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('AC-RMD-014 a task name matching nothing remindable is a plain refusal', async () => {
    const { client } = fakeSupabase(world(TASKS));
    const out = await prepareRemindOverdue({ task: 'My own task' }, ctx(client), NOW);
    expect(out).toEqual({ ok: false, error: { error: 'No overdue task named "My own task" belongs to someone else.' } });
  });
  it('AC-RMD-015 proposes only as many as remain today, oldest due first, and says how many were left out', async () => {
    const { client } = fakeSupabase(world(TASKS));
    client.rpc.mockResolvedValueOnce(eligible([T(1), T(4)], 1) as never);
    const out = await prepareRemindOverdue({}, ctx(client), NOW);
    expect(out.ok && out.value.reminders.map((r) => r.taskId)).toEqual([T(1)]);
    expect(out.ok && out.summary).toMatch(/1 left out: daily reminder limit\.$/);
  });
  it('AC-RMD-015 with nothing remaining there is no chip', async () => {
    const { client } = fakeSupabase(world(TASKS));
    client.rpc.mockResolvedValueOnce(eligible([T(1)], 0) as never);
    expect(await prepareRemindOverdue({}, ctx(client), NOW))
      .toEqual({ ok: false, error: { error: "You have reached today's reminder limit. Try again tomorrow." } });
  });
  const ONE = { kind: 'prepared-reminders', reminders: [{ taskId: T(1), taskName: 'Pour foundation', recipientName: 'Site engineer', dueDate: '2026-10-01' }] };
  it.each([
    ['an extra field', { ...ONE, recipientIds: ['u-2'] }],
    ['an extra reminder field', { ...ONE, reminders: [{ ...ONE.reminders[0], recipientId: 'u-9' }] }],
    ['a non-uuid id', { ...ONE, reminders: [{ ...ONE.reminders[0], taskId: 'x' }] }],
    ['a duplicate', { ...ONE, reminders: [ONE.reminders[0], ONE.reminders[0]] }],
    ['11 items', { ...ONE, reminders: Array.from({ length: REMINDER_BATCH_CAP + 1 }, (_, i) => ({ ...ONE.reminders[0], taskId: T(i + 1) })) }],
  ])('AC-RMD-016 the replayed value is rejected with %s', (_label, value) => {
    expect(validatePreparedReminders(value).ok).toBe(false);
  });
  it('AC-RMD-017 run sends task ids only and reports each outcome', async () => {
    const { client } = fakeSupabase(world([]));
    client.rpc.mockResolvedValueOnce({ data: { remaining: 19, items: [{ task_id: T(1), outcome: 'sent' }] }, error: null } as never);
    const out = await runRemindOverdue(ONE, ctx(client));
    expect(client.rpc).toHaveBeenCalledWith('send_task_reminders', { p_task_ids: [T(1)] });
    expect(out).toMatchObject({ ok: true, sent: ['Site engineer'], skipped: [], remainingToday: 19 });
  });
```

Run `npx vitest run src/lib/agent/remindOverdue.test.ts`: GREEN. **Mutation check:** change the filter in
`prepareRemindOverdue` to `t.assigneeId` only (drop `!== ctx.userId`); AC-RMD-013 must go RED; restore.

### S2.6 Offer line on the overdue answer (AC-RMD-023) (4 min)

Failing test first, appended to `pmo-portal/src/lib/agent/overdue.test.tsx`:

```ts
describe('renderOverdueMarkdown — reminder offer (#1639)', () => {
  const base: OverdueFacts = {
    asOf: '2026-10-06', numberLocale: 'en-US', callerId: 'u-me', tasksTruncated: false, invoices: null, invoicesTruncated: false,
    tasks: [
      { id: 't1', name: 'Pour', projectId: null, projectName: null, assigneeName: 'Site engineer', assigneeId: 'u-2', dueDate: '2026-10-01', daysOverdue: 5 },
      { id: 't2', name: 'Rebar', projectId: null, projectName: null, assigneeName: 'Planner', assigneeId: 'u-3', dueDate: '2026-10-02', daysOverdue: 4 },
    ],
  };
  it('AC-RMD-023 offers reminders for the 2 people with late tasks', () => {
    expect(renderOverdueMarkdown(base, { offerReminders: true }))
      .toMatch(/Say \*remind them\* and I'll prepare reminders for the 2 people with late tasks\.\n\n$/);
  });
  it('AC-RMD-023 makes no offer when every task is the caller\'s own, or when reminders are off', () => {
    const own = { ...base, tasks: base.tasks.map((t) => ({ ...t, assigneeId: 'u-me' })) };
    expect(renderOverdueMarkdown(own, { offerReminders: true })).not.toMatch(/remind them/);
    expect(renderOverdueMarkdown(base)).not.toMatch(/remind them/);
  });
});
```

Then in `overdue.ts`: change the signature to
`export function renderOverdueMarkdown(f: OverdueFacts, opts: { offerReminders?: boolean } = {}): string` and, before the
final `return` (`overdue.ts:253`):

```ts
  if (opts.offerReminders) {
    const people = new Set(f.tasks.map((t) => t.assigneeId).filter((id): id is string => !!id && id !== f.callerId));
    if (people.size > 0) {
      lines.push('', `Say *remind them* and I'll prepare reminders for the ${people.size} ${people.size === 1 ? 'person' : 'people'} with late tasks.`);
    }
  }
```

Thread it: `runWhatsOverdue(_input, ctx, now = new Date(), opts: { offerReminders?: boolean } = {})` passes `opts` to
`renderOverdueMarkdown`; replace the action export (`overdue.ts:281-289`) with:

```ts
export function makeWhatsOverdueAction(opts: { offerReminders: boolean }): AgentAction {
  return {
    name: 'whats_overdue',
    description:
      "One call: the user's overdue tasks across their projects, plus overdue invoices when their role may see invoices. The list is shown to the user automatically.",
    inputSchema: WHATS_OVERDUE_SCHEMA,
    surfaces: ['agent'],
    confirm: false,
    run: (input: unknown, ctx: DeputyContext) => runWhatsOverdue(input, ctx, new Date(), opts),
  };
}
/** Unchanged default for existing importers (no offer line). The handler registers makeWhatsOverdueAction(...). */
export const whatsOverdueAction: AgentAction = makeWhatsOverdueAction({ offerReminders: false });
```

Run `npx vitest run src/lib/agent/overdue.test.tsx src/lib/agent/handlerOverdue.test.ts`: GREEN.

### S2.7 Register behind a kill switch; handler proof (AC-RMD-018) (5 min)

Failing test first, `pmo-portal/src/lib/agent/handlerRemind.test.ts` **(new)** (shape copied from
`handlerOverdue.test.ts:1-37`):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentChatHandler, type HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import { fakeSupabase, type FakeCall } from './testing/fakeSupabase';

const P1 = '11111111-1111-4111-8111-111111111111';
const T1 = '00000000-0000-4000-8000-000000000001';
async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
const toolCall = (name: string, args: object) => ({
  finish_reason: 'tool_calls', usage: {}, model: 'm',
  message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
});
function respond(c: FakeCall) {
  if (c.table === 'profiles' && c.columns === 'org_id, role') return { data: { org_id: 'org-1', role: 'Project Manager' }, error: null };
  if (c.table === 'profiles' && c.columns === 'timezone') return { data: { timezone: 'UTC' }, error: null };
  if (c.table === 'profiles') return { data: [{ id: 'u-2', full_name: 'Site engineer' }], error: null };
  if (c.table === 'organizations') return { data: { default_timezone: 'UTC', default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
  if (c.table === 'org_features') return { data: { enabled: false }, error: null };
  if (c.table === 'projects' && c.columns === 'id') return { data: [{ id: P1 }], error: null };
  if (c.table === 'projects') return { data: [{ id: P1, name: 'Harbor Tower' }], error: null };
  if (c.table === 'tasks') return { data: [{ id: T1, name: 'Pour foundation', end_date: '2026-10-01', project_id: P1, assignee_id: 'u-2' }], error: null };
  return { data: null, error: null };
}

describe('remind_overdue through the handler (#1639)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T03:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('AC-RMD-018 the call always ends in needs-approval and nothing is sent before approval', async () => {
    const { client } = fakeSupabase(respond);
    client.rpc.mockResolvedValueOnce({ data: { remaining: 20, items: [{ task_id: T1, outcome: 'eligible', recipient_name: 'Site engineer' }] }, error: null } as never);
    const create = vi.fn().mockResolvedValueOnce(toolCall('remind_overdue', {}));
    const deps: HandlerDeps = { modelClient: { create }, model: 'm', userId: 'u-me', can: () => true, supabase: client as unknown as HandlerDeps['supabase'] };
    const events = await collect(agentChatHandler({ messages: [{ role: 'user', content: 'Remind whoever is late.' }] }, deps));
    const chip = events.find((e) => (e.payload as { status?: string } | undefined)?.status === 'needs-approval');
    expect(chip?.payload).toMatchObject({ actionName: 'remind_overdue', structuredArgs: { kind: 'prepared-reminders', reminders: [{ taskId: T1 }] } });
    expect(client.rpc.mock.calls.map((c) => c[0])).toEqual(['preview_task_reminders']);
  });
});
```

Then `supabase/functions/agent-chat/handler.ts`:

- import: replace `import { whatsOverdueAction } from './overdue.ts';` with
  `import { makeWhatsOverdueAction } from './overdue.ts';` and add `import { remindOverdueAction } from './remindOverdue.ts';`.
- after `INVOICE_DRAFTS_ENABLED` (`handler.ts:123`):
  ```ts
  /** #1639 kill switch: AGENT_REMINDERS=false removes remind_overdue (and the overdue offer line) without a redeploy
   *  (default ON; ON in a Deno-less test context, mirroring INVOICE_DRAFTS_ENABLED). */
  const REMINDERS_ENABLED = denoGlobal === undefined || denoGlobal.env.get('AGENT_REMINDERS') !== 'false';
  ```
- `BASE_ACTIONS` (`handler.ts:124-131`): replace `whatsOverdueAction,` with
  `makeWhatsOverdueAction({ offerReminders: REMINDERS_ENABLED }),` and add `...(REMINDERS_ENABLED ? [remindOverdueAction] : []),`
  after the invoice-drafts line.
- status label switch (`handler.ts:97`, beside `draft_invoice`): add `case 'remind_overdue': return 'Preparing reminders…';`.
- `getPermissionCheck` stays unchanged (PQ-3); add a comment line above its `default:`:
  `// remind_overdue: no can() entity — send_task_reminders is the authority (ADR-0016/0019, #1639 PQ-3).`
- the three `buildAgentSystemPrompt(...)` calls (`handler.ts:1469, 1553, 1629`): add `remindersEnabled: REMINDERS_ENABLED`
  to the options object.

Run `npx vitest run src/lib/agent/handlerRemind.test.ts src/lib/agent/handlerOverdue.test.ts src/lib/agent/agentWriteActions.test.ts`: GREEN.

### S2.8 Prompt index line and skill (AC-RMD-019) (4 min)

Failing test first, `pmo-portal/src/lib/agent/agentPrompt.remind.test.ts` **(new)**:

```ts
import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '../../../../supabase/functions/agent-chat/prompt';

describe('remind skill gating (#1639)', () => {
  it('AC-RMD-019 the tool line and the remind skill appear only when reminders are registered', () => {
    const on = buildAgentSystemPrompt(['projects'], 50, 'Project Manager', { remindersEnabled: true });
    expect(on).toMatch(/- remind_overdue — /);
    expect(on).toMatch(/### remind — Use when the user asks to remind, chase, nudge or follow up/);
    const off = buildAgentSystemPrompt(['projects'], 50, 'Project Manager', { remindersEnabled: false });
    expect(off).not.toMatch(/remind_overdue/);
  });
});
```

Then `supabase/functions/agent-chat/prompt.ts`:

- `AgentPromptOptions` (`prompt.ts:35-40`): add `/** #1639: remind_overdue is registered (AGENT_REMINDERS kill switch). */ remindersEnabled?: boolean;`
  and `const remindersEnabled = opts.remindersEnabled === true;` beside the others (`prompt.ts:57-59`).
- tool index (after the `draft_invoice` entry, `prompt.ts:89-91`):
  ```ts
    remindersEnabled
      ? '- remind_overdue — remind the people whose overdue tasks the user can see (or one named task). Write action — goes through the approve/deny chip; never reminds the user themself.'
      : '',
  ```
- skill, after `invoiceSkill`:
  ```ts
  const remindSkill = remindersEnabled
    ? `

### remind — Use when the user asks to remind, chase, nudge or follow up the people whose work is late
Call \`remind_overdue\` right away — with no arguments for "remind them / whoever is late / everyone", or with \`task\` set to the one task the user named. Do NOT call \`notify\` for this (it only reaches the user's own inbox), and do NOT look up people or ids first. If it returns \`needs\` with \`candidates\`, call \`ask_user\` with those options, then call \`remind_overdue\` again with the chosen task. The user confirms on the approve/deny chip; never say a reminder was sent before the tool result says so. Do NOT propose reminders when the user only asked what is overdue.`
    : '';
  ```
  and append `${remindSkill}` right after `${invoiceSkill}` where it is interpolated (`prompt.ts:180`).
- map-questions line (`prompt.ts:185`), add after it (only when enabled, same ternary pattern):
  `- "remind", "chase", "nudge", "follow up" + people/late work → call \`remind_overdue\`.`

Run `npx vitest run src/lib/agent/agentPrompt.remind.test.ts src/lib/agent/agentPrompt.test.ts src/lib/agent/agentPrompt.mapBeforeRefuse.test.ts`: GREEN.

### S2.9 Slice gate and commit (3 min)

From `pmo-portal/`: `npm run check:guards && npm run typecheck && npm run typecheck:edge`,
`npx eslint --max-warnings=0 ../supabase/functions/agent-chat/remindOverdue.ts ../supabase/functions/agent-chat/overdue.ts ../supabase/functions/agent-chat/handler.ts ../supabase/functions/agent-chat/prompt.ts ../supabase/functions/agent-chat/schema.ts src/lib/agent/remindOverdue.test.ts src/lib/agent/handlerRemind.test.ts src/lib/agent/agentPrompt.remind.test.ts src/lib/agent/overdue.test.tsx`,
then the touched vitest files listed in S2.5-S2.8. Commit `feat(agent): remind_overdue confirmed reminders (#1639 S2)`.

---

## S3 - Eval on the deployed model (AC-RMD-020..022)

### S3.1 `noProposal` scorer, test first (3 min)

Append to `pmo-portal/evals/harness/scorers.test.ts` (runs in the normal suite, ADR-0052 §4):

```ts
describe('noProposal (#1639)', () => {
  const run = (actionName?: string) => ({
    events: actionName ? [{ type: 'status', payload: { status: 'needs-approval', actionName } }] : [],
    toolCalls: [], answer: '',
  }) as unknown as EvalRunResult;
  it('AC-RMD-022 passes when the named action was not proposed', async () => {
    expect((await noProposal('remind_overdue')(run())).pass).toBe(true);
    expect((await noProposal('remind_overdue')(run('draft_invoice'))).pass).toBe(true);
  });
  it('AC-RMD-022 fails when the named action was proposed', async () => {
    expect((await noProposal('remind_overdue')(run('remind_overdue'))).pass).toBe(false);
  });
});
```

(Add `noProposal` and `type EvalRunResult` to that file's import from `./scorers`.) Then in
`pmo-portal/evals/harness/scorers.ts`, after `proposesAction` (`scorers.ts:184-198`):

```ts
/** The run did NOT propose the named action (over-trigger guard). */
export function noProposal(name: string): Scorer {
  return (run) => {
    const hit = run.events.some((e) => {
      const p = e.payload as { status?: string; actionName?: string } | undefined;
      return e.type === 'status' && p?.status === 'needs-approval' && p.actionName === name;
    });
    return hit ? { pass: false, reason: `unexpected needs-approval proposal for "${name}"` } : { pass: true, reason: `no "${name}" proposal` };
  };
}
```

Run `npx vitest run evals/harness/scorers.test.ts`: GREEN.

### S3.2 The suite (3 min)

Create `pmo-portal/evals/cases/remind-overdue.eval.ts` **(new)**:

```ts
/**
 * #1639 — "Remind this person", against the DEPLOYED agent (ADR-0052). Proposal-only: no case approves, so an eval run
 * never sends a reminder or uses the daily allowance. Fixture contract: evals/README.md § "Reminder fixture".
 */
import { noProposal, proposesAction, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

const RUNS = 10;
const MIN_PASSES = 9; // DD-AIN-9, OD-GRILL-20261101 "Evals"
const OTHERS_TASK = 'EVAL overdue task for reminder';
const OWN_TASK = 'EVAL own overdue task';
type R = { taskName: string };
const names = (a: Record<string, unknown>) => ((a.reminders as R[] | undefined) ?? []).map((r) => r.taskName);

export default runEvalSuite(
  defineEvalSuite({
    name: 'assistant reminders (#1639)',
    cases: [
      {
        name: 'AC-RMD-020 "what\'s overdue? remind whoever is late" → proposes reminders for others, never the caller\'s own task',
        prompt: "What's overdue? Remind whoever is late.",
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [proposesAction('remind_overdue', (a) =>
          a.kind === 'prepared-reminders' && names(a).includes(OTHERS_TASK) && !names(a).includes(OWN_TASK))],
      },
      {
        name: 'AC-RMD-021 "remind the person on <task>" → proposes exactly that task',
        prompt: `Remind the person on ${OTHERS_TASK}.`,
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [proposesAction('remind_overdue', (a) => names(a).length === 1 && names(a)[0] === OTHERS_TASK)],
      },
      {
        name: 'AC-RMD-022 "what\'s overdue?" alone → whats_overdue, no reminder proposal',
        prompt: "What's overdue?",
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [usesTool('whats_overdue'), noProposal('remind_overdue')],
      },
    ],
  }),
);
```

### S3.3 Fixture contract (2 min)

Append to `pmo-portal/evals/README.md` after "Invoice-reach fixture (#787)":

```md
## Reminder fixture (#1639)

`evals/cases/remind-overdue.eval.ts` runs as the same eval test user (Finance, whole-org overdue scope, DD-AIN-2). The org
needs: an open task named **`EVAL overdue task for reminder`**, past its end date, assigned to **another active member**,
not reminded in the last 24 hours; and an open task named **`EVAL own overdue task`**, past its end date, assigned to the
eval user. The suite only proposes, never approves, so it sends nothing and uses none of the daily allowance.
```

The live run needs an owner-approved deploy of `agent-chat` to the eval target (ADR-0052 §1). Run once deployed:
from `pmo-portal/`, `npm run test:evals -- evals/cases/remind-overdue.eval.ts`. Bar: each case 9 of 10. A red case is a
prompt/skill fix in S2.8's text, re-run; never a weaker scorer.

---

## S4 - Curated e2e (AC-RMD-024)

### S4.1 The journey (5 min)

Create `pmo-portal/e2e/AC-RMD-024-reminder-reaches-assignee.spec.ts` **(new)**:

```ts
// @e2e-isolation: self-isolated — service-role seeds one uniquely named overdue task assigned to engineer@acme.test and deletes it, its ledger rows and its notification in afterAll; the sender is pm@acme.test.
/**
 * AC-RMD-024 — Given the project manager sends a reminder about an overdue task assigned to the site engineer (the exact
 * RPC an approved remind_overdue chip calls; the edge runtime does not run here, see AC-AAN-036's MECHANISM note),
 * When the site engineer signs in, Then the bell shows an unread reminder naming the task and opening it lands on My tasks.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SEED_PASSWORD, signIn } from './helpers';

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const TASK_NAME = `AC-RMD-024 overdue task ${Date.now()}`;
let taskId = '';

test.beforeAll(async () => {
  const admin = createClient(URL_, SERVICE_KEY);
  const { data: eng } = await admin.from('profiles').select('id, org_id').eq('email', 'engineer@acme.test').single();
  const { data: proj } = await admin.from('projects').select('id').eq('org_id', eng!.org_id).is('archived_at', null).limit(1).single();
  const due = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const { data: task } = await admin.from('tasks').insert({
    org_id: eng!.org_id, project_id: proj!.id, name: TASK_NAME, status: 'In Progress', end_date: due, assignee_id: eng!.id,
  }).select('id').single();
  taskId = task!.id;
});

test.afterAll(async () => {
  const admin = createClient(URL_, SERVICE_KEY);
  await admin.from('notifications').delete().eq('metadata->entity->>id', taskId);
  await admin.from('task_reminders').delete().eq('task_id', taskId);
  await admin.from('tasks').delete().eq('id', taskId);
});

test('AC-RMD-024 a confirmed reminder reaches the assignee and opens My tasks', async ({ page }) => {
  const pm = createClient(URL_, ANON_KEY);
  await pm.auth.signInWithPassword({ email: 'pm@acme.test', password: SEED_PASSWORD });
  const { data, error } = await pm.rpc('send_task_reminders', { p_task_ids: [taskId] });
  expect(error).toBeNull();
  expect((data as { items: Array<{ outcome: string }> }).items[0].outcome).toBe('sent');

  await signIn(page, 'engineer@acme.test');
  const bell = page.getByRole('button', { name: /notifications, [1-9]\d* unread/i });
  await expect(bell).toBeVisible({ timeout: 10_000 });
  await bell.click();
  const item = page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(TASK_NAME));
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/\/my-tasks/);
});
```

Note: the 0237 assignment trigger does not fire on this service-role insert (`auth.uid()` is null, `0237:98`), so the
only notification for this task is the reminder. Run (DB reset needed only on S1's branch, which this branch follows):
`scripts/e2e-local.sh AC-RMD-024`, then (from `pmo-portal/`) `npm run check:e2e-isolation`.
Commit S3 + S4 with S2's branch: `test(agent): reminder eval suite and assignee journey (#1639 S3-S4)`.

---

## Traceability (each AC has one owning test)

| AC | Layer | File | Test title (leading token) |
|---|---|---|---|
| AC-RMD-001 | pgTAP | `supabase/tests/task_reminders.test.sql` | `AC-RMD-001 a reminder for an overdue task assigned to an active colleague is sent` (+2) |
| AC-RMD-002 | pgTAP | same | `AC-RMD-002 the sender is never reminded about their own task` |
| AC-RMD-003 | pgTAP | same | `AC-RMD-003 another org's task is not found` (+1) |
| AC-RMD-004 | pgTAP | same | `AC-RMD-004 disabled and banned assignees are not reminded` (+1) |
| AC-RMD-005 | pgTAP | same | `AC-RMD-005 the 21st reminder in 24 hours is refused` (+1) |
| AC-RMD-006 | pgTAP | same | `AC-RMD-006 a second sender within 24 hours does not repeat the reminder` (+1) |
| AC-RMD-007 | pgTAP | same | `AC-RMD-007 a disabled sender is refused` |
| AC-RMD-008 | pgTAP | same | `AC-RMD-008 done or due-today tasks are not overdue; unassigned has no recipient` |
| AC-RMD-009 | pgTAP | same | `AC-RMD-009 …` (5 cases) |
| AC-RMD-010 | pgTAP | same | `AC-RMD-010 …` (6 cases) |
| AC-RMD-011 | pgTAP | same | `AC-RMD-011 more than 10 tasks is refused` (+1) |
| AC-RMD-012 | pgTAP | same | `AC-RMD-012 preview reports the same outcomes as send` (+4) |
| AC-RMD-013 | Vitest | `pmo-portal/src/lib/agent/remindOverdue.test.ts` | `AC-RMD-013 with no argument proposes exactly the overdue tasks assigned to other people` |
| AC-RMD-014 | Vitest | same | `AC-RMD-014 a task name matching two remindable tasks returns candidates and no chip` (+1) |
| AC-RMD-015 | Vitest | same | `AC-RMD-015 proposes only as many as remain today, …` (+1) |
| AC-RMD-016 | Vitest | same | `AC-RMD-016 the replayed value is rejected with %s` |
| AC-RMD-017 | Vitest | same | `AC-RMD-017 run sends task ids only and reports each outcome` |
| AC-RMD-018 | Vitest | `pmo-portal/src/lib/agent/handlerRemind.test.ts` | `AC-RMD-018 the call always ends in needs-approval and nothing is sent before approval` |
| AC-RMD-019 | Vitest | `pmo-portal/src/lib/agent/agentPrompt.remind.test.ts` | `AC-RMD-019 the tool line and the remind skill appear only when reminders are registered` |
| AC-RMD-020 | Eval | `pmo-portal/evals/cases/remind-overdue.eval.ts` | `AC-RMD-020 "what's overdue? remind whoever is late" → …` |
| AC-RMD-021 | Eval | same | `AC-RMD-021 "remind the person on <task>" → proposes exactly that task` |
| AC-RMD-022 | Eval | same | `AC-RMD-022 "what's overdue?" alone → whats_overdue, no reminder proposal` (scorer logic: `evals/harness/scorers.test.ts`) |
| AC-RMD-023 | Vitest | `pmo-portal/src/lib/agent/overdue.test.tsx` | `AC-RMD-023 offers reminders for the 2 people with late tasks` (+1) |
| AC-RMD-024 | E2E | `pmo-portal/e2e/AC-RMD-024-reminder-reaches-assignee.spec.ts` | `AC-RMD-024 a confirmed reminder reaches the assignee and opens My tasks` |

## Risks

- **Weak tool-selector.** The model may answer "remind them" with `notify` (self-inbox) or prose. Mitigations: one
  argument-free tool, an explicit "do NOT call notify" line, a server-written offer line naming the exact phrase, and the
  eval at 9/10. If AC-RMD-020 stays below the bar after two prompt rounds, the fallback is deterministic routing of the
  phrase "remind them" in the handler, which needs its own owner ruling (not in this plan).
- **Notification volume.** Bounded by the per-sender cap, the per-task de-duplication and the 10-per-chip batch. Recipient
  mute is a follow-up.
- **`tasks_select` drift.** The RPC's org check mirrors today's org-wide task visibility (⚑ MIRRORS comment). A future
  narrowing of task visibility must update `task_reminder_check` in the same migration; the security-auditor checks this
  on any `tasks_select` change.
