-- LOCAL ONLY. Never run by seed.sql, CI or any script; never against a cloud database.
-- The field side of a large contractor organisation, for the concurrent-user load run (scripts/perf/load-mix.mjs):
-- 500 sign-in accounts in the default org (field users, foremen, site supervisors, storekeepers, PMs, finance,
-- executives, admins), 3,220 people in 300 crews, 300 issued work orders with a check-in area on 30 large-org projects,
-- 30,000 tasks, 90 days of attendance (about 290,000 rows) and phone check-ins, 18,000 daily site reports,
-- 2,400 material requests and 90 days of stock movements. Invented names only. Password = the local seed password.
-- Run AFTER scripts/perf/large-org-seed.sql (it uses its LG- projects), inside the stack's DB lock:
--   psql "$LOCAL_DB_URL" -f scripts/perf/large-org-seed.sql -f scripts/perf/large-org-field-seed.sql
-- Not re-runnable: UNDO is `supabase db reset`.
-- Historical rows (attendance, check-ins, reports, stock ledger, requests) are written with triggers off
-- (session_replication_role = replica): they are settled history the guards would refuse to back-date. Their keys are
-- generated consistently here, so every foreign key holds. Rows the load run writes go through the real RPCs.
\set ON_ERROR_STOP on
begin;

