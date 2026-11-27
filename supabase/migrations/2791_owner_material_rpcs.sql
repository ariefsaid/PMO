-- Owner material reads and bounded opening import (#3010).
create or replace function public.guard_section_material_plan() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_section_material_plan := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_status public.work_order_status; v_archived timestamptz;
  v_plan numeric; v_others numeric;
begin
  select w.org_id, w.status into v_org, v_status from public.work_orders w where w.id = v_row.work_order_id;
  if v_org is null or v_org is distinct from v_row.org_id then
    raise exception 'WOS_WO: the work order is not in your organisation' using errcode = '23514'; end if;
  if v_status = 'Cancelled' then
    raise exception 'WOS_CANCELLED: a cancelled work order''s plan is frozen' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.work_order_id is distinct from old.work_order_id or new.section_id is distinct from old.section_id
                           or new.item_id is distinct from old.item_id or new.org_id is distinct from old.org_id) then
    raise exception 'WOS_KEY: an allocation keeps its work order, section and item' using errcode = '23514'; end if;
  if v_status not in ('Draft', 'Issued') then
    raise exception 'WOS_STATUS: a closed work order takes no allocation changes' using errcode = '23514'; end if;
  select s.archived_at into v_archived from public.work_order_sections s where s.id = new.section_id;
  if v_archived is not null then
    raise exception 'WOS_SECTION_ARCHIVED: an archived section takes no allocation' using errcode = '23514'; end if;
  if not exists (select 1 from public.stock_items i where i.id = new.item_id and i.org_id = new.org_id
                  and (i.archived_at is null or tg_op = 'UPDATE')) then
    raise exception 'WOS_ITEM: the item is not a live stock item of this organisation' using errcode = '23514'; end if;
  -- Serialize allocations of one item on one work order before summing, so two writers cannot both fit.
  perform pg_advisory_xact_lock(hashtextextended('wos-alloc:' || new.work_order_id::text || ':' || new.item_id::text, 0));
  v_plan := public.mrq_plan_quantity(new.work_order_id, new.item_id);
  select coalesce(sum(a.quantity), 0) into v_others from public.work_order_section_material_plan a
   where a.work_order_id = new.work_order_id and a.item_id = new.item_id and a.id is distinct from new.id;
  if v_others + new.quantity > v_plan and not (public.is_active_member() and public.auth_role() = 'Admin' and exists (select 1 from public.owner_material_import_witness x where x.transaction_id=txid_current() and x.backend_pid=pg_backend_pid() and x.org_id=new.org_id and x.actor_id=auth.uid() and x.batch_id=new.import_batch_id)) then                                                               -- mut:alloc_cap
    raise exception 'WOS_ALLOCATION_CAP: the allocations would be % against a work-order plan of %', v_others + new.quantity, v_plan
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;

create function public.om_material_check_parent() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_plan public.work_order_section_material_plan;v_wo uuid;v_kind text;
begin
 if new.section_material_plan_id is null then return new;end if;
 select * into v_plan from public.work_order_section_material_plan p where p.id=new.section_material_plan_id and p.org_id=new.org_id;
 if tg_table_name='client_requisition_lines' then
 select r.work_order_id into v_wo from public.client_requisitions r where r.id=new.requisition_id and r.org_id=new.org_id;
 else
 select d.work_order_id,d.kind into v_wo,v_kind from public.stock_documents d where d.id=new.document_id and d.org_id=new.org_id;
 if (new.stage='received' and v_kind is distinct from 'receive') or (new.stage='issued' and v_kind is distinct from 'issue')
 or (new.stage='returned' and v_kind is distinct from 'return') then raise exception 'Movement stage mismatch' using errcode='23514';end if;
 end if;
 if v_plan.id is null or v_wo is distinct from v_plan.work_order_id then
 raise exception 'Material parent mismatch' using errcode='23514';end if;
 return new;
end $$;
revoke all on function public.om_material_check_parent() from public,anon,authenticated,service_role;
create trigger owner_material_requisition_parent before insert or update on public.client_requisition_lines
 for each row execute function public.om_material_check_parent();
create trigger owner_material_movement_parent before insert or update on public.owner_material_movement_links
 for each row execute function public.om_material_check_parent();

