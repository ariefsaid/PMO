-- 0360 procurement flexible entry — foundation (spec docs/specs/procurement-flexible-entry.spec.md; ADR-0093).
-- Rollback: supabase/migrations/rollback/0360_procurement_flexible_foundation_down.sql
-- No begin/commit: the rollback pgTAP wraps this file in its own transaction.

-- §1 The purchase mirror also carries receipts and supplier payments, and the pre-tax total (FR-PFE-040).
alter table public.erp_purchase_documents drop constraint erp_purchase_documents_erp_doctype_check;
alter table public.erp_purchase_documents add constraint erp_purchase_documents_erp_doctype_check
  check (erp_doctype in ('Purchase Order','Purchase Receipt','Purchase Invoice','Payment Entry'));
alter table public.erp_purchase_documents add column net_total numeric(18,2);

-- 0335's upsert, plus net_total (the only change).
create or replace function public.upsert_erp_purchase_documents(p_org_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_written integer;
begin
  insert into public.erp_purchase_documents as d (
    org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
    grand_total, net_total, outstanding_amount, erp_status, erp_docstatus, is_return, erp_project, erp_modified)
  select p_org_id, r.erp_doctype, r.erp_name, r.supplier, r.supplier_name, r.doc_date, r.due_date, r.bill_no,
         r.currency, r.grand_total, r.net_total, r.outstanding_amount, r.erp_status, r.erp_docstatus,
         coalesce(r.is_return, false), r.erp_project, r.erp_modified
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      erp_doctype text, erp_name text, supplier text, supplier_name text, doc_date date, due_date date,
      bill_no text, currency text, grand_total numeric, net_total numeric, outstanding_amount numeric, erp_status text,
      erp_docstatus smallint, is_return boolean, erp_project text, erp_modified text)
  on conflict (org_id, erp_doctype, erp_name) do update set
    supplier = excluded.supplier, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date,
    due_date = excluded.due_date, bill_no = excluded.bill_no, currency = excluded.currency,
    grand_total = excluded.grand_total, net_total = excluded.net_total, outstanding_amount = excluded.outstanding_amount,
    erp_status = excluded.erp_status, erp_docstatus = excluded.erp_docstatus, is_return = excluded.is_return,
    erp_project = excluded.erp_project, erp_modified = excluded.erp_modified, updated_at = now()
  where excluded.erp_modified > d.erp_modified;
  get diagnostics v_written = row_count;

  with map as (
    select m.value as erp_name, min(m.key)::uuid as project_id
      from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) m
     where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
       and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
     group by m.value having count(*) = 1
  ), names as (
    select d.id, d.erp_project as erp_name from public.erp_purchase_documents d
     where d.org_id = p_org_id and d.erp_project is not null
    union
    select d.id, g.project from public.erp_purchase_documents d
      join public.erp_gl_entry_mirror g
        on g.org_id = d.org_id and g.voucher_type = d.erp_doctype and g.voucher_no = d.erp_name
     where d.org_id = p_org_id and d.erp_doctype = 'Purchase Invoice'
       and g.project is not null and not g.is_cancelled
  ), stamped as (
    select d.id,
           coalesce(array_agg(distinct p.id order by p.id) filter (where p.id is not null), '{}') as project_ids,
           exists (select 1 from public.external_refs x
                    where x.org_id = p_org_id and x.domain = 'procurement' and x.external_tier = 'erpnext'
                      and x.external_record_id = d.erp_name) as pmo_owned
      from public.erp_purchase_documents d
      left join names n on n.id = d.id
      left join map on map.erp_name = n.erp_name
      left join public.projects p on p.id = map.project_id and p.org_id = p_org_id
     where d.org_id = p_org_id
     group by d.id, d.erp_name
  )
  update public.erp_purchase_documents d
     set project_ids = s.project_ids, pmo_owned = s.pmo_owned
    from stamped s
   where d.id = s.id and (d.project_ids is distinct from s.project_ids or d.pmo_owned is distinct from s.pmo_owned);

  return v_written;
end $$;
revoke all on function public.upsert_erp_purchase_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_erp_purchase_documents(uuid, jsonb) to service_role;

-- §2 The link: an ERP document belongs to at most one purchase (FR-PFE-021). Written only by 0361's RPCs.
create table public.procurement_erp_links (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  procurement_id           uuid not null references public.procurements(id) on delete cascade,
  erp_purchase_document_id uuid not null references public.erp_purchase_documents(id) on delete restrict,
  linked_by                uuid references public.profiles(id),
  linked_at                timestamptz not null default now(),
  constraint procurement_erp_links_one_purchase unique (erp_purchase_document_id)
);
create index procurement_erp_links_procurement_idx on public.procurement_erp_links (procurement_id);

