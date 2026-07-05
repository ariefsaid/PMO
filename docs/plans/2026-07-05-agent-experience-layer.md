# Implementation plan — Agent Experience Layer (surface the shipped batteries)

- **Date:** 2026-07-05
- **Issue:** PMO agent-experience-layer — make the deployed `AssistantPanel` stop feeling like a raw chatbot.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-experience-layer.spec.md` (FR-AXP-001..026, OBS-AXP-001..005, NFR-AXP-*, AC-AXP-001..019 + traceability)
- **Binding ADRs (authored with this plan):** `docs/adr/0049-transcript-safe-markdown-rendering.md`
  (supersedes design-plan D-A2-8 plain-text-only), `docs/adr/0050-layered-agent-prompt-charter-and-skills.md`.
- **Depends-on ADRs (unchanged, controlling on conflict):** ADR-0045 (widget/ask-user/context contracts),
  ADR-0039 (untrusted-output boundary), ADR-0036 §2/§5 (deputy invariant + declarative-artifact rule),
  ADR-0044 (automations/notifications), ADR-0010 (test pyramid), ADR-0016/0017 (real-JWT + repository seam).
- **Format model:** `docs/plans/2026-07-03-agent-transcript-contracts.md` (same shape / verify discipline).

> ## ⚠ Read before building
> - **Current-state audit spot-checked (2026-07-05) — the spec's §1.1 audit is accurate on every point:**
>   `TranscriptItem.tsx:72-81` renders `{event.text}` verbatim (no markdown, no `whitespace-pre-wrap`);
>   `prompt.ts:76` ends "respond in plain text"; `prompt.ts` documents ONLY `query_entity`; `handler.ts:1001`
>   appends `buildGroundingHint(req.context?.entity)` on the **initial** run but `handleAnswer` (`:1074`) and
>   `handleDecision` (`:1140`) rebuild `system` **without** it; `schema.ts:142` confirms the hint is named
>   **`as`** (enum `['table']`), not `presentation` (OBS-AXP-002); NO markdown dep in `package.json`;
>   `AssistantPanel.tsx:321` is fixed `w-[400px]`, `:313-317` `fixed right-0 top-0 z-[40]` overlay; NO page
>   under `pmo-portal/pages/` calls `setEntity`. **Re-grep the anchor line numbers before editing** — the
>   AC/FR mapping does not change if a line moved, only the insertion point.
> - **NO schema change, NO migration, NO pgTAP.** This is FE (markdown/context/drawer) + one edge-fn prompt
>   rewrite + one edge-fn grounding-hint fix. If anything here appears to need a migration, **STOP and
>   escalate** — it doesn't.
> - **Owner decisions baked in (do NOT re-open):** (1) precedence = typed widget for structured/sortable
>   data, safe markdown for narrative prose, they coexist; (2) prompt-steering IS in scope, the **eval
>   harness + model bump are DEFERRED to separate issues** (risk flagged, §7); (3) drawer UX §2.5 IS in scope
>   (resizable + dock/overlay toggle, overlay stays default); (4) `setEntity` populators = **all four** entity
>   detail routes (project, procurement case, company, contact); (5) one plan file.

---

## 0. Decisions this plan fixes (mechanical choices the spec/ADRs delegated)

| ID | Choice | Resolution (binding for this plan) |
|---|---|---|
| **DEC-1 — markdown dependency** | which renderer | **`react-markdown` + `remark-gfm`** (ADR-0049 §2). Safe-by-default: no raw-HTML unless a `rehype-raw` plugin is added — **we add none**. `remark-gfm` gives pipe tables. ~40–60 KB gz behind the flag-gated panel. **NO** `marked`/`markdown-it`/`DOMPurify`/`dangerouslySetInnerHTML`. |
| **DEC-2 — lockfile trap** | how to add the dep without CI EUSAGE | **Do NOT run a bare `npm install` on the darwin dev machine** (it prunes rolldown's linux optionals → CI `npm ci` fails EUSAGE / @emnapi, the recurring trap). Add the two `dependencies` lines by editing `package.json`, then regenerate the lockfile with the CI-proven approach: `npm install --package-lock-only` (writes lockfile only, no darwin-pruned `node_modules`) followed by a local `npm ci` to prove resolution. If `npm ci` errors on rolldown optionals, splice the new dep subtree into the existing lockfile rather than a full regen (MEMORY: `npm ci`-not-`npm install` for lockfiles). |
| **DEC-3 — renderer component location** | where the shared markdown renderer lives | **`pmo-portal/src/components/panel/Markdown.tsx`** — a single configured `<Markdown>` wrapper (the ONLY markdown surface in the app, ADR-0049). `TranscriptItem`'s `assistant` case imports it. |
| **DEC-4 — prompt builder signature** | how skills gate on tool registration (FR-AXP-010) | The tool index + gated skills must match the **per-request** registered tool set. `buildAgentSystemPrompt` gains an **optional options arg**: `buildAgentSystemPrompt(entities, rowCap, role, opts?: { composeEnabled?: boolean; automationsEnabled?: boolean })`. Defaulting both to `false` keeps every existing call compiling; the handler passes the real gate values. **Additive, non-breaking** (AC-AXP-009 proves gating). |
| **DEC-5 — grounding hint on continuation** | close the `:1074`/`:1140` omission (FR-AXP-022) | Append `buildGroundingHint(req.context?.entity)` to the `system` string in BOTH `handleAnswer` and `handleDecision`, identical to `handler.ts:1001`. One-line each. `buildGroundingHint` already exists + is grounding-only (ADR-0045 §3); no new function. |
| **DEC-6 — drawer persistence** | where width/mode persist | **`localStorage`** keys `pmo.agentPanel.width` (number px) + `pmo.agentPanel.dock` (`'overlay'|'docked'`), read on mount, written on change. Bounds **320–720px** (spec §2.5 proposal, owner-confirmed default overlay). No server/DB persistence (per-device UX preference). |
| **DEC-7 — §2.5 sequencing** | ship split? | Drawer UX is **Track D**, the LAST track, independently acceptable. If the owner defers it at review, Tracks A/B/C ship without it (partial-ship seam). |

**Edge-fn unit tests live under `pmo-portal/src/lib/agent/*.test.ts`** and import edge-fn modules by relative
path (ADR-0039 §7 convention — Vitest's root is `pmo-portal/`, does not reach `supabase/functions/`). AC-ids
unchanged; the traceability table records the ACTUAL files (the spec's §6 named some under `supabase/…` —
this plan corrects them to the working convention, per REC-1 precedent in the transcript-contracts plan).

---

## 1. Architecture & data flow

```
Browser (flag agentAssistant ON)
  AssistantPanel ── useAssistantPanel (hook)
     ├─ Transcript → TranscriptItem
     │      ├─ case 'assistant'  → <Markdown text={event.text}/>   (Track A — NEW: react-markdown, raw-HTML OFF)
     │      ├─ case 'user'       → <ChatBubble/>                    (UNCHANGED — stays literal, FR-AXP-006)
     │      ├─ artifact{kind:'widget'}   → <WidgetSlot/>            (UNCHANGED — registry path, coexists)
     │      └─ status{kind:'question'}   → <QuestionChips/>         (UNCHANGED — coexists)
     ├─ resize handle + dock/overlay toggle (Track D — NEW: localStorage width/mode)
     └─ AgentContextProvider.getContext() → {route, entity?}        (Track C — populate entity)

  Detail pages (Track C — NEW setEntity callers):
     ProjectDetail / ProcurementDetails / CompanyDetail / ContactDetail
        → useAgentContext().setEntity({type,id,label}) on mount; clear on unmount

  POST /functions/v1/agent-chat { messages, context?, decision? | answer? }
                                                              │
supabase/functions/agent-chat/ (Deno edge fn, caller-JWT deputy — auth UNCHANGED)
  prompt.ts   (Track B — REWRITE: flat body → charter + tool-index + skills; drop "respond in plain text";
                        signature += opts{composeEnabled,automationsEnabled} for gated index/skills)
  handler.ts  (Track B: pass gate flags to buildAgentSystemPrompt at the 3 build sites;
               Track C/DEC-5: append buildGroundingHint(context.entity) in handleAnswer + handleDecision)
                                                              │
Postgres — NO schema change. NO migration. NO new pgTAP.
```

**Deputy invariant + ADR-0039 boundary stay explicit (OBS-AXP-003/004, NFR-AXP-SEC-001/002/003):**
- **Markdown = new trust surface.** Model text is untrusted; `<Markdown>` emits a fixed safe React-element
  set — no `dangerouslySetInnerHTML`, no `rehype-raw`, no `<script>/<iframe>/<style>`, unsafe-scheme links
  inert. This IS the ADR-0039 boundary applied to prose. Proven by AC-AXP-003 (hostile-markdown gate).
- **Prompt = defense-in-depth only.** ADR-0050 restates every hard rule; the schema/handler/RLS remain the
  authorities. Deleting a prompt line cannot widen access (NFR-AXP-SEC-002).
- **Context = grounding only.** `setEntity` publishes `{type,id,label}`; the grounding hint is injected into
  the system prompt TEXT, never read to select a client / skip `can()` / bypass `dispatchAction`. A forged
  `entity.id` degrades to a zero-row RLS read under the caller JWT (AC-ATC-013 unchanged, NFR-AXP-SEC-003).

---

## 2. Parallelizable tracks (sequence to minimize churn + enable partial shipping)

Four tracks, dispatched to maximize parallelism (owner's stated sequencing):

- **Track A — Safe markdown rendering (§2.1)** — pure FE. NEW `Markdown.tsx` + edit `TranscriptItem` `assistant`
  case. **Highest value, independent of B.** Touches `TranscriptItem.tsx` (shared file) — serialize its edit
  vs Track D if both run in parallel worktrees.
- **Track B — Prompt / skills (§2.2)** — pure edge-fn (`prompt.ts` rewrite + `handler.ts` build-site flag
  pass). **Highest value, fully independent of A** (different files, different runtime). **A and B build in
  parallel.**
- **Track C — Context completeness (§2.4)** — small FE (4 detail-page `setEntity` calls) + edge-fn grounding-hint
  consistency (DEC-5). Depends on nothing in A; its edge-fn edit (`handleAnswer`/`handleDecision`) is in the
  same file as B's build-site edits — **serialize the `handler.ts` edits (B then C, or one worktree)**.
- **Track D — Drawer UX (§2.5)** — FE-only, adjacent, **separately acceptable / deferrable** (DEC-7). Edits
  `AssistantPanel.tsx`. Build LAST.

**Battery-surfacing e2e (§2.3)** is verification that **depends on Track B** (the prompt must steer before the
behaviors surface) — it is **Track E** (final e2e + gate), not a parallel build track.

**Recommended dispatch:** A ‖ B in parallel worktrees → C (after B's `handler.ts` lands) → D → E.

---

## 3. Traceability (FR-AXP → owning test → task)

| FR-AXP | AC | Layer | Owning test (title / file) | Task |
|---|---|---|---|---|
| FR-AXP-001 | AC-AXP-001 | Unit | `AC-AXP-001 assistant markdown renders formatted` · `src/components/panel/Markdown.test.tsx` | A2 |
| FR-AXP-001 | AC-AXP-002 | Unit | `AC-AXP-002 markdown pipe table renders as table` · `Markdown.test.tsx` | A2 |
| FR-AXP-002/003 | AC-AXP-003 | Unit (security gate) | `AC-AXP-003 hostile markdown never executes` · `Markdown.security.test.tsx` | A3 |
| FR-AXP-004 | AC-AXP-004 | Unit | `AC-AXP-004 partial streaming markdown does not throw` · `Markdown.test.tsx` | A2 |
| FR-AXP-006 | AC-AXP-005 | Unit | `AC-AXP-005 user message stays literal` · `src/components/panel/ChatBubble.test.tsx` | A5 |
| FR-AXP-005 | AC-AXP-006 | Unit | `AC-AXP-006 typed data_table still renders via registry` · `src/components/panel/TranscriptItem.coexist.test.tsx` | A6 |
| FR-AXP-007 | (in A2/A6) | Unit | flag-off → renderer not mounted (asserted in A6) | A6 |
| FR-AXP-008/009 | AC-AXP-007 | Unit | `AC-AXP-007 prompt is layered, no "respond in plain text"` · `src/lib/agent/prompt.experience.test.ts` | B1 |
| FR-AXP-011 | AC-AXP-008 | Unit | `AC-AXP-008 prompt steers tabular to as:"table"` · `prompt.experience.test.ts` | B1 |
| FR-AXP-010/013/014 | AC-AXP-009 | Unit | `AC-AXP-009 prompt advertises only registered tools` · `prompt.experience.test.ts` | B1 |
| FR-AXP-016 | AC-AXP-010 | Unit | `AC-AXP-010 prompt retains hard security rules` · `prompt.experience.test.ts` | B1 |
| FR-AXP-012/015 | (in B1) | Unit | ask-user skill + anti-over-trigger scoping present (asserted in B1) | B1 |
| FR-AXP-017 | AC-AXP-011 | E2E (+Eval deferred) | `AC-AXP-011 over-budget → inline table` · `e2e/AC-AXP-011-table-surfacing.spec.ts` | E1 |
| FR-AXP-018 | AC-AXP-012 | E2E (+Eval deferred) | `AC-AXP-012 recurring → automation flow` · `e2e/AC-AXP-012-automation-surfacing.spec.ts` | E1 |
| FR-AXP-019 | AC-AXP-013 | E2E (+Eval deferred) | `AC-AXP-013 ambiguous → ask_user chips` · `e2e/AC-AXP-013-ask-user-surfacing.spec.ts` | E1 |
| FR-AXP-020 | AC-AXP-014 | E2E | `AC-AXP-014 narrative → formatted markdown, role-grounded` · `e2e/AC-AXP-014-markdown-narrative.spec.ts` | E1 |
| FR-AXP-021 | AC-AXP-015 | Unit | `AC-AXP-015 detail route publishes entity` · `pages/**/…entityContext.test.tsx` (×4) | C2–C5 |
| FR-AXP-021/022 | AC-AXP-016 | E2E | `AC-AXP-016 summarize this grounds to viewed project` · `e2e/AC-AXP-016-context-summarize.spec.ts` | E1 |
| FR-AXP-022 | AC-AXP-017 | Unit | `AC-AXP-017 grounding hint on continuation turns` · `src/lib/agent/handlerContext.grounding.test.ts` | C1 |
| FR-AXP-023 | (AC-ATC-013 unchanged) | — | re-proven by nothing new; asserted by C1's forged-id sub-case | C1 |
| FR-AXP-024/026 | AC-AXP-018 | Unit + E2E | `AC-AXP-018 drawer resizable + persists` · `src/components/panel/AssistantPanel.resize.test.tsx` / `e2e/AC-AXP-018-drawer-resize.spec.ts` | D1–D2 |
| FR-AXP-025/026 | AC-AXP-019 | Unit + E2E | `AC-AXP-019 dock/overlay reflow + persists` · `AssistantPanel.dock.test.tsx` / `e2e/AC-AXP-019-drawer-dock.spec.ts` | D3–D4 |

---

## TRACK A — Safe markdown rendering (§2.1) — ADR-0049

> Pure FE. NEW `Markdown.tsx` + one edit to `TranscriptItem`'s `assistant` case. Parallel with Track B.

### Task A0 — Add `react-markdown` + `remark-gfm` (DEC-1/DEC-2) — FR-AXP-001, NFR-AXP-SEC-001
**File:** `pmo-portal/package.json` (EDIT)
- Add to `dependencies` (alphabetical): `"react-markdown": "^9.0.1"`, `"remark-gfm": "^4.0.0"`.
- Regenerate the lockfile the CI-safe way (DEC-2 — do NOT bare `npm install`): from `pmo-portal/`,
  `npm install --package-lock-only`, then prove resolution with `npm ci`. If `npm ci` errors on rolldown/@emnapi
  linux optionals, splice the two new dep subtrees into the existing `package-lock.json` instead of a full
  regen (MEMORY: darwin-prune trap).

**Verify:** from `pmo-portal/`: `node -e "require('react-markdown'); require('remark-gfm'); console.log('ok')"`
prints `ok`; `git diff --stat package.json` shows only the two additions; `npm ci` exits 0.

### Task A1 — `Markdown` failing tests (RED) — AC-AXP-001/002/004, FR-AXP-001/004
**File:** `pmo-portal/src/components/panel/Markdown.test.tsx` (NEW)
Import `{ Markdown }` from `'./Markdown'`. Render inside `<MemoryRouter>` (links may be relative).
- **AC-AXP-001:** `render(<Markdown text={"**Done.** Here are the steps:\n\n1. First\n2. Second"} />)`; assert
  `screen.getByText('Done.').tagName === 'STRONG'`, a real `<ol>` with two `<li>` (`screen.getAllByRole('listitem')`
  has length 2), and NO literal `**`/`1.` text nodes (`expect(screen.queryByText(/\*\*/)).toBeNull()`). Title:
  `AC-AXP-001 assistant markdown renders formatted`.
- **AC-AXP-002:** `text` = a GFM pipe table (`"| Project | Budget |\n|---|---|\n| Alpha | 100 |"`); assert
  `screen.getByRole('table')` exists, a `columnheader` "Project" and a `cell` "Alpha" render, and no `|` wall
  (`expect(screen.queryByText(/^\| Project/)).toBeNull()`). Title: `AC-AXP-002 markdown pipe table renders as table`.
- **AC-AXP-004:** `text` = an UNTERMINATED code fence (`"Here:\n\n```ts\nconst x = 1"`) and a half-written table
  (`"| A | B |\n|---|"`); assert `render(...)` does not throw (the passing render is the proof) and the partial
  text appears; then rerender with the completed string and assert it settles (a `<code>`/`<pre>` for the fenced
  block). Title: `AC-AXP-004 partial streaming markdown does not throw`.

**Verify (fails):** `npx vitest run src/components/panel/Markdown.test.tsx` → module-not-found.

### Task A2 — `Markdown.tsx` (GREEN for A1) — FR-AXP-001/002/003/004, NFR-AXP-A11Y-001, ADR-0049 §2
**File:** `pmo-portal/src/components/panel/Markdown.tsx` (NEW)
```tsx
import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Safe href schemes (FR-AXP-003, ADR-0049 §2). Same-origin relative paths pass (no scheme). */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];
function safeUrl(url: string): string {
  try {
    // Relative URLs (no scheme) resolve against the app origin → allowed.
    const u = new URL(url, window.location.origin);
    return SAFE_SCHEMES.includes(u.protocol) ? url : ''; // '' → react-markdown renders inert text, no anchor
  } catch {
    return '';
  }
}

