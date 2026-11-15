# Manual journals — plan (#895)

Spec: `docs/specs/accountants-desk.spec.md` §5–§8. Migration: `supabase/migrations/0887_manual_journals.sql` (rollback in `rollback/`).

| Step | What | Owning proof |
|---|---|---|
| 1 | Tables, enums, RLS (select only), definer RPCs: save, submit, approve, return, reverse | `supabase/tests/manual_journals.test.sql` (AC-MJE-001/002/020) |
| 2 | Approver predicate: `journal_approver_allows` (no client grant), `may_approve_journal(uuid)` (signed-in user), `journal_org_sole_member` (no client grant); the audit entry of an approval records `sole_member` | `supabase/tests/manual_journals_sole_member.test.sql` |
| 3 | Dispatch gate and ledger adapters (Odoo, ERPNext) | `supabase/functions/adapter-dispatch/*journal*.test.ts`, adapter contract suite |
| 4 | Journals screen, drawer, form; amounts via the shared money formatter | `pmo-portal/pages/Journals.test.tsx` |
| 5 | Journey: draft → submit → second member approves | `pmo-portal/e2e/AC-MJE-040-journal-second-approver.spec.ts` |

## Traceability

| AC | Layer |
|---|---|
| AC-MJE-001, AC-MJE-002, AC-MJE-020 | pgTAP |
| AC-MJE-021, FR-MJE-021, AC-MJE-028/029 | Vitest |
| AC-MJE-040 | Playwright (approval by a second member; the ledger send needs a connected ledger) |

## Verify

`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` · `npx vitest run pmo-portal/pages/Journals.test.tsx` · `scripts/e2e-local.sh AC-MJE-040`.
