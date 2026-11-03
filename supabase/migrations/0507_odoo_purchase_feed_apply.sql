-- 0507_odoo_purchase_feed_apply.sql (#1505 O2 P7, AC-OPP-072/073/074, FR-OPP-080..085)
-- The Odoo purchase feed's service-only writers, the mirror of 0421 for orders, transfers, bills and payments:
--   apply_odoo_purchase_page      one page: refresh the PMO mirror rows already linked to an Odoo document, store every
--                                 non-draft order and bill (linked or native) once in erp_purchase_documents, and write the
--                                 domain's cursor, all in one transaction; never older over newer; a malformed row fails the
--                                 whole page (the cursor stays). It creates no PMO row of its own, ever (FR-OPP-083).
--   erp_document_recorded_by_pmo  0378's rule plus one branch for an Odoo row (external_ref set): a document PMO pushed, or whose
--                                 PMO anchor names a PMO record, is PMO's, so link-existing refuses it and a case never counts
--                                 it twice (#1319). ERPNext rows carry no external_ref, so their answer is byte-for-byte unchanged.
--   mark_odoo_purchase_census_seen / finish_odoo_purchase_census
--                                 tombstone (docstatus 2, erp_attention 'deleted-in-erp:<prior docstatus>', never delete) what Odoo no
--                                 longer returns and restore exactly the prior docstatus when the id returns (FR-OPP-085). A census
--                                 that would tombstone more than half of a sizeable set raises instead (a narrowed integration
--                                 user must not erase counted money).
-- The org is the caller's verified binding (p_org_id); a body org_id is never read. Every statement filters by it, so org B's
-- page cannot reach org A's row even when both orgs hold the same Odoo id (the ref is only unique per org).
-- Reversal: rollback/0507_odoo_purchase_feed_apply_down.sql.

create or replace function public.odoo_purchase_model(p_domain text) returns text
  language sql immutable set search_path = public as $$
  select case p_domain when 'purchase-order' then 'purchase.order' when 'receipt' then 'stock.picking'
                       when 'bill' then 'account.move' when 'payment' then 'account.payment' end
$$;

-- A figure the money columns (numeric(14,2) and wider) can hold; anything else is absent, never an error that pins the cursor.
create or replace function public.odoo_num(p text) returns numeric
  language sql immutable set search_path = public as $$
  select case when p ~ '^-?[0-9]{1,12}(\.[0-9]+)?$' then p::numeric end
$$;

create or replace function public.odoo_safe_date(p text) returns date
  language plpgsql immutable set search_path = public as $$
begin
  return case when p ~ '^\d{4}-\d{2}-\d{2}$' then p::date end;
exception when others then
  return null;
end $$;

-- One typed row per Odoo id of the page (the newest write_date wins when a page lists an id twice). The money header is 'ok'
-- only when all four parts parse and the withheld total honours procurement_invoices_withheld_amount_bounds (0269): a header the
-- bill table would refuse is flagged and left unwritten, never allowed to poison the page (FR-OPP-082, DD-VWH-5).
create or replace function public.odoo_purchase_page_rows(p_rows jsonb) returns table (
  external_id text, name text, wd text, state text, status text, docstatus smallint, anchor_key text, partner text, partner_name text,
  doc_date date, due_date date, bill_no text, currency text, source_orders text[], analytic_ids text[], amount_total numeric, amount_untaxed numeric,
  residual numeric, amount numeric, money text, gross numeric, vat numeric, withheld numeric, outstanding numeric)
  language sql stable set search_path = public as $$
  with newest as (
    select distinct on (x->>'external_id') x from jsonb_array_elements(p_rows) x
     order by x->>'external_id', x->>'source_write_date' desc
  ), f as (
    select x->>'external_id' as external_id, x->>'name' as name, x->>'source_write_date' as wd,
           x#>>'{attrs,state}' as state, x#>>'{attrs,status}' as status, (x#>>'{attrs,docstatus}')::smallint as docstatus,
           nullif(x#>>'{attrs,anchor_key}', '') as anchor_key, nullif(x#>>'{attrs,partner}', '') as partner,
           x#>>'{attrs,partner_name}' as partner_name,
           public.odoo_safe_date(x#>>'{attrs,date}') as doc_date, public.odoo_safe_date(x#>>'{attrs,due_date}') as due_date,
           x#>>'{attrs,bill_no}' as bill_no, x#>>'{attrs,currency}' as currency,
           case when jsonb_typeof(x#>'{attrs,source_orders}') = 'array' then array(select jsonb_array_elements_text(x#>'{attrs,source_orders}')) else '{}'::text[] end as source_orders,
           case when jsonb_typeof(x#>'{attrs,analytic_ids}') = 'array' then array(select jsonb_array_elements_text(x#>'{attrs,analytic_ids}')) else '{}'::text[] end as analytic_ids,
           public.odoo_num(x#>>'{attrs,amount_total}') as amount_total, public.odoo_num(x#>>'{attrs,amount_untaxed}') as amount_untaxed,
           public.odoo_num(x#>>'{attrs,residual}') as residual, public.odoo_num(x#>>'{attrs,amount}') as amount,
           public.odoo_num(x#>>'{attrs,money,gross}') as gross, public.odoo_num(x#>>'{attrs,money,vat}') as vat,
           public.odoo_num(x#>>'{attrs,money,withheld}') as withheld, public.odoo_num(x#>>'{attrs,money,outstanding}') as outstanding
      from newest
  )
  select f.external_id, f.name, f.wd, f.state, f.status, f.docstatus, f.anchor_key, f.partner, f.partner_name, f.doc_date, f.due_date,
         f.bill_no, f.currency, f.source_orders, f.analytic_ids, f.amount_total, f.amount_untaxed, f.residual, f.amount,
         case when f.gross is null or f.vat is null or f.withheld is null or f.outstanding is null then 'incomplete'
              when f.withheld = 0 or (sign(f.withheld) = sign(f.gross) and abs(f.withheld) <= abs(f.gross)) then 'ok'
              else 'invalid' end as money,
         f.gross, f.vat, f.withheld, f.outstanding
    from f
$$;

create or replace function public.apply_odoo_purchase_page(p_org_id uuid, p_domain text, p_rows jsonb, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_model text := public.odoo_purchase_model(p_domain);
  v_doctype text;
  v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if v_model is null then raise exception 'unknown purchase domain' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be an array' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
              where coalesce(r->>'external_id', '') !~ '^[1-9][0-9]*$' or coalesce(r->>'name', '') = ''
                 or coalesce(r->>'source_write_date', '') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
                 or coalesce(r#>>'{attrs,docstatus}', '') !~ '^[0-2]$') then
    raise exception 'malformed purchase row' using errcode = '22023';
  end if;

  -- 1. The PMO mirror rows already linked to an Odoo document (the ref is model-qualified, so a bill never meets an order).
  --    A value a column cannot hold (a negative order total, an amount beyond the column) is left as it was, never an error.
  if p_domain = 'purchase-order' then
    update public.purchase_orders t set
      status = case when s.status in ('Draft', 'Issued', 'Closed') then s.status else t.status end,
      amount = case when s.docstatus = 2 or s.amount_total < 0 then t.amount else coalesce(s.amount_total, t.amount) end,
      erp_docstatus = s.docstatus, erp_modified = s.wd, erp_state = s.state,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) end,
      erp_attention = null, erp_read_at = now()
    from public.odoo_purchase_page_rows(p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id and (t.erp_modified is null or t.erp_modified <= s.wd);
  elsif p_domain = 'receipt' then
    update public.procurement_receipts t set
      status = case when s.status in ('Partial', 'Complete') then s.status::procurement_receipt_status else t.status end,
      erp_docstatus = s.docstatus, erp_modified = s.wd, erp_state = s.state,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) end,
      erp_attention = null, erp_read_at = now()
    from public.odoo_purchase_page_rows(p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id and (t.erp_modified is null or t.erp_modified <= s.wd);
  elsif p_domain = 'bill' then
    -- FR-OPP-082: the money header and the status derived from it are written whole or not at all.
    update public.procurement_invoices t set
      status = case when s.money = 'ok' and s.status in ('Received', 'Paid') then s.status::procurement_invoice_status else t.status end,
      amount = case when s.money = 'ok' then s.gross else t.amount end,
      tax_amount = case when s.money = 'ok' then s.vat else t.tax_amount end,
      withheld_amount = case when s.money = 'ok' then s.withheld else t.withheld_amount end,
      tax_treatment = case when s.money = 'ok' then 'inclusive' else t.tax_treatment end,
      erp_outstanding_amount = case when s.money = 'ok' then s.outstanding else t.erp_outstanding_amount end,
      erp_docstatus = s.docstatus, erp_modified = s.wd, erp_state = s.state,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) end,
      erp_attention = case when s.docstatus <> 1 or s.money = 'ok' then null
                           when s.money = 'invalid' then 'money-header-invalid' else 'money-header-incomplete' end,
      erp_read_at = now()
    from public.odoo_purchase_page_rows(p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id and (t.erp_modified is null or t.erp_modified <= s.wd);
  else
    update public.payments t set
      status = case when s.status in ('Scheduled', 'Paid') then s.status else t.status end,
      amount = case when s.docstatus = 1 and s.amount >= 0 then s.amount else t.amount end,
      erp_docstatus = s.docstatus, erp_modified = s.wd, erp_state = s.state,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) end,
      erp_attention = null, erp_read_at = now()
    from public.odoo_purchase_page_rows(p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id and (t.erp_modified is null or t.erp_modified <= s.wd);
  end if;

  -- 2. Every issued, posted or cancelled order and bill is listed once, PMO's own flagged pmo_owned so the case counts it once and
  --    link-existing refuses it, an Odoo-native one open to link-existing (FR-OPP-083). "PMO's own" is LIVE here: the link row (or the
  --    PMO key in the document's anchor) must name a PMO record of this org that exists; a planted anchor naming nothing owns nothing
  --    and is stored with a reason. A native document whose vendor or project has no PMO mapping is stored with the reason, not
  --    dropped. Nothing here ever creates a PMO record. A name another row already holds (or the page holds twice) is replaced by the
  --    document's own ref, which is unique, so a page can never trip the (org, kind, name) key and pin the cursor.
  if p_domain in ('purchase-order', 'bill') then
    v_doctype := case p_domain when 'bill' then 'Purchase Invoice' else 'Purchase Order' end;
    insert into public.erp_purchase_documents as d
      (org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency, grand_total, net_total,
       outstanding_amount, erp_status, erp_docstatus, project_ids, pmo_owned, erp_modified, external_ref, erp_state,
       erp_attention, adoption_key, purchase_orders, erp_read_at, updated_at)
    select p_org_id, v_doctype,
           case when s.dup > 1 or exists (select 1 from public.erp_purchase_documents x where x.org_id = p_org_id and x.erp_doctype = v_doctype
                                            and x.erp_name = s.name and x.external_ref is distinct from v_model || ':' || s.external_id)
                then v_model || ':' || s.external_id else s.name end,
           s.partner, s.partner_name, s.doc_date, s.due_date, s.bill_no, s.currency, s.amount_total, s.amount_untaxed,
           case when p_domain = 'bill' then s.residual end, s.status, s.docstatus, p.ids, o.owned, s.wd, v_model || ':' || s.external_id,
           s.state,
           nullif(concat_ws(',',
             case when s.partner is null or not exists (select 1 from public.external_refs v where v.org_id = p_org_id and v.domain = 'companies'
                                                           and v.external_tier = 'odoo' and v.external_record_id = 'Vendor:' || s.partner)
                  then 'vendor-unmapped' end,
             case when cardinality(s.analytic_ids) > 0 and cardinality(p.ids) = 0 then 'project-unmapped' end,
             case when s.anchor_key is not null and not o.anchored then 'anchor-unresolved' end), ''),
           case when o.anchored and not o.linked then s.anchor_key end, s.source_orders, now(), now()
      from (select q.*, count(*) over (partition by q.name) as dup from public.odoo_purchase_page_rows(p_rows) q) s
      cross join lateral (
        select l.linked, a.anchored, (l.linked or a.anchored) as owned
          from (select exists (select 1 from public.external_refs r
                                where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
                                  and r.external_record_id = v_model || ':' || s.external_id
                                  and case p_domain
                                        when 'bill' then exists (select 1 from public.procurement_invoices i where i.org_id = p_org_id and i.id::text = r.pmo_record_id)
                                        else exists (select 1 from public.purchase_orders i where i.org_id = p_org_id and i.id::text = r.pmo_record_id) end) as linked) l,
               (select coalesce(case p_domain
                         when 'bill' then s.anchor_key ~ '^bill:' and exists (select 1 from public.procurement_invoices i where i.org_id = p_org_id and i.id::text = substr(s.anchor_key, 6))
                         else s.anchor_key ~ '^po:' and exists (select 1 from public.purchase_orders i where i.org_id = p_org_id and i.id::text = substr(s.anchor_key, 4)) end, false) as anchored) a
      ) o
      cross join lateral (select coalesce(array_agg(distinct b.project_id order by b.project_id), '{}'::uuid[]) as ids
                            from public.external_project_bindings b
                           where b.org_id = p_org_id and b.external_tier = 'odoo' and b.external_container_id = any (s.analytic_ids)) p
     where s.docstatus in (1, 2)
    on conflict (org_id, external_ref) where external_ref is not null do update set
      erp_name = excluded.erp_name, supplier = excluded.supplier, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date,
      due_date = excluded.due_date, bill_no = excluded.bill_no, currency = excluded.currency, grand_total = excluded.grand_total,
      net_total = excluded.net_total, outstanding_amount = excluded.outstanding_amount, erp_status = excluded.erp_status,
      erp_docstatus = excluded.erp_docstatus, project_ids = excluded.project_ids, pmo_owned = excluded.pmo_owned,
      erp_modified = excluded.erp_modified, erp_state = excluded.erp_state, erp_attention = excluded.erp_attention,
      adoption_key = excluded.adoption_key, purchase_orders = excluded.purchase_orders, erp_read_at = now(), updated_at = now()
    where d.erp_modified <= excluded.erp_modified;

    -- A document set back to draft in Odoo is no longer issued money: a row already listed stops counting (docstatus 2) and says why.
    update public.erp_purchase_documents d set erp_docstatus = 2, erp_state = s.state, erp_attention = 'reset-to-draft', erp_modified = s.wd, erp_read_at = now(), updated_at = now()
      from public.odoo_purchase_page_rows(p_rows) s
     where s.docstatus = 0 and d.org_id = p_org_id and d.external_ref = v_model || ':' || s.external_id and d.erp_modified <= s.wd;

    -- 0361 M-1, as upsert_erp_purchase_documents does for ERPNext: a linked document that Odoo changed, cancelled or set back to draft
    -- moves its purchase's total (ledger-held and evidence already read erp_docstatus = 1).
    perform public.refresh_erp_linked_purchase_total(x.procurement_id)
       from (select distinct l.procurement_id
               from public.procurement_erp_links l
               join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
              where l.org_id = p_org_id and d.org_id = p_org_id
                and d.external_ref in (select v_model || ':' || q.external_id from public.odoo_purchase_page_rows(p_rows) q)) x;
  end if;

  -- 3. The cursor, in the same transaction (a raise anywhere above leaves it where it was).
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'purchase:' || p_domain, p_cursor, now())
  on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();

  select count(*) into v_n from public.odoo_purchase_page_rows(p_rows);
  return v_n;
end $$;
revoke all on function public.apply_odoo_purchase_page(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_odoo_purchase_page(uuid, text, jsonb, text) to service_role;

-- 0378's rule plus one branch for an Odoo row (external_ref set), decided LIVE like the first: the document's link row, or the PMO key in
-- its anchor, must name a PMO record of that kind in this org that exists. ERPNext rows carry no external_ref, so their answer is unchanged.
create or replace function public.erp_document_recorded_by_pmo(p_org uuid, p_doctype text, p_erp_name text)
returns boolean
language sql stable set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.external_refs x
     where x.org_id = p_org and x.domain = 'procurement' and x.external_tier = 'erpnext'
       and x.external_record_id = p_erp_name
       and case p_doctype
             when 'Purchase Order'   then exists (select 1 from public.purchase_orders r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             when 'Purchase Receipt' then exists (select 1 from public.procurement_receipts r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             when 'Purchase Invoice' then exists (select 1 from public.procurement_invoices r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             when 'Payment Entry'    then exists (select 1 from public.payments r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             else false end)
  or exists (
    select 1 from public.erp_purchase_documents d
     where d.org_id = p_org and d.erp_doctype = p_doctype and d.erp_name = p_erp_name and d.external_ref is not null
       and (exists (select 1 from public.external_refs x
                     where x.org_id = p_org and x.domain = 'procurement' and x.external_tier = 'odoo' and x.external_record_id = d.external_ref
                       and case p_doctype
                             when 'Purchase Order'   then exists (select 1 from public.purchase_orders r where r.org_id = p_org and r.id::text = x.pmo_record_id)
                             when 'Purchase Invoice' then exists (select 1 from public.procurement_invoices r where r.org_id = p_org and r.id::text = x.pmo_record_id)
                             else false end)
            or (d.adoption_key is not null
                and case p_doctype
                      when 'Purchase Order'   then d.adoption_key ~ '^po:'   and exists (select 1 from public.purchase_orders r where r.org_id = p_org and r.id::text = substr(d.adoption_key, 4))
                      when 'Purchase Invoice' then d.adoption_key ~ '^bill:' and exists (select 1 from public.procurement_invoices r where r.org_id = p_org and r.id::text = substr(d.adoption_key, 6))
                      else false end)))
$$;
revoke all on function public.erp_document_recorded_by_pmo(uuid, text, text) from public, anon, authenticated;

-- A row the census sees exists in Odoo: record the run, and lift a tombstone the census put there, back to exactly the docstatus it
-- had (a document that was cancelled stays cancelled, FR-OPP-085).
create or replace function public.mark_odoo_purchase_census_seen(p_org_id uuid, p_domain text, p_run timestamptz, p_ids text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_model text := public.odoo_purchase_model(p_domain);
  v_refs text[];
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if v_model is null then raise exception 'unknown purchase domain' using errcode = '22023'; end if;
  v_refs := array(select v_model || ':' || i from unnest(coalesce(p_ids, '{}')) i);
  if p_domain = 'purchase-order' then
    update public.purchase_orders t set erp_census_seen_at = p_run,
      erp_docstatus = case when starts_with(t.erp_attention, 'deleted-in-erp:') then substr(t.erp_attention, 16)::smallint else t.erp_docstatus end,
      erp_cancelled_at = case when starts_with(t.erp_attention, 'deleted-in-erp:') and substr(t.erp_attention, 16) <> '2' then null else t.erp_cancelled_at end,
      erp_attention = case when starts_with(t.erp_attention, 'deleted-in-erp:') then null else t.erp_attention end
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and r.external_record_id = any (v_refs) and t.org_id = p_org_id and t.id::text = r.pmo_record_id;
  elsif p_domain = 'receipt' then
    update public.procurement_receipts t set erp_census_seen_at = p_run,
      erp_docstatus = case when starts_with(t.erp_attention, 'deleted-in-erp:') then substr(t.erp_attention, 16)::smallint else t.erp_docstatus end,
      erp_cancelled_at = case when starts_with(t.erp_attention, 'deleted-in-erp:') and substr(t.erp_attention, 16) <> '2' then null else t.erp_cancelled_at end,
      erp_attention = case when starts_with(t.erp_attention, 'deleted-in-erp:') then null else t.erp_attention end
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and r.external_record_id = any (v_refs) and t.org_id = p_org_id and t.id::text = r.pmo_record_id;
  elsif p_domain = 'bill' then
    update public.procurement_invoices t set erp_census_seen_at = p_run,
      erp_docstatus = case when starts_with(t.erp_attention, 'deleted-in-erp:') then substr(t.erp_attention, 16)::smallint else t.erp_docstatus end,
      erp_cancelled_at = case when starts_with(t.erp_attention, 'deleted-in-erp:') and substr(t.erp_attention, 16) <> '2' then null else t.erp_cancelled_at end,
      erp_attention = case when starts_with(t.erp_attention, 'deleted-in-erp:') then null else t.erp_attention end
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and r.external_record_id = any (v_refs) and t.org_id = p_org_id and t.id::text = r.pmo_record_id;
  else
    update public.payments t set erp_census_seen_at = p_run,
      erp_docstatus = case when starts_with(t.erp_attention, 'deleted-in-erp:') then substr(t.erp_attention, 16)::smallint else t.erp_docstatus end,
      erp_cancelled_at = case when starts_with(t.erp_attention, 'deleted-in-erp:') and substr(t.erp_attention, 16) <> '2' then null else t.erp_cancelled_at end,
      erp_attention = case when starts_with(t.erp_attention, 'deleted-in-erp:') then null else t.erp_attention end
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and r.external_record_id = any (v_refs) and t.org_id = p_org_id and t.id::text = r.pmo_record_id;
  end if;
  if p_domain in ('purchase-order', 'bill') then
    update public.erp_purchase_documents d set erp_census_seen_at = p_run,
      erp_docstatus = case when starts_with(d.erp_attention, 'deleted-in-erp:') then substr(d.erp_attention, 16)::smallint else d.erp_docstatus end,
      erp_attention = case when starts_with(d.erp_attention, 'deleted-in-erp:') then null else d.erp_attention end
    where d.org_id = p_org_id and d.external_ref = any (v_refs);
    -- a document lifted back from its tombstone counts again in the purchase it is linked to
    perform public.refresh_erp_linked_purchase_total(x.procurement_id)
       from (select distinct l.procurement_id
               from public.procurement_erp_links l
               join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
              where l.org_id = p_org_id and d.org_id = p_org_id and d.external_ref = any (v_refs)) x;
  end if;
end $$;
revoke all on function public.mark_odoo_purchase_census_seen(uuid, text, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.mark_odoo_purchase_census_seen(uuid, text, timestamptz, text[]) to service_role;

-- Tombstone what the run did not see: docstatus 2, the prior docstatus kept in the reason so the lift restores it. A link made, or a
-- document stored, within the overlap window before the run (or after it) is never judged by it: the run read its ids before that
-- document existed in PMO, and the run's clock is the edge function's. A census that would tombstone more than half of a set of more
-- than ten documents raises (and so changes nothing): a narrowed integration user or a company change makes Odoo answer with fewer ids
-- and no error, and that must not erase counted money.
create or replace function public.finish_odoo_purchase_census(p_org_id uuid, p_domain text, p_run timestamptz, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_model text := public.odoo_purchase_model(p_domain);
  v_cut timestamptz := p_run - interval '10 minutes';
  v_n integer := 0;
  v_k integer;
  v_eligible integer;
  v_ids uuid[];
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if v_model is null then raise exception 'unknown purchase domain' using errcode = '22023'; end if;
  if p_domain = 'purchase-order' then
    update public.purchase_orders t set erp_attention = 'deleted-in-erp:' || coalesce(t.erp_docstatus, 1), erp_docstatus = 2, erp_cancelled_at = coalesce(t.erp_cancelled_at, now()), erp_read_at = now()
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and starts_with(r.external_record_id, v_model || ':') and r.created_at < v_cut
      and t.org_id = p_org_id and t.id::text = r.pmo_record_id and not starts_with(coalesce(t.erp_attention, ''), 'deleted-in-erp:')
      and (t.erp_census_seen_at is null or t.erp_census_seen_at < p_run);
  elsif p_domain = 'receipt' then
    update public.procurement_receipts t set erp_attention = 'deleted-in-erp:' || coalesce(t.erp_docstatus, 1), erp_docstatus = 2, erp_cancelled_at = coalesce(t.erp_cancelled_at, now()), erp_read_at = now()
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and starts_with(r.external_record_id, v_model || ':') and r.created_at < v_cut
      and t.org_id = p_org_id and t.id::text = r.pmo_record_id and not starts_with(coalesce(t.erp_attention, ''), 'deleted-in-erp:')
      and (t.erp_census_seen_at is null or t.erp_census_seen_at < p_run);
  elsif p_domain = 'bill' then
    update public.procurement_invoices t set erp_attention = 'deleted-in-erp:' || coalesce(t.erp_docstatus, 1), erp_docstatus = 2, erp_cancelled_at = coalesce(t.erp_cancelled_at, now()), erp_read_at = now()
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and starts_with(r.external_record_id, v_model || ':') and r.created_at < v_cut
      and t.org_id = p_org_id and t.id::text = r.pmo_record_id and not starts_with(coalesce(t.erp_attention, ''), 'deleted-in-erp:')
      and (t.erp_census_seen_at is null or t.erp_census_seen_at < p_run);
  else
    update public.payments t set erp_attention = 'deleted-in-erp:' || coalesce(t.erp_docstatus, 1), erp_docstatus = 2, erp_cancelled_at = coalesce(t.erp_cancelled_at, now()), erp_read_at = now()
    from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
      and starts_with(r.external_record_id, v_model || ':') and r.created_at < v_cut
      and t.org_id = p_org_id and t.id::text = r.pmo_record_id and not starts_with(coalesce(t.erp_attention, ''), 'deleted-in-erp:')
      and (t.erp_census_seen_at is null or t.erp_census_seen_at < p_run);
  end if;
  get diagnostics v_k = row_count;
  v_n := v_k;
  if p_domain in ('purchase-order', 'bill') then
    with t as (
      update public.erp_purchase_documents d set erp_attention = 'deleted-in-erp:' || d.erp_docstatus, erp_docstatus = 2, erp_read_at = now()
      where d.org_id = p_org_id and starts_with(d.external_ref, v_model || ':') and not starts_with(coalesce(d.erp_attention, ''), 'deleted-in-erp:')
        and d.updated_at < v_cut and (d.erp_census_seen_at is null or d.erp_census_seen_at < p_run)
      returning d.id)
    select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from t;
    v_n := v_n + cardinality(v_ids);
  end if;
  select (select count(*) from public.external_refs r where r.org_id = p_org_id and r.domain = 'procurement' and r.external_tier = 'odoo'
                 and starts_with(r.external_record_id, v_model || ':') and r.created_at < v_cut)
       + (select count(*) from public.erp_purchase_documents d where d.org_id = p_org_id and starts_with(d.external_ref, v_model || ':') and d.updated_at < v_cut)
    into v_eligible;
  if v_n > 10 and v_n * 2 > v_eligible then
    raise exception 'census saw implausibly few documents' using errcode = 'P0001';
  end if;
  -- a tombstoned document stops counting in the purchase it is linked to (the guard above has already let the run through)
  if cardinality(v_ids) > 0 then
    perform public.refresh_erp_linked_purchase_total(x.procurement_id)
       from (select distinct l.procurement_id from public.procurement_erp_links l
              where l.org_id = p_org_id and l.erp_purchase_document_id = any (v_ids)) x;
  end if;
  update public.external_sync_watermarks set watermark_cursor = p_cursor, updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and domain = 'purchase:' || p_domain;
  return v_n;
end $$;
revoke all on function public.finish_odoo_purchase_census(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.finish_odoo_purchase_census(uuid, text, timestamptz, text) to service_role;

revoke all on function public.odoo_purchase_model(text) from public, anon, authenticated;
revoke all on function public.odoo_num(text) from public, anon, authenticated;
revoke all on function public.odoo_safe_date(text) from public, anon, authenticated;
revoke all on function public.odoo_purchase_page_rows(jsonb) from public, anon, authenticated;
grant execute on function public.odoo_purchase_model(text), public.odoo_num(text), public.odoo_safe_date(text), public.odoo_purchase_page_rows(jsonb) to service_role;
