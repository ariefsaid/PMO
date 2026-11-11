/**
 * #1532 S1: AI traces from agent-chat. Real handler, mocked globalThis.fetch (no DI in prod code).
 * AC-PHO-001..004 (spec) + owner-scope AC-PHO-090..093 (demo text, consent link, eval verdicts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import { evalSampled } from '../../../../supabase/functions/agent-chat/aiJudge';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostHog payloads are inspected structurally
type Ph = { event: string; properties: Record<string, any> };
const QUESTION = 'How many active projects does Acme Corp payroll have?';
const MODEL = 'deepseek/deepseek-v4-flash';
const resp = (over: object) => ({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, total_cost: 0.001 }, model: MODEL, ...over });
const toolRound = resp({ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects', columns: ['name'] }) } }] } });
const stopRound = resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'There are 4 active projects.' } });

interface Opts {
  rounds?: 1 | 2; orgState?: string | null | 'error'; consent?: boolean; posthog?: 'ok' | 'hangs' | 'rejects' | 'absent';
  modelThrows?: Error; usageAction?: 'chat' | 'automation'; runId?: string; model?: string; judge?: string; threadId?: string;
  judgeModel?: string; judgeDelayMs?: number;
}
async function runWith(o: Opts = {}) {
  const usageRows: Record<string, unknown>[] = [];
  const ph: Ph[] = [];
  const judgeCalls: unknown[] = [];
  const tables: string[] = [];
  const orgEq: unknown[][] = [];
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      tables.push(table);
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }) }) }) };
      if (table === 'organizations') {
        // Only the org-filtered path exists: a lookup without `.eq('id', orgId)` throws (fails closed => no text).
        return { select: () => ({ eq: (col: string, val: string) => { orgEq.push([col, val]); return { limit: async () => (o.orgState === 'error' ? { data: null, error: { message: 'x' } } : { data: [{ lifecycle_state: o.orgState === undefined ? 'live' : o.orgState }], error: null }) }; } }) };
      }
      if (table === 'agent_usage') return { insert: (row: Record<string, unknown>) => { usageRows.push(row); return { select: () => ({ single: async () => ({ data: { id: 'u' }, error: null }) }) }; } };
      return { select: () => ({ limit: async () => ({ data: [{ name: 'A' }], error: null }), eq: () => ({ limit: async () => ({ data: [{ name: 'A' }], error: null }) }) }) };
    }),
  } as unknown as HandlerDeps['supabase'];
  const script = (o.rounds ?? 1) === 2 ? [toolRound, stopRound] : [stopRound];
  let i = 0;
  const create = vi.fn(async (p: { messages: { role: string; content: string | null }[] }) => {
    if (String(p.messages[0]?.content).startsWith('You grade one turn')) {
      judgeCalls.push(p);
      if (o.judgeDelayMs) await new Promise((r) => setTimeout(r, o.judgeDelayMs));
      return resp({ model: o.judgeModel ?? MODEL, finish_reason: 'stop', message: { role: 'assistant', content: o.judge ?? '{"right_tool":true,"answered_question":true}' } });
    }
    if (o.modelThrows) throw o.modelThrows;
    return script[Math.min(i++, script.length - 1)];
  });
  const registered: Promise<unknown>[] = [];
  (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { registered.push(p); } };
  if (o.posthog !== 'absent') (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'POSTHOG_PROJECT_KEY' ? 'phc_x' : undefined) } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (o.posthog === 'hangs') return new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abort'))));
    if (o.posthog === 'rejects') throw new Error('down');
    ph.push(JSON.parse(String(init.body)));
    return { ok: true } as Response;
  }));
  const req: AgentChatRequest = {
    runId: o.runId ?? 'run-1', threadId: o.threadId ?? 'thread-1', messages: [{ role: 'user', content: QUESTION }],
    ...(o.consent ? { analytics: { consent: true, sessionId: 'replay-1' } } : {}),
  };
  const events: AgentEvent[] = [];
  for await (const e of agentChatHandler(req, {
    modelClient: { create } as never, model: o.model ?? MODEL, supabase, userId: 'user-1', usage: { supabase }, verifyAnswer: false,
    usageAction: o.usageAction, now: () => new Date('2026-07-03T00:00:00Z'),
  })) events.push(e);
  // What the runtime was asked to keep alive when the stream closed, and what it had delivered once those settled.
  if (!o.posthog || o.posthog === 'ok') await Promise.all([...registered]); // a hanging PostHog would only stall the test
  const evalsAfterWaitUntil = ph.filter((e) => e.event === 'ai_eval').length;
  for (let n = 0; n < 30; n++) await new Promise((r) => setTimeout(r, 0)); // let fire-and-forget emissions land
  return { events, usageRows, ph, judgeCalls, create, tables, orgEq, evalsAfterWaitUntil };
}
afterEach(() => { delete (globalThis as { Deno?: unknown }).Deno; delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime; vi.unstubAllGlobals(); });

const by = (r: { ph: Ph[] }, n: string) => r.ph.filter((e) => e.event === n);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// Runs whose id is NOT picked for the real-org eval sample, so judge noise stays out of other tests.
const UNSAMPLED = Array.from({ length: 50 }, (_, k) => `r-${k}`).find((id) => !evalSampled(id, false))!;
const SAMPLED = Array.from({ length: 50 }, (_, k) => `s-${k}`).find((id) => evalSampled(id, false))!;

describe('AC-PHO-001 trace shape', () => {
  it('two rounds + one tool => 2 generations, 1 span, 1 trace; one trace id; cost/tokens equal agent_usage', async () => {
    const r = await runWith({ rounds: 2, runId: UNSAMPLED });
    expect(by(r, '$ai_generation')).toHaveLength(2);
    expect(by(r, '$ai_span')).toHaveLength(1);
    expect(by(r, '$ai_trace')).toHaveLength(1);
    expect(new Set(r.ph.map((e) => e.properties.$ai_trace_id)).size).toBe(1);
    expect(sum(by(r, '$ai_generation').map((e) => e.properties.$ai_total_cost_usd))).toBeCloseTo(sum(r.usageRows.map((u) => u.cost as number)));
    expect(sum(by(r, '$ai_generation').map((e) => e.properties.$ai_input_tokens))).toBe(sum(r.usageRows.map((u) => u.prompt_tokens as number)));
    expect(by(r, '$ai_span')[0].properties.$ai_parent_id).toBe(by(r, '$ai_generation')[0].properties.$ai_span_id);
    expect(by(r, '$ai_span')[0].properties.$ai_span_name).toBe('query_entity');
    expect(by(r, '$ai_generation')[0].properties.$ai_session_id).toBe('thread-1');
  });
});

describe('AC-PHO-002 real orgs: numbers and codes only', () => {
  it('a provider error containing user text reaches PostHog as error_code only', async () => {
    const r = await runWith({ modelThrows: new Error('quota exceeded for "Acme Corp payroll"'), runId: UNSAMPLED });
    expect(JSON.stringify(r.ph)).not.toContain('Acme Corp');
    expect(by(r, '$ai_trace')[0].properties.error_code).toBe('UPSTREAM_ERROR');
  });
  it.each([['live'], ['test'], [null], ['error' as const]])('lifecycle %s => no prompt/response text in ANY event, even with consent', async (state) => {
    const r = await runWith({ rounds: 2, orgState: state as never, consent: true, runId: SAMPLED });
    expect(r.ph.length).toBeGreaterThan(3);
    const all = JSON.stringify(r.ph);
    expect(all).not.toContain('Acme Corp');
    expect(all).not.toContain('active projects');
    for (const e of r.ph) for (const k of ['$ai_input', '$ai_output_choices', '$ai_input_state', '$ai_output_state']) expect(e.properties[k]).toBeUndefined();
  });
});

describe('AC-PHO-003 PostHog failure never touches the run', () => {
  it.each([['hangs'], ['rejects']] as const)('posthog %s => same events and usage rows as the control run', async (mode) => {
    const control = await runWith({ rounds: 2, posthog: 'absent', runId: UNSAMPLED });
    const bad = await runWith({ rounds: 2, posthog: mode, runId: UNSAMPLED });
    const shape = (xs: AgentEvent[]) => xs.map((e) => [e.type, e.payload, e.text]);
    expect(shape(bad.events)).toEqual(shape(control.events));
    const stable = (rows: Record<string, unknown>[]) => rows.map(({ duration_ms: _d, ...rest }) => rest); // wall-clock varies
    expect(stable(bad.usageRows)).toEqual(stable(control.usageRows));
  });
});

describe('AC-PHO-004 action label', () => {
  it('usageAction automation => action=automation on generations and trace', async () => {
    const r = await runWith({ usageAction: 'automation', runId: UNSAMPLED });
    expect(by(r, '$ai_generation')[0].properties.action).toBe('automation');
    expect(by(r, '$ai_trace')[0].properties.action).toBe('automation');
  });
});

describe('AC-PHO-090 demo org + consent: text linked to the replay', () => {
  it('captures prompt, response and tool I/O, with $session_id and user_id', async () => {
    const r = await runWith({ rounds: 2, orgState: 'demo', consent: true });
    const gens = by(r, '$ai_generation');
    expect(JSON.stringify(gens[0].properties.$ai_input)).toContain('Acme Corp');
    expect(JSON.stringify(gens[1].properties.$ai_output_choices)).toContain('4 active projects');
    expect(gens[0].properties.$ai_input.some((m: { role: string }) => m.role === 'system')).toBe(false);
    expect(by(r, '$ai_span')[0].properties.$ai_input_state).toContain('projects');
    expect(by(r, '$ai_trace')[0].properties.$ai_output_state).toContain('4 active projects');
    for (const e of [...gens, ...by(r, '$ai_span'), ...by(r, '$ai_trace')]) {
      expect(e.properties.$session_id).toBe('replay-1');
      expect(e.properties.user_id).toBe('user-1');
    }
  });
  it('demo org WITHOUT the consent flag: no text, no session, no user id', async () => {
    const r = await runWith({ rounds: 2, orgState: 'demo', consent: false });
    const all = JSON.stringify(r.ph);
    expect(all).not.toContain('Acme Corp');
    expect(all).not.toContain('user-1');
    expect(all).not.toContain('replay-1');
    expect(r.ph.length).toBeGreaterThan(3);
  });
});

describe('AC-PHO-092 consent flag gates the user join (cost per user)', () => {
  it('real org + consent => user_id and $session_id, still no text', async () => {
    const r = await runWith({ consent: true, runId: UNSAMPLED });
    expect(by(r, '$ai_generation')[0].properties).toMatchObject({ user_id: 'user-1', $session_id: 'replay-1' });
  });
  it('no flag => neither key on any event', async () => {
    const r = await runWith({ rounds: 2, runId: UNSAMPLED });
    for (const e of r.ph) { expect(e.properties.user_id).toBeUndefined(); expect(e.properties.$session_id).toBeUndefined(); }
  });
});

describe('AC-PHO-093 online eval verdicts', () => {
  it('a sampled real run gets two verdicts, booleans only', async () => {
    const r = await runWith({ rounds: 2, runId: SAMPLED, judge: '{"right_tool":true,"answered_question":false}' });
    const ev = by(r, 'ai_eval');
    expect(ev.map((e) => [e.properties.eval_name, e.properties.eval_pass]).sort()).toEqual([['answered_question', false], ['right_tool', true]]);
    expect(ev[0].properties.$ai_trace_id).toBe(SAMPLED);
    expect(JSON.stringify(ev)).not.toContain('Acme Corp');
    const judgePrompt = JSON.stringify(r.judgeCalls[0]);
    expect(judgePrompt).toContain('query_entity');
  });
  it('an unsampled real run is not judged', async () => {
    const r = await runWith({ runId: UNSAMPLED });
    expect(r.judgeCalls).toHaveLength(0);
    expect(by(r, 'ai_eval')).toHaveLength(0);
  });
  it('the demo org is always judged', async () => {
    const r = await runWith({ orgState: 'demo', consent: true, runId: UNSAMPLED });
    expect(by(r, 'ai_eval')).toHaveLength(2);
  });
  it('never judges with a Claude model', async () => {
    const r = await runWith({ orgState: 'demo', model: 'anthropic/claude-sonnet-5-5' });
    expect(r.judgeCalls).toHaveLength(0);
    expect(by(r, 'ai_eval')).toHaveLength(0);
  });
  it('a failed judge changes nothing about the run', async () => {
    const r = await runWith({ orgState: 'demo', judge: 'garbage' });
    expect(by(r, 'ai_eval')).toHaveLength(0);
    expect(r.events.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });
});

describe('judge hardening (#1532 review)', () => {
  it('the lifecycle lookup is filtered by the run org id', async () => {
    const r = await runWith({ orgState: 'demo', consent: true });
    expect(r.orgEq).toEqual([['id', 'org-1']]);
  });
  it('the judge call asks for no model fallbacks', async () => {
    const r = await runWith({ orgState: 'demo' });
    expect((r.judgeCalls[0] as { noFallback?: boolean }).noFallback).toBe(true);
  });
  it('a Claude model that answers the judge anyway yields no verdict, but its spend is still recorded', async () => {
    const r = await runWith({ orgState: 'demo', judgeModel: 'anthropic/claude-sonnet-5-5' });
    expect(by(r, 'ai_eval')).toHaveLength(0);
    const spend = by(r, '$ai_generation').filter((e) => e.properties.action === 'eval');
    expect(spend).toHaveLength(1);
    expect(spend[0].properties.$ai_model).toBe('anthropic/claude-sonnet-5-5');
  });
  it('records the judge own spend as an action=eval $ai_generation: tokens, cost, model, no text, consent link kept', async () => {
    const r = await runWith({ orgState: 'demo', consent: true, runId: UNSAMPLED });
    const spend = by(r, '$ai_generation').filter((e) => e.properties.action === 'eval');
    expect(spend).toHaveLength(1);
    expect(spend[0].properties).toMatchObject({
      $ai_trace_id: UNSAMPLED, $ai_model: MODEL, $ai_input_tokens: 100, $ai_output_tokens: 20, $ai_total_cost_usd: 0.001, $ai_is_error: false,
      org_id: 'org-1', user_id: 'user-1',
    });
    expect(spend[0].properties.$ai_input).toBeUndefined();
    expect(spend[0].properties.$ai_output_choices).toBeUndefined();
    expect(by(r, 'ai_eval')[0].properties.judge_model).toBe(MODEL);
  });
  it('an unjudged run records no eval spend', async () => {
    const r = await runWith({ runId: UNSAMPLED });
    expect(by(r, '$ai_generation').filter((e) => e.properties.action === 'eval')).toHaveLength(0);
  });
  it('the judge chain is registered with waitUntil before the stream closes, so ai_eval survives the response', async () => {
    const r = await runWith({ orgState: 'demo', judgeDelayMs: 20 });
    expect(r.judgeCalls).toHaveLength(1);
    expect(r.evalsAfterWaitUntil).toBe(2);
  });
});

describe('no PostHog key => telemetry is a pure no-op', () => {
  it('no organizations read, no judge call, even for a sampled run', async () => {
    const r = await runWith({ posthog: 'absent', runId: SAMPLED });
    expect(r.tables).not.toContain('organizations');
    expect(r.judgeCalls).toHaveLength(0);
    expect(r.create).toHaveBeenCalledTimes(1);
  });
});
