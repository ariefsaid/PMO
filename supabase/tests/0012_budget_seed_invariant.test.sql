begin;
select plan(2);

-- AC-733: Every project in the seeded DB has exactly one Active budget_version.
-- We verify this against the real seed data (no extra fixtures — this test depends on seed.sql).
select is(
  (select count(*)::int from projects p
   where (select count(*) from budget_versions bv
          where bv.project_id = p.id and bv.status = 'Active') <> 1),
  0,
  'AC-733: every seeded project has exactly one Active budget_version');

-- AC-733: Every Active budget_version has at least one line-item.
select is(
  (select count(*)::int from budget_versions bv
   where bv.status = 'Active'
   and (select count(*) from budget_line_items li where li.budget_version_id = bv.id) < 1),
  0,
  'AC-733: every Active budget_version has at least one line-item');

select * from finish();
rollback;
