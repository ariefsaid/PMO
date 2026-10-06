# Plan #766 — part 2: database (migration 0250)

> Part of [`2026-10-06-progress-billing.md`](2026-10-06-progress-billing.md). Tasks A1–A16. Conventions: see the
> main file. The management pack (#765) is migration `0245_management_pack.sql`; this feature's schema is
> `0250_progress_billing.sql`. Next: [part 3](2026-10-06-progress-billing.part3-adapter-data.md).

### Task A1 — pgTAP: bill of quantities + org item (RED) · AC-PB-001, AC-PB-011

Create `supabase/tests/0250_progress_billing_boq.test.sql`:

```sql
-- 0250_progress_billing_boq.test.sql — #766 AC-PB-001 (bill of quantities) + AC-PB-011 (org down-payment item).
-- Migration under test: 0250_progress_billing.sql. Every denial asserts errcode AND message.
-- Cast (org A): a1 Admin · a2 Finance · a4 PM · a5 Engineer · a6 Finance (disabled) · b1 Admin of org B.
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a1', 'pb-admin@example.com'),
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000a5', 'pb-eng@example.com'),
  ('07660000-0000-0000-0000-0000000000a6', 'pb-off@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a1', '07660000-0000-0000-0000-000000000001', 'PB Admin', 'pb-admin@example.com', 'Admin', 'active'),
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000a5', '07660000-0000-0000-0000-000000000001', 'PB Eng', 'pb-eng@example.com', 'Engineer', 'active'),
  ('07660000-0000-0000-0000-0000000000a6', '07660000-0000-0000-0000-000000000001', 'PB Off', 'pb-off@example.com', 'Finance', 'disabled'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('07660000-0000-0000-0000-0000000000d1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'PB WO one', 'Issued', 500000, 'exclusive', 0),
  ('07660000-0000-0000-0000-0000000000d9', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', 'PB WO other project', 'Issued', 500000, 'exclusive', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ insert into boq_items (id, project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000) $$,
  'AC-PB-001 a PM adds a bill of quantities line without stating the org');
select is((select org_id from boq_items where id = '07660000-0000-0000-0000-0000000000e1'),
  '07660000-0000-0000-0000-000000000001'::uuid, 'AC-PB-001 the line is stamped with the caller''s org');
select lives_ok($$ insert into boq_items (id, project_id, work_order_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000e2', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000d1', 'STATION', 'Station build', 'unit', 5, 100000) $$,
  'AC-PB-001 a line may name a work order on the same project');
select throws_ok($$ insert into boq_items (project_id, work_order_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000d9', 'X', 'X', 'km', 1, 1) $$,
  '23514', 'the work order must be on the same project as the bill of quantities line',
  'AC-PB-001 a line cannot name another project''s work order');
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 0, 1) $$,
  '23514', 'new row for relation "boq_items" violates check constraint "boq_items_quantity_check"',
  'AC-PB-001 quantity must be above 0');
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 'NaN', 1) $$,
  '23514', 'new row for relation "boq_items" violates check constraint "boq_items_quantity_check"',
  'AC-PB-001 a NaN quantity is refused (NaN sorts above every number)');
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 1, -1) $$,
  '23514', 'new row for relation "boq_items" violates check constraint "boq_items_rate_check"',
  'AC-PB-001 a rate cannot be negative');
select lives_ok($$ update boq_items set quantity = 12 where id = '07660000-0000-0000-0000-0000000000e1' $$,
  'AC-PB-001 a PM may re-measure a line');
select throws_ok($$ update boq_items set project_id = '07660000-0000-0000-0000-0000000000c2' where id = '07660000-0000-0000-0000-0000000000e1' $$,
  '42501', 'permission denied for table boq_items', 'AC-PB-001 a line cannot be moved to another project');
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 1, 1) $$,
  '42501', 'new row violates row-level security policy for table "boq_items"', 'AC-PB-001 an Engineer cannot add lines');
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is((select count(*)::int from boq_items), 0, 'AC-PB-001 an offboarded member reads no lines');
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from boq_items), 0, 'AC-PB-001 another org reads none of these lines');
reset role;
select is(has_table_privilege('anon', 'public.boq_items', 'SELECT'), false, 'AC-PB-001 anon cannot read the bill of quantities');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001' $$,
  'AC-PB-011 an Admin sets the org''s down payment item');
reset role;
select is((select count(*)::int from audit_events where action = 'org.down_payment_item.change'
   and entity_id = '07660000-0000-0000-0000-000000000001'
   and detail = jsonb_build_object('from', null, 'to', 'DP-ITEM')), 1,
  'AC-PB-011 the change is audited with its before and after values');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
with changed as (update organizations set down_payment_item = 'OTHER' where id = '07660000-0000-0000-0000-000000000001' returning id)
select is(count(*)::int, 0, 'AC-PB-011 Finance cannot change the down payment item') from changed;
reset role;
select throws_ok($$ update organizations set down_payment_item = repeat('x', 141) where id = '07660000-0000-0000-0000-000000000001' $$,
  '23514', 'new row for relation "organizations" violates check constraint "organizations_down_payment_item_check"',
  'AC-PB-011 the item code is at most 140 characters');

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0250_progress_billing_boq.test.sql`
Expect: fails (`relation "boq_items" does not exist`).

### Task A2 — migration §1–§2: org item + `boq_items` (GREEN) · AC-PB-001, AC-PB-011

Create `supabase/migrations/0250_progress_billing.sql`:

```sql
-- 0250_progress_billing.sql — #766: bill of quantities, progress assessment, down payment, billing claims.
-- Spec docs/specs/progress-billing.spec.md (DD-PBL-1..11) · ADR-0077 · plan docs/plans/2026-10-06-progress-billing.md.
-- Depends on #765's 0245_management_pack.sql (project_progress_entries and its helpers).
-- Reversal: supabase/migrations/rollback/0250_progress_billing_down.sql (pre-production: supabase db reset).
--
-- ⚑ A progress ASSESSMENT is operational and never reaches the ERP; a BILLING CLAIM is the only path to an
--   invoice (owner ruling 2026-10-06, DD-PBL-2).
-- ⚑ A claim IS its sales invoice's PMO record (claim id = sales_invoices.id). No column is added to
--   sales_invoices, so its native-mirror guard (0193 §10) needs no paired edit.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions to anon/authenticated explicitly; every function
--   below revokes what it must not expose (the 0185/0210 lesson). Definer client RPCs join 0178's allow-list.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — organizations.down_payment_item (DD-PBL-1, DD-PBL-8). The ERPNext item whose Item Default income
-- account is the customer-advance liability account. Admin-only through the existing own-org, active-member,
-- Admin-only organizations UPDATE policy (0232 precedent).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.organizations add column down_payment_item text
  constraint organizations_down_payment_item_check
  check (down_payment_item is null or (length(btrim(down_payment_item)) between 1 and 140));
grant update (down_payment_item) on public.organizations to authenticated;

create or replace function public.audit_org_down_payment_item() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.down_payment_item is distinct from old.down_payment_item then
    perform public.log_audit('org.down_payment_item.change', new.id, auth.uid(), new.id,
      jsonb_build_object('from', old.down_payment_item, 'to', new.down_payment_item));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_down_payment_item() from public, anon, authenticated;
create trigger organizations_audit_down_payment_item after update on public.organizations
  for each row execute function public.audit_org_down_payment_item();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — boq_items (DD-PBL-4). The contract's priced lines. Rates are tax-exclusive (DD-PBL-6). quantity carries
-- 3 decimals — ERPNext's default float precision — so the ERP never re-rounds what PMO sends.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.boq_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id)
                  default '00000000-0000-0000-0000-000000000001',
  project_id    uuid not null references public.projects(id),
  work_order_id uuid references public.work_orders(id),
  item_code     text not null check (length(btrim(item_code)) between 1 and 140),
  description   text not null check (length(btrim(description)) between 1 and 500),
  unit          text not null check (length(btrim(unit)) between 1 and 40),
  -- `> 0` alone is not enough: numeric NaN sorts ABOVE every value; the upper bound rejects it (0193 precedent).
  quantity      numeric(14,3) not null constraint boq_items_quantity_check
                  check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate          numeric(14,2) not null constraint boq_items_rate_check
                  check (rate >= 0 and rate < 'Infinity'::numeric),
  created_at    timestamptz not null default now()
);
create index boq_items_org_project_idx on public.boq_items (org_id, project_id);
create index boq_items_project_idx on public.boq_items (project_id);
create index boq_items_work_order_idx on public.boq_items (work_order_id);

create trigger boq_items_stamp_org_id before insert on public.boq_items
  for each row execute function public.stamp_org_id();

-- Runs after the org stamp ('s' < 'z'). Reads work_orders under the caller's RLS, so another org's work order
-- is invisible and fails closed exactly like a wrong-project one.
create or replace function public.check_boq_item_work_order_same_project() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.work_order_id is not null
     and (select wo.project_id from public.work_orders wo where wo.id = new.work_order_id)
         is distinct from new.project_id then
    raise exception 'the work order must be on the same project as the bill of quantities line'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_boq_item_work_order_same_project() from public, anon, authenticated;
create trigger boq_items_zz_check_work_order before insert or update on public.boq_items
  for each row execute function public.check_boq_item_work_order_same_project();

alter table public.boq_items enable row level security;
alter table public.boq_items force row level security;
create policy boq_items_select on public.boq_items for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy boq_items_insert on public.boq_items for insert
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p where p.id = boq_items.project_id and p.org_id = public.auth_org_id()));
create policy boq_items_update on public.boq_items for update
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy boq_items_delete on public.boq_items for delete
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'));

-- Column-level grants only (the 0014 A2 mechanic). project_id is not updatable: a line never moves contracts.
revoke all on public.boq_items from authenticated, anon;
grant select on public.boq_items to authenticated;
grant insert (id, org_id, project_id, work_order_id, item_code, description, unit, quantity, rate)
  on public.boq_items to authenticated;
grant update (work_order_id, item_code, description, unit, quantity, rate) on public.boq_items to authenticated;
grant delete on public.boq_items to authenticated;
```

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_boq.test.sql'`
Expect: 17/17.

### Task A3 — pgTAP: progress assessment (RED) · AC-PB-017

Create `supabase/tests/0250_progress_billing_assessment.test.sql`:

```sql
-- 0250_progress_billing_assessment.test.sql — #766 AC-PB-017: a progress assessment by quantities extends #765's
-- project_progress_entries (0245) and never reaches billing. BoQ of c1: 10 km @ 50,000 + 5 units @ 100,000 = 1,000,000.
-- Cast: a2 Finance · a4 PM (c1's project manager) · a7 PM2 (not c1's) · a5 Engineer.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name) values ('07660000-0000-0000-0000-000000000001', 'PB Org');
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000a5', 'pb-eng@example.com'),
  ('07660000-0000-0000-0000-0000000000a7', 'pb-pm2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000a5', '07660000-0000-0000-0000-000000000001', 'PB Eng', 'pb-eng@example.com', 'Engineer', 'active'),
  ('07660000-0000-0000-0000-0000000000a7', '07660000-0000-0000-0000-000000000001', 'PB PM Two', 'pb-pm2@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000a4'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, null),
  ('07660000-0000-0000-0000-0000000000c3', '07660000-0000-0000-0000-000000000001', 'PB Project Three', 'Ongoing Project', 1000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'STATION', 'Station build', 'unit', 5, 100000),
  ('07660000-0000-0000-0000-0000000000e3', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', 'CABLE', 'Cable pull', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e4', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c3', 'FREE', 'Free service', 'lot', 1, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-15',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":4},{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity_to_date":1}]'::jsonb) $$,
  'AC-PB-017 the project''s PM records quantities done to date for September');                              -- 1
select is((select pct_complete || '/' || entered_by from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'),
  '30.00/07660000-0000-0000-0000-0000000000a4',
  'AC-PB-017 the month''s percent is derived from quantities (300,000 of 1,000,000) and stamped with the PM'); -- 2
select is((select string_agg(q.quantity_to_date::text, ',' order by q.quantity_to_date)
             from progress_assessment_quantities q join project_progress_entries e on e.id = q.entry_id
            where e.project_id = '07660000-0000-0000-0000-0000000000c1' and e.month = '2026-09-01'),
  '1.000,4.000', 'AC-PB-017 each line''s quantity done to date is kept');                                      -- 3
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6},{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity_to_date":1}]'::jsonb) $$,
  'AC-PB-017 re-recording the open month replaces it');                                                     -- 4
select is((select pct_complete::text from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'), '40.00',
  'AC-PB-017 6 km and 1 unit is 40%');                                                                       -- 5
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6}]'::jsonb) $$,
  'AC-PB-017 an assessment that omits a line');                                                             -- 6
select is((select e.pct_complete || '/' || count(q.id) from project_progress_entries e
             left join progress_assessment_quantities q on q.entry_id = e.id
            where e.project_id = '07660000-0000-0000-0000-0000000000c1' and e.month = '2026-09-01'
            group by e.pct_complete), '30.00/1',
  'AC-PB-017 an omitted line is removed from the month and counts as nothing done');                         -- 7
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":12}]'::jsonb) $$,
  'AC-PB-017 over-measurement is accepted');                                                                -- 8
select is((select pct_complete::text from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'), '50.00',
  'AC-PB-017 12 of 10 km counts the line at most to its full value');                                       -- 9
select throws_ok($$ select public.record_project_progress('07660000-0000-0000-0000-0000000000c1', '2026-09-01', 70) $$,
  'P0001', 'this month''s progress is measured by quantities — record the quantities done to date instead',
  'AC-PB-017 a typed percent cannot overwrite a quantity-measured month');                                  -- 10
select lives_ok($$ select public.record_project_progress('07660000-0000-0000-0000-0000000000c1', '2026-08-01', 25) $$,
  'AC-PB-017 CONTROL a typed percent for a month without quantities still works (#765)');                    -- 11
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":-1}]'::jsonb) $$,
  '23514', 'each quantity done to date must be 0 or more with at most 3 decimals',
  'AC-PB-017 a negative quantity is refused');                                                              -- 12
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1.2345}]'::jsonb) $$,
  '23514', 'each quantity done to date must be 0 or more with at most 3 decimals',
  'AC-PB-017 a quantity has at most 3 decimals');                                                           -- 13
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity_to_date":1}]'::jsonb) $$,
  '23514', 'every line must be a bill of quantities line of this project',
  'AC-PB-017 another project''s line is refused');                                                          -- 14
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1},{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":2}]'::jsonb) $$,
  '23514', 'each bill of quantities line may appear once per assessment',
  'AC-PB-017 a repeated line is refused');                                                                  -- 15
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01', '[]'::jsonb) $$,
  '23502', 'project, month and at least one quantity are required',
  'AC-PB-017 an empty assessment is refused');                                                              -- 16
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1}]'::jsonb) $$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-PB-017 another PM cannot assess this project');                                                       -- 17
select throws_ok($$ insert into progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select e.id, '07660000-0000-0000-0000-0000000000e2', 1 from project_progress_entries e
   where e.project_id = '07660000-0000-0000-0000-0000000000c1' and e.month = '2026-08-01' $$,
  '42501', 'new row violates row-level security policy for table "progress_assessment_quantities"',
  'AC-PB-017 another PM cannot write quantities directly either');                                          -- 18
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1}]'::jsonb) $$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-PB-017 an Engineer cannot assess');                                                                   -- 19
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c3', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e4","quantity_to_date":1}]'::jsonb) $$,
  '23514', 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead',
  'AC-PB-017 a BoQ with no value cannot measure a percent');                                                -- 20
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c2', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity_to_date":3}]'::jsonb) $$,
  'AC-PB-017 Finance may assess any project');                                                              -- 21
reset role;
select is((select count(*)::int from progress_claims) + (select count(*)::int from external_command_outbox
            where org_id = '07660000-0000-0000-0000-000000000001'), 0,
  'AC-PB-017 an assessment creates no billing claim and no ERP command');                                   -- 22
select throws_ok($$ delete from boq_items where id = '07660000-0000-0000-0000-0000000000e1' $$,
  '23503', 'update or delete on table "boq_items" violates foreign key constraint "progress_assessment_quantities_boq_item_id_fkey" on table "progress_assessment_quantities"',
  'AC-PB-017 a BoQ line with recorded quantities cannot be deleted');                                       -- 23
select is(has_function_privilege('anon', 'public.record_progress_assessment(uuid,date,jsonb,text)', 'EXECUTE'), false,
  'AC-PB-017 anon cannot record an assessment');                                                            -- 24
select is((select prosecdef from pg_proc where oid = 'public.record_progress_assessment(uuid,date,jsonb,text)'::regprocedure), false,
  'AC-PB-017 the assessment writer is SECURITY INVOKER — #765''s RLS stays the authority');                   -- 25

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_assessment.test.sql'`
Expect: fails (`function public.record_progress_assessment(...) does not exist`).

### Task A4 — migration §3: progress assessment (GREEN) · AC-PB-017

Append to `supabase/migrations/0250_progress_billing.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — progress assessment (DD-PBL-2, DD-PBL-3). ONE source of operational progress: #765's
-- project_progress_entries row for the month (0245), optionally with per-BoQ-line quantities done to date. When
-- quantities are recorded the month's pct_complete is DERIVED from them, so the management pack sees
-- quantity-measured progress with no change. Never reaches billing or the ERP. Who: #765's
-- may_record_project_progress (the project's PM, or Finance rank and above). INVOKER throughout.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.progress_assessment_quantities (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id)
                     default '00000000-0000-0000-0000-000000000001',
  entry_id         uuid not null references public.project_progress_entries(id),
  boq_item_id      uuid not null references public.boq_items(id),
  quantity_to_date numeric(14,3) not null constraint progress_assessment_quantities_quantity_check
                     check (quantity_to_date >= 0 and quantity_to_date < 'Infinity'::numeric),
  unique (entry_id, boq_item_id)
);
create index progress_assessment_quantities_org_idx on public.progress_assessment_quantities (org_id);
create index progress_assessment_quantities_boq_item_idx on public.progress_assessment_quantities (boq_item_id);

create trigger progress_assessment_quantities_stamp_org_id before insert on public.progress_assessment_quantities
  for each row execute function public.stamp_org_id();

-- A quantity row is writable only by someone who may record the entry's project's progress, and only for a
-- BoQ line of that project.
create or replace function public.progress_assessment_line_ok(p_entry_id uuid, p_boq_item_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (select 1 from public.project_progress_entries e
                   join public.boq_items b on b.project_id = e.project_id
                  where e.id = p_entry_id and b.id = p_boq_item_id
                    and public.may_record_project_progress(e.project_id))
$$;
revoke all on function public.progress_assessment_line_ok(uuid, uuid) from public, anon;
grant execute on function public.progress_assessment_line_ok(uuid, uuid) to authenticated;

alter table public.progress_assessment_quantities enable row level security;
alter table public.progress_assessment_quantities force row level security;
create policy progress_assessment_quantities_select on public.progress_assessment_quantities for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy progress_assessment_quantities_insert on public.progress_assessment_quantities for insert
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id));
create policy progress_assessment_quantities_update on public.progress_assessment_quantities for update
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id))
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id));
create policy progress_assessment_quantities_delete on public.progress_assessment_quantities for delete
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id));
revoke all on public.progress_assessment_quantities from authenticated, anon;
grant select on public.progress_assessment_quantities to authenticated;
grant insert (entry_id, boq_item_id, quantity_to_date) on public.progress_assessment_quantities to authenticated;
grant update (quantity_to_date) on public.progress_assessment_quantities to authenticated;
grant delete on public.progress_assessment_quantities to authenticated;

-- The writer. Every BoQ line the PM sends is "done to date" for that month; lines not sent count as nothing
-- done and are removed from the month (the UI always sends every line, pre-filled from the last assessment).
-- pct = Σ min(done, BoQ qty) × rate / Σ BoQ qty × rate × 100, rounded to 2 — so it can never pass 100.
create or replace function public.record_progress_assessment(
  p_project_id uuid, p_month date, p_quantities jsonb, p_note text default null)
  returns numeric language plpgsql volatile set search_path = public as $$
declare
  v_total numeric;
  v_done  numeric;
  v_pct   numeric;
  v_entry uuid;
begin
  if p_project_id is null or p_month is null or p_quantities is null
     or jsonb_typeof(p_quantities) <> 'array' or jsonb_array_length(p_quantities) = 0 then
    raise exception 'project, month and at least one quantity are required' using errcode = '23502';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
              where not coalesce(x.quantity_to_date >= 0 and x.quantity_to_date < 'Infinity'::numeric
                                 and x.quantity_to_date = round(x.quantity_to_date, 3), false)) then
    raise exception 'each quantity done to date must be 0 or more with at most 3 decimals' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
              where b.id is null) then
    raise exception 'every line must be a bill of quantities line of this project' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric))
     <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)) then
    raise exception 'each bill of quantities line may appear once per assessment' using errcode = '23514';
  end if;
  select coalesce(sum(b.quantity * b.rate), 0) into v_total from public.boq_items b where b.project_id = p_project_id;
  if v_total <= 0 then
    raise exception 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead'
      using errcode = '23514';
  end if;
  select coalesce(sum(least(x.quantity_to_date, b.quantity) * b.rate), 0) into v_done
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
    join public.boq_items b on b.id = x.boq_item_id;
  v_pct := round(v_done / v_total * 100, 2);

  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, v_pct, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note
  returning id into v_entry;

  delete from public.progress_assessment_quantities q
   where q.entry_id = v_entry
     and not exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
                      where x.boq_item_id = q.boq_item_id);
  insert into public.progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select v_entry, x.boq_item_id, x.quantity_to_date
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
  on conflict (entry_id, boq_item_id) do update set quantity_to_date = excluded.quantity_to_date;
  return v_pct;
end; $$;
revoke all on function public.record_progress_assessment(uuid, date, jsonb, text) from public, anon;
grant execute on function public.record_progress_assessment(uuid, date, jsonb, text) to authenticated;

-- Paired edit to #765: 0245's record_project_progress, verbatim, with ONE added refusal (marked). A month
-- measured by quantities must not have its derived percent overwritten by a typed one.
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  -- ⚑ 0250 (#766, DD-PBL-3): the one added refusal.
  if exists (select 1 from public.project_progress_entries e
               join public.progress_assessment_quantities q on q.entry_id = e.id
              where e.project_id = p_project_id and e.month = date_trunc('month', p_month)::date) then
    raise exception 'this month''s progress is measured by quantities — record the quantities done to date instead'
      using errcode = 'P0001';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;
```

Before pasting the paired edit, diff its body against `dev`'s:
`sed -n '/create or replace function public.record_project_progress/,/^end; \$\$;/p' supabase/migrations/0245_management_pack.sql`.
If `dev` changed it, take `dev`'s body and add only the marked refusal.

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_assessment.test.sql supabase/tests/0245_management_pack.test.sql'`
Expect: 25/25, and #765's suite unchanged.

### Task A5 — pgTAP: claims and recovery (RED) · AC-PB-002, AC-PB-004

Create `supabase/tests/0250_progress_billing_claims.test.sql`:

```sql
-- 0250_progress_billing_claims.test.sql — #766 AC-PB-002 (recovery arithmetic) + AC-PB-004 (claim guards).
-- Migration under test: 0250_progress_billing.sql. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(40);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000a5', 'pb-eng@example.com'),
  ('07660000-0000-0000-0000-0000000000a6', 'pb-off@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000a5', '07660000-0000-0000-0000-000000000001', 'PB Eng', 'pb-eng@example.com', 'Engineer', 'active'),
  ('07660000-0000-0000-0000-0000000000a6', '07660000-0000-0000-0000-000000000001', 'PB Off', 'pb-off@example.com', 'Finance', 'disabled'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c3', '07660000-0000-0000-0000-000000000001', 'PB Project Three', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('07660000-0000-0000-0000-0000000000d1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'PB WO issued', 'Issued', 500000, 'exclusive', 0),
  ('07660000-0000-0000-0000-0000000000d2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'PB WO draft', 'Draft', 500000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, work_order_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', null, 'SURVEY', 'Route survey', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000d1', 'STATION', 'Station build', 'unit', 5, 100000),
  ('07660000-0000-0000-0000-0000000000e3', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', null, 'CABLE', 'Cable pull', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e4', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c3', null, 'POLE', 'Pole set', 'unit', 10, 10000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills a 200,000 down payment recovered at 20% per claim');                                  -- 1
select is((select kind || '/' || gross_amount || '/' || recovery_pct || '/' || dp_item_code || '/' || currency || '/' || created_by
             from progress_claims where id = current_setting('pb.dp')::uuid),
  'down_payment/200000.00/20.000/DP-ITEM/USD/07660000-0000-0000-0000-0000000000a2',
  'AC-PB-002 the down payment claim stores its amount, percentage, the org item, the project currency and its creator'); -- 2
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  'P0001', 'this project already has a down payment — withdraw it or cancel its invoice before billing another',
  'AC-PB-004 a second live down payment is refused');                                                            -- 3
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb) $$,
  'P0001', 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress',
  'AC-PB-004 progress cannot be billed before the down payment invoice is submitted');                           -- 4
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 200000, 'inclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.pc1', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills 4 km');                                                                              -- 5
select is((select gross_amount || '/' || dp_recovery_amount || '/' || dp_item_code from progress_claims where id = current_setting('pb.pc1')::uuid),
  '200000.00/40000.00/DP-ITEM', 'AC-PB-002 4 km at 50,000 bills 200,000 and recovers 20% = 40,000 on the DP item'); -- 6
select is((select item_code || '/' || description || '/' || unit || '/' || quantity || '/' || rate || '/' || amount
             from progress_claim_lines where claim_id = current_setting('pb.pc1')::uuid),
  'SURVEY/Route survey/km/4.000/50000.00/200000.00', 'AC-PB-002 the claim line copies the BoQ line at that moment'); -- 7
select lives_ok($$ do $d$ begin perform set_config('pb.pc2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":6}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills 6 km');                                                                              -- 8
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.pc2')::uuid), '60000.00',
  'AC-PB-002 300,000 recovers 60,000');                                                                          -- 9
select lives_ok($$ do $d$ begin perform set_config('pb.pc3', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":12}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 billing past the BoQ quantity (22 of 10 km) is accepted');                                          -- 10
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.pc3')::uuid), '100000.00',
  'AC-PB-002 600,000 would recover 120,000 but only 100,000 of the down payment remains');                       -- 11
select lives_ok($$ do $d$ begin perform set_config('pb.pc4', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills 1 km after the down payment is fully recovered');                                    -- 12
select is((select dp_recovery_amount || '/' || coalesce(dp_item_code, '') from progress_claims where id = current_setting('pb.pc4')::uuid),
  '0.00/', 'AC-PB-002 nothing is left to recover, so no recovery line is due');                                  -- 13
select lives_ok($$ do $d$ begin perform set_config('pb.dp2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'down_payment', p_down_payment_amount => 100000, p_recovery_pct => 10)::text, true); end $d$ $$,
  'AC-PB-002 Finance bills a 100,000 down payment on the second project');                                     -- 14
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp2')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 100000, 'inclusive', 0, 'USD', 'Paid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.c2a', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity":1}]'::jsonb, p_recover_remaining => true)::text, true); end $d$ $$,
  'AC-PB-002 a claim may recover the rest of the down payment');                                                -- 15
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.c2a')::uuid), '50000.00',
  'AC-PB-002 recovering the rest is capped at the claim''s own gross (50,000 of 100,000)');                      -- 16
select lives_ok($$ do $d$ begin perform set_config('pb.c2b', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity":2}]'::jsonb, p_recover_remaining => true)::text, true); end $d$ $$,
  'AC-PB-002 a second claim recovers the rest');                                                                -- 17
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.c2b')::uuid), '50000.00',
  'AC-PB-002 the rest is the 50,000 still unrecovered');                                                         -- 18
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e4","quantity":1}]'::jsonb, p_recover_remaining => true) $$,
  'P0001', 'there is no down payment to recover on this project', 'AC-PB-002 recovering the rest needs a down payment'); -- 19
select lives_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '07660000-0000-0000-0000-0000000000d1', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity":1}]'::jsonb) $$,
  'AC-PB-004 a claim scoped to an issued work order bills that work order''s lines');                            -- 20
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '07660000-0000-0000-0000-0000000000d1', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb) $$,
  '23514', 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)',
  'AC-PB-004 a work-order claim cannot bill a contract-level line');                                           -- 21
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity":1}]'::jsonb) $$,
  '23514', 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)',
  'AC-PB-004 a claim cannot bill another project''s line');                                                     -- 22
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '07660000-0000-0000-0000-0000000000d2', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb) $$,
  'P0001', 'only an issued or closed work order can be billed — this one is Draft', 'AC-PB-004 a Draft work order cannot be billed'); -- 23
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1.2345}]'::jsonb) $$,
  '23514', 'each quantity must be a positive number with at most 3 decimals', 'AC-PB-004 a quantity has at most 3 decimals'); -- 24
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1},{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":2}]'::jsonb) $$,
  '23514', 'each bill of quantities line may appear once per claim', 'AC-PB-004 a line appears once per claim'); -- 25
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[]'::jsonb) $$,
  'P0001', 'a progress claim needs at least one quantity line', 'AC-PB-004 an empty claim is refused');         -- 26
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress',
    p_lines => (select jsonb_agg(jsonb_build_object('boq_item_id', '07660000-0000-0000-0000-0000000000e1', 'quantity', 1)) from generate_series(1, 501))) $$,
  '22023', 'a progress claim may have at most 500 lines', 'AC-PB-004 a claim has at most 500 lines');           -- 27
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => -1, p_recovery_pct => 10) $$,
  '23514', 'the down payment amount must be a positive number with at most 2 decimals', 'AC-PB-004 a negative down payment is refused'); -- 28
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 0) $$,
  '23514', 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals', 'AC-PB-004 a 0% recovery is refused'); -- 29
reset role;
update organizations set down_payment_item = null where id = '07660000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  'P0001', 'set the down payment item in Administration → Accounting before billing a down payment',
  'AC-PB-004 a down payment needs the org''s down payment item');                                              -- 30
reset role;
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  '42501', 'only Admin or Finance may create a progress claim', 'AC-PB-004 a PM cannot create a billing claim'); -- 31
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  '42501', 'only Admin or Finance may create a progress claim', 'AC-PB-004 an Engineer cannot create a claim'); -- 32
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-PB-004 an offboarded Finance user cannot create a claim');                                               -- 33
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.create_progress_claim('07660000-0000-0000-0000-0000000000c3', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10) $$,
  'P0002', 'project not found', 'AC-PB-004 another org cannot bill this org''s project');                         -- 34
reset role;
select is((select count(*)::int from information_schema.table_privileges
            where table_schema = 'public' and table_name in ('progress_claims', 'progress_claim_lines')
              and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'AC-PB-004 no client role may write the claim tables directly');                                              -- 35
select throws_ok($$ update progress_claims set gross_amount = 1 where id = current_setting('pb.pc1')::uuid $$,
  '42501', 'a progress claim cannot be edited: its invoice is built from it — withdraw it (if not yet raised) or cancel its invoice, then create a new claim',
  'AC-PB-004 a claim''s figures cannot change, even for the table owner');                                     -- 36
select throws_ok($$ update progress_claim_lines set quantity = 1 where claim_id = current_setting('pb.pc1')::uuid $$,
  '42501', 'progress claim lines cannot be changed', 'AC-PB-004 a claim''s lines cannot change');                -- 37
update boq_items set rate = 60000 where id = '07660000-0000-0000-0000-0000000000e1';
select is((select rate::text from progress_claim_lines where claim_id = current_setting('pb.pc1')::uuid), '50000.00',
  'AC-PB-004 re-pricing the BoQ line does not change a claim already made');                                   -- 38
select is((select count(*)::int from audit_events where action = 'progress_claim.create'
            and entity_id = current_setting('pb.pc1')::uuid and (detail ->> 'dp_recovery_amount')::numeric = 40000), 1,
  'AC-PB-004 each claim creation is audited with its recovery');                                                -- 39
select is(has_function_privilege('anon', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'EXECUTE'), false,
  'AC-PB-004 anon cannot create claims');                                                                       -- 40

select * from finish();
rollback;
```

The offboarded-member message in assertion 33 is `assert_is_active_member()`'s; if `dev` has reworded it, copy
the current text from `supabase/migrations` (`grep -rn "assert_is_active_member" supabase/migrations | tail -3`).

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_claims.test.sql'`
Expect: fails (`function public.create_progress_claim(...) does not exist`).

### Task A6 — migration §4: claim tables · AC-PB-004

Append:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — progress_claims + progress_claim_lines: BILLING claims (DD-PBL-5, DD-PBL-7). Written ONLY by
-- create_progress_claim and withdraw_progress_claim. org_id has no default: the RPC states it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.progress_claims (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  project_id          uuid not null references public.projects(id),
  work_order_id       uuid references public.work_orders(id),
  kind                text not null check (kind in ('down_payment','progress')),
  currency            text not null check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX'),
  gross_amount        numeric(14,2) not null check (gross_amount >= 0 and gross_amount < 'Infinity'::numeric),
  down_payment_amount numeric(14,2),
  recovery_pct        numeric(6,3),
  dp_recovery_amount  numeric(14,2) not null default 0
                        check (dp_recovery_amount >= 0 and dp_recovery_amount < 'Infinity'::numeric),
  dp_item_code        text,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  withdrawn_by        uuid references public.profiles(id),
  withdrawn_at        timestamptz,
  constraint progress_claims_kind_shape check (
    (kind = 'down_payment'
      and down_payment_amount > 0 and down_payment_amount < 'Infinity'::numeric
      and recovery_pct > 0 and recovery_pct <= 100
      and gross_amount = down_payment_amount and dp_recovery_amount = 0 and dp_item_code is not null)
    or (kind = 'progress'
      and down_payment_amount is null and recovery_pct is null
      and dp_recovery_amount <= gross_amount
      and (dp_recovery_amount = 0 or dp_item_code is not null))),
  constraint progress_claims_withdrawn_pair check ((withdrawn_by is null) = (withdrawn_at is null))
);
create index progress_claims_org_project_kind_idx on public.progress_claims (org_id, project_id, kind);
create index progress_claims_project_idx on public.progress_claims (project_id);
create index progress_claims_work_order_idx on public.progress_claims (work_order_id);
create index progress_claims_created_by_idx on public.progress_claims (created_by);
create index progress_claims_withdrawn_by_idx on public.progress_claims (withdrawn_by);

create table public.progress_claim_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  claim_id    uuid not null references public.progress_claims(id),
  boq_item_id uuid not null references public.boq_items(id),
  item_code   text not null,
  description text not null,
  unit        text not null,
  quantity    numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate        numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  amount      numeric(14,2) not null check (amount >= 0 and amount < 'Infinity'::numeric),
  unique (claim_id, boq_item_id)
);
create index progress_claim_lines_org_idx on public.progress_claim_lines (org_id);
create index progress_claim_lines_boq_item_idx on public.progress_claim_lines (boq_item_id);

