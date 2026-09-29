# BlockNote meeting-editor prototype (#467)

## Environment and boundary

- Branch: `spike/467-blocknote`.
- Verification environment: Node `v22.23.1` / npm `10.9.8`, satisfying the repository's Node >=22.22.0 requirement. An earlier exploratory run used v22.20.0; the final scoped verification and bundle measurements below were rerun under v22.23.1.
- Temporary packages: `@blocknote/core@0.54.0`, `@blocknote/react@0.54.0`, `@blocknote/shadcn@0.54.0`; all are MPL-2.0. They were installed with `npm install --no-save --package-lock=false`. Neither `package.json` nor `package-lock.json` changed.
- Reproduce from `pmo-portal/`: `npm install --no-save --package-lock=false @blocknote/core@0.54.0 @blocknote/react@0.54.0 @blocknote/shadcn@0.54.0 && npm run dev` and open `/spike/blocknote` after the normal demo login.
- Route is lazy, authenticated-shell-only, absent from the rail and command palette, and not a nav/module entry. There is no database, persistence, repository, mutation, localStorage, or real meeting/task schema.

## Design-system fit

The editor is scoped under `.blocknote-spike`. The shadcn stylesheet is imported once and the Tailwind scanner receives `@source "./node_modules/@blocknote/shadcn/dist"`.

Overridden variables: `--bn-colors-editor-text`, `--bn-colors-editor-background`, `--bn-colors-menu-background`, `--bn-colors-menu-text`, `--bn-colors-hovered-background`, `--bn-colors-selected-background`, `--bn-colors-side-menu`, `--bn-colors-border`, `--bn-font-family`, `--bn-border-radius`, and `--bn-shadow-medium`. Scoped selectors cover `.bn-container`, `.bn-editor`, `.bn-block-content`, `.bn-side-menu`, `.bn-suggestion-menu`, `.bn-suggestion-menu-item`, `.bn-formatting-toolbar`, and focus-visible states. The action block adds `.blocknote-action-item`, title, metadata fields, and native controls.

Observed fit in the browser accessibility snapshot: the editor and inspector read as two calm, bordered surfaces, action-item metadata is legible and keyboard-addressable, and the native date control exposes labelled day/month/year controls. Inter and the 14px/12px body/label hierarchy fit without importing BlockNote's Inter font. Borders, 8px outer/6px nested radii, 32px controls, 4px spacing rhythm, and the PMO `--ring` focus treatment are token-derived. The dark theme is passed directly to `BlockNoteView` and the overrides use app HSL variables, so the same surfaces follow the shell theme toggle.

The remaining friction is BlockNote's internal selection/drag behavior and the native date picker/rich-text palette: those internals are not cleanly replaceable through the shadcn surface API without forking deeper components. The Tailwind `@source` seam adds no material global CSS; the candidate CSS gzip increase is primarily the lazy BlockNote/shadcn chunk and scoped stylesheet, not an app-wide selector change.

## Live slash interaction

The default corpus remains present because `getDefaultReactSlashMenuItems(editor)` is combined with the custom `Action item` item and filtered with `filterSuggestionItems`. `slashMenu={false}` is required so the one custom `SuggestionMenuController` owns the menu. The custom item has aliases `action`, `task`, and `todo`, and inserts a real `actionItem` block.

Desktop keyboard exercise: focus the editor, type three short lines quickly, type `/hea`, use arrows and Enter to insert a heading, continue typing, then repeat with blank `/` and Escape. The `/hea` menu appeared during the next 300ms observation poll; focus stayed in the editor, the typed characters remained in the document, and Enter returned to the editing flow. Blank `/` opened the default corpus and Escape dismissed it without navigating away. The browser snapshot confirmed the editor is a textbox and the action-item select is a labelled combobox. The menu is a floating interruption while open, but arrow/Enter selection preserves the editor path rather than moving the user into a separate page. No intentional debounce was added, and the fast-entry exercise did not show character loss. The existing shell captures `Cmd/Ctrl+K` while the editor is focused, so the shell command palette wins over BlockNote's link shortcut. That shared behavior was intentionally not changed.

A real touch keyboard/device was **not verified** in this environment. Desktop responsive emulation is covered by the CSS breakpoint, but that is not evidence for virtual-keyboard behavior.

## Typed block cost and serialization

The marked custom-block region is **45 LOC** (`awk` range count). The page is 159 LOC and the scoped stylesheet is 65 LOC. The main API friction was the multi-package seam: define a `createReactBlockSpec`, add it to `BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, actionItem: ActionItem() } })`, then replace the stock slash controller with a controller whose async `getItems` recomposes the stock items plus the custom command. Prop changes must go through `editor.updateBlock`; title text remains BlockNote inline content. Assignee is only an opaque local string (`''`, `member-a`, or `member-b`) and due date is a primitive ISO calendar string.

This is the actual initial JSON visible in the inspector (IDs are generated by BlockNote):

```json
[
  {
    "id": "ce5593a2-e3af-4fdf-ac6e-6421d97b3678",
    "type": "heading",
    "props": { "backgroundColor": "default", "textColor": "default", "textAlignment": "left", "level": 1, "isToggleable": false },
    "content": [{ "type": "text", "text": "Meeting notes, without the ceremony", "styles": {} }],
    "children": []
  },
  {
    "id": "5f8c3360-0753-4cab-bbe4-50b58d00372d",
    "type": "paragraph",
    "props": { "backgroundColor": "default", "textColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "Type / to explore blocks. Try /action to add a structured follow-up.", "styles": {} }],
    "children": []
  },
  {
    "id": "b6d21a50-fc69-43ba-905e-15d366e08631",
    "type": "actionItem",
    "props": { "assignee": "", "dueDate": "2026-09-18" },
    "content": [{ "type": "text", "text": "Confirm the next project checkpoint", "styles": {} }],
    "children": []
  }
]
```

