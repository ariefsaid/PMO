# Plan — Administration information architecture coherence

**Spec:** [`docs/specs/administration-ia-coherence.spec.md`](../specs/administration-ia-coherence.spec.md)  
**Design authority:** [`DESIGN.md`](../../DESIGN.md) and [`docs/design/2026-09-26-enterprise-coherence-brief.md`](../design/2026-09-26-enterprise-coherence-brief.md)  
**Scope:** route the existing Administration capabilities into coherent, bookmarkable destinations. Preserve every existing permission, repository, server gate, data contract, and panel state. This plan does not implement the account menu, personal Microsoft 365 route, new authorization, or a new visual identity.

## Design contract

### Job and outcome

An organization Admin who opens Administration should immediately understand that it is the home for organization setup and governance. They should be able to manage one job at a time, bookmark that job, return to it with Back/Forward, and see the next permitted action beside the relevant state. A platform Operator gets the additional Usage and Features destinations without making those panels visible or queryable to an org Admin.

The surface is an **Operate** workflow. Information architecture and task completion take precedence over decorative motion. The current “Quiet Control Surface” identity remains authoritative; the work is structural and behavioral.

### Canonical route model

Use route paths as the single source of truth. The selected destination, breadcrumb, heading, document title if present, and visible panel must derive from the same route segment.

| Destination | Canonical URL | Audience | Existing panel(s) | Primary job |
|---|---|---|---|---|
| Users | `/administration/users` | Admin; existing Executive read-only access remains | `AdminUsers` user directory | Invite, edit role/manager, disable/re-enable, or review members |
| Organization integrations | `/administration/integrations` | Administration viewers; writes remain `CanWrite`/server gated | `IntegrationsView` and `M365OrgApprovalCard` | Connect, activate, verify, or disconnect organization services |
| Accounting setup | `/administration/accounting` | Administration viewers; existing accounting gates remain | `OrgTaxDefault` and `BudgetAccountMap` | Set tax default and map budget categories to ERP accounts |
| Credits | `/administration/credits` | Administration viewers; Operator grant remains Operator-only | `AdministrationCredits` | Review the organization pool; Operator grants credits |
| Usage | `/administration/usage` | Operator only | `AgentCostMetrics` and `AdministrationUsage` | Review aggregate platform usage and cost |
| Features | `/administration/features` | Operator only | `AdministrationFeatures` | Toggle organization entitlements |

Compatibility behavior:

- `/administration` redirects with `replace` to `/administration/users`.
- `/administration#budget-account-map` redirects with `replace` to `/administration/accounting#budget-account-map` and preserves the fragment so the map remains the deep-link target.
- An unknown Administration section is caught by the Administration section fallback route, then redirects with `replace` to `/administration/users`; it does not fall through to the global `*` route or mount an unrelated panel.
- `/integrations` remains the personal Microsoft 365 connection home. Its page heading and supporting copy must identify it as **My integrations** or **Personal integrations** in the user-visible copy; it must not be merged with `/administration/integrations`.
- Existing accounting links, especially `pmo-portal/pages/BudgetProjection.tsx`, must target `/administration/accounting#budget-account-map` after the new route exists.

### Persona and authorization matrix

This matrix describes rendered affordances, not server authority. RLS, RPCs, edge functions, and existing `CanWrite` gates remain the enforcement layer.

| State | Route shell | Visible destinations | Panel behavior |
|---|---|---|---|
| Org Admin, non-Operator | Allowed | Users, Organization integrations, Accounting setup, Credits | Full existing Admin writes; Credits balance is visible and grant is absent; Usage/Features are absent and direct URLs render a blocked state without mounting those panels |
| Platform Operator | Allowed | All six destinations | Existing User/Integration/Accounting gates remain intact; Operator-only grant, Usage, and Feature controls remain available; every write still uses its existing server path |
| Executive | Existing route access preserved | Existing non-Operator destinations only | Existing read-only Users behavior and existing read-only panel behavior remain; no Operator-only panel or action is introduced |
| Project Manager, Finance, Engineer, or unresolved role | Existing Admin gate | None | Render the existing blocked `GateNotice`; do not mount Administration queries or panels |
| Operator query pending on an Operator-only URL | Stable shell state | Do not claim access or denial yet | Show the shell/panel loading state until the operator membership query settles; fail closed after a settled negative result |

