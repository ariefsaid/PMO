-- This file is run by the migration reversal harness after inserting an upload on
-- the pre-feature schema and applying 0292 in the same database session.
begin;
select no_plan();

select is(
  (select source::text from public.project_documents where id = '10200000-0000-0000-0000-000000000301'),
  'upload',
  'AC-M365DOC-001 existing Storage upload is backfilled as upload during upgrade'
);
select is(
  (select source::text from public.project_documents where id = '10200000-0000-0000-0000-000000000302'),
  null,
  'AC-M365DOC-001 metadata-only row remains source-null during upgrade'
);
select is(
  (select file_path from public.project_documents where id = '10200000-0000-0000-0000-000000000301'),
  'documents/m365-fixture.pdf',
  'AC-M365DOC-001 upload path is preserved during upgrade'
);

select * from finish();
rollback;
