# Plan — document expiry (#2527)

Migrations 0970 registry + RLS, 0971 runner, 0972 list + warning-days RPCs, 0974 daily cron (0973 unused). Rollbacks in `supabase/migrations/rollback/`. Spec: `docs/specs/document-expiry.spec.md`.

| AC | Owning layer | Proof |
|---|---|---|
| AC-DEX-001..008 | pgTAP | `supabase/tests/document_expiry.test.sql` (runner takes `p_today`; list takes `p_today`) |
| Expiry list screen renders, empty and error states | Vitest | `pmo-portal/pages/ExpiringDocuments.test.tsx` |

Tasks: (1) migrations + pgTAP; (2) DAL `src/lib/db/documentExpiry.ts` + repository; (3) `can()` action `documentExpiry`; (4) page `/expiring-documents` + en/id strings; (5) later: create/edit forms for people, types, documents and attachment upload.
