begin;
create extension if not exists pgtap;
select plan(1);
select results_eq(
  $$select term_key from public.org_term_keys where term_key in ('foreman', 'workOrderPlan') order by term_key$$,
  $$values ('foreman'::text), ('workOrderPlan'::text)$$,
  'Both additional terminology keys are available'
);
select * from finish();
rollback;