-- Immutability as a schema fact (DD-WO-8 lesson): only the withdraw stamp may ever change, once.
create or replace function public.assert_progress_claim_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  if old.withdrawn_at is not null then
    raise exception 'this progress claim was withdrawn and can no longer change' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'withdrawn_by' - 'withdrawn_at') is distinct from (to_jsonb(old) - 'withdrawn_by' - 'withdrawn_at') then
    raise exception 'a progress claim cannot be edited: its invoice is built from it — withdraw it (if not yet raised) or cancel its invoice, then create a new claim'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.assert_progress_claim_update() from public, anon, authenticated;
create trigger progress_claims_assert_update before update on public.progress_claims
  for each row execute function public.assert_progress_claim_update();

create or replace function public.refuse_progress_claim_line_change() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'progress claim lines cannot be changed' using errcode = '42501';
end; $$;
revoke all on function public.refuse_progress_claim_line_change() from public, anon, authenticated;
create trigger progress_claim_lines_immutable before update on public.progress_claim_lines
  for each row execute function public.refuse_progress_claim_line_change();

alter table public.progress_claims enable row level security;
alter table public.progress_claims force row level security;
alter table public.progress_claim_lines enable row level security;
alter table public.progress_claim_lines force row level security;
create policy progress_claims_select on public.progress_claims for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy progress_claim_lines_select on public.progress_claim_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.progress_claims from authenticated, anon;
revoke all on public.progress_claim_lines from authenticated, anon;
grant select on public.progress_claims to authenticated;
grant select on public.progress_claim_lines to authenticated;
```

Verify: `scripts/with-db-lock.sh supabase db reset` — Expect: reset succeeds (the claims test stays RED until A7).

### Task A7 — migration §5: `create_progress_claim` (GREEN) · AC-PB-002, AC-PB-004

Append:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — create_progress_claim (DD-PBL-5). Quantities in, money out: rates are copied from the BoQ and the
-- recovery is computed HERE, under the project row lock, so two concurrent claims never read one balance.
-- "Live" = not withdrawn and invoice (if any) not Cancelled. Check order: membership → role → project →
-- work order → kind-specific input → scope → money. The assessment is not an input: Finance states the
-- quantities (the UI may pre-fill them from it, DD-PBL-7).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or b.work_order_id is distinct from p_work_order_id) then
      raise exception 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;
revoke all on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;
```

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_boq.test.sql supabase/tests/0250_progress_billing_assessment.test.sql supabase/tests/0250_progress_billing_claims.test.sql'`
Expect: 17/17, 25/25, 40/40. Mutation check (do not commit): change `least(round(v_gross * v_dp_pct / 100, 2), v_balance)`
to `round(v_gross * v_dp_pct / 100, 2)` → claims assertion 11 red; revert.

