/**
 * compose-view — Deno Edge Function entry point.
 *
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision 7).
 * All business logic lives in handler.ts (pure, importable in Vitest).
 *
 * Responsibilities of this wrapper:
 *   1. Read the Authorization header; reject with 401 if absent.
 *   2. Verify the JWT using the service-role Supabase client
 *      (NFR-AS-SEC-002 — service_role ONLY for JWT verification, never business data).
 *   3. Build a SECOND caller-JWT Supabase client for business data (deputy auth,
 *      NFR-AS-SEC-001/006, FR-AS-010, ADR-0039 decision 2).
 *   4. Read OPENROUTER_API_KEY from Deno.env (function secret — NFR-MC-SEC-001).
 *   5. Parse the JSON body into ComposeViewRequest.
 *   6. Call composeViewHandler(req, { modelClient, model, supabase: callerClient, userId }).
 *   7. Return JSON response.
 *
 * The [functions.compose-view] config.toml block sets verify_jwt = false so the
 * handler can return a typed 401 body (not Supabase's untyped gate rejection).
 */

// Deno-native imports (not in pmo-portal/package.json — NFR ground-truth #4)
import { createClient } from '@supabase/supabase-js';
import { composeViewHandler } from './handler.ts';
import { createCreditRateGuard } from '../_shared/creditRateGuard.ts';
import { OpenRouterModelClient } from '../_shared/openRouterModelClient.ts';
import { resolveComposeModel } from '../_shared/modelResolution.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import type { ComposeViewRequest } from '../../../pmo-portal/src/lib/agent/types.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── 1. Read and validate the Authorization header ──────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ status: 401, error: 'UNAUTHORIZED', detail: 'missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const jwt = authHeader.slice(7); // strip "Bearer "

  // ── 2. Verify JWT using service-role client (NFR-AS-SEC-002) ─────────────
  // service_role is used ONLY here to call auth.getUser(jwt).
  // NEVER used for business data queries (ADR-0039 decision 2).
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

  // ── 3. Build caller-JWT Supabase client (deputy auth — FR-AS-010) ─────────
  // All business data (profiles lookup for org_id) goes through this client.
  // RLS scopes it exactly as the human user.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // ── 4. Read the OpenRouter API key from function secrets (NFR-MC-SEC-001) ──
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    logStructuredError({ fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Build the vendor-neutral model client (OpenRouter transport, deepseek-v4-flash default).
  const modelClient = new OpenRouterModelClient({ apiKey });
  const model = resolveComposeModel({
    AGENT_MODEL_DEFAULT: Deno.env.get('AGENT_MODEL_DEFAULT') ?? undefined,
    AGENT_MODEL_COMPOSE: Deno.env.get('AGENT_MODEL_COMPOSE') ?? undefined,
  });

  // ── 5. Parse request body ─────────────────────────────────────────────────
  let body: ComposeViewRequest;
  try {
    body = await req.json() as ComposeViewRequest;
  } catch {
    return new Response(
      JSON.stringify({ status: 400, error: 'BAD_REQUEST', detail: 'invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── ADR-0044 §6 / FR-AUC-015/017: the SAME credit-backed RateGuard + env toggle as
  // agent-chat — a user's compose-view calls and agent-chat calls draw from one shared
  // balance, not two independent budgets. Default OFF, mirrors agent-chat/index.ts.
  const creditsEnforced = Deno.env.get('AGENT_CREDITS_ENFORCED') === 'true';

  // ── 6. Delegate to the pure handler ───────────────────────────────────────
  // Item 3 (cast cleanup): OpenRouterModelClient structurally satisfies ModelClient and the
  // real Supabase client structurally satisfies HandlerSupabaseLike — no cast needed
  // (previously an `as unknown as` bridge that TS never actually required).
  const result = await composeViewHandler(body, {
    modelClient,
    model,
    // Cast: Item 3's original cast-cleanup rationale (real client structurally satisfies
    // HandlerSupabaseLike, checked fine under tsc) still holds; deno check's stricter structural
    // recursion over this HandlerDeps literal (multiple `supabase: callerClient` occurrences
    // combined) hits TS2589 without it — a TS-engine depth limit, not a real mismatch (see
    // agent-chat/index.ts's identical, more heavily documented instance of this same bridge).
    supabase: callerClient as never,
    userId,
    rateGuard: creditsEnforced ? createCreditRateGuard({ supabase: callerClient as never }) : undefined,
    // FR-AUC-002/015: usage recording is UNCONDITIONAL (no flag).
    usage: { supabase: callerClient as never },
  });

  // ── 7. Return JSON response ───────────────────────────────────────────────
  return new Response(
    JSON.stringify(result.body),
    {
      status: result.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
