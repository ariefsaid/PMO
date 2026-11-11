-- m365_record_folder_sweep_save.test.sql — the folder-sweep summary (0375) is idempotent per run and page: a replayed
-- continuation adds nothing, a page of an older run never appends to a newer run's summary, and the stored
-- unmatched list stays de-duplicated and capped at 500. Service-only; the app reads the row through RLS.
begin;
select plan(19);
insert into organizations(id,name,default_currency) values ('03750000-0000-0000-0000-0000000001c0','Sweep summary','IDR');
insert into auth.users(id,email) values ('03750000-0000-0000-0000-0000000001c6','ss-admin@example.com'),('03750000-0000-0000-0000-0000000001c7','ss-admin2@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-0000000001c0','Admin','ss-admin@example.com','Admin','active'),
('03750000-0000-0000-0000-0000000001c7','03750000-0000-0000-0000-0000000001c0','Admin two','ss-admin2@example.com','Admin','active');
create function pg_temp.save(p_actor text,p_run text,p_start boolean,p_from jsonb,p_next jsonb,p_scanned int,p_unmatched jsonb default '[]')
returns text language sql as $$
  select public.m365_record_folder_sweep_save('03750000-0000-0000-0000-0000000001c0',p_actor::uuid,p_run::uuid,p_start,p_from,p_next,
    jsonb_build_object('scanned',p_scanned,'linked',p_scanned,'needs_choice',0,'missing',0,'failed',0,'skipped',0),p_unmatched) $$;
create function pg_temp.row() returns public.m365_record_folder_sweeps language sql as $$
  select * from public.m365_record_folder_sweeps where org_id='03750000-0000-0000-0000-0000000001c0' $$;

set local role authenticated;
select throws_ok($q$select public.m365_record_folder_sweep_save(null,null,null,true,null,null,null,null)$q$,'42501',null,
  'an app user cannot write the sweep summary');
reset role;
set local role service_role;

select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa01',true,'{"kind":"project","after":null}','{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}',5),'accepted','the first page starts a run');
select is(((pg_temp.row()).counts->>'scanned')::int,5,'the first page counts are stored');
select is((pg_temp.row()).run_id,'03750000-0000-0000-0000-00000000aa01'::uuid,'the run id is stored');
select is((pg_temp.row()).next_cursor,'{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}'::jsonb,'the next accepted cursor is stored');
select is((pg_temp.row()).state,'in_progress','an unfinished run is in progress');

select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa01',false,'{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}','{"kind":"procurement","after":null}',2),'accepted','the continuation is accepted');
select is(((pg_temp.row()).counts->>'scanned')::int,7,'continuation counts are added');
select is((pg_temp.row()).last_cursor,'{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}'::jsonb,'the last accepted page cursor is stored');

select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa01',false,'{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}','{"kind":"procurement","after":null}',2),'replayed','a replayed continuation is recognised');
select is(((pg_temp.row()).counts->>'scanned')::int,7,'a replayed continuation does not add its counts twice');
select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa01',false,'{"kind":"project","after":null}','{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}',5),'replayed','an earlier page of the same run is recognised as already counted');
select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa01',false,'{"kind":"procurement","after":"10200000-0000-0000-0001-000000000009"}',null,1),'out_of_order','a page that skips ahead of the accepted cursor is not counted');

-- A second Admin starts a new run: it replaces the summary, and the first run can no longer append to it.
select is(pg_temp.save('03750000-0000-0000-0000-0000000001c7','03750000-0000-0000-0000-00000000aa02',true,'{"kind":"project","after":null}',null,3),'accepted','a second run starts its own summary');
select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa01',false,'{"kind":"procurement","after":null}',null,4),'superseded','the older run cannot append to the newer run');
select is(((pg_temp.row()).counts->>'scanned')::int,3,'the newer run summary is untouched by the older run');
select is((pg_temp.row()).state,'complete','a run whose last page has no next cursor is complete');

-- The stored unmatched list is de-duplicated and capped at 500, flagged truncated.
select is(pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa03',true,'{"kind":"project","after":null}','{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}',1,
  (select jsonb_agg(format('00000000-0000-4000-8000-%s',lpad(i::text,12,'0'))) from generate_series(1,499) i)),'accepted','a run with 499 unmatched ids starts');
select pg_temp.save('03750000-0000-0000-0000-0000000001c6','03750000-0000-0000-0000-00000000aa03',false,'{"kind":"project","after":"10200000-0000-0000-0000-000000000005"}',null,1,
  jsonb_build_array('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000777','00000000-0000-4000-8000-000000000778'));
select ok(jsonb_array_length((pg_temp.row()).unmatched)=500 and (pg_temp.row()).unmatched_truncated
  and (select count(distinct v) from jsonb_array_elements_text((pg_temp.row()).unmatched) v)=500,
  'the unmatched list is de-duplicated, capped at 500 and flagged truncated');
reset role;
select * from finish();
rollback;
