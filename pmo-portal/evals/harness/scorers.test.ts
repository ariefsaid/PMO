/**
 * Scorer logic unit tests — deterministic, runs in `verify` (NO network, NO model
 * call; the `llmJudge` client is mocked). AC-AT2-015 scorer half.
 *
 * FR-AT2-EV-002: each scorer reports its own pass/fail with a clear reason; scorers
 * compose (all must pass for a case to pass). The real-loop execution of these
 * scorers is the harness half (run by the eval case files in the eval job only) —
 * the scorer LOGIC is proven here, separate from model flakiness.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  contains,
  llmJudge,
  runScorers,
  usesTool,
  type EvalRunResult,
} from './scorers';
import type { ModelClient, ModelResponse } from '../../../supabase/functions/_shared/modelClient';

function runWith(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    toolCalls: [],
    answerText: '',
    events: [],
    ...overrides,
  };
}

function fakeClient(resp: ModelResponse): ModelClient {
  return { create: vi.fn().mockResolvedValue(resp) };
}

describe('AC-AT2-015 usesTool/contains/llmJudge scorers pass/fail with reasons', () => {
  // ── usesTool ────────────────────────────────────────────────────────────────
  it('usesTool passes when the named tool was called', async () => {
    const run = runWith({
      toolCalls: [
        { name: 'query_entity', input: {}, result: { rowCount: 2, rows: [] } },
        { name: 'compose_view', input: {}, result: {} },
      ],
    });
    const verdict = await usesTool('query_entity')(run);
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain('query_entity');
  });

  it('usesTool fails with the actual tool list when the tool was not called', async () => {
    const run = runWith({
      toolCalls: [{ name: 'compose_view', input: {}, result: {} }],
    });
    const verdict = await usesTool('query_entity')(run);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('query_entity');
    expect(verdict.reason).toContain('compose_view');
  });

  it('usesTool fails with "none" when no tool was called', async () => {
    const verdict = await usesTool('query_entity')(runWith());
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('none');
  });

  // ── contains ────────────────────────────────────────────────────────────────
  it('contains(string) passes on a substring match', async () => {
    const run = runWith({ answerText: 'Project Alpha is on track.' });
    expect((await contains('Alpha')(run)).pass).toBe(true);
  });

  it('contains(RegExp) passes on a regex match', async () => {
    const run = runWith({ answerText: 'Here are your companies.' });
    expect((await contains(/compan/i)(run)).pass).toBe(true);
  });

  it('contains fails with the truncated answer when no match', async () => {
    const run = runWith({ answerText: 'Project Beta is on track.' });
    const verdict = await contains('Alpha')(run);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('Alpha');
    expect(verdict.reason).toContain('Beta');
  });

  // ── llmJudge ────────────────────────────────────────────────────────────────
  it('llmJudge passes when the judge returns PASS', async () => {
    const client = fakeClient({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'PASS' },
      model: 'deepseek/deepseek-v4-flash',
    });
    const verdict = await llmJudge('answer mentions the project name', { judgeClient: client })(
      runWith({ answerText: 'Project Alpha.' }),
    );
    expect(verdict.pass).toBe(true);
    expect(client.create).toHaveBeenCalledOnce();
  });

  it('llmJudge fails (fail-closed) when the judge returns FAIL with a reason', async () => {
    const client = fakeClient({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'FAIL: too vague' },
      model: 'deepseek/deepseek-v4-flash',
    });
    const verdict = await llmJudge('specific budget number', { judgeClient: client })(
      runWith({ answerText: 'It is on budget.' }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('FAIL');
    expect(verdict.reason).toContain('TOO VAGUE');
  });

  it('llmJudge fails (fail-closed) on a malformed/empty judge body', async () => {
    const client = fakeClient({
      finish_reason: 'stop',
      message: { role: 'assistant', content: null },
      model: 'deepseek/deepseek-v4-flash',
    });
    const verdict = await llmJudge('any rubric', { judgeClient: client })(
      runWith({ answerText: 'x' }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('FAIL');
  });

  it('llmJudge fails (fail-closed) when the judge model call throws', async () => {
    const client: ModelClient = {
      create: vi.fn().mockRejectedValue(new Error('upstream 503')),
    };
    const verdict = await llmJudge('any rubric', { judgeClient: client })(
      runWith({ answerText: 'x' }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('judge model call failed');
    expect(verdict.reason).toContain('503');
  });

  // ── composition ─────────────────────────────────────────────────────────────
  it('runScorers passes iff every scorer passes, merging failure reasons', async () => {
    const run = runWith({
      toolCalls: [{ name: 'query_entity', input: {}, result: {} }],
      answerText: 'Project Alpha.',
    });
    const ok = await runScorers(
      [usesTool('query_entity'), contains('Alpha')],
      run,
    );
    expect(ok.pass).toBe(true);
    expect(ok.reasons).toEqual([]);

    const mixed = await runScorers(
      [usesTool('query_entity'), contains('Beta')],
      run,
    );
    expect(mixed.pass).toBe(false);
    expect(mixed.reasons).toHaveLength(1);
    expect(mixed.reasons[0]).toContain('Beta');
  });

  it('runScorers aggregates multiple distinct failure reasons', async () => {
    const run = runWith({ toolCalls: [], answerText: 'nothing relevant' });
    const both = await runScorers(
      [usesTool('query_entity'), contains('Alpha')],
      run,
    );
    expect(both.pass).toBe(false);
    expect(both.reasons).toHaveLength(2);
  });
});