The role preview control remains governed by its existing demo-only eligibility and real-role rules. This IA change must not make a previewed role appear to own or unlock Administration writes.

### Layout and interaction model

1. `Administration` is the only page-level `h1`. The shell description says “Organization setup and governance” (or the equivalent translated copy), not “Manage users,” because the page owns multiple jobs.
2. A route-backed section navigation appears directly below the page heading. It is rendered as a native `nav` containing links, visually styled with the existing `seg` inline segmented-control pattern. Native links are intentional: each item is a deep link and browser history target, so no fake `role="tab"` state machine is needed. The current item uses `aria-current="page"`, the `primary/10` active wash, `nav-active-text`, and `font-semibold`.
3. The four organization destinations are ordered Users, Organization integrations, Accounting setup, Credits. Operator-only Usage and Features follow them in a visually separated but same-level continuation. The Operator sees the same order on every route; an org Admin never sees a blank or disabled Operator tab.
4. Only the selected panel mounts. This prevents unrelated tables, health queries, usage RPCs, feature toggles, and modals from competing for attention or firing on every Administration visit.
5. The shell keeps the existing content-over-containers grammar: `background`/`secondary` canvas, `card` only where a panel earns a container, `border` hairlines, and whitespace between sections. Use the existing `PageHeader`/`SectionHeader`, `ListState`, `DataTable`, `Card`, `Button`, `StatusPill`, `GateNotice`, and form primitives. Do not add a second card, toolbar, tab, or status grammar.
6. Route changes rely on the existing AppShell focus-on-route-change behavior. The selected panel begins with a meaningful heading and the main landmark receives focus. The legacy budget fragment additionally focuses or scrolls the `#budget-account-map` section after Accounting has mounted, without trapping focus.
7. Back and Forward are ordinary router navigation. Do not use local selected-tab state, `location.replace`, or a tab click that mutates the URL without adding a history entry. The `/administration` and legacy-fragment aliases use `replace` so compatibility redirects do not add duplicate history entries.

### DESIGN.md token contract

Every implementation decision below names an existing token or molecule:

| Surface piece | Required tokens/patterns |
|---|---|
| Page canvas and shell | `background`, `secondary`, `foreground`, `muted-foreground`, `border`, `card`; content-over-containers and flat-by-default rules |
| Route navigation | `seg` inline segmented-control pattern; `secondary` track; `background` selected item; `primary/10` active wash; `nav-active-text`; `rounded.lg`/`rounded.md`; `base` spacing; global `ring` focus |
| Page heading and copy | `page-title`, `heading`, `body`, `label`, `overline`; `foreground` and `muted-foreground` |
| Panel frames | `card`, `card-foreground`, `border`, `rounded.lg`, standard `card` padding; no rest shadow |
| Actions | `button-primary`, `button-outline`, `button-ghost`, `button-destructive`; the existing `h-8` control-height token; one primary action per selected surface |
| Status and permission states | `badge-status`, `secondary`, `muted-foreground`, `success-text`, `warning-foreground`, `destructive-text`; status dot/ring plus label; never color alone |
| Inputs and search | `input`, `background`, `foreground`, `border`, `rounded.lg`, global `ring`; existing `SelectField`, `Combobox`, `TextField`, and `SearchMini` |
| Tables and lists | `table-header-cell`, `table-body-cell`, `DataTable`, `ListState`, `tabular` figures; existing table-to-card reflow at `table-reflow` |
| Responsive shell | `rail-w` and `header-h`; existing `rail-collapse` behavior; `table-reflow`; `base` spacing scale; `min-w-0` and existing mobile gutters |
| Motion | `ds-ease`; only cause-and-effect route/panel transitions; honor `prefers-reduced-motion` |

No raw hex, new font, new radius, new border color, new blue, custom shadow, or decorative animation is part of this plan. If a required state cannot be represented by the existing tokens, stop and record the gap for owner sign-off instead of inventing one.

## State and edge contract

