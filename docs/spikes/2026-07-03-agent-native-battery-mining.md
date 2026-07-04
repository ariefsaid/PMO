# Agent-native battery mining — candidate batteries & nice-to-haves for the PMO end-user agent

**Date:** 2026-07-03 · **Status:** reference catalog (owner to pick; nothing here is committed work)
**Context:** the agent-native sidecar was retired (ADR-0040 addendum 2026-07-03; PR #209 closed unmerged,
branch `feat/agent-native-adoption` kept as a mining reference). The next program is **batteries-included A**
(backlog "NEXT BUILD": ① OpenRouter `ModelClient` ② `agent_threads`/`agent_events` ③ `agent_usage`+credits
④ PostHog events). This doc is the exhaustive mining pass over the framework — the retired branch's
installed dist (`@agent-native/core` 0.84.8) **and** upstream docs (agent-native.com/docs, core 0.85.x) —
for **additional** batteries serving the intended use: *the agent as a first-class surface for PMO end
users*. Everything below is "borrow the pattern, build PMO-native" — **no finding justifies re-adopting
the framework as a dependency** (consistent with the retirement verdict).

**Provenance:** dist evidence = `.claude/worktrees/integration/pmo/agent-native/node_modules/@agent-native/core`
(branch `feat/agent-native-adoption`); upstream evidence = per-feature URLs under <https://www.agent-native.com/docs>.

---

## ⚑ Design inputs for the ALREADY-PLANNED batteries (fold in now — cheap at design time, expensive later)

These are not new backlog items; they are schema/contract requirements the mining surfaced for
batteries-A items ② (persistence) and ④ (observability):

- **`agent_threads` must carry an entity scope** — `scope {type, id, label}` binding a thread to a PMO
  record (project, procurement case…), plus pin/archive and (optional) fork-thread. "Open the assistant
  on Project X and it remembers that project's conversation" is the single most-expected end-user
  behavior. (dist: `chat-threads` scope; upstream: context-awareness doc.)
- **`agent_events` must journal completed tool calls for durable resume** — on a dropped SSE/interrupted
  run, the resumed turn is told what already executed and **write tools matching a journaled call are
  hard-blocked** (return the journaled result; reads never blocked). Prevents double-created tasks — a
  safety property, not polish. (upstream: durable-resume doc — zero-config there, ours by construction.)
- **`agent_events` should carry a progress heartbeat** (`last_progress_at` + optional percent/step) so
  the UI can distinguish "working" from "stuck" (see Tier 1 progress/stuck-run below).
- **Per-event user feedback fields** (thumbs up/down + downvote category: Inaccurate / Not helpful /
  Wrong tool / Too slow) — feeds item ④ PostHog; upstream also derives an implicit "frustration index"
  (rephrase/retry/abandon signals) worth copying as a PostHog insight later.
- **Negative finding that validates item ③:** upstream has **NO rate limiting / budget / quota system**
  (cost is *tracked*, never *capped*). Our per-user credit enforcement has no framework equivalent —
  it must be built, and it is a differentiator.

---

## Tier 1 — high value × high novelty (scope next, roughly in this order)

