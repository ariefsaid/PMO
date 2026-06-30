/**
 * agentChatHandler — pure async generator for the agent-chat edge function.
 *
 * Pure: all I/O injected via HandlerDeps. No Deno globals, no process.env.
 * Importable in Vitest (Node) with Anthropic SDK + Supabase mocked.
 *
 * ADR-0039 decision 7: handler is CI-testable; index.ts (Deno.serve) is not.
 * D2: handler = async function* agentChatHandler(req, deps): AsyncIterable<AgentEvent>
 * D7/R4: MAX_TOOL_ROUNDS=8 → terminal completed (not errored) with "reached step limit"
 * NFR-AR-SEC-005: no prompt/row content logged; only turn/error counts.
 */

// Relative imports — no .ts extension; no @-alias.
import {
  queryEntityAction,
  AGENT_READ_ENTITIES,
  AGENT_READ_ROW_CAP,
} from './actions';
import { buildAgentSystemPrompt } from './prompt';
import type { AgentEvent, AgentRunStatus } from '../../../pmo-portal/src/lib/agent/runtime/port';
import type { AgentChatRequest, ConversationMessage } from '../../../pmo-portal/src/lib/agent/runtime/transport';

// ── Constants (D7) ────────────────────────────────────────────────────────────

/** Hard cap on tool-use rounds per run. D7. */
export const MAX_TOOL_ROUNDS = 8;

// ── Injected interfaces ────────────────────────────────────────────────────────

/** Minimal Anthropic-like interface for messages.create. */
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
  tools: Array<{ name: string; description: string; input_schema: object }>;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
}

export interface AnthropicResponse {
  stop_reason: string;
  content: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Minimal Supabase-like interface supporting the profiles lookup (.single()) and
 * entity reads (.limit()). The same SupabaseLike from port.ts but with .single() added
 * for the profiles gate.
 */
export interface HandlerSupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): Promise<{ data: { org_id: string } | null; error: unknown }>;
        limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
        in(column: string, values: string[]): { limit(n: number): Promise<{ data: unknown[] | null; error: unknown }> };
      };
      limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/** Injectable rate guard (AS-OD-002 — disabled by default). */
export interface RateGuard {
  check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number }>;
}

export interface HandlerDeps {
  anthropic: AnthropicLike;
  supabase: HandlerSupabaseLike;
  userId: string;
  rateGuard?: RateGuard;
  now?: () => Date;
}

// ── Event builders ─────────────────────────────────────────────────────────────

