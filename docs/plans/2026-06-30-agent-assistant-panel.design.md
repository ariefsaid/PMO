# Design-plan — A2 · AssistantPanel (the in-app agent drawer)

- **Date:** 2026-06-30
- **Issue:** ADR-0040 Option A, build step **A2** — the `AssistantPanel` shell drawer against the A1 `AgentRuntime` port.
- **Author:** design-architect (Frontend + Existing-repo lens)
- **Scope of THIS doc:** layout / IA / interaction / all states / responsive / WCAG-AA a11y / motion / `DESIGN.md` token map. **Behaviour (FR/AC) is owned by the companion spec** (`docs/specs/agent-assistant-panel.spec.md`, not yet authored — design to ADR-0040 + the A1 port until it lands; reconcile IDs at plan time).
- **Read-only on code.** This plan names **only `DESIGN.md` tokens**; any NEW token/component is listed in §7 as a *proposal* to fold into `DESIGN.md` during build/design-review. No raw hex / px in visual decisions.
- **A2 is read-only Q&A.** Write-action approve/deny chips (`needs-approval`) and the artifact slot are **A3/A4** — this plan reserves their seams but does not design their full UX (noted where the layout must not foreclose them).

---

## 0. Source anchors (what this binds to)

- **Port (A1):** `pmo-portal/src/lib/agent/runtime/port.ts` — `AgentRuntime { createRun, followUp, control, subscribe }`; the transcript is an `AsyncIterable<AgentEvent>` where `AgentEvent { id, runId, type, text?, payload?, createdAt }`, `type ∈ {user|assistant|tool|artifact|status|system}`; `AgentRunStatus ∈ {queued|running|paused|needs-approval|completed|errored}`. **The panel renders this stream; it owns no agent logic.**
- **Shell:** `src/components/shell/AppShell.tsx` (CSS-grid `rail/header/main`, `--rail-w`/`--header-h`, the mobile rail-drawer modal pattern this panel mirrors), `src/components/shell/Rail.tsx` (the nav-item idiom + `aria-current`), `src/components/shell/CommandPalette.tsx` (the ⌘K modal-overlay idiom + global key registration this must coexist with).
- **a11y contract to mirror (verbatim pattern):** `ConfirmDialog.tsx` + `AIComposerModal.tsx` — `createPortal`, `role`, `aria-modal`, `aria-labelledby`/`aria-describedby`, focus-capture-on-open / focus-trap (`useFocusTrap`) / focus-restore-on-close, Esc-to-close, `aria-live="polite"` status region, the `bg-[hsl(var(--scrim)/0.4)]` / `bg-foreground/40` scrim.
- **Intent oracle (Lens D):** `docs/jtbd.md` "Agent assistant" row — *"When I'm working in PMO and have a question about my own data… I want to ask my agent in plain language… so I get answers without leaving the app or exceeding my access."* §8 grades against it.
- **Feature flag:** `src/lib/features.ts` — A2 ships behind a new `agentPanel` flag (UI-hide-first idiom, §4 flag-off state).

---

## 1. IA / placement

### 1.1 Where it lives in the shell grid

The panel is a **right-side drawer** that is a **peer of `<main>`**, NOT a child of it — it must persist visually and in state across route changes (the job: "without leaving the app"). The cleanest fit for the existing grid (`gridTemplateColumns: 'var(--rail-w) minmax(0,1fr)'`, `gridTemplateAreas: '"rail header" "rail main"'`) is to **mount the panel as a fixed-position overlay layer on the right**, anchored to the viewport, rendered via `createPortal` at `document.body` (same as `ConfirmDialog`/`AIComposerModal`/`CommandPalette`), pinned below the header band so the breadcrumb/search stay reachable.