The shell and each selected panel must state every meaningful state. “Nothing rendered” is not a state.

| Surface | Required visible states and recovery |
|---|---|
| Shell | Route/lazy loading skeleton matching the page head; settled selected route; unknown-section redirect; blocked permission gate; Operator-membership pending; Operator-only denied direct URL |
| Users | Loading skeleton; no users; no search matches; load error + retry; Executive read-only notice; Admin/Operator action pending; invite/edit/disable error beside the originating dialog; success feedback; disabled/re-enabled rows |
| Organization integrations | Status loading; status error while retaining safe available actions; no binding; connecting; active; disconnected/reconnect; ERPNext connected-but-not-activated; health unavailable/degraded; last-sync/error count; company/list/binding empty and error states; read-only viewer; mutation pending/error/success |
| Accounting setup | Tax default loading/error/read-only/saved/error; budget map loading/error/empty/read-only/editing/saving/save failure/delete confirmation/delete failure; fragment target reachable after load |
| Credits | Balance loading; balance error + retry; known zero and positive balances with unit; org Admin read-only; Operator grant dialog idle/validation/pending/success/error; modal close/unsaved-change behavior |
| Usage | Operator-only pending; results; no usage yet; RPC error + retry; null pricing/margin explanation; aggregate-only content; no panel/query for org Admin |
| Features | Operator-only loading; enabled/disabled switches; toggle pending; toggle error with retry or remedy; settled success; no panel/query for org Admin |
| Personal integrations route | Personal connection loading, disconnected, connecting, connected, degraded/error, and recovery copy remain on `/integrations`; organization route copy must not imply a personal connection grants organization readiness |

Existing panel tests are the authority for data and mutation outcomes. The implementation should move those panels behind routes without weakening their current assertions or replacing errors with a generic toast.

## Responsive behavior

- At the existing `rail-collapse` breakpoint, the Administration route remains a normal page inside the AppShell mobile drawer model. Do not introduce a second navigation drawer.
- Below `table-reflow`, route links use a wrapped, two-column navigation layout sized by the `seg` and `nav-item` patterns. All six Operator links must be reachable without page-level horizontal scrolling; four org-Admin links must not leave an empty column or clipped label.
- At the 390px verification viewport, the page heading, section navigation, selected panel heading, and first meaningful action/state remain visible in the first scroll region. Long labels wrap or use the existing truncation strategy with an accessible full label; they must not force the page wider than the viewport.
- At desktop/tablet widths, keep the navigation inline and let the selected panel use its existing full table/card layout. Do not make the entire Administration page a nested scrolling region.
- Existing `DataTable` stacked-card behavior at `table-reflow` remains the table contract. Integration metadata and action rows wrap using `min-w-0` and the base spacing scale. Any legitimate table scroller must be scoped to the table frame and keyboard focusable; the page itself must not pan horizontally.
- Test light and dark themes at desktop and the 390px viewport. Active navigation, borders, inputs, statuses, and focus indicators must remain distinguishable using the paired `DESIGN.md` tokens.

## WCAG-AA and keyboard contract

- Use the existing global `focus-visible` ring (`ring`) on every route link, button, input, switch, table scroller, and fragment target.
- Use a labelled `<nav>` for the section links and `aria-current="page"` for the active URL. Do not use `aria-selected` without a real `role="tablist"`/`role="tab"` implementation. If a future implementation chooses ARIA tabs, it must add the complete roving-focus, Arrow-key, Home/End, Enter/Space, and panel `aria-controls` contract with tests.
- DOM order follows the visual task order: heading/description → Administration section nav → selected panel heading → status/description → primary action → content. The route change moves focus to `main` via AppShell; the first heading is discoverable without a second focus jump.
- Every icon-only control has an accessible name through the existing icon/button conventions. Visible labels remain present for form controls; placeholders never act as labels.
- Permission and status meaning is expressed by text plus the existing dot/ring or icon. Do not rely on active color, switch color, or status color alone.
- Errors use the existing `ListState`, inline field error, `GateNotice`, or persistent modal error patterns with a recovery action. Pending controls are semantically disabled and expose truthful saving/loading text.
- Confirm destructive disconnect/disable/delete actions with the existing `ConfirmDialog`; keep `Escape`, visible close, focus restore, and background inert behavior owned by the existing dialog primitive.
- Verify normal text and control boundaries against the existing light/dark AA token pair. Do not introduce a local focus color or ad hoc contrast fix.
- Preserve the skip link, AppShell route-focus behavior, browser back/forward, and mobile drawer focus trap. No keyboard-only path should require hover.

