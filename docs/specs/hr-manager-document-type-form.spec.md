# HR Manager "add document type" form: offer only database-accepted kinds

Lane `rolescreens` (branch `feat/1124d-role-screens`). Follow-up 3 to migrations 2040–2051 (`2042_people_team_role_rights.sql`). Rulings read: ADR-0016, `docs/specs/document-expiry.spec.md`.

**Job story.** When I hold the HR Manager job role and open "Add document type", I want the form to offer only non-medical person document types — the exact kind the database lets me create — so I am never offered `Equipment` or `Medical document` choices that fail on save.

## 1. Today (verified at head)

- In `2042_people_team_role_rights.sql`, `public.actor_may_manage_document_types(p_applies_to, p_medical)` allows `Admin` for every kind, and `actor_holds_job_role('hr_manager')` only when `p_applies_to = 'person' and not coalesce(p_medical, false)` (`RR-HR-12`, `RR-HR-13`).
- `pmo-portal/src/auth/policy.ts` (`documentType.manage`) already mirrors this exact predicate per `(applies_to, medical)` pair.
- `TypeForm` in `pmo-portal/pages/admin/DocumentTypes.tsx` unconditionally offers `Equipment` in `Applies to` and unconditionally renders the `Medical document` checkbox when `applies_to === 'person'`, promising writes the database refuses for a non-Admin HR Manager.

## 2. Requirements (EARS)

- **FR-HMDT-001 (State-driven — `Applies to` options).** While creating a document type in `TypeForm`, the `Applies to` field SHALL include `'person'` only when `can('manage', 'documentType', { record: { viewOnly, applies_to: 'person', medical: false } })` is true and `'equipment'` only when `can('manage', 'documentType', { record: { viewOnly, applies_to: 'equipment', medical: false } })` is true.
- **FR-HMDT-002 (State-driven — `Medical document` option).** While creating a person document type in `TypeForm`, the `Medical document` checkbox SHALL render only when `can('manage', 'documentType', { record: { viewOnly, applies_to: 'person', medical: true } })` is true; otherwise `is_medical` SHALL be submitted as `false`.
- **FR-HMDT-003 (State-driven — view-as fence).** While viewing as another role (`realRole !== effectiveRole`), `DocumentTypes` SHALL offer no create, edit, archive, or warning-days write affordance.

## 3. Acceptance criteria (Given / When / Then)

- **AC-HMDT-001 (Vitest).** Given a signed-in Project Manager holding `hr_manager`, when they click `Add document type`, then `Applies to` contains only `Person` (no `Equipment` option), no `Medical document` checkbox is rendered, and saving submits `{ applies_to: 'person', is_medical: false }`.
- **AC-HMDT-002 (Vitest).** Given a signed-in `Admin` (with or without a built-in role key), when they click `Add document type`, then `Applies to` offers both `Person` and `Equipment` and the `Medical document` checkbox is rendered for `Person`.
- **AC-HMDT-003 (Vitest).** Given an `hr_manager` viewing a list containing a non-medical person type, a medical person type, and an equipment type, when `DocumentTypes` renders, then Edit and Archive buttons appear only on the non-medical person type.
- **AC-HMDT-004 (Vitest).** Given Bahasa Indonesia (`id`) active for an `hr_manager`, when `Tambah jenis dokumen` opens, then `Berlaku untuk` offers only `Orang` with no `Peralatan` option and no medical checkbox.
