-- project_overview_read.test.sql — AC-PERF-005/006: get_project_overview_read returns exactly what the individual
-- reads return, for every role, refuses the way they refuse, and shows another org nothing.
begin;
select plan(22);

insert into organizations (id, name, default_currency, default_timezone) values
  ('06520000-0000-0000-0000-0000000000a0','POR A','IDR','Asia/Jakarta'), ('06520000-0000-0000-0000-0000000000b0','POR B','USD','UTC');
insert into auth.users (id, email) values
  ('06520000-0000-0000-0000-0000000000a1','por-admin@example.test'), ('06520000-0000-0000-0000-0000000000a2','por-exec@example.test'),
  ('06520000-0000-0000-0000-0000000000a3','por-fin@example.test'),   ('06520000-0000-0000-0000-0000000000a4','por-pm@example.test'),
  ('06520000-0000-0000-0000-0000000000a5','por-eng@example.test'),   ('06520000-0000-0000-0000-0000000000b1','por-b@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06520000-0000-0000-0000-0000000000a1','06520000-0000-0000-0000-0000000000a0','Admin','por-admin@example.test','Admin','active'),
  ('06520000-0000-0000-0000-0000000000a2','06520000-0000-0000-0000-0000000000a0','Exec','por-exec@example.test','Executive','active'),
  ('06520000-0000-0000-0000-0000000000a3','06520000-0000-0000-0000-0000000000a0','Fin','por-fin@example.test','Finance','active'),
  ('06520000-0000-0000-0000-0000000000a4','06520000-0000-0000-0000-0000000000a0','PM','por-pm@example.test','Project Manager','active'),
  ('06520000-0000-0000-0000-0000000000a5','06520000-0000-0000-0000-0000000000a0','Eng','por-eng@example.test','Engineer','active'),
  ('06520000-0000-0000-0000-0000000000b1','06520000-0000-0000-0000-0000000000b0','Other','por-b@example.test','Admin','active');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('06520000-0000-0000-0000-0000000000d1','06520000-0000-0000-0000-0000000000a0','POR project','Ongoing Project','IDR',5000000,'exclusive',0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, line_no) values
  ('06520000-0000-0000-0000-0000000000c1','06520000-0000-0000-0000-0000000000a0','06520000-0000-0000-0000-0000000000d1','B1','Line one','m',10,1000,2),
  ('06520000-0000-0000-0000-0000000000c2','06520000-0000-0000-0000-0000000000a0','06520000-0000-0000-0000-0000000000d1','B2','Line two','m',5,2000,null);
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  ('06520000-0000-0000-0000-0000000000e1','06520000-0000-0000-0000-0000000000a0','06520000-0000-0000-0000-0000000000d1','Phase 1',1,1),
  ('06520000-0000-0000-0000-0000000000e2','06520000-0000-0000-0000-0000000000a0','06520000-0000-0000-0000-0000000000d1','Phase 2',2,2);
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('06520000-0000-0000-0000-0000000000f1','06520000-0000-0000-0000-0000000000a0','06520000-0000-0000-0000-0000000000d1',1,'v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('06520000-0000-0000-0000-0000000000a0','06520000-0000-0000-0000-0000000000f1','Materials','steel',1000000,0);
update budget_versions set status = 'Active' where id = '06520000-0000-0000-0000-0000000000f1';
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('06520000-0000-0000-0000-000000000101','06520000-0000-0000-0000-0000000000a0','ordered','06520000-0000-0000-0000-0000000000a3','06520000-0000-0000-0000-0000000000d1','IDR',1000,'Ordered'),
  ('06520000-0000-0000-0000-000000000102','06520000-0000-0000-0000-0000000000a0','usd','06520000-0000-0000-0000-0000000000a3','06520000-0000-0000-0000-0000000000d1','USD',50,'Ordered');
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('06520000-0000-0000-0000-0000000000a0','clickup','tasks'), ('06520000-0000-0000-0000-0000000000a0','erpnext','procurement');

-- Every individual call, in the function's order, compared with the one overview call. '' = identical.
create function pg_temp.parity(p uuid, m boolean, c boolean, b boolean) returns text
language plpgsql security invoker as $$
declare r record; es text; gs text; mism text := '';
begin
  begin
    if m then perform public.get_project_finances(p); perform public.get_project_billing(p); end if;
    if b then perform public.budget_version_read(p, 0, 1000); end if;
    if c then perform * from public.project_committed_spend(p); perform public.org_reads_erp_ledger(); end if;
    perform * from public.get_project_milestones(p);
  exception when others then es := sqlstate; end;
  begin select * into strict r from public.get_project_overview_read(p, m, c, b);
  exception when others then gs := sqlstate; end;
  if es is distinct from gs then return 'state expected=' || coalesce(es, 'ok') || ' got=' || coalesce(gs, 'ok'); end if;
  if es is not null then return ''; end if;
  if r.finances is distinct from (case when m then public.get_project_finances(p) end) then mism := mism || ' finances'; end if;
  if r.billing is distinct from (case when m then public.get_project_billing(p) end) then mism := mism || ' billing'; end if;
  if r.boq_items is distinct from (case when m then (select coalesce(jsonb_agg(to_jsonb(x) order by x.line_no nulls last, x.created_at, x.id), '[]') from public.boq_items x where x.project_id = p) end) then mism := mism || ' boq'; end if;
  if r.budget_versions is distinct from (case when b then (select coalesce(jsonb_agg(to_jsonb(v) order by v.version_no), '[]') from public.budget_version_read(p, 0, 1000) v) end) then mism := mism || ' budget'; end if;
  if r.committed_spend is distinct from (case when c then (select coalesce(jsonb_agg(to_jsonb(x) order by x.is_project_currency desc, x.currency), '[]') from public.project_committed_spend(p) x) end) then mism := mism || ' committed'; end if;
  if r.external_domain_ownership is distinct from (case when c then (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'org_id', e.org_id, 'external_tier', e.external_tier, 'domain', e.domain) order by e.external_tier, e.id), '[]') from public.external_domain_ownership e) end) then mism := mism || ' ownership'; end if;
  if r.reads_erp_ledger is distinct from (case when c then public.org_reads_erp_ledger() end) then mism := mism || ' ledger'; end if;
  if r.milestones is distinct from (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.id), '[]') from public.get_project_milestones(p) x) then mism := mism || ' milestones'; end if;
  return mism;
