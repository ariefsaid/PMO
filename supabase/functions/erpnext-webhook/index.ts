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
import { createErpFeedDeps, ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import type { ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
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
  let matchedOrg: EmployingOrg | null = null;
  if (signatureHeader) {
    for (const org of orgs) {
      if (org.webhookSecret && (await verifyErpWebhookSignature(rawBody, signatureHeader, org.webhookSecret))) {
        matchedOrg = org;
        break;
      }
    }
  }
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
    .select('org_id, webhook_secret_ref, activated_at')
    .eq('external_tier', ERPNEXT_TIER);
  // task FIX-5 (Quality IMPORTANT 2): a real DB error must not be swallowed into "no employing org"
  // (that reads as a permanent 401 to Frappe) — log it and THROW so the caller (handleErpWebhook)
  // surfaces a retryable 500 instead.
  if (error) {
    console.error(`[erpnext-webhook] external_org_bindings load failed: code=${error.code ?? 'none'} message=${error.message}`);
    throw new AppError(error.message, error.code);
  }
  const rows = (data as Array<{ org_id: string; webhook_secret_ref: string | null; activated_at: string | null }> | null) ?? [];
  // Only ACTIVATED bindings are employing (a binding is activated once the version handshake passes,
  // 2.6/8.8). A binding without a webhook_secret_ref is employing for COMMANDS but not webhooks — it
  // contributes no HMAC key (webhook events for it are rejected until a secret is configured).
  return rows
    .filter((r) => r.activated_at && r.webhook_secret_ref)
    .map((r) => ({ orgId: r.org_id, webhookSecret: Deno.env.get(r.webhook_secret_ref!) ?? '' }))
    .filter((r) => r.webhookSecret !== '');
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
  });
});
