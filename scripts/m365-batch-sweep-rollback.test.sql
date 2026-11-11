-- Round trip for 0375 (SharePoint batch linking and folder-sweep runs): down, then up again. Run by
-- scripts/test-m365-batch-sweep-rollback.sh, which inlines the migration files at the markers.
-- The down half doubles as a mutation check: without 0375 a dry run of one folder for two projects reports both linked.
begin;
select plan(8);
insert into organizations(id,name,default_currency) values ('03759000-0000-0000-0000-0000000000c0','M365 RT','IDR');
insert into auth.users(id,email) values ('03759000-0000-0000-0000-0000000000c1','m365-rt@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
('03759000-0000-0000-0000-0000000000c1','03759000-0000-0000-0000-0000000000c0','RT Fin','m365-rt@example.com','Finance','active');
insert into projects(id,org_id,name,code) values
('03759000-0000-0000-0000-0000000000d1','03759000-0000-0000-0000-0000000000c0','RT one','RT-1'),
('03759000-0000-0000-0000-0000000000d2','03759000-0000-0000-0000-0000000000c0','RT two','RT-2');
insert into org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by) values
('03759000-0000-0000-0000-0000000000c0','x.sharepoint.com,site-a,web-a','Site','drive-a','Library','03759000-0000-0000-0000-0000000000c1');
create function pg_temp.conflict_dry_run() returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims','{"sub":"03759000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
  perform public.link_m365_documents_batch('[{"project_id":"03759000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f1","name":"F1","kind":"folder"},{"project_id":"03759000-0000-0000-0000-0000000000d2","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f1","name":"F1","kind":"folder"}]'::jsonb,true);
  return 'accepted';
exception when sqlstate '23514' then return 'refused';
end $$;

-- @0375_DOWN@
select is(pg_temp.conflict_dry_run(),'accepted','down: the 0372 batch dry run does not see the batch''s own conflict');
select ok(to_regprocedure('public.m365_record_folder_sweep_save(uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb,jsonb)') is null,'down: the sweep save function is dropped');
select hasnt_column('public','m365_record_folder_sweeps','run_id','down: the run id column is dropped');
select hasnt_column('public','m365_record_folder_sweeps','next_cursor','down: the next cursor column is dropped');

-- @0375_UP@
select is(pg_temp.conflict_dry_run(),'refused','up: the dry run predicts the real refusal again');
select ok(to_regprocedure('public.m365_record_folder_sweep_save(uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb,jsonb)') is not null,'up: the sweep save function is back');
select has_column('public','m365_record_folder_sweeps','last_cursor','up: the last cursor column is back');
select ok(not has_function_privilege('authenticated','public.m365_record_folder_sweep_save(uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb,jsonb)','execute'),'up: the sweep save function stays service-only');
select * from finish();
rollback;