-- Defence in depth (the RPC already checks): purchase, document and link are one org.
create function public.guard_procurement_erp_link_org() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.procurements p where p.id = new.procurement_id and p.org_id = new.org_id)
     or not exists (select 1 from public.erp_purchase_documents d where d.id = new.erp_purchase_document_id and d.org_id = new.org_id) then
    raise exception 'An ERP document can be linked only to a purchase of its own organization.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_erp_link_org() from public, anon, authenticated;
create trigger procurement_erp_links_org_guard before insert or update on public.procurement_erp_links
  for each row execute function public.guard_procurement_erp_link_org();

alter table public.procurement_erp_links enable row level security;
alter table public.procurement_erp_links force row level security;
create policy procurement_erp_links_select on public.procurement_erp_links for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.procurement_erp_links from anon, authenticated;
grant select on public.procurement_erp_links to authenticated;

-- §3 Read models (FR-PFE-041/043). security_invoker: the caller's RLS on both tables applies.
create view public.erp_purchase_documents_linked with (security_invoker = true) as
  select d.id, d.org_id, d.erp_doctype, d.erp_name, d.supplier, d.supplier_name, d.doc_date, d.due_date, d.bill_no,
         d.currency, d.grand_total, d.net_total, d.outstanding_amount, d.erp_status, d.erp_docstatus, d.is_return,
         d.erp_project, d.project_ids, d.pmo_owned, l.id as link_id, l.procurement_id, l.linked_at
    from public.erp_purchase_documents d
    left join public.procurement_erp_links l on l.erp_purchase_document_id = d.id;
create view public.erp_purchase_orphans with (security_invoker = true) as
  select id, org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
         grand_total, net_total, outstanding_amount, erp_status, is_return, erp_project, project_ids
    from public.erp_purchase_documents_linked
   where erp_docstatus = 1 and not pmo_owned and procurement_id is null;
revoke all on public.erp_purchase_documents_linked, public.erp_purchase_orphans from anon;
grant select on public.erp_purchase_documents_linked, public.erp_purchase_orphans to authenticated;

-- §4 Gates: org settings, default OFF (FR-PFE-010..013).
alter table public.organizations add column procurement_gates jsonb not null default '{}'::jsonb
  constraint organizations_procurement_gates_object check (jsonb_typeof(procurement_gates) = 'object');
comment on column public.organizations.procurement_gates is
  'FR-PFE-011 purchase rules (request_before_order, approval_before_order, approval_before_payment, receipt_before_invoice); absent or non-boolean = OFF. Written only by set_procurement_gates().';

