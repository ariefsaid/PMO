# Issue #477 — Locale drift sweep: ~45 hardcoded-locale format sites bypass format.ts

Read the full issue first: `gh issue view 477`. It lists every file. Do not re-survey; it is accurate.

## Goal

Route every number/date/money display through `pmo-portal/src/lib/format.ts`. Today ~45 sites in ~28
files call `toLocaleString` / `toLocaleDateString` / `new Intl.*` with a hardcoded (or implicit)
locale, bypassing `format.ts` entirely.

**Why now, and why this is not the i18n work itself:** the locale seam (#468, `DD-I18N-*`) makes
`format.ts` locale-aware. This sweep is a **prerequisite** — done first, the seam changes ONE file;
done after, it changes 28. This issue adds **no** locale awareness. Behaviour stays byte-identical.

## The three shapes (worst first)

1. **Hand-rolled money with a welded `$`** — `` `$${n.toLocaleString(...)}` `` in
   `pages/RevenueByProject.tsx`, `pages/SalesInvoices.tsx`, `pages/IncomingPayments.tsx`.
   Route through `formatCurrency`.
2. **Hardcoded `Intl` constructors** — `new Intl.NumberFormat('en-US')` / `new Intl.DateTimeFormat('en-US'|'en-GB')`.
   Move the behaviour into `format.ts` as a named export; call that.
3. **Bare `toLocaleDateString()` / `toLocaleString()`** — locale-*implicit*, so output depends on the
   viewer's browser. Already a latent bug: two users in one org see different date formats. Route
   through `formatDate` / the appropriate `format.ts` export.

## Hard constraints

- **Behaviour-preserving.** This is a refactor. If a site currently renders `Jun 14, 2026`, it still
  renders `Jun 14, 2026` after. Where an existing site's format differs from `format.ts`'s (e.g. an
  `en-GB` `14 Jun` in `MilestoneStrip`/`MilestonePhaseHeader`/`sCurve`), add a **named export** to
  `format.ts` for that variant rather than silently changing the output. Do not "harmonise" formats —
  that is a design decision, not yours.
- **EXCLUDE `pages/project-detail/ProjectDetailHeader.tsx:67`.** Its `toLocaleString('en-US')` is a
  masked money *input*, owned by #468. Leave it exactly as is.
- **DO NOT TOUCH the export path.** `src/lib/export/toWorkbookBuffer.ts` and `cellType.ts` write
  *typed cells* (real numbers + `numFmt`), which is correct and deliberate (`DD-I18N-4`). No export
  value may pass through a formatter — a formatted string in a spreadsheet cell corrupts data.
- **Leave e2e/test files alone** unless a test asserts output you changed (you should not change any).
- Do not add an i18n library. Do not add dependencies.

## Guard (the point of the exercise)

Add an ESLint `no-restricted-syntax` rule banning `toLocaleString` / `toLocaleDateString` /
`new Intl.*` **outside** `src/lib/format.ts` and `src/lib/export/**`. The guard is cheaper than the
next sweep. It must fail the build if violated — verify by deliberately reintroducing one call and
confirming `npm run lint:ci` goes red, then remove it.

## Done when

- `grep -rn "toLocaleString\|toLocaleDateString\|new Intl\." pmo-portal --include='*.ts' --include='*.tsx'`
  returns hits ONLY in `src/lib/format.ts`, `src/lib/export/**`, `ProjectDetailHeader.tsx:67`, and test files.
- No `$` literal adjacent to a formatted number in JSX.
- `npm run verify` green from `pmo-portal/` — the WHOLE suite (8 gates), not touched files.
  Cross-component breakage is exactly what this class of change causes.

## Notes for the runner

- Work in this worktree only. Branch `fix/477-locale-drift-sweep` off `dev`. Do not push, do not open a PR.
- Node 22.22+. Run npm from `pmo-portal/`.
- The heavy vitest suite is machine-shared: use `npm run verify:locked`, not bare `npm run verify`.
