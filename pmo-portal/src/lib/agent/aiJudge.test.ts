import { describe, it, expect, vi } from 'vitest';
import { runJudge, isAllowedJudgeModel, evalSampled } from '../../../../supabase/functions/agent-chat/aiJudge';

const input = { question: 'How many active projects?', answer: 'There are 4.', tools: [{ name: 'query_entity', error: false }], catalog: ['query_entity: read rows', 'notify: send note'] };
const client = (content: string | Error, model = 'm') => ({
  create: vi.fn(async (_p: { messages: unknown[]; tools?: unknown; noFallback?: boolean }) => {
    if (content instanceof Error) throw content;
    return { finish_reason: 'stop', model, usage: { prompt_tokens: 500, completion_tokens: 12, total_tokens: 512, total_cost: 0.0004 }, message: { role: 'assistant' as const, content } };
  }),
});

describe('AC-PHO-093 LLM judge', () => {
  it('parses a verdict for both criteria', async () => {
    const c = client('{"right_tool": true, "answered_question": false}');
    const r = await runJudge(c, 'deepseek/deepseek-v4-flash', input);
    expect(r?.verdict).toEqual({ right_tool: true, answered_question: false });
    const sent = JSON.stringify(c.create.mock.calls[0][0]);
    expect(sent).toContain('query_entity');
    expect(c.create.mock.calls[0][0].tools).toBeUndefined();
  });
  it('tolerates fenced / noisy JSON', async () => {
    expect((await runJudge(client('```json\n{"right_tool":false,"answered_question":true}\n```'), 'm', input))?.verdict).toEqual({ right_tool: false, answered_question: true });
  });
  it('no verdict for garbage or a non-boolean, but the spend is still reported; a throw reports nothing', async () => {
    expect(await runJudge(client('nope'), 'm', input)).toMatchObject({ verdict: null, usage: { total_cost: 0.0004 } });
    expect(await runJudge(client('{"right_tool":"yes","answered_question":true}'), 'm', input)).toMatchObject({ verdict: null });
    expect(await runJudge(client(new Error('down')), 'm', input)).toBeNull();
  });
  it('asks for no model fallbacks and reports the model that answered', async () => {
    const c = client('{"right_tool":true,"answered_question":true}', 'served/by-this');
    const r = await runJudge(c, 'deepseek/deepseek-v4-flash', input);
    expect(c.create.mock.calls[0][0].noFallback).toBe(true);
    expect(r?.model).toBe('served/by-this');
  });
  it('drops the verdict when a Claude model answered anyway (fallback served it), keeping the spend', async () => {
    const r = await runJudge(client('{"right_tool":true,"answered_question":true}', 'anthropic/claude-sonnet-5-5'), 'deepseek/deepseek-v4-flash', input);
    expect(r).toMatchObject({ verdict: null, model: 'anthropic/claude-sonnet-5-5', usage: { total_cost: 0.0004 } });
  });
  it('gives up after the deadline', async () => {
    const hang = { create: () => new Promise<never>(() => undefined) };
    expect(await runJudge(hang, 'm', input, 20)).toBeNull();
  });
});

describe('judge model + sampling', () => {
  it('never a Claude model (owner rule: no Claude via OpenRouter)', () => {
    expect(isAllowedJudgeModel('anthropic/claude-sonnet-5-5')).toBe(false);
    expect(isAllowedJudgeModel('Claude-3')).toBe(false);
    expect(isAllowedJudgeModel('deepseek/deepseek-v4-flash')).toBe(true);
  });
  it('demo org always sampled; others deterministic ~1 in 4 by run id', () => {
    expect(evalSampled('x', true)).toBe(true);
    const hits = Array.from({ length: 400 }, (_, i) => evalSampled(`run-${i}`, false)).filter(Boolean).length;
    expect(hits).toBeGreaterThan(60); expect(hits).toBeLessThan(140);
    expect(evalSampled('run-7', false)).toBe(evalSampled('run-7', false));
  });
});
