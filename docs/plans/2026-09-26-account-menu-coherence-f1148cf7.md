# Account-menu coherence implementation plan

## Summary

Replace the separate desktop and phone account affordances with one responsive `AccountMenu` owned by the shell. It will reuse the current auth, view-as, theme, legal-link, and profile-route contracts; it will not alter database schema, auth/RLS authority, role eligibility, or theme/profile persistence.

No ADR is required: this is a reversible presentation and navigation consolidation within the existing shell architecture.

## Design and data flow

- Add `pmo-portal/src/components/shell/AccountMenu.tsx`. This is the sole owner of the account trigger, dropdown state, focus references, outside-click/Escape listeners, and shared menu body. `ContextBar` remains the layout owner for the rail, breadcrumb, command palette, and notification controls, and renders exactly one `<AccountMenu />`.
- `AccountMenu` reads `currentUser`/`signOut` from `useAuth`, `effectiveRole`/`canImpersonate`/`viewAs` from `useEffectiveRole`, and `theme`/`setTheme` from `useTheme`. This preserves the existing authority boundaries: `canImpersonate` remains the sole UI eligibility input and `viewAs` remains view-only; `useTheme` remains responsible for document-class update and best-effort storage.
- The one avatar/identity button is labelled “Account menu”, has `aria-haspopup="menu"` and live `aria-expanded`, shows the avatar-only compact treatment below `sm`, and shows the existing identity text at `sm` and above. It controls one `role="menu"` popup at all widths; do not render a desktop copy and a mobile copy.
- Menu order: signed-in identity; Profile & preferences link; Theme section with Light and Dark `menuitemradio` choices and `aria-checked`; conditional View as role section; Legal & support (Terms, Privacy, optional Help); separated Sign out command. Profile/role/legal/sign-out actions close the popup; choosing a theme leaves the popup open so the new selected state is immediately announced and visible. Sign out closes before invoking the existing action.
- Escape closes and focuses the trigger. A document `mousedown` handler closes only when its target is outside the trigger/popup wrapper. Effects install listeners only while open and clean them up on close/unmount. Because the popup uses `role="menu"`, opening it focuses the first item and ArrowUp/ArrowDown/Home/End navigate its items; Tab and Shift+Tab close the popup and move directly to the adjacent control in document order. A selected sample-only preview exposes Return to Admin, and the identity label remains the real role while the banner names the preview.
- Use the existing popover grammar: `bg-popover`, `text-popover-foreground`, `border-border`, `rounded-lg`, `p-[5px]`, and the sanctioned low single-layer overlay shadow. Use 32px menu rows, `accent` hover, `primary/10` plus `text-nav-active-text` for selected theme/role, `destructive-text` for Sign out, existing global focus ring, and `touch-target` on the trigger. Fit the popup to the viewport with a token-scale inset, a `max-height` derived from `100dvh` and `--header-h`, `overflow-y-auto`, and a viewport-bounded width so short 390px phone viewports scroll internally without horizontal document overflow.
- Remove the `ThemeToggle` rendering and standalone desktop role/user/sign-out cluster. Remove the profile entry from `Rail.ALL_ITEMS`; direct `/settings/profile` routing is unchanged. Delete the now-unreferenced `ThemeToggle` component/test rather than retaining a dead second theme surface.
- Keep the existing `HELP_URL` omission behavior and Help target/rel behavior; Terms and Privacy become entries in the one shared menu at desktop as well as phone.
- Rename displayed profile IA consistently to **Profile & preferences** / **Profil & preferensi** in the profile H1, direct-route breadcrumb, account-menu link, route-match fallback, and locale catalogues. Keep the existing profile language save data flow untouched.

## Acceptance traceability

**Implementation clarification after review.** The unified popup uses `role="menu"`, so its items receive initial focus and support Arrow Up/Down, Home, and End. Escape restores the trigger; Tab and Shift+Tab dismiss the popup and move directly to the next or previous control in document order. Theme and preview choices use `menuitemradio` with `aria-checked`. This resolves the initial plan's incomplete keyboard treatment without changing the account-menu scope or the acceptance goal.

