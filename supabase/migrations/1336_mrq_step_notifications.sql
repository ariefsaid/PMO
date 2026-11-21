-- 1336_mrq_step_notifications.sql — #2685 the open material-request step notifies the people who can decide it.
-- Spec docs/specs/material-request-approver-inbox.spec.md (FR-MRI-003..008). Proven by
-- supabase/tests/mrq_approver_inbox.test.sql and mrq_approver_inbox_parity.test.sql.
--
-- mrq_step_recipients(step): who can decide the open step NOW. Calls mrq_step_authority (role, live pin, in-window
-- stand-in, one hop) and applies the same earlier-decision rule as mrq_decide_step / mrq_waiting_for_me, so the
-- notified set equals the queue set. The recipient is derived here from the database; no client supplies one.
-- mrq_sync_step_notifications(step): inserts the missing notifications of the step (only while the organisation's
-- setting is on) and deletes those no longer wanted (always: a decided, superseded or cancelled step wants nobody).
-- A trigger on the steps calls it whenever a step is inserted or changes status.
-- Wording is plain English like every 0237 workflow notification (deliberate; templated text is a follow-up).
--
-- REVERSE: supabase/migrations/rollback/1336_mrq_step_notifications_down.sql

create or replace function public.mrq_step_recipients(p_step_id uuid) returns setof uuid
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.material_request_steps; r public.material_requests; v_pin uuid; c record; a record;
begin
  select * into s from public.material_request_steps x where x.id = p_step_id;
  if not found or s.status <> 'open' then return; end if;
  select * into r from public.material_requests x where x.id = s.request_id;
  if not found or r.status <> 'pending' or r.round <> s.round then return; end if;
  v_pin := public.mrq_pinned_to(r.project_id, s.position, s.role);
  for c in
    select p.id from public.profiles p
     where p.org_id = r.org_id and p.status = 'active' and p.id <> r.created_by                       -- mut:recipient_author
       and (p.role = s.role
            or exists (select 1 from public.approval_stand_ins si
                        where si.org_id = r.org_id and si.stand_in_id = p.id and si.revoked_at is null))
  loop
    select m.ok, m.acting_for into a
      from public.mrq_step_authority(r.org_id, c.id, s.role, r.created_by, v_pin) m;                  -- mut:recipient_authority
    if not a.ok then continue; end if;
    if exists (select 1 from public.material_request_steps x                                          -- mut:recipient_twice
                where x.request_id = r.id and x.id <> s.id and x.status in ('approved','returned','rejected')
                  and (x.round = s.round or (x.position, x.role, x.label) is distinct from (s.position, s.role, s.label))
                  and (x.decided_by = any(array_remove(array[c.id, a.acting_for], null))
                       or x.acted_for = any(array_remove(array[c.id, a.acting_for], null)))) then
      continue;
    end if;
    return next c.id;
  end loop;
end $$;

create or replace function public.mrq_sync_step_notifications(p_step_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare s public.material_request_steps; r public.material_requests; v_want uuid[] := '{}'; u uuid;
begin
  select * into s from public.material_request_steps x where x.id = p_step_id;
  if not found then
    delete from public.notifications n where n.metadata ->> 'mrq_step_id' = p_step_id::text;
    return;
  end if;
  if public.mrq_approver_inbox_on(s.org_id) then                                                         -- mut:setting_gate
    select coalesce(array_agg(x), '{}') into v_want from public.mrq_step_recipients(p_step_id) x;
  end if;
  delete from public.notifications n
   where n.org_id = s.org_id and n.metadata ->> 'mrq_step_id' = p_step_id::text
     and n.owner_id <> all (v_want);
  if cardinality(v_want) = 0 then return; end if;
  select * into r from public.material_requests x where x.id = s.request_id;
  foreach u in array v_want loop
    if not exists (select 1 from public.notifications n
                    where n.owner_id = u and n.metadata ->> 'mrq_step_id' = p_step_id::text) then
      insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
      values (s.org_id, u, 'info', 'Material request awaiting your approval',
              r.number || ' · ' || s.label,
              jsonb_build_object('entity', jsonb_build_object('type', 'material_request', 'id', r.id, 'label', r.number),
                                 'mrq_step_id', s.id));
    end if;
  end loop;
end $$;

create or replace function public.mrq_step_notify_trg() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mrq_sync_step_notifications(new.id);
  return null;
end $$;

create trigger material_request_steps_notify_trg
  after insert or update of status on public.material_request_steps
  for each row execute function public.mrq_step_notify_trg();

revoke all on function public.mrq_step_recipients(uuid), public.mrq_sync_step_notifications(uuid),
  public.mrq_step_notify_trg() from public, anon, authenticated, service_role;
