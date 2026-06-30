# Implementation plan — A2 · AssistantPanel UI (ADR-0040 Option A)

- **Date:** 2026-06-30
- **Issue:** A2 — the `AssistantPanel` drawer against the A1 `AgentRuntime` port.
- **Author:** eng-planner (Claude Opus 4.8)
- **Spec:** `docs/specs/agent-assistant-panel.spec.md` (FR-AP-001..025, NFR-AP-A11Y/SEC/PERF, AC-AP-001..024 + AC-AR-013)
- **Design-plan:** `docs/plans/2026-06-30-agent-assistant-panel.design.md`
- **ADR:** `docs/adr/0040-in-app-agent-panel-pmo-native-vs-sidecar.md`
- **Port (A1, on this branch):** `pmo-portal/src/lib/agent/runtime/{port.ts,pmoNativeRuntime.ts,transport.ts}`

This plan supersedes conflicting spec wording per the Director reconciliations **D-A2-1..8** (§ Reconciliations).
The design-plan owns appearance/tokens; this plan + the reconciliations own behaviour & a11y where they conflict
with the spec. **No new runtime deps** — reuse React 19, RTL, Playwright, the existing `useFocusTrap`, `axe-core`,
and the shared `axeViolations` helper (`src/components/__tests__/axe.ts`).

---

## 0. Reconciliations (binding — the Director will amend the spec to match)

These decisions come from the Director and from the design-plan; where they conflict with the spec, **they win**.
The implementer follows this section over the spec wording. The right-hand column lists the **exact spec ACs/FRs
whose wording the Director must amend** so the spec traces to what we build.

| ID | Decision (binding) | Spec wording to amend |
|---|---|---|
| **D-A2-1** | **Dual focus contract.** Desktop (≥1024px) = `<aside role="complementary" aria-label="Agent assistant">`, **non-modal, NO focus-trap, NO `inert`-on-the-background**; Tab must exit the panel back into `<main>`. Mobile (<1024px) = `role="dialog" aria-modal="true"` with full focus-trap (`useFocusTrap`) + background `inert` + scrim + body-scroll-lock. Focus moves to the composer on open; restores to the trigger on close, in BOTH modes. | Spec NFR-AP-A11Y-001 (keep `complementary` on desktop, ADD the mobile `dialog` mode), **NFR-AP-A11Y-005** ("the main content area is NOT made `inert`" — clarify this is the DESKTOP rule; mobile DOES inert the background). AC-AP-020 stays `complementary` (it asserts the desktop default render). No AC assumes a blanket modal, so no AC needs deleting — only NFR text gains the explicit dual-mode split. |
| **D-A2-2** | **Flag = `FEATURES.agentAssistant`** (off by default). The design-plan's `agentPanel` name is renamed to `agentAssistant` everywhere. Panel + ⌘J + Rail entry + header trigger all ABSENT when off. | Spec FR-AP-001 already uses `agentAssistant` ✓. Design-plan §0/§4.6/§7 say `agentPanel` — superseded (doc note only; design-plan is not amended, this plan records the rename). |
| **D-A2-3** | **Width 400px, breakpoint 1024px** (design-plan owns visuals). | Spec **AP-OD-003** ("**360px**") → reconcile to **400px**. Spec §7 / FR-AP-002 mount text unaffected. |
| **D-A2-4** | **Esc CLOSES the panel** (idle or streaming). The explicit **Stop** button CANCELS the run (`runtime.control(runId,'cancel')`). There is NO two-stage Escape; Esc never cancels. | Spec **NFR-AP-A11Y-001** last sentence ("while a run is in flight, Escape cancels the run") → DELETE; Esc always closes. Spec **FR-AP-007** ("and no run is in flight") → relax to "Esc closes regardless of run state". Spec **AP-OQ-002** (two-stage Escape recommendation) → resolved to D-A2-4 (close-only). |
| **D-A2-5** | **Shell-level `AgentRuntimeProvider`** (React context) mounted ABOVE the router (in `ShellChrome`, wrapping `<AppShell>`), holding a single `PmoNativeRuntime` + the conversation/run state, so the transcript + active run survive route changes. The panel + `useAssistantPanel` read the runtime from `AgentRuntimeContext`. This is the ONLY place that imports the concrete `PmoNativeRuntime`. | Spec FR-AP-024/025 + **AP-OQ-004** → resolved to "React context" (was a recommendation). FR-AP-003 ("hook holds transcript") → the transcript/run state lives in the provider; the hook is the panel's view onto it. |
| **D-A2-6** | **Mounted + `inert`/hidden when closed** (no unmount) on desktop so conversation state survives close→open. (On mobile the modal sheet still uses the keep-mounted provider state; the sheet DOM itself conditionally renders, but transcript state lives in the provider, so reopening replays it.) | Spec FR-AP-003 / NFR-AP-A11Y-005 / **AP-OQ-001** → resolved to "keep mounted, `inert` when closed". |
| **D-A2-7** | **Tool-call cards announce the human label** ("Looked up projects · N rows"), never the raw `payload` JSON. | Spec FR-AP-015 / AC-AP-013 already say this ✓ (records the binding). |
| **D-A2-8** | **Assistant text rendered as PLAIN TEXT** (React default text node; NO `dangerouslySetInnerHTML`, NO markdown lib in A2). Record-code-as-link is **deferred to A3**. | Spec NFR-AP-SEC-002 already mandates plain text ✓. Design-plan §3 "Markdown-ish" + §8 R2 record-link → superseded to plain-text-only for A2. |

