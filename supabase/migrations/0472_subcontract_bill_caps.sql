-- 0472_subcontract_bill_caps.sql — #1513 S3: a subcontract vendor bill states its BoQ line quantities and may not exceed
-- min(verified, PO) per line. The cap lives in ONE function (subcontract_bill_cap_violation, D3).
-- Spec docs/specs/subcontract-acceptance.spec.md (signed 2026-11-01) · Plan docs/plans/2026-11-01-subcontract-acceptance.md S3.
-- Proven by supabase/tests/subcontract_bill_caps.test.sql, subcontract_cap_concurrency.test.sql, subcontract_cap_mutation.test.sql
-- and the 0178 allow-list.
-- ── REVERSE (also rollback/0472_subcontract_bill_caps_down.sql; refused while rows exist, NFR-SCA-007) ──
--   do $$ begin if exists (select 1 from public.procurement_invoice_lines)
--     then raise exception 'rollback refused: subcontract bill lines exist — export and remove them first'; end if; end $$;
--   drop trigger if exists procurement_invoices_zz_subcontract_capture on public.procurement_invoices;
--   drop function if exists public.capture_subcontract_vendor_invoice(uuid, procurement_invoice_status, date, jsonb, text, numeric, text, text, numeric, numeric, text, integer, integer, text, numeric, text);
--   drop function if exists public.subcontract_po_position(uuid);
--   drop function if exists public.subcontract_bill_cap_violation(uuid, jsonb, uuid);
--   drop function if exists public.subcontract_billed(uuid, uuid);
--   drop function if exists public.subcontract_bill_is_live(smallint, timestamptz);
--   drop function if exists public.guard_subcontract_invoice_capture();
--   drop table if exists public.procurement_invoice_lines;   (drops its trigger)
--   drop function if exists public.guard_procurement_invoice_line();

-- §1 Bill lines. Append-only, written only by the capture RPC; org_id is stamped from the invoice, never the client (D6).
create table public.procurement_invoice_lines (
  org_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.procurement_invoices(id),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  amount numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  attributed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (invoice_id, boq_item_id)
);
create index procurement_invoice_lines_boq_idx on public.procurement_invoice_lines (boq_item_id);

create or replace function public.guard_procurement_invoice_line() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'bill lines are immutable' using errcode = '42501';
  end if;
  if coalesce(current_setting('pmo.subcontract_capture', true), '') <> 'on' then
    raise exception 'bill lines are written by the subcontract capture only' using errcode = '42501';
  end if;
  new.org_id := (select i.org_id from public.procurement_invoices i where i.id = new.invoice_id);
  if new.org_id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  return new;
end $$;
revoke all on function public.guard_procurement_invoice_line() from public, anon, authenticated;
create trigger procurement_invoice_lines_guard before insert or update or delete on public.procurement_invoice_lines
  for each row execute function public.guard_procurement_invoice_line();

-- RLS (D6): select only, org + active member, and the parent invoice visible under the caller's own RLS
-- (so the 0350 Engineer exclusion of invoices is inherited, not restated).
alter table public.procurement_invoice_lines enable row level security;
alter table public.procurement_invoice_lines force row level security;
create policy procurement_invoice_lines_read on public.procurement_invoice_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.procurement_invoices i where i.id = invoice_id));
revoke all on public.procurement_invoice_lines from public, anon, authenticated;
grant select on public.procurement_invoice_lines to authenticated;

-- §2 What counts as a live (billable) bill: the shipped "not cancelled" predicate (0373 create_payment), defined ONCE.
-- The cap's billed read and the position read both call it, so the PO screen can never show a payable the cap refuses.
create or replace function public.subcontract_bill_is_live(p_erp_docstatus smallint, p_erp_cancelled_at timestamptz)
  returns boolean language sql immutable security invoker set search_path = public as $$
  select coalesce(p_erp_docstatus, 1) <> 2 and p_erp_cancelled_at is null
$$;
revoke all on function public.subcontract_bill_is_live(smallint, timestamptz) from public, anon;
grant execute on function public.subcontract_bill_is_live(smallint, timestamptz) to authenticated;

