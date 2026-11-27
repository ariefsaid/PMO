-- Rollback of 2780_read_correctness.sql: restores 2766 work_order_section_rollup and 1046 billing_reconciliation.
begin;

create or replace function public.work_order_section_rollup(p_work_order_id uuid)
  returns table (
    section_id uuid, code text, name text, location_note text, foreman_id uuid, readiness text, readiness_note text,
    sort_order integer, archived_at timestamptz,
    direct_budget numeric, indirect_budget numeric, equipment_hours numeric, crew_hours numeric,
    tasks_total integer, tasks_done integer, crews_today integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select x.id, x.code, x.name, x.location_note, x.foreman_id, x.readiness, x.readiness_note, x.sort_order, x.archived_at
      from public.work_order_sections x where x.work_order_id = p_work_order_id
  ),
  keys as (
    select s.id as sid, s.code, s.name, s.location_note, s.foreman_id, s.readiness, s.readiness_note, s.sort_order, s.archived_at from s
    union all
    select null::uuid, null, null, null, null::uuid, null, null, null::integer, null::timestamptz where exists (select 1 from s)
  ),
  plan as (
    select l.section_id as sid, l.kind, sum(l.value) as v
      from public.work_order_plan_lines l where l.work_order_id = p_work_order_id group by l.section_id, l.kind
  ),
  tk as (
    select t.section_id as sid, count(*)::integer as total, (count(*) filter (where t.status = 'Done'))::integer as done
      from public.tasks t
     where t.work_order_id = p_work_order_id and t.archived_at is null
       and not exists (
         select 1 from public.tasks c
          where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null
       )
     group by t.section_id
  ),
  cr as (
    select c.section_id as sid, count(*)::integer as n
      from public.work_order_crews c
     where c.work_order_id = p_work_order_id and (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC'))::date between c.valid_from and coalesce(c.valid_to, 'infinity'::date)
     group by c.section_id
  )
  select k.sid, k.code, k.name, k.location_note, k.foreman_id, k.readiness, k.readiness_note, k.sort_order, k.archived_at,
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'direct_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'indirect_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'equipment_hours'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'crew_hours'),
         coalesce((select t.total from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select t.done from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select c.n from cr c where c.sid is not distinct from k.sid), 0)
    from keys k
   order by (k.sid is null), k.sort_order, k.code
$$;
revoke all on function public.work_order_section_rollup(uuid) from public, anon;
grant execute on function public.work_order_section_rollup(uuid) to authenticated;

create or replace function public.billing_reconciliation(p_project uuid, p_work_order uuid default null)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, line_no integer,
                 scope_qty numeric, progress_qty numeric, measured_qty numeric, billed_qty numeric, billed_amount numeric,
                 unbilled_qty numeric, surplus_qty numeric, status text)
  language sql stable security invoker set search_path = public as $$
  with scope as (
    select b.id, b.item_code, b.description, b.unit, b.rate, b.line_no,
           case when p_work_order is null then b.quantity else wl.quantity end as qty,
           p_work_order is not null
             and exists (select 1 from public.work_order_lines o where o.boq_item_id = b.id and o.work_order_id <> p_work_order) as shared
      from public.boq_items b
      left join public.work_order_lines wl on wl.boq_item_id = b.id and wl.work_order_id = p_work_order
     where b.project_id = p_project
       and (p_work_order is null or wl.id is not null)
  ),
  progress as (
    select distinct on (q.boq_item_id) q.boq_item_id, q.quantity_to_date
      from public.progress_assessment_quantities q
      join public.project_progress_entries e on e.id = q.entry_id
     where e.project_id = p_project
     order by q.boq_item_id, e.month desc
  ),
  claimed as (
    select boq_item_id, sum(measured) as measured, sum(billed) as billed, sum(billed_amount) as billed_amount from (
      select l.boq_item_id,
             sum(l.quantity) filter (where pc.withdrawn_at is null) as measured,
             sum(l.quantity) filter (where si.id is not null and si.status <> 'Cancelled')                    as billed,
             sum(l.amount)   filter (where si.id is not null and si.status <> 'Cancelled')                    as billed_amount
        from public.progress_claim_lines l
        join public.progress_claims pc on pc.id = l.claim_id
        left join public.sales_invoices si on si.id = pc.id and si.org_id = pc.org_id
       where pc.project_id = p_project and pc.kind = 'progress'
         and (p_work_order is null or pc.work_order_id = p_work_order)
       group by l.boq_item_id
      union all
      select x.boq_item_id, x.claimed_quantity, x.claimed_quantity, x.claimed_amount
        from public.opening_balance_lines x
        join public.opening_balances ob on ob.id = x.opening_id
        join public.work_orders wo on wo.id = ob.work_order_id
       where wo.project_id = p_project and ob.reversed_at is null and x.claimed_quantity > 0
         and (p_work_order is null or ob.work_order_id = p_work_order)) u
     group by boq_item_id
  )
  select s.id, s.item_code, s.description, s.unit, s.rate, s.line_no,
         s.qty,
         case when s.shared then null else coalesce(p.quantity_to_date, 0) end,
         coalesce(c.measured, 0),
         coalesce(c.billed, 0),
         coalesce(c.billed_amount, 0),
         case when s.shared then null else greatest(coalesce(p.quantity_to_date, 0) - coalesce(c.billed, 0), 0) end,
         greatest(greatest(case when s.shared then 0 else coalesce(p.quantity_to_date, 0) end, coalesce(c.billed, 0)) - s.qty, 0),
         case when coalesce(c.billed, 0) = 0 then 'unbilled'
              when c.billed > s.qty then 'surplus'
              when c.billed = s.qty then 'fully_billed'
              else 'partly_billed' end
    from scope s
    left join progress p on p.boq_item_id = s.id
    left join claimed c on c.boq_item_id = s.id
   order by s.line_no nulls last, s.item_code
$$;
revoke all on function public.billing_reconciliation(uuid, uuid) from public, anon;
grant execute on function public.billing_reconciliation(uuid, uuid) to authenticated, service_role;

commit;
