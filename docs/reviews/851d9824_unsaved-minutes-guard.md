# Unsaved meeting-minutes navigation guard

## What changed

Meeting detail now protects dirty BlockNote minutes from accidental loss. When the existing dirty predicate (the Save minutes affordance is enabled) is true, `MeetingDetail` installs:

- a `beforeunload` handler for tab close/reload; and
- a capture-phase document click handler for ordinary, primary, unmodified, same-origin `<a href>` navigation.

Eligible in-app navigation is stopped and opens the shared default-tone `ConfirmDialog`. **Stay** clears the pending destination without changing the editor; **Leave** navigates to the captured local path/query/hash. The handlers are removed when minutes become pristine or the page unmounts. Browser Back/Forward, autosave, drafts, and persistence changes remain out of scope.

The shell breadcrumb now supports an optional `href`. Route-derived parent crumbs provide validated local destinations while retaining their existing callback navigation and contextual list-return behavior. This makes the Meetings breadcrumb an interceptable anchor without changing router architecture. English and Indonesian translations add the unsaved-minutes dialog copy.

## Files carrying the change

- `pmo-portal/pages/MeetingDetail.tsx` — dirty-state unload and in-app anchor guard plus Stay/Leave dialog.
- `pmo-portal/src/components/shell/Breadcrumb.tsx` — optional anchor-backed parent crumbs, preserving callback-only button fallback.
- `pmo-portal/src/components/shell/routeMatch.ts` — local `href` values for Administration, My Views, and module detail parents, including validated contextual list paths.
- `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json` — dialog translations.
- `pmo-portal/pages/MeetingDetail.test.tsx` — AC-MTG-301 pristine navigation, AC-MTG-302 unload lifecycle, and dirty Stay/Leave coverage.
- `pmo-portal/e2e/AC-MTG-300-unsaved-minutes.spec.ts` — read-only Playwright journey covering edit, Stay preservation, and Leave navigation.
- `pmo-portal/src/components/shell/__tests__/Breadcrumb.test.tsx`, `breadcrumb-nav.test.ts`, `routeMatch.test.ts`, `AppShell.test.tsx`, and `AppShell.mobile.test.tsx` — anchor semantics, href derivation, callback preservation, and updated shell role/mobile assertions.
- `docs/plans/2026-10-06-unsaved-minutes-guard-851d9824.md` and `_v2.md` — implementation design, acceptance-test ownership, verification commands, and scope boundaries.

## Verification

From `pmo-portal/`, the plan specifies focused Vitest runs for the MeetingDetail and shell tests, `npm run check:i18n`, typecheck, zero-warning ESLint on the touched frontend files, `npm run check:e2e-isolation`, and `npx vitest run --changed origin/dev`. Run the curated journey through `scripts/e2e-local.sh AC-MTG-300-unsaved-minutes`; it is tagged read-only and makes no database write. No migration, seed, package-lock, or environment-file change is included.
