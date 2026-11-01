-- ECA-2 (#1605): census, match proposals and one-pass accept (FR-ECA-001..016). Tier-keyed, shared by ERPNext and Odoo.
-- Four tables (run, staged ERP pages, census, proposals) and sixteen functions. Reversal: rollback/0480_erp_connect_setup_down.sql.
--
-- Who may do what:
--   * service role (the edge function, from the org's own binding): start a run, write the census, stage pages,
--     write proposals, apply one outcome. Every writer takes the org explicitly and scopes by it.
--   * Admin (Finance for account rows): accept, decide a review, unlink. The actor is `auth.uid()`, never a parameter;
--     org, active membership and role are re-asserted in each body (the 0148 pattern).
--   * Nobody on a user JWT writes any of the four tables, and nobody on a user JWT reads `erp_connect_staged`.

create table public.erp_connect_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null references public.external_org_bindings(id) on delete cascade,   -- a disconnect takes the setup state with it
  external_tier text not null,
  state text not null default 'staging' check (state in ('staging','proposing','ready','failed')),
  cursor jsonb not null default '{}'::jsonb check (jsonb_typeof(cursor) = 'object'),   -- {kind: next cursor|null}
  proposed_kinds text[] not null default '{}',                                         -- kinds proposed so far (one per tick)
  started_by uuid references public.profiles(id), started_at timestamptz not null default now(),
  finished_at timestamptz, error_class text,   -- finished_at: the run is over. ready and finished_at null = proposals are in, sends still wait
  failed_ticks int not null default 0          -- consecutive ticks that failed; a page that lands resets it
);
create unique index erp_connect_runs_one_open on public.erp_connect_runs (org_id, external_tier) where state in ('staging','proposing');

-- PD-ECA-1: one run's ERP master pages. Never Odoo's directory mirror; deleted with the run.
create table public.erp_connect_staged (
  run_id uuid not null references public.erp_connect_runs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('party','item','project','employee','account')),
  external_id text not null,
  row jsonb not null check (jsonb_typeof(row) = 'object'),   -- the NormalisedMaster
  primary key (run_id, kind, external_id)
);

create table public.erp_connect_census (
  org_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null references public.external_org_bindings(id) on delete cascade,
  external_tier text not null,
  kind text not null check (kind in ('party','item','project','employee','account',
                                     'budget','purchase','invoice','receipt','payment','timesheet')),
  pmo_count int not null, erp_count int, linked_count int not null default 0, inactive_erp_count int not null default 0,
  scenario text check (scenario in ('none','S-A','S-C','S-D')),   -- null: this ERP cannot count the domain yet
  accepted_at timestamptz,                                          -- PD-ECA-15: first bulk accept of this kind
  taken_at timestamptz not null default now(),
  primary key (org_id, external_tier, kind)
);

create table public.erp_connect_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null references public.external_org_bindings(id) on delete cascade,   -- only this connection's rows can apply
  external_tier text not null,
  run_id uuid references public.erp_connect_runs(id) on delete set null,
  kind text not null check (kind in ('party','item','project','employee','account')),
  outcome text not null check (outcome in ('link','bring-in','send','review')),
  identity text not null,                      -- outcome|sorted pmo ids|sorted external ids: re-proposal upserts
  pmo_ids text[] not null default '{}', external_ids text[] not null default '{}',
  match_key text check (match_key in ('tax','code','name')),
  reason text check (reason in ('ambiguous','tax-conflict','rejected','held')),
  reason_text text,                            -- plain words, never ERP vocabulary (FR-ECA-022)
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),  -- the ERP fields a link/bring-in applies (PD-ECA-2)
  state text not null default 'open' check (state in ('open','sending','applied','dismissed')),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, external_tier, kind, identity),
  check (outcome not in ('link','bring-in') or cardinality(external_ids) = 1),   -- accept applies [1]: a link or bring-in names one ERP row
  check (outcome <> 'link' or cardinality(pmo_ids) = 1)
);
create index erp_connect_proposals_queue on public.erp_connect_proposals (org_id, external_tier, kind, outcome, state);

