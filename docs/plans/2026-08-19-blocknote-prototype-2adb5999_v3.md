# Issue #467 — BlockNote meeting-editor prototype plan

**Mode:** throwaway, local-only prototype on `spike/467-blocknote`. Do not commit, push, open a PR, add a nav entry, add a database migration/repository, or change any real meeting/task schema (none exists). This plan deliberately has **no automated tests**: #467 explicitly waives TDD/test-suite work for the spike. `npm run verify` is out of scope.

## Preconditions and boundaries

- The route remains inside the existing authenticated shell, so it is reachable only after the normal app sign-in at `/spike/blocknote`; it must not appear in the rail or command palette.
- The worktree currently reports Node `v22.20.0`, below the required `>=22.22.0`. Activate a compliant Node before installing or building; do not proceed under v22.20.0.
- Install BlockNote only into the local worktree's ignored `node_modules`. Do not save dependencies or modify `pmo-portal/package.json` / `pmo-portal/package-lock.json`. The prototype will therefore be reproducible only while those temporary packages remain installed; the report must say that a production adoption needs a separately reviewed, lockfile-changing dependency decision.
- Use `@blocknote/core@0.54.0`, `@blocknote/react@0.54.0`, and `@blocknote/shadcn@0.54.0`. The shadcn package is React-19-compatible and maps its utility classes to the app's existing semantic token names, avoiding a Mantine theme/provider for this experiment. All three are MPL-2.0; record that fact for the later adoption decision, without treating this uncommitted spike as adoption.
- There is no #467 spec with `AC-###` identifiers. Traceability below uses the six explicit prompt deliverables (`D1`–`D6`) rather than inventing ACs.

## Design

### Route and data flow

`App.tsx` lazy-loads one unlisted route, `/spike/blocknote`, before the existing wildcard route. The existing `RequireAuth` → `RequireInviteAccepted` → `Shell` remains untouched, so the page is rendered with the app rail, header, token CSS, dark-theme toggle, and normal responsive shell. Add only `PLACEHOLDER_TITLES['/spike/blocknote'] = 'BlockNote spike'` in `src/components/shell/routeMatch.ts` so the authenticated shell's breadcrumb is accurate without making the route navigable. Do not change the rail/module/palette registries.

`pages/BlockNoteSpike.tsx` owns a single in-memory `BlockNoteEditor` and an in-memory `document` snapshot. `BlockNoteView.onChange` copies `editor.document` into React state; the adjacent `<pre>` renders `JSON.stringify(document, null, 2)`. Reloading resets the seeded document. There is no fetch, mutation, cache, localStorage, repository, auth-policy change, or database path.

The custom block is a real schema entry, not a styled paragraph:

- Build `ActionItem` with `createReactBlockSpec({ type: 'actionItem', content: 'inline', propSchema: { assignee: { default: '' }, dueDate: { default: '' } } }, …)`, then register the factory result as `actionItem: ActionItem()`. Both values are primitive strings: `assignee` is an opaque future user ID (never a user object) and `dueDate` is an ISO calendar date.
- Its renderer has a `contentRef` editable title plus `contentEditable={false}` assignee select with exactly `Unassigned` (`''`), `Member A` (`'member-a'`), and `Member B` (`'member-b'`) local-only options and a native `type="date"` input. Each metadata control calls `editor.updateBlock(block, { props: { assignee | dueDate: nextValue } })`; title text stays BlockNote inline content.
- Seed one action item with generic, non-personal test content so the visitor can edit both its title and structured props. Replace the built-in slash controller with one `SuggestionMenuController` that filters `[...getDefaultReactSlashMenuItems(editor), actionItemMenuItem]`: pass `slashMenu={false}` to `BlockNoteView`, then render the controller as its child. `actionItemMenuItem` has title `Action item`, aliases `action`, `task`, and `todo`, and calls `insertOrUpdateBlockForSlashMenu(editor, { type: 'actionItem', props: { assignee: '', dueDate: '' } })`. This keeps every default slash command working while measuring the additional custom-block insertion seam.