**Spec ACs the Director must amend for the non-modal desktop contract:** **NFR-AP-A11Y-001** (split into desktop
`complementary`/non-modal + mobile `dialog`/trap; delete "Escape cancels the run"), **NFR-AP-A11Y-005** (clarify
desktop-only "background not inert"; mobile DOES inert), **FR-AP-007** (Esc closes regardless of run state),
**AP-OD-003** (360→400px), **AP-OQ-002** (resolved to close-only). No behaviour AC is invalidated — AC-AP-005 stays
("Escape closes the panel") and is now mode-independent.

---

## 1. Architecture & data flow

```
ShellChrome (App.tsx — above <AppShell>, inside the router so it can read auth + location)
  └─ <AgentRuntimeProvider>                      ← D-A2-5; constructs PmoNativeRuntime ONCE (flag-on only)
       │   value = { runtime, panelState }        runtime: AgentRuntime (port type)
       │   getJwt = () => session.access_token     fnUrl = `${VITE_SUPABASE_URL}/functions/v1/agent-chat`
       ├─ <AppShell assistant={<AssistantPanel/>} …/>   ← D-A2-6: panel mounted as a sibling of <main>
       │     • Rail gains a flag-gated "Assistant" <button> entry (FR-AP-005)
       │     • ContextBar/header gains a flag-gated ghost trigger button (design-plan §1.3) — OPTIONAL, see Task 14
       └─ ⌘J handler (useAssistantHotkey) registered on document, flag-gated (FR-AP-004)

AssistantPanel  (reads AgentRuntimeContext via useAssistantPanel)
  ├─ Header     New-conversation (FR-AP-023 / AP-OD-006) · Close (×)
  ├─ Transcript role="log" aria-live="polite"  →  <TranscriptItem> switch on event.type
  │     user → ChatBubble · assistant → assistant prose block · tool → ToolCallCard
  │     status → status chip / step-cap notice / error card · system → quiet note
  ├─ streaming indicator (aria-live anchor)
  └─ Composer   textarea + Send/Stop (single slot) · example chips in empty state

useAssistantPanel (hook) — orchestrates the port:
  send(text): no runId → createRun({goal}); has runId → followUp(runId, text); then drain subscribe(runId)
  the async-iterator drain appends AgentEvents to transcript state; assistant text concatenates into the
  current bubble (NFR-AP-PERF-002 — keyed bubble, no full-list remount); terminal status flips running→idle.
  stop(): control(runId,'cancel'). retry(): createRun with the last goal. newConversation(): reset runId+transcript.
```

**Why a provider, not panel-local state (D-A2-5):** FR-AP-003 requires the transcript + an active run to survive
route changes. `<main>` remounts on navigation; the provider sits above `<AppShell>` so its state is stable. The
panel is a thin view; `useAssistantPanel` is `useContext(AgentRuntimeContext)` + the orchestration callbacks.

**Port isolation (NFR-AP-SEC-003 / AC-AP-024):** `AssistantPanel.tsx`, `Transcript.tsx`, `ChatBubble.tsx`,
`ToolCallCard.tsx`, `Composer.tsx`, `useAssistantPanel.ts` import ONLY from `port.ts` (+ `AgentRuntimeContext`).
`AgentRuntimeProvider.tsx` is the sole importer of `pmoNativeRuntime.ts`. The lint gate forbids the adapter import
anywhere except the provider + `src/lib/agent/runtime/**`.

---

## 2. File tree (exact paths — all NEW unless marked EDIT)

```
pmo-portal/
  src/
    lib/
      features.ts                                    EDIT  +agentAssistant flag (D-A2-2)
      agent/runtime/
        AgentRuntimeContext.tsx                      NEW   context + useAgentRuntime() (port type only)
        AgentRuntimeProvider.tsx                     NEW   constructs PmoNativeRuntime; holds runtime+panel state
        AgentRuntimeProvider.test.tsx                NEW   provider wiring + flag-off no-construct
    components/
      panel/
        AssistantPanel.tsx                           NEW   the drawer (header/transcript/composer; dual a11y)
        AssistantPanel.test.tsx                      NEW   AC-AP-003..023 (most behaviour ACs)
        Transcript.tsx                               NEW   role=log; maps events → items; auto-scroll
        TranscriptItem.tsx                           NEW   switch on event.type
        ChatBubble.tsx                               NEW   user bubble (secondary, right-aligned)
        ToolCallCard.tsx                             NEW   "Looked up <entity> · N rows" (D-A2-7)
        Composer.tsx                                 NEW   textarea + Send/Stop + Enter/Shift+Enter
        EmptyState.tsx                               NEW   heading + example chips (FR-AP-020)
        emptyState.constants.ts                      NEW   EXAMPLE_QUESTIONS array (shared by chip tests)
    hooks/
      useAssistantPanel.ts                           NEW   orchestration over the port (createRun/followUp/control)
      useAssistantPanel.test.ts                      NEW   send→createRun/followUp/stop/retry unit tests
      useAssistantHotkey.ts                          NEW   ⌘J/Ctrl+J document listener, flag-gated
      useAssistantHotkey.test.tsx                    NEW   AC-AP-003 hotkey toggle (+ flag-off no-op)
    components/shell/
      AppShell.tsx                                   EDIT  +assistant?: React.ReactNode sibling of <main> (FR-AP-002)
      Rail.tsx                                       EDIT  +flag-gated "Assistant" button entry (FR-AP-005)
      __tests__/AppShell.test.tsx                    EDIT  AC-AP-001/002 (flag off/on mount + inert)
      __tests__/Rail.assistant.test.tsx              NEW   AC-AP-004 supporting (Rail entry present/absent by flag)
    components/ui/
      iconPaths.tsx                                  EDIT  +'message' icon (Assistant trigger/Rail entry)
  e2e/
    AC-AR-013-assistant-panel-journey.spec.ts        NEW   Playwright; page.route mocks agent-chat SSE
  App.tsx                                            EDIT  wrap ShellChrome's AppShell in AgentRuntimeProvider;
                                                            pass assistant={<AssistantPanel/>}; register ⌘J
  eslint.config.js                                   EDIT  +no-restricted-imports rule for pmoNativeRuntime (AC-AP-024)
DESIGN.md                                            EDIT  +--agent-panel-w/--agent-panel-breakpoint tokens;
                                                            +AssistantPanel/ChatBubble/ToolCallCard component entries
```

