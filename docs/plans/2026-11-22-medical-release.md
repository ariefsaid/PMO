# Plan: Medical release (minimal form)

Spec: `docs/specs/medical-release.spec.md`. Range 1750-1759. No database is run in this lane; the wave run proves pgTAP and e2e.

## Migrations
| File | Content | Rollback |
|---|---|---|
| `1750_notify_person.sql` (shipped, `1bbbaa87`) | shared `notify_person` helper | `rollback/1750_notify_person_down.sql` |
| `1751_medical_release.sql` | table `medical_releases`, RLS, `medical_release_can_enter`, `medical_release_authority`, `medical_release_create`, `medical_release_decide`, `medical_release_blocks`, `medical_release_holds`, `medical_releases_visible` | `rollback/1751_medical_release_down.sql` |
| `1752_medical_release_guards.sql` | BEFORE triggers on `crew_members`, `crew_loans`, `attendance_days` | `rollback/1752_medical_release_guards_down.sql` |

No function is restated (leave decide, crew guards and `attendance_record` are untouched), so `check:restated-functions` has nothing to compare.

## Frontend (pmo-portal/)
- `src/lib/db/medicalRelease.ts`, `src/lib/repositories/medicalRelease.ts`, `src/hooks/useMedicalRelease.ts`; generated types edited by hand.
- `pages/approvals/MedicalReleaseSection.tsx` (list, Approve, Defer with reason, "Open a release" for the people team) + form; mounted on `pages/Approvals.tsx`.
- `pages/crews/AttendanceTick.tsx` and `WorkOrderRoster.tsx`: held people get a "release pending" pill, disabled controls, reason; held people left out of the save.
- `src/lib/refusals.ts` needs no change (generic `FAMILY_CODE` reader); sentences in `public/locales/{en,id}/refusals.json` for every `MR_*` code; strings in the `crews` namespace.
- `can('decide'|'create','medicalRelease')` in `src/auth/policy.ts` (UX only).

## Tests per AC
| AC | File |
|---|---|
| 001-007 | `supabase/tests/1751_medical_release.test.sql` |
| 010 | `supabase/tests/1750_notify_person.test.sql` |
| 008, 009 | `pages/crews/AttendanceTick.release.test.tsx`, `pages/approvals/MedicalReleaseSection.test.tsx` |
| 009 journey | `e2e/AC-MR-009-medical-release.spec.ts` |
| 011 | existing refusal-codes gate (`scripts/check-refusal-codes.mjs`) |
