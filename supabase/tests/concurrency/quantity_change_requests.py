"""Two-session arbitration of the quantity change request limit (AC-QCR-007, DB lock required).

With a limit of 1 and two people raising on the SAME work order at the same moment, exactly one request may exist: the
count check and the insert run under the work order's row lock (qcr_raise). The first session raises and holds its
transaction open for two seconds, so the second overlaps it; the second must wait for the lock and then be refused by the
limit. Remove the `for update` from qcr_raise and both succeed - this script then fails.
"""
import subprocess
import time

BASE = ["docker", "exec", "-i", "supabase_db_pmo-portal", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
ORG = "25780000-0000-0000-0000-0000000007a1"
U1 = "25780000-0000-0000-0000-0000000007b1"
U2 = "25780000-0000-0000-0000-0000000007b2"
PROJ = "25780000-0000-0000-0000-0000000007c1"
WO = "25780000-0000-0000-0000-0000000007e1"
I1 = "25780000-0000-0000-0000-0000000007f1"
I2 = "25780000-0000-0000-0000-0000000007f2"
ENTRY = "25780000-0000-0000-0000-0000000007d1"


def run(sql, check=True):
    result = subprocess.run(BASE, input=sql, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def raise_sql(user, item, request_id):
    return (f"set role authenticated; set request.jwt.claims = '{{\"sub\":\"{user}\",\"role\":\"authenticated\"}}'; "
            f"select public.qcr_raise('{WO}', '{request_id}', '[{{\"boq_item_id\":\"{item}\",\"requested_quantity\":150,\"reason\":\"race\"}}]'::jsonb);")


def cleanup():
    run(f"""
      delete from public.quantity_change_request_lines where org_id = '{ORG}';
      delete from public.quantity_change_requests where org_id = '{ORG}';
      delete from public.quantity_overrun_notices where org_id = '{ORG}';
      delete from public.notifications where org_id = '{ORG}';
      delete from public.progress_assessment_quantities where org_id = '{ORG}';
      delete from public.project_progress_entries where org_id = '{ORG}';
      delete from public.work_order_lines where org_id = '{ORG}';
      delete from public.boq_items where org_id = '{ORG}';
      delete from public.work_orders where org_id = '{ORG}';
      delete from public.projects where org_id = '{ORG}';
      delete from public.audit_events where org_id = '{ORG}';
      delete from public.profiles where org_id = '{ORG}';
      delete from auth.users where id in ('{U1}','{U2}');
      delete from public.organizations where id = '{ORG}';
    """, check=False)


try:
    cleanup()
    run(f"""
      insert into public.organizations(id, name, quantity_change_limit) values ('{ORG}', 'QCR race org', 1);
      insert into auth.users(id, email) values ('{U1}', 'qcr-race-1@example.invalid'), ('{U2}', 'qcr-race-2@example.invalid');
      insert into public.profiles(id, org_id, full_name, email, role) values
        ('{U1}', '{ORG}', 'Race PM 1', 'qcr-race-1@example.invalid', 'Project Manager'),
        ('{U2}', '{ORG}', 'Race PM 2', 'qcr-race-2@example.invalid', 'Project Manager');
      insert into public.projects(id, org_id, name, status, currency, project_manager_id) values ('{PROJ}', '{ORG}', 'Race project', 'Ongoing Project', 'USD', '{U1}');
      insert into public.work_orders(id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount)
        values ('{WO}', '{ORG}', '{PROJ}', 'Race WO', 'Issued', 1000, 'exclusive', 0);
      insert into public.boq_items(id, org_id, project_id, item_code, description, unit, quantity, rate) values
        ('{I1}', '{ORG}', '{PROJ}', 'R1', 'Race line one', 'm', 100, 10), ('{I2}', '{ORG}', '{PROJ}', 'R2', 'Race line two', 'm', 100, 10);
      insert into public.work_order_lines(org_id, work_order_id, boq_item_id, quantity) values ('{ORG}', '{WO}', '{I1}', 100), ('{ORG}', '{WO}', '{I2}', 100);
      insert into public.project_progress_entries(id, org_id, project_id, month, pct_complete) values ('{ENTRY}', '{ORG}', '{PROJ}', '2026-02-01', 50);
      insert into public.progress_assessment_quantities(org_id, entry_id, boq_item_id, quantity_to_date) values
        ('{ORG}', '{ENTRY}', '{I1}', 120), ('{ORG}', '{ENTRY}', '{I2}', 120);
    """)
    first = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("begin; " + raise_sql(U1, I1, "25780000-0000-0000-0000-0000000007aa") + " select pg_sleep(2); commit;\n")
    first.stdin.close()
    time.sleep(0.5)
    second = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    started = time.monotonic()
    out2, err2 = second.communicate("begin; " + raise_sql(U2, I2, "25780000-0000-0000-0000-0000000007bb") + " commit;\n", timeout=20)
    waited = time.monotonic() - started
    out1 = first.stdout.read()
    err1 = first.stderr.read()
    rc1 = first.wait(timeout=20)
    assert rc1 == 0, (out1, err1)
    assert waited >= 1, f"the second request did not wait for the first (waited {waited:.2f}s): the work order lock is not held"
    assert second.returncode != 0 and "limit is 1" in err2, (out2, err2)
    count = run(f"select count(*) from public.quantity_change_requests where work_order_id = '{WO}';").stdout.strip()
    assert count == "1", f"expected exactly one request, found {count}"
    print(f"AC-QCR-007 ok: one request exists; the second waited {waited:.1f}s and was refused by the limit")
finally:
    cleanup()
