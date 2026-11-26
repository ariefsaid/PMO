-- work_order_candidates.test.sql — #2915: the candidate work order writers are retired (migration 2720).
-- The records stay: candidates, items and proofs read for their own organisation only; the check template still reads.
begin;
create extension if not exists pgtap;
select plan(27);

select hasnt_function('public', 'create_work_order_candidate', array['uuid','text','text','text','date','uuid'], '#2915 create function is gone');
select hasnt_function('public', 'decide_work_order_candidate', array['uuid','text','text'], '#2915 decide function is gone');
select hasnt_function('public', 'set_work_order_candidate_template', array['jsonb'], '#2915 template editor stays gone');
select hasnt_function('public', 'check_work_order_candidate_item', '#2915 item guard function is gone');
select hasnt_function('public', 'check_work_order_candidate_proof', '#2915 proof guard function is gone');
select hasnt_function('public', 'check_work_order_candidate_update', '#2915 candidate guard function is gone');
select hasnt_function('public', 'wo_candidate_can_assess', '#2915 assess helper is gone');
select hasnt_function('public', 'wo_candidate_item_can_edit', '#2915 item-edit helper is gone');
select has_function('public', 'audit_work_order_candidate_row', '#2915 the audit function the check template still uses is kept');

select hasnt_trigger('public', 'work_order_candidate_items', 'zz_work_order_candidate_items_check', '#2915 item guard trigger is gone');
select hasnt_trigger('public', 'work_order_candidates', 'zz_work_order_candidates_audit', '#2915 candidate audit trigger is gone');
select has_trigger('public', 'work_order_checklist_items', 'zz_work_order_checklist_items_audit', '#2915 the check template audit trigger is kept');

select is((select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'storage_objects_wo_candidate_proof%'), 0,
  '#2915 no bucket policy remains');
select is((select count(*)::int from pg_policies where schemaname = 'public'
            and tablename in ('work_order_candidates', 'work_order_candidate_items', 'work_order_candidate_proofs') and cmd <> 'SELECT'), 0,
  '#2915 the candidate tables keep read policies only');

-- ── Fixtures (table owner): two organisations, one candidate with an item in each.
insert into organizations (id, name, default_currency) values
  ('29150000-0000-0000-0000-00000000000a', 'Retire Org A', 'IDR'), ('29150000-0000-0000-0000-00000000000b', 'Retire Org B', 'IDR');
insert into auth.users (id, email) values
  ('29150000-0000-0000-0000-0000000000a1', 'retire-a@example.com'), ('29150000-0000-0000-0000-0000000000b1', 'retire-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('29150000-0000-0000-0000-0000000000a1', '29150000-0000-0000-0000-00000000000a', 'Retire A', 'retire-a@example.com', 'Admin', 'active'),
  ('29150000-0000-0000-0000-0000000000b1', '29150000-0000-0000-0000-00000000000b', 'Retire B', 'retire-b@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('29150000-0000-0000-0000-0000000000d1', '29150000-0000-0000-0000-00000000000a', 'Retire Site', 'Ongoing Project', null, 'IDR');
insert into work_order_candidates (id, org_id, project_id, title, offered_on, created_by) values
  ('29150000-0000-0000-0000-0000000000c1', '29150000-0000-0000-0000-00000000000a', '29150000-0000-0000-0000-0000000000d1', 'Earlier offer', '2026-11-20', '29150000-0000-0000-0000-0000000000a1');
insert into work_order_candidate_items (id, org_id, candidate_id, label) values
  ('29150000-0000-0000-0000-0000000000e1', '29150000-0000-0000-0000-00000000000a', '29150000-0000-0000-0000-0000000000c1', 'Earlier check');
insert into work_order_checklist_items (org_id, label, position, required) values
  ('29150000-0000-0000-0000-00000000000a', 'Template check', 1, true);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;

select pg_temp.act_as('29150000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from work_order_candidates), 1, '#2915 a member reads the earlier candidate');
select is((select count(*)::int from work_order_candidate_items), 1, '#2915 a member reads its items');
select is((select count(*)::int from work_order_checklist_items), 1, '#2915 a member reads the check template');
select throws_ok($$ insert into work_order_candidates (project_id, title, offered_on) values ('29150000-0000-0000-0000-0000000000d1', 'new', '2026-11-26') $$,
  '42501', null, '#2915 a member can no longer create a candidate');
select throws_ok($$ update work_order_candidate_items set status = 'passed' $$, '42501', null, '#2915 a member can no longer change an item');

select pg_temp.act_as('29150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from work_order_candidates), 0, '#2915 another organisation reads no candidate');
select is((select count(*)::int from work_order_candidate_items) + (select count(*)::int from work_order_checklist_items), 0,
  '#2915 another organisation reads no item or template');

-- Direct write on the candidate table: refused for every role, Admin included (no policy, no grant).
select pg_temp.act_as('29150000-0000-0000-0000-0000000000a1');
select throws_ok($$ update work_order_candidates set title = 'renamed' $$, '42501', null, '#2915 an Admin cannot update a candidate directly');
reset role;
select is((select title from work_order_candidates where id = '29150000-0000-0000-0000-0000000000c1'), 'Earlier offer', '#2915 the candidate is unchanged');
set local role authenticated;

-- Proof rows and the proof bucket.
reset role;
insert into work_order_candidate_proofs (id, org_id, item_id, file_path, file_name) values
  ('29150000-0000-0000-0000-0000000000f1', '29150000-0000-0000-0000-00000000000a', '29150000-0000-0000-0000-0000000000e1',
   '29150000-0000-0000-0000-00000000000a/29150000-0000-0000-0000-0000000000c1/29150000-0000-0000-0000-0000000000f1/site.pdf', 'site.pdf');
insert into storage.objects (bucket_id, name) values ('work-order-candidate-proofs',
  '29150000-0000-0000-0000-00000000000a/29150000-0000-0000-0000-0000000000c1/29150000-0000-0000-0000-0000000000f1/site.pdf');
set local role authenticated;
select pg_temp.act_as('29150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from work_order_candidate_proofs), 0, '#2915 another organisation reads no proof row');
select is((select count(*)::int from storage.objects where bucket_id = 'work-order-candidate-proofs'), 0, '#2915 no client reads a proof file');
select pg_temp.act_as('29150000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from storage.objects where bucket_id = 'work-order-candidate-proofs'), 0, '#2915 not even a member of the owning organisation');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner) values ('work-order-candidate-proofs', '29150000-0000-0000-0000-00000000000a/x/y/z.pdf', auth.uid()) $$,
  '42501', null, '#2915 no client writes a proof file');

select * from finish();
rollback;
