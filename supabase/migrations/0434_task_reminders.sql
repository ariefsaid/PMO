-- 0434_task_reminders.sql — assistant "Remind this person" (#1639, OD-GRILL-20261101; spec assistant-remind-person).
-- A sender-readable ledger + one internal rule function + two client RPCs. The recipient's in-app notification is
-- written by the shipped helper notify_workflow_user (0237), which is reused, not re-derived.
-- Reverse (also supabase/migrations/rollback/0434_task_reminders_down.sql):
--   drop function if exists public.send_task_reminders(uuid[]);
--   drop function if exists public.preview_task_reminders(uuid[]);
--   drop function if exists public.task_reminder_check(uuid, uuid, uuid);
--   drop function if exists public.task_reminder_daily_cap();
--   drop function if exists public.task_reminder_window();
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
  using (sender_id = auth.uid() and org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.task_reminders from public, anon, authenticated;
grant select on public.task_reminders to authenticated;

-- FR-RMD-014 / OQ-1: the per-sender cap over a rolling window (OQ-2). One place each, read by the check and both RPCs.
create or replace function public.task_reminder_daily_cap() returns integer
  language sql immutable set search_path = public as $$ select 20 $$;
create or replace function public.task_reminder_window() returns interval
  language sql immutable set search_path = public as $$ select interval '24 hours' $$;

-- FR-RMD-012: every send rule, in one place. SECURITY INVOKER on purpose: only the two definer RPCs below call it (execute is
-- revoked from every client role), so it runs as their owner and reads the rows RLS hides without being a definer itself.
-- ⚑ MIRRORS tasks_select (0002_rls.sql:91: org-scoped, active members): a task is reachable here only in the caller's
-- org, and both callers assert the caller is an active member first. If tasks_select narrows, narrow this too.
create or replace function public.task_reminder_check(p_sender uuid, p_org uuid, p_task uuid)
  returns table (outcome text, recipient_id uuid, task_name text, due_date date)
  language plpgsql stable set search_path = public, pg_temp as $$
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
              where x.task_id = p_task and x.recipient_id = t.assignee_id and x.created_at > now() - public.task_reminder_window()) then
    return query select 'already_reminded'::text, t.assignee_id, t.name::text, t.end_date; return;
  end if;
  return query select 'eligible'::text, t.assignee_id, t.name::text, t.end_date;
end $$;

revoke all on function public.task_reminder_daily_cap() from public, anon, authenticated;
revoke all on function public.task_reminder_window() from public, anon, authenticated;
revoke all on function public.task_reminder_check(uuid, uuid, uuid) from public, anon, authenticated;

-- FR-RMD-018: the same checks, no writes. Returns {remaining, items:[{task_id, outcome, task_name, due_date, recipient_name}]}.
-- Takes up to 50 ids (PQ-5: the overdue fetch cap), so prepare can skip already-reminded tasks; the send takes 10.
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
  if coalesce(cardinality(p_task_ids), 0) not between 1 and 50 then
    raise exception 'between 1 and 50 tasks may be checked at once' using errcode = '22023';
  end if;
  select count(*) into v_used from public.task_reminders
   where sender_id = v_me and created_at > now() - public.task_reminder_window();
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
   where sender_id = v_me and created_at > now() - public.task_reminder_window();
  select coalesce(nullif(btrim(p.full_name), ''), 'A colleague') into v_sender from public.profiles p where p.id = v_me;

  foreach v_id in array (select array_agg(distinct x order by x) from unnest(p_task_ids) x) loop
    -- PQ-1: per-task lock, taken in ascending id order, so concurrent senders de-duplicate without deadlock.
    perform pg_advisory_xact_lock(hashtextextended('task_reminders:task:' || v_id::text, 0));
    select * into c from public.task_reminder_check(v_me, v_org, v_id);
    -- PQ-6: names in the result are read here, never taken from the caller (task_name is null for not_found).
    if c.outcome <> 'eligible' then
      v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', c.outcome, 'task_name', c.task_name);
      continue;
    end if;
    if v_used >= public.task_reminder_daily_cap() then
      v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', 'daily_limit', 'task_name', c.task_name);
      continue;
    end if;
    insert into public.task_reminders (org_id, sender_id, recipient_id, task_id)
      values (v_org, v_me, c.recipient_id, v_id);
    -- FR-RMD-017: server-written text; notify_workflow_user re-checks org, active membership and not-self.
    perform public.notify_workflow_user(v_org, c.recipient_id, 'Reminder: a task is overdue',
      v_sender || ' reminded you: "' || c.task_name || '" was due ' || to_char(c.due_date, 'FMDD Mon YYYY') || '.',
      'info', 'task', v_id, c.task_name);
    v_used := v_used + 1;
    v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', 'sent', 'task_name', c.task_name,
      'recipient_name', (select p.full_name from public.profiles p where p.id = c.recipient_id));
  end loop;
  return jsonb_build_object('remaining', greatest(public.task_reminder_daily_cap() - v_used, 0), 'items', v_out);
end $$;
revoke all on function public.send_task_reminders(uuid[]) from public, anon;
grant execute on function public.send_task_reminders(uuid[]) to authenticated;

do $$
declare v text;
begin
  foreach v in array array['public.preview_task_reminders(uuid[])', 'public.send_task_reminders(uuid[])'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or not has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0434: % ACL is not the intended shape', v;
    end if;
  end loop;
  foreach v in array array['public.task_reminder_check(uuid, uuid, uuid)', 'public.task_reminder_daily_cap()', 'public.task_reminder_window()'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0434: internal % is client-executable', v;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.task_reminders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.task_reminders', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('service_role', 'public.task_reminders', 'SELECT,INSERT,DELETE') then
    raise exception '0434: task_reminders ACL is not the intended shape (0137: service_role keeps DML)';
  end if;
end $$;
