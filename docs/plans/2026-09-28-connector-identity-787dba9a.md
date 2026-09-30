# Plan: readable organization connector identity (#680)

**Binding scope:** `docs/specs/integration-connector-identity.spec.md` and `docs/plans/2026-09-27-integration-connector-identity.md`. This is a bounded FE slice on `dev`; no ADR is warranted. `scripts/prior-art.sh "connector identity"` exited 0 and found only issue #680, so it supplies no competing in-repo decision. The owner signed the enterprise UX milestone on 2026-09-28.

## Design

`IntegrationsView` already owns the organization-card metadata and receives the immutable `connected_by` audit stamp plus `connected_at` from `useIntegrations`. It will reuse `useAssignableProfiles()` from `pmo-portal/src/hooks/useTasks.ts`: that hook already calls `repositories.profile.listOrgProfiles()` under the caller's organization-scoped `['org-profiles', orgId]` React Query key, with a five-minute cache. The repository delegates to the RLS-scoped profile source; no client `org_id`, DAL call, API, schema, RLS, auth, or permission change is introduced.

In `IntegrationsView`, derive one memoized `Map<string, string>` from a successful, non-error profile query. Admit only `profile.full_name.trim()` values that are nonempty, keyed by the profile `id`. For every rendered binding metadata block, resolve `binding.connected_by` through that map; use the translated neutral fallback when the actor is absent, unmatched, blank, the query is pending, or the query failed. Never interpolate `connected_by` into the DOM. Keep the existing `connected_at` formatting and its adjacent placement. The profile query is display-only: its state must not participate in binding status, per-tier health queries, or the existing `CanWrite` branches.

This performs one cached organization-profile read, not one lookup per card; the in-memory map avoids repeated linear scans when tiers/cards render. The two-card surface remains responsive through its existing `flex flex-wrap` metadata row; give the identity line `min-w-0 break-words` so a legitimate long display name wraps rather than causing horizontal bleed. Use only existing DESIGN.md typography, foreground/muted-foreground, border, spacing, and radius tokens/classes.

## TDD implementation tasks

1. **Add the resolved-name component proof before production code.**
   - **Files:** `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`
   - Add a module mock for `@/src/hooks/useTasks` exposing `useAssignableProfiles`, and make its default return a settled, successful empty profile list in the test setup so the existing suite never reaches the real auth/repository hook. Add an `AC-ICI-001` test whose active ClickUp binding has a non-person actor token and whose settled profile result contains the same `id` with a readable name. Scope assertions to `[data-tier="clickup"]`: the readable name and existing formatted connection date are present, and the actor token is absent.
   - **Red proof:** `cd pmo-portal && npm test -- src/components/integrations/IntegrationsView.test.tsx` — record the failing `AC-ICI-001` assertion before editing production code.

2. **Add fallback and language proofs before production code.**
   - **Files:** `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`
   - Add `AC-ICI-002` cases for an unmatched actor, a matched profile whose `full_name` is whitespace-only, and a binding without `connected_by`. Each asserts the English fallback `Former or unavailable user`, the existing connection date, and absence of the actor token. Replace the legacy `AC-IRUX-002` assertion that a missing connector produces no line with the new neutral-fallback expectation; #680 deliberately changes that display behavior.
   - Reuse the file's real-catalogue `wrapWithRoleAndLocale` helper to add an Indonesian `AC-ICI-002` assertion for `Pengguna sebelumnya atau tidak tersedia`, and assert the English fallback is not rendered in that locale.
   - **Red proof:** `cd pmo-portal && npm test -- src/components/integrations/IntegrationsView.test.tsx` — record the failing `AC-ICI-002` fallback/localization assertions before editing production code.

