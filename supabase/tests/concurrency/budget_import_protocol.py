#!/usr/bin/env python3
"""Real PostgreSQL sessions; run under the repository's shared DB lock."""
import subprocess
import json
from pathlib import Path
import time

CMD = ['docker', 'exec', '-i', 'supabase_db_pmo-portal', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
ORG = '03970000-0000-0000-0000-000000000001'
USER = '03970000-0000-0000-0000-0000000000a1'
VERSION = '03970000-0000-0000-0000-000000000100'


def run(sql):
    return subprocess.run(CMD, input=sql, text=True, capture_output=True, check=True).stdout.strip()


def conn(name, client=False):
    p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    claims = {'sub': USER, 'role': 'authenticated'}
    if client:
        claims['client_id'] = 'cli'
    p.stdin.write(f"set application_name = '{name}'; begin; set local role authenticated; select set_config('request.jwt.claims', '{json.dumps(claims)}', true); set local request.method = 'POST'; set local request.path = '/rpc/import_budget_line_v2'; set local request.headers = '{{}}'; select public.api_client_request_guard();\\echo READY\n")
    p.stdin.flush()
    while p.stdout.readline().strip() != 'READY':
        if p.poll() is not None:
            raise RuntimeError(p.stderr.read())
    return p


def send(p, sql, token):
    p.stdin.write(sql + '\n\\echo ' + token + '\n')
    p.stdin.flush()


def result(p, token):
    lines = []
    while True:
        line = p.stdout.readline()
        if not line:
            raise RuntimeError(p.stderr.read())
        if line.strip() == token:
            return '\n'.join(lines).strip()
        lines.append(line.strip())


def imp(key, old, ref):
    return f"select outcome from public.import_budget_line_v2('{VERSION}','Labor','test',1,'2026','03970000-0000-0000-0000-0000000000b1',now(),'{key}','{old}',{str(ref).lower()});"


def blocked(name):
    for _ in range(100):
        if run(f"select count(*) from pg_stat_activity where application_name='{name}' and cardinality(pg_blocking_pids(pid)) > 0;") == '1':
            return
        time.sleep(.05)
    raise AssertionError(f'{name} did not wait on a database lock')


def race(label, akey, aold, aref, bkey, bold, bref, finish, expected_a, expected_b, client_first=False):
    a = conn('t397_a', client_first)
    b = conn('t397_b', not client_first)
    try:
        send(a, imp(akey, aold, aref), 'A_DONE')
        actual_a = result(a, 'A_DONE')
        assert actual_a == expected_a, (label, actual_a)
        send(b, imp(bkey, bold, bref), 'B_DONE')
        blocked('t397_b')
        send(a, finish + ';', 'A_END')
        result(a, 'A_END')
        actual_b = result(b, 'B_DONE')
        assert actual_b == expected_b, (label, actual_b)
        send(b, 'commit;', 'B_END')
        result(b, 'B_END')
        print(label, actual_a, actual_b)
    finally:
        for p in (a, b):
            p.stdin.close()
            p.wait(timeout=10)


run(f"""
insert into organizations(id,name,default_currency) values ('{ORG}','Concurrency import','USD'), ('03970000-0000-0000-0000-000000000002','Concurrency other','USD');
insert into auth.users(id,email) values ('{USER}','t397race@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('{USER}','{ORG}','Race','t397race@example.test','Admin','active');
insert into projects(id,org_id,code,name,status) values ('03970000-0000-0000-0000-000000000010','{ORG}','RACE397','Race','Ongoing Project');
insert into budget_versions(id,org_id,project_id,version,name) values ('{VERSION}','{ORG}','03970000-0000-0000-0000-000000000010',1,'Race');
""")
schema_down = False
try:
    assert run('show transaction_isolation;') == 'read committed'
    race('app then CLI', 'v2:one', 'one', True, 'v2:one', 'one', True, 'commit', 'created', 'skipped')
    race('CLI then app', 'v2:two', 'two', True, 'v2:two', 'two', True, 'commit', 'created', 'skipped', client_first=True)
    race('rollback', 'v2:rollback', 'rollback', True, 'v2:rollback', 'rollback', True, 'rollback', 'created', 'created')
    race('distinct references', 'v2:three', 'three', True, 'v2:four', 'four', True, 'commit', 'created', 'created')
    race('fingerprint and reference', 'v2:five', 'fp:five', False, 'v2:six', 'fp:five', True, 'commit', 'created', 'created')
    run(f"insert into budget_line_items(org_id,budget_version_id,category,import_key) values ('{ORG}','{VERSION}','Labor','fp:legacy');")
    race('legacy ambiguity', 'v2:legacy', 'fp:legacy', False, 'v2:legacy', 'fp:legacy', False, 'commit', 'conflict', 'conflict')
    assert run(f"select count(*) from budget_line_items where budget_version_id='{VERSION}' and import_key='v2:one';") == '1'
    assert run(f"select count(*) from budget_line_items where budget_version_id='{VERSION}' and import_key='v2:legacy';") == '0'
    a = conn('t397_a')
    b = conn('t397_b')
    try:
        send(a, imp('v2:parent', 'parent', True), 'A_DONE')
        assert result(a, 'A_DONE') == 'created'
        send(b, "reset role; update public.budget_versions set status='Archived' where id='" + VERSION + "' returning status;", 'B_DONE')
        blocked('t397_b')
        send(a, 'commit;', 'A_END')
        result(a, 'A_END')
        assert result(b, 'B_DONE') == 'Archived'
        send(b, 'rollback;', 'B_END')
        result(b, 'B_END')
        print('parent mutation waited for import')
    finally:
        for p in (a, b):
            p.stdin.close()
            p.wait(timeout=10)
    assert run(f"select status from budget_versions where id='{VERSION}';") == 'Draft'
    a = conn('t397_a')
    b = conn('t397_b')
    try:
        send(a, imp('v2:org', 'org', True), 'A_DONE')
        assert result(a, 'A_DONE') == 'created'
        send(b, "reset role; update public.budget_versions set org_id='03970000-0000-0000-0000-000000000002' where id='" + VERSION + "' returning org_id;", 'B_DONE')
        blocked('t397_b')
        send(a, 'commit;', 'A_END')
        result(a, 'A_END')
        assert result(b, 'B_DONE') == '03970000-0000-0000-0000-000000000002'
        send(b, 'rollback;', 'B_END')
        result(b, 'B_END')
        print('parent org mutation waited for import')
    finally:
        for p in (a, b):
            p.stdin.close()
            p.wait(timeout=10)
    a = conn('t397_a')
    b = conn('t397_b')
    try:
        send(a, imp('v2:old-writer', 'old-writer', True), 'A_DONE')
        assert result(a, 'A_DONE') == 'created'
        send(b, f"""create function pg_temp.old_insert() returns text language plpgsql as $$ begin
          insert into public.budget_line_items(org_id,budget_version_id,category,import_key) values ('{ORG}','{VERSION}','Labor','old-writer');
          return 'unexpected'; exception when insufficient_privilege then return 'rejected'; end $$;
          select pg_temp.old_insert();""", 'B_DONE')
        assert result(b, 'B_DONE') == 'rejected'
        send(b, 'rollback;', 'B_END')
        result(b, 'B_END')
        send(a, 'commit;', 'A_END')
        result(a, 'A_END')
        print('old keyed insert rejected during import')
    finally:
        for p in (a, b):
            p.stdin.close()
            p.wait(timeout=10)
    rollback_sql = Path('supabase/migrations/rollback/0397_budget_import_protocol_down.sql').read_text()
    run("begin;\n" + rollback_sql + f"""
    do $$ begin
      if not exists (select 1 from public.budget_line_items where budget_version_id='{VERSION}' and import_key='v2:one') then
        raise exception 'rollback changed retained key';
      end if;
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='budget_line_items' and column_name='import_origin') then
        raise exception 'rollback retained marker';
      end if;
      if to_regprocedure('public.import_budget_line_v2(uuid,public.budget_category,text,numeric,text,uuid,timestamp with time zone,text,text,boolean)') is not null then
        raise exception 'rollback retained RPC';
      end if;
      if position('import_budget_line_v2' in pg_get_functiondef('public.api_client_request_guard()'::regprocedure)) <> 0 then
        raise exception 'rollback did not restore client guard';
      end if;
    end $$;
    rollback;
    """)
    assert run(f"select import_origin from budget_line_items where budget_version_id='{VERSION}' and import_key='v2:one';") == '2'
    print('rollback retains keys; transaction restores schema and marker')
    # Exercise the real DDL cutover against an already-open legacy write.
    run(rollback_sql)
    schema_down = True
    a = conn('t397_a')
    b = conn('t397_b')
    migration_sql = Path('supabase/migrations/0397_budget_import_protocol.sql').read_text()
    try:
        send(a, f"insert into public.budget_line_items(org_id,budget_version_id,category,import_key) values ('{ORG}','{VERSION}','Labor','cutover-old') returning import_key;", 'A_DONE')
        assert result(a, 'A_DONE') == 'cutover-old'
        send(b, 'reset role;\n' + migration_sql, 'B_DONE')
        blocked('t397_b')
        send(a, 'commit;', 'A_END')
        result(a, 'A_END')
        result(b, 'B_DONE')
        send(b, 'commit;', 'B_END')
        result(b, 'B_END')
        schema_down = False
    finally:
        for p in (a, b):
            p.stdin.close()
            p.wait(timeout=10)
    c = conn('t397_c')
    try:
        send(c, f"""create function pg_temp.old_insert() returns text language plpgsql as $$ begin
          insert into public.budget_line_items(org_id,budget_version_id,category,import_key) values ('{ORG}','{VERSION}','Labor','cutover-after');
          return 'unexpected'; exception when insufficient_privilege then return 'rejected'; end $$;
          select pg_temp.old_insert();""", 'C_DONE')
        assert result(c, 'C_DONE') == 'rejected'
        send(c, 'rollback;', 'C_END')
        result(c, 'C_END')
    finally:
        c.stdin.close()
        c.wait(timeout=10)
    assert run(f"select count(*) from budget_line_items where budget_version_id='{VERSION}' and import_key in ('cutover-old','cutover-after');") == '1'
    print('migration waited for legacy insert; later keyed insert rejected')
finally:
    if schema_down:
        run(Path('supabase/migrations/0397_budget_import_protocol.sql').read_text())
    run(f"delete from budget_line_items where budget_version_id='{VERSION}'; delete from budget_versions where id='{VERSION}'; delete from projects where id='03970000-0000-0000-0000-000000000010'; delete from profiles where id='{USER}'; delete from auth.users where id='{USER}'; delete from organizations where id in ('{ORG}','03970000-0000-0000-0000-000000000002');")
