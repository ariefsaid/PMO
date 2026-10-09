-- AC-BUPOT-011: history declarations coexist with the current 0278 invoice arms.
begin;
select plan(6);
select is((select count(*)::int from public.record_history_config where entity_type in ('vendor_withholding_slip','vendor_withholding_slip_bill')),2,
 'AC-BUPOT-011 both slip entities are classified');
select ok((select count(*)=2 from pg_trigger where tgname in ('vendor_withholding_slips_zz_record_change','vendor_withholding_slip_bills_zz_record_change') and not tgisinternal),
 'AC-BUPOT-011 both slip tables capture row changes');
select ok(public.record_history_visible('sales_invoice',gen_random_uuid()) is false and public.record_history_visible('procurement_invoice',gen_random_uuid()) is false,
 'AC-CHG-011 0278 invoice visibility arms remain after the slip migration');
select is((select captured->>'withheld_amount' from public.record_history_config where entity_type='vendor_withholding_slip'),'money',
 'AC-BUPOT-011 slip withheld amount is classified as money');
select is((select flag_cols::text from public.record_history_config where entity_type='vendor_withholding_slip'),'{void_reason}',
 'AC-BUPOT-011 free-text void reason is classified as a change flag');
select is((select parent_type from public.record_history_config where entity_type='vendor_withholding_slip_bill'),'vendor_withholding_slip',
 'AC-BUPOT-011 bill history groups beneath its slip without assigning one project parent');
select * from finish();
rollback;
