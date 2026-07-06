# ADR-0050 — Layered agent system prompt: charter + tool index + progressively-disclosed skills

- **Status:** Proposed (owner accepts at merge of the agent-experience-layer PR)
- **Date:** 2026-07-05
- **Deciders:** Director, eng-planner (owner sign-off pending at merge)
- **Related:** ADR-0039 (prompt is defense-in-depth only; the schema/handler/RLS are the enforcement
  authorities — this ADR restates and depends on that boundary), ADR-0045 (the typed-widget / ask-user /
  live-context tools the skills steer toward), ADR-0044 (automations/notifications tools), ADR-0041
  (model-calling action capability seam), ADR-0036 §2 (deputy invariant), ADR-0010 (test pyramid).
- **Source pattern:** `docs/spikes/2026-07-03-agent-native-battery-mining.md` § "Prompt-architecture
  conventions worth adopting framework-free" (small always-on charter + progressively-disclosed skills +
  one-line tool index + per-turn live context; anti-fabrication + verify-before-done as core rules).
- **Spec:** `docs/specs/agent-experience-layer.spec.md` (FR-AXP-008..016, AC-AXP-007..010, AC-AXP-011..014,
  NFR-AXP-SEC-002, NFR-AXP-PERF-002, NFR-AXP-QUAL-001).
- **Plan:** `docs/plans/2026-07-05-agent-experience-layer.md`.

---

## Context

`buildAgentSystemPrompt` (`supabase/functions/agent-chat/prompt.ts`, ~79 lines) is a **flat** prompt whose
only tool guidance is `query_entity` (lines 67–76) and which ends with **"When you have enough information
to answer the user's question, respond in plain text."** (line 76). It never mentions the tools the model
is *actually handed* — `data_table`/`as:"table"`, `ask_user`, `compose_view`, `create_automation`,
`notify`, `create_activity`, `update_task_status` — all of which `buildTools` registers per request. The
deployed model (deepseek-v4-flash) is a **weak tool-selector**, so with no steering it defaults to
hand-rolled markdown prose for everything: tables become pipe-walls, clarifications become prose questions,
recurring requests become one-shot answers. The batteries are built and wired; the prompt never tells the
model they exist.

The mining spike cataloged (but never built) a **layered prompt** convention. As the agent's tool count
grows (ADR-0044 automations, ADR-0045 widgets/ask-user, future tools), a flat prompt does not scale — each
new affordance needs a place to be described and a trigger for when to use it. This ADR records the layered
structure as the **durable pattern** every future agent-tool addition follows, so the prompt scales by
adding a skill, not by rewriting a monolith.

This is **not** a security control. ADR-0039 is explicit: the prompt is defense-in-depth; the schema,
handler, and RLS are the enforcement authorities. This ADR restates that and adds no new authority.

## Decision

### 1. The prompt is composed of four ordered layers. **Pattern.**
`buildAgentSystemPrompt(entities, rowCap, role)` remains a **pure function** (no I/O, no data rows —
NFR-AR-SEC-005) with the **same signature**, but its body is composed, in order, of:

- **(a) Charter** — small, always-on. States: the assistant's purpose (a read-and-act deputy for the PMO
  app); the **hard rules** — the **deputy invariant** (acts only within the caller's RLS-scoped access;
  read scope = the user's own rows; cannot exceed the user's permissions), **anti-fabrication** (never
  invent entity/column names, ids, or data values; only report what a tool returned), **verify-before-done**
  (confirm a tool result actually answers the question before concluding); the existing role-grounding
  sentence (FR-DH-007) when a role resolved; and the existing read-only + no-data-rows-in-reasoning rules.
  The charter does **NOT** end with "respond in plain text" — that line is **removed** (it is the direct
  cause of the plain-chatbot behavior).
- **(b) Tool index** — one concise line per tool **actually registered for this request**. A tool not
  registered (e.g. `compose_view` when `composeEnabled` is false; `create_automation`/`notify` when
  `AGENT_AUTOMATIONS` is off) is **not** advertised — no dangling affordance the model cannot call
  (FR-AXP-010). Because tool registration is per-request (`buildTools(composeEnabled)` + the
  `AUTOMATIONS_ENABLED` gate), the tool index is **parameterized by the same gates** — the builder receives
  the enablement flags so the index and skills match the registered tool set exactly.
- **(c) Skills** — progressively-disclosed, each with an explicit **"Use when…"** trigger. The v1 skill set:
  - **table-not-markdown** (FR-AXP-011): when the answer is multi-row/tabular data, call `query_entity` with
    `as:"table"` (the **real** field name, OBS-AXP-002 — not `presentation`) so the panel renders a real
    sortable table; do NOT hand-roll a markdown pipe table for that data. Single scalar KPI → `data_insight`;
    magnitude-over-categories → `data_chart`. Narrative prose stays markdown. **This is the precedence rule:
    typed widget for data, markdown for narrative.**
  - **ask-user** (FR-AXP-012): on genuine ambiguity (underspecified entity, unresolved "which one", a
    missing required filter the user did not supply), call `ask_user` with structured `options` rather than
    guessing or asking in prose. Concrete trigger example included.
  - **compose-view** (FR-AXP-013 — only when `compose_view` registered): use `compose_view` for a
    saved/dashboard/reusable view, distinct from a one-shot inline widget answer.
  - **automation** (FR-AXP-014 — only when automations registered): offer `create_automation` for
    recurring/event-triggered requests (`schedule` kind for cron phrasing, `trigger` kind for event
    phrasing), not a one-shot answer.
  Each "Use when…" is **scoped to prevent over-triggering** (FR-AXP-015): `ask_user` only on genuine
  ambiguity (not a reflex before every answer); `create_automation` only on genuinely recurring phrasing;
  `compose_view` only on save/dashboard intent. When no trigger matches, prefer answering directly.
