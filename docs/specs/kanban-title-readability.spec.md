# Kanban project title readability — spec (#685)

**Status:** signed within the enterprise UX milestone, 2026-09-28. **Authority:** `docs/design/2026-09-26-enterprise-coherence-brief.md`, `DESIGN.md`, and the shared `ProjectCardShell` used by Sales and Projects boards.

## Job and observed failure

When a person scans a phone-width Sales or Projects board, they need to read the project's name before deciding which record to open. A long status pill currently shares the compact card's top row with the icon and title, leaving a narrow title strip that breaks ordinary words and hides the name. The same shared card appears in both boards.

## Design contract

For the Kanban variant only, place the status below the title, with the title using the width beside the icon. Keep the status visible and distinct, then show the existing client/code and lens-specific body and foot. Allow a multiword title to wrap at word boundaries and remain readable without a two-line clamp. Preserve the grid-card layout, the board's stage navigation, and the whole Kanban card as its single keyboard and pointer activation target. Use existing `DESIGN.md` tokens and avoid new decorative chrome.

## Requirements (EARS)

- **FR-KTR-001:** While a project renders as a Kanban card, the application shall give its title the available text width beside the icon and render the status below the title.
- **FR-KTR-002:** When a title spans multiple words or lines, the Kanban card shall expose the full readable title without clipping or forced midword wrapping caused by a sibling status.
- **FR-KTR-003:** While the same project renders as a grid card, the application shall preserve its established head layout and inner name activation.
- **FR-KTR-004:** When a user activates a Kanban card by pointer, Enter, or Space, the application shall open its project once; no nested interactive control shall be introduced.
- **FR-KTR-005:** While rendered in Sales and Projects at 390px and desktop, in both themes and languages, title and status shall remain visible without card overflow.

## Acceptance and proof

| ID | Given / When / Then | Owning layer |
|---|---|---|
| **AC-KTR-001** | Given a long multiword project name and long status, when the Kanban shell renders, then status follows the full-width title and the title is not line-clamped. | Component |
| **AC-KTR-002** | Given the same project in grid view, when it renders, then its established status placement and name button remain. | Component |
| **AC-KTR-003** | Given a Kanban card, when activated by click, Enter, or Space, then its open callback fires once and the card has no nested button. | Component |
| **AC-KTR-004** | Given Sales and Projects board cards at 390px and desktop, when rendered in English/Bahasa and light/dark, then ordinary title words and the status are visibly readable with no horizontal overflow. | Rendered Discover, backed by the component regression |

## Boundary

This is a shared-card layout repair. It does not change project data, status vocabulary, list state, navigation destination, role permissions, or board stage behavior.
