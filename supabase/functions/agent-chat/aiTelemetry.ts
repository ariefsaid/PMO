import { clampUsageValue } from '../_shared/usage.ts';
import {
  emitAiEval, emitAiGeneration, emitAiSpan, emitAiTrace,
  type AiAction, type AiLink, type AiMessage,
} from '../_shared/posthogAi.ts';
import type { ModelClient, ModelMessage, ModelResponse } from '../_shared/modelClient.ts';
import { serverTelemetryEnabled } from '../_shared/posthogServer.ts';
import { evalSampled, isAllowedJudgeModel, runJudge } from './aiJudge.ts';

/**
 * Per-run AI telemetry (#1532 S1). Created once in agentChatHandler, carried on `deps.ai`.
 *
 * Privacy contract (provable, tested both ways):
 *  - Text (prompts, replies, tool I/O) is attached ONLY when the org's `lifecycle_state` is exactly
 *    'demo' AND the user sent the analytics-consent flag. Every other case (live, test, unknown,
 *    lookup error, no consent) sends numbers and codes only: the emitter allowlist drops text keys.
 *  - `$session_id` / `user_id` are attached ONLY with the consent flag.
 *  - The online-eval judge reads text in memory only; PostHog receives booleans.
 * Every emission is fire-and-forget and swallows its own failure (NFR-PHO-REL-001).
 */
export interface AiRunContext {
  runId: string;
  threadId?: string;
  action: AiAction;
  userId: string;
  analytics?: { consent: true; sessionId?: string };
  modelClient: Pick<ModelClient, 'create'>;
  model: string;
}

export interface AiRunTelemetry {
  /** Resolves the org's lifecycle once; every emission waits for it (fail closed on error). */
  setOrg(orgId: string, supabase: LifecycleLookup): void;
  setTools(catalog: string[]): void;
  /** `input` = the messages sent to the model (used only on the demo-text path). */
  generation(resp: { model: string; usage?: ModelResponse['usage']; message?: ModelResponse['message'] },
    latencyMs: number, err?: { code: string; status: number }, input?: ModelMessage[]): void;
  span(toolName: string, latencyMs: number, isError: boolean, io?: { input: unknown; output: unknown }): void;
  /** Watches the event stream: question, last answer, tool outcomes (judge input + demo trace text). */
  observe(ev: { type: string; text?: string; payload?: unknown }): void;
  trace(status: 'completed' | 'errored', errorCode?: string): void;
}

export interface LifecycleLookup {
  from(table: string): { select(cols: string): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }> } };
}

const MAX_CONTEXT_MESSAGES = 20;
const toText = (m: ModelMessage): AiMessage => ({
  role: m.role,
  content: m.content ?? (m.tool_calls ? `[tool call: ${m.tool_calls.map((t) => t.function.name).join(', ')}]` : ''),
});
const json = (v: unknown): string => { try { return JSON.stringify(v) ?? ''; } catch { return ''; } };

export function createAiRunTelemetry(ctx: AiRunContext): AiRunTelemetry {
  let orgId = '';
  let demo = false;
  let ready: Promise<void> = Promise.resolve();
  let lastGeneration: string | undefined;
  let catalog: string[] = [];
  let question = '';
  let answer = '';
  const tools: { name: string; error: boolean }[] = [];
  const startedAt = Date.now();
  const consent = ctx.analytics?.consent === true;
  const link: AiLink | undefined = consent ? { sessionId: ctx.analytics?.sessionId, userId: ctx.userId } : undefined;
  const textOk = () => demo && consent;
  // ponytail: emission errors are swallowed on purpose (never alter the run); the emitters' own
  // strict mode already fails unit tests for an allowlist breach.
  const later = (fn: () => Promise<unknown>) => { void ready.then(fn).then(() => undefined, () => undefined); };

  return {
    setOrg(o, supabase) {
      // No PostHog key (tests, local, unconfigured deploy): stay a no-op, no lookups and no judge spend.
      if (orgId || !serverTelemetryEnabled()) return;
      orgId = o;
      ready = (async () => {
        try {
          const { data, error } = await supabase.from('organizations').select('lifecycle_state').limit(1);
          demo = !error && (data?.[0] as { lifecycle_state?: unknown } | undefined)?.lifecycle_state === 'demo';
        } catch { demo = false; }
      })();
    },
    setTools(c) { catalog = c; },
    generation(resp, latencyMs, err, input) {
      if (!orgId) return;
      const spanId = crypto.randomUUID();
      lastGeneration = spanId;
      const u: Partial<NonNullable<ModelResponse['usage']>> = resp.usage ?? {};
      const out = resp.message;
      later(() => emitAiGeneration('agent-chat', {
        traceId: ctx.runId, spanId, sessionId: ctx.threadId ?? ctx.runId, model: resp.model,
        inputTokens: clampUsageValue(u.prompt_tokens), outputTokens: clampUsageValue(u.completion_tokens),
        costUsd: clampUsageValue(u.total_cost), latencySeconds: latencyMs / 1000,
        isError: !!err, httpStatus: err?.status ?? 200, action: ctx.action, orgId,
        cachedTokens: clampUsageValue(u.cached_tokens), reasoningTokens: clampUsageValue(u.reasoning_tokens),
        errorCode: err?.code, link,
        text: textOk() && input
          ? {
            input: input.filter((m) => m.role !== 'system').slice(-MAX_CONTEXT_MESSAGES).map(toText),
            output: out ? [toText({ role: 'assistant', content: out.content, tool_calls: out.tool_calls })] : [],
          }
          : undefined,
      }));
    },
    span(toolName, latencyMs, isError, io) {
      if (!orgId) return;
      const parentId = lastGeneration;
      later(() => emitAiSpan('agent-chat', {
        traceId: ctx.runId, spanId: crypto.randomUUID(), parentId, name: toolName, latencySeconds: latencyMs / 1000,
        isError, orgId, link,
        text: textOk() && io ? { input: json(io.input), output: json(io.output) } : undefined,
      }));
    },
    observe(ev) {
      if (ev.type === 'user' && ev.text) question = ev.text;
      else if (ev.type === 'assistant' && ev.text) answer = ev.text;
      else if (ev.type === 'tool') {
        const p = ev.payload as { name?: string; result?: unknown } | undefined;
        if (p?.name) tools.push({ name: p.name, error: !!p.result && typeof p.result === 'object' && 'error' in (p.result as object) });
      }
    },
    trace(status, errorCode) {
      if (!orgId) return;
      later(() => emitAiTrace('agent-chat', {
        traceId: ctx.runId, sessionId: ctx.threadId ?? ctx.runId, latencySeconds: (Date.now() - startedAt) / 1000,
        isError: status === 'errored', errorCode, orgId, action: ctx.action, link,
        text: textOk() ? { input: question, output: answer } : undefined,
      }));
      if (status !== 'completed' || !isAllowedJudgeModel(ctx.model)) return;
      later(async () => {
        if (!answer || !question || !evalSampled(ctx.runId, demo)) return;
        const verdict = await runJudge(ctx.modelClient, ctx.model, { question, answer, tools, catalog });
        if (!verdict) return;
        const base = { traceId: ctx.runId, sessionId: ctx.threadId ?? ctx.runId, judgeModel: ctx.model, orgId, action: ctx.action, link };
        await Promise.all([
          emitAiEval('agent-chat', { ...base, name: 'right_tool', pass: verdict.right_tool }),
          emitAiEval('agent-chat', { ...base, name: 'answered_question', pass: verdict.answered_question }),
        ]);
      });
    },
  };
}
