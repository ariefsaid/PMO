-- A saved rental check is associated with the actual supplier invoice; warnings never alter money or approval.
-- Field accounts: existing assert_not_light and restrictive snapshot policy retained.
-- Latest calculator: 2620, every arithmetic, role, proof and tenancy check preserved.
-- Rollback: rollback/2621_hourly_rental_handoff_down.sql
alter table public.hourly_rental_checks add column invoice_id uuid references public.procurement_invoices(id) on delete restrict;
alter table public.hourly_rental_checks add column note text check (char_length(note) <= 1000);
create index hourly_rental_checks_invoice on public.hourly_rental_checks(org_id,invoice_id);
create index hourly_rental_checks_asset_history on public.hourly_rental_checks(org_id,asset_id,created_at desc);
drop function public.check_hourly_rental(uuid,date,date,numeric,numeric,jsonb,text);
create function public.check_hourly_rental(p_asset uuid, p_from date, p_to date,
  p_contracted numeric, p_invoice numeric, p_broken jsonb, p_state text default null, p_invoice_id uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_term public.equipment_rental_terms;
  v_day jsonb; v_date date; v_hours numeric; v_broken numeric := 0; v_billable numeric;
  v_proofs jsonb; v_days jsonb := '[]'; v_result jsonb; v_dates date[] := '{}';
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()) or coalesce(public.actor_built_in_role() = 'equipment_officer', false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 399 then
    raise exception 'invalid rental period' using errcode = '22023';
  end if;
  if p_contracted is null or p_invoice is null or p_contracted::text in ('NaN','Infinity','-Infinity')
    or p_invoice::text in ('NaN','Infinity','-Infinity') or p_contracted < 0 or p_invoice < 0
    or p_contracted > 9600 or p_invoice > 9600 or round(p_contracted,2) <> p_contracted or round(p_invoice,2) <> p_invoice then
    raise exception 'invalid hours' using errcode = '22023';
  end if;
  if p_state is not null and p_state not in ('checked','disputed') then
    raise exception 'invalid check outcome' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets where id = p_asset and org_id = v_org and ownership = 'rented' and archived_at is null) then
    raise exception 'rented asset not found' using errcode = 'P0002';
  end if;
  select * into v_term from public.equipment_rental_terms
    where org_id = v_org and asset_id = p_asset and basis = 'hour'
    and rented_from <= p_from and coalesce(rented_to,'infinity'::date) >= p_to;
  if not found then raise exception 'one hourly term must cover the entire check period' using errcode = '22023'; end if;
  if p_broken is null or jsonb_typeof(p_broken) <> 'array' or jsonb_array_length(p_broken) > 400 then
    raise exception 'invalid broken hours' using errcode = '22023';
  end if;
  for v_day in select value from jsonb_array_elements(p_broken) loop
    v_date := (v_day->>'date')::date; v_hours := (v_day->>'hours')::numeric;
    if v_date is null or v_date < p_from or v_date > p_to or v_date = any(v_dates)
      or v_hours is null or v_hours::text in ('NaN','Infinity','-Infinity') or v_hours <= 0 or v_hours > 24 or round(v_hours,2) <> v_hours then
      raise exception 'invalid dated broken hours' using errcode = '22023';
    end if;
    v_dates := array_append(v_dates,v_date);
    select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'file_name',pr.file_name,'file_path',pr.file_path)), '[]') into v_proofs
      from public.equipment_downtime_proofs pr where pr.org_id = v_org and pr.asset_id = p_asset and pr.proof_date = v_date
      and exists (select 1 from storage.objects o where o.bucket_id = 'equipment-proof' and o.name = pr.file_path);
    if jsonb_array_length(v_proofs) > 0 then v_broken := v_broken + v_hours; end if;
    v_days := v_days || jsonb_build_array(jsonb_build_object('date',v_date,'hours',v_hours,'proven',jsonb_array_length(v_proofs)>0,'proofs',v_proofs));
  end loop;
  v_billable := greatest(0, p_contracted - v_broken);
  v_result := jsonb_build_object('contracted_hours',p_contracted::numeric(12,2)::text,
    'broken_hours',v_broken::numeric(12,2)::text,'billable_hours',v_billable::numeric(12,2)::text,
    'invoice_hours',p_invoice::numeric(12,2)::text,'rate',v_term.rate::text,'currency',v_term.currency,
    'deduction',round((p_contracted-v_billable)*v_term.rate,2)::numeric(14,2)::text,
    'expected_amount',round(v_billable*v_term.rate,2)::numeric(14,2)::text,'days',v_days,'state',p_state);
  if p_state is not null then
    if p_invoice_id is null or not exists (
      select 1 from public.procurement_invoices i join public.procurements p on p.id = i.procurement_id and p.org_id = v_org
      where i.id = p_invoice_id and i.org_id = v_org and p.vendor_id = v_term.vendor_id
    ) then raise exception 'choose a supplier invoice for this rental vendor' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_note,''))) > 1000 or (p_state = 'disputed' and nullif(btrim(p_note),'') is null) then
      raise exception 'a dispute needs a note of at most 1000 characters' using errcode = '22023';
    end if;
    v_result := v_result || jsonb_build_object('invoice_id',p_invoice_id,'note',nullif(btrim(p_note),''));
    insert into public.hourly_rental_checks(org_id,asset_id,period_from,period_to,result,invoice_id,note)
      values(v_org,p_asset,p_from,p_to,v_result,p_invoice_id,nullif(btrim(p_note),''));
    perform public.log_audit('equipment_rental.hourly_check',v_org,auth.uid(),p_asset,v_result);
  end if;
  return v_result;
