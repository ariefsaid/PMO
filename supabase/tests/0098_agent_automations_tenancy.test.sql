-- 0098_agent_automations_tenancy.test.sql — agent_automations owner-only RLS (ADR-0044 §1, FR-AAN-004/005).
-- Proves: owner isolation, cross-org wall (incl. Admin), INSERT org/owner pin (spoofed owner denied),
-- and the dispatcher's due-selection predicate excludes disabled/archived rows. Modeled on
-- 0092_agent_persistence_tenancy.test.sql. Fixtures inserted as the table owner (bypassing RLS), then
-- `set local role authenticated` + `set local request.jwt.claims`.
-- Fixture namespace: 00970000-…. Org A = default '00000000-…-0001'; Org B = '00970000-…-0002'.
begin;
select plan(12);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00970000-0000-0000-0000-000000000002','AAN Tenancy Org B');

insert into auth.users (id, email) values
  ('00970000-0000-0000-0000-0000000000a1','aan-ann@example.com'),
  ('00970000-0000-0000-0000-0000000000a2','aan-bob@example.com'),
  ('00970000-0000-0000-0000-0000000000a3','aan-dana@example.com'),
  ('00970000-0000-0000-0000-0000000000b2','aan-erin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00970000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AAN Ann','aan-ann@example.com','Engineer'),
  ('00970000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AAN Bob','aan-bob@example.com','Engineer'),
  ('00970000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','AAN Dana','aan-dana@example.com','Admin'),
  ('00970000-0000-0000-0000-0000000000b2','00970000-0000-0000-0000-000000000002','AAN Erin','aan-erin@example.com','Admin');

-- Ann (org A) owns one kind='schedule' automation.
insert into agent_automations (id, owner_id, kind, prompt, schedule) values
  ('00970000-0000-0000-0000-000000000010','00970000-0000-0000-0000-0000000000a1','schedule','summarize overdue tasks','0 8 * * 1');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-005: owner reads own automations; non-owner in the SAME org reads zero.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from agent_automations where id = '00970000-0000-0000-0000-000000000010'), 1,
  'AC-AAN-005: owner (Ann) reads her own automation');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from agent_automations where id = '00970000-0000-0000-0000-000000000010'), 0,
  'AC-AAN-005: non-owner same-org (Bob) reads zero automations');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-006: cross-org read returns zero regardless of role, including Admin.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select is((select count(*)::int from agent_automations where id = '00970000-0000-0000-0000-000000000010'), 0,
  'AC-AAN-006: same-org Admin (Dana), not owner, reads zero automations');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is((select count(*)::int from agent_automations where id = '00970000-0000-0000-0000-000000000010'), 0,
  'AC-AAN-006: cross-org Admin (Erin, org B) reads zero automations');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-007: INSERT pins org_id and owner_id; a spoofed owner_id is rejected.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- Bob tries to insert an automation claiming Ann's owner_id — WITH CHECK rejects.
select throws_ok(
  $$ insert into agent_automations (owner_id, kind, prompt, schedule)
       values ('00970000-0000-0000-0000-0000000000a1','schedule','spoofed','0 8 * * 1') $$,
  '42501', null,
  'AC-AAN-007: insert with a spoofed owner_id (another user) is denied by WITH CHECK');

-- Bob tries to insert an automation claiming Ann's org — WITH CHECK rejects.
select throws_ok(
  $$ insert into agent_automations (org_id, kind, prompt, schedule)
       values ('00970000-0000-0000-0000-000000000002','schedule','spoofed org','0 8 * * 1') $$,
  '42501', null,
  'AC-AAN-007: insert with a spoofed org_id (another org) is denied by WITH CHECK');

-- Bob's legitimate insert (no explicit owner_id/org_id) is stamped to himself.
select lives_ok(
  $$ insert into agent_automations (kind, prompt, schedule)
       values ('schedule','Bob own automation','0 9 * * 1') $$,
  'AC-AAN-007: insert with no explicit owner_id/org_id succeeds (stamped via defaults)');

reset role;

select is(
  (select owner_id::text from agent_automations where prompt = 'Bob own automation'),
  '00970000-0000-0000-0000-0000000000a2',
  'AC-AAN-007: the legitimate insert is stamped with the caller as owner_id');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-008: enabled=false and archived automations are excluded from the dispatcher's
-- due-selection query (run as a raw SQL query, independent of the edge fn).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into agent_automations (id, kind, prompt, schedule, enabled)
       values ('00970000-0000-0000-0000-000000000011','schedule','disabled one','* * * * *', false) $$,
  'AC-AAN-008: owner inserts a disabled automation');

select lives_ok(
  $$ insert into agent_automations (id, kind, prompt, schedule, archived_at)
       values ('00970000-0000-0000-0000-000000000012','schedule','archived one','* * * * *', now()) $$,
  'AC-AAN-008: owner inserts an archived automation');

select lives_ok(
  $$ insert into agent_automations (id, kind, prompt, schedule)
       values ('00970000-0000-0000-0000-000000000013','schedule','live one','* * * * *') $$,
  'AC-AAN-008: owner inserts a live+enabled automation');

select is(
  (select array_agg(id::text order by id)
     from agent_automations
    where owner_id = auth.uid()
      and enabled = true
      and archived_at is null
      and kind = 'schedule'
      and id in (
        '00970000-0000-0000-0000-000000000011',
        '00970000-0000-0000-0000-000000000012',
        '00970000-0000-0000-0000-000000000013'
      )
  ),
  array['00970000-0000-0000-0000-000000000013'],
  'AC-AAN-008 disabled/archived excluded from dispatcher selection');

reset role;

select * from finish();
rollback;
