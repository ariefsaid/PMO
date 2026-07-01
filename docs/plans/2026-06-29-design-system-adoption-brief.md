# Design-System Adoption + Full Reskin — Locked Brief (2026-06-29)

> ⚠️ **SUPERSEDED IN PART (2026-07-01) by ADR-0037 + `docs/design-mockups/redesign/reskin/`.** The
> exploration ran diverge→converge→**reskin** and the owner locked a **monochrome-calm** language:
> the **accent/font/theme flipped** vs this brief — near-**monochrome** chrome (blue only for the one
> primary action), **Inter+cv** (not Plus Jakarta/DM Sans), status-as-dot, dark first-class. What still
> holds from below: the **hybrid IA** (records-workspace + two-pane triage + board toggle), the
> **big-bang-branch** ship strategy, **light+dark+AA** discipline, **reskin-IN-PLACE** porting, and the
> **coding-standards / codemod track (still open, separate)**. Read ADR-0037 + the reskin port plan first.

Owner-approved program brief. The redesign workflow agents consume these as **fixed inputs**
(decisions are front-loaded — agents do not re-litigate them). Source of the grill: owner Q&A,
2026-06-29.

## 0. Hard de-reference rule (binding on EVERY artifact)
The design system is adopted as **PMO Portal's OWN**. **NO external/brand/product name** may appear
in any artifact — docs, code, comments, commit messages, PR titles, file names, CSS class names, or
token names. Port **values and structure only**; rename everything to PMO's own vocabulary. The
reference kit being ported lives at `/Users/ariefsaid/Coding/gordi-mos/docs/reference/mos-design-kit/`
and `…/DESIGN.md` + `…/docs/reference/engineering-conventions.md` — read them **read-only** for the
token values, type/spacing/elevation scales, dark theme, IA patterns, and convention rules, then
re-express them as PMO's own. (That reference repo itself de-referenced an upstream AGPL source; do
not reintroduce any of that provenance.)

## 1. What we adopt
**Design (full visual reskin + IA overhaul):**
- **Token structure:** a `--ds-*` token layer (aliases → semantic), replacing PMO's current flat
  shadcn HSL vars, with a **light + dark** theme pair. Full **light + dark parity from the start**.
- **Accent: KEEP PMO's blue primary** `hsl(221.2 83.2% 53.3%)` and PMO's AA-tuned semantic tokens
  (warning/success/destructive/icon variants from PMO's current `DESIGN.md`). Adopt the kit's
  **neutrals, surfaces, type scale + weights, spacing scale, radii, elevation/shadow, and scoped
  gradients**. Net: PMO keeps its brand hue; everything else becomes the new system.
- **Fonts:** Plus Jakarta Sans (display/headings) + DM Sans (body). Replace Inter.
- **Shell IA:** evolve the EXISTING `src/components/shell/` (`AppShell`, `Rail`, `CommandPalette`,
  `Breadcrumb`, `ContextBar`) into the records-workspace pattern — **rail** (workspace switcher + nav +
  settings/identity) + **top bar** (⌘K search · breadcrumb · notification-bell stub · user chip), per
  the kit's `guidelines/ia-patterns.md`. Reuse PMO's components; do not rebuild from zero.
- **Records-workspace surfaces:** dense, calm tables (soft-tag status, light headers); hybrid record
  page (two-column details + tabbed feed); status **pills at full radius (999px)**; resting shadow on
  cards/KPI/kanban only (toolbars/tables stay flat).

**Coding standards (adopt `engineering-conventions` as PMO's own `docs/reference/engineering-conventions.md`):**
- Named exports only · `@/` alias (no `../` parent imports) · kebab-case filenames · `type` over
  `interface` (except third-party extend) · string-union over `enum` · no `any` · no `React.FC` ·
  short `//` comments (no JSDoc blocks) · component < ~300 / module < ~500 lines · no hardcoded colors
  (tokens only) · event-handlers-over-effects · small SR functions · behavior-first tests (role/label/text).
- **Author PMO's own ESLint + Stylelint config** enforcing the lint-able subset (`no-restricted-imports`
  `../*`, color-literal bans, `import/no-default-export` on `src`+`pages`, inline-type-imports,
  no-console, no-duplicate-imports).

## 2. Current PMO state (the gap to close)
- Default exports: **32** · `../` parent imports: **265** (alias configured, unenforced) · PascalCase
  component files: **108** (no kebab) · Stylelint: **absent** · effectively **light-only** (6 `dark:`).
- Shell already exists (rail + palette + breadcrumb). DESIGN.md exists (shadcn HSL, Inter, "calm/dense").
- ~22 routes / ~13 surfaces. Gates: `npm run verify` + tiered CI; render-before-ship; dev→main, never prod.

## 3. Sequencing (big-bang redesign branch `redesign/design-system`, off `dev`)
0. **Mockup round (THIS workflow) → owner sign-off GATE.** Static HTML mockups of the new look on the
   representative surfaces below, in light + dark. No app code yet.
1. **Foundation:** port token layer (light+dark, PMO-blue accent) + fonts; rewrite `DESIGN.md` to the
   new system; author `engineering-conventions.md` + ESLint/Stylelint config (warn→error); write the
   adoption ADR. 
2. **Structural codemods** (sequenced on clean branch, each gated): named-exports → `@/`-alias enforce →
   kebab-case rename.
3. **Shell IA:** rail + top-bar records-workspace.
4. **Surface reskin (pipelined):** each surface → new tokens + primitives + **light+dark** + all states +
   a11y (axe) + visual gate; `design-reviewer` rendered pass per surface.
5. **Merge** `redesign/design-system` → `dev` (gated: full `verify` + `integration` green) → owner-gated
   `dev→main`. **Never `production`** without a direct, per-instance owner instruction.

After the mockup sign-off, steps 1–5 run **fully autonomously** on the branch; owner reviews the
completed branch before the `dev` merge.

## 4. Mockup-round surfaces (representative, light + dark each)
1. **App shell** — rail + top-bar + breadcrumb + ⌘K, wrapping a list.
2. **Projects list** — records-workspace dense table (status soft-tags, group-by, light header).
3. **Project detail** — hybrid record page (two-column details + tabbed feed).
4. **Executive dashboard** — KPI tiles + charts (resting shadow on cards only).
5. **Procurement detail** — lifecycle/record page (richer record surface).
6. **Login** — auth shell.

## 5. Quality bar (the autonomous build, per surface)
Light+dark · empty/loading/error states · WCAG-AA (axe-core) · responsive @390/768/1280 · no
hardcoded colors · file-size budget · behavior-first tests · `design-reviewer` rendered audit · full
`verify` + `integration` green before the surface is considered done.
