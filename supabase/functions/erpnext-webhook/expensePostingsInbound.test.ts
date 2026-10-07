// AC-EXP-126 [Deno, webhook lane] — FR-EXP-113 / DD-EXP-19 at the webhook ingress: the webhook applies the SAME
// poll scope the sweep does (`pollDiscriminatorForKind`), so a Journal Entry that does not carry a PMO expense key
// in `user_remark` is acked and dropped before any apply — on every org, whatever it employs — and an Employee
// Payment Entry is never routed into the procurement or revenue read models.
//
// Verify: cd supabase/functions/erpnext-webhook && deno test expensePostingsInbound.test.ts --config deno.json --allow-env --allow-net --allow-read

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { handleErpWebhook } = await import('./index.ts');
type ErpWebhookHandlerDeps = Parameters<typeof handleErpWebhook>[1];

const SECRET = 'test-webhook-secret';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY = 'PMO Smoke Co';
const KEY = 'expj:0b7a8c2e-1111-4222-8333-444455556666:1791367200123';

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

async function sign(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** An org employing `ownedDomains`; records every apply (the only write path of the handler). */
function deps(ownedDomains: string[]) {
  const applied: string[] = [];
  const d: ErpWebhookHandlerDeps = {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: SECRET, company: COMPANY, ownedDomains }],
    applyEvent: async (_orgId, event) => {
      applied.push(`${event.kind}:${event.erpName}`);
      return { kind: 'upserted' as const, pmoRecordId: 'pmo-1', adopted: false };
    },
  } as ErpWebhookHandlerDeps;
  return { d, applied };
}

async function post(payload: unknown, d: ErpWebhookHandlerDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = JSON.stringify(payload);
  const res = await handleErpWebhook(new Request('https://erpnext-webhook.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'X-Frappe-Webhook-Signature': await sign(body) },
    body,
  }), d);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const journal = (userRemark: string | null) => ({
  doctype: 'Journal Entry', name: 'ACC-JV-2026-00099', docstatus: 1, modified: '2026-10-08 10:00:00.000000',
  doc: { name: 'ACC-JV-2026-00099', docstatus: 1, company: COMPANY, ...(userRemark === null ? {} : { user_remark: userRemark }) },
});

const employeeReceipt = {
  doctype: 'Payment Entry', name: 'ACC-PAY-2026-00077', docstatus: 1, modified: '2026-10-08 10:00:00.000000',
  doc: { name: 'ACC-PAY-2026-00077', docstatus: 1, company: COMPANY, payment_type: 'Receive', party_type: 'Employee', party: 'HR-EMP-00001', paid_amount: 100 },
};

for (const owned of [['revenue'], ['procurement'], ['revenue', 'procurement', 'companies', 'expenses']]) {
  Deno.test(`AC-EXP-126 a native Journal Entry (no PMO key) is acked and never applied — org owning ${owned.join('+')}`, async () => {
    for (const remark of ['Payroll accrual October', null, 'expj:not-a-key']) {
      const { d, applied } = deps(owned);
      const res = await post(journal(remark), d);
      assertEquals(res.status, 200, JSON.stringify(res.body));
      assertEquals(typeof res.body.skipped, 'string', JSON.stringify(res.body));
      assertEquals(applied, [], `remark ${remark}`);
    }
  });
}

Deno.test('AC-EXP-126 a revenue-only org never applies an Employee cash return as a customer receipt', async () => {
  const { d, applied } = deps(['revenue', 'companies']);
  const res = await post(employeeReceipt, d);
  assertEquals(res.status, 200, JSON.stringify(res.body));
  assertEquals(applied, []);
});

Deno.test('AC-EXP-126 an org employing expenses applies a PMO-keyed Journal Entry and an Employee Payment Entry (lifecycle mirror)', async () => {
  const { d, applied } = deps(['expenses']);
  assertEquals((await post(journal(KEY), d)).status, 200);
  assertEquals((await post(employeeReceipt, d)).status, 200);
  assertEquals(applied, ['expense-journal:ACC-JV-2026-00099', 'expense-receipt:ACC-PAY-2026-00077']);
});

Deno.test('AC-EXP-126 a Customer receipt still reaches the revenue apply unchanged', async () => {
  const { d, applied } = deps(['revenue']);
  await post({ ...employeeReceipt, doc: { ...employeeReceipt.doc, party_type: 'Customer', party: 'CUST-1' } }, d);
  assertEquals(applied, ['incoming-payment:ACC-PAY-2026-00077']);
});

// A Payment Entry without party_type is not adopted (its party type decides its domain): acked, skipped, and the
// org's Admin/Finance are told the webhook configuration omits the field — the same escalation as a missing company.
const unstatedParty = (paymentType: 'Pay' | 'Receive') => {
  const { party_type: _omitted, ...doc } = { ...employeeReceipt.doc, payment_type: paymentType, party: 'P-1' };
  return { ...employeeReceipt, doc };
};

for (const [owned, paymentType, kind] of [
  [['revenue', 'companies'], 'Receive', 'incoming-payment'],
  [['procurement', 'companies'], 'Pay', 'payment'],
] as const) {
  Deno.test(`AC-EXP-126 a ${paymentType} Payment Entry without party_type is skipped and surfaced — org owning ${owned.join('+')}`, async () => {
    const { d, applied } = deps([...owned]);
    const alerts: Array<[string, string | undefined, string]> = [];
    d.onScopeFieldMissing = async (orgId, event, field) => { alerts.push([orgId, event.kind, field]); };
    const res = await post(unstatedParty(paymentType), d);
    assertEquals(res.status, 200, JSON.stringify(res.body));
    assertEquals(res.body.skipped, 'not-in-poll-scope');
    assertEquals(applied, []);
    assertEquals(alerts, [[ORG_ID, kind, 'party_type']]);
  });
}

Deno.test('AC-EXP-126 a Payment Entry without party_type for a domain the org does not own is skipped silently', async () => {
  const { d, applied } = deps(['procurement', 'companies']);
  const alerts: string[] = [];
  d.onScopeFieldMissing = async (_orgId, _event, field) => { alerts.push(field); };
  const res = await post(unstatedParty('Receive'), d);
  assertEquals(res.status, 200, JSON.stringify(res.body));
  assertEquals([applied, alerts], [[], []]);
});

Deno.test('AC-EXP-126 an Employee Payment Entry on a revenue-only org is skipped without an alert (party type stated)', async () => {
  const { d } = deps(['revenue', 'companies']);
  const alerts: string[] = [];
  d.onScopeFieldMissing = async (_orgId, _event, field) => { alerts.push(field); };
  await post(employeeReceipt, d);
  assertEquals(alerts, []);
});