### Task A8 — pgTAP: billing evidence (RED) · AC-PB-018

Create `supabase/tests/0250_progress_billing_evidence.test.sql`:

```sql
-- 0250_progress_billing_evidence.test.sql — #766 AC-PB-018: a billing claim needs evidence (an Issued/Approved
-- project document with a file) before any invoice can be raised. Project c1 has no down payment, so its
-- progress claims recover nothing and need no DP invoice.
begin;
create extension if not exists pgtap;
select plan(16);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('07660000-0000-0000-0000-00000000d0c1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Progress report', 'Issued', 'A', 'docs/pb/report.pdf'),
  ('07660000-0000-0000-0000-00000000d0c2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Draft report', 'Draft', 'A', 'docs/pb/draft.pdf'),
  ('07660000-0000-0000-0000-00000000d0c3', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Report without file', 'Issued', 'A', null),
  ('07660000-0000-0000-0000-00000000d0c4', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', 'Report', 'Other project report', 'Issued', 'A', 'docs/pb/other.pdf');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('pb.k1', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true);
  perform set_config('pb.k2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":2}]'::jsonb)::text, true);
  perform set_config('pb.k3', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":3}]'::jsonb)::text, true);
  perform public.withdraw_progress_claim(current_setting('pb.k3')::uuid);
end $$;
select lives_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'AC-PB-018 Finance attaches an issued project document as evidence');                                     -- 1
select is((select document_status || '/' || document_revision || '/' || attached_by from progress_claim_evidence
            where claim_id = current_setting('pb.k1')::uuid),
  'Issued/A/07660000-0000-0000-0000-0000000000a2', 'AC-PB-018 the evidence records the document''s status, revision and who attached it'); -- 2
select lives_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'AC-PB-018 attaching the same document again is harmless');                                               -- 3
select is((select count(*)::int from progress_claim_evidence where claim_id = current_setting('pb.k1')::uuid), 1,
  'AC-PB-018 a repeat attach adds nothing');                                                                -- 4
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c2') $$,
  'P0001', 'only an issued or approved document can be billing evidence — its content is frozen from issue',
  'AC-PB-018 a Draft document is not evidence');                                                            -- 5
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c3') $$,
  'P0001', 'the evidence document has no file attached', 'AC-PB-018 a document without a file is not evidence'); -- 6
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c4') $$,
  '23514', 'the evidence must be a document of the claim''s project', 'AC-PB-018 another project''s document is not evidence'); -- 7
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k3')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'P0001', 'this progress claim was withdrawn', 'AC-PB-018 a withdrawn claim takes no evidence');            -- 8
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k2')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  '42501', 'only Admin or Finance may attach billing evidence', 'AC-PB-018 a PM cannot attach billing evidence'); -- 9
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k2')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'P0002', 'progress claim not found', 'AC-PB-018 another org cannot attach to this org''s claim');          -- 10
reset role;
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.k2'), 'pb-ev-k2', 'erpnext', 'create', 'pending') $$,
  '55000', 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice',
  'AC-PB-018 the database refuses to raise a claim without evidence');                                      -- 11
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.k1'), 'pb-ev-k1', 'erpnext', 'create', 'pending') $$,
  'AC-PB-018 CONTROL a claim with evidence may be raised');                                                 -- 12
select throws_ok($$ delete from project_documents where id = '07660000-0000-0000-0000-00000000d0c1' $$,
  '23503', 'update or delete on table "project_documents" violates foreign key constraint "progress_claim_evidence_document_id_fkey" on table "progress_claim_evidence"',
  'AC-PB-018 a document cited as evidence cannot be deleted');                                              -- 13
select is((select count(*)::int from audit_events where action = 'progress_claim.evidence.attach'
            and entity_id = current_setting('pb.k1')::uuid), 1, 'AC-PB-018 the attach is audited once');      -- 14
select is((select count(*)::int from information_schema.table_privileges
            where table_schema = 'public' and table_name = 'progress_claim_evidence'
              and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'AC-PB-018 no client role may write evidence directly');                                                  -- 15
select is(has_function_privilege('anon', 'public.attach_claim_evidence(uuid,uuid)', 'EXECUTE'), false,
  'AC-PB-018 anon cannot attach evidence');                                                                 -- 16

select * from finish();
rollback;
```