create view public.owner_material_stage_totals with (security_invoker=true) as
with requests as (
 select l.section_material_plan_id plan_id,sum(l.requested_quantity) requested,
 sum(coalesce(e.reserved,0)) set_aside
 from public.client_requisition_lines l join public.client_requisitions r on r.id=l.requisition_id and r.org_id=l.org_id
 left join lateral (select sum(case kind when 'reserved' then quantity when 'released' then -quantity else 0 end) reserved
 from public.client_requisition_events e where e.line_id=l.id and e.org_id=l.org_id) e on true
 where r.status='open' and l.section_material_plan_id is not null group by l.section_material_plan_id
), movements as (
 select x.section_material_plan_id plan_id,
 sum(abs(g.qty_delta)) filter(where x.stage='received' and d.kind='receive' and g.qty_delta>0) received,
 sum(abs(g.qty_delta)) filter(where x.stage='issued' and d.kind='issue' and g.qty_delta<0) issued,
 sum(abs(g.qty_delta)) filter(where x.stage='returned' and d.kind='return' and g.qty_delta>0) returned,
 sum(abs(g.qty_delta)) filter(where x.stage='transfer_in' and g.qty_delta>0) transfer_in,
 sum(abs(g.qty_delta)) filter(where x.stage='transfer_out' and g.qty_delta<0) transfer_out,
 sum(abs(g.qty_delta)) filter(where x.stage='owner_return' and g.qty_delta<0) owner_return
 from public.owner_material_movement_links x
 join public.stock_documents d on d.id=x.document_id and d.org_id=x.org_id and d.status='Posted'
 join public.stock_ledger g on g.document_id=d.id and g.line_id=x.stock_line_id and g.org_id=x.org_id
 where not exists(select 1 from public.order_receiving_requests r join public.order_receiving_reversals v on v.request_id=r.id where r.stock_document_id=d.id)
 and not exists(select 1 from public.dsr_stock_postings s where s.issue_document_id=d.id and s.reversed_at is not null)
 group by x.section_material_plan_id
), quantities as (
 select p.id plan_id,p.section_id,p.item_id,p.work_order_id,w.project_id,i.code item_code,i.name item_name,u.code unit,
 c.code category_code,s.owner_cost_code,p.quantity planned,
 coalesce(o.requested,0)+coalesce(r.requested,0) requested,coalesce(o.set_aside,0)+coalesce(r.set_aside,0) set_aside,
 coalesce(o.received,0)+coalesce(m.received,0) received,coalesce(o.issued,0)+coalesce(m.issued,0) issued,
 coalesce(o.returned,0)+coalesce(m.returned,0) returned,coalesce(o.transfer_in,0)+coalesce(m.transfer_in,0) transfer_in,
 coalesce(o.transfer_out,0)+coalesce(m.transfer_out,0) transfer_out,coalesce(o.owner_return,0)+coalesce(m.owner_return,0) owner_return,
 o.as_of,o.evidence
 from public.work_order_section_material_plan p
 join public.work_order_sections s on s.id=p.section_id and s.org_id=p.org_id and s.archived_at is null
 join public.work_orders w on w.id=p.work_order_id and w.org_id=p.org_id
 join public.projects j on j.id=w.project_id and j.org_id=w.org_id
 join public.stock_items i on i.id=p.item_id and i.org_id=p.org_id join public.stock_units u on u.id=i.unit_id and u.org_id=p.org_id
 left join public.stock_material_categories c on c.id=p.category_id and c.org_id=p.org_id
 left join public.owner_material_openings o on o.section_material_plan_id=p.id and o.org_id=p.org_id
 left join requests r on r.plan_id=p.id left join movements m on m.plan_id=p.id
 where p.org_id=(select public.auth_org_id()) and (select public.is_active_member())
), closing as (
 select *,received+transfer_in-issued+returned-transfer_out-owner_return closing from quantities
)
select *,case when planned>0 then least(100,requested/planned*100) end requested_pct,
 case when planned>0 then least(100,set_aside/planned*100) end set_aside_pct,
 case when planned>0 then least(100,received/planned*100) end received_pct,
 case when received>0 then least(100,issued/received*100) end issued_pct,
 case when received>0 then least(100,closing/received*100) end closing_pct from closing;
revoke all on public.owner_material_stage_totals from public,anon,authenticated;
grant select on public.owner_material_stage_totals to authenticated;

create function public.om_material_lines(p_work_order_id uuid,p_section_id uuid default null,p_page integer default 1,p_page_size integer default 50)
returns table(plan_id uuid,section_id uuid,item_id uuid,item_code text,item_name text,unit text,category_code text,owner_cost_code text,
 planned text,requested text,set_aside text,received text,issued text,returned text,transfer_in text,transfer_out text,owner_return text,
 closing text,requested_pct text,set_aside_pct text,received_pct text,issued_pct text,closing_pct text,total_count bigint,as_of date,evidence jsonb)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not coalesce(public.is_active_member(),false) then raise exception 'Active membership required' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
 raise exception 'Invalid pagination' using errcode='P0001',detail='material-invalid'; end if;
 return query select t.plan_id,t.section_id,t.item_id,t.item_code,t.item_name,t.unit,t.category_code,t.owner_cost_code,
 t.planned::text,t.requested::text,t.set_aside::text,t.received::text,t.issued::text,t.returned::text,t.transfer_in::text,t.transfer_out::text,
 t.owner_return::text,t.closing::text,t.requested_pct::text,t.set_aside_pct::text,t.received_pct::text,t.issued_pct::text,t.closing_pct::text,
 count(*) over(),t.as_of,t.evidence from public.owner_material_stage_totals t
 where t.work_order_id=p_work_order_id and (p_section_id is null or t.section_id=p_section_id)
 order by t.section_id,t.item_code,t.plan_id limit p_page_size offset (p_page::bigint-1)*p_page_size;
