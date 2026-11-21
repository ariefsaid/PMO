-- 1337_mrq_notify_resync.sql — #2685 a pin or stand-in change re-points the notifications of steps already open.
-- Spec docs/specs/material-request-approver-inbox.spec.md (FR-MRI-007). Proven by supabase/tests/mrq_approver_inbox.test.sql.
--
-- A pin change affects the open steps of that project's pending requests at that position; a stand-in change affects
-- the open steps of the organisation (bounded: open steps of pending requests). Both just re-run the sync.
--
-- REVERSE: supabase/migrations/rollback/1337_mrq_notify_resync_down.sql

create or replace function public.mrq_pin_notify_trg() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_proj uuid := coalesce(new.project_id, old.project_id); v_pos integer := coalesce(new.position, old.position); v_step uuid;
begin
  for v_step in select st.id from public.material_request_steps st
                  join public.material_requests r on r.id = st.request_id and r.round = st.round
                 where r.project_id = v_proj and st.position = v_pos and st.status = 'open' and r.status = 'pending'
  loop
    perform public.mrq_sync_step_notifications(v_step);
  end loop;
  return null;
end $$;
create trigger approval_step_pins_notify_trg
  after insert or update or delete on public.approval_step_pins
  for each row execute function public.mrq_pin_notify_trg();

create or replace function public.mrq_stand_in_notify_trg() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := coalesce(new.org_id, old.org_id); v_step uuid;
begin
  for v_step in select st.id from public.material_request_steps st
                  join public.material_requests r on r.id = st.request_id and r.round = st.round
                 where st.org_id = v_org and st.status = 'open' and r.status = 'pending'
  loop
    perform public.mrq_sync_step_notifications(v_step);
  end loop;
  return null;
end $$;
create trigger approval_stand_ins_notify_trg
  after insert or update of revoked_at, starts_on, ends_on on public.approval_stand_ins
  for each row execute function public.mrq_stand_in_notify_trg();

revoke all on function public.mrq_pin_notify_trg(), public.mrq_stand_in_notify_trg() from public, anon, authenticated, service_role;
