-- 0335 — ERP purchases read model (spec: docs/specs/erp-purchases-readonly.spec.md, FR-EPR-001..005).
-- Rollback: rollback/0335_erp_purchase_documents_down.sql
--
-- ERP-native Purchase Orders / Purchase Invoices, mirrored by the erpnext-sweep for VISIBILITY ONLY.
-- DD-XING-2: read, never adopted. Their cost already reaches PMO as Actuals through the GL mirror, so
-- nothing may sum this table into spent / committed / actuals (NFR-EPR-001, pgTAP AC-EPR-006 guards it).
begin;

create table public.erp_purchase_documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                       references public.organizations(id) on delete cascade,
  erp_doctype        text not null check (erp_doctype in ('Purchase Order','Purchase Invoice')),
  erp_name           text not null,
  supplier           text,
  supplier_name      text,
  doc_date           date,              -- PI posting_date / PO transaction_date
  due_date           date,              -- PI due_date / PO schedule_date
  bill_no            text,              -- PI supplier invoice number
  currency           text,
  grand_total        numeric(18,2),
  outstanding_amount numeric(18,2),     -- PI only; ERP's figure (ADR-0048), never recomputed
  erp_status         text,
  erp_docstatus      smallint not null check (erp_docstatus in (1,2)),
  is_return          boolean not null default false,
  erp_project        text,              -- header project as ERP states it
  project_ids        uuid[] not null default '{}',  -- stamped by upsert_erp_purchase_documents (FR-EPR-003)
  pmo_owned          boolean not null default false, -- PMO pushed it; shown as a procurement case instead
  erp_modified       text not null,
  updated_at         timestamptz not null default now(),
  unique (org_id, erp_doctype, erp_name)
);
create index erp_purchase_documents_project_ids_idx on public.erp_purchase_documents using gin (project_ids);
-- The attribution pass joins GL rows by voucher; the GL mirror only had an org index.
create index if not exists erp_gl_entry_mirror_org_voucher_idx
  on public.erp_gl_entry_mirror (org_id, voucher_type, voucher_no);

alter table public.erp_purchase_documents enable row level security;
alter table public.erp_purchase_documents force  row level security;
-- Same audience as the org-wide procurement index (policy.ts `procurement.view`): an Engineer sees only
-- their own requests, so not the org's supplier invoices either. SELECT-only: no write policy.
create policy erp_purchase_documents_select on public.erp_purchase_documents
  for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_purchase_documents from anon, authenticated;
grant select on public.erp_purchase_documents to authenticated;

-- Upsert one batch (a strictly newer `modified` wins, FR-EPR-002; the inclusive cursor's re-delivered
-- boundary row is a no-op), then re-stamp attribution and the
-- PMO-owned flag for the WHOLE org, so a project remap or a late external_refs row applies every tick.
create function public.upsert_erp_purchase_documents(p_org_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_written integer;
begin
  insert into public.erp_purchase_documents as d (
    org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
    grand_total, outstanding_amount, erp_status, erp_docstatus, is_return, erp_project, erp_modified)
  select p_org_id, r.erp_doctype, r.erp_name, r.supplier, r.supplier_name, r.doc_date, r.due_date, r.bill_no,
         r.currency, r.grand_total, r.outstanding_amount, r.erp_status, r.erp_docstatus,
         coalesce(r.is_return, false), r.erp_project, r.erp_modified
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      erp_doctype text, erp_name text, supplier text, supplier_name text, doc_date date, due_date date,
      bill_no text, currency text, grand_total numeric, outstanding_amount numeric, erp_status text,
      erp_docstatus smallint, is_return boolean, erp_project text, erp_modified text)
  on conflict (org_id, erp_doctype, erp_name) do update set
    supplier = excluded.supplier, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date,
    due_date = excluded.due_date, bill_no = excluded.bill_no, currency = excluded.currency,
    grand_total = excluded.grand_total, outstanding_amount = excluded.outstanding_amount,
    erp_status = excluded.erp_status, erp_docstatus = excluded.erp_docstatus, is_return = excluded.is_return,
    erp_project = excluded.erp_project, erp_modified = excluded.erp_modified, updated_at = now()
  where excluded.erp_modified > d.erp_modified;
  get diagnostics v_written = row_count;

  -- ERP project name → PMO project, from the activated binding. A name mapped twice has no unique target
  -- (projectMap.ts invertProjectMap) and a key that is not a same-org project is ignored.
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

commit;
