-- 0424_imprest_position.sql — #1515 site imprest S3: the float position and plan-usage reads, append-only cash counts,
-- the expense form's narrow float chooser (PQ-4) and the imprest notifications (FR-IMP-064, PQ-10). Spec §5-§7 · Plan S3.
-- Depends on 0237, 0247, 0422, 0423. Proven by imprest_position, imprest_notify, imprest_rls, imprest_acl pgTAP, the
-- 0178 allow-list and expense_claims_notify (the re-created notifier's existing proof).
-- ⚑ notify_expense_claim_transition below is 0247 §10 VERBATIM plus the lines marked `-- 0424`.
-- ── REVERSE (manual, in this order; also rollback/0424_imprest_position_down.sql) ───────────────────────────────────
--   re-create public.notify_expense_claim_transition from 0247 §10 (copy it from the rollback file, never from this file)
--   drop trigger if exists imprest_replenishments_notify_trg on public.imprest_replenishments;
--   drop trigger if exists imprest_plans_notify_trg on public.imprest_plans;
--   drop function if exists public.notify_imprest_replenishment();
--   drop function if exists public.notify_imprest_plan_transition();
--   drop function if exists public.imprest_exception_recipients(uuid, uuid, date, uuid);
--   drop function if exists public.imprest_float_choices(uuid, public.budget_category);
--   drop function if exists public.get_imprest_position(uuid);
--   drop function if exists public.get_imprest_plan_usage(uuid, date);
--   drop function if exists public.record_imprest_count(uuid, numeric, text);
--   drop table if exists public.imprest_cash_counts;   -- its trigger goes with it
--   drop function if exists public.refuse_imprest_count_change();
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- §1 cash counts (FR-IMP-062): append-only, the book figure frozen at the count.
create table public.imprest_cash_counts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  float_id       uuid not null references public.imprest_floats(id),
  counted_amount numeric(14,2) not null,
  book_amount    numeric(14,2) not null,
  variance       numeric(14,2) not null,
  note           text,
  counted_by     uuid not null references public.profiles(id),
  counted_at     timestamptz not null default now(),
  constraint imprest_cash_counts_counted_range check (counted_amount >= 0 and counted_amount < 'Infinity'::numeric),
  constraint imprest_cash_counts_variance_math check (variance = counted_amount - book_amount),
  constraint imprest_cash_counts_note_on_variance check (variance = 0 or btrim(coalesce(note, '')) <> '')
);
create index imprest_cash_counts_float_idx on public.imprest_cash_counts (float_id, counted_at desc);
alter table public.imprest_cash_counts enable row level security;
alter table public.imprest_cash_counts force  row level security;
create policy imprest_cash_counts_select on public.imprest_cash_counts for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_cash_counts.float_id));
revoke all on public.imprest_cash_counts from public, anon, authenticated;
grant select on public.imprest_cash_counts to authenticated;
-- only record_imprest_count writes (0413 stock-ledger shape): the service role reads, never writes or truncates
revoke insert, update, delete, truncate, trigger, references on public.imprest_cash_counts from service_role;
-- append-only for every writer, TRUNCATE included (FR-IMP-062)
create or replace function public.refuse_imprest_count_change() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a cash count is append-only' using errcode = '42501';
end; $$;
revoke all on function public.refuse_imprest_count_change() from public, anon, authenticated;
create trigger imprest_cash_counts_append_only before update or delete on public.imprest_cash_counts
  for each row execute function public.refuse_imprest_count_change();
create trigger imprest_cash_counts_no_truncate before truncate on public.imprest_cash_counts
  for each statement execute function public.refuse_imprest_count_change();

