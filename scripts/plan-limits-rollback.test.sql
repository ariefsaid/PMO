-- Migration 0535 down/up round trip. The test expands the actual shipped migration files.
begin;
create extension if not exists pgtap;
select plan(5);

insert into public.organizations (id, name)
values ('0535b000-0000-0000-0000-000000000001', 'S5 Rollback');
insert into auth.users (id, email)
values ('0535b000-0000-0000-0000-0000000000a1', 's5-rollback@example.invalid');
insert into public.profiles (id, org_id, full_name, email, role, status)
values ('0535b000-0000-0000-0000-0000000000a1', '0535b000-0000-0000-0000-000000000001',
        'S5 Rollback Operator', 's5-rollback@example.invalid', 'Finance', 'active');
insert into public.org_plans (org_id, plan_id)
values ('0535b000-0000-0000-0000-000000000001', 'starter');

insert into public.credits (id, org_id, owner_id, amount, note, granted_by)
values ('0535b000-0000-0000-0000-0000000000c1', '0535b000-0000-0000-0000-000000000001',
        null, 17.25, 'plan-monthly-ai-allowance: manual grant',
        '0535b000-0000-0000-0000-0000000000a1');

create temporary table s5_generated_credit (id uuid primary key) on commit drop;
select public.plan_monthly_ai_allowance_tick('2026-11-01');
insert into s5_generated_credit (id)
select credit_id from public.org_ai_allowance_grants
 where org_id = '0535b000-0000-0000-0000-000000000001' and period = '2026-11-01';
select is((select count(*)::int from s5_generated_credit), 1,
  'AC-PLN-012 the scheduled allowance has a linked generated credit');

-- @0535_DOWN@

select is((select count(*)::int from public.credits
            where id = '0535b000-0000-0000-0000-0000000000c1'
              and amount = 17.25
              and note = 'plan-monthly-ai-allowance: manual grant'),
  1,
  'AC-PLN-012 rollback preserves the manual grant with the same note prefix');
select is((select count(*)::int from public.credits
            where id in (select id from s5_generated_credit)), 0,
  'AC-PLN-012 rollback removes the credit linked from its generated-grant ledger');
select ok(to_regclass('public.org_ai_allowance_grants') is null,
  'AC-PLN-012 rollback removes the allowance ledger');

-- @0535_UP@

select ok(to_regclass('public.org_ai_allowance_grants') is not null
          and to_regprocedure('public.plan_monthly_ai_allowance_tick(date)') is not null,
  'AC-PLN-012 reapplying 0535 restores the allowance ledger and tick');
select * from finish();
rollback;
