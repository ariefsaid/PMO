/**
 * composeSpec — extracted compose+repair logic, shared by:
 *   - composeViewHandler (the I5 HTTP edge fn path)
 *   - composeViewAction / runComposeView (the A4 agent-chat path)
 *
 * Pure: all I/O is injected via ComposeSpecDeps. No Deno globals.
 * Importable in Vitest (Node) with the Anthropic SDK mocked (ADR-0039 decision 7).
 *
 * D2/D3: extracts composeSpec() + ComposeSpecError from handler.ts so both callers share
 * exactly one compose+repair path (D-A4-1 — no second weaker path, ADR-0039).
 *
 * Reconciliation #2: CompilerContext = { userId, orgId } (userId needed for $current_user token).
 */

// Relative imports — no .ts extension; no @-alias (Deno + Node/Vitest both resolve these).
import { compileCompositionSpec } from '../../../pmo-portal/src/lib/viewspec/compiler';
import { ValidationError, ENTITY_WHITELIST, MAX_PANELS_PER_VIEW } from '../../../pmo-portal/src/lib/viewspec/types';
import { registry } from '../../../pmo-portal/src/lib/viewspec/registry';
import { COMPOSITION_SPEC_SCHEMA } from './schema';
import { buildSystemPrompt } from './prompt';
import type { CompositionSpec } from '../../../pmo-portal/src/lib/viewspec/types';

// ── Constants (shared with handler.ts) ───────────────────────────────────────

/**
 * Maximum number of repair attempts after initial compile failure (AS-OD-001).
 * Default 2 → up to 3 total model calls (initial + 2 repairs).
 */
export const MAX_REPAIR_ATTEMPTS = 2;

// ── Injected interfaces ───────────────────────────────────────────────────────

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
  messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }>;
  tools: Array<{
    name: string;
    description: string;
    input_schema: object;
  }>;
  tool_choice: { type: 'tool'; name: string };
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

export interface ComposeSpecDeps {
  /** Injected Anthropic-like client — mocked in tests; real SDK in handler/index.ts. */
  anthropic: AnthropicLike;
  /** Caller user ID — needed for the CompilerContext ($current_user token resolution). */
  userId: string;
}

// ── ComposeSpecError ──────────────────────────────────────────────────────────

/**
 * Thrown by composeSpec when the repair loop is exhausted or an upstream SDK error occurs.
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
  anthropic: AnthropicLike,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }>,
): Promise<{ spec: CompositionSpec; tokensUsed: number }> {
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system,
    messages,
    tools: [
      {
        name: 'compose_view',
        description: "Author a validated CompositionSpec v1 for the user's natural-language request.",
        input_schema: COMPOSITION_SPEC_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'compose_view' },
  });

  const toolUseBlock = response.content.find(
    (block) => block.type === 'tool_use' && block.name === 'compose_view',
  );

  if (!toolUseBlock || toolUseBlock.input == null) {
    throw new Error('Model did not return compose_view tool_use block');
  }

  const tokensUsed =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  return {
    spec: toolUseBlock.input as CompositionSpec,
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
 * Throws ComposeSpecError on exhaustion (REPAIR_EXHAUSTED) or upstream SDK error (UPSTREAM_ERROR).
 *
 * Logging discipline (NFR-CV-SEC-006 / NFR-AS-SEC-004): log only
 * { errorCode, repairAttempts, tokensUsed } — NEVER the prompt text or spec contents.
 */
export async function composeSpec(
  prompt: string,
  orgId: string,
  deps: ComposeSpecDeps,
): Promise<{ spec: CompositionSpec; repairAttempts: number; tokensUsed: number }> {
  const { anthropic, userId } = deps;

  const system = buildSystemPrompt(
    ENTITY_WHITELIST,
    registry.keys(),
    orgId,
    MAX_PANELS_PER_VIEW,
  );

  const ctx = { userId, orgId };

  const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string | object[] }> = [
    { role: 'user', content: prompt },
  ];

  let repairAttempts = 0;
  let totalTokensUsed = 0;

  try {
    while (true) {
      const { spec, tokensUsed } = await callModel(anthropic, system, conversationMessages);
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

        conversationMessages.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'repair_placeholder', name: 'compose_view', input: {} }],
        });
        conversationMessages.push({ role: 'user', content: repairFeedback });

        repairAttempts++;
      }
    }
  } catch (err) {
    if (err instanceof ComposeSpecError) {
      throw err;
    }
    // Upstream SDK or unexpected error
    console.error('[compose-view] UPSTREAM_ERROR', {
      errorCode: 'UPSTREAM_ERROR',
      repairAttempts,
      tokensUsed: totalTokensUsed,
    });
    throw new ComposeSpecError('UPSTREAM_ERROR', repairAttempts, totalTokensUsed);
  }
}
