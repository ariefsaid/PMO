-- external_sync_watermarks_rls.test.sql
-- AC-EAS-050 [pgTAP]: org-isolated read; machine-written only (user-JWT write denied; service role upserts).
-- (AC-EAS-051 — one row per (org,tier,domain) — is owned by the Vitest unit test; pgTAP proves the
--  unique constraint + RLS write-authority here as defense-in-depth.)
begin;
select plan(5);

insert into organizations (id, name) values
  ('00870000-0000-0000-0000-000000000001','AC-EAS WM A'),
  ('00870000-0000-0000-0000-000000000002','AC-EAS WM B');
insert into auth.users (id, email) values
  ('00870000-0000-0000-0000-0000000000a1','wm-a@example.com'),
  ('00870000-0000-0000-0000-0000000000b1','wm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00870000-0000-0000-0000-0000000000a1','00870000-0000-0000-0000-000000000001','A','wm-a@example.com','Admin','active'),
  ('00870000-0000-0000-0000-0000000000b1','00870000-0000-0000-0000-000000000002','B','wm-b@example.com','Admin','active');

-- Seed as OWNER (service-role path).
reset role;
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
values ('00870000-0000-0000-0000-000000000001','reference','reference','cur-1');

-- AC-EAS-050: own-org read; cross-org invisible.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_sync_watermarks), 1, 'AC-EAS-050 org-A reads own watermark');
set local request.jwt.claims = '{"sub":"00870000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_sync_watermarks), 0, 'AC-EAS-050 org-B reads nothing (org isolation)');

-- AC-EAS-050: user-JWT write denied (machine-only).
select throws_ok(
  $$ insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values ('00870000-0000-0000-0000-000000000002','reference','reference','cur-x') $$,
  '42501', null, 'AC-EAS-050 user-JWT INSERT denied (machine-written only)');

-- Service-role upsert: exactly one row per (org,tier,domain) (defense-in-depth for AC-EAS-051).
reset role;
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
values ('00870000-0000-0000-0000-000000000001','reference','reference','cur-2')
on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor;
select is((select count(*)::int from external_sync_watermarks where org_id='00870000-0000-0000-0000-000000000001'), 1,
  'AC-EAS-050 upsert keeps exactly one row per (org,tier,domain)');
select is((select watermark_cursor from external_sync_watermarks where org_id='00870000-0000-0000-0000-000000000001'), 'cur-2',
  'AC-EAS-050 upsert advances the cursor in place');

select finish();
rollback;
