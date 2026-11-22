# Plan: three-way match setting screen and line editors (#2634)

Spec: `docs/specs/three-way-match.spec.md` section 7 (FR-TWM-010..014, AC-TWM-017..025). Map #2516. Money path: ships alone.
Builds on 1018 (`set_three_way_match_settings`, `record_receipt_match_lines`, `record_bill_match_lines`, `get_bill_match`),
the #2622 panel (`BillMatchDrawer`, `useThreeWayMatch`, `src/lib/db/threeWayMatch.ts`).

## Migration (one, number 1357)

`supabase/migrations/1357_three_way_match_edit_states.sql`: `create or replace` of the two line writers, each body copied
from 1018 with: (a) bill-lines writer refuses a Paid bill (`23514`, detail `three-way-match-posted`); (b) receipt-lines
writer refuses a receipt of a Paid or Cancelled purchase (same code); (c) the audit row also carries the lines before.
Grants re-stated (revoke from public/anon/authenticated, grant to authenticated). The settings writer is unchanged.
One new client-callable definer `three_way_match_held_count()` (Admin only, own org; D-TWM-15): fragments
`supabase/tests/inventory/anon-executable-definers/1357-three-way-match-edit.txt` and
`scripts/isolation-probe-denominator.d/1357-three-way-match-edit.json`; 0178 is re-run. Rollback: `supabase/migrations/rollback/1357_three_way_match_edit_states_down.sql` restores the 1018 bodies.

## Tasks (test first, each 2-5 min)

1. pgTAP `supabase/tests/three_way_match_settings.test.sql` (AC-TWM-017..020): roles refused, other-org isolation, audit,
   Paid bill and Paid/Cancelled purchase refused, held bill clears by a receipt edit and by a bill edit with no exception row,
   SoD follows the last recorder, before/after audit. Red first, then the migration.
2. pgTAP mutation `supabase/tests/three_way_match_edit_mutation.test.sql` (AC-TWM-021), same pattern as
   `three_way_match_mutation.test.sql`: rewrite the shipped function bodies, assert the refusal disappears, roll back.
3. DAL `src/lib/db/threeWayMatch.ts`: `setThreeWayMatchSettings`, `getReceiptLines`, `getBillLines`, `recordReceiptLines`,
   `recordBillLines`, `listOrderedItems`; repository `src/lib/repositories/threeWayMatch.ts`; hooks in
   `src/hooks/useThreeWayMatch.ts` (invalidate settings, `['bill-match', org, id]` and the purchase queries). Unit tests beside them.
4. `pmo-portal/pages/admin/OrgThreeWayMatch.tsx` (+ test, AC-TWM-022), mounted in `pages/Administration.tsx` accounting panel after
   `OrgProcurementGates`; shared primitives (`TextField`, `Button`, toast, `classifyMutationError`), Admin gate via
   `usePermission` on a new `threeWayMatchSettings` entity (`src/auth/policy.ts`, Admin only; policy test).
5. `pages/procurement/MatchLinesEditor.tsx` (one editor, bill or receipt; + tests, AC-TWM-023, AC-TWM-025): opened from the
   ledger's held-bill notice and bill row menu and from the receipt row menu (`ProcurementLedger.matchLines.test.tsx`); gate with `can('edit', 'billMatch')` (Admin,
   Executive, Project Manager, Finance, matching the RPC); `EntityFormModal`-style rows; refusal messages through `threeWayMatchError.ts`.
6. i18n: `administration.json` and `procurement.json` in `public/locales/en` and `id` (completeness gate must pass).
7. e2e `pmo-portal/e2e/serial/AC-TWM-024-bill-match-settings.spec.ts` (one curated journey, serial lane because it switches the org-wide match on; `@e2e-isolation: serial`).
8. Glossary: terms "match tolerance", "match lines" in `docs/glossary.md`. Screenshots: phone 390 and desktop 1440 (scale 2) of the
   setting section and each editor, `docs/evidence/1215/2634/`.

## Traceability

| AC | Layer | File |
|---|---|---|
| AC-TWM-017..020 | pgTAP | `supabase/tests/three_way_match_settings.test.sql` |
| AC-TWM-021 | pgTAP mutation | `supabase/tests/three_way_match_edit_mutation.test.sql` |
| AC-TWM-022 | RTL | `pages/admin/OrgThreeWayMatch.test.tsx` |
| AC-TWM-023, 025 | RTL | `pages/procurement/MatchLinesEditor.test.tsx`, `ProcurementLedger.matchLines.test.tsx` |
| AC-TWM-024 | e2e | `e2e/serial/AC-TWM-024-bill-match-settings.spec.ts` |

## Gates

Per `docs/cloud-session-rules.md` and the lane rules: `check:guards`, `typecheck`, eslint on changed files, `vitest related`;
database reset + the three files + 0178 + 0646 under `flock /tmp/db.lock`; mutation lines quoted in the report.
