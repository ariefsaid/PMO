-- 0152_reopen_refuses_held_mirror.test.sql
-- AC-TSC-R5 — the re-open REFUSES while the `timesheet_erp_mirror` is `held`, and behaves per the
-- existing rules once the hold has been released.
--
-- ⚑ WHY (Luna FU-1a round-4 BLOCK, the money half). `held` on the mirror means exactly one thing: PMO
-- DOES NOT KNOW whether ERPNext holds a document for this week (the POST/submit succeeded, then the
-- read-back failed deterministically — `markTimesheetPushOutcome`'s `command-held` arm). That is
-- precisely the state this slice must never admit: a re-open followed by a re-approve mints a SECOND
-- ERP Timesheet for a week ERPNext may already hold, and the client's hours double-count. The outbox
-- hold covers the same window only while the outbox is non-terminal; the mirror is an INDEPENDENT
-- witness, written by an independent writer, and it must fence on its own.
--
-- Two states are asserted:
--   (a) mirror `held` + a TERMINAL (`failed`) outbox row → REFUSES `reopen-push-outcome-unknown`,
--       and the sheet stays Approved. Without this arm 0151 ADMITS: `failed` is deliberately terminal
--       (a clean rejection mints no document) and no other predicate looks at the mirror unless a
--       `ts_number` is set — which is exactly what a failed read-back never learned.
--   (b) after an Admin `release_outbox_hold` (which releases BOTH rows), the ordinary rules apply
--       again: no live document + a terminal outbox ⇒ the re-open ADMITS.
begin;
select plan(7);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01521000-0000-0000-0000-00000000000a','Reopen Held Mirror Org');

insert into auth.users (id, email) values
  ('01521000-0000-0000-0000-0000000000a1','rhm-owner@example.com'),
  ('01521000-0000-0000-0000-0000000000a2','rhm-mgr@example.com'),
  ('01521000-0000-0000-0000-0000000000a3','rhm-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01521000-0000-0000-0000-0000000000a1','01521000-0000-0000-0000-00000000000a',
   'Owner U','rhm-owner@example.com','Engineer','01521000-0000-0000-0000-0000000000a2'),
  ('01521000-0000-0000-0000-0000000000a2','01521000-0000-0000-0000-00000000000a',
   'Manager M','rhm-mgr@example.com','Engineer', null),
  ('01521000-0000-0000-0000-0000000000a3','01521000-0000-0000-0000-00000000000a',
   'Admin A','rhm-admin@example.com','Admin', null);

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01521000-0000-0000-0000-000000000010','01521000-0000-0000-0000-00000000000a',
   '01521000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01521000-0000-0000-0000-0000000000a2', now()),
  ('01521000-0000-0000-0000-000000000011','01521000-0000-0000-0000-00000000000a',
   '01521000-0000-0000-0000-0000000000a1','2026-06-08','Approved','01521000-0000-0000-0000-0000000000a2', now());

-- The outbox rows come from the SHIPPED writers (the fenced guard RPC + `claim_outbox_for_commit` +
-- either the fenced `failed` write-back `markOutboxFailed` issues, or `mark_outbox_held`).
create function pg_temp.seed_command(p_sheet uuid, p_target text) returns uuid
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
  if p_target = 'failed' then                       -- deps.markOutboxFailed (fenced write-back)
    update public.external_command_outbox
       set state = 'failed', last_error = 'mirror-write-failed'
     where id = v_id and claim_generation = v_gen;
  elsif p_target = 'held' then                      -- the deterministic-probe-failure hold
    if public.mark_outbox_held(v_id, v_gen, 'recovery-inconclusive') <> 1 then
      raise exception 'fixture: the shipped hold refused %', p_sheet;
    end if;
  else
    raise exception 'fixture: unknown target %', p_target;
  end if;
  return v_id;
end; $fn$;

create table pg_temp.ids (label text primary key, id uuid);
insert into pg_temp.ids values
  -- (a) the outbox is TERMINAL while the mirror still holds — the window in which 0151 alone admits.
  ('a', pg_temp.seed_command('01521000-0000-0000-0000-000000000010', 'failed')),
  -- (b) both rows held — the ordinary shape an operator releases.
  ('b', pg_temp.seed_command('01521000-0000-0000-0000-000000000011', 'held'));
-- the RPC calls below run as `authenticated`, which must be able to read the fixture's id table.
grant select on pg_temp.ids to authenticated;

-- Mirrors written exactly as `markTimesheetPushOutcome`'s `command-held` arm writes them: push_state
-- `held`, the classified reason, and NO ts_number (the read-back never learned one — that absence is
-- the whole problem).
insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, approved_at_pushed) values
  ('01521000-0000-0000-0000-00000000000a','01521000-0000-0000-0000-000000000010','held',
   'command-held: the command is held pending operator review', now()),
  ('01521000-0000-0000-0000-00000000000a','01521000-0000-0000-0000-000000000011','held',
   'command-held: the command is held pending operator review', now());

select is(
  (select string_agg(state, ',' order by pmo_record_id) from external_command_outbox
     where org_id = '01521000-0000-0000-0000-00000000000a'),
  'failed,held',
  'AC-TSC-R5 fixtures: the shipped writers produced a terminal command beside a held one');

-- ── (a) mirror held + terminal outbox → REFUSE ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01521000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01521000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R5(a): a HELD mirror refuses the re-open — `held` means PMO does not know whether ERP holds a document, and an unknown ERP outcome can never be admitted');
reset role;

select is(
  (select status from timesheets where id = '01521000-0000-0000-0000-000000000010'),
  'Approved'::timesheet_status,
  'AC-TSC-R5(a): the sheet stays Approved — fail closed, never a silent flip');

-- ── (b) after the Admin release, the ordinary rules apply again ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01521000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold((select id from pg_temp.ids where label = 'b'), 'probe fixed') $$,
  'AC-TSC-R5(b): the Admin releases the hold');
reset role;

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01521000-0000-0000-0000-000000000011'),
  'failed',
  'AC-TSC-R5(b): the release moved the mirror out of `held` — the backstop route is restored');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01521000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01521000-0000-0000-0000-000000000011','Draft') $$,
  'AC-TSC-R5(b): once released (no live document, a terminal command), the re-open ADMITS per the existing rules');
reset role;

select is(
  (select status from timesheets where id = '01521000-0000-0000-0000-000000000011'),
  'Draft'::timesheet_status,
  'AC-TSC-R5(b): the released sheet actually flips to Draft — the refusal is a fence, not a dead end');

select * from finish();
rollback;
