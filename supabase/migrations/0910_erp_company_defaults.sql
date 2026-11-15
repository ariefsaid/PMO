-- 0910 — ERP company defaults set from PMO (#1599 ECX-3). Rollback: rollback/0910_erp_company_defaults_down.sql.
--
-- Clients never work in the ERP: an Admin or Finance user chooses the company's default payable, expense, cash and bank accounts
-- and cost centre in PMO, and PMO writes them to the ERP company. The ERP checks only that an account exists, is a leaf and is the
-- company's (bed, ERPNext v15); it accepts an account of any type and a group or another company's cost centre. So PMO checks:
--   * request_company_defaults (a person, definer): role, active membership, org, and each choice against the mirrored chart
--     (erp_account_mirror) and the mirrored cost centres (erp_cost_centre_mirror, below): an enabled leaf of the bound company,
--     of the right kind. A refused choice queues nothing.
--   * the tier adapter checks the same rule against the ERP's own record before it writes (pmo-portal adapterSeam/companyDefaults.ts).
--   * record_company_defaults_result (service role): the binding records only what the ERP read back after the write, and only
--     when it holds every chosen value; anything else is a refusal.

-- The bound company's cost centres as the ERP lists them, refreshed by the setup function before it offers a choice.
create table public.erp_cost_centre_mirror (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001') references public.organizations(id) on delete cascade,
  company text not null,
  erp_name text not null,
  is_group boolean not null,
  disabled boolean not null default false,
  as_of timestamptz not null default now(),
  unique (org_id, company, erp_name)
);
create trigger erp_cost_centre_mirror_stamp_org_id before insert or update on public.erp_cost_centre_mirror
  for each row execute function public.stamp_org_id();
alter table public.erp_cost_centre_mirror enable row level security;
alter table public.erp_cost_centre_mirror force row level security;
create policy erp_cost_centre_mirror_select on public.erp_cost_centre_mirror for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) in ('Admin','Finance','Executive'));
revoke all on public.erp_cost_centre_mirror from anon, authenticated;
grant select on public.erp_cost_centre_mirror to authenticated;
grant all on public.erp_cost_centre_mirror to service_role;

-- Replace one company's cost centres with the ERP's complete list. Returns the number now held.
create or replace function public.replace_erp_cost_centre_mirror(p_org_id uuid, p_company text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if p_org_id is null or coalesce(btrim(p_company), '') = '' then raise exception 'org and company are required' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'cost centres must be a list' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
              where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'name') <> 'string' or btrim(e->>'name') = ''
                 or jsonb_typeof(e->'isGroup') <> 'boolean' or (e ? 'disabled' and jsonb_typeof(e->'disabled') <> 'boolean')) then
    raise exception 'each cost centre needs a name and isGroup' using errcode = '22023';
  end if;
  delete from public.erp_cost_centre_mirror m
   where m.org_id = p_org_id and m.company = p_company
     and not exists (select 1 from jsonb_array_elements(p_rows) e where e->>'name' = m.erp_name);
  insert into public.erp_cost_centre_mirror (org_id, company, erp_name, is_group, disabled, as_of)
  select distinct on (e->>'name') p_org_id, p_company, e->>'name', (e->>'isGroup')::boolean, coalesce((e->>'disabled')::boolean, false), now()
    from jsonb_array_elements(p_rows) e
  on conflict (org_id, company, erp_name) do update set is_group = excluded.is_group, disabled = excluded.disabled, as_of = excluded.as_of;
  select count(*)::int into v_count from public.erp_cost_centre_mirror where org_id = p_org_id and company = p_company;
  return v_count;
end $$;

-- One row per distinct choice per connection: the same choice again is the same request (its key), never a second one.
create table public.erp_company_default_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  binding_id uuid not null references public.external_org_bindings(id) on delete cascade,
  external_tier text not null,
  company text not null,
  idempotency_key text not null,
  chosen jsonb not null check (jsonb_typeof(chosen) = 'object'),
  state text not null check (state in ('pending', 'applied', 'rejected')),
  reason_text text,
  read_back jsonb,
  attempts int not null default 1,
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (org_id, idempotency_key)
);
alter table public.erp_company_default_requests enable row level security;
alter table public.erp_company_default_requests force row level security;
create policy erp_company_default_requests_select on public.erp_company_default_requests for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) in ('Admin','Finance'));
revoke all on public.erp_company_default_requests from anon, authenticated;
grant select on public.erp_company_default_requests to authenticated;
grant all on public.erp_company_default_requests to service_role;

