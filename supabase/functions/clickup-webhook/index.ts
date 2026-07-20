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
 * The `X-Signature` HMAC-SHA256 of the raw body (keyed by CLICKUP_WEBHOOK_SECRET) is the SOLE trust
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
  /** Durably enqueue one verified event; the worker (clickup-webhook-worker) claims + applies it. */
  enqueue: (payload: ClickUpWebhookPayload) => Promise<void>;
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
  const secret = Deno.env.get('CLICKUP_WEBHOOK_SECRET') ?? '';
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('X-Signature') ?? '';
  if (!secret || !(await verifyClickUpSignature(rawBody, signatureHeader, secret))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

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

  // ── 3. Enqueue + ack. Never applies inline — the worker re-GETs + applies (OD-INT-11). ──
  try {
    await deps.enqueue(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'enqueue failed';
    console.error(`[clickup-webhook] enqueue failed: task=${payload.task_id} event=${payload.event} detail=${message}`);
    // Review fix #7c: a 5xx response carries a GENERIC message (never the raw error detail — which
    // could leak schema/internal detail to the public, unauthenticated surface).
    return json({ error: 'ENQUEUE_FAILED', message: 'the webhook could not be queued' }, 500);
  }
  return json({ ok: true, enqueued: true });
}

// ── The real wiring the Deno.serve wrapper uses (DB insert into clickup_webhook_inbox). ──────────

function enqueueLive(serviceClient: SupabaseClient): ClickUpWebhookHandlerDeps['enqueue'] {
  return async (payload) => {
    const { error } = await serviceClient.from('clickup_webhook_inbox').insert({
      event: payload.event,
      task_id: payload.task_id,
      team_id: payload.team_id ?? null,
      webhook_id: payload.webhook_id ?? null,
      history_items: payload.history_items,
    });
    if (error) throw new Error(error.message);
  };
}

if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
    }
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    return handleClickUpWebhook(req, { enqueue: enqueueLive(serviceClient) });
  });
}
