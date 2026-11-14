// AC-ROP-024: run explicitly with the local ERPNext and local served functions under both locks.
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';

const required = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Real ERP acceptance requires ${key}`);
  return value;
};
const env = {
  url: required('SUPABASE_URL'), anon: required('SUPABASE_ANON_KEY'), service: required('SUPABASE_SERVICE_ROLE_KEY'),
  bench: required('ERPNEXT_BENCH_URL'), key: required('ERPNEXT_BENCH_API_KEY'), secret: required('ERPNEXT_BENCH_API_SECRET'),
  site: required('ERPNEXT_SITE_URL'), db: required('PMO_DATABASE_URL'),
  company: required('ERPNEXT_BENCH_COMPANY'), supplier: required('ERPNEXT_BENCH_SUPPLIER'), item: required('ERPNEXT_BENCH_ITEM'),
  cash: required('ERPNEXT_BENCH_CASH'), payable: required('ERPNEXT_BENCH_PAYABLE'), secretRef: required('ERPNEXT_BENCH_SECRET_REF'),
};
for (const address of [env.url, env.bench, env.db]) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(address).hostname)) throw new Error('Real ERP acceptance requires local services');
}
const consumedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const body = await response.arrayBuffer();
  return new Response(response.status === 204 ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
};
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: consumedFetch } };
const admin = createClient(env.url, env.service, clientOptions);
async function sql(code: string): Promise<string> {
  const process = new Deno.Command('psql', { args: [env.db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const writer = process.stdin.getWriter(); await writer.write(new TextEncoder().encode(code)); await writer.close();
  const result = await process.output();
  if (!result.success) throw new Error(`local fixture SQL failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}