| Acceptance criterion | Owning proof | Supporting regression proof |
|---|---|---|
| AC-ACCT-001 | `pmo-portal/src/components/shell/__tests__/ContextBar.test.tsx` unified-menu test | `pmo-portal/src/components/shell/__tests__/Rail.test.tsx` absence test |
| AC-ACCT-002 | `pmo-portal/src/components/shell/__tests__/ContextBar.test.tsx` Light→Dark and Dark→Light tests | existing `pmo-portal/src/hooks/useTheme.test.ts` persistence contract remains unchanged |
| AC-ACCT-003 | `pmo-portal/src/components/shell/__tests__/ContextBar.test.tsx` Escape/focus and sign-out test | — |
| AC-ACCT-004 | `pmo-portal/src/components/shell/__tests__/ContextBar.test.tsx` eligible sample Admin and ineligible ordinary Admin tests | `pmo-portal/e2e/AC-AUTH-010-demo-admin-view-role.spec.ts`, `pmo-portal/e2e/AC-AUTH-011-non-admin-view-role.spec.ts` |
| AC-ACCT-005 | `pmo-portal/e2e/AC-ACCT-005-account-menu-layout.spec.ts` | required agent-browser desktop/390px rendered check |
| AC-ACCT-006 | `pmo-portal/src/components/shell/__tests__/ContextBar.test.tsx` real-catalogue English/Bahasa rendering test | `pmo-portal/pages/ProfileSettings.test.tsx` translated H1 and existing `pmo-portal/e2e/serial/AC-L10N-060-language-switch.spec.ts` route journey |

## Tasks

1. **Write the failing unified-account-menu component tests before changing shell production code.**
   - Files: `pmo-portal/src/components/shell/__tests__/ContextBar.test.tsx`, `pmo-portal/src/components/shell/ContextBar.test.tsx`, and `pmo-portal/src/components/shell/__tests__/ContextBar.touchTarget.test.tsx`.
   - Replace assertions for the retired desktop cluster, separate view-as trigger, inline Sign out, and phone-only menu with failing tests that open the one `Account menu` trigger and assert `aria-expanded`, the identity, Profile & preferences link (`href="/settings/profile"`), both theme choices with their selected `aria-checked` state, and Sign out. Cover a signed-in non-admin at the shared trigger, an eligible sample Admin whose View as role heading and choices invoke `viewAs`, and an ordinary Admin/non-admin whose heading and choices are absent. Test keyboard Tab/Enter reachability, Escape closes and restores trigger focus, outside mouse-down closes, and Sign out calls the existing mock exactly once after the menu closes. Change the touch-target regression to assert the account trigger rather than the retired role trigger. Retain command-palette, rail-toggle, and notification coverage.
   - ACs: AC-ACCT-001, AC-ACCT-003, AC-ACCT-004.
   - Verify RED: `cd pmo-portal && npm test -- src/components/shell/__tests__/ContextBar.test.tsx src/components/shell/ContextBar.test.tsx src/components/shell/__tests__/ContextBar.touchTarget.test.tsx`.

2. **Write the failing rail-removal and translated-profile assertions.**
   - Files: `pmo-portal/src/components/shell/__tests__/Rail.test.tsx`, `pmo-portal/src/components/shell/__tests__/breadcrumb-nav.test.ts`, and `pmo-portal/pages/ProfileSettings.test.tsx`.
   - Replace the old all-role Profile settings rail-link and active-rail assertions with an `AC-ACCT-001` assertion that `/settings/profile` is absent for every tested role, including when that URL is current. Change the route-match expectation and profile page heading assertion to Profile & preferences. Add English and Bahasa catalogue-backed render cases that prove the account-menu/profile page visible labels use the selected locale rather than fallback keys; retain every existing language save, refresh, error, and axe assertion.
   - ACs: AC-ACCT-001, AC-ACCT-006.
   - Verify RED: `cd pmo-portal && npm test -- src/components/shell/__tests__/Rail.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts pages/ProfileSettings.test.tsx`.

