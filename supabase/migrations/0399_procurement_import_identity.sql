-- Registered import runs attest only newly inserted records, never existing rows.
create table public.procurement_import_runs (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  identity_version smallint not null check (identity_version = 2),
  created_at timestamptz not null default now()
);
alter table public.procurement_import_runs enable row level security;
alter table public.procurement_import_runs force row level security;
revoke all on public.procurement_import_runs from public, anon, authenticated, service_role;
grant select on public.procurement_import_runs to authenticated, service_role;
create policy procurement_import_runs_select on public.procurement_import_runs for select to authenticated
  using (org_id = public.auth_org_id() and public.is_active_member());

create function public.start_procurement_import_run(p_org_id uuid default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_selected_role text := current_setting('role', true);
  v_bypass boolean;
  v_org uuid;
  v_id uuid;
begin
  if v_selected_role is null or v_selected_role = 'none' then v_selected_role := session_user; end if;
  select coalesce(r.rolbypassrls, false) into v_bypass from pg_catalog.pg_roles r where r.rolname = v_selected_role;
  if coalesce(v_bypass, false) then
    v_org := p_org_id;
  else
    perform public.assert_is_active_member();
    v_org := public.auth_org_id();
    if p_org_id is not null and p_org_id is distinct from v_org then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  if v_org is null then raise exception 'organization required' using errcode = '42501'; end if;
  loop
    v_id := gen_random_uuid();
    begin
      insert into public.procurement_import_runs(id, org_id, identity_version) values (v_id, v_org, 2);
      return v_id;
    exception when unique_violation then null;
    end;
  end loop;
end $$;
revoke all on function public.start_procurement_import_run(uuid) from public, anon;
grant execute on function public.start_procurement_import_run(uuid) to authenticated, service_role;

create function public.normalize_procurement_import_refs(p_refs text[])
returns table(input_ref text, normalized_ref text)
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
begin
  if cardinality(p_refs) > 200 then
    raise exception 'normalization batch exceeds limit' using errcode = '22023';
  end if;
  return query select r, lower(btrim(r)) from unnest(p_refs) r;
end $$;
revoke all on function public.normalize_procurement_import_refs(text[]) from public, anon;
grant execute on function public.normalize_procurement_import_refs(text[]) to authenticated, service_role;

alter table public.procurements add column import_normalized_ref text generated always as (lower(btrim(import_key))) stored;
create index procurements_import_ref_lookup_idx on public.procurements
  (org_id, import_normalized_ref, id) where import_key is not null;
create function public.lookup_procurement_import_cases(
  p_refs text[], p_after_key text default null, p_after_id uuid default null,
  p_limit integer default 200, p_org_id uuid default null
) returns table(id uuid, import_key text, import_batch_id uuid, normalized_ref text)
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare v_org uuid;
begin
  if cardinality(p_refs) > 200 then
    raise exception 'lookup batch exceeds limit' using errcode = '22023';
  end if;
  if (p_after_key is null) <> (p_after_id is null) then
    raise exception 'both cursor values are required' using errcode = '22023';
  end if;
  if public.actor_bypasses_rls() then
    v_org := p_org_id;
  else
    if not coalesce(public.is_active_member(), false) then raise exception 'not authorized' using errcode = '42501'; end if;
    v_org := public.auth_org_id();
    if p_org_id is not null and p_org_id is distinct from v_org then raise exception 'not authorized' using errcode = '42501'; end if;
  end if;
  if v_org is null then raise exception 'organization required' using errcode = '42501'; end if;
  return query
    select p.id, p.import_key, p.import_batch_id, p.import_normalized_ref
    from public.procurements p
    where p.org_id = v_org and p.import_key is not null
      and p.import_normalized_ref = any (array(select distinct lower(btrim(r)) from unnest(p_refs) r where r is not null))
      and (p_after_key is null or (p.import_normalized_ref, p.id) > (p_after_key, p_after_id))
    order by p.import_normalized_ref, p.id
    limit greatest(1, least(coalesce(p_limit, 200), 200));
end $$;
revoke all on function public.lookup_procurement_import_cases(text[], text, uuid, integer, uuid) from public, anon;
grant execute on function public.lookup_procurement_import_cases(text[], text, uuid, integer, uuid) to authenticated, service_role;

-- Runs after the existing insert defaults and typed-value triggers.
create function public.procurement_import_identity_stamp() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    if not public.actor_bypasses_rls() and (
      new.import_identity_version is distinct from old.import_identity_version
      or new.import_identity_facts is distinct from old.import_identity_facts
      or (old.import_identity_version = 2 and (
        new.import_key is distinct from old.import_key
        or new.import_batch_id is distinct from old.import_batch_id
        or new.procurement_id is distinct from old.procurement_id
      ))
    ) then raise exception 'import identity is immutable' using errcode = '42501'; end if;
    return new;
  end if;
  if not public.actor_bypasses_rls() and (new.import_identity_version is not null or new.import_identity_facts is not null) then
    raise exception 'import identity is server assigned' using errcode = '42501';
  end if;
  if new.import_key is not null and new.import_batch_id is not null and exists (
    select 1 from public.procurement_import_runs r join public.procurements p on p.org_id = r.org_id
    where r.id = new.import_batch_id and r.identity_version = 2 and p.id = new.procurement_id
  ) then
    new.import_identity_version := 2;
    case tg_table_name
      when 'purchase_requests', 'rfqs', 'purchase_orders' then
        new.import_identity_facts := jsonb_build_array(new.reference_number, new.status, to_char(new.date, 'YYYY-MM-DD'), new.amount::text);
      when 'procurement_quotations' then
        new.import_identity_facts := jsonb_build_array(new.reference, new.vendor_id::text, new.total_amount::text, to_char(new.received_date, 'YYYY-MM-DD'));
      when 'procurement_receipts' then
        new.import_identity_facts := jsonb_build_array(new.reference_number, new.status::text, to_char(new.receipt_date, 'YYYY-MM-DD'));
      when 'procurement_invoices' then
        new.import_identity_facts := jsonb_build_array(new.reference_number, new.status::text, to_char(new.invoice_date, 'YYYY-MM-DD'), new.amount::text, new.tax_treatment, new.tax_amount::text);
      when 'payments' then
        new.import_identity_facts := jsonb_build_array(new.reference_number, new.invoice_id::text, new.status, to_char(new.date, 'YYYY-MM-DD'), new.amount::text);
    end case;
  end if;
  return new;
end $$;
revoke all on function public.procurement_import_identity_stamp() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['purchase_requests','rfqs','procurement_quotations','purchase_orders','procurement_receipts','procurement_invoices','payments'] loop
    execute format('alter table public.%I add column import_identity_version smallint, add column import_identity_facts jsonb', t);
    execute format('alter table public.%I add constraint %I check ((import_identity_version is null and import_identity_facts is null) or (import_identity_version is not null and import_identity_version = 2 and import_identity_facts is not null and import_key is not null and import_batch_id is not null))', t, t || '_import_identity_check');
    execute format('create unique index %I on public.%I (procurement_id, import_key) where import_identity_version = 2', t || '_import_identity_key_idx', t);
    execute format('create trigger zzzz_import_identity before insert or update on public.%I for each row execute function public.procurement_import_identity_stamp()', t);
  end loop;
end $$;

-- Change-history registry (record_changes_catalog_gate): classify the columns this migration adds.
-- The import identity pair is server-assigned at insert and immutable afterwards (the zzzz_import_identity
-- stamp trigger refuses any later change), and import_normalized_ref is generated always — neither is a
-- user-visible row change, so both are OMITTED, the same treatment import_key/import_batch_id/imported_at
-- already receive (0260/0271).
do $$
declare t text;
begin
  foreach t in array array['purchase_requests','rfqs','purchase_orders','procurement_invoices','payments'] loop
    update public.record_history_config
       set omit_cols = omit_cols || array(select c from unnest(array['import_identity_version','import_identity_facts']) c
                                          where not (c = any (omit_cols)))
     where table_name = t;
  end loop;
end $$;
update public.record_history_config
   set omit_cols = omit_cols || array(select c from unnest(array['import_normalized_ref']) c
                                      where not (c = any (omit_cols)))
 where table_name = 'procurements';

notify pgrst, 'reload schema';
