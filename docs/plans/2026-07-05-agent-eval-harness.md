# Implementation plan — Agent eval harness (agent-behavior-quality regression net)

- **Date:** 2026-07-05
- **Issue:** PMO agent-tier2 — the `*.eval.ts` behavior-regression harness for the agent loop (mining item 10). The prod model is `deepseek/deepseek-v4-flash` — a weak tool-selector; this is the net that catches tool-selection / answer-quality regressions the deterministic gate-tests cannot.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-tier2-capabilities.spec.md` §4 (FR-AT2-EV-001..006), NFR-AT2-SEC-005, AC-AT2-015/016, §OQ-1.
- **ADR authored with this plan:** `docs/adr/0052-agent-eval-harness.md` (the `*.eval.ts` contract + composable-scorer pattern + the deployed-function-on-demand gate as a durable convention).
- **Owner-decided architecture (baked in, do NOT re-open):** evals run against the **DEPLOYED** `agent-chat` function **on-demand / nightly** with a small cost budget — **NOT per-PR**, and **NOT in the `verify` fast lane**. Edge functions do not run in CI (`edge_runtime` disabled in `config.toml`; only `deno check` + boot-smoke run over `supabase/functions/**` — `.github/workflows/ci.yml:112-134`). So the harness targets the deployed function over HTTP with a test-user JWT (the deputy path), parses its SSE stream, and scores the outcome. See DEC-1/§OQ-1.
- **Depends-on ADRs (unchanged, controlling on conflict):** ADR-0040/0043/0045 (the agent loop + SSE contract), ADR-0041 (`ModelClient` seam — reused by `llmJudge`), ADR-0039 (untrusted-output boundary), ADR-0036 §2 / ADR-0016 (deputy invariant — evals run under a TEST-USER JWT, never `service_role`), ADR-0010 (test pyramid — an eval is NOT an ADR-0010 AC-owned test; it is a separate behavior net).
- **Format model:** `docs/plans/2026-07-05-agent-experience-layer.md`.

## ✅ Progress (updated 2026-07-05 — implementation landed on `dev` via PR #237)

**Built (all V tasks):**
- **V1+V2 — scorers + deterministic unit tests (AC-AT2-015 scorer half, runs in `verify`):**
  `evals/harness/scorers.ts` exports `EvalRunResult`, `Scorer`, `usesTool`/`contains`/`llmJudge`
  + `runScorers`; `evals/harness/scorers.test.ts` (12 tests) proves pass/fail/composition +
  the fail-closed `llmJudge` (PASS verdict, FAIL reason, malformed body, thrown call).
- **V3 — dedicated eval Vitest project + isolation (AC-AT2-016 exit half, FR-AT2-EV-004/006):**
  `vitest.eval.config.ts` (`include: ['evals/cases/**/*.eval.ts']`, `fileParallelism:false`,
  `testTimeout:60_000`, no coverage); `vite.config.ts` `test.exclude` adds `evals/cases/**` +
  `evals/harness/runEval.ts`; `package.json` gains `test:evals`. Verified: `npm run test:evals`
  with no env SKIPS all cases (exit 0); the default `npx vitest run evals/` runs ONLY
  `scorers.test.ts` (eval cases + the runner module are excluded).
- **V4 — real-loop drive + first case (AC-AT2-015 loop half, FR-AT2-EV-001/003, DEC-1/DEC-6):**
  `evals/harness/runEval.ts` — `defineEvalSuite`, `runEvalCase` (test-user JWT via
  `signInWithPassword` → POST `${EVAL_AGENT_CHAT_URL}` → `decodeSseStream` → fold into
  `EvalRunResult`), and `runEvalSuite` (emits one Vitest `it` per case; per-case
  skip-on-missing-env — NFR-AT2-SEC-005). `evals/cases/tool-selection.eval.ts` ships 2 anchor
  cases (list→`query_entity`, grounded answers).
- **V5 — convention record:** `evals/README.md` (what an eval is, how to add a case, env vars,
  secrets discipline, where it runs).
- **V6 — CI workflow:** `.github/workflows/agent-evals.yml` (nightly cron + `workflow_dispatch`,
  NEVER push/PR; masks secrets; `npm run test:evals`). Non-merge-blocking by default (DEC-8).

**Verification (binding pre-PR gate):** `npm run typecheck` + `npx eslint evals/ vitest.eval.config.ts`
green; `npx vitest run evals/` → only `scorers.test.ts` (12 tests) runs; `npm run test:evals`
with no env → 2 cases SKIP, exit 0. The full `npm run verify` is the pre-PR gate (scorer test
included; no eval case runs).

