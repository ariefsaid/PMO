-- work_order_candidates.test.sql — #2595 (docs/specs/candidate-work-orders.spec.md).
-- Migrations under test: 1405 (tables, guards, RLS), 1406 (create; its template editor was dropped in 2680), 1407 (decide), 1408 (proof bucket).
-- AC-CWO-001..014 and 017. Every denial asserts the errcode AND the message.
-- Mutation checks (spec): drop the project-manager gate in decide_work_order_candidate -> AC-CWO-008 red; drop the
-- required-items test -> AC-CWO-004 red; drop the repeat-accept guard -> AC-CWO-006 red.
begin;
create extension if not exists pgtap;
select plan(61);

-- ── Fixtures (as the table owner): org A (admin, project manager of d1, another project manager, engineer, finance) and org B.
insert into organizations (id, name, default_currency) values
  ('25950000-0000-0000-0000-00000000000a', 'CWO Org', 'IDR'),
  ('25950000-0000-0000-0000-00000000000b', 'CWO Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25950000-0000-0000-0000-0000000000a1', 'cwo-admin@example.com'),
  ('25950000-0000-0000-0000-0000000000a2', 'cwo-fin@example.com'),
  ('25950000-0000-0000-0000-0000000000a3', 'cwo-pm@example.com'),
  ('25950000-0000-0000-0000-0000000000a4', 'cwo-eng@example.com'),
  ('25950000-0000-0000-0000-0000000000a5', 'cwo-pm2@example.com'),
  ('25950000-0000-0000-0000-0000000000b1', 'cwo-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25950000-0000-0000-0000-0000000000a1', '25950000-0000-0000-0000-00000000000a', 'CWO Admin', 'cwo-admin@example.com', 'Admin', 'active'),
  ('25950000-0000-0000-0000-0000000000a2', '25950000-0000-0000-0000-00000000000a', 'CWO Fin',   'cwo-fin@example.com',   'Finance', 'active'),
  ('25950000-0000-0000-0000-0000000000a3', '25950000-0000-0000-0000-00000000000a', 'CWO PM',    'cwo-pm@example.com',    'Project Manager', 'active'),
  ('25950000-0000-0000-0000-0000000000a4', '25950000-0000-0000-0000-00000000000a', 'CWO Eng',   'cwo-eng@example.com',   'Engineer', 'active'),
  ('25950000-0000-0000-0000-0000000000a5', '25950000-0000-0000-0000-00000000000a', 'CWO PM Two', 'cwo-pm2@example.com',  'Project Manager', 'active'),
  ('25950000-0000-0000-0000-0000000000b1', '25950000-0000-0000-0000-00000000000b', 'CWO XAdmin', 'cwo-xadmin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('25950000-0000-0000-0000-0000000000d1', '25950000-0000-0000-0000-00000000000a', 'CWO Site',     'Ongoing Project', '25950000-0000-0000-0000-0000000000a3', 'IDR'),
  ('25950000-0000-0000-0000-0000000000d2', '25950000-0000-0000-0000-00000000000a', 'CWO Site Two', 'Ongoing Project', '25950000-0000-0000-0000-0000000000a5', 'IDR'),
  ('25950000-0000-0000-0000-0000000000d9', '25950000-0000-0000-0000-00000000000b', 'CWO Other',    'Ongoing Project', null, 'IDR');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
create temp table cwo_ids (k text primary key, v uuid);
grant all on cwo_ids to authenticated;
create temp table cwo_bucket as select (public, file_size_limit, allowed_mime_types)::text as cfg from storage.buckets where id = 'work-order-candidate-proofs';
grant all on cwo_bucket to authenticated;

-- ── Org B has no template: a candidate has no items and the system supplies none (AC-CWO-003)
set local role authenticated;
select pg_temp.act_as('25950000-0000-0000-0000-0000000000b1');
insert into cwo_ids select 'xc', public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d9', 'Other org offer');
select is((select count(*)::int from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'xc')), 0,
  'AC-CWO-003 with no saved template a candidate has no items');
select is((select count(*)::int from work_order_checklist_items), 0, 'AC-CWO-003 no item text is supplied by the system');