async function erp(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${env.bench}${path}`, { method, headers: { authorization: `token ${env.key}:${env.secret}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  if (!response.ok) throw new Error(`ERP ${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text); return parsed.data ?? parsed.message ?? parsed;
}
const docPath = (type: string, name: string) => `/api/resource/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
async function count(type: string): Promise<number> {
  const query = new URLSearchParams({ doctype: type, filters: JSON.stringify({ docstatus: 1 }) });
  return Number(await erp('GET', `/api/method/frappe.client.get_count?${query}`));
}
async function counts(label: string) {
  const result = { invoices: await count('Purchase Invoice'), orders: await count('Purchase Order'), payments: await count('Payment Entry') };
  console.log(`${label}: ${JSON.stringify(result)}`); return result;
}
function check<T>(result: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

Deno.test('AC-ROP-024 real ERP captured payments reject stale balances and settle once', async () => {
  const version = await erp('GET', '/api/method/frappe.utils.change_log.get_versions');
  console.log(`ERPNext version: ${JSON.stringify(version.erpnext)}`);
  const created: Array<{ type: string; name: string }> = [];
  const fixtures: Array<{ org: string; user: string }> = [];
  const today = new Date().toISOString().slice(0, 10);
  async function makeFixture(): Promise<{ invoice: string; purchase: string; doc: string; org: string; token: string; project: string }> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const projectName = String((await erp('POST', '/api/resource/Project', { project_name: `Capture payment ${suffix}`, company: env.company })).name);
    created.push({ type: 'Project', name: projectName });
    const order = String((await erp('POST', '/api/resource/Purchase%20Order', { supplier: env.supplier, company: env.company, transaction_date: today, schedule_date: today, items: [{ item_code: env.item, qty: 1, rate: 100, schedule_date: today, project: projectName }] })).name);
    created.push({ type: 'Purchase Order', name: order });
    await erp('PUT', docPath('Purchase Order', order), { docstatus: 1 });
    const orderDoc = await erp('GET', docPath('Purchase Order', order));
    const orderItem = (orderDoc.items as Array<{ name: string }>)[0].name;
    const invoice = String((await erp('POST', '/api/resource/Purchase%20Invoice', { supplier: env.supplier, company: env.company, posting_date: today, bill_no: `capture-${suffix}`, items: [{ item_code: env.item, qty: 1, rate: 100, project: projectName, purchase_order: order, po_detail: orderItem }] })).name);
    created.push({ type: 'Purchase Invoice', name: invoice });
    await erp('PUT', docPath('Purchase Invoice', invoice), { docstatus: 1 });
    const invoiceDoc = await erp('GET', docPath('Purchase Invoice', invoice));
    assertEquals(Number(invoiceDoc.outstanding_amount), 100);
    const items = invoiceDoc.items as Array<{ expense_account: string }>;
    const expense = items[0].expense_account;
    const glQuery = new URLSearchParams({ filters: JSON.stringify({ voucher_type: 'Purchase Invoice', voucher_no: invoice, account: expense, is_cancelled: 0 }), fields: JSON.stringify(['debit', 'credit']), limit_page_length: '100' });
    const gl = await erp('GET', `/api/resource/GL%20Entry?${glQuery}`) as unknown as Array<{ debit: number; credit: number }>;
    assertEquals(gl.reduce((sum, entry) => sum + Number(entry.debit) - Number(entry.credit), 0), 100);
    const userResult = await admin.auth.admin.createUser({ email: `capture-${suffix}@example.test`, password: `Test-${suffix}-Aa1!`, email_confirm: true });
    if (userResult.error) throw new Error(userResult.error.message);
    const user = userResult.data.user;
    const replacements: Record<string, string> = {};
    for (const tail of ['001', '003', '004', '005', '008', '010', '011', '012', '013']) replacements[`21950111-0000-0000-0000-000000000${tail}`] = crypto.randomUUID();
    replacements['21950111-0000-0000-0000-000000000002'] = user.id;
    const org = replacements['21950111-0000-0000-0000-000000000001'];
    const project = replacements['21950111-0000-0000-0000-000000000003'];
    fixtures.push({ org, user: user.id });
    let fixture = (await Deno.readTextFile('supabase/tests/2195_capture_continue_ledger.test.sql')).split('-- Cancelled capture holds')[0].split('set local request.jwt.claims = \'{"role":"service_role"}\';\ncreate function pg_temp.pay')[0];
    fixture = fixture.replace(/^select plan\(\d+\);/m, '').replace(/^insert into auth\.users .*;\n/m, '');
    fixture = fixture.replace(/^insert into profiles .*;$/m, `insert into profiles(id,org_id,full_name,email,role,status) values ('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000001','Capture admin','capture-${suffix}@example.test','Admin','active') on conflict(id) do update set org_id=excluded.org_id,role='Admin',status='active';`);
    fixture = fixture.replace(/^select is\(pg_temp\.capture_family\(false\).*;$/m, 'select pg_temp.capture_family(false);');
    fixture = fixture.replace(/^select (?:is|isnt|ok|throws_ok|lives_ok)\(.*;\n/gm, '');
    fixture += 'commit;';
    for (const [from, to] of Object.entries(replacements)) fixture = fixture.replaceAll(from, to);
    fixture = fixture.replaceAll('https://example.test', env.site).replaceAll('test-ref', env.secretRef)
      .replaceAll('Example', env.company).replaceAll('PROJECT', projectName).replaceAll('Supplier:SUP-1', `Supplier:${env.supplier}`)
      .replaceAll('SUP-1', env.supplier).replaceAll('ORDER-1', order).replaceAll('INVOICE-1', invoice).replaceAll('Cost', expense)
      .replaceAll("'USD'", "'IDR'").replaceAll('"USD"', '"IDR"');
    await sql(fixture);
    check(await admin.from('external_domain_ownership').upsert({ org_id: org, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' }));
    check(await admin.from('external_org_bindings').update({ config: { company: env.company, project_map: { [project]: projectName }, default_cash_account: env.cash, default_payable_account: env.payable } }).eq('org_id', org));
    const capture = check(await admin.from('erp_purchase_captures').select('procurement_id').eq('org_id', org).eq('kind', 'supplier_invoice').single()) as { procurement_id: string };
    const doc = check(await admin.from('erp_purchase_documents').select('id').eq('org_id', org).eq('erp_name', invoice).single()) as { id: string };
    const auth = createClient(env.url, env.anon, clientOptions);
    const signed = await auth.auth.signInWithPassword({ email: `capture-${suffix}@example.test`, password: `Test-${suffix}-Aa1!` });
    if (signed.error) throw new Error(signed.error.message);
    const session = signed.data.session;
    return { invoice, purchase: capture.procurement_id, doc: doc.id, org, token: session.access_token, project };
  }
  async function dispatch(f: Awaited<ReturnType<typeof makeFixture>>, amount: number, id: string) {
    const response = await fetch(`${env.url}/functions/v1/adapter-dispatch`, { method: 'POST', headers: { apikey: env.anon, authorization: `Bearer ${f.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'procurement', operation: 'create', idempotencyKey: id, record: { id, procurementId: f.purchase, erp_doc_kind: 'payment', capturedInvoiceDocumentId: f.doc, paid_amount: amount, date: today } }) });
    return { status: response.status, body: await response.text() };
  }
  async function directPayment(f: Awaited<ReturnType<typeof makeFixture>>, amount: number) {
    const name = String((await erp('POST', '/api/resource/Payment%20Entry', { payment_type: 'Pay', party_type: 'Supplier', party: env.supplier, company: env.company, paid_amount: amount, received_amount: amount, paid_from: env.cash, paid_to: env.payable, posting_date: today, reference_date: today, references: [{ reference_doctype: 'Purchase Invoice', reference_name: f.invoice, allocated_amount: amount }] })).name);
    created.push({ type: 'Payment Entry', name }); await erp('PUT', docPath('Payment Entry', name), { docstatus: 1 });
  }
  async function actuals(f: Awaited<ReturnType<typeof makeFixture>>) {
    const rows = check(await admin.from('erp_actuals_snapshot').select('net').eq('org_id', f.org).eq('project_id', f.project));
    return rows.reduce((n, row) => n + Number(row.net), 0);
  }
  let start: Awaited<ReturnType<typeof counts>> | undefined;
  try {
    start = await counts('baseline');
    const stale = await makeFixture(); await counts('stale invoice captured');
    const actualBefore = await actuals(stale); assertEquals(actualBefore, 100);
    await directPayment(stale, 80);
    assertEquals(Number((await erp('GET', docPath('Purchase Invoice', stale.invoice))).outstanding_amount), 20);
    assertEquals(Number((check(await admin.from('erp_purchase_documents').select('outstanding_amount').eq('id', stale.doc).single()) as { outstanding_amount: number }).outstanding_amount), 100);
    const beforeReject = await counts('direct payment submitted');
    const intent = crypto.randomUUID(); const rejected = await dispatch(stale, 50, intent);
    assert(rejected.status >= 400, rejected.body); assert(rejected.body.includes('captured_invoice_payment_rejected'), rejected.body);
    const draftQuery = new URLSearchParams({ filters: JSON.stringify([['reference_no', 'like', `%${intent}%`]]), fields: JSON.stringify(['name', 'docstatus']) });
    const drafts = await erp('GET', `/api/resource/Payment%20Entry?${draftQuery}`) as unknown as Array<{ name: string; docstatus: number }>;
    for (const draft of drafts) if (draft.docstatus === 0) created.push({ type: 'Payment Entry', name: draft.name });
    const row = check(await admin.from('external_command_outbox').select('state,attempt_count,last_error').eq('idempotency_key', intent).single()) as { state: string; attempt_count: number; last_error: string };
    assertEquals(row.state, 'failed'); assertEquals(row.attempt_count, Number(await sql('select public.outbox_max_auto_attempts();'))); assertEquals(row.last_error, 'captured_invoice_payment_rejected');
    const rejectedMirror = await admin.from('payments').select('id').eq('id', intent).maybeSingle();
    if (rejectedMirror.error) throw new Error(rejectedMirror.error.message);
    assertEquals(rejectedMirror.data, null);
    const afterReject = await counts('stale allocation refused'); assertEquals(afterReject.payments, beforeReject.payments);
    assertEquals(await actuals(stale), actualBefore);
    assertEquals((check(await admin.from('procurements').select('status').eq('id', stale.purchase).single()) as { status: string }).status, 'Vendor Invoiced');
    const good = await makeFixture(); await counts('second invoice captured');
    const one = crypto.randomUUID(); const partial = await dispatch(good, 25, one); assertEquals(partial.status, 200, partial.body);
    const partialBody = JSON.parse(partial.body); created.push({ type: 'Payment Entry', name: partialBody.externalRecordId });
    const afterPartial = await counts('partial payment submitted'); assertEquals(afterPartial.payments, afterReject.payments + 1);
    assertEquals(Number((await erp('GET', docPath('Purchase Invoice', good.invoice))).outstanding_amount), 75);
    assertEquals((check(await admin.from('procurements').select('status').eq('id', good.purchase).single()) as { status: string }).status, 'Vendor Invoiced');
    await dispatch(good, 25, one); assertEquals((await counts('partial intent replay')).payments, afterPartial.payments);
    const two = crypto.randomUUID(); const full = await dispatch(good, 75, two); assertEquals(full.status, 200, full.body);
    const fullBody = JSON.parse(full.body); created.push({ type: 'Payment Entry', name: fullBody.externalRecordId });
    const afterFull = await counts('final payment submitted'); assertEquals(afterFull.payments, afterPartial.payments + 1);
    assertEquals(Number((await erp('GET', docPath('Purchase Invoice', good.invoice))).outstanding_amount), 0);
    assertEquals((check(await admin.from('procurements').select('status').eq('id', good.purchase).single()) as { status: string }).status, 'Vendor Invoiced');
    check(await admin.from('erp_purchase_documents').update({ outstanding_amount: 0 }).eq('id', good.doc));
    assertEquals((check(await admin.from('procurements').select('status').eq('id', good.purchase).single()) as { status: string }).status, 'Paid');
    await dispatch(good, 75, two); assertEquals((await counts('final intent replay')).payments, afterFull.payments);
    assertEquals(await actuals(good), 100); assertEquals(afterFull.invoices, start.invoices + 2); assertEquals(afterFull.orders, start.orders + 2);
  } finally {
    const cleanupErrors: string[] = [];
    for (const record of [...created].reverse()) {
      try {
        const doc = await erp('GET', docPath(record.type, record.name));
        if (Number(doc.docstatus) === 1) await erp('PUT', docPath(record.type, record.name), { docstatus: 2 });
        else if (Number(doc.docstatus) === 0 && record.type !== 'Project') await erp('DELETE', docPath(record.type, record.name));
      } catch (e) { cleanupErrors.push(`${record.type}: ${String(e)}`); }
    }
    for (const f of fixtures) await admin.auth.admin.deleteUser(f.user);
    const cleaned = await counts('after cleanup');
    if (start) assertEquals(cleaned, start);
    assertEquals(cleanupErrors, []);
    console.log('Synthetic submitted ERP documents cancelled; accounting tombstones and their projects remain.');
  }
});
