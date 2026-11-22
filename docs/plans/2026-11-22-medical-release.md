# Plan: Medical release before rostering again

Spec: `docs/specs/medical-release.spec.md`. Range 1750-1759. Do not run a database in this lane; the wave run proves pgTAP and e2e.

## Migrations (bodies of restated functions come from the database at head via `pg_get_functiondef`; run `npm run check:restated-functions`)
| File | Content | Rollback |
|---|---|---|
| `1750_medical_release_tables.sql` | `leave_types.requires_release boolean not null default false`; table `medical_releases` (id, org_id stamped, person_id, leave_request_id unique, status Pending/Approved/Rejected, decided_by, decided_at, decision_note <=500, created_at) with RLS select for the person, direct manager and approver role via `(select ...)` helpers; no write grants; `medical_release_authority(person)` definer | `rollback/1750_medical_release_tables_down.sql` |
| `1751_medical_release_rpcs.sql` | restate `leave_request_decide` (from 1241) to create the release on approval of a marked type; `medical_release_decide(id, decision, note)` (SoD, authority, notify worker, audit); `medical_release_state(person)` returning a state word; `leave_types_set_requires_release` admin setter | `rollback/1751_..._down.sql` (restores the 1241 body) |
| `1752_medical_release_roster_guard.sql` | restate `guard_crew_refs` crew_members branch (1035) and the crew-loan guard (1245) to call a `medical_release_blocks(worker, from, to)` check raising `MR_BLOCKED` | `rollback/1752_..._down.sql` (restores the prior bodies) |

Also: isolation denominator manifest (`node scripts/check-isolation-denominator.mjs`) for the new table and definers; `database.types.ts` edited by hand to match.

## Frontend (pmo-portal/)
- `src/lib/db/medicalRelease.ts`, `src/lib/repositories/medicalRelease.ts`, `src/hooks/useMedicalRelease.ts` (typed, no casts).
- `pages/leave/LeaveTypes.tsx`: a "needs a release" toggle per type.
- `pages/approvals/MedicalReleaseSection.tsx`: pending list for the direct manager; approve or reject with note; waiting-list pointer.
- Roster/crew placement forms show the state word and a disabled-with-reason action; `MR_BLOCKED` mapped in `src/lib/refusals.ts` with `public/locales/{en,id}` sentences.
- `can('approve','medicalRelease')` in `src/auth/policy.ts` (UX only; RPC is the authority). Does not touch `medical_documents_view`.

## Tests per AC
| AC | File | Layer |
|---|---|---|
| 001-008 | `supabase/tests/1750_medical_release.test.sql` (mutation notes in header) | pgTAP |
| 009 | `src/lib/refusals.test.ts` additions | Unit |
| 010 | `pages/approvals/MedicalReleaseSection.test.tsx`; `e2e/AC-MR-010-medical-release.spec.ts` | Unit + E2E |

## Order
1. RED pgTAP for AC-003/005/002, then 1750-1752 to green; 2. refusals + repo; 3. screens; 4. gates (`check:guards`, `typecheck`, eslint, related vitest); 5. glossary entry "Medical release". Existing leave tests: steps unchanged (default false keeps them green).
