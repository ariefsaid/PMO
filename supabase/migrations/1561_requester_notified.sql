-- 1561_requester_notified.sql — the person who made a request is told when it is returned, refused or approved, with the reason (fix-waiting item 4).
-- Before this, a material request returned or refused, a daily report returned, a subcontract certificate returned and an equipment plan decided
-- told the person nothing. Each decision already writes its state and reason; these AFTER triggers only READ that state and write one in-app
-- notification to the requester through notify_workflow_user (0237/1224: same organisation, active member, never the acting user).
-- Titles are fixed English strings that the app translates by title (src/lib/i18n/notificationCopy.ts); the reason is the user's own text in the body;
-- the record's number or name rides in metadata.entity.label so a notification always says WHAT was decided.
-- No decision rule changes. Triggers are not executable by anon or authenticated.
-- REVERSE: rollback/1561_requester_notified_down.sql

create function public.notify_requester_mrq_step() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.material_requests;
begin
  if old.status is not distinct from new.status or old.status <> 'open' or new.status not in ('returned', 'rejected') then return new; end if;
  select * into r from public.material_requests where id = new.request_id;
  if not found then return new; end if;
  perform public.notify_workflow_user(r.org_id, r.created_by,
    case new.status when 'returned' then 'Your material request was sent back' else 'Your material request was refused' end,
    nullif(btrim(coalesce(new.reason, '')), ''), 'warning', 'material_request', r.id, r.number);
  return new;
end; $$;
revoke all on function public.notify_requester_mrq_step() from public, anon, authenticated;
create trigger material_request_steps_notify_requester after update of status on public.material_request_steps
  for each row execute function public.notify_requester_mrq_step();

create function public.notify_requester_mrq_approved() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status is distinct from new.status and old.status = 'pending' and new.status = 'approved' then
    perform public.notify_workflow_user(new.org_id, new.created_by, 'Your material request was approved', null, 'info', 'material_request', new.id, new.number);
  end if;
  return new;
end; $$;
revoke all on function public.notify_requester_mrq_approved() from public, anon, authenticated;
create trigger material_requests_notify_requester_approved after update of status on public.material_requests
  for each row execute function public.notify_requester_mrq_approved();

create function public.notify_requester_dsr_returned() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_label text;
begin
  if old.status is distinct from new.status and old.status = 'submitted' and new.status = 'returned' then
    select coalesce(w.wo_number || ' · ', '') || w.title || ' · ' || to_char(new.work_date, 'YYYY-MM-DD') into v_label
      from public.work_orders w where w.id = new.work_order_id;
    perform public.notify_workflow_user(new.org_id, new.author_id, 'Your daily report was sent back', nullif(btrim(coalesce(new.returned_reason, '')), ''),
      'warning', 'daily_site_report', new.id, v_label);
  end if;
  return new;
end; $$;
revoke all on function public.notify_requester_dsr_returned() from public, anon, authenticated;
create trigger daily_site_reports_notify_requester after update of status on public.daily_site_reports
  for each row execute function public.notify_requester_dsr_returned();

create function public.notify_requester_certificate_returned() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_label text;
begin
  if old.status is distinct from new.status and old.status = 'submitted' and new.status = 'returned' then
    select pr.title into v_label from public.procurements pr where pr.id = new.procurement_id;
    perform public.notify_workflow_user(new.org_id, new.prepared_by, 'Your subcontract certificate was sent back', nullif(btrim(coalesce(new.returned_reason, '')), ''),
      'warning', 'subcontract_certificate', new.id, v_label);
  end if;
  return new;
end; $$;
revoke all on function public.notify_requester_certificate_returned() from public, anon, authenticated;
create trigger subcontract_certificates_notify_requester after update of status on public.subcontract_certificates
  for each row execute function public.notify_requester_certificate_returned();

create function public.notify_requester_equipment_plan() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_label text;
begin
  if old.status is distinct from new.status and old.status = 'Submitted' and new.status in ('Rejected', 'Approved') then
    select pj.name || ' · ' || to_char(new.plan_month, 'YYYY-MM') into v_label from public.projects pj where pj.id = new.project_id;
    perform public.notify_workflow_user(new.org_id, new.created_by,
      case new.status when 'Rejected' then 'Your equipment plan was sent back' else 'Your equipment plan was approved' end,
      case new.status when 'Rejected' then nullif(btrim(coalesce(new.reject_reason, '')), '') end,
      case new.status when 'Rejected' then 'warning' else 'info' end, 'equipment_plan', new.id, v_label);
  end if;
  return new;
end; $$;
revoke all on function public.notify_requester_equipment_plan() from public, anon, authenticated;
create trigger equipment_plans_notify_requester after update of status on public.equipment_plans
  for each row execute function public.notify_requester_equipment_plan();
