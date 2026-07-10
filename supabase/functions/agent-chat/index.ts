/**
 * agent-chat — Deno Edge Function entry point.
 * BUILD-TIME-VERIFY checklist (deploy-time, not CI):
 *   1. Non-streaming call form: modelClient.create({...}) resolves one accumulated
 *      ModelResponse (MC-OD-007 — plain fetch, no provider-side SSE consumption).
 *   2. tool_calls[0] shape: .id is used as tool_call_id in the role:'tool' result message.
 *   3. finish_reason values: 'tool_calls' vs 'stop'/'length' match the branches in handler.ts.
 *   4. supabase functions serve passes Content-Type: text/event-stream unbuffered.
 *   5. OPENROUTER_API_KEY function secret set in deployed project (never committed).
 *
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision 7).
 * All business logic lives in handler.ts (pure, importable in Vitest).
 *
 * Responsibilities:
 *   1. CORS preflight handling.
 *   2. Read Authorization header; reject 401 if absent.
 *   3. Verify JWT using service-role client (service_role ONLY for auth.getUser — NFR-AR-SEC-002).
 *   4. Build caller-JWT Supabase client for all business data (deputy auth — FR-AR-014).
 *   5. Read OPENROUTER_API_KEY from Deno.env (function secret — NFR-MC-SEC-001).
 *   6. Parse JSON body into AgentChatRequest.
 *   7. Delegate to agentChatHandler; pipe events into SSE ReadableStream (D1/ADR-0042).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
import { agentChatHandler } from './handler.ts';
import { loadJournaledWrites, loadMaxSeq } from './persistence.ts';
import { createAttachmentResolver } from './attachments.ts';
import { createCreditRateGuard } from '../_shared/creditRateGuard.ts';
import { OpenRouterModelClient, providerPolicyFromEnv } from '../_shared/openRouterModelClient.ts';
import { resolveDefaultModel } from '../_shared/modelResolution.ts';
import { DEPLOY_VERSION } from '../_shared/version.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { recordErrorEvent } from '../_shared/errorEvent.ts';
import { encodeSse } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import type { AgentChatRequest } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import {
  AGENT_MASTER_DATA_ROLES,
  AGENT_DELIVERY_WITH_ENGINEER_ROLES,
} from '../../../pmo-portal/src/auth/agentRoles.ts';

// AUDIT quick-win (2026-07-07): CORS narrows to the deployed SPA origin when
// AGENT_ALLOWED_ORIGIN is set; falls back to SITE_URL, then to '' (fail-closed — never '*').
// Auth is JWT-header-based (no cookies), so this is defense-in-depth against browser-driven
// abuse, matching the admin-invite-user/index.ts pattern.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // x-deploy-version is a custom RESPONSE header — cross-origin JS can only read it
  // if it's explicitly exposed (the SPA lives on a different origin than the fn).
  'Access-Control-Expose-Headers': 'x-deploy-version',
};

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── 1. Authorization header ───────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ status: 401, error: 'UNAUTHORIZED', detail: 'missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const jwt = authHeader.slice(7);

  // ── 2. Verify JWT using service-role client (NFR-AR-SEC-002) ─────────────
  // service_role is used ONLY here for auth.getUser(jwt). Never for business data.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const verifierClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user }, error: authError } = await verifierClient.auth.getUser(jwt);
  if (authError || !user) {
    return new Response(
      JSON.stringify({ status: 401, error: 'UNAUTHORIZED', detail: 'invalid JWT' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const userId = user.id;

  // ── 3. Build caller-JWT Supabase client (deputy auth — FR-AR-014) ─────────
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // ── 4. Read OPENROUTER_API_KEY from function secrets (NFR-MC-SEC-001) ──────
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    logStructuredError({ fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    // Cast: the real supabase-js client's .from().insert() returns a thenable
    // PostgrestFilterBuilder, not a plain Promise — a structural superset of
    // ErrorEventSupabaseLike at runtime, but not nominally assignable (the same
    // documented cast pattern used elsewhere for this client shape).
    void recordErrorEvent(verifierClient as never, { fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const modelClient = new OpenRouterModelClient({
    apiKey,
    provider: providerPolicyFromEnv({
      AGENT_PROVIDER_ORDER: Deno.env.get('AGENT_PROVIDER_ORDER') ?? undefined,
      AGENT_PROVIDER_ONLY: Deno.env.get('AGENT_PROVIDER_ONLY') ?? undefined,
      AGENT_PROVIDER_IGNORE: Deno.env.get('AGENT_PROVIDER_IGNORE') ?? undefined,
      AGENT_PROVIDER_SORT: Deno.env.get('AGENT_PROVIDER_SORT') ?? undefined,
      AGENT_PROVIDER_ALLOW_FALLBACKS: Deno.env.get('AGENT_PROVIDER_ALLOW_FALLBACKS') ?? undefined,
      AGENT_PROVIDER_DATA_COLLECTION: Deno.env.get('AGENT_PROVIDER_DATA_COLLECTION') ?? undefined,
    }),
  });
  const model = resolveDefaultModel({ AGENT_MODEL_DEFAULT: Deno.env.get('AGENT_MODEL_DEFAULT') ?? undefined });

  // ── 5. Parse request body ─────────────────────────────────────────────────
  let body: AgentChatRequest;
  try {
    body = await req.json() as AgentChatRequest;
  } catch {
    return new Response(
      JSON.stringify({ status: 400, error: 'BAD_REQUEST', detail: 'invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── A3: Shared can() role sets for v1 write actions (FR-AW-010, ADR-0016) ────
  // Role sets imported from agentRoles.ts — single source of truth shared with policy.ts.
  // Drift guard: agentRoles.test.ts asserts these match the policy.ts RBAC expectations.
  // RLS/SoD is the enforcement authority; this is a UX preflight only (ADR-0016).
  const MASTER_DATA_SET = new Set(AGENT_MASTER_DATA_ROLES);
  const DELIVERY_WITH_ENGINEER_SET = new Set(AGENT_DELIVERY_WITH_ENGINEER_ROLES);
  const agentCan = (action: string, entity: string, ctx: { realRole: string | null }): boolean => {
    const role = ctx.realRole;
    if (!role) return false;
    if (entity === 'contactActivity' && action === 'create') return MASTER_DATA_SET.has(role);
    if (entity === 'taskStatus' && action === 'edit') return DELIVERY_WITH_ENGINEER_SET.has(role);
    return false;
  };

  // ── ADR-0043 §6: persistence deps bound to the SAME callerClient (never verifierClient/
  // service_role — the deputy invariant, AC-AGP-018). Gated on AGENT_PERSISTENCE (default ON;
  // Deno cannot read the SPA's Vite `agentAssistant` flag, so this is the mirrored server-side
  // gate — FR-AGP-026). When the flag is off, `persistence` stays undefined and every
  // persistence call site in handler.ts is a no-op by construction.
  const persistenceEnabled = Deno.env.get('AGENT_PERSISTENCE') !== 'false';

  // ── ADR-0044 §6 / FR-AUC-017: credit-backed RateGuard, independent of AGENT_PERSISTENCE.
  // Default OFF (spec Open Question 3) — matches today's `rateGuard: undefined` behavior so an
  // existing deployment with no seeded credits grants is not instantly locked out. An operator
  // flips this on once grant seed-data exists for their users.
  const creditsEnforced = Deno.env.get('AGENT_CREDITS_ENFORCED') === 'true';
  // orgId is resolved by the handler's own gate-2 profiles lookup; ownerId (== userId) is all
  // this entry point can supply up front. index.ts does not duplicate the profiles read —
  // persistence writes rely on RLS column DEFAULTs (owner_id default auth.uid(), org_id default
  // seed-org) rather than an explicit orgId here, so an empty string is a safe placeholder
  // (never sent to Postgres; RLS/DEFAULT stamps the real value).
  const journaledWrites = persistenceEnabled && body.runId
    ? await loadJournaledWrites(
        {
          // Cast: real SupabaseClient structurally satisfies HandlerSupabaseLike at runtime (both
          // are minimal Supabase-like interfaces), but checking that assignability against the
          // real client's full generic type here hits deno check's structural-recursion limit
          // (TS2589 "excessively deep") — a TS-engine limitation, not a real mismatch (every other
          // `supabase: callerClient` site in this file checks fine). Same bridging-cast convention
          // as `handler: agentChatHandler as never` elsewhere in this codebase.
          supabase: callerClient as never,
          ownerId: userId,
          orgId: '',
          now: () => new Date(),
        },
        body.runId,
      )
    : undefined;

  // ADR-0043 §2: seq continuity — a resumed run (body.runId already exists, e.g. a
  // req.decision re-POST) must continue the run's seq counter, never restart at 0 (which
  // would collide with the prior turn's already-persisted agent_events rows — silent
  // transcript misordering, since listRunEvents orders by seq). loadMaxSeq(runId) mirrors
  // loadJournaledWrites' same fail-safe style (-1 on error/no rows ⇒ startSeq 0, identical to
  // a fresh run). Only computed when body.runId is present — a fresh run has no prior seq.
  const startSeq = persistenceEnabled && body.runId
    ? (await loadMaxSeq(
        {
          // Cast: see the identical loadJournaledWrites cast above (TS2589 structural-recursion
          // limit, not a real mismatch).
          supabase: callerClient as never,
          ownerId: userId,
          orgId: '',
          now: () => new Date(),
        },
        body.runId,
      )) + 1
    : undefined;

  // ── 6. Pipe agentChatHandler events into SSE ReadableStream (D1/ADR-0042) ─
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // FR-AGP-016: client-disconnect continuation — an enqueue error (dropped socket) is
      // swallowed so the `for await` loop below keeps draining the generator to completion
      // server-side (persisting the remaining journal/heartbeat/terminal-status writes) rather
      // than breaking early and leaving the run's durable-resume state incomplete.
      let socketLive = true;
      // Built as its own explicitly-typed variable (rather than an inline object literal in the
      // call expression below): deno check's structural assignability recursion (TS2589
      // "excessively deep") is triggered by inferring+widening this large literal (6+
      // `supabase: callerClient` occurrences across nested sub-objects) THROUGH the call
      // expression's generic resolution — giving it a concrete `HandlerDeps` target to check
      // directly resolves the same real assignability with no cast needed (every field here is
      // the same real client the codebase already establishes structurally satisfies
      // HandlerSupabaseLike — Item 3's cast-cleanup rationale still holds).
      const deps: import('./handler.ts').HandlerDeps = {
        modelClient,
        model,
        // Cast: Item 3's original cast-cleanup rationale (real client structurally satisfies
        // HandlerSupabaseLike, checked fine under tsc) still holds; deno check's stricter/deeper
        // structural recursion over this large HandlerDeps literal (6 `supabase: callerClient`
        // occurrences combined) hits TS2589 without it — a TS-engine depth limit, not a real
        // mismatch (confirmed: this exact field alone, isolated, checks fine).
        supabase: callerClient as never,
        userId,
        // A3: injectable can() for deputy re-auth (FR-AW-010)
        can: agentCan,
        // A4: enable compose_view tool (Task 8b / FR-CV-024 / D7).
        // The SPA AND-gates panel rendering + ArtifactSlot on agentAssistant && aiComposer,
        // so enabling the tool here is harmless when the SPA never renders an artifact
        // (OQ-A4-2 recommendation — default true; add a function secret if needed).
        composeEnabled: true,
        // Cast: createCreditRateGuard's own generic resolution is what trips deno check's TS2589
        // recursion limit here (the direct `supabase: callerClient` field above, and everywhere
        // else in this HandlerDeps literal, checks fine unaided) — the real client structurally
        // satisfies CreditRateGuardDeps.supabase (HandlerSupabaseLike) at runtime; this is a
        // TS-engine depth limit, not a real mismatch.
        rateGuard: creditsEnforced ? createCreditRateGuard({ supabase: callerClient as never }) : undefined,
        // FR-AUC-004/018: usage recording is UNCONDITIONAL (no flag) — independent of both
        // AGENT_PERSISTENCE and AGENT_CREDITS_ENFORCED.
        usage: { supabase: callerClient as never },
        attachmentResolver: createAttachmentResolver(),
        persistence: persistenceEnabled
          ? {
              supabase: callerClient as never,
              ownerId: userId,
              orgId: '',
              now: () => new Date(),
              journaledWrites,
              startSeq,
            }
          : undefined,
      };
      try {
        for await (const ev of agentChatHandler(body, deps)) {
          if (!socketLive) continue; // keep draining for persistence; stop trying to enqueue
          try {
            controller.enqueue(enc.encode(encodeSse(ev)));
          } catch {
            // Dropped socket — stop enqueueing but keep the loop (and persistence) running.
            socketLive = false;
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed/errored (e.g. socket dropped) — nothing further to do.
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Baked git SHA of THIS deployed fn (scripts/stamp-edge-fns.sh). Lets the client —
      // and devtools Network — see which agent-chat build answered, so a stale deploy
      // (the prod symptom that hid the persistence fix) is visible on every response.
      'x-deploy-version': DEPLOY_VERSION,
    },
  });
});
