# Sales Pipeline funnel amount readability — spec (#687)

**Status:** proposed within the signed enterprise UX program, 2026-09-28. **Authority:** `docs/design/2026-09-26-enterprise-coherence-brief.md`, `DESIGN.md`, and the rendered 390px Sales Pipeline finding.

## Job story and observed failure

When a RIS organization Admin compares pipeline stages on a phone, they need to read each stage's amount in full. At 390px, the five-stage funnel scrolls horizontally, but a representative formatted amount needs about 117px while its stage has about 99px of content width. The value reaches the neighboring stage boundary, so trailing digits can be misread. The board's project-card title correction in #685 does not change this funnel.

## Design intent

Keep exact formatted amounts. Let the existing horizontal funnel scroll provide room for stage values, and ensure each stage's visible amount is contained within its own stage at phone width. Preserve stage selection, probability, weighted value, and desktop presentation. Avoid replacing exact amounts with a compact approximation. Any shared Funnel change must also keep dashboard funnel instances contained in their panels.

## Requirements (EARS)

- **FR-SFA-001:** While the Sales Pipeline funnel is shown at 390px, each stage shall show its complete formatted amount without overlapping a neighboring stage or clipping digits.
- **FR-SFA-002:** While the funnel is horizontally scrollable, stage selection shall remain operable by touch, Enter, and Space and shall preserve its current selected-state semantics.
- **FR-SFA-003:** While the page is in English or Bahasa Indonesia and light or dark theme, the amount, label, probability, and weighted value shall remain legible.
- **FR-SFA-004:** When the shared Funnel is used in a dashboard panel, the panel shall contain it without page-width overflow.

## Acceptance criteria and owning proof

| ID | Given / When / Then | Owning layer |
|---|---|---|
| **AC-SFA-001** | Given five Sales stages with a representative long currency amount, when the funnel renders at 390px, then the full amount fits inside its own stage or wraps without losing digits, and no value overlaps another stage. | Browser geometry / visual regression |
| **AC-SFA-002** | Given a stage in a horizontally scrolled funnel, when the user clicks or presses Enter or Space on it, then the selected stage and `aria-pressed` state agree with the list filter. | Component integration |
| **AC-SFA-003** | Given English and Bahasa Indonesia in light and dark themes, when the 390px and desktop funnel render, then amount, probability, and weighted text remain readable. | Rendered review matrix |
| **AC-SFA-004** | Given a dashboard Funnel panel with long values, when the panel renders in a narrow container, then the funnel stays within a deliberate local scroll area rather than widening the page. | Component/layout test |

## Boundaries

No money calculation, locale parser, pipeline filtering, or Kanban card change. Exact amount semantics remain intact. The separate board-card amount finding, if confirmed, will have its own acceptance criteria.
