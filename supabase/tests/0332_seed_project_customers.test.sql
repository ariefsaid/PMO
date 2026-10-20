begin;
select plan(5);

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

select ok(
  (select count(distinct client_id) = 6
       and bool_and(client_id is not null)
       and (select client_id from public.projects where id = '41000000-0000-0000-0000-000000000007')
           = (select client_id from public.projects where id = '41000000-0000-0000-0000-000000000002')
       and (select client_id from public.projects where id = '41000000-0000-0000-0000-000000000008')
           = (select client_id from public.projects where id = '41000000-0000-0000-0000-000000000001')
       and (select client_id from public.projects where id = '41000000-0000-0000-0000-000000000009')
           = (select client_id from public.projects where id = '41000000-0000-0000-0000-000000000004')
   from public.projects
   where id in ('41000000-0000-0000-0000-000000000001',
                '41000000-0000-0000-0000-000000000002',
                '41000000-0000-0000-0000-000000000003',
                '41000000-0000-0000-0000-000000000004',
                '41000000-0000-0000-0000-000000000005',
                '41000000-0000-0000-0000-000000000006',
                '41000000-0000-0000-0000-000000000007',
                '41000000-0000-0000-0000-000000000008',
                '41000000-0000-0000-0000-000000000009')),
  'AC-0332-003 related solar phases share customers while unrelated projects remain distinct'
);

select ok(
  (select count(*) filter (where client_id is null) = 1
       and bool_and(id = '40000000-0000-0000-0000-000000000004'::uuid)
           filter (where client_id is null)
   from public.projects),
  'AC-0332-004 P003 is the only seeded project without a customer'
);

select ok(
  (select count(*) = 13
       and bool_and(client_id is not null)
       and count(distinct client_id) = 13
   from public.projects
   where id in ('41000000-0000-0000-0000-000000000001',
                 '41000000-0000-0000-0000-000000000002',
                 '41000000-0000-0000-0000-000000000003',
                 '41000000-0000-0000-0000-000000000004',
                 '41000000-0000-0000-0000-000000000005',
                 '41000000-0000-0000-0000-000000000006',
                 '40000000-0000-0000-0000-000000000001',
                 '40000000-0000-0000-0000-000000000002',
                 '40000000-0000-0000-0000-000000000005',
                 '40000000-0000-0000-0000-000000000011',
                 '40000000-0000-0000-0000-000000000012',
                 '40000000-0000-0000-0000-000000000013',
                 '40000000-0000-0000-0000-000000000003')),
  'AC-0332-005 unrelated seeded project fixtures have populated, distinct customers'
);

select * from finish();
rollback;