-- ── Template: the org's list (edited since 2680 through set_work_order_check_template, proven in 2680_wo_capture_checks)
reset role;
insert into work_order_checklist_items (org_id, label, position, required) values
  ('25950000-0000-0000-0000-00000000000a', 'Alpha check', 1, true), ('25950000-0000-0000-0000-00000000000a', 'Beta check', 2, true),
  ('25950000-0000-0000-0000-00000000000a', 'Gamma check', 3, false);
insert into cwo_ids select 'ta', id from work_order_checklist_items where label = 'Alpha check';
insert into cwo_ids select 'tg', id from work_order_checklist_items where label = 'Gamma check';
set local role authenticated;

-- ── AC-CWO-001 create copies the template; roles that may create
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'Finance try') $$, '42501',
  'only an administrator, an engineer or the project''s project manager can open a candidate', 'FR-CWO-001 finance cannot open a candidate');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'Wrong PM try') $$, '42501',
  'only an administrator, an engineer or the project''s project manager can open a candidate', 'FR-CWO-001 another project''s manager cannot open one here');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a3');
insert into cwo_ids select 'c1', public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'Pipe repair', 'scope text', 'REF-77', '2026-11-20');
select is((select count(*)::int from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1')), 3,
  'AC-CWO-001 the candidate has exactly the template''s 3 items');
select is((select count(*)::int from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1') and status = 'open'), 3,
  'AC-CWO-001 each item is open');
select is((select array_agg(label order by position) from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1')),
  array['Alpha check', 'Beta check', 'Gamma check'], 'AC-CWO-001 items copy the template in order');

-- ── AC-CWO-002 a later template edit never changes an existing candidate
reset role;
update work_order_checklist_items set label = 'Alpha renamed' where id = (select v from cwo_ids where k = 'ta');
update work_order_checklist_items set archived_at = now() where org_id = '25950000-0000-0000-0000-00000000000a' and id <> (select v from cwo_ids where k = 'ta');
set local role authenticated;
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from work_order_checklist_items where archived_at is null), 1, 'AC-CWO-002 the template now has one live item');
select is((select array_agg(label order by position) from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1')),
  array['Alpha check', 'Beta check', 'Gamma check'], 'AC-CWO-002 the open candidate''s items are unchanged');

-- ── AC-CWO-013 another organisation sees none of it
select pg_temp.act_as('25950000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from work_order_candidates where project_id = '25950000-0000-0000-0000-0000000000d1'), 0, 'AC-CWO-013 org B reads no org A candidate');
select is((select count(*)::int from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1')), 0, 'AC-CWO-013 org B reads no org A item');
select is((select count(*)::int from work_order_checklist_items where label like 'Alpha%'), 0, 'AC-CWO-013 org B reads no org A template');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'rejected', 'x') $$, (select v from cwo_ids where k = 'c1')), 'P0002',
  'candidate not found', 'AC-CWO-013 org B cannot decide an org A candidate');
select throws_ok($$ select public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'Cross org') $$, 'P0002',
  'project not found', 'AC-CWO-013 org B cannot open a candidate under an org A project');

-- ── AC-CWO-004 accept refused while a required item is open
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a3');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'accepted', 'go') $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_NOT_READY: required items are not ready: Alpha check, Beta check', 'AC-CWO-004 accept is refused naming the open required items (the optional one is not named)');
select is((select count(*)::int from work_orders where title = 'Pipe repair'), 0, 'AC-CWO-004 no work order exists');

-- ── AC-CWO-008 only the project's project manager or an admin decides
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a4');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'rejected', 'engineer says no') $$, (select v from cwo_ids where k = 'c1')), '42501',
  'only the project''s project manager or an administrator can decide a candidate', 'AC-CWO-008 an engineer who is not the project manager is refused');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a2');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'rejected', 'finance says no') $$, (select v from cwo_ids where k = 'c1')), '42501',
  'only the project''s project manager or an administrator can decide a candidate', 'AC-CWO-008 finance (a non-assessing role) is refused');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a5');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'rejected', 'wrong pm says no') $$, (select v from cwo_ids where k = 'c1')), '42501',
  'only the project''s project manager or an administrator can decide a candidate', 'AC-CWO-008 another project''s manager is refused');
select is((select status from work_order_candidates where id = (select v from cwo_ids where k = 'c1')), 'assessing', 'AC-CWO-008 the candidate is unchanged');

