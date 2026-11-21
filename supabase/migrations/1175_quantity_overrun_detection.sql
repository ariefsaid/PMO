-- 1175_quantity_overrun_detection.sql — #2578: when does a contract line pass its contract quantity?
-- Spec: docs/specs/quantity-change-requests.spec.md (FR-QCR-001..003); AC-QCR-001..003, 028, 029.
-- Reversal: rollback/1175_quantity_overrun_detection_down.sql.
--   §1 quantity_forecasts: append-only expected-final-quantity rows (the forecast source, OD-QCR-1).
--   §2 qcr_figures: ONE set-based read of contract quantity C, reported progress P (greatest of four shipped sources,
--      naming the winner) and forecast E, per item; over-contract = strictly greater, never for a lump_sum line.
--   §3 quantity_overrun_notices: the persisted "told once" row per (item, kind); qcr_evaluate_items opens / clears it and
--      notifies the project's manager. Evaluation runs on the WRITES that can move P, E or C — never on a read.
--   §4 hooks on those writes; record_quantity_forecast (the guarded per-project read is in 1129).

-- ── §1 forecasts ────────────────────────────────────────────────────────────────────────────────────
create table public.quantity_forecasts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  boq_item_id uuid not null references public.boq_items(id) on delete cascade,
  quantity    numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index quantity_forecasts_item_idx on public.quantity_forecasts (boq_item_id, created_at desc, id desc);
create index quantity_forecasts_org_idx on public.quantity_forecasts (org_id);
create index quantity_forecasts_created_by_idx on public.quantity_forecasts (created_by);
alter table public.quantity_forecasts enable row level security;
alter table public.quantity_forecasts force row level security;
create policy quantity_forecasts_select on public.quantity_forecasts for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.quantity_forecasts from public, anon, authenticated;
grant select on public.quantity_forecasts to authenticated;

-- Append-only for every role; the one exception is the cascade that removes a contract line itself.
create function public.refuse_quantity_forecast_change() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.boq_items b where b.id = old.boq_item_id) then
    return old;
  end if;
  raise exception 'forecast quantities are append-only' using errcode = '42501';
end; $$;
revoke all on function public.refuse_quantity_forecast_change() from public, anon, authenticated;
create trigger quantity_forecasts_immutable before update or delete on public.quantity_forecasts
  for each row execute function public.refuse_quantity_forecast_change();

