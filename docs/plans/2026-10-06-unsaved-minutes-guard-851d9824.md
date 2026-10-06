# Plan — unsaved meeting-minutes navigation guard (#864)

**Binding inputs:** `docs/specs/meeting-module.spec.md` §10 (`FR-MTG-040`, `AC-MTG-300..302`) and `docs/decisions.md` `DD-MTG-11`.

## Design

`MeetingDetail` already owns the sole dirty signal: `minutesDirty` is true exactly when the editor document differs from its saved baseline, which is the same condition that enables **Save minutes**. Keep that single source of truth; do not add autosave, persisted drafts, router migration, database work, or browser-history interception.

While `minutesDirty` is true, `MeetingDetail` will attach two cleanup-safe native handlers:

1. A `beforeunload` listener calls `preventDefault()` and assigns `event.returnValue = ''`, delegating the tab-close/reload warning to the browser.
2. A document capture-phase `click` listener identifies an activation of an ordinary, primary, unmodified, same-origin in-app `<a href>` navigation. It ignores already-prevented clicks, modified/non-primary clicks, downloads, non-self targets, external origins, and links that do not change the current app URL. For an eligible target it prevents the native/React navigation, records the local `pathname + search + hash`, and opens a default-tone shared `ConfirmDialog`.

The dialog is entirely page-local: **Stay** closes it and leaves the editor/baseline unchanged; **Leave** calls `useNavigate()` with the saved local destination. No text from minutes is put into a URL, state, or telemetry. The native listeners only exist while dirty and are removed on save, reset, or unmount, avoiding stale handlers and route-wide work.

The actual desktop parent breadcrumb is currently a button, not an anchor, so it cannot meet the specified anchor interception boundary. Make the existing shell breadcrumb support an optional `href` alongside its existing callback. `breadcrumbForPath` supplies safe same-app hrefs for its parent crumbs (including the validated contextual list-return path); `Breadcrumb` renders such a parent as an anchor but retains callback-driven React navigation and the existing list-return state behavior. This narrowly makes the rendered Meetings crumb an interceptable same-origin anchor without changing the router type or the breadcrumb destination contract.

Use the already-tokened `ConfirmDialog` at default tone; add the dialog title, loss warning, **Stay**, and **Leave** under `meetingDetail.confirm.unsavedMinutes` in both shipped catalogues. No new CSS, API, package, migration, RLS policy, or ADR is required: `DD-MTG-11` is the decided architecture.

### Test ownership

| Acceptance criterion | Owning layer and canonical test |
| --- | --- |
| AC-MTG-300 | Playwright curated journey: `pmo-portal/e2e/AC-MTG-300-unsaved-minutes.spec.ts` |
| AC-MTG-301 | RTL: `pmo-portal/pages/MeetingDetail.test.tsx` |
| AC-MTG-302 | RTL: `pmo-portal/pages/MeetingDetail.test.tsx` |

## Implementation tasks

1. **RED — specify the real breadcrumb anchor and pristine-save behavior.**
   - In `pmo-portal/src/components/shell/__tests__/Breadcrumb.test.tsx`, first add an expectation that a parent crumb given both its existing navigation callback and `href="/meetings"` renders a link with that href and invokes the callback rather than a button.
   - In `pmo-portal/src/components/shell/__tests__/breadcrumb-nav.test.ts`, first assert detail-parent crumbs expose their canonical href; cover the contextual list-return case so its href is the validated list path while its existing callback still receives the `ListReturnNavigation` descriptor.
   - Update the existing role assertions in `pmo-portal/src/components/shell/__tests__/AppShell.test.tsx` and `pmo-portal/src/components/shell/__tests__/AppShell.mobile.test.tsx` from parent breadcrumb buttons to links, preserving their route-return and mobile-hide assertions.
   - In `pmo-portal/pages/MeetingDetail.test.tsx`, add a routed page-plus-real-`Breadcrumb` helper that uses a `/meetings` parent anchor. Write **`AC-MTG-301: pristine minutes breadcrumb reaches Meetings without a dialog`**: click the crumb before editing, assert the Meetings route probe renders, and assert no dialog appeared. Write **`AC-MTG-302: beforeunload is armed only while Save minutes is enabled`**: assert no cancellation for a pristine dispatch, make the stub editor dirty, assert a cancelable `beforeunload` dispatch is prevented/has the browser return value, save through the mocked mutation, then assert a subsequent dispatch is not prevented.
   - Run the new focused tests and confirm they fail before production changes:
     ```bash
     cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/MeetingDetail.test.tsx src/components/shell/__tests__/Breadcrumb.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts src/components/shell/__tests__/AppShell.test.tsx src/components/shell/__tests__/AppShell.mobile.test.tsx
     ```

2. **GREEN — make production parent breadcrumbs interceptable anchors without changing their destinations.**
   - In `pmo-portal/src/components/shell/Breadcrumb.tsx`, extend `BreadcrumbPart` with optional `href`. When a non-current part has both `href` and `onClick`, render an `<a href>` with the existing typography/mobile-hide classes; its click handler prevents the document navigation and invokes the supplied callback so router navigation and contextual scroll-restore state remain unchanged. Keep the existing callback-only button fallback for isolated callers and keep the current segment non-interactive.
   - In `pmo-portal/src/components/shell/routeMatch.ts`, supply `href` for every routed parent breadcrumb: `/administration/users` for Administration, `/` for My Views, and `contextualParent?.path ?? parentPath` for module details. Keep each existing `onClick` callback exactly responsible for `navigate(contextualParent ?? parentPath)` so no list-return state behavior regresses.
   - Re-run the focused command from Task 1 until green. This supporting semantic change enables the exact `<a href>` boundary required by `FR-MTG-040`; it owns no additional meeting acceptance criterion.