create function public.procurement_gate(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((
    select case when jsonb_typeof(o.procurement_gates -> p_key) = 'boolean'
                then (o.procurement_gates ->> p_key)::boolean else false end
      from public.organizations o
     where o.id = p_org and (auth.uid() is null or p_org = public.auth_org_id())), false)
$$;
revoke all on function public.procurement_gate(uuid, text) from public, anon;
grant execute on function public.procurement_gate(uuid, text) to authenticated, service_role;

create function public.procurement_gate_message(p_code text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select case p_code
    when 'gate_request_before_order'    then 'Your organization requires a purchase request before an order.'
    when 'gate_approval_before_order'   then 'Your organization requires an approval before an order.'
    when 'gate_receipt_before_invoice'  then 'Your organization requires a goods receipt before a vendor invoice.'
    when 'gate_approval_before_payment' then 'Your organization requires an approval before payment.'
    else p_code end
$$;
grant execute on function public.procurement_gate_message(text) to authenticated, service_role;

create function public.get_procurement_gates() returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'request_before_order',    public.procurement_gate(public.auth_org_id(), 'request_before_order'),
    'approval_before_order',   public.procurement_gate(public.auth_org_id(), 'approval_before_order'),
    'approval_before_payment', public.procurement_gate(public.auth_org_id(), 'approval_before_payment'),
    'receipt_before_invoice',  public.procurement_gate(public.auth_org_id(), 'receipt_before_invoice'))
  where public.is_active_member()
$$;
revoke all on function public.get_procurement_gates() from public, anon;
grant execute on function public.get_procurement_gates() to authenticated;

create function public.set_procurement_gates(p_gates jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_old jsonb; v_new jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change purchase rules.' using errcode = '42501';
  end if;
  if p_gates is null or jsonb_typeof(p_gates) <> 'object' or exists (
       select 1 from jsonb_each(p_gates) e
        where e.key not in ('request_before_order','approval_before_order','approval_before_payment','receipt_before_invoice')
           or jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'Purchase rules are the four known switches, each true or false.' using errcode = '22023';
  end if;
  select procurement_gates into v_old from public.organizations where id = v_org for update;
  v_new := coalesce(v_old, '{}'::jsonb) || p_gates;
  update public.organizations set procurement_gates = v_new where id = v_org;
  perform public.log_audit('organization.procurement_gates', v_org, auth.uid(), v_org,
    jsonb_build_object('from', v_old, 'to', v_new));
  return public.get_procurement_gates();
end $$;
revoke all on function public.set_procurement_gates(jsonb) from public, anon;
grant execute on function public.set_procurement_gates(jsonb) to authenticated;

-- §5 Step model (FR-PFE-002/003/007).
create function public.procurement_step_rank(p_status public.procurement_status) returns integer
language sql immutable set search_path = public, pg_catalog as $$
  select case p_status::text
    when 'Draft' then 0 when 'Rejected' then 0 when 'Requested' then 1 when 'Approved' then 2
    when 'Vendor Quoted' then 3 when 'Quote Selected' then 4 when 'Ordered' then 5
    when 'Received' then 6 when 'Vendor Invoiced' then 7 when 'Paid' then 8 else -1 end
$$;
grant execute on function public.procurement_step_rank(public.procurement_status) to authenticated, service_role;

-- Furthest document-evidenced step: a PMO record or a linked, submitted ERP document.
create function public.procurement_evidenced_step(p_procurement_id uuid) returns public.procurement_status
language sql stable security definer set search_path = public, pg_catalog as $$
  with linked as (
    select d.erp_doctype from public.procurement_erp_links l
      join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1)
  select case
    when exists (select 1 from public.payments pay where pay.procurement_id = p_procurement_id and pay.status = 'Paid'
                   and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null)
      or exists (select 1 from linked where erp_doctype = 'Payment Entry') then 'Paid'::public.procurement_status
    when exists (select 1 from public.procurement_invoices i where i.procurement_id = p_procurement_id
                   and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null)
      or exists (select 1 from linked where erp_doctype = 'Purchase Invoice') then 'Vendor Invoiced'::public.procurement_status
    when exists (select 1 from public.procurement_receipts r where r.procurement_id = p_procurement_id)
      or exists (select 1 from linked where erp_doctype = 'Purchase Receipt') then 'Received'::public.procurement_status
    when exists (select 1 from public.purchase_orders po where po.procurement_id = p_procurement_id)
      or exists (select 1 from linked where erp_doctype = 'Purchase Order') then 'Ordered'::public.procurement_status
    else null end
$$;
revoke all on function public.procurement_evidenced_step(uuid) from public, anon, authenticated;
grant execute on function public.procurement_evidenced_step(uuid) to service_role;

-- Which gate (if any) refuses moving this purchase to p_step (FR-PFE-010). Null = allowed.
create function public.procurement_gate_violation(p_procurement_id uuid, p_step public.procurement_status)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  if public.procurement_step_rank(p_step) >= 5 then
    if public.procurement_gate(v_row.org_id, 'request_before_order')
       and v_row.pr_number is null and public.procurement_step_rank(v_row.status) < 1
       and not exists (select 1 from public.purchase_requests r where r.procurement_id = v_row.id) then
      return 'gate_request_before_order';
    end if;
    if public.procurement_gate(v_row.org_id, 'approval_before_order') and v_row.approved_by_id is null then
      return 'gate_approval_before_order';
    end if;
  end if;
  if public.procurement_step_rank(p_step) >= 7
     and public.procurement_gate(v_row.org_id, 'receipt_before_invoice')
     and public.procurement_step_rank(v_row.status) < 6
     and not exists (select 1 from public.procurement_receipts r where r.procurement_id = v_row.id)
     and not exists (select 1 from public.procurement_erp_links l
                       join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                      where l.procurement_id = v_row.id and d.erp_doctype = 'Purchase Receipt' and d.erp_docstatus = 1) then
    return 'gate_receipt_before_invoice';
  end if;
  if p_step = 'Paid' and public.procurement_gate(v_row.org_id, 'approval_before_payment') and v_row.approved_by_id is null then
    return 'gate_approval_before_payment';
  end if;
  return null;
end $$;
revoke all on function public.procurement_gate_violation(uuid, public.procurement_status) from public, anon;
grant execute on function public.procurement_gate_violation(uuid, public.procurement_status) to authenticated, service_role;

-- Move a purchase forward to its furthest evidence; never backwards; never out of Cancelled/Rejected.
-- The status update runs the 0349/0362 guard (SoD, ceiling, approval gate). Returns the resulting status.
create function public.advance_procurement_status(p_procurement_id uuid, p_note text)
returns public.procurement_status language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_from public.procurement_status; v_org uuid; v_to public.procurement_status;
begin
  select status, org_id into v_from, v_org from public.procurements where id = p_procurement_id for update;
  if not found or v_from::text in ('Cancelled','Rejected') then return v_from; end if;
  v_to := public.procurement_evidenced_step(p_procurement_id);
  if v_to is null or public.procurement_step_rank(v_to) <= public.procurement_step_rank(v_from) then
    return v_from;
  end if;
  update public.procurements
     set status = v_to,
         vendor_invoiced_at = case when v_to::text in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,
         updated_at = now()
   where id = p_procurement_id;
  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_procurement_id, v_org, v_from, v_to, auth.uid(), p_note);
  return v_to;
end $$;
revoke all on function public.advance_procurement_status(uuid, text) from public, anon, authenticated;
grant execute on function public.advance_procurement_status(uuid, text) to service_role;
