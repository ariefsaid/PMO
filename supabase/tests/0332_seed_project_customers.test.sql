begin;
select plan(4);

select isnt(
  (select client_id from public.projects where id = '40000000-0000-0000-0000-000000000001'),
  (select client_id from public.projects where id = '40000000-0000-0000-0000-000000000002'),
  'AC-0332-001 unrelated seeded projects have distinct customer records'
);

select is(
  (select client_id::text from public.projects where id = '40000000-0000-0000-0000-000000000004'),
  null,
  'AC-0332-002 the internal platform project has no customer'
);

select is(
  (select count(distinct client_id)::int from public.projects
    where id in ('41000000-0000-0000-0000-000000000001',
                 '41000000-0000-0000-0000-000000000002',
                 '41000000-0000-0000-0000-000000000003',
                 '41000000-0000-0000-0000-000000000004',
                 '41000000-0000-0000-0000-000000000005',
                 '41000000-0000-0000-0000-000000000006',
                 '41000000-0000-0000-0000-000000000007',
                 '41000000-0000-0000-0000-000000000008',
                 '41000000-0000-0000-0000-000000000009')),
  9,
  'AC-0332-003 each solar seed project has a distinct synthetic customer'
);

select is(
  (select count(distinct client_id)::int from public.projects),
  (select count(*)::int from public.projects where client_id is not null),
  'AC-0332-004 every non-internal seeded project has its own customer'
);

select * from finish();
rollback;