3. **Add independent-state and read-only component proofs before production code.**
   - **Files:** `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`
   - Add `AC-ICI-003` table-driven cases where `useAssignableProfiles` is pending and where it is errored. In both, render an active binding with a successful health result and assert the neutral fallback, `Connected`, the existing health text, and the Admin's already-permitted Disconnect control. Assert neither case relabels the binding as unavailable/disconnected or suppresses health.
   - Add `AC-ICI-004` using `Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })` with restoration after the test, an Engineer role, and the Indonesian catalogue. Assert the translated fallback and date are visible inside the card's existing `flex flex-wrap` metadata container and that Connect, Disconnect, and Select Company controls remain absent. This is the deterministic role/copy proof; the rendered pass below owns physical wrapping in both themes.
   - **Red proof:** `cd pmo-portal && npm test -- src/components/integrations/IntegrationsView.test.tsx` — record the failing `AC-ICI-003` and `AC-ICI-004` assertions before editing production code.

4. **Implement the display-only profile resolution and translations.**
   - **Files:** `pmo-portal/src/components/integrations/IntegrationsView.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`
   - Import and call the existing `useAssignableProfiles()` at `IntegrationsView`'s top level. Use `useMemo` to build `Map<string, string>` only while that query is successful and not errored, trimming names and excluding blank values. In the current connected/disconnected metadata block, replace the raw `binding.connected_by` span with an always-rendered `Connected by` line whose value is `connectorNamesById.get(binding.connected_by ?? '') ?? t('integrations.organization.readiness.connectedByUnavailable', 'Former or unavailable user')`; apply `min-w-0 break-words` to that line. Do not alter `binding`, `isConnected`, `isDisconnected`, `healthQueries`, `connectedTiers`, date formatting, or any `CanWrite` branch.
   - Add the `integrations.organization.readiness.connectedByUnavailable` key with exactly `Former or unavailable user` in English and `Pengguna sebelumnya atau tidak tersedia` in Bahasa Indonesia.
   - **Green proof:** `cd pmo-portal && npm test -- src/components/integrations/IntegrationsView.test.tsx && npm run check:i18n`.

5. **Refactor only after the component suite is green, then run bounded static gates.**
   - **Files:** the three files in Task 4 only if a duplicated test fixture or display expression needs simplification; do not create a new hook, repository, endpoint, or visual component.
   - Keep the existing `useAssignableProfiles` query contract, use a typed `Map<string, string>`, and leave all unrelated integration tests/expectations intact. Confirm changed-code coverage is behavior-bearing (resolved, fallback, pending/error, language, and role cases), not snapshot-only.
   - **Verify:** `cd pmo-portal && npm run typecheck && npm run lint:ci && npm test -- src/components/integrations/IntegrationsView.test.tsx`.

6. **Run the rendered Admin Discover pass without operating an integration.**
   - **Files:** no tracked files. Save evidence only under `adws/adw_data/sessions/787dba9a/context_handoff/screenshots/`.
   - Start the local UI on a fixed local port: `cd pmo-portal && npm run dev -- --host 127.0.0.1 --port 4173`. First run exactly `agent-browser skills get core --full`. Using an authenticated existing local Admin test session without reading, printing, saving, or committing credentials/state, open `http://127.0.0.1:4173/administration/integrations`. At `1440x1000`, take an English/light screenshot named `connector-identity-admin-en-light-desktop.png`; select the existing account-menu Dark `menuitemradio`, verify `html.dark` and take `connector-identity-admin-en-dark-desktop.png`.
   - Navigate through the existing Account menu to Profile & preferences, select Bahasa (`id`) in the existing language select, save through the UI, and return to the organization integrations route. At `390x844`, inspect the accessibility snapshot and take `connector-identity-admin-id-dark-phone.png`. Verify the identity label/name-or-fallback and connection date are legible, the metadata wraps within the card without horizontal page overflow, status/health wording remains independent, and no live service handshake, Connect, Disconnect, activation, or retry action is invoked. Restore the local language preference to `inherit` and theme to Light through the same UI before closing the browser.
   - **Verify:** `test -f adws/adw_data/sessions/787dba9a/context_handoff/screenshots/connector-identity-admin-en-light-desktop.png && test -f adws/adw_data/sessions/787dba9a/context_handoff/screenshots/connector-identity-admin-en-dark-desktop.png && test -f adws/adw_data/sessions/787dba9a/context_handoff/screenshots/connector-identity-admin-id-dark-phone.png`.

