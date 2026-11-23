# Plan: expiry-to-manager (spec docs/specs/expiry-to-manager.spec.md)

Migrations (range 1760-1764): 1760, 1761. Functions restated from the database at head; `npm run check:restated-functions` passes (one `-- drops:` marker). 1761 calls `public.notify_person` from migration 1750 (medical-release item): merge that branch before running the wave.

## Tasks (all done test-first)
1. `supabase/migrations/1760_document_type_notify_person.sql` (+ rollback): `document_types.notify_person` default false, `notify_roles` default dropped (trigger fills when NULL), restate `document_types_defaults()` and `run_document_expiry_warnings(date)`, column grants. Test: `supabase/tests/document_expiry_manager.test.sql`; the older fixtures in `document_expiry.test.sql`, `1466_...`, `1221_...` now omit `notify_roles` where they meant "no list supplied" (steps changed, goals kept).
2. `supabase/migrations/1761_record_document_renewal.sql` (+ rollback): `record_document_renewal(p_document, p_expires_on)` security definer; refusal codes DXR_* in `public/locales/{en,id}/refusals.json`; listed in `supabase/tests/inventory/anon-executable-definers/expiry-to-manager.txt`.
3. DAL/types/repository/hook: `src/lib/db/documentExpiry.ts`, `src/lib/supabase/database.types.ts`, repository + contract, `useRecordRenewal`.
4. UI: `pages/admin/DocumentTypes.tsx` ("Also tell the person", default roles pre-ticked), `pages/equipment/RecordRenewalAction.tsx` + `ExpiringDocuments.tsx` (action), `pages/admin/People.tsx` Manager field + `src/lib/db/people.ts`; EN + ID strings.
5. e2e: second journey in `pmo-portal/e2e/serial/JOB-F14-expiry-warning-recipients.spec.ts`.
6. Docs: glossary "Direct manager"; FR-DEX-003 line updated.

## Traceability
AC-EXM-001/002/003/005 pgTAP (+ Vitest for the form); AC-EXM-004 pgTAP + Vitest + e2e; AC-EXM-006 Vitest.

## Gates
`npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run`. pgTAP and e2e are left for the wave run.
