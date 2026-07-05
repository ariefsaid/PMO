# ADR-0052 — Agent eval harness: `*.eval.ts` behavior-regression net against the deployed loop

- **Status:** Accepted (implementation landed on `dev` with PR #237 — harness + scorers + isolation + workflow; the deployed-target credentials + nightly cadence remain owner-provisioned per §OQ-1)
- **Date:** 2026-07-05
- **Deciders:** Director, eng-planner
- **Related:** ADR-0040/0043/0045 (agent loop + SSE contract), ADR-0041 (`ModelClient` seam — reused by `llmJudge`), ADR-0039 (untrusted-output boundary), ADR-0036 §2 / ADR-0016 (deputy invariant), ADR-0030 (QA portfolio — deterministic Layer-1 gate-tests, of which this is the NON-deterministic complement), ADR-0010 (test pyramid).
- **Spec:** `docs/specs/agent-tier2-capabilities.spec.md` §4 (FR-AT2-EV-001..006), NFR-AT2-SEC-005, §OQ-1.
- **Plan:** `docs/plans/2026-07-05-agent-eval-harness.md` (Track V).

---

## Context

The production agent model is `deepseek/deepseek-v4-flash` — a cheap, **weak tool-selector**. The deterministic
Layer-1 gate-tests (ADR-0030 §C: chart-position, money, dates, a11y, visual-regression) and the ADR-0010 unit/
pgTAP/e2e pyramid all assert **deterministic** correctness; none of them catch a **behavior-quality**
regression like "the model stopped choosing `query_entity` for a list request" or "answers got vague." The
prompt-steering work (ADR-0050) is unit-tested only for the presence of steering TEXT, not for the model acting
on it — the experience-layer plan explicitly flags this gap (`docs/plans/2026-07-05-agent-experience-layer.md`
§7: the eval harness is the intended gate for real-model reliability).

Two hard constraints shape where evals can run:
1. **Edge functions do not run in CI.** The `integration` job disables `edge_runtime` in `config.toml`; only
   `deno check` + a boot-smoke run over `supabase/functions/**` (`.github/workflows/ci.yml:112-134`). The real
   agent loop (model call + tool selection) is only reachable via a **deployed** function or a local
   `supabase functions serve`.
2. **A real loop needs a real provider key + a cost budget.** Any run that exercises the actual model costs
   money and is nondeterministic — it must never contaminate the deterministic `verify` fast lane.

## Decision

Adopt a **`*.eval.ts` behavior-regression harness** with these properties (owner-decided architecture):

1. **Evals run against the DEPLOYED `agent-chat` function, on-demand / nightly — NOT per-PR, NOT in `verify`.**
   The harness POSTs to the deployed staging endpoint with a **test-user JWT** (the deputy path), parses the SSE
   stream (`decodeSseStream`, reused from `transport.ts`), and scores the collected outcome. This exercises the
   REAL model path (FR-AT2-EV-003) without needing the edge runtime in CI.

2. **The `*.eval.ts` contract:** a file exports `defineEvalSuite({ name, cases })`; each case is
   `{ name, prompt, context?, expect: Scorer[] }` — a natural-language prompt through the real loop + composable
   scorers (FR-AT2-EV-001).

3. **Composable scorers:** `usesTool(name)` (the run called a named action — free inspection), `contains(text|RegExp)`
   (the answer matches — free), `llmJudge(rubric)` (a cheap-tier model grades the answer PASS/FAIL — one model
   call). A case passes iff EVERY scorer passes; each scorer reports its own failure reason (FR-AT2-EV-002).

4. **Runner = a dedicated Vitest project.** `*.eval.ts` files are a separate Vitest config
   (`vitest.eval.config.ts`) run by `npm run test:evals`; the default project + `verify` EXCLUDE `**/*.eval.ts`.
   Vitest's own non-zero exit on any failing case is the exit-code gate (FR-AT2-EV-004). The scorer LOGIC is
   deterministically unit-tested in the normal suite (runs in `verify`) so a scorer bug is caught separately
   from model flakiness.

5. **A failing eval blocks ONLY its own dedicated gate** — a scheduled/`workflow_dispatch` `agent-evals` job —
   never `verify`, never a PR→dev merge (FR-AT2-EV-006, DEC-8). Default posture: a red nightly suite is a
   signal/alert, not a merge-block. The owner MAY later opt it into a required PR→main check (a
   branch-protection toggle, no code change).

6. **Deputy invariant + secrets (NFR-AT2-SEC-005):** the harness authenticates as a real **test user** (JWT),
   never `service_role`. The provider key (loop + judge) is a CI secret, masked, never committed, never logged
   beyond scorer reasons. The judge's output crosses the ADR-0039 boundary — parsed to a bounded PASS/FAIL
   token, never executed or re-injected as an instruction. A case whose env vars are absent **skips gracefully**
   (never a red on a missing secret).

## Consequences

**Positive:**
- The first real regression net for agent behavior on the weak prod model; closes the ADR-0050 "prompt says it,
  does the model do it?" gap.
- Reuses shipped seams (`decodeSseStream`, `OpenRouterModelClient`) — the eval exercises the exact wire the
  browser does; a runtime change is caught here for free.
- Nondeterminism is contained: off the merge fast lane, so a flaky model/judge can never redden `verify` or
  block a PR→dev. Scorer logic is deterministically unit-tested.
- Scales by adding a `*.eval.ts` case (each new agent behavior adds its regression case), not by rewrites.

**Negative / risks (mitigated):**
- **Costs money + needs a live deployed target.** Bounded by a small curated suite, serial execution, cheap
  models, one judge call per case, a `max_tokens` cap, and a nightly (not per-commit) cadence. The owner sets
  the ceiling + cadence (§OQ-1).
- **A `*.eval.ts` leaking into `verify` would flake the fast lane + need a live key.** Guarded by the
  `**/*.eval.ts` exclusion in the default Vitest project (the load-bearing config invariant a reviewer checks).
- **Judge nondeterminism.** A weak judge is noisy; the model id is configurable (`EVAL_JUDGE_MODEL`) so the
  owner picks the cost/quality point. `usesTool`/`contains` (deterministic) carry the high-signal assertions;
  `llmJudge` is for answer-quality only.

## Alternatives considered

- **Local `supabase functions serve` in CI.** Rejected as the DEFAULT: still needs a live OpenRouter key + the
  whole Supabase stack + the deployed model in the CI job, and couples the regression net to the merge lane —
  the owner explicitly wants it decoupled. It remains available for a developer's inner loop (point
  `EVAL_AGENT_CHAT_URL` at localhost).
- **A Deno-native eval runner.** Rejected: the scorers + case files are plain TS the existing Vitest toolchain
  runs; the harness only needs to CALL the function over HTTP, not host it — so no Deno runtime is required to
  run the evals, and Vitest gives the runner/reporter/exit-code for free.
- **Mocking the model / a stubbed loop.** Rejected by FR-AT2-EV-003: a fabricated tool-call proves nothing
  about production tool selection on the weak model — the entire point is REAL model behavior.
