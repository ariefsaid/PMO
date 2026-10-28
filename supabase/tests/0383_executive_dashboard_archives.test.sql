-- 0383 (#1293): archived projects are excluded from every executive project aggregate.
begin;
select plan(18);

insert into organizations (id,name,default_currency)
values ('03830000-0000-0000-0000-00000000000a','Dashboard archive test org','USD');
insert into auth.users (id,email)
values ('03830000-0000-0000-0000-0000000000a1','dashboard-archive@example.test');
insert into profiles (id,org_id,full_name,email,role,status)
values ('03830000-0000-0000-0000-0000000000a1','03830000-0000-0000-0000-00000000000a',
        'Dashboard Reader','dashboard-archive@example.test','Executive','active');
insert into projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,
                      tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat) values
  ('03830000-0000-0000-0000-0000000000d1','03830000-0000-0000-0000-00000000000a','Current delivery','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false),
  ('03830000-0000-0000-0000-0000000000d2','03830000-0000-0000-0000-00000000000a','Archived delivery','Ongoing Project','USD',9000,'exclusive',0,0,1,1,false),
  ('03830000-0000-0000-0000-0000000000d3','03830000-0000-0000-0000-00000000000a','Current pipeline','Tender Submitted','USD',400,'exclusive',0,0,1,1,false),
  ('03830000-0000-0000-0000-0000000000d4','03830000-0000-0000-0000-00000000000a','Archived pipeline','Tender Submitted','USD',8000,'exclusive',0,0,1,1,false);
update projects set archived_at=now()
where id in ('03830000-0000-0000-0000-0000000000d2','03830000-0000-0000-0000-0000000000d4');

set local role authenticated;
set local request.jwt.claims to '{"sub":"03830000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((get_executive_dashboard()->>'active_projects')::int,1,
  'AC-1293: active project count excludes archived delivery projects');
select is((get_executive_dashboard()->>'total_contract_value')::numeric,1000::numeric,
  'AC-1293: active contract value excludes archived delivery projects');
select is((get_executive_dashboard()->>'on_hand_value')::numeric,1000::numeric,
  'AC-1293: on-hand contract value excludes archived delivery projects');
select is((get_executive_dashboard()->>'on_hand_actual_project_total')::int,1,
  'AC-1293: spending coverage project total excludes archived delivery projects');
select is((get_executive_dashboard()->>'on_hand_actual_coverage_total')::int,1,
  'AC-1293: spending category coverage excludes archived delivery projects');
select is((get_executive_dashboard()->>'active_delivery_projects')::int,1,
  'AC-1293: active-delivery count excludes archived projects');
select is((get_executive_dashboard()->>'active_delivery_actual_project_count')::int,1,
  'AC-1293: active-delivery Actual coverage count excludes archived projects');
select is((get_executive_dashboard()->>'active_delivery_actual_project_total')::int,1,
  'AC-1293: active-delivery Actual coverage denominator excludes archived projects');
select is((get_executive_dashboard()->>'active_delivery_actual_coverage_total')::int,1,
  'AC-1293: active-delivery category coverage excludes archived projects');
select is((get_executive_dashboard()->>'active_delivery_actual_coverage_count')::int,1,
  'AC-1293: known active-delivery category coverage excludes archived projects');
select is(json_array_length(get_executive_dashboard()->'on_hand_value_by_currency'),1,
  'AC-1293: per-currency contract split excludes archived delivery projects');
select is((select (value->>'contract_value')::numeric
           from json_array_elements(get_executive_dashboard()->'on_hand_value_by_currency') value
           where value->>'currency'='USD'),1000::numeric,
  'AC-1293: the retained currency amount excludes archived contract value');
select is((get_executive_dashboard()->>'pipeline_total_value')::numeric,400::numeric,
  'AC-1293: pipeline total excludes archived pipeline projects');
select is((select (value->>'count')::int
           from json_array_elements(get_executive_dashboard()->'projects_by_status') value
           where value->>'status'='Ongoing Project'),1,
  'AC-1293: on-hand status count excludes archived projects');
select is((select (value->>'count')::int
           from json_array_elements(get_executive_dashboard()->'projects_by_status') value
           where value->>'status'='Tender Submitted'),1,
  'AC-1293: pipeline status count excludes archived projects');
select is(json_array_length(get_executive_dashboard()->'top_projects'),1,
  'AC-1293: top project rows exclude archived projects');
select is((select count(*)::int from json_array_elements(get_executive_dashboard()->'top_projects') value
           where value->>'name'='Archived delivery'),0,
  'AC-1293: archived on-hand project does not appear in the ranked project list');
select is((select value->>'name' from json_array_elements(get_executive_dashboard()->'top_projects') value
           limit 1),'Current delivery',
  'AC-1293: current on-hand project remains in the ranked project list');

reset role;
select * from finish();
rollback;
