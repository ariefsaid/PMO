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
 *   4. Read ANTHROPIC_API_KEY from Deno.env (function secret — NFR-AS-SEC-001).
 *   5. Parse the JSON body into ComposeViewRequest.
 *   6. Call composeViewHandler(req, { anthropic, supabase: callerClient, userId }).
 *   7. Return JSON response.
 *
 * The [functions.compose-view] config.toml block sets verify_jwt = false so the
 * handler can return a typed 401 body (not Supabase's untyped gate rejection).
 */

// Deno-native imports (not in pmo-portal/package.json — NFR ground-truth #4)
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { composeViewHandler } from './handler.ts';
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

  // ── 4. Read the Anthropic API key from function secrets (NFR-AS-SEC-001) ──
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Build Anthropic client (SDK imported via deno.json npm: specifier)
  const anthropic = new Anthropic({ apiKey });

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

  // ── 6. Delegate to the pure handler ───────────────────────────────────────
  const result = await composeViewHandler(body, {
    // Cast: the real Anthropic SDK satisfies AnthropicLike (same create() signature)
    anthropic: anthropic as unknown as Parameters<typeof composeViewHandler>[1]['anthropic'],
    supabase: callerClient as unknown as Parameters<typeof composeViewHandler>[1]['supabase'],
    userId,
    // rateGuard: undefined (AS-OD-002 default — disabled in v1)
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
