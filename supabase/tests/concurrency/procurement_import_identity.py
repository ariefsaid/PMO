"""Two-session arbitration of imported purchase request identities (DB lock required)."""
import json
import subprocess
import time

BASE = ["docker", "exec", "-i", "supabase_db_pmo-portal", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
ORG = "39930000-0000-0000-0000-000000000001"
USER = "39930000-0000-0000-0000-000000000011"
CASE = "39930000-0000-0000-0000-000000000021"
RUN1 = "39930000-0000-0000-0000-000000000031"
RUN2 = "39930000-0000-0000-0000-000000000032"


def run(sql, check=True):
    result = subprocess.run(BASE, input=sql, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def insert_sql(mode, key, amount, run_id):
    if mode == "app":
        return (f"set role authenticated; set request.jwt.claims = '{{\"sub\":\"{USER}\",\"role\":\"authenticated\"}}'; "
                f"select id from public.create_purchase_request('{CASE}', 'R', null, null, {amount}, '{key}', '{run_id}');")
    return ("set role service_role; set request.jwt.claims = '{\"role\":\"service_role\"}'; "
            f"insert into public.purchase_requests(procurement_id,reference_number,amount,import_key,import_batch_id) values ('{CASE}','R',{amount},'{key}','{run_id}');")


def race(mode, key_a, key_b, amount_b, duplicate):
    first = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("begin; " + insert_sql(mode, key_a, 10, RUN1) + " select pg_sleep(2); commit;\n")
    first.stdin.close()
    time.sleep(0.4)
    second = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    started = time.monotonic()
    out2, err2 = second.communicate("begin; " + insert_sql(mode, key_b, amount_b, RUN2) + " commit;\n", timeout=15)
    overlap_wait = time.monotonic() - started
    out1 = first.stdout.read()
    err1 = first.stderr.read()
    rc1 = first.wait(timeout=15)
    assert rc1 == 0, (out1, err1)
    if duplicate:
        assert overlap_wait >= 1, 'second transaction did not overlap the first'
        assert second.returncode != 0 and "23505" in err2, (out2, err2)
        facts = json.loads(run(f"select import_identity_facts from public.purchase_requests where procurement_id='{CASE}' and import_key='{key_a}';").stdout.strip())
        assert facts == ["R", "Draft", None, "10.00"], facts
        assert (facts[3] == f"{amount_b:.2f}") == (amount_b == 10)
        count = run(f"select count(*) from public.purchase_requests where procurement_id='{CASE}' and import_key='{key_a}';").stdout.strip()
        assert count == "1", count
    else:
        assert second.returncode == 0, (out2, err2)
    print(f"{mode}: {key_a}, {key_b}: {'one row' if duplicate else 'both rows'}")


try:
    run(f"""
      insert into public.organizations(id,name) values ('{ORG}','Race org');
      insert into auth.users(id,email) values ('{USER}','race@example.invalid');
      insert into public.profiles(id,org_id,full_name,email,role) values ('{USER}','{ORG}','Admin','race@example.invalid','Admin');
      insert into public.procurements(id,org_id,title,status,requested_by_id) values ('{CASE}','{ORG}','Race','Draft','{USER}');
      insert into public.procurement_import_runs(id,org_id,identity_version) values ('{RUN1}','{ORG}',2),('{RUN2}','{ORG}',2);
    """)
    for mode in ("app", "service"):
        race(mode, mode + '-equal', mode + '-equal', 10, True)
        race(mode, mode + '-different', mode + '-different', 20, True)
        race(mode, mode + '-left', mode + '-right', 20, False)
finally:
    run(f"delete from public.procurements where id='{CASE}'; delete from public.procurement_import_runs where id in ('{RUN1}','{RUN2}'); delete from public.profiles where id='{USER}'; delete from auth.users where id='{USER}'; delete from public.organizations where id='{ORG}';", check=False)
