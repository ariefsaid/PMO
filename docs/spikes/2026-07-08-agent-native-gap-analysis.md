# Agent-Native ↔ PMO gap analysis (grounded)

- **Date:** 2026-07-08
- **Author:** Director (grounded read of both trees)
- **Question:** For the SAME feature (in-app conversational agent: panel + backend + tool/actions
  + run persistence + deploy + observability + metering + automations), what has Builder.io's MIT
  `@agent-native/core` already solved that we're missing, re-deriving badly, or doing more fragilely?
- **Reference tree:** `/Users/ariefsaid/Coding/PMO-sidecar/pmo/agent-native/node_modules/@agent-native/core/`
  (esp. `docs/design/durable-agent-runs.md`, `dist/{checkpoints,chat-threads,observability,usage,progress,triggers,jobs,deploy,file-upload,provider-api}/*.d.ts`)
- **Our tree:** `supabase/functions/agent-chat/*`, `supabase/functions/_shared/*`, `supabase/functions/{health,agent-dispatch,compose-view}/`,
  `pmo-portal/src/lib/agent/runtime/*`, `pmo-portal/src/components/panel/*`, `docs/adr/0036…0045`.

---

## 1. Summary — the top-3 gaps that would most cut our "simple mistakes"

We are actually **further along than the framing implies** — our `persistence.ts` already encodes
most of agent-native's durable-run primitives (natural-key run row, seq continuity, idempotent
journaled tool-writes for de-dupe, heartbeat, loud step-limit terminal, fail-closed metering,
atomic per-org credit reserve). The money-path `!runId` bug was **not** a missing primitive; it was
a lifecycle we hand-modelled from the wrong key. So the highest-leverage adoptions are cheap
**patterns**, not their Nitro/Netlify infrastructure. The three that would most reduce recurring
mistakes:

1. **Model the run lifecycle exactly as their `run-store` does — natural-key `insertRun` → conditional
   *claim* → resume-by-cursor — never a `!runId`/"is this the first POST?" heuristic.** Our bug
   (`persistence.ts` `runExists`, fixed 2026-07-08) is the textbook symptom of keying run-creation on
   request shape instead of run existence. Their `docs/design/durable-agent-runs.md` (steps 2–3,
   idempotency §) makes `!runId` *structurally impossible*: the run row is inserted before dispatch and
   the worker claims it with a conditional `UPDATE … WHERE status='running'`. Adopt the **shape**; we
   already have the tables. (Pattern, cheap, HIGH mistake-risk.)
2. **A per-run trace read-model (their `TraceSummary`/`TraceSpan`) so monitoring is never blind.** The
   reason the `!runId` bug was invisible for so long is that our monitoring is only `agent_usage` +
   `error_events` — there is no "what happened inside run X" view. `observability/types.d.ts` defines a
   `TraceSummary` (llmCalls, toolCalls, successfulTools, failedTools, cost, durationMs, status) that is
   trivially derivable from rows we *already* write (`agent_events` + `agent_usage`). A read-model +
   admin panel would have surfaced "runs never persisted / trace empty" on day one. (Pattern, cheap,
   HIGH.)
3. **`reliable-mutations` discipline: proof-of-done re-read + truthful "N of N committed" terminal for
   batch writes.** Their Phase-0 (`durable-agent-runs.md` "Tie-in") is the cure for silent
   "looked-done" failures. We have journaled-write de-dupe and a loud `MAX_TOOL_ROUNDS` terminal, but a
   multi-write turn can still report success on rows that didn't commit. Encode "after a write, re-read
   and report concrete counts/ids; on cutoff report M of N + remainder." (Pattern, cheap, MED-HIGH.)

The heavier, genuinely-missing capability is **live reconnect to an in-flight run** (their
`GET /runs/active` + `GET /runs/:id/events?after=N` cross-isolate SQL-poll). We persist everything but
cannot *resume the live stream* after a dropped socket — only replay history on a cold load. Worth
doing, but it's the one item that needs new endpoints, not just a pattern.

---