## Test ownership and traceability

| Requirement/criterion | Owning proof | Supporting proof |
|---|---|---|
| FR/AC-ADMIA-001 | `pmo-portal/e2e/AC-ADMIA-001-administration-navigation.spec.ts` (read-only cross-route journey) | `AdministrationShell.test.tsx` selected URL/heading/panel assertions |
| FR/AC-ADMIA-002 | `pmo-portal/pages/AdministrationShell.test.tsx` (component/route guard) | existing Operator/permission tests; direct URLs assert no Operator panel/query mounts |
| FR/AC-ADMIA-003 | `pmo-portal/App.routes.test.tsx` and `routeMatch` tests | `BudgetProjection.test.tsx` exact canonical map href |
| FR/AC-ADMIA-004 | `pmo-portal/e2e/AC-ADMIA-001-administration-navigation.spec.ts` | breadcrumb unit tests and AppShell route-focus test touchpoint |
| FR/AC-ADMIA-005 | `pmo-portal/e2e/AC-ADMIA-005-administration-mobile.spec.ts` (desktop + 390px rendered assertions) | `AdministrationShell.test.tsx` responsive class/semantic assertions; existing `axe` coverage updated to the shell |
| FR/AC-ADMIA-006 | `pmo-portal/pages/Integrations.test.tsx` and `IntegrationsView.test.tsx` | visible owner copy assertions for personal versus organization routes |
| Existing panel contracts | Existing `AdminUsers`, `AdministrationCredits`, `AdministrationUsage`, `AdministrationFeatures`, `BudgetAccountMap`, `OrgTaxDefault`, and `IntegrationsView` tests | route-specific mount tests ensure unrelated panels are not rendered |
| Accessibility and state coverage | `pmo-portal/pages/__tests__/Administration.a11y.test.tsx` updated to render each selected route/persona | `axe` at desktop and 390px; keyboard tab/back/fragment checks |

The new read-only e2e specs must carry the first-line isolation tag required by `docs/e2e-parallel-conventions.md`. If the implementation later adds shared-seed writes to the route journey, move that spec to `serial` and document the reason; do not gate it on `process.env.CI`.

Because `appRouteConfig` gains six canonical child routes, update the explicit route denominator in `docs/qa-portfolio.md` in the same code PR. Add the six Administration routes (or the exact route set emitted by the final route table) and cover each affected route with the `state-coverage`, `cross-screen consistency`, `a11y`, and `mobile@390` oracles.

## TDD implementation tasks

All paths are repo-root-relative unless the command begins with `cd pmo-portal`. Re-read each file before editing, preserve concurrent changes, and stage only the implementation paths named by the task.

### Task 1 — lock the route contract and breadcrumb expectations first (RED)

**AC coverage:** AC-ADMIA-001, AC-ADMIA-003, AC-ADMIA-004.

Edit these tests before production code:

- `pmo-portal/App.routes.test.tsx`: assert `/administration`, `/administration/users`, `/administration/integrations`, `/administration/accounting`, `/administration/credits`, `/administration/usage`, and `/administration/features` resolve to real route elements; assert `/administration/unknown` resolves to the Administration section fallback rather than the global `*` catch-all.
- `pmo-portal/src/components/shell/__tests__/breadcrumb-nav.test.ts`: add expected `[Administration → Users]`, `[Administration → Organization integrations]`, `[Administration → Accounting setup]`, `[Administration → Credits]`, `[Administration → Usage]`, and `[Administration → Features]` results, with the parent crumb navigating to `/administration/users`.
- `pmo-portal/src/components/shell/__tests__/routeMatch.test.ts`: add exact route-prefix matching tests so `/administration/usage` does not collapse to the Users crumb and unknown sections resolve to the Users destination.
- `pmo-portal/src/lib/analytics/route.test.ts`: assert child paths normalize to a safe `/administration/:section` route and module `administration`, without leaking IDs, query values, or fragment text.