-- The billed quantity per line (internal).
create or replace function public.subcontract_billed(p_po_id uuid, p_exclude_invoice uuid)
  returns table (boq_item_id uuid, quantity numeric)
  language sql stable security definer set search_path = public as $$
  select l.boq_item_id, sum(l.quantity)
    from public.procurement_invoice_lines l
    join public.procurement_invoices i on i.id = l.invoice_id
   where i.po_id = p_po_id
     and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at)
     and (p_exclude_invoice is null or i.id <> p_exclude_invoice)
   group by l.boq_item_id
$$;
revoke all on function public.subcontract_billed(uuid, uuid) from public, anon, authenticated;

-- §3 THE CAP (D3). The only place the rule lives: per line, billed_other + requested <= least(verified, po_qty).
-- Validates and sums its own input (a line named twice counts twice). Returns null when allowed, else the reason.
-- Reads as the owner on purpose: the cap must see every confirmed acceptance and bill whatever the caller's RLS shows.
create or replace function public.subcontract_bill_cap_violation(p_po_id uuid, p_lines jsonb, p_exclude_invoice uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rev integer; v_bad record;
begin
  if p_po_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)
                 where x.boq_item_id is null or x.quantity is null or not (x.quantity > 0 and x.quantity < 'Infinity'::numeric)) then
    return jsonb_build_object('reason', 'unreadable_input');                                  -- D3: the cap validates its own input
  end if;
  v_rev := public.po_effective_revision(p_po_id);
  if v_rev is null then return jsonb_build_object('reason', 'no_issued_lines'); end if;
  if not exists (select 1 from public.purchase_order_lines where po_id = p_po_id and revision = v_rev) then
    return jsonb_build_object('reason', 'unreadable_po_lines');
  end if;
  select x.boq_item_id, b.item_code, x.quantity as requested, pl.quantity as po_qty,
         coalesce(v.quantity, 0) as verified, coalesce(bl.quantity, 0) as billed
    into v_bad
    from (select r.boq_item_id, sum(r.quantity) as quantity                                 -- D3: a line named twice counts twice
            from jsonb_to_recordset(p_lines) r(boq_item_id uuid, quantity numeric) group by r.boq_item_id) x
    left join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
    left join public.boq_items b on b.id = x.boq_item_id
      and b.org_id = (select o.org_id from public.purchase_orders o where o.id = p_po_id)   -- never name another org's line
    left join (select * from public.subcontract_verified(p_po_id)) v on v.boq_item_id = x.boq_item_id
    left join (select * from public.subcontract_billed(p_po_id, p_exclude_invoice)) bl on bl.boq_item_id = x.boq_item_id
   where pl.boq_item_id is null
      or coalesce(bl.quantity, 0) + x.quantity > least(coalesce(v.quantity, 0), pl.quantity)
   order by b.item_code nulls first
   limit 1;
  if not found then return null; end if;
  if v_bad.po_qty is null then
    return jsonb_build_object('reason', 'line_not_on_po', 'boq_item_id', v_bad.boq_item_id, 'item_code', v_bad.item_code);
  end if;
  return jsonb_build_object('reason', 'over_cap', 'boq_item_id', v_bad.boq_item_id, 'item_code', v_bad.item_code,
    'verified', v_bad.verified, 'po_qty', v_bad.po_qty, 'billed', v_bad.billed, 'requested', v_bad.requested);
