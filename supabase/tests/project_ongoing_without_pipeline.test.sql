-- project_ongoing_without_pipeline.test.sql — #3023 (AC-3023).
-- An organisation whose sales-pipeline module is off must still be able to run delivery on a
-- project: transition_project accepts Leads → Won, Pending KoM (then the ordinary
-- Won, Pending KoM → Ongoing Project) EXACTLY when the feature is off for the project's
-- organisation, and project_win_eligibility (the screen's win preflight) offers the win on the
-- same condition. Entering a pipeline stage keeps asserting the feature, so the branch is
-- reachable only with the feature off.
-- WHO MAY CHANGE A STATUS IS UNCHANGED: the coarse role gate (Admin/Executive/Project Manager/
-- Finance) and the value-witness money SoD run before and after this branch exactly as before —
-- the Engineer leg and the unwitnessed-value leg below pin that.
-- Mutation-check: drop 2785's feature-off exception in the legality gate (or in the eligibility
-- preflight) and the feature-off win legs go red; loosen the role gate or the witness rule and
-- the Engineer/unwitnessed legs go red; make the win unconditional and the feature-on refusal
-- leg goes red.
-- Isolated orgs; UUID prefix 30230000-… (issue #3023).
begin;
create extension if not exists pgtap;
select plan(15);

-- The org WITHOUT the pipeline (the issue's shape): the override row turns the feature off
-- (resolve_feature_internal precedence: override > global > plan).
insert into organizations (id, name) values
  ('30230000-0000-0000-0000-000000000001','Pipeline-Off Org (3023)'),
  ('30230000-0000-0000-0000-000000000002','Pipeline-On Org (3023)');
insert into org_features (org_id, feature_key, enabled)
  values ('30230000-0000-0000-0000-000000000001','sales_pipeline', false);

insert into auth.users (id, email) values
  ('30230000-0000-0000-0000-0000000000a1','pm-off3023@example.com'),
  ('30230000-0000-0000-0000-0000000000a2','admin-off3023@example.com'),
  ('30230000-0000-0000-0000-0000000000a3','eng-off3023@example.com'),
  ('30230000-0000-0000-0000-0000000000b1','pm-on3023@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('30230000-0000-0000-0000-0000000000a1','30230000-0000-0000-0000-000000000001','PM Off 3023','pm-off3023@example.com','Project Manager'),
  ('30230000-0000-0000-0000-0000000000a2','30230000-0000-0000-0000-000000000001','Admin Off 3023','admin-off3023@example.com','Admin'),
  ('30230000-0000-0000-0000-0000000000a3','30230000-0000-0000-0000-000000000001','Eng Off 3023','eng-off3023@example.com','Engineer'),
  ('30230000-0000-0000-0000-0000000000b1','30230000-0000-0000-0000-000000000002','PM On 3023','pm-on3023@example.com','Project Manager');

-- One project per leg. The value-bearing rows carry their witness stamps directly (the
-- witness-authoring path is owned by 0170/0177; this file reads only what transition_project reads).
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('30230000-0000-0000-0000-000000000010','30230000-0000-0000-0000-000000000001','P3023-A','Off-org value-less lead','Leads','30230000-0000-0000-0000-0000000000a1'),
  ('30230000-0000-0000-0000-000000000011','30230000-0000-0000-0000-000000000001','P3023-B','Off-org unwitnessed lead','Leads','30230000-0000-0000-0000-0000000000a1'),
  ('30230000-0000-0000-0000-000000000012','30230000-0000-0000-0000-000000000001','P3023-C','Off-org witnessed lead','Leads','30230000-0000-0000-0000-0000000000a1'),
  ('30230000-0000-0000-0000-000000000013','30230000-0000-0000-0000-000000000001','P3023-D','Off-org stage lead','Leads','30230000-0000-0000-0000-0000000000a1'),
  ('30230000-0000-0000-0000-000000000014','30230000-0000-0000-0000-000000000001','P3023-E','Off-org engineer lead','Leads','30230000-0000-0000-0000-0000000000a1'),
  ('30230000-0000-0000-0000-000000000015','30230000-0000-0000-0000-000000000002','P3023-F','On-org lead','Leads','30230000-0000-0000-0000-0000000000b1'),
  ('30230000-0000-0000-0000-000000000016','30230000-0000-0000-0000-000000000001','P3023-G','Off-org internal lead','Leads','30230000-0000-0000-0000-0000000000a1');
update projects set contract_value = 5000, tax_treatment = 'exclusive', tax_amount = 0,
         contract_value_set_at = now()
  where id in ('30230000-0000-0000-0000-000000000011','30230000-0000-0000-0000-000000000012');
-- The witnessed lead's value was authored by the org's Admin (outranks the PM: rank limb of
-- may_approve_work_of) and the Admin is an active member — the permit shape of 0177/0183.
update projects set contract_value_set_by = '30230000-0000-0000-0000-0000000000a2'
  where id = '30230000-0000-0000-0000-000000000012';

-- ── The job (role: Project Manager, organisation without the pipeline) ──────
set local role authenticated;
set local request.jwt.claims = '{"sub":"30230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The win preflight offers the win on a Lead exactly when the feature is off.
select is(
  (select project_win_eligibility('30230000-0000-0000-0000-000000000010')),
  'allowed'::text,
  'AC-3023: the win preflight allows a value-less Lead in a pipeline-off organisation');

-- The role-job leg: the PM wins the Lead (contract ref + date), then starts it.
select lives_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000010','Won, Pending KoM','CPO-3023','2026-11-28') $$,
  'AC-3023: Leads → Won, Pending KoM is accepted for a pipeline-off organisation (no pipeline stage)');

select lives_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-3023: Won, Pending KoM → Ongoing Project is accepted (the ordinary start)');

select is(
  (select status::text from projects where id = '30230000-0000-0000-0000-000000000010'),
  'Ongoing Project',
  'AC-3023: the lead reached Ongoing Project');

select is(
  (select customer_contract_ref from projects where id = '30230000-0000-0000-0000-000000000010'),
  'CPO-3023',
  'AC-3023: the win recorded the customer contract reference');

select ok(
  (select decided_at is not null and contract_date = date '2026-11-28'
     from projects where id = '30230000-0000-0000-0000-000000000010'),
  'AC-3023: the win recorded the contract date and the decision stamp');

-- The witnessed priced lead also wins: the money SoD is untouched by the new branch.
select lives_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000012','Won, Pending KoM','CPO-3023W','2026-11-28') $$,
  'AC-3023: a priced Lead whose value a senior member set still wins (money SoD intact)');

-- ── The refusals that must NOT move ─────────────────────────────────────────
-- The feature gate keeps refusing pipeline stages for the pipeline-off organisation (this is the
-- stuck state the issue describes; it stays for the stages themselves).
select throws_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000013','Quotation Submitted') $$,
  'P0001', 'feature_off',
  'AC-3023: entering a pipeline stage still asserts the feature (feature_off)');