This proves a typed block can carry row-shaped primitive props, not that a future action-item row can synchronize deletion, reassignment, external edits, or lifecycle status with a document block.

## Bundle measurement

Build command for both measurements: `CF_PAGES_COMMIT_SHA=0000000000000000000000000000000000000000 npm run build` under Node `v22.23.1`. These are gzip-9 emitted JS+CSS asset bytes, not simulated network transfer. Baseline was captured before temporary packages; candidate after the prototype.

| Asset class | Baseline gzip | Candidate gzip | Delta | Percent |
|---|---:|---:|---:|---:|
| JS | 924,104 | 1,329,435 | +405,331 | +43.86% |
| CSS | 16,019 | 27,640 | +11,621 | +72.55% |
| All JS + CSS | 940,123 | 1,357,075 | +416,952 | +44.35% |

The candidate emitted a `BlockNoteSpike` JS chunk of approximately 300.75 kB gzip and a `BlockNoteSpike` CSS chunk of approximately 7.70 kB gzip. The totals above are sums of every emitted `.js` and `.css` row. The per-asset audit was written to `/tmp` during the run and is **not retained** — the table above is the durable record, and the two figures that matter are reproduced here rather than referenced:

| | gzip |
|---|---:|
| `BlockNoteSpike` JS chunk | ~300.75 kB |
| `BlockNoteSpike` CSS chunk | ~7.70 kB |

To re-measure: build on `dev`, then build with the spike branch checked out and `@blocknote/*` installed `--no-save`, summing gzip-9 bytes of every emitted `.js`/`.css`. Lazy routing defers this cost until `/spike/blocknote` is visited, but production adoption still needs a reviewed dependency and PWA budget decision.

## Mobile

The layout collapses at 720px; at 375px the two panels stack, headings wrap, metadata controls become full-width, and only the JSON code panel is intentionally horizontally scrollable. Grid/flex children have `min-width: 0`; the editor surface and action item do not intentionally extend beyond the viewport in desktop responsive inspection. A physical touch keyboard and slash selection were not verified.

## Decision impact for #463

BlockNote is acceptable as a meeting-notes prototype and is technically capable of belonging to this design system with a modest scoped CSS seam. For v1, constrain typed blocks to action items first: the primitive JSON shape is understandable, while the custom renderer and slash composition are a meaningful but bounded cost. Before production adoption, design and test the row↔block synchronization contract explicitly (delete/archive, external assignee/date edits, duplicate/paste, undo/history, and offline conflict behavior); this spike proves none of those.

The +416,952-byte (+44.35%) all-asset gzip delta is the gating concern for an installable PWA. Keep BlockNote lazy, require a production lockfile/license review, and set a concrete route-chunk/PWA budget before adopting it in the meeting module. A real touch-device test and a decision on whether the shell should reserve Cmd/Ctrl+K for the editor are also required before settling #463.

## Verification

Under Node `v22.23.1`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. `git diff --exit-code -- package.json package-lock.json` passed. No tests were added, per the throwaway-spike brief; `npm run verify` was intentionally not run.


## Director pixel pass (2026-08-19) — two findings the review missed

The ADW's `fe_reviewer` audits the rendered **accessibility tree**; it does not judge pixels. Per
`docs/factory-workflow.md` § Executor routing the Director's look at the screenshots is the exit gate,
and it found two things the a11y tree could not express.

**1. Heading scale is BlockNote's, not ours — and the report overstates the fit.**
The report says the "14px/12px body/label hierarchy fit without importing BlockNote's Inter font."
That is true for **body and labels** and false for **headings**. At desktop width the H1 dominates the
editor panel and wraps to two lines; at 375px it consumes three lines and roughly a third of the first
viewport before any content. The overridden token list covers colors, font-family, radius and shadow —
**no heading size or line-height variable is overridden**, so H1/H2/H3 inherit BlockNote's own scale.
For a meeting-notes surface whose whole job is dense capture, that is a real cost, not cosmetic.
*Fixable within the same scoped-CSS seam* — it is an omission, not a limitation.

**2. Horizontal text clipping at 375px, in the paragraph the mobile section declares clean.**
The intro paragraph renders as `Type / to explore blocks. Try /action to add a str` — clipped at the
right edge — with the remainder appearing on the next line as `ZZuctured follow-up.` The word
`structured` is broken and partially duplicated across the wrap.

This contradicts the Mobile section's claim that "the editor surface and action item do not
intentionally extend beyond the viewport". ⚑ It is also precisely the class the repo already guards at
e2e (`AC-MOBILE-OVERFLOW-001-no-horizontal-bleed`) — which did not run here, because a spike does not
run the suite. **Anything BlockNote-shaped that reaches production must pass that gate.**

### What these two change for #463

Neither reverses the adoption. Both sharpen the estimate: the scoped-CSS seam is **larger than "a
modest seam"** once headings are included, and BlockNote's text layout needs an explicit mobile-overflow
proof rather than an assumption. Add both to the meeting-module plan before it is sized.