-- ── §2 the figures ──────────────────────────────────────────────────────────────────────────────────
-- Internal: no caller check (the callers below are triggers and the guarded read). Each source is pinned to the shipped
-- query it mirrors: (a) the item's OWN latest assessed quantity (not the project's latest month); (b) the latest
-- Confirmed acceptance of each non-cancelled work order that allocates it, summed (get_project_billing's latest_bast);
-- (c) non-withdrawn claim lines whose invoice is not Cancelled; (d) validated, un-superseded, un-archived daily reports
-- through the allocation (work_order_validated_revenue's filter).
create function public.qcr_figures(p_items uuid[])
returns table (boq_item_id uuid, org_id uuid, project_id uuid, earning_basis text, contract_quantity numeric,
               progress_quantity numeric, progress_source text, forecast_quantity numeric,
               over_progress boolean, over_forecast boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with items as (
    select b.id, b.org_id, b.project_id, b.earning_basis, b.quantity from public.boq_items b where b.id = any(p_items)
  ), assessed as (
    select distinct on (q.boq_item_id) q.boq_item_id, q.quantity_to_date as qty
      from public.progress_assessment_quantities q
      join public.project_progress_entries e on e.id = q.entry_id
     where q.boq_item_id in (select id from items)
     order by q.boq_item_id, e.month desc, e.id desc
  ), accepted as (
    select wl.boq_item_id, sum(al.quantity) as qty
      from public.work_order_lines wl
      join public.work_orders wo on wo.id = wl.work_order_id and wo.status <> 'Cancelled'
      join lateral (select a.id from public.work_order_acceptances a
                     where a.work_order_id = wl.work_order_id and a.status = 'Confirmed'
                     order by a.confirmed_at desc, a.id desc limit 1) la on true
      join public.work_order_acceptance_lines al on al.acceptance_id = la.id and al.boq_item_id = wl.boq_item_id
     where wl.boq_item_id in (select id from items)
     group by wl.boq_item_id
  ), claimed as (
    select l.boq_item_id, sum(l.quantity) as qty
      from public.progress_claim_lines l
      join public.progress_claims c on c.id = l.claim_id and c.withdrawn_at is null
      left join public.sales_invoices si on si.id = c.id and si.org_id = c.org_id
     where l.boq_item_id in (select id from items) and si.status is distinct from 'Cancelled'
     group by l.boq_item_id
  ), reported as (
    select wl.boq_item_id, sum(d.quantity) as qty
      from public.dsr_progress_lines d
      join public.daily_site_reports r on r.id = d.report_id
           and r.status = 'validated' and r.superseded_at is null and r.archived_at is null
      join public.work_order_lines wl on wl.id = d.work_order_line_id
     where wl.boq_item_id in (select id from items)
     group by wl.boq_item_id
  ), fc as (
    select distinct on (f.boq_item_id) f.boq_item_id, f.quantity as qty
      from public.quantity_forecasts f
     where f.boq_item_id in (select id from items)
     order by f.boq_item_id, f.created_at desc, f.id desc
  )
  select i.id, i.org_id, i.project_id, i.earning_basis, i.quantity,
         p.qty, case when p.qty > 0 then p.src end, fc.qty,
         (i.earning_basis = 'unit_rate' and p.qty > i.quantity),
         (i.earning_basis = 'unit_rate' and coalesce(fc.qty, 0) > i.quantity)
    from items i
    left join assessed a on a.boq_item_id = i.id
    left join accepted ac on ac.boq_item_id = i.id
    left join claimed cl on cl.boq_item_id = i.id
    left join reported rp on rp.boq_item_id = i.id
    left join fc on fc.boq_item_id = i.id
    cross join lateral (
      select v.qty, v.src
        from (values (coalesce(a.qty, 0), 'assessment', 1), (coalesce(ac.qty, 0), 'acceptance', 2),
                     (coalesce(cl.qty, 0), 'claim', 3), (coalesce(rp.qty, 0), 'daily_report', 4)) v(qty, src, ord)
       order by v.qty desc, v.ord limit 1) p
$$;
revoke all on function public.qcr_figures(uuid[]) from public, anon, authenticated;

-- ── §3 the persisted "told once" row ────────────────────────────────────────────────────────────────
create table public.quantity_overrun_notices (
  boq_item_id       uuid not null references public.boq_items(id) on delete cascade,
  kind              text not null check (kind in ('progress','forecast')),
  org_id            uuid not null references public.organizations(id),
  figure            numeric(14,3) not null,
  contract_quantity numeric(14,3) not null,
  notified_at       timestamptz not null default now(),
  primary key (boq_item_id, kind)
);
create index quantity_overrun_notices_org_idx on public.quantity_overrun_notices (org_id);
alter table public.quantity_overrun_notices enable row level security;
alter table public.quantity_overrun_notices force row level security;
create policy quantity_overrun_notices_select on public.quantity_overrun_notices for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.quantity_overrun_notices from public, anon, authenticated;
grant select on public.quantity_overrun_notices to authenticated;

create function public.qcr_evaluate_items(p_items uuid[]) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; v_kind text; v_over boolean; v_figure numeric; v_inserted integer; v_pm uuid; v_code text; v_proj text;
begin
  if p_items is null or cardinality(p_items) = 0 then return; end if;
  for r in select f.* from public.qcr_figures(p_items) f loop
    foreach v_kind in array array['progress','forecast'] loop
      v_over := case v_kind when 'progress' then r.over_progress else r.over_forecast end;
      v_figure := case v_kind when 'progress' then r.progress_quantity else r.forecast_quantity end;
      if not v_over then
        delete from public.quantity_overrun_notices n where n.boq_item_id = r.boq_item_id and n.kind = v_kind;
        continue;
      end if;
      insert into public.quantity_overrun_notices (boq_item_id, kind, org_id, figure, contract_quantity)
      values (r.boq_item_id, v_kind, r.org_id, v_figure, r.contract_quantity)
      on conflict (boq_item_id, kind) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 1 then
        select p.project_manager_id, b.item_code, p.name into v_pm, v_code, v_proj
          from public.boq_items b join public.projects p on p.id = b.project_id where b.id = r.boq_item_id;
        begin
          perform public.notify_workflow_user(r.org_id, v_pm,
            'Contract quantity exceeded',
            format('%s on %s: %s %s the contract quantity of %s. Raise a quantity change request.',
                   v_code, v_proj, case v_kind when 'progress' then 'reported progress of' else 'the forecast of' end,
                   v_figure, r.contract_quantity),
            'warning', 'project', r.project_id, v_proj);
        exception when others then null;  -- a notification never blocks the money write that triggered the check
        end;
      end if;
    end loop;
  end loop;
end; $$;
revoke all on function public.qcr_evaluate_items(uuid[]) from public, anon, authenticated;

-- ── §4 hooks on the writes that can move P, E or C ──────────────────────────────────────────────────
create function public.qcr_hook_assessment_ins() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array(select distinct n.boq_item_id from new_rows n));
  return null;
end; $$;
create function public.qcr_hook_assessment_del() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array(select distinct o.boq_item_id from old_rows o));
  return null;
end; $$;
create trigger progress_assessment_quantities_qcr_ins after insert on public.progress_assessment_quantities
  referencing new table as new_rows for each statement execute function public.qcr_hook_assessment_ins();
create trigger progress_assessment_quantities_qcr_upd after update on public.progress_assessment_quantities
  referencing new table as new_rows for each statement execute function public.qcr_hook_assessment_ins();
create trigger progress_assessment_quantities_qcr_del after delete on public.progress_assessment_quantities
  referencing old table as old_rows for each statement execute function public.qcr_hook_assessment_del();

create function public.qcr_hook_claim_lines() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array(select distinct n.boq_item_id from new_rows n));
  return null;
