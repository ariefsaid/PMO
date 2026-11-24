begin;
create extension if not exists pgtap;
select plan(4);
select has_table('public', 'order_stock_mappings', 'AC-RGO-002 purchasing maps order lines to stock');
select has_table('public', 'order_receiving_settings', 'AC-RGO-001 receiving is opt-in');
select has_function('public', 'receive_order_goods', array['uuid','uuid','date','jsonb','uuid'], 'AC-RGO-005 order-derived stock receipt');
select has_function('public', 'read_order_receiving', array['uuid'], 'AC-RGO-004 blind receiving read');
select * from finish();
rollback;
