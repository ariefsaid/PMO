/**
 * composeSpec — extracted compose+repair logic, shared by:
 *   - composeViewHandler (the I5 HTTP edge fn path)
 *   - composeViewAction / runComposeView (the A4 agent-chat path)
 *
 * Pure: all I/O is injected via ComposeSpecDeps. No Deno globals.
 * Importable in Vitest (Node) with the ModelClient mocked (ADR-0039 decision 7).
 *
 * D2/D3: extracts composeSpec() + ComposeSpecError from handler.ts so both callers share
 * exactly one compose+repair path (D-A4-1 — no second weaker path, ADR-0039).
 *
 * Reconciliation #2: CompilerContext = { userId, orgId } (userId needed for $current_user token).
 *
 * Provider swap (docs/specs/agent-model-client.spec.md, FR-MC-019/020):
 *   - ComposeSpecDeps.anthropic (AnthropicLike) → ComposeSpecDeps.modelClient (ModelClient) + model.
 *   - tool_choice forces compose_view via the OpenAI shape (FR-MC-004).
 *   - the repair-loop feedback is a single role:'user' text turn (FR-MC-020) — no placeholder.
 */

// Relative imports — no .ts extension; no @-alias (Deno + Node/Vitest both resolve these).
import { compileCompositionSpec } from '../../../pmo-portal/src/lib/viewspec/compiler.ts';
import { ValidationError, ENTITY_WHITELIST, MAX_PANELS_PER_VIEW } from '../../../pmo-portal/src/lib/viewspec/types.ts';
import { registry } from '../../../pmo-portal/src/lib/viewspec/registry.ts';
import { COMPOSITION_SPEC_SCHEMA } from './schema.ts';
import { buildSystemPrompt } from './prompt.ts';
import type { ModelClient, ModelMessage } from '../_shared/modelClient.ts';
import type { CompositionSpec } from '../../../pmo-portal/src/lib/viewspec/types.ts';

// ── Constants (shared with handler.ts) ───────────────────────────────────────

/**
 * Maximum number of repair attempts after initial compile failure (AS-OD-001).
 * Default 2 → up to 3 total model calls (initial + 2 repairs).
 */
export const MAX_REPAIR_ATTEMPTS = 2;

// ── Injected interfaces ───────────────────────────────────────────────────────

export interface ComposeSpecDeps {
  /** Vendor-neutral model client — mocked in tests; OpenRouterModelClient in handler/index.ts. */
  modelClient: ModelClient;
  /** Caller user ID — needed for the CompilerContext ($current_user token resolution). */
  userId: string;
  /** Resolved model id for this call (FR-MC-015 / MC-OD-009). */
  model: string;
}

// ── ComposeSpecError ──────────────────────────────────────────────────────────

/**
 * Thrown by composeSpec when the repair loop is exhausted or an upstream model-call error occurs.
 * The handler maps this to 422 (REPAIR_EXHAUSTED) or 502 (UPSTREAM_ERROR).
 */
export class ComposeSpecError extends Error {
  code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR';
  repairAttempts: number;
  tokensUsed: number;
  validationError?: { code: string; detail?: string };

  constructor(
    code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR',
    repairAttempts: number,
    tokensUsed: number,
    validationError?: { code: string; detail?: string },
  ) {
    super(`composeSpec failed: ${code}`);
    this.code = code;
    this.repairAttempts = repairAttempts;
    this.tokensUsed = tokensUsed;
    this.validationError = validationError;
  }
}

// ── Model call helper ─────────────────────────────────────────────────────────

async function callModel(
  modelClient: ModelClient,
  model: string,
  system: string,
  messages: ModelMessage[],
): Promise<{ spec: CompositionSpec; tokensUsed: number }> {
  const response = await modelClient.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'system', content: system }, ...messages],
    tools: [
      {
        type: 'function',
        function: {
          name: 'compose_view',
          description: "Author a validated CompositionSpec v1 for the user's natural-language request.",
          parameters: COMPOSITION_SPEC_SCHEMA,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'compose_view' } },
  });

  const toolCall = response.message.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== 'compose_view') {
    throw new Error('Model did not return a compose_view tool call');
  }

  const tokensUsed = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

  return {
    spec: JSON.parse(toolCall.function.arguments) as CompositionSpec,
    tokensUsed,
  };
}

// ── composeSpec (the shared compose+repair loop) ──────────────────────────────

/**
 * Compose and validate a CompositionSpec from a natural-language prompt.
 *
 * Implements the same tool-forcing + bounded repair loop as the I5 HTTP handler.
 * Called by both composeViewHandler and runComposeView — a single shared path (D-A4-1).
 *
 * Throws ComposeSpecError on exhaustion (REPAIR_EXHAUSTED) or upstream model-call error
 * (UPSTREAM_ERROR).
 *
 * Logging discipline (NFR-CV-SEC-006 / NFR-AS-SEC-004): log only
 * { errorCode, repairAttempts, tokensUsed } — NEVER the prompt text or spec contents.
 */
export async function composeSpec(
  prompt: string,
  orgId: string,
  deps: ComposeSpecDeps,
): Promise<{ spec: CompositionSpec; repairAttempts: number; tokensUsed: number }> {
  const { modelClient, userId, model } = deps;

  const system = buildSystemPrompt(
    ENTITY_WHITELIST,
    registry.keys(),
    orgId,
    MAX_PANELS_PER_VIEW,
  );

  const ctx = { userId, orgId };

  const conversationMessages: ModelMessage[] = [
    { role: 'user', content: prompt },
  ];

  let repairAttempts = 0;
  let totalTokensUsed = 0;

  try {
    while (true) {
      const { spec, tokensUsed } = await callModel(modelClient, model, system, conversationMessages);
      totalTokensUsed += tokensUsed;

      try {
        compileCompositionSpec(spec, ctx);
        // Compile succeeded
        return { spec, repairAttempts, tokensUsed: totalTokensUsed };
      } catch (err) {
        if (!(err instanceof ValidationError)) {
          throw err;
        }

        if (repairAttempts >= MAX_REPAIR_ATTEMPTS) {
          // Logging: only code + repairAttempts, never spec contents (NFR-CV-SEC-006)
          console.error('[compose-view] REPAIR_EXHAUSTED', {
            errorCode: err.code,
            repairAttempts: MAX_REPAIR_ATTEMPTS,
            tokensUsed: totalTokensUsed,
          });
          throw new ComposeSpecError(
            'REPAIR_EXHAUSTED',
            MAX_REPAIR_ATTEMPTS,
            totalTokensUsed,
            { code: err.code, detail: err.detail },
          );
        }

        const repairFeedback = err.detail
          ? `Validation failed: ${err.code} — ${err.detail}. Fix and re-emit a valid CompositionSpec.`
          : `Validation failed: ${err.code}. Fix and re-emit a valid CompositionSpec.`;

        // FR-MC-020: a single role:'user' text turn — no placeholder tool_use echo
        // needed under the OpenAI message shape (unlike Anthropic's requirement).
        conversationMessages.push({ role: 'user', content: repairFeedback });

        repairAttempts++;
      }
    }
  } catch (err) {
    if (err instanceof ComposeSpecError) {
      throw err;
    }
    // Upstream model-call error or unexpected error
    console.error('[compose-view] UPSTREAM_ERROR', {
      errorCode: 'UPSTREAM_ERROR',
      repairAttempts,
      tokensUsed: totalTokensUsed,
    });
    throw new ComposeSpecError('UPSTREAM_ERROR', repairAttempts, totalTokensUsed);
  }
}