If the `external_command_outbox` insert needs more NOT NULL columns on `dev`, copy the minimal column list from
the newest outbox test (`grep -ln "insert into external_command_outbox" supabase/tests | tail -1`) and keep
`domain = 'revenue'` and `pmo_record_id` as above; the assertions do not change.

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_evidence.test.sql'`
Expect: fails (`function public.withdraw_progress_claim(uuid) does not exist`).

### Task A9 — migration §6: evidence · AC-PB-018

Append:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — billing evidence (DD-PBL-7). Evidence is a document from the project's own register, Issued or
-- Approved (content frozen by the 2026-06-12 register rule) and carrying a file. Attach-only; a cited
-- document cannot be deleted (FK, no action). The outbox fence (§7) refuses to raise a claim without evidence.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.progress_claim_evidence (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  claim_id          uuid not null references public.progress_claims(id),
  document_id       uuid not null references public.project_documents(id),
  document_status   public.doc_status not null,
  document_revision text,
  attached_by       uuid not null references public.profiles(id),
  attached_at       timestamptz not null default now(),
  unique (claim_id, document_id)
);
create index progress_claim_evidence_org_idx on public.progress_claim_evidence (org_id);
create index progress_claim_evidence_document_idx on public.progress_claim_evidence (document_id);
create index progress_claim_evidence_attached_by_idx on public.progress_claim_evidence (attached_by);