Rationale for overlay-over-grid-column (vs. adding a 3rd grid track):
- **Persistence is free** — a portal layer is independent of the `<main>` remount on route change; a 3rd grid column would re-layout every page and risk the same right-edge-clipping the shell comments warn about (`minmax(0,1fr)` is tuned for exactly two tracks).
- **It coexists with `<main>` scroll** — `<main>` keeps its own `overflow-y-auto`; the panel has its own transcript scroller.
- **Reversibility** — A2 ships/removes as one portal component + one flag, no shell-grid surgery (matches the ADR's "delete an edge fn + a panel" reversibility claim).

### 1.2 Overlay vs. push

**Desktop (≥ `lg`, see §1.5): OVERLAY, not push.** The panel floats above the right edge of `<main>` with a scrim **only on the panel's own gutter is NOT used** — instead use a **light, dismissable, non-modal overlay**: the panel sits at a fixed width (`--agent-panel-w`, proposed 400px) with a **1px `border` left edge + the `Overlay` shadow** (§4 Elevation of DESIGN.md), and **content underneath stays interactive** (the user can click a row in `<main>` to give the agent context, then ask about it). This is deliberately **non-modal on desktop** — the agent is a companion, not a blocking dialog. (Contrast: ConfirmDialog/CommandPalette ARE modal. The panel is a *persistent surface*, like a second rail.)

- No full-screen scrim on desktop (a scrim would say "you must deal with me first," which contradicts "keep working while you ask").
- The panel does **not push** `<main>` narrower on desktop either — pushing would reflow data tables mid-task. It overlays the right ~400px; the `max-w-[1600px] mx-auto` content centering in `<main>` means on wide screens the panel rarely occludes primary content, and on mid-width the user accepts the trade for a persistent assistant (it is user-summoned).

**Mobile (< `lg`): FULL-SCREEN SHEET, modal.** Below the breakpoint the panel becomes a full-viewport sheet (like the mobile rail drawer in `AppShell`) — `role="dialog" aria-modal="true"`, scrim, focus-trap, body-scroll-lock, background `inert`. There is no room to overlay-and-keep-working on a phone, so it goes modal and owns the screen until dismissed.

> **One consequence to honour:** on desktop the panel is **non-modal**, so it must **NOT focus-trap** and must **NOT mark the background `inert`** (that would break the "click a row while the panel is open" job). It still manages focus *on open* (move into the panel) and *on close* (restore to the trigger), and Esc still closes. On mobile it IS modal and DOES trap + inert (mirrors `AppShell`'s mobile rail drawer exactly). This dual contract is the single most important a11y subtlety in the panel — see §5.2.

### 1.3 Coexistence with the Rail (left) + CommandPalette (⌘K)

Three keyboard surfaces, three distinct paradigms, no collision:

| Surface | Trigger | Paradigm | Modality |
|---|---|---|---|
| Rail (left) | always visible / hamburger | persistent navigation | non-modal (mobile drawer is modal) |
| CommandPalette | **⌘K** | transient command/search launcher | **modal** overlay, closes on action |
| **AssistantPanel** | **⌘J** + Rail "Assistant" entry | **persistent conversational companion** | **non-modal** desktop / modal mobile |

- **⌘J is the panel; ⌘K is the palette** — distinct, mnemonic ("J" for the agent, no existing binding). Registration mirrors the CommandPalette's global `keydown` listener. Guard: when the CommandPalette is open, ⌘J is swallowed (one overlay opens at a time on mobile; on desktop the palette is modal so the panel toggle waits). When the panel is open and the user hits ⌘K, the palette opens **over** the panel (palette is modal, higher z) — expected, since the palette is a transient launcher.
- **Rail entry:** an "Assistant" nav item is **not** a `NavLink` (it routes nowhere) — it is a `<button>` styled with the exact `NAV_LINK_BASE` classes from `Rail.tsx`, placed in a new **"Assistant"** position. Recommended placement: a **dedicated affordance pinned in the rail foot** (next to/above Administration) OR the **header** (a ghost icon-button beside the ⌘K chip, mirroring `button-ghost`). **Recommendation: BOTH a header ghost icon-button (always visible, discoverable) AND a Rail item** — the header button is the primary, the rail item the labelled fallback. It carries `aria-pressed={open}` (it is a toggle, not a destination), an icon (proposed `sparkles`/`message` — see §7 icon note), and the `⌘J` kbd hint chip (mono, the `.kbd` idiom).
- **Z-order:** `--main` < panel (desktop non-modal layer) < CommandPalette (modal) < ConfirmDialog (`z-[800]`). Panel proposed `z-[40]` desktop layer / `z-[60]` mobile modal (same as the mobile rail drawer). The A3 write-confirm `ConfirmDialog` it spawns sits above it at `z-[800]` — correct (a write confirmation SHOULD be modal even though the panel is not).

### 1.4 Open / close model

- **Open:** ⌘J (toggle), Rail "Assistant" item, header ghost icon-button.
- **Close:** the same toggles (⌘J again, the now-`aria-pressed` button), a **visible × close button** in the panel header (mirrors the mobile rail drawer's close button — `touch-target grid size-8 … rounded-md text-muted-foreground hover:bg-accent`), **Esc** (both desktop and mobile — desktop Esc closes even though non-modal, matching user expectation for a summoned surface), and on **mobile** scrim-tap.
- **State persistence:** open/closed state + the active `runId` + transcript live **above** the route (in a context/provider mounted at the shell level, not inside a routed page) so navigating `/projects → /companies` does not tear down the conversation. The panel content is **not** reset on route change. (A "New conversation" is an explicit user action — §2 header.)
- **Default:** closed on first load (the agent is summoned, never intrusive — One-Blue/calm-surface ethos: nothing shouts).

### 1.5 Responsive breakpoints

Two existing shell breakpoints are reused; the panel adds one of its own:

| Breakpoint | Source | Panel behaviour |
|---|---|---|
| **≥ 1024px (`lg`)** | new panel breakpoint | Right overlay drawer, **non-modal**, fixed width `--agent-panel-w` (400px), border-left + Overlay shadow, content underneath interactive. |
| **< 1024px (`lg`)** | new panel breakpoint | **Full-screen modal sheet** — `role=dialog aria-modal`, scrim, focus-trap, inert background, body-scroll-lock, slide-up/over entrance. |
| 920px (rail collapse) | existing `--rail-w:0` | Independent of the panel; on a tablet the rail is already a hamburger drawer and the panel is the full-screen sheet. |

> Breakpoint choice: the panel goes modal-sheet at `lg` (1024), **earlier** than the table reflow (768), because a 400px overlay on an 800–1000px viewport occludes too much of `<main>` to "keep working underneath." Below 1024 the honest model is full-screen. This is a NEW breakpoint specific to the panel; record it in §7 as `--agent-panel-breakpoint: 1024px`.

---

## 2. Layout & anatomy

Three stacked regions in a flex column: **Header (fixed) · Transcript (flex-1, scrolls) · Composer (fixed)**. All on `card` surface (white) with a left `border`, so it reads as an elevated peer-surface, not a floating glass panel (honours Flat-By-Default + No-glassmorphism).

```
DESKTOP (≥1024) — non-modal right overlay, 400px, border-left + Overlay shadow
                                                    ┌────────────────────────────────┐ ← border-l border
 ┌─────────┬──────────────────────────────────────┐│  Assistant            [↻] [×]   │  header (56px = --header-h)
 │  Rail   │  Header (breadcrumb · ⌘K · [✦] ⌘J)    ││  ────────────────────────────── │  1px border-b
 │ 224px   ├──────────────────────────────────────┤│                                  │
 │         │                                       ││  ┌── tool-call card ───────────┐ │
 │ Dash    │   <main> stays interactive            ││  │ ✓ Looked up projects · 12   │ │  transcript
 │ Projects│   (click a row → context for agent)   ││  └─────────────────────────────┘ │  region
 │ Sales   │                                       ││    Assistant streamed text…     │  (flex-1,
 │ …       │                                       ││                                  │   overflow-y
 │         │                                       ││                ┌──────────────┐  │   -auto)
 │ [✦ Asst]│                                       ││                │ user message │  │
 └─────────┴──────────────────────────────────────┘│                └──────────────┘  │
                                                    │  ● status chip: working…        │  aria-live
                                                    │  ────────────────────────────── │  1px border-t
                                                    │  ┌────────────────────────┐ ⏎   │  composer
                                                    │  │ Ask about your data…   │[Send]│  (textarea +
                                                    │  └────────────────────────┘      │   send/stop)
                                                    └────────────────────────────────┘

MOBILE (<1024) — full-screen modal sheet (mirrors AppShell mobile rail drawer)
 ┌────────────────────────────────┐
 │  Assistant          [↻] [×]    │  header — × is touch-target ≥44px
 │  ───────────────────────────── │
 │   (transcript, full width)     │
 │                                │
 │  ┌── tool card ──────────────┐ │
 │  │ ✓ Looked up projects · 12 │ │
 │  └───────────────────────────┘ │
 │     assistant text…            │
 │              ┌──────────────┐  │
 │              │ user message │  │
 │              └──────────────┘  │
 │  ───────────────────────────── │
 │  ┌──────────────────────┐ [→] │  composer pinned to bottom
 │  │ Ask…                 │      │  (thumb zone), send is ≥44px
 │  └──────────────────────┘      │
 └────────────────────────────────┘
```

### 2.1 Header (fixed, height = `--header-h` 56px so it aligns with the app header band)
- **Left:** title "Assistant" (`heading`/20px or `subheading`/18px — recommend `subheading` 18px/600 to sit calmly, not compete with the page `page-title`). Optionally a small `● running` status dot when a run is active (uses the status-dot idiom, `success`/`muted` per run state).
- **Right (icon cluster, `button-ghost` 32px squares):**
  - **New conversation** (`↻`/`plus` icon) — starts a fresh run (`createRun`), clearing the transcript after a guard (see §4 — if a run is mid-stream, confirm; else immediate). `aria-label="New conversation"`.
  - **Close** (`×`) — `aria-label="Close assistant"`, the `touch-target` close pattern from the mobile rail drawer.
- **Border-bottom:** 1px `border`.

### 2.2 Transcript region (flex-1, `overflow-y-auto`)
- Vertical list of event groups, padding `spacing.4` (16px) horizontal, `spacing.3` (12px) between turns.
- Background `card` (white). Auto-scrolls to bottom on new events **unless** the user has scrolled up (then show a "↓ Jump to latest" pill — proposed, reuses `badge-status` shape + `button-ghost`).
- This is the `aria-live` surface for streamed assistant text (politeness rules in §5.3).
- The A4 **artifact** event will render a card here that hosts the I3 renderer — A2 reserves the slot (renders an `artifact`-type event as a placeholder "View ready" card stub if one ever arrives in read-only mode), but does not build it.

### 2.3 Composer (fixed, bottom, border-top 1px `border`)
- A `card`-surface bar, padding `spacing.3` (12px).
- **Textarea:** auto-growing (1 row → max ~5 rows then internal scroll), the `AIComposerModal` textarea styling verbatim — `rounded-md border border-border bg-background px-3 py-2 text-[14px]`/`body` token, `placeholder:text-muted-foreground`, `focus:ring-2 focus:ring-ring`. Placeholder: *"Ask about your projects, companies, pipeline…"*. `maxLength` cap (proposed 2000, matching `AIComposerModal`'s `MAX_PROMPT_LENGTH`); a `muted-foreground` counter appears only as the cap nears.
- **Send button** (`button-primary`, 32px): enabled only when the textarea is non-empty and no run is streaming. Icon + `aria-label="Send message"`. The One-Blue affordance — this is the panel's single primary action.
- **Stop / Cancel control** (replaces Send **while streaming**): a `button-outline` (NOT destructive — cancelling a read query is not destructive) labelled "Stop" with a square/stop icon, wired to `control(runId, 'cancel')`. `aria-label="Stop generating"`. Swapping Send→Stop in place (single button slot) keeps the layout stable and makes the streaming state unmissable.
- **Enter sends / Shift+Enter newline** (the chat idiom — §5.4).

---

## 3. Transcript component breakdown — rendering each `AgentEvent`

One `<TranscriptItem>` switch keyed on `event.type`. Visual hierarchy goal: **the assistant's answer is the most scannable thing**; tool-calls and status are secondary, recede-able metadata.

| `event.type` | Rendered as | DESIGN.md tokens | Notes |
|---|---|---|---|
| **`user`** | Right-aligned **user bubble** — compact, `secondary` fill (the quiet-grey, NOT primary blue — One-Blue rule: a sent message is not an *action*), `foreground` text, `rounded-md` (with one corner squared toward the edge), max-width ~85%. | bg `secondary`, text `foreground`, `rounded.md`, pad `spacing.2`/`spacing.3`, type `body` | Blue is reserved for the Send button only; the bubble must not read as "the action." |
| **`assistant`** | Left-aligned **streamed text**, **no bubble** — full-width prose block on `card`, `foreground` text, `body` type with `body` line-height (1.45). Markdown-ish (paragraphs, lists, inline `mono` for codes/IDs). A blinking caret / typing indicator appended while the run streams. | text `foreground`, type `body`, `mono` for IDs only | Bubble-less so long answers read like a document, not a chat blob (calm, data-first). This is the **focal** element. |
| **`tool`** | **Tool-call card** (compact, collapsed by default): a single row — leading status glyph (`✓` done = `success`; spinner = `muted-foreground` while running; `!` failed = `destructive`), a `muted-foreground` label *"Looked up `<entity>` · N rows"*, optional chevron to expand the raw input/result (`mono`, scrollable, capped). Tinted-card: `secondary/50%` or `card` + 1px `border`, `rounded.md`, small (label is `label`/12px). | bg `secondary` or `card`+`border`, glyph `success`/`muted-foreground`/`destructive`, label `label` 12px `muted-foreground`, `rounded.md`, pad `spacing.2`, counts `tabular` | Derives "looked up X · N rows" from `payload` (the action name + row count). **Recedes** — it is evidence the agent did work, not the answer. `mono`/`tabular` for the N. Never blue. |
| **`status`** | **Status chip** inline in the flow — a `badge-status` pill (full-radius, `secondary` bg, `muted-foreground` text) + a 6px leading dot colored by phase (`muted` queued/working, `success` done). e.g. "working…", "thinking…". | `badge-status` (bg `secondary`, text `muted-foreground`, `rounded.full`), dot per status | Transient/ephemeral — collapses once the terminal event arrives. This is the visible half of the `aria-live` announcement (§5.3). |
| **`artifact`** | **A4 — reserved.** In A2: a stub card "A view is ready" (it shouldn't occur in read-only A2, but render defensively, never crash). | `card` + `border`, `rounded.md` | Full I3-renderer slot is A4. |
| **`system`** | **System note** — small, centered, `muted-foreground`, `overline`/`label` type (e.g. "New conversation started", "Run completed"). De-emphasised divider voice. | text `muted-foreground`, type `label`/`overline` | Never a bubble; it's a quiet separator. |
| **terminal run status** (`completed`/`errored` via the `payload:{status}` status event) | A footer affordance per §4 — `completed` → quiet `system` note; `errored` → the **error state** card (§4.3); `needs-approval` → **A3** approve/deny chips (reserved seam, not built in A2). | per §4 | A2 read-only ends in `completed` or `errored` (or `cancelled`). |

**Hierarchy summary (most → least prominent):** assistant answer (full `foreground` prose) → user bubble (quiet grey) → tool-call card (recessed, `muted-foreground` label) → status chip (ephemeral pill) → system note (faint divider). The eye lands on the answer.

---

## 4. All states

State machine driven by `AgentRunStatus` + connection state + transcript length + the feature flag.

### 4.1 Empty / first-run (no run yet, transcript empty)
- A calm **scent panel** centered in the transcript region: a one-line value statement ("Ask about your own projects, companies, and pipeline — I only see what you can see.") + **2–3 example-question chips** the user can tap to prefill the composer:
  - *"Which of my projects are behind schedule?"*
  - *"How many open opportunities do I have this quarter?"*
  - *"List my companies with no active projects."*
- Chips use the `control`/segmented-chip idiom (`secondary` track / `button-outline` shape, `rounded.md`, `label` type) — tapping fills the textarea (does not auto-send; user reviews then sends — actionability + control).
- The scent reinforces the **deputy bound** ("I only see what you can see") — the Lens-D intent ("without exceeding my access") is made visible here, building trust.
- A small `system`/`overline` footnote: "Answers are read-only for now." (A2 truth.)

### 4.2 Loading / streaming (run `queued`/`running`)
- The **status chip** (§3) shows "Working…" with an animated (reduced-motion-safe) dot.
- A **typing indicator** (three-dot pulse or a caret) appended to the streaming `assistant` block.
- The composer **Send swaps to Stop** (§2.3); the textarea stays editable (the user can draft the next question) but a second send is blocked until the run is terminal (matches `AIComposerModal`'s disabled-while-loading, but allows drafting).
- **`aria-live="polite"`** announces status transitions; streamed text uses a **throttled** live region (§5.3) so the SR isn't spammed token-by-token.

### 4.3 Error (transport / edge-fn failure → run `errored`, or `subscribe` stream drops)
- An **error card** in the transcript (and/or a composer-anchored inline note): `destructive`-tinted (NOT a solid fill — Tinted-Status rule: `destructive/10` bg + a darkened `destructive` text variant + a 6px `destructive` dot), `rounded.md`, with a plain-language message classified by failure type:
  - transport/network → "Couldn't reach the assistant. Check your connection."
  - edge-fn 5xx → "The assistant ran into a problem. Try again."
  - budget/rate guard (`RateGuard`, ADR-0040) → "You've reached your assistant usage limit for now."
  - auth/JWT → "Your session expired. Refresh and sign in."
- A **Retry** button (`button-outline`) re-issues the last `followUp`/`createRun` (mirrors `CommandPalette`'s inline retry idiom). Retry is the adjacent next-action (actionability).
- Errors are announced via an **`aria-live="assertive"`** region (errors interrupt; status is polite — §5.3).
- Classification reuses the app's `classifyMutationError` posture (named tone per cause) — to be confirmed against the spec.

### 4.4 Step-limit-reached (the agent hit its multi-turn/tool step cap)
- A `warning`-toned `system` card (`warning/12` bg, `warning-icon` glyph, `warning-foreground` text — the AA-safe amber pair): "I reached my step limit for this question. Ask a narrower question or start a new one." + a "New conversation" affordance. Not an error (the agent worked, just bounded) — amber, not red.

### 4.5 Cancelled (user pressed Stop → `control(runId,'cancel')`)
- The streaming block freezes with a quiet `system` note: "Stopped." The Stop control reverts to Send. The partial answer remains (don't yank context the user may still read). No scrim, no modal — immediate.

### 4.6 Flag-off (`agentPanel` feature flag false)
- **The panel, the ⌘J binding, the header button, and the Rail "Assistant" item are all absent** — not disabled, absent (UI-hide-first, mirrors `incidents`/`userViews` in `features.ts` + the Rail's `feature` gate). ⌘J is not registered. No empty doorway, no dead shortcut. The deep-link/route (if any) resolves to nothing or the honest placeholder.

### 4.7 Edge cases
- **Long transcript:** cap + virtualization note in §6.
- **Long single answer / long tool result:** the assistant block wraps and scrolls within the region; tool-call expanded raw payload is capped (`max-h` + internal scroll, `mono`).
- **Rapid open/close:** state is preserved (the provider lives above the route); re-opening shows the same transcript.
- **Run active while user navigates routes:** the stream keeps running (provider-scoped); the panel can be closed and the run continues, surfacing on re-open. Consider a subtle "● running" dot on the header button when closed-with-active-run (proposed, §7).
- **Empty/whitespace-only message:** Send stays disabled (trim check, like `AIComposerModal`).

---

## 5. WCAG-AA accessibility

### 5.1 Landmark / role
- **Desktop (non-modal):** the panel is a **`<aside role="complementary" aria-label="Assistant">`** — a complementary landmark, NOT a `dialog` (it does not trap, it is a persistent companion surface; calling it a modal dialog while leaving the background live would be an a11y lie).
- **Mobile (modal sheet):** `role="dialog" aria-modal="true" aria-labelledby={titleId}` — full modal contract, identical to the `AppShell` mobile rail drawer.
- The transcript is a labelled region: `<div role="log" aria-label="Conversation" aria-live="polite">` (a `log` is the correct role for an append-only message stream).

### 5.2 Focus order, trap, restore
- **On open:** capture `document.activeElement` (the trigger), move focus to the **composer textarea** (the primary action — mirrors `AIComposerModal` focusing its textarea; lets the user start typing immediately). Defer with `setTimeout(0)` past the portal commit (the `AppShell` pattern, works in jsdom).
- **On close:** restore focus to the trigger (the ⌘J header button / Rail item) — the `ConfirmDialog`/`AppShell` restore pattern.
- **Focus trap — CONDITIONAL (the key subtlety):**
  - **Desktop non-modal: NO trap, NO `inert` background.** Tab from the composer must be able to leave the panel back into `<main>` (the "click/keyboard a row while asking" job). The panel participates in the normal DOM tab order, placed *after* `<main>` in the portal so Tab flows main → panel naturally, and Shift+Tab exits back.
  - **Mobile modal: full trap** (`useFocusTrap(panelRef)` — the exact hook `AppShell` uses) + background `inert` + body-scroll-lock. Identical to the mobile rail drawer.
- **Tab order within the panel:** New-conversation → Close → [transcript interactive elements: example chips (empty state), tool-card expanders, Retry, Jump-to-latest] → composer textarea → Send/Stop. Logical top→bottom, then the persistent composer last so it's always one Shift+Tab from the answer.

### 5.3 `aria-live` politeness (the two-channel rule)
- **Streamed assistant text → `aria-live="polite"`, THROTTLED.** Do NOT announce token-by-token (spams the SR). Announce on a debounce/coalesce (e.g. flush the appended text every ~1s or at sentence/clause boundaries) so the SR hears coherent chunks. The `role="log"` container is polite + `aria-relevant="additions"`.
- **Status events → `aria-live="polite"`** in a **separate, atomic** region (`aria-atomic="true"`) — "Working…", "Done." — so status doesn't interleave with the answer stream. (Mirrors `AIComposerModal`'s dedicated `aria-live` status region.)
- **Errors → `aria-live="assertive"`** (interrupts) — a failure should not wait behind a long answer.
- **Tool-call cards → polite, named** — each announces "Looked up projects, 12 rows" (the visible label IS the accessible name; the glyph is `aria-hidden`, the count is read). Screen-reader name = the same human string, never the raw `payload` JSON.

### 5.4 Keyboard map
| Key | Action | Notes |
|---|---|---|
| **⌘J / Ctrl+J** | toggle panel open/close | global; swallowed when CommandPalette is open |
| **Esc** | close panel | desktop + mobile; if a run is streaming, Esc closes the panel but the run is NOT cancelled (closing ≠ cancelling — Stop cancels). Reconsider per spec; default = close-only. |
| **Enter** (in composer) | send message | when non-empty + not streaming |
| **Shift+Enter** (in composer) | newline | standard chat idiom |
| **Tab / Shift+Tab** | move focus (trapped on mobile, free on desktop) | §5.2 |
| **Enter / Space** (on a tool-card expander, example chip, Retry) | activate | native button semantics |

### 5.5 Contrast
- All text pairs use DESIGN.md's AA-cleared tokens: `foreground` on `card` (AAA), `muted-foreground` (the 40% L darkened value) on `card`/`secondary` (AA), status text via the **darkened variants** (`success-text`, `--status-lost-text`, `warning-foreground`/`warning-icon`) on their tints — never a base status hue as text on a light tint. The user bubble is `foreground` on `secondary` (AA). No new color decisions; reuse the proven pairs.

### 5.6 Reduced motion
- The typing indicator, the streaming caret, the open/close slide, and any "Working…" dot animation all respect `prefers-reduced-motion` — degrade to a static state / crossfade (the `motion-reduce:animate-none` idiom already in `ConfirmDialog`). The typing dots become a static "Working…" label under reduced motion.

### 5.7 Color independence
- Status is never color-only: tool-card states carry a glyph (`✓`/spinner/`!`) **and** a text label; status chips carry a dot **and** the word; the user/assistant distinction is position + shape (right bubble vs. left prose) **and** an SR-only "You said" / "Assistant" prefix in the `role="log"` so the stream is unambiguous to a screen reader.

---

## 6. Motion / performance

- **Open/close transition:** desktop — slide-in from the right (translateX) + fade over ~150–180ms ease-out (the `confirm-anim` timing family); mobile — slide-up/over like the mobile sheet. **Reduced-motion → crossfade only, no transform** (the existing `motion-reduce` degrade).
- **Append-without-jank:** new events append to the bottom; auto-scroll to bottom is done with a single `scrollTo` after paint, **only when the user is already at the bottom** (preserve scroll position if they scrolled up — show the "Jump to latest" pill instead). Streamed text appends into the *same* assistant node (don't remount per token — mutate the text content) so React reconciliation is cheap and the SR `role="log"` sees additions, not replacements.
- **Streaming throttle:** coalesce token chunks before committing to the DOM (e.g. rAF-batched) to avoid layout thrash on fast streams.
- **Transcript cap / virtualization:** cap the in-DOM transcript at a sane length (proposed ~200 events) — beyond that, **collapse older turns** ("Show earlier messages") rather than mounting unbounded nodes. Full virtualization (windowing) is **noted as a follow-up, not required for A2** (read-only Q&A sessions are short); the cap + collapse is the A2 measure. Record the cap constant in the spec.

---

## 7. Proposed `DESIGN.md` additions (for owner sign-off — fold in during build/design-review)

All reuse existing scales (radius, spacing, color roles); **no new hue, no new font, no raw hex**. These are **molecule/component** additions — the atoms already exist.

### New CSS custom properties / layout tokens
| Proposed token | Value (from existing scale) | Why it's needed (gap) |
|---|---|---|
| `--agent-panel-w` | `400px` | Fixed desktop drawer width — a layout constant alongside `--rail-w: 224px` / `--header-h: 56px`. Not derivable from an existing token; new genuine layout constant. |
| `--agent-panel-breakpoint` | `1024px` | The panel's modal-sheet threshold (distinct from the 920 rail-collapse and 768 table-reflow breakpoints, §1.5). A new, panel-specific responsive boundary. |

### New components (DESIGN.md §5 "Components" entries)
| Proposed component | Built from existing tokens | Notes |
|---|---|---|
| **`AssistantPanel` (drawer surface)** | `card` bg, left `border`, `Overlay` shadow (desktop) / scrim (mobile), `--agent-panel-w`, flex header/transcript/composer | A new surface archetype: a **persistent non-modal right drawer**. DESIGN.md currently documents modal overlays (ConfirmDialog) + the mobile rail drawer but **no persistent companion drawer** — this is a real gap to record (and a Do/Don't: "a companion drawer is non-modal on desktop — never trap focus or scrim the background"). |
| **`ChatBubble` (user message)** | `secondary` bg, `foreground` text, `rounded.md` (one corner squared), `spacing.2/3` pad, `body` type, right-aligned, max-w ~85% | New molecule. Explicitly **not** blue (One-Blue compliance noted). |
| **assistant-text block** | `foreground`, `body`, `mono` for inline IDs | Bubble-less prose; arguably not a new component, just a typographic treatment — record as a pattern note. |
| **`ToolCallCard`** | `secondary`/`card`+`border`, `rounded.md`, `label` 12px `muted-foreground`, glyph `success`/`muted-foreground`/`destructive`, `tabular` count, `spacing.2` | New molecule — the "looked up `<entity>` · N rows" evidence card. Recedes by design. |
| **status chip (transient)** | reuses `badge-status` + a leading 6px dot | **Not new** — it is `badge-status` applied to a transient run-phase. Record as a usage note, not a new token. |
| **example-question chip (empty state)** | `button-outline`/`control` shape, `rounded.md`, `label` type | Reuses the control-chip idiom; record as a usage pattern. |
| **typing indicator** | `muted-foreground` dots, reduced-motion-safe | New small animated affordance; document the reduced-motion degrade. |

### Icon
- The panel needs an **"Assistant" icon** for the Rail item + header button (proposed `sparkles` or `message`/`chat`). Confirm the icon exists in `src/components/ui/icons.ts` `IconName` set or add one — flagged for the build (icon-set addition, not a token).

### Feature flag
- Add `agentPanel: false` to `src/lib/features.ts` (UI-hide-first), and an "Assistant" `feature`-gated entry path. (Code change, not a DESIGN.md token — noted for the implementer.)

> **None of these introduce a new color, font, radius, or border value.** Every visual decision lands on an existing atom; the additions are layout constants + molecule definitions. Owner sign-off requested only on: (a) the `--agent-panel-w` 400px and `--agent-panel-breakpoint` 1024px constants, (b) recording the **non-modal companion-drawer** as a sanctioned new surface archetype in DESIGN.md (it widens the "overlays are modal" assumption — deliberately, for this one surface).

---

## 8. Lens-D self-grade (the 5 questions, against the primary job)

**Primary job (jtbd.md):** *"When I'm working in PMO and have a question about my own data, I want to ask my agent in plain language… so I get answers without leaving the app or exceeding my access."* Primary role: **Any.**

1. **Job — what did the user come to do?** Ask a plain-language question about their own data and get a scannable answer *in context, without leaving the page.* ✅ The persistent non-modal drawer + ⌘J-from-anywhere + answer-as-focal-prose serves exactly this.
2. **Expectation — do they expect this here, named this way?** ✅ ⌘J mirrors the established ⌘K palette idiom; "Assistant" in the Rail + a header button matches where users look for AI affordances; the conversation persisting across routes matches the mental model of a companion. **Risk:** ⌘J must be genuinely unbound elsewhere — verify no collision (low risk, flagged).
3. **Priority / placement — decision-relevant info first?** ✅ The **answer** is the most prominent element (full `foreground` prose); tool-calls and status recede to `muted-foreground` metadata. The empty state leads with *what the agent can answer* (scent) so the user immediately knows the job is doable here. The "I only see what you can see" line places the trust-relevant fact up front.
4. **Actionability — can they act in one step on what they see?** ✅ Example chips prefill the composer (one tap to a question); Retry is adjacent to errors; Stop is adjacent to streaming. **Reserved gap (by design):** in A2 the agent only *answers* — it cannot yet *act* on the answer (no "open that project" link from an answer, no write). The job's "act within what I'm allowed to do" half is **A3/A4**. A2 honestly scopes to "answers"; the footnote "Answers are read-only for now" sets that expectation (no dishonest doorway — anchor #4). **Recommendation to strengthen even in A2:** where the answer names a record (e.g. "PRJ-0142 is behind"), render that code as a **link into the record** — cheap, large actionability win, keeps the "a number is never a dead end" anchor. Flag for the spec (may be A2-stretch or A3).
5. **Mental-model consistency — same paradigm as analogues?** ✅ The a11y/overlay contract mirrors `ConfirmDialog`/`AIComposerModal`/the mobile rail drawer; the trigger mirrors the CommandPalette; the icon-button cluster mirrors the header; tokens are 100% the existing system. The one deliberate divergence — **non-modal on desktop** — is *correct* for a companion (a modal would break the job), and is recorded as a sanctioned new archetype (§7) rather than a silent inconsistency.

**Open risk register:**
- **R1 (Q2):** ⌘J collision — verify against any existing global binding before build. *Low.*
- **R2 (Q4):** the "answer → actionable record link" (record-code-as-link) is the highest-value cheap win; decide A2 vs A3 in the spec. *Owner/spec decision.*
- **R3 (a11y):** the non-modal-desktop / modal-mobile **dual focus contract** (§5.2) is the implementation's sharpest edge — it must be covered by axe + a focus-order test in both modes (graduates to the QA portfolio). *Build gate.*
- **R4 (scope honesty):** "read-only" must be stated in-UI (§4.1 footnote) so the panel isn't a dishonest doorway promising writes it can't do yet. *Built into the empty state.*

---

## 9. Open questions for the owner / spec

1. **⌘J** confirmed as the binding (vs. a floating button)? ADR-0040 OQ#3 recommends ⌘J + Rail; this plan assumes it.
2. **Panel width 400px** and the **1024px modal-sheet breakpoint** — sign off the two new layout constants (§7).
3. **Non-modal companion drawer** sanctioned as a new DESIGN.md surface archetype (§7)? (It deliberately relaxes "overlays are modal" for this one surface.)
4. **Record-code-as-link in answers** (R2) — A2 stretch or defer to A3?
5. **Esc while streaming** — close-only (this plan's default) or close-and-cancel? (This plan: close ≠ cancel; Stop cancels.)
6. **Header placement of the trigger** — header ghost button + Rail item both (recommended), or Rail-only?
7. Reconcile FR/AC IDs once `docs/specs/agent-assistant-panel.spec.md` is authored (the spec owns behaviour; this plan owns layout/IxD/states/a11y).
```