-- ── AC-CWO-009 a blank reason is refused for both decisions
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a3');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'rejected', '   ') $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_REASON: a decision needs a reason of 1 to 500 characters', 'AC-CWO-009 a blank reason is refused when rejecting');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'accepted', null) $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_REASON: a decision needs a reason of 1 to 500 characters', 'AC-CWO-009 a missing reason is refused when accepting');

-- ── AC-CWO-010 no direct write of status or any decision column
select throws_ok(format($$ update work_order_candidates set status = 'accepted' where id = '%s' $$, (select v from cwo_ids where k = 'c1')), '42501',
  'permission denied for table work_order_candidates', 'AC-CWO-010 a direct status update is refused');
select throws_ok(format($$ update work_order_candidates set decision_reason = 'sneaky' where id = '%s' $$, (select v from cwo_ids where k = 'c1')), '42501',
  'permission denied for table work_order_candidates', 'AC-CWO-010 a direct decision-reason update is refused');
select throws_ok(format($$ update work_order_candidates set work_order_id = (select id from work_orders limit 1) where id = '%s' $$, (select v from cwo_ids where k = 'c1')), '42501',
  'permission denied for table work_order_candidates', 'AC-CWO-010 a direct work-order link update is refused');
select throws_ok($$ insert into work_order_candidates (project_id, title, offered_on) values ('25950000-0000-0000-0000-0000000000d1', 'direct', '2026-11-20') $$, '42501',
  'permission denied for table work_order_candidates', 'AC-CWO-010 a direct insert is refused (the RPC is the only way in)');

-- ── Item work: engineer sets a status; not-applicable needs a note; an ad-hoc item; an owner
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a4');
update work_order_candidate_items set status = 'passed', owner_id = '25950000-0000-0000-0000-0000000000a4', target_date = '2026-11-25'
 where candidate_id = (select v from cwo_ids where k = 'c1') and label = 'Alpha check';
select is((select status from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1') and label = 'Alpha check'), 'passed',
  'FR-CWO-003 an engineer sets an item''s status, owner and target');
select throws_ok(format($$ update work_order_candidate_items set status = 'not_applicable' where candidate_id = '%s' and label = 'Beta check' $$, (select v from cwo_ids where k = 'c1')),
  '23514', 'CWO_NA_NOTE: marking an item not applicable needs a note', 'FR-CWO-003 not applicable without a note is refused');
update work_order_candidate_items set status = 'not_applicable', note = 'covered by the site visit'
 where candidate_id = (select v from cwo_ids where k = 'c1') and label = 'Beta check';
select is((select status from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1') and label = 'Beta check'), 'not_applicable',
  'FR-CWO-003 not applicable with a note is accepted');
insert into work_order_candidate_items (candidate_id, label, required) values ((select v from cwo_ids where k = 'c1'), 'Ad hoc check', true);
select is((select position from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1') and label = 'Ad hoc check'), 4,
  'FR-CWO-004 an ad-hoc item is appended after the copied ones');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'accepted', 'go') $$, (select v from cwo_ids where k = 'c1')), '42501',
  'only the project''s project manager or an administrator can decide a candidate', 'AC-CWO-008 the engineer still cannot accept even when the items are ready');
-- the finance role may not touch an item (0 rows), an item owner may
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a2');
select is_empty(format($$ update work_order_candidate_items set status = 'passed' where candidate_id = '%s' and label = 'Ad hoc check' returning id $$, (select v from cwo_ids where k = 'c1')),
  'FR-CWO-003 finance cannot change an item');

-- ── proof file rows (FR-CWO-005)
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a4');
insert into cwo_ids select 'p1', gen_random_uuid();
insert into cwo_ids select 'item_alpha', id from work_order_candidate_items where candidate_id = (select v from cwo_ids where k = 'c1') and label = 'Alpha check';
select lives_ok(format($$ insert into work_order_candidate_proofs (id, item_id, file_path, file_name) values ('%s', '%s', '25950000-0000-0000-0000-00000000000a/%s/%s/site.pdf', 'site.pdf') $$,
  (select v from cwo_ids where k = 'p1'), (select v from cwo_ids where k = 'item_alpha'), (select v from cwo_ids where k = 'c1'), (select v from cwo_ids where k = 'p1')),
  'FR-CWO-005 a proof row under the candidate''s path is accepted');