The page is a two-column desktop review surface (editor first, JSON second), collapsing to one column at 375px. Use `PageHeader` and existing token utilities for the page chrome. Import `useTheme` and pass its `light | dark` value to `BlockNoteView`, so the editor follows the existing header toggle.

### Styling seam to evaluate

`@blocknote/shadcn/style.css` scopes BlockNote's base rules under `.bn-shadcn` / `.bn-root`, but its distributed component classes must be discovered by Tailwind. Add the one scanner directive `@source "./node_modules/@blocknote/shadcn/dist";` to `pmo-portal/index.css`; it only emits utilities used by the package and does not attach styling to other pages.

Keep all runtime overrides in `pages/BlockNoteSpike.css`, rooted at `.blocknote-spike`. Map BlockNote variables separately for light and `.dark`: editor/menu text and surfaces, hover/selected states, borders, side-menu gray, font family, 8px radius, and low single-layer overlay shadow. Override the editor padding/paragraph density, action-item container, metadata inputs, selected block treatment, focus-within/focus-visible ring, toolbar, and slash-menu popover/rows to the `DESIGN.md` spacing/type/radius/semantic variables. The custom action item uses a quiet bordered surface and neutral labels; it does not consume a second blue action. Do not use stock raw gray/blue values as the final visible chrome.

The report must distinguish these scoped overrides from any residual hard-coded BlockNote styles that cannot be changed cleanly (for example rich-text palette and internal selection/drag behavior); that friction is evidence, not a reason to edit the global design system.

## Implementation tasks

### Task 1 — Establish a reproducible, dependency-free baseline (D4)

1. From the repository root, confirm the branch and clean tracked dependency manifests:
   ```bash
   test "$(git branch --show-current)" = "spike/467-blocknote"
   node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 22) ? 0 : 1)"
   git diff --exit-code -- pmo-portal/package.json pmo-portal/package-lock.json
   ```
   If the Node command fails (it currently will on v22.20.0), stop and activate Node 22.22+ before continuing.
2. In `pmo-portal/`, run `npm ci` (never `npm install` for the baseline), then `CF_PAGES_COMMIT_SHA=0000000000000000000000000000000000000000 npm run build` so injected build metadata cannot distort the baseline/candidate byte delta.
3. Save a deterministic baseline gzip table outside the repository, covering every emitted JS and CSS asset:
   ```bash
   rm -f /tmp/pmo-467-blocknote-baseline.tsv
   find dist/assets -type f \( -name '*.js' -o -name '*.css' \) -print | LC_ALL=C sort | while IFS= read -r file; do
     printf '%s\t%s\n' "$(gzip -9c "$file" | wc -c | tr -d ' ')" "${file#dist/}"
   done > /tmp/pmo-467-blocknote-baseline.tsv
   awk -F '\t' '{sum += $1} END {print sum}' /tmp/pmo-467-blocknote-baseline.tsv
   ```
4. Verify: `test -s /tmp/pmo-467-blocknote-baseline.tsv && git diff --exit-code -- pmo-portal/package.json pmo-portal/package-lock.json`.

### Task 2 — Add temporary BlockNote packages without changing tracked manifests (D4)

1. From `pmo-portal/`, install the pinned packages only in the local worktree:
   ```bash
   npm install --no-save --package-lock=false @blocknote/core@0.54.0 @blocknote/react@0.54.0 @blocknote/shadcn@0.54.0
   ```
2. Confirm the resolved packages and that neither manifest changed:
   ```bash
   npm ls @blocknote/core @blocknote/react @blocknote/shadcn tailwindcss --depth=0
   git diff --exit-code -- package.json package-lock.json
   ```
3. Do not run a lockfile regeneration command. If npm cannot satisfy the package peer dependencies without editing a manifest/lockfile, stop and record that exact failure in the spike report rather than bypassing it or changing the lock.