create temp table pu (role_key text, n int, id uuid, email text) on commit drop;
insert into pu
select r.k, g.n, md5('lf-user-' || r.k || '-' || g.n)::uuid, 'lf-' || r.k || '-' || g.n || '@perf.test'
  from (values ('field_user', 220), ('foreman', 150), ('site_supervisor', 45), ('storekeeper', 20),
               ('project_manager', 30), ('finance_officer', 20), ('executive', 10), ('administrator', 5)) r(k, cnt)
  cross join lateral generate_series(1, r.cnt) g(n);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change,
                        email_change_token_new, email_change_token_current, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       crypt('Passw0rd!dev', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', '', ''
  from pu;
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now() from pu;

insert into public.profiles (id, org_id, full_name, email, role, status, built_in_role)
select id, '00000000-0000-0000-0000-000000000001', initcap(replace(role_key, '_', ' ')) || ' ' || n, email,
       'Engineer', 'active', role_key
  from pu;

-- 30 large-org projects carry the field work: one PM each.
create temp table lp on commit drop as
select row_number() over (order by code)::int as i, id from public.projects
 where code like 'LG-%' and status = 'Ongoing Project' and archived_at is null order by code limit 30;
update public.projects p set project_manager_id = (select id from pu where role_key = 'project_manager' and n = lp.i)
  from lp where lp.id = p.id;

-- 300 issued work orders, 10 per project, each with a 500 m check-in area.
insert into public.work_orders (id, org_id, project_id, wo_number, title, status, order_value, currency, tax_treatment,
                                tax_amount, order_date, start_date, end_date, area_lat, area_lng, area_radius_m)
select md5('lf-wo-' || w)::uuid, '00000000-0000-0000-0000-000000000001', lp.id, 'LF-WO-' || lpad(w::text, 4, '0'),
       'Field work order ' || w, 'Issued', 50000000 + w * 10000, 'IDR', 'exclusive', 0,
       current_date - 120, current_date - 120, current_date + 120, -6.2 + w * 0.001, 106.8 + w * 0.001, 500
  from generate_series(1, 300) w join lp on lp.i = 1 + (w - 1) / 10;

-- 300 crews, one per work order (a crew holds one work order at a time); each foreman leads two.
insert into public.crews (id, org_id, code, name, field_controller_id, kind)
select md5('lf-crew-' || c)::uuid, '00000000-0000-0000-0000-000000000001', 'LFC-' || c, 'Field crew ' || c,
       (select id from pu where role_key = 'foreman' and n = 1 + (c - 1) % 150), 'own'
  from generate_series(1, 300) c;
insert into public.work_order_crews (org_id, work_order_id, crew_id, valid_from)
select '00000000-0000-0000-0000-000000000001', md5('lf-wo-' || c)::uuid, md5('lf-crew-' || c)::uuid, current_date - 120
  from generate_series(1, 300) c;

-- People: 3,000 workers without an account, then one person row per field user and foreman.
insert into public.people (id, org_id, code, name, kind, job_title)
select md5('lf-person-' || p)::uuid, '00000000-0000-0000-0000-000000000001', 'LFP-' || p, 'Field worker ' || p, 'own', 'Labourer'
  from generate_series(1, 3000) p;
insert into public.people (id, org_id, code, name, kind, profile_id, job_title)
select md5('lf-person-' || pu.id)::uuid, '00000000-0000-0000-0000-000000000001', 'LFA-' || pu.role_key || '-' || pu.n,
       initcap(replace(pu.role_key, '_', ' ')) || ' ' || pu.n, 'own', pu.id, initcap(replace(pu.role_key, '_', ' '))
  from pu where pu.role_key in ('field_user', 'foreman');
-- 10 workers per crew, plus the field users spread over the crews.
insert into public.crew_members (org_id, crew_id, worker_id, valid_from)
select '00000000-0000-0000-0000-000000000001', md5('lf-crew-' || (1 + (p - 1) / 10))::uuid, md5('lf-person-' || p)::uuid, current_date - 120
  from generate_series(1, 3000) p;
insert into public.crew_members (org_id, crew_id, worker_id, valid_from)
select '00000000-0000-0000-0000-000000000001', md5('lf-crew-' || (1 + (pu.n - 1) % 300))::uuid, md5('lf-person-' || pu.id)::uuid, current_date - 120
  from pu where pu.role_key = 'field_user';

-- 30,000 tasks: 100 per work order, assigned across field users, foremen, site supervisors and PMs.
insert into public.tasks (id, org_id, project_id, work_order_id, name, start_date, end_date, assignee_id, status, priority)
select md5('lf-task-' || t)::uuid, '00000000-0000-0000-0000-000000000001', wo.project_id, wo.id, 'Field task ' || t,
       current_date - 60 + t % 90, current_date - 50 + t % 90,
       (select id from pu where (role_key, n) = (case t % 4 when 0 then 'field_user' when 1 then 'foreman'
                                                         when 2 then 'site_supervisor' else 'project_manager' end,
                                                 1 + (t / 4) % case t % 4 when 0 then 220 when 1 then 150 when 2 then 45 else 30 end)),
       (array['To Do','In Progress','Done','Done','Blocked']::task_status[])[1 + t % 5],
       (array['Normal','High','Low','Urgent']::task_priority[])[1 + t % 4]
  from generate_series(1, 30000) t
  join public.work_orders wo on wo.id = md5('lf-wo-' || (1 + (t - 1) % 300))::uuid;

-- Two-step approval chain for material requests (PM, then Executive), unless the org already has one.
insert into public.approval_chain_steps (org_id, position, role, label)
select '00000000-0000-0000-0000-000000000001', s.p, s.r::user_role, s.l
  from (values (1, 'Project Manager', 'Project manager'), (2, 'Executive', 'Director')) s(p, r, l)
 where not exists (select 1 from public.approval_chain_steps where org_id = '00000000-0000-0000-0000-000000000001');

-- Stock: 200 items, one site store per project, storekeepers keep them.
insert into public.stock_items (id, org_id, code, name, unit_id)
select md5('lf-item-' || i)::uuid, '00000000-0000-0000-0000-000000000001', 'LFI-' || i, 'Field material ' || i,
       (select id from public.stock_units order by id limit 1)
  from generate_series(1, 200) i;
insert into public.stock_warehouses (id, org_id, code, name, kind, project_id)
select md5('lf-wh-' || lp.i)::uuid, '00000000-0000-0000-0000-000000000001', 'LFW-' || lp.i, 'Field site store ' || lp.i, 'site', lp.id
  from lp;
update public.work_orders w set site_warehouse_id = md5('lf-wh-' || (1 + (substr(w.wo_number, 7)::int - 1) / 10))::uuid
 where w.wo_number like 'LF-WO-%';
insert into public.stock_warehouse_keepers (org_id, warehouse_id, user_id)
select '00000000-0000-0000-0000-000000000001', md5('lf-wh-' || lp.i)::uuid, (select id from pu where role_key = 'storekeeper' and n = 1 + (lp.i - 1) % 20)
  from lp;

-- ── settled history, triggers off ──────────────────────────────────────────────────────────────────────────────
set local session_replication_role = replica;

-- 90 days of attendance before today, on each worker's crew's work order: weeks before this one approved and locked.
insert into public.attendance_days (id, org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source,
                                    tick_hours, recorded_by, recorded_by_ids, recorded_at, submitted_at, approved_by, approved_at, locked_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', m.worker_id, wo.id, wo.project_id, m.crew_id, d::date,
       case when (abs(hashtext(m.worker_id::text || d::text)) % 20) = 0 then 'absent' else 'present' end,
       case when (abs(hashtext(m.worker_id::text || d::text)) % 20) = 0 then null else 8 end,
       'roster_tick', case when (abs(hashtext(m.worker_id::text || d::text)) % 20) = 0 then 0 else 8 end,
       c.field_controller_id, array[c.field_controller_id], d + interval '17 hours',
       case when d < date_trunc('week', current_date) then d + interval '7 days' end,
       case when d < date_trunc('week', current_date) then (select id from pu where role_key = 'project_manager' and n = 1) end,
       case when d < date_trunc('week', current_date) then d + interval '8 days' end,
       case when d < date_trunc('week', current_date) then d + interval '8 days' end
  from public.crew_members m
  join public.crews c on c.id = m.crew_id and c.code like 'LFC-%'
  join public.work_order_crews r on r.crew_id = c.id
  join public.work_orders wo on wo.id = r.work_order_id
  cross join generate_series(current_date - 90, current_date - 1, interval '1 day') d
 where extract(isodow from d) < 7;

-- Field users clocked in by phone on those days.
insert into public.phone_check_ins (org_id, work_order_id, worker_id, requester_id, crew_id, work_date, hours, lat, lng, accuracy_m,
                                    distance_m, checked_in_at, outcome, status, attendance_day_id)
select a.org_id, a.work_order_id, a.worker_id, pe.profile_id, a.crew_id, a.work_date, 8, -6.2, 106.8, 10, 40,
       a.work_date + interval '7 hours', 'inside', 'recorded', a.id
  from public.attendance_days a join public.people pe on pe.id = a.worker_id and pe.profile_id is not null
 where a.status = 'present';

-- A daily site report per work order per working day for 60 days, written by a site supervisor and validated by the PM.
insert into public.daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, version, author_id, submitted_at,
                                       validated_by, validated_at, start_time, end_time, note)
select gen_random_uuid(), wo.org_id, wo.project_id, wo.id, d::date, 'validated', 1,
       (select id from pu where role_key = 'site_supervisor' and n = 1 + (substr(wo.wo_number, 7)::int - 1) % 45),
       d + interval '18 hours', p.project_manager_id, d + interval '1 day 9 hours', '07:00', '17:00', 'Work went to plan.'
  from public.work_orders wo join public.projects p on p.id = wo.project_id
  cross join generate_series(current_date - 60, current_date - 1, interval '1 day') d
 where wo.wo_number like 'LF-WO-%' and extract(isodow from d) < 7;

-- 2,400 material requests (8 per work order) by the foremen, 3 lines each; the newest 300 wait on the PM's step.
insert into public.material_requests (id, org_id, number, work_order_id, project_id, to_warehouse_id, needed_by, status, round,
                                      created_by, created_at, submitted_at, decided_at)
select md5('lf-mr-' || q)::uuid, wo.org_id, 'LF-MR-' || lpad(q::text, 5, '0'), wo.id, wo.project_id, wo.site_warehouse_id,
       current_date - 90 + q % 93, case when q > 2100 then 'pending' else (array['approved','approved','fulfilled','rejected'])[1 + q % 4] end, 1,
       (select c.field_controller_id from public.work_order_crews r join public.crews c on c.id = r.crew_id
         where r.work_order_id = wo.id order by c.code limit 1),
       now() - (2400 - q) * interval '50 minutes', now() - (2400 - q) * interval '50 minutes',
       case when q <= 2100 then now() - (2400 - q) * interval '40 minutes' end
  from generate_series(1, 2400) q join public.work_orders wo on wo.id = md5('lf-wo-' || (1 + (q - 1) % 300))::uuid;
insert into public.material_request_lines (org_id, request_id, line_no, item_id, quantity)
select '00000000-0000-0000-0000-000000000001', md5('lf-mr-' || q)::uuid, l, md5('lf-item-' || (1 + (q * 3 + l) % 200))::uuid, 10 * l
  from generate_series(1, 2400) q cross join generate_series(1, 3) l;
insert into public.material_request_steps (org_id, request_id, round, position, role, label, status, decided_by, decided_at)
select '00000000-0000-0000-0000-000000000001', mr.id, 1, s.p, s.r::user_role, s.l,
       case when mr.status = 'pending' then case s.p when 1 then 'open' else 'waiting' end else 'approved' end,
       case when mr.status <> 'pending' then (select id from pu where role_key = case s.p when 1 then 'project_manager' else 'executive' end and n = 1) end,
       mr.decided_at
  from public.material_requests mr cross join (values (1, 'Project Manager', 'Project manager'), (2, 'Executive', 'Director')) s(p, r, l)
 where mr.number like 'LF-MR-%';

-- 90 days of stock movement: per project store a receive every working day and an issue to a work order, 4 lines each.
create temp table sd on commit drop as
select md5('lf-sd-' || lp.i || '-' || d::date || '-' || k)::uuid as id, lp.i, lp.id as project_id, d::date as day, k,
       md5('lf-wh-' || lp.i)::uuid as wh, md5('lf-wo-' || ((lp.i - 1) * 10 + 1 + (extract(doy from d)::int % 10)))::uuid as wo
  from lp cross join generate_series(current_date - 90, current_date - 1, interval '1 day') d cross join (values ('receive'), ('issue')) x(k)
 where extract(isodow from d) < 7;
insert into public.stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, work_order_id, occurred_on, created_by,
                                    created_at, posted_by, posted_at)
