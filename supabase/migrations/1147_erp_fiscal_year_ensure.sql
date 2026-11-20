-- 1147_erp_fiscal_year_ensure.sql (#1599 ECX-5)
-- Immutable intent table and service-only fenced SQL API for fiscal-year ensure.

create table public.erp_fiscal_year_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  company text not null,
  site_url text not null,
  activated_at timestamptz not null,
  start_date date not null,
  end_date date not null,
  year_name text not null,
  operator_alerted_at timestamptz,
  post_started_at timestamptz,
  post_outbox_id uuid references public.external_command_outbox(id),
  post_generation bigint,
  created_at timestamptz not null default now(),
  constraint erp_fiscal_year_intents_span_check check (end_date >= start_date),
  constraint erp_fiscal_year_intents_post_fields_check check (
    (post_started_at is null and post_outbox_id is null and post_generation is null) or
    (post_started_at is not null and post_outbox_id is not null and post_generation is not null)
  ),
  constraint erp_fiscal_year_intents_identity_unique unique (org_id, binding_id, company, start_date, end_date)
);

alter table public.erp_fiscal_year_intents enable row level security;
alter table public.erp_fiscal_year_intents force row level security;

revoke all on public.erp_fiscal_year_intents from public, anon, authenticated;
grant all on public.erp_fiscal_year_intents to service_role;

create or replace function public.prepare_fiscal_year_intent(
  p_org_id uuid,
  p_binding_id uuid,
  p_company text,
  p_site_url text,
  p_activated_at timestamptz,
  p_start date,
  p_end date,
  p_year_name text
) returns public.erp_fiscal_year_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_binding public.external_org_bindings%rowtype;
  v_intent public.erp_fiscal_year_intents%rowtype;
begin
  if p_end < p_start then
    raise exception 'invalid date span: end_date (%) is before start_date (%)', p_end, p_start using errcode = '22023';
  end if;
  if p_year_name is null or trim(p_year_name) = '' then
    raise exception 'invalid year_name: cannot be empty' using errcode = '22023';
  end if;

  select * into v_binding
    from public.external_org_bindings
   where id = p_binding_id
     for update;

  if not found then
    raise exception 'binding not found' using errcode = 'P0001';
  end if;

  if v_binding.org_id <> p_org_id or
     v_binding.external_tier <> 'erpnext' or
     v_binding.status <> 'active' or
     v_binding.activated_at is null or
     v_binding.activated_at <> p_activated_at or
     v_binding.site_url <> p_site_url or
     coalesce(v_binding.config->>'company', '') <> p_company then
    raise exception 'binding snapshot mismatch' using errcode = 'P0001';
  end if;

  insert into public.erp_fiscal_year_intents (
    org_id, binding_id, company, site_url, activated_at, start_date, end_date, year_name
  ) values (
    p_org_id, p_binding_id, p_company, p_site_url, p_activated_at, p_start, p_end, p_year_name
  ) on conflict (org_id, binding_id, company, start_date, end_date) do nothing;

  select * into v_intent
    from public.erp_fiscal_year_intents
   where org_id = p_org_id
     and binding_id = p_binding_id
     and company = p_company
     and start_date = p_start
     and end_date = p_end
     for update;

  if v_intent.binding_id <> p_binding_id or
     v_intent.site_url <> p_site_url or
     v_intent.activated_at <> p_activated_at or
     v_intent.company <> p_company or
     v_intent.start_date <> p_start or
     v_intent.end_date <> p_end then
    raise exception 'intent snapshot mismatch' using errcode = 'P0001';
  end if;

  return v_intent;
end;
$$;
revoke all on function public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text) from public, anon, authenticated;
grant execute on function public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text) to service_role;