create or replace function public.record_imprest_count(p_float uuid, p_counted numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_book numeric; v_id uuid;
begin
  perform public.assert_is_active_member();
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if not (public.auth_role() in ('Finance','Admin')
          or (v_uid = v_f.custodian_id and public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid))) then
    raise exception 'only the custodian, Finance or an Admin records a cash count' using errcode = '42501';
  end if;
  if p_counted is null or not (p_counted >= 0 and p_counted < 'Infinity'::numeric) then
    raise exception 'a counted amount must be zero or more' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  v_book := public.imprest_cash_book(p_float);
  if round(p_counted, 2) <> v_book and btrim(coalesce(p_note, '')) = '' then
    raise exception 'the count differs from the book by %: add a note', round(p_counted, 2) - v_book using errcode = 'P0001';
  end if;
  insert into public.imprest_cash_counts (org_id, float_id, counted_amount, book_amount, variance, note, counted_by)
  values (v_f.org_id, p_float, round(p_counted, 2), v_book, round(p_counted, 2) - v_book, nullif(btrim(p_note), ''), v_uid)
  returning id into v_id;
  perform public.log_audit('imprest_count.recorded', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'counted', round(p_counted, 2), 'book', v_book, 'variance', round(p_counted, 2) - v_book));
  return v_id;
end; $$;
revoke all on function public.record_imprest_count(uuid, numeric, text) from public, anon;
grant execute on function public.record_imprest_count(uuid, numeric, text) to authenticated;

-- §2 position and plan usage (FR-IMP-060/061, NFR-IMP-006). SECURITY INVOKER: a float the caller cannot see yields no
-- row (AC-IMP-050). Usage first: a SQL function body is resolved at creation.
create or replace function public.get_imprest_plan_usage(p_float uuid, p_month date)
returns table (budget_category public.budget_category, planned numeric, drawn numeric, remaining numeric, exceptions jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with cats as (
    select l.budget_category, l.planned_amount from public.imprest_plans p join public.imprest_plan_lines l on l.plan_id = p.id
     where p.float_id = p_float and p.month = p_month and p.status = 'Approved'
    union
    select c.budget_category, 0 from public.expense_claims c
     where c.imprest_float_id = p_float and c.imprest_month = p_month and c.status in ('Approved','Paid')
       and not exists (select 1 from public.imprest_plans p join public.imprest_plan_lines l on l.plan_id = p.id
                        where p.float_id = p_float and p.month = p_month and p.status = 'Approved'
                          and l.budget_category = c.budget_category))
  select k.budget_category, k.planned_amount, public.imprest_drawn(p_float, p_month, k.budget_category),
         public.imprest_remaining(p_float, p_month, k.budget_category),
         coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.claim_number, 'kind', c.kind,
                                                       'amount', to_char(c.amount, 'FM999999999990.00'), 'status', c.status)
                                    order by c.submitted_at)
                     from public.expense_claims c
                    where c.imprest_float_id = p_float and c.imprest_month = p_month and c.budget_category = k.budget_category
                      and c.is_plan_exception), '[]'::jsonb)
    from cats k
   where exists (select 1 from public.imprest_floats f where f.id = p_float)
$$;

