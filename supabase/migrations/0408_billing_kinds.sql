-- 0408_billing_kinds.sql - #1471: contract billing vs other billing on a project invoice (spec billing-kinds.spec.md).
-- Rollback: migrations/rollback/0408_billing_kinds_down.sql.

-- §1 storage. A text CHECK, not an enum type: an enum value cannot be dropped on rollback.
alter table public.sales_invoices
  add column billing_kind text not null default 'contract',
  add constraint sales_invoices_billing_kind_check check (billing_kind in ('contract','other'));
comment on column public.sales_invoices.billing_kind is
  '#1471 FR-001: PMO project attribution kind. contract = draws down the contract value; other = counts toward revenue and margin only. PMO metadata, never sent to the ERP. Written only by assign_sales_invoice_project / set_sales_invoice_billing_kind / create_native_sales_invoice / the mirror writer create branch.';

-- §2 history: classified once (catalog gate record_changes_catalog_gate.test.sql fails on an unclassified column).
update public.record_history_config
   set captured = captured || '{"billing_kind":"enum"}'::jsonb
 where entity_type = 'sales_invoice';

-- §3 mirror guard: 0290 body verbatim + one pin. Only the definer RPCs (current_user = postgres) may change the kind
-- while ERP owns revenue, mirroring how 0290 treats project_id.
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
     or (new.billing_kind is distinct from old.billing_kind and current_user <> 'postgres') -- 0408 (#1471): only the definer RPCs change it
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- §4 assignment carries the kind. Dropped + recreated: a create-or-replace with a new argument list would leave the old
-- overload callable and ambiguous for PostgREST. Two-argument callers keep working through the default.
drop function public.assign_sales_invoice_project(uuid,uuid);
create function public.assign_sales_invoice_project(p_si_id uuid,p_project_id uuid,p_billing_kind text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_si public.sales_invoices; v_role public.user_role := public.auth_role(); v_kind text;
begin
  perform public.assert_is_active_member();
  -- PFIN_ASSIGN_ROLE_CHECK: mutation target; keep this exact marker and predicate.
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_billing_kind is not null and p_billing_kind not in ('contract','other') then
    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
  end if;
  select * into v_si from public.sales_invoices where id = p_si_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_si.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.org_id = v_si.org_id
  ) then raise exception 'project not found' using errcode = 'P0002'; end if;
  if v_si.pmo_native or v_si.si_number is null or v_si.author_user_id is not null
     or exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_si_id)
     or not exists (select 1 from public.external_refs r where r.org_id = v_si.org_id
                    and r.domain = 'revenue' and r.pmo_record_id = p_si_id::text
                    and r.external_record_id = v_si.si_number) then
    raise exception 'only an adopted ERP invoice can be attributed here' using errcode = '23514';
  end if;
  if (v_si.work_order_id is not null and not exists (
        select 1 from public.work_orders w where w.id = v_si.work_order_id
          and w.org_id = v_si.org_id and w.project_id = p_project_id))
     or exists (select 1 from public.progress_claims c where c.id = p_si_id
                and (c.org_id is distinct from v_si.org_id or c.project_id is distinct from p_project_id)) then
    raise exception 'project conflicts with the invoice billing context' using errcode = '23514';
  end if;
  v_kind := coalesce(p_billing_kind, v_si.billing_kind);   -- Q1: omitted keeps the stored kind (contract for never-classified rows)
  if v_si.project_id is not distinct from p_project_id and v_kind = v_si.billing_kind then return; end if;
  update public.sales_invoices set project_id = p_project_id, billing_kind = v_kind where id = p_si_id;