end $$;

create function public.om_material_rollup(p_project_id uuid,p_page integer default 1,p_page_size integer default 50,p_work_order_id uuid default null)
returns table(work_order_id uuid,number text,title text,section_count bigint,requested_pct text,set_aside_pct text,received_pct text,
 issued_pct text,closing_pct text,reconciliation_step text,reconciliation_pct text,unallocated_movement_count bigint,total_count bigint)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not coalesce(public.is_active_member(),false) then raise exception 'Active membership required' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
 raise exception 'Invalid pagination' using errcode='P0001',detail='material-invalid'; end if;
 return query with totals as (
 select t.work_order_id,avg(t.requested_pct) requested,avg(t.set_aside_pct) reserved,avg(t.received_pct) received,
 avg(t.issued_pct) issued,avg(t.closing_pct) closing from public.owner_material_stage_totals t
 where t.project_id=p_project_id group by t.work_order_id
 ), sections as (
 select s.work_order_id,count(*) n,min(coalesce(r.percentage,0)) pct
 from public.work_order_sections s left join public.owner_material_reconciliation c on c.section_id=s.id
 left join public.owner_material_reconciliation_steps r on r.id=c.step_id
 where s.archived_at is null group by s.work_order_id
 ), unallocated as (
 select d.work_order_id,count(distinct g.line_id) n from public.stock_documents d join public.stock_ledger g on g.document_id=d.id
 where d.status='Posted' and not exists(select 1 from public.owner_material_movement_links x where x.stock_line_id=g.line_id)
 group by d.work_order_id
 ) select w.id,coalesce(w.wo_number,w.client_po_number),w.title,coalesce(s.n,0),t.requested::text,t.reserved::text,t.received::text,
 t.issued::text,t.closing::text,r.name,s.pct::text,coalesce(u.n,0),count(*) over()
 from public.work_orders w join public.projects j on j.id=w.project_id
 left join totals t on t.work_order_id=w.id left join sections s on s.work_order_id=w.id left join unallocated u on u.work_order_id=w.id
 left join public.owner_material_reconciliation_steps r on r.org_id=w.org_id and r.percentage=s.pct and r.archived_at is null
 where w.project_id=p_project_id and (p_work_order_id is null or w.id=p_work_order_id)
 and w.org_id=(select public.auth_org_id()) and (select public.is_active_member())
 order by coalesce(w.wo_number,w.client_po_number),w.id limit p_page_size offset (p_page::bigint-1)*p_page_size;
end $$;

create function public.om_material_config() returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not coalesce(public.is_active_member(),false) then raise exception 'Active membership required' using errcode='42501'; end if;
 return jsonb_build_object(
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) order by code,id) from public.stock_material_categories where archived_at is null),'[]'::jsonb),
 'owner_warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) order by code,id) from public.owner_material_warehouses where archived_at is null),'[]'::jsonb),
 'steps',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'position',position,'percentage',percentage::text) order by position,id) from public.owner_material_reconciliation_steps where archived_at is null),'[]'::jsonb));
end $$;

revoke all on function public.om_material_lines(uuid,uuid,integer,integer),public.om_material_rollup(uuid,integer,integer,uuid),public.om_material_config() from public,anon,authenticated;
grant execute on function public.om_material_lines(uuid,uuid,integer,integer),public.om_material_rollup(uuid,integer,integer,uuid),public.om_material_config() to authenticated;