end $$;
grant execute on function pg_temp.parity(uuid, boolean, boolean, boolean) to authenticated;

select is((select security_type from information_schema.routines where routine_schema='public' and routine_name='get_project_overview_read'),
          'INVOKER', 'AC-PERF-005 the overview read is SECURITY INVOKER');
select is((select count(*)::int from information_schema.role_routine_grants where routine_schema='public'
            and routine_name='get_project_overview_read' and grantee in ('PUBLIC','anon')), 0,
          'AC-PERF-005 anon and public cannot execute the overview read');
select is((select count(*)::int from information_schema.role_routine_grants where routine_schema='public'
            and routine_name='get_project_overview_read' and grantee = 'authenticated'), 1,
          'AC-PERF-005 authenticated can execute the overview read');

set local role authenticated;

set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', true, true, true), '', 'AC-PERF-005 Admin: every section equals its individual read');
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', false, false, false), '', 'AC-PERF-005 Admin: flags off still equal');
set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', true, true, true), '', 'AC-PERF-005 Executive: every section equals its individual read');
set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', true, true, true), '', 'AC-PERF-005 Finance: every section equals its individual read');
set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', true, true, true), '', 'AC-PERF-005 Project Manager: every section equals its individual read');
set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', true, true, true), '', 'AC-PERF-005 Engineer: refused exactly as the individual reads refuse (or equal)');
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', false, false, false), '', 'AC-PERF-005 Engineer, delivery lens flags off: equal');

-- Concrete pins so an all-null parity cannot pass: Finance sees real figures in the right shape.
set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select jsonb_array_length(boq_items) from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 2,
          'AC-PERF-005 BoQ lines arrive');
select is((select boq_items->0->>'item_code' from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 'B1',
          'AC-PERF-005 BoQ ordered by line number, unnumbered last');
select is((select jsonb_array_length(milestones) from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 2,
          'AC-PERF-005 milestones arrive');
select is((select (committed_spend->0->>'amount')::numeric from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 1000::numeric,
          'AC-PERF-005 committed spend in the project currency arrives');
select is((select jsonb_array_length(budget_versions) from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 1,
          'AC-PERF-005 budget versions arrive via budget_version_read');
select is((select org_default_currency || ':' || org_default_timezone from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 'IDR:Asia/Jakarta',
          'AC-PERF-005 org fx context arrives');
select is((select jsonb_array_length(external_domain_ownership) from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)), 2,
          'AC-PERF-005 domain ownership rows arrive');

-- Flags off: the gated sections are null and unread.
select is((select (finances is null and billing is null and boq_items is null and budget_versions is null and committed_spend is null
                   and external_domain_ownership is null and reads_erp_ledger is null)
             from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', false, false, false)), true,
          'AC-PERF-005 flags off: gated sections are null');

-- AC-PERF-006: another org's caller gets nothing of this project.
set local request.jwt.claims = '{"sub":"06520000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(pg_temp.parity('06520000-0000-0000-0000-0000000000d1', true, true, true), '', 'AC-PERF-006 another org: parity (same refusal or same empty answer)');
select is((select coalesce((select jsonb_array_length(boq_items) + jsonb_array_length(milestones) + comment_count
                            from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', false, false, false)), 0)), 0,
          'AC-PERF-006 another org sees no BoQ, milestones or comments of the project');
select throws_ok($q$select * from get_project_overview_read('06520000-0000-0000-0000-0000000000d1', true, true, true)$q$,
                 'P0002', 'project not found', 'AC-PERF-006 another org asking for the money sections is refused like get_project_finances');

reset role;
select is(has_function_privilege('anon', 'public.get_project_overview_read(uuid,boolean,boolean,boolean)', 'execute'), false,
          'AC-PERF-005 anon has no execute privilege');

select * from finish();
rollback;
