begin;
select plan(3);

select is(
  (select array_agg(a.attname::text order by k.ordinality)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
     cross join lateral unnest(i.indkey) with ordinality k(attnum, ordinality)
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where c.oid = to_regclass('public.erp_purchase_documents_visible_org_id_idx')),
  array['org_id', 'id'],
  'AC-EPR-005 the visible purchase list has an org-scoped ordered index');
select is(
  (select pg_get_expr(i.indpred, i.indrelid)
     from pg_index i
    where i.indexrelid = to_regclass('public.erp_purchase_documents_visible_org_id_idx')),
  '((erp_docstatus = 1) AND (NOT pmo_owned))',
  'AC-EPR-005 the purchase list index covers submitted native documents');
select is(
  (select i.indisvalid and i.indisready
     from pg_index i
    where i.indexrelid = to_regclass('public.erp_purchase_documents_visible_org_id_idx')),
  true,
  'AC-EPR-005 the purchase list index is ready for reads');

select * from finish();
rollback;