**Verify RED:**

```bash
cd pmo-portal && npx vitest run App.routes.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts src/components/shell/__tests__/routeMatch.test.ts src/lib/analytics/route.test.ts
```

The new assertions must fail because the child route table, breadcrumb mapping, and analytics normalization do not exist yet. Do not make the test pass by weakening it to assert only that `/administration` exists.

### Task 2 — lock the shell persona and mount contract first (RED)

**AC coverage:** AC-ADMIA-001, AC-ADMIA-002, AC-ADMIA-004.

Create `pmo-portal/pages/AdministrationShell.test.tsx` with mocked repository/query hooks and a `MemoryRouter`. Add tests for:

1. org Admin: four organization links are present, Users is selected at `/administration/users`, only the Users panel marker is mounted, and the other panel markers/queries are absent;
2. Operator: all six links are present, Usage and Features mount only at their own paths, and a direct Operator URL never renders the Users panel in addition to the requested panel;
3. non-Operator direct `/administration/usage` and `/administration/features`: a blocked/denied state is visible and the Operator panel marker/query is absent;
4. Executive: the existing user-directory read-only notice remains available and no new write affordance appears;
5. unknown section: the router replaces it with Users; and
6. browser Back/Forward changes the selected URL and panel without stale local tab state.

Use stable `data-testid` values only for route/panel ownership (`administration-panel-users`, `administration-panel-integrations`, `administration-panel-accounting`, `administration-panel-credits`, `administration-panel-usage`, `administration-panel-features`). Do not assert implementation-specific class names.

**Verify RED:**

```bash
cd pmo-portal && npx vitest run pages/AdministrationShell.test.tsx
```

### Task 3 — implement the route-backed Administration shell (GREEN)

**AC coverage:** AC-ADMIA-001, AC-ADMIA-002, AC-ADMIA-004.

Create `pmo-portal/pages/Administration.tsx` and edit `pmo-portal/App.tsx`:

- Move the page-level Administration heading/description and route section navigation into the shell. Keep the selected-panel wrapper responsible for the stable panel marker and route-derived heading.
- Map each canonical section to exactly one existing panel composition. Extract the Users directory from `AdminUsers.tsx` only as needed; do not duplicate user mutation logic or change its existing `can()`/Operator gates.
- Use a route segment lookup, not a local `useState`, and redirect aliases with `<Navigate replace>`. Preserve `#budget-account-map` only for the legacy fragment redirect.
- Keep the route-level authorization fail-closed. A non-Admin/non-Executive/non-Operator receives the existing `GateNotice`; a non-Operator at Usage/Features receives a visible denial state without mounting those panels.
- Expose a pending operator-membership state so a real Operator does not briefly see a false denial on a direct Operator URL. Extend `pmo-portal/src/auth/useIsOperator.ts` only if the current boolean hook cannot expose the query state cleanly; retain the existing boolean API for current callers.
- Use the existing `SectionHeader`, `PageHeader`/page-title tokens, `ListState`, and panel components. The shell owns headings; child panels must not create a second page-level `h1`.

**Verify GREEN:**

```bash
cd pmo-portal && npx vitest run pages/AdministrationShell.test.tsx
```

### Task 4 — wire the complete route table, breadcrumbs, and analytics (GREEN)

**AC coverage:** AC-ADMIA-001, AC-ADMIA-003, AC-ADMIA-004.

Edit:

- `pmo-portal/App.tsx`: add the lazy Administration shell, the six canonical child routes, and an `/administration/:section` fallback before the global catch-all; keep `/administration` as the compatibility redirect entry.
- `pmo-portal/src/components/shell/routeMatch.ts`: add the child-section labels and parent/child breadcrumb links; keep `Administration` in the module map so rail and ⌘K remain one top-level destination.
- `pmo-portal/src/lib/analytics/route.ts`: normalize canonical child sections to `module: 'administration'` and a safe section/tab identifier, preserving the existing top-level `/administration` event shape where compatibility requires it.
- `pmo-portal/App.routes.test.tsx`, `pmo-portal/src/components/shell/__tests__/breadcrumb-nav.test.ts`, `pmo-portal/src/lib/analytics/route.test.ts`: make the new route assertions green without deleting the old `/administration` compatibility proof.

