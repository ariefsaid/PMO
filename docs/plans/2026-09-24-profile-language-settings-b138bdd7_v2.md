# Plan — personal profile language settings

**Scope:** signed-in users can select an interface-language override at `/settings/profile`: inherit the organization default (`NULL`), Bahasa Indonesia (`id`), or English (`en`). This is a bounded UI/auth-refresh slice; it deliberately does **not** change number-locale or timezone controls, `ContextBar.tsx`, impersonation, schema, RLS, or formatting logic.

**No ADR:** this composes with the existing nullable-preference model (DD-I18N-2) and the established `AuthProvider → I18nProvider → useResolvedLocale` flow; it introduces neither a schema nor an architectural decision.

## Design

### Data flow and error boundary

1. `ProfileSettings` reads the signed-in profile from `useAuth()`. Its select is initialized from `currentUser.locale` without resolving/copying the organization default: `inherit` is mapped to `null`, `id` maps to `'id'`, and `en` maps to `'en'`.
2. On save it calls the existing `setMyLocalePreferences(currentUser.id, { locale, numberLocale: currentUser.number_locale, timezone: currentUser.timezone })`. The user id remains the only client-side row selector; RLS remains the authority. Passing the two existing fields through verbatim is load-bearing: this slice cannot reset, resolve, or otherwise alter formatting/timezone preferences.
3. Only after that write resolves does it call a new `refreshCurrentUser()` Auth-context method and treats a non-null returned `error` as a save failure. The method reuses the provider’s existing `loadProfile` fetch and atomically replaces `currentUser` only when a profile is returned. It returns `{ error: string | null }` in the existing auth-method style; on a refresh error it preserves the previously usable profile. A monotonic profile-request generation guard makes the latest auth-event or manual refresh win, so an older profile read cannot overwrite a newer locale.
4. The changed profile drives `useResolvedLocale`; `I18nProvider` synchronously updates active format locales and then updates i18next and `<html lang>`. Thus the selector reports success only after the provider’s state is fresh, and a reload reads the persisted profile again.
5. A rejected database write or refresh displays an assertive, translated error, leaves the selected retry value available, and never renders the success state. Pending disables the select/save action and exposes a truthful saving state. A successful save exposes a polite success status.

### UI and navigation

- Create `pages/ProfileSettings.tsx` as a small, content-over-container settings page: page title/description, one `SelectField`, explanatory inherited-state copy, and one primary 32px save button. Use existing token utilities only (`border-border`, `bg-card`, `text-muted-foreground`, `focus-visible:ring-ring`, `max-w-*`, responsive spacing); stack naturally at narrow widths and keep the native labelled select and live regions keyboard/screen-reader accessible.
- Add an all-role `Profile settings` `NavLink` to the existing **Overview** Rail group, using the already-registered `pencil` icon. This makes the route discoverable on desktop and in the mobile rail drawer without touching the separately owned account menu in `ContextBar.tsx`.
- Add the lazy route to `appRouteConfig`; authenticated wrappers already apply at `App.tsx`’s shell boundary.
- Add literal `t(key, default)` calls and matching English and Bahasa values. Register `/settings/profile  pages/ProfileSettings.tsx` in the explicit i18n launch-scope list so `check:i18n` checks the new rendered screen instead of silently excluding it.

### Test ownership / traceability

| Acceptance criterion | Owning proof after this slice | Supporting proof in this plan |
|---|---|---|
| AC-L10N-003 | existing `pmo-portal/src/lib/db/preferences.test.ts` DAL test (writes `NULL`) | `ProfileSettings.test.tsx` verifies the inherit UI maps to the same `null` call while preserving number locale/timezone. |
| AC-L10N-060 | `pmo-portal/e2e/serial/AC-L10N-060-language-switch.spec.ts`, **only when its local red→green run reaches the test body and passes** | component/Auth tests prove the lower-layer selector and refresh contract. |

The page’s discoverability, current-choice rendering, pending/success/error states, responsive layout, and exact preservation of the two out-of-scope values are prompt acceptance behavior supporting AC-L10N-003/060; no new product semantics are invented. If the target e2e cannot execute in the local stack because its harness never reaches the test body, do not commit a skipped/vacuous test: retain the unit coverage, omit the e2e as the owner expressly permits, and report the failing local prerequisite.