- **(d) Live-context block** — the per-turn grounding hint (`buildGroundingHint(context.entity)`), injected
  **grounding-only, never an authorization input** (FR-ATC-016). See ADR-0045 §3 and this spec's §2.4.

### 2. Progressive disclosure keeps the token budget bounded. **Pattern.**
Skills are concise (one trigger + one instruction each). The whole system prompt stays small enough not to
materially raise per-turn cost or crowd context (NFR-AXP-PERF-002) — "small charter + short skills" is the
ceiling, not a license to write an essay per skill.

### 3. No security regression via prompt. **[SEC — restates ADR-0039]**
The layered prompt retains **every** existing hard rule: the read-only framing for `query_entity`, the
RLS/deputy scoping language, the FR-DH-007 role-appropriate-help rule, and the "no data rows in reasoning"
rule (FR-AXP-016). The prompt is **defense-in-depth only** — deleting or overriding a prompt line can
degrade behavior but MUST NOT be able to widen access, bypass a `can()` gate, or exfiltrate cross-tenant
data (NFR-AXP-SEC-002). The schema/handler/RLS remain the authorities (ADR-0039).

### 4. Battery-surfacing behavior is model-dependent — the acknowledged risk. **Pattern boundary.**
Prompt steering (this ADR) is **necessary but may not be sufficient** for the §2.3 behavior ACs
(AC-AXP-011..014) to pass reliably, because deepseek-v4-flash is a weak tool-selector (NFR-AXP-QUAL-001).
This ADR **scopes prompt-steering only.** The **eval harness** (mining Tier-2 #10 — `*.eval.ts` with
`usesTool` scorers against the real loop) and a **model bump** to a stronger tool-selector are **separate,
deferred issues** — flagged as risks here and as Open Questions to the owner in the plan, NOT decided or
built in this issue. The §2.3 ACs are written to re-run against whatever model/eval decision later lands.

## Consequences

**Positive**
- The model is finally told about its affordances → the built batteries (typed tables, ask-user chips,
  automations) surface from natural phrasing instead of degrading to prose. The highest-value fix for
  "the panel feels like a raw chatbot," with **no tool or schema change** — only the prompt that describes
  the existing tools.
- The prompt **scales by adding a skill**, not rewriting a monolith — a durable pattern for every future
  agent tool (a new tool = one index line + one "Use when…" skill + a gate check).
- The tool index/skills track tool **registration** exactly (per-request gates), so the model is never told
  about a tool it cannot call — no dangling-affordance confusion.
- Pure function, same signature → the change is unit-testable in CI (AC-AXP-007..010 inspect the built
  string) with no live model call.

**Negative / costs**
- **Behavior is model-dependent and only partially provable in CI.** The structure ACs (string inspection)
  are deterministic; the surfacing ACs (AC-AXP-011..014) depend on the model choosing the tool. The plan
  covers them at E2E on a scripted/mocked turn (deterministic) and flags the real-model risk to the owner —
  the honest limit of prompt-steering-alone (NFR-AXP-QUAL-001).
- **A longer prompt costs tokens per turn.** Mitigated by progressive-disclosure conciseness
  (NFR-AXP-PERF-002); the builder stays small.
- The builder now takes the enablement flags (compose/automations) to gate the index/skills — a slightly
  wider signature contract the handler must pass correctly (guarded by AC-AXP-009).

## Alternatives considered

- **Keep the flat prompt, just append tool descriptions.** Rejected: does not scale as tools multiply, and
  without "Use when…" triggers a weak tool-selector still under-uses affordances. The layered structure is
  the point.
- **Move steering into per-tool `description` fields only (no skills).** Rejected: tool descriptions
  describe *what a tool is*, not *when to prefer it over prose* — the precedence rule (widget-vs-markdown)
  and ambiguity trigger are cross-tool decisions that belong in skills, not a single tool's description.
- **Build the eval harness / bump the model in this issue.** Rejected as scope: both are separate,
  independently-valuable issues (mining Tier-2 #10; a model-policy change). This issue ships steering and
  measures; the owner decides the next lever (Open Questions in the plan).
- **Make the prompt an enforcement control (e.g. "never read other orgs").** Rejected: the prompt is
  defense-in-depth only (ADR-0039). RLS is the authority; a prompt line is not a security boundary.

## Verification

- **Decision-level:** owner sign-off at merge → Status → Accepted; `docs/README.md` ADR range updated to
  include `0050`.
- **Structure (deterministic, CI):** AC-AXP-007 (layered, no "respond in plain text"), AC-AXP-008 (steers
  to `as:"table"`), AC-AXP-009 (advertises only registered tools), AC-AXP-010 (retains hard security rules)
  — Vitest against the built string, per the plan's Track B.
- **Surfacing (model-dependent):** AC-AXP-011..014 at E2E on a scripted/mocked turn (deterministic in CI);
  the real-model behavior is flagged under NFR-AXP-QUAL-001 as an Open Question (eval harness / model bump
  deferred).
- **Defense-in-depth:** the deputy invariant is re-proven by nothing new here (unchanged by construction);
  the security-auditor confirms the prompt adds no authority (ADR-0039 restated).
