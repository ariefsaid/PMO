# Plan: checklist target dates (#2800)

Spec `docs/specs/checklist-target-dates.spec.md`. Migrations 1830 to 1832 only.

| Step | Path | Owning layer |
|---|---|---|
| 1830 close-out columns, issue copy, set function | `supabase/migrations/1830_closeout_target_days.sql` + rollback | pgTAP `supabase/tests/1830_closeout_target_days.test.sql` (AC-001..003) |
| 1831 clearance columns, stamp trigger, notices table, due-day seam and read function | `supabase/migrations/1831_clearance_target_days.sql` + rollback | pgTAP `supabase/tests/1831_clearance_target_days.test.sql` (AC-004,005,007) |
| 1832 one runner: helpers + restated `notify_overdue_billing_stages` | `supabase/migrations/1832_overdue_runner_checklists.sql` + rollback | pgTAP `supabase/tests/1832_overdue_runner_checklists.test.sql` (AC-002,003,006,008) |
| Types by hand | `pmo-portal/src/lib/supabase/database.types.ts` | typecheck |
| Isolation | `scripts/isolation-probe-denominator.d/2800-checklist-target-dates.json`, `scripts/isolation-fixtures.sql` | isolation probe |
| Pure helpers | `pmo-portal/src/lib/checklistDue.ts` (+ test) | Vitest AC-009 |
| DAL, repository, hooks | `src/lib/db/closeoutChecklist.ts`, `src/lib/db/clearance.ts`, repositories, `src/hooks/useCloseoutChecklist.ts`, `useClearance.ts` | RTL via screens |
| Screens | `CloseoutSection.tsx`, `WorkOrders.tsx`, `admin/WorkOrderCloseoutTemplate.tsx`, `admin/Clearance.tsx`, `admin/PersonClearance.tsx`, `NotificationBell.tsx` routes | RTL AC-010 |
| Strings | `public/locales/{en,id}/closeout.json`, `administration.json`, `workOrders.json`, `refusals.json` | locale guard |

The runner keeps its name and cron entry; it calls two private helpers (`notify_overdue_closeout_items`, `notify_overdue_clearance_items`) after its unchanged billing loop and returns the sum.
