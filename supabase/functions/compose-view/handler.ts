/**
 * composeViewHandler — pure business-logic handler for the compose-view edge function.
 *
 * Pure: all I/O is injected via HandlerDeps. No Deno globals, no process.env reads.
 * Importable in Vitest (Node) with the Anthropic SDK and Supabase client mocked.
 *
 * ADR-0039 decision 7: handler is CI-testable with SDK mocked; the Deno.serve wrapper
 * (index.ts) is integration-only and not unit-tested.
 *
 * Reconciliation #1: compileCompositionSpec THROWS (fail-fast); the loop feeds one error.
 * Reconciliation #2: CompilerContext = { userId, orgId } (subset; teamId/projectId omitted).
 * Reconciliation #4: org_id derived from profiles under caller JWT (not JWT claims).
 */

// Relative imports so this module resolves under both Deno and Node/Vitest (Option B).
// No .ts extension: Vite/Node resolves TypeScript modules without extensions.
import { compileCompositionSpec } from '../../../pmo-portal/src/lib/viewspec/compiler';
import { ValidationError, ENTITY_WHITELIST, MAX_PANELS_PER_VIEW } from '../../../pmo-portal/src/lib/viewspec/types';
import { registry } from '../../../pmo-portal/src/lib/viewspec/registry';
import { COMPOSITION_SPEC_SCHEMA } from './schema';
import { buildSystemPrompt } from './prompt';
import type { ComposeViewRequest, ComposeViewResponse, ComposeViewError } from '../../../pmo-portal/src/lib/agent/types';
import type { CompositionSpec } from '../../../pmo-portal/src/lib/viewspec/types';

// ── Owner-decision flags ───────────────────────────────────────────────────────

/**
 * Maximum number of repair attempts after initial compile failure (AS-OD-001).
 * Default 2 → up to 3 total model calls (initial + 2 repairs).
 */
export const MAX_REPAIR_ATTEMPTS = 2;

// ── Injected interfaces ────────────────────────────────────────────────────────

/**
 * Minimal Anthropic-like interface for the messages.create call.
 * The real @anthropic-ai/sdk is never imported here (NFR: no SDK in pmo-portal).
 * Unit tests mock this; index.ts injects the real SDK instance.
 */
export interface AnthropicLike {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicResponse>;
  };
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: Array<{
    name: string;
    description: string;
    input_schema: object;
  }>;
  tool_choice: { type: 'tool'; name: string };
  // Note: thinking param omitted — shape not confirmed against installed SDK version.
  // Add `thinking: { type: 'enabled', budget_tokens: N }` after verifying the param shape
  // against @anthropic-ai/sdk at build time (ADR-0039 decision 6).
}

export interface AnthropicResponse {
  content: Array<{
    type: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Minimal Supabase-like interface for the profiles lookup.
 * Only the chained call `from('profiles').select('org_id').eq('id', userId).single()` is used.
 */
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): Promise<{ data: { org_id: string } | null; error: unknown }>;
      };
    };
  };
}

/**
 * Per-user rate guard (AS-OD-002). Undefined in v1 production (disabled).
 * Injected as a testable interface so enabling it later is config, not a rewrite.
 */
export interface RateGuard {
  check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number }>;
}

export interface HandlerDeps {
  /** Injected Anthropic-like client — mocked in tests; real SDK in index.ts. */
  anthropic: AnthropicLike;
  /** Injected caller-JWT Supabase client — mocked in tests; real caller-JWT client in index.ts. */
  supabase: SupabaseLike;
  /** Verified caller user ID (auth.uid()); extracted by index.ts. Empty string = unauthorized. */
  userId: string;
  /** Optional rate guard — undefined disables rate limiting (AS-OD-002 default). */
  rateGuard?: RateGuard;
  /** Injectable clock for testing — defaults to () => new Date(). */
  now?: () => Date;
}

// ── Handler result type ────────────────────────────────────────────────────────

type HandlerResult =
  | { status: 200; body: ComposeViewResponse }
  | { status: 400; body: ComposeViewError }
  | { status: 401; body: ComposeViewError }
  | { status: 422; body: ComposeViewError }
  | { status: 429; body: ComposeViewError }
  | { status: 502; body: ComposeViewError };

