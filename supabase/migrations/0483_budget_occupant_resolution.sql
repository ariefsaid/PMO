-- 0483_budget_occupant_resolution.sql — ECA-6 (#1603, PD-ECA-12): the two ways forward when the ERP already holds a
-- budget PMO did not create for a project, account and year.
--   • "Replace the ERP budget" is a RECORDED, single-use consent naming the exact ERP document. adapter-dispatch reads it
--     with the service role before it relaxes the ownership refusal; the request payload never asserts it.
--   • "Use the ERP figures as a draft" creates a PMO Draft version holding the ERP figures. It runs as the caller (SECURITY
--     INVOKER), so RLS and the budget authorship triggers apply, and it reuses the import protocol's line writer.
-- Rollback: supabase/migrations/rollback/0481_budget_occupant_resolution_down.sql

create table public.budget_occupant_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  fiscal_year text not null check (btrim(fiscal_year) <> ''),
  -- '' on ERPNext 15, whose Budget is per project and year; the account on 16, whose Budget is per account.
  erp_account text not null,
  erp_budget_name text not null check (btrim(erp_budget_name) <> ''),
  consented_by uuid not null references public.profiles(id),
  consented_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (org_id, project_id, fiscal_year, erp_account, erp_budget_name)
);
alter table public.budget_occupant_consents enable row level security;
alter table public.budget_occupant_consents force row level security;
create policy budget_occupant_consents_select on public.budget_occupant_consents for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role()::text in ('Admin', 'Finance'));
revoke all on public.budget_occupant_consents from anon, authenticated;
grant select on public.budget_occupant_consents to authenticated;
grant select, insert, update, delete on public.budget_occupant_consents to service_role;

-- Record the consent. Admin/Finance, own org, and only for a project that has an Active version to push.
create function public.consent_budget_occupant_replace(
  p_project_id uuid, p_fiscal_year text, p_erp_account text, p_erp_budget_name text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_active_member(), false)
     or coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_id is null or coalesce(btrim(p_fiscal_year), '') = '' or p_erp_account is null
     or coalesce(btrim(p_erp_budget_name), '') = '' then
    raise exception 'Invalid budget consent arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.budget_versions v
                  where v.project_id = p_project_id and v.org_id = v_org and v.status = 'Active') then
    raise exception 'the project has no active budget version to push' using errcode = 'P0001';
  end if;
  insert into public.budget_occupant_consents (org_id, project_id, fiscal_year, erp_account, erp_budget_name, consented_by)
    values (v_org, p_project_id, p_fiscal_year, p_erp_account, p_erp_budget_name, auth.uid())
    on conflict (org_id, project_id, fiscal_year, erp_account, erp_budget_name)
    do update set consented_by = excluded.consented_by, consented_at = now(), consumed_at = null
    returning id into v_id;
  perform public.log_audit('budget.occupant_replace_consent', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'fiscal_year', p_fiscal_year, 'erp_account', p_erp_account,
                       'erp_budget_name', p_erp_budget_name));
  return v_id;
end $$;
revoke all on function public.consent_budget_occupant_replace(uuid, text, text, text) from public, anon;
grant execute on function public.consent_budget_occupant_replace(uuid, text, text, text) to authenticated;

-- Spend the consent once the push has replaced the ERP document. Service only; idempotent (a consumed row stays
-- consumed and writes no second audit row). p_actor_id is the verified caller of the push that used it.
create function public.consume_budget_occupant_consent(p_org_id uuid, p_id uuid, p_actor_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.budget_occupant_consents;
begin
  update public.budget_occupant_consents c set consumed_at = now()
   where c.id = p_id and c.org_id = p_org_id and c.consumed_at is null
   returning c.* into v_row;
  if found then
    perform public.log_audit('budget.occupant_replaced', p_org_id, p_actor_id, p_id,
      jsonb_build_object('project_id', v_row.project_id, 'fiscal_year', v_row.fiscal_year,
                         'erp_account', v_row.erp_account, 'erp_budget_name', v_row.erp_budget_name,
                         'consented_by', v_row.consented_by));
  end if;
end $$;
revoke all on function public.consume_budget_occupant_consent(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_budget_occupant_consent(uuid, uuid, uuid) to service_role;

-- A PMO Draft holding the ERP figures. SECURITY INVOKER: the caller's RLS decides, and the lines go through the
-- import protocol's writer (0397), so the Draft-only and role checks stay its own. p_lines is
-- [{category, budgeted_amount, fiscal_year}], built by adapter-dispatch from the ERP document.
create function public.create_budget_draft_from_erp(p_project_id uuid, p_erp_budget_name text, p_lines jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_batch uuid := gen_random_uuid();
  v_at timestamptz := now();
  v_line jsonb;
  v_key text;
  v_outcome text;
begin
  if p_project_id is null or coalesce(btrim(p_erp_budget_name), '') = '' or p_lines is null
     or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Invalid budget draft arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('budget_version:' || p_project_id::text, 0));
  insert into public.budget_versions (project_id, version, name, status, import_batch_id, imported_at)
    select p_project_id, coalesce(max(v.version), 0) + 1, 'From ERP ' || p_erp_budget_name, 'Draft', v_batch, v_at
      from public.budget_versions v where v.project_id = p_project_id
    returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_key := 'erp-budget:' || p_erp_budget_name || ':' || (v_line ->> 'category');
    select r.outcome into v_outcome from public.import_budget_line_v2(
      v_id, (v_line ->> 'category')::public.budget_category, 'From ERP budget ' || p_erp_budget_name,
      (v_line ->> 'budgeted_amount')::numeric, v_line ->> 'fiscal_year', v_batch, v_at, v_key, v_key, false) r;
    if v_outcome is distinct from 'created' then
      raise exception 'budget line % was not created (%)', v_line ->> 'category', v_outcome using errcode = '23505';
    end if;
  end loop;
  return v_id;
end $$;
revoke all on function public.create_budget_draft_from_erp(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.create_budget_draft_from_erp(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