end $$;
revoke all on function public.subcontract_bill_cap_violation(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.subcontract_bill_cap_violation(uuid, jsonb, uuid) to service_role;

-- §4 The capture. Wraps the shipped capture_vendor_invoice (tax, numbering, the case transition, SoD) and adds the lines and the cap.
-- Order (D5): procurements row FOR UPDATE, then the PO advisory lock, then the invoice rows. The caller's authority (membership,
-- org, invoice-capture role) is checked BEFORE the cap is evaluated, so a caller who may not read bill money never gets it
-- back in a refusal message.
create or replace function public.capture_subcontract_vendor_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date, p_lines jsonb,
  p_reference_number text default null, p_amount numeric default null, p_notes text default null,
  p_tax_treatment text default null, p_tax_amount numeric default null, p_tax_rate numeric default null,
  p_tax_template text default null, p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null, p_withheld_amount numeric default 0, p_withheld_pph_type text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_proc public.procurements; v_po uuid; v_rev integer; v_v jsonb; v_net numeric; v_lines_net numeric;
        v_inv public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select * into v_proc from public.procurements where id = p_procurement_id and org_id = public.auth_org_id() for update;
  if not found then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then          -- the invoice-capture roles (create_procurement_invoice)
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select r.po_id into v_po from public.purchase_order_revisions r where r.procurement_id = p_procurement_id and r.revision = 1;
  if not v_proc.is_subcontract or v_po is null then
    raise exception 'this purchase has no issued BoQ lines; capture the bill without lines' using errcode = 'SC002';
  end if;
  if v_proc.status::text in ('Cancelled','Rejected') then                                            -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501';
  end if;
  perform public.subcontract_po_lock(v_po);                                                          -- D5, AC-SCA-007
  v_rev := public.po_effective_revision(v_po);
  v_v := public.subcontract_bill_cap_violation(v_po, p_lines, null);                                 -- D3, NFR-SCA-004: fail closed
  if v_v is not null then
    if v_v->>'reason' = 'over_cap' then
      raise exception 'line % cannot be billed: verified %, PO %, billed %, this bill %',
        v_v->>'item_code', v_v->>'verified', v_v->>'po_qty', v_v->>'billed', v_v->>'requested' using errcode = 'SC001';
    end if;
    if v_v->>'reason' = 'line_not_on_po' then
      raise exception 'line % is not on this purchase order; the bill is refused', coalesce(v_v->>'item_code', v_v->>'boq_item_id')
        using errcode = 'SC001';
    end if;
    raise exception 'the bill cap could not be evaluated (%); the bill is refused', v_v->>'reason' using errcode = 'SC001';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric)
              left join public.purchase_order_lines pl on pl.po_id = v_po and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
              where pl.boq_item_id is null or x.rate is null or x.rate > pl.rate or x.rate <> round(x.rate, 2)
                 or x.quantity is null or x.quantity <= 0 or x.quantity <> round(x.quantity, 3))
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid) group by x.boq_item_id having count(*) > 1) then
    raise exception 'each bill line must be a distinct BoQ line of this PO at no more than the PO rate' using errcode = '23514'; -- FR-SCA-023
  end if;
  select coalesce(sum(round(x.quantity * x.rate, 2)), 0) into v_lines_net
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  v_net := case when btrim(p_tax_treatment) = 'inclusive' then p_amount - p_tax_amount else p_amount end;
  if v_net is distinct from v_lines_net then
    raise exception 'the bill''s pre-tax amount % must equal its lines %', v_net, v_lines_net using errcode = '23514';
  end if;
  perform set_config('pmo.subcontract_capture', 'on', true);
  v_inv := public.capture_vendor_invoice(p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount, p_notes,
    p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator,
    p_external_ref, p_withheld_amount, p_withheld_pph_type);
  update public.procurement_invoices set po_id = v_po where id = v_inv.id;
  insert into public.procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate)
  select v_inv.id, x.boq_item_id, x.quantity, x.rate from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  perform set_config('pmo.subcontract_capture', '', true);
  perform public.log_audit('procurement_invoice.subcontract_lines', v_proc.org_id, auth.uid(), v_inv.id,
    jsonb_build_object('po_id', v_po, 'revision', v_rev, 'lines', (
      select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'quantity', x.quantity, 'rate', x.rate)
                                order by x.boq_item_id), '[]'::jsonb)
        from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric))));   -- normalised, never the raw client JSON
  select * into v_inv from public.procurement_invoices where id = v_inv.id;
  return v_inv;
end $$;
revoke all on function public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) from public, anon;
grant execute on function public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) to authenticated;

