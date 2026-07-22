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
const { handleErpWebhook, buildIsInFlightAdopt } = await import('./index.ts');
type ErpWebhookHandlerDeps = Parameters<typeof handleErpWebhook>[1];
import type { SupabaseClient } from '@supabase/supabase-js';

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

// AC-TSP-040 (FR-TSP-082 / FR-BUD-140) — a CLASSIFIED never-adopt refusal is an ACK, not a 500.
// Frappe RETRIES a failed webhook, so one Desk-created Timesheet answering 500 becomes a permanent
// retry storm against the client's own ERP — and reads as an outage rather than as the deliberate
// never-adopt rule. This is the SAME posture the sweep already takes for this exact class
// (`erpFeedApplyErrorPolicy` ⇒ 'skip'); the ingress must not fork it.
Deno.test('AC-TSP-040: a never-adopt refusal (native-timesheet-not-adopted) ⇒ 200 ACK, never a retry-storming 500', async () => {
  const d = deps(async () => {
    const e = new Error('native-timesheet-not-adopted') as Error & { code?: string };
    e.code = 'commit-rejected';
    throw e;
  });
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), d);
  assert(res.status === 200, `a classified never-adopt refusal must ACK, got ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; skipped?: string };
  assert(body.ok === true, 'expected { ok: true }');
  assert(body.skipped === 'native-timesheet-not-adopted', `expected the classified reason, got ${body.skipped}`);
});

Deno.test('AC-TSP-040: a Desk-created Budget (native-budget-not-adopted) ⇒ 200 ACK too — same classified class', async () => {
  const d = deps(async () => { throw new Error('native-budget-not-adopted'); });
  const validSig = await sign(PI_EVENT);
  const res = await handleErpWebhook(req(PI_EVENT, validSig), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// FIX 1 (round-9 cross-family SHOULD-FIX) — the webhook must NOT adopt a doc a still-in-flight
// PMO-originated command owns. The race: dispatch POSTs a Sales Invoice (outbox `committing`); ERP
// commits and fires the webhook immediately; the webhook's claim-first adopt records `external_refs`
// (a fresh UUID ← ERP name) BEFORE the dispatch's fenced `record_outbox_ref` (R ← ERP name). The outbox
// insert then hard-fails 23505 on the `external_refs (org,domain,external_record_id)` unique (0093) — a
// DIFFERENT constraint than its on-conflict target — so it is NOT caught, stranding the outbox row at
// `committed` and leaving a phantom mirror under a random UUID; the user's real SI is unlinked.
//
// The fix mirrors the sweep's B5 barrier on the webhook: refuse to adopt any doc whose anchor field
// carries the idempotency key of an UNRESOLVED (in-flight, non-confirmed) outbox row — let the
// dispatch/sweep own finalization. Once the dispatch confirms, its row is `confirmed` (not an IN_FLIGHT
// state), so the probe returns false and a legitimately-later webhook flows through the normal path.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const INFLIGHT_KEY = '5f7d2b1e-0c3a-4a9e-9f10-2b6c8d4e1a77';

/** A Sales Invoice event whose `remarks` anchor carries `key` (the ADR-0058 §3 stamp). */
function siEventWithRemarks(key: string, name = 'ACC-SINV-2026-00099'): string {
  const doc = { name, docstatus: 1, grand_total: '125000.00', outstanding_amount: '125000.00', company: COMPANY, remarks: `Invoice for ACME — ${key}` };
  return JSON.stringify({ doctype: 'Sales Invoice', name, docstatus: 1, amended_from: null, modified: '2026-07-20 09:00:00.000000', doc });
}

/** A fake `external_command_outbox` that really applies the probe's filters (org + in-flight states +
 *  idempotency_key set), so `buildIsInFlightAdopt` runs its REAL query against seeded rows. */
function fakeOutboxClient(rows: Array<{ org_id: string; state: string; idempotency_key: string }>) {
  const client = {
    from: () => {
      let filtered = rows;
      const builder = {
        eq: (col: string, val: string) => { filtered = filtered.filter((r) => (r as unknown as Record<string, string>)[col] === val); return builder; },
        in: (col: string, vals: readonly string[]) => { filtered = filtered.filter((r) => vals.includes((r as unknown as Record<string, string>)[col])); return builder; },
        then: (resolve: (v: unknown) => void) => resolve({ data: filtered.map((r) => ({ idempotency_key: r.idempotency_key })), error: null }),
      };
      return { select: () => builder };
    },
  } as unknown as SupabaseClient;
  return client;
}

/** deps whose `isInFlightAdopt` is the REAL wiring (`buildIsInFlightAdopt`) over a seeded outbox. */
function depsWithOutbox(rows: Array<{ org_id: string; state: string; idempotency_key: string }>): ErpWebhookHandlerDeps & { _applied: () => number } {
  let applied = 0;
  return {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: SECRET, company: COMPANY, ownedDomains: ['procurement', 'revenue', 'companies'] }],
    applyEvent: async () => { applied += 1; return { kind: 'upserted' as const, pmoRecordId: 'pmo-1', adopted: false }; },
    isInFlightAdopt: buildIsInFlightAdopt(fakeOutboxClient(rows)),
    _applied: () => applied,
  } as unknown as ErpWebhookHandlerDeps & { _applied: () => number };
}

Deno.test('FIX 1: a Sales Invoice a still-COMMITTING dispatch owns is NOT adopted (no phantom mirror/ref — dispatch keeps its one row)', async () => {
  const d = depsWithOutbox([{ org_id: ORG_ID, state: 'committing', idempotency_key: INFLIGHT_KEY }]);
  const event = siEventWithRemarks(INFLIGHT_KEY);
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected a 200 ack (the dispatch/sweep owns this doc), got ${res.status}`);
  assert(d._applied() === 0, 'applyEvent must NOT run — adopting mints a phantom mirror + wedges record_outbox_ref on the extid unique');
  const body = await res.json();
  assert(body.skipped === 'in-flight-command-owns-doc', `expected an explicit in-flight skip, got ${JSON.stringify(body)}`);
});

