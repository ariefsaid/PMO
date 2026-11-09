-- 0810_pack_earned_value.sql — #1279: where a project has contract lines, the management pack (and the
-- finance-hub figure derived from it) recognises revenue from the same per-line earned value get_project_billing
-- computes, instead of latest percent complete x net contract. Projects without lines keep the percent basis.
-- The earning formula lives once, in project_line_earned; get_project_billing now reads it too.
-- Reversal: supabase/migrations/rollback/0810_pack_earned_value_down.sql.

-- One source of truth for per-line earned value (progress billing §8, DD-CQ-5): a closed work order earns its
-- final accepted quantity; the assessment earns only beyond what closed work orders ordered; nothing earns past the
-- contract quantity. p_as_at NULL = now (what get_project_billing reports); a date = as at the end of that month in
-- the org timezone (latest assessment on or before it, only acceptances confirmed before the month ended).
-- Every read is scoped to the project: the pack calls this once per project per month.
create or replace function public.project_line_earned(p_project_id uuid, p_as_at date default null)
 returns table(boq_item_id uuid, earned_quantity numeric, rate numeric, earned_value numeric)
 language sql stable security invoker set search_path=public as $$
with tz as (
 select coalesce((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),'UTC') name
), lim as (
 select case when p_as_at is null then null::timestamptz
   else ((date_trunc('month',p_as_at)+interval '1 month')::date)::timestamp at time zone tz.name end ts,
  coalesce(date_trunc('month',p_as_at)::date,public.org_current_month(tz.name,now())) month_at
 from tz
), latest as (
 select e.id from public.project_progress_entries e,lim where e.project_id=p_project_id and e.month<=lim.month_at order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a,lim where a.project_id=p_project_id and a.status='Confirmed' and (lim.ts is null or a.confirmed_at<lim.ts)
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,wo.closing_acceptance_id,
   al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.project_id=p_project_id and wo.status<>'Cancelled'
), agg as (
 select b.id,b.rate,b.quantity contract_quantity,a.quantity_to_date assessed_quantity,
  coalesce((select sum(x.accepted) from allocation x where x.boq_item_id=b.id and x.final and x.status='Closed'),0) closed_final,
  coalesce((select sum(x.quantity) from allocation x,lim where x.boq_item_id=b.id and x.status='Closed' and x.closing_acceptance_id is not null and (lim.ts is null or x.final)),0) closed_ordered
 from public.boq_items b left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
)
select g.id,g.earned_quantity,g.rate,round(g.earned_quantity*g.rate,2) from (
 select agg.*,agg.closed_final+least(greatest(coalesce(agg.assessed_quantity,0)-agg.closed_ordered,0),greatest(agg.contract_quantity-agg.closed_final,0)) earned_quantity from agg) g
$$;
revoke all on function public.project_line_earned(uuid,date) from public,anon;
grant execute on function public.project_line_earned(uuid,date) to authenticated;

