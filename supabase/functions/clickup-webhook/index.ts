/**
 * clickup-webhook — Deno Edge Function entry point (Slice D, FR-CUA-040/041/043, AC-CUA-040..045).
 *
 * 2026-07-20 (OD-INT-11 fix): live-verified against the real ClickUp API — the delivery ALWAYS carries
 * `{event, task_id, team_id, webhook_id, history_items}` and NEVER a `task` body, `date_updated`, or
 * `list_id`. So this ingress can no longer apply inline (there is nothing to apply — the state has to
 * be re-GET'd). It is now THIN: verify -> parse -> enqueue -> 200. ClickUp marks a webhook *Failing* if
 * the endpoint errors OR takes >7s, drops an event permanently after 5 failed retries, and *Suspends*
 * the webhook at 100 failures with NO notification — so a synchronous re-GET on the request path is
 * never safe here. A separate worker (`clickup-webhook-worker`, `../_shared` queue table
 * `clickup_webhook_inbox`) re-GETs the task and applies the full current state.
 *
 * The `X-Signature` HMAC-SHA256 of the raw body (keyed by the org's own webhook secret) is the SOLE trust
 * boundary (FR-CUA-041, NFR-CUA-SEC-002): an absent/invalid signature ⇒ 401 with NO side effect, before
 * any parse/enqueue (STRIDE spoofing/tampering). `verify_jwt = false` (supabase/config.toml) — the HMAC
 * replaces the JWT gate.
 *
 * The exported `handleClickUpWebhook` is the testable core (deps-injected `enqueue`, mirroring
 * erpnext-webhook's `handleErpWebhook` pattern) — `index.test.ts` proves the gate + parse + enqueue-not-
 * apply contract with `globalThis.fetch` never touched (no re-GET happens on this path, by construction:
 * this file makes no ClickUp HTTP calls at all). The real DB insert is INTEGRATION-ONLY, verified by
 * `deno check` + the boot-smoke.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyClickUpSignature } from '../../../pmo-portal/src/lib/adapterSeam/clickup/signature.ts';
import { parseWebhookEnvelope, type ClickUpWebhookPayload } from '../../../pmo-portal/src/lib/adapterSeam/clickup/types.ts';
import { readBodyBounded } from '../_shared/readBodyBounded.ts';
import { resolveClickUpWebhookSecrets, type ClickUpWebhookOrgSecret } from '../_shared/clickupOrgSecret.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

// 256 KiB body cap (review fix #7b): reject an oversized payload BEFORE req.text() so a huge body
// can't exhaust the isolate. ClickUp task webhooks are small JSON (<2 KB typical); 256 KiB is a
// generous ceiling that still bounds memory.
const MAX_WEBHOOK_BODY_BYTES = 262144;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The injectable surface `handleClickUpWebhook` needs — so the gate + parse + enqueue contract is
 *  unit-testable (index.test.ts) without a live Supabase stack. The Deno.serve wrapper wires the real
 *  `clickup_webhook_inbox` insert. */
export interface ClickUpWebhookHandlerDeps {
  /** Every org's resolved webhook secret. A delivery verifies only against exactly one org's secret. */
  resolveWebhookSecrets: () => Promise<ClickUpWebhookOrgSecret[]>;
  /** The org bound to a ClickUp team, resolved exactly as the worker resolves it; `null` when unbound. */
  orgForTeam: (teamId: string) => Promise<string | null>;
  /** Durably enqueue one verified event; the worker (clickup-webhook-worker) claims + applies it. */
  enqueue: (payload: ClickUpWebhookPayload, rawBodySha256: string) => Promise<void>;
}

/**
 * The testable core: verify (HMAC) → parse the envelope → enqueue → 200. An absent/invalid signature ⇒
 * 401 with NO side effect (enqueue never called). A body that fails to parse as JSON, or whose envelope
 * is missing `event`/`task_id`, ⇒ 400 (also no side effect). A valid envelope ⇒ enqueued + 200
 * `{ok:true, enqueued:true}` — this handler NEVER performs a ClickUp HTTP call (no re-GET on the request
 * path, so ClickUp's <7s / no-error budget always holds here regardless of the worker's own latency).
 */
