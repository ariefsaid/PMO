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
