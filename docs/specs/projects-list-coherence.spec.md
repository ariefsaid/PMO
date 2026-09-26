# Projects list coherence — spec

**Status:** active enterprise UX program, 2026-09-26. **Authority:** `DESIGN.md` ListPage contract and `docs/design/2026-09-26-enterprise-coherence-brief.md`. This issue fixes the Projects list's phone-width control density and ambiguous project-manager choices. It preserves existing project reads, writes, roles, status meanings, and desktop slot order.

## Job story

When I review projects on a phone, I want to find a project promptly and refine the list only when needed. When I filter by manager, every choice must name a person or clearly say that no manager is assigned.

## Current behavior and decisions

At 390px, status segments, search, Customer and PM selectors, Export, Import, Import budgets, and four view choices fill most of the first screen before a project appears. The status segment is already horizontally scrollable and must remain so. The manager selector currently labels options with `full_name` verbatim; an existing profile with an empty name therefore creates an empty choice. The invitation/display-name source is a separate identity-data issue. This list must defend against already-existing empty names without hiding those profiles.

At phone widths, keep status, search, and the view switch visible. Put Customer and PM choices under a clearly labelled Filters disclosure with an active count, and put Export/Import/Import budgets under a separate More actions control. Show applied secondary filters as removable chips with Clear all. Preserve the existing desktop toolbar arrangement. A manager whose name is empty or whitespace uses a translated `Unnamed user` label with a distinguishing identifier if needed; a project with no manager uses `Unassigned`, never the same label as an unnamed profile.

## Requirements

- **FR-PRJUX-001:** While the Projects list is at a narrow phone width, the application shall keep status, search, the selected view, and the primary New project action visible while grouping secondary filters and bulk actions under separately named controls.
- **FR-PRJUX-002:** When a secondary filter is selected, the list shall show its active count and a removable applied-filter chip; Clear all shall restore the role-appropriate default status and clear search and secondary filters.
- **FR-PRJUX-003:** When the user opens Filters or More actions, the control shall expose its state, be keyboard reachable, close on Escape and outside interaction, and keep its contents within the phone viewport.
- **FR-PRJUX-004:** When the manager filter options render, every profile shall have a nonempty visible label, including historical blank-name profiles. A blank-name profile shall remain selectable and filter by its stable ID.
- **FR-PRJUX-005:** When a project has no manager, the list shall display Unassigned; selecting the Unassigned filter shall show only projects without a manager. An unnamed but assigned manager shall not be treated as unassigned.
- **FR-PRJUX-006:** At desktop widths, the existing ListPage toolbar slot order, export/import actions, views, and role gates shall remain available.

## Acceptance criteria

- **AC-PRJUX-001 (component/rendered):** Given a 390px Projects list, when the page settles, then the first record follows a compact status/search/view toolbar; Customer, PM, Export, Import, and Import budgets are available through named disclosures, and no page-level horizontal overflow or clipped action appears.
- **AC-PRJUX-002 (component):** Given a selected Customer or PM filter, when the mobile toolbar renders, then Filters shows the active count, a chip names the choice, removing the chip removes only that filter, and Clear all returns the list to its role-appropriate default.
- **AC-PRJUX-003 (component):** Given an open mobile disclosure, when Escape is pressed, then it closes and focus returns to its trigger; keyboard users can activate every filter and action.
- **AC-PRJUX-004 (component):** Given a manager profile whose `full_name` is empty or whitespace, when the filter and project rows render, then both show a readable nonempty fallback and the option still filters by that manager's ID.
- **AC-PRJUX-005 (component):** Given projects with null and non-null `project_manager_id`, when Unassigned is selected, then only null-manager projects remain; the label is distinct from an unnamed assigned manager.
- **AC-PRJUX-006 (regression):** Given a desktop viewport or an Engineer role, when Projects renders, then the existing desktop controls, role-sensitive filtering, and project actions behave as before.

## Boundaries and proof

This issue does not change the invitation API, database, profile record, or project permissions. The source fix that requires names during invitation and lets users repair their own display name is a separate identity-data change. Component tests own filter semantics, disclosures, and fallback labels; the existing mobile overflow journey and a rendered 390px/desktop review own layout. Keep status-filter URL tokens and analytics values unchanged. A later list-to-record issue owns filter persistence and return navigation across routes.
