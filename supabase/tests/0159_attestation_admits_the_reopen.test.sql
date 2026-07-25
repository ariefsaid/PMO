-- 0159_attestation_admits_the_reopen.test.sql
-- AC-TSC-R11 — after a SUCCESSFUL attestation the re-open is ADMITTED, not refused with the same code.
--
-- ⚑ WHY THIS EXISTS (Luna FU-1a round-12 SHOULD-FIX 2, reproduced against the migrated DB). The
-- attestation is the ONLY documented route out of a post-submit unknown, and it cleared the WITNESS
-- only. `0157 §4` refuses the re-open on THREE independent predicates, and the third — a mirror still
-- sitting at `push_state='held'` — no operator action could clear:
--   • `release_outbox_hold` refuses a non-`held` OUTBOX row (0152:79-81), and both producers of this
--     state leave the outbox terminal or absent;
--   • the sweep excludes a `held` mirror from its queue and skips the timesheets domain in pass 1;
--   • `attest_timesheet_no_erp_document` touched only the witness.
-- So an operator who did the one thing the surface tells them to do got the IDENTICAL refusal
-- afterwards, and their only remaining in-product act (Retry) re-POSTs the original hours — the one act
-- that can permanently foreclose the correction. The fence worked; its escape hatch did not.
--
-- The oracle here is deliberately the END STATE A USER CARES ABOUT — the week is back in `Draft` — not
-- the intermediate column. Asserting `post_submit_unknown_at is null` is what let this ship: it was true
-- the whole time, and the week was still stranded.
--
-- Two producers of the stranded state are driven, both through the SHIPPED writers:
--   SHEET A — 0158's lost-CAS door: `mark_outbox_held` stamps the witness and creates the mirror `held`
--             even when its own CAS returns 0, and the winning claimant then terminal-fails the outbox.
--   SHEET B — the PRE-EXISTING sweep park (`parkTimesheetMirrorRow(row,'held',
--             'timesheet-push-attempts-exhausted')`), whose outbox row is by definition not `held`.
-- Plus the two controls that keep the fix narrow: the escape hatch must NOT weaken the fence (SHEET C),
-- and it must move NO push_state other than `held` (SHEET D).
begin;
select plan(10);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01590000-0000-0000-0000-00000000000a','Attestation Org');

insert into auth.users (id, email) values
  ('01590000-0000-0000-0000-0000000000a1','attest-admin@example.com'),
  ('01590000-0000-0000-0000-0000000000a2','attest-owner@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01590000-0000-0000-0000-0000000000a1','01590000-0000-0000-0000-00000000000a',
   'Admin A','attest-admin@example.com','Admin', null),
  ('01590000-0000-0000-0000-0000000000a2','01590000-0000-0000-0000-00000000000a',
   'Owner A','attest-owner@example.com','Engineer','01590000-0000-0000-0000-0000000000a1');

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01590000-0000-0000-0000-000000000010','01590000-0000-0000-0000-00000000000a',
   '01590000-0000-0000-0000-0000000000a2','2026-06-01','Approved','01590000-0000-0000-0000-0000000000a1', now()),
  ('01590000-0000-0000-0000-000000000011','01590000-0000-0000-0000-00000000000a',
   '01590000-0000-0000-0000-0000000000a2','2026-06-08','Approved','01590000-0000-0000-0000-0000000000a1', now()),
  ('01590000-0000-0000-0000-000000000012','01590000-0000-0000-0000-00000000000a',
   '01590000-0000-0000-0000-0000000000a2','2026-06-15','Approved','01590000-0000-0000-0000-0000000000a1', now()),
  ('01590000-0000-0000-0000-000000000013','01590000-0000-0000-0000-00000000000a',
   '01590000-0000-0000-0000-0000000000a2','2026-06-22','Approved','01590000-0000-0000-0000-0000000000a1', now());

-- Mints a held command through the SHIPPED writers, keyed exactly as the originators derive it.
-- `p_gen_offset` = 0 drives the ordinary hold (the CAS lands); a non-zero offset drives 0158's
-- lost-CAS door, where the hold transition matches 0 rows and the witness is stamped anyway.
create table pg_temp.ids (label text primary key, id uuid, gen int);
create function pg_temp.seed_held_command(p_label text, p_sheet uuid, p_gen_offset int) returns void
  language plpgsql as $fn$
declare v_id uuid; v_gen int; v_key text;
begin
  v_key := 'ts:' || p_sheet::text || ':'
           || (select approved_at::text from public.timesheets where id = p_sheet);
  select id into v_id from public.insert_timesheet_outbox_pending(
    p_org := (select org_id from public.timesheets where id = p_sheet),
    p_domain := 'timesheets', p_record_id := p_sheet::text, p_key := v_key,
    p_tier := 'erpnext', p_operation := 'create', p_payload := null, p_digest := null, p_actor := null);
  select claim_generation into v_gen from public.claim_outbox_for_commit(v_id);
  if v_gen is null then raise exception 'fixture: the shipped claim refused %', p_sheet; end if;
  perform public.mark_outbox_held(v_id, v_gen + p_gen_offset, 'recovery-probe-failed: deterministic');
  insert into pg_temp.ids values (p_label, v_id, v_gen);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET A — 0158's lost-CAS door. The fenced-out claimant stamps the witness + creates the mirror