### Task 3 — Define the real action-item BlockNote schema and local JSON inspector (D1, D3)

1. Create `pmo-portal/pages/BlockNoteSpike.tsx`. Put visibly delimited `// action-item block start` and `// action-item block end` comments around the schema and renderer so its later line count is exact.
2. Import `BlockNoteSchema` and `defaultBlockSpecs` from `@blocknote/core`; import `filterSuggestionItems` and `insertOrUpdateBlockForSlashMenu` from `@blocknote/core/extensions`; import `createReactBlockSpec`, `getDefaultReactSlashMenuItems`, `SuggestionMenuController`, and `useCreateBlockNote` from `@blocknote/react`; import `BlockNoteView` from `@blocknote/shadcn`; import `useTheme` from `@/src/hooks/useTheme`; and import `PageHeader` from `@/src/components/ui`.
3. Define the `ActionItem` factory as the inline-content custom block described in the Design section. Use two labelled controls, `Assignee` and `Due date`, and a title content area with `ref={contentRef}`. Metadata controls must be `contentEditable={false}` and update only the matching primitive custom prop with `editor.updateBlock`; they must not be React-only state.
4. Create `BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, actionItem: ActionItem() } })`, seed a short generic meeting-note document containing a heading, a plain paragraph that invites the visitor to type `/`, and one `actionItem` with a title, `assignee: ''`, and a non-personal ISO due date.
5. Define `getItems(query)` with `filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), actionItemMenuItem], query)`. Define `actionItemMenuItem` with `title: 'Action item'`, `subtext: 'Add an owner and due date'`, aliases `['action', 'task', 'todo']`, group `Basic blocks`, and `onItemClick` calling `insertOrUpdateBlockForSlashMenu` with `{ type: 'actionItem', props: { assignee: '', dueDate: '' } }`.
6. Render `BlockNoteView` with this schema/editor, `theme={theme}`, `slashMenu={false}`, and `onChange={() => setDocument(editor.document)}`; render `<SuggestionMenuController triggerCharacter="/" getItems={getItems} />` as its child. This preserves the default slash corpus and adds the custom typed action item. Render the current document alongside it in a labelled, horizontally scrollable `<pre>` using `JSON.stringify(document, null, 2)`; it is the only persistence/serialization demonstration.
6. Verify compilation only (no test suite for this waived spike):
   ```bash
   npm run typecheck
   ```

### Task 4 — Apply the app tokens to the editor without changing global product behavior (D1, D5)

1. Create `pmo-portal/pages/BlockNoteSpike.css`; in `BlockNoteSpike.tsx`, import `@blocknote/shadcn/style.css` exactly once and then import this new stylesheet. Do not separately import BlockNote core/react styles, and do not import `@blocknote/core/fonts/inter.css` because the app already self-hosts Inter.
2. Scope every override beneath `.blocknote-spike`: map the BlockNote `--bn-colors-*`, `--bn-font-family`, `--bn-border*`, and shadow variables to the existing `hsl(var(--…))` tokens for both light and `.dark`; use the app's `--radius` and `--ds-ease` values.
3. Style the editor card, toolbar, slash-menu popover and row focus/hover states, side controls, selected action item, title area, metadata controls, and JSON panel with the exact `DESIGN.md` 14px body / 12px label, 4px spacing scale, 32px field height, 8px outer/6px nested radius, border-first, and `--ring` focus rules. Add `min-width: 0` to all grid/flex children and `overflow-x: auto` only to the JSON code panel.
4. In `pmo-portal/index.css`, immediately after `@import "tailwindcss";`, add exactly `@source "./node_modules/@blocknote/shadcn/dist";` so Tailwind emits the shadcn package utilities. Do not change any existing token values or selectors.
5. Verify with:
   ```bash
   npm run typecheck && npm run lint && npm run build
   ```

### Task 5 — Wire the hidden lazy route through the existing shell (D1)

