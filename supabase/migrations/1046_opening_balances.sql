-- 1046_opening_balances.sql — #2588: opening balances at go-live (running work-order progress and counted stock).
-- Spec docs/specs/opening-balances.spec.md (FR-OPB-001..009). Reversal: rollback/1046_opening_balances_down.sql.
-- ⚑ Counted once, by construction:
--   certified  → a Confirmed acceptance with confirm_basis 'opening'. Acceptances are cumulative snapshots, so the next real
--                acceptance supersedes it in every "latest confirmed" reader;
--   claimed    → opening_balance_lines.claimed_quantity, read by the three billing readers redefined in §6. It is never a
--                progress claim or an invoice, so no ERP command can be minted from it;
--   stock      → a stock document of kind 'opening' written through the single ledger writer (stock_write_entry).
-- `-- mut:<id>` marks the line a mutation check breaks (supabase/tests/opening_balances.test.sql must go red).

-- §1 records ------------------------------------------------------------------------------------------------------
create table public.opening_balances (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  kind              text not null check (kind in ('work_order', 'stock')),
  as_of             date not null,
  work_order_id     uuid references public.work_orders(id),
  acceptance_id     uuid references public.work_order_acceptances(id) on delete set null,
  warehouse_id      uuid references public.stock_warehouses(id),
  stock_document_id uuid references public.stock_documents(id),
  currency          text,
  claimed_amount    numeric(14,2) not null default 0 check (claimed_amount >= 0 and claimed_amount < 'Infinity'::numeric),
  note              text check (note is null or length(note) <= 500),
  loaded_by         uuid not null references public.profiles(id),
  loaded_at         timestamptz not null default now(),
  reversed_by       uuid references public.profiles(id),
  reversed_at       timestamptz,
  constraint opening_balances_shape check (
    (kind = 'work_order' and work_order_id is not null and currency is not null and warehouse_id is null and stock_document_id is null)
    or (kind = 'stock' and warehouse_id is not null and stock_document_id is not null and work_order_id is null and claimed_amount = 0)),
  constraint opening_balances_reversed_pair check ((reversed_by is null) = (reversed_at is null))
);
create unique index opening_balances_live_work_order on public.opening_balances (work_order_id) where reversed_at is null and kind = 'work_order';
create unique index opening_balances_live_warehouse on public.opening_balances (warehouse_id) where reversed_at is null and kind = 'stock';
create index opening_balances_org_idx on public.opening_balances (org_id, as_of);
create index opening_balances_acceptance_idx on public.opening_balances (acceptance_id) where acceptance_id is not null;
create index opening_balances_stock_document_idx on public.opening_balances (stock_document_id) where stock_document_id is not null;

create table public.opening_balance_lines (
  opening_id         uuid not null references public.opening_balances(id),
  org_id             uuid not null references public.organizations(id),
  boq_item_id        uuid not null references public.boq_items(id),
  certified_quantity numeric(14,3) not null check (certified_quantity >= 0 and certified_quantity < 'Infinity'::numeric),
  claimed_quantity   numeric(14,3) not null check (claimed_quantity >= 0 and claimed_quantity < 'Infinity'::numeric),
  claimed_amount     numeric(14,2) not null check (claimed_amount >= 0 and claimed_amount < 'Infinity'::numeric),
  primary key (opening_id, boq_item_id)
);
create index opening_balance_lines_boq_idx on public.opening_balance_lines (boq_item_id);
create index opening_balance_lines_org_idx on public.opening_balance_lines (org_id);

-- Written only by the definer RPCs below. Read like claims (0350): active members of the org, never Engineers.
alter table public.opening_balances enable row level security;      alter table public.opening_balances force row level security;
alter table public.opening_balance_lines enable row level security; alter table public.opening_balance_lines force row level security;
create policy opening_balances_select on public.opening_balances for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance'));
create policy opening_balance_lines_select on public.opening_balance_lines for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance'));
revoke all on public.opening_balances, public.opening_balance_lines from public, anon, authenticated;
grant select on public.opening_balances, public.opening_balance_lines to authenticated;