-- One row per call, never paged.
create or replace function public.get_imprest_position(p_float uuid)
returns table (float_id uuid, float_amount numeric, cash_book numeric, advances_out numeric, receipts_waiting numeric,
               replenishment_in_flight numeric, gap numeric, last_count_at timestamptz, last_count_variance numeric,
               month date, plan_lines jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with f as (select fl.*, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date as m
               from public.imprest_floats fl join public.organizations o on o.id = fl.org_id where fl.id = p_float),
       n as (select public.imprest_cash_book(p_float) cb, public.imprest_advances_out(p_float) ao,
                    public.imprest_receipts_waiting(p_float) rw)
  select f.id, f.float_amount, n.cb, n.ao, n.rw,
         coalesce((select sum(r.amount) from public.imprest_replenishments r
                    where r.float_id = p_float and r.status in ('Requested','Approved')), 0),
         f.float_amount - (n.cb + n.ao + n.rw),
         (select c.counted_at from public.imprest_cash_counts c where c.float_id = p_float order by c.counted_at desc limit 1),
         (select c.variance   from public.imprest_cash_counts c where c.float_id = p_float order by c.counted_at desc limit 1),
         f.m,
         (select coalesce(jsonb_agg(u order by u.budget_category), '[]'::jsonb)
            from public.get_imprest_plan_usage(p_float, f.m) u)
    from f, n
$$;
revoke all on function public.get_imprest_position(uuid), public.get_imprest_plan_usage(uuid, date) from public, anon;
grant execute on function public.get_imprest_position(uuid), public.get_imprest_plan_usage(uuid, date) to authenticated;

-- §3 the expense form's float chooser (PQ-4, FR-IMP-072). DEFINER, narrow: for any active member, only id, custodian
-- name and this month's remaining for the category — never the float amount, cash or other floats' data. A custodian is
-- never offered their own float (DD-IMP-7.2).
create or replace function public.imprest_float_choices(p_project uuid, p_category public.budget_category default null)
returns table (float_id uuid, custodian_name text, remaining numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, pf.full_name,
         case when p_category is null then null
              else public.imprest_remaining(f.id, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date,
                                            p_category) end
    from public.imprest_floats f
    join public.profiles pf on pf.id = f.custodian_id
    join public.organizations o on o.id = f.org_id
   where f.project_id = p_project and f.org_id = public.auth_org_id() and f.archived_at is null
     and public.is_active_member() and f.custodian_id is distinct from auth.uid()
   order by pf.full_name
$$;
revoke all on function public.imprest_float_choices(uuid, public.budget_category) from public, anon;
grant execute on function public.imprest_float_choices(uuid, public.budget_category) to authenticated;

-- §4 notifications (FR-IMP-064, PQ-10). Plans and replenishments, one trigger each.
create or replace function public.notify_imprest_plan_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_f public.imprest_floats%rowtype; v_label text := coalesce(new.number, 'Site cash plan');
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into v_f from public.imprest_floats where id = new.float_id;
  if new.status = 'Submitted' then
    -- the union of every line's route population, minus the author and the custodian (they cannot decide)
    for r in select distinct p.id from public.profiles p
              cross join lateral (select * from public.imprest_plan_lines l where l.plan_id = new.id) l
              cross join lateral public.spend_approval_route(new.org_id, v_f.project_id, l.budget_category, l.planned_amount,
                                                             v_f.currency, new.author_id, null, new.submitted_at) rt
             where p.org_id = new.org_id and p.id is distinct from new.author_id and p.id is distinct from v_f.custodian_id
               and case coalesce(rt.route, 'admin') when 'flat' then public.holds_spend_approval_authority(p.role)
                                                    when 'admin' then p.role = 'Admin'
                                                    else p.id = any (rt.approver_ids) end
    loop
      perform public.notify_workflow_user(new.org_id, r.id, 'Site cash plan awaiting your approval', v_label, 'info',
                                          'imprest_plan', new.id, v_label);
    end loop;
  elsif new.status in ('Approved','Rejected') then
    perform public.notify_workflow_user(new.org_id, new.author_id, 'Your site cash plan was ' || lower(new.status),
      coalesce(new.decision_notes, v_label), case new.status when 'Approved' then 'info' else 'warning' end,
      'imprest_plan', new.id, v_label);
  end if;
  return new;
end; $$;
revoke all on function public.notify_imprest_plan_transition() from public, anon, authenticated;
create trigger imprest_plans_notify_trg after update of status on public.imprest_plans
  for each row execute function public.notify_imprest_plan_transition();

create or replace function public.notify_imprest_replenishment() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_f public.imprest_floats%rowtype; v_noun text := case new.kind when 'funding' then 'Site float funding' else 'Site cash replenishment' end;
begin
  select * into v_f from public.imprest_floats where id = new.float_id;
  if tg_op = 'INSERT' then
    -- Finance other than the custodian and requester; with none, the Admins (who may also approve it)
    for r in with x as (select p.id, p.role from public.profiles p
                      where p.org_id = new.org_id and p.role in ('Finance','Admin')
                        and p.id is distinct from v_f.custodian_id and p.id is distinct from new.requested_by)
          select x.id from x where x.role = 'Finance' or not exists (select 1 from x where x.role = 'Finance')
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' requested', new.number, 'info',
                                          'imprest_replenishment', new.id, new.number);
    end loop;
  elsif new.status is distinct from old.status and new.status in ('Approved','Paid') then
    perform public.notify_workflow_user(new.org_id, v_f.custodian_id, v_noun || ' ' || lower(new.status), new.number, 'info',
                                        'imprest_replenishment', new.id, new.number);
  end if;
  return new;
end; $$;
revoke all on function public.notify_imprest_replenishment() from public, anon, authenticated;
create trigger imprest_replenishments_notify_trg after insert or update of status on public.imprest_replenishments
  for each row execute function public.notify_imprest_replenishment();

-- FR-IMP-064: who may still decide an out-of-plan item — the senior set minus the claimant, the custodian (DD-IMP-7.1)
-- and this month's plan approver (FR-IMP-024); with nobody left, the Admins minus the same people (the senior route's
-- own fallback). Mirrors the refusals in transition_expense_claim (0423), so nobody is told who would be refused.
create or replace function public.imprest_exception_recipients(p_org uuid, p_float uuid, p_month date, p_claimant uuid)
returns setof uuid language sql stable security invoker set search_path = public, pg_temp as $$
  with x as (select array_remove(array[p_claimant,
                      (select f.custodian_id from public.imprest_floats f where f.id = p_float),
                      (select p.approved_by from public.imprest_plans p
                        where p.float_id = p_float and p.month = p_month and p.status = 'Approved')], null) as ids),
       s as (select p.id from public.profiles p cross join x cross join lateral public.imprest_senior_route(p_org, p_claimant) r
              where p.org_id = p_org and r.route = 'org' and p.id = any (r.approver_ids) and p.id <> all (x.ids))
  select s.id from s
  union all
  select p.id from public.profiles p cross join x
   where p.org_id = p_org and p.role = 'Admin' and p.status = 'active' and p.id <> all (x.ids)
     and not exists (select 1 from s)
