/**
 * compose-view — Deno Edge Function entry point.
 *
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision 7).
 * All business logic lives in handler.ts (pure, importable in Vitest).
 *
 * Responsibilities of this wrapper:
 *   1. Read the Authorization header; reject with 401 if absent.
 *   2. Verify the caller JWT LOCALLY against the project JWKS (ADR-0057 — asymmetric ES256, no
 *      auth.getUser round-trip). The service-role client is retained ONLY for the non-bypassable
 *      rate-guard + error-event RPCs (NFR-AS-SEC-002 — service_role never touches business data).
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
import { checkRequestRate } from '../_shared/requestRateGuard.ts';
import { OpenRouterModelClient, providerPolicyFromEnv } from '../_shared/openRouterModelClient.ts';
import { resolveComposeModel } from '../_shared/modelResolution.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { recordErrorEvent } from '../_shared/errorEvent.ts';
import type { ComposeViewRequest } from '../../../pmo-portal/src/lib/agent/types.ts';
import {
  verifyCallerJwt,
  bearerToken,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';

// ADR-0057: one cached, rate-limited JWKS resolver, memoized across warm invocations. Built lazily
// (not at module load) so an empty SUPABASE_URL can't throw a URL error before the handler can return
// a typed 500/401. `createRemoteJWKSet` fetches the ES256 public key on first verify and caches it.
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // AUDIT quick-win (2026-07-07): same origin-narrowing seam as agent-chat/index.ts —
  // set AGENT_ALLOWED_ORIGIN in prod; falls back to SITE_URL, then '' (fail-closed — never '*').
  const corsHeaders = {
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── 1. Read and validate the Authorization header (case-insensitive Bearer) ──
  // Use the shared, unit-tested bearerToken parser (audit #2) — single source of truth for the parse.
  const token = bearerToken(req.headers.get('Authorization'));
  if (!token) {
    return new Response(
      JSON.stringify({ status: 401, error: 'UNAUTHORIZED', detail: 'missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── 2. Verify the caller JWT LOCALLY against the project JWKS (ADR-0057) ──
  // Asymmetric ES256 signature check via the cached JWKS — no auth.getUser round-trip to GoTrue.
  // compose-view's data path is caller-JWT + RLS (deputy client, step 3) and does NOT escalate to
  // service_role, so local verification alone is sufficient here (ADR-0057 §Decision-3 — the
  // banned-user staleness window is absorbed by RLS on every row). The service-role client is still
  // built, but ONLY for the non-bypassable rate-guard + error-event RPCs below — never business data
  // (NFR-AS-SEC-002 preserved). Any signature/expiry/issuer/audience/alg failure → a single typed 401.
  // Normalize a possible trailing slash (audit #3) so the derived issuer/JWKS URL never doubles a
  // slash — a malformed SUPABASE_URL would otherwise fail-closed the whole function.
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const verifierClient = createClient(supabaseUrl, serviceRoleKey);

  let userId: string;
  try {
    const verified = await verifyCallerJwt(token, getJwks(supabaseUrl), {
      issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      audience: 'authenticated', // pin at the call site (audit #1) — don't lean on the helper default
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    return new Response(
      JSON.stringify({ status, error: 'UNAUTHORIZED', detail: 'invalid JWT' }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── 2b. Request-rate throttle (IG-audit 2026-07-10, migration 0091) ───────
  // Bounds how OFTEN one verified user may trigger a compose (model spend), independent of credits.
  // Keyed by verified user id; service-role verifier RPC (non-bypassable). Fail-open (availability
  // defense — see requestRateGuard.ts). COMPOSE_RATE_LIMIT_PER_MIN overrides the default.
  const composeRateLimitPerMin = Number(Deno.env.get('COMPOSE_RATE_LIMIT_PER_MIN')) || 20;
  const composeRate = await checkRequestRate(verifierClient as never, {
    key: `compose-view:${userId}`,
    limit: composeRateLimitPerMin,
    windowSecs: 60,
  });
  if (composeRate.exceeded) {
    return new Response(
      JSON.stringify({ status: 429, error: 'RATE_LIMITED', detail: 'too many requests' }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(composeRate.retryAfterSeconds),
        },
      },
    );
  }

  // ── 3. Build caller-JWT Supabase client (deputy auth — FR-AS-010) ─────────
  // All business data (profiles lookup for org_id) goes through this client.
  // RLS scopes it exactly as the human user.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // ── 4. Read the OpenRouter API key from function secrets (NFR-MC-SEC-001) ──
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    logStructuredError({ fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    // Cast: the real supabase-js client's .from().insert() returns a thenable
    // PostgrestFilterBuilder, not a plain Promise — a structural superset of
    // ErrorEventSupabaseLike at runtime, but not nominally assignable.
    void recordErrorEvent(verifierClient as never, { fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Build the vendor-neutral model client (OpenRouter transport, deepseek-v4-flash default).
  // Same privacy-first backend routing policy as agent-chat (providerPolicyFromEnv).
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
