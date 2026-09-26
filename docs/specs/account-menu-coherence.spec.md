# Account menu coherence — spec

**Status:** approved direction from the RIS Admin UX review, 2026-09-26. This issue moves personal controls into one account menu on desktop and mobile. It changes navigation and presentation, not the underlying profile, theme, or sign-out persistence.

## Job story

When I am signed in and need to change how the portal appears or leave my session, I want one predictable account control so I do not have to search the primary navigation and header for related actions.

## Scope and decisions

- The top-bar identity chip is the account-menu trigger at every width. On phones it may show only the avatar; on desktop it shows identity text. The same menu content and behavior serve both.
- The menu contains **Profile & preferences**, a **Theme** choice with Light and Dark, and **Sign out**, separated from preference choices. The profile page continues to own the stored interface-language override and remains directly routable at `/settings/profile`.
- The sample-org-only, view-only role preview remains available within the account menu. Its authorization continues to derive from `canImpersonate`; moving its affordance must not change real identity or RLS behavior.
- Existing Help, Terms, and Privacy destinations remain reachable in the account menu. They are not RIS acceptance prerequisites.
- Remove the Profile settings rail item and the standalone theme, role-preview, and sign-out top-bar controls. Keep notification and command-palette controls in the top bar.
- Follow `DESIGN.md` tokens. The menu must fit short phone viewports without clipping its actions. English and Bahasa labels must both be present.

## Requirements

- **FR-ACCT-001:** While a user is signed in, the application shall expose one account-menu trigger in the top bar at desktop and phone widths, labelled for assistive technology and reflecting its expanded state.
- **FR-ACCT-002:** When the user opens the account menu, the application shall show the signed-in identity, a link to `/settings/profile`, Light and Dark choices, and Sign out. The Profile & preferences route shall remain directly accessible by URL.
- **FR-ACCT-003:** When the user chooses Light or Dark, the application shall apply and persist the choice through the existing `useTheme` contract and show which choice is selected.
- **FR-ACCT-004:** When the user chooses Sign out, the application shall invoke the existing auth sign-out action and close the menu.
- **FR-ACCT-005:** While `canImpersonate` is true, the menu shall expose view-only role choices. While it is false, those choices and their heading shall be absent.
- **FR-ACCT-006:** When the user presses Escape or clicks outside an open menu, it shall close. Escape shall restore focus to the trigger. Menu actions shall be keyboard reachable and expose their names and selection state.
- **FR-ACCT-007:** While the account menu is closed, Profile & preferences shall not occupy a primary rail slot, and personal theme/sign-out controls shall not occupy separate top-bar slots.

## Acceptance criteria

- **AC-ACCT-001 (component):** Given any signed-in role at desktop or phone width, when the user opens the account control, then one menu exposes Profile & preferences at `/settings/profile`, Light and Dark with the current theme identified, and Sign out; the primary rail has no Profile settings item.
- **AC-ACCT-002 (component):** Given a Light theme, when the user chooses Dark from the menu, then the document theme changes immediately and its stored preference becomes Dark; the reverse choice also works.
- **AC-ACCT-003 (component):** Given an open account menu, when the user presses Escape, then the menu closes and focus returns to the trigger; when the user opens it again and activates Sign out, then the existing `signOut` action is called once.
- **AC-ACCT-004 (component):** Given a sample Admin with role-preview permission, when the account menu opens, then view-only role choices appear and selecting one calls `viewAs`; given an ordinary org Admin, those choices are absent.
- **AC-ACCT-005 (rendered):** Given desktop and 390px phone viewports, when the account menu opens, then all actions remain visible or reachable within a scrollable menu and no horizontal page overflow appears.
- **AC-ACCT-006 (localization):** Given English and Bahasa interface languages, when the account menu and profile route render, then their visible labels use the selected language.

## Test ownership and regression updates

`ContextBar` component tests own menu behavior, focus, role-preview gating, and theme choice. `Rail` component tests own absence of the personal settings item. The existing profile-language cross-stack journey continues to own preference persistence; its entry path should use the account menu. Existing sign-out journeys should open the account menu before Sign out while preserving their sign-out outcome assertion. A rendered desktop/phone pass owns layout and overflow. Do not retain tests that assert the retired rail or inline-header placement.
