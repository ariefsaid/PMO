# Plan: lane site, 24 Nov decisions (crew link, head count evidence, areas and rates)

Specs: `docs/specs/site-report-crew-link.spec.md`, `docs/specs/headcount-evidence.spec.md`, `docs/specs/areas-and-area-rates.spec.md`.
Branch `feat/1124d-site` off `origin/dev`. Migrations 2130-2132 (range 2130-2159), each with a rollback. Restated bodies
(`dsr_save_draft`, `dsr_correct`, `dsr_validate`, `dsr_validation_queue`, `dsr_report_revenue`, `dsr_line_rate`) were read from the database
at head with `pg_get_functiondef`; only the lines named in each migration's `-- drops:` note change.

## Prior art checked
`scripts/prior-art.sh` on site report, head count, area: areas and a work order's area already exist (1382/1383), so item 3 adds a
description, a rate table and the rate default, not a second list. The close-out checklist (1400/1401) already cites a project document as
evidence, so item 2 reuses that shape rather than adding a bucket.

| # | Task | Files | Owning test |
|---|---|---|---|
| 1 | Crew/person link columns, restated save and correct | `supabase/migrations/2130_*`, rollback | `supabase/tests/2130_site_report_crew_link.test.sql` |
| 2 | DAL, create/edit crew or person link, list labels and crew filter, work order section | `src/lib/db/dailySiteReports.ts`, `pages/siteReports/*`, `pages/work-order-detail/SiteReportsSection.tsx` | `siteReportForm`, `SiteReportWho`, `NewSiteReportDialog`, `SiteReports`, `SiteReportsSection`, `dailySiteReports` tests |
| 3 | Head count evidence table and two functions | `supabase/migrations/2131_*`, rollback | `supabase/tests/2131_headcount_evidence.test.sql` |
| 4 | Evidence DAL, hooks, pending/error/retry states, approval waits for the resolved read | `src/lib/db/headcount.ts`, `src/hooks/useHeadcount.ts`, `pages/crews/HeadCountEvidence.tsx`, `pages/crews/HeadCountSection.tsx` | `headcount.test`, `HeadCountSection.test` |
| 5 | Area description, area rates, report area, rate default | `supabase/migrations/2132_*`, rollback | `supabase/tests/2132_areas_and_area_rates.test.sql` |
| 6 | Area description in the Admin list, rates by area on the contract line | `src/lib/db/workOrderLists.ts`, `pages/admin/WorkOrderLists.tsx`, `pages/project-detail/BoqAreaRates.tsx` | `WorkOrderLists`, `BoqAreaRates`, `workOrderLists.areaRates` tests |

Every rule about who may act is in the database (item 2 reuses `attendance_can_record` or the Project Administrator job role; item 3
reuses `dsr_may_write_revenue` and `dsr_may_see_revenue`), proven in pgTAP, and mutation-checked (notes at the top of each pgTAP file).