1. **Scheduled + event-triggered automations** ("jobs" + "triggers") — *the highest-value new capability
   class found.* End user asks the assistant: "every Monday 8am, summarize my overdue tasks" (cron) or
   "when a procurement case sits >30 days in Ordered, notify me" (event + NL condition, evaluated by a
   small model, memoized). Upstream runs an in-process 60s scheduler with a 5-min run timeout and lets the
   agent itself create/manage automations via a tool. **PMO build:** `agent_automations` table +
   `pg_cron`→edge-fn dispatch (Supabase-native; we have no always-on Node process); status-transition
   triggers can hook the existing append-only event tables (e.g. `procurement_status_events`). Deputy rule
   unchanged — an automation runs **as its owner** (store owner JWT-subject; execute via a per-owner
   session, RLS ceiling; upstream's `runAs: creator|shared` maps to owner-only for v1). Depends on:
   notifications (#2) as the delivery surface. (dist `jobs/`+`triggers/`; upstream recurring-jobs +
   automations docs; deterministic trigger mode is unshipped upstream — agentic-only parity is fine.)
2. **Notifications inbox** — fire-once `notify()` with severity (`info|warning|critical`), in-app inbox
   (bell + unread badge) + pluggable delivery channels (webhook/Slack/email later). The delivery surface
   for automations and long-run completions ("bulk import done — 3 rows failed"). **PMO build:** small
   `notifications` table (severity/title/body/metadata/read_at, org_id + owner RLS) + a bell in the
   ContextBar; channel abstraction from day one so Slack/email slot in without redesign. (dist
   `notifications/`; upstream notifications doc.)
3. **Long-running progress + stuck-run recovery** — runs tray showing percent/current-step for long agent
   tasks, backed by start/update/complete lifecycle; a heartbeat-driven "this looks stuck — Retry/Cancel"
   banner distinct from silent SSE reconnect, with an abort endpoint. Directly addresses the frozen-spinner
   failure mode our panel will hit. **PMO build:** ride on `agent_events` (see design inputs) + ~2 hooks
   and 2 small components. (dist `progress/`, `RunStuckBanner`, `use-run-stuck-detection`; upstream
   progress doc.)
4. **Typed generative-UI results — "native chat renderers"** — actions return zod-validated widget
   payloads (`DataTableWidget` / `DataChartWidget` / `DataInsightsWidget`) and declare a renderer id; the
   panel renders **real PMO components** (our tables/charts/KPI tiles) inline in the transcript — no
   iframe, no markdown-table parsing. "Show me over-budget projects" answers as a real table. **PMO
   build:** a discriminated-union result contract + a renderer registry in `AssistantPanel`; the ADR-0039
   untrusted-output boundary applies (validate before render, exactly like `compose_view` specs — this is
   effectively compose-view's little sibling for inline answers). Upstream's *sandboxed* generative UI
   (agent-authored Alpine.js mini-apps in iframes) is **out** — that's executable-artifact territory
   ADR-0036 §5 already rejected without a dedicated ADR + sandbox. (dist `data-widgets/`,
   `tool-render-registry`; upstream native-chat-ui doc.)
5. **Context awareness ("the agent sees what you see")** — the UI publishes semantic navigation/selection
   state; the agent reads it, so "summarize this" while viewing a project just works; optionally the agent
   can `navigate` the UI. Pairs with thread↔entity scoping (design input above) — scoping is the
   persistence half, this is the live-context half. **PMO build:** a small context provider fed by
   react-router location + selected-entity state, injected into the system context of `agent-chat`
   requests. (dist `dynamic-suggestions`, route-state hooks; upstream context-awareness doc.)

## Tier 2 — nice-to-haves (backlog; small builds, real value)

6. **Ask-the-user structured questions** — agent-initiated multiple-choice/clarification chips inline in
   the panel ("Which project — Alpha or Beta?"), resolving back into the same turn. Cheap once the panel
   has approval chips (same interaction shape as A3's approve/deny). (dist `guided-questions`.)
7. **Chat attachments** — upload a PDF/screenshot into the conversation ("what does this quote say vs the
   PO?"). Provider interface wraps **Supabase Storage** (we skip their CDN/base64 fallbacks); image
   transcode/downscale utility worth copying; procurement docs make this a natural PMO flow. (dist
   `file-upload/` + composer components; upstream file-uploads doc.)
8. **Cmd+K → "Ask AI" fallback + contextual suggestion chips** — unmatched CommandPalette queries open the
   assistant pre-filled; route-aware prompt chips ("Ask about this project"). PMO already has the
   palette — this is wiring, not a build. (dist `CommandMenu`, `dynamic-suggestions`.)
9. **Observational memory / thread compaction** — auto-compact long threads into tiers (reflections /
   dated observations / recent raw turns) for cost control + long-thread continuity. Note: thread
   compaction, **not** cross-session user memory. Do when long threads + credit costs make it measurable
   (it directly stretches credits — synergy with item ③). (upstream observational-memory doc.)
10. **Agent eval harness in CI** — `*.eval.ts` prompt+expectation files run against the real agent loop
    with composable scorers (`usesTool`, `contains`, `llmJudge`), exit-code gated. Fits ADR-0030 Layer-1
    philosophy exactly; becomes the regression net for the deepseek-v4-flash across-the-board quality
    gate (backlog item ① precondition) instead of a one-off manual test. (upstream evals doc.)
11. **Conditional approvals** — `needsApproval` as a *predicate* of args/context (not just a boolean):
    e.g. auto-approve reads + tiny writes, require the chip above a materiality threshold. Small A3
    refinement; keep "approvals rare" guidance. (upstream human-approval doc.)

## Tier 3 — strategic / later (each needs its own decision, most need an ADR)

12. **MCP server exposure of PMO actions** — PMO auto-exposed as a remote MCP server (actions = tools +
    an `ask-agent` meta-tool), OAuth 2.1/JWT-scoped: users drive PMO from Claude/ChatGPT/Cursor. Strategic
    differentiator; real security surface (deputy invariant across a third-party host). Own ADR when
    picked up. (upstream mcp-protocol doc; dist `mcp-client/` is the *consuming* direction — even later.)
13. **Messaging channels** — the assistant reachable by email/Slack/WhatsApp, sharing one thread history;
    upstream's de-facto mobile/field story. Strong for site engineers; big surface (inbound auth,
    rate-limits, allowlists). (upstream messaging doc.)
14. **Voice input** — dictation in the composer; browser Web Speech API fallback = zero-cost floor; the
    "voice context pack" (domain-term corrections: project codes, vendor names) is the clever part.
    (dist `voice/`+`transcription/`; upstream voice-input doc.)
15. **Sharing model for agent artifacts** — 3-tier visibility + viewer/editor roles for agent-produced
    artifacts (saved threads, generated reports). PMO's RLS/roles already cover domain data; only needed
    when artifacts outgrow `user_views`' private/shared model. (dist `sharing/`; upstream sharing doc.)
16. **Comment→agent loop** (from their real-time collaboration): a "Send to AI" affordance on a comment
    thread — neat future hook for the backlogged **view-proposal workflow**; full CRDT co-editing = skip.
17. **Skip list** (evaluated, rejected for PMO): A2A protocol · MCP-Apps embedded UIs (host-gated,
    ChatGPT Business-only) · sandboxed iframe generative UI (ADR-0036 §5) · multi-agent teams/@mentions
    (overkill for v1) · context X-Ray treemap (power-user debugging) · `track()` wrapper (PostHog direct
    is equivalent) · i18n (single-locale today) · changelog-in-app (trivial, any time) · framework voice
    cloud tiers (Builder-keyed).

## Prompt-architecture conventions worth adopting framework-free

Layered instructions: a small always-on charter (purpose / hard rules / state keys / action index) +
progressively-disclosed **skills** ("Use when…" triggers) + one-sentence tool descriptions + live
application state injected per turn; anti-fabrication and verify-before-done as core rules. Directly
applicable to the `agent-chat` system prompt as tools multiply. (upstream writing-agent-instructions +
skills-guide docs.)

## Other negative findings (useful signal)

- No cross-user **admin** observability dashboard upstream (per-user only) — our PostHog plan is not behind.
- No per-user model policy/allowlists — our env-configurable per-action model map is ahead.
- No dedicated cross-device resume — implicit via SQL thread persistence (ours: item ② + Supabase).
- No public roadmap; releases are dependency-bump changelogs (churn signal unchanged: pin-hard was right).