-- §2 the opening acceptance -----------------------------------------------------------------------------------------
alter table public.work_order_acceptances drop constraint work_order_acceptances_confirm_basis_check;
alter table public.work_order_acceptances add constraint work_order_acceptances_confirm_basis_check
  check (confirm_basis in ('standard', 'sole_operator', 'opening'));

-- 0337 bodies, plus: the reversal RPC (and only it, via the transaction-local flag) may delete an opening acceptance.
create or replace function public.guard_work_order_acceptance_immutable() returns trigger
 language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' then
   if old.confirm_basis='opening' and coalesce(current_setting('pmo.reverse_opening',true),'')='on' then return old; end if;
   if old.status='Confirmed' or old.status='Withdrawn' then raise exception 'acceptance is immutable' using errcode='42501'; end if;
   raise exception 'acceptances are managed by their RPC' using errcode='42501';
 end if;
 if old.status<>'Draft' or (new.id,new.org_id,new.project_id,new.work_order_id) is distinct from (old.id,old.org_id,old.project_id,old.work_order_id) then
   raise exception 'acceptance is immutable' using errcode='42501';
 end if;
 return new;
end; $$;
create or replace function public.guard_work_order_acceptance_line_immutable() returns trigger
 language plpgsql set search_path=public as $$
declare v_status text; v_basis text;
begin
 select status,confirm_basis into v_status,v_basis from public.work_order_acceptances where id=coalesce(new.acceptance_id,old.acceptance_id);
 if tg_op='DELETE' and v_basis='opening' and coalesce(current_setting('pmo.reverse_opening',true),'')='on' then return old; end if;
 if v_status is distinct from 'Draft' or (tg_op='DELETE' and coalesce(current_setting('pmo.replace_work_order_acceptance',true),'')<>'on') then raise exception 'acceptance lines are immutable outside draft replacement' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function public.guard_work_order_acceptance_immutable() from public,anon,authenticated;
revoke all on function public.guard_work_order_acceptance_line_immutable() from public,anon,authenticated;

-- §3 the opening stock kind -----------------------------------------------------------------------------------------
alter table public.stock_documents drop constraint stock_documents_kind_check;
alter table public.stock_documents add constraint stock_documents_kind_check
  check (kind in ('receive','transfer','issue','return','adjustment','count','opening'));