end $$;

revoke all on function public.check_hourly_rental(uuid,date,date,numeric,numeric,jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.check_hourly_rental(uuid,date,date,numeric,numeric,jsonb,text,uuid,text) to authenticated;

-- Bounded identifiers only: no invoice amounts or general purchasing read is added to the Officer.
create function public.hourly_rental_invoice_choices(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_result jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()) or coalesce(public.actor_built_in_role() = 'equipment_officer',false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',coalesce(i.vi_number,i.reference_number,i.id::text)) order by i.created_at desc),'[]') into v_result
    from public.procurement_invoices i join public.procurements p on p.id = i.procurement_id and p.org_id = v_org
    where i.org_id = v_org and exists (select 1 from public.equipment_rental_terms t
      where t.asset_id = p_asset and t.org_id = v_org and t.vendor_id = p.vendor_id and t.basis = 'hour');
  return v_result;
end $$;
revoke all on function public.hourly_rental_invoice_choices(uuid) from public,anon,authenticated;
grant execute on function public.hourly_rental_invoice_choices(uuid) to authenticated;

-- Saved warnings are returned at either the asset or purchase handoff, scoped again inside this definer.
create function public.get_hourly_rental_checks(p_asset uuid default null, p_procurement uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_result jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()) or coalesce(public.actor_built_in_role() = 'equipment_officer',false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_asset is null) = (p_procurement is null) then raise exception 'choose one rental asset or purchase' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'state',c.result->>'state','note',c.note,
    'period_from',c.period_from,'period_to',c.period_to,'created_at',c.created_at,
    'author',pr.full_name,'invoice_number',coalesce(i.vi_number,i.reference_number,i.id::text)) order by c.created_at desc,c.id),'[]') into v_result
    from public.hourly_rental_checks c
    left join public.profiles pr on pr.id = c.created_by and pr.org_id = v_org
    left join public.procurement_invoices i on i.id = c.invoice_id and i.org_id = v_org
    left join public.procurements p on p.id = i.procurement_id and p.org_id = v_org
    where c.org_id = v_org and ((p_asset is not null and c.asset_id = p_asset)
      or (p_procurement is not null and p.id = p_procurement and c.result->>'state' = 'disputed'));
  return v_result;
end $$;
revoke all on function public.get_hourly_rental_checks(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_hourly_rental_checks(uuid,uuid) to authenticated;
