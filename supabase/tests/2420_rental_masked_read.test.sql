begin;
select plan(4);
select has_column('public', 'procurements_masked', 'purchase_type_id', 'Rental reader carries purchase_type_id');
select has_column('public', 'procurements_masked', 'rental_from', 'Rental reader carries rental_from');
select has_column('public', 'procurements_masked', 'rental_to', 'Rental reader carries rental_to');
select has_column('public', 'procurements_masked', 'extends_procurement_id', 'Rental reader carries extends_procurement_id');
select * from finish();
rollback;
