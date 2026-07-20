/**
 * erpnext-webhook — Deno Edge Function entry point (task 8.2, AC-ENA-070, FR-ENA-082/083).
 *
 * The public, unauthenticated ERPNext webhook ingress. The `X-Frappe-Webhook-Signature`
 * (base64(HMAC-SHA256(secret, raw_body))) is the SOLE trust boundary (FR-ENA-082, NFR-ENA-SEC-002,
 * STRIDE spoofing/tampering): an absent/invalid signature ⇒ 401 with NO side effect, before any
 * read-model apply. `verify_jwt = false` (supabase/config.toml) — the HMAC replaces the JWT gate.
 *
 * The org is resolved by the SECRET that validates: the handler iterates employing orgs (each org's
 * `external_org_bindings.webhook_secret_ref` → a resolved function-secret env), recomputes the HMAC
 * with each, and the first constant-time match identifies the org. A webhook with no matching secret
 * is rejected 401 (no side effect). P2 is single-tenant (one employing org) ⇒ one HMAC compute/event.
 *
 * Lossy hint semantics (FR-ENA-083): a verified event is applied through the lineage-aware feed
 * (`applyErpFeedEvent`, 8.5) as a HINT — the modified-poll sweep (`erpnext-sweep`, 8.6) is the
 * convergence authority. An unmapped doctype (one P2 does not mirror) is ack'd-and-skipped. A 23505
 * from a concurrent adopt surfaces 409 (recoverable, not alert-spam). A 5xx carries a GENERIC message.
 *
 * Thin wiring ONLY — the HMAC gate, the decode, and the lineage apply are unit-proven under
 * `index.test.ts` (this file's `handleErpWebhook` core) + `applyFeed.test.ts`. This Deno.serve wrapper
 * is INTEGRATION-ONLY — verified by `deno check` + the boot-smoke (same contract as clickup-webhook).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyErpWebhookSignature } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/webhookSignature.ts';
import { decodeErpWebhookEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/webhookEvent.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import { admitsDocForBindingCompany } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/companyScope.ts';
import { createErpFeedDeps, ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import { createInFlightAnchorProbe } from '../_shared/inFlightAnchorProbe.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import type { ErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/webhookEvent.ts';
import type { ApplyOutcome } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

// 256 KiB body cap: reject an oversized payload so a huge body can't exhaust the isolate (mirrors
// clickup-webhook's review fix #7b).
const MAX_WEBHOOK_BODY_BYTES = 262144;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Read the request body with a HARD byte cap enforced on the STREAM (M-1 audit fix). The old
 * Content-Length-only check was bypassable: a chunked request (no/short/lying `Content-Length`) let
 * `req.text()` buffer an unbounded body. This reads the body stream and ABORTS once `maxBytes` is
 * exceeded, so the cap holds regardless of the declared length. Returns `null` when the cap is
 * exceeded (the caller replies 413). Falls back to `req.text()` when there is no stream body.
 */