/**
 * Markdown — the app's SOLE markdown surface (ADR-0049). Renders assistant PROSE only.
 * SECURITY (ADR-0039 boundary applied to prose, NFR-AXP-SEC-001):
 *   - NO rehype-raw / NO dangerouslySetInnerHTML → raw HTML in the model text is escaped/dropped, never executed.
 *   - disallowedElements + unwrapDisallowed strips script/style/iframe/form controls even if a plugin emitted them.
 *   - urlTransform (safeUrl) restricts link schemes; components.a forces rel + safe target.
 * Do NOT add rehype-raw or widen SAFE_SCHEMES without a security review (ADR-0049 §2).
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div data-testid="assistant-markdown" className="text-sm text-foreground [&_*]:break-words prose-pmo">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        /* no rehypePlugins — raw HTML stays inert (ADR-0049 §2) */
        urlTransform={safeUrl}
        disallowedElements={['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta']}
        unwrapDisallowed
        components={{
          a: ({ href, children, ...rest }) => {
            const isAbsolute = !!href && /^https?:/i.test(href);
            return (
              <a
                href={href}
                {...(isAbsolute ? { target: '_blank' } : {})}
                rel="noopener noreferrer nofollow"
                {...rest}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
```
Notes: `memo` satisfies NFR-AXP-PERF-001 (no re-parse on unrelated re-render). `prose-pmo` is a token-scoped
class for heading/list/table spacing on DESIGN.md tokens — if no `prose-pmo` utility exists, style headings/
lists/tables/code with explicit Tailwind in the `components` overrides (headings `font-semibold`, `ul`
`list-disc pl-4`, `table` `border-collapse` with `th` `text-left font-medium`, `code`
`rounded bg-secondary/60 px-1 font-mono text-[0.85em]`) — keep it minimal + tokenized (design-reviewer owns
the polish pass at Track E).

**Verify (green):** `npx vitest run src/components/panel/Markdown.test.tsx` → pass.

### Task A3 — Hostile-markdown security gate (RED→GREEN) — AC-AXP-003, FR-AXP-002/003, NFR-AXP-SEC-001
**File:** `pmo-portal/src/components/panel/Markdown.security.test.tsx` (NEW)
`render(<Markdown text={hostile} />)` inside `<MemoryRouter>` where `hostile` concatenates
`"<script>alert(1)</script>"`, `"<img src=x onerror=alert(1)>"`, `"<iframe src='https://evil'></iframe>"`,
`"[click](javascript:alert(1))"`, and a raw `"<div onclick='x()'>hi</div>"`. Assert ALL:
- `expect(document.querySelector('script')).toBeNull()`;
- `expect(document.querySelector('iframe')).toBeNull()`;
- no element has an `onerror`/`onclick`/any `on*` handler attribute
  (`document.querySelectorAll('*').forEach(el => el.getAttributeNames().forEach(n => expect(n.startsWith('on')).toBe(false)))`);
- the `javascript:` link is inert — either rendered as text or an `<a>` with NO `href` pointing at `javascript:`
  (`expect(document.querySelector('a[href^="javascript:"]')).toBeNull()`);
- any surviving `<a>` carries `rel` containing `noopener` and `nofollow`.
Title: `AC-AXP-003 hostile markdown never executes`.
Because A2 already ships the safe config, this test should pass on first run against A2 — if any assertion is
RED, the `Markdown.tsx` config is the bug (do NOT weaken the test; fix the config, ADR-0049 §2).

**Verify (green):** `npx vitest run src/components/panel/Markdown.security.test.tsx` → pass. **Negative grep gate:**
`rg -n "rehype-raw|dangerouslySetInnerHTML|dompurify" pmo-portal/src/components/panel/` → no matches.

### Task A4 — Wire `Markdown` into `TranscriptItem` assistant case (GREEN) — FR-AXP-001/005/007
**File:** `pmo-portal/src/components/panel/TranscriptItem.tsx` (EDIT — `case 'assistant'` at :72-81)
Replace the bare `{event.text}` child with `<Markdown text={event.text ?? ''} />`. Keep the surrounding
`<div data-transcript-item>`, the `sr-only "Assistant: "` prefix, the `data-testid="assistant-bubble"` wrapper
(so existing panel/axe tests still find it), and the `FeedbackControl`. Import `{ Markdown }` from `./Markdown`.
Do NOT touch the `user` / `tool` / `status` / `artifact` cases — markdown applies to prose ONLY (FR-AXP-005,
coexistence). No flag branch needed here: the whole panel is `agentAssistant`-gated at mount (FR-AXP-007).

**Verify (green):** `npx vitest run src/components/panel/TranscriptItem.test.tsx` → green (adjust a query only
if it asserted the literal text node shape — the `data-testid="assistant-bubble"` + `sr-only` prefix survive;
NEVER weaken an assertion, BDD rule).

### Task A5 — `ChatBubble` stays literal (RED→GREEN, regression lock) — AC-AXP-005, FR-AXP-006
**File:** `pmo-portal/src/components/panel/ChatBubble.test.tsx` (NEW or EDIT if exists)
`render(<ChatBubble text={"use * and ** literally"} />)`; assert `screen.getByText('use * and ** literally')`
renders the string verbatim, NO `<strong>`/`<em>`/`<li>` transformation (`expect(document.querySelector('strong')).toBeNull()`).
Title: `AC-AXP-005 user message stays literal`. `ChatBubble.tsx` is UNCHANGED (it already renders `{text}` as a
bare node) — this task only LOCKS the invariant so a future refactor can't markdown-parse the user bubble.

**Verify (green):** `npx vitest run src/components/panel/ChatBubble.test.tsx` → pass.

### Task A6 — Coexistence + flag-off (RED→GREEN) — AC-AXP-006, FR-AXP-005/007
**File:** `pmo-portal/src/components/panel/TranscriptItem.coexist.test.tsx` (NEW)
- **AC-AXP-006:** with `agentAssistant` flag ON (mock `isFeatureEnabled`), render a `TranscriptItem` whose
  `event` is `artifact{kind:'widget', widget:{kind:'data_table', columns:[{key:'name',label:'Project'}], rows:[{name:'Alpha'}]}}`
  inside `<MemoryRouter>`; assert the real `DataTable` renders (`screen.getByRole('table')` + cell `Alpha`) and
  the markdown renderer did NOT intercept it (`expect(screen.queryByTestId('assistant-markdown')).toBeNull()`).
  Title: `AC-AXP-006 typed data_table still renders via registry`.
- **FR-AXP-007 (flag-off):** with `agentAssistant` OFF, render the same widget event → assert nothing renders
  (`container.firstChild` null / no table), confirming the panel's flag-off posture is unchanged. (Same-file
  assertion, no separate AC.)

**Verify (green):** `npx vitest run src/components/panel/TranscriptItem.coexist.test.tsx` → pass.
**Track-A gate:** `npx vitest run src/components/panel` → all Track-A tests green.

---

## TRACK B — Prompt / skills architecture (§2.2) — ADR-0050

> Pure edge-fn. `prompt.ts` rewrite + `handler.ts` build-site flag pass. Independent of Track A — build in
> parallel. Serialize the `handler.ts` edit vs Track C (both touch `handler.ts`).

### Task B1 — Layered-prompt failing tests (RED) — AC-AXP-007/008/009/010, FR-AXP-008..016
**File:** `pmo-portal/src/lib/agent/prompt.experience.test.ts` (NEW) [edge-fn-unit via relative import]
Import `{ buildAgentSystemPrompt }` from `'../../../../supabase/functions/agent-chat/prompt'`. Call with a small
entity list (e.g. `['projects','companies']`), `rowCap=50`, `role='engineer'`.
- **AC-AXP-007:** the returned string contains a charter section (assert a stable substring, e.g. a
  `## Charter`/`## Purpose` heading the rewrite introduces), a tool-index section (assert a `query_entity`
  index line AND an `ask_user` index line), at least the table + ask-user skills each with a "Use when" trigger
  (assert `/Use when/i` appears ≥2×), and it does **NOT** contain `"respond in plain text"`
  (`expect(prompt).not.toContain('respond in plain text')`). It is still pure metadata (no data rows — assert
  no sample values leak; the entity block still lists column names only). Title:
  `AC-AXP-007 prompt is layered, no "respond in plain text"`.
- **AC-AXP-008:** assert the prompt instructs `as:"table"` explicitly (`expect(prompt).toMatch(/as["']?\s*[:=]\s*["']?table/i)`
  or the literal `as:"table"`) for multi-row data AND tells the model NOT to hand-roll a markdown table
  (`/do not.*(markdown|pipe).*table/i`). Uses the REAL field name `as` (OBS-AXP-002), never `presentation`
  (`expect(prompt).not.toMatch(/presentation.*table/i)`). Title: `AC-AXP-008 prompt steers tabular to as:"table"`.
- **AC-AXP-009:** build with `opts={composeEnabled:false, automationsEnabled:false}` → assert the prompt does
  NOT mention `compose_view` or `create_automation` (`expect(prompt).not.toContain('compose_view')`,
  `not.toContain('create_automation')`). Build with `opts={composeEnabled:true, automationsEnabled:true}` →
  assert the compose skill AND the automation skill ARE present (`toContain('compose_view')`,
  `toContain('create_automation')`, each with a "Use when" trigger). Title:
  `AC-AXP-009 prompt advertises only registered tools`.
- **AC-AXP-010:** assert the built prompt still contains the deputy/RLS read-only framing (`/read-only/i`,
  `/cannot exceed .*access/i` or the RLS sentence), the FR-DH-007 role rule (`/only the actions and affordances
  permitted to the user's role/i` or the rewritten equivalent), and the no-data-rows rule (`/never include data
  rows/i`). Title: `AC-AXP-010 prompt retains hard security rules`.
- **(FR-AXP-012/015 in-file, no separate AC):** assert the ask-user skill's trigger is scoped to ambiguity
  (`/ambiguous|underspecified|which one/i`) and includes an anti-over-trigger note (`/not.*before every|only
  when|genuinely/i`).

**Verify (fails):** `npx vitest run src/lib/agent/prompt.experience.test.ts` → fails (flat prompt still has
"respond in plain text", no charter/skills/tool-index, no `as:"table"` steer, signature lacks `opts`).

### Task B2 — Rewrite `buildAgentSystemPrompt` to the layered structure (GREEN for B1) — FR-AXP-008..016, ADR-0050
**File:** `supabase/functions/agent-chat/prompt.ts` (EDIT — full body rewrite; signature per DEC-4)
- **Signature:** `buildAgentSystemPrompt(entities, rowCap, role = null, opts: { composeEnabled?: boolean; automationsEnabled?: boolean } = {})`.
  Keep the existing `entities`/`rowCap`/`role` semantics + the `entityDescriptions` + `roleSentence` builders +
  the `HELP_CORPUS` append (all preserved). Stays a **pure function, no I/O, no data rows** (NFR-AR-SEC-005).
- **Compose the body in four layers (ADR-0050 §1):**
  - **(a) Charter** — purpose ("a read-and-act deputy for the PMO app"); the deputy invariant (acts only within
    the caller's RLS-scoped access; read scope = the user's own rows; cannot exceed permissions); anti-fabrication
    ("never invent entity/column names, ids, or data values; only report what a tool returned"); verify-before-done;
    the read-only + no-data-rows-in-reasoning rules (keep the exact existing sentences from the current `## Rules`
    block so AC-AXP-010 greps them); the `roleSentence` (FR-DH-007). **Remove** the trailing "respond in plain
    text" line.
  - **(b) Tool index** — one line per registered tool. Always: `query_entity` (read), `ask_user` (structured
    clarification). Conditionally (only when the flag is on): `compose_view` (when `opts.composeEnabled`),
    `create_automation` + `notify` (when `opts.automationsEnabled`). Build the conditional lines with
    `opts.composeEnabled ? '...' : ''` so an unregistered tool is never advertised (FR-AXP-010, AC-AXP-009).
  - **(c) Skills** (each `### <name> — Use when …`):
    - **table-not-markdown** (always): "When the answer is multi-row/tabular data, call `query_entity` with
      `as:"table"` so the panel renders a real sortable table. Do NOT hand-roll a markdown pipe table for that
      data. A single scalar/KPI answer → prefer `data_insight`; magnitude-over-categories → `data_chart`.
      Narrative/explanatory prose stays as normal (markdown) text." (FR-AXP-011, uses `as` — OBS-AXP-002.)
    - **ask-user** (always): "When the request is ambiguous — an underspecified entity, an unresolved 'which
      one', or a missing required filter the user did not supply — call `ask_user` with structured `options`
      rather than guessing or asking in prose. Example: an ambiguous 'show my projects' that could mean several
      scopes → offer option chips. Use this only on genuine ambiguity, not as a reflex before every answer."
      (FR-AXP-012/015.)
    - **compose-view** (only when `opts.composeEnabled`): "Use `compose_view` when the user wants a
      saved/dashboard/reusable view ('build me a dashboard of…', 'save this as a view'), distinct from a
      one-shot inline widget answer." (FR-AXP-013.)
    - **automation** (only when `opts.automationsEnabled`): "Offer `create_automation` for recurring or
      event-triggered requests ('every Monday…', 'remind me when…', 'when a case sits >30 days…') — `schedule`
      kind for cron phrasing, `trigger` kind for event phrasing — not a one-shot answer. Use only on genuinely
      recurring/triggered phrasing." (FR-AXP-014/015.)
    - **anti-over-trigger closing rule:** "When no skill trigger matches, answer directly." (FR-AXP-015.)
  - **(d) Available entities** block (the existing `entityDescriptions`) + filter-operators + `HELP_CORPUS` —
    preserved. The per-turn live-context grounding hint is appended by the HANDLER (`buildGroundingHint`), not
    here (unchanged — FR-AXP-022 handles its consistency in Track C).
- **NFR-AXP-PERF-002:** keep each skill to ~2 sentences; the whole prompt stays small.

**Verify (green):** `npx vitest run src/lib/agent/prompt.experience.test.ts` → AC-AXP-007..010 pass;
`npx vitest run src/lib/agent/agentChatHandler.test.ts` → still green (any existing prompt-substring assertions
there that referenced "respond in plain text" must be UPDATED to the new structure — that is a deliberate
behavior change per ADR-0050, update the assertion to the new goal, do NOT re-add the removed line).

### Task B3 — Pass the gate flags at the three build sites (GREEN, wiring) — FR-AXP-010, DEC-4
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT — 3 `buildAgentSystemPrompt` call sites: :1001, :1074, :1140)
At each `buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole)` call, add the 4th arg
`{ composeEnabled: deps.composeEnabled, automationsEnabled: AUTOMATIONS_ENABLED }`. `AUTOMATIONS_ENABLED` is the
module const at `handler.ts:76`; `deps.composeEnabled` is on `HandlerDeps` (:184). Where a build site is inside
a helper without direct access to those, thread the value from the const/deps in scope (both are module- or
deps-level, reachable at all three sites). This ensures the tool index/skills match the tools `buildTools`
actually registered for the request (AC-AXP-009).

**Verify (green):** `npx vitest run src/lib/agent/agentChatHandler.test.ts src/lib/agent/handlerPersistence.test.ts`
→ green; `cd pmo-portal && npm run typecheck` → zero errors. **Track-B gate:**
`npx vitest run src/lib/agent/prompt.experience.test.ts src/lib/agent/agentChatHandler.test.ts` → all green.

---

## TRACK C — Context completeness (§2.4)

> Small FE (4 `setEntity` callers) + one edge-fn consistency fix. Its `handler.ts` edit (C1) is in the same
> file as Track B's — serialize (B then C, or one worktree).

### Task C1 — Grounding hint on continuation turns (RED→GREEN) — AC-AXP-017, FR-AXP-022/023, DEC-5, NFR-AXP-SEC-003
**File:** `pmo-portal/src/lib/agent/handlerContext.grounding.test.ts` (NEW) [edge-fn-unit]
Import `agentChatHandler` + copy the `baseDeps`/`modelClient` mock helpers from `agentChatHandler.test.ts` and
the answer-path setup from `handlerQuestion.test.ts` (both shipped).
- **AC-AXP-017 (answer continuation):** build a `req` with `context.entity = { type:'project', id:'p-123',
  label:'Alpha' }`, a `req.answer` present, and a replayed transcript with a trailing unresolved `ask_user`
  tool_use (drives `handleAnswer`). Spy on `modelClient.create`; assert the system message passed to the model
  CONTAINS the grounding hint substring (`p-123` and the entity label, as `buildGroundingHint` formats it) —
  proving the hint is now injected on the answer path. Title: `AC-AXP-017 grounding hint on continuation turns`.
- **AC-AXP-017 (decision continuation):** same, but with `req.decision` present + a trailing confirm tool_use
  (drives `handleDecision`); assert the same grounding substring appears in that path's system message.
- **FR-AXP-023 / AC-ATC-013 unchanged (forged-id sub-case):** set `context.entity.id` to a cross-org id; drive
  a `query_entity` grounded by it; the mocked caller-JWT `supabase` returns `[]`; assert the tool result is
  `{ rowCount:0, rows:[] }` AND only `deps.supabase` (caller-JWT) is touched (no `service_role`/second client) —
  the hint is grounding-only, never authorization (NFR-AXP-SEC-003).

**Verify (fails):** `npx vitest run src/lib/agent/handlerContext.grounding.test.ts` → the continuation-path
assertions fail (`:1074`/`:1140` build `system` without the hint today).

### Task C2 — Inject the hint in both continuation handlers (GREEN for C1) — FR-AXP-022, DEC-5
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT — `handleAnswer` :1074, `handleDecision` :1140)
At both sites, change
`const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole, {…flags…});`
to append the hint exactly as the initial run does at :1001:
`... , {…flags…}) + buildGroundingHint(req.context?.entity);`
(`buildGroundingHint` is the existing ADR-0045 §3 function; `req.context` is on `AgentChatRequest`). No other
change — grounding-only, no `can()`/client/dispatch change (FR-AXP-023). This also carries Track B's flag arg
(DEC-4) added in B3 — apply C2 AFTER B3 at these two sites, or combine the edits if one worktree.

**Verify (green):** `npx vitest run src/lib/agent/handlerContext.grounding.test.ts` → pass;
`npx vitest run src/lib/agent/agentChatHandler.test.ts src/lib/agent/handlerPersistence.test.ts` → still green.

### Task C3 — `setEntity` on ProjectDetail (RED→GREEN) — AC-AXP-015, FR-AXP-021
**File:** `pmo-portal/pages/project-detail/__tests__/ProjectDetail.entityContext.test.tsx` (NEW), then
`pmo-portal/pages/project-detail/ProjectDetail.tsx` (EDIT).
- **Test (RED):** render `ProjectDetail` at `/projects/p-123` with a seeded/mocked `project` (`{id:'p-123',
  name:'Alpha', ...}`) inside a real `<AgentContextProvider>` + `<MemoryRouter>`; read `useAgentContext().getContext()`
  via a probe child; assert it returns `entity:{ type:'project', id:'p-123', label:'Alpha' }`. Then unmount and
  assert `getContext().entity` is `undefined` (cleared on unmount). Title: `AC-AXP-015 detail route publishes entity`.
- **Impl (GREEN):** in `ProjectDetail`, after `project` resolves (the memo at :74), add:
  ```tsx
  const { setEntity } = useAgentContext();
  useEffect(() => {
    if (!project) return;
    setEntity({ type: 'project', id: project.id, label: project.name });
    return () => setEntity(undefined);
  }, [project?.id, project?.name, setEntity]);
  ```
  Import `useAgentContext` from `@/src/lib/agent/context/useAgentContext`. Guard on `project` being loaded
  (don't publish a half-loaded entity). `setEntity` is a no-op outside a provider (the hook's `NOOP_CONTEXT`),
  so this is safe in any render context.

**Verify (green):** `npx vitest run pmo-portal/pages/project-detail/__tests__/ProjectDetail.entityContext.test.tsx` → pass.

### Task C4 — `setEntity` on CompanyDetail + ContactDetail (RED→GREEN) — AC-AXP-015, FR-AXP-021
**Files:** `pmo-portal/pages/CompanyDetail.tsx` (EDIT) + `…/__tests__/CompanyDetail.entityContext.test.tsx` (NEW);
`pmo-portal/pages/ContactDetail.tsx` (EDIT) + `…/__tests__/ContactDetail.entityContext.test.tsx` (NEW).
- Mirror C3 exactly. CompanyDetail: `setEntity({ type:'company', id: company.id, label: company.name })`.
  ContactDetail: `setEntity({ type:'contact', id: contact.id, label: contact.name })` (use the contact's display
  name field — grep the component for the resolved record's name/label field; use `full_name`/`name` as present).
  Each with the same `useEffect` mount/clear pattern and a `getContext()` probe test. Titles:
  `AC-AXP-015 detail route publishes entity` (company / contact variants — the AC is shared; the leading token
  identifies it, distinct file per ADR-0010 tagging).

**Verify (green):** `npx vitest run pmo-portal/pages/CompanyDetail.entityContext.test.tsx pmo-portal/pages/ContactDetail.entityContext.test.tsx` → pass.

### Task C5 — `setEntity` on ProcurementDetails (RED→GREEN) — AC-AXP-015, FR-AXP-021
**File:** `pmo-portal/pages/ProcurementDetails.tsx` (EDIT) + `…/__tests__/ProcurementDetails.entityContext.test.tsx` (NEW).
Mirror C3. The route is `/procurement/:procurementId`; publish
`setEntity({ type:'procurement_case', id: procurementCase.id, label: <case title/ref> })` — grep the component
for the resolved case record and use its human label field (title/subject/ref). Same mount/clear `useEffect`,
same `getContext()` probe test. Title: `AC-AXP-015 detail route publishes entity` (procurement variant).

**Verify (green):** `npx vitest run pmo-portal/pages/ProcurementDetails.entityContext.test.tsx` → pass.
**Track-C gate:** `npx vitest run src/lib/agent/handlerContext.grounding.test.ts pmo-portal/pages` (entity-context
tests) → all green.

---

## TRACK D — Drawer UX (§2.5) — SEPARATELY ACCEPTABLE (DEC-7)

> FE-only, adjacent, deferrable. Build LAST. Overlay stays the default. Edits `AssistantPanel.tsx` — serialize
> vs Track A's `TranscriptItem` edit only if the same worktree touches both (different files, low conflict risk).

### Task D1 — Resizable drawer failing test (RED) — AC-AXP-018, FR-AXP-024/026, NFR-AXP-A11Y-003
**File:** `pmo-portal/src/components/panel/AssistantPanel.resize.test.tsx` (NEW)
Render the panel open on desktop (jsdom defaults to desktop, `AssistantPanel.tsx:37`) with `agentAssistant` on.
- Assert a resize handle exists as a keyboard-operable slider: `screen.getByRole('slider', { name:/resize|width/i })`
  with `aria-valuemin=320`, `aria-valuemax=720`, `aria-valuenow` = current width.
- Fire `ArrowLeft`/`ArrowRight` (or `keyDown`) on the handle → assert `aria-valuenow` changes within [320,720]
  and the panel's inline width style updates.
- Assert persistence: after a width change, `localStorage.getItem('pmo.agentPanel.width')` equals the new value;
  re-mounting a fresh panel reads it back (`aria-valuenow` restores). Title: `AC-AXP-018 drawer resizable + persists`.

**Verify (fails):** `npx vitest run src/components/panel/AssistantPanel.resize.test.tsx` → no slider (fixed w-[400px]).

### Task D2 — Resizable drawer impl (GREEN for D1) — FR-AXP-024/026, DEC-6, NFR-AXP-A11Y-003
**File:** `pmo-portal/src/components/panel/AssistantPanel.tsx` (EDIT — the desktop container at :313-321)
- Replace the fixed `w-[400px]` with an inline `style={{ width }}` where `width` is state initialized from
  `localStorage['pmo.agentPanel.width']` clamped to [320,720], default 400.
- Add a left-edge resize handle: a thin absolutely-positioned element on the panel's left border,
  `role="slider"` `aria-label="Resize assistant panel"` `aria-valuemin={320}` `aria-valuemax={720}`
  `aria-valuenow={width}` `tabIndex={0}`. Pointer-drag (pointerdown→pointermove→pointerup) adjusts width
  (clamped); `onKeyDown` Arrow keys adjust by a step (e.g. 16px, clamped). On every change, write
  `localStorage['pmo.agentPanel.width']`. Do NOT regress the panel's existing focus-trap/Escape behavior
  (FR-AP-006/007) — the handle is a sibling control, not inside the trap's first/last cycle disruptively;
  keep Escape closing the panel (`AssistantPanel.tsx:10`).
- Mobile (<1024px) is unaffected — the resize handle renders only on desktop (`useIsDesktop()` guard).

**Verify (green):** `npx vitest run src/components/panel/AssistantPanel.resize.test.tsx` → pass;
`npx vitest run src/components/panel/AssistantPanel.test.tsx src/components/panel/AssistantPanel.mobile.test.tsx`
→ still green (existing focus/Escape/mobile assertions intact).

### Task D3 — Dock/overlay toggle failing test (RED) — AC-AXP-019, FR-AXP-025/026
**File:** `pmo-portal/src/components/panel/AssistantPanel.dock.test.tsx` (NEW)
Render the desktop panel open.
- Assert a labelled toggle button exists: `screen.getByRole('button', { name:/dock|overlay/i })`.
- Default mode is **overlay** (`fixed right-0 z-[40]` — assert the container has the overlay classes).
- Click the toggle → assert the panel switches to **docked**: it no longer has `fixed`/overlay positioning but
  participates in layout (assert the docked container class / that `<main>` gets a reserved-space sibling
  affordance — assert via a `data-panel-mode="docked"` attribute the impl sets, and that content is NOT covered:
  the panel's container lacks the `fixed inset` overlay class).
- Assert `localStorage['pmo.agentPanel.dock']` persists the choice; re-mount restores it. Title:
  `AC-AXP-019 dock/overlay reflow + persists`.

**Verify (fails):** `npx vitest run src/components/panel/AssistantPanel.dock.test.tsx` → no toggle.

### Task D4 — Dock/overlay toggle impl (GREEN for D3) — FR-AXP-025/026, DEC-6
**Files:** `pmo-portal/src/components/panel/AssistantPanel.tsx` (EDIT), and the layout host that renders
`<main>` alongside the panel (grep for where `AssistantPanel` mounts relative to `<main>` — likely `AppShell`/
`Shell` in `App.tsx`; EDIT to reserve space when docked).
- Add `mode` state (`'overlay'|'docked'`) initialized from `localStorage['pmo.agentPanel.dock']`, default
  `'overlay'` (owner default). A labelled toggle button (in the panel header, near the close button) flips it +
  persists. Set `data-panel-mode={mode}` on the container.
- **Overlay** (default): unchanged — `fixed right-0 top-0 z-[40]` floating over content.
- **Docked**: the panel is a normal in-flow sibling of `<main>` (not `fixed`); the layout host reserves the
  panel's `width` so `<main>` reflows beside it rather than being covered. Implement by having the host read the
  same panel width/mode (lift `mode`+`width` to a small shared context or read `localStorage` in the host) and
  apply a right margin/grid column to `<main>` equal to the panel width when `mode==='docked'`.
- Mobile stays the full-screen sheet regardless of `mode` (the toggle is desktop-only, `useIsDesktop()` guard),
  FR-AXP-025.
- Keyboard/focus: the toggle is a real `<button>` with a discernible name; Escape/focus behavior unchanged
  (FR-AXP-026, NFR-AXP-A11Y-003).

**Verify (green):** `npx vitest run src/components/panel/AssistantPanel.dock.test.tsx` → pass;
`npx vitest run src/components/panel/AssistantPanel.test.tsx src/components/panel/AssistantPanel.mobile.test.tsx`
→ still green. **Track-D gate:** `npx vitest run src/components/panel/AssistantPanel.resize.test.tsx src/components/panel/AssistantPanel.dock.test.tsx` → green + an `axe` pass on the panel with the new controls.

---

## TRACK E — Battery-surfacing e2e (§2.3) + full gate (depends on Track B)

### Task E1 — Surfacing e2e journeys (RED→GREEN) — AC-AXP-011/012/013/014/016
**Files (NEW):** `pmo-portal/e2e/AC-AXP-011-table-surfacing.spec.ts`, `AC-AXP-012-automation-surfacing.spec.ts`,
`AC-AXP-013-ask-user-surfacing.spec.ts`, `AC-AXP-014-markdown-narrative.spec.ts`, `AC-AXP-016-context-summarize.spec.ts`.
Follow the shipped agent-panel e2e patterns (`AC-AR-013`, `AC-CV-015`) — full-serial + dedicated fixtures,
`VITE_FEATURES_AGENT_ASSISTANT=true`. **Determinism (Open Q for Director, §7):** the model is live in prod; in
e2e the `agent-chat` SSE must be **scripted/stubbed** (reuse the AR-013/CV-015 `page.route` stubbing) so the
behavior ACs are deterministic in CI — the E2E asserts the RENDERED outcome given a scripted model turn:
- **AC-AXP-011:** open panel, ask "show me over-budget projects"; script the turn to a `query_entity as:"table"`
  → `artifact{kind:'widget', kind:'data_table'}`; assert a real inline `<table>` renders (`getByRole('table')`
  + a known project cell), NOT a markdown/`<pre>` table. Leading title `AC-AXP-011 …`.
- **AC-AXP-012:** ask "remind me every Monday to review overdue tasks" (automations on); script a
  `create_automation` tool call; assert its approval/confirmation UX appears, not a prose answer. `AC-AXP-012 …`.
- **AC-AXP-013:** ask an ambiguous "show my projects"; script an `ask_user` with options; assert
  `status{kind:'question'}` chips render and tapping a chip continues the SAME run. `AC-AXP-013 …`.
- **AC-AXP-014:** ask "explain how procurement approvals work for my role"; script a markdown prose answer with
  headings/lists; assert the panel renders real `<h*>`/`<ul>`/`<strong>` (not literal asterisks), role-grounded.
  `AC-AXP-014 …`.
- **AC-AXP-016:** navigate to a specific project detail page, open panel, ask "summarize this"; assert the
  scripted `query_entity` filter targets that project id (the grounding hint made `entity.id` available) without
  the user naming it — the `page.route` stub can assert the request body carried `context.entity.id`. `AC-AXP-016 …`.

**Verify:** from `pmo-portal/`: `npx playwright test e2e/AC-AXP-011-table-surfacing.spec.ts e2e/AC-AXP-012-automation-surfacing.spec.ts e2e/AC-AXP-013-ask-user-surfacing.spec.ts e2e/AC-AXP-014-markdown-narrative.spec.ts e2e/AC-AXP-016-context-summarize.spec.ts`.

### Task E2 — Drawer e2e (RED→GREEN) — AC-AXP-018/019
**Files (NEW):** `pmo-portal/e2e/AC-AXP-018-drawer-resize.spec.ts`, `AC-AXP-019-drawer-dock.spec.ts`.
- **AC-AXP-018:** open the desktop panel, drag the left-edge handle to a new width; reload the page; assert the
  panel restores the chosen width (localStorage). `AC-AXP-018 …`.
- **AC-AXP-019:** toggle overlay→docked; assert `<main>` content reflows beside the panel (a known page element
  is not covered by the panel); reload; assert the docked mode persists. `AC-AXP-019 …`.
(Skip these if the owner defers Track D.)

**Verify:** `npx playwright test e2e/AC-AXP-018-drawer-resize.spec.ts e2e/AC-AXP-019-drawer-dock.spec.ts`.

### Task E3 — FULL verify + rendered Discover (binding pre-PR)
From `pmo-portal/`, in order:
1. `npm run verify` (= `typecheck && lint:ci && test && build`) — the WHOLE suite (a shared-file edit like
   `TranscriptItem.tsx`/`AssistantPanel.tsx` can break other renders — the recurring CI-verify-red trap).
2. From repo root: `supabase db reset && supabase test db` — all pgTAP still green (this issue adds NO migration
   and NO pgTAP; if red, a baseline drifted — do NOT add pgTAP here, escalate).
3. `npx playwright test` for the AC-AXP journeys + the existing `AC-AR-013`/`AC-CV-015` panel journeys (confirm
   no markdown/widget/context/drawer regression).
4. **Rendered Discover pass on a clean build** (`npm run build && npm run preview`): render (a) formatted
   assistant markdown incl. a pipe table, a fenced code block, a link (confirm `rel`/inert-`javascript:`), (b)
   a hostile-markdown string (confirm nothing executes — MEMORY: rendered-review-catches-what-tests-pass,
   stub tests are NOT the rendered pass — this is exactly what let an unstyled panel reach PR #209), (c) the
   coexisting typed `data_table` widget beside prose, (d) the resizable drawer + dock/overlay reflow, (e) the
   panel in dark + light. Route Discover findings to `ui-implementer`; re-render until clean.

**Only after all four are green** → the review battery (3-lens code review + security-auditor on the markdown
XSS boundary + rendered Discover + BDD) → PR to `dev`. **NEVER open the PR before the full battery is green
locally** (MEMORY: pr-after-review-battery). `main`/`production` promotes are owner-gated (do NOT self-promote).

---

## 4. Type/signature consistency (guard across tasks)

- **`buildAgentSystemPrompt(entities, rowCap, role?, opts?)`** — the `opts: { composeEnabled?: boolean;
  automationsEnabled?: boolean }` 4th arg is OPTIONAL (defaults `{}`) so every existing caller compiles (B2);
  the handler passes `{ composeEnabled: deps.composeEnabled, automationsEnabled: AUTOMATIONS_ENABLED }` at ALL
  THREE build sites (B3 :1001, C2 :1074, :1140). The three system strings share the same builder + the same
  `+ buildGroundingHint(req.context?.entity)` append (C2 makes :1074/:1140 match :1001).
- **`Markdown({ text: string })`** — the single markdown component (DEC-3); imported ONLY by `TranscriptItem`'s
  `assistant` case (A4). The `safeUrl`/`disallowedElements`/`components.a` config is the security contract
  (ADR-0049 §2) — no second markdown renderer, no `rehype-raw`, no `dangerouslySetInnerHTML` anywhere.
- **`setEntity({ type, id, label })`** — same `{type:string,id:string,label:string}` shape at all four callers
  (C3–C5), matching `AgentContextValue.setEntity` (`agentContextInternal.ts:18`) and `RunContext.entity`. Each
  caller clears on unmount (`return () => setEntity(undefined)`).
- **Drawer state** — `width: number` (clamped 320–720, D2) + `mode: 'overlay'|'docked'` (default `'overlay'`,
  D4), persisted at `localStorage['pmo.agentPanel.width']` / `['pmo.agentPanel.dock']` (DEC-6); the layout host
  and the panel read the SAME keys/shape.

## 5. Scaling / risk notes (Performance + Architecture + Existing-repo lenses)

- **Markdown parse is bounded + memoized (NFR-AXP-PERF-001):** one parse per assistant message, memoized by
  `memo` on the message text; no re-parse on unrelated transcript re-render; no network round-trip. Bundle cost
  (~40–60 KB gz) is behind the flag-gated panel — acceptable; flagged in ADR-0049.
- **Markdown = the app's ONLY markdown surface (Existing-repo lens):** if a second markdown need appears later,
  it MUST reuse `Markdown.tsx` (the configured safe renderer), never add a second dep or a `rehype-raw` variant.
  Reviewers guard this (ADR-0049 Consequences).
- **Prompt scales by adding a skill, not rewriting (Architecture lens, ADR-0050):** a future tool = one index
  line + one "Use when…" skill + a gate check; no monolith rewrite. Progressive disclosure keeps token cost
  bounded (NFR-AXP-PERF-002).
- **Context is zero-authorization-risk by construction (NFR-AXP-SEC-003):** `setEntity` publishes only
  `{type,id,label}`; the grounding hint changes prompt TEXT only; RLS + caller-JWT `deps.supabase` + `can()` are
  untouched, so a forged `entity.id` is a nuisance (a wasted zero-row read), never a breach (ADR-0036 §2). The
  reviewer-guarded invariant: C2's edit APPENDS to a string, nothing else.
- **§2.3 behavior is model-dependent — the primary risk (NFR-AXP-QUAL-001):** prompt steering (Track B) is
  necessary but may not be sufficient for AC-AXP-011..014 to pass against the LIVE weak tool-selector
  (deepseek-v4-flash). The e2e (E1) proves the RENDER path deterministically on a scripted turn; the REAL-model
  reliability is NOT closed by this issue. **The eval harness (mining Tier-2 #10) and the model bump are
  DEFERRED to separate issues per owner decision** — see §7 Q1/Q2. Do NOT build them here.
- **`org_id` seam / tenancy:** untouched. No table, no RLS policy, no migration. The deputy runs as the caller
  JWT with RLS as the ceiling, before and after this issue (OBS-AXP-003).

## 6. Sequencing summary (partial-ship seams)

1. **A ‖ B** (parallel worktrees) — markdown rendering + prompt/skills. Either can ship first; both are
   high-value and independent (FE vs edge-fn). Serialize the `TranscriptItem.tsx` edit (A4) vs any Track-D
   `AssistantPanel` work only if the same worktree.
2. **C** — after B's `handler.ts` build-site edits land (C2 shares :1074/:1140 with B3). FE `setEntity` callers
   (C3–C5) are independent and can land alongside.
3. **D** — last; **separately acceptable** (DEC-7). If deferred, A+B+C ship without it (skip E2).
4. **E** — final e2e + full gate; E1 depends on Track B (steering) + Track C (AC-AXP-016 grounding).

Minimum shippable increment: **Track A alone** (markdown) OR **Track B alone** (prompt) each independently
improve the panel and can be a standalone PR if the owner wants to split — though one cohesive PR (A+B+C) is
recommended for the experience-layer story; D as a follow-up PR.

## 7. Open questions for the Director

1. **Eval harness — build now or defer? (NFR-AXP-QUAL-001, ADR-0050 §4).** Owner decision baked in: **DEFERRED
   to a separate issue** (not built here). Confirming the plan does NOT include the `*.eval.ts` harness — the
   §2.3 ACs are covered at E2E on scripted turns only; real-model reliability is measured in the eval issue.
   **Confirm defer.**
2. **Model bump — defer pending eval data? (NFR-AXP-QUAL-001).** Owner decision baked in: **DEFERRED pending
   eval data.** This issue ships prompt steering and measures nothing about the live model's tool-selection
   reliability. Risk: AC-AXP-011..013 may be flaky against the live model post-ship (the e2e is scripted, so CI
   stays green, but PROD behavior may still under-surface). **Confirm the risk is accepted for this issue.**
3. **E2E model determinism (Task E1).** The surfacing journeys need the `agent-chat` SSE scripted/stubbed
   (reuse the `AC-AR-013`/`AC-CV-015` `page.route` approach) so behavior ACs are deterministic. **Confirm the
   existing e2e harness stubs the edge fn** (if it calls a live model, E1 must gate on a seeded deterministic
   model). This is a mechanical confirm, not a scope change.
4. **ProcurementDetails + ContactDetail label fields (Track C).** C5/C4 publish the entity `label` from the
   resolved record's human name (case title/ref; contact full name). If those pages resolve the record via a
   hook whose label field is non-obvious, the implementer greps the component — no scope change, flagged so the
   reviewer confirms the right field is published (a wrong label is a grounding-quality nit, never a security
   issue).
5. **Drawer default (Track D).** Baked in: overlay default, bounds 320–720px. Confirm if the owner wants a
   different default width (currently 400, matching today's fixed width) or bounds.