## 2. Prioritized gap table

Mistake-risk = how likely our current approach is to (re)produce a "simple mistake" bug.

| Concern | agent-native ships (path) | PMO status (path) | Mistake pattern (if re-derived badly) | Recommendation | Risk |
|---|---|---|---|---|---|
| **Run lifecycle / create contract** | Insert run row by natural id *before* dispatch; worker claims via conditional `UPDATE…WHERE status='running'`; `!runId` never a signal (`docs/design/durable-agent-runs.md` steps 2–3, "Idempotency/dedup"; `run-store.ts insertRun`/`updateRunStatusIfRunning`) | **Have (just fixed)** — `persistence.ts` `runExists`+`createThreadAndRun` (create-iff-not-exists, idempotent) | **THE money-path bug**: gated creation on `!req.runId` instead of run-existence → real browser runs (FE mints runId on every POST) never persisted → every `agent_events`/`agent_usage` insert 42501 → ≥3-round runs tripped the fail-closed usage breaker → errored + monitoring empty | **Adopt pattern** — codify "run row keyed by id, created iff-not-exists, claimed conditionally; request shape is never the key." Add a regression test asserting a first POST *with* a runId still persists. | **High** |
| **Checkpoints / resume across chunks** | SQL progress checkpoint; idempotent steps; resume skips committed units; "N of N / M of N + remainder" truthful terminal (Option A, `durable-agent-runs.md`; `dist/checkpoints/store.d.ts`) | **Partial** — journaled tool-writes de-dupe (`persistence.ts loadJournaledWrites`+`hashToolArgs`) + `loadMaxSeq` seq continuity give resume-idempotency, but **no committed-count checkpoint** and no batch "N of N" terminal | Their `checkpoints` is git-commit-per-thread (coding-agent specific) — skip that. But the *committed-count* idea is missing: a batch write can look done without proof. | **Adopt pattern only** — add proof-of-done counts to batch actions; skip the git-checkpoint primitive. | **Med** |
| **Run/event persistence idempotency** | `insertRunEvent` is `ON CONFLICT (run_id, seq) DO NOTHING` — re-emit is a safe no-op (`durable-agent-runs.md` "Event persistence") | **Partial** — `agent_events (run_id, seq)` unique, but `insertEvent` is a plain `.insert()` (dup seq → error, swallowed); collisions avoided only by seeding from `loadMaxSeq+1` | A resumed/retried producer re-emitting an event errors instead of no-op'ing; assistant-text events can duplicate across a decision re-POST. | **Adopt pattern** — make `insertEvent` an upsert `on_conflict=run_id,seq, ignoreDuplicates`. One-line change, removes a fragility class. | **Med** |
| **Deploy versioning & staleness** | Immutable hashed assets + long-cache headers (`dist/deploy/immutable-assets.d.ts`); no per-fn deploy-version staleness signal | **Have — and ahead** — per-fn git-SHA baked at deploy (`_shared/version.ts` `DEPLOY_VERSION`), `x-deploy-version` response header (`index.ts`), `health` reports it (`health/index.ts`) | Prior stale-prod-edge-fn shipped silently. Our baked-SHA cannot lie (a shared runtime secret can). | **Skip — we're correct/ahead.** Keep. Only add: a CI/promote check that asserts deployed `x-deploy-version` == pushed SHA. | **Low** |
| **Streaming tokens** | Engine streams deltas into the event stream (`observability/traces.d.ts instrumentAgentLoop send(event)`; SSE) | **Missing (deliberate, queued)** — non-streaming model call (MC-OD-007: accumulate full `ModelResponse`, then emit); FE consumes SSE via `fetch`+`getReader` (`transport.ts decodeSseStream`) but frames are whole events, not tokens | Not a bug — a UX gap (no typing effect; long turns feel frozen until a round completes). | **Adopt pattern (later)** — stream token deltas as `text-delta` events through the existing SSE codec; deepseek/OpenRouter support SSE. Not urgent. | **Med** |
| **Live reconnect / leave-and-return** | `GET /runs/active?threadId` + `GET /runs/:id/events?after=N` → cross-isolate SQL-poll `subscribeFromSQL` (500ms); reconnect is first-class (`durable-agent-runs.md` steps 11–12, "How the client UX changes") | **Missing** — one long-held SSE per POST; on socket drop `index.ts` keeps draining for *persistence* but the browser cannot rejoin the live stream (no `/runs/active`, no `events?after=`; grep confirms none in `pmo-portal/src`) | Close/reopen the tab mid-run = lose the live view; only a cold history reload shows persisted events after the fact. Not data-loss (we persist), but a real UX cliff. | **Adopt pattern, our stack** — add two read endpoints over `agent_runs`/`agent_events` (Supabase can do the poll via PostgREST `?after=seq`); FE resumes from `lastSeq`. Medium build. | **Med** |
| **Durable background execution** | Host-agnostic self-dispatch worker + SQL fan-in; Netlify 15-min `-background` layer (`durable-agent-runs.md` Layers 1–2) | **Partial / N/A for chat** — interactive chat runs inside the edge fn (bounded by Supabase's ~150s wall, capped further by `MAX_TOOL_ROUNDS=8`); **automations** already use fire-and-forget dispatch (`agent-dispatch` via pg_cron, ADR-0044) | Their whole Layer-2 is Netlify-specific; we are Supabase-edge. A long chat turn that exceeds the wall would hard-kill rather than auto-continue. | **Skip the primitive; adopt the seam if needed** — deepseek turns are short and 8-round-capped, so the wall is rarely hit. If it becomes real, reuse the `agent-dispatch` self-dispatch pattern for chat, not Netlify. | **Low** |
| **Error taxonomy & retry/backoff** | Provider quota-governor: cooldown / retry_after / max_attempts, dedupe key (`dist/provider-api/quota-governor.d.ts`) | **Have (thin)** — `openRouterModelClient.ts` bounded retry + exp-backoff + jitter, `provider:{order:['DeepInfra'],allow_fallbacks:true}`; FE `classifyMutationError`; structured `errorLog`/`errorEvent` | Their quota-governor is multi-provider/multi-credential SaaS; we're deepseek-pinned single-key. | **Skip primitive.** Our retry/backoff is adequate; keep. Optionally borrow the "distinguish retryable vs terminal upstream error" taxonomy if 429s become common. | **Low** |
| **Observability & tracing** | `TraceSpan`/`TraceSummary` (per-span type/tokens/cost/duration/status), `instrumentAgentLoop` wrapper, feedback, satisfaction score, cleanup job, overview endpoint + admin routes (`dist/observability/*`) | **Partial** — `agent_usage` (cost/tokens per model call), `error_events`, `FeedbackControl` (thumbs); **no per-run trace summary / tool-span view**; monitoring = usage + errors only | The `!runId` bug was invisible *because* there's no run-trace panel. Blind spot, not a wrong impl. | **Adopt pattern (top-3)** — derive a `TraceSummary` read-model from `agent_events`+`agent_usage`; add an admin "Runs" panel (llm calls, tool calls, failures, cost, status). Cheap, high signal. | **High** |
| **Usage / cost metering** | `recordUsage` (input/output/cache tokens, `refId` overwrite-dedup, cost centicents, per-label/app/model/day buckets), `getUsageSummary` (`dist/usage/store.d.ts`) | **Have** — `_shared/usage.ts` `insertUsageRow`/`recordUsage`, clamped, fail-closed after 3 consecutive failures; `AdministrationUsage` panel; per-org credit reserve/release (`creditRateGuard.ts`) | Aligned. Two smaller misses: no `refId` idempotent-overwrite (re-recording a run double-counts) and no cache-token columns. | **Adopt pattern (small)** — add a `refId`/run-scoped dedup on re-record, and cache-token fields if deepseek reports them. | **Low** |
| **Tool-call rendering & progress UI** | `AgentRun` progress primitive (percent/step/status), `progress/*`, `action-ui` (`dist/progress/types.d.ts`) | **Have** — `ToolCallCard`, `ActivityTrail`, `StuckRunBanner`, live step-trail, `progress_step`+`heartbeat` on `agent_runs` | Aligned; we lack a numeric percent, but our steps are discrete tool rounds where percent is meaningless. | **Skip.** Our discrete-step trail is the right model for an 8-round loop. | **Low** |
| **Automations / scheduled jobs** | `jobs/cron` (nextOccurrence/isValidCron/describeCron) + `triggers` (schedule|event, NL `condition` via Haiku, agentic|deterministic mode) (`dist/{jobs,triggers}/*`) | **Have (idle)** — ADR-0044: `agent_automations` + pg_cron + `agent-dispatch` (mints owner JWT, RLS stays ceiling), NL condition, event triggers via `select_trigger_events` RPC | Architecturally aligned; ours is stronger on the tenancy/deputy invariant. Currently idle (pg_cron GUCs unset — owner-gated). | **Skip primitive.** Keep our pg_cron path (no always-on Node process to host theirs). Just wire the GUCs when the owner opens it. | **Low** |
| **Eval harness** | `define-eval`/`scorer`/`runner`/`agent-runner`/`report`, eval types automated\|llm_judge\|human, datasets (`dist/eval/*`, `observability` evals) | **Missing** — `docs/qa-portfolio.md` covers app QA; no agent-output eval harness; "agent-driven multi-turn QA" is queued | For a deepseek-pinned single model, a small seeded eval set would catch prompt/action regressions we currently only catch by hand. | **Adopt pattern (later)** — a lightweight eval: fixed prompts × seeded DB × oracle assertions, run in CI against local Supabase. Skip their experiments/A-B primitive. | **Med** |
| **File upload** | Provider abstraction (builder/s3/resumable, SQL fallback) (`dist/file-upload/*`) | **Have** — `agent-chat/attachments.ts` + Supabase Storage; `Composer.attach` | Supabase Storage *is* our provider; their abstraction is for pluggable clouds we don't have. | **Skip.** | **Low** |
| **Provider / model fallback** | quota-governor + engine registry, per-app model defaults, `allow_fallbacks` | **Have (deliberately narrow)** — `provider:{order:['DeepInfra'],allow_fallbacks:true}`; model pinned `deepseek/deepseek-v4-flash` | Cross-model fallback is deliberately *unwanted* (pin is binding, memory). | **Skip.** A same-model provider fallback (already on via `allow_fallbacks`) is enough. | **Low** |
| **Auth / deputy seam** | `secrets`/`connections`/`credentials`/`oauth-tokens` dirs; runs under a resolved identity | **Have — and stronger** — deputy invariant (ADR-0036): run under caller JWT, RLS is sole enforcement; automations mint short-lived owner JWT (`agent-dispatch`), never service_role on business data | We're ahead here — org_id tenancy seam + RLS-as-ceiling is more rigorous than the framework's single-tenant assumption. | **Skip.** Keep our model. | **Low** |
| **Context-awareness (app-state → agent)** | `application-state` dir; compose-view of live app state into the prompt | **Have / Partial** — `compose-view` edge fn + `AgentRuntimeProvider.prefill`; `entityCatalog`/`readEntities` give the agent scoped read access | Aligned; our read-scope is RLS-bounded (safer). | **Skip / minor.** Extend `readEntities` coverage as features land. | **Low** |
| **Chat-thread richness** | fork, hashed share-link, pin, archive, scope-to-resource, queued-message persistence, engine-pin, search (`dist/chat-threads/store.d.ts`) | **Partial** — `ThreadList`, threads persist + `scope`, history survives reload; **no** fork/share/pin/queued-msg-persist/search | These are product nice-to-haves, not correctness. | **Adopt pattern selectively (later)** — queued-message persistence (survives reload) and thread search are the two worth cheap-cloning; skip share-links until multi-user sharing is a product goal. | **Low** |

---

## 3. What to actually do next (prioritized; PRIMITIVE = heavy, PATTERN = cheap, our stack)

**Do now (cheap patterns; each closes a "simple mistake" class):**

1. **[PATTERN] Codify the run-lifecycle invariant + regression test.** Map to `persistence.ts`
   (`runExists`/`createThreadAndRun`) and a new `e2e`/unit test: "a POST carrying a runId that does
   NOT yet exist still creates the run + persists events." This locks in the 2026-07-08 fix and makes
   the `!runId` mistake unrepeatable. Note it in ADR-0043 as the binding rule ("request shape is never
   the run key").
2. **[PATTERN] `insertEvent` → idempotent upsert** on `(run_id, seq)` with `ignoreDuplicates` (mirror
   their `ON CONFLICT DO NOTHING`). File: `persistence.ts insertEvent`. One-line resilience win for
   resume/retry.
3. **[PATTERN] Run-trace read-model + admin "Runs" panel.** Derive a `TraceSummary` (llm calls, tool
   calls, successful/failed tools, cost, duration, status) from `agent_events` + `agent_usage`; surface
   it next to `AdministrationUsage`/`AdministrationCredits`. This is the observability floor that would
   have caught the money-path bug immediately. Reference: `observability/types.d.ts` `TraceSummary`.
4. **[PATTERN] `reliable-mutations` discipline for batch actions.** In `agent-chat/actions.ts`, for any
   action that writes N rows: re-read and report concrete committed counts/ids; on a step-limit cutoff
   report "M of N committed + remainder," never a bare success. Reference: `durable-agent-runs.md`
   Tie-in (Phase 0).
5. **[PATTERN, tiny] Usage `refId` idempotent overwrite** so re-recording a run doesn't double-count
   (`_shared/usage.ts`). Reference: `usage/store.d.ts UsageRecord.refId`.

**Do next (medium builds, our stack):**

6. **[PATTERN→endpoints] Live reconnect.** Add `GET agent_runs?status=running&thread=…` (active-run
   probe) and `GET agent_events?run=…&seq=gt.N` (cursor replay) — both plain PostgREST reads under RLS,
   no new infra — and have `pmoNativeRuntime.ts` persist `lastSeq` per thread and resume the live view
   on remount. Reference: `durable-agent-runs.md` steps 11–12. This is the biggest genuine capability
   gap.
7. **[PATTERN] Token streaming.** Emit `text-delta` events through the existing `transport.ts` SSE codec
   from a streaming OpenRouter call. Removes the "frozen until round completes" feel. Queued already.
8. **[PATTERN] Minimal eval harness.** Fixed prompts × seeded local DB × oracle assertions in CI
   against local Supabase; catches prompt/action regressions. Skip their experiment/A-B primitive.

**Explicitly skip (don't adopt):**

- **Netlify `-background` durable-execution primitive** — host-specific; our edge + pg_cron dispatch
  and 8-round cap cover it. Reuse the *seam* (`agent-dispatch` self-dispatch) only if a chat turn ever
  needs to outlive the edge wall.
- **git-commit `checkpoints`, quota-governor, file-upload provider abstraction, cross-model fallback,
  A/B experiments, multi-app A2A/workspace** — all solve problems we deliberately don't have
  (coding-agent checkpoints, multi-provider SaaS, pluggable clouds, model choice, multi-tenant B2B
  workspace). Our deputy/RLS/org_id model is stronger than their single-tenant identity seam — keep it.
- **Deploy versioning** — we're ahead (baked per-fn SHA can't lie); keep it, just add a promote-time
  assert that deployed `x-deploy-version` == pushed SHA.

---

### One-line verdict

We didn't lack the primitives — we mis-keyed a lifecycle we already had the tables for, and we had no
run-trace view to catch it. The cheapest, highest-value adoptions from the MIT repo are **patterns**
(run-key invariant, idempotent event upsert, `TraceSummary` read-model, proof-of-done terminals), not
their Nitro/Netlify machinery, which is largely a mismatch for our Supabase-edge + deepseek-pinned +
single-tenant-org_id stack.