$$;
revoke all on function public.imprest_exception_recipients(uuid, uuid, date, uuid) from public, anon, authenticated;

-- notify_expense_claim_transition: 0247 §10 VERBATIM plus the lines marked `-- 0424` (FR-IMP-064 exceptions, PQ-10
-- a float record is ready to pay for its custodian only). The trigger from 0247 stays bound.
create or replace function public.notify_expense_claim_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r       record;
  v_route record;
  v_noun  text := case new.kind when 'advance' then 'Cash advance' else 'Expense claim' end;
  v_label text := coalesce(new.claim_number, new.title);
  v_left  numeric;                                                                          -- 0424
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'Draft' and new.status = 'Submitted' then
    select * into v_route
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category, new.amount, new.currency,
                                       new.claimant_id, null, new.submitted_at);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.claimant_id
                and (new.imprest_float_id is null or p.id is distinct from                        -- 0424 DD-IMP-7.1
                     (select f.custodian_id from public.imprest_floats f where f.id = new.imprest_float_id))  -- 0424
                and case coalesce(v_route.route, 'admin')
                      when 'flat'  then public.holds_spend_approval_authority(p.role)
                      when 'admin' then p.role = 'Admin'
                      else p.id = any (v_route.approver_ids)
                    end
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' awaiting your approval',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
    if new.imprest_float_id is not null                                                     -- 0424 FR-IMP-064
       and new.amount > public.imprest_remaining(new.imprest_float_id, new.imprest_month, new.budget_category) then  -- 0424
      for r in select x as id from public.imprest_exception_recipients(new.org_id, new.imprest_float_id,  -- 0424
                                      new.imprest_month, new.claimant_id) x                -- 0424
      loop                                                                                  -- 0424
        perform public.notify_workflow_user(new.org_id, r.id, 'Out-of-plan site cash item awaiting your approval',  -- 0424
          new.title, 'warning', 'expense_claim', new.id, v_label);                          -- 0424
      end loop;                                                                             -- 0424
    end if;                                                                                 -- 0424
  elsif old.status = 'Submitted' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was approved',
      coalesce(nullif(btrim(new.approval_notes), ''), new.title), 'info', 'expense_claim', new.id, v_label);
    if new.imprest_float_id is not null then                                                -- 0424 FR-IMP-024: this
      -- approval may push a waiting item on the line out of plan; alert only those that just crossed.  -- 0424
      -- ponytail: the approved amount stands in for its draw (an advance's outstanding equals it at approval).  -- 0424
      v_left := coalesce((select l.planned_amount from public.imprest_plans p                -- 0424
                            join public.imprest_plan_lines l on l.plan_id = p.id              -- 0424
                           where p.float_id = new.imprest_float_id and p.month = new.imprest_month  -- 0424
                             and p.status = 'Approved' and l.budget_category = new.budget_category), 0)  -- 0424
                - public.imprest_drawn(new.imprest_float_id, new.imprest_month, new.budget_category);  -- 0424
      for r in select c.id as claim_id, c.title, coalesce(c.claim_number, c.title) as label, x as id  -- 0424
                 from public.expense_claims c                                                -- 0424
                 cross join lateral public.imprest_exception_recipients(c.org_id, c.imprest_float_id,  -- 0424
                                      c.imprest_month, c.claimant_id) x                      -- 0424
                where c.imprest_float_id = new.imprest_float_id and c.imprest_month = new.imprest_month  -- 0424
                  and c.budget_category = new.budget_category and c.status = 'Submitted' and c.id <> new.id  -- 0424
                  and c.amount > greatest(v_left, 0) and c.amount <= v_left + new.amount     -- 0424
      loop                                                                                  -- 0424
        perform public.notify_workflow_user(new.org_id, r.id, 'Out-of-plan site cash item awaiting your approval',  -- 0424
          r.title, 'warning', 'expense_claim', r.claim_id, r.label);                        -- 0424
      end loop;                                                                             -- 0424
    end if;                                                                                 -- 0424
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and ((new.imprest_float_id is null and p.role = 'Finance')                   -- 0424 PQ-10
                     or p.id = (select f.custodian_id from public.imprest_floats f where f.id = new.imprest_float_id))  -- 0424
                and p.id is distinct from new.claimant_id and p.id is distinct from new.approved_by_id
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' ready to pay',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was rejected',
      coalesce(nullif(btrim(new.rejection_notes), ''), new.title), 'warning', 'expense_claim', new.id, v_label);
  elsif old.status = 'Approved' and new.status = 'Paid' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was paid',
      new.title, 'info', 'expense_claim', new.id, v_label);
  end if;
  return new;
end; $$;
revoke execute on function public.notify_expense_claim_transition() from public, anon, authenticated;

-- §5 closing self-assertion (0423 §7 style): fail the migration if the ACL shape is wrong.
do $$
declare v text;
begin
  foreach v in array array['public.record_imprest_count(uuid, numeric, text)', 'public.get_imprest_position(uuid)',
    'public.get_imprest_plan_usage(uuid, date)', 'public.imprest_float_choices(uuid, public.budget_category)'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or not has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0424: % ACL is not the intended shape', v;
    end if;
  end loop;
  foreach v in array array['public.refuse_imprest_count_change()', 'public.notify_imprest_plan_transition()',
    'public.notify_imprest_replenishment()', 'public.notify_expense_claim_transition()',
    'public.imprest_exception_recipients(uuid, uuid, date, uuid)'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0424: internal % is client-executable', v;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.imprest_cash_counts', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('anon', 'public.imprest_cash_counts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role', 'public.imprest_cash_counts', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '0424: imprest_cash_counts is client-writable';
  end if;
end $$;