3. **Implement the single responsive account-menu component and simplify `ContextBar`.**
   - Files: add `pmo-portal/src/components/shell/AccountMenu.tsx`; modify `pmo-portal/src/components/shell/ContextBar.tsx`.
   - Move the current identity initials helper and impersonation-role list to the new component as needed; make it render one responsive avatar/identity trigger and one popup with the menu order, semantic roles, conditional role-preview gate, close behavior, focus return, and viewport-scrolling treatment described in the design. Call `setTheme('light' | 'dark')` from the two explicit choices and derive their selected state from `theme`; do not reimplement local storage or document-class logic. Render the existing profile Link, Terms/Privacy Links, optional Help anchor, and `signOut` action in this same popup. Remove both old `menuOpen`/`acctOpen` state machines, inline desktop cluster, inline theme toggle, inline Help/sign-out controls, and `mobile-account-menu`/`desktop-account-cluster` test ids from `ContextBar`; retain command palette, rail toggle, breadcrumb, and notification behavior.
   - ACs: AC-ACCT-001, AC-ACCT-002, AC-ACCT-003, AC-ACCT-004, AC-ACCT-005.
   - Verify GREEN: `cd pmo-portal && npm test -- src/components/shell/__tests__/ContextBar.test.tsx src/components/shell/ContextBar.test.tsx src/components/shell/__tests__/ContextBar.touchTarget.test.tsx`.

4. **Remove the retired rail destination and clean up its intentional placement tests.**
   - Files: `pmo-portal/src/components/shell/Rail.tsx`, `pmo-portal/src/components/shell/__tests__/Rail.test.tsx`.
   - Delete only the `/settings/profile` `ALL_ITEMS` entry and its now-unused navigation-label mapping. Preserve all other role/feature gates, groups, active-state behavior, and direct route behavior. Keep the replacement absence test from Task 2; do not retain assertions that require Profile settings to appear in the rail.
   - ACs: AC-ACCT-001, AC-ACCT-007.
   - Verify: `cd pmo-portal && npm test -- src/components/shell/__tests__/Rail.test.tsx src/components/shell/Rail.test.tsx`.

5. **Retire the standalone theme component without weakening quiet-shell control coverage.**
   - Files: delete `pmo-portal/src/components/shell/ThemeToggle.tsx` and `pmo-portal/src/components/shell/__tests__/ThemeToggle.test.tsx`; modify `pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx`.
   - Remove the obsolete `ThemeToggle` import/render and replace its comparison assertion with a direct regression assertion that NotificationBell remains a quiet `text-muted-foreground` shell control in light and dark DOM states. Do not modify `pmo-portal/src/hooks/useTheme.ts` or its tests.
   - ACs: AC-ACCT-002, AC-ACCT-007.
   - Verify: `cd pmo-portal && npm test -- src/components/shell/__tests__/NotificationBell.test.tsx src/hooks/useTheme.test.ts`.

6. **Apply the approved Profile & preferences copy through source-of-truth routing and both locale catalogues.**
   - Files: `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`, `pmo-portal/pages/ProfileSettings.tsx`, `pmo-portal/App.tsx`, `pmo-portal/src/components/shell/routeMatch.ts`.
   - Add the account-menu Theme/Light/Dark strings and use the existing account, role, legal, Help, and Sign out keys where their text is unchanged. Change the profile navigation/title values to English `Profile & preferences` and Bahasa `Profil & preferensi`; use that same translated profile label in the `App.tsx` direct-route breadcrumb and the English route-match fallback. Do not change the profile repository call, locale field mapping, refresh behavior, or route configuration.
   - ACs: AC-ACCT-001, AC-ACCT-006.
   - Verify: `cd pmo-portal && npm run check:i18n && npm test -- pages/ProfileSettings.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts`.

