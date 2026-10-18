-- S40: bounded prefix search for project, sales-invoice and incoming-payment references.
-- The per-alias equality and prefix branches below use these narrow org-scoped indexes.
create index if not exists uxs40_projects_order_ref_idx
  on public.projects (org_id, lower(customer_contract_ref) text_pattern_ops);
create index if not exists uxs40_projects_code_ref_idx
  on public.projects (org_id, lower(code) text_pattern_ops);
create index if not exists uxs40_projects_number_ref_idx
  on public.projects (org_id, lower(pmo_project_number) text_pattern_ops);
create index if not exists uxs40_invoices_si_ref_idx
  on public.sales_invoices (org_id, lower(si_number) text_pattern_ops);
create index if not exists uxs40_invoices_pmo_ref_idx
  on public.sales_invoices (org_id, lower(pmo_number) text_pattern_ops);
create index if not exists uxs40_invoices_customer_ref_idx
  on public.sales_invoices (org_id, lower(reference_number) text_pattern_ops);
create index if not exists uxs40_receipts_ip_ref_idx
  on public.incoming_payments (org_id, lower(ip_number) text_pattern_ops);
create index if not exists uxs40_receipts_pmo_ref_idx
  on public.incoming_payments (org_id, lower(pmo_number) text_pattern_ops);
create index if not exists uxs40_receipts_payment_ref_idx
  on public.incoming_payments (org_id, lower(reference_number) text_pattern_ops);

create or replace function public.search_record_references(p_query text, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_query_lower text;
  v_pattern text;
  v_org_id uuid;
  v_role text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 8), 8));
  v_items jsonb;
  v_has_more boolean;