create function public.om_material_section_rollup(p_work_order_id uuid)
returns table(section_id uuid,section_code text,section_name text,owner_cost_code text,line_count bigint,
 requested_pct text,set_aside_pct text,received_pct text,issued_pct text,closing_pct text,
 reconciliation_step_id uuid,reconciliation_step text,reconciliation_pct text,as_of date)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not coalesce(public.is_active_member(),false) then raise exception 'Active membership required' using errcode='42501';end if;
 if (select count(*) from public.work_order_sections s join public.work_orders w on w.id=s.work_order_id
 join public.projects j on j.id=w.project_id where s.work_order_id=p_work_order_id and s.archived_at is null)>200 then
 raise exception 'Too many sections' using detail='material-invalid';end if;
 return query with stages as (
 select t.section_id,count(*) n,avg(t.requested_pct) requested,avg(t.set_aside_pct) reserved,avg(t.received_pct) received,
 avg(t.issued_pct) issued,avg(t.closing_pct) closing,max(t.as_of) as_of from public.owner_material_stage_totals t
 where t.work_order_id=p_work_order_id group by t.section_id
 ) select s.id,s.code,s.name,s.owner_cost_code,coalesce(t.n,0),t.requested::text,t.reserved::text,t.received::text,t.issued::text,t.closing::text,
 r.id,r.name,r.percentage::text,t.as_of from public.work_order_sections s
 join public.work_orders w on w.id=s.work_order_id join public.projects j on j.id=w.project_id
 left join stages t on t.section_id=s.id left join public.owner_material_reconciliation c on c.section_id=s.id
 left join public.owner_material_reconciliation_steps r on r.id=c.step_id
 where s.work_order_id=p_work_order_id and s.archived_at is null and s.org_id=(select public.auth_org_id())
 order by s.name,s.id;
end $$;
revoke all on function public.om_material_section_rollup(uuid) from public,anon,authenticated;
grant execute on function public.om_material_section_rollup(uuid) to authenticated;

