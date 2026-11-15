-- AC-CSD-014: every stage `pmo load` can target is reachable from Leads through the REAL transition_project,
-- walking exactly scripts/lib/pmo-load.mjs LOAD_STAGE_PATHS (a vitest-free node test, scripts/pmo-load.test.mjs,
-- asserts the JSON below equals LOAD_STAGE_PATHS, so the two cannot drift). A won stage also supplies the win
-- branch's own inputs: a contract value with its witness, the client contract reference and the contract date.
begin;
select plan(11);

insert into organizations (id, name) values ('c5d40000-0000-0000-0000-000000000001', 'Load Paths Org');
insert into auth.users (id, email) values ('c5d40000-0000-0000-0000-0000000000a1', 'load-paths-admin@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('c5d40000-0000-0000-0000-0000000000a1', 'c5d40000-0000-0000-0000-000000000001', 'Load Paths Admin', 'load-paths-admin@example.com', 'Admin');

create temp table path_cases on commit drop as
select t.key as target, t.value as steps, row_number() over (order by t.key) as n
from jsonb_each($paths$
{
  "Leads": [],
  "Quotation Submitted": ["Quotation Submitted"],
  "PQ Submitted": ["Quotation Submitted", "PQ Submitted"],
  "Tender Submitted": ["Quotation Submitted", "PQ Submitted", "Tender Submitted"],
  "Negotiation": ["Quotation Submitted", "PQ Submitted", "Tender Submitted", "Negotiation"],
  "Won, Pending KoM": ["Quotation Submitted", "Won, Pending KoM"],
  "Ongoing Project": ["Quotation Submitted", "Won, Pending KoM", "Ongoing Project"],
  "On Hold": ["Quotation Submitted", "Won, Pending KoM", "On Hold"],
  "Close Out": ["Quotation Submitted", "Won, Pending KoM", "Close Out"]
}
$paths$::jsonb) as t;
create temp table path_results (target text primary key, final_status text, failure text);
grant all on path_cases, path_results to authenticated;

insert into projects (id, org_id, code, name, status)
select ('c5d40000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'c5d40000-0000-0000-0000-000000000001',
       'LP-' || n, 'Load path ' || target, 'Leads'
from path_cases;

insert into projects (id, org_id, code, name, status) values
  ('c5d40000-0000-0000-0002-000000000001', 'c5d40000-0000-0000-0000-000000000001', 'LP-X', 'Load path no ref', 'Quotation Submitted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5d40000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  c record; s text; v_id uuid; v_status text;
begin
  for c in select * from path_cases loop
    v_id := ('c5d40000-0000-0000-0001-' || lpad(c.n::text, 12, '0'))::uuid;
    begin
      -- The loader writes the value before the steps (set_project_contract_value), then each step in order.
      perform set_project_contract_value(v_id, 1000, p_tax_treatment => 'exclusive', p_tax_amount => 0);
      for s in select jsonb_array_elements_text(c.steps) loop
        if s = 'Won, Pending KoM' then
          perform transition_project(v_id, s::project_status, 'PO-LP-1', '2025-01-15');
        else
          perform transition_project(v_id, s::project_status);
        end if;
      end loop;
      select status::text into v_status from projects where id = v_id;
      insert into path_results values (c.target, v_status, null);
    exception when others then
      insert into path_results values (c.target, null, sqlerrm);
    end;
  end loop;
end $$;

select is((select coalesce(final_status, 'FAILED: ' || failure) from path_results where target = t.target), t.target,
          'AC-CSD-014 the load path for ' || t.target || ' reaches it through transition_project')
from (select target from path_cases order by target) t;

reset role;
select is((select count(*)::int from projects where org_id = 'c5d40000-0000-0000-0000-000000000001' and customer_contract_ref = 'PO-LP-1' and contract_date = '2025-01-15'),
          4, 'AC-CSD-014 each won stage carries the contract reference and date the win step supplied');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5d40000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('c5d40000-0000-0000-0002-000000000001', 'Won, Pending KoM') $$,
  'P0001', 'customer contract ref and date are required to win',
  'AC-CSD-014 a win without its contract reference and date is still refused by the database, with the win step''s own message');

select * from finish();
rollback;