7. **Render the read-only and failed-profile-read states, and record the portfolio result.**
   - **Files:** no tracked files unless Discover finds a real defect; if it does, add its specific regression assertion to `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` before the fix and record its `/administration/integrations × {mobile@390, state-coverage, job-fit-per-role, WCAG-AA}` matrix cell plus a DESIGN.md/decision note as required by `docs/qa-portfolio.md`.
   - In a fresh `agent-browser` session, authenticate using the existing local read-only fixture without persisting credentials, set `390x844`, and inspect `/administration/integrations` in both Light and Dark. Save `connector-identity-readonly-light-phone.png` and `connector-identity-readonly-dark-phone.png`; confirm readable identity/date and absence of management controls. In a separate local-dev Admin session, before navigation run `agent-browser network route '**/rest/v1/profiles*' --abort`, then render the same route and save `connector-identity-profile-error.png`; confirm the neutral fallback while the independently derived binding/health state and its permitted controls stay truthful. The component `AC-ICI-003` pending case is the canonical proof for the visually identical pending fallback; do not add a loading indicator merely to manufacture a different screenshot.
   - Close every browser session and remove any temporary auth-state file if the local setup created one. Do not create or commit screenshots, auth state, service data, or a claimed live transfer result.
   - **Verify:** `test -f adws/adw_data/sessions/787dba9a/context_handoff/screenshots/connector-identity-readonly-light-phone.png && test -f adws/adw_data/sessions/787dba9a/context_handoff/screenshots/connector-identity-readonly-dark-phone.png && test -f adws/adw_data/sessions/787dba9a/context_handoff/screenshots/connector-identity-profile-error.png`.

8. **Run the full local gate, review scope, and commit only issue work.**
   - **Files:** no new production files. Review the diff so it contains only the integration component, its component test, both locale catalogues, and this issue's plan/evidence-free documentation; do not alter auth, policy, RLS, migrations, repository/DAL, readiness/health logic, package lock, or service code.
   - Run the factory's type/lint/Vitest gate as an inner-loop result and then the binding full local gate; report each command's actual exit status and any failure without weakening/skipping a test: `cd pmo-portal && npm run verify:locked`. Do not push, open a PR, merge, deploy, run a live handshake, or claim one. After all required checks are green, commit the scoped issue changes, including the issue plan if it remains uncommitted, with an imperative subject such as `Show readable connector identities`; verify `git status --short` is empty.

## Acceptance traceability

| Acceptance criterion | Owning proof | Tasks |
|---|---|---|
| AC-ICI-001 | `IntegrationsView.test.tsx` resolved same-org profile/name, preserved date, no actor token | 1, 4, 5 |
| AC-ICI-002 | `IntegrationsView.test.tsx` unmatched/blank/missing profile fallback in English and Bahasa, no actor token | 2, 4, 5 |
| AC-ICI-003 | `IntegrationsView.test.tsx` pending/error profile read preserves binding, health, and allowed actions | 3, 4, 5; rendered failed-query check in 7 |
| AC-ICI-004 | `IntegrationsView.test.tsx` Engineer/Bahasa/390 assertions plus agent-browser read-only desktop/phone/theme review | 3, 6, 7 |

## Scope fences

- Preserve `connected_by` and `connected_at` storage/audit semantics; this issue changes display resolution only.
- The list source is already organization-scoped through the repository and RLS. Do not pass an organization id from the client or add an identity-management surface.
- Do not change role policy, availability/readiness wording, binding lifecycle, health fetching, actions, service calls, schema, migrations, RLS, or auth.
- No e2e test is added: every #680 acceptance criterion is owned at the lowest sufficient component layer. The rendered Discover pass is evidence and does not replace those deterministic tests.
