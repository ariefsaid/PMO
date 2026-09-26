# Administration information architecture — spec

**Status:** active UX program, 2026-09-26. **Design authority:** `docs/design/2026-09-26-enterprise-coherence-brief.md`, `DESIGN.md`, and the existing organization-integration ownership decisions. This issue reorganizes where existing administration work appears; it does not change who may perform any action.

## Job story

When I administer my organization, I want separate, bookmarkable places for members, service connections, accounting setup, and credits so I can finish one setup task and return to it without searching through an unrelated long page.

## Current behavior and decision

`/administration` currently mounts the Users directory, Credits, organization Integrations, tax default, and budget account map in one page; Operator-only Usage and Features also mount there. The page introduction describes user management even though the route now owns several jobs. Personal Microsoft 365 connection intentionally lives at `/integrations` for every entitled member. This issue preserves that distinction and labels the two scopes clearly.

Use a route-backed Administration shell with tabs for Users, Organization integrations, Accounting setup, and Credits. Operators additionally receive Usage and Features. The old `/administration` URL remains an entry alias to Users; a historical `#budget-account-map` deep link resolves to Accounting setup. Each child route has one active tab and a matching breadcrumb. Only its selected panel mounts, so unrelated setup content and queries do not occupy the screen.

## Requirements

- **FR-ADMIA-001:** While an organization Admin is in Administration, the application shall expose Users, Organization integrations, Accounting setup, and Credits as distinct destinations, each with a stable URL and one active tab.
- **FR-ADMIA-002:** While an Operator is in Administration, the application shall additionally expose Usage and Features. While the caller is not an Operator, those destinations shall not appear, and a direct URL shall not render their panels.
- **FR-ADMIA-003:** When a user opens `/administration`, the application shall resolve to the Users destination. When a user opens the historical budget-account-map fragment, the application shall resolve to Accounting setup with the map reachable.
- **FR-ADMIA-004:** When a user selects an Administration destination, the URL, breadcrumb, heading, and selected tab shall describe the same location; browser Back/Forward shall restore the prior destination.
- **FR-ADMIA-005:** While Users is selected, the existing directory, invitation, role, manager, and status actions shall remain reachable with their current authorization and feedback.
- **FR-ADMIA-006:** While Organization integrations is selected, the existing organization connection, approval, company, and binding controls shall remain reachable with their current authorization and states. The personal Microsoft 365 connection shall remain at `/integrations` and be labelled as personal.
- **FR-ADMIA-007:** While Accounting setup is selected, the existing tax default and budget-to-account mapping shall remain reachable with their current authorization and states.
- **FR-ADMIA-008:** While Credits is selected, the existing balance and permitted grant controls shall remain reachable with their current authorization and states.
- **FR-ADMIA-009:** At phone widths, the Administration navigation shall remain readable and operable without horizontal page overflow; keyboard users shall be able to identify and activate the selected destination.

## Acceptance criteria

- **AC-ADMIA-001 (cross-stack):** Given an org Admin on `/administration`, when the page settles, then Users is selected and the user directory is visible; when they choose Organization integrations, Accounting setup, and Credits in turn, each URL, heading, and visible panel changes coherently, and browser Back restores the prior selection.
- **AC-ADMIA-002 (component/route):** Given an org Admin, when Administration renders, then Usage and Features are absent; opening either URL directly shows the existing denied behavior and does not mount those panels. Given an Operator, both destinations are visible and their existing content mounts.
- **AC-ADMIA-003 (route):** Given an old link to `/administration#budget-account-map`, when it opens, then Accounting setup becomes active and the mapping control is reachable without losing the fragment target.
- **AC-ADMIA-004 (regression):** Given each Administration destination, when its existing action is exercised, then its prior role, validation, status, and persistence contract still holds. Existing tests retain their outcome assertions and update only navigation steps changed by this issue.
- **AC-ADMIA-005 (rendered):** Given desktop and 390px phone widths, when the Administration navigation is used, then tabs, heading, and selected content remain visible and usable with no page-level horizontal overflow or clipped action.
- **AC-ADMIA-006 (copy):** Given a member at the personal connection route or an Admin at the organization connection route, when each renders, then the headings make the connection owner clear and do not imply that a personal Microsoft 365 account grants organization-wide readiness.

## Boundaries and proof

Do not combine personal and organization Microsoft 365 cards, move ERPNext Company selection out of organization integrations, change role/entitlement rules, or alter repository and server authorization. Preserve direct links from existing records and dashboards. Use `docs/qa-portfolio.md`'s route and oracle maintenance rule for every new route. Component tests own tab visibility, selected state, and guard rendering; a curated e2e journey owns org-Admin navigation and Back; rendered desktop/phone review owns layout. Security review must check that direct Operator-only URLs do not expose those panels.