alter table public.progress_claim_evidence enable row level security;
alter table public.progress_claim_evidence force row level security;
create policy progress_claim_evidence_select on public.progress_claim_evidence for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.progress_claim_evidence from authenticated, anon;
grant select on public.progress_claim_evidence to authenticated;

create or replace function public.attach_claim_evidence(p_claim_id uuid, p_document_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role := public.auth_role();
  v_org         uuid;
  v_project     uuid;
  v_withdrawn   timestamptz;
  v_doc_org     uuid;
  v_doc_project uuid;
  v_status      public.doc_status;
  v_file        text;
  v_revision    text;
  v_rows        int;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may attach billing evidence' using errcode = '42501';
  end if;
  -- Same row lock as withdraw_progress_claim and the outbox fence.
  select pc.org_id, pc.project_id, pc.withdrawn_at into v_org, v_project, v_withdrawn
    from public.progress_claims pc where pc.id = p_claim_id for update;
  if not found or v_org is distinct from public.auth_org_id() then
    raise exception 'progress claim not found' using errcode = 'P0002';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn' using errcode = 'P0001';
  end if;
  select d.org_id, d.project_id, d.status, d.file_path, d.revision
    into v_doc_org, v_doc_project, v_status, v_file, v_revision
    from public.project_documents d where d.id = p_document_id;
  if not found or v_doc_org is distinct from v_org or v_doc_project is distinct from v_project then
    raise exception 'the evidence must be a document of the claim''s project' using errcode = '23514';
  end if;
  if v_status not in ('Issued','Approved') then
    raise exception 'only an issued or approved document can be billing evidence — its content is frozen from issue'
      using errcode = 'P0001';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'the evidence document has no file attached' using errcode = 'P0001';
  end if;
  insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
  values (v_org, p_claim_id, p_document_id, v_status, v_revision, auth.uid())
  on conflict (claim_id, document_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.log_audit('progress_claim.evidence.attach', v_org, auth.uid(), p_claim_id,
      jsonb_build_object('document_id', p_document_id, 'document_status', v_status, 'document_revision', v_revision));
  end if;
end; $$;
revoke all on function public.attach_claim_evidence(uuid, uuid) from public, anon;
grant execute on function public.attach_claim_evidence(uuid, uuid) to authenticated;
```

Verify: `scripts/with-db-lock.sh supabase db reset` — Expect: reset succeeds (the evidence test turns green after A11).

### Task A10 — pgTAP: withdraw, outbox fence, author set (RED) · AC-PB-005, AC-PB-012

Create `supabase/tests/0250_progress_billing_withdraw.test.sql`:

```sql
-- 0250_progress_billing_withdraw.test.sql — #766 AC-PB-005 (withdraw + outbox fence) + AC-PB-012 (author set).
-- Claims that get an outbox row are given evidence first (the fence requires it, AC-PB-018).
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('07660000-0000-0000-0000-00000000d0c1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Progress report', 'Issued', 'A', 'docs/pb/report.pdf');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 200000, 'inclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ do $d$ begin perform set_config('pb.a', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":10}]'::jsonb, p_recover_remaining => true)::text, true); end $d$ $$,
  'AC-PB-005 an unraised claim recovers the whole down payment');                                              -- 1
