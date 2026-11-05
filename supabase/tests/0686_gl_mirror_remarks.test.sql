-- 0686 AC-JEC-013: the ledger mirror carries the GL Entry remark through the voucher-replace path.
begin;
select plan(3);

insert into public.external_org_bindings(org_id, external_tier, site_url, secret_ref, config)
values ('00000000-0000-0000-0000-000000000001','erpnext','https://remarks.example.test','synthetic-ref','{"company":"Remark Co"}')
on conflict (org_id, external_tier) do update set config = excluded.config;

select is(
  public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Remark Co','Journal Entry','JV-R1',
    $j$[{"erp_name":"GLE-R1","company":"Remark Co","account":"A","voucher_type":"Journal Entry","voucher_no":"JV-R1","debit":"5.00","credit":"0.00","remarks":"Vendor X inv 12","erp_modified":"2026-10-25 08:00:00"}]$j$::jsonb,
    array['GLE-R1']) ->> 'upserted', '1', 'AC-JEC-013 replace lands the row');
select is((select remarks from public.erp_gl_entry_mirror where erp_name = 'GLE-R1'), 'Vendor X inv 12',
  'AC-JEC-013 the mirror row carries the remark');

select public.replace_erp_gl_voucher_rows('00000000-0000-0000-0000-000000000001','Remark Co','Journal Entry','JV-R1',
  $j$[{"erp_name":"GLE-R1","company":"Remark Co","account":"A","voucher_type":"Journal Entry","voucher_no":"JV-R1","debit":"5.00","credit":"0.00","remarks":"changed","erp_modified":"2026-10-25 08:00:00"}]$j$::jsonb,
  array['GLE-R1']);
select is((select remarks from public.erp_gl_entry_mirror where erp_name = 'GLE-R1'), 'changed',
  'AC-JEC-013 a re-delivery with the same erp_modified updates the remark');

select * from finish();
rollback;