**Note on AppShell test path:** the spec says `pmo-portal/src/components/shell/AppShell.test.tsx`; the real file is
`src/components/shell/__tests__/AppShell.test.tsx`. We use the real path (Reconciliation note R-FILE; no spec amend
needed, the AC owning-file column should read `__tests__/AppShell.test.tsx`).

---

## 3. Shared contracts (type/signature consistency across tasks)

```ts
// AgentRuntimeContext.tsx
import type { AgentRuntime } from './port';
export interface AgentRuntimeContextValue { runtime: AgentRuntime | null }
export const AgentRuntimeContext = React.createContext<AgentRuntimeContextValue>({ runtime: null });
export const useAgentRuntime = (): AgentRuntime => { /* throws if null */ };

// useAssistantPanel.ts — the panel's single orchestration hook
export type RunPhase = 'idle' | 'running' | 'error';
export interface TranscriptEntry { key: string; event: AgentEvent }   // AgentEvent from port.ts
export interface UseAssistantPanel {
  open: boolean;
  transcript: TranscriptEntry[];
  phase: RunPhase;
  lastGoal: string | null;       // for Retry (AC-AP-016)
  runId: string | null;          // FR-AP-023
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
  send(text: string): Promise<void>;   // createRun OR followUp + drain subscribe
  stop(): Promise<void>;               // control(runId,'cancel')
  retry(): Promise<void>;              // createRun(lastGoal)
  newConversation(): void;             // reset runId + transcript
}

// PmoNativeRuntime construction (D-A2-5, AgentRuntimeProvider.tsx, the ONLY adapter import):
new PmoNativeRuntime({
  getJwt: () => session?.access_token ?? '',                     // session from useAuth()
  fnUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
});
```

**Tool-card label derivation (D-A2-7, single source — in `ToolCallCard.tsx`):**
```ts
function toolLabel(payload: unknown): string {
  const p = payload as { entity?: string; rowCount?: number } | undefined;
  if (p?.entity) return `Looked up ${p.entity}${typeof p.rowCount === 'number' ? ` · ${p.rowCount} rows` : ''}`;
  return 'Checking your data…';                                  // FR-AP-015 fallback
}
```

**Status-event classification (single source — in `useAssistantPanel.ts` drain loop):**
```ts
// AgentEvent.type==='status', payload:{status, error?}
//  status==='completed'           → phase='idle' (composer re-enables; no extra line)  FR-AP-016
//  status==='errored' & error==='TURN_CAP' → append step-cap notice; phase='idle'      FR-AP-016/AC-AP-014
//  status==='errored' (other)     → phase='error' (error card + Retry)                 FR-AP-018/AC-AP-015
```

---

## 4. Tasks (TDD; each 2–5 min, independently committable; failing test FIRST for behaviour)

> Verify command convention: `cd pmo-portal && npm test -- <file>` (single-file Vitest run for the inner loop);
> `cd pmo-portal && npm run typecheck` where a task is type-only. The FINAL gate (Task 26) runs `npm run verify`.

### Task 1 — Feature flag `agentAssistant` (FR-AP-001, D-A2-2)
- **EDIT** `src/lib/features.ts`: add to the `FEATURES` object, after `aiComposer`:
  ```ts
  // A2 (ADR-0040): the in-app agent AssistantPanel + ⌘J. UI-hide-first; off by default.
  agentAssistant: import.meta.env.VITE_FEATURES_AGENT_ASSISTANT === 'true' || false,
  ```
- No new test file (covered by AC-AP-001/002 in AppShell test, Task 13). Pure additive.
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 2 — `AgentRuntimeContext` (FR-AP-024, NFR-AP-SEC-003)
- **NEW** `src/lib/agent/runtime/AgentRuntimeContext.tsx`:
  ```tsx
  import React from 'react';
  import type { AgentRuntime } from './port';
  export interface AgentRuntimeContextValue { runtime: AgentRuntime | null }
  export const AgentRuntimeContext = React.createContext<AgentRuntimeContextValue>({ runtime: null });
  export function useAgentRuntime(): AgentRuntime {
    const { runtime } = React.useContext(AgentRuntimeContext);
    if (!runtime) throw new Error('useAgentRuntime must be used within an AgentRuntimeProvider with the agentAssistant flag on');
    return runtime;
  }
  ```
- Imports ONLY `port.ts` (port isolation holds). No adapter import.
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 3 — `useAssistantHotkey` failing test (AC-AP-003 part 1, FR-AP-004)
- **NEW** `src/hooks/useAssistantHotkey.test.tsx`: render a probe component using `useAssistantHotkey({ enabled, onToggle })`; fire `document` keydown `{ key: 'j', metaKey: true }` → assert `onToggle` called once; fire again → called twice. Add a case `enabled: false` → keydown → `onToggle` NOT called (FR-AP-001 flag-off). Title the toggle case `it('AC-AP-003 ⌘J toggles via the document hotkey', …)`.
- **Verify (RED):** `cd pmo-portal && npm test -- src/hooks/useAssistantHotkey.test.tsx`

