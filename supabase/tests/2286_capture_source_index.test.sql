-- #2286 (item 6): the source page's family check reads invoices through a GIN index on purchase_orders, not by scanning
-- every purchase document of the organization once per order. Plan shape only — no latency threshold.
begin;
select plan(4);
insert into organizations (id, name, default_currency) values ('22860600-0000-0000-0000-000000000001','Source index test','IDR');
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '22860600-0000-0000-0000-000000000001','Purchase Order','V-ORDER-'||n,'SUP-1','Supplier','IDR',1,1,1,'To Bill','PROJECT','{}','{}','2026-02-01'
from generate_series(1,485) n;
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '22860600-0000-0000-0000-000000000001','Purchase Invoice','V-INV-'||n,'SUP-1','Supplier','IDR',1,1,1,'Unpaid','PROJECT','{}',array['V-ORDER-'||n],'2026-02-01'
from generate_series(1,485) n;
analyze erp_purchase_documents;

select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='erp_purchase_documents'
  and indexname='erp_purchase_documents_purchase_orders_idx' and indexdef ilike '%using gin (purchase_orders)%'),'#2286 purchase_orders has a GIN index');

create function pg_temp.nodes(p jsonb) returns table(node jsonb) language sql as $$
 with recursive t(n) as (select p->0->'Plan' union all select c from t, jsonb_array_elements(coalesce(t.n->'Plans','[]'::jsonb)) c) select n from t $$;
-- The family subquery exactly as the source page runs it for one order (the per-row correlation fixed to V-ORDER-7).
create function pg_temp.family_plan() returns jsonb language plpgsql as $$
declare v jsonb; begin
 execute $q$explain (format json) select 1 from public.erp_purchase_documents invoice
   where invoice.org_id = '22860600-0000-0000-0000-000000000001' and invoice.erp_doctype = 'Purchase Invoice'
     and invoice.purchase_orders @> array['V-ORDER-7'::text] and invoice.erp_docstatus = 1$q$ into v;
 return v; end $$;
select ok(exists(select 1 from pg_temp.nodes(pg_temp.family_plan()) where node->>'Index Name'='erp_purchase_documents_purchase_orders_idx'),
  '#2286 the family check reads invoices through the purchase_orders index');
select ok(not exists(select 1 from pg_temp.nodes(pg_temp.family_plan()) where node->>'Relation Name'='erp_purchase_documents' and node->>'Node Type'='Seq Scan'),
  '#2286 the family check never scans the purchase documents');

-- The EXPLAIN assertions above are the proof; this one textual guard binds them to the shipped source page (a plpgsql body
-- is not visible to EXPLAIN from here).
select ok(pg_get_functiondef('public.purchase_capture_source_page(uuid,uuid,integer)'::regprocedure) like '%invoice.purchase_orders @> array[d.erp_name]%',
  '#2286 the source page tests family membership with an indexable containment');
select * from finish();
rollback;