create or replace function public.stock_doc_prefix(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'receive' then 'RCV' when 'transfer' then 'TRF' when 'issue' then 'ISS'
                     when 'return' then 'RTN' when 'adjustment' then 'ADJ' when 'count' then 'CNT' when 'opening' then 'OPN' end $$;
-- The generic RPCs refuse the kind (stock_validate_payload knows only the six movement kinds); load_stock_opening posts it.

-- §4 shared rules -------------------------------------------------------------------------------------------------
-- FR-OPB-001 + FR-OPB-002: an active Admin, one go-live date per organisation, never in the future.
create or replace function public.opening_assert_load(p_org uuid, p_as_of date) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then                                                   -- mut:admin
    raise exception 'only an Admin loads or reverses an opening balance' using errcode = '42501'; end if;
  if p_as_of is null or p_as_of > public.stock_org_today(p_org) then
    raise exception 'the go-live date is required and cannot be in the future' using errcode = '23514'; end if;
  if exists (select 1 from public.opening_balances o where o.org_id = p_org and o.reversed_at is null and o.as_of <> p_as_of) then   -- mut:one_date
    raise exception 'every opening balance is dated at the one go-live date: %', (select min(o.as_of) from public.opening_balances o where o.org_id = p_org and o.reversed_at is null)
      using errcode = '23514'; end if;
end $$;

-- "Real activity" on a work order: any acceptance that is not withdrawn and not the given opening one, any live
-- progress claim, any billing record other than the given opening.
create or replace function public.opening_work_order_has_activity(p_wo uuid, p_opening uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.work_order_acceptances a where a.work_order_id = p_wo and a.status <> 'Withdrawn'
                   and a.id is distinct from (select o.acceptance_id from public.opening_balances o where o.id = p_opening))
      or exists (select 1 from public.progress_claims pc where pc.work_order_id = p_wo and pc.withdrawn_at is null)
      or exists (select 1 from public.work_order_billing_lines l where l.work_order_id = p_wo and l.record_id is distinct from p_opening) $$;

-- §5 the load and reversal RPCs -------------------------------------------------------------------------------------
create or replace function public.load_work_order_opening(p_work_order_id uuid, p_as_of date, p_lines jsonb, p_note text default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_project uuid; v_status public.work_order_status;
        v_currency text; v_id uuid := gen_random_uuid(); v_acc uuid; v_claimed numeric;
begin
  perform public.opening_assert_load(v_org, p_as_of);
  perform public.lock_work_order_billing(p_work_order_id);                    -- the billing writers' order (DD-BWO-5)
  select w.project_id, w.status into v_project, v_status from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org for update;
  if not found then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if v_status <> 'Issued' then                                                                           -- mut:running
    raise exception 'only a running (issued) work order carries an opening balance; a finished one carries none' using errcode = 'P0001'; end if;
  if exists (select 1 from public.opening_balances o where o.work_order_id = p_work_order_id and o.reversed_at is null) then
    raise exception 'this work order already has an opening balance' using errcode = 'P0001'; end if;
  if public.opening_work_order_has_activity(p_work_order_id, null) then                                 -- mut:wo_activity
    raise exception 'an opening balance is loaded before the work order''s first real transaction' using errcode = 'P0001'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'an opening needs 1 to 500 contract lines' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, certified_quantity numeric, claimed_quantity numeric)
              left join public.work_order_lines l on l.work_order_id = p_work_order_id and l.boq_item_id = x.boq_item_id
             where not coalesce(l.quantity is not null
                                and x.certified_quantity >= 0 and x.certified_quantity = round(x.certified_quantity, 3) and x.certified_quantity <= l.quantity
                                and x.claimed_quantity >= 0 and x.claimed_quantity = round(x.claimed_quantity, 3) and x.claimed_quantity <= l.quantity, false)) then
    raise exception 'each line must be allocated to this work order, with certified and claimed quantities from 0 to the allocation (3 decimals at most)' using errcode = '23514'; end if;
  if (select count(*) from jsonb_to_recordset(p_lines) x(boq_item_id uuid)) <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) x(boq_item_id uuid)) then
    raise exception 'each contract line may appear once in an opening' using errcode = '23514'; end if;
  select p.currency into v_currency from public.projects p where p.id = v_project;
  select coalesce(sum(round(x.claimed_quantity * b.rate, 2)), 0) into v_claimed
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, claimed_quantity numeric) join public.boq_items b on b.id = x.boq_item_id;
  perform public.assert_work_order_invoiceable(v_org, p_work_order_id, v_project, v_id::text, v_claimed, v_currency);   -- never past the order value

  if exists (select 1 from jsonb_to_recordset(p_lines) x(certified_quantity numeric) where x.certified_quantity > 0) then
    insert into public.work_order_acceptances (org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, prepared_at,
                                               confirmed_by, confirmed_at, confirm_basis, note)
    values (v_org, v_project, p_work_order_id, p_as_of, false, 'Confirmed', v_uid, now(), v_uid, now(), 'opening', 'Opening balance at go-live')
    returning id into v_acc;
    insert into public.work_order_acceptance_lines (acceptance_id, boq_item_id, quantity)
    select v_acc, x.boq_item_id, x.certified_quantity from jsonb_to_recordset(p_lines) x(boq_item_id uuid, certified_quantity numeric);
  end if;
  insert into public.opening_balances (id, org_id, kind, as_of, work_order_id, acceptance_id, currency, claimed_amount, note, loaded_by)
  values (v_id, v_org, 'work_order', p_as_of, p_work_order_id, v_acc, v_currency, v_claimed, nullif(btrim(p_note), ''), v_uid);
  insert into public.opening_balance_lines (opening_id, org_id, boq_item_id, certified_quantity, claimed_quantity, claimed_amount)
  select v_id, v_org, x.boq_item_id, x.certified_quantity, x.claimed_quantity, round(x.claimed_quantity * b.rate, 2)
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, certified_quantity numeric, claimed_quantity numeric) join public.boq_items b on b.id = x.boq_item_id;
  perform public.log_audit('opening_balance.load', v_org, v_uid, v_id, jsonb_build_object('kind', 'work_order', 'work_order_id', p_work_order_id,
    'as_of', p_as_of, 'acceptance_id', v_acc, 'claimed_amount', v_claimed, 'lines', p_lines));
  return v_id;