export async function handleClickUpWebhook(req: Request, deps: ClickUpWebhookHandlerDeps): Promise<Response> {
  // ── 0. Body-size cap (review fix #7b): reject Content-Length > 256 KiB BEFORE req.text() so a huge
  //    payload can't exhaust the isolate. Checked on the declared Content-Length (cheap header read). ──
  const declaredLength = Number(req.headers.get('Content-Length') ?? '0');
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  // ── 1. The HMAC is the sole trust boundary: read the RAW body + the X-Signature header BEFORE any
  //    parse/enqueue. An absent/invalid signature ⇒ 401 with NO side effect (FR-CUA-041, NFR-CUA-SEC-002). ──
  const rawBody = await readBodyBounded(req, MAX_WEBHOOK_BODY_BYTES);
  if (rawBody === null) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const signatureHeader = req.headers.get('X-Signature') ?? '';
  let orgSecrets: ClickUpWebhookOrgSecret[];
  try {
    orgSecrets = await deps.resolveWebhookSecrets();
  } catch (err) {
    console.error(`[clickup-webhook] resolveWebhookSecrets failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return json({ error: 'INTERNAL_ERROR', message: 'could not resolve the webhook secret' }, 500);
  }
  // Check EVERY org (no first-wins): a signature must identify exactly one org. No match, or a secret
  // shared by several orgs, is rejected with no side effect.
  const matchedOrgIds: string[] = [];
  if (signatureHeader) {
    for (const org of orgSecrets) {
      if (org.secret && (await verifyClickUpSignature(rawBody, signatureHeader, org.secret))) matchedOrgIds.push(org.orgId);
    }
  }
  if (matchedOrgIds.length !== 1) return json({ error: 'UNAUTHORIZED' }, 401);

  // ── 2. Parse the verified body — the REAL envelope (2026-07-20 live-verified): {event, task_id,
  //    team_id, webhook_id, history_items}. No task/date_updated/list_id ever crosses this boundary. ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const payload = parseWebhookEnvelope(parsed);
  if (!payload) {
    return json({ error: 'BAD_REQUEST', message: 'event and task_id are required' }, 400);
  }
  // The worker picks the org from the delivery's team, so the team must belong to the org whose secret
  // signed it: one org's secret never acts on another org's workspace.
  let teamOrgId: string | null;
  try {
    teamOrgId = payload.team_id ? await deps.orgForTeam(payload.team_id) : null;
  } catch (err) {
    console.error(`[clickup-webhook] orgForTeam failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return json({ error: 'INTERNAL_ERROR', message: 'could not resolve the webhook secret' }, 500);
  }
  if (teamOrgId !== matchedOrgIds[0]) return json({ error: 'UNAUTHORIZED' }, 401);

  // ── 3. Enqueue + ack. Never applies inline — the worker re-GETs + applies (OD-INT-11). ──
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  const rawBodySha256 = Array.from(new Uint8Array(digestBytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  try {
    await deps.enqueue(payload, rawBodySha256);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === '23505') return json({ ok: true, enqueued: true, duplicate: true });
    const message = err instanceof Error ? err.message : 'enqueue failed';
    console.error(`[clickup-webhook] enqueue failed: task=${payload.task_id} event=${payload.event} detail=${message}`);
    // Review fix #7c: a 5xx response carries a GENERIC message (never the raw error detail — which
    // could leak schema/internal detail to the public, unauthenticated surface).
    return json({ error: 'ENQUEUE_FAILED', message: 'the webhook could not be queued' }, 500);
  }
  return json({ ok: true, enqueued: true });
}

// ── The real wiring the Deno.serve wrapper uses (DB insert into clickup_webhook_inbox). ──────────

/** Mirrors the worker's `resolveOrgForTeam` binding lookup, so both sides agree on the team's org. */
function orgForTeamLive(serviceClient: SupabaseClient): ClickUpWebhookHandlerDeps['orgForTeam'] {
  return async (teamId) => {
    const { data, error } = await serviceClient
      .from('external_org_bindings')
      .select('org_id')
      .eq('external_tier', 'clickup')
      .eq('config->>clickup_team_id', teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { org_id?: string } | null)?.org_id ?? null;
  };
}

function enqueueLive(serviceClient: SupabaseClient): ClickUpWebhookHandlerDeps['enqueue'] {
  return async (payload, rawBodySha256) => {
    const { error } = await serviceClient.from('clickup_webhook_inbox').insert({
      event: payload.event,
      task_id: payload.task_id,
      team_id: payload.team_id ?? null,
      webhook_id: payload.webhook_id ?? null,
      history_items: payload.history_items,
      raw_body_sha256: rawBodySha256,
    });
    if (error) {
      if (error.code === '23505') return;
      const enqueueError = new Error(error.message) as Error & { code?: string };
      enqueueError.code = error.code;
      throw enqueueError;
    }
  };
}

if (import.meta.main) {
  serveWithErrorReporting('clickup-webhook', async (req: Request): Promise<Response> => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
    }
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    return handleClickUpWebhook(req, {
      resolveWebhookSecrets: () => resolveClickUpWebhookSecrets(serviceClient),
      orgForTeam: orgForTeamLive(serviceClient),
      enqueue: enqueueLive(serviceClient),
    });
  });
}
