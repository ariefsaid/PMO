/**
 * agent-chat — Deno Edge Function entry point.
 * BUILD-TIME-VERIFY checklist (deploy-time, not CI):
 *   1. Streaming call form: messages.create({ ...params }) accumulates; check tool_use block id field.
 *   2. tool_use block shape: content_block.id is used as tool_use_id in the tool_result turn.
 *   3. stop_reason values: 'tool_use' vs 'end_turn' match the loop branches in handler.ts.
 *   4. supabase functions serve passes Content-Type: text/event-stream unbuffered.
 *   5. ANTHROPIC_API_KEY function secret set in deployed project (never committed).
 *
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision 7).
 * All business logic lives in handler.ts (pure, importable in Vitest).
 *
 * Responsibilities:
 *   1. CORS preflight handling.
 *   2. Read Authorization header; reject 401 if absent.
 *   3. Verify JWT using service-role client (service_role ONLY for auth.getUser — NFR-AR-SEC-002).
 *   4. Build caller-JWT Supabase client for all business data (deputy auth — FR-AR-014).
 *   5. Read ANTHROPIC_API_KEY from Deno.env (function secret — NFR-AR-SEC-001).
 *   6. Parse JSON body into AgentChatRequest.
 *   7. Delegate to agentChatHandler; pipe events into SSE ReadableStream (D1/ADR-0042).
 */

// Deno-native imports (not in pmo-portal/package.json)
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { agentChatHandler } from './handler.ts';
import { encodeSse } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import type { AgentChatRequest } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import {
  AGENT_MASTER_DATA_ROLES,
  AGENT_DELIVERY_WITH_ENGINEER_ROLES,
} from '../../../pmo-portal/src/auth/agentRoles.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  // ── 4. Read ANTHROPIC_API_KEY from function secrets (NFR-AR-SEC-001) ──────
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const anthropic = new Anthropic({ apiKey });

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

  // ── 6. Pipe agentChatHandler events into SSE ReadableStream (D1/ADR-0042) ─
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const ev of agentChatHandler(body, {
          // Cast: real Anthropic SDK satisfies AnthropicLike (same create() signature)
          anthropic: anthropic as unknown as Parameters<typeof agentChatHandler>[1]['anthropic'],
          // Cast: real callerClient satisfies HandlerSupabaseLike
          supabase: callerClient as unknown as Parameters<typeof agentChatHandler>[1]['supabase'],
          userId,
          // A3: injectable can() for deputy re-auth (FR-AW-010)
          can: agentCan,
          // A4: enable compose_view tool (Task 8b / FR-CV-024 / D7).
          // The SPA AND-gates panel rendering + ArtifactSlot on agentAssistant && aiComposer,
          // so enabling the tool here is harmless when the SPA never renders an artifact
          // (OQ-A4-2 recommendation — default true; add a function secret if needed).
          composeEnabled: true,
          // rateGuard: undefined (AR-OD-002 default — disabled in v1)
        })) {
          controller.enqueue(enc.encode(encodeSse(ev)));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
});
