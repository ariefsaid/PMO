-- #1802: keep the ERP sales item at the rate-line level. The ERP remains the item authority;
-- invoice preflight validates this reference against the live enabled sales-item catalog.
alter table public.contract_rate_lines
  add column sales_item_code text,
  add constraint contract_rate_lines_sales_item_code_shape check (
    sales_item_code is null or (
      char_length(btrim(sales_item_code)) between 1 and 140
      and sales_item_code = btrim(sales_item_code)
      and sales_item_code !~ '[[:cntrl:]]'
    )
  );

-- Extends the existing rate-card write path. Item mapping is line-level metadata, not a commercial
-- rate version: a mapping-only save updates the current row in place; an ordinary rate version
-- change carries the current mapping forward. A JSON array makes Accept proposed one transaction.
create or replace function public.save_contract_rate_line(p_line jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_inputs jsonb;
  v_bulk boolean;
  v_line jsonb;
  v_project uuid;
  v_line_key uuid;
  v_has_sales_item boolean;
  v_has_expected_sales_item boolean;
  v_sales_item_code text;
  v_expected_sales_item_code text;
  v_previous_sales_item_code text;
  v_before_sales_item_code text;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_changed boolean;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to save contract rates' using errcode = '42501';
  end if;
  if jsonb_typeof(p_line) not in ('object', 'array') then
    raise exception 'rate line must be a JSON object or array of objects' using errcode = '22023';
  end if;
  v_bulk := jsonb_typeof(p_line) = 'array';
  if v_bulk and jsonb_array_length(p_line) = 0 then
    raise exception 'at least one rate line is required' using errcode = '22023';
  end if;
  v_inputs := case when v_bulk then p_line else jsonb_build_array(p_line) end;

  for v_line in select value from jsonb_array_elements(v_inputs)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'each rate line must be a JSON object' using errcode = '22023';
    end if;
    begin
      v_project := nullif(v_line->>'project_id', '')::uuid;
      v_line_key := nullif(v_line->>'line_key', '')::uuid;
    exception when others then
      raise exception 'rate line identifiers are malformed' using errcode = '22023';
    end;

    v_has_sales_item := v_line ? 'sales_item_code';
    if v_has_sales_item then
      if jsonb_typeof(v_line->'sales_item_code') = 'null' then
        v_sales_item_code := null;
      elsif jsonb_typeof(v_line->'sales_item_code') = 'string' then
        v_sales_item_code := nullif(btrim(v_line->>'sales_item_code'), '');
        if v_sales_item_code is not null and (
          char_length(v_sales_item_code) > 140 or v_sales_item_code ~ '[[:cntrl:]]'
        ) then
          raise exception 'sales_item_code has an invalid shape' using errcode = '22023';
        end if;
      else
        raise exception 'sales_item_code must be text or null' using errcode = '22023';
      end if;
    end if;
    v_has_expected_sales_item := v_line ? 'expected_sales_item_code';
    if v_has_expected_sales_item then
      if jsonb_typeof(v_line->'expected_sales_item_code') = 'null' then
        v_expected_sales_item_code := null;
      elsif jsonb_typeof(v_line->'expected_sales_item_code') = 'string' then
        v_expected_sales_item_code := nullif(btrim(v_line->>'expected_sales_item_code'), '');
      else
        raise exception 'expected_sales_item_code must be text or null' using errcode = '22023';
      end if;
    end if;

    -- Lock order: organization advisory lock before any rate-line row lock, matching the end path.
    perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
    -- The project is checked by contract_rate_line_write against the caller's org. This lookup
    -- never accepts an org_id from the payload, and a foreign project's current row is invisible.
    select l.sales_item_code into v_previous_sales_item_code
      from public.contract_rate_lines l
     where l.org_id = v_org and l.project_id = v_project and l.line_key = v_line_key and l.is_current
     for update;
    if v_has_expected_sales_item and v_expected_sales_item_code is distinct from v_previous_sales_item_code then
      raise exception 'sales item mapping changed since it was loaded' using errcode = '40001';
    end if;

    v_result := public.contract_rate_line_write(v_line, 'update');
    v_id := (v_result->>'id')::uuid;
    if not v_has_sales_item then
      v_sales_item_code := v_previous_sales_item_code;
    end if;
    select l.sales_item_code into v_before_sales_item_code
      from public.contract_rate_lines l
     where l.org_id = v_org and l.id = v_id
     for update;
    if not found then raise exception 'rate line not found' using errcode = 'P0002'; end if;

    update public.contract_rate_lines l
       set sales_item_code = v_sales_item_code
     where l.org_id = v_org and l.id = v_id;

    v_changed := coalesce((v_result->>'changed')::boolean, false)
      or v_before_sales_item_code is distinct from v_sales_item_code;
    if v_before_sales_item_code is distinct from v_sales_item_code then
      perform public.log_audit(
        'contract_rate_line.item_map', v_org, v_uid, v_id,
        jsonb_build_object(
          'line_key', v_result->>'line_key',
          'version', (v_result->>'version')::integer,
          'before', jsonb_build_object('sales_item_code', v_before_sales_item_code),
          'after', jsonb_build_object('sales_item_code', v_sales_item_code)
        )
      );
    end if;
    v_result := jsonb_set(v_result, '{changed}', to_jsonb(v_changed), true);
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  if v_bulk then return v_results; end if;
  return v_results->0;
end $$;

revoke all on function public.save_contract_rate_line(jsonb) from public, anon, authenticated;
grant execute on function public.save_contract_rate_line(jsonb) to authenticated;
alter function public.save_contract_rate_line(jsonb) owner to postgres;

-- Keep the sales-item reference when the end operation creates a new current rate version.
create or replace function public.end_contract_rate_line(p_project uuid, p_line_key uuid, p_effective_to date, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_line public.contract_rate_lines;
  v_currency text;
  v_result jsonb;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to end contract rates' using errcode = '42501';
  end if;
  if p_effective_to is null then raise exception 'effective_to is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || v_org::text, 0));
  select * into v_line from public.contract_rate_lines l
   where l.org_id = v_org and l.project_id = p_project and l.line_key = p_line_key and l.is_current for update;
  if not found then raise exception 'rate line not found' using errcode = 'P0002'; end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = v_org;
  v_result := public.contract_rate_line_write(jsonb_build_object(
    'project_id', p_project, 'line_key', p_line_key, 'expected_version', p_expected_version,
    'kind', v_line.kind, 'label', v_line.label, 'unit', v_line.unit, 'rate', v_line.rate,
    'currency', v_currency, 'effective_from', v_line.effective_from, 'effective_to', p_effective_to
  ), 'end');
  update public.contract_rate_lines l
     set sales_item_code = v_line.sales_item_code
   where l.org_id = v_org and l.id = (v_result->>'id')::uuid;
  return v_result;
end $$;

revoke all on function public.end_contract_rate_line(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.end_contract_rate_line(uuid, uuid, date, integer) to authenticated;
alter function public.end_contract_rate_line(uuid, uuid, date, integer) owner to postgres;