end; $$;
create trigger progress_claim_lines_qcr_ins after insert on public.progress_claim_lines
  referencing new table as new_rows for each statement execute function public.qcr_hook_claim_lines();

create function public.qcr_hook_acceptance() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array(select l.boq_item_id from public.work_order_acceptance_lines l where l.acceptance_id = new.id));
  return new;
end; $$;
create trigger work_order_acceptances_qcr_confirm after update of status on public.work_order_acceptances
  for each row when (new.status = 'Confirmed' and old.status is distinct from new.status)
  execute function public.qcr_hook_acceptance();

create function public.qcr_hook_daily_report() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array(
    select distinct wl.boq_item_id from public.dsr_progress_lines d
      join public.work_order_lines wl on wl.id = d.work_order_line_id where d.report_id = new.id));
  return new;
end; $$;
create trigger daily_site_reports_qcr_validated after update of status, superseded_at, archived_at on public.daily_site_reports
  for each row when (new.status = 'validated' or old.status = 'validated')
  execute function public.qcr_hook_daily_report();

create function public.qcr_hook_forecast() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array[new.boq_item_id]);
  return new;
end; $$;
create trigger quantity_forecasts_qcr_ins after insert on public.quantity_forecasts
  for each row execute function public.qcr_hook_forecast();

create function public.qcr_hook_contract_quantity() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform public.qcr_evaluate_items(array[new.id]);
  return new;
end; $$;
create trigger boq_items_zz_qcr_quantity after update of quantity on public.boq_items
  for each row when (new.quantity is distinct from old.quantity)
  execute function public.qcr_hook_contract_quantity();

do $$ declare f text; begin
  foreach f in array array['qcr_hook_assessment_ins()','qcr_hook_assessment_del()','qcr_hook_claim_lines()','qcr_hook_acceptance()',
                           'qcr_hook_daily_report()','qcr_hook_forecast()','qcr_hook_contract_quantity()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- A PM (or Finance and above) records the expected final quantity of an item. Append-only; the latest wins.
create function public.record_quantity_forecast(p_boq_item_id uuid, p_quantity numeric, p_note text default null)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_org uuid; v_basis text; v_id uuid;
begin
  perform public.assert_is_active_member();
  select b.project_id, b.org_id, b.earning_basis into v_project, v_org, v_basis from public.boq_items b where b.id = p_boq_item_id;
  if v_project is null or v_org is distinct from public.auth_org_id() then
    raise exception 'contract line not found' using errcode = 'P0002';
  end if;
  if not public.may_record_project_progress(v_project) then
    raise exception 'you may record a forecast only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if v_basis = 'lump_sum' then
    raise exception 'a lump-sum line is fixed at one, so it has no forecast quantity' using errcode = '23514';
  end if;
  if p_quantity is null or not (p_quantity > 0 and p_quantity < 'Infinity'::numeric and p_quantity = round(p_quantity, 3)) then
    raise exception 'the forecast quantity must be positive with at most 3 decimals' using errcode = '23514';
  end if;
  insert into public.quantity_forecasts (org_id, boq_item_id, quantity, note)
  values (v_org, p_boq_item_id, p_quantity, nullif(btrim(p_note), '')) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.record_quantity_forecast(uuid, numeric, text) from public, anon;
grant execute on function public.record_quantity_forecast(uuid, numeric, text) to authenticated;
