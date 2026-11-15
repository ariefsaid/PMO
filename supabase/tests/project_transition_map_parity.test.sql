-- project_transition_map_parity.test.sql — AC-2379-1. The sales stage-move map the app offers
-- (LEGAL_PROJECT_TRANSITIONS) must equal the one the database enforces. This file holds the map as
-- ONE literal between the dollar-quote markers; the unit test pmo-portal/src/lib/db/projectTransitions.test.ts
-- reads the same literal and asserts the app's list equals it. Here the literal is walked through the
-- real transition_project for EVERY (from, to) pair of the twelve statuses: a pair in the literal
-- must not be refused as an illegal transition, and a pair outside it must be.
-- (A legal win pair may still stop on its own win-capture rules; only the map is under test.)
-- Mutation-check: change any stage's list in the literal, or in the function's v_legal, and this goes red.
-- Isolated org; UUID prefix 23790000-… (issue #2379).
begin;
create extension if not exists pgtap;
select plan(2);

create temp table map_literal (m jsonb);
insert into map_literal values ($map$
{
  "Leads":               ["Quotation Submitted", "Loss Tender", "Internal Project", "Declined"],
  "Quotation Submitted": ["PQ Submitted", "Won, Pending KoM", "Loss Tender", "Declined"],
  "PQ Submitted":        ["Tender Submitted", "Quotation Submitted", "Leads", "Loss Tender", "Declined"],
  "Tender Submitted":    ["Negotiation", "PQ Submitted", "Won, Pending KoM", "Loss Tender", "Declined"],
  "Negotiation":         ["Won, Pending KoM", "Tender Submitted", "Loss Tender", "Declined"],
  "Won, Pending KoM":    ["Ongoing Project", "On Hold", "Close Out"],
  "Ongoing Project":     ["On Hold", "Close Out"],
  "On Hold":             ["Ongoing Project", "Close Out"],
  "Close Out":           ["Ongoing Project"],
  "Loss Tender":         ["Negotiation"],
  "Declined":            ["Negotiation"],
  "Internal Project":    []
}
$map$::jsonb);
grant select on map_literal to authenticated;

insert into organizations (id, name) values ('23790000-0000-0000-0000-000000000001','Stage Map Org (2379)');
insert into auth.users (id, email) values ('23790000-0000-0000-0000-0000000000a1','pm-map2379@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('23790000-0000-0000-0000-0000000000a1','23790000-0000-0000-0000-000000000001','PM Map 2379','pm-map2379@example.com','Project Manager');

-- One project per (from, to) pair, sitting at `from`.
create temp table pairs (id uuid default gen_random_uuid(), frm text, tos text, refused boolean);
insert into pairs (frm, tos)
  select f.k, t.k from (select jsonb_object_keys(m) k from map_literal) f, (select jsonb_object_keys(m) k from map_literal) t;
insert into projects (id, org_id, code, name, status, project_manager_id)
  select id, '23790000-0000-0000-0000-000000000001', 'P' || row_number() over (), frm || ' > ' || tos, frm::project_status,
         '23790000-0000-0000-0000-0000000000a1'
  from pairs;
grant select, update on pairs to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"23790000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare r record;
begin
  for r in select id, tos from pairs loop
    begin
      perform transition_project(r.id, r.tos::project_status, 'CPO-2379', '2026-03-15', 'price', null);
      update pairs set refused = false where id = r.id;
    exception when others then
      update pairs set refused = (sqlerrm like 'illegal transition%') where id = r.id;
    end;
  end loop;
end $$;

select is(
  (select count(*) from pairs), 144::bigint, 'AC-2379-1: every (from, to) pair of the twelve statuses was walked');

select is(
  (select coalesce(jsonb_agg(frm || ' > ' || tos order by frm, tos), '[]'::jsonb) from pairs p, map_literal l
    where p.refused is distinct from not ((l.m -> p.frm) ? p.tos)),
  '[]'::jsonb,
  'AC-2379-1: the database refuses exactly the pairs outside the map literal, and accepts exactly those inside');

reset role;
select * from finish();
rollback;
