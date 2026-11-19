-- AC-APR-056: two real approvals overlap through the first commit.
create extension if not exists dblink;
begin;
select plan(6);
select dblink_connect('approval_first', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(),5432)));
-- The fixtures commit through dblink, so the same cleanup runs before the setup (erasing a run that died
-- mid-file) and at the end. It deletes every org-scoped row of the test org, retrying in FK order.
select dblink_exec('approval_first', $clean$
do $do$
declare r record; v_blocked int; v_pass int := 0;
begin
  loop
    v_blocked := 0;
    for r in select c.table_name from information_schema.columns c
               join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
              where c.table_schema = 'public' and c.column_name = 'org_id' and c.table_name <> 'organizations' loop
      begin
        execute format('delete from public.%I where org_id = %L', r.table_name, 'a2511000-0000-0000-0000-000000000001');
      exception when foreign_key_violation then v_blocked := v_blocked + 1;
      end;
    end loop;
    v_pass := v_pass + 1;
    exit when v_blocked = 0 or v_pass > 10;
  end loop;
  delete from public.organizations where id = 'a2511000-0000-0000-0000-000000000001';
  delete from auth.users where id in ('a2511000-0000-0000-0000-000000000011','a2511000-0000-0000-0000-000000000012','a2511000-0000-0000-0000-000000000013');
end $do$;
$clean$);
select dblink_exec('approval_first', $setup$
  insert into organizations (id,name,default_currency) values ('a2511000-0000-0000-0000-000000000001','Approval concurrency','USD');
  insert into auth.users (id,email) values ('a2511000-0000-0000-0000-000000000011','interleave-eng@example.invalid'), ('a2511000-0000-0000-0000-000000000012','interleave-pm@example.invalid'), ('a2511000-0000-0000-0000-000000000013','interleave-exec@example.invalid');
  insert into profiles (id,org_id,full_name,email,role,status) values
    ('a2511000-0000-0000-0000-000000000011','a2511000-0000-0000-0000-000000000001','Engineer','interleave-eng@example.invalid','Engineer','active'),
    ('a2511000-0000-0000-0000-000000000012','a2511000-0000-0000-0000-000000000001','Manager','interleave-pm@example.invalid','Project Manager','active'),
    ('a2511000-0000-0000-0000-000000000013','a2511000-0000-0000-0000-000000000001','Executive','interleave-exec@example.invalid','Executive','active');
  insert into projects (id,org_id,name,status,currency) values ('a2511000-0000-0000-0000-000000000021','a2511000-0000-0000-0000-000000000001','Interleave','Ongoing Project','USD');
  insert into budget_versions (id,org_id,project_id,version,name,status,currency) values ('a2511000-0000-0000-0000-000000000031','a2511000-0000-0000-0000-000000000001','a2511000-0000-0000-0000-000000000021',1,'v1','Draft','USD');
  insert into budget_line_items (org_id,budget_version_id,category,budgeted_amount) values
    ('a2511000-0000-0000-0000-000000000001','a2511000-0000-0000-0000-000000000031','Labor',400),
    ('a2511000-0000-0000-0000-000000000001','a2511000-0000-0000-0000-000000000031','Materials',600);
  update budget_versions set status='Active' where id='a2511000-0000-0000-0000-000000000031';
  insert into spend_approvers (org_id,project_id,profile_id) values
    ('a2511000-0000-0000-0000-000000000001','a2511000-0000-0000-0000-000000000021','a2511000-0000-0000-0000-000000000012'),
    ('a2511000-0000-0000-0000-000000000001',null,'a2511000-0000-0000-0000-000000000013');
  insert into procurements (id,org_id,title,status,total_value,project_id,currency,budget_category,requested_by_id) values
    ('a2511000-0000-0000-0000-000000000041','a2511000-0000-0000-0000-000000000001','Categoryless','Requested',600,'a2511000-0000-0000-0000-000000000021','USD',null,'a2511000-0000-0000-0000-000000000011'),
    ('a2511000-0000-0000-0000-000000000042','a2511000-0000-0000-0000-000000000001','Materials','Requested',500,'a2511000-0000-0000-0000-000000000021','USD','Materials','a2511000-0000-0000-0000-000000000011');
$setup$);
select dblink_exec('approval_first','set role authenticated');
select dblink_exec('approval_first', $$set request.jwt.claims = '{"sub":"a2511000-0000-0000-0000-000000000013","role":"authenticated"}'$$);
-- The first RPC completes but deliberately retains its transaction lock until COMMIT.
select dblink_exec('approval_first','begin');
select * from dblink('approval_first', $$select transition_procurement('a2511000-0000-0000-0000-000000000041','Approved')::text$$) as x(result text);
select dblink_connect('approval_second', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(),5432)));
select dblink_exec('approval_second','set role authenticated');
select dblink_exec('approval_second', $$set request.jwt.claims = '{"sub":"a2511000-0000-0000-0000-000000000012","role":"authenticated"}'$$);
create temporary table approval_second_pid as select pid from dblink('approval_second','select pg_backend_pid()') as x(pid int);
select is(dblink_send_query('approval_second', $$select transition_procurement('a2511000-0000-0000-0000-000000000042','Approved')::text$$),1,'AC-APR-056: competing named approval starts');
create function pg_temp.wait_for_approval_lock(p_pid int) returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted and locktype='advisory') then return true; end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;
select ok(pg_temp.wait_for_approval_lock((select pid from approval_second_pid)), 'AC-APR-056: competing approval waits for the project lock');
select is(dblink_exec('approval_first','commit'),'COMMIT','AC-APR-056: senior approval commits while competitor waits');
select is((select count(*)::int from dblink_get_result('approval_second',false) as x(result text)),0,'AC-APR-056: named approval does not succeed after first commit');
select alike(dblink_error_message('approval_second'), '%exceeds_project%', 'AC-APR-056: competitor reclassifies against committed categoryless reservation');
select dblink_disconnect('approval_second');
select dblink_exec('approval_first', 'reset role; reset request.jwt.claims');
select dblink_exec('approval_first', $clean$
do $do$
declare r record; v_blocked int; v_pass int := 0;
begin
  loop
    v_blocked := 0;
    for r in select c.table_name from information_schema.columns c
               join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
              where c.table_schema = 'public' and c.column_name = 'org_id' and c.table_name <> 'organizations' loop
      begin
        execute format('delete from public.%I where org_id = %L', r.table_name, 'a2511000-0000-0000-0000-000000000001');
      exception when foreign_key_violation then v_blocked := v_blocked + 1;
      end;
    end loop;
    v_pass := v_pass + 1;
    exit when v_blocked = 0 or v_pass > 10;
  end loop;
  delete from public.organizations where id = 'a2511000-0000-0000-0000-000000000001';
  delete from auth.users where id in ('a2511000-0000-0000-0000-000000000011','a2511000-0000-0000-0000-000000000012','a2511000-0000-0000-0000-000000000013');
end $do$;
$clean$);
select dblink_disconnect('approval_first');
select is((select count(*)::int from organizations where id = 'a2511000-0000-0000-0000-000000000001'),0,'AC-APR-056: committed fixtures are removed');
select * from finish();
rollback;
