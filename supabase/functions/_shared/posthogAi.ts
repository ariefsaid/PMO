import { emitServerEvent } from './posthogServer.ts';
import type { EdgeFunctionName } from './errorLog.ts';

/**
 * Typed AI-trace emitters (#1532 S1). Every property is a number, a boolean or a short code; the
 * ONLY text path is the optional `text` field, which the caller sets solely for a demo org whose
 * user sent the analytics-consent flag (see agent-chat/aiTelemetry.ts). `link` is set only with
 * that same consent flag.
 */
export const AI_PROVIDER = 'openrouter';
export type AiAction = 'chat' | 'compose' | 'automation';
export interface AiMessage { role: string; content: string }
/** Consent-gated joins: browser replay session and opaque user id (cost per user). */
export interface AiLink { sessionId?: string; userId?: string }

const linkProps = (l?: AiLink) => ({ $session_id: l?.sessionId, user_id: l?.userId });

export interface AiGenerationProps {
  traceId: string; spanId: string; sessionId?: string; model: string;
  inputTokens: number; outputTokens: number; costUsd: number; latencySeconds: number;
  isError: boolean; httpStatus: number; action: AiAction; orgId: string;
  cachedTokens?: number; reasoningTokens?: number; errorCode?: string;
  text?: { input?: AiMessage[]; output?: AiMessage[] };
  link?: AiLink;
}
export function emitAiGeneration(fn: EdgeFunctionName, p: AiGenerationProps): Promise<void> {
  return emitServerEvent('$ai_generation', fn, {
    $ai_trace_id: p.traceId, $ai_span_id: p.spanId, $ai_session_id: p.sessionId, $ai_model: p.model,
    $ai_provider: AI_PROVIDER, $ai_input_tokens: p.inputTokens, $ai_output_tokens: p.outputTokens,
    $ai_total_cost_usd: p.costUsd, $ai_latency: p.latencySeconds, $ai_is_error: p.isError,
    $ai_http_status: p.httpStatus, action: p.action, org_id: p.orgId,
    cached_tokens: p.cachedTokens, reasoning_tokens: p.reasoningTokens, error_code: p.errorCode,
    $ai_input: p.text?.input, $ai_output_choices: p.text?.output, ...linkProps(p.link),
  }, { allowText: p.text !== undefined });
}

export interface AiSpanProps {
  traceId: string; spanId: string; parentId?: string; name: string; latencySeconds: number;
  isError: boolean; orgId: string; text?: { input?: string; output?: string }; link?: AiLink;
}
export function emitAiSpan(fn: EdgeFunctionName, p: AiSpanProps): Promise<void> {
  return emitServerEvent('$ai_span', fn, {
    $ai_trace_id: p.traceId, $ai_span_id: p.spanId, $ai_parent_id: p.parentId, $ai_span_name: p.name,
    $ai_latency: p.latencySeconds, $ai_is_error: p.isError, org_id: p.orgId,
    $ai_input_state: p.text?.input, $ai_output_state: p.text?.output, ...linkProps(p.link),
  }, { allowText: p.text !== undefined });
}

export interface AiTraceProps {
  traceId: string; sessionId?: string; latencySeconds: number; isError: boolean; errorCode?: string;
  orgId: string; action?: AiAction; text?: { input?: string; output?: string }; link?: AiLink;
}
export function emitAiTrace(fn: EdgeFunctionName, p: AiTraceProps): Promise<void> {
  return emitServerEvent('$ai_trace', fn, {
    $ai_trace_id: p.traceId, $ai_session_id: p.sessionId, $ai_latency: p.latencySeconds,
    $ai_is_error: p.isError, error_code: p.errorCode, org_id: p.orgId, action: p.action,
    $ai_input_state: p.text?.input, $ai_output_state: p.text?.output, ...linkProps(p.link),
  }, { allowText: p.text !== undefined });
}

export interface AiEvalProps {
  traceId: string; sessionId?: string; name: string; pass: boolean; judgeModel: string;
  orgId: string; action?: AiAction; link?: AiLink;
}
export function emitAiEval(fn: EdgeFunctionName, p: AiEvalProps): Promise<void> {
  return emitServerEvent('ai_eval', fn, {
    $ai_trace_id: p.traceId, $ai_session_id: p.sessionId, eval_name: p.name, eval_pass: p.pass,
    judge_model: p.judgeModel, org_id: p.orgId, action: p.action, ...linkProps(p.link),
  });
}
