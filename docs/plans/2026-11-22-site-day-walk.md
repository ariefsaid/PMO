# Plan: site day walk fixes (branch fix/walk-siteday, migrations 1630, 1631)

| AC | Change | Files | Owning layer |
|---|---|---|---|
| AC-SD-001 | `incident.view` in `can()`; report page shows "cannot be shown" when its read is idle | `src/auth/policy.ts`, `pages/incidents/ClosingTimeReport.tsx` | unit |
| AC-SD-002 | loan only moves a worker on days the host crew is scheduled; lend form check; per-person save retry; who-can-lend line | `supabase/migrations/1630_*.sql`, `pages/crews/CrewLoans.tsx`, `pages/crews/AttendanceTick.tsx`, `src/lib/crewLoanCoverage.ts` | pgTAP `1630_loan_one_roster`, unit |
| AC-SD-003/004 | lock confirmation, readiness, localized refusals, today's record link | `pages/safetyDays/SafetyDayForm.tsx`, `src/lib/safetyDay.ts`, `pages/work-order-detail/SafetySection.tsx`, `pages/WorkOrderDetail.tsx` | unit |
| AC-SD-005 | checkpoints on the work order | `pages/work-order-detail/WorkOrderCheckpoints.tsx` | unit |
| AC-SD-006 | notice link, save confirmation, setting moved up | `pages/siteReports/SiteReportStock.tsx`, `pages/work-order-detail/SiteLocationSection.tsx` | unit |
| AC-SD-007 | `absence_reports`, `report_absence`, roster `reported_absent`, phone-home card | `supabase/migrations/1631_*.sql`, `src/components/my/AbsentTodaySection.tsx`, `pages/crews/AttendanceTick.tsx` | pgTAP `1631_absence_reports`, unit |
| AC-SD-008 | read-only roster sentence | `pages/crews/AttendanceTick.tsx` | unit |
| AC-SD-009 | author sees the paper-photo need | `pages/siteReports/SiteReportDetail.tsx` | unit |

Browser journeys (one per job id, role-walked) are owed and not written here: this sandbox has no Docker, so none could be run.
