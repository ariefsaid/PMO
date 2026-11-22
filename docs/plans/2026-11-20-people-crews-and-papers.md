# Plan: people, crews and their papers (fix/walk-people)

Spec: `docs/specs/people-crews-and-papers.spec.md`. Migrations 1610-1612 (reversible, under `supabase/migrations/rollback/`).

| Job | Files | Owning test layer |
|---|---|---|
| 1 mark as left | `supabase/migrations/1610_person_mark_left.sql`, `pmo-portal/src/lib/db/people.ts`, `pages/admin/MarkLeftDialog.tsx`, `People.tsx`, `equipment/PersonDetail.tsx` | pgTAP `person_mark_left.test.sql`; Vitest |
| 2, 3 invite | `src/lib/db/adminUsers.ts`, `pages/AdminUsers.tsx`, `pages/admin-users/UserForms.tsx` | Vitest |
| 4 terminology | `pages/AdministrationTerminology.tsx`, `AdministrationRoleNames.tsx`, `src/lib/i18n/orgTerms.ts`, `public/locales/id/*.json` | Vitest |
| 5 defaults | `pages/equipment/ExpiryDocumentsCard.tsx`, `pages/leave/LeaveRequestForm.tsx` | Vitest |
| 6, 7 crews | `pages/crews/CrewList.tsx`, `WorkOrderRoster.tsx`, `pages/admin-users/UserDirectory.tsx` | Vitest |
| 8 clearance | `supabase/migrations/1612_clearance_item_document_type.sql`, `pages/admin/PersonClearance.tsx`, `Clearance.tsx` | pgTAP `clearance_item_document_type.test.sql`; Vitest |
| 9 leave | `supabase/migrations/1611_leave_approver_and_result.sql`, `pages/leave/*`, `src/lib/i18n/notificationCopy.ts` | pgTAP `leave_approver_and_result.test.sql`; Vitest |
| 10 scheduled report | `src/components/emailNotifications/ScheduleThisReport.tsx`, `ScheduledReportFields.tsx`, `pages/siteReports/SiteReports.tsx` | Vitest |
| 11 small ones | `src/components/import/useImportWizard.ts`, `pages/crews/CrewPickers.tsx`, `pages/Administration.tsx`, `src/components/ui/FormFields.tsx` | Vitest |

Verify: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`; DB: `supabase db reset` then the three new pgTAP files and the suite (Docker is not available in this session; CI's pgtap job proves it).
