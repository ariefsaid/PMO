// AC-ENA-070 [Deno unit] — erpnext-webhook/index.ts `handleErpWebhook`: the HMAC trust boundary.
// `X-Frappe-Webhook-Signature` = base64(HMAC-SHA256(secret, raw_body)) is the SOLE trust boundary
// (FR-ENA-082): an absent/invalid signature ⇒ 401 with NO side effect (no applyEvent call); a valid
// signature ⇒ applied as a lossy hint (FR-ENA-083). Also proves: no employing org ⇒ 401; an oversized
// body ⇒ 413 before req.text(); an unmapped doctype ⇒ 200 skipped; a 23505 concurrent-adopt ⇒ 409;
// a generic apply failure ⇒ 500 GENERIC (never leaks the raw error to the public surface).
//
// Deno-native test (plain assertions, no network dependency). The applyEvent + resolveEmployingOrgs
// are injected mocks — the gate + decode + routing are what's under test here. The lineage apply
// itself is unit-proven under applyFeed.test.ts (Vitest).
//
// Verify: cd supabase/functions/erpnext-webhook && deno test index.test.ts

// Stub Deno.serve BEFORE the dynamic import of index.ts (which calls Deno.serve at top level) so the
// import does not bind a real port under `deno test`. ES module imports are hoisted above executable
// code, so a static `import` would run before this stub — a dynamic import after the stub is required
// (the same stance as scripts/deno-boot-smoke.ts). The handler under test is `handleErpWebhook`
// (exported), not the Deno.serve wrapper itself.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { handleErpWebhook } = await import('./index.ts');
type ErpWebhookHandlerDeps = Parameters<typeof handleErpWebhook>[1];

const SECRET = 'test-webhook-secret';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
/** The ERP Company this org's binding names (`external_org_bindings.config.company`). B4: every inbound
 *  company-scoped document must state THIS company or it is not ours to adopt. */
const COMPANY = 'PMO Smoke Co';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Compute the valid X-Frappe-Webhook-Signature for a body (base64 HMAC-SHA256, keyed by SECRET). */
async function sign(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function deps(applyEvent: () => Promise<unknown> = async () => ({ kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false })): ErpWebhookHandlerDeps {
  let applied = 0;
  return {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: SECRET, company: COMPANY, ownedDomains: ['procurement', 'revenue', 'companies'] }],
    applyEvent: async () => { applied += 1; await applyEvent(); return { kind: 'upserted' as const, pmoRecordId: 'pmo-1', adopted: false }; },
    // exposed via closure for the no-side-effect assertion
    _applied: () => applied,
  } as unknown as ErpWebhookHandlerDeps & { _applied: () => number };
}

function req(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['X-Frappe-Webhook-Signature'] = signature;
  headers['Content-Length'] = String(body.length);
  return new Request('https://erpnext-webhook.test', { method: 'POST', headers, body });
}

const PI_EVENT = JSON.stringify({
  doctype: 'Purchase Invoice',
  name: 'ACC-PINV-2026-00002',
  docstatus: 1,
  amended_from: null,
  modified: '2026-07-12 12:00:00.000000',
  doc: { name: 'ACC-PINV-2026-00002', docstatus: 1, grand_total: '50000.00', company: 'PMO Smoke Co' },
});

Deno.test('AC-ENA-070: an ABSENT X-Frappe-Webhook-Signature ⇒ 401 with NO side effect', async () => {
  const d = deps();
  const res = await handleErpWebhook(req(PI_EVENT, null), d);
  assert(res.status === 401, `expected 401, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'applyEvent must NOT be called on a signature-less request');
  const body = (await res.json()) as { error?: string };
  assert(body.error === 'UNAUTHORIZED', `expected UNAUTHORIZED, got ${body.error}`);
});

Deno.test('AC-ENA-070: an INVALID signature (wrong secret / tampered body) ⇒ 401 with NO side effect', async () => {
  const d = deps();
  const res = await handleErpWebhook(req(PI_EVENT, 'dGhpcy1pcy1ub3QtdGhlLWNvcnJlY3Qtc2ln'), d); // bogus base64
  assert(res.status === 401, `expected 401, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'applyEvent must NOT be called on an invalid signature');
  // A signature over a TAMPERED body (valid secret, body changed after signing) is equally rejected.
  const validSig = await sign(PI_EVENT);
  const tamperedReq = req(PI_EVENT.replace('50000.00', '999999.00'), validSig);
  const res2 = await handleErpWebhook(tamperedReq, d);
  assert(res2.status === 401, `expected 401 for a tampered body, got ${res2.status}`);
});