begin
  if char_length(v_query) < 2 or char_length(v_query) > 120 then
    return jsonb_build_object('items', '[]'::jsonb, 'hasMore', false);
  end if;

  v_org_id := public.auth_org_id();
  v_role := public.auth_role()::text;
  if v_org_id is null
     or not coalesce(public.is_active_member(), false)
     or v_role not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    return jsonb_build_object('items', '[]'::jsonb, 'hasMore', false);
  end if;

  v_query_lower := lower(v_query);
  -- Treat %, _ and backslash as literal user characters. Only the trailing % is a wildcard.
  v_pattern := replace(replace(replace(v_query_lower, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';

  with candidate_ids as (
    (select 'project'::text as kind, p.id, true as exact
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.customer_contract_ref) = v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, false
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.customer_contract_ref) like v_pattern escape E'\\'
        and lower(p.customer_contract_ref) <> v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, true
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null and lower(p.code) = v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, false
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.code) like v_pattern escape E'\\' and lower(p.code) <> v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, true
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null and lower(p.pmo_project_number) = v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'project'::text, p.id, false
       from public.projects p
      where p.org_id = v_org_id and p.archived_at is null
        and lower(p.pmo_project_number) like v_pattern escape E'\\' and lower(p.pmo_project_number) <> v_query_lower
      order by p.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, true
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.si_number) = v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, false
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.si_number) like v_pattern escape E'\\' and lower(si.si_number) <> v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, true
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.pmo_number) = v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, false
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.pmo_number) like v_pattern escape E'\\' and lower(si.pmo_number) <> v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, true
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.reference_number) = v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'invoice'::text, si.id, false
       from public.sales_invoices si
      where si.org_id = v_org_id and lower(si.reference_number) like v_pattern escape E'\\' and lower(si.reference_number) <> v_query_lower
      order by si.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, true
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.ip_number) = v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, false
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.ip_number) like v_pattern escape E'\\' and lower(ip.ip_number) <> v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, true
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.pmo_number) = v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, false
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.pmo_number) like v_pattern escape E'\\' and lower(ip.pmo_number) <> v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, true
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.reference_number) = v_query_lower
      order by ip.id limit v_limit + 1)
    union all
    (select 'receipt'::text, ip.id, false
       from public.incoming_payments ip
      where ip.org_id = v_org_id and lower(ip.reference_number) like v_pattern escape E'\\' and lower(ip.reference_number) <> v_query_lower
      order by ip.id limit v_limit + 1)
  ), candidate_records as (
    select kind, id, bool_or(exact) as exact
      from candidate_ids
     group by kind, id
  ), selected_ids as (
    select kind, id, exact
      from candidate_records
     order by exact desc, kind, id
     limit v_limit + 1
  ), all_aliases as (
    select s.kind, p.id, p.name as title,
           nullif(btrim(concat_ws(' · ', nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(p.code), ''), nullif(btrim(p.pmo_project_number), ''))), '') as context,
           p.customer_contract_ref as matched_reference, 1 as alias_priority,
           lower(p.customer_contract_ref) = v_query_lower as exact
      from selected_ids s join public.projects p on s.kind = 'project' and p.id = s.id and p.org_id = v_org_id
      left join public.companies c on c.id = p.client_id and c.org_id = p.org_id
     where p.archived_at is null and lower(p.customer_contract_ref) like v_pattern escape E'\\'
    union all
    select s.kind, p.id, p.name,
           nullif(btrim(concat_ws(' · ', nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(p.code), ''), nullif(btrim(p.pmo_project_number), ''))), ''),
           p.code, 2, lower(p.code) = v_query_lower
      from selected_ids s join public.projects p on s.kind = 'project' and p.id = s.id and p.org_id = v_org_id
      left join public.companies c on c.id = p.client_id and c.org_id = p.org_id
     where p.archived_at is null and lower(p.code) like v_pattern escape E'\\'
    union all
    select s.kind, p.id, p.name,
           nullif(btrim(concat_ws(' · ', nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(p.code), ''), nullif(btrim(p.pmo_project_number), ''))), ''),
           p.pmo_project_number, 3, lower(p.pmo_project_number) = v_query_lower
      from selected_ids s join public.projects p on s.kind = 'project' and p.id = s.id and p.org_id = v_org_id
      left join public.companies c on c.id = p.client_id and c.org_id = p.org_id
     where p.archived_at is null and lower(p.pmo_project_number) like v_pattern escape E'\\'
    union all
    select s.kind, si.id,
           coalesce(nullif(btrim(si.pmo_number), ''), nullif(btrim(si.si_number), ''),
                    nullif(btrim(si.reference_number), ''), 'Sales invoice'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''))), ''),
           si.pmo_number, 1, lower(si.pmo_number) = v_query_lower
      from selected_ids s join public.sales_invoices si on s.kind = 'invoice' and si.id = s.id and si.org_id = v_org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
     where lower(si.pmo_number) like v_pattern escape E'\\'
    union all
    select s.kind, si.id,
           coalesce(nullif(btrim(si.pmo_number), ''), nullif(btrim(si.si_number), ''),
                    nullif(btrim(si.reference_number), ''), 'Sales invoice'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''))), ''),
           si.si_number, 2, lower(si.si_number) = v_query_lower
      from selected_ids s join public.sales_invoices si on s.kind = 'invoice' and si.id = s.id and si.org_id = v_org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
     where lower(si.si_number) like v_pattern escape E'\\'
    union all
    select s.kind, si.id,
           coalesce(nullif(btrim(si.pmo_number), ''), nullif(btrim(si.si_number), ''),
                    nullif(btrim(si.reference_number), ''), 'Sales invoice'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''))), ''),
           si.reference_number, 3, lower(si.reference_number) = v_query_lower
      from selected_ids s join public.sales_invoices si on s.kind = 'invoice' and si.id = s.id and si.org_id = v_org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
     where lower(si.reference_number) like v_pattern escape E'\\'
    union all
    select s.kind, ip.id,
           coalesce(nullif(btrim(ip.pmo_number), ''), nullif(btrim(ip.ip_number), ''),
                    nullif(btrim(ip.reference_number), ''), 'Incoming payment'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(coalesce(si.pmo_number, si.si_number)), ''))), ''),
           ip.pmo_number, 1, lower(ip.pmo_number) = v_query_lower
      from selected_ids s join public.incoming_payments ip on s.kind = 'receipt' and ip.id = s.id and ip.org_id = v_org_id
      left join public.sales_invoices si on si.id = ip.sales_invoice_id and si.org_id = ip.org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = ip.customer_id and c.org_id = ip.org_id
     where lower(ip.pmo_number) like v_pattern escape E'\\'
    union all
    select s.kind, ip.id,
           coalesce(nullif(btrim(ip.pmo_number), ''), nullif(btrim(ip.ip_number), ''),
                    nullif(btrim(ip.reference_number), ''), 'Incoming payment'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(coalesce(si.pmo_number, si.si_number)), ''))), ''),
           ip.ip_number, 2, lower(ip.ip_number) = v_query_lower
      from selected_ids s join public.incoming_payments ip on s.kind = 'receipt' and ip.id = s.id and ip.org_id = v_org_id
      left join public.sales_invoices si on si.id = ip.sales_invoice_id and si.org_id = ip.org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = ip.customer_id and c.org_id = ip.org_id
     where lower(ip.ip_number) like v_pattern escape E'\\'
    union all
    select s.kind, ip.id,
           coalesce(nullif(btrim(ip.pmo_number), ''), nullif(btrim(ip.ip_number), ''),
                    nullif(btrim(ip.reference_number), ''), 'Incoming payment'),
           nullif(btrim(concat_ws(' · ', nullif(btrim(p.name), ''),
                                 nullif(btrim(coalesce(c.short_name, c.name)), ''),
                                 nullif(btrim(coalesce(si.pmo_number, si.si_number)), ''))), ''),
           ip.reference_number, 3, lower(ip.reference_number) = v_query_lower
      from selected_ids s join public.incoming_payments ip on s.kind = 'receipt' and ip.id = s.id and ip.org_id = v_org_id
      left join public.sales_invoices si on si.id = ip.sales_invoice_id and si.org_id = ip.org_id
      left join public.projects p on p.id = si.project_id and p.org_id = si.org_id
      left join public.companies c on c.id = ip.customer_id and c.org_id = ip.org_id
     where lower(ip.reference_number) like v_pattern escape E'\\'
  ), distinct_aliases as (
    select distinct on (kind, id, lower(matched_reference))
           kind, id, title, context, matched_reference, alias_priority, exact
      from all_aliases
     order by kind, id, lower(matched_reference), alias_priority, matched_reference
  ), grouped as (
    select kind, id, title, context,
           array_agg(matched_reference order by alias_priority, matched_reference) as aliases,
           bool_or(exact) as exact
      from distinct_aliases
     group by kind, id, title, context
  ), ranked as (
    select kind, id, title, context, aliases, exact,
           row_number() over (order by exact desc, kind, id) as ordinal
      from grouped
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind,
           'id', id,
           'title', title,
           'context', context,
           'reference', aliases[1],
           'aliases', to_jsonb(aliases),
           'exact', exact
         ) order by ordinal) filter (where ordinal <= v_limit), '[]'::jsonb),
         coalesce(bool_or(ordinal > v_limit), false)
    into v_items, v_has_more
    from ranked;

  return jsonb_build_object('items', v_items, 'hasMore', v_has_more);
end;
$$;

revoke all on function public.search_record_references(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_record_references(text, integer) to authenticated;