7. **Update ContextBar legal and honesty regressions for the shared menu, not a phone-only placement.**
   - Files: `pmo-portal/src/components/shell/ContextBar.test.tsx`, `pmo-portal/src/components/shell/__tests__/ContextBar.honesty.test.tsx`.
   - Replace the assertion that desktop has Help but no Terms/Privacy with assertions that the single opened account menu exposes Terms, Privacy, and the optional Help anchor with its existing href/target/rel, regardless of viewport treatment; retain the empty-Help omission case. Change the honesty regression to open the account menu before asserting Sign out and identity navigation, and retire references to the removed static Sign out button.
   - ACs: AC-ACCT-001, AC-ACCT-003.
   - Verify: `cd pmo-portal && npm test -- src/components/shell/ContextBar.test.tsx src/components/shell/__tests__/ContextBar.honesty.test.tsx`.

8. **Add the rendered desktop/phone overflow acceptance journey before treating the responsive implementation as complete.**
   - File: add `pmo-portal/e2e/AC-ACCT-005-account-menu-layout.spec.ts`.
   - Start the file with `// @e2e-isolation: read-only — signed-in shell rendering and menu interaction only; no database write.` Use a seeded signed-in member, open the account menu at a desktop viewport and at 390px width with a deliberately short phone height, and assert its named actions are visible or can be scrolled into view inside the popup. Assert the popup has scrollable overflow when constrained and evaluate that document `scrollWidth` does not exceed viewport width. Preserve the session and do not activate Sign out in this layout-only journey.
   - ACs: AC-ACCT-005.
   - Verify: `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm run e2e:parallel -- e2e/AC-ACCT-005-account-menu-layout.spec.ts'`.

9. **Move role-preview and legal e2e journeys to the one menu while preserving their goal oracles.**
   - Files: `pmo-portal/e2e/AC-AUTH-010-demo-admin-view-role.spec.ts`, `pmo-portal/e2e/AC-AUTH-011-non-admin-view-role.spec.ts`, `pmo-portal/e2e/AC-LEG-024-mobile-account-menu.spec.ts`.
   - In the eligible sample-Admin journey, open the account menu to select the view-only role and to sign out, then retain the real navigation/identity-reset assertions. In the ordinary-org Admin/non-admin journey, open the same menu at desktop and 390px before asserting the View as role heading/choices are absent. In the legal journey, query the shared account-menu popup rather than `mobile-account-menu`, preserving Terms/Privacy destination and bare-public-page oracles.
   - ACs: AC-ACCT-004, AC-ACCT-005; preserves AC-AUTH-010, AC-AUTH-011, AC-LEG-024.
   - Verify: `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm run e2e:parallel -- e2e/AC-AUTH-010-demo-admin-view-role.spec.ts e2e/AC-AUTH-011-non-admin-view-role.spec.ts e2e/AC-LEG-024-mobile-account-menu.spec.ts'`.

10. **Update every existing sign-out journey to enter through the account menu and retain each original outcome assertion.**
    - Files: `pmo-portal/e2e/AC-AUTH-006.spec.ts`, `pmo-portal/e2e/AC-CRE-004-grant.spec.ts`, `pmo-portal/e2e/AC-PRJ-001-projects-crud.spec.ts`, `pmo-portal/e2e/AC-AGP-023-thread-persistence.spec.ts`, `pmo-portal/e2e/AC-AAN-036-automation-notification.spec.ts`, and `pmo-portal/e2e/serial/AC-ENT-005-toggle.spec.ts`.
    - Before each existing Sign out activation, open the labelled account menu and click its Sign out menu item. Preserve every post-sign-out `/login` assertion and each cross-user/data-isolation goal oracle. Replace the projects journey’s swallowed Sign out click with an account-menu sign-out followed by the explicit login-page assertion before changing persona; do not use `.catch`, skip, or a weaker proxy.
    - ACs: AC-ACCT-003; preserves the existing ACs in each file.
    - Verify parallel files: `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm run e2e:parallel -- e2e/AC-AUTH-006.spec.ts e2e/AC-CRE-004-grant.spec.ts e2e/AC-PRJ-001-projects-crud.spec.ts e2e/AC-AGP-023-thread-persistence.spec.ts e2e/AC-AAN-036-automation-notification.spec.ts'`.
    - Verify serial file: `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm run e2e:serial -- e2e/serial/AC-ENT-005-toggle.spec.ts'`.