select lives_ok($$ select public.withdraw_progress_claim(current_setting('pb.a')::uuid) $$,
  'AC-PB-005 Finance withdraws the unraised claim');                                                            -- 2
select is((select (withdrawn_at is not null)::text || '/' || withdrawn_by from progress_claims where id = current_setting('pb.a')::uuid),
  'true/07660000-0000-0000-0000-0000000000a2', 'AC-PB-005 the withdrawal is stamped with who and when');           -- 3
select lives_ok($$ do $d$ begin perform set_config('pb.b', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-005 a new claim after the withdrawal');                                                                -- 4
select is((select dp_recovery_amount::text from progress_claims where id = current_setting('pb.b')::uuid), '40000.00',
  'AC-PB-005 the withdrawn claim no longer consumes the down payment');                                         -- 5
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.a')::uuid) $$,
  'P0001', 'this progress claim is already withdrawn', 'AC-PB-005 a claim is withdrawn once');                  -- 6
do $$ begin perform public.attach_claim_evidence(current_setting('pb.b')::uuid, '07660000-0000-0000-0000-00000000d0c1'); end $$;
reset role;
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.b'), 'pb-key-b', 'erpnext', 'create', 'pending');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.b')::uuid) $$,
  'P0001', 'an invoice for this claim is being raised in the ERP — wait for it to finish, then cancel the invoice if it is wrong',
  'AC-PB-005 a claim with a live ERP attempt cannot be withdrawn');                                             -- 7
reset role;
update external_command_outbox set state = 'failed' where pmo_record_id = current_setting('pb.b');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.withdraw_progress_claim(current_setting('pb.b')::uuid) $$,
  'AC-PB-005 a claim whose only attempt failed (nothing minted) can be withdrawn');                              -- 8
select lives_ok($$ do $d$ begin perform set_config('pb.c', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-PB-005 another claim');                                                                                   -- 9
do $$ begin perform public.attach_claim_evidence(current_setting('pb.c')::uuid, '07660000-0000-0000-0000-00000000d0c1'); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.c')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', 40000, 'inclusive', 0, 'USD', 'Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.c')::uuid) $$,
  'P0001', 'this claim already has an invoice — cancel the invoice instead', 'AC-PB-005 a raised claim cannot be withdrawn'); -- 10
reset role;
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.a'), 'pb-key-a', 'erpnext', 'create', 'pending') $$,
  '55000', 'this progress claim was withdrawn, so no invoice can be raised for it',
  'AC-PB-005 the database refuses any attempt to raise a withdrawn claim');                                     -- 11
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.c'), 'pb-key-c', 'erpnext', 'create', 'pending') $$,
  'AC-PB-005 CONTROL the fence refuses only withdrawn claims and claims without evidence');                      -- 12
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', '07660000-0000-0000-0000-00000000aa01', 'pb-key-x', 'erpnext', 'create', 'pending') $$,
  'AC-PB-005 CONTROL an invoice that is not a claim is untouched by the fence');                                -- 13
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.c')::uuid) $$,
  '42501', 'only Admin or Finance may withdraw a progress claim', 'AC-PB-005 a PM cannot withdraw a claim');     -- 14
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.withdraw_progress_claim(current_setting('pb.c')::uuid) $$,
  'P0002', 'progress claim not found', 'AC-PB-005 another org cannot withdraw this org''s claim');               -- 15
reset role;
select is((select count(*)::int from audit_events where action = 'progress_claim.withdraw'
            and entity_id = current_setting('pb.a')::uuid), 1, 'AC-PB-005 the withdrawal is audited');          -- 16
select is((select count(*)::int from sales_invoice_authors where sales_invoice_id = current_setting('pb.c')::uuid
            and user_id = '07660000-0000-0000-0000-0000000000a2'), 1,
  'AC-PB-012 the claim''s creator joins its invoice''s author set, so they cannot submit it');                   -- 17