-- No client flag confers the allocation exception: only this function owns the witness.
create function public.om_material_import(p_source_key text,p_schema_version integer,p_payload jsonb,p_confirm boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare
 v_org uuid:=public.auth_org_id(); v_uid uuid:=auth.uid();v_batch uuid;v_project uuid;
 v_results jsonb:='[]';v_result jsonb;v_entity jsonb;v_line jsonb;v_open jsonb;v_existing jsonb;v_ids jsonb;
 v_wo public.work_orders;v_section public.work_order_sections;v_plan public.work_order_section_material_plan;
 v_item public.stock_items;v_category uuid;v_id uuid;v_unit uuid;v_tag uuid;v_type text;v_status text;
 v_hash text;v_old_hash text;v_old_ids jsonb;v_before jsonb;v_after jsonb;v_quantity numeric;v_q numeric;
 v_requested numeric;v_reserved numeric;v_received numeric;v_issued numeric;v_returned numeric;v_in numeric;v_out numeric;v_owner numeric;
 v_closing numeric;v_flag boolean;v_asof date;v_count integer;v_key text;v_code text;v_name text;v_err text;v_message text;
begin
 perform public.assert_is_active_member();perform public.assert_not_light();
 if public.auth_role() is distinct from 'Admin' then raise exception 'Admin required' using errcode='42501';end if; -- mut:material_import_admin
 if p_source_key is null or length(btrim(p_source_key)) not between 1 and 200 or p_schema_version is distinct from 2
 or p_confirm is null or jsonb_typeof(p_payload) is distinct from 'object'
 or coalesce(p_payload->>'kind','') not in ('catalogue','section')
 or jsonb_typeof(p_payload->'entities') is distinct from 'array'
 or jsonb_array_length(p_payload->'entities')<1
 or jsonb_array_length(p_payload->'entities')>(case when p_payload->>'kind'='catalogue' then 500 else 1 end) then
 raise exception 'Invalid import envelope' using errcode='P0001',detail='material-invalid';end if;
 v_project:=(p_payload->>'project_id')::uuid;
 if not exists(select 1 from public.projects j where j.id=v_project and j.org_id=v_org and j.archived_at is null) then
 raise exception 'Project unavailable' using errcode='42501';end if; -- mut:material_import_org
 perform pg_advisory_xact_lock(hashtextextended('om-source:'||v_org::text||':'||p_source_key,0));
 -- Locks outside the preview subtransaction are retained through the validation decision.
 if p_payload->>'kind'='section' then
 perform pg_advisory_xact_lock(hashtextextended('om-order:'||v_project::text||':'||btrim(p_payload->'entities'->0->>'owner_order_number'),0));
 end if;
 begin
 select b.id into v_batch from public.owner_material_import_batches b where b.org_id=v_org and b.source_key=p_source_key for update;
 if v_batch is null then
 insert into public.owner_material_import_batches(org_id,source_key,schema_version,created_by)
 values(v_org,p_source_key,p_schema_version,v_uid) returning id into v_batch;
 end if;
 insert into public.owner_material_import_witness values(txid_current(),pg_backend_pid(),v_org,v_uid,v_batch);
 for v_entity in select e from jsonb_array_elements(p_payload->'entities') e order by e->>'entity_key' loop
 v_key:=v_entity->>'entity_key';v_hash:=v_entity->>'hash';
 if length(coalesce(v_key,'')) not between 1 and 500 or length(coalesce(v_hash,'')) not between 1 and 200 then
 raise exception 'Entity identity required' using errcode='P0001',detail='material-invalid';end if;
 select r.payload_hash,r.result_ids into v_old_hash,v_old_ids from public.owner_material_import_rows r where r.batch_id=v_batch and r.entity_key=v_key;
 if v_old_hash=v_hash then
 v_results:=v_results||jsonb_build_array(jsonb_build_object('entity_key',v_key,'status','skip','ids',v_old_ids));continue;
 end if;
 v_status:=case when v_old_hash is null then 'create' else 'update' end;
 if p_payload->>'kind'='catalogue' then
 v_type:=v_entity->>'type';v_code:=btrim(v_entity->>'code');v_name:=btrim(v_entity->>'name');
 if coalesce(v_code,'')='' or coalesce(v_name,'')='' then raise exception 'Code and name required' using detail='material-invalid';end if;
 if v_type='category' then
 select c.id into v_id from public.stock_material_categories c where c.org_id=v_org and c.code=v_code and c.archived_at is null;
 if v_id is null then insert into public.stock_material_categories(org_id,code,name) values(v_org,v_code,v_name) returning id into v_id;
 elsif not exists(select 1 from public.stock_material_categories c where c.id=v_id and c.name=v_name) then raise exception 'Catalogue conflict' using detail='material-conflict';end if;
 v_ids:=jsonb_build_object('category_id',v_id);
 elsif v_type='owner_warehouse' then
 select c.id into v_id from public.owner_material_warehouses c where c.org_id=v_org and c.code=v_code and c.archived_at is null;
 if v_id is null then insert into public.owner_material_warehouses(org_id,code,name) values(v_org,v_code,v_name) returning id into v_id;
 elsif not exists(select 1 from public.owner_material_warehouses c where c.id=v_id and c.name=v_name) then raise exception 'Catalogue conflict' using detail='material-conflict';end if;
 v_ids:=jsonb_build_object('owner_warehouse_id',v_id);
 elsif v_type='item' then
 select u.id into v_unit from public.stock_units u where u.org_id=v_org and u.code=btrim(v_entity->>'unit') and u.archived_at is null;
 v_tag:=(v_entity->>'zero_cost_tag_id')::uuid;
 if v_unit is null or not exists(select 1 from public.stock_tags t where t.id=v_tag and t.org_id=v_org and t.zero_cost and t.archived_at is null) then
 raise exception 'Existing unit and zero-cost tag required' using detail='material-invalid';end if;
 select * into v_item from public.stock_items i where i.org_id=v_org and btrim(i.code)=v_code;
 if v_item.id is null then
 insert into public.stock_items(org_id,code,name,unit_id,tag_id) values(v_org,v_code,v_name,v_unit,v_tag) returning * into v_item;
 elsif v_item.name<>v_name or v_item.unit_id<>v_unit or v_item.tag_id is distinct from v_tag or v_item.archived_at is not null then
 raise exception 'Item conflicts with existing catalogue' using detail='material-conflict';end if;
 v_ids:=jsonb_build_object('item_id',v_item.id);
 else raise exception 'Unknown catalogue type' using detail='material-invalid';end if;
 v_results:=v_results||jsonb_build_array(jsonb_build_object('entity_key',v_key,'status',v_status,'ids',v_ids));
 else
 if jsonb_typeof(v_entity->'lines') is distinct from 'array' or jsonb_array_length(v_entity->'lines') not between 1 and 200
 or v_entity->>'as_of' is null or v_entity->>'as_of' !~ '^\d{4}-\d{2}-\d{2}$'
 or coalesce(v_entity->>'closing_conflict','refuse') not in ('refuse','movements_win') then
 raise exception 'Invalid section' using detail='material-invalid';end if;
 v_asof:=(v_entity->>'as_of')::date;
 select count(*) into v_count from public.work_orders w where w.org_id=v_org and w.project_id=v_project and
 (btrim(w.wo_number)=btrim(v_entity->>'owner_order_number') or btrim(w.client_po_number)=btrim(v_entity->>'owner_order_number'));
 if v_count=0 then raise exception 'Work order must exist before material import' using detail='material-work-order-missing';end if;
 if v_count<>1 then raise exception 'Ambiguous work order' using detail='material-conflict';end if;
 select * into v_wo from public.work_orders w where w.org_id=v_org and w.project_id=v_project and
 (btrim(w.wo_number)=btrim(v_entity->>'owner_order_number') or btrim(w.client_po_number)=btrim(v_entity->>'owner_order_number')) for update;
 if v_wo.status not in ('Draft','Issued') then raise exception 'Work order is frozen' using detail='material-conflict';end if;
 select count(*) into v_count from public.work_order_sections s where s.work_order_id=v_wo.id and lower(btrim(s.name))=lower(btrim(v_entity->>'location_name'));
 if v_count>1 then raise exception 'Ambiguous section' using detail='material-conflict';end if;
 select * into v_section from public.work_order_sections s where s.work_order_id=v_wo.id and lower(btrim(s.name))=lower(btrim(v_entity->>'location_name')) for update;
 if v_section.id is null then
 insert into public.work_order_sections(org_id,project_id,work_order_id,code,name,owner_cost_code)
 values(v_org,v_project,v_wo.id,v_entity->>'section_code',btrim(v_entity->>'location_name'),v_entity->>'owner_cost_code') returning * into v_section;
 elsif v_section.archived_at is not null then raise exception 'Section is archived' using detail='material-conflict';
 else update public.work_order_sections set owner_cost_code=v_entity->>'owner_cost_code' where id=v_section.id;end if;
 if (select count(distinct e->>'item_code') from jsonb_array_elements(v_entity->'lines') e)<>jsonb_array_length(v_entity->'lines')
 or (select count(distinct e->>'entity_key') from jsonb_array_elements(v_entity->'lines') e)<>jsonb_array_length(v_entity->'lines') then
 raise exception 'Repeated material identity' using detail='material-conflict';end if;
 for v_line in select l from jsonb_array_elements(v_entity->'lines') l order by l->>'entity_key' loop
 if length(coalesce(v_line->>'entity_key','')) not between 1 and 500 or length(coalesce(v_line->>'hash','')) not between 1 and 200
 or jsonb_typeof(v_line->'opening') is distinct from 'object' or jsonb_typeof(v_line->'evidence') is distinct from 'object'
 or octet_length((v_line->'evidence')::text)>32768 then raise exception 'Invalid line identity or evidence' using detail='material-invalid';end if;
 select * into v_item from public.stock_items i where i.org_id=v_org and i.code=btrim(v_line->>'item_code') and i.archived_at is null;
 if v_item.id is null or not exists(select 1 from public.stock_units u where u.id=v_item.unit_id and u.org_id=v_org and u.code=btrim(v_line->>'unit'))
 or not exists(select 1 from public.stock_tags t where t.id=v_item.tag_id and t.org_id=v_org and t.zero_cost) then
 raise exception 'Item or unit unavailable' using detail='material-invalid';end if;
 v_category:=null;
 if nullif(v_line->>'category_code','') is not null then
 select c.id into v_category from public.stock_material_categories c where c.org_id=v_org and c.code=v_line->>'category_code' and c.archived_at is null;
 if v_category is null then raise exception 'Category unavailable' using detail='material-invalid';end if;end if;
 if coalesce(v_line->>'planned','') !~ '^\d{1,11}(\.\d{1,3})?$' then raise exception 'Invalid planned quantity' using detail='material-invalid';end if;
 v_quantity:=(v_line->>'planned')::numeric;
 if v_quantity<=0 then raise exception 'Planned quantity must be positive' using detail='material-invalid';end if;
 v_open:=v_line->'opening';
 foreach v_type in array array['requested','set_aside','received','issued','returned','transfer_in','transfer_out','owner_return'] loop
 if coalesce(v_open->>v_type,'') !~ '^\d{1,11}(\.\d{1,3})?$' then raise exception 'Invalid opening quantity' using detail='material-invalid';end if;
 end loop;
 v_requested:=(v_open->>'requested')::numeric;v_reserved:=(v_open->>'set_aside')::numeric;
 v_received:=(v_open->>'received')::numeric;v_issued:=(v_open->>'issued')::numeric;v_returned:=(v_open->>'returned')::numeric;
 v_in:=(v_open->>'transfer_in')::numeric;v_out:=(v_open->>'transfer_out')::numeric;v_owner:=(v_open->>'owner_return')::numeric;
 v_closing:=v_received+v_in-v_issued+v_returned-v_out-v_owner;
 v_flag:=v_closing<0 or (v_line->'expected'->>'closing') is null or (v_line->'expected'->>'closing')::numeric<>v_closing;
 if v_flag and coalesce(v_entity->>'closing_conflict','refuse')<>'movements_win' then raise exception 'Closing totals disagree' using detail='material-invalid';end if;
 select * into v_plan from public.work_order_section_material_plan p where p.section_id=v_section.id and p.item_id=v_item.id for update;
 v_before:=null;
 if v_plan.id is not null then
 select to_jsonb(o) into v_existing from public.owner_material_openings o where o.section_material_plan_id=v_plan.id;
 if v_existing is not null and (v_existing->>'import_batch_id')::uuid<>v_batch then raise exception 'Opening belongs to another source' using detail='material-overlap';end if;
 if v_existing is null and (exists(select 1 from public.client_requisition_lines l join public.client_requisitions r on r.id=l.requisition_id where l.section_material_plan_id=v_plan.id and r.status<>'cancelled')
 or exists(select 1 from public.owner_material_movement_links x where x.section_material_plan_id=v_plan.id)) then
 raise exception 'Material already has live records' using detail='material-overlap';end if;
 v_before:=jsonb_build_object('planned',v_plan.quantity::text,'opening',v_existing);
 update public.work_order_section_material_plan set quantity=v_quantity,category_id=v_category,import_batch_id=v_batch where id=v_plan.id;
 else
 insert into public.work_order_section_material_plan(org_id,work_order_id,section_id,item_id,quantity,category_id,import_batch_id)
 values(v_org,v_wo.id,v_section.id,v_item.id,v_quantity,v_category,v_batch) returning * into v_plan;
 end if;
 insert into public.owner_material_openings(org_id,section_material_plan_id,as_of,requested,set_aside,received,issued,returned,transfer_in,transfer_out,owner_return,evidence,import_batch_id,created_by)
 values(v_org,v_plan.id,v_asof,v_requested,v_reserved,v_received,v_issued,v_returned,v_in,v_out,v_owner,v_line->'evidence',v_batch,v_uid)
 on conflict(section_material_plan_id) do update set as_of=excluded.as_of,requested=excluded.requested,set_aside=excluded.set_aside,
 received=excluded.received,issued=excluded.issued,returned=excluded.returned,transfer_in=excluded.transfer_in,transfer_out=excluded.transfer_out,
 owner_return=excluded.owner_return,evidence=excluded.evidence,updated_at=now();
 v_ids:=jsonb_build_object('work_order_id',v_wo.id,'section_id',v_section.id,'plan_id',v_plan.id,'document_ids','[]'::jsonb);
 v_after:=jsonb_build_object('planned',v_quantity::text,'opening',v_open,'closing',v_closing::text);
 v_results:=v_results||jsonb_build_array(jsonb_build_object('entity_key',v_line->>'entity_key','status',case when v_before is null then 'create' else 'update' end,
 'ids',v_ids,'before',v_before,'after',v_after,'flagged',v_flag,'sheet',v_entity->>'sheet','row',v_line->'row'));
 insert into public.owner_material_import_rows(batch_id,org_id,entity_key,payload_hash,result_ids) values(v_batch,v_org,v_line->>'entity_key',v_line->>'hash',v_ids)
 on conflict(batch_id,entity_key) do update set payload_hash=excluded.payload_hash,result_ids=excluded.result_ids;
 end loop;
 end if;
 insert into public.owner_material_import_rows(batch_id,org_id,entity_key,payload_hash,result_ids) values(v_batch,v_org,v_key,v_hash,v_ids)
 on conflict(batch_id,entity_key) do update set payload_hash=excluded.payload_hash,result_ids=excluded.result_ids;
 end loop;
 delete from public.owner_material_import_witness where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 if not p_confirm then raise exception using errcode='MTPRV',message='Preview rollback';end if;
 exception when sqlstate 'MTPRV' then v_batch:=null;
 when others then
 get stacked diagnostics v_err=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
 if v_err not in ('material-invalid','material-conflict','material-overlap','material-work-order-missing') or v_err is null or v_err='' then v_err:='material-invalid';end if;
 return jsonb_build_object('batch_id',null,'complete',false,'results',jsonb_build_array(jsonb_build_object('entity_key',coalesce(v_key,''),'status','refused','ids','{}'::jsonb,
 'reason',v_err,'sheet',v_entity->>'sheet','row',coalesce(v_line->'row',v_entity->'row'))));
 end;
 return jsonb_build_object('batch_id',v_batch,'results',v_results,'complete',true);
end $$;
revoke all on function public.om_material_import(text,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.om_material_import(text,integer,jsonb,boolean) to authenticated;

create function public.om_material_set_scale(p_steps jsonb) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.auth_org_id();v_step jsonb;v_previous numeric:=-1;v_pct numeric;v_id uuid;
begin
 perform public.assert_is_active_member();perform public.assert_not_light();
 if public.auth_role() is distinct from 'Admin' then raise exception 'Admin required' using errcode='42501';end if; -- mut:material_scale_admin
 if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) not between 1 and 20 then
 raise exception 'Scale requires 1 to 20 steps' using detail='material-invalid';end if;
 if (select count(distinct lower(btrim(e->>'name'))) from jsonb_array_elements(p_steps) e)<>jsonb_array_length(p_steps)
 or (select count(distinct (e->>'position')::integer) from jsonb_array_elements(p_steps) e)<>jsonb_array_length(p_steps) then
 raise exception 'Scale steps must be unique' using detail='material-invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('om-scale:'||v_org::text,0));
 for v_step in select e from jsonb_array_elements(p_steps) e order by (e->>'position')::integer loop
 if coalesce(v_step->>'name','')='' or coalesce(v_step->>'percentage','') !~ '^\d{1,3}(\.\d{1,3})?$'
 or coalesce((v_step->>'position')::integer,0)<=0 then raise exception 'Invalid scale step' using detail='material-invalid';end if;
 v_pct:=(v_step->>'percentage')::numeric;
 if v_pct<=v_previous or v_pct>100 then raise exception 'Percentages must increase' using detail='material-invalid';end if;
 v_previous:=v_pct;
 end loop;
 if v_previous<>100 then raise exception 'Scale must end at 100' using detail='material-invalid';end if;
 update public.owner_material_reconciliation_steps set archived_at=now() where org_id=v_org and archived_at is null;
 for v_step in select e from jsonb_array_elements(p_steps) e order by (e->>'position')::integer loop
 insert into public.owner_material_reconciliation_steps(org_id,position,name,percentage)
 values(v_org,(v_step->>'position')::integer,btrim(v_step->>'name'),(v_step->>'percentage')::numeric);
 end loop;
 return jsonb_build_object('count',jsonb_array_length(p_steps));
end $$;

create function public.om_material_set_reconciliation(p_section_id uuid,p_step_id uuid,p_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.auth_org_id();v_section public.work_order_sections;v_wo public.work_orders;
 v_step public.owner_material_reconciliation_steps;v_old public.owner_material_reconciliation;v_old_pct numeric;
begin
 perform public.assert_is_active_member();perform public.assert_not_light();perform public.csr_assert_recorder();
 select * into v_section from public.work_order_sections s where s.id=p_section_id and s.org_id=v_org for update;
 if v_section.id is null then raise exception 'Section unavailable' using errcode='42501';end if; -- mut:material_reconciliation_org
 select * into v_wo from public.work_orders w where w.id=v_section.work_order_id and w.org_id=v_org for update;
 if v_wo.id is null or v_wo.status not in ('Draft','Issued') or v_section.archived_at is not null then
 raise exception 'Section is frozen' using detail='material-conflict';end if;
 select * into v_step from public.owner_material_reconciliation_steps s where s.id=p_step_id and s.org_id=v_org and s.archived_at is null;
 if v_step.id is null then raise exception 'Step unavailable' using errcode='42501';end if;
 select * into v_old from public.owner_material_reconciliation r where r.section_id=p_section_id for update;
 select percentage into v_old_pct from public.owner_material_reconciliation_steps where id=v_old.step_id;
 if v_step.percentage<v_old_pct and nullif(btrim(p_reason),'') is null then
 raise exception 'Moving backwards requires a reason' using detail='material-invalid';end if;
 insert into public.owner_material_reconciliation(org_id,section_id,step_id,changed_by,reason)
 values(v_org,p_section_id,p_step_id,auth.uid(),nullif(btrim(p_reason),''))
 on conflict(section_id) do update set step_id=excluded.step_id,changed_by=excluded.changed_by,changed_on=now(),reason=excluded.reason;
 insert into public.owner_material_reconciliation_events(org_id,section_id,previous_step_id,step_id,changed_by,reason)
 values(v_org,p_section_id,v_old.step_id,p_step_id,auth.uid(),nullif(btrim(p_reason),''));
 return jsonb_build_object('section_id',p_section_id,'step_id',p_step_id,'percentage',v_step.percentage::text);
end $$;
revoke all on function public.om_material_set_scale(jsonb),public.om_material_set_reconciliation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.om_material_set_scale(jsonb),public.om_material_set_reconciliation(uuid,uuid,text) to authenticated;

create function public.om_material_seed_scale() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.owner_material_reconciliation_steps(org_id,position,name,percentage)
 select new.id,p,n,p*20 from (values(1,'Prepared'),(2,'Checked'),(3,'Submitted'),(4,'Agreed'),(5,'Closed')) t(p,n);
 return new;
end $$;
revoke all on function public.om_material_seed_scale() from public,anon,authenticated,service_role;
create trigger owner_material_seed_scale after insert on public.organizations for each row execute function public.om_material_seed_scale();
insert into public.owner_material_reconciliation_steps(org_id,position,name,percentage)
select o.id,p,n,p*20 from public.organizations o cross join (values(1,'Prepared'),(2,'Checked'),(3,'Submitted'),(4,'Agreed'),(5,'Closed')) t(p,n);