end $$;

create or replace function public.load_stock_opening(p_warehouse_id uuid, p_as_of date, p_lines jsonb, p_note text default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_doc public.stock_documents; v_id uuid := gen_random_uuid(); l record;
begin
  perform public.opening_assert_load(v_org, p_as_of);
  perform public.assert_feature_on(v_org, 'stock');
  perform public.stock_assert_standalone(v_org);
  perform 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org for update;   -- serialises two loads of one location
  if not found then raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0002'; end if;
  -- The count shape (item in org, not archived, 0+ with 3 decimals, whole units, cost 0+ with 4 decimals).
  perform public.stock_validate_payload(v_org, 'count', jsonb_build_object('warehouse_id', p_warehouse_id), p_lines);
  if exists (select 1 from jsonb_to_recordset(p_lines) x(item_id uuid, counted_quantity numeric, unit_cost numeric) where x.counted_quantity > 0 and x.unit_cost is null) then
    raise exception 'STK_INVALID: an opening count above 0 needs a unit cost' using errcode = 'P0001'; end if;
  if (select count(*) from jsonb_to_recordset(p_lines) x(item_id uuid)) <> (select count(distinct x.item_id) from jsonb_to_recordset(p_lines) x(item_id uuid)) then
    raise exception 'STK_INVALID: an item appears once per location' using errcode = 'P0001'; end if;
  if exists (select 1 from public.opening_balances o where o.warehouse_id = p_warehouse_id and o.reversed_at is null) then
    raise exception 'this location already has an opening balance' using errcode = 'P0001'; end if;
  if exists (select 1 from public.stock_ledger s where s.warehouse_id = p_warehouse_id) then                  -- mut:stock_activity
    raise exception 'an opening balance is loaded before the location''s first stock movement' using errcode = 'P0001'; end if;

  insert into public.stock_documents (org_id, number, kind, warehouse_id, note, occurred_on, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix('opening')), 'opening', p_warehouse_id,
          coalesce(nullif(btrim(p_note), ''), 'Opening balance at go-live'), p_as_of, v_uid)
  returning * into v_doc;
  insert into public.stock_document_lines (org_id, document_id, line_no, item_id, counted_quantity, unit_cost)
  select v_org, v_doc.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'counted_quantity')::numeric, (t.e->>'unit_cost')::numeric
    from jsonb_array_elements(p_lines) with ordinality t(e, n);
  perform public.stock_lock_for_document(v_doc);
  for l in select * from public.stock_document_lines where document_id = v_doc.id and counted_quantity > 0 order by line_no loop
    perform public.stock_write_entry(v_doc, l.id, l.item_id, p_warehouse_id, l.counted_quantity, round(l.counted_quantity * l.unit_cost, 2), null, null, null);
  end loop;
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = v_doc.id;
  insert into public.opening_balances (id, org_id, kind, as_of, warehouse_id, stock_document_id, note, loaded_by)
  values (v_id, v_org, 'stock', p_as_of, p_warehouse_id, v_doc.id, nullif(btrim(p_note), ''), v_uid);
  perform public.log_audit('opening_balance.load', v_org, v_uid, v_id, jsonb_build_object('kind', 'stock', 'warehouse_id', p_warehouse_id,
    'as_of', p_as_of, 'stock_document_id', v_doc.id, 'number', v_doc.number, 'lines', p_lines));
  return v_id;
end $$;

