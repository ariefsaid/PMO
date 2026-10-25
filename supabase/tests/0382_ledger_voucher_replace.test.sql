-- 0382: a reposted voucher's mirrored ledger rows are replaced with ERPNext's current set, atomically.
begin;
select plan(22);

insert into public.organizations(id, name) values ('00000000-0000-0000-0000-000000000002','Voucher Other Org') on conflict (id) do nothing;
insert into public.external_org_bindings(org_id, external_tier, site_url, secret_ref, config)
values ('00000000-0000-0000-0000-000000000001','erpnext','https://voucher.example.test','synthetic-ref','{"company":"Voucher Co"}')
on conflict (org_id, external_tier) do update set config = excluded.config;

-- After two reposts: the original (cancelled), the first repost's hash rows (hard-deleted in ERPNext),
-- and the second repost's live row the feed has already landed.
insert into public.erp_gl_entry_mirror(org_id, erp_name, company, account, project, voucher_type, voucher_no, debit, credit, is_cancelled, erp_modified) values
 ('00000000-0000-0000-0000-000000000001','GLE-ORIG','Voucher Co','519101','PROJ-0004','Journal Entry','JV-70',241999959,0,true,'2026-10-25 07:37:41.941175'),
 ('00000000-0000-0000-0000-000000000001','hash-rev','Voucher Co','519101','PROJ-0004','Journal Entry','JV-70',0,241999959,true,'2026-10-25 07:37:41.951217'),
 ('00000000-0000-0000-0000-000000000001','hash-live','Voucher Co','519101','PROJ-0004','Journal Entry','JV-70',241999959,0,false,'2026-10-25 07:37:57.013202'),
 ('00000000-0000-0000-0000-000000000001','GLE-1438','Voucher Co','519101','PROJ-0004','Journal Entry','JV-70',241999959,0,false,'2026-10-25 08:32:12.251858'),
 ('00000000-0000-0000-0000-000000000001','legacy-null',null,'519101','PROJ-0004','Journal Entry','JV-70',5,0,false,'2026-10-01 00:00:00'),
 ('00000000-0000-0000-0000-000000000001','other-company','Other Co','519101','PROJ-0004','Journal Entry','JV-70',7,0,false,'2026-10-01 00:00:00'),
 ('00000000-0000-0000-0000-000000000001','other-voucher','Voucher Co','519101','PROJ-0004','Journal Entry','JV-71',11,0,false,'2026-10-01 00:00:00'),
 ('00000000-0000-0000-0000-000000000002','other-org','Voucher Co','519101','PROJ-0004','Journal Entry','JV-70',13,0,false,'2026-10-01 00:00:00');

select is((select sum(debit - credit) from public.erp_gl_entry_mirror
            where org_id='00000000-0000-0000-0000-000000000001' and voucher_no='JV-70' and company='Voucher Co' and not is_cancelled),
          483999918::numeric, 'precondition: the reposted voucher counts twice');

select is(
  public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Voucher Co','Journal Entry','JV-70',
    $j$[{"erp_name":"GLE-1435","company":"Voucher Co","account":"519101","project":"PROJ-0004","voucher_type":"Journal Entry","voucher_no":"JV-70","debit":"0.00","credit":"241999959.00","is_cancelled":true,"erp_docstatus":1,"erp_modified":"2026-10-25 08:32:12.248890"},
        {"erp_name":"GLE-1438","company":"Voucher Co","account":"519101","project":"PROJ-0004","voucher_type":"Journal Entry","voucher_no":"JV-70","debit":"241999959.00","credit":"0.00","is_cancelled":false,"erp_docstatus":1,"erp_modified":"2026-10-25 08:32:12.251858"}]$j$::jsonb,
    array['GLE-ORIG','GLE-1435','GLE-1438']),
  '{"upserted": 2, "deleted": 3}'::jsonb,
  'replace upserts the re-delivered rows and deletes the three rows ERPNext no longer has');

select is((select array_agg(erp_name order by erp_name) from public.erp_gl_entry_mirror
            where org_id='00000000-0000-0000-0000-000000000001' and voucher_no='JV-70' and (company='Voucher Co' or company is null)),
          array['GLE-1435','GLE-1438','GLE-ORIG'], 'exactly ERPNext''s current rows remain for the voucher');
select is((select sum(debit - credit) from public.erp_gl_entry_mirror
            where org_id='00000000-0000-0000-0000-000000000001' and project='PROJ-0004' and company='Voucher Co' and voucher_no='JV-70' and not is_cancelled),
          241999959::numeric, 'the project spend counts once');