Deno.test('FIX 1: every UNRESOLVED outbox state guards the webhook (committed/quarantined/held too)', async () => {
  for (const state of ['pending', 'committing', 'committed', 'quarantined', 'held']) {
    const d = depsWithOutbox([{ org_id: ORG_ID, state, idempotency_key: INFLIGHT_KEY }]);
    const event = siEventWithRemarks(INFLIGHT_KEY);
    const res = await handleErpWebhook(req(event, await sign(event)), d);
    assert(d._applied() === 0, `a '${state}' outbox row's doc may exist unmapped — the webhook must not adopt it`);
    assert((await res.json()).skipped === 'in-flight-command-owns-doc', `expected in-flight skip for state '${state}'`);
  }
});

Deno.test('FIX 1: once the dispatch CONFIRMS (outbox confirmed), the SAME webhook flows through normally (legitimate later delivery is not blocked)', async () => {
  const d = depsWithOutbox([{ org_id: ORG_ID, state: 'confirmed', idempotency_key: INFLIGHT_KEY }]);
  const event = siEventWithRemarks(INFLIGHT_KEY);
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(d._applied() === 1, 'a confirmed dispatch has its external_refs mapping — the webhook resolves+updates, never blocked');
});

Deno.test('FIX 1: a NATIVE Sales Invoice (no stamped key in remarks) is still adopted normally', async () => {
  const d = depsWithOutbox([{ org_id: ORG_ID, state: 'committing', idempotency_key: INFLIGHT_KEY }]);
  const event = siEventWithRemarks('cash sale — no PMO key here'); // remarks carries no UUID
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(d._applied() === 1, 'a native ERP invoice must still be adopted (its anchor carries no in-flight key)');
});