insert into sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
values ('07660000-0000-0000-0000-00000000aa02', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', 1000, 'inclusive', 0, 'USD', 'Draft');
select is((select count(*)::int from sales_invoice_authors where sales_invoice_id = '07660000-0000-0000-0000-00000000aa02'), 0,
  'AC-PB-012 CONTROL an invoice that is not a claim gets no author from this rule');                             -- 18

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_withdraw.test.sql'`
Expect: fails (`function public.withdraw_progress_claim(uuid) does not exist`).

### Task A11 — migration §7: withdraw, fence, author set (GREEN) · AC-PB-005, AC-PB-012, AC-PB-018

Append:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — withdraw + the outbox fence + the author set (DD-PBL-7, DD-PBL-8).
-- Withdraw, attach_claim_evidence and the outbox insert serialize on the CLAIM ROW. The outbox insert precedes
-- every ERP POST (0134) and PostgREST runs it as one statement, so the fence needs no edge-function lock
-- (0154 §fence precedent). The fence refuses (a) a withdrawn claim and (b) a claim with no evidence.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.withdraw_progress_claim(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org       uuid;
  v_withdrawn timestamptz;
  v_role      user_role := public.auth_role();
begin
  -- SECURITY: these re-assertions MUST stay.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may withdraw a progress claim' using errcode = '42501';
  end if;
  select pc.org_id, pc.withdrawn_at into v_org, v_withdrawn
    from public.progress_claims pc where pc.id = p_id for update;
  if not found or v_org is distinct from public.auth_org_id() then
    raise exception 'progress claim not found' using errcode = 'P0002';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim is already withdrawn' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.sales_invoices si where si.id = p_id) then
    raise exception 'this claim already has an invoice — cancel the invoice instead' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.external_command_outbox o
              where o.org_id = v_org and o.domain = 'revenue' and o.pmo_record_id = p_id::text
                and o.state <> 'failed') then
    raise exception 'an invoice for this claim is being raised in the ERP — wait for it to finish, then cancel the invoice if it is wrong'
      using errcode = 'P0001';
  end if;
  update public.progress_claims set withdrawn_by = auth.uid(), withdrawn_at = now() where id = p_id;
  perform public.log_audit('progress_claim.withdraw', v_org, auth.uid(), p_id, '{}'::jsonb);
end; $$;
revoke all on function public.withdraw_progress_claim(uuid) from public, anon;
grant execute on function public.withdraw_progress_claim(uuid) to authenticated;

create or replace function public.assert_progress_claim_raisable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_withdrawn timestamptz;
begin
  if new.pmo_record_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return new;
  end if;
  select pc.withdrawn_at into v_withdrawn
    from public.progress_claims pc
   where pc.id = new.pmo_record_id::uuid and pc.org_id = new.org_id
     for share;
  if not found then
    return new;   -- not a claim: an ordinary invoice or receipt
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = new.pmo_record_id::uuid) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;
  return new;
end; $$;
revoke all on function public.assert_progress_claim_raisable() from public, anon, authenticated;
create trigger external_command_outbox_progress_claim_fence
  before insert on public.external_command_outbox
  for each row when (new.domain = 'revenue')
  execute function public.assert_progress_claim_raisable();

-- Whoever set a claim's quantities is an author of its invoice, alongside whoever raised it (0132's set).
create or replace function public.append_progress_claim_author() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  select new.org_id, new.id, pc.created_by
    from public.progress_claims pc
   where pc.id = new.id and pc.org_id = new.org_id
  on conflict do nothing;
  return new;
end; $$;
revoke all on function public.append_progress_claim_author() from public, anon, authenticated;
create trigger sales_invoices_append_progress_claim_author
  after insert on public.sales_invoices
  for each row execute function public.append_progress_claim_author();
```

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_withdraw.test.sql supabase/tests/0250_progress_billing_evidence.test.sql'`
Expect: 18/18 and 16/16. Mutation checks (do not commit): drop the fence trigger statement → withdraw 11 and
evidence 11 red; delete the evidence `if not exists` block → evidence 11 red; drop
`sales_invoices_append_progress_claim_author` → withdraw 17 red; revert each.

### Task A12 — pgTAP: billing summary (RED) · AC-PB-007

Create `supabase/tests/0250_progress_billing_summary.test.sql`:

```sql
-- 0250_progress_billing_summary.test.sql — #766 AC-PB-007 (get_project_billing + the shared billed-work view).
begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Inclusive', 'Ongoing Project', 1110000, 'inclusive', 110000, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values ('07660000-0000-0000-0000-00000000aa05', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-08-01', 55500, 'inclusive', 5500, 'USD', 'Paid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-09-01', 222000, 'inclusive', 22000, 'USD', 'Paid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc1', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.pc1')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-01', 177600, 'inclusive', 17600, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":2}]'::jsonb)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
values (current_setting('pb.pc2')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1',
        '07660000-0000-0000-0000-0000000000f1', '2026-10-02', 88800, 'inclusive', 8800, 'USD', 'Cancelled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc3', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true); end $$;
do $$ begin perform public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', public.org_current_month('UTC', now()),
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6}]'::jsonb); end $$;
do $$ begin perform set_config('pb.s', public.get_project_billing('07660000-0000-0000-0000-0000000000c1')::text, true); end $$;
do $$ begin perform set_config('pb.s2', public.get_project_billing('07660000-0000-0000-0000-0000000000c2')::text, true); end $$;

select is((current_setting('pb.s')::jsonb ->> 'work_billed')::numeric, 250000::numeric,
  'AC-PB-007 billed to date = the plain invoice''s net 50,000 + the claim''s net 160,000 + its 40,000 recovery; DP, cancelled and unraised excluded'); -- 1
select is((current_setting('pb.s')::jsonb ->> 'dp_billed')::numeric, 200000::numeric,
  'AC-PB-007 the down payment invoiced is its invoice net of tax');                                            -- 2
select is((current_setting('pb.s')::jsonb ->> 'dp_recovered')::numeric, 40000::numeric,
  'AC-PB-007 recovered counts only submitted claims');                                                         -- 3
select is((current_setting('pb.s')::jsonb ->> 'not_submitted')::numeric, 40000::numeric,
  'AC-PB-007 the unraised 1 km claim (50,000 less 10,000 recovery) is raised-not-submitted');                   -- 4
select is((current_setting('pb.s')::jsonb ->> 'contract_net')::numeric, 1000000::numeric,
  'AC-PB-007 an exclusive contract reads at its value');                                                       -- 5
select is((current_setting('pb.s2')::jsonb ->> 'contract_net')::numeric, 1000000::numeric,
  'AC-PB-007 an inclusive contract reads net of its tax');                                                     -- 6
select is((select (x ->> 'claimed_quantity')::numeric || '/' || (x ->> 'assessed_quantity')::numeric
             from jsonb_array_elements(current_setting('pb.s')::jsonb -> 'boq') x
            where x ->> 'boq_item_id' = '07660000-0000-0000-0000-0000000000e1'), '5.000/6.000',
  'AC-PB-007 the line shows 5 claimed on live claims (4 + 1; the cancelled 2 is out) and 6 assessed');         -- 7
select is((current_setting('pb.s')::jsonb -> 'assessment' ->> 'pct_complete')::numeric || '/' || (current_setting('pb.s')::jsonb -> 'assessment' ->> 'month'),
  '60.00/' || public.org_current_month('UTC', now())::text,
  'AC-PB-007 the latest assessment is this month at 60% (6 of 10 km)');                                        -- 8
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.get_project_billing('07660000-0000-0000-0000-0000000000c1'), null::jsonb,
  'AC-PB-007 another org reads nothing — null, never a zero summary');                                          -- 9
reset role;
select is(has_function_privilege('anon', 'public.get_project_billing(uuid)', 'EXECUTE'), false,
  'AC-PB-007 anon cannot read billing');                                                                        -- 10
select is((select prosecdef from pg_proc where oid = 'public.get_project_billing(uuid)'::regprocedure), false,
  'AC-PB-007 the summary is SECURITY INVOKER — RLS is its tenancy boundary');                                   -- 11
select ok((select coalesce(reloptions::text, '') from pg_class where oid = 'public.sales_invoice_work_billed'::regclass) ~ 'security_invoker=true',
  'AC-PB-007 the shared billed-work view runs with the caller''s RLS');                                         -- 12

select * from finish();
rollback;
```

The test org has no `default_timezone`; `org_current_month` treats null as UTC.

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_summary.test.sql'`
Expect: fails (`function public.get_project_billing(uuid) does not exist`).

### Task A13 — migration §8: shared view + `get_project_billing` (GREEN) · AC-PB-007