end $$;
alter function public.assign_sales_invoice_project(uuid,uuid,text) owner to postgres;
revoke all on function public.assign_sales_invoice_project(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.assign_sales_invoice_project(uuid,uuid,text) to authenticated;

-- §5 kind-only correction: any already-linked invoice (native, adopted, authored, paid). Changes ONE column; never
-- touches the outbox, the body, receipts, authorship or approval. Admin/Finance, active member, caller's org.
create function public.set_sales_invoice_billing_kind(p_si_id uuid, p_billing_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_si public.sales_invoices; v_role public.user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  -- BKIND_ROLE_CHECK: mutation target; keep this exact marker and predicate.
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_billing_kind is null or p_billing_kind not in ('contract','other') then
    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
  end if;
  -- org filter in the SELECT: a foreign or missing invoice is the same P0002 (no existence signal).
  select * into v_si from public.sales_invoices where id = p_si_id and org_id = public.auth_org_id() for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_si.project_id is null then
    raise exception 'attribute a project to the invoice before choosing its billing kind'
      using errcode = '23514', detail = 'billing-kind-needs-project';
  end if;
  if v_si.billing_kind = p_billing_kind then return; end if;   -- identical save: no write, no history event
  update public.sales_invoices set billing_kind = p_billing_kind where id = p_si_id;
end $$;
alter function public.set_sales_invoice_billing_kind(uuid,text) owner to postgres;
revoke all on function public.set_sales_invoice_billing_kind(uuid,text) from public,anon,authenticated;
grant execute on function public.set_sales_invoice_billing_kind(uuid,text) to authenticated;
comment on function public.set_sales_invoice_billing_kind(uuid,text) is
  '#1471 FR-004: PMO-only billing-kind correction of an already-linked sales invoice. Admin/Finance; no ERP command.';

-- §6 native creation carries the kind in the same INSERT. Dropped + recreated (new default parameter; see §4).
drop function public.create_native_sales_invoice(uuid,uuid,jsonb,uuid);
create function public.create_native_sales_invoice(
  p_project_id    uuid,
  p_customer_id   uuid,
  p_lines         jsonb,
  p_work_order_id uuid default null,
  p_billing_kind  text default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid      := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_uid         uuid      := auth.uid();
  v_valid       boolean;
  v_lines       jsonb;
  v_amount      numeric;
  v_p_org       uuid;
  v_currency    text;
  v_vat         boolean;
  v_rate        numeric;
  v_num         integer;
  v_den         integer;
  v_contract    text;
  v_wo_org      uuid;
  v_wo_currency text;
  v_wo_po       text;
  v_id          uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can raise a customer invoice' using errcode = '42501';
  end if;
  if p_billing_kind is not null and p_billing_kind not in ('contract','other') then
    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
  end if;
  -- Serialise with an ERP take-over of revenue (§7) BEFORE reading who owns it.
  perform 1 from public.organizations o where o.id = v_org for share;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'an invoice needs between 1 and 100 lines' using errcode = '23514', detail = 'invoice-lines-count';
  end if;
  -- CASE, not a bare cast: a non-number qty/rate becomes NULL (refused below), never a cast error or a coercion.
  with lines as (
    select x.ord,
           nullif(btrim(x.l ->> 'item_code'), '')   as item_code,
           nullif(btrim(x.l ->> 'description'), '') as description,
           case when jsonb_typeof(x.l -> 'qty')  = 'number' then (x.l ->> 'qty')::numeric  end as qty,
           case when jsonb_typeof(x.l -> 'rate') = 'number' then (x.l ->> 'rate')::numeric end as rate
      from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
  )
  select bool_and((item_code is not null or description is not null)
                  and coalesce(length(item_code), 0) <= 140 and coalesce(length(description), 0) <= 140
                  and coalesce(qty > 0 and qty < 'Infinity'::numeric and qty = round(qty, 3), false)
                  and coalesce(rate >= 0 and rate < 'Infinity'::numeric and rate = round(rate, 2), false)),
         jsonb_agg(jsonb_build_object('item_code', item_code, 'description', description, 'qty', qty, 'rate', rate,
                                      'amount', round(qty * rate, 2)) order by ord),
         sum(round(qty * rate, 2))
    into v_valid, v_lines, v_amount
    from lines;
  if not coalesce(v_valid, false) then
    raise exception 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals'
      using errcode = '23514', detail = 'invoice-line-invalid';
  end if;
  if not coalesce(v_amount > 0 and v_amount < 1000000000000, false) then
    raise exception 'the invoice total must be above zero' using errcode = '23514', detail = 'invoice-total-invalid';
  end if;

  -- DD-BWO-5: the work order's billing lock BEFORE the project row lock — the order every billing writer uses.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency, p.subject_to_vat, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
         p.customer_contract_ref
    into v_p_org, v_currency, v_vat, v_rate, v_num, v_den, v_contract
    from public.projects p where p.id = p_project_id for share;
  if not found or v_p_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_customer_id and c.org_id = v_org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_work_order_id is not null then
    select wo.org_id, wo.currency, wo.client_po_number into v_wo_org, v_wo_currency, v_wo_po
      from public.work_orders wo where wo.id = p_work_order_id;
    if not found or v_wo_org is distinct from v_org then
      raise exception 'work order not found' using errcode = 'P0002';
    end if;
    v_currency := v_wo_currency;
  end if;

  -- OD-TAX-4 / DD-NAR-7: the project says whether it is subject to VAT; its own rate and base apply.
  if v_vat then
    if v_rate is null or v_rate <= 0 then
      raise exception 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing'
        using errcode = 'P0001', detail = 'vat-rate-missing';
    end if;
  else
    v_rate := 0; v_num := 1; v_den := 1;
  end if;

  -- tax_amount 0 is a placeholder the 0227 trigger (sales_invoices_zz_apply_tax_base) replaces from tax_rate on insert.
  insert into public.sales_invoices
    (id, org_id, project_id, customer_id, work_order_id, reference_number, native_lines, amount, currency,
     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id,
     billing_kind)
  values
    (v_id, v_org, p_project_id, p_customer_id, p_work_order_id,
     coalesce(nullif(btrim(v_wo_po), ''), nullif(btrim(v_contract), '')),
     v_lines, v_amount, v_currency,
     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid,
     coalesce(p_billing_kind, 'contract'));

  -- 0132's SoD oracle: nobody in this set may approve the invoice (§4).
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values (v_org, v_id, v_uid);
  return v_id;
end; $$;
revoke all on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid, text) to authenticated;
comment on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid, text) is
  '#784 FR-NAR-001..004: raises a PMO customer invoice as a Draft while no ERP owns revenue. Admin/Finance only; tax from the project; the caller is recorded as author.';

-- §6b assert the result on the database itself (hosted Supabase grants EXECUTE on new functions by default).
do $$
declare v_bad text;
begin
  select string_agg(sig, ', ') into v_bad
    from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid,text)'),
                 ('public.set_sales_invoice_billing_kind(uuid,text)'),
                 ('public.assign_sales_invoice_project(uuid,uuid,text)')) f(sig)
   where has_function_privilege('anon', sig, 'execute')
      or not has_function_privilege('authenticated', sig, 'execute')
      or not (select p.prosecdef from pg_proc p where p.oid = sig::regprocedure);
  if v_bad is not null then
    raise exception '0408 §6b: billing-kind writer grants or SECURITY DEFINER drifted: %', v_bad;
  end if;
end $$;