select is((select count(*)::int from public.erp_gl_entry_mirror where erp_name='legacy-null'), 0, 'a legacy NULL-company row of the voucher absent from ERPNext is removed');
select is((select count(*)::int from public.erp_gl_entry_mirror where erp_name='other-company'), 1, 'another company''s rows are untouched');
select is((select count(*)::int from public.erp_gl_entry_mirror where erp_name='other-voucher'), 1, 'other vouchers are untouched');
select is((select count(*)::int from public.erp_gl_entry_mirror where erp_name='other-org'), 1, 'other orgs are untouched');
select is((select company from public.erp_gl_entry_mirror where erp_name='GLE-1435'), 'Voucher Co', 'a new row is stamped with the bound company');

-- The per-row freshness guard: an older re-delivery never overwrites newer money.
select is(
  public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Voucher Co','Journal Entry','JV-70',
    '[{"erp_name":"GLE-1438","account":"STALE","voucher_type":"Journal Entry","voucher_no":"JV-70","debit":"1.00","credit":"0.00","is_cancelled":false,"erp_modified":"2026-10-25 08:00:00"}]'::jsonb,
    array['GLE-ORIG','GLE-1435','GLE-1438']) ->> 'upserted', '0', 'an older re-delivery is not applied');
select is((select account from public.erp_gl_entry_mirror where erp_name='GLE-1438'), '519101', 'the newer row survives');

-- Fail closed: nothing is removed on an empty, malformed or mismatched call.
select throws_ok($$select public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Voucher Co','Journal Entry','JV-70','[]'::jsonb, array[]::text[])$$,
  '22023', null, 'an empty current set is refused');
select throws_ok($$select public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Voucher Co','Journal Entry','JV-70',
  '[{"erp_name":"X","account":"A","voucher_type":"Journal Entry","voucher_no":"JV-71","erp_modified":"2026-10-26"}]'::jsonb, array['X'])$$,
  '22023', null, 'a row of another voucher is refused');
select throws_ok($$select public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Voucher Co','Journal Entry','JV-70',
  '[{"erp_name":"X","company":"Other Co","account":"A","voucher_type":"Journal Entry","voucher_no":"JV-70","erp_modified":"2026-10-26"}]'::jsonb, array['X'])$$,
  '22023', null, 'a row of another company is refused');
select is((select count(*)::int from public.erp_gl_entry_mirror where org_id='00000000-0000-0000-0000-000000000001' and voucher_no='JV-70' and company='Voucher Co'),
  3, 'refused calls removed nothing');

select is(public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Stale Co','Journal Entry','JV-70','[]'::jsonb, array['GLE-1438']) ->> 'stale_binding',
  'true', 'a company that is no longer bound changes nothing');
select is((select count(*)::int from public.erp_gl_entry_mirror where org_id='00000000-0000-0000-0000-000000000001' and voucher_no='JV-70' and company='Voucher Co'),
  3, 'the stale-binding call removed nothing');

-- Payment Ledger mirror: same replace, keyed on the voucher that wrote the row.
insert into public.erp_payment_ledger_mirror(org_id, erp_name, account, voucher_type, voucher_no, amount, delinked, erp_modified) values
 ('00000000-0000-0000-0000-000000000001','ple-old','Creditors','Purchase Invoice','PINV-6',5811783.49,false,'2026-10-25 07:00:00'),
 ('00000000-0000-0000-0000-000000000001','ple-legacy','Creditors',null,null,99,false,'2026-10-01 00:00:00');
select is(
  public.replace_erp_ple_voucher_rows('00000000-0000-0000-0000-000000000001','Voucher Co','Purchase Invoice','PINV-6',
    '[{"erp_name":"ple-new","account":"Creditors","voucher_type":"Purchase Invoice","voucher_no":"PINV-6","amount":"5811783.49","delinked":false,"erp_modified":"2026-10-25 11:52:16.308551"}]'::jsonb,
    array['ple-new']),
  '{"upserted": 1, "deleted": 1}'::jsonb, 'PLE replace lands the new row and deletes the hard-deleted one');
select is((select array_agg(erp_name order by erp_name) from public.erp_payment_ledger_mirror where org_id='00000000-0000-0000-0000-000000000001'),
  array['ple-legacy','ple-new'], 'only the voucher''s rows are replaced; a legacy row without a voucher is untouched');

select ok(not has_function_privilege('authenticated','public.replace_erp_gl_voucher_rows(uuid,text,text,text,jsonb,text[])','execute'), 'authenticated cannot call the GL replace');
select ok(not has_function_privilege('anon','public.replace_erp_ple_voucher_rows(uuid,text,text,text,jsonb,text[])','execute'), 'anon cannot call the PLE replace');
select ok(has_function_privilege('service_role','public.replace_erp_gl_voucher_rows(uuid,text,text,text,jsonb,text[])','execute'), 'the sweep (service role) can call the GL replace');

select * from finish();
rollback;
