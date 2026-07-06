# ADR-0049 — Safe markdown rendering in the agent transcript (reversing the plain-text-only stance)

- **Status:** Proposed (owner accepts at merge of the agent-experience-layer PR)
- **Date:** 2026-07-05
- **Deciders:** Director, eng-planner (owner sign-off pending at merge)
- **Related:** ADR-0039 (untrusted-output validation boundary — the trust posture this extends to prose),
  ADR-0045 (transcript interaction contracts — typed widgets/ask-user/context, the plumbing this coexists
  with), ADR-0036 §5 (declarative-artifact rule — safe declarative rendering is allowed; executable
  generative UI is not), ADR-0040 (the in-app panel), ADR-0010 (test pyramid).
- **Supersedes (design-plan decision, not an ADR):** **D-A2-8** in `docs/plans/2026-06-30-agent-assistant-panel.md`
  ("Assistant text rendered as PLAIN TEXT … NO markdown lib in A2"). D-A2-8 was an A2-scoping call, never an
  architectural decision. This ADR promotes the question to the ADR tier because it (a) reverses a locked
  posture, (b) adds a new untrusted-render trust surface, and (c) introduces a runtime dependency.
- **Spec:** `docs/specs/agent-experience-layer.spec.md` (FR-AXP-001..007, AC-AXP-001..006, NFR-AXP-SEC-001).
- **Plan:** `docs/plans/2026-07-05-agent-experience-layer.md`.

---

## Context

The shipped `AssistantPanel` renders an `assistant` transcript event's text as a bare JSX text node
(`TranscriptItem.tsx` `case 'assistant'` → `{event.text}`). When the model answers in GitHub-Flavored
Markdown (`**bold**`, `- lists`, `| pipe tables |`, fenced code), the user sees literal asterisks and pipe
walls — the panel "feels like a raw chatbot" even though its typed-widget plumbing (ADR-0045) is fully
built. The root cause on the render side is **D-A2-8**: A2 deliberately shipped plain-text-only, with the
security note "Plain-text assistant rendering only — NO `dangerouslySetInnerHTML`" (`AssistantPanel.tsx:12`,
`ChatBubble.tsx`, spec NFR-AP-SEC-002).

That security note is **correct and must be preserved**. But it currently *also* blocks legible prose,
because nothing renders safe markdown. We need to render markdown **without** relaxing the no-raw-HTML
stance. This is the same problem ADR-0039 solved for composed views (untrusted model output crosses a
validation boundary before it can render) and ADR-0045 solved for typed widgets (twice-validated payloads,
unknown kinds fall back to safe text) — now applied to **prose**.

Three facts shape the decision:

1. **Model text is untrusted** (ADR-0039). The renderer's fixed React-element output is the boundary — the
   renderer must never emit raw HTML, scripts, styles, event handlers, `<iframe>`, or unsafe-scheme links,
   even if the model's markdown contains them.
2. **`ChatBubble` (the user echo) must stay literal** — a user typing `*` should see `*`; rendering user
   input as markdown is an unnecessary trust surface for zero benefit (FR-AXP-006).
3. **Prose and typed widgets coexist** (ADR-0045 §1). Markdown is for narrative; the registry is for
   sortable/charted data. Markdown must NOT intercept the `artifact{kind:'widget'}` / `status{kind:'question'}`
   paths.

## Decision

Tags: **[SEC]** = security-invariant; **[UX]** = experience.

### 1. Render `assistant` prose as GitHub-Flavored Markdown, via a fixed safe element set. **[UX]**
An `assistant` event's `text` renders through a markdown renderer that emits **only a fixed, safe set of
React elements** (headings, bold/italic, ordered/unordered lists, inline + fenced code, blockquotes, links,
GFM pipe tables). No `dangerouslySetInnerHTML`, no raw-HTML passthrough (FR-AXP-001/002).