-- FR-OPB-008: undo an opening while nothing real has happened since.
create or replace function public.reverse_opening_balance(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); o public.opening_balances; v_doc public.stock_documents; l record; v_lines jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin loads or reverses an opening balance' using errcode = '42501'; end if;
  select * into o from public.opening_balances x where x.id = p_id and x.org_id = v_org;
  if not found then raise exception 'opening balance not found' using errcode = 'P0002'; end if;
  if o.kind = 'work_order' then perform public.lock_work_order_billing(o.work_order_id);
  else perform 1 from public.stock_warehouses w where w.id = o.warehouse_id for update; end if;
  select * into o from public.opening_balances x where x.id = p_id for update;
  if o.reversed_at is not null then raise exception 'this opening balance was already reversed' using errcode = 'P0001'; end if;

  if o.kind = 'work_order' then
    if public.opening_work_order_has_activity(o.work_order_id, o.id) then                               -- mut:wo_reverse
      raise exception 'an opening balance can be reversed only before the first real transaction' using errcode = 'P0001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'quantity', x.quantity)), '[]'::jsonb) into v_lines
      from public.work_order_acceptance_lines x where x.acceptance_id = o.acceptance_id;
    perform set_config('pmo.reverse_opening', 'on', true);
    delete from public.work_order_acceptance_lines where acceptance_id = o.acceptance_id;
    delete from public.work_order_acceptances where id = o.acceptance_id and confirm_basis = 'opening';
    perform set_config('pmo.reverse_opening', '', true);
  else
    select * into v_doc from public.stock_documents d where d.id = o.stock_document_id;
    if exists (select 1 from public.stock_ledger s where s.warehouse_id = o.warehouse_id and s.document_id <> o.stock_document_id) then   -- mut:stock_reverse
      raise exception 'an opening balance can be reversed only before the first real transaction' using errcode = 'P0001'; end if;
    perform public.stock_lock_for_document(v_doc);
    v_doc.kind := 'opening_reversal';                                                                    -- the ledger rows' kind, not the document's
    for l in select * from public.stock_document_lines where document_id = o.stock_document_id and counted_quantity > 0 order by line_no loop
      perform public.stock_write_entry(v_doc, l.id, l.item_id, o.warehouse_id, -l.counted_quantity, null, null, null, null);
    end loop;
  end if;
  update public.opening_balances set reversed_by = v_uid, reversed_at = now() where id = o.id;
  perform public.log_audit('opening_balance.reverse', v_org, v_uid, o.id, jsonb_build_object('kind', o.kind, 'work_order_id', o.work_order_id,
    'warehouse_id', o.warehouse_id, 'acceptance_lines', v_lines, 'claimed_amount', o.claimed_amount));
end $$;

-- FR-OPB / AC-OPB-009: what was loaded, per live opening, to reconcile against the source totals.
create or replace function public.opening_balance_report()
  returns table (id uuid, kind text, as_of date, work_order_id uuid, work_order text, warehouse_id uuid, warehouse text,
                 line_count integer, certified_value numeric, claimed_value numeric, stock_quantity numeric, stock_value numeric)
  language plpgsql stable security definer set search_path = public as $$
begin
  -- Definer: the stock value is cost, which clients do not read (0413 D5); so the Admin gate and the org filter are here.
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin reads the opening balance report' using errcode = '42501'; end if;
  return query
  select o.id, o.kind, o.as_of, o.work_order_id, coalesce(w.wo_number, w.title), o.warehouse_id, h.code,
         coalesce(wl.n, sl.n, 0)::int, wl.certified, case when o.kind = 'work_order' then o.claimed_amount end, sl.qty, sl.val
    from public.opening_balances o
    left join public.work_orders w on w.id = o.work_order_id
    left join public.stock_warehouses h on h.id = o.warehouse_id
    left join lateral (select count(*) n, sum(round(x.certified_quantity * b.rate, 2)) certified
                         from public.opening_balance_lines x join public.boq_items b on b.id = x.boq_item_id where x.opening_id = o.id) wl on o.kind = 'work_order'
    left join lateral (select (select count(*) from public.stock_document_lines d where d.document_id = o.stock_document_id) n,
                              coalesce(sum(s.qty_delta), 0) qty, coalesce(sum(s.value_delta), 0) val
                         from public.stock_ledger s where s.document_id = o.stock_document_id and s.kind = 'opening') sl on o.kind = 'stock'
   where o.org_id = public.auth_org_id() and o.reversed_at is null
   order by o.kind, coalesce(w.wo_number, w.title, h.code);