-- `held`; the WINNING claimant then terminal-fails the outbox (the shape `markOutboxFailed` writes:
-- an UPDATE to `failed` guarded on its own claim generation). Nothing on that path records a mirror
-- outcome — the sweep has no mirror failure recorder at all.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.seed_held_command('lost-cas', '01590000-0000-0000-0000-000000000010', 7);

update external_command_outbox
   set state = 'failed', last_error = 'external-unreachable'
 where id = (select id from pg_temp.ids where label = 'lost-cas')
   and claim_generation = (select gen from pg_temp.ids where label = 'lost-cas');

select is(
  (select push_state || '|' || (post_submit_unknown_at is not null)::text
     from timesheet_erp_mirror where timesheet_id = '01590000-0000-0000-0000-000000000010'),
  'held|true',
  'AC-TSC-R11: precondition — a lost-CAS hold leaves the mirror `held` with the unknown witnessed, and no release can reach it (its outbox is terminal)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01590000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R11: precondition — the re-open is refused while the unknown stands');

-- The Admin goes and looks in ERPNext, finds no Timesheet for the week, and says so.
select lives_ok(
  $$ select attest_timesheet_no_erp_document('01590000-0000-0000-0000-000000000010',
       'Checked ERPNext: no Timesheet exists for this employee and week') $$,
  'AC-TSC-R11: the audited Admin attestation succeeds');

-- ⚑ THE ORACLE: the week a user cares about is back in Draft — the attestation is a route OUT, not a
-- column edit that leaves the identical refusal behind.
select transition_timesheet('01590000-0000-0000-0000-000000000010','Draft');
reset role;
select is(
  (select status::text from timesheets where id = '01590000-0000-0000-0000-000000000010'),
  'Draft',
  'AC-TSC-R11: after a SUCCESSFUL attestation the re-open is ADMITTED — the week returns to Draft for correction');

-- ⚑ MINOR 3 (same round) — an attested row lands in the `failed` "needs attention" queue, whose copy
-- layer splits `<code>: <detail>`. The reason it leaves behind must therefore be a CLASSIFIABLE code,
-- or the row an operator reached by doing exactly what the product asked reads back "a reason this
-- screen could not be classified".
select ok(
  (select push_error like 'operator-attested-no-erp-document:%'
     from timesheet_erp_mirror where timesheet_id = '01590000-0000-0000-0000-000000000010'),
  'AC-TSC-R11: the attestation leaves a CODE-SHAPED push_error the operator surface can classify');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET B — the PRE-EXISTING producer: the sweep's attempts-exhausted park. `parkTimesheetMirrorRow`
-- creates the mirror row `held` + the witness in one PostgREST patch, and there is no outbox row in
-- `held` behind it — so `release_outbox_hold` was never a route out of this one either.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, post_submit_unknown_at)
values ('01590000-0000-0000-0000-00000000000a','01590000-0000-0000-0000-000000000011',
        'held','timesheet-push-attempts-exhausted', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"01590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01590000-0000-0000-0000-000000000011','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R11: precondition — the sweep-parked week is refused too');
select attest_timesheet_no_erp_document('01590000-0000-0000-0000-000000000011',
  'Checked ERPNext: the exhausted attempts never landed a Timesheet');
select transition_timesheet('01590000-0000-0000-0000-000000000011','Draft');
reset role;
select is(
  (select status::text from timesheets where id = '01590000-0000-0000-0000-000000000011'),
  'Draft',
  'AC-TSC-R11: the sweep-parked week is admitted after its attestation too — the route out is the same one');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET C — CONTROL: the escape hatch does NOT weaken the fence. A LIVE held outbox command is still a
-- command that may be inside ERPNext right now; the attestation answers the mirror's question and the
-- outbox predicate keeps refusing on its own.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.seed_held_command('live-hold', '01590000-0000-0000-0000-000000000012', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"01590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select attest_timesheet_no_erp_document('01590000-0000-0000-0000-000000000012',
  'Checked ERPNext: no Timesheet on record');
select throws_ok(
  $$ select transition_timesheet('01590000-0000-0000-0000-000000000012','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R11 control: a still-HELD outbox command keeps refusing the re-open — an attestation is not a release');
reset role;
select is(
  (select state from external_command_outbox where id = (select id from pg_temp.ids where label = 'live-hold')),
  'held',
  'AC-TSC-R11 control: and the attestation moves no outbox row — it answers what ERPNext holds, never "can the backstop retry this"');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET D — CONTROL: the CAS is `held`-only. A desk-CANCELLED document (`erp_cancelled_at` set) keeps
-- its `pushed` state and its `ts_number` — 0157 §2 rule 1 deliberately does NOT clear the witness on a
-- tombstoned document, so the attestation is reachable there and must not rewrite the push history.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, ts_number, erp_cancelled_at, post_submit_unknown_at)
values ('01590000-0000-0000-0000-00000000000a','01590000-0000-0000-0000-000000000013',
        'pushed','TS-0013', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"01590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select attest_timesheet_no_erp_document('01590000-0000-0000-0000-000000000013',
  'Checked ERPNext: the cancelled document is the only one; the later generation minted nothing');
reset role;
select is(
  (select push_state || '|' || coalesce(ts_number,'-')
     from timesheet_erp_mirror where timesheet_id = '01590000-0000-0000-0000-000000000013'),
  'pushed|TS-0013',
  'AC-TSC-R11 control: a non-`held` push_state is left exactly as it was — the attestation widens to the hold and nothing else');

select * from finish();
rollback;