The breadcrumb parent must link to `/administration/users`, not the redirect alias, so keyboard and screen-reader users do not take an unnecessary second route transition.

**Verify GREEN:**

```bash
cd pmo-portal && npx vitest run App.routes.test.tsx src/components/shell/__tests__/breadcrumb-nav.test.ts src/components/shell/__tests__/routeMatch.test.ts src/lib/analytics/route.test.ts
```

### Task 5 — split the existing all-in-one render without changing panel behavior

**AC coverage:** AC-ADMIA-004; regression support for AC-ADMIA-001/002/006.

Edit `pmo-portal/pages/AdminUsers.tsx` and the existing Administration panel files:

- Keep `AdminUsers.tsx` responsible for the Users directory, its loading/empty/error/filtered-empty states, Executive gate, invite/edit/manager/status dialogs, and existing mutation feedback.
- Remove the Credits, Usage, Features, organization Integrations, tax, and budget-map sections from the Users panel render so visiting Users does not fetch or mount unrelated surfaces.
- Let `Administration.tsx` compose `AdministrationCredits`, `AdministrationUsage`, `AdministrationFeatures`, `IntegrationsView`, `OrgTaxDefault`, and `BudgetAccountMap` on their canonical routes with their existing props and server gates.
- Preserve `pmo-portal/pages/AdministrationCredits.tsx`, `AdministrationUsage.tsx`, `AdministrationFeatures.tsx`, `pmo-portal/src/components/integrations/IntegrationsView.tsx`, `pmo-portal/pages/admin/OrgTaxDefault.tsx`, and `pmo-portal/pages/admin/BudgetAccountMap.tsx` behavior. Refactor only the wrapper/heading needed for a single selected panel.
- Update existing full-composed tests (`pmo-portal/pages/__tests__/Administration.a11y.test.tsx`, `Administration.sectionHeaders.test.tsx`, `Administration.operatorGate.test.tsx`, and related tests) to render the shell at the relevant canonical route or the individual panel, preserving their state/action assertions.

**Verify:**

```bash
cd pmo-portal && npx vitest run pages/AdminUsers.test.tsx pages/__tests__/AdminUsers.heading.test.tsx pages/__tests__/AdminUsers.disable.test.tsx pages/__tests__/AdminUsers.selfedit.test.tsx pages/__tests__/Administration.a11y.test.tsx pages/__tests__/Administration.operatorGate.test.tsx pages/__tests__/Administration.sectionHeaders.test.tsx pages/AdministrationCredits.saveError.test.tsx
```

### Task 6 — make the navigation and copy coherent in both locales

**AC coverage:** AC-ADMIA-001, AC-ADMIA-006 and the brief’s English/Bahasa requirement.

Edit:

- `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json`: add Administration section labels, description, route denial copy, organization-versus-personal integration ownership copy, and pending/recovery labels. Keep existing panel translations unchanged unless a new shell heading currently falls back to English.
- `pmo-portal/src/lib/i18n/launch-scope-routes.txt`: add every canonical Administration route and retain `/integrations` so completeness checks cover both ownership surfaces.
- `pmo-portal/pages/Integrations.tsx`: label the personal route as personal in the heading/description while keeping its route and callback query handling unchanged.
- `pmo-portal/src/components/integrations/IntegrationsView.tsx`: label the organization panel’s scope and next permitted action without changing credential, Vault, health, Company, or binding behavior.
- `pmo-portal/pages/AdministrationShell.test.tsx` and `pmo-portal/pages/Integrations.test.tsx`: assert the scope labels are present and do not imply that a personal connection makes the organization ready.

**Verify:**

```bash
cd pmo-portal && npx vitest run pages/AdministrationShell.test.tsx pages/Integrations.test.tsx src/components/integrations/IntegrationsView.test.tsx && npm run check:i18n
```