## TDD implementation tasks

All paths are repo-root-relative unless the command begins with `cd pmo-portal`. Do not overwrite concurrent work; re-read each file before editing and stage only the paths below.

### Task 1 — add the Auth refresh contract test first (RED)

**AC coverage:** supports AC-L10N-003 and AC-L10N-060.

**Edit** `pmo-portal/src/auth/AuthProvider.test.tsx` before provider code:

- Extend the `Probe` (or add a `RefreshProbe`) to call `refreshCurrentUser()` through `useAuth()`.
- Make the mocked profiles query return the initial profile for initial load and a second profile with `locale: 'id'`, unchanged `number_locale` and `timezone`, after the refresh button is clicked.
- Add a test titled `refreshCurrentUser replaces currentUser from a fresh profile read` that waits for the initial profile, invokes refresh, and asserts the rendered locale becomes `id` without an auth-state event.
- Add a test titled `refreshCurrentUser returns an error and preserves the current profile when the refresh read fails` that switches the second query result to a generic error; assert the original profile remains rendered and the method resolves `{ error: '…' }` rather than reporting success.
- Add deferred-read ordering coverage: begin an auth/session profile read, complete a manual refresh with locale `id`, then resolve the older read; assert the stale completion cannot replace the refreshed locale.

**Verify RED:** `cd pmo-portal && npx vitest run src/auth/AuthProvider.test.tsx` (the context has no refresh method yet, so the new probe/test cannot compile or pass).

### Task 2 — implement the Auth refresh contract (GREEN)

**AC coverage:** supports AC-L10N-003 and AC-L10N-060.

**Edit** `pmo-portal/src/auth/AuthContext.ts`, `pmo-portal/src/auth/AuthProvider.tsx`, and `pmo-portal/src/lib/analytics/AnalyticsProvider.test.tsx`:

- Add `refreshCurrentUser: () => Promise<{ error: string | null }>` to `AuthContextValue`.
- Add a `useRef` monotonic profile-request generation to `AuthProvider`. Increment/capture it before every profile read in `apply` and refresh, and apply a returned result only when the captured generation is current and the provider is active. Increment it for a signed-out `apply(null)` as well, invalidating any in-flight prior-user read. This preserves existing initial-load/auth-event behavior while preventing a stale read from overwriting a newer locale or a changed session.
- Create a memoized refresh callback that reads the current session user id and calls `loadProfile`. It returns `{ error: 'Not signed in' }` when there is no user, returns `{ error: result.error }` without clearing the current profile when the read reports an error, and returns `{ error: null }` only after the current-generation successful profile result has replaced `currentUser` and cleared both profile-error fields. Catch a rejected profile-query promise and return its message in the same result shape; never turn an already usable authenticated profile into null for this page-level refresh.
- Include the callback in the context value and `useMemo` dependencies. Add `refreshCurrentUser: vi.fn()` to the typed `makeAuthCtx()` fixture in `AnalyticsProvider.test.tsx`. Do not alter sign-in, sign-out, auth-event, impersonation, or analytics production code.

**Verify GREEN:** `cd pmo-portal && npx vitest run src/auth/AuthProvider.test.tsx`.

### Task 3 — write the profile settings component tests first (RED)

**AC coverage:** AC-L10N-003 supporting proof; AC-L10N-060 supporting proof.

**Create** `pmo-portal/pages/ProfileSettings.test.tsx` before the page implementation. Mock `@/src/auth/useAuth` with a signed-in profile whose locale is alternately `null`, `'en'`, and `'id'`, including distinctive `number_locale` and `timezone`; mock `@/src/lib/db/preferences` and use the real `ToastProvider` only if the implementation requires it. Mock `react-i18next` so literal defaults remain accessible in unit assertions.

Add meaningful RTL tests that:

1. verify the native labelled language select exposes exactly Organization default, Bahasa Indonesia, and English and reflects `null`, `id`, and `en` as the current stored choice;
2. select Organization default and save, then assert `setMyLocalePreferences` is called with the authenticated user id and `{ locale: null, numberLocale: <unchanged profile value>, timezone: <unchanged profile value> }`, then `refreshCurrentUser` is called before the polite success status appears and its `{ error: null }` result is required;
3. use a deferred mutation promise to assert the select/save button are disabled and a saving status is visible while pending;
4. reject the DAL mutation and separately return `{ error: 'profile refresh failed' }` from `refreshCurrentUser`, asserting an assertive error is shown and no success status appears in either case; and
5. run `axe` against the rendered page, including its labelled control and live feedback, and assert no violations.

