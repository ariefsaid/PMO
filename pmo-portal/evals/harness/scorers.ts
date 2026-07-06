/**
 * Agent eval-harness scorers — composable PASS/FAIL assertions over a collected run.
 *
 * ADR-0052 + `docs/plans/2026-07-05-agent-eval-harness.md` (Track V).
 *
 * A `Scorer` is a function `(run: EvalRunResult) => Result | Promise<Result>` where
 * `Result = { pass: boolean; reason: string }`. A case passes iff EVERY scorer in its
 * `expect` list returns `pass: true`; each scorer surfaces its own failure `reason`
 * (FR-AT2-EV-002).
 *
 * `usesTool` / `contains` are PURE (free inspection of the collected run — no model
 * call). `llmJudge` is the ONLY scorer that costs an extra model call: it asks a
 * cheap-tier model (via the SAME `ModelClient` seam the agent loop uses) to grade the
 * answer against a rubric and parses a strict PASS/FAIL token (ADR-0039 boundary —
 * the judge's output is untrusted model content, parsed to a bounded token, never
 * executed or re-injected as an instruction).
 *
 * This module is plain TS with NO Deno globals — it runs in the normal Vitest suite
 * (the scorer LOGIC is deterministically unit-tested in `scorers.test.ts`, which
 * lives in `verify`) AND is imported by the `*.eval.ts` case files (which run only in
 * the dedicated eval project). Both environments are Node.
 */
import type { AgentEvent } from '../../src/lib/agent/runtime/port';
import type { ModelClient, ModelClientParams } from '../../../supabase/functions/_shared/modelClient';

/**
 * The collected outcome of one deployed run, consumed by every scorer.
 * Produced by `runEvalCase` in `runEval.ts` from the SSE stream.
 */
export interface EvalRunResult {
  /** Every `type:'tool'` event's `{ name, input, result }` (in order). */
  toolCalls: { name: string; input: unknown; result: unknown }[];
  /** The merged assistant answer text (concatenated across `type:'assistant'` chunks). */
  answerText: string;
  /** The full event stream (for scorers that need richer inspection). */
  events: AgentEvent[];
}

/** A scorer's verdict. */
export interface ScorerResult {
  pass: boolean;
  /** A human-readable failure reason (surfaced on `pass:false`); a short confirmation on `pass:true`. */
  reason: string;
}

/** A composable scorer. May be async (`llmJudge` is); the runner `await`s every scorer. */
export type Scorer = (run: EvalRunResult) => ScorerResult | Promise<ScorerResult>;

/**
 * `usesTool(name)` — passes iff the run called the named `AgentAction` at least once.
 * Pure inspection of `run.toolCalls` — free (no model call). FR-AT2-EV-002.
 *
 * Example: `usesTool('query_entity')` proves the model selected the read tool for a
 * list request — the load-bearing behavior-regression signal for the weak prod model.
 */
export function usesTool(name: string): Scorer {
  return (run) => {
    const hit = run.toolCalls.some((t) => t.name === name);
    return hit
      ? { pass: true, reason: `run called tool "${name}"` }
      : {
          pass: false,
          reason: `expected tool "${name}" to be called; actual tools: [${
            run.toolCalls.map((t) => t.name).join(', ') || 'none'
          }]`,
        };
  };
}

/**
 * `contains(needle)` — passes iff the merged answer text contains the substring or
 * matches the RegExp. Pure inspection — free. FR-AT2-EV-002.
 *
 * Example: `contains(/compan/i)` proves the answer mentioned "company"/"companies".
 */
export function contains(needle: string | RegExp): Scorer {
  return (run) => {
    const matched =
      typeof needle === 'string' ? run.answerText.includes(needle) : needle.test(run.answerText);
    const label = typeof needle === 'string' ? `"${needle}"` : needle.toString();
    return matched
      ? { pass: true, reason: `answer matches ${label}` }
      : { pass: false, reason: `answer does not match ${label}; got: "${truncate(run.answerText)}"` };
  };
}

/**
 * `llmJudge(rubric, opts?)` — asks a cheap-tier model to grade the answer PASS/FAIL
 * against `rubric`. The ONLY scorer that costs a model call. FR-AT2-EV-002, DEC-5.
 *
 * The judge's output crosses the ADR-0039 boundary: it is parsed to a bounded
 * `PASS`/`FAIL` token (any non-`PASS` — including a parse failure — is `pass:false`,
 * fail-closed), NEVER executed or re-injected as an instruction (NFR-AT2-SEC-005).
 *
 * `judgeClient` is injected (DI) so the scorer logic is unit-testable with a fake
 * client (no network). The eval runner wires the real `OpenRouterModelClient`; the
 * unit test wires a stub. `judgeModel` defaults to `EVAL_JUDGE_MODEL` at the call site.
 */
export function llmJudge(
  rubric: string,
  opts: {
    judgeClient: ModelClient;
    judgeModel?: string;
  },
): Scorer {
  return async (run) => {
    const model = opts.judgeModel ?? process.env.EVAL_JUDGE_MODEL ?? 'deepseek/deepseek-v4-flash';
    const prompt = buildJudgePrompt(rubric, run.answerText);
    const params: ModelClientParams = {
      model,
      max_tokens: 16,
      messages: [
        {
          role: 'system',
          content:
            'You are a strict behavior-grading judge. Reply with exactly one token: PASS or FAIL. ' +
            'PASS only if the answer fully satisfies the rubric.',
        },
        { role: 'user', content: prompt },
      ],
    };
    let resp;
    try {
      resp = await opts.judgeClient.create(params);
    } catch (err) {
      return {
        pass: false,
        reason: `judge model call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const verdict = (resp.message.content ?? '').trim().toUpperCase();
    // Fail-closed: only an explicit PASS passes; FAIL / parse failure / empty → fail.
    if (verdict.startsWith('PASS')) {
      return { pass: true, reason: `judge PASS (${model})` };
    }
    return {
      pass: false,
      reason: `judge FAIL (${model}): ${truncate(verdict) || '<empty>'}`,
    };
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function buildJudgePrompt(rubric: string, answer: string): string {
  return [
    'Rubric:',
    rubric,
    '',
    'Answer to grade:',
    truncate(answer, 4000),
    '',
    'Verdict (PASS or FAIL):',
  ].join('\n');
}

/**
 * Run a list of scorers over a collected run and merge their verdicts. A case passes
 * iff EVERY scorer returns `pass:true`; the merged `reason` concatenates each failing
 * scorer's reason (FR-AT2-EV-002 composition). Used by the eval runner + the unit
 * tests of composition.
 */
export async function runScorers(
  scorers: Scorer[],
  run: EvalRunResult,
): Promise<{ pass: boolean; reasons: string[] }> {
  const results = await Promise.all(scorers.map((s) => s(run)));
  const failing = results.filter((r) => !r.pass);
  return {
    pass: failing.length === 0,
    reasons: failing.map((r) => r.reason),
  };
}