function makeId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function mkEvent(
  runId: string,
  type: AgentEvent['type'],
  fields: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>,
  now: () => Date,
): AgentEvent {
  return {
    id: makeId(),
    runId,
    type,
    createdAt: now().toISOString(),
    ...fields,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * agentChatHandler — the pure business-logic generator.
 *
 * Gate order (each gate yields terminal status and returns):
 *   (1) 401 UNAUTHORIZED — userId empty (AC-AR-002)
 *   (2) 400 BAD_REQUEST(orgId) — profiles lookup fails (AC-AR-003)
 *   (3) 429 RATE_LIMITED — rate guard exceeded (D9/AR-OD-002)
 *   (4) tool-use loop — up to MAX_TOOL_ROUNDS (AC-AR-001, AC-AR-004)
 *   (5) 502 UPSTREAM_ERROR — SDK throws; error scrubbed (AC-AR-005)
 */
export async function* agentChatHandler(
  req: AgentChatRequest,
  deps: HandlerDeps,
): AsyncIterable<AgentEvent> {
  const now = deps.now ?? (() => new Date());
  const runId = req.runId ?? makeId();

  const emit = (
    type: AgentEvent['type'],
    fields: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>> = {},
  ): AgentEvent => mkEvent(runId, type, fields, now);

  const statusEvent = (
    status: AgentRunStatus,
    extra: Record<string, unknown> = {},
    text?: string,
  ): AgentEvent =>
    emit('status', { payload: { status, ...extra }, text });

  // ── Gate (1): userId present (AC-AR-002) ──────────────────────────────────
  if (!deps.userId) {
    yield statusEvent('errored', { error: 'UNAUTHORIZED' });
    return;
  }

  // ── Gate (2): org lookup via caller JWT (AC-AR-003) ───────────────────────
  let orgId: string;
  try {
    const { data, error } = await deps.supabase
      .from('profiles')
      .select('org_id')
      .eq('id', deps.userId)
      .single();

    if (error || !data) {
      yield statusEvent('errored', { error: 'BAD_REQUEST', detail: 'orgId' });
      return;
    }
    orgId = data.org_id;
  } catch {
    yield statusEvent('errored', { error: 'BAD_REQUEST', detail: 'orgId' });
    return;
  }

  // ── Gate (3): rate guard (AR-OD-002, D9) ─────────────────────────────────
  if (deps.rateGuard) {
    const r = await deps.rateGuard.check(deps.userId);
    if (r.exceeded) {
      yield statusEvent('errored', {
        error: 'RATE_LIMITED',
        retryAfterSeconds: r.retryAfterSeconds,
      });
      return;
    }
  }

  // ── Yield the last user message ────────────────────────────────────────────
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg) {
    yield emit('user', {
      text: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : undefined,
    });
  }

  // ── Build system prompt ────────────────────────────────────────────────────
  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);

  // The full conversation messages for the Anthropic API
  const messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }> =
    req.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content as object[]),
    }));

  // ── Tool-use loop (AC-AR-001, AC-AR-004) ──────────────────────────────────
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await deps.anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        system,
        messages,
        tools: [
          {
            name: queryEntityAction.name,
            description: queryEntityAction.description,
            input_schema: queryEntityAction.inputSchema,
          },
        ],
      });

      // Emit any text blocks as assistant events
      for (const block of resp.content) {
        if (block.type === 'text' && block.text) {
          yield emit('assistant', { text: block.text });
        }
      }

      // Blocker 3: use the API's own sentinel — stop_reason !== 'tool_use' means
      // no tool dispatch needed, regardless of whether content happens to contain
      // a tool_use block. Also handle max_tokens explicitly.
      if (resp.stop_reason === 'max_tokens') {
        // Token budget exhausted — complete with a truncation note so the caller
        // can distinguish this from a real final answer.
        yield statusEvent('completed', {}, 'response truncated');
        return;
      }

      const toolBlock = resp.content.find((b) => b.type === 'tool_use');

      if (resp.stop_reason !== 'tool_use') {
        // No tool call — final answer (end_turn or any other non-tool stop reason)
        yield statusEvent('completed');
        return;
      }

      // Dispatch the tool
      const toolInput = toolBlock.input;
      const toolResult = await queryEntityAction.run(toolInput, {
        jwt: '',
        userId: deps.userId,
        orgId,
        supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port').SupabaseLike,
      });

      yield emit('tool', {
        payload: {
          name: toolBlock.name,
          input: toolInput,
          result: toolResult,
        },
      });

      // Append assistant tool_use turn + user tool_result turn for the next round
      messages.push({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: toolBlock.id ?? 'tool-use-id',
            name: toolBlock.name,
            input: toolInput,
          },
        ],
      });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolBlock.id ?? 'tool-use-id',
            content: JSON.stringify(toolResult),
          },
        ],
      });
    }

    // Loop fell through — step cap reached (D7/R4: graceful completed, not errored)
    yield statusEvent('completed', {}, 'reached step limit');
  } catch {
    // ── Upstream error → scrub, never echo raw error (AC-AR-005, NFR-AR-SEC-005)
    // Log only event metadata — never req.messages, tool inputs, or rows.
    console.error('[agent-chat] UPSTREAM_ERROR', {
      errorCode: 'UPSTREAM_ERROR',
      round: 'unknown',
    });
    yield statusEvent('errored', { error: 'UPSTREAM_ERROR' });
  }
}
