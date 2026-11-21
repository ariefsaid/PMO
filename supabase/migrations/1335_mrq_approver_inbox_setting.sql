-- 1335_mrq_approver_inbox_setting.sql — #2685 material-request approvals reach the approver (setting).
-- Spec docs/specs/material-request-approver-inbox.spec.md (FR-MRI-001/002/013/014). Proven by
-- supabase/tests/mrq_approver_inbox.test.sql.
--
-- One flag per organisation on the existing settings row: default OFF, so an existing organisation sees no change.
-- Written only by mrq_set_approver_inbox (Admin only, audited). Turning it ON backfills notifications for every
-- step open now; turning it OFF deletes this feature's unread step notifications for the organisation (both through
-- mrq_sync_step_notifications, defined in 1336 and resolved at call time).
--
-- REVERSE: supabase/migrations/rollback/1335_mrq_approver_inbox_setting_down.sql

alter table public.material_request_settings
  add column approver_inbox boolean not null default false;
comment on column public.material_request_settings.approver_inbox is
  'FR-MRI-001: when true, open material-request steps notify their approvers and list in the approvals inbox. Default off. Written only by mrq_set_approver_inbox().';

-- Internal reader for the triggers. Absent settings row = off.
create or replace function public.mrq_approver_inbox_on(p_org uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.approver_inbox from public.material_request_settings s where s.org_id = p_org), false)
$$;
revoke all on function public.mrq_approver_inbox_on(uuid) from public, anon, authenticated, service_role;

create or replace function public.mrq_set_approver_inbox(p_on boolean) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_step uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                                  -- mut:setting_admin
    raise exception 'MRQ_ADMIN_ONLY: only an Admin can change the approvals inbox setting' using errcode = '42501'; end if;
  if p_on is null then
    raise exception 'MRQ_INVALID: the setting is on or off' using errcode = 'P0001'; end if;
  insert into public.material_request_settings (org_id, approver_inbox, updated_by, updated_at)
  values (v_org, p_on, v_uid, now())
  on conflict (org_id) do update set approver_inbox = excluded.approver_inbox, updated_by = excluded.updated_by, updated_at = now();
  if p_on then
    -- Backfill: every step open now gets its notifications.
    for v_step in select st.id from public.material_request_steps st
                    join public.material_requests r on r.id = st.request_id and r.round = st.round
                   where st.org_id = v_org and st.status = 'open' and r.status = 'pending'
    loop
      perform public.mrq_sync_step_notifications(v_step);
    end loop;
  else
    -- Off: remove this feature's unread step notifications for the organisation.
    delete from public.notifications n
     where n.org_id = v_org and n.read_at is null and n.metadata ? 'mrq_step_id';
  end if;
  perform public.log_audit('material_request.approver_inbox_set', v_org, v_uid, null, jsonb_build_object('on', p_on));
end $$;
revoke all on function public.mrq_set_approver_inbox(boolean) from public, anon, authenticated, service_role;
grant execute on function public.mrq_set_approver_inbox(boolean) to authenticated;