**Verify RED:** `cd pmo-portal && npx vitest run pages/ProfileSettings.test.tsx` (module does not exist).

### Task 4 — implement the page and locale catalogue entries (GREEN)

**AC coverage:** AC-L10N-003 supporting proof; AC-L10N-060 supporting proof.

**Create** `pmo-portal/pages/ProfileSettings.tsx`; **edit** `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`, and `pmo-portal/src/lib/i18n/launch-scope-routes.txt`.

- Implement the page described in the design with `SelectField`, `useAuth`, `setMyLocalePreferences`, and local save state. Encode the select values as `'inherit' | 'id' | 'en'`; map only `'inherit'` to `null`. Initialize/reset the selection from `currentUser.locale` when that profile changes.
- Call the DAL only for `currentUser.id` and copy `currentUser.number_locale`/`currentUser.timezone` unchanged. Await `refreshCurrentUser()` after a successful DAL write; show success only when its returned `error` is null. On a DAL rejection or a non-null refresh error, render an error state and keep the chosen value retryable. Do not add controls or writes for number locale/timezone.
- Add literal `t('profileSettings.…', default)` calls for title, description, field label/help, three options, save/saving, saved, and failed feedback. Add the same nested key tree with English text in `en/common.json` and Bahasa translations in `id/common.json`; do not place unlocalized text in the component.
- Add `/settings/profile  pages/ProfileSettings.tsx` to `launch-scope-routes.txt` using the existing route-list format.

**Verify GREEN:** `cd pmo-portal && npx vitest run pages/ProfileSettings.test.tsx && npm run check:i18n`.

### Task 5 — write route and Rail discoverability tests first (RED)

**AC coverage:** supports AC-L10N-060.

**Edit** `pmo-portal/App.routes.test.tsx` and `pmo-portal/src/components/shell/__tests__/Rail.test.tsx` before route/Rail production code:

- Add a route-table assertion that `matchRoutes(appRouteConfig, '/settings/profile')` resolves a real element rather than the `*` route.
- Add a Rail test for every-role visibility (at least Executive and Engineer, matching the current test harness) that asserts an accessible `Profile settings` link has `href="/settings/profile"`; add an active-route assertion with `MemoryRouter initialEntries={['/settings/profile']}` that the link has `aria-current="page"`.

**Verify RED:** `cd pmo-portal && npx vitest run App.routes.test.tsx src/components/shell/__tests__/Rail.test.tsx`.

### Task 6 — wire the lazy route and all-role Rail link (GREEN)

**AC coverage:** supports AC-L10N-060.

**Edit** `pmo-portal/App.tsx` and `pmo-portal/src/components/shell/Rail.tsx`:

- Add a lazy `ProfileSettingsPage` import and `{ path: '/settings/profile', element: <ProfileSettingsPage /> }` to `appRouteConfig` before the `*` fallback.
- Add `{ to: '/settings/profile', text: 'Profile settings', icon: 'pencil', group: 'Overview', roles: [Executive, ProjectManager, Finance, Engineer, Admin] }` to `ALL_ITEMS`; add the literal `shell.nav.profileSettings` translation lookup to `navLabels`. Do not alter `ContextBar.tsx`, `modulesForRole`, authentication gates, or impersonation logic.
- Add `shell.nav.profileSettings` English/Bahasa values to the same two catalogue files (if not already added by Task 4, add them now in this task).

**Verify GREEN:** `cd pmo-portal && npx vitest run App.routes.test.tsx src/components/shell/__tests__/Rail.test.tsx && npm run check:i18n`.

### Task 7 — conditionally establish the curated local E2E red proof

**AC coverage:** owns AC-L10N-060 only if the local harness reaches the test body.

**Create** `pmo-portal/e2e/serial/AC-L10N-060-language-switch.spec.ts` with the required first-line tag:

```ts
// @e2e-isolation: serial — changes the shared PM seed profile’s locale and restores its NULL override in afterEach.
```

Write one curated journey using `signIn(page, 'pm@acme.test')` and only UI operations:

