-- Round trip for 0369 (#1319 link create number + vendor): down, then up again. Run by
-- scripts/test-procurement-link-create-rollback.sh, which inlines the migration files at the markers.
begin;
select plan(6);
-- @0369_DOWN@
select hasnt_function('public','erp_supplier_company', array['uuid','text','text'], 'down 0369: the supplier resolver is gone');
select ok((select prosrc not like '%next_procurement_doc_number%' from pg_proc where oid = 'public.link_erp_purchase_documents(jsonb,boolean)'::regprocedure),
  'down 0369: the link function is 0361''s body (no purchase number minted)');
select ok(has_function_privilege('authenticated','public.link_erp_purchase_documents(jsonb,boolean)','execute')
          and not has_function_privilege('anon','public.link_erp_purchase_documents(jsonb,boolean)','execute'), 'down 0369: the link grants are unchanged');
-- @0369_UP@
select has_function('public','erp_supplier_company', array['uuid','text','text'], 'up again: the supplier resolver');
select ok((select prosrc like '%next_procurement_doc_number(v_org, ''PROC'')%' from pg_proc where oid = 'public.link_erp_purchase_documents(jsonb,boolean)'::regprocedure),
  'up again: the link function numbers a created purchase');
select ok(has_function_privilege('authenticated','public.link_erp_purchase_documents(jsonb,boolean)','execute')
          and not has_function_privilege('anon','public.link_erp_purchase_documents(jsonb,boolean)','execute')
          and not has_function_privilege('authenticated','public.erp_supplier_company(uuid,text,text)','execute'),
  'up again: the link keeps its grants and the resolver is internal');
select * from finish();
rollback;