3. **GREEN — add the scoped dirty guard and localized shared confirmation.**
   - In `pmo-portal/pages/MeetingDetail.tsx`, import `useEffect`, `useNavigate`, and `useLocation` as needed; add `pendingLeaveTarget: string | null` state beside the existing minutes state. While `minutesDirty`, register the `beforeunload` listener and document capture listener described in Design, returning both cleanup functions from the effect. Do not register either listener when minutes are pristine or after a successful save resets the baseline.
   - Construct the leave target only from an eligible same-origin anchor URL and pass only its local path/query/hash to `navigate`; never use an untrusted external URL. On interception call both `preventDefault()` and `stopPropagation()` before opening the dialog so the `Breadcrumb`/`NavLink` callback cannot navigate first.
   - Render one additional default-tone `ConfirmDialog` in `MeetingDetail`: `open={pendingLeaveTarget !== null}`, title/description/labels from the new translations, `onCancel` clears the pending target (**Stay**), and `onConfirm` clears it then calls `navigate(pendingLeaveTarget)` (**Leave**). Do not alter browser Back/Forward handling.
   - Add `meetingDetail.confirm.unsavedMinutes.{title,description,stay,leave}` with the specified loss-warning meaning to `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json`; use the exact keys from the page, no fallback-only copy.
   - Re-run the focused Task 1 unit command and the catalogue gate until green:
     ```bash
     cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/MeetingDetail.test.tsx src/components/shell/__tests__/Breadcrumb.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts src/components/shell/__tests__/AppShell.test.tsx src/components/shell/__tests__/AppShell.mobile.test.tsx && npm run check:i18n
     ```

4. **RED then GREEN — add the curated browser journey for dirty minutes.**
   - Create `pmo-portal/e2e/AC-MTG-300-unsaved-minutes.spec.ts` with line-one `// @e2e-isolation: read-only — signs in to the seeded author meeting and makes an unsaved browser-only edit; it performs no database write.` Import `signIn` (and call `waitForFonts(page)` before any future layout measurement; this journey makes none).
   - Write **`AC-MTG-300: dirty minutes breadcrumb offers Stay and Leave without losing the edit`** against the seeded editable meeting: sign in as its author, type a unique line into BlockNote without saving, verify Save minutes enables, click the rendered Breadcrumb landmark's **Meetings** link, and assert the unsaved-minutes dialog appears. Choose **Stay**, assert the detail URL remains, the typed line remains in the editor, and Save remains enabled. Click the breadcrumb again, choose **Leave**, and assert `/meetings` loads. This is browser-only state, so it must not mutate or clean up the shared seed row.
   - Run it first against the pre-guard behavior to observe the missing-dialog failure; after Task 3, run the targeted e2e through the required local wrapper and isolation guard:
     ```bash
     npm run check:e2e-isolation
     cd .. && scripts/e2e-local.sh AC-MTG-300-unsaved-minutes
     ```

5. **Run the local final gate for the touched frontend and document review handoff.**
   - From `pmo-portal/`, run typecheck and zero-warning lint on exactly the changed app, shell, locale-independent test, and e2e files:
     ```bash
     ../scripts/with-test-lock.sh npm run typecheck
     npx eslint --max-warnings=0 pages/MeetingDetail.tsx pages/MeetingDetail.test.tsx src/components/shell/Breadcrumb.tsx src/components/shell/routeMatch.ts src/components/shell/__tests__/Breadcrumb.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts src/components/shell/__tests__/AppShell.test.tsx src/components/shell/__tests__/AppShell.mobile.test.tsx e2e/AC-MTG-300-unsaved-minutes.spec.ts
     ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
     npm run check:i18n
     npm run check:e2e-isolation
     ```
   - From the repository root, run the touched curated journey once more with `scripts/e2e-local.sh AC-MTG-300-unsaved-minutes`. Do not run `db reset` (no migration or seed change), do not regenerate `package-lock.json`, and do not read environment files.
   - Hand the passing evidence to the required spec, code-quality, and security reviewers. The frontend Discover pass must audit `/meetings/:id` on rich seed; graduate any rendered finding under the active QA portfolio before merge.

## Scope and boundaries

- **In:** same-origin anchor navigation from the meeting detail (including the real desktop Meetings breadcrumb and rail/shell anchors), the native reload/close warning, Stay/Leave confirm, English and Indonesian copy, and the three specified acceptance criteria.
- **Out:** autosave/drafts, browser Back/Forward interception, data-router migration or `useBlocker`, changes to BlockNote persistence, database/schema/RLS changes, and package/lockfile changes.
- **Risk control:** the capture listener is mounted only while the existing dirty predicate is true and filters activation semantics before preventing anything; Leave navigation is constrained to the parsed same-origin local URL. This gives a constant-time per-click listener only during unsaved edits and does not introduce a new cross-route store or data fetch.