select throws_ok(format($$ insert into work_order_candidate_proofs (item_id, file_path) values ('%s', 'elsewhere/file.pdf') $$, (select v from cwo_ids where k = 'item_alpha')), '23514',
  'CWO_PROOF_PATH: the file must be stored under {organisation}/{candidate}/{proof}/{name}', 'FR-CWO-005 a proof outside the candidate''s folder is refused');
-- storage: the bucket is private, size-limited and type-limited (AC-CWO-014); the object policies key on the org and the proof
select is((select cfg from cwo_bucket),
  '(f,10485760,"{image/png,image/jpeg,image/webp,application/pdf}")', 'AC-CWO-014 the proof bucket is private, 10 MB, images and PDF only');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner) values ('work-order-candidate-proofs', '25950000-0000-0000-0000-00000000000a/%s/%s/site.pdf', auth.uid()) $$,
  (select v from cwo_ids where k = 'c1'), (select v from cwo_ids where k = 'p1')), 'AC-CWO-014 an assessor uploads a proof file into the candidate''s folder');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a2');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner) values ('work-order-candidate-proofs', '25950000-0000-0000-0000-00000000000a/%s/%s/x.pdf', auth.uid()) $$,
  (select v from cwo_ids where k = 'c1'), gen_random_uuid()), '42501', 'new row violates row-level security policy for table "objects"',
  'AC-CWO-014 a role that cannot assess cannot upload');
select is((select count(*)::int from storage.objects where bucket_id = 'work-order-candidate-proofs'), 1, 'AC-CWO-014 a member of the organisation reads the proof file');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from storage.objects where bucket_id = 'work-order-candidate-proofs'), 0, 'AC-CWO-014 a member of another organisation cannot read the proof file');
select is((select count(*)::int from work_order_candidate_proofs), 0, 'AC-CWO-014 nor the proof row');

-- ── AC-CWO-005 accept with every required item ready; AC-CWO-012 the Draft is untouched money-wise
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a4');
update work_order_candidate_items set status = 'passed' where candidate_id = (select v from cwo_ids where k = 'c1') and label in ('Ad hoc check', 'Gamma check');
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a3');
insert into cwo_ids select 'wo1', (public.decide_work_order_candidate((select v from cwo_ids where k = 'c1'), 'accepted', 'site and cost confirmed')->>'work_order_id')::uuid;
select is((select status from work_order_candidates where id = (select v from cwo_ids where k = 'c1')), 'accepted', 'AC-CWO-005 the candidate is accepted');
select is((select work_order_id from work_order_candidates where id = (select v from cwo_ids where k = 'c1')), (select v from cwo_ids where k = 'wo1'),
  'AC-CWO-005 the candidate holds the work order id');
select is((select count(*)::int from work_orders where project_id = '25950000-0000-0000-0000-0000000000d1' and title = 'Pipe repair'), 1,
  'AC-CWO-005 one work order exists on the same project');
select is((select decision_reason || '/' || (decided_by = '25950000-0000-0000-0000-0000000000a3')::text from work_order_candidates where id = (select v from cwo_ids where k = 'c1')),
  'site and cost confirmed/true', 'AC-CWO-005 the reason and decider are on record');
select is((select (status::text, order_value, wo_number, client_po_number, description, issued_at)::text from work_orders where id = (select v from cwo_ids where k = 'wo1')),
  '(Draft,0.00,,REF-77,"scope text",)', 'AC-CWO-012 the work order is a Draft with value 0, no number, the client reference mapped and nothing issued');

-- ── AC-CWO-006 accepting again returns the same work order
select is((public.decide_work_order_candidate((select v from cwo_ids where k = 'c1'), 'accepted', 'again')->>'work_order_id')::uuid, (select v from cwo_ids where k = 'wo1'),
  'AC-CWO-006 a repeat accept returns the same work order id');
select is((select count(*)::int from work_orders where project_id = '25950000-0000-0000-0000-0000000000d1' and title = 'Pipe repair'), 1,
  'AC-CWO-006 still one work order from it');
