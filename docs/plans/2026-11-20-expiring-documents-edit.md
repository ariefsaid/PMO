# Plan — add and edit expiring documents (#2542)

Spec: `docs/specs/expiring-documents-edit.spec.md`. Migration 0994 (bucket + storage policies); 0995-0996 unused. Rollback in `supabase/migrations/rollback/`.

| AC | Owning layer | Proof |
|---|---|---|
| AC-DEE-001..004, 006 | Vitest | `pmo-portal/pages/equipment/ExpiryDocumentsCard.test.tsx` |
| AC-DEE-005 | Vitest | `pmo-portal/src/auth/expiryDocumentPolicy.test.ts` |
| AC-DEE-007, 008 | pgTAP | `supabase/tests/expiry_documents_storage.test.sql` |

Tasks: (1) policy entity `expiryDocument` + test; (2) migration 0994 + rollback + pgTAP; (3) DAL `src/lib/db/documentExpiry.ts` (list by subject, types, create, update, archive, attachment upload/url) + repository + contract; (4) hooks; (5) `ExpiryDocumentsCard` + form (shared primitives) mounted on the asset record; (6) person record page `/people/:personId`, route, DAL `people.ts`; (7) en/id strings; (8) glossary term; (9) gates.
