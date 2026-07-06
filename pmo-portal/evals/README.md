# Agent eval harness

A **behavior-regression net** for the agent loop, run against the **deployed**
`agent-chat` function on the weak prod model (`deepseek/deepseek-v4-flash`).
Authority: **ADR-0052**; plan `docs/plans/2026-07-05-agent-eval-harness.md`;
spec `docs/specs/agent-tier2-capabilities.spec.md` §4 (FR-AT2-EV-001..006).

## What an eval is — and is not

- **Is:** a regression net for **real model behavior** (tool selection + answer
  quality) that the deterministic Layer-1 gate-tests (ADR-0030 §C) structurally
  cannot catch. The prod model is a weak tool-selector; this is the net that
  catches "the model stopped choosing `query_entity` for a list request."
- **Is NOT:** an ADR-0010 AC-owned test. It is the **non-deterministic complement**
  to the deterministic pyramid. A red suite is a **signal/alert**, not (by default)
  a merge-block — it never runs in `verify` and never gates a PR→dev merge
  (FR-AT2-EV-006).

## How to run

```bash
# From pmo-portal/. Requires the eval env (below) to be provisioned — otherwise
# every case SKIPS gracefully (exit 0, never red on a missing secret).
export EVAL_AGENT_CHAT_URL=https://<staging-project-ref>.functions.supabase.co/agent-chat
export EVAL_TEST_USER_EMAIL=…
export EVAL_TEST_USER_PASSWORD=…
export VITE_SUPABASE_URL=https://<staging-project-ref>.supabase.co
export VITE_SUPABASE_ANON_KEY=…
export OPENROUTER_API_KEY=…        # only needed if a case uses llmJudge
export EVAL_JUDGE_MODEL=deepseek/deepseek-v4-flash  # optional; default is the cheap judge

npm run test:evals
```

A failing case → Vitest exits non-zero (FR-AT2-EV-004). The exit code is the gate.

## How to add a case

Create `evals/cases/<area>.eval.ts`:

```ts
import { contains, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

export default runEvalSuite(
  defineEvalSuite({
    name: '<area>',
    cases: [
      {
        name: 'AC-AT2-015 <what the case proves>',
        prompt: 'natural-language request',
        // optional: context: { entity: { type: 'project', id: 'p-1', label: 'Alpha' } },
        expect: [usesTool('query_entity'), contains(/something/i)],
      },
    ],
  }),
);
```

Scorers compose (a case passes iff **every** scorer passes):
- `usesTool(name)` — the run called a named `AgentAction` (free).
- `contains(text | RegExp)` — the answer matches (free).
- `llmJudge(rubric, { judgeClient })` — a cheap-tier model grades the answer
  PASS/FAIL (one model call; the judge's output is parsed to a bounded token, never
  executed — ADR-0039 boundary).

Each new agent behavior should land a regression case here alongside its build.

## Secrets discipline (NFR-AT2-SEC-005)

- **Test-user JWT only, NEVER `service_role`.** The harness authenticates as a real
  seeded test user via `signInWithPassword` — the exact deputy path a browser uses.
  A foreign/forged id in a case degrades to a zero-row RLS read, same as any browser
  call.
- **Credentials from process env / GH secrets ONLY** — never read from `.env` or
  `op.*.env` files. Missing required vars → the case SKIPS (never reds the suite).
- **No raw answer text or keys in logs** — scorers print ids/reasons/`kind` only.

## Where it runs

- **Locally / inner loop:** `npm run test:evals` (point `EVAL_AGENT_CHAT_URL` at your
  local `supabase functions serve` or the deployed staging function).
- **CI:** the `agent-evals` GitHub workflow (`.github/workflows/agent-evals.yml`) —
  `schedule` (nightly) + `workflow_dispatch` (manual). **NOT** on push/PR — it is
  deliberately decoupled from the merge fast lane. The owner MAY later opt it into a
  required PR→main check (a branch-protection toggle, no code change).

The default `verify` job is unchanged: `**/*.eval.ts` and `evals/harness/runEval.ts`
are excluded from the default Vitest project (`vite.config.ts` `test.exclude`).