create or replace function public.get_project_billing(p_project_id uuid)
 returns jsonb language sql stable security invoker set search_path=public as $$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), claimed_line as (
 select l.boq_item_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id group by l.boq_item_id
), claimed_alloc as (
 select l.boq_item_id,c.work_order_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
 where c.work_order_id is not null group by l.boq_item_id,c.work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a where a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.status<>'Cancelled'
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status in ('Issued','Closed')),0) ordered_quantity,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status='Issued'),0) issued_ordered,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.final and a.status='Closed'),0) closed_final,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.accepted is not null),0) accepted_quantity,
  coalesce(cl.claimed,0) claimed_quantity,a.quantity_to_date assessed_quantity,
  coalesce((select jsonb_agg(jsonb_build_object('work_order_id',x.work_order_id,'boq_item_id',x.boq_item_id,'quantity',x.quantity,'claimed_quantity',x.claimed,'accepted_quantity',x.accepted,'final',x.final) order by x.work_order_id)
    from allocation x where x.boq_item_id=b.id),'[]'::jsonb) allocations
 from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
), earned as (select * from public.project_line_earned(p_project_id)), lines as (
 select a.*,coalesce(e.earned_quantity,0) earned_quantity,
  a.contract_quantity-a.issued_ordered-a.closed_final contract_balance
 from agg a left join earned e on e.boq_item_id=a.id
)
select jsonb_build_object(
 'currency',p.currency,'contract_net',p.contract_net,
 'work_billed',coalesce((select sum(net+recovery) from counted where not is_down_payment),0),
 'dp_billed',coalesce((select sum(net) from counted where is_down_payment),0),
 'dp_recovered',coalesce((select sum(recovery) from counted where not is_down_payment),0),
 'not_submitted',coalesce((select sum(gross_amount-dp_recovery_amount) from claims where status is null or status='Draft'),0),
 'assessment',(select jsonb_build_object('month',l.month,'pct_complete',l.pct_complete) from latest l),
 'earned_value',coalesce((select sum(earned_value) from earned),0),
 'boq',coalesce((select jsonb_agg(jsonb_build_object('boq_item_id',id,'claimed_quantity',claimed_quantity,'assessed_quantity',assessed_quantity,
   'earning_basis',earning_basis,'line_no',line_no,'ordered_quantity',ordered_quantity,'accepted_quantity',accepted_quantity,'closed_final',closed_final,
   'earned_quantity',earned_quantity,'contract_balance',contract_balance,'allocations',allocations) order by line_no nulls last,created_at,id)
   from lines),'[]'::jsonb)) from p
$$;
revoke all on function public.get_project_billing(uuid) from public,anon;
grant execute on function public.get_project_billing(uuid) to authenticated;