Deno.test('AC-ENA-070: a VALID signature ⇒ applied as a hint (200 + outcome)', async () => {
  const d = deps();
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 1, 'applyEvent MUST be called once on a valid signature');
  const body = (await res.json()) as { ok?: boolean };
  assert(body.ok === true, 'expected { ok: true }');
});

Deno.test('AC-ENA-070: no employing org ⇒ 401 (no secret to match, no side effect)', async () => {
  const emptyDeps: ErpWebhookHandlerDeps = {
    resolveEmployingOrgs: async () => [],
    applyEvent: async () => { throw new Error('applyEvent must not be called when no org employs erpnext'); },
  };
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), emptyDeps);
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

// task FIX-5 (Quality IMPORTANT 2): a DB LOAD failure resolving employing orgs must NOT be
// indistinguishable from "genuinely no employing org" — a 401 there tells Frappe "stop retrying, this
// is a permanent auth failure", but a transient DB outage is retryable. `resolveEmployingOrgs` throwing
// ⇒ 500 (so Frappe's webhook retry policy kicks in), never silently folded into the 401 no-secret-match
// path.
Deno.test('FIX-5: resolveEmployingOrgs THROWING (a DB load error) ⇒ 500, distinct from the 401 no-secret-match path', async () => {
  const throwingDeps: ErpWebhookHandlerDeps = {
    resolveEmployingOrgs: async () => { throw new Error('connection reset'); },
    applyEvent: async () => { throw new Error('applyEvent must not be called when org resolution failed'); },
  };
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), throwingDeps);
  assert(res.status === 500, `expected 500 on a DB load error, got ${res.status}`);
  const body = (await res.json()) as { error?: string };
  assert(body.error !== 'UNAUTHORIZED', 'a DB load error must not present as UNAUTHORIZED (401)');
});

Deno.test('AC-ENA-070: a webhook whose secret does NOT match any employing org ⇒ 401 (no side effect)', async () => {
  const otherSecretDeps: ErpWebhookHandlerDeps = {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: 'a-DIFFERENT-secret', company: COMPANY, ownedDomains: ['procurement', 'revenue', 'companies'] }],
    applyEvent: async () => { throw new Error('applyEvent must not be called on a secret mismatch'); },
  };
  const validSig = await sign(PI_EVENT); // signed with SECRET, not 'a-DIFFERENT-secret'
  const res = await handleErpWebhook(req(PI_EVENT, validSig), otherSecretDeps);
  assert(res.status === 401, `expected 401 on a secret mismatch, got ${res.status}`);
});

Deno.test('AC-ENA-070: an oversized body (>256 KiB Content-Length) ⇒ 413 BEFORE req.text()', async () => {
  const d = deps();
  const huge = 'x'.repeat(262145);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': '262145' };
  const bigReq = new Request('https://erpnext-webhook.test', { method: 'POST', headers, body: huge });
  const res = await handleErpWebhook(bigReq, d);
  assert(res.status === 413, `expected 413, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'applyEvent must NOT be called on an oversized body');
});

Deno.test('M-1: an oversized body with a LYING (small) Content-Length is still capped on the STREAM ⇒ 413', async () => {
  const d = deps();
  const huge = 'x'.repeat(262145); // > 256 KiB
  // Content-Length claims a tiny body (bypasses the header check) — the stream-bounded read must still 413.
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': '10' };
  const sneakyReq = new Request('https://erpnext-webhook.test', { method: 'POST', headers, body: huge });
  const res = await handleErpWebhook(sneakyReq, d);
  assert(res.status === 413, `expected 413 from the stream cap, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'applyEvent must NOT be called on a stream-capped body');
});