-- The capture guard closes every other user path (FR-SCA-020, PQ-4): once a subcontract purchase has lines or an issued
-- revision, a bill without lines is refused. The service-role mirror and seeds (no JWT user) are handled in S5 (OQ-10).
create or replace function public.guard_subcontract_invoice_capture() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('pmo.subcontract_capture', true), '') = 'on' then return new; end if;
  if exists (select 1 from public.procurements p where p.id = new.procurement_id and p.is_subcontract)
     and (exists (select 1 from public.purchase_order_revisions r where r.procurement_id = new.procurement_id)
          or exists (select 1 from public.purchase_order_lines l join public.purchase_orders o on o.id = l.po_id
                      where o.procurement_id = new.procurement_id)) then
    raise exception 'a subcontract bill must state its BoQ line quantities' using errcode = 'SC002';
  end if;
  return new;
end $$;
revoke all on function public.guard_subcontract_invoice_capture() from public, anon, authenticated;
create trigger procurement_invoices_zz_subcontract_capture before insert on public.procurement_invoices
  for each row execute function public.guard_subcontract_invoice_capture();

-- §5 The position read (FR-SCA-050 data, NFR-SCA-005). Invoker: a caller who cannot see the PO gets no rows (never a
-- fabricated 0 line); a caller outside the four invoice-reading roles gets billed / payable as null (rendered "—", not 0).
create or replace function public.subcontract_po_position(p_po_id uuid)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, revision integer,
                 po_qty numeric, verified numeric, billed numeric, payable numeric, verified_not_on_po numeric,
                 verified_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  with rev as (select public.po_effective_revision(p_po_id) as r),
  bl as (select l.boq_item_id, sum(l.quantity) q from public.procurement_invoice_lines l
           join public.procurement_invoices i on i.id = l.invoice_id
          where i.po_id = p_po_id and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at)
          group by l.boq_item_id),
  money as (select public.auth_role() in ('Admin','Executive','Project Manager','Finance') as ok)  -- D6 / 0350 ruling
  select pl.boq_item_id, b.item_code, b.description, pl.unit, pl.rate, pl.revision, pl.quantity,
         coalesce(v.quantity, 0),
         case when money.ok then coalesce(bl.q, 0) end,
         case when money.ok then greatest(least(coalesce(v.quantity, 0), pl.quantity) - coalesce(bl.q, 0), 0) end,
         greatest(coalesce(v.quantity, 0) - pl.quantity, 0),
         v.confirmed_at
    from rev cross join money join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = rev.r
    join public.boq_items b on b.id = pl.boq_item_id
    left join public.subcontract_verified(p_po_id) v on v.boq_item_id = pl.boq_item_id
    left join bl on bl.boq_item_id = pl.boq_item_id
   order by b.line_no nulls last, b.item_code
$$;
revoke all on function public.subcontract_po_position(uuid) from public, anon;
grant execute on function public.subcontract_po_position(uuid) to authenticated;

-- Closing self-assertion: FORCE RLS, no client DML, internals not client-executable, no anon execute.
do $$
begin
  if not (select c.relforcerowsecurity from pg_class c where c.oid = 'public.procurement_invoice_lines'::regclass) then
    raise exception '0472: procurement_invoice_lines lacks FORCE RLS';
  end if;
  if has_table_privilege('authenticated', 'public.procurement_invoice_lines', 'INSERT')
     or has_table_privilege('authenticated', 'public.procurement_invoice_lines', 'UPDATE')
     or has_table_privilege('authenticated', 'public.procurement_invoice_lines', 'DELETE') then
    raise exception '0472: procurement_invoice_lines holds a client DML grant';
  end if;
  if has_function_privilege('authenticated', 'public.subcontract_bill_cap_violation(uuid,jsonb,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.subcontract_billed(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_subcontract_invoice_capture()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_procurement_invoice_line()', 'EXECUTE') then
    raise exception '0472: an internal function is client-executable';
  end if;
  if has_function_privilege('anon', 'public.subcontract_bill_is_live(smallint,timestamptz)', 'EXECUTE') then
    raise exception '0472: the bill-is-live predicate is anon-executable';
  end if;
  if has_function_privilege('anon', 'public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.subcontract_po_position(uuid)', 'EXECUTE') then
    raise exception '0472: a subcontract bill function is anon-executable';
  end if;
end $$;