1. In `pmo-portal/App.tsx`, add a `React.lazy(() => import('./pages/BlockNoteSpike'))` declaration with the other lazy page chunks.
2. Add `{ path: '/spike/blocknote', element: <BlockNoteSpike /> }` to `appRouteConfig` before `{ path: '*', … }`.
3. In `pmo-portal/src/components/shell/routeMatch.ts`, add exactly `'/spike/blocknote': 'BlockNote spike'` to `PLACEHOLDER_TITLES`. This supplies only the existing breadcrumb label seam; it must not add a module, rail item, command-palette item, feature flag, public route, analytics classification, or data hook.
4. Verify the final production compilation and dependency boundary:
   ```bash
   npm run typecheck && npm run lint && npm run build
   git diff --check
   git diff --exit-code -- package.json package-lock.json
   ```

### Task 6 — Run the live-note and responsive evaluation; capture reproducible evidence (D1, D2, D3, D5)

1. Start the local app from `pmo-portal/` with `npm run dev -- --host 0.0.0.0`, sign in normally, and open `/spike/blocknote`. Confirm the breadcrumb says `BlockNote spike` while the route is absent from rail navigation and command palette.
2. In light and dark themes, record the exact CSS selectors/variables overridden and any residual stock behavior. Exercise keyboard-only flow: focus the editor, type a short three-line note quickly, type `/hea`, use arrows and Enter to insert a default heading, then continue typing; repeat with a blank-query `/` and Escape. Record menu-open latency as observed (do not invent milliseconds), focus continuity, whether typed characters are lost, and whether menu navigation interrupts note flow. Also press `⌘/Ctrl+K` while the editor is focused and record that the existing shell command palette intercepts the editor's customary Mod-K link shortcut; do not change this shared shell behavior for the spike.
3. Edit the seeded action item title, assignee, and due date. Copy the actual JSON currently visible in the UI, including the emitted action-item object, into the report; do not substitute an illustrative JSON sample. Count the exact custom-block LOC with:
   ```bash
   awk '/^\/\/ action-item block start/,/^\/\/ action-item block end/' pages/BlockNoteSpike.tsx | wc -l
   ```
   Also record `wc -l pages/BlockNoteSpike.tsx pages/BlockNoteSpike.css` and the concrete API seams encountered.