end $$;

revoke all on function public.opening_assert_load(uuid, date), public.opening_work_order_has_activity(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.load_work_order_opening(uuid, date, jsonb, text), public.load_stock_opening(uuid, date, jsonb, text),
  public.reverse_opening_balance(uuid), public.opening_balance_report() from public, anon;
grant execute on function public.load_work_order_opening(uuid, date, jsonb, text), public.load_stock_opening(uuid, date, jsonb, text),
  public.reverse_opening_balance(uuid), public.opening_balance_report() to authenticated;

-- §6 the claimed part in the billing readers ------------------------------------------------------------------------
-- 0262 §2 plus the live openings' claimed value: already invoiced before go-live (submitted), and not a PMO receivable
-- (paid: the accounting books' own opening entry carries what was still owed, OD-XING-1).
create or replace view public.work_order_billing_lines with (security_invoker = true) as
  select w.id as record_id, w.org_id, w.work_order_id, w.currency,
         case when w.is_down_payment then 0::numeric else w.net + w.recovery end as billed,
         (w.status in ('Submitted', 'Unpaid', 'Paid')) as submitted,
         (w.status = 'Paid') as paid
    from public.sales_invoice_work_billed w
   where w.work_order_id is not null and w.status <> 'Cancelled'
  union all
  select pc.id, pc.org_id, pc.work_order_id, pc.currency,
         case when pc.kind = 'down_payment' then 0::numeric else pc.gross_amount end,
         false, false
    from public.progress_claims pc
   where pc.work_order_id is not null and pc.withdrawn_at is null
     and not exists (select 1 from public.sales_invoices si where si.id = pc.id)
  union all
  select ob.id, ob.org_id, ob.work_order_id, ob.currency, ob.claimed_amount::numeric, true, true
    from public.opening_balances ob
   where ob.kind = 'work_order' and ob.reversed_at is null and ob.claimed_amount > 0;                    -- mut:billing_lines

-- 0921 verbatim, plus the live openings' claimed quantities (claimed_line, claimed_alloc) and value (work_billed).
create or replace function public.get_project_billing(p_project_id uuid)
 returns jsonb language sql stable security invoker set search_path=public as $$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
 union all
 select false,ob.claimed_amount,0 from public.opening_balances ob join public.work_orders wo on wo.id=ob.work_order_id join p on p.id=wo.project_id
 where ob.kind='work_order' and ob.reversed_at is null and ob.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), opening_claimed as (
 select ob.work_order_id,x.boq_item_id,x.claimed_quantity claimed from public.opening_balance_lines x join public.opening_balances ob on ob.id=x.opening_id
 join public.work_orders wo on wo.id=ob.work_order_id where wo.project_id=p_project_id and ob.reversed_at is null and x.claimed_quantity>0
), claimed_line as (
 select boq_item_id,sum(claimed) claimed from (
  select l.boq_item_id,l.quantity claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
  union all select boq_item_id,claimed from opening_claimed) u group by boq_item_id
), claimed_alloc as (
 select boq_item_id,work_order_id,sum(claimed) claimed from (
  select l.boq_item_id,c.work_order_id,l.quantity claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id where c.work_order_id is not null
  union all select boq_item_id,work_order_id,claimed from opening_claimed) u group by boq_item_id,work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a where a.project_id=p_project_id and a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.project_id=p_project_id and wo.status<>'Cancelled'
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

-- 1023 verbatim, plus the live openings' claimed quantity and value: measured and billed (claimed and invoiced before go-live).
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