-- Why a mirrored target cannot be the default for a slot, in plain words, or null when it fits. The same rule as the adapter's
-- `defaultTargetProblem`. Internal: called by the definer only.
create or replace function public.company_default_target_problem(p_org_id uuid, p_company text, p_slot text, p_name text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_label text := case p_slot when 'payable' then 'vendor payable account' when 'expense' then 'default expense account'
                   when 'cash' then 'cash account' when 'bank' then 'bank account' else 'cost centre' end;
  v_company text; v_group boolean; v_disabled boolean; v_root text; v_type text;
begin
  if p_slot = 'cost_centre' then
    select company, is_group, disabled into v_company, v_group, v_disabled
      from public.erp_cost_centre_mirror where org_id = p_org_id and erp_name = p_name
     order by (company = p_company) desc limit 1;
  else
    select company, is_group, disabled, root_type, account_type into v_company, v_group, v_disabled, v_root, v_type
      from public.erp_account_mirror where org_id = p_org_id and erp_name = p_name
     order by (company = p_company) desc limit 1;
  end if;
  if not found then return format('%s is not in the ERP chart PMO has read, so it cannot be the %s. Refresh the list and choose again.', p_name, v_label); end if;
  if v_company <> p_company then return format('%s belongs to another company, so it cannot be the %s.', p_name, v_label); end if;
  if v_group then return format('%s is a group, so it cannot be the %s. Choose an account or cost centre under it.', p_name, v_label); end if;
  if v_disabled then return format('%s is disabled, so it cannot be the %s.', p_name, v_label); end if;
  if p_slot = 'payable' and v_type is distinct from 'Payable' then return format('%s is not a payable account, so it cannot be the %s.', p_name, v_label); end if;
  if p_slot = 'cash' and v_type is distinct from 'Cash' then return format('%s is not a cash account, so it cannot be the %s.', p_name, v_label); end if;
  if p_slot = 'bank' and v_type is distinct from 'Bank' then return format('%s is not a bank account, so it cannot be the %s.', p_name, v_label); end if;
  if p_slot = 'expense' and v_root is distinct from 'Expense' then return format('%s is not an expense account, so it cannot be the %s.', p_name, v_label); end if;
  return null;
end $$;

-- A person asks for the company defaults to be set. Org, role and membership come from the caller's session; each choice is checked
-- against the mirrors before anything is queued. Returns the request the setup function then writes to the ERP.
create or replace function public.request_company_defaults(p_tier text, p_values jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id();
  b public.external_org_bindings%rowtype; v_company text; v_values jsonb; v_key text; v_problem text; e record;
  r public.erp_company_default_requests%rowtype;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text not in ('Admin', 'Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into b from public.external_org_bindings
   where org_id = v_org and external_tier = p_tier and status = 'active' and activated_at is not null;
  v_company := b.config->>'company';
  if not found or coalesce(btrim(v_company), '') = '' then
    raise exception 'Connect the ERP and choose its company first.' using errcode = 'P0001';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb then
    raise exception 'Choose at least one company default.' using errcode = '22023';
  end if;
  for e in select key, value from jsonb_each(p_values) loop
    if e.key not in ('payable', 'expense', 'cash', 'bank', 'cost_centre') then
      raise exception 'Unknown company default: %.', left(e.key, 40) using errcode = '22023';
    end if;
    if jsonb_typeof(e.value) <> 'string' or btrim(e.value #>> '{}') = '' or length(e.value #>> '{}') > 140 then
      raise exception 'Choose a value for every company default you change.' using errcode = '22023';
    end if;
    v_problem := public.company_default_target_problem(v_org, v_company, e.key, btrim(e.value #>> '{}'));
    if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  end loop;
  select jsonb_object_agg(key, btrim(value #>> '{}')) into v_values from jsonb_each(p_values);
  v_key := 'setup:company-defaults:' || b.id::text || ':' || encode(sha256(convert_to(v_values::text, 'UTF8')), 'hex');
  insert into public.erp_company_default_requests (org_id, binding_id, external_tier, company, idempotency_key, chosen, state, requested_by)
    values (v_org, b.id, p_tier, v_company, v_key, v_values, 'pending', v_actor)
  on conflict (org_id, idempotency_key) do update
    set state = 'pending', reason_text = null, read_back = null, decided_at = null, attempts = public.erp_company_default_requests.attempts + 1,
        requested_by = excluded.requested_by, requested_at = now()
  returning * into r;
  perform public.log_audit('integration.company_defaults_requested', v_org, v_actor, r.id,
    jsonb_build_object('tier', p_tier, 'slots', (select jsonb_agg(k order by k) from jsonb_object_keys(v_values) k)));
  return jsonb_build_object('id', r.id, 'idempotencyKey', v_key, 'company', v_company, 'values', v_values);
end $$;

-- The setup function's answer after it wrote to the ERP and read the company back (p_rejection null) or was refused (plain words).
-- The binding records the five defaults exactly as read back, and only when the read-back holds every chosen value. A result for a
-- request that is no longer pending changes nothing; another org's request is refused.
create or replace function public.record_company_defaults_result(p_org_id uuid, p_request_id uuid, p_read_back jsonb, p_rejection text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.erp_company_default_requests%rowtype; v_reason text := p_rejection; k text;
begin
  select * into r from public.erp_company_default_requests where id = p_request_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown request' using errcode = 'P0002'; end if;
  if r.state <> 'pending' then return jsonb_build_object('state', r.state); end if;
  if v_reason is null then
    if p_read_back is null or jsonb_typeof(p_read_back) <> 'object' then
      v_reason := 'The ERP company could not be read back, so nothing was recorded. Try again.';
    else
      foreach k in array array['payable', 'expense', 'cash', 'bank', 'cost_centre'] loop
        if not (p_read_back ? k) or jsonb_typeof(p_read_back->k) not in ('string', 'null') then
          v_reason := 'The ERP company could not be read back, so nothing was recorded. Try again.';
        end if;
      end loop;
    end if;
  end if;
  if v_reason is null and exists (select 1 from jsonb_each_text(r.chosen) c where p_read_back->>c.key is distinct from c.value) then
    v_reason := 'The ERP did not keep every chosen default, so nothing was recorded. Try again.';
  end if;
  if v_reason is null and not exists (select 1 from public.external_org_bindings
                                        where id = r.binding_id and org_id = p_org_id and status = 'active' and config->>'company' = r.company) then
    v_reason := 'The ERP connection changed while this was being set, so nothing was recorded.';
  end if;
  if v_reason is not null then
    update public.erp_company_default_requests set state = 'rejected', reason_text = left(v_reason, 300), decided_at = now() where id = r.id;
    return jsonb_build_object('state', 'rejected', 'reason', left(v_reason, 300));
  end if;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
       'default_payable_account', p_read_back->'payable', 'default_expense_account', p_read_back->'expense',
       'default_cash_account', p_read_back->'cash', 'default_bank_account', p_read_back->'bank', 'cost_center', p_read_back->'cost_centre')
   where id = r.binding_id;
  update public.erp_company_default_requests set state = 'applied', read_back = p_read_back, decided_at = now() where id = r.id;
  perform public.log_audit('integration.company_defaults', p_org_id, r.requested_by, r.id,
    jsonb_build_object('tier', r.external_tier, 'slots', (select jsonb_agg(k2 order by k2) from jsonb_object_keys(r.chosen) k2)));
  return jsonb_build_object('state', 'applied');
end $$;

revoke all on function public.replace_erp_cost_centre_mirror(uuid, text, jsonb), public.company_default_target_problem(uuid, text, text, text),
  public.request_company_defaults(text, jsonb), public.record_company_defaults_result(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_erp_cost_centre_mirror(uuid, text, jsonb), public.record_company_defaults_result(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.request_company_defaults(text, jsonb) to authenticated;   -- role, membership and org re-asserted in the body