create or replace function public.get_management_pack(p_from date default null, p_to date default null)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_tz     text;
  v_cur    text;
  v_to     date;
  v_from   date;
  v_result jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC'), o.default_currency
    into v_tz, v_cur
    from public.organizations o where o.id = v_org;

  v_to   := coalesce(date_trunc('month', p_to)::date, public.org_current_month(v_tz, now()));
  v_from := coalesce(date_trunc('month', p_from)::date, date_trunc('year', v_to)::date);

  if v_from > v_to or v_from < (v_to - interval '23 months')::date then
    raise exception 'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it'
      using errcode = '22023';
  end if;

  with counted as (
    -- ⚑ 0251: billed work from the shared view (was a direct read of sales_invoices with its own net-of-tax CASE).
    select w.project_id, w.currency,
           date_trunc('month', w.invoice_date)::date as month,
           w.net + w.recovery as net
      from public.sales_invoice_work_billed w
     where w.org_id = v_org
       and w.status in ('Submitted', 'Unpaid', 'Paid')
       and w.net is not null
       and w.invoice_date is not null
       and w.invoice_date < (v_to + interval '1 month')::date
       and not w.is_down_payment
  ),
  in_window as (
    select project_id, currency, month, sum(net) as net, count(*)::int as invoice_count
      from counted where month >= v_from
     group by project_id, currency, month
  ),
  before_window as (
    select project_id, currency, sum(net) as net, count(*)::int as invoice_count
      from counted where month < v_from
     group by project_id, currency
  ),
  proj as (
    select p.id, p.name, p.pmo_project_number, p.code, p.status::text as status, p.currency,
           case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                else p.contract_value end as contract_net,
           p.start_date, p.end_date, p.project_manager_id, c.name as client_name
      from public.projects p
      left join public.companies c on c.id = p.client_id
     where p.org_id = v_org
       and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
            or exists (select 1 from in_window w where w.project_id = p.id))
  ),
  earned as (
    -- ⚑ 0810: projects with contract lines recognise per-line earned value (the same function
    -- get_project_billing reads), as at the end of each month from the month before the window.
    select p.id as project_id, m.month::date as month, x.earned_value
      from proj p
     cross join generate_series(v_from - interval '1 month', v_to, interval '1 month') as m(month)
     cross join lateral (select coalesce(sum(e.earned_value), 0) as earned_value
                           from public.project_line_earned(p.id, m.month::date) e) x
     where exists (select 1 from public.boq_items b where b.project_id = p.id)
  ),
  progress as (
    select e.project_id, e.month, e.pct_complete, e.entered_at, pr.full_name as entered_by_name
      from public.project_progress_entries e
      join proj on proj.id = e.project_id
      left join public.profiles pr on pr.id = e.entered_by
     where e.month <= v_to
       and (   e.month >= v_from
            or e.month = (select max(e2.month) from public.project_progress_entries e2
                           where e2.project_id = e.project_id and e2.month < v_from))
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'timezone', v_tz,
    'org_currency', v_cur,
    -- ⚑ 0251: an undated down-payment invoice is not undated WORK.
    'undated_invoice_count', (select count(*)::int from public.sales_invoice_work_billed w
                               where w.org_id = v_org and w.status in ('Submitted', 'Unpaid', 'Paid')
                                 and w.net is not null and w.invoice_date is null and not w.is_down_payment),
    'projects', coalesce((select jsonb_agg(to_jsonb(x) order by x.name, x.id) from proj x), '[]'::jsonb),
    'invoiced', coalesce((select jsonb_agg(to_jsonb(w) order by w.month, w.project_id, w.currency)
                            from in_window w
                           where w.project_id is null or w.project_id in (select id from proj)), '[]'::jsonb),
    'invoiced_before', coalesce((select jsonb_agg(to_jsonb(b) order by b.project_id, b.currency)
                                   from before_window b
                                  where b.project_id is null or b.project_id in (select id from proj)), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(to_jsonb(g) order by g.project_id, g.month) from progress g), '[]'::jsonb),
    'earned', coalesce((select jsonb_agg(to_jsonb(g) order by g.project_id, g.month) from earned g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end; $$;
revoke all     on function public.get_management_pack(date, date) from public, anon;
grant  execute on function public.get_management_pack(date, date) to authenticated;

create or replace function public.get_finance_hub_figures()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_tz   text;
  v_to   date;
  v_from date;
  v_today date;
  v_bad  boolean;
  v_project_map jsonb;
  v_period_start date;
  v_unpublished boolean;
  v_payload jsonb;
  v_col text;
  v_currency text;
  v_net  numeric;
  v_pack jsonb;
  v_statement jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role not in ('Admin', 'Finance', 'Executive') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC')
    into v_tz
    from public.organizations o where o.id = v_org;

  v_to    := public.org_current_month(v_tz, now());
  v_from  := date_trunc('year', v_to)::date;
  v_today := (now() at time zone v_tz)::date;

  -- ── pack figures ── the client's derivation of the 0323 facts, computed where the data lives ──
  v_pack := (
    with counted as (
      select w.project_id, w.currency,
             date_trunc('month', w.invoice_date)::date as month,
             w.net + w.recovery as net
        from public.sales_invoice_work_billed w
       where w.org_id = v_org
         and w.status in ('Submitted', 'Unpaid', 'Paid')
         and w.net is not null
         and w.invoice_date is not null
         and w.invoice_date < (v_to + interval '1 month')::date
         and not w.is_down_payment
    ),
    proj as (
      select p.id, p.currency,
             (case when p.tax_treatment = 'inclusive'
                   then p.contract_value - coalesce(p.tax_amount, 0)
                   else p.contract_value end) as contract_net
        from public.projects p
       where p.org_id = v_org
         and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
              or exists (select 1 from counted w where w.project_id = p.id and w.month >= v_from))
    ),
    progress_latest as (
      select distinct on (e.project_id) e.project_id, e.pct_complete
        from public.project_progress_entries e
        join proj on proj.id = e.project_id
       where e.month <= v_to
       order by e.project_id, e.month desc
    ),
    earned_now as (
      -- ⚑ 0810: contract-line projects recognise per-line earned value, as the pack does
      select p.id as project_id, (select coalesce(sum(e.earned_value), 0) from public.project_line_earned(p.id, v_to) e) as earned_value
        from proj p
       where exists (select 1 from public.boq_items b where b.project_id = p.id)
    ),
    key_cents as (
      -- the client rounds each of the facts' month groups to cents, then sums the groups
      select s.project_id, s.currency, sum(s.cents)::bigint as cents
        from (
          select project_id, currency, round(sum(net) * 100)::bigint as cents
            from counted where month >= v_from
           group by project_id, currency, month
          union all
          select project_id, currency, round(sum(net) * 100)::bigint
            from counted where month < v_from
           group by project_id, currency
        ) s
       where s.project_id is null or s.project_id in (select id from proj)
       group by s.project_id, s.currency
    ),
    project_unbilled as (
      select p.currency,
             (case
                when en.project_id is not null then round(en.earned_value * 100)::bigint
                when prog.pct_complete is not null
                  then floor((2 * (round(p.contract_net * 100)::bigint)::numeric
                                  * round(prog.pct_complete * 100)::bigint + 10000) / 20000)::bigint
                else coalesce(kc.cents, 0)
              end - coalesce(kc.cents, 0))::bigint as unbilled_cents
        from proj p
        left join progress_latest prog on prog.project_id = p.id
        left join earned_now en on en.project_id = p.id
        left join key_cents kc on kc.project_id = p.id and kc.currency = p.currency
    ),
    figures as (
      -- rows without a contract recognise exactly what they billed, so they contribute their
      -- currency at zero; contract rows contribute recognised − invoiced in their own currency
      select x.currency, sum(x.unbilled_cents)::bigint as unbilled_cents
        from (
          select currency, unbilled_cents from project_unbilled
          union all
          select currency, 0::bigint from key_cents
           where project_id is null or project_id in (select id from proj)
        ) x
       group by x.currency
    )
    select jsonb_build_object(
      'as_at', v_to,
      'unbilled', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'cents', unbilled_cents)
                                              order by currency)
                              from figures), '[]'::jsonb),
      'contract_rows', (select count(*)::int from proj),
      'invoiced_basis_rows', (select count(*)::int from proj p
                               where not exists (select 1 from progress_latest pr where pr.project_id = p.id)
                                 and not exists (select 1 from earned_now en where en.project_id = p.id))
    )
  );

  -- ── statement figures ── the 0321 read's own contract, narrowed to the two fields the hub shows ──
  select exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
    where a.snapshot_id is not null and s.scope_kind = 'company' and s.project_id is null
      and (s.source_generation is distinct from a.source_generation or s.as_of is distinct from a.last_success_at
        or s.capture_started_at is distinct from a.capture_started_at
        or s.capture_completed_at is distinct from a.capture_completed_at)
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
    where a.snapshot_id is not null and s.scope_kind = 'company' and s.project_id is null
    group by s.snapshot_id
    having count(distinct s.display_precision) > 1 or count(distinct s.display_rounding_method) > 1
      or count(distinct s.capture_started_at) > 1 or count(distinct s.capture_completed_at) > 1
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
    where a.snapshot_id is not null and s.scope_kind = 'company' and s.project_id is null
    group by s.period_kind, s.current_start
    having count(distinct (s.current_end, s.prior_start, s.prior_end)) > 1
  ) into v_bad;
  if v_bad then raise exception 'Invalid statement selection' using errcode = '22023'; end if;

  select binding.config->'project_map' into v_project_map
    from public.external_org_bindings binding
   where binding.org_id = v_org and binding.external_tier = 'erpnext' and binding.activated_at is not null
   limit 1;

  -- `unpublished` mirrors the catalogue's empty period list (the hub's integrations pointer).
  select not exists (
    select 1
      from public.erp_financial_statement_availability a
      join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
     where a.snapshot_id is not null and s.capture_started_at is not null
       and ( (s.scope_kind = 'company' and s.project_id is null)
          or (s.scope_kind = 'project' and s.project_id is not null
              and coalesce(jsonb_typeof(v_project_map) = 'object'
                and v_project_map ? s.project_id::text
                and jsonb_typeof(v_project_map->s.project_id::text) = 'string'
                and btrim(v_project_map->>s.project_id::text) <> '', false)
              and exists (select 1 from public.projects p where p.id = s.project_id and p.org_id = v_org)) )
  ) into v_unpublished;

  -- the latest month period at or before today over the catalogue's candidate set — the same period
  -- the hub picks from the catalogue before reading the statement.
  select s.current_start into v_period_start
    from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
   where a.snapshot_id is not null and s.capture_started_at is not null
     and s.period_kind = 'month' and s.current_start <= v_today
     and ( (s.scope_kind = 'company' and s.project_id is null)
        or (s.scope_kind = 'project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map) = 'object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text) = 'string'
              and btrim(v_project_map->>s.project_id::text) <> '', false)
            and exists (select 1 from public.projects p where p.id = s.project_id and p.org_id = v_org)) )
   order by s.current_start desc
   limit 1;

  -- the 0321 read's company-scope selection of the profit-and-loss payload, plus the generation
  -- currency (the same latest-candidate row the read names in its envelope).
  with readable as materialized (
    select s.id, s.snapshot_id, s.as_of, s.capture_completed_at, s.currency,
           s.period_kind, s.current_start, s.payload, s.statement, s.view_kind
      from public.erp_financial_statement_availability a
      join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
     where a.snapshot_id is not null and s.capture_started_at is not null
       and s.scope_kind = 'company' and s.project_id is null
  ), generation_row as (
    select currency from readable
     order by as_of desc, capture_completed_at desc, snapshot_id desc, id limit 1
  ), selected as (
    select payload from readable
     where period_kind = 'month' and current_start = v_period_start
       and statement = 'profit_and_loss' and view_kind = 'account_breakdown'
     limit 1
  )
  select (select currency from generation_row), (select payload from selected)
    into v_currency, v_payload;

  -- the client's own netProfit extraction: the first row whose label matches /profit for the period/i
  -- after apostrophe removal, at the first visible non-total currency column.
  if v_payload is not null then
    select c.value->>'fieldname' into v_col
      from jsonb_array_elements(v_payload->'current'->'columns') with ordinality c(value, ord)
     where c.value->>'type' = 'currency' and c.value->>'fieldname' <> 'total'
       -- JS `!column.hidden`: absent, null, false, 0 and "" are visible
       and coalesce(c.value->'hidden', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)
     order by c.ord
     limit 1;
    if v_col is not null then
      -- Number(value) is null for non-numeric text; a bare cast would abort the whole read
      select case when jsonb_typeof(cell) = 'number'
                    or (jsonb_typeof(cell) = 'string' and (cell #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$')
                  then btrim(cell #>> '{}')::numeric end
        into v_net
        from (
          select row_value -> v_col as cell
            from jsonb_array_elements(v_payload->'current'->'rows') with ordinality as t(row_value, ord)
           where (
             case when jsonb_typeof(row_value->'account_name') = 'string' then row_value->>'account_name'
                  when jsonb_typeof(row_value->'account') = 'string' then row_value->>'account' end
           ) is not null
             and position('profit for the period' in
                   lower(regexp_replace(
                     case when jsonb_typeof(row_value->'account_name') = 'string' then row_value->>'account_name'
                          when jsonb_typeof(row_value->'account') = 'string' then row_value->>'account' end,
                     '''', '', 'g'))) > 0
           order by ord
           limit 1
        ) profit_cell;
    end if;
  end if;

  v_statement := jsonb_build_object(
    'unpublished', v_unpublished,
    'period_start', v_period_start,
    'net_profit', v_net,
    'currency', v_currency
  );

  return jsonb_build_object('pack', v_pack, 'statement', v_statement);
end;
$$;

revoke all on function public.get_finance_hub_figures() from public, anon, authenticated, service_role;
grant execute on function public.get_finance_hub_figures() to authenticated;