11. **Route the language-switch persistence journey through the account menu without changing its persistence oracle.**
    - File: `pmo-portal/e2e/serial/AC-L10N-060-language-switch.spec.ts`.
    - After sign-in, open Account menu and select Profile & preferences instead of navigating directly to `/settings/profile`; assert the URL and the renamed breadcrumb/page label before selecting Bahasa. Keep the existing save, document-language, reload, money/date-format, and `afterEach` restoration assertions. In `afterEach`, navigate through the same menu when the authenticated shell is present; if an existing test failure has already left the shell unavailable, report that runner limitation rather than removing the restoration goal.
    - ACs: AC-ACCT-001, AC-ACCT-006; preserves AC-L10N-060.
    - Verify: `scripts/with-db-lock.sh bash -c 'cd pmo-portal && npm run e2e:serial -- e2e/serial/AC-L10N-060-language-switch.spec.ts'`.

12. **Run the UI rendering check and retain screenshots only in the ADW handoff.**
    - Files: no tracked source changes; write screenshots only under `adws/adw_data/sessions/f1148cf7/context_handoff/screenshots/`.
    - First run exactly `agent-browser skills get core --full`. Start the app from `pmo-portal/`, authenticate with the existing local test setup, then inspect the opened account menu at a desktop viewport and 390px phone viewport (including a short height). Check the accessible snapshot for the trigger name/expanded state, identity, radio selection, and menu entries; check that the narrow popup scrolls internally and the page has no horizontal overflow. Save the two screenshots only under the stated handoff directory; do not add screenshots or authentication data to Git. If local e2e/auth setup cannot run, preserve the automated layout test and report the specific command limitation rather than claiming this pass.
    - ACs: AC-ACCT-005.
    - Verify: `test -f adws/adw_data/sessions/f1148cf7/context_handoff/screenshots/account-menu-desktop.png && test -f adws/adw_data/sessions/f1148cf7/context_handoff/screenshots/account-menu-phone-390.png` (run only after the rendered check succeeds).

13. **Run the bounded implementation gates and report their real exit status/output.**
    - Files: no production changes unless a gate identifies a defect in the files above; fix the implementation, never weaken or skip a test.
    - Run targeted component tests, i18n completeness, typecheck, lint, and the affected parallel/serial e2e commands from Tasks 8–11. Do not regenerate `package-lock.json`; do not run or claim the Director-owned `npm run verify:locked`, PR, push, or merge gates.
    - ACs: all AC-ACCT criteria.
    - Verify: `cd pmo-portal && npm run typecheck && npm run lint:ci && npm run check:i18n && npm test -- src/components/shell/__tests__/ContextBar.test.tsx src/components/shell/ContextBar.test.tsx src/components/shell/__tests__/ContextBar.honesty.test.tsx src/components/shell/__tests__/ContextBar.touchTarget.test.tsx src/components/shell/__tests__/Rail.test.tsx src/components/shell/__tests__/NotificationBell.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts pages/ProfileSettings.test.tsx src/hooks/useTheme.test.ts`.

## Non-goals and guardrails

- Do not add a migration, repository, API endpoint, auth rule, role rule, theme storage mechanism, or profile preference persistence behavior.
- Do not expose role preview based on displayed Admin text; render it only from existing `canImpersonate`.
- Do not leave a second desktop/mobile menu body, an inline theme/role/sign-out control, a Profile settings rail item, retired placement assertions, skipped specs, `.catch`-swallowed sign-out, or committed screenshots.
- The component has no fetches or subscriptions. Its document listeners exist only while open and clean up on unmount, avoiding duplicate listeners and steady-state re-render work.