Append:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — ONE definition of billed work (DD-PBL-9), read by get_project_billing and (0251) get_management_pack.
-- Per invoice: its net of tax (0197's CASE), whether it is a down-payment invoice, and the recovery its claim
-- removed. Billed work = net + recovery for every non-DP invoice. security_invoker: RLS stays the boundary.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create view public.sales_invoice_work_billed with (security_invoker = true) as
  select si.id, si.org_id, si.project_id, si.currency, si.invoice_date, si.status,
         coalesce(pc.kind = 'down_payment', false) as is_down_payment,
         case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net,
         coalesce(pc.dp_recovery_amount, 0) as recovery
    from public.sales_invoices si
    left join public.progress_claims pc on pc.id = si.id and pc.org_id = si.org_id;
comment on view public.sales_invoice_work_billed is
  '#766 DD-PBL-9: the single definition of billed work. A DP invoice is an advance, not work; a claim invoice '
  'counts at net plus the recovery its negative line removed.';
revoke all on public.sales_invoice_work_billed from public, anon, authenticated;
grant select on public.sales_invoice_work_billed to authenticated;

-- SECURITY INVOKER — do NOT add security definer. All figures net of tax in the project's currency.
-- The assessment is the latest #765 entry up to the org's current month; assessed value and the gap are
-- computed in the UI with the management pack's pctOf (one formula, DD-PBL-9). Invisible project → NULL.
create or replace function public.get_project_billing(p_project_id uuid)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with p as (
    select pr.id, pr.currency,
           case when pr.tax_treatment = 'inclusive' then pr.contract_value - coalesce(pr.tax_amount, 0)
                else pr.contract_value end as contract_net
      from public.projects pr where pr.id = p_project_id
  ),
  counted as (
    select w.is_down_payment, w.net, w.recovery
      from public.sales_invoice_work_billed w join p on p.id = w.project_id
     where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency = p.currency
  ),
  c as (
    select pc.id, pc.kind, pc.gross_amount, pc.dp_recovery_amount, si.status as si_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id and si.org_id = pc.org_id
     where pc.project_id = p_project_id and pc.withdrawn_at is null
       and si.status is distinct from 'Cancelled'
  ),
  claimed as (
    select l.boq_item_id, sum(l.quantity) as claimed_quantity
      from public.progress_claim_lines l join c on c.id = l.claim_id
     group by l.boq_item_id
  ),
  latest as (
    select e.id, e.month, e.pct_complete
      from public.project_progress_entries e
     where e.project_id = p_project_id
       and e.month <= public.org_current_month(
             (select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), now())
     order by e.month desc
     limit 1
  ),
  assessed as (
    select q.boq_item_id, q.quantity_to_date
      from public.progress_assessment_quantities q join latest l on l.id = q.entry_id
  )
  select jsonb_build_object(
    'currency',      p.currency,
    'contract_net',  p.contract_net,
    'work_billed',   coalesce((select sum(net + recovery) from counted where not is_down_payment), 0),
    'dp_billed',     coalesce((select sum(net) from counted where is_down_payment), 0),
    'dp_recovered',  coalesce((select sum(recovery) from counted where not is_down_payment), 0),
    'not_submitted', coalesce((select sum(gross_amount - dp_recovery_amount) from c
                                where si_status is null or si_status = 'Draft'), 0),
    'assessment',    (select jsonb_build_object('month', l.month, 'pct_complete', l.pct_complete) from latest l),
    'boq',           coalesce((select jsonb_agg(jsonb_build_object(
                                        'boq_item_id', b.id,
                                        'claimed_quantity', coalesce(cl.claimed_quantity, 0),
                                        'assessed_quantity', a.quantity_to_date) order by b.id)
                                 from public.boq_items b
                                 left join claimed cl on cl.boq_item_id = b.id
                                 left join assessed a on a.boq_item_id = b.id
                                where b.project_id = p_project_id), '[]'::jsonb))
  from p
$$;
revoke all on function public.get_project_billing(uuid) from public, anon;
grant execute on function public.get_project_billing(uuid) to authenticated;
```

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_summary.test.sql'`
Expect: 12/12. Mutation check (do not commit): change `sum(net + recovery)` to `sum(net)` → assertion 1 red; revert.

### Task A14 — rollback file · NFR-PB-004

Create `supabase/migrations/rollback/0250_progress_billing_down.sql`:

```sql
-- Reverses 0250_progress_billing.sql. Run 0251's rollback first (it reads the view). BoQ lines, assessment
-- quantities, claims and evidence are dropped; #765's percent entries stay (a quantity-derived percent remains
-- as a typed one); posted ERP documents are untouched.
drop function if exists public.get_project_billing(uuid);
drop view if exists public.sales_invoice_work_billed;
drop trigger if exists sales_invoices_append_progress_claim_author on public.sales_invoices;
drop function if exists public.append_progress_claim_author();
drop trigger if exists external_command_outbox_progress_claim_fence on public.external_command_outbox;
drop function if exists public.assert_progress_claim_raisable();
drop function if exists public.withdraw_progress_claim(uuid);
drop function if exists public.attach_claim_evidence(uuid, uuid);
drop table if exists public.progress_claim_evidence;
drop function if exists public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean);
drop table if exists public.progress_claim_lines;
drop table if exists public.progress_claims;
drop function if exists public.refuse_progress_claim_line_change();
drop function if exists public.assert_progress_claim_update();
drop function if exists public.record_progress_assessment(uuid, date, jsonb, text);
drop table if exists public.progress_assessment_quantities;
drop function if exists public.progress_assessment_line_ok(uuid, uuid);
drop table if exists public.boq_items;
drop function if exists public.check_boq_item_work_order_same_project();
drop trigger if exists organizations_audit_down_payment_item on public.organizations;
drop function if exists public.audit_org_down_payment_item();
alter table public.organizations drop column if exists down_payment_item;

-- Restore 0245's record_project_progress verbatim (without 0250's quantity refusal).
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;
```

Verify (0251 is not written yet — this is the 0250-only round trip; part 5's D3 repeats it with both):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0250_progress_billing_down.sql \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "select to_regclass('\''public.boq_items'\'') is null" \
  && supabase db reset'
```
Expect: `t`, then the final reset succeeds.

### Task A15 — completeness gates: 0178 allow-list + 0171 §K · AC-PB-004, AC-PB-018

In `supabase/tests/0178_anon_executable_definers.test.sql`:
1. After the `⚑ AMENDED BY 0193 …` comment block (it ends `… per the merge hazard below.`) add:
   ```sql
   -- ⚑ AMENDED BY 0250 (#766): `attach_claim_evidence`, `create_progress_claim` and `withdraw_progress_claim`
   -- join the retained set, taking the count to 56 (53 + 3, re-derived by hand). Each is a SECURITY DEFINER
   -- writer called through PostgREST under a member's JWT that re-asserts membership + Admin/Finance + org,
   -- proven by supabase/tests/0250_progress_billing_{claims,evidence,withdraw}.test.sql. `record_progress_assessment`
   -- and `get_project_billing` are SECURITY INVOKER and deliberately NOT listed.
   ```
2. After the line `  ('approved_timesheet_for_push'),` insert `  ('attach_claim_evidence'),`.
3. After the line `  ('create_procurement_receipt'),` insert `  ('create_progress_claim'),`.
4. Replace `  ('transition_work_order');` with `  ('transition_work_order'),` followed by a new line `  ('withdraw_progress_claim');`.
5. Replace both occurrences of `  53,` with `  56,`, and in the two descriptions replace `all 53 retained` with `all 56 retained`.

In `supabase/tests/0171_sod_class_completeness.test.sql`:
1. Replace `select plan(97);` with `select plan(99);`.
2. Immediately before the final `select * from finish();` insert:
   ```sql
   -- ════════════════════════════════════════════════════════════════════════════════════════════════
   -- K. progress_claims / progress_claim_lines / progress_claim_evidence (0250, #766) — billing records written
   --    only by create_progress_claim / withdraw_progress_claim / attach_claim_evidence.
   -- ════════════════════════════════════════════════════════════════════════════════════════════════
   select is(
     (select count(*)::int from information_schema.table_privileges
       where table_schema = 'public' and table_name in ('progress_claims','progress_claim_lines','progress_claim_evidence')
         and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')),
     0,
     'AC-SCC-096 no client role holds a TABLE-level INSERT/UPDATE/DELETE on the billing claim tables');
   select is(
     (select count(*)::int from information_schema.column_privileges
       where table_schema = 'public' and table_name in ('progress_claims','progress_claim_lines','progress_claim_evidence')
         and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE')),
     0,
     'AC-SCC-097 no client role holds a COLUMN-level INSERT/UPDATE on the billing claim tables — the RPCs are the sole writers');
   ```

The 53 / 97 / AC-SCC-096 baselines are `dev` as of 2026-10-06. Migrations 0246, 0247 and 0249 land first; if any
of them changed either count or took those AC-SCC ids, re-derive by hand after rebasing (0178's merge-hazard
note) and take the next free ids.

Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/0005_force_rls.test.sql'`
Expect: all pass.

### Task A16 — regenerate types, Slice A gate

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && supabase test db supabase/tests/0250_progress_billing_boq.test.sql supabase/tests/0250_progress_billing_assessment.test.sql supabase/tests/0250_progress_billing_claims.test.sql supabase/tests/0250_progress_billing_evidence.test.sql supabase/tests/0250_progress_billing_withdraw.test.sql supabase/tests/0250_progress_billing_summary.test.sql supabase/tests/0245_management_pack.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/0005_force_rls.test.sql'
cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck
```
Expect: all pgTAP pass; typecheck 0 errors; `database.types.ts` has the new tables, the view and the RPCs.
