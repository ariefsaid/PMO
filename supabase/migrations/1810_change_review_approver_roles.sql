-- 1810_change_review_approver_roles.sql — change-review: who may review a quantity change request is a per-organisation setting,
-- (the per-work-order request limit is NOT touched).
-- Spec: docs/specs/change-review.spec.md (FR-CHR-001..006; AC-CHR-001..008). Reversal: rollback/1810_change_review_approver_roles_down.sql.
--   §1 organizations.quantity_change_approver_roles (built-in role keys, default empty = today's route; Admin-only, audited, catalogue keys only).
--   §2 qcr_profile_may_approve / qcr_may_approve_role: the ONE copy of the role rule (base approver levels, or a listed built-in role).
--   §3 restated at head: qcr_assert_approver (1177), qcr_approval_state (1178 as rewritten by 1219: assert_not_light first), qcr_submit (1176 plus the assert_not_light guard of 1530, who is told).
-- Restated bodies are the newest earlier definitions (highest migration number defining each), changed only where noted.
-- drops: the base-level approver list in qcr_assert_approver, qcr_approval_state and qcr_submit moves into qcr_profile_may_approve; the two approval refusals gain a QCR_ code.

-- ── §1 the setting ──────────────────────────────────────────────────────────────────────────────────
alter table public.organizations add column quantity_change_approver_roles text[] not null default '{}';
comment on column public.organizations.quantity_change_approver_roles is
  'change-review / FR-CHR-001: built-in role keys that may approve or return a quantity change request in addition to the Admin, Executive and Finance levels. Empty = today. Admin-only, audited.';

create policy organizations_update_quantity_change_approver_roles on public.organizations for update
  using (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
grant update (quantity_change_approver_roles) on public.organizations to authenticated;

create function public.check_qcr_approver_roles() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.quantity_change_approver_roles is distinct from old.quantity_change_approver_roles then
    if exists (select 1 from unnest(new.quantity_change_approver_roles) k where k is null or public.is_light_role_key(k)) then
      raise exception 'QCR_APPROVER_ROLE_LIGHT: a field role cannot review requests; choose a manager or officer role' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(new.quantity_change_approver_roles) k where not exists (select 1 from public.built_in_roles b where b.key = k)) then
      raise exception 'QCR_APPROVER_ROLE_UNKNOWN: choose reviewer roles from the role list' using errcode = '22023';
    end if;
    -- a reviewer must be able to read the request: only these base levels can (qcr_* reads and the author roles)
    if exists (select 1 from unnest(new.quantity_change_approver_roles) k join public.built_in_roles b on b.key = k
                where b.base_level not in ('Admin','Executive','Project Manager','Finance')) then
      raise exception 'QCR_APPROVER_ROLE_CANNOT_READ: choose a role that can see change requests' using errcode = '22023';
    end if;
    new.quantity_change_approver_roles := (select coalesce(array_agg(distinct k order by k), '{}') from unnest(new.quantity_change_approver_roles) k);
  end if;
  return new;
end; $$;
revoke all on function public.check_qcr_approver_roles() from public, anon, authenticated;
create trigger organizations_check_qcr_approver_roles before update on public.organizations
  for each row execute function public.check_qcr_approver_roles();

create function public.audit_org_qcr_approver_roles() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.quantity_change_approver_roles is distinct from old.quantity_change_approver_roles then
    perform public.log_audit('org.quantity_change_approver_roles.change', new.id, auth.uid(), new.id,
      jsonb_build_object('from', to_jsonb(old.quantity_change_approver_roles), 'to', to_jsonb(new.quantity_change_approver_roles)));
  end if;
  return null;
end; $$;
revoke all on function public.audit_org_qcr_approver_roles() from public, anon, authenticated;
create trigger organizations_audit_qcr_approver_roles after update on public.organizations
  for each row execute function public.audit_org_qcr_approver_roles();

-- ── §2 the role rule ────────────────────────────────────────────────────────────────────────────────
create function public.qcr_profile_may_approve(p_role public.user_role, p_built_in_role text, p_org uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select p_role in ('Admin','Executive','Finance')
      or (p_built_in_role is not null and not public.is_light_role_key(p_built_in_role) and public.org_built_in_roles_enabled(p_org) and exists (select 1 from public.organizations o
            where o.id = p_org and p_built_in_role = any (o.quantity_change_approver_roles)))
$$;
revoke all on function public.qcr_profile_may_approve(public.user_role, text, uuid) from public, anon, authenticated;

create function public.qcr_may_approve_role(p_org uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.qcr_profile_may_approve(public.auth_role(), public.actor_built_in_role(), p_org)
$$;
revoke all on function public.qcr_may_approve_role(uuid) from public, anon, authenticated;

-- ── §3 restated at head ─────────────────────────────────────────────────────────────────────────────
create or replace function public.qcr_assert_approver(p_request public.quantity_change_requests) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if not public.qcr_may_approve_role(p_request.org_id) then
    raise exception 'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list' using errcode = '42501';
  end if;
  if v_uid = p_request.author_id or v_uid = any (p_request.editor_ids) or v_uid is not distinct from p_request.submitted_by then
    raise exception 'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer' using errcode = '42501';
  end if;
end; $$;

create or replace function public.qcr_approval_state(p_request_id uuid)
returns table (can_approve boolean, reason text, eligible_approver_exists boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_req public.quantity_change_requests; v_reason text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id;
  if not found or v_req.org_id is distinct from public.auth_org_id() then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  v_reason := case
    when not public.qcr_may_approve_role(public.auth_org_id()) then 'role'
    when v_uid = v_req.author_id then 'author'
    when v_uid = any (v_req.editor_ids) then 'editor'
    when v_uid is not distinct from v_req.submitted_by then 'submitter'
    when v_req.status <> 'pending_approval' then 'status'
  end;
  return query select v_reason is null, v_reason,
    exists (select 1 from public.profiles p
             where p.org_id = v_req.org_id and public.is_active_member(p.id) and public.qcr_profile_may_approve(p.role, p.built_in_role, v_req.org_id)
               and p.id <> v_req.author_id and p.id <> all (v_req.editor_ids)
               and p.id is distinct from v_req.submitted_by);
end; $$;

create or replace function public.qcr_submit(p_request_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req record; v_wo_status text; r record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to submit a quantity change request' using errcode = '42501';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_uid <> all (v_req.editor_ids) then
    raise exception 'only the author or an editor of this request can submit it' using errcode = '42501';
  end if;
  if v_req.status <> 'draft' then
    raise exception 'only a draft can be submitted; this request is %', v_req.status using errcode = 'P0001';
  end if;
  select w.status into v_wo_status from public.work_orders w where w.id = v_req.work_order_id;
  if v_wo_status in ('Closed','Cancelled') then
    raise exception 'a % work order cannot take a quantity change request', v_wo_status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.quantity_change_request_lines l where l.request_id = p_request_id) then
    raise exception 'a change request needs at least one line' using errcode = '23502';
  end if;
  update public.quantity_change_requests
     set status = 'pending_approval', submitted_by = v_uid, submitted_at = now(),
         first_submitted_at = coalesce(first_submitted_at, now()), updated_at = now()
   where id = p_request_id;
  perform public.qcr_log(p_request_id, 'submitted', 'draft', 'pending_approval');
  -- Tell everyone who could approve it (never the people it is separated from).
  for r in select p.id from public.profiles p
            where p.org_id = v_org and public.qcr_profile_may_approve(p.role, p.built_in_role, v_org) and public.is_active_member(p.id)
              and p.id <> v_req.author_id and p.id <> v_uid and p.id <> all (v_req.editor_ids) loop
    perform public.notify_workflow_user(v_org, r.id, 'Quantity change request awaiting approval',
      'A quantity change request has been submitted for your approval.', 'info', 'quantity_change_request', p_request_id, 'Quantity change request');
  end loop;
end; $$;
