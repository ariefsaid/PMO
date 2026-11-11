import { it, expect, vi, afterEach, describe } from 'vitest';
import { emitAiGeneration, emitAiSpan, emitAiTrace, emitAiEval } from '../../../../supabase/functions/_shared/posthogAi';
import { emitServerEvent } from '../../../../supabase/functions/_shared/posthogServer';

afterEach(() => { delete (globalThis as { Deno?: unknown }).Deno; vi.unstubAllGlobals(); });
const withKey = () => {
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'POSTHOG_PROJECT_KEY' ? 'phc_x' : undefined) } };
  const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f);
  return () => JSON.parse((f.mock.calls.at(-1)![1] as { body: string }).body) as { event: string; properties: Record<string, unknown> };
};
const base = { traceId: 't', spanId: 'g', sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 2, costUsd: 0.01,
  latencySeconds: 0.4, isError: false, httpStatus: 200, action: 'chat' as const, orgId: 'o', cachedTokens: 0, reasoningTokens: 0 };

describe('AC-PHO-002 allowlist, never text', () => {
  it('maps to $ai_* keys and carries no text', async () => {
    const sent = withKey();
    await emitAiGeneration('agent-chat', base);
    expect(Object.keys(sent().properties).sort()).toEqual([
      '$ai_http_status', '$ai_input_tokens', '$ai_is_error', '$ai_latency', '$ai_model', '$ai_output_tokens', '$ai_provider',
      '$ai_session_id', '$ai_span_id', '$ai_total_cost_usd', '$ai_trace_id', '$process_person_profile', 'action',
      'cached_tokens', 'org_id', 'reasoning_tokens'].sort());
  });
  it('a smuggled $ai_input is thrown in test mode (strict) — mutation: loosening the allowlist turns this red', () => {
    expect(() => emitServerEvent('$ai_generation', 'agent-chat', { $ai_trace_id: 't', $ai_input: 'user text' })).toThrow(/\$ai_input/);
  });
  it('error path carries error_code only, never the provider message', async () => {
    const sent = withKey();
    await emitAiGeneration('agent-chat', { ...base, isError: true, httpStatus: 502, errorCode: 'UPSTREAM_ERROR' });
    const p = sent().properties;
    expect(p.error_code).toBe('UPSTREAM_ERROR');
    expect(JSON.stringify(p)).not.toMatch(/message|user text/);
  });
  it('without text/link there is no text, no $session_id, no user_id', async () => {
    const sent = withKey();
    await emitAiSpan('agent-chat', { traceId: 't', spanId: 's1', parentId: 'g', name: 'query_entity', latencySeconds: 1, isError: false, orgId: 'o' });
    expect(Object.keys(sent().properties)).not.toEqual(expect.arrayContaining(['$ai_input_state']));
    expect(sent().properties).toMatchObject({ $ai_span_name: 'query_entity', $ai_parent_id: 'g' });
    expect(sent().properties.user_id).toBeUndefined();
    expect(sent().properties.$session_id).toBeUndefined();
  });
});

describe('AC-PHO-090 demo text + replay/user link are opt-in per call', () => {
  it('generation with text + link carries $ai_input/$ai_output_choices, $session_id and user_id', async () => {
    const sent = withKey();
    await emitAiGeneration('agent-chat', { ...base, text: { input: [{ role: 'user', content: 'q' }], output: [{ role: 'assistant', content: 'a' }] }, link: { sessionId: 'rep-1', userId: 'u-1' } });
    expect(sent().properties).toMatchObject({ $ai_input: [{ role: 'user', content: 'q' }], $ai_output_choices: [{ role: 'assistant', content: 'a' }], $session_id: 'rep-1', user_id: 'u-1' });
  });
  it('span and trace carry state text only when given', async () => {
    const sent = withKey();
    await emitAiSpan('agent-chat', { traceId: 't', spanId: 's', name: 'x', latencySeconds: 1, isError: false, orgId: 'o', text: { input: '{"a":1}', output: '{"b":2}' } });
    expect(sent().properties).toMatchObject({ $ai_input_state: '{"a":1}', $ai_output_state: '{"b":2}' });
    await emitAiTrace('agent-chat', { traceId: 't', latencySeconds: 1, isError: false, orgId: 'o', text: { input: 'q', output: 'a' } });
    expect(sent().properties).toMatchObject({ $ai_input_state: 'q', $ai_output_state: 'a' });
  });
});

describe('AC-PHO-093 eval verdict', () => {
  it('emits ai_eval with name, boolean, judge model, no text', async () => {
    const sent = withKey();
    await emitAiEval('agent-chat', { traceId: 't', name: 'answered_question', pass: false, judgeModel: 'j', orgId: 'o', action: 'chat' });
    expect(sent().event).toBe('ai_eval');
    expect(sent().properties).toMatchObject({ $ai_trace_id: 't', eval_name: 'answered_question', eval_pass: false, judge_model: 'j' });
  });
});