1. open `/settings/profile`, choose Bahasa Indonesia, save, and wait for `<html lang="id">` plus the success state;
2. reload, assert the selected value and `html[lang]` remain Indonesian (persistence);
3. open the seeded P001 project detail at `/projects/40000000-0000-0000-0000-000000000001`, and assert the same settled screen contains the contract value formatted with `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })` for `5_000_000` and the start date formatted with `Intl.DateTimeFormat('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })` for local `2026-01-06`;
4. in `afterEach`, use the settings UI and stable page test ids to choose Organization default and save, wait for `html[lang="en"]`, so the shared seed profile returns to its `NULL` override even after an assertion failure.

Run it under the DB lock from the repo root:

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && cd pmo-portal && npm run e2e:serial -- e2e/serial/AC-L10N-060-language-switch.spec.ts'
```

**Decision gate:** retain this test only when the red run reaches its intended missing-route/missing-control assertion (not a stack/bootstrap failure). If the local stack cannot start or the test body cannot run, delete this new test rather than adding a skip, record the exact command and failed prerequisite in the build report, and proceed with Tasks 1–6’s lower-layer proofs as the owner directed.

### Task 8 — make the E2E green and reconcile traceability

**AC coverage:** AC-L10N-060 owner, if Task 7’s decision gate passed.

After Tasks 1–6, rerun Task 7’s exact locked command. The journey must pass without retries or skips and must leave the PM profile inherited at the end. If the test is retained, **edit** `docs/specs/i18n-framework.spec.md` only in its AC-L10N-060 traceability location to replace `e2e/AC-L10N-060-language-switch.spec.ts` with `e2e/serial/AC-L10N-060-language-switch.spec.ts`; the criterion and owning layer remain unchanged, while the path becomes compliant with the binding serial-isolation rule.

**Verify GREEN:** `scripts/with-db-lock.sh bash -c 'supabase db reset && cd pmo-portal && npm run e2e:serial -- e2e/serial/AC-L10N-060-language-switch.spec.ts'`.

### Task 9 — focused regression, full verification, and handoff

**AC coverage:** AC-L10N-003 and, when retained, AC-L10N-060.

1. Re-run the focused red→green suite as one command:
   ```bash
   cd pmo-portal && npx vitest run src/auth/AuthProvider.test.tsx pages/ProfileSettings.test.tsx App.routes.test.tsx src/components/shell/__tests__/Rail.test.tsx && npm run check:i18n
   ```
2. Inspect `git diff --check` and `git status --short`; confirm the diff contains only the planned Auth context/provider, page/test, route/Rail tests and code, catalogues/scope registry, conditional E2E/spec-traceability files, and this plan’s intended docs. Do not revert concurrent changes and do not stage them.
3. Run the binding full suite (not a targeted substitute):
   ```bash
   cd pmo-portal && npm run verify:locked
   ```
4. If the E2E was retained, also rerun its exact locked command from Task 8 after the full verify. If any gate is red, stop and fix code; do not weaken/skip/delete a test. Commit only the clean planned file set with the implementation subject `Add profile language settings` (no push or deployment).

## Expected changed files

- `pmo-portal/src/auth/AuthContext.ts`
- `pmo-portal/src/auth/AuthProvider.tsx`
- `pmo-portal/src/auth/AuthProvider.test.tsx`
- `pmo-portal/src/lib/analytics/AnalyticsProvider.test.tsx`
- `pmo-portal/pages/ProfileSettings.tsx`
- `pmo-portal/pages/ProfileSettings.test.tsx`
- `pmo-portal/App.tsx`
- `pmo-portal/App.routes.test.tsx`
- `pmo-portal/src/components/shell/Rail.tsx`
- `pmo-portal/src/components/shell/__tests__/Rail.test.tsx`
- `pmo-portal/public/locales/en/common.json`
- `pmo-portal/public/locales/id/common.json`
- `pmo-portal/src/lib/i18n/launch-scope-routes.txt`
- Conditional only: `pmo-portal/e2e/serial/AC-L10N-060-language-switch.spec.ts` and the corresponding path-only traceability correction in `docs/specs/i18n-framework.spec.md`.

No migration, generated type, DAL, number-format, timezone, `ContextBar.tsx`, or impersonation file changes are planned.