**Owner-pending (NOT the build agent's to do — §OQ-1):** provision the GH secrets
(`EVAL_AGENT_CHAT_URL`, `EVAL_TEST_USER_EMAIL`/`PASSWORD`, `VITE_SUPABASE_URL`/`ANON_KEY`,
`OPENROUTER_API_KEY`, `EVAL_JUDGE_MODEL`) targeting the STAGING/DEMO Supabase project's
`agent-chat` + a seeded non-privileged test user; set the nightly cron cadence + cost ceiling.
Until provisioned, the workflow runs but every case SKIPS (graceful, NFR-AT2-SEC-005) — the
machinery + isolation + workflow land now and light up the moment the env exists.

> ## ⚠ Read before building
> - **Current-state audit spot-checked (2026-07-05) — the spec §0 audit is accurate:** no `*.eval.ts` files
>   exist (`find` → none); no `usesTool`/`contains`/`llmJudge` scorer module. The deployed function is HTTP/SSE
>   (`supabase/functions/agent-chat/index.ts` — POST `{messages, context?, decision?, answer?}`, returns
>   `text/event-stream`). The SSE decoder already exists and is reusable: `decodeSseStream(reader)` in
>   `pmo-portal/src/lib/agent/runtime/transport.ts:90` yields `AgentEvent`s; `AgentChatRequest` is at :47. Tool
>   calls surface as `AgentEvent{type:'tool', payload:{name,input,result}}`; the final answer is the merged
>   `AgentEvent{type:'assistant'}.text` (concatenated across chunks — the same `mergeAssistantEvent` fold the
>   client uses, `useAssistantPanel.ts:160`). The `ModelClient` seam for `llmJudge` is `OpenRouterModelClient`
>   (`supabase/functions/_shared/openRouterModelClient.ts` — pure fetch, Node-importable, ADR-0039 dec-7).
> - **This plan writes NO app/edge code and NO migration.** The harness is a stand-alone Node test-runner
>   (Vitest project) + scorer modules + `*.eval.ts` case files + a nightly/dispatch GH workflow. It exercises
>   the ALREADY-DEPLOYED function; it does not modify `handler.ts`/`actions.ts`/`index.ts`. If a case reveals a
>   handler bug, that is a SEPARATE issue — the harness's job is to detect, not fix.
> - **Secrets discipline (NFR-AT2-SEC-005, env-file-privacy MEMORY):** the harness reads a **test-user JWT** and
>   an **OpenRouter key** (for `llmJudge`) from process env / GH secrets ONLY — never from `.env`/`op.*.env`
>   files, never `service_role`. Tests that lack the env vars **skip gracefully** (never fail red for a missing
>   secret). The env-var NAMES and how they're provisioned are the owner's (§OQ-1) — the plan reads them, never
>   prints them.
> - **Owner-confirmable specifics flagged in §7:** which deployed target (the STAGING/DEMO Supabase project
>   `prwccpsiumjzvnwjlkwq` per the deployment MEMORY, NOT a client prod project), the test-user credentials
>   source (1Password vault `AS` via `op-get.sh`), the per-run cost budget ceiling, and the schedule cadence.

---

## 0. Decisions this plan fixes (mechanical choices the spec/ADRs delegated)

| ID | Choice | Resolution (binding for this plan) |
|---|---|---|
| **DEC-1 — where evals run (§OQ-1, owner-decided)** | local `functions serve` vs deployed | **The DEPLOYED function, on-demand/nightly.** The harness POSTs to `${EVAL_AGENT_CHAT_URL}` (the deployed staging `agent-chat` endpoint) with a test-user JWT, exercising the REAL model path (FR-AT2-EV-003). NOT per-PR, NOT in `verify`. Rationale: edge functions don't run in CI (`edge_runtime` off), a `functions serve` step in CI would still need a live OpenRouter key + the whole Supabase stack + the deployed model, and the owner wants the regression net decoupled from the merge fast lane (FR-AT2-EV-006). A local `functions serve` run stays available for a developer's inner loop (same URL env var pointed at `http://localhost:54321/...`), but CI targets the deployed URL. |
| **DEC-2 — the runner** | Deno test vs Node/Vitest | **Node + Vitest, a dedicated Vitest project.** The scorers + case files are plain TS the existing Vitest toolchain already runs; the harness talks to the function over HTTP (no Deno runtime needed to CALL it). A dedicated Vitest config (`vitest.eval.config.ts`) with `include: ['**/*.eval.ts']` isolates evals from the unit suite so `npm test`/`verify` never picks them up (FR-AT2-EV-006). A new npm script `test:evals` runs ONLY that project. Exit code is Vitest's own (non-zero on any failing case → FR-AT2-EV-004). |
| **DEC-3 — the `*.eval.ts` contract** | shape of a case file | An `*.eval.ts` file exports `default defineEvalSuite({ name, cases })` where each case is `{ name: string; prompt: string; context?: RunContext; expect: Scorer[] }` (FR-AT2-EV-001). A shared `runEvalSuite(suite)` (imported by a thin `evals/run.eval.ts` aggregator, or each file self-registers via a Vitest `describe`/`it` wrapper) drives each case through the deployed loop and asserts every scorer passes. **Chosen shape:** each `*.eval.ts` is itself a Vitest test file — `defineEvalSuite` emits a `describe` with one `it` per case, so Vitest's runner + reporter + exit code are reused directly (no bespoke runner/exit-code plumbing). |
| **DEC-4 — scorer contract** | shape of a `Scorer` | `type Scorer = (run: EvalRunResult) => { pass: boolean; reason: string }` where `EvalRunResult = { toolCalls: {name,input,result}[]; answerText: string; events: AgentEvent[] }` — the collected outcome of one deployed run. `usesTool(name)`, `contains(text | RegExp)`, and `llmJudge(rubric)` are factory functions returning a `Scorer`. Scorers COMPOSE: a case passes iff EVERY scorer returns `pass:true`; each scorer's `reason` is surfaced on failure (FR-AT2-EV-002). |
| **DEC-5 — `llmJudge` model** | which model grades | A **cheap-tier** model via the SAME `ModelClient` seam (`OpenRouterModelClient`), model id from `EVAL_JUDGE_MODEL` (default a cheap judge, e.g. `deepseek/deepseek-v4-flash` or a small instruct model — owner-confirmable, §7). The judge gets the rubric + the candidate answer and returns a strict `PASS`/`FAIL` token the scorer parses; a non-`PASS` (including a parse failure) is `pass:false` with the judge's text as the reason. `llmJudge` is the ONLY scorer that costs an extra model call — `usesTool`/`contains` are free (pure inspection of the collected run). |
| **DEC-6 — deputy invariant + untrusted boundary (NFR-AT2-SEC-005)** | how the harness authenticates + treats output | The harness authenticates as a **test user** (a real seeded account on the target project) and sends that user's JWT in the `Authorization: Bearer` header — the EXACT deputy path a browser uses. It NEVER uses `service_role`. The judge's output crosses the ADR-0039 boundary: it is parsed as a bounded PASS/FAIL token, never executed, never fed back as an instruction. |
| **DEC-7 — cost budget (FR-AT2-EV-005, §OQ-1)** | how the run stays cheap | The suite is SMALL (a curated set of high-value cases — start ~6-10, one per critical tool-selection behavior), each is one bounded run + at most one `llmJudge` call. A hard per-run `max_tokens` cap + a suite-level case cap (`EVAL_MAX_CASES`, default all) keep the total call count low. The workflow's cost ceiling is enforced operationally (a small curated suite + cheap models); the plan documents the estimate, the owner sets the ceiling (§7). |
| **DEC-8 — what a failing eval blocks (FR-AT2-EV-006)** | the gate | A failing eval blocks **only its own dedicated gate** — the scheduled/`workflow_dispatch` `agent-evals` job — never the `verify` fast lane and never a PR→dev merge. On the nightly/dispatch run, a red suite is a **signal** (issue-opening / alert), and MAY be wired as a required check on PR→main IF the owner opts in later (§OQ-1); default is non-merge-blocking nightly. This keeps a nondeterministic LLM-scored suite off the deterministic merge path. |

**File layout (all NEW, under `pmo-portal/`):**
- `pmo-portal/evals/harness/scorers.ts` — `usesTool`/`contains`/`llmJudge` + the `Scorer`/`EvalRunResult` types.
- `pmo-portal/evals/harness/runEval.ts` — `defineEvalSuite`, the HTTP-drive-one-case fn, the collect-run helper.
- `pmo-portal/evals/harness/scorers.test.ts` — UNIT tests of the scorer logic against a FAKE `EvalRunResult` (AC-AT2-015 scorer half — runs in the normal `verify` suite, no network, deterministic).
- `pmo-portal/evals/cases/tool-selection.eval.ts` — the first real case file (drives the deployed loop).
- `pmo-portal/vitest.eval.config.ts` — the dedicated Vitest project (`include: ['evals/cases/**/*.eval.ts']`).
- `.github/workflows/agent-evals.yml` — the `workflow_dispatch` + nightly `schedule` gated job.
- `package.json` — a `test:evals` script; `vitest.config.ts` EXCLUDES `**/*.eval.ts` from the default project.

---

## 1. Architecture & data flow

```
── The eval loop (one case) ─────────────────────────────────────────────────
tool-selection.eval.ts  →  defineEvalSuite({ name, cases:[{ name, prompt, context?, expect:[Scorer] }] })
        │  (Vitest describe/it per case — DEC-3)
        ▼
runEvalCase(case):
   1. auth: sign in the TEST USER (email/pw from env) → JWT   (deputy path, NEVER service_role — DEC-6)
   2. POST ${EVAL_AGENT_CHAT_URL}  { messages:[{role:'user', content: prompt}], context? }
              Authorization: Bearer <test-user JWT>
   3. read the SSE body via decodeSseStream(reader)  (transport.ts:90 — REUSED)
   4. collect → EvalRunResult { toolCalls:[{name,input,result}], answerText, events }
              (tool events → toolCalls; assistant chunks → merged answerText via mergeAssistantEvent fold)
        ▼
   for scorer of case.expect:  { pass, reason } = scorer(result)   (all must pass — DEC-4)
        │        ├─ usesTool('query_entity')  → toolCalls.some(t => t.name==='query_entity')     (free)
        │        ├─ contains('Alpha')          → answerText matches substring/RegExp               (free)
        │        └─ llmJudge(rubric)           → OpenRouterModelClient.create(judge prompt) → PASS?  (1 model call)
        ▼
   assert every scorer.pass === true (Vitest `expect`), each failing scorer's `reason` in the message
        ▼
Vitest exit code: non-zero on any failing case  (FR-AT2-EV-004)

── Where it runs (DEC-1/DEC-8) ──────────────────────────────────────────────
.github/workflows/agent-evals.yml   (schedule nightly + workflow_dispatch — NOT on push/PR)
   npm run test:evals   (vitest.eval.config.ts project ONLY)
   env: EVAL_AGENT_CHAT_URL, EVAL_TEST_USER_EMAIL/PASSWORD, OPENROUTER_API_KEY, EVAL_JUDGE_MODEL
        → targets the DEPLOYED staging agent-chat function (real deepseek-v4-flash)
   red suite → job fails → alert/issue (non-merge-blocking by default — DEC-8)

ci.yml `verify` job: UNCHANGED. `**/*.eval.ts` excluded from the default Vitest project (FR-AT2-EV-006) —
the eval files never run in verify; verify stays provider-key-free + deterministic.
```

**Deputy invariant + ADR-0039 boundary stay explicit (NFR-AT2-SEC-005):**
- The harness authenticates as a **real test user** and sends that user's JWT — the exact deputy path
  (ADR-0036 §2). It never constructs a `service_role` client; a foreign/forged id in a case degrades to a
  zero-row RLS read, same as any browser call. The eval proves the loop's BEHAVIOR, never a privileged path.
- The `OPENROUTER_API_KEY` (loop + judge) is a CI secret, never committed, masked in logs; the harness prints
  ids/scorer reasons/`kind` only — never the raw answer text beyond the scorer's own reason, never the key
  (NFR-AT2-SEC-006).
- The judge's output is untrusted model content: parsed to a bounded PASS/FAIL token, never executed or
  re-injected as an instruction (ADR-0039).

---

## 2. Traceability (FR → owning test/proof → task)

| FR | AC | Layer | Owning test/proof (title / file) | Task |
|---|---|---|---|---|
| FR-AT2-EV-002 | AC-AT2-015 (scorer half) | Unit | `AC-AT2-015 usesTool/contains/llmJudge scorers pass/fail with reasons` · `evals/harness/scorers.test.ts` | V2 |
| FR-AT2-EV-001/003 | AC-AT2-015 (loop half) | Harness | `AC-AT2-015 eval case runs against the real loop` · `evals/cases/tool-selection.eval.ts` | V4 |
| FR-AT2-EV-004 | AC-AT2-016 | Harness/CI | `AC-AT2-016 failing eval exits non-zero; green exits zero` · Vitest exit code (V3 config) + V6 workflow | V3, V6 |
| FR-AT2-EV-005 | (in DEC-1) | — | deployed-target env wiring (V4/V6) | V4, V6 |
| FR-AT2-EV-006 | AC-AT2-016 (gate half) | CI | eval excluded from `verify`; own `agent-evals` job | V5, V6 |
| NFR-AT2-SEC-005 | (in V4) | Harness | deputy-JWT auth, never service_role; graceful skip on missing env | V4 |

> AC-AT2-015 is split: the **scorer logic** is a deterministic UNIT test (V2, runs in `verify`); the **real-loop
> execution** is the harness half (V4, runs only in the eval job). AC-AT2-016 is the exit-code + gate proof
> (V3 config + V6 workflow). An eval is NOT an ADR-0010 AC-owned test — it is the separate behavior net.

---

## TRACK V — Eval harness

### Task V1 — Scorer + run-result types + `defineEvalSuite` skeleton (support) — FR-AT2-EV-001/002, DEC-3/DEC-4
**Files:** `pmo-portal/evals/harness/scorers.ts` (NEW) + `pmo-portal/evals/harness/runEval.ts` (NEW)
- **`scorers.ts`:** export the types
  ```ts
  export interface EvalRunResult {
    toolCalls: { name: string; input: unknown; result: unknown }[];
    answerText: string;
    events: import('@/src/lib/agent/runtime/port').AgentEvent[];
  }
  export type Scorer = (run: EvalRunResult) => { pass: boolean; reason: string };
  ```
  and the three factories (signatures only in V1; logic proven by V2):
  `export function usesTool(name: string): Scorer`,
  `export function contains(needle: string | RegExp): Scorer`,
  `export function llmJudge(rubric: string, opts?: { model?: string }): Scorer` — note `llmJudge` needs an
  async model call, so its `Scorer` may be async: widen `Scorer` to `(run) => Result | Promise<Result>` and
  `await` each scorer in the runner. Keep `usesTool`/`contains` synchronous (pure inspection).
- **`runEval.ts`:** export
  ```ts
  export interface EvalCase { name: string; prompt: string; context?: import('@/src/lib/agent/runtime/port').RunContext; expect: Scorer[] }
  export interface EvalSuite { name: string; cases: EvalCase[] }
  export function defineEvalSuite(suite: EvalSuite): EvalSuite { return suite; }
  ```
  plus the (V4) drive/collect helpers declared here.

**Verify:** `cd pmo-portal && npm run typecheck` → zero errors (types + stubs compile).

### Task V2 — Scorer unit tests (RED→GREEN, deterministic, runs in verify) — AC-AT2-015 (scorer half), FR-AT2-EV-002
**File:** `pmo-portal/evals/harness/scorers.test.ts` (NEW) — a NORMAL Vitest unit test (NOT `.eval.ts`), so it
runs in `verify`. Mock the `ModelClient` for `llmJudge` (no network).
- **`usesTool`:** given a fake `EvalRunResult` whose `toolCalls` includes `{name:'query_entity',...}`, assert
  `usesTool('query_entity')(run).pass === true`; given none, `pass === false` with a reason naming the missing
  tool.
- **`contains`:** given `answerText: 'Project Alpha is on track'`, assert `contains('Alpha')(run).pass === true`
  and `contains(/beta/i)(run).pass === false` with a reason.
- **`llmJudge`:** inject a fake `ModelClient` returning `PASS` → `pass === true`; returning `FAIL: too vague` →
  `pass === false` with the judge text as reason; returning a malformed body → `pass === false` (fail-closed).
- **Composition:** a helper that runs `[usesTool, contains]` over a run passes iff both pass, and surfaces each
  failing scorer's reason.
- Title: `AC-AT2-015 usesTool/contains/llmJudge scorers pass/fail with reasons`.

**Verify (RED then GREEN):** `npx vitest run evals/harness/scorers.test.ts` — fails until V1's scorer logic is
implemented, then passes. (V1 ships the signatures; the LOGIC is written to make V2 green — TDD red→green.)

### Task V3 — Dedicated Vitest eval project + exit-code isolation (GREEN) — AC-AT2-016 (exit half), FR-AT2-EV-004/006, DEC-2
**Files:** `pmo-portal/vitest.eval.config.ts` (NEW) + `pmo-portal/vitest.config.ts` (EDIT) + `package.json` (EDIT)
- **`vitest.eval.config.ts`:** a Vitest config with `test.include: ['evals/cases/**/*.eval.ts']`, a longer
  `testTimeout` (a deployed run + judge call can take ~20-30s — set `testTimeout: 60_000`), and
  `test.fileParallelism: false` (serial, to stay within the cost budget + avoid rate-limits). No coverage.
- **`vitest.config.ts`:** add `'**/*.eval.ts'` to `test.exclude` so the default project + `verify` NEVER pick up
  eval case files (FR-AT2-EV-006). The scorer UNIT test (`scorers.test.ts`, V2) is NOT `.eval.ts` → still runs
  in `verify`.
- **`package.json`:** add `"test:evals": "vitest run --config vitest.eval.config.ts"`. Vitest's own exit code is
  non-zero on any failing case (FR-AT2-EV-004) — no bespoke exit plumbing.

**Verify:** `cd pmo-portal && npm test` → does NOT execute any `evals/cases/**/*.eval.ts` (grep the run output —
no eval case names); `npm run test:evals` → runs the eval project (0 cases yet / all-skip if env absent → exits
0, proving green-suite-exits-zero). Add a temporary always-failing case locally to confirm a red suite exits
non-zero, then remove it.

### Task V4 — Real-loop drive + collect + first case (harness half) — AC-AT2-015 (loop half), FR-AT2-EV-001/003, NFR-AT2-SEC-005, DEC-1/DEC-6
**Files:** `pmo-portal/evals/harness/runEval.ts` (EDIT — implement drive/collect) + `pmo-portal/evals/cases/tool-selection.eval.ts` (NEW)
- **`runEval.ts` drive/collect:** implement `runEvalCase(c: EvalCase): Promise<EvalRunResult>`:
  1. Read env: `EVAL_AGENT_CHAT_URL`, `EVAL_TEST_USER_EMAIL`, `EVAL_TEST_USER_PASSWORD`, `VITE_SUPABASE_URL`,
     `VITE_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `EVAL_JUDGE_MODEL`. **If any REQUIRED var is missing, the
     Vitest wrapper `it.skip`s the case** (graceful skip — NFR-AT2-SEC-005; never a red on a missing secret).
  2. Auth as the test user via `@supabase/supabase-js` `signInWithPassword` → the caller JWT (the deputy path,
     DEC-6; NEVER `service_role`).
  3. `fetch(EVAL_AGENT_CHAT_URL, { method:'POST', headers:{ Authorization:'Bearer <jwt>', 'Content-Type':'application/json' }, body: JSON.stringify({ messages:[{role:'user', content: c.prompt}], ...(c.context ? {context:c.context} : {}) }) })`.
  4. Parse the SSE body: `for await (const ev of decodeSseStream(res.body!.getReader())) { ... }` — REUSE
     `decodeSseStream` from `@/src/lib/agent/runtime/transport`. Collect `type:'tool'` payloads into
     `toolCalls`, fold `type:'assistant'` chunks into `answerText` (same concat as `mergeAssistantEvent`), keep
     all `events`.
  5. Return the `EvalRunResult`.
  - Implement `defineEvalSuite`'s Vitest emission: `runEvalSuite(suite)` (called at the bottom of each
    `.eval.ts`) does `describe(suite.name, () => { for (const c of suite.cases) it(c.name, async () => { const run = await runEvalCase(c); for (const s of c.expect) { const { pass, reason } = await s(run); expect(pass, reason).toBe(true); } }); })` — with the env-missing `it.skip` guard applied per case.
- **`tool-selection.eval.ts` (first real case, AC-AT2-015):**
  ```ts
  export default runEvalSuite(defineEvalSuite({
    name: 'agent tool-selection',
    cases: [{
      name: 'AC-AT2-015 asks for a list → uses query_entity and grounds the answer',
      prompt: 'List my companies.',
      expect: [ usesTool('query_entity'), contains(/compan/i) ],
    }],
  }));
  ```
  Add 1-2 more high-value cases (a tabular request that should pick `as:"table"`; an ambiguous request that
  should pick `ask_user`) — each a documented critical tool-selection behavior for the weak prod model.
  Leading token `AC-AT2-015` on the anchor case's `it` title.

**Verify:** with the eval env vars exported to the shell (owner-provided, never read from a file), from
`pmo-portal/`: `npm run test:evals` → the tool-selection case runs against the deployed loop and passes (the
deployed `deepseek-v4-flash` picks `query_entity` for "List my companies"); without the env vars, the case
SKIPS (not red). **Do NOT commit any secret** — the vars come from the shell/GH secrets.

### Task V5 — Exclude evals from the default suite + doc the convention (GREEN) — FR-AT2-EV-006, DEC-8
**Files:** confirm `vitest.config.ts` exclusion (V3) holds + add a short `pmo-portal/evals/README.md` (NEW)
documenting: what an eval is (behavior net, not an ADR-0010 AC test), how to add a `*.eval.ts` case, the env
vars it needs (names only, never values), that it targets the DEPLOYED staging function, and that a red suite
is a signal not a merge-block (DEC-8). This is the durable convention record (points to ADR-0052).

**Verify:** `cd pmo-portal && npm run verify` → green AND its test run includes `scorers.test.ts` but NOT any
`evals/cases/**/*.eval.ts` (grep the output).

### Task V6 — `agent-evals` GitHub workflow (nightly + dispatch) — AC-AT2-016 (gate half), FR-AT2-EV-004/005/006, DEC-1/DEC-7/DEC-8
**File:** `.github/workflows/agent-evals.yml` (NEW)
- Triggers: `schedule` (a nightly cron, e.g. `0 6 * * *`) + `workflow_dispatch` (manual). **NOT** `push`/
  `pull_request` (FR-AT2-EV-006 — off the merge fast lane).
- `permissions: contents: read`. One job `agent-evals` on `ubuntu-latest`, `defaults.run.working-directory: pmo-portal`.
- Steps: checkout → setup-node 22 + npm cache → `npm ci` → `npm run test:evals`, with `env:` populated from
  **GitHub secrets** (`EVAL_AGENT_CHAT_URL`, `EVAL_TEST_USER_EMAIL`, `EVAL_TEST_USER_PASSWORD`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `EVAL_JUDGE_MODEL`) — `echo "::add-mask::..."` the JWT/key.
- Cost guard (DEC-7): the suite is small + serial (`fileParallelism:false`, V3) + one `llmJudge` call max per
  case; document the estimated per-run call count in a comment. Owner sets the cron cadence + any hard cost cap.
- A failing suite fails the JOB → GitHub surfaces it (and, if the owner wires it, opens an issue / alerts) —
  but it is NOT a required status check on any PR by default (DEC-8). If the owner later opts into merge-blocking
  on PR→main, add the workflow as a required check then (§OQ-1) — no code change, a branch-protection setting.

**Verify:** the workflow is syntactically valid (`actionlint .github/workflows/agent-evals.yml` if available, or
a `workflow_dispatch` dry-run on the branch); a manual dispatch runs `test:evals` against the deployed function
and reports per-case pass/fail; a green suite → job success (exit 0), a red case → job failure (exit non-zero).

---

## 3. Full gate (binding pre-PR)

From `pmo-portal/`, in order:
1. `npm run verify` — the WHOLE suite; confirm `scorers.test.ts` runs and no `*.eval.ts` case runs (the
   exclusion holds — a leaked eval case would need a live key and would flake `verify`, the exact thing
   FR-AT2-EV-006 forbids).
2. `npm run test:evals` locally with the eval env exported (owner-provided) → the curated cases pass against
   the deployed loop; without the env, they SKIP (graceful, NFR-AT2-SEC-005).
3. The `agent-evals` workflow validates + a manual `workflow_dispatch` on the branch succeeds.

**Only after** the review battery (3-lens code review + security-auditor on the deputy-JWT/no-service_role +
untrusted-judge-output boundary + the secret-handling discipline) → PR to `dev`. The workflow does NOT gate the
PR (DEC-8). `main`/`production` promotes + the deployed-target/secret provisioning are owner-gated (§OQ-1).

---

## 4. Type/signature consistency (guard across tasks)

- **`Scorer = (run: EvalRunResult) => Result | Promise<Result>`**, `Result = { pass: boolean; reason: string }`
  (V1/DEC-4) — the runner `await`s every scorer (V4). `usesTool`/`contains` sync; `llmJudge` async (one model
  call via `OpenRouterModelClient`, DEC-5).
- **`EvalRunResult { toolCalls: {name,input,result}[]; answerText: string; events: AgentEvent[] }`** — produced
  by `runEvalCase` (V4) from the SSE stream (`decodeSseStream`, `transport.ts:90`), consumed by every scorer.
- **`EvalCase { name; prompt; context?: RunContext; expect: Scorer[] }` + `EvalSuite { name; cases }`** (V1) —
  `RunContext` is the SAME type the browser sends (`port.ts`), so a case can ground on an entity exactly like a
  real turn.
- **Env-var names** are the SINGLE contract shared by `runEvalCase` (V4) + the workflow (V6): `EVAL_AGENT_CHAT_URL`,
  `EVAL_TEST_USER_EMAIL`, `EVAL_TEST_USER_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `OPENROUTER_API_KEY`, `EVAL_JUDGE_MODEL` — read from process env ONLY, never a file (env-file-privacy).

## 5. Scaling / risk notes (Performance + Architecture + Existing-repo lenses)

- **Reuses the shipped SSE + ModelClient seams (Existing-repo lens):** the harness adds NO parsing/transport of
  its own — `decodeSseStream` + `OpenRouterModelClient` are reused, so the eval exercises the exact wire the
  browser does. A future runtime change to the SSE frame is caught here for free.
- **Nondeterminism is contained (Architecture lens, DEC-8):** the LLM-scored suite is off the deterministic
  merge lane; a flaky judge/model can never redden `verify` or block a PR→dev. The scorer LOGIC is
  deterministically unit-tested (V2) so a scorer bug is caught in `verify`, separate from model flakiness.
- **Cost is bounded (Performance lens, DEC-7):** small curated suite + serial + cheap models + one judge call
  per case + `max_tokens` cap; nightly cadence. The owner sets the ceiling. Growing the suite is adding a
  `*.eval.ts` case — the harness scales by cases, not by rewrites.
- **Deputy invariant + secrets (Security lens, NFR-AT2-SEC-005/006):** test-user JWT only, never `service_role`;
  keys from GH secrets/shell env only, masked, never logged; judge output treated as untrusted (ADR-0039). The
  reviewer-guarded invariant: `runEvalCase` constructs a caller-JWT client and NEVER a `service_role` one.
- **`org_id` seam / tenancy:** untouched — no table, no migration. The harness is a client of the deployed
  function; RLS is the ceiling as for any caller.

## 6. Sequencing summary

1. **V1 → V2** (types + scorer logic, deterministic, in `verify`).
2. **V3** (dedicated project + exclusion + `test:evals` script + exit-code isolation).
3. **V4** (real-loop drive + first case) — needs the deployed target + test-user + keys (§OQ-1 owner-provided).
4. **V5** (exclusion confirm + README convention).
5. **V6** (nightly/dispatch workflow).
Minimum shippable increment: **V1+V2+V3+V5** (the harness + deterministic scorer tests + isolation) can land
as a PR even before the deployed-target credentials exist — the real-loop case (V4) + workflow (V6) light up
once the owner provisions the env (§OQ-1). This lets the scorer machinery ship + be reviewed independently of
the secret provisioning.

## 7. Open questions for the Director

1. **[BLOCKS V4/V6] Deployed target + credentials + budget (spec §OQ-1).** Confirm: (a) the eval target is the
   **STAGING/DEMO** Supabase project's `agent-chat` (`EVAL_AGENT_CHAT_URL` → the staging endpoint), NOT a client
   prod project; (b) the **test-user** account (email/password) — source (1Password vault `AS` via `op-get.sh`),
   and that it is a seeded, non-privileged account; (c) the **per-run cost ceiling** and the **schedule cadence**
   (nightly cron time). These become GH secrets + the workflow's cron. Until provisioned, V4 cases SKIP and V6
   is dormant.
2. **[V5/V6] Merge-blocking posture (DEC-8, FR-AT2-EV-006).** Baked in: **non-merge-blocking nightly** by
   default (a red suite is a signal/alert, not a PR block). Confirm — or opt into making `agent-evals` a
   required check on PR→main (a branch-protection toggle, no code change), accepting that a nondeterministic
   suite could then block a merge.
3. **[DEC-5] Judge model.** `EVAL_JUDGE_MODEL` default (a cheap judge). Confirm the model id — a stronger judge
   grades more reliably but costs more; a weak judge is cheaper but noisier. Owner picks the cost/quality point.
4. **[scope] Case corpus.** V4 ships ~2-3 seed cases (list→`query_entity`, tabular→`as:"table"`,
   ambiguous→`ask_user`). The corpus grows as agent behaviors are added (attachments, approvals). Confirm the
   initial set + who curates additions (the implementer of each new agent behavior adds its regression case).
