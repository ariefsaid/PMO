# Scoped job-role rights

FR-001 When an active Equipment Officer registers or edits an asset, the system shall allow the existing editable asset fields in their organisation. Delete and rental-term rights remain unchanged.
FR-002 While an active Project Control Manager reads a catalogue in their organisation, the system shall expose its items, variants, rates and stages without additional write authority.
FR-003 The system shall preserve other organisation isolation, field-account restrictions and all other roles existing rights.

AC-GR-001 Given an Equipment Officer, when they create and edit an asset on the register, then the asset persists and delete remains unavailable.
AC-GR-002 Given a Project Control Manager and another managers project in the same organisation, when they open its rate catalogue, then its prices and locations are visible without import or edit actions.

Owning rule proof: supabase/tests/2560_gap_rights.test.sql. Affordance proof: policy.gapRights.test.ts. Screen proofs: e2e/AC-GR-gap-rights.spec.ts (combined CI). Existing English and Bahasa labels are reused.
