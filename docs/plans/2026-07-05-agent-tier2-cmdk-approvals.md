# Implementation plan — Agent Tier-2: Cmd+K "Ask AI" + contextual chips, and conditional approvals

- **Date:** 2026-07-05
- **Issue:** PMO agent-tier2 — two cohesive, low-risk Tier-2 items: (2) Cmd+K→Ask-AI + route-aware suggestion chips (WIRING), (3) conditional approvals (REFINEMENT of the A3 seam).
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-tier2-capabilities.spec.md` — §2 (FR-AT2-CMDK-001..007), §3 (FR-AT2-APR-001..006), OBS-AT2-002/003/004/006, NFR-AT2-SEC-001/004, AC-AT2-006..014.
- **ADR authored with this plan:** `docs/adr/0051-conditional-approval-predicate.md` (the `needsApproval(input, ctx)` predicate contract + server-side materiality-constant convention).
- **Depends-on ADRs (unchanged, controlling on conflict):** ADR-0040 (AssistantPanel + A3 chip), ADR-0045 §3 (live-context entity), ADR-0039 (untrusted-output boundary), ADR-0019 (server-enforced SoD/delete — the real authority the predicate must NOT relax), ADR-0016/0017 (real-JWT deputy + repository seam), ADR-0010 (test pyramid).
- **Format model:** `docs/plans/2026-07-05-agent-experience-layer.md`.

> ## ⚠ Read before building
> - **Current-state audit spot-checked (2026-07-05) — the spec §0 audit is accurate on every point:**
>   `openPanel(): void` has no prefill arg (`AgentRuntimeContext.tsx:16`, `AgentRuntimeProvider.tsx:46`);
>   composer draft is panel-local (`AssistantPanel.tsx:132` `composerValue`/`setComposerValue`, seeded by
>   `handleChipPick` at :287); `EmptyState.tsx` renders a fixed `EXAMPLE_QUESTIONS` list (`emptyState.constants.ts`),
>   no route-awareness; `CommandPalette.tsx:244-247` renders `No results for "{query}"` with no "Ask AI" row;
>   `AgentAction.confirm?: boolean` is a static literal per action (`port.ts:102`; every action in `actions.ts`
>   sets `confirm:` a literal — `queryEntity:false`, `createActivity:true`, `updateTaskStatus:true`,
>   `notify:false`, `createAutomation:true`, `composeView:false`, `askUser:false`); the handler routes on
>   `action.confirm` at `handler.ts:724`, `:738` (propose branch), `:1181` (decision continuation), and
>   `isConfirmToolUse` at `:1525`. **Re-grep the anchor line numbers before editing** — the AC/FR mapping does
>   not change if a line moved.
> - **NO schema change, NO migration, NO pgTAP added by THIS plan.** Both items are FE wiring + one edge-fn
>   refinement. AC-AT2-014 (auto-approve must not relax an SoD/delete rule) is proven by an EXISTING pgTAP
>   proof (ADR-0019's) staying green — this plan adds a *reference* assertion in a handler unit test that the
>   predicate never touches the RPC/RLS path, not a new pgTAP file. If anything here appears to need a
>   migration, **STOP and escalate** — it does not.
> - **Owner decisions baked in (do NOT re-open) — flagged as owner-confirmable in §7:**
>   - **Materiality thresholds (FR-AT2-APR-003, spec §OQ-2):** (a) **all destructive deletes always chip**
>     (`needsApproval` returns `true` irrespective of args — FR-AT2-APR-005); (b) **money-value writes** chip
>     at/above **`AGENT_APPROVAL_MONEY_THRESHOLD = 10_000`** (minor units of the org currency, i.e. a
>     `contract_value`/amount field ≥ 10000); below it, auto-approve; (c) **SoD-gated transitions** (a write
>     whose success crosses a Separation-of-Duties rule, e.g. a status→`Won`/`Approved` transition) always chip;
>     (d) trivial field edits with no money/SoD/delete dimension auto-approve. These bake into the named
>     server-side constants + per-action predicates below.
>   - **Today's write actions keep their current behavior (OBS-AT2-001):** `create_activity`,
>     `update_task_status`, `create_automation` all currently `confirm:true` → they map to a predicate that
>     returns `true` (always-chip) UNLESS this plan gives them a materiality predicate. **This plan opts ONLY
>     `update_task_status` into a materiality predicate** (its status set includes no money/delete and only a
>     benign SoD-free transition, so it becomes the demonstration of auto-approve for a sub-threshold write);
>     `create_activity` and `create_automation` **stay always-chip** (no predicate) — a conservative default
>     that keeps chips where the owner already expects them. The predicate machinery is proven generic by a
>     synthetic test action, so future actions opt in without a handler change.
>   - **Prefill seam location (FR-AT2-CMDK-003):** the prefill is carried on `AgentRuntimeContext`
>     (`openPanel(prefill?: string)` sets a `pendingPrefill` value the provider exposes); the panel consumes it
>     into `composerValue` via an effect and the provider clears it on consume. This is the minimal additive
>     change that keeps `openPanel()` no-arg callers (Rail button, ⌘J hotkey) unchanged (OBS-AT2-004).

---

## 0. Decisions this plan fixes (mechanical choices the spec/ADRs delegated)

| ID | Choice | Resolution (binding for this plan) |
|---|---|---|
| **DEC-1 — prefill transport** | how a prefill string reaches the panel composer without threading props through `AppShell` | Carry it on `AgentRuntimeContext`. `openPanel(prefill?: string)` sets `open=true` AND a new `pendingPrefill: string \| null` on the context value; add `consumePrefill(): string \| null` (returns + clears it, one-shot). The panel calls `consumePrefill()` in an effect when it opens and seeds `composerValue`. One-shot consume prevents a stale prefill re-seeding on a later re-open. Additive; no existing consumer changes. |
| **DEC-2 — Ask-AI palette affordance shape** | new row vs. replace empty state | When `agentAssistant` is on AND the query is non-empty AND `resultCount===0`, render an **"Ask AI" row** styled as a normal `role="option"` so it participates in the existing roving selection + Enter/click activation (NFR-AT2-A11Y-002) — REPLACING the "No results" text (spec FR-AT2-CMDK-001 "in place of or alongside"; in-place is cleaner and keeps one focusable). Flag-off OR non-empty results → unchanged. The palette gets a new optional `onAskAi?: (query: string) => void` prop; the row only renders when it is provided (App passes it only under the flag → FR-AT2-CMDK-007). |
| **DEC-3 — suggestion-chip source** | where the per-entity-type prompt map lives | A new `pmo-portal/src/components/panel/suggestionChips.constants.ts` — a `Record<string, string[]>` keyed by `entity.type` (`project`, `procurement_case`, `company`, `contact`), each a **fixed, app-authored** list of ≤3 prompts. NO model call, NO network (FR-AT2-CMDK-006, AC-AT2-010). `EmptyState` reads the live `getContext().entity?.type`, looks up the map, and renders route-aware chips; with no entity it falls back to today's `EXAMPLE_QUESTIONS`. |
| **DEC-4 — approval predicate contract** | on the `AgentAction` object vs. a co-located map | On the `AgentAction` object: extend `port.ts` `AgentAction` with `needsApproval?: (input: unknown, ctx: DeputyContext) => boolean`. The action already owns its typed `validate`/`summarize`; the predicate is the same locality (ADR-0051). Materiality *constants* live in `actions.ts` (co-located with the catalog, server-side, never client/model-supplied — FR-AT2-APR-003). |
| **DEC-5 — predicate evaluation site + input** | when/where the handler decides "chip or auto-approve" | In the A3 propose branch (`handler.ts:738`), AFTER `writeAction.validate(toolInput)` succeeds, compute `const requiresApproval = resolveNeedsApproval(action, validation.value, deputyCtx)` where `resolveNeedsApproval` returns `action.needsApproval ? action.needsApproval(validatedInput, ctx) : (action.confirm ?? false)`. The predicate reads the **validated** input (post-schema `validation.value`), never raw `toolInput`, never `req.context` (FR-AT2-APR-003). If `requiresApproval` → emit needs-approval + end stream (unchanged path). If `!requiresApproval` → **auto-approve**: dispatch immediately via `dispatchActionForced` under the caller JWT, emit the `tool` event, push the tool_result, continue the loop — the SAME code the decision-continuation approve path runs, just without the human round-trip. |
| **DEC-6 — the `confirm`/predicate/gate relationship** | keep `dispatchAction`'s guard intact | `dispatchAction` still throws for `action.confirm===true` (`handler.ts:421`) — that guard is unchanged. Auto-approve uses `dispatchActionForced` (the existing "execute an approved confirm action" site, `handler.ts:431`), NOT `dispatchAction`, so the invariant "only `dispatchActionForced` executes a confirm action" holds. This is why an action must keep `confirm:true` (its "this is a write requiring the forced path") AND gain an optional `needsApproval` predicate (its "does THIS instance need a human?"). The two are orthogonal: `confirm` selects the forced-dispatch machinery; `needsApproval` selects whether a human sees a chip first. |

**Edge-fn unit tests live under `pmo-portal/src/lib/agent/*.test.ts`** and import edge-fn modules by relative path (Vitest root is `pmo-portal/`; the `agentChatHandler.test.ts` `baseDeps` helper is the template). This plan's handler tests reuse that `baseDeps`/`collect` scaffold.

---

## 1. Architecture & data flow

```
── Item 2: Cmd+K → Ask AI + chips (WIRING) ──────────────────────────────────
Browser (flag agentAssistant ON)
  CommandPalette (query="over budget cases", 0 matches)
     └─ NEW "Ask AI: 'over budget cases'" role=option row  ── onAskAi(query) ──┐
  App.tsx: onAskAi = (q) => { setPaletteOpen(false); openPanel(q); }           │
                                                                                ▼
  AgentRuntimeProvider: openPanel(prefill?) → setOpen(true) + setPendingPrefill(prefill ?? null)
     └─ context now exposes: open, openPanel(prefill?), consumePrefill()
                                                                                │
  AssistantPanel (opens): useEffect on `open` → const p = consumePrefill(); if (p) setComposerValue(p) + focus
     └─ EmptyState (empty transcript): getContext().entity?.type → SUGGESTION_CHIPS[type] ?? EXAMPLE_QUESTIONS
            chip click → onPick(prompt) → setComposerValue(prompt)   (NO auto-send — FR-AT2-CMDK-004)

── Item 3: Conditional approvals (REFINEMENT) ───────────────────────────────
supabase/functions/agent-chat/handler.ts  runToolLoop, A3 propose branch (:738)
  validate(toolInput) → validation.value
  requiresApproval = resolveNeedsApproval(action, validation.value, deputyCtx)
     ├─ true  → yield needs-approval chip + END stream          (unchanged A3)
     └─ false → dispatchActionForced(action, validation.value)  (AUTO-APPROVE, caller JWT)
                 → emit 'tool' + push tool_result + continue loop
  resolveNeedsApproval := action.needsApproval?(input,ctx) ?? (action.confirm ?? false)
  materiality constants (actions.ts): AGENT_APPROVAL_MONEY_THRESHOLD, isDestructiveDelete(...)
                                                                                │
Postgres — NO schema change. RLS + ADR-0019 SoD/delete RPCs UNCHANGED = the real authority.
```

**Deputy invariant + ADR-0039 boundary + ADR-0019 authority stay explicit (NFR-AT2-SEC-001/004):**
- **Prefill/chips = trusted app copy, zero new trust surface.** The prefill is the user's own palette query;
  the chips are app-authored constants (DEC-3). Neither is model-produced → outside the ADR-0039 boundary.
  Neither auto-sends → no billable run without an explicit user send (FR-AT2-CMDK-004).
- **The predicate is UX-only (FR-AT2-APR-004, NFR-AT2-SEC-004).** `resolveNeedsApproval` decides ONLY whether
  a human sees a chip. An auto-approved write still runs through `dispatchActionForced` under the caller JWT;
  RLS + the ADR-0019 SoD/delete RPCs reject anything the caller may not do, chip-or-no-chip. The predicate
  reads server-side constants + validated typed args ONLY — never `req.context`, never client/model-supplied
  thresholds. A model that lies in its args still hits `validate()` then RLS.
- **Deletes never auto-approve (FR-AT2-APR-005).** `isDestructiveDelete(action)` short-circuits
  `resolveNeedsApproval` to `true` before any threshold check — a delete predicate returns `true`
  irrespective of args. (No delete action exists in `actions.ts` today; the rule is encoded now so a future
  delete action is safe-by-construction, and proven by a synthetic-delete-action unit test — AC-AT2-012.)

---

## 2. Parallelizable tracks

- **Track F — Cmd+K "Ask AI" + prefill seam (§2, FR-AT2-CMDK-001/002/003/004/007)** — FE only. Touches
  `AgentRuntimeContext.tsx`, `AgentRuntimeProvider.tsx`, `AssistantPanel.tsx`, `CommandPalette.tsx`, `App.tsx`.
- **Track G — Route-aware suggestion chips (§2, FR-AT2-CMDK-005/006, AC-AT2-009/010)** — FE only. Touches
  `suggestionChips.constants.ts` (NEW), `EmptyState.tsx`. Depends on Track F only for the shared `onPick`
  no-auto-send contract (already exists) — otherwise independent; **F ‖ G in parallel**.
- **Track H — Conditional approvals (§3, all FR-AT2-APR)** — edge-fn only. Touches `port.ts` (type),
  `actions.ts` (constants + one predicate), `handler.ts` (resolve + auto-approve branch). Fully independent
  of F/G (different runtime) — **runs in parallel with F+G**.

**Recommended dispatch:** F ‖ G ‖ H in parallel worktrees → integration verify (E-gate) last.

---

## 3. Traceability (FR → owning test → task)

| FR | AC | Layer | Owning test (title / file) | Task |
|---|---|---|---|---|
| FR-AT2-CMDK-003 | AC-AT2-008 | Unit | `AC-AT2-008 openPanel(prefill) seeds composer; openPanel() unchanged` · `src/lib/agent/runtime/AgentRuntimeProvider.prefill.test.tsx` | F1 |
| FR-AT2-CMDK-001 | AC-AT2-006 | Unit | `AC-AT2-006 zero-result query renders Ask AI only when flag on` · `src/components/shell/CommandPalette.askAi.test.tsx` | F3 |
| FR-AT2-CMDK-002/004 | AC-AT2-007 | E2E | `AC-AT2-007 Ask AI opens panel pre-filled, no auto-send` · `e2e/AC-AT2-007-askai-prefill.spec.ts` | F5 |
| FR-AT2-CMDK-007 | (in F3/F5) | Unit/E2E | flag-off → no Ask AI row (asserted in F3) | F3 |
| FR-AT2-CMDK-005 | AC-AT2-009 | Unit | `AC-AT2-009 entity route shows route-aware chips that pre-fill on tap` · `src/components/panel/EmptyState.suggestion.test.tsx` | G2 |
| FR-AT2-CMDK-006 | AC-AT2-010 | Unit | `AC-AT2-010 suggestion chip text is static, no model call` · `EmptyState.suggestion.test.tsx` | G2 |
| FR-AT2-APR-001/002 | AC-AT2-011 | Unit | `AC-AT2-011 sub-threshold write auto-approves; at/above chips` · `src/lib/agent/handlerApprovals.test.ts` | H2 |
| FR-AT2-APR-005 | AC-AT2-012 | Unit | `AC-AT2-012 destructive delete always chips regardless of args` · `handlerApprovals.test.ts` | H2 |
| FR-AT2-APR-001/OBS-AT2-001 | AC-AT2-013 | Unit | `AC-AT2-013 action with no predicate keeps static behavior` · `handlerApprovals.test.ts` | H2 |
| FR-AT2-APR-004 | AC-AT2-014 | pgTAP (existing) + Unit ref | `AC-AT2-014 auto-approve never relaxes SoD/delete RPC` · `handlerApprovals.test.ts` (ref) + ADR-0019 pgTAP stays green | H3 |

---

## TRACK F — Cmd+K "Ask AI" fallback + prefill seam (§2)

> FE only. `openPanel` gains an optional prefill; the palette gains an "Ask AI" row; App wires them.

### Task F1 — `openPanel(prefill?)` + `consumePrefill()` failing test (RED) — AC-AT2-008, FR-AT2-CMDK-003
**File:** `pmo-portal/src/lib/agent/runtime/AgentRuntimeProvider.prefill.test.tsx` (NEW)
Render `<AgentRuntimeProvider>` with the `agentAssistant` flag mocked ON (mirror `AgentRuntimeProvider.test.tsx`'s
setup). Read the context via a probe child that captures `useAgentRuntimeContext()`.
- **AC-AT2-008 (prefill path):** call `openPanel('over budget cases')`; assert `open===true` and
  `consumePrefill()` returns `'over budget cases'` on first call and `null` on the second (one-shot consume).
- **AC-AT2-008 (no-arg path, OBS-AT2-004):** on a fresh provider, call `openPanel()` (no arg); assert
  `open===true` and `consumePrefill()` returns `null` (empty composer, existing callers unchanged).
- Title: `AC-AT2-008 openPanel(prefill) seeds composer; openPanel() unchanged`.

**Verify (fails):** `npx vitest run src/lib/agent/runtime/AgentRuntimeProvider.prefill.test.tsx` → `consumePrefill`
is not on the context (type + runtime error).

### Task F2 — Extend the context type + provider (GREEN for F1) — FR-AT2-CMDK-003, DEC-1
**Files:** `pmo-portal/src/lib/agent/runtime/AgentRuntimeContext.tsx` (EDIT) + `AgentRuntimeProvider.tsx` (EDIT).
- **`AgentRuntimeContext.tsx`:** change the interface `openPanel(): void` → `openPanel(prefill?: string): void`;
  add `consumePrefill(): string | null;` to `AgentRuntimeContextValue`; add `consumePrefill: () => null` to the
  default context object at :21.
- **`AgentRuntimeProvider.tsx`:** add `const [pendingPrefill, setPendingPrefill] = useState<string | null>(null);`.
  Change `openPanel` (:46) to `useCallback((prefill?: string) => { setOpen(true); if (prefill) setPendingPrefill(prefill); safeTrack(() => trackAgentPanelOpened(false)); }, [])`.
  Add `const consumePrefill = useCallback(() => { const p = pendingPrefill; setPendingPrefill(null); return p; }, [pendingPrefill]);`
  and include `consumePrefill` in the `ctxValue` memo (:55) + its dep array. (`pendingPrefill` is intentionally
  NOT in `openPanel`'s deps — it uses the setter only.)

**Verify (green):** `npx vitest run src/lib/agent/runtime/AgentRuntimeProvider.prefill.test.tsx src/lib/agent/runtime/AgentRuntimeProvider.test.tsx` → pass; `cd pmo-portal && npm run typecheck` → zero errors (the `openPanel` no-arg callers in `App.tsx:336`/hotkey still compile — the arg is optional).

### Task F3 — CommandPalette "Ask AI" row failing test (RED) — AC-AT2-006, FR-AT2-CMDK-001/007
**File:** `pmo-portal/src/components/shell/CommandPalette.askAi.test.tsx` (NEW)
Render `<CommandPalette open items={[]} onClose={vi.fn()} onAskAi={vi.fn()} />`, then type a non-matching query
into the search input (`fireEvent.change` on the `role="combobox"` input, flush the 120ms debounce with
`vi.useFakeTimers()`/`act`).
- **AC-AT2-006 (flag-on / onAskAi provided):** assert an `role="option"` with accessible name matching
  `/Ask AI/i` and containing the query text renders; assert the plain "No results for" text is ABSENT; activate
  it (click) → `onAskAi` called with the exact query string.
- **AC-AT2-006 (flag-off / onAskAi omitted):** render the same with NO `onAskAi` prop; assert the normal
  `No results for "…"` text renders and NO `/Ask AI/i` option exists.
- Title: `AC-AT2-006 zero-result query renders Ask AI only when flag on`.

**Verify (fails):** `npx vitest run src/components/shell/CommandPalette.askAi.test.tsx` → no Ask AI row (component
has no `onAskAi` prop).

### Task F4 — CommandPalette "Ask AI" row impl (GREEN for F3) — FR-AT2-CMDK-001/007, DEC-2, NFR-AT2-A11Y-002
**File:** `pmo-portal/src/components/shell/CommandPalette.tsx` (EDIT)
- Add `onAskAi?: (query: string) => void;` to `CommandPaletteProps`.
- Compute `const showAskAi = !!onAskAi && !hasResults && !loading && debounced.trim().length > 0;` (near
  `hasResults` at :158).
- Include the Ask-AI row in the roving-selection order: when `showAskAi`, treat it as a single trailing option
  so `resultCount` accounts for it and Enter/Arrow reach it. Simplest correct wiring: replace the
  `!hasResults && !loading` empty-state block (:244-247) with a conditional — if `showAskAi`, render a
  `role="option"` row (same class shape as a real item row, `aria-selected` when it's the selected index) whose
  `onClick`/Enter calls `onAskAi(debounced.trim())` then `onClose()`; else render the existing "No results"
  text. Extend the Enter handler (:143-149) and `resultCount` so the Ask-AI row is index 0 when it's the only
  option (guard: when `showAskAi`, `resultCount` is at least 1 and `flatItems[selected]` falls through to the
  Ask-AI action). Keep it a real focusable `role="option"` with a visible selected style (NFR-AT2-A11Y-002).
- The row label: `Ask AI: "{query}"` with an `assistant`/`sparkle` icon from the existing `Icon` set (use a
  benign existing `IconName`, e.g. `search` if no assistant glyph exists — the implementer greps `icons.ts`).

**Verify (green):** `npx vitest run src/components/shell/CommandPalette.askAi.test.tsx src/components/shell/CommandPalette.test.tsx` → pass (the existing palette tests — non-agent behavior — stay green, OBS-AT2-003).

### Task F5 — Wire App + panel prefill consume (GREEN, E2E) — AC-AT2-007, FR-AT2-CMDK-002/004
**Files:** `pmo-portal/App.tsx` (EDIT) + `pmo-portal/src/components/panel/AssistantPanel.tsx` (EDIT) +
`pmo-portal/e2e/AC-AT2-007-askai-prefill.spec.ts` (NEW).
- **`App.tsx`:** pass `onAskAi={isFeatureEnabled('agentAssistant') ? (q: string) => { setPaletteOpen(false); openPanel(q); } : undefined}`
  to `<CommandPalette>` (:356). `openPanel` is already destructured from `useAgentRuntimeContext()` at :167 —
  its new optional `prefill` arg is what carries the query (FR-AT2-CMDK-007: `undefined` when flag off → no row).
- **`AssistantPanel.tsx`:** destructure `consumePrefill` from `useAgentRuntimeContext()` (add to the existing
  read). Add an effect keyed on `open`: `useEffect(() => { if (!open) return; const p = consumePrefill(); if (p) { setComposerValue(p); textareaRef?.current?.focus(); } }, [open, consumePrefill]);` — placed after
  `composerValue` state (:132). This seeds the draft and focuses; it does NOT call `send()` (FR-AT2-CMDK-004,
  no auto-send). If `composerValue` is already non-empty when a prefill arrives, prefer the prefill (the user
  explicitly asked via the palette) — the one-shot consume guarantees it seeds at most once per open.
- **E2E (`AC-AT2-007`):** follow the shipped agent-panel e2e patterns (`AC-AR-013`), `VITE_FEATURES_AGENT_ASSISTANT=true`.
  Open the palette (⌘K), type a query that matches no records/modules, assert the "Ask AI" row appears, activate
  it; assert the palette closes, the AssistantPanel opens, the composer textarea `value` equals the query, and
  **no run started** (no assistant/tool transcript entry, phase idle — assert the empty-state/greeting is still
  shown, or `data-testid="assistant-markdown"` is absent). Then click Send → a run starts (proving the prefill
  was a draft, not an auto-send). Title leading token `AC-AT2-007`.

**Verify (green):** `npx vitest run src/components/panel/AssistantPanel.test.tsx` → still green; from `pmo-portal/`:
`npx playwright test e2e/AC-AT2-007-askai-prefill.spec.ts` → pass.

---

## TRACK G — Route-aware suggestion chips (§2)

> FE only. NEW constants map + `EmptyState` reads live context. F ‖ G.

### Task G1 — Suggestion-chips constants (support, no test of its own) — FR-AT2-CMDK-006, DEC-3
**File:** `pmo-portal/src/components/panel/suggestionChips.constants.ts` (NEW)
Export `SUGGESTION_CHIPS: Record<string, readonly string[]>` keyed by `entity.type`, matching the four
`setEntity` publishers the experience-layer plan wires (`project`, `procurement_case`, `company`, `contact`):
```ts
export const SUGGESTION_CHIPS: Record<string, readonly string[]> = {
  project: ['Summarize this project’s status', 'What tasks on this project are overdue?', 'Show this project’s budget vs actuals'],
  procurement_case: ['Summarize this procurement case', 'What’s the next step on this case?', 'Which items on this case are still open?'],
  company: ['Summarize this company’s active work', 'List this company’s open opportunities', 'What projects does this company have?'],
  contact: ['Summarize recent activity with this contact', 'What open items involve this contact?'],
};
```
All app-authored, static, ≤3 each (FR-AT2-CMDK-006). No import of any model/network module (AC-AT2-010).

**Verify:** `cd pmo-portal && npm run typecheck` → zero errors (a pure constants module).

### Task G2 — Route-aware `EmptyState` (RED→GREEN) — AC-AT2-009/010, FR-AT2-CMDK-005/006
**Files:** `pmo-portal/src/components/panel/EmptyState.suggestion.test.tsx` (NEW) + `EmptyState.tsx` (EDIT).
- **Test (RED):**
  - **AC-AT2-009 (entity present):** render `<EmptyState onPick={fn} />` inside a real `<AgentContextProvider>`
    whose `getContext()` returns `entity:{ type:'project', id:'p-1', label:'Alpha' }` (set via `setEntity` in a
    wrapper, or a mocked `useAgentContext`). Assert the three project prompts from `SUGGESTION_CHIPS.project`
    render as `<button>`s; tap one → `onPick` called with that exact prompt string, and no auto-send occurs
    (the component has no send capability — the assertion is `onPick` fired with the prompt, mirroring the
    existing chip contract). Title: `AC-AT2-009 entity route shows route-aware chips that pre-fill on tap`.
  - **AC-AT2-009 (no entity):** render with `getContext()` returning `{}`; assert the fallback
    `EXAMPLE_QUESTIONS` render (today's behavior preserved), NOT the route-aware set.
  - **AC-AT2-010 (static source):** spy on `fetch`/any network; assert zero calls when the chips render, and
    that every rendered chip label is a member of `SUGGESTION_CHIPS[type]` (imported directly — proving the
    source is the constant map). Title: `AC-AT2-010 suggestion chip text is static, no model call`.
- **Impl (GREEN):** in `EmptyState.tsx`, import `useAgentContext` and `SUGGESTION_CHIPS`. Compute
  `const entityType = getContext().entity?.type; const chips = (entityType && SUGGESTION_CHIPS[entityType]) ?? EXAMPLE_QUESTIONS;`
  and map `chips` in the existing button list (unchanged markup — same `onClick={() => onPick(q)}`, same classes).
  Optionally add a route-aware heading ("Ask about this project") when `entityType` resolves — keep it a static
  lookup, no model call. `EmptyState` is only mounted inside the flag-gated panel, so FR-AT2-CMDK-007 (inert
  when off) holds by construction.

**Verify (green):** `npx vitest run src/components/panel/EmptyState.suggestion.test.tsx` → pass;
`npx vitest run src/components/panel/AssistantPanel.test.tsx` → still green.

---

## TRACK H — Conditional approvals (§3) — ADR-0051

> Edge-fn only. `port.ts` type + `actions.ts` constants/predicate + `handler.ts` resolve+auto-approve. Fully
> independent of F/G.

### Task H1 — Predicate type + materiality constants + one predicate (support) — FR-AT2-APR-001/003/005, DEC-4/DEC-5, ADR-0051
**Files:** `pmo-portal/src/lib/agent/runtime/port.ts` (EDIT) + `supabase/functions/agent-chat/actions.ts` (EDIT).
- **`port.ts` (`AgentAction`, :94-104):** add an optional field:
  ```ts
  /**
   * ADR-0051: optional materiality predicate. Returns true ⇒ the handler surfaces the A3
   * approve/deny chip for THIS instance; false ⇒ auto-approve (dispatch via dispatchActionForced,
   * no human round-trip). UX-ONLY — never an enforcement authority; RLS + ADR-0019 SoD/delete RPCs
   * remain the ceiling. Reads the VALIDATED input + server-side constants only; never req.context,
   * never client/model-supplied thresholds. Omitted ⇒ falls back to `confirm` (static behavior).
   */
  needsApproval?: (input: unknown, ctx: DeputyContext) => boolean;
  ```
- **`actions.ts` — named server-side constants (co-located with the catalog, FR-AT2-APR-003):**
  ```ts
  /** ADR-0051: money-value writes at/above this (minor units of org currency) require the A3 chip;
   *  below → auto-approve. Owner-set (spec §OQ-2); server-side only, never client/model-supplied. */
  export const AGENT_APPROVAL_MONEY_THRESHOLD = 10_000;

  /** ADR-0051 / FR-AT2-APR-005: a destructive-delete action is ALWAYS material (chips regardless of
   *  args). Encoded by name suffix so a future delete action is safe-by-construction. No delete action
   *  exists today; this is the guard for when one is added. */
  export function isDestructiveDeleteAction(name: string): boolean {
    return name.startsWith('delete_') || name.endsWith('_delete');
  }
  ```
- **`actions.ts` — opt ONE existing action into a materiality predicate (DEC / owner default):** add
  `needsApproval` to `updateTaskStatusAction` — a benign, money-free, SoD-free status change auto-approves:
  ```ts
  needsApproval: (_input, _ctx) => false, // a task status change carries no money/SoD/delete dimension → auto-approve (FR-AT2-APR-002/006)
  ```
  Leave `create_activity` and `create_automation` WITHOUT a predicate → they keep `confirm:true` always-chip
  (OBS-AT2-001, conservative default). `query_entity`/`notify`/`compose_view`/`ask_user` are `confirm:false`
  and unaffected.

**Verify:** covered by H2's tests + `cd pmo-portal && npm run typecheck` → zero errors (optional field, no
existing action forced to change).

### Task H2 — `resolveNeedsApproval` + auto-approve branch: failing tests (RED) — AC-AT2-011/012/013, FR-AT2-APR-001/002/005/006
**File:** `pmo-portal/src/lib/agent/handlerApprovals.test.ts` (NEW) [edge-fn-unit]
Reuse `agentChatHandler.test.ts`'s `baseDeps`/`collect` scaffold + a `modelClient.create` that returns a
tool_call for the action under test, then a plain answer on the next round. Define a small **synthetic**
`AgentAction` set injected for the test (or drive through the real catalog where the real action suffices):
- **AC-AT2-011 (materiality threshold):** a synthetic write action `confirm:true` with
  `needsApproval: (i) => (i as {amount:number}).amount >= AGENT_APPROVAL_MONEY_THRESHOLD`. Drive a tool_call
  with `amount: 5000` → assert the event stream contains a `tool` event (auto-approved, dispatched) and **no**
  `needs-approval` status event. Drive `amount: 20000` → assert a `needs-approval` status event IS emitted and
  the stream ends (no `tool` event yet). Title: `AC-AT2-011 sub-threshold write auto-approves; at/above chips`.
- **AC-AT2-012 (delete always chips):** a synthetic `delete_thing` action `confirm:true` with
  `needsApproval: () => false` (deliberately permissive) — assert `resolveNeedsApproval` STILL forces the chip
  because `isDestructiveDeleteAction('delete_thing')` short-circuits to `true`, so a `needs-approval` event is
  emitted for ANY args. Title: `AC-AT2-012 destructive delete always chips regardless of args`.
- **AC-AT2-013 (no predicate = static):** drive the REAL `create_activity` (confirm:true, no predicate) → assert
  a `needs-approval` event still fires (unchanged); drive the REAL `query_entity` (confirm:false) → assert it
  dispatches immediately with no chip (unchanged). Title: `AC-AT2-013 action with no predicate keeps static behavior`.

**Verify (fails):** `npx vitest run src/lib/agent/handlerApprovals.test.ts` → the auto-approve branch does not
exist yet (a sub-threshold write still emits `needs-approval` today).

### Task H3 — `resolveNeedsApproval` helper + auto-approve dispatch (GREEN for H2) — FR-AT2-APR-002/004/005, DEC-5/DEC-6, NFR-AT2-SEC-004
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT — the A3 propose branch, :737-769)
- Add a pure helper near the action registry:
  ```ts
  /**
   * ADR-0051: decide whether a write needs the human A3 chip. UX-only — the return value gates
   * ONLY chip visibility, never enforcement (RLS + ADR-0019 remain the authority). A destructive
   * delete is ALWAYS material (FR-AT2-APR-005) irrespective of the action's own predicate; otherwise
   * the action's needsApproval(validatedInput, ctx) decides; absent a predicate, fall back to
   * `confirm` (static behavior, OBS-AT2-001). `input` is the VALIDATED value (post-schema), never raw.
   */
  function resolveNeedsApproval(action: AgentAction, input: unknown, ctx: DeputyContext): boolean {
    if (isDestructiveDeleteAction(action.name)) return true;
    if (action.needsApproval) return action.needsApproval(input, ctx);
    return action.confirm ?? false;
  }
  ```
- In the propose branch, AFTER `validation.ok` succeeds (:755), compute
  `const requiresApproval = resolveNeedsApproval(action, validation.value, deputyCtx);`
  - `if (requiresApproval)` → the EXISTING needs-approval yield + `return` (unchanged, :757-768).
  - `else` (auto-approve) → dispatch via the forced path (mirror the decision-continuation approve execute at
    `handler.ts:1287`): `const toolResult = await dispatchActionForced(action, validation.value, deputyCtx);`
    inside a try/catch (a DB error → push an error tool_result + `continue`, mirroring :1288-1298), then
    `yield emit('tool', { payload: { name: toolName, input: validation.value, result: toolResult } });`
    and push the tool_result message (mirror :793-798), then `continue` the loop. Do NOT emit a
    `needs-approval` and do NOT `return` — auto-approve keeps the run going.
- **Do NOT change** `dispatchAction`'s confirm guard (:421), the decision-continuation approve path
  (`handleDecision`), or `isConfirmToolUse` (:1525). Auto-approve reuses `dispatchActionForced` so the invariant
  "only the forced path executes a confirm action" holds (DEC-6).
- **NFR-AT2-SEC-004 reference assertion (part of H2's `handlerApprovals.test.ts`, AC-AT2-014 ref):** add a case
  proving the auto-approve branch calls `dispatchActionForced` under `deputyCtx.supabase` (the caller-JWT
  client) and that `resolveNeedsApproval` never reads `req.context` — assert by spying that the only Supabase
  client touched on the auto-approve path is `deps.supabase`, never a second/`service_role` client, and that a
  `req.context.entity` value does not alter the predicate's verdict (pass a context, assert same chip/no-chip
  decision). The REAL SoD/delete enforcement (AC-AT2-014) is owned by the EXISTING ADR-0019 pgTAP proof staying
  green (H4).

**Verify (green):** `npx vitest run src/lib/agent/handlerApprovals.test.ts src/lib/agent/agentChatHandler.test.ts src/lib/agent/agentWriteActions.test.ts` → all green (existing A3 write tests unchanged — OBS-AT2-002);
`cd pmo-portal && npm run typecheck` → zero errors.

### Task H4 — ADR-0019 pgTAP still green (AC-AT2-014, no new file) — FR-AT2-APR-004, NFR-AT2-SEC-004
**No file added.** AC-AT2-014 is owned by the EXISTING ADR-0019 SoD/destructive-delete pgTAP proofs
(`supabase/tests/…` — the approver≠author + Admin-only-delete restrictive policies). The conditional-approval
predicate does not touch the DB authority, so those proofs must remain green with this change (they exercise
the RPC/RLS directly, independent of the chip). This task is the **verify step**: run the pgTAP suite and
confirm no regression.

**Verify:** from repo root: `supabase db reset --yes && supabase test db` → all pgTAP green (grep the ADR-0019
SoD/delete proofs by name — they exist and pass; this change adds none and breaks none).

---

## TRACK E — Full gate (binding pre-PR)

### Task E1 — FULL verify + rendered Discover
From `pmo-portal/`, in order:
1. `npm run verify` (= `typecheck && lint:ci && test && build`) — the WHOLE suite (shared-file edits —
   `CommandPalette.tsx`, `AssistantPanel.tsx`, `App.tsx`, `port.ts` — can break other renders; the recurring
   CI-verify-red trap).
2. From repo root: `supabase db reset --yes && supabase test db` — all pgTAP green (this issue adds NO migration
   and NO pgTAP; AC-AT2-014's ADR-0019 proofs stay green — H4).
3. `npx playwright test e2e/AC-AT2-007-askai-prefill.spec.ts` + the existing `AC-AR-013`/`AC-AW-012` panel
   journeys (confirm no palette/panel/approval regression).
4. **Rendered Discover pass on a clean build** (`npm run build && npm run preview`): render (a) ⌘K on a
   no-match query → the "Ask AI" row → panel opens pre-filled, composer focused, NOT auto-sent; (b) a project
   detail page → open panel → route-aware chips → tap a chip → composer pre-filled, not sent; (c) an
   auto-approving write (`update_task_status`) → no chip, the write lands + a tool bubble; (d) a `create_activity`
   write → the A3 chip still appears (unchanged). Route findings to `ui-implementer`; re-render until clean.

**Only after all four are green** → the review battery (3-lens code review + security-auditor on the predicate
UX-only boundary + rendered Discover + BDD) → PR to `dev`. **NEVER open the PR before the full battery is green
locally.** `main`/`production` promotes are owner-gated.

---

## 4. Type/signature consistency (guard across tasks)

- **`openPanel(prefill?: string): void`** + **`consumePrefill(): string | null`** — both on
  `AgentRuntimeContextValue` (F2); every existing `openPanel()` no-arg caller (`App.tsx:336`, ⌘J hotkey)
  compiles unchanged (optional arg, OBS-AT2-004). The panel is the ONLY `consumePrefill()` caller (F5).
- **`CommandPalette` `onAskAi?: (query: string) => void`** — optional; rendered row exists iff the prop is
  provided (App gates it on the flag, FR-AT2-CMDK-007). `onAskAi` receives the trimmed debounced query (F4);
  App passes `(q) => { setPaletteOpen(false); openPanel(q); }` (F5).
- **`AgentAction.needsApproval?: (input: unknown, ctx: DeputyContext) => boolean`** — the SAME signature the
  handler calls via `resolveNeedsApproval(action, validation.value, deputyCtx)` (H3); `input` is ALWAYS the
  validated value (post-schema), never raw `toolInput`. `isDestructiveDeleteAction(name)` +
  `AGENT_APPROVAL_MONEY_THRESHOLD` are the only server-side materiality constants (H1), exported from
  `actions.ts`.
- **`SUGGESTION_CHIPS: Record<string, readonly string[]>`** keyed by the SAME `entity.type` strings the
  experience-layer plan's `setEntity` publishers emit (`project`/`procurement_case`/`company`/`contact`) — G1;
  `EmptyState` looks them up via `getContext().entity?.type` (G2).

## 5. Scaling / risk notes (Performance + Architecture + Existing-repo lenses)

- **Zero new trust surface (Existing-repo lens):** the prefill is the user's own query; chips are app-authored
  constants; neither is model-produced → both stay outside the ADR-0039 boundary and neither auto-sends → no
  billable run without explicit user action (FR-AT2-CMDK-004). A reviewer guards that no chip/prefill path calls
  `send()`.
- **The predicate is additive + reviewer-guarded UX-only (Architecture lens, ADR-0051):** a future write action
  opts into materiality with one `needsApproval` line + (if money) reading `AGENT_APPROVAL_MONEY_THRESHOLD`;
  no handler change. The single load-bearing invariant reviewers enforce: `resolveNeedsApproval` gates ONLY chip
  visibility; the auto-approve branch uses `dispatchActionForced` under the caller JWT, so RLS + ADR-0019 remain
  the ceiling (NFR-AT2-SEC-004). Deletes short-circuit to always-chip regardless of a permissive predicate.
- **"Approvals stay rare" preserved (FR-AT2-APR-006):** the common interactive write (`update_task_status`)
  auto-approves; `create_activity`/`create_automation` keep their chip (conservative). Net chip friction goes
  DOWN, not up — the predicate reduces chips, never multiplies them.
- **`org_id` seam / tenancy:** untouched. No table, no RLS policy, no migration. The deputy runs as the caller
  JWT with RLS as the ceiling before and after this issue.
- **Performance:** the chip lookup + predicate are O(1) synchronous; the palette Ask-AI row is one extra
  conditional render on the zero-result branch (no extra query). No network round-trips added.

## 6. Sequencing summary (partial-ship seams)

1. **F ‖ G ‖ H** (parallel worktrees) — Cmd+K/prefill, chips, approvals are independent (F/G FE, H edge-fn).
2. **E** — full verify + rendered Discover + pgTAP-still-green, last.
Minimum shippable increment: **Track H alone** (approvals) OR **F+G** (Cmd+K + chips) — each is an independent,
cohesive PR if the owner wants to split; one cohesive PR (all three) is recommended for the Tier-2 story.

## 7. Open questions for the Director

1. **[Item 3] Materiality thresholds — confirm the owner defaults (spec §OQ-2).** Baked in:
   `AGENT_APPROVAL_MONEY_THRESHOLD = 10_000` (minor units of org currency), **all destructive deletes always
   chip**, SoD-gated transitions always chip, trivial edits auto. **Confirm the money number + "deletes always
   material" rule** — these are the named server-side constants (FR-AT2-APR-003).
2. **[Item 3] Which existing write actions opt into a materiality predicate now?** Baked in: only
   `update_task_status` (auto-approve — a benign status change); `create_activity` + `create_automation` stay
   always-chip (conservative). **Confirm** — if the owner wants `create_activity` (a small CRM note) to also
   auto-approve below a bound, add its predicate the same way (no machinery change).
3. **[Item 2] Ask-AI row: in-place vs. alongside "No results" (FR-AT2-CMDK-001).** Baked in: **in-place**
   (replaces the "No results" text, one focusable row). Confirm — "alongside" is a trivial variant if the owner
   prefers keeping the "No results" line above the Ask-AI row.
4. **[Item 2] Ask-AI icon glyph.** The palette row wants an assistant/sparkle icon; if `icons.ts` has no
   assistant glyph, the implementer uses a benign existing `IconName` (e.g. `search`). Flagged so the reviewer
   confirms the chosen glyph — a cosmetic nit, never a blocker.
5. **[Item 2] Suggestion-chip copy per entity type (DEC-3).** The prompts in `SUGGESTION_CHIPS` are a first
   draft; owner/design may reword. Content-only, no code change — flagged for a copy pass.
