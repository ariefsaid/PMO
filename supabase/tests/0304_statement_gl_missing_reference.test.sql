-- AC-005: uncancelled GL references absent from the chart require replay; successful replay clears it.
begin;
select plan(7);

insert into public.external_org_bindings(org_id,external_tier,site_url,secret_ref,config)
values ('00000000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','synthetic-ref','{}')
on conflict (org_id,external_tier) do nothing;
insert into public.erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('00000000-0000-0000-0000-000000000001','Replay Co','Known Account','Known Account','Asset','Balance Sheet',false,'IDR',1,2,'30000000-0000-0000-0000-000000000001')
on conflict (org_id,company,erp_name) do nothing;
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,is_cancelled,erp_modified)
values
 ('00000000-0000-0000-0000-000000000001','GL-MISSING-ACCOUNT','Replay Co','Missing Account',false,'2026-01-01'),
 ('00000000-0000-0000-0000-000000000001','GL-KNOWN-ACCOUNT','Replay Co','Known Account',false,'2026-01-01'),
 ('00000000-0000-0000-0000-000000000001','GL-CANCELLED-MISSING','Replay Co','Cancelled Missing',true,'2026-01-01');
update public.external_org_bindings set statement_full_ledger_replay_needed=false, statement_update_delayed=false
where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext';

select ok(public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Replay Co'),'uncancelled missing chart reference requests replay');
select ok((select statement_full_ledger_replay_needed and statement_update_delayed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),'missing reference sets replay and delayed flags');
select ok(not public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Other Co'),'no references for another company do not request replay');
select ok(not has_function_privilege('anon','public.mark_erp_statement_replay_for_missing_accounts(uuid,text)','EXECUTE'),'anon cannot invoke replay detection');

update public.erp_gl_entry_mirror set replay_seen_id='30000000-0000-0000-0000-000000000002'
where erp_name='GL-MISSING-ACCOUNT';
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,is_cancelled,erp_modified,replay_seen_id)
values ('00000000-0000-0000-0000-000000000001','GL-REPLAY-COMPLETE','Replay Co','Known Account',false,'2026-02-01','30000000-0000-0000-0000-000000000002');
select lives_ok($$select public.finish_erp_gl_replay('00000000-0000-0000-0000-000000000001','Replay Co','30000000-0000-0000-0000-000000000002','2026-02-01')$$,'completed full replay finishes');
select ok(not (select statement_full_ledger_replay_needed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),'successful replay finish clears replay flag');
select ok(public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Replay Co'),'still-unresolved reference keeps replay requested after finish');
select * from finish();
rollback;
