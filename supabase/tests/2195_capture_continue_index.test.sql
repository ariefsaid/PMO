begin;
select plan(1);
insert into organizations(id,name,default_currency) values ('21950009-0000-0000-0000-000000000001','Index proof','USD');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
select '21950009-0000-0000-0000-000000000001','procurement',g::text,'index-proof-'||g,'erpnext','create','pending',
 jsonb_build_object('procurementId',md5(g::text)::uuid,'erp_doc_kind','payment')
from generate_series(1,6000) g;
analyze public.external_command_outbox;
create function pg_temp.outbox_index_plan() returns text language plpgsql as $$
declare r record; result text := '';
begin
  for r in execute $q$explain select 1 from public.external_command_outbox o
    where o.org_id='21950009-0000-0000-0000-000000000001' and o.domain='procurement'
    and public.procurement_case_uuid(o.payload->>'procurementId')=md5('1250')::uuid$q$
  loop result := result || r."QUERY PLAN" || E'\n'; end loop;
  return result;
end $$;
select diag(pg_temp.outbox_index_plan());
select ok(pg_temp.outbox_index_plan() like '%external_command_outbox_procurement_case_idx%','AC-ROP-024 indexed captured purchase outbox lookup');
select * from finish();
rollback;