### Task 7 — repair canonical accounting entry points and fragment focus

**AC coverage:** AC-ADMIA-003, AC-ADMIA-004.

Edit:

- `pmo-portal/pages/BudgetProjection.tsx`: change `ACCOUNT_MAP_HREF` to `/administration/accounting#budget-account-map`.
- `pmo-portal/pages/BudgetProjection.test.tsx`: assert the exact accounting route and fragment, not merely a string containing `/administration`.
- `pmo-portal/pages/admin/BudgetAccountMap.tsx`: preserve `id="budget-account-map"`; add the existing focus/scroll target behavior only if the route-mounted panel needs it, using the global `ring` and no new visual token.
- `pmo-portal/pages/AdministrationShell.test.tsx`: open `/administration#budget-account-map`, assert the final URL/selected Accounting link and target visibility, and assert `/administration` without a fragment selects Users.

**Verify:**

```bash
cd pmo-portal && npx vitest run pages/BudgetProjection.test.tsx pages/admin/BudgetAccountMap.test.tsx pages/AdministrationShell.test.tsx
```

### Task 8 — lock responsive and WCAG-AA behavior at the component layer (RED → GREEN)

**AC coverage:** AC-ADMIA-005 plus the cross-cutting accessibility requirements.

Edit `pmo-portal/pages/AdministrationShell.test.tsx` and `pmo-portal/pages/__tests__/Administration.a11y.test.tsx` before changing responsive markup:

- Assert the section navigation is a labelled native `nav`, each destination is a keyboard-focusable link, the active destination has `aria-current="page"`, and DOM order matches heading → nav → selected panel.
- Assert no fake tab semantics are emitted unless the full ARIA tab contract is implemented.
- Assert Operator-only routes expose a named denial/pending state without mounting their panel for an org Admin.
- Run `axe` for org Admin and Operator at desktop and 390px. Keep existing blocking-violation policy and advisory reporting.
- Add a keyboard test for Tab through the section links, Enter activation, route-change focus on `main`, Escape/close behavior for any open dialog, and focus restoration after a modal.

Implement the narrow layout with existing `seg`, `nav-item`, `base`, `rail-collapse`, `table-reflow`, `min-w-0`, `card`, `border`, `background`, and `ring` tokens. Do not add a horizontal page scroller. Keep existing `DataTable` reflow and legitimate table scrollers scoped to the table frame.

**Verify:**

```bash
cd pmo-portal && npx vitest run pages/AdministrationShell.test.tsx pages/__tests__/Administration.a11y.test.tsx src/components/shell/__tests__/AppShell.test.tsx src/components/shell/__tests__/AppShell.mobile.test.tsx
```

### Task 9 — add the curated cross-route journey and mobile oracle

**AC coverage:** owns AC-ADMIA-001, AC-ADMIA-004, and AC-ADMIA-005 at the cross-stack/rendered layer.

Create:

- `pmo-portal/e2e/AC-ADMIA-001-administration-navigation.spec.ts` with first-line `// @e2e-isolation: read-only`. Sign in as the seeded Admin, open `/administration`, verify Users, visit Organization integrations → Accounting setup → Credits, assert URL/heading/selected link/visible panel coherence, use browser Back to restore the previous section, and open the legacy budget-map fragment to verify the Accounting target is reachable. No external credential or connection action belongs in this read-only journey.
- `pmo-portal/e2e/AC-ADMIA-005-administration-mobile.spec.ts` with first-line `// @e2e-isolation: read-only`. At desktop and the 390px viewport, verify every Admin link is reachable, the selected panel remains visible, and the page has no element-right-edge overflow outside the viewport. Repeat the route shell in dark mode if the existing visual harness supports it.

Use dependency-based setup and existing sign-in helpers. Never gate on `process.env.CI`. If the journey needs shared-seed writes later, change its isolation class to `serial` and record the owner of the row before editing the test.

