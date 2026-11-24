# Spec: Areas and rates per area, generic (ARA)

**Status:** built on branch `feat/1124d-site` (lane site, item 3, 24 Nov decisions). IDs `FR-ARA-###`, `AC-ARA-###`.
Plan: `docs/plans/2026-11-24-site-evidence-areas.md`. Migration `2132`. Extends `docs/specs/work-order-area-group.spec.md`
and `docs/specs/daily-site-report.spec.md`. No client-specific logic: areas are the organisation's own data.

**Job story.** When the same contract line is paid a different rate in different areas, I want each area to carry its own rate, so a
daily report is priced at the area's rate without anyone retyping it.

## 1. Today (checked 2026-11-24)
- Areas already exist (`work_order_areas`, `1382`/`1383`, #2668): an Admin keeps the list (code, name), and a work order names at
  most one. This spec reuses them; it adds an optional description.
- A daily report's rate is found by `dsr_line_rate`: a catalogue item at the report's work location, else the contract line's own
  rate (`boq_items.rate`). The rate is frozen when a report is validated (`dsr_validate`, `1041`).

## 2. Requirements (EARS)
- **FR-ARA-001** An area shall carry an optional description (up to 500 characters), kept by an Admin with the list.
- **FR-ARA-002** A contract line priced by hand (no catalogue item) may carry a rate per area (positive, up to 8 decimals); an empty
  value removes the area's rate. A catalogue-priced line takes its rate from the catalogue and refuses an area rate.
- **FR-ARA-003** Only the roles that write a daily report's revenue on the project (Admin, Finance, Executive, the project's manager)
  set an area rate, through one server function; the same roles that read revenue read it; nobody else, no field account.
- **FR-ARA-004** When a report's line is priced from a hand-priced contract line, the system shall use the rate of the report's own
  area when the report names one, else of its work order's area, when that area has a rate for the line; otherwise the contract line's
  rate, as today. The frozen rate source stays "contract".
- **FR-ARA-005** A report may name its own area (optional); the choice is offered only to an organisation that has areas, and the
  default reads "The work order's area".
- **FR-ARA-006** An organisation with no area rates sees no change in any rate, amount or screen.
- **FR-ARA-007** The rate is frozen at validation exactly as before; a later change of an area rate never changes a validated report.
- **FR-ARA-008** The contract line form shall show "Rates by area" (an area's rate, save, clear) only where the organisation has areas,
  the line is hand-priced and the role may edit it; English and Bahasa Indonesia ("wilayah").

## 3. Acceptance criteria (owning layer)
- **AC-ARA-001** An area saves with and without a description; a group has none. [pgTAP `2132`; unit `WorkOrderLists.test`, `workOrderLists.areaRates.test`]
- **AC-ARA-002** An Admin sets and changes an area rate; an Engineer is refused; another organisation's area and a rate of 0 are refused. [pgTAP `2132` mutation-checked; unit `BoqAreaRates.test`, `workOrderLists.areaRates.test`]
- **AC-ARA-003** A report on a work order in an area is priced at that area's rate. [pgTAP `2132` mutation-checked]
- **AC-ARA-004** A report that names its own area is priced at that area (an area with no rate falls back to the contract rate). [pgTAP `2132` mutation-checked; unit `SiteReportWho.test`, `siteReportForm.test`]
- **AC-ARA-005** A work order with no area, or an organisation with no area rates, keeps the contract rate; the screens render nothing extra. [pgTAP `2132`; unit `BoqAreaRates.test`, `SiteReportWho.test`]
- **AC-ARA-006** Validation freezes the area rate. [pgTAP `2132`]
- **AC-ARA-007** An Engineer reads no area rate. [pgTAP `2132` mutation-checked]

## 4. Not in scope
Area rates for catalogue-priced lines (the catalogue's work locations already price by location); effective dates on an area rate; area-based billing rates (invoices still use the contract rate).