### Task 4 — `useAssistantHotkey` implementation (AC-AP-003 part 1)
- **NEW** `src/hooks/useAssistantHotkey.ts`: a `useEffect` adding a `document` keydown listener (mirror App.tsx ⌘K idiom, lines 188–198) gated on `enabled`; `(e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')` → `e.preventDefault(); onToggle()`. Cleanup removes the listener. When `enabled` is false, register nothing.
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/hooks/useAssistantHotkey.test.tsx`

### Task 5 — `ChatBubble` (FR-AP-013, AC-AP-022 support)
- **NEW** `src/components/panel/ChatBubble.tsx`: `({ text }: { text: string })` → a right-aligned `secondary`-fill bubble (NOT primary blue — design-plan §3/One-Blue), `rounded-md`, max-w ~85%, `body` type, with an SR-only "You said" prefix (`<span className="sr-only">You said: </span>`, design-plan §5.7). Plain text only (D-A2-8). No co-located test (exercised via AssistantPanel + axe).
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 6 — `ToolCallCard` failing test (AC-AP-013, FR-AP-015, D-A2-7)
- **NEW** `src/components/panel/ToolCallCard.test.tsx`:
  - `it('AC-AP-013 renders a tool-call card with the human label', …)`: render `<ToolCallCard payload={{ entity: 'projects', rowCount: 3 }} />` → `getByText(/Looked up projects/i)`; assert the rendered text contains `3` and does NOT contain a raw `{` (no JSON).
  - fallback case: `payload={{}}` → `getByText(/Checking your data/i)`.
- **Verify (RED):** `cd pmo-portal && npm test -- src/components/panel/ToolCallCard.test.tsx`

### Task 7 — `ToolCallCard` implementation (AC-AP-013)
- **NEW** `src/components/panel/ToolCallCard.tsx`: the `toolLabel(payload)` from §3, rendered as a compact recessed card (`secondary`/`card`+`border`, `rounded-md`, `label`/12px `muted-foreground`, a leading `aria-hidden` glyph). The visible label IS the accessible name (design-plan §5.3). `tabular-nums` on the count. Never blue.
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/components/panel/ToolCallCard.test.tsx`

### Task 8 — `TranscriptItem` + `Transcript` (FR-AP-013/014/017, AC-AP-012 support)
- **NEW** `src/components/panel/TranscriptItem.tsx`: a switch on `entry.event.type`:
  - `user` → `<ChatBubble text={event.text ?? ''} />`
  - `assistant` → left-aligned prose block, `data-testid="assistant-bubble"`, plain `{event.text}` (D-A2-8), SR-only "Assistant: " prefix
  - `tool` → `<ToolCallCard payload={event.payload} />`
  - `status` → render via the status helper (step-cap notice / error card handled at the Transcript level by phase; a bare `status` completed renders nothing)
  - `system` → quiet centered `muted-foreground` `label` note (`{event.text}`)
  - `artifact` → defensive stub card "A view is ready" (A4 reserved; never crash)
- **NEW** `src/components/panel/Transcript.tsx`: `<div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">` mapping `transcript` → `<TranscriptItem key={entry.key} />`. Auto-scroll to bottom on new entries via a `ref` + `scrollTo` effect, skipped when the user has scrolled up (track `atBottom`). The keyed map keeps stable keys so sibling bubbles do not remount (NFR-AP-PERF-002).
- No co-located test (driven by AssistantPanel tests).
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 9 — `EmptyState` + example-question constants (FR-AP-020, AC-AP-017/018)
- **NEW** `src/components/panel/emptyState.constants.ts`:
  ```ts
  export const EXAMPLE_QUESTIONS = [
    'Which of my projects are behind schedule?',
    'How many open opportunities do I have this quarter?',
    'List my companies with no active projects.',
  ] as const;
  ```
- **NEW** `src/components/panel/EmptyState.tsx`: `({ onPick }: { onPick: (q: string) => void })` → heading "Ask your agent", the read-only descriptor ("I only see what you can see."), the read-only footnote ("Answers are read-only for now.", design-plan §4.1), and the `EXAMPLE_QUESTIONS` as `button` chips (`button-outline`/control shape) each calling `onPick(q)` (does NOT submit — FR-AP-020/AC-AP-018).
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 10 — `Composer` (FR-AP-008/009/010/011/012, AC-AP-008/009/010/011)
- **NEW** `src/components/panel/Composer.tsx`:
  ```ts
  interface ComposerProps {
    value: string; onChange(v: string): void;
    onSend(): void; onStop(): void;
    running: boolean;                 // disables textarea + Send, shows Stop (FR-AP-010)
  }
  ```
  - `<label htmlFor>` "Ask a question" (explicit label, NFR-AP-A11Y-003) + auto-growing `<textarea>` styled verbatim from `AIComposerModal` (rounded-md border bg-background px-3 py-2, `focus:ring-2 focus:ring-ring`, `disabled:opacity-50`), `maxLength={2000}`.
  - `onKeyDown`: `Enter` && `!shiftKey` && trimmed non-empty && `!running` → `e.preventDefault(); onSend()`; `Shift+Enter` falls through (newline). (FR-AP-009)
  - Single button slot: `running` → "Stop" button (`button-outline`, enabled, `aria-label="Stop generating"`, `onClick={onStop}`); else "Send" (`button-primary`, `disabled={running || value.trim().length === 0}`, `aria-label="Send message"`). (FR-AP-010/011/012)
- No co-located test (driven by AssistantPanel tests where the live runtime mock is present).
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 11 — `useAssistantPanel` failing tests (AC-AP-008/016/019/023, FR-AP-009/021/022/023)
- **NEW** `src/hooks/useAssistantPanel.test.ts`. Use a **scripted fake `AgentRuntime`** (a factory yielding a controllable `AgentEvent` async-iterable) provided through `AgentRuntimeContext`. Cover at the hook layer:
  - `it('AC-AP-008 send() with no runId calls createRun with the goal', …)`: `createRun` spy called `{ goal: 'how many projects?' }`.
  - `it('AC-AP-023 send() with a held runId calls followUp + re-subscribes', …)`: after a completed run (runId 'abc'), `send('more')` → `followUp('abc','more')`, `subscribe('abc')` called again; transcript appends.
  - `it('AC-AP-019 stop() calls control(runId, cancel) and returns to idle', …)`: phase running → `stop()` → `control(runId,'cancel')`, phase 'idle', a "Stopped" entry appended.
  - `it('AC-AP-016 retry() re-invokes createRun with the last goal', …)`: after an `errored`/non-TURN_CAP status (phase 'error', lastGoal 'show active projects'), `retry()` → `createRun({ goal:'show active projects' })`.
- **Verify (RED):** `cd pmo-portal && npm test -- src/hooks/useAssistantPanel.test.ts`

### Task 12 — `useAssistantPanel` implementation (AC-AP-008/014/015/016/019/023)
- **NEW** `src/hooks/useAssistantPanel.ts` per §3 `UseAssistantPanel`. Reads `useAgentRuntime()`. `send(text)`:
  - append a local `user` entry; if no `runId` → `createRun({goal:text})` (store `runId`, `lastGoal`); else `followUp(runId, text)`; set `phase='running'`; then `for await (const ev of runtime.subscribe(runId))` drain → append entries; assistant text concatenates into the current assistant bubble (mutate the last assistant entry's `event.text`, keep its `key` stable — NFR-AP-PERF-002); classify `status` events per §3 (completed→idle, TURN_CAP→append step-cap notice + idle, other errored→phase 'error').
  - `stop()` → `runtime.control(runId,'cancel')`, append `{type:'system', text:'Stopped'}`, phase 'idle'.
  - `retry()` → reset phase, `createRun({goal:lastGoal})` + drain.
  - `newConversation()` → `runId=null`, `transcript=[]`, phase 'idle'.
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/hooks/useAssistantPanel.test.ts`

### Task 13 — AppShell flag mount: failing tests (AC-AP-001/002, FR-AP-002)
- **EDIT** `src/components/shell/__tests__/AppShell.test.tsx`: add a describe block:
  - `it('AC-AP-001 flag off → no assistant slot rendered', …)`: render `<AppShell rail header>` WITHOUT `assistant` → `queryByRole('complementary', {name:/agent assistant/i})` is null.
  - `it('AC-AP-002 flag on → assistant slot rendered as a sibling of main, inert when closed', …)`: render with `assistant={<aside role="complementary" aria-label="Agent assistant" inert data-testid="asst"/>}` → the node is present, is NOT inside `getByRole('main')`, and carries `inert`.
- **Verify (RED):** `cd pmo-portal && npm test -- src/components/shell/__tests__/AppShell.test.tsx`

### Task 14 — AppShell `assistant` prop (AC-AP-001/002, FR-AP-002)
- **EDIT** `src/components/shell/AppShell.tsx`: add `assistant?: React.ReactNode` to `AppShellProps`; render `{assistant}` as a sibling of `<main>` (after the `</main>` close, before the mobile rail drawer), so it is NOT inside `<main>` or the rail `<aside>`. When `assistant` is `undefined` (flag off), the layout is byte-identical (no wrapper emitted). The panel owns its own fixed-position/overlay CSS, so AppShell adds no grid track (design-plan §1.1).
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/components/shell/__tests__/AppShell.test.tsx`

### Task 15 — `message` icon (FR-AP-005 support)
- **EDIT** `src/components/ui/iconPaths.tsx`: add `| 'message'` to the `IconName` union and a `message:` entry in `ICON_PATHS` (a simple chat-bubble outline `<path>` at stroke-2, 24×24, mirroring the existing family). Used by the Rail "Assistant" entry + header trigger.
- **Verify:** `cd pmo-portal && npm run typecheck`

### Task 16 — Rail "Assistant" entry: failing test (AC-AP-004 support, FR-AP-005)
- **NEW** `src/components/shell/__tests__/Rail.assistant.test.tsx`: render `<Rail onNavigate>` under a router with a role set (mock `useEffectiveRole`). With `FEATURES.agentAssistant=true` (mock the module) → an "Assistant" control with `aria-pressed` is present and visible to the role; with the flag false → absent. The Rail entry calls an `onOpenAssistant` callback prop + `onNavigate` on click.
- **Verify (RED):** `cd pmo-portal && npm test -- src/components/shell/__tests__/Rail.assistant.test.tsx`

### Task 17 — Rail "Assistant" entry (AC-AP-004 support, FR-AP-005)
- **EDIT** `src/components/shell/Rail.tsx`: add an optional `onOpenAssistant?: () => void` prop. When `isFeatureEnabled('agentAssistant')`, render — in a dedicated "Assistant" group above the Administration foot — a `<button type="button">` styled with `NAV_LINK_BASE`, `aria-pressed={false}` (toggle, not a destination), `<Icon name="message" />` + "Assistant", `onClick={() => { onOpenAssistant?.(); onNavigate?.(); }}`. Visible to ALL roles (no role gate — AP-OD-004). Absent when the flag is off.
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/components/shell/__tests__/Rail.assistant.test.tsx`

### Task 18 — `AgentRuntimeProvider` failing test (FR-AP-024/025, D-A2-5)
- **NEW** `src/lib/agent/runtime/AgentRuntimeProvider.test.tsx`:
  - flag-on: render the provider (mock `useAuth` → `{ session: { access_token: 'jwt' } }`), and a child calling `useAgentRuntime()` → resolves a non-null runtime with `createRun`/`followUp`/`control`/`subscribe` methods.
  - flag-off: provider renders children but `runtime` is null (no `PmoNativeRuntime` constructed) — assert a probe calling `useAgentRuntime()` throws.
- **Verify (RED):** `cd pmo-portal && npm test -- src/lib/agent/runtime/AgentRuntimeProvider.test.tsx`

### Task 19 — `AgentRuntimeProvider` implementation (FR-AP-024/025, D-A2-5, AC-AP-024)
- **NEW** `src/lib/agent/runtime/AgentRuntimeProvider.tsx`: the SOLE importer of `./pmoNativeRuntime`. When `isFeatureEnabled('agentAssistant')`, `useMemo` a single `new PmoNativeRuntime({ getJwt: () => useAuth().session?.access_token ?? '', fnUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat` })` (NFR-AP-SEC-001/025: only the session JWT; never service-role/ANTHROPIC key). Provide `{ runtime }` via `AgentRuntimeContext`. Flag-off → provide `{ runtime: null }`, construct nothing.
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/lib/agent/runtime/AgentRuntimeProvider.test.tsx`

### Task 20 — `AssistantPanel` failing tests batch 1: open/close/focus/inert/Esc (AC-AP-003/004/005/006/007, FR-AP-004/006/007, D-A2-1/4/6)
- **NEW** `src/components/panel/AssistantPanel.test.tsx`. A `renderPanel({ flag, scriptedRuntime })` helper wraps the panel in `AgentRuntimeContext` with a scripted fake runtime + a `MemoryRouter`. Failing tests:
  - `it('AC-AP-003 ⌘J toggles the panel open then closed', …)`: meta+J opens (panel visible, not `inert`); meta+J again closes.
  - `it('AC-AP-004 the Rail Assistant entry opens the panel', …)`: click the Assistant control → panel open. (Drive via the panel's open callback.)
  - `it('AC-AP-005 Escape closes the panel and restores focus', …)`: open with a probe button focused; Escape → closed + focus back on the probe. (D-A2-4: closes regardless of run state.)
  - `it('AC-AP-006 focus moves into the composer on open and restores on close', …)`: open → `document.activeElement` is the composer textarea (transcript empty → focus the first empty-state element, per FR-AP-006 — assert focus is within the panel root); close → focus restored.
  - `it('AC-AP-007 the panel root is inert when closed', …)`: closed → root has the `inert` attribute.
- **Verify (RED):** `cd pmo-portal && npm test -- src/components/panel/AssistantPanel.test.tsx`

### Task 21 — `AssistantPanel` failing tests batch 2: composer/stream/states (AC-AP-008/009/010/011/012/013/014/015/016/017/018/019/023)
- **EDIT** `src/components/panel/AssistantPanel.test.tsx`: add, each driven by a scripted runtime:
  - `AC-AP-008` Enter → `createRun({goal})`; Shift+Enter then Enter → goal contains a newline.
  - `AC-AP-009` while streaming: textarea + Send `disabled`; Stop enabled.
  - `AC-AP-010` after `status:'completed'`: textarea + Send enabled; Stop hidden/disabled.
  - `AC-AP-011` empty textarea → Send `disabled`.
  - `AC-AP-012` three `assistant` events "Hello "/"world"/"." → ONE assistant bubble "Hello world." (assert via a stable `data-testid="assistant-bubble"` count === 1).
  - `AC-AP-013` tool event → tool card matching `/projects/i`, distinct from bubbles.
  - `AC-AP-014` `status errored TURN_CAP` → step-cap notice text; no error card; composer re-enabled.
  - `AC-AP-015` `status errored UPSTREAM_ERROR` → error card "Something went wrong" + "Retry"; assert the text has no `{`/`stack`/raw body.
  - `AC-AP-016` click Retry → `createRun({goal: lastGoal})`.
  - `AC-AP-017` empty transcript → empty state with heading + ≥2 example chips; no transcript entries.
  - `AC-AP-018` click a chip → composer textarea contains the chip text; `createRun` NOT called.
  - `AC-AP-019` Stop → `control(runId,'cancel')`; "Stopped" notice; composer re-enabled.
  - `AC-AP-023` followUp same runId — appends below.
- **Verify (RED):** `cd pmo-portal && npm test -- src/components/panel/AssistantPanel.test.tsx`

### Task 22 — `AssistantPanel` failing tests batch 3: a11y (AC-AP-020/021/022, NFR-AP-A11Y-001/003, D-A2-1)
- **EDIT** `src/components/panel/AssistantPanel.test.tsx`: add:
  - `AC-AP-020` open (desktop default) → `getByRole('complementary', {name:/agent assistant/i})` present; composer textarea has an accessible label (queryable via `getByLabelText`).
  - `AC-AP-021` open → an `aria-live="polite"` element wraps/adjoins the streaming content (the `role="log"` container).
  - `AC-AP-022` axe-core: render open with (a) empty state, (b) a transcript of one assistant bubble + one tool card + one system note → `const { blocking } = await axeViolations(container); expect(blocking).toEqual([])`. Import `axeViolations` from `../../__tests__/axe`.
- **Verify (RED):** `cd pmo-portal && npm test -- src/components/panel/AssistantPanel.test.tsx`

### Task 23 — `AssistantPanel` implementation (makes Tasks 20–22 GREEN; FR-AP-008..023, NFR-AP-A11Y, D-A2-1/4/6)
- **NEW** `src/components/panel/AssistantPanel.tsx`: composes `useAssistantPanel`, `Transcript`, `Composer`, `EmptyState`, header (New-conversation + Close ×). Behaviour:
  - **Dual a11y (D-A2-1):** read viewport via a `matchMedia('(min-width: 1024px)')` hook (default desktop in jsdom). Desktop → `<aside role="complementary" aria-label="Agent assistant">`, NO `useFocusTrap`, NO background `inert`, fixed-right overlay (`--agent-panel-w`), keep-mounted, `inert` on the root when closed (D-A2-6). Mobile → `role="dialog" aria-modal="true" aria-labelledby`, `useFocusTrap(panelRef)` + scrim + background `inert` + body-scroll-lock (mirror AppShell mobile drawer lines 196–246).
  - **Focus (NFR-AP-A11Y-002):** on open capture `document.activeElement` into a `triggerRef`, then `setTimeout(0)` focus the composer textarea (or the first empty-state chip if transcript empty); on close restore the trigger. (AppShell pattern lines 63–84.)
  - **Esc (D-A2-4):** a keydown effect — Escape → `closePanel()` (always; never cancels).
  - **Streaming indicator (FR-AP-019):** a reduced-motion-safe "Working…" element after the last bubble while `phase==='running'`; it is the aria-live anchor.
  - **Error/step-cap/empty/cancel states** per §3 + the design-plan §4.
  - Plain-text assistant rendering (D-A2-8). Tool cards via `ToolCallCard` (D-A2-7).
- **Verify (GREEN):** `cd pmo-portal && npm test -- src/components/panel/AssistantPanel.test.tsx`

### Task 24 — Wire the provider + panel + ⌘J + Rail into the shell (FR-AP-002/004/005, D-A2-5)
- **EDIT** `App.tsx` `ShellChrome`: wrap the `<AppShell …>` return in `<AgentRuntimeProvider>`. Inside, instantiate `const asst = useAssistantPanel()` is NOT correct here (the panel owns the hook) — instead lift the open-state callback: pass `assistant={<AssistantPanel ref/controlled by context>}`. Concretely: the panel reads open-state from the provider (move `open`/`togglePanel` into the provider value so the Rail button + ⌘J + panel share it). Register `useAssistantHotkey({ enabled: isFeatureEnabled('agentAssistant'), onToggle: togglePanel })`. Pass `onOpenAssistant={openPanel}` to `<Rail>`. Pass `assistant={isFeatureEnabled('agentAssistant') ? <AssistantPanel/> : undefined}` to `<AppShell>`.
  - **Refinement (consistency):** move `open`/`openPanel`/`closePanel`/`togglePanel` from `useAssistantPanel`'s local state into `AgentRuntimeProvider`'s context value, so `useAssistantPanel` reads them from context (single source; Rail, ⌘J, and panel all agree). Update §3 `UseAssistantPanel` consumers accordingly — the hook still exposes the same fields, now context-backed.
- **EDIT** `src/components/shell/AppShell.tsx`: already accepts `assistant` (Task 14) — no further change.
- **Verify:** `cd pmo-portal && npm run typecheck && npm test -- src/components/panel/AssistantPanel.test.tsx`

### Task 25 — ESLint port-isolation rule for the panel (AC-AP-024, NFR-AP-SEC-003)
- **EDIT** `eslint.config.js`: add a new flat-config block (mirroring the analytics/client boundary, lines 22–44) that applies to `src/**/*.{ts,tsx}`, **ignores** `src/lib/agent/runtime/**` (the provider + adapter live here), and forbids importing the concrete adapter:
  ```js
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/agent/runtime/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['**/pmoNativeRuntime', '**/pmoNativeRuntime.ts', '@/src/lib/agent/runtime/pmoNativeRuntime'],
          message: 'Import only the AgentRuntime port / AgentRuntimeContext. The concrete PmoNativeRuntime adapter may be imported only inside src/lib/agent/runtime/ (the provider).' },
      ]}],
    },
  },
  ```
  - This extends the AC-AR-011 posture to A2's panel/hook files. The existing `src/lib/agent/portIsolation.test.ts` (rg-based) already proves "no module outside runtime/ imports the adapter" and continues to pass (the provider is inside `runtime/`).
- **Verify:** `cd pmo-portal && npm run lint` (zero errors; the new rule does not flag the in-`runtime/` provider).

### Task 26 — DESIGN.md additions (design-system source of truth; tokens only, no raw hex)
- **EDIT** `DESIGN.md`:
  - In the `:root` token list note (near line 464) + §5 Navigation/Overlays, add the two layout constants: `--agent-panel-w` (the desktop drawer width, alongside `--rail-w`/`--header-h`) and `--agent-panel-breakpoint` (the modal-sheet threshold). Describe by role, not raw px in the prose (the value lives in `index.css`).
  - In §5 Components, add three entries: **AssistantPanel** ("persistent non-modal companion drawer — desktop non-modal `complementary`, NO focus-trap/scrim; mobile modal sheet") with a Do/Don't ("never trap focus or scrim the background on desktop"), **ChatBubble** (user message — `secondary` fill, right-aligned, NOT blue), **ToolCallCard** (recessed evidence card — `muted-foreground` label, `tabular` count). Status chip + example chip recorded as usage notes of existing molecules (`badge-status` / control-chip).
- No test (doc). **Verify:** `cd pmo-portal && npm run typecheck` (sanity; DESIGN.md is not compiled).

### Task 27 — E2E journey (AC-AR-013, Playwright)
- **NEW** `pmo-portal/e2e/AC-AR-013-assistant-panel-journey.spec.ts`:
  - `test.beforeEach`: `page.route('**/functions/v1/agent-chat', …)` → fulfil `status:200, contentType:'text/event-stream'`, body = the four `data: <json>\n\n` SSE frames from the spec (user echo, tool `{entity:'projects',rowCount:5}`, assistant "You have 5 active projects.", status `completed`). NO live LLM.
  - `test('AC-AR-013 open the assistant, ask a question, see the streamed answer', …)`: `signIn(page, 'admin@acme.test')` (helper); press `Meta+J` (use `ControlOrMeta`/`Control+j` for Linux CI); assert `getByRole('complementary', {name:/agent assistant/i})` visible; empty state visible; fill the composer, press Enter; assert Send `disabled` while streaming; tool card `/projects/i`; assistant bubble "5 active projects"; Send re-enabled; press the hotkey again → panel not visible (or `inert`).
  - Header comment documents the flags-on CI env (`VITE_FEATURES_AGENT_ASSISTANT=true`) and that the run is PR→`dev` fast-lane (Vite dev server, agent-chat mocked, no Supabase edge-fn deploy).
- **Verify:** `cd pmo-portal && npx playwright test e2e/AC-AR-013-assistant-panel-journey.spec.ts --project=chromium` (CI; run locally only if a dev server + seeded auth are available).

### Task 28 — FINAL full-suite gate (binding pre-push)
- Run the WHOLE verify suite (typecheck + lint:ci + unit test + build) — never just touched files (CLAUDE.md pre-push rule).
- **Verify:** `cd pmo-portal && npm run verify`

---

## 5. Traceability (AC → layer → owning test file)

| AC-### | FR/NFR covered | Layer | Owning test file | Task |
|---|---|---|---|---|
| AC-AP-001 | FR-AP-001/002 | Unit (RTL) | `src/components/shell/__tests__/AppShell.test.tsx` | 13/14 |
| AC-AP-002 | FR-AP-002, NFR-A11Y-005 | Unit (RTL) | `src/components/shell/__tests__/AppShell.test.tsx` | 13/14 |
| AC-AP-003 | FR-AP-004 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` (+ `src/hooks/useAssistantHotkey.test.tsx`) | 3/4/20/23 |
| AC-AP-004 | FR-AP-005 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` (+ `Rail.assistant.test.tsx`) | 16/17/20/23 |
| AC-AP-005 | FR-AP-007, D-A2-4 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 20/23 |
| AC-AP-006 | FR-AP-006, NFR-A11Y-002 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 20/23 |
| AC-AP-007 | NFR-A11Y-005, D-A2-6 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 20/23 |
| AC-AP-008 | FR-AP-009 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` (+ hook) | 11/12/21/23 |
| AC-AP-009 | FR-AP-010 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-010 | FR-AP-011 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-011 | FR-AP-012 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-012 | FR-AP-014, NFR-PERF-002 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-013 | FR-AP-015, D-A2-7 | Unit (RTL) | `src/components/panel/ToolCallCard.test.tsx` (+ panel) | 6/7/21/23 |
| AC-AP-014 | FR-AP-016 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-015 | FR-AP-018 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-016 | FR-AP-018 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` (+ hook) | 11/12/21/23 |
| AC-AP-017 | FR-AP-020 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-018 | FR-AP-020 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 21/23 |
| AC-AP-019 | FR-AP-021 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` (+ hook) | 11/12/21/23 |
| AC-AP-020 | NFR-A11Y-001, D-A2-1 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 22/23 |
| AC-AP-021 | NFR-A11Y-003 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` | 22/23 |
| AC-AP-022 | NFR-A11Y-006 | Unit (RTL + axe) | `src/components/panel/AssistantPanel.test.tsx` | 22/23 |
| AC-AP-023 | FR-AP-022/023 | Unit (RTL) | `src/components/panel/AssistantPanel.test.tsx` (+ hook) | 11/12/21/23 |
| AC-AP-024 | NFR-SEC-003, FR-AP-024 | Unit/lint | `eslint.config.js` no-restricted-imports (+ existing `src/lib/agent/portIsolation.test.ts`) | 25 |
| AC-AR-013 | (deferred from A1) | E2E (Playwright) | `e2e/AC-AR-013-assistant-panel-journey.spec.ts` | 27 |

All RTL tests mock the `AgentRuntime` **port** via a scripted fake provided through `AgentRuntimeContext` (scripted
`AgentEvent` streams) — no live `agent-chat` call. AC-AR-013 mocks the wire via `page.route` — no live Anthropic.

---

## 6. Risks / notes for the Director

- **R-FILE:** the spec's AC owning-file column lists `src/components/shell/AppShell.test.tsx`; the real path is
  `src/components/shell/__tests__/AppShell.test.tsx`. Used the real path; please update the spec's table column.
- **R-OPEN-STATE:** Task 24 lifts `open`/`toggle` into the provider (so Rail + ⌘J + panel share one source). This is
  a small departure from FR-AP-003's "hook owns open state" wording — the hook still EXPOSES it, now context-backed.
  Flagged so the spec's FR-AP-003 can say "the provider holds open + transcript state; `useAssistantPanel` is its view".
- **NFR-AP-PERF-003** (transcript cap/virtualization at 200, AP-OD-007) is NOT given its own task — A2 read-only
  sessions are short and the spec marks it an owner-decision with a default. Recommend deferring the cap to a
  follow-up unless the Director wants it in-scope now (it would add one task + one test).
- **Mobile dual-mode (D-A2-1)** is exercised at the desktop default in jsdom (matchMedia defaults). A dedicated
  mobile-mode RTL test (modal/trap/inert) is recommended as a graduated QA-portfolio cell but is not an AC in the
  spec — flagging so the design-reviewer's Discover pass covers it (design-plan §8 R3).
- **No new runtime deps** confirmed: reuses `useFocusTrap`, `axe-core` + `axeViolations`, React 19, RTL, Playwright.
```
