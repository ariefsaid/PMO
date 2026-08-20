begin;
select plan(8);

select has_column('public', 'budget_versions', 'import_batch_id', 'budget_versions has import_batch_id');
select has_column('public', 'budget_versions', 'imported_at', 'budget_versions has imported_at');
select has_column('public', 'budget_versions', 'import_key', 'budget_versions has import_key');
select has_column('public', 'budget_line_items', 'import_batch_id', 'budget_line_items has import_batch_id');
select has_column('public', 'budget_line_items', 'imported_at', 'budget_line_items has imported_at');
select has_column('public', 'budget_line_items', 'import_key', 'budget_line_items has import_key');
select has_index('public', 'budget_versions', 'budget_versions_import_key_batch_uidx', 'header skip index exists');
select has_index('public', 'budget_line_items', 'budget_line_items_import_key_batch_uidx', 'line skip index exists');

select * from finish();
rollback;