// ── Model call helper (Task 13) ────────────────────────────────────────────────

/**
 * Call the Anthropic SDK with tool-forcing and accumulate the response.
 * AS-OD-004: accumulate server-side; single JSON response (no SSE).
 * NFR-AS-PERF-001: streaming is the correct pattern for production Deno; in the
 * mocked unit-test path this helper just resolves the mock directly.
 *
 * The model is called with `compose_view` tool forced (ADR-0039 decision 6).
 * `thinking` param is intentionally omitted here — verify the param shape against
 * the installed @anthropic-ai/sdk before adding it (see AnthropicCreateParams above).
 */
async function callModel(
  anthropic: AnthropicLike,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ spec: CompositionSpec; tokensUsed: number }> {
  // Tool-forcing pattern (ADR-0039 decision 6 / FR-AS-005):
  // Force the compose_view tool; the response content will be a tool_use block.
  // Streaming: in Deno production, messages.stream() would be used; the injected mock resolves
  // synchronously — both paths produce the same result object shape.
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system,
    messages,
    tools: [
      {
        name: 'compose_view',
        description: 'Author a validated CompositionSpec v1 for the user\'s natural-language request.',
        input_schema: COMPOSITION_SPEC_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'compose_view' },
  });

  // Extract the tool_use block named 'compose_view'
  const toolUseBlock = response.content.find(
    (block) => block.type === 'tool_use' && block.name === 'compose_view',
  );

  if (!toolUseBlock || toolUseBlock.input == null) {
    // Model did not return the forced tool — unexpected; treat as upstream error
    throw new Error('Model did not return compose_view tool_use block');
  }

  const tokensUsed =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  return {
    spec: toolUseBlock.input as CompositionSpec,
    tokensUsed,
  };
}

// ── Main handler ───────────────────────────────────────────────────────────────

/**
 * composeViewHandler — the pure business-logic handler.
 *
 * Gate order (each gate returns before reaching the model call):
 *   (1) 401 — userId empty (AC-AS-004)
 *   (2) 400 — prompt empty or > 2000 chars (AC-AS-006)
 *   (3) 400 — org mismatch via profiles lookup (AC-AS-005, Recon #4)
 *   (4) 429 — rate guard exceeded (AC-AS-008, optional)
 *   (5) model call → compile → 200 / repair loop / 422 (AC-AS-001,002,003)
 *   (6) 502 — upstream error, raw SDK error scrubbed (AC-AS-007)
 *
 * Logging discipline (NFR-AS-SEC-004): log only { error code, repairAttempts, tokensUsed }.
 * NEVER log req.prompt or spec contents.
 */
