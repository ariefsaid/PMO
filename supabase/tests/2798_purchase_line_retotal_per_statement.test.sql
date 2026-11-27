-- 2798_purchase_line_retotal_per_statement.test.sql — the purchase total roll-up (0284) and the line work-order copy (1883) now run once
-- per statement (migration 2798). Parity proof: the same line sequences run first under the new statement triggers, then under the OLD
-- per-row bodies kept in this file under temporary names (t2798_old_*), and every stored purchase total, header work order, the change
-- history written for the header and the error each step raised are compared step by step.
-- Also: a 50-line save re-writes the purchase header once instead of 50 times; definer status, search path and grants are unchanged.
-- MUTATION CHECKS (each must turn this file RED, then be restored):
--   1. In 2798's sync_procurement_item_total, drop `v_ids` handling of old_rows in the update branch (re-total only new_rows) -> the
--      'a line moved between purchases' parity step goes red.
--   2. In 2798's copy_line_work_order_to_header, remove the `pmo.line_work_order_set` gate -> the 'update without work_order_id in
--      the SET list leaves the header' parity step goes red.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency) values ('27980000-0000-0000-0000-00000000000a', 'Retotal Org', 'IDR');
insert into auth.users (id, email) values ('27980000-0000-0000-0000-0000000000a3', 'retotal-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27980000-0000-0000-0000-0000000000a3', '27980000-0000-0000-0000-00000000000a', 'Retotal PM', 'retotal-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values ('27980000-0000-0000-0000-0000000000d1', '27980000-0000-0000-0000-00000000000a', 'Retotal Site', 'Ongoing Project', '27980000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27980000-0000-0000-0000-000000000401', '27980000-0000-0000-0000-00000000000a', '27980000-0000-0000-0000-0000000000d1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('27980000-0000-0000-0000-000000000402', '27980000-0000-0000-0000-00000000000a', '27980000-0000-0000-0000-0000000000d1', 'WO two', 'Issued', 10000, 'exclusive', 0);
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('27980000-0000-0000-0000-000000000403', '27980000-0000-0000-0000-00000000000a', '27980000-0000-0000-0000-0000000000d1', 'WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
-- slots: a, b = Draft purchases; r = a submitted purchase. One set per run ('n' new triggers, 'o' old bodies).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency)
select ('2798000' || t.k || '-0000-0000-0000-00000000060' || s.n)::uuid, '27980000-0000-0000-0000-00000000000a', 'Retotal ' || t.k || s.n,
       '27980000-0000-0000-0000-0000000000d1', '27980000-0000-0000-0000-0000000000a3',
       case s.n when 3 then 'Requested' else 'Draft' end::procurement_status, 0, 0, 'IDR'
  from (values ('1'), ('2')) t(k), (values (1), (2), (3)) s(n);
set local session_replication_role = origin;

-- Old bodies, verbatim from 0284 and 1883, under temporary names.
create function public.t2798_old_sync() returns trigger language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  if tg_op in ('UPDATE','DELETE') then
    v_id := old.procurement_id;
    update public.procurements p set total_value = s.line_total, updated_at = now()
      from (select sum(i.amount) as line_total from public.procurement_items i where i.procurement_id = v_id) s
     where p.id = v_id and p.status in ('Draft','Rejected') and s.line_total is not null;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_id := new.procurement_id;
    update public.procurements p set total_value = s.line_total, updated_at = now()
      from (select sum(i.amount) as line_total from public.procurement_items i where i.procurement_id = v_id) s
     where p.id = v_id and p.status in ('Draft','Rejected') and s.line_total is not null;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
create function public.t2798_old_copy() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case uuid := case when tg_op = 'DELETE' then old.procurement_id else new.procurement_id end;
  v_lines int; v_named int; v_distinct int; v_wo uuid;
begin
  select count(*), count(i.work_order_id), count(distinct i.work_order_id), min(i.work_order_id::text)::uuid
    into v_lines, v_named, v_distinct, v_wo from public.procurement_items i where i.procurement_id = v_case;
  if v_lines > 0 and v_named = v_lines and v_distinct = 1
     and exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled')
     and exists (select 1 from public.procurements p where p.id = v_case and p.status in ('Draft', 'Rejected')) then
    update public.procurements set work_order_id = v_wo where id = v_case and work_order_id is distinct from v_wo;
  end if;
  return null;
end $$;

-- Header update counter (every row-level update of a purchase header).
create table t2798_header_writes (n int);
create function public.t2798_count_write() returns trigger language plpgsql as $$ begin insert into t2798_header_writes values (1); return null; end $$;
create trigger t2798_count after update on public.procurements for each row execute function public.t2798_count_write();

create function public.t2798_swap_to_old() returns void language plpgsql as $$
begin
  drop trigger procurement_items_sync_total_ins on public.procurement_items;
  drop trigger procurement_items_sync_total_upd on public.procurement_items;
  drop trigger procurement_items_sync_total_del on public.procurement_items;
  drop trigger zz_copy_line_work_order_to_header_ins on public.procurement_items;
  drop trigger zz_copy_line_work_order_to_header_del on public.procurement_items;
  drop trigger zz_copy_line_work_order_to_header_1_upd_cols on public.procurement_items;
  drop trigger zz_copy_line_work_order_to_header_2_upd on public.procurement_items;
  create trigger procurement_items_sync_total after insert or update or delete on public.procurement_items
    for each row execute function public.t2798_old_sync();
  create trigger zz_copy_line_work_order_to_header after insert or delete or update of work_order_id on public.procurement_items
    for each row execute function public.t2798_old_copy();
end $$;

create table t2798_snap (run text, step int, slot int, total numeric, wo uuid, history text, outcome text);

-- One step = a statement text with {a} {b} {r} (purchase ids) and {L01}.. (line ids) of this run. Records the error (if any) and the state
-- of every slot after the step.
create function public.t2798_run(p_run text) returns void language plpgsql as $$
declare
  k text := case p_run when 'n' then '1' else '2' end;
  ids uuid[] := array[('2798000' || k || '-0000-0000-0000-000000000601')::uuid, ('2798000' || k || '-0000-0000-0000-000000000602')::uuid, ('2798000' || k || '-0000-0000-0000-000000000603')::uuid];
  steps text[]; q text; i int; n int; v_out text;
  wo1 text := '27980000-0000-0000-0000-000000000401'; wo2 text := '27980000-0000-0000-0000-000000000402'; wo3 text := '27980000-0000-0000-0000-000000000403';
  ins text := 'insert into procurement_items (id, org_id, procurement_id, name, quantity, rate, work_order_id) values ';
  o text := '''27980000-0000-0000-0000-00000000000a''';
begin
  steps := array[
    ins || '(''{L01}'',' || o || ',''{a}'',''L1'',1,100,null),(''{L02}'',' || o || ',''{a}'',''L2'',2,50,null),(''{L03}'',' || o || ',''{a}'',''L3'',3,10,null)',
    ins || '(''{L04}'',' || o || ',''{a}'',''L4'',1,7,''' || wo1 || ''')',
    ins || '(''{L05}'',' || o || ',''{b}'',''B1'',1,11,null),(''{L06}'',' || o || ',''{b}'',''B2'',1,13,null),(''{L07}'',' || o || ',''{r}'',''R1'',1,5,null)',
    'update procurement_items set rate = rate + 1 where id = ''{L01}''',
    'update procurement_items set quantity = quantity + 1 where procurement_id in (''{a}'',''{b}'',''{r}'')',
    'update procurement_items set work_order_id = ''' || wo1 || ''' where procurement_id = ''{a}''',
    'update procurements set work_order_id = null where id = ''{a}''',
    'update procurement_items set rate = rate + 2 where procurement_id = ''{a}''',
    'update procurement_items set rate = rate + 3, work_order_id = work_order_id where procurement_id = ''{a}''',
    'update procurement_items set work_order_id = ''' || wo2 || ''' where procurement_id = ''{b}''',
    'update procurement_items set work_order_id = ''' || wo1 || ''' where id = ''{L05}''',
    'update procurement_items set work_order_id = ''' || wo3 || ''' where procurement_id = ''{b}''',
    'update procurement_items set work_order_id = ''' || wo1 || ''', quantity = 9 where procurement_id = ''{r}''',
    'update procurement_items set procurement_id = ''{b}'' where id = ''{L03}''',
    'update procurement_items set procurement_id = case id when ''{L03}'' then ''{a}''::uuid else ''{b}''::uuid end where id in (''{L03}'',''{L02}'')',
    'update procurement_items set rate = 1 where id = ''00000000-0000-0000-0000-000000000000''',
    'delete from procurement_items where id = ''{L02}''',
    'delete from procurement_items where id in (''{L04}'',''{L05}'',''{L07}'')',
    'delete from procurement_items where procurement_id = ''{a}''',
    ins || '(''{L09}'',' || o || ',''{a}'',''L9'',4,25,''' || wo2 || ''')',
    'update procurements set status = ''Rejected'', rejection_notes = ''n'' where id = ''{b}''',
    'update procurement_items set rate = rate * 2 where procurement_id = ''{b}''',
    'delete from procurement_items where procurement_id = ''{b}'''
  ];
  for i in 1 .. array_length(steps, 1) loop
    q := replace(replace(replace(steps[i], '{a}', ids[1]::text), '{b}', ids[2]::text), '{r}', ids[3]::text);
    for n in 1 .. 12 loop
      q := replace(q, '{L' || lpad(n::text, 2, '0') || '}', format('2798%s000-0000-0000-0000-0000000000%s', k, lpad(n::text, 2, '0')));
    end loop;
    v_out := 'ok';
    begin
      execute q;
    exception when others then v_out := 'err ' || sqlstate;
    end;
    insert into t2798_snap
    select p_run, i, s.n, p.total_value, p.work_order_id,
           coalesce((select string_agg(rc.op || ':' || rc.changes::text, ' | ' order by rc.seq) from record_changes rc where rc.entity_id = p.id), ''),
           v_out
      from (values (1), (2), (3)) s(n) join procurements p on p.id = ids[s.n];
  end loop;
end $$;

-- Header writes for one 50-line save (a single statement), new triggers first, then the old ones.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('27980009-0000-0000-0000-000000000601', '27980000-0000-0000-0000-00000000000a', 'Retotal big new', '27980000-0000-0000-0000-0000000000d1', '27980000-0000-0000-0000-0000000000a3', 'Draft', 0, 0, 'IDR'),
  ('27980009-0000-0000-0000-000000000602', '27980000-0000-0000-0000-00000000000a', 'Retotal big old', '27980000-0000-0000-0000-0000000000d1', '27980000-0000-0000-0000-0000000000a3', 'Draft', 0, 0, 'IDR');
truncate t2798_header_writes;
insert into procurement_items (org_id, procurement_id, name, quantity, rate, work_order_id)
  select '27980000-0000-0000-0000-00000000000a', '27980009-0000-0000-0000-000000000601', 'big ' || g, 1, g, '27980000-0000-0000-0000-000000000401' from generate_series(1, 50) g;
create temp table t2798_counts as select 'new'::text as run, count(*)::int as writes from t2798_header_writes;
select is((select total_value from procurements where id = '27980009-0000-0000-0000-000000000601'), 1275::numeric, 'a 50-line save totals the purchase (sum 1..50)');
select public.t2798_run('n');
select public.t2798_swap_to_old();
truncate t2798_header_writes;
insert into procurement_items (org_id, procurement_id, name, quantity, rate, work_order_id)
  select '27980000-0000-0000-0000-00000000000a', '27980009-0000-0000-0000-000000000602', 'big ' || g, 1, g, '27980000-0000-0000-0000-000000000401' from generate_series(1, 50) g;
insert into t2798_counts select 'old', count(*)::int from t2798_header_writes;
select public.t2798_run('o');

select ok((select count(*) from t2798_snap where run = 'n') = 69 and (select count(*) from t2798_snap where run = 'o') = 69, 'both runs recorded 23 steps x 3 purchases');
select is((select count(*) from (select step, slot, total, wo, history, outcome from t2798_snap where run = 'n' except select step, slot, total, wo, history, outcome from t2798_snap where run = 'o') d)::int, 0,
  'parity: every stored total, header work order, header change history and step outcome match the old per-row triggers (new minus old)');
select is((select count(*) from (select step, slot, total, wo, history, outcome from t2798_snap where run = 'o' except select step, slot, total, wo, history, outcome from t2798_snap where run = 'n') d)::int, 0,
  'parity: (old minus new)');
select ok((select count(*) from t2798_snap where run = 'n' and outcome = 'ok')   >= 66, 'the sequences really ran (at most a few steps are refused, identically in both runs)');
select ok((select count(distinct total) from t2798_snap where run = 'n' and slot = 1) >= 5 and (select count(distinct wo) from t2798_snap where run = 'n' and slot = 1) >= 2,
  'the sequences move the total and the header work order (the comparison is not vacuous)');
select diag('step outcomes (new): ' || (select string_agg(step::text || '=' || outcome, ' ' order by step) from t2798_snap where run = 'n' and slot = 1));

select is((select writes from t2798_counts where run = 'new'), 2, 'a 50-line save writes the purchase header twice in total (one total, one work-order copy), not once per line');
select cmp_ok((select writes from t2798_counts where run = 'old'), '>=', 50, 'before: the same save wrote the header at least once per line');
select diag('header writes for a 50-line save: before=' || (select writes from t2798_counts where run='old') || ' after=' || (select writes from t2798_counts where run='new'));
select ok(
  (select prosecdef and proconfig = array['search_path=public, pg_catalog, pg_temp'] from pg_proc where oid = 'public.sync_procurement_item_total'::regproc)
  and (select prosecdef and proconfig = array['search_path=public, pg_temp'] from pg_proc where oid = 'public.copy_line_work_order_to_header'::regproc)
  and (select prosecdef and proconfig = array['search_path=public, pg_temp'] from pg_proc where oid = 'public.mark_line_work_order_set'::regproc)
  and not has_function_privilege('anon', 'public.sync_procurement_item_total()', 'execute')
  and not has_function_privilege('authenticated', 'public.sync_procurement_item_total()', 'execute')
  and not has_function_privilege('anon', 'public.copy_line_work_order_to_header()', 'execute')
  and not has_function_privilege('authenticated', 'public.copy_line_work_order_to_header()', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_line_work_order_set()', 'execute'),
  'the trigger functions stay security definer with a pinned search path and no direct execute for anon or authenticated');
select finish();
rollback;