4. At a 375px-wide Chrome responsive viewport, check the page, editor, JSON panel, action-item metadata fields, formatting toolbar, and slash popover. Inspect the document for an element extending past the viewport (the app shell's clipping is not proof of no overflow). Separately use a real touch device with a 375 CSS-pixel viewport and its virtual keyboard to type `/`, choose a slash item, and continue typing. Record device/browser and result. If no real touch keyboard is available, report that question as **not verified**, not inferred from desktop emulation.
5. Verify manually: the default slash menu is interactive, action-item metadata updates the on-screen JSON, theme toggle restyles the editor, and no horizontal element edge exceeds 375px except the intentionally scrollable JSON code panel.

### Task 7 — Measure candidate bundle and write the decision-quality spike report (D1–D6)

1. With the completed prototype installed, run `CF_PAGES_COMMIT_SHA=0000000000000000000000000000000000000000 npm run build` from `pmo-portal/`, then create the matching candidate table:
   ```bash
   rm -f /tmp/pmo-467-blocknote-candidate.tsv
   find dist/assets -type f \( -name '*.js' -o -name '*.css' \) -print | LC_ALL=C sort | while IFS= read -r file; do
     printf '%s\t%s\n' "$(gzip -9c "$file" | wc -c | tr -d ' ')" "${file#dist/}"
   done > /tmp/pmo-467-blocknote-candidate.tsv
   awk -F '\t' '{sum += $1} END {print "candidate all assets gzip bytes=" sum}' /tmp/pmo-467-blocknote-candidate.tsv
   awk -F '\t' '{sum += $1} END {print "baseline all assets gzip bytes=" sum}' /tmp/pmo-467-blocknote-baseline.tsv
   for table in /tmp/pmo-467-blocknote-baseline.tsv /tmp/pmo-467-blocknote-candidate.tsv; do
     label=$(basename "$table" .tsv)
     awk -F '\t' -v label="$label" '$2 ~ /\.js$/ {sum += $1} END {print label " JS gzip bytes=" sum}' "$table"
     awk -F '\t' -v label="$label" '$2 ~ /\.css$/ {sum += $1} END {print label " CSS gzip bytes=" sum}' "$table"
   done
   ```
2. Use the emitted totals to calculate and report `candidate - baseline` and `(candidate - baseline) / baseline * 100` for all JS+CSS assets and for JS alone. Report baseline bytes, candidate bytes, signed byte delta, and percent delta; include both TSV tables (or their per-file rows) so every total is auditable. Describe it as a gzip build-asset delta, not a simulated network transfer; note that lazy routing defers the BlockNote code until `/spike/blocknote` is visited.
3. Create `docs/spikes/2026-08-19-blocknote-prototype.md`. It is a report of observed facts, not a plan. Include:
   - environment (branch, Node/npm versions, exact temporary package versions, MPL-2.0 license), route, no-persistence boundary, and reproduction command;
   - **Design-system fit:** light/dark results; exact BlockNote variables/selectors overridden; spacing, typography, focus, popover, and dark-mode outcomes; what could not be cleanly overridden; whether the Tailwind `@source` seam caused material CSS/bundle cost;
   - **Live slash interaction:** the exact keyboard protocol/result, flow interruption or lack of it, fast-typing outcome, the existing `⌘/Ctrl+K` shell-shortcut collision, and the mobile touch-keyboard result or explicit non-verification;
   - **Typed block:** exact schema/renderer LOC count, all API friction (including the custom slash-controller composition), and the actual copied action-item JSON; state plainly that assignee is only an opaque local string in this spike, the document is in memory, and neither proves lifecycle synchronization with a future action-item row;
   - **Bundle:** exact gzip baseline/candidate/delta/percent, JS-versus-CSS split, and lazy-load qualification;
   - **Mobile:** 375px observations, overflow result, editor/popover/metadata behavior, and device details;
   - **Decision impact for #463:** a direct recommendation on whether BlockNote is acceptable for meeting notes, whether v1 should constrain typed blocks to action items first, the remaining unproven row↔block deletion/external-edit synchronization design, and any design-system or PWA/bundle threshold that should gate production adoption.
4. Finish with only scoped checks, preserving the spike exception:
   ```bash
   npm run typecheck && npm run lint && npm run build
   git diff --check
   git diff --exit-code -- package.json package-lock.json
   git status --short
   ```
   Do not run `npm run verify`, do not write tests, and do not push/open a PR. The final status may contain only this throwaway prototype, its scoped CSS/route/breadcrumb changes, the spike report, and this already-created planning document; `node_modules` remains ignored.

## Traceability

| Prompt deliverable | Owning task(s) | Evidence |
|---|---|---|
| D1 — clickable BlockNote route, default slash menu, typed action item, token fit | 3–6 | running authenticated `/spike/blocknote`, manual editor exercise, scoped token CSS |
| D2 — live-meeting slash interaction | 6–7 | documented keyboard-only fast-entry protocol and observed result |
| D3 — custom typed-block cost and serialization | 3, 6–7 | marked LOC count, API-friction log, actual on-screen JSON |
| D4 — installable-PWA bundle cost | 1–2, 7 | before/after gzipped asset tables and delta |
| D5 — mobile at 375px | 4, 6–7 | responsive overflow inspection plus real touch-keyboard result/non-verification |
| D6 — impact on #463 decisions | 7 | explicit decision-impact section with unresolved row-sync boundary |

## No ADR

Do not create an ADR. This prototype makes no production dependency, schema, persistence, or architecture decision; `docs/spikes/2026-08-19-blocknote-prototype.md` supplies the evidence needed for #463 to make those decisions later.