select throws_ok(format($$ select public.decide_work_order_candidate('%s', 'rejected', 'changed my mind') $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_DECIDED: this candidate has already been accepted', 'FR-CWO-015 a decided candidate is never reopened or flipped');

-- ── AC-CWO-011 a decided candidate's items and proofs are read-only
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a4');
select is_empty(format($$ update work_order_candidate_items set status = 'failed' where candidate_id = '%s' returning id $$, (select v from cwo_ids where k = 'c1')),
  'AC-CWO-011 an assessor''s item edit on a decided candidate changes nothing');
select throws_ok(format($$ insert into work_order_candidate_items (candidate_id, label) values ('%s', 'late') $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_DECIDED: a decided candidate''s assessment is read-only', 'AC-CWO-011 a new item on a decided candidate is refused');
select throws_ok(format($$ insert into work_order_candidate_proofs (item_id, file_path) values ('%s', 'x') $$, (select v from cwo_ids where k = 'item_alpha')), '23514',
  'CWO_DECIDED: a decided candidate''s assessment is read-only', 'AC-CWO-011 a new proof on a decided candidate is refused');
reset role;
select throws_ok(format($$ update work_order_candidate_items set status = 'failed' where candidate_id = '%s' $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_DECIDED: a decided candidate''s assessment is read-only', 'AC-CWO-011 the database refuses it for every writer, not only through policy');
select throws_ok(format($$ update work_order_candidates set title = 'renamed' where id = '%s' $$, (select v from cwo_ids where k = 'c1')), '23514',
  'CWO_DECIDED: a decided candidate is never reopened or edited', 'AC-CWO-011 a decided candidate''s own body is frozen');

-- ── AC-CWO-007 reject with failed items; AC-CWO-017 a replacement names the earlier one
set local role authenticated;
select pg_temp.act_as('25950000-0000-0000-0000-0000000000a3');
insert into cwo_ids select 'c2', public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'Tank relining');
update work_order_candidate_items set status = 'failed', note = 'access blocked' where candidate_id = (select v from cwo_ids where k = 'c2') and label = 'Alpha renamed';
select is((public.decide_work_order_candidate((select v from cwo_ids where k = 'c2'), 'rejected', 'site not reachable')->>'status'), 'rejected', 'AC-CWO-007 reject with failed items is allowed');
select is((select (status, decision_reason, work_order_id is null)::text from work_order_candidates where id = (select v from cwo_ids where k = 'c2')),
  '(rejected,"site not reachable",t)', 'AC-CWO-007 rejected, the reason is stored and no work order is linked');
select is((select count(*)::int from work_orders where title = 'Tank relining'), 0, 'AC-CWO-007 no work order exists');
insert into cwo_ids select 'c3', public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'Tank relining, revised', null, null, null, (select v from cwo_ids where k = 'c2'));
select is((select replaces_id from work_order_candidates where id = (select v from cwo_ids where k = 'c3')), (select v from cwo_ids where k = 'c2'),
  'AC-CWO-017 the new candidate names the rejected one');
select is((select (status, decision_reason)::text from work_order_candidates where id = (select v from cwo_ids where k = 'c2')), '(rejected,"site not reachable")',
  'AC-CWO-017 the earlier decision is unchanged');
select throws_ok(format($$ select public.create_work_order_candidate('25950000-0000-0000-0000-0000000000d1', 'bad replace', null, null, null, '%s') $$, (select v from cwo_ids where k = 'c3')),
  '23514', 'CWO_REPLACES: a candidate can replace only a rejected candidate of the same project', 'AC-CWO-017 only a rejected candidate can be replaced');

-- ── audit (FR-CWO-018): who and when
reset role;
select ok((select count(*) from audit_events where action = 'work_order_candidate.update' and entity_id = (select v from cwo_ids where k = 'c1')
            and actor_id = '25950000-0000-0000-0000-0000000000a3' and detail #>> '{after,status}' = 'accepted') = 1,
  'FR-CWO-018 the decision is on the audit trail with who');
select ok((select count(*) from audit_events where action = 'work_order_candidate_item.update' and actor_id = '25950000-0000-0000-0000-0000000000a4') >= 3,
  'FR-CWO-018 item changes are on the audit trail');

select * from finish();
rollback;