select id, '00000000-0000-0000-0000-000000000001', 'LF-SD-' || i || '-' || to_char(day, 'YYYYMMDD') || '-' || k, k, 'Posted', wh,
       case when k = 'issue' then project_id end, case when k = 'issue' then wo end, day,
       (select id from pu where role_key = 'storekeeper' and n = 1 + (i - 1) % 20), day + interval '10 hours',
       (select id from pu where role_key = 'storekeeper' and n = 1 + (i - 1) % 20), day + interval '10 hours'
  from sd;
create temp table sl on commit drop as
select md5(sd.id::text || l)::uuid as id, sd.id as document_id, l as line_no, sd.i, sd.wh, sd.project_id, sd.day, sd.k,
       md5('lf-item-' || (1 + (sd.i * 7 + l * 13 + extract(doy from sd.day)::int) % 200))::uuid as item_id,
       case when sd.k = 'receive' then 20 else -10 end::numeric as qty
  from sd cross join generate_series(1, 4) l;
insert into public.stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, unit_cost)
select id, '00000000-0000-0000-0000-000000000001', document_id, line_no, item_id, abs(qty), 15000 from sl;
insert into public.stock_ledger (id, org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta,
                                 qty_after, value_after, occurred_on, posted_at, posted_by)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
       document_id, id, item_id, wh, case when k = 'issue' then project_id end, k, qty, qty * 15000,
       sum(qty) over w, sum(qty * 15000) over w, day, day + interval '10 hours',
       (select id from pu where role_key = 'storekeeper' and n = 1 + (sl.i - 1) % 20)
  from sl window w as (partition by item_id, wh order by day, k desc, line_no);
insert into public.stock_balances (org_id, item_id, warehouse_id, qty_on_hand, value_on_hand)
select '00000000-0000-0000-0000-000000000001', item_id, wh, sum(qty), sum(qty * 15000) from sl group by item_id, wh;

set local session_replication_role = origin;
commit;

analyze;