Deno.test('M-1: a body just UNDER the cap is read + processed normally (the stream cap is not over-eager)', async () => {
  const d = deps();
  const validSig = await sign(PI_EVENT);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Frappe-Webhook-Signature': validSig };
  // No Content-Length header at all (chunked) — the stream read must still work for an in-bounds body.
  const chunkedReq = new Request('https://erpnext-webhook.test', { method: 'POST', headers, body: PI_EVENT });
  const res = await handleErpWebhook(chunkedReq, d);
  assert(res.status === 200, `expected 200 for an in-bounds chunked body, got ${res.status}`);
});

Deno.test('AC-ENA-070: an unmapped doctype (one P2 does not mirror) ⇒ 200 skipped (lossy hint)', async () => {
  const d = deps();
  const event = JSON.stringify({ doctype: 'Some Other DocType', name: 'X-0001', docstatus: 1, modified: '2026-07-12 12:00:00.000000', doc: {} });
  const validSig = await sign(event);
  const res = await handleErpWebhook(req(event, validSig), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = (await res.json()) as { skipped?: string };
  assert(body.skipped === 'unmapped-doctype', `expected skipped=unmapped-doctype, got ${JSON.stringify(body)}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'applyEvent must NOT be called for an unmapped doctype');
});

Deno.test('AC-ENA-070: a 23505 concurrent-adopt ⇒ 409 (recoverable, not alert-spam)', async () => {
  const d = deps(async () => { const e = new Error('duplicate'); (e as Error & { code?: string }).code = '23505'; throw e; });
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), d);
  assert(res.status === 409, `expected 409, got ${res.status}`);
  const body = (await res.json()) as { error?: string };
  assert(body.error === 'CONCURRENT_ADOPT', `expected CONCURRENT_ADOPT, got ${body.error}`);
});

Deno.test('AC-ENA-070: a generic apply failure ⇒ 500 GENERIC (never leaks the raw error detail)', async () => {
  const d = deps(async () => { throw new Error('internal: column "secret_col" violates NOT NULL on table procurement_invoices'); });
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), d);
  assert(res.status === 500, `expected 500, got ${res.status}`);
  const body = (await res.json()) as { error?: string; message?: string };
  assert(body.error === 'WEBHOOK_APPLY_FAILED', `expected WEBHOOK_APPLY_FAILED, got ${body.error}`);
  assert(!JSON.stringify(body).includes('secret_col'), 'the raw error detail must NOT leak to the public surface');
  assert(body.message === 'the webhook could not be applied', 'the public message must be GENERIC');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Luna BLOCK 9 — inbound adoption must be gated on the org's ACTUAL per-domain ownership. A valid
// HMAC proves WHO sent the event, not that the org opted this DOMAIN into external ownership: a
// procurement-only org was still handed native Sales Invoice / Receive Payment Entry mirrors, which
// then surfaced in its revenue read model as data it never opted into. Fail-CLOSED (an org whose
// owned-domain set is unknown adopts nothing).
// ────────────────────────────────────────────────────────────────────────────────────────────────

const SI_EVENT = JSON.stringify({
  doctype: 'Sales Invoice',
  name: 'ACC-SINV-2026-00003',
  docstatus: 1,
  amended_from: null,
  modified: '2026-07-18 12:00:00.000000',
  doc: { name: 'ACC-SINV-2026-00003', docstatus: 1, grand_total: '125000.00', outstanding_amount: '125000.00', company: 'PMO Smoke Co' },
});

function depsOwning(ownedDomains: string[]): ErpWebhookHandlerDeps & { _applied: () => number } {
  let applied = 0;
  return {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: SECRET, company: COMPANY, ownedDomains }],
    applyEvent: async () => { applied += 1; return { kind: 'upserted' as const, pmoRecordId: 'pmo-1', adopted: false }; },
    _applied: () => applied,
  } as unknown as ErpWebhookHandlerDeps & { _applied: () => number };
}

Deno.test('BLOCK 9: a correctly-signed Sales Invoice for a PROCUREMENT-only org is NOT adopted (no unowned revenue row)', async () => {
  const d = depsOwning(['procurement', 'companies']);
  const res = await handleErpWebhook(req(SI_EVENT, await sign(SI_EVENT)), d);
  assert(res.status === 200, `expected a 200 ack (the event is genuine, just not ours to mirror), got ${res.status}`);
  assert(d._applied() === 0, 'applyEvent must NOT run for a domain the org does not externally own');
  const body = await res.json();
  assert(body.skipped === 'domain-not-owned', `expected an explicit domain-not-owned skip, got ${JSON.stringify(body)}`);
});

Deno.test('BLOCK 9: the SAME Sales Invoice IS adopted once the org owns the revenue domain', async () => {
  const d = depsOwning(['procurement', 'revenue']);
  const res = await handleErpWebhook(req(SI_EVENT, await sign(SI_EVENT)), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(d._applied() === 1, 'expected the event to apply for an org that owns revenue');
});

Deno.test('BLOCK 9: an org with NO owned domains adopts nothing (fail-closed, not fail-open)', async () => {
  const d = depsOwning([]);
  const res = await handleErpWebhook(req(PI_EVENT, await sign(PI_EVENT)), d);
  assert(res.status === 200, `expected a 200 ack, got ${res.status}`);
  assert(d._applied() === 0, 'expected NO apply when the org owns no domain at all');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Round-7 cross-family B4 — MULTI-COMPANY ERP DATA MUST BE SCOPED ON ADOPTION (CROSS-TENANT).
// The binding names one ERP Company (`config.company`) but inbound admission checked only HMAC +
// domain ownership. On an ERP site hosting Company A and Company B, a Company-B Sales Invoice or
// Receive Payment Entry was adopted into Company A's PMO tenant and appeared in its revenue/AR views
// with no error. The gate is `companyScope.admitsDocForBindingCompany` — shared with the sweep so the
// two inbound paths cannot drift.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A Sales Invoice event whose doc states `company`. */
function siEventForCompany(company: string | undefined, name = 'ACC-SINV-2026-00042'): string {
  const doc: Record<string, unknown> = { name, docstatus: 1, grand_total: '99000.00', outstanding_amount: '99000.00' };
  if (company !== undefined) doc.company = company;
  return JSON.stringify({ doctype: 'Sales Invoice', name, docstatus: 1, amended_from: null, modified: '2026-07-20 09:00:00.000000', doc });
}

Deno.test("B4: a correctly-signed Sales Invoice belonging to ANOTHER ERP company is NOT adopted (cross-tenant money)", async () => {
  const d = deps();
  const event = siEventForCompany('Other Tenant Ltd');
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected a 200 ack (genuine event, not ours), got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'applyEvent must NOT run for another company\'s document');
  const body = await res.json();
  assert(body.skipped === 'company-not-in-scope', `expected company-not-in-scope, got ${JSON.stringify(body)}`);
});

Deno.test("B4: the SAME invoice IS adopted when it states this binding's own company", async () => {
  const d = deps();
  const event = siEventForCompany(COMPANY);
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 1, 'expected the own-company invoice to apply');
});

Deno.test('B4: a company-scoped document that states NO company is NOT adopted (fail closed)', async () => {
  const d = deps();
  const event = siEventForCompany(undefined);
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected a 200 ack, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 0, 'a document that does not state its company must not be adopted');
  const body = await res.json();
  assert(body.skipped === 'company-not-in-scope', `expected company-not-in-scope, got ${JSON.stringify(body)}`);
});

Deno.test('B4: a binding with NO configured company adopts no company-scoped document (fail closed)', async () => {
  let applied = 0;
  const d = {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: SECRET, company: null, ownedDomains: ['procurement', 'revenue', 'companies'] }],
    applyEvent: async () => { applied += 1; return { kind: 'upserted' as const, pmoRecordId: 'pmo-1', adopted: false }; },
  } as unknown as ErpWebhookHandlerDeps;
  const event = siEventForCompany(COMPANY);
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected a 200 ack, got ${res.status}`);
  assert(applied === 0, 'an unconfigured binding company can scope nothing ⇒ adopt nothing');
});

Deno.test('B4: a GLOBAL master (Customer) is still adopted — it carries no company dimension', async () => {
  const d = deps();
  const event = JSON.stringify({
    doctype: 'Customer', name: 'Acme Corp', docstatus: 0, modified: '2026-07-20 09:00:00.000000',
    doc: { name: 'Acme Corp', customer_name: 'Acme Corp' },
  });
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((d as unknown as { _applied: () => number })._applied() === 1, 'a Customer master must still be adopted (no company field exists on it)');
});
