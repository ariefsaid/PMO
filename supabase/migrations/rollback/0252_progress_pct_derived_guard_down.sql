-- Reverses 0252: drops the guard and restores 0250's record_progress_assessment verbatim.
drop trigger if exists project_progress_entries_derived_pct_guard on public.project_progress_entries;
drop function if exists public.refuse_derived_pct_overwrite();

create or replace function public.record_progress_assessment(
  p_project_id uuid, p_month date, p_quantities jsonb, p_note text default null)
  returns numeric language plpgsql volatile set search_path = public as $$
declare
  v_total numeric;
  v_done  numeric;
  v_pct   numeric;
  v_entry uuid;
begin
  if p_project_id is null or p_month is null or p_quantities is null
     or jsonb_typeof(p_quantities) <> 'array' or jsonb_array_length(p_quantities) = 0 then
    raise exception 'project, month and at least one quantity are required' using errcode = '23502';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
              where not coalesce(x.quantity_to_date >= 0 and x.quantity_to_date < 'Infinity'::numeric
                                 and x.quantity_to_date = round(x.quantity_to_date, 3), false)) then
    raise exception 'each quantity done to date must be 0 or more with at most 3 decimals' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
              where b.id is null) then
    raise exception 'every line must be a bill of quantities line of this project' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric))
     <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)) then
    raise exception 'each bill of quantities line may appear once per assessment' using errcode = '23514';
  end if;
  select coalesce(sum(b.quantity * b.rate), 0) into v_total from public.boq_items b where b.project_id = p_project_id;
  if v_total <= 0 then
    raise exception 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead'
      using errcode = '23514';
  end if;
  select coalesce(sum(least(x.quantity_to_date, b.quantity) * b.rate), 0) into v_done
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
    join public.boq_items b on b.id = x.boq_item_id;
  v_pct := round(v_done / v_total * 100, 2);

  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, v_pct, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note
  returning id into v_entry;

  delete from public.progress_assessment_quantities q
   where q.entry_id = v_entry
     and not exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
                      where x.boq_item_id = q.boq_item_id);
  insert into public.progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select v_entry, x.boq_item_id, x.quantity_to_date
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
  on conflict (entry_id, boq_item_id) do update set quantity_to_date = excluded.quantity_to_date;
  return v_pct;
end; $$;
revoke all on function public.record_progress_assessment(uuid, date, jsonb, text) from public, anon;
grant execute on function public.record_progress_assessment(uuid, date, jsonb, text) to authenticated;