export async function composeViewHandler(
  req: ComposeViewRequest,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const { anthropic, supabase, userId, rateGuard } = deps;

  // ── Gate (1): userId present (AC-AS-004, NFR-AS-SEC-002) ──────────────────
  if (!userId) {
    return {
      status: 401,
      body: { status: 401, error: 'UNAUTHORIZED', detail: 'missing userId' },
    };
  }

  // ── Gate (2): input validation — prompt (AC-AS-006, FR-AS-012) ─────────────
  if (!req.prompt || req.prompt.length === 0) {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'prompt' },
    };
  }
  if (req.prompt.length > 2000) {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'prompt' },
    };
  }

  // ── Gate (3): org match via profiles under caller JWT (AC-AS-005, Recon #4) ─
  // NFR-AS-SEC-003: org mismatch → 400 before any LLM call.
  // Deputy auth: profiles lookup goes through the caller-JWT client (not service_role).
  let profileOrgId: string | null = null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return {
        status: 400,
        body: { status: 400, error: 'BAD_REQUEST', detail: 'orgId' },
      };
    }
    profileOrgId = data.org_id;
  } catch {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'orgId' },
    };
  }

  if (profileOrgId !== req.orgId) {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'orgId' },
    };
  }

  // ── Gate (4): rate guard (AC-AS-008, AS-OD-002 — disabled by default) ───────
  if (rateGuard) {
    const rateResult = await rateGuard.check(userId);
    if (rateResult.exceeded) {
      return {
        status: 429,
        body: {
          status: 429,
          error: 'RATE_LIMITED',
          retryAfterSeconds: rateResult.retryAfterSeconds,
        },
      };
    }
  }

  // ── Build system prompt ────────────────────────────────────────────────────
  const system = buildSystemPrompt(
    ENTITY_WHITELIST,
    registry.keys(),
    req.orgId,
    MAX_PANELS_PER_VIEW,
  );

  // ── CompilerContext (Reconciliation #2) ───────────────────────────────────
  const ctx = { userId, orgId: req.orgId };

  // ── Model call + compile + bounded repair loop (AC-AS-001, 002, 003) ──────
  // Wrap the entire model-call section; any non-ValidationError → 502 (AC-AS-007).
  const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: req.prompt },
  ];

  let repairAttempts = 0;
  let lastValidationError: ValidationError | null = null;
  let totalTokensUsed = 0;

  try {
    while (true) {
      // Call the model (streaming accumulated into one response)
      const { spec, tokensUsed } = await callModel(anthropic, system, conversationMessages);
      totalTokensUsed += tokensUsed;

      // Compile the spec (Reconciliation #1: throws on first error)
      try {
        compileCompositionSpec(spec, ctx);
        // Compile succeeded — return 200
        return {
          status: 200,
          body: {
            spec,
            repairAttempts,
            tokensUsed: totalTokensUsed,
          },
        };
      } catch (err) {
        if (!(err instanceof ValidationError)) {
          // Non-validation error during compile — rethrow to 502 handler
          throw err;
        }

        lastValidationError = err;

        // Check if we've exhausted repair attempts
        if (repairAttempts >= MAX_REPAIR_ATTEMPTS) {
          // 422 REPAIR_EXHAUSTED (AC-AS-003)
          // Logging: only code + repairAttempts, never spec contents (NFR-AS-SEC-004)
          console.error('[compose-view] REPAIR_EXHAUSTED', {
            errorCode: err.code,
            repairAttempts: MAX_REPAIR_ATTEMPTS,
            tokensUsed: totalTokensUsed,
          });
          return {
            status: 422,
            body: {
              status: 422,
              error: 'REPAIR_EXHAUSTED',
              validationError: { code: err.code, detail: err.detail },
              repairAttempts: MAX_REPAIR_ATTEMPTS,
            },
          };
        }

        // Build repair message (Reconciliation #1: single code+detail, never SQL/stack)
        // FR-AS-025: include only code and detail, never raw SQL or stack traces.
        const repairFeedback = err.detail
          ? `Validation failed: ${err.code} — ${err.detail}. Fix and re-emit a valid CompositionSpec.`
          : `Validation failed: ${err.code}. Fix and re-emit a valid CompositionSpec.`;

        conversationMessages.push({ role: 'assistant', content: '[compose_view tool call]' });
        conversationMessages.push({ role: 'user', content: repairFeedback });

        repairAttempts++;
      }
    }
  } catch (err) {
    // ── Gate (6): upstream error → 502 (AC-AS-007) ─────────────────────────
    // NFR-AS-SEC-004: log only error code, never req.prompt or spec contents.
    // The raw SDK error is NEVER echoed to the client (FR-AS-008).
    console.error('[compose-view] UPSTREAM_ERROR', {
      errorCode: 'UPSTREAM_ERROR',
      repairAttempts,
      tokensUsed: totalTokensUsed,
      // err.message intentionally NOT logged — may contain SDK internals
    });

    // Check if the error was a validation error from a non-repair path (should not happen
    // given the loop structure, but guard for safety)
    if (lastValidationError && repairAttempts >= MAX_REPAIR_ATTEMPTS) {
      return {
        status: 422,
        body: {
          status: 422,
          error: 'REPAIR_EXHAUSTED',
          validationError: { code: lastValidationError.code, detail: lastValidationError.detail },
          repairAttempts: MAX_REPAIR_ATTEMPTS,
        },
      };
    }

    return {
      status: 502,
      body: {
        status: 502,
        error: 'UPSTREAM_ERROR',
        detail: 'model call failed',
      },
    };
  }
}
