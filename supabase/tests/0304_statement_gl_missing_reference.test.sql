-- AC-005: uncancelled GL references absent from the chart require replay; successful replay clears it.
begin;
select plan(12);

insert into public.external_org_bindings(org_id,external_tier,site_url,secret_ref,config)
values ('00000000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','synthetic-ref','{"company":"Replay Co"}')
on conflict (org_id,external_tier) do update set config=excluded.config;
insert into public.erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('00000000-0000-0000-0000-000000000001','Replay Co','Known Account','Known Account','Asset','Balance Sheet',false,'IDR',1,2,'30000000-0000-0000-0000-000000000001')
on conflict (org_id,company,erp_name) do nothing;
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,is_cancelled,erp_modified)
values
 ('00000000-0000-0000-0000-000000000001','GL-MISSING-ACCOUNT','Replay Co','Missing Account',false,'2026-01-01'),
 ('00000000-0000-0000-0000-000000000001','GL-KNOWN-ACCOUNT','Replay Co','Known Account',false,'2026-01-01'),
 ('00000000-0000-0000-0000-000000000001','GL-CANCELLED-MISSING','Replay Co','Cancelled Missing',true,'2026-01-01');
update public.external_org_bindings set statement_full_ledger_replay_needed=false, statement_update_delayed=false,
  statement_last_attempt_at='2026-01-15T12:00:00Z',statement_calendar='[{"start":"2025-01-01","end":"2025-12-31"}]'::jsonb
where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext';
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
values ('00000000-0000-0000-0000-000000000001','Replay Co','30000000-0000-0000-0000-0000000000a1',
 '30000000-0000-0000-0000-0000000000a2','profit_and_loss','company',null,'account_breakdown','month',
 '2025-02-01','2025-02-28','2025-01-01','2025-01-31','IDR','2025-03-01T00:00:00Z',
 '{"rows":[]}',false,2,'Commercial Rounding');

select ok(public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Replay Co'),'uncancelled missing chart reference requests replay');
select ok((select statement_full_ledger_replay_needed and not statement_update_delayed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),'missing reference requests ledger replay without changing native delayed status');
select ok((select statement_calendar='[{"start":"2025-01-01","end":"2025-12-31"}]'::jsonb
  and statement_last_attempt_at='2026-01-15T12:00:00Z'::timestamptz
  and statement_update_delayed=false
  and (select count(*)=1 and bool_and(snapshot_id='30000000-0000-0000-0000-0000000000a1'::uuid)
    and bool_and(as_of='2025-03-01T00:00:00Z'::timestamptz) from public.erp_financial_statement_snapshot where company='Replay Co')
  from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'missing-reference replay leaves native calendar, delay, last success and snapshot unchanged');
select ok(not public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Other Co'),'no references for another company do not request replay');
select ok(not has_function_privilege('anon','public.mark_erp_statement_replay_for_missing_accounts(uuid,text)','EXECUTE'),'anon cannot invoke replay detection');
select ok(not has_function_privilege('authenticated','public.mark_erp_statement_replay_for_missing_accounts(uuid,text)','EXECUTE'),
  'authenticated callers cannot execute replay detection');
set local role authenticated;
select throws_ok($$select public.mark_erp_statement_replay_for_missing_accounts(
  '00000000-0000-0000-0000-000000000001','Replay Co')$$,
  '42501', null, 'authenticated replay-detection call is denied');
reset role;

update public.erp_gl_entry_mirror set replay_seen_id='30000000-0000-0000-0000-000000000002'
where erp_name='GL-MISSING-ACCOUNT';
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,is_cancelled,erp_modified,replay_seen_id)
values ('00000000-0000-0000-0000-000000000001','GL-REPLAY-COMPLETE','Replay Co','Known Account',false,'2026-02-01','30000000-0000-0000-0000-000000000002');
select lives_ok($$select public.finish_erp_gl_replay('00000000-0000-0000-0000-000000000001','Replay Co','30000000-0000-0000-0000-000000000002','2026-02-01')$$,'completed full replay finishes');
select ok(not (select statement_full_ledger_replay_needed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),'successful replay finish clears replay flag');
select ok(public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Replay Co'),'still-unresolved reference keeps replay requested after finish');
update public.erp_gl_entry_mirror set is_cancelled=true where erp_name='GL-MISSING-ACCOUNT';
select ok(not public.mark_erp_statement_replay_for_missing_accounts('00000000-0000-0000-0000-000000000001','Replay Co'),
  'valid uncancelled chart references do not request replay');
select ok((select statement_full_ledger_replay_needed and not statement_update_delayed
  and statement_calendar='[{"start":"2025-01-01","end":"2025-12-31"}]'::jsonb
  and statement_last_attempt_at='2026-01-15T12:00:00Z'::timestamptz
  and (select count(*)=1 and bool_and(snapshot_id='30000000-0000-0000-0000-0000000000a1'::uuid)
    and bool_and(as_of='2025-03-01T00:00:00Z'::timestamptz) from public.erp_financial_statement_snapshot where company='Replay Co')
  from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'valid reference detection preserves replay and native calendar, delay, last success and snapshot');
select * from finish();
rollback;
