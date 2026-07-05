/**
 * agent-dispatch — Deno Edge Function entry point (ADR-0044 §2/§3, FR-AAN-010).
 *
 * Invoked once per minute by the pg_cron job (migration 0048) via net.http_post. Thin wiring ONLY —
 * all tick logic lives in the pure modules (dispatcher/cron/watermark/condition/mint/fire), unit-
 * tested under pmo-portal/src/lib/agent/dispatch/* (REC-1). This file is INTEGRATION-ONLY (not unit-
 * tested) — verified by the deploy-time BUILD-VERIFY checklist + the e2e simulated fire (Task G1).
 *
 * BUILD-TIME-VERIFY checklist (deploy-time, not CI):
 *   1. The incoming Authorization bearer MUST equal SUPABASE_SERVICE_ROLE_KEY — this endpoint MINTS,
 *      so it must never be publicly callable (the pg_cron job sends the service-role key).
 *   2. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / OPENROUTER_API_KEY function
 *      secrets set in the deployed project (never committed).
 *   3. AGENT_AUTOMATIONS flag ('false' disables the mint/model path — FR-AAN-038); with it off, the
 *      tick is a no-op even if rows exist.
 *
 * THE deputy invariant (NFR-AAN-SEC-001): service_role is used ONLY to (a) verify the caller +
 * enumerate automation metadata + watermark bookkeeping (serviceClient, quarantined table set), and
 * (b) mint short-lived owner JWTs (authAdmin). The FIRED run runs under the MINTED owner client —
 * never service_role — so RLS stays the ceiling exactly as for an interactive run.
 * SEC-HIGH-2: trigger-event selection goes through the SECURITY DEFINER select_trigger_events RPC
 * (serviceClient.rpc), NOT a raw service_role read of the tenant procurement_status_events table —
 * so no cross-org business row ever crosses the trust boundary into this edge fn.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
import { runDispatchTick } from './dispatcher.ts';
import { OpenRouterModelClient } from '../_shared/openRouterModelClient.ts';
import { resolveDefaultModel } from '../_shared/modelResolution.ts';
import { createCreditRateGuard } from '../_shared/creditRateGuard.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
// Shared-module import of the SAME agent loop the interactive path uses (the fired run is an
// ordinary run — no automation-only branch). This does NOT modify agent-chat source.
import { agentChatHandler } from '../agent-chat/handler.ts';
import {
  AGENT_MASTER_DATA_ROLES,
  AGENT_DELIVERY_WITH_ENGINEER_ROLES,
} from '../../../pmo-portal/src/auth/agentRoles.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Authorization: the bearer MUST be the service-role key (this endpoint mints). ──
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceRoleKey) {
    // Missing SUPABASE_SERVICE_ROLE_KEY: distinct from a bad/absent caller bearer — this
    // function secret is required for the dispatcher to ever authenticate its own pg_cron
    // caller, so its absence is a deploy-config gap, not a caller error.
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'MISSING_SERVICE_ROLE_KEY' });
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 2. Flag gate (FR-AAN-038). Off ⇒ no-op tick (no mint/model path). ──
  if (Deno.env.get('AGENT_AUTOMATIONS') === 'false') {
    return new Response(JSON.stringify({ ok: true, skipped: 'flag off' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!supabaseUrl || !anonKey || !apiKey) {
    // Distinct codes so a deploy-config gap is greppable without exposing WHICH secret is
    // missing in the client-facing body (the log line — server-side only — names it).
    const errorCode = !supabaseUrl
      ? 'MISSING_SUPABASE_URL'
      : !anonKey
        ? 'MISSING_SUPABASE_ANON_KEY'
        : 'MISSING_OPENROUTER_API_KEY';
    logStructuredError({ fn: 'agent-dispatch', errorCode });
    return new Response(JSON.stringify({ error: 'MISCONFIGURED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 3. serviceClient (selection/watermark/last_fired_at metadata ONLY) + authAdmin (mint ONLY). ──
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const authAdmin = createClient(supabaseUrl, serviceRoleKey).auth;

  // buildClient: a caller-JWT-scoped client from a minted access token — the SAME anon-key +
  // Bearer client shape the interactive path uses. This is the ONLY business-data surface for a
  // fired run, and it is the minted OWNER identity, never service_role.
  const buildClient = (accessToken: string) =>
    createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

  const modelClient = new OpenRouterModelClient({ apiKey });
  const model = resolveDefaultModel({ AGENT_MODEL_DEFAULT: Deno.env.get('AGENT_MODEL_DEFAULT') ?? undefined });
  // Cheap-tier condition model (§4, FR-AAN-021) — the small model for NL condition evaluation.
  const conditionModel = new OpenRouterModelClient({ apiKey });
  const conditionModelId = Deno.env.get('AGENT_MODEL_CHEAP') ?? model;

  // Same can() deputy re-auth as interactive (FR-AAN-017) — threaded to the fired run via extras.
  const MASTER_DATA_SET = new Set(AGENT_MASTER_DATA_ROLES);
  const DELIVERY_WITH_ENGINEER_SET = new Set(AGENT_DELIVERY_WITH_ENGINEER_ROLES);
  const agentCan = (action: string, entity: string, ctx: { realRole: string | null }): boolean => {
    const role = ctx.realRole;
    if (!role) return false;
    if (entity === 'contactActivity' && action === 'create') return MASTER_DATA_SET.has(role);
    if (entity === 'taskStatus' && action === 'edit') return DELIVERY_WITH_ENGINEER_SET.has(role);
    return false;
  };

  // ── ADR-0044 §6 / REC-4: credit-backed RateGuard, gated by the SAME AGENT_CREDITS_ENFORCED flag
  // as the interactive path (agent-chat/index.ts) — default OFF so a deployment with no seeded
  // credits grants is not instantly locked out (spec Open Question 3). `check` receives the MINTED
  // OWNER client (dispatcher.ts) and builds the credit-backed guard against it per-automation, so the
  // balance read runs under owner RLS — never service_role (NFR-AAN-SEC-002/SEC-006).
  const creditsEnforced = Deno.env.get('AGENT_CREDITS_ENFORCED') === 'true';
  const rateGuard = {
    check: async (orgId: string, mintedClient?: unknown) => {
      if (!creditsEnforced || !mintedClient) return { exceeded: false, retryAfterSeconds: 0 };
      const guard = createCreditRateGuard({ supabase: mintedClient as never });
      return guard.check(orgId);
    },
  };

  try {
    await runDispatchTick({
      // Casts: the real supabase-js client/auth-admin objects satisfy ServiceClientLike/
      // AuthAdminLike at runtime (both are minimal Supabase-like interfaces the real client is
      // a structural superset of) but their exact TS shapes (PostgrestFilterBuilder thenables,
      // GenerateLinkParams' discriminated union) don't nominally match these hand-written
      // interfaces — the same documented cast pattern as `handler: agentChatHandler as never`
      // below, surfaced by the deno-check CI gate (never checked under tsc's looser resolution
      // for this file before).
      serviceClient: serviceClient as never,
      authAdmin: authAdmin as never,
      buildClient,
      // The real agent loop — the fired run is indistinguishable from interactive (FR-AAN-017).
      handler: agentChatHandler as never,
      modelClient,
      model,
      conditionModel,
      conditionModelId,
      rateGuard,
      now: () => new Date(),
      // The fired run gets the SAME gates as interactive: can() re-auth + compose tool.
      handlerExtras: { can: agentCan, composeEnabled: true },
      // FR-AAN-020: the fired run persists as an ordinary run under the MINTED OWNER client (owner
      // RLS — the deputy invariant, never service_role). auditMint already created the thread+run +
      // the seq-0 audit event, so this resumes that run: startSeq=1, no journaled writes yet.
      buildPersistence: (mintedClient, ownerId, _runId) => ({
        supabase: mintedClient,
        ownerId,
        orgId: '',
        now: () => new Date(),
        startSeq: 1,
        journaledWrites: [],
      }),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Scrub — never surface a mint/owner detail. Log the error name only (NFR-AAN-SEC-007/008).
    logStructuredError({
      fn: 'agent-dispatch',
      errorCode: 'DISPATCH_TICK_FAILED',
      contextId: err instanceof Error ? err.name : 'unknown',
    });
    return new Response(JSON.stringify({ error: 'TICK_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