alter table public.erp_connect_runs enable row level security;      alter table public.erp_connect_runs force row level security;
alter table public.erp_connect_staged enable row level security;    alter table public.erp_connect_staged force row level security;
alter table public.erp_connect_census enable row level security;    alter table public.erp_connect_census force row level security;
alter table public.erp_connect_proposals enable row level security; alter table public.erp_connect_proposals force row level security;
create policy erp_connect_runs_select on public.erp_connect_runs for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Finance'));
create policy erp_connect_census_select on public.erp_connect_census for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Finance'));
create policy erp_connect_proposals_select on public.erp_connect_proposals for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and (public.auth_role() = 'Admin' or (public.auth_role() = 'Finance' and kind = 'account')));
-- erp_connect_staged: no client policy and no client grant (it holds raw ERP names, including people).
revoke all on public.erp_connect_runs, public.erp_connect_staged, public.erp_connect_census, public.erp_connect_proposals from anon, authenticated;
grant select on public.erp_connect_runs, public.erp_connect_census, public.erp_connect_proposals to authenticated;
grant select, insert, update, delete on public.erp_connect_runs, public.erp_connect_staged, public.erp_connect_census,
  public.erp_connect_proposals to service_role;

-- FR-ODC-073 / FR-ECA-015: the ONE re-link check. A link is in use once an ERP document that names the master exists.
-- Later slices (Odoo O2+, inventory) extend THIS function; they never add a second check.
create or replace function public.connect_link_in_use(p_org_id uuid, p_domain text, p_pmo_record_id text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select case p_domain
    when 'companies' then exists (
        select 1 from public.procurements p
         where p.org_id = p_org_id and p.vendor_id::text = p_pmo_record_id
           and public.procurement_case_has_external_evidence(p_org_id, p.id))      -- outbox, #1319 links, any ref (0393)
      or exists (select 1 from public.sales_invoices si where si.org_id = p_org_id and si.customer_id::text = p_pmo_record_id
                    and (not si.pmo_native and si.erp_docstatus is not null
                         or exists (select 1 from public.external_refs r where r.org_id = p_org_id and r.domain = 'revenue'
                                       and r.pmo_record_id = si.id::text)))
    when 'projects' then exists (
        select 1 from public.procurements p
         where p.org_id = p_org_id and p.project_id::text = p_pmo_record_id
           and public.procurement_case_has_external_evidence(p_org_id, p.id))
      or exists (select 1 from public.sales_invoices si where si.org_id = p_org_id and si.project_id::text = p_pmo_record_id
                    and (not si.pmo_native and si.erp_docstatus is not null
                         or exists (select 1 from public.external_refs r where r.org_id = p_org_id and r.domain = 'revenue'
                                       and r.pmo_record_id = si.id::text)))
      or exists (select 1 from public.budget_version_account_erp_mirror m join public.budget_versions v on v.id = m.budget_version_id
                  where m.org_id = p_org_id and v.project_id::text = p_pmo_record_id)
    when 'employees' then exists (
        select 1 from public.timesheets t join public.external_refs r
          on r.org_id = t.org_id and r.domain = 'timesheets' and r.pmo_record_id = t.id::text
         where t.org_id = p_org_id and t.user_id::text = p_pmo_record_id)
    when 'accounts' then exists (
        select 1 from public.budget_version_account_erp_mirror m join public.budget_category_account_map a
          on a.org_id = m.org_id and a.erp_account = m.erp_account
         where m.org_id = p_org_id and a.category::text = p_pmo_record_id)
    else false end   -- items: a pushed line carries its code; unlinking changes only future lines
$$;
revoke all on function public.connect_link_in_use(uuid,text,text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Service-only writers. `p_org_id` is resolved by the caller from the binding (NFR-ECA-003); each scopes by it.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.start_connect_run(p_org_id uuid, p_tier text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active') then
    raise exception 'no active connection for this ERP';
  end if;
  if p_actor is not null and not exists (select 1 from public.profiles where id = p_actor and org_id = p_org_id) then
    raise exception 'actor is not in this organisation';
  end if;
  insert into public.erp_connect_runs (org_id, binding_id, external_tier, started_by)
    values (p_org_id, (select id from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active'), p_tier, p_actor)
    on conflict (org_id, external_tier) where state in ('staging','proposing') do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.erp_connect_runs where org_id = p_org_id and external_tier = p_tier and state in ('staging','proposing');
  end if;
  return v_id;
end $$;

create or replace function public.write_connect_census(p_org_id uuid, p_tier text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_binding uuid;
begin
  select id into v_binding from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active';
  if v_binding is null then raise exception 'no active connection for this ERP'; end if;
  insert into public.erp_connect_census (org_id, binding_id, external_tier, kind, pmo_count, erp_count, scenario)
    select p_org_id, v_binding, p_tier, r->>'kind', (r->>'pmoCount')::int, (r->>'erpCount')::int, r->>'scenario'
      from jsonb_array_elements(p_rows) r
  on conflict (org_id, external_tier, kind) do update
    set binding_id = excluded.binding_id, pmo_count = excluded.pmo_count, erp_count = excluded.erp_count, scenario = excluded.scenario, taken_at = now();
end $$;

create or replace function public.stage_connect_master_page(p_org_id uuid, p_run_id uuid, p_kind text, p_rows jsonb, p_next_cursor text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.erp_connect_runs%rowtype; v_cursor jsonb;
begin
  select * into v_run from public.erp_connect_runs where id = p_run_id and org_id = p_org_id and state = 'staging' for update;
  if not found then raise exception 'no staging run for this organisation'; end if;
  insert into public.erp_connect_staged (run_id, org_id, kind, external_id, row)
    select p_run_id, p_org_id, p_kind, r->>'externalId', r from jsonb_array_elements(p_rows) r
  on conflict (run_id, kind, external_id) do update set row = excluded.row;
  v_cursor := jsonb_set(v_run.cursor, array[p_kind], coalesce(to_jsonb(p_next_cursor), 'null'::jsonb));
  update public.erp_connect_runs set cursor = v_cursor, failed_ticks = 0,
      state = case when (select count(*) from unnest(array['party','item','project','employee','account']) k where v_cursor->k = 'null'::jsonb) = 5
                   then 'proposing' else state end
    where id = p_run_id;
end $$;

create or replace function public.replace_connect_proposals(p_org_id uuid, p_tier text, p_run_id uuid, p_kind text, p_rows jsonb, p_last boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.erp_connect_runs%rowtype;
begin
  select * into v_run from public.erp_connect_runs where id = p_run_id and org_id = p_org_id and external_tier = p_tier for update;
  if not found then raise exception 'no run for this organisation'; end if;
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, run_id, kind, outcome, identity, pmo_ids, external_ids, match_key, reason, reason_text, snapshot)
    select p_org_id, v_run.binding_id, p_tier, p_run_id, p_kind, x.outcome,
           x.outcome || '|' || to_jsonb(x.pmo)::text || '|' || to_jsonb(x.ext)::text, x.pmo, x.ext, x.key, x.reason, x.reason_text, x.snapshot
      from (select r->>'outcome' as outcome,
                   array(select jsonb_array_elements_text(coalesce(r->'pmoIds','[]')) order by 1) as pmo,
                   array(select jsonb_array_elements_text(coalesce(r->'externalIds','[]')) order by 1) as ext,
                   r->>'key' as key, r->>'reason' as reason, r->>'reasonText' as reason_text,
                   coalesce(r->'snapshot','{}'::jsonb) as snapshot
              from jsonb_array_elements(p_rows) r) x
  on conflict (org_id, external_tier, kind, identity) do update
    set run_id = excluded.run_id, snapshot = excluded.snapshot, reason = excluded.reason, reason_text = excluded.reason_text
    where public.erp_connect_proposals.state = 'open';
  if p_last then
    -- a proposal an earlier run made and this one no longer makes disappears; applied and in-flight history stays, and so does
    -- a review row no run wrote (run_id null: the feed's, a held send), which a matcher run cannot re-derive
    delete from public.erp_connect_proposals
     where org_id = p_org_id and external_tier = p_tier and kind = p_kind and state = 'open' and run_id is not null and run_id <> p_run_id;
    update public.erp_connect_census c
       set linked_count = (select count(*) from public.erp_connect_proposals p
                            where p.org_id = p_org_id and p.external_tier = p_tier and p.kind = p_kind and p.outcome = 'link'),
           inactive_erp_count = (select count(*) from public.erp_connect_staged s
                                  where s.run_id = p_run_id and s.kind = p_kind and s.row->>'active' = 'false')
     where c.org_id = p_org_id and c.external_tier = p_tier and c.kind = p_kind;
    update public.erp_connect_runs
       set proposed_kinds = case when p_kind = any(proposed_kinds) then proposed_kinds else proposed_kinds || p_kind end,
           failed_ticks = 0
     where id = p_run_id;
    update public.erp_connect_runs set state = 'ready'
     where id = p_run_id and state in ('staging','proposing')
       and (select count(*) from unnest(array['party','item','project','employee','account']) k where k = any(proposed_kinds)) = 5;
    if found then
      delete from public.erp_connect_staged where run_id = p_run_id;
      perform public.settle_connect_run(p_org_id, p_tier);   -- ready is not over while a send waits for the ERP
    end if;
  end if;
end $$;

-- Minor 8: a run that cannot finish must end, or it blocks every later run of this org and tier. A tick that throws counts one
-- failure; three in a row, or a run that outlived its budget (p_fatal), ends it. A page that lands resets the count.
create or replace function public.fail_connect_run(p_org_id uuid, p_run_id uuid, p_error_class text, p_fatal boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state text;
begin
  update public.erp_connect_runs
     set failed_ticks = failed_ticks + 1,
         state = case when p_fatal or failed_ticks + 1 >= 3 then 'failed' else state end,
         error_class = case when p_fatal or failed_ticks + 1 >= 3 then left(coalesce(p_error_class, 'unknown'), 64) else error_class end,
         finished_at = case when p_fatal or failed_ticks + 1 >= 3 then now() else finished_at end
   where id = p_run_id and org_id = p_org_id and state in ('staging','proposing')
   returning state into v_state;
  if v_state is null then raise exception 'no open run for this organisation'; end if;
  if v_state = 'failed' then delete from public.erp_connect_staged where run_id = p_run_id; end if;
  return v_state;
end $$;

-- Minor 10: sends park in `sending` until ECA-3's drain. A ready run is complete only when no send waits; ECA-3's drain calls this
-- after it resolves the last one, and accept re-opens a completed run when it queues a send.
create or replace function public.settle_connect_run(p_org_id uuid, p_tier text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.erp_connect_runs r set finished_at = now()
   where r.org_id = p_org_id and r.external_tier = p_tier and r.state = 'ready' and r.finished_at is null
     and not exists (select 1 from public.erp_connect_proposals p
                      where p.org_id = p_org_id and p.external_tier = p_tier and p.state = 'sending')
$$;

create or replace function public.record_connect_review(p_org_id uuid, p_tier text, p_kind text, p_pmo_ids text[], p_external_ids text[],
                                                         p_reason text, p_reason_text text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pmo text[] := array(select unnest(coalesce(p_pmo_ids,'{}')) order by 1); v_ext text[] := array(select unnest(coalesce(p_external_ids,'{}')) order by 1);
begin
  if not exists (select 1 from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active') then
    raise exception 'no active connection for this ERP';
  end if;
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, reason, reason_text)
    values (p_org_id, (select id from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active'), p_tier, p_kind, 'review', 'review|' || to_jsonb(v_pmo)::text || '|' || to_jsonb(v_ext)::text, v_pmo, v_ext, p_reason, p_reason_text)
  on conflict (org_id, external_tier, kind, identity) do update set reason = excluded.reason, reason_text = excluded.reason_text
    where public.erp_connect_proposals.state = 'open';
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Internal appliers. Each returns null when applied (or already applied: reconciled), else the plain reason the row
-- stays open with, so one bad row never aborts a batch. Every one re-checks that the PMO record is in `p_org`.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.connect_config_map_link(p_org uuid, p_tier text, p_map text, p_key text, p_ext text, p_unique_target boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  update public.external_org_bindings
     set config = jsonb_set(config, array[p_map], coalesce(config->p_map, '{}'::jsonb) || jsonb_build_object(p_key, p_ext))
   where org_id = p_org and external_tier = p_tier and status = 'active'
     and not (coalesce(config->p_map, '{}'::jsonb) ? p_key)
     and (not p_unique_target or not exists (select 1 from jsonb_each_text(coalesce(config->p_map, '{}'::jsonb)) e where e.value = p_ext));
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

create or replace function public.connect_link_project(p_org uuid, p_tier text, p_pmo text, p_ext text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_tier <> 'erpnext' then return 'Project links for this ERP are not available yet'; end if;
  if public.connect_config_map_link(p_org, p_tier, 'project_map', p_pmo, p_ext, true) then return null; end if;
  if exists (select 1 from public.external_org_bindings where org_id = p_org and external_tier = p_tier and status = 'active'
               and config->'project_map'->>p_pmo = p_ext) then return null; end if;
  return 'This project is already linked';
end $$;

create or replace function public.apply_connect_link(p_org uuid, p_tier text, p_kind text, p_pmo text, p_ext text, p_snapshot jsonb, p_actor uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uuid uuid; v_n int; v_ref public.external_refs%rowtype; v_emp public.erp_employees%rowtype; v_email text; v_emps int;
        v_key text := p_snapshot->>'matchKey'; v_reviewed boolean := coalesce((p_snapshot->>'reviewed')::boolean, false);
begin
  -- A person's cost identity and a budget account link only on their strong key (the work email, the category code) or after a
  -- person has looked at the pair (decide_connect_review). A name, or a key this function cannot recheck, never links.
  if p_kind in ('employee', 'account') and not v_reviewed and v_key is distinct from 'code' then return 'This pairing needs a person to confirm it'; end if;
  if p_kind = 'party' then
    if not exists (select 1 from public.companies where id = p_pmo::uuid and org_id = p_org) then return 'This company is no longer in PMO'; end if;
    -- a tax-keyed link is only as good as the tax id: it must still be the one that was proposed
    if v_key = 'tax' and not v_reviewed and regexp_replace(lower(coalesce((select erp_tax_id from public.companies where id = p_pmo::uuid), '')), '[^0-9a-z]', '', 'g')
         is distinct from regexp_replace(lower(coalesce(p_snapshot->>'taxId', '')), '[^0-9a-z]', '', 'g') then
      return 'The ERP record changed since this was proposed';
    end if;
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (p_org, 'companies', p_pmo, p_tier, p_ext) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      -- the tax id is filled, never overwritten; while companies belong to the ERP the feed owns the column
      if coalesce(p_snapshot->>'taxId', '') <> '' and not public.domain_externally_owned(p_org, 'companies') then
        update public.companies set erp_tax_id = coalesce(erp_tax_id, p_snapshot->>'taxId') where id = p_pmo::uuid and org_id = p_org;
      end if;
      return null;
    end if;
    select * into v_ref from public.external_refs where org_id = p_org and domain = 'companies' and pmo_record_id = p_pmo;
    if found and v_ref.external_record_id = p_ext then return null; end if;   -- reconciled
    return 'This record is already linked to another ERP record';
  elsif p_kind = 'project' then
    if not exists (select 1 from public.projects where id = p_pmo::uuid and org_id = p_org) then return 'This project is no longer in PMO'; end if;
    return public.connect_link_project(p_org, p_tier, p_pmo, p_ext);
  elsif p_kind = 'item' then
    if public.connect_config_map_link(p_org, p_tier, 'item_map', p_pmo, p_ext, false) then return null; end if;
    if exists (select 1 from public.external_org_bindings where org_id = p_org and external_tier = p_tier and status = 'active'
                 and config->'item_map'->>p_pmo = p_ext) then return null; end if;
    return 'This item is already linked';
  elsif p_kind = 'employee' then
    -- employee_number is display-only and not unique: never guess between two rows
    select count(*) into v_emps from public.erp_employees where org_id = p_org and employee_number = p_ext;
    if v_emps = 0 then return 'This person has not been read from the ERP yet'; end if;
    if v_emps > 1 then return 'More than one ERP person has this number'; end if;
    select * into v_emp from public.erp_employees where org_id = p_org and employee_number = p_ext for update;
    v_uuid := p_pmo::uuid;
    select lower(email) into v_email from public.profiles where id = v_uuid and org_id = p_org;
    if v_email is null then return 'This person is no longer in PMO'; end if;
    if v_emp.link_state = 'confirmed' then
      return case when v_emp.profile_id = v_uuid then null else 'This ERP employee is already linked to another person' end;
    end if;
    if v_emp.link_state = 'rejected' then return 'An administrator declined this pairing'; end if;
    -- an email-keyed match is only as good as the email: the Desk can edit it, so it must still be what was proposed
    if not v_reviewed and lower(coalesce(nullif(v_emp.work_email, ''), v_emp.erp_user_id, '')) is distinct from v_email then
      return 'The ERP record changed since this was proposed';
    end if;
    begin
      update public.erp_employees set profile_id = v_uuid, link_state = 'confirmed', linked_by = p_actor, linked_at = now()
       where id = v_emp.id;
    exception when unique_violation then
      return 'This person is already linked to another ERP employee';
    end;
    return null;
  elsif p_kind = 'account' then
    -- the category code the ERP account was proposed under must still be the category being linked
    if not v_reviewed and p_snapshot->>'code' is distinct from p_pmo then return 'The ERP account changed since this was proposed'; end if;
    insert into public.budget_category_account_map (org_id, category, erp_account, updated_by)
      values (p_org, p_pmo::public.budget_category, p_ext, p_actor) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then return null; end if;
    if exists (select 1 from public.budget_category_account_map where org_id = p_org and category = p_pmo::public.budget_category and erp_account = p_ext) then
      return null;   -- reconciled
    end if;
    return 'This account is already used by another category';
  end if;
  return 'This kind cannot be linked';
end $$;

create or replace function public.apply_connect_bring_in(p_org uuid, p_tier text, p_kind text, p_ext text, p_snapshot jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_claimed uuid; v_type public.company_type;
begin
  if p_kind <> 'party' then return 'This kind cannot be brought in'; end if;
  v_type := case p_snapshot->>'role' when 'vendor' then 'Vendor' when 'client' then 'Client' end;
  if v_type is null or coalesce(trim(p_snapshot->>'name'), '') = '' then return 'The ERP record is incomplete'; end if;
  -- claim the reference first (the order of onboarding.ts): a lost race writes no company
  insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
    values (p_org, 'companies', v_id::text, p_tier, p_ext)
    on conflict (org_id, domain, external_record_id) do nothing returning pmo_record_id::uuid into v_claimed;
  if v_claimed is null then
    select pmo_record_id::uuid into v_claimed from public.external_refs where org_id = p_org and domain = 'companies' and external_record_id = p_ext;
    if v_claimed is null or exists (select 1 from public.companies where id = v_claimed) then return null; end if;   -- reconciled
    v_id := v_claimed;   -- a claimed link whose company never landed: repair with the same id
  end if;
  insert into public.companies (id, org_id, name, type, erp_tax_id, erp_party_type, erp_supplier_name, erp_customer_name, erp_payment_terms_days)
    values (v_id, p_org, trim(p_snapshot->>'name'), v_type, nullif(p_snapshot->>'taxId', ''), v_type::text,
            case when v_type = 'Vendor' then trim(p_snapshot->>'name') end, case when v_type = 'Client' then trim(p_snapshot->>'name') end,
            case when v_type = 'Client' then 30 end);
  return null;
end $$;

create or replace function public.apply_connect_outcome(p_org_id uuid, p_tier text, p_kind text, p_outcome text, p_pmo_id text, p_external_id text, p_snapshot jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active') then
    return 'No active connection for this ERP';
  end if;
  -- A person's cost identity is confirmed by a person (OQ-TSP-10(C)): the feed never links employees.
  if p_kind = 'employee' then return 'A person link needs an administrator'; end if;
  begin
    if p_outcome = 'link' then return public.apply_connect_link(p_org_id, p_tier, p_kind, p_pmo_id, p_external_id, coalesce(p_snapshot, '{}'::jsonb) || '{"reviewed":false}', null);
    elsif p_outcome = 'bring-in' then return public.apply_connect_bring_in(p_org_id, p_tier, p_kind, p_external_id, coalesce(p_snapshot, '{}'::jsonb));
    end if;
  exception when others then
    raise warning 'apply_connect_outcome % %: % %', p_kind, p_outcome, sqlstate, sqlerrm;   -- the screen gets plain words; the log keeps the cause
    return 'This row could not be applied';
  end;
  return 'This outcome cannot be applied here';
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Actor-checked writers. Actor = auth.uid(); org, active member and role re-asserted exactly as 0148.
-- ---------------------------------------------------------------------------------------------------------------
-- One call applies at most 500 rows (a user JWT has an 8 s statement timeout) and says how many untried rows are left; the
-- caller loops until `remaining` is 0. A row that was left open with a reason sorts last and is not counted as remaining, so the
-- loop ends. One audit row per call, naming each applied person and account pair.
create or replace function public.accept_connect_proposals(p_tier text, p_kind text default null, p_ids uuid[] default null, p_batch int default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        r record; v_reason text; v_counts jsonb := '{}'::jsonb; v_k text; v_field text; v_binding uuid;
        v_links jsonb := '[]'::jsonb; v_errors jsonb := '[]'::jsonb; v_remaining int; v_state text; v_msg text;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_role = 'Finance' and coalesce(p_kind, 'account') <> 'account' then raise exception 'not allowed' using errcode = '42501'; end if;
  select id into v_binding from public.external_org_bindings where org_id = v_org and external_tier = p_tier and status = 'active';
  if v_binding is null then raise exception 'no active connection for this ERP' using errcode = 'P0001'; end if;
  -- p_kind null = every kind the actor may accept; p_ids null = every open non-review row of the current connection (FR-ECA-012 "all").
  for r in select * from public.erp_connect_proposals
            where org_id = v_org and external_tier = p_tier and binding_id = v_binding and state = 'open' and outcome <> 'review'
              and (kind = p_kind or (p_kind is null and (v_role = 'Admin' or kind = 'account')))
              and (p_ids is null or id = any(p_ids))
            order by (reason_text is not null), kind, id limit least(greatest(coalesce(p_batch, 500), 1), 500) for update loop
    v_reason := null;
    if r.outcome <> 'send' then
      begin   -- one bad row is left open with a reason and never aborts the batch; its partial writes roll back with it
        if r.outcome = 'link' then
          v_reason := public.apply_connect_link(v_org, p_tier, r.kind, r.pmo_ids[1], r.external_ids[1],
                                                r.snapshot || jsonb_build_object('matchKey', r.match_key, 'reviewed', false), v_actor);
        else
          v_reason := public.apply_connect_bring_in(v_org, p_tier, r.kind, r.external_ids[1], r.snapshot);
        end if;
      exception when others then
        get stacked diagnostics v_msg = message_text;
        v_state := sqlstate;
        v_reason := 'This row could not be applied';   -- plain words for the screen; the audit row keeps the cause
        v_errors := v_errors || jsonb_build_object('proposalId', r.id, 'sqlstate', v_state, 'message', v_msg);
      end;
    end if;
    if r.outcome = 'send' then   -- queued for ECA-3's drain; nothing is reported done before the ERP confirms (NFR-ECA-004)
      update public.erp_connect_proposals set state = 'sending', decided_by = v_actor, decided_at = now() where id = r.id;
      v_field := 'send';
    elsif v_reason is null then
      update public.erp_connect_proposals set state = 'applied', decided_by = v_actor, decided_at = now(), reason_text = null where id = r.id;
      v_field := replace(r.outcome, '-', '_');
      if r.outcome = 'link' and r.kind in ('employee', 'account') then
        v_links := v_links || jsonb_build_object('kind', r.kind, 'pmoId', r.pmo_ids[1], 'externalId', r.external_ids[1]);
      end if;
    else
      update public.erp_connect_proposals set reason_text = v_reason where id = r.id;
      v_field := 'left_open';
    end if;
    v_counts := jsonb_set(v_counts, array[r.kind], coalesce(v_counts->r.kind, '{"link":0,"bring_in":0,"send":0,"left_open":0}'::jsonb));
    v_counts := jsonb_set(v_counts, array[r.kind, v_field], to_jsonb((v_counts #>> array[r.kind, v_field])::int + 1));
  end loop;
  -- "set up once" (PD-ECA-15) is stamped only for a kind where something was applied or queued
  for v_k in select jsonb_object_keys(v_counts) loop
    if (v_counts #>> array[v_k, 'link'])::int + (v_counts #>> array[v_k, 'bring_in'])::int + (v_counts #>> array[v_k, 'send'])::int > 0 then
      update public.erp_connect_census set accepted_at = coalesce(accepted_at, now())
       where org_id = v_org and external_tier = p_tier and kind = v_k;
    end if;
  end loop;
  if exists (select 1 from jsonb_each(v_counts) e where (e.value->>'send')::int > 0) then
    update public.erp_connect_runs set finished_at = null where org_id = v_org and external_tier = p_tier and state = 'ready';
  end if;
  if v_counts <> '{}'::jsonb then
    perform public.log_audit('integration.connect_accept', v_org, v_actor, null,
      jsonb_build_object('tier', p_tier, 'kinds', v_counts, 'links', v_links, 'errors', v_errors));
  end if;
  select count(*) into v_remaining from public.erp_connect_proposals
   where org_id = v_org and external_tier = p_tier and binding_id = v_binding and state = 'open' and outcome <> 'review' and reason_text is null
     and (kind = p_kind or (p_kind is null and (v_role = 'Admin' or kind = 'account')))
     and (p_ids is null or id = any(p_ids));
  return jsonb_build_object('counts', v_counts, 'remaining', v_remaining);
end $$;

create or replace function public.decide_connect_review(p_id uuid, p_choice jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        r public.erp_connect_proposals%rowtype; v_reason text; v_pmo text := p_choice->>'pmoId'; v_ext text := p_choice->>'externalId';
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.erp_connect_proposals where id = p_id and org_id = v_org for update;
  if not found or r.outcome <> 'review' or r.state <> 'open' then raise exception 'review not found' using errcode = 'P0002'; end if;
  if v_role = 'Finance' and r.kind <> 'account' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.external_org_bindings where id = r.binding_id and status = 'active') then
    raise exception 'no active connection for this ERP' using errcode = 'P0001';
  end if;
  if p_choice->>'action' = 'dismiss' then
    update public.erp_connect_proposals set state = 'dismissed', decided_by = v_actor, decided_at = now() where id = p_id;
  elsif p_choice->>'action' = 'link' then
    -- only a pair the row itself offered
    if not (v_pmo = any(r.pmo_ids) and v_ext = any(r.external_ids)) then raise exception 'not one of the candidates' using errcode = '22023'; end if;
    -- a person looked at this pair: that is the confirmation a name-keyed person or account link needs
    v_reason := public.apply_connect_link(v_org, r.external_tier, r.kind, v_pmo, v_ext, r.snapshot || jsonb_build_object('matchKey', r.match_key, 'reviewed', true), v_actor);
    if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
    update public.erp_connect_proposals set state = 'applied', decided_by = v_actor, decided_at = now() where id = p_id;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  perform public.log_audit('integration.connect_review', v_org, v_actor, p_id,
    jsonb_build_object('tier', r.external_tier, 'kind', r.kind, 'action', p_choice->>'action', 'pmoId', v_pmo, 'externalId', v_ext));
end $$;

create or replace function public.unlink_connect_match(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); r public.erp_connect_proposals%rowtype;
        v_domain text; v_pmo text; v_ext text; v_n int;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.erp_connect_proposals where id = p_id and org_id = v_org for update;
  if not found or r.outcome <> 'link' or r.state <> 'applied' then raise exception 'link not found' using errcode = 'P0002'; end if;
  v_pmo := r.pmo_ids[1]; v_ext := r.external_ids[1];
  v_domain := case r.kind when 'party' then 'companies' when 'project' then 'projects' when 'employee' then 'employees'
                          when 'account' then 'accounts' when 'item' then 'items' end;
  if public.connect_link_in_use(v_org, v_domain, v_pmo) then raise exception 'link in use' using errcode = 'P0001'; end if;
  if r.kind = 'party' then
    delete from public.external_refs where org_id = v_org and domain = 'companies' and pmo_record_id = v_pmo and external_record_id = v_ext;
  elsif r.kind in ('project', 'item') then
    update public.external_org_bindings
       set config = jsonb_set(config, array[case r.kind when 'project' then 'project_map' else 'item_map' end],
                              (config->(case r.kind when 'project' then 'project_map' else 'item_map' end)) - v_pmo)
     where org_id = v_org and external_tier = r.external_tier and status = 'active'
       and config->(case r.kind when 'project' then 'project_map' else 'item_map' end)->>v_pmo = v_ext;
  elsif r.kind = 'employee' then
    -- 'rejected' (0136): the feed and the applier both refuse a declined pairing, so it does not come back by itself
    update public.erp_employees set profile_id = null, link_state = 'rejected', linked_by = null, linked_at = null
     where org_id = v_org and employee_number = v_ext and profile_id = v_pmo::uuid and link_state = 'confirmed';
  elsif r.kind = 'account' then
    delete from public.budget_category_account_map where org_id = v_org and category = v_pmo::public.budget_category and erp_account = v_ext;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'nothing to unlink' using errcode = 'P0001'; end if;
  -- dismissed, not open: an unlinked pairing was wrong, and an open row would be re-applied by the next accept-all
  update public.erp_connect_proposals set state = 'dismissed', decided_by = v_actor, decided_at = now() where id = p_id;
  perform public.log_audit('integration.connect_unlink', v_org, v_actor, p_id,
    jsonb_build_object('tier', r.external_tier, 'kind', r.kind, 'pmoId', v_pmo, 'externalId', v_ext, 'linkedBy', r.decided_by, 'linkedAt', r.decided_at));
end $$;


-- ACL. Service-only writers: service_role alone. Internal appliers and the in-use check: nobody (the definers above
-- call them as their owner). Actor-checked writers: authenticated, never anon.
revoke all on function public.start_connect_run(uuid,text,uuid), public.write_connect_census(uuid,text,jsonb),
  public.stage_connect_master_page(uuid,uuid,text,jsonb,text), public.replace_connect_proposals(uuid,text,uuid,text,jsonb,boolean),
  public.record_connect_review(uuid,text,text,text[],text[],text,text), public.apply_connect_outcome(uuid,text,text,text,text,text,jsonb),
  public.fail_connect_run(uuid,uuid,text,boolean), public.settle_connect_run(uuid,text)
  from public, anon, authenticated;
grant execute on function public.start_connect_run(uuid,text,uuid), public.write_connect_census(uuid,text,jsonb),
  public.stage_connect_master_page(uuid,uuid,text,jsonb,text), public.replace_connect_proposals(uuid,text,uuid,text,jsonb,boolean),
  public.record_connect_review(uuid,text,text,text[],text[],text,text), public.apply_connect_outcome(uuid,text,text,text,text,text,jsonb),
  public.fail_connect_run(uuid,uuid,text,boolean), public.settle_connect_run(uuid,text)
  to service_role;
revoke all on function public.connect_config_map_link(uuid,text,text,text,text,boolean), public.connect_link_project(uuid,text,text,text),
  public.apply_connect_link(uuid,text,text,text,text,jsonb,uuid), public.apply_connect_bring_in(uuid,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.accept_connect_proposals(text,text,uuid[],int), public.decide_connect_review(uuid,jsonb), public.unlink_connect_match(uuid)
  from public, anon;
grant execute on function public.accept_connect_proposals(text,text,uuid[],int), public.decide_connect_review(uuid,jsonb), public.unlink_connect_match(uuid)
  to authenticated;
