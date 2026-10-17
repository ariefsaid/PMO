-- AC-005: only a fully completed replay finishes mark-and-sweep reconciliation.
begin;
select plan(16);

insert into public.organizations(id, name) values ('00000000-0000-0000-0000-000000000002','Replay Other Org') on conflict (id) do nothing;
insert into public.external_org_bindings(org_id, external_tier, site_url, secret_ref, config, statement_full_ledger_replay_needed)
values ('00000000-0000-0000-0000-000000000001','erpnext','https://replay.example.test','synthetic-ref','{"company":"Replay Co"}',true)
on conflict (org_id, external_tier) do update set config=excluded.config, statement_full_ledger_replay_needed=true;

insert into public.erp_gl_entry_mirror(org_id, erp_name, company, account, erp_modified, replay_seen_id) values
 ('00000000-0000-0000-0000-000000000001','GL-REPLAY-SEEN','Replay Co','A','2026-01-01','10000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000001','GL-REPLAY-OMIT','Replay Co','B','2026-01-01',null),
 ('00000000-0000-0000-0000-000000000001','GL-OTHER-COMPANY','Other Co','C','2026-01-01',null),
 ('00000000-0000-0000-0000-000000000001','GL-LEGACY-NULL',null,'Legacy','2026-01-01',null),
 ('00000000-0000-0000-0000-000000000002','GL-OTHER-ORG','Replay Co','D','2026-01-01',null);

select lives_ok(
 $$select public.finish_erp_gl_replay('00000000-0000-0000-0000-000000000001','Replay Co','10000000-0000-0000-0000-000000000001','2026-02-01')$$,
 'complete replay finish succeeds atomically');
select is((select count(*)::integer from public.erp_gl_entry_mirror where org_id='00000000-0000-0000-0000-000000000001' and company='Replay Co' and erp_name='GL-REPLAY-OMIT'),0,'unseen historical row is deleted');
select is((select replay_seen_id from public.erp_gl_entry_mirror where erp_name='GL-REPLAY-SEEN'),null::uuid,'seen mark is cleared on finish');
select is((select count(*)::integer from public.erp_gl_entry_mirror where erp_name='GL-OTHER-COMPANY'),0,'old-company rows retire after complete bound-company replay');
select is((select count(*)::integer from public.erp_gl_entry_mirror where erp_name='GL-LEGACY-NULL'),0,'legacy NULL-company rows retire only after complete replay');
select is((select count(*)::integer from public.erp_gl_entry_mirror where erp_name='GL-OTHER-ORG'),1,'other org is untouched');
select is((select statement_full_ledger_replay_needed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),false,'successful replay clears replay-needed flag only for bound company');
select is((select watermark_cursor from public.external_sync_watermarks where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext' and domain='ledger::GL Entry'),'2026-02-01','watermark advances with finish');

-- Legacy NULL-company rows keep counting before the first complete replay finishes.
insert into public.erp_gl_entry_mirror(org_id, erp_name, company, account, erp_modified)
values ('00000000-0000-0000-0000-000000000001','GL-LEGACY-PENDING',null,'Legacy','2026-01-01');
update public.external_org_bindings set config='{"company":"Next Co"}', statement_full_ledger_replay_needed=true
 where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext';
select is((select count(*)::integer from public.erp_gl_entry_mirror where erp_name='GL-LEGACY-PENDING'),1,'legacy NULL rows remain until next full replay completion');
select lives_ok($$select public.finish_erp_gl_replay('00000000-0000-0000-0000-000000000001','Replay Co','30000000-0000-0000-0000-000000000001','2026-03-01')$$,'stale company replay is a safe no-op');
select is((select statement_full_ledger_replay_needed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),true,'company change during in-flight replay leaves replay-needed set');
select is((select count(*)::integer from public.erp_gl_entry_mirror where erp_name='GL-LEGACY-PENDING'),1,'stale replay cannot retire legacy rows');

-- A partial replay only stamps its fetched row. Without the finish RPC it cannot delete or advance.
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,erp_modified)
values ('00000000-0000-0000-0000-000000000001','GL-OTHER-COMPANY','Other Co','C','2026-01-01');
update public.erp_gl_entry_mirror set replay_seen_id='20000000-0000-0000-0000-000000000001' where erp_name='GL-OTHER-COMPANY';
select is((select count(*)::integer from public.erp_gl_entry_mirror where erp_name='GL-OTHER-COMPANY'),1,'partial replay leaves omitted rows intact');
select is((select watermark_cursor from public.external_sync_watermarks where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext' and domain='ledger::GL Entry'),'2026-02-01','partial replay does not move watermark');
select ok(not has_function_privilege('anon','public.finish_erp_gl_replay(uuid,text,uuid,text)','EXECUTE'),'anon cannot execute finish RPC');
select ok(not has_function_privilege('authenticated','public.finish_erp_gl_replay(uuid,text,uuid,text)','EXECUTE'),'authenticated cannot execute finish RPC');
select * from finish();
rollback;