create or replace function public.begin_fiscal_year_post(
  p_org_id uuid,
  p_intent_id uuid,
  p_outbox_id uuid,
  p_generation bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_binding_id uuid;
  v_binding public.external_org_bindings%rowtype;
  v_intent public.erp_fiscal_year_intents%rowtype;
  v_outbox public.external_command_outbox%rowtype;
begin
  select binding_id into v_binding_id
    from public.erp_fiscal_year_intents
   where id = p_intent_id and org_id = p_org_id;

  if not found then
    return false;
  end if;

  select * into v_binding
    from public.external_org_bindings
   where id = v_binding_id and org_id = p_org_id
     for update;

  if not found or
     v_binding.external_tier <> 'erpnext' or
     v_binding.status <> 'active' then
    return false;
  end if;

  select * into v_intent
    from public.erp_fiscal_year_intents
   where id = p_intent_id and org_id = p_org_id
     for update;

  if not found or
     v_intent.binding_id <> v_binding.id or
     v_intent.site_url <> v_binding.site_url or
     v_intent.activated_at <> v_binding.activated_at or
     v_intent.company <> coalesce(v_binding.config->>'company', '') or
     v_intent.post_started_at is not null then
    return false;
  end if;

  select * into v_outbox
    from public.external_command_outbox
   where id = p_outbox_id
     for update;

  if not found or
     v_outbox.org_id <> p_org_id or
     v_outbox.domain <> 'fiscal_year_setup' or
     v_outbox.pmo_record_id <> p_intent_id::text or
     v_outbox.idempotency_key <> ('setup:fiscal-year:' || p_intent_id::text) or
     v_outbox.external_tier <> 'erpnext' or
     v_outbox.state <> 'committing' or
     v_outbox.claim_generation <> p_generation then
    return false;
  end if;

  update public.erp_fiscal_year_intents
     set post_started_at = clock_timestamp(),
         post_outbox_id = p_outbox_id,
         post_generation = p_generation
   where id = p_intent_id;

  return true;
end;
$$;
revoke all on function public.begin_fiscal_year_post(uuid,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.begin_fiscal_year_post(uuid,uuid,uuid,bigint) to service_role;

create or replace function public.record_fiscal_year_status(
  p_org_id uuid,
  p_binding_id uuid,
  p_company text,
  p_site_url text,
  p_activated_at timestamptz,
  p_intent_id uuid,
  p_outbox_id uuid,
  p_generation bigint,
  p_status jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_binding public.external_org_bindings%rowtype;
  v_intent public.erp_fiscal_year_intents%rowtype;
  v_outbox public.external_command_outbox%rowtype;
begin
  select * into v_binding
    from public.external_org_bindings
   where id = p_binding_id and org_id = p_org_id
     for update;

  if not found or
     v_binding.external_tier <> 'erpnext' or
     v_binding.status <> 'active' or
     v_binding.site_url <> p_site_url or
     v_binding.activated_at <> p_activated_at or
     coalesce(v_binding.config->>'company', '') <> p_company then
    return false;
  end if;

  select * into v_intent
    from public.erp_fiscal_year_intents
   where id = p_intent_id and org_id = p_org_id
     for update;

  if not found or
     v_intent.binding_id <> p_binding_id or
     v_intent.company <> p_company or
     v_intent.site_url <> p_site_url or
     v_intent.activated_at <> p_activated_at or
     v_intent.post_outbox_id <> p_outbox_id or
     v_intent.post_generation <> p_generation then
    return false;
  end if;

  select * into v_outbox
    from public.external_command_outbox
   where id = p_outbox_id
     for update;

  if not found or
     v_outbox.org_id <> p_org_id or
     v_outbox.domain <> 'fiscal_year_setup' or
     v_outbox.pmo_record_id <> p_intent_id::text or
     v_outbox.idempotency_key <> ('setup:fiscal-year:' || p_intent_id::text) or
     v_outbox.claim_generation <> p_generation or
     v_outbox.state not in ('committed', 'confirmed') then
    return false;
  end if;

  if p_status->>'state' <> 'ready' or
     p_status->>'company' <> p_company then
    return false;
  end if;

  update public.external_org_bindings
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{fiscal_year}', p_status, true),
         updated_at = clock_timestamp()
   where id = p_binding_id;

  return true;
end;
$$;
revoke all on function public.record_fiscal_year_status(uuid,uuid,text,text,timestamptz,uuid,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.record_fiscal_year_status(uuid,uuid,text,text,timestamptz,uuid,uuid,bigint,jsonb) to service_role;

create or replace function public.record_fiscal_year_observation(
  p_org_id uuid,
  p_binding_id uuid,
  p_company text,
  p_site_url text,
  p_activated_at timestamptz,
  p_checked_at timestamptz,
  p_status jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_binding public.external_org_bindings%rowtype;
  v_existing_checked timestamptz;
  v_unresolved_exists boolean;
begin
  select * into v_binding
    from public.external_org_bindings
   where id = p_binding_id and org_id = p_org_id
     for update;

  if not found or
     v_binding.external_tier <> 'erpnext' or
     v_binding.status <> 'active' or
     v_binding.site_url <> p_site_url or
     v_binding.activated_at <> p_activated_at or
     coalesce(v_binding.config->>'company', '') <> p_company then
    return false;
  end if;

  v_existing_checked := (v_binding.config->'fiscal_year'->>'checked_at')::timestamptz;
  if v_existing_checked is not null and v_existing_checked >= p_checked_at then
    return false;
  end if;

  if p_status->>'state' in ('ready', 'not-due') then
    select exists (
      select 1
        from public.erp_fiscal_year_intents i
        join public.external_command_outbox o on o.id = i.post_outbox_id
       where i.org_id = p_org_id
         and i.binding_id = p_binding_id
         and i.company = p_company
         and i.post_started_at is not null
         and o.state in ('held', 'quarantined', 'failed')
    ) into v_unresolved_exists;

    if v_unresolved_exists or coalesce(v_binding.config->'fiscal_year'->>'state', '') in ('held', 'needs-operator', 'operator') then
      return false;
    end if;
  end if;

  update public.external_org_bindings
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{fiscal_year}', p_status, true),
         updated_at = clock_timestamp()
   where id = p_binding_id;

  return true;
end;
$$;
revoke all on function public.record_fiscal_year_observation(uuid,uuid,text,text,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.record_fiscal_year_observation(uuid,uuid,text,text,timestamptz,timestamptz,jsonb) to service_role;