export async function readBodyBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) {
    const text = await req.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** A candidate employing org + its resolved webhook secret (for the HMAC match). */
export interface EmployingOrg {
  orgId: string;
  webhookSecret: string;
  /** Round-7 B4: the ERP Company this binding represents (`external_org_bindings.config.company`).
   *  One ERPNext site routinely hosts several Companies; a valid HMAC proves the SITE sent the event,
   *  not that the document belongs to THIS tenant. `null` (an unconfigured binding) scopes nothing and
   *  therefore adopts no company-scoped document. */
  company: string | null;
  /** Luna BLOCK 9: the PMO domains this org has ACTUALLY assigned to the ERPNext tier
   *  (`external_domain_ownership`). A valid HMAC proves who sent the event, NOT that the org opted
   *  this domain into external ownership — an event for an unowned domain is ack'd and dropped. */
  ownedDomains: string[];
}

/** The injectable surface `handleErpWebhook` needs — so the gate + decode + apply routing are
 *  unit-testable (index.test.ts) without a live Supabase/ERP stack. The Deno.serve wrapper wires the
 *  real implementations (DB read + env secret resolution + createErpFeedDeps + applyErpFeedEvent). */
export interface ErpWebhookHandlerDeps {
  /** The employing orgs + their resolved webhook secrets (HMAC keys). The first whose secret validates
   *  identifies the org the event belongs to. */
  resolveEmployingOrgs: () => Promise<EmployingOrg[]>;
  /** Apply one decoded event for a resolved org (the wrapper builds the feed deps + the fromDoc-mapped
   *  canonical + calls applyErpFeedEvent). Returns the apply outcome (or throws on a real failure). */
  applyEvent: (orgId: string, event: ErpFeedEvent) => Promise<ApplyOutcome>;
  /**
   * FIX 1 (round-9 SHOULD-FIX): the in-flight adopt guard — the SAME `createInFlightAnchorProbe` barrier
   * the sweep raises (`buildIsInFlightAdopt`). Answers "does an UNRESOLVED (in-flight, non-confirmed)
   * outbox row for this org own this event's anchor key?" When true, the ERP doc belongs to a
   * PMO-originated command still inside the ADR-0058 recovery algorithm — the webhook must NOT adopt it
   * (adopting mints a phantom mirror under a random id AND wedges the dispatch's fenced
   * `record_outbox_ref` on the 0093 extid unique). Optional so the existing gate/decode tests stay
   * byte-for-byte; the Deno.serve wrapper ALWAYS wires it.
   */
  isInFlightAdopt?: (orgId: string, event: ErpFeedEvent) => Promise<boolean>;
}

/**
 * The testable core: gate (HMAC) → decode → apply. An absent/invalid signature ⇒ 401 no side effect.
 * A valid signature whose payload decodes to an unmapped doctype ⇒ 200 skipped (lossy hint). A valid
 * event for a mapped doctype ⇒ applied (200); a 23505 concurrent-adopt ⇒ 409; any other apply failure
 * ⇒ 500 GENERIC (the detail is logged server-side, never leaked to the public surface).
 */
export async function handleErpWebhook(req: Request, deps: ErpWebhookHandlerDeps): Promise<Response> {
  // ── 0. Body-size cap: reject Content-Length > 256 KiB early (cheap), THEN enforce the cap on the
  //    STREAM so a chunked/short/lying Content-Length cannot smuggle an unbounded body (M-1 audit). ──
  const declaredLength = Number(req.headers.get('Content-Length') ?? '0');
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  // ── 1. The HMAC is the sole trust boundary: read the RAW body (stream-bounded) + the
  //    X-Frappe-Webhook-Signature header BEFORE any parse/apply. An absent header ⇒ 401 no side effect. ──
  const rawBody = await readBodyBounded(req, MAX_WEBHOOK_BODY_BYTES);
  if (rawBody === null) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const signatureHeader = req.headers.get('X-Frappe-Webhook-Signature') ?? '';

  // task FIX-5 (Quality IMPORTANT 2): a DB load failure resolving employing orgs is NOT the same
  // event as "genuinely no employing org" — the former is transient/retryable (500, so Frappe's
  // webhook retry policy kicks in), the latter is a permanent no-secret-match (401). Conflating them
  // by letting a thrown load-error silently degrade to an empty org list would tell Frappe to STOP
  // retrying on what may be a momentary outage.
  let orgs: EmployingOrg[];
  try {
    orgs = await deps.resolveEmployingOrgs();
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'failed to resolve employing orgs';
    console.error(`[erpnext-webhook] resolveEmployingOrgs failed: ${detail}`);
    return json({ error: 'INTERNAL_ERROR', message: 'could not resolve the employing org' }, 500);
  }
  // No employing org ⇒ the public surface rejects (no secret to match) — 401, no side effect.
  // Check EVERY org's secret (no first-wins break): if two bindings resolve to the same/reused
  // secret, the signature identifies no single org, and applying by query order could route a
  // signed payload into the WRONG org's mirror (Luna money review 2026-07-14, BLOCK 2). Ambiguity
  // is a configuration fault — reject loudly, apply nothing.
  const matchedOrgs: EmployingOrg[] = [];
  if (signatureHeader) {
    for (const org of orgs) {
      if (org.webhookSecret && (await verifyErpWebhookSignature(rawBody, signatureHeader, org.webhookSecret))) {
        matchedOrgs.push(org);
      }
    }
  }
  if (matchedOrgs.length > 1) {
    console.error(`[erpnext-webhook] AMBIGUOUS signature match: ${matchedOrgs.length} orgs share a webhook secret — rejecting (fix the per-org webhook_secret_ref configuration)`);
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  const matchedOrg: EmployingOrg | null = matchedOrgs[0] ?? null;
  if (!matchedOrg) return json({ error: 'UNAUTHORIZED' }, 401);

  // ── 2. Parse the verified body + decode the feed event. ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const event = decodeErpWebhookEvent(parsed);
  if (!event) return json({ error: 'BAD_REQUEST', message: 'doctype and name are required' }, 400);
  // An unmapped doctype (one P2 does not mirror) — ack and skip (lossy hint, FR-ENA-083).
  if (!event.kind || !event.domain) return json({ ok: true, skipped: 'unmapped-doctype' });

  // Luna BLOCK 9: per-DOMAIN ownership gate. The signature identified the org; it did NOT establish
  // that this org employs ERPNext for THIS domain. Without the check, a procurement-only org received
  // native Sales Invoice / Receive Payment Entry mirrors and surfaced them in its revenue read model.
  // Fail-CLOSED (an empty/unknown owned-domain set adopts nothing); ack'd 200 so Frappe does not retry
  // an event that is genuine but simply not ours to mirror.
  if (!matchedOrg.ownedDomains.includes(event.domain)) {
    return json({ ok: true, skipped: 'domain-not-owned' });
  }

  // Round-7 B4: per-COMPANY admission. The org owns the domain — but an ERPNext site routinely hosts
  // several Company records, and the binding represents exactly ONE of them. Without this, a Company-B
  // Sales Invoice or Receive Payment Entry was adopted into Company A's PMO tenant and surfaced in its
  // revenue/AR views with no error: another tenant's financial data. Fail CLOSED — a document that does
  // not state its company, and a binding that names none, adopt nothing. Ack'd 200 (like
  // domain-not-owned): the event is genuine, it is simply not ours to mirror, so Frappe must not retry.
  // The rule lives in `companyScope` so the sweep applies the IDENTICAL one (as a server-side filter).
  if (!admitsDocForBindingCompany(event.kind, event.doc, matchedOrg.company)) {
    return json({ ok: true, skipped: 'company-not-in-scope' });
  }

  // FIX 1 (round-9 SHOULD-FIX): the in-flight adopt guard — the SAME barrier the sweep's
  // `createInFlightAnchorProbe` raises. If this doc's anchor carries the idempotency key of an
  // UNRESOLVED (in-flight, non-confirmed) outbox row, it belongs to a PMO-originated command still
  // finalizing (ADR-0058 §4) — the dispatch/sweep maps that ERP name to the ORIGINAL PMO record id.
  // Adopting it here mints a SECOND (phantom) mirror under a random id AND makes the dispatch's fenced
  // `record_outbox_ref` fail the 0093 extid unique, wedging a real money row at `committed`. Ack-and-skip
  // (lossy hint, FR-ENA-083) — the dispatch/sweep owns finalization; once it CONFIRMS, its outbox row is
  // no longer in-flight and a legitimately-later webhook flows through the normal resolve/update path.
  if (await deps.isInFlightAdopt?.(matchedOrg.orgId, event)) {
    return json({ ok: true, skipped: 'in-flight-command-owns-doc' });
  }

  // ── 3. Apply via the lineage-aware feed (lossy hint; the sweep is the convergence authority). ──
  try {
    const outcome = await deps.applyEvent(matchedOrg.orgId, event);
    return json({ ok: true, outcome });
  } catch (err) {
    const code = err instanceof AppError ? err.code : (err as { code?: string } | null)?.code;
    if (code === '23505') {
      return json({ error: 'CONCURRENT_ADOPT', message: 'a concurrent adopt is reconciling' }, 409);
    }
    const detail = err instanceof Error ? err.message : 'webhook apply failed';
    console.error(`[erpnext-webhook] apply failed: org=${matchedOrg.orgId} doctype=${event.doctype} code=${code ?? 'none'} detail=${detail}`);
    return json({ error: 'WEBHOOK_APPLY_FAILED', message: 'the webhook could not be applied' }, 500);
  }
}

// ── The real wiring the Deno.serve wrapper uses (DB + env + createErpFeedDeps). ──────────────────

/** Loads the employing orgs + resolves each org's webhook secret from its `webhook_secret_ref` env. */
async function resolveEmployingOrgsLive(serviceClient: SupabaseClient): Promise<EmployingOrg[]> {
  const { data, error } = await serviceClient.from('external_org_bindings')
    .select('org_id, webhook_secret_ref, activated_at, config')
    .eq('external_tier', ERPNEXT_TIER);
  // task FIX-5 (Quality IMPORTANT 2): a real DB error must not be swallowed into "no employing org"
  // (that reads as a permanent 401 to Frappe) — log it and THROW so the caller (handleErpWebhook)
  // surfaces a retryable 500 instead.
  if (error) {
    console.error(`[erpnext-webhook] external_org_bindings load failed: code=${error.code ?? 'none'} message=${error.message}`);
    throw new AppError(error.message, error.code);
  }
  const rows = (data as Array<{
    org_id: string;
    webhook_secret_ref: string | null;
    activated_at: string | null;
    config: Record<string, unknown> | null;
  }> | null) ?? [];
  // Only ACTIVATED bindings are employing (a binding is activated once the version handshake passes,
  // 2.6/8.8). A binding without a webhook_secret_ref is employing for COMMANDS but not webhooks — it
  // contributes no HMAC key (webhook events for it are rejected until a secret is configured).
  const candidates = rows
    .filter((r) => r.activated_at && r.webhook_secret_ref)
    // B4: carry the binding's ERP Company through — the per-document admission gate below scopes
    // adoption to it (a multi-company ERP site must not leak Company B's money into Company A's tenant).
    .map((r) => ({
      orgId: r.org_id,
      webhookSecret: Deno.env.get(r.webhook_secret_ref!) ?? '',
      company: typeof r.config?.company === 'string' && r.config.company.length > 0 ? r.config.company : null,
    }))
    .filter((r) => r.webhookSecret !== '');
  if (candidates.length === 0) return [];

  // Luna BLOCK 9: load each org's ACTUAL per-domain ERPNext ownership. A load failure THROWS (→ a
  // retryable 500) rather than degrading to "owns nothing" silently — but a successful read with no
  // rows genuinely means the org owns no domain, and the gate then adopts nothing (fail-closed).
  const { data: owned, error: ownedError } = await serviceClient.from('external_domain_ownership')
    .select('org_id, domain')
    .eq('external_tier', ERPNEXT_TIER)
    .in('org_id', candidates.map((c) => c.orgId));
  if (ownedError) {
    console.error(`[erpnext-webhook] external_domain_ownership load failed: code=${ownedError.code ?? 'none'} message=${ownedError.message}`);
    throw new AppError(ownedError.message, ownedError.code);
  }
  const byOrg = new Map<string, string[]>();
  for (const row of (owned as Array<{ org_id: string; domain: string }> | null) ?? []) {
    byOrg.set(row.org_id, [...(byOrg.get(row.org_id) ?? []), row.domain]);
  }
  return candidates.map((c) => ({ ...c, ownedDomains: byOrg.get(c.orgId) ?? [] }));
}

/**
 * FIX 1 (round-9 SHOULD-FIX): build the webhook's in-flight adopt guard over the SAME
 * `createInFlightAnchorProbe` the sweep uses. Reads the anchor off `event.doc` using the kind's stock
 * anchor field (DOCTYPE_REGISTRY) — a doc that carries no key, or a kind with no anchor, is a native doc
 * and adopts normally. Exported so its wiring is unit-tested (index.test.ts) against a seeded outbox
 * rather than reachable only through the live stack.
 */
export function buildIsInFlightAdopt(serviceClient: SupabaseClient): (orgId: string, event: ErpFeedEvent) => Promise<boolean> {
  return (orgId, event) => {
    if (!event.kind) return Promise.resolve(false);
    const anchorField = DOCTYPE_REGISTRY[event.kind].anchorField;
    if (!anchorField) return Promise.resolve(false); // anchor-less kind — nothing to probe.
    const anchor = ((event.doc ?? {}) as Record<string, unknown>)[anchorField];
    if (typeof anchor !== 'string' || anchor === '') return Promise.resolve(false);
    // A fresh probe per event: one anchor is checked, so the per-tick memo carries no benefit here.
    return createInFlightAnchorProbe(serviceClient, orgId)(anchor);
  };
}

/** The real applyEvent: map the ERP doc → canonical via the kind's fromDoc, stamp the routing fields,
 *  build the feed deps, and call applyErpFeedEvent. */
async function applyEventLive(
  serviceClient: SupabaseClient,
  orgId: string,
  event: ErpFeedEvent,
): Promise<ApplyOutcome> {
  const kind = event.kind as ErpDocKind;
  const bodyFns = DOCTYPE_BODIES[kind];
  if (!bodyFns) throw new AppError(`erpnext doctype body for '${kind}' is not yet wired`, 'commit-rejected');
  const canonical = {
    ...bodyFns.fromDoc(event.doc),
    erp_docstatus: event.docstatus,
    erp_amended_from: event.amendedFrom,
  };
  const feedDeps = createErpFeedDeps(serviceClient, orgId, kind);
  return applyErpFeedEvent({ tier: ERPNEXT_TIER, domain: event.domain! }, event.externalRecordId, canonical, Date.parse(event.modified), feedDeps);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' } });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
  const serviceClient = createClient(supabaseUrl, serviceRoleKey) as unknown as SupabaseClient;
  return handleErpWebhook(req, {
    resolveEmployingOrgs: () => resolveEmployingOrgsLive(serviceClient),
    applyEvent: (orgId, event) => applyEventLive(serviceClient, orgId, event),
    // FIX 1: the in-flight adopt guard is ALWAYS wired on the live path (the dep is optional only so the
    // gate/decode unit tests stay byte-for-byte).
    isInFlightAdopt: buildIsInFlightAdopt(serviceClient),
  });
});