Deno.test('FIX 1: ANOTHER org\'s in-flight row never blocks this org (org scoping preserved)', async () => {
  const d = depsWithOutbox([{ org_id: 'some-other-org', state: 'committing', idempotency_key: INFLIGHT_KEY }]);
  const event = siEventWithRemarks(INFLIGHT_KEY);
  const res = await handleErpWebhook(req(event, await sign(event)), d);
  assert(d._applied() === 1, 'the in-flight guard is org-scoped — a foreign org\'s command must not block adoption here');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AC-TSP-042 / FR-TSP-081 (P3b slice 6.5) — the trust boundary for the NEW kinds.
//
// `Timesheet` and `Employee` reached the public webhook surface in P3b. The HMAC gate is generic (it
// runs before any doctype routing), so the claim is that they inherit it — but "no code change was
// needed" is exactly the kind of assumption that is only true until someone reorders the handler, and
// these two kinds are the ones where being wrong is worst: `Employee` is the identity master the
// timesheet push resolves people through, and an unsigned write to it is an identity-spoofing surface.
// So it is PROVEN per kind, not assumed from the shape of the code.
//
// ⚑ `timesheets` must be in `ownedDomains` here: KIND_DOMAIN maps BOTH kinds to the `timesheets`
// domain (feedKinds.ts), and the domain-ownership gate would otherwise skip them for a reason that has
// nothing to do with the signature — a green test proving nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** An org that has handed the `timesheets` domain (both new kinds' domain) to the ERPNext tier. */
function timesheetDeps(): ErpWebhookHandlerDeps & { _applied: () => number; _events: () => unknown[] } {
  let applied = 0;
  const events: unknown[] = [];
  return {
    resolveEmployingOrgs: async () => [{ orgId: ORG_ID, webhookSecret: SECRET, company: COMPANY, ownedDomains: ['timesheets'] }],
    applyEvent: async (_orgId: string, event: unknown) => {
      applied += 1;
      events.push(event);
      return { kind: 'upserted' as const, pmoRecordId: 'pmo-1', adopted: false };
    },
    _applied: () => applied,
    _events: () => events,
  } as unknown as ErpWebhookHandlerDeps & { _applied: () => number; _events: () => unknown[] };
}

const TIMESHEET_EVENT = JSON.stringify({
  doctype: 'Timesheet',
  name: 'TS-2026-00050',
  docstatus: 1,
  amended_from: null,
  modified: '2026-07-20 09:00:00.000000',
  doc: { name: 'TS-2026-00050', docstatus: 1, total_hours: '40.0', company: COMPANY },
});

const EMPLOYEE_EVENT = JSON.stringify({
  doctype: 'Employee',
  name: 'HR-EMP-00007',
  docstatus: 1,
  amended_from: null,
  modified: '2026-07-20 09:00:00.000000',
  doc: { name: 'HR-EMP-00007', docstatus: 1, employee_name: 'Dana Ops', company_email: 'dana@example.com', company: COMPANY },
});

for (const [label, body] of [['Timesheet', TIMESHEET_EVENT], ['Employee', EMPLOYEE_EVENT]] as const) {
  Deno.test(`AC-TSP-042 an ABSENT signature on a ${label} ⇒ 401 with ZERO side effects`, async () => {
    const d = timesheetDeps();
    const res = await handleErpWebhook(req(body, null), d);
    assert(res.status === 401, `expected 401, got ${res.status}`);
    assert(d._applied() === 0, `FR-TSP-081: an unsigned ${label} must never reach the feed`);
  });

  Deno.test(`AC-TSP-042 an INVALID signature on a ${label} (wrong secret, and a tampered body) ⇒ 401 with ZERO side effects`, async () => {
    const d = timesheetDeps();
    const res = await handleErpWebhook(req(body, 'dGhpcy1pcy1ub3QtdGhlLWNvcnJlY3Qtc2ln'), d);
    assert(res.status === 401, `expected 401, got ${res.status}`);
    // A signature over the ORIGINAL body replayed against a MUTATED one is the real attack: the hours /
    // the employee's work email are exactly what an attacker would want to rewrite in flight.
    const validSig = await sign(body);
    const tampered = body.replace('40.0', '400.0').replace('dana@example.com', 'attacker@example.com');
    const res2 = await handleErpWebhook(req(tampered, validSig), d);
    assert(res2.status === 401, `expected 401 for a tampered ${label} body, got ${res2.status}`);
    assert(d._applied() === 0, `FR-TSP-081: neither a bad signature nor a tampered ${label} body may reach the feed`);
  });

  Deno.test(`AC-TSP-042 a VALID signature on a ${label} routes to the feed as a hint (200, kind resolved)`, async () => {
    const d = timesheetDeps();
    const res = await handleErpWebhook(req(body, await sign(body)), d);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(d._applied() === 1, `a correctly-signed ${label} MUST be routed to applyErpFeedEvent`);
    // Proving it is ROUTED, not merely ack'd: `kindFromDoctype` resolved a real kind + the timesheets
    // domain. An unresolved doctype would have returned 200 `skipped: 'unmapped-doctype'` — a green
    // "it was accepted" assertion over a payload that was silently dropped.
    const event = d._events()[0] as { kind?: string; domain?: string };
    assert(event.kind === (label === 'Timesheet' ? 'timesheet' : 'employee'), `expected the ${label} kind, got '${event.kind}'`);
    assert(event.domain === 'timesheets', `expected the timesheets domain, got '${event.domain}'`);
  });
}
