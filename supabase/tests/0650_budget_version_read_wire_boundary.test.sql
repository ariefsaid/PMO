-- Full serialized RPC response at the many-version wire boundary; all fixture data rolls back.
begin;
select no_plan();
insert into public.organizations(id,name,default_currency) values
 ('06510000-0000-0000-0000-000000000001','Wire budget org','USD');
insert into auth.users(id,email) values
 ('06510000-0000-0000-0000-000000000001','wire650@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('06510000-0000-0000-0000-000000000001','06510000-0000-0000-0000-000000000001','Wire reader','wire650@example.test','Admin','active');
insert into public.projects(id,org_id,code,name,status) values
 ('06510000-0000-0000-0000-000000000010','06510000-0000-0000-0000-000000000001','WIRE650','Wire boundary','Ongoing Project');
insert into public.budget_versions(id,org_id,project_id,version,name,status)
 select ('06510000-0000-0000-0001-' || lpad(i::text,12,'0'))::uuid,
 '06510000-0000-0000-0000-000000000001','06510000-0000-0000-0000-000000000010',i,repeat('x',7000),'Draft'
 from generate_series(1,1000) i;
insert into public.budget_line_items(org_id,budget_version_id,category,budgeted_amount)
 select '06510000-0000-0000-0000-000000000001',id,'Labor',999999999999.99
 from public.budget_versions where project_id='06510000-0000-0000-0000-000000000010';
-- Set old census just 30 KB below the limit, distributing padding across all 1000 rows.
-- Its response envelopes add substantially more than 30 KB.
with census as (
 select (select sum(octet_length(to_json(v)::text)) from public.budget_versions v where v.project_id='06510000-0000-0000-0000-000000000010')
      + (select sum(octet_length(to_json(li)::text)) from public.budget_line_items li join public.budget_versions v on v.id=li.budget_version_id where v.project_id='06510000-0000-0000-0000-000000000010') + 2000 + 1024 as bytes
), padding as (select (8388608 - 30000 - bytes)::int as n from census)
update public.budget_versions v set name = v.name || repeat('x', p.n / 1000 + case when v.version <= p.n % 1000 then 1 else 0 end)
from padding p where v.project_id='06510000-0000-0000-0000-000000000010';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"06510000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select ok((select bool_or(overflow) or octet_length(json_agg(row_to_json(r))::text) > 8388608 from public.budget_version_read('06510000-0000-0000-0000-000000000010',0,1000) r),'near-limit response is a marker or exceeds the wire cap');
select is((select count(*)::int from public.budget_version_read('06510000-0000-0000-0000-000000000010',0,1000) where overflow),1,'near-limit many-version response returns overflow marker');
reset role;
update public.budget_versions set name=left(name,length(name)-300)
 where project_id='06510000-0000-0000-0000-000000000010';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"06510000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read('06510000-0000-0000-0000-000000000010',0,1000) where not overflow and total=999999999999.99),1000,'below-limit response retains every version and sizeable total');
select ok((select octet_length(coalesce(json_agg(row_to_json(r))::text,'[]')) <= 8388608 from public.budget_version_read('06510000-0000-0000-0000-000000000010',0,1000) r),'serialized complete below-limit response is bounded');
select * from finish();
rollback;
