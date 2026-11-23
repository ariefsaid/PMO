-- 1771_billing_steps_capabilities.sql — the two billing-step rights, their ONE gate each, and the step read rule.
-- Rollback: supabase/migrations/rollback/1771_billing_steps_capabilities_down.sql
-- billing_steps_view ("see billing steps") and billing_steps_run ("run billing steps") join the role capability catalogue (1200, 1539).
-- Each is read by exactly one gate function through actor_has_role_capability (supabase/tests/2716). A person with no built-in role key
-- holds no capability, so the gates fall back to today's claim-step levels for them: see = Admin, Executive, Project Manager, Finance
-- (the claim-step readers, 1021/1365); run = Admin, Finance, Project Manager (the claim-step writers, 1367).
-- Combined with the per-step hidden-from list (wo_step_readable): HIDDEN beats every right except being the step's named person;
-- otherwise a step is read by a holder of "see" or by a holder of the step's owner role; and acted on by a holder of "run", a holder of
-- the step's owner role or its named person (1772). Light accounts hold neither right and are refused by the database.
-- Source of the capability CHECK list: 1539 (the latest migration that defines it).

alter table public.built_in_role_capabilities drop constraint built_in_role_capabilities_capability_check;
alter table public.built_in_role_capabilities add constraint built_in_role_capabilities_capability_check
  check (capability in ('sees_prices', 'daily_report_enter', 'daily_report_validate', 'people_documents_view', 'medical_documents_view',
                        'billing_steps_view', 'billing_steps_run'));

-- role key, capability (ONE tuple per line: the parity test parses this).
insert into public.built_in_role_capabilities (role_key, capability) values
('executive','billing_steps_view'),
('administrator','billing_steps_view'),
('project_manager','billing_steps_view'),
('deputy_project_manager','billing_steps_view'),
('project_control_manager','billing_steps_view'),
('construction_manager','billing_steps_view'),
('procurement_manager','billing_steps_view'),
('finance_manager','billing_steps_view'),
('quality_manager','billing_steps_view'),
('safety_manager','billing_steps_view'),
('equipment_manager','billing_steps_view'),
('hr_manager','billing_steps_view'),
('finance_officer','billing_steps_view'),
('billing_officer','billing_steps_view'),
('quantity_surveyor','billing_steps_view'),
('project_administrator','billing_steps_view'),
('site_supervisor','billing_steps_view'),
('administrator','billing_steps_run'),
('project_manager','billing_steps_run'),
('deputy_project_manager','billing_steps_run'),
('project_control_manager','billing_steps_run'),
('finance_manager','billing_steps_run'),
('finance_officer','billing_steps_run'),
('billing_officer','billing_steps_run'),
('quantity_surveyor','billing_steps_run'),
('project_administrator','billing_steps_run');

-- may_see_billing_steps(profile) is the ONE reader of the see right (supabase/tests/2716); the signed-in adapter and the email function call it.
-- Not executable by signed-in callers (an is-this-person-X oracle, as may_see_medical_documents).
create function public.may_see_billing_steps(p_profile uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select public.is_active_member(p_profile)
                          and (public.role_has_capability(p.built_in_role, 'billing_steps_view')
                               or (p.built_in_role is null and p.role in ('Admin','Executive','Project Manager','Finance')))
                     from public.profiles p where p.id = p_profile), false)
$$;
revoke all on function public.may_see_billing_steps(uuid) from public, anon, authenticated;
grant execute on function public.may_see_billing_steps(uuid) to service_role;

create function public.actor_may_see_billing_steps() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.may_see_billing_steps(auth.uid()), false)
$$;
revoke all on function public.actor_may_see_billing_steps() from public, anon;
grant execute on function public.actor_may_see_billing_steps() to authenticated, service_role;

create function public.actor_may_run_billing_steps() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.actor_has_role_capability('billing_steps_run')
                  or (public.actor_built_in_role() is null and public.is_active_member() and public.auth_role() in ('Admin','Finance','Project Manager')), false)
$$;
revoke all on function public.actor_may_run_billing_steps() from public, anon;
grant execute on function public.actor_may_run_billing_steps() to authenticated, service_role;

-- The ONE read rule for a step row and its documents (policies and the 1772 lock call it; no other copy exists). STRICT boolean: every
-- NULL (no named person, no role key) is folded to false, so a NULL can never make a refusal or a hidden-from test fail open.
-- The caller's own organisation and an active membership are the policy's own terms; a light account is refused by its restrictive policy.
create function public.wo_step_readable(p_assignee uuid, p_owner_key text, p_hidden text[]) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(coalesce(p_assignee = auth.uid(), false)
      or (not coalesce(public.actor_built_in_role() = any (coalesce(p_hidden, '{}')), false)
          and (coalesce(public.actor_may_see_billing_steps(), false)
               or coalesce(p_owner_key is not null and p_owner_key = public.actor_built_in_role(), false))), false)
$$;
revoke all on function public.wo_step_readable(uuid, text, text[]) from public, anon;
grant execute on function public.wo_step_readable(uuid, text, text[]) to authenticated, service_role;

-- Does the caller hold the step's owner role FOR THIS PROJECT? A role whose base level is Project Manager owns a step only on the
-- projects its holder manages (as claim steps: acting, notices and the waiting list); other roles own it organisation-wide.
create function public.wo_step_owner_matches(p_owner_key text, p_project uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(p_owner_key is not null and p_owner_key = public.actor_built_in_role()
                  and (public.built_in_role_base(p_owner_key) is distinct from 'Project Manager'
                       or exists (select 1 from public.projects pr where pr.id = p_project and pr.project_manager_id = auth.uid())), false)
$$;
revoke all on function public.wo_step_owner_matches(text, uuid) from public, anon;
grant execute on function public.wo_step_owner_matches(text, uuid) to authenticated, service_role;

create policy work_order_billing_steps_select on public.work_order_billing_steps for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and public.wo_step_readable(assignee_id, owner_role_key, hidden_from_role_keys));

-- A step's documents follow the step: the subquery runs under the step's own policy, so a hidden step shows no documents either.
create policy work_order_billing_step_documents_select on public.work_order_billing_step_documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.work_order_billing_steps s where s.id = step_id));
