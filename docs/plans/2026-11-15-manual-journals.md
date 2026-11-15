# Manual journals — plan (#895)

Spec: `docs/specs/accountants-desk.spec.md` §5–§8. Migration: `supabase/migrations/0887_manual_journals.sql` (rollback in `rollback/`).

| Step | What | Owning proof |
|---|---|---|
| 1 | Tables, enums, RLS (select only), definer RPCs: save, submit, approve, return, reverse | `supabase/tests/manual_journals.test.sql` (AC-MJE-001/002/020) |
| 2 | Approver predicate: `journal_approver_allows` (no client grant), `may_approve_journal(uuid)` (signed-in user), `journal_org_sole_member` (no client grant; true only while the org has no `org_second_member_marks` row); the `profiles_mark_org_second_member` trigger and the backfill set that permanent marker; the audit entry of an approval records `sole_member` | `supabase/tests/manual_journals_sole_member.test.sql` |
| 3 | Dispatch gate and ledger adapters (Odoo, ERPNext) | `supabase/functions/adapter-dispatch/*journal*.test.ts`, adapter contract suite |
| 4 | Journals screen, drawer, form; amounts via the shared money formatter | `pmo-portal/pages/Journals.test.tsx` |
| 5 | Journey: draft → submit → second member approves | `pmo-portal/e2e/AC-MJE-040-journal-second-approver.spec.ts` |

## Traceability

Each AC has one owning test, named with its id; other layers may reference it.

| AC | Layer | Owning test |
|---|---|---|
| AC-MJE-001 | pgTAP | `supabase/tests/manual_journals.test.sql` |
| AC-MJE-002 | pgTAP | `supabase/tests/manual_journals_sole_member.test.sql` |
| AC-MJE-003 | Deno (served) | `supabase/functions/adapter-dispatch/journalDispatch.served.test.ts` |
| AC-MJE-004 | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/bodies.test.ts` |
| AC-MJE-005 | Vitest | `pmo-portal/src/lib/adapterSeam/contractSuite/journal.suite.ts` |
| AC-MJE-006 | pgTAP | `supabase/tests/manual_journals.test.sql` |
| AC-MJE-007 | pgTAP | `supabase/tests/manual_journals.test.sql` |
| AC-MJE-008 | Vitest | `pmo-portal/src/lib/adapterSeam/contractSuite/journal.suite.ts` |
| AC-MJE-020 | pgTAP | `supabase/tests/manual_journals.test.sql` |
| AC-MJE-021 | Vitest | `pmo-portal/pages/Journals.test.tsx` |
| AC-MJE-024 | Vitest | `pmo-portal/src/lib/adapterSeam/contractSuite/journal.suite.ts` |
| AC-MJE-027 | Vitest | `pmo-portal/src/lib/adapterSeam/ledgerJournalReadBack.test.ts` |
| AC-MJE-028 | Vitest | `pmo-portal/pages/Journals.test.tsx` |
| AC-MJE-029 | Vitest | `pmo-portal/pages/Journals.test.tsx` |
| AC-MJE-040 | Playwright | `pmo-portal/e2e/AC-MJE-040-journal-second-approver.spec.ts` (approval by a second member; the ledger send needs a connected ledger) |

FR tests: FR-MJE-010/033 `pmo-portal/src/auth/policy.test.ts` and `pmo-portal/pages/Journals.test.tsx`; FR-MJE-021/023/025/116
`supabase/tests/manual_journals.test.sql`; FR-MJE-022 `supabase/functions/adapter-dispatch/journalGuard.test.ts`; FR-MJE-024
`pmo-portal/src/lib/adapterSeam/odoo/journal/body.test.ts`; FR-MJE-027/028 `supabase/functions/adapter-dispatch/readModelWriters.journal.test.ts`.

## Verify

`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` · `npx vitest run pmo-portal/pages/Journals.test.tsx` · `scripts/e2e-local.sh AC-MJE-040`.
