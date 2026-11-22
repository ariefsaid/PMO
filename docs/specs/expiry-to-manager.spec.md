# Expiry warnings to the direct manager, recipients per document type, renewal recorded by the manager

**Job story:** When a person's document is about to expire, I want the warning to go to that person's direct manager (not to every holder of an access level), the recipients to be choosable per document type, and the worker told after the manager records the renewal.

## Today (verified on land/fix-1122)
- **"Direct manager" exists** as `people.manager_id` (profile id, same-org FK): `supabase/migrations/0970_document_expiry_registry.sql:18,23`; writable by Admin (column grant, 0970:152-153). There was no screen field for it: the person form (`pmo-portal/pages/admin/People.tsx`) did not carry it. `profiles.manager_id` (ADR-0070 line management) is a separate field not read by expiry warnings.
- **The manager is already warned.** `run_document_expiry_warnings(date)` (`0971_document_expiry_warnings.sql:27-66`): recipients are `p.id = d.manager_id OR p.role = any(d.notify_roles)`, active members only, one notice per (document, expiry, threshold, recipient), via `notify_workflow_user`. The worker is never warned.
- **Per-type roles exist**: `document_types.notify_roles` (0970:38), edited on `pages/admin/DocumentTypes.tsx`. Defaults on insert: person -> Admin, equipment -> Admin + Project Manager (`document_types_defaults`, 0970:81-89) - but an explicit empty list on insert was overwritten by that default, so "manager only" could not be set at create.
- **No renewal step for a manager.** Managers read their reports' non-medical documents; only Admin writes documents (FR-DEX-006). Nothing told the worker about a renewal.

## Requirements (EARS)
- **FR-EXM-001** The person form shall carry an optional Direct manager, chosen from active members of the organisation.
- **FR-EXM-002** Each document type shall carry "also tell the person" (`notify_person`, default off, so every existing type keeps today's recipients). When on, the daily run also warns the person's linked active profile, once per document, expiry date and threshold.
- **FR-EXM-003** A document type created with an explicitly empty role list shall keep it empty (manager only); role defaults apply only when no list is supplied. Existing types keep their stored lists.
- **FR-EXM-004** When a person's direct manager records a renewal (a later expiry date) for a non-medical document of one of their own people, the database shall accept it and change only `expires_on`; a person who is not theirs, a medical document, an equipment document, or a date that is not later shall be refused with a sentence saying what to do next (English and Bahasa Indonesia). Admin keeps the existing write and may also use the same step.
- **FR-EXM-005** After a renewal is recorded the person is told once, with the type and new date (no medical status), through the shared `notify_person` (migration 1750, defined by the medical-release item; a person with no active linked profile is a no-op).
- **FR-EXM-006** The Expiring documents list shall offer "Record renewal" on person rows (not medical, not equipment) opening a form for the new date; the success message says the person has been told.

## Acceptance criteria
- **AC-EXM-001** Given a person type with an empty role list and a document 14 days out, when the run executes, then the manager has one notice and the worker none. *(pgTAP `supabase/tests/document_expiry_manager.test.sql`; e2e JOB-F14)*
- **AC-EXM-002** Given a type with "also tell the person" on, then the worker is also warned; off by default. *(pgTAP; Vitest `DocumentTypes.test.tsx`)*
- **AC-EXM-003** Given a type inserted with an explicit empty role list it stays empty; with no list, person -> Admin and equipment -> Admin + Project Manager. *(pgTAP; Vitest: form can save with no roles)*
- **AC-EXM-004** Given the direct manager, when they record a later date, it is saved; another person's document, a medical document, an equal or earlier date and the worker themselves are refused; Admin may record. *(pgTAP; Vitest `RecordRenewalAction.test.tsx`; e2e JOB-F14 second journey)*
- **AC-EXM-005** Given a recorded renewal, the worker gets one notice with the new date and no medical status; an unlinked person gets none. *(pgTAP)*
- **AC-EXM-006** Given the person form, the manager list offers active members only and the choice is saved. *(Vitest `People.test.tsx`, DAL test)*

## Settings
`document_types.notify_person boolean not null default false` - default keeps today's recipients. No on/off switch for the feature.

## Mutation check plan
Make the renewal RPC skip the manager test (`d.manager_id is distinct from v_uid` -> false): AC-EXM-004 "not your person" goes red. Drop the `notify_person` clause from the runner: AC-EXM-002 goes red. Restore the old `coalesce(cardinality(...)) = 0` default: AC-EXM-003 goes red.

## Open questions (recommended)
1. Fall back to the user account's line manager when a person has no direct manager? Recommended: later, once the roster work fixes which field is canonical.
2. Should a manager be able to renew medical documents? Recommended: no (Admin-only data today).

## Out of scope
Email, an acknowledge button, the manager column in the people import (people-import-update item), roster rework.
