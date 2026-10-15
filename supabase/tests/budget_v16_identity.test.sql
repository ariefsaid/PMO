begin;
select plan(4);
select is(
  public.budget_account_identity('0b162222-0000-0000-0000-000000000001','FY/2026:','Salary: α'),
  '0b162222-0000-0000-0000-000000000001:a:16:46592:323032363T:53616c6172793a20ceb1',
  'SQL budget account identity matches the framed TypeScript bytes');
select throws_ok(
  $$select public.budget_account_identity(null,'2026','Salary')$$,
  '22023', 'Invalid budget account identity', 'null version is rejected');
select throws_ok(
  $$select public.budget_account_identity('0b162222-0000-0000-0000-000000000001','','Salary')$$,
  '22023', 'Invalid budget account identity', 'empty fiscal year is rejected');
select ok(not has_function_privilege('anon','public.budget_account_identity(uuid,text,text)','EXECUTE'),
  'anon cannot execute the identity helper');
select finish();
rollback;