### 2. The dependency: `react-markdown` + `remark-gfm`, with raw-HTML disabled by construction. **[SEC]**
`react-markdown` is chosen because it is **safe by default**: it does **not** parse or render raw HTML
unless a `rehype-raw`/`rehype-dangerouslySetInnerHTML`-style plugin is explicitly added. We add **no** such
plugin — raw HTML embedded in the model's markdown is escaped/dropped, never executed. `remark-gfm` adds
pipe tables + strikethrough + task lists. The renderer is configured with:
- **no** `rehype-raw` (raw HTML stays inert) — this is the core [SEC] invariant;
- a **`urlTransform`** (react-markdown's built-in href sanitizer hook) restricting link schemes to an
  allowlist (`http`, `https`, `mailto`, and same-origin relative paths); a disallowed scheme
  (`javascript:`, `data:`, `vbscript:`, …) makes the link render as inert text, not a live anchor
  (FR-AXP-003);
- a **`components` override** for `a` forcing `rel="noopener noreferrer nofollow"` (and `target="_blank"`
  only for absolute links) (FR-AXP-003);
- an allowed-element allowlist via `allowedElements`/`disallowedElements` so `<script>`, `<style>`,
  `<iframe>`, form controls, and event-handler-bearing elements can never appear (defense in depth on top
  of the no-`rehype-raw` posture).

This mirrors ADR-0039's "the validator is the authority, the prompt is defense-in-depth" posture: here the
**renderer's fixed element set is the authority**; nothing the model writes can widen it.

### 3. `ChatBubble` (user echo) stays literal — no markdown parse. **[SEC]**
The user's own bubble continues to render `{text}` as a bare text node (FR-AXP-006). User input is never
markdown-parsed.

### 4. Coexistence — markdown applies to prose text ONLY. **[UX]**
The markdown renderer runs only in the `assistant` case. The `artifact{kind:'widget'}` → `WidgetSlot`
(registry) path, the `status{kind:'question'}` → `QuestionChips` path, the `compose_view` artifact, and
tool-call cards are untouched (FR-AXP-005). Precedence — enforced by the prompt (ADR-0050 / FR-AXP-011),
not the renderer: **typed widget for structured/sortable/tabular data; safe markdown for narrative prose.**
A markdown table the model writes *inline as prose* still renders legibly (a real `<table>`), but the model
is steered to route genuinely tabular answers to the `data_table` widget.

### 5. Streaming degrades gracefully; parsing is memoized per message. **[UX]**
Partial/incomplete markdown mid-stream (an unterminated code fence, a half-written table) renders without
throwing and settles to the correct output on completion (FR-AXP-004). The parse is memoized per message id
so an unrelated transcript re-render does not re-parse every message (NFR-AXP-PERF-001), and the streaming
`aria-live` announcement contract is unchanged (NFR-AXP-A11Y-002).

### 6. Behind the existing `agentAssistant` flag; no new flag. **[UX]**
Markdown rendering is part of the panel; with `agentAssistant` off the panel and renderer do not mount
(FR-AXP-007).

## Consequences

**Positive**
- Assistant prose reads as formatted, legible text — the panel stops feeling like a raw chatbot — while the
  **no-raw-HTML security posture (`AssistantPanel.tsx:12`) is preserved by construction** (`react-markdown`
  emits typed React elements, never raw HTML). The XSS surface is closed by a **gate test** feeding hostile
  markdown (`<script>`, `<img onerror>`, `<iframe>`, `[x](javascript:…)`) and asserting nothing executes
  (AC-AXP-003).
- The trust boundary is the **same posture** as ADR-0039 (composed views) and ADR-0045 (typed widgets): the
  renderer's fixed output is the authority, model text is untrusted. One coherent story across all three
  agent output surfaces.
- Semantic, accessible output (real headings/lists/tables/`<code>`) — a screen reader conveys structure
  (NFR-AXP-A11Y-001).

**Negative / costs**
- **A new client dependency.** `react-markdown` + `remark-gfm` add ~40–60 KB gzipped (pulls `micromark`,
  `mdast`). Acceptable for an already-flag-gated panel; the plan flags the **@emnapi/rolldown lockfile
  trap** (a darwin `npm install` prunes rolldown's linux optionals → CI `npm ci` EUSAGE) and mandates the
  splice-into-the-CI-proven-lockfile fix, not a raw `npm install` on the dev machine.
- **A second markdown renderer would be a maintenance smell.** This is the *only* markdown surface in the
  app; if a second appears, it must reuse this configured renderer, not add another dep.
- The `urlTransform` + `components.a` + `allowedElements` config is a security-load-bearing block — reviewers
  must treat any relaxation (adding `rehype-raw`, widening the scheme allowlist) as a security change.

## Alternatives considered

- **Keep plain text, add `whitespace-pre-wrap` only.** Rejected: preserves newlines but still shows literal
  `**`/`|` — does not solve the legibility problem the spec targets.
- **Hand-roll a tiny safe-subset markdown parser.** Rejected: reinvents a well-solved, security-sensitive
  problem; a hand-rolled parser is exactly the kind of ad-hoc validity check ADR-0039 forbids. `react-markdown`
  is the mature, safe-by-default option.
- **`marked`/`markdown-it` + `DOMPurify` + `dangerouslySetInnerHTML`.** Rejected: reintroduces
  `dangerouslySetInnerHTML` (violating the `AssistantPanel.tsx:12` stance) and makes safety depend on a
  correctly-configured sanitizer at the HTML-string layer rather than a renderer that never produces raw
  HTML. `react-markdown`'s no-raw-HTML-by-default posture is a stronger, simpler invariant.
- **Render markdown for the user bubble too.** Rejected: unnecessary trust surface, surprises users who type
  literal `*` (FR-AXP-006).

## Verification

- **Decision-level:** owner sign-off at merge → Status → Accepted; `docs/README.md` ADR range updated to
  include `0049`; the D-A2-8 supersession noted.
- **Renderer safety:** AC-AXP-003 (hostile-markdown gate) + AC-AXP-001/002 (formatted output) + AC-AXP-004
  (streaming no-throw) + AC-AXP-005 (user bubble literal) + AC-AXP-006 (typed widget still via registry) —
  Vitest/RTL, per the plan's Track A.
- **No security regression:** a negative grep gate confirms no `rehype-raw`, no `dangerouslySetInnerHTML`,
  and no `dompurify` in the panel tree; the `urlTransform`/`allowedElements` config is present.