-- The money SoD holds on the new branch: an unwitnessed priced Lead refuses with the witness code.
select throws_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000011','Won, Pending KoM','CPO-3023U','2026-11-28') $$,
  '42501', null,
  'AC-3023: an unwitnessed priced Lead cannot be won by the PM (money SoD intact)');

-- The role gate holds on the new branch: an Engineer cannot change a project's status at all.
select throws_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000014','Won, Pending KoM','CPO-3023E','2026-11-28') $$,
  '42501', null,
  'AC-3023: an Engineer is still refused (role gate intact)');

-- ── Feature ON: everything as before ────────────────────────────────────────
set local request.jwt.claims = '{"sub":"30230000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000015','Won, Pending KoM','CPO-3023ON','2026-11-28') $$,
  'P0001', null,
  'AC-3023: with the feature on, Leads → Won stays an illegal jump (the map is unchanged)');

select is(
  (select project_win_eligibility('30230000-0000-0000-0000-000000000015')),
  'unavailable'::text,
  'AC-3023: with the feature on, the preflight keeps a Lead unwinnable');

-- The preflight stays witness-aware on the new branch (the screen shows the same diagnosis).
select is(
  (select project_win_eligibility('30230000-0000-0000-0000-000000000011')),
  'missing_witness'::text,
  'AC-3023: the preflight reports the missing witness for the unwitnessed priced Lead');

reset role;

-- The rest of the map is untouched: a Lead can still be filed away as an Internal Project.
set local role authenticated;
set local request.jwt.claims = '{"sub":"30230000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('30230000-0000-0000-0000-000000000016','Internal Project') $$,
  'AC-3023: Leads → Internal Project is unchanged');

reset role;
select * from finish();
rollback;