**Verify:**

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && cd pmo-portal && npm run e2e:parallel -- e2e/AC-ADMIA-001-administration-navigation.spec.ts e2e/AC-ADMIA-005-administration-mobile.spec.ts'
```

### Task 10 — update the QA route denominator and complete the design Discover handoff

**AC coverage:** portfolio traceability and the design/UI Definition of Done.

Edit `docs/qa-portfolio.md` in the route denominator and affected-oracle notes:

- Derive the final Administration routes from `pmo-portal/App.tsx` rather than typing from memory.
- Add the canonical Administration child routes and state that the alias is compatibility-only.
- Mark the affected cells for action-completeness, state-coverage, cross-screen consistency, WCAG-AA, mobile@390, and job-fit-per-role.

After implementation, run one rendered Discover pass on the rich Admin seed at desktop and 390px using the project’s design-review workflow. Graduate every finding into a deterministic test, a `routes × oracles` cell, and a `DESIGN.md`/decision note before merge. This pass is read-only on source until a finding is accepted into the implementation; it must not create a second visual system.

### Task 11 — focused regression, full verification, and handoff

Run the focused suite, inspect the changed file set, then run the binding full suite. Do not open a PR or push from this plan.

```bash
cd pmo-portal && npx vitest run \
  pages/AdministrationShell.test.tsx \
  pages/AdminUsers.test.tsx \
  pages/__tests__/Administration.a11y.test.tsx \
  pages/__tests__/Administration.operatorGate.test.tsx \
  pages/__tests__/Administration.sectionHeaders.test.tsx \
  pages/Integrations.test.tsx \
  pages/BudgetProjection.test.tsx \
  pages/admin/BudgetAccountMap.test.tsx \
  App.routes.test.tsx \
  src/components/shell/__tests__/breadcrumb-nav.test.ts \
  src/components/shell/__tests__/routeMatch.test.ts \
  src/lib/analytics/route.test.ts \
  src/components/integrations/IntegrationsView.test.tsx && npm run check:i18n
git diff --check
git status --short
```

Then run the full shared-machine gate from the repository root:

```bash
cd pmo-portal && npm run verify:locked
```

For a PR targeting `main`, the Director must additionally run `scripts/verify-main-pr.sh` from the repo root. The implementation PR must leave the existing data/authorization tests green, add no migration or credential changes, and include only the planned route, shell, translation, test, QA-denominator, and this plan paths.

## Expected implementation file set

### New

- `pmo-portal/pages/Administration.tsx`
- `pmo-portal/pages/AdministrationShell.test.tsx`
- `pmo-portal/pages/Integrations.test.tsx`
- `pmo-portal/e2e/AC-ADMIA-001-administration-navigation.spec.ts`
- `pmo-portal/e2e/AC-ADMIA-005-administration-mobile.spec.ts`

### Existing files expected to change

- `pmo-portal/App.tsx`
- `pmo-portal/App.routes.test.tsx`
- `pmo-portal/pages/AdminUsers.tsx`
- `pmo-portal/pages/Integrations.tsx`
- `pmo-portal/pages/BudgetProjection.tsx`
- `pmo-portal/pages/BudgetProjection.test.tsx`
- `pmo-portal/pages/admin/BudgetAccountMap.tsx` and its test only if fragment focus requires it
- `pmo-portal/pages/__tests__/Administration.a11y.test.tsx`
- `pmo-portal/pages/__tests__/Administration.operatorGate.test.tsx`
- `pmo-portal/pages/__tests__/Administration.sectionHeaders.test.tsx`
- `pmo-portal/src/components/integrations/IntegrationsView.tsx` and its tests
- `pmo-portal/src/components/shell/routeMatch.ts`
- `pmo-portal/src/components/shell/__tests__/breadcrumb-nav.test.ts`
- `pmo-portal/src/components/shell/__tests__/routeMatch.test.ts`
- `pmo-portal/src/lib/analytics/route.ts` and its test
- `pmo-portal/src/auth/useIsOperator.ts` and its test only if pending membership state is added
- `pmo-portal/public/locales/en/common.json`
- `pmo-portal/public/locales/id/common.json`
- `pmo-portal/src/lib/i18n/launch-scope-routes.txt`
- `docs/qa-portfolio.md`

No source file outside this list should change without a new spec/decision. No schema, RLS, edge-function, Vault, credential, or deployment change is part of this IA slice.
