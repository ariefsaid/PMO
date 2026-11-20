# Plan — three-way match, slice 1 (database) · #2525

Spec: `docs/specs/three-way-match.spec.md`. Money path: ships alone. Migration range 0965–0969 (uses 0965).

## Design

- One evaluator `bill_match_evaluate(invoice)` (security definer, internal) holds the whole rule and returns
  `{status, reasons, lines[], tolerances, exception}`. Everything else asks it.
- Gate = three BEFORE triggers (`payments_zz_three_way_hold`, `procurement_invoices_zz_three_way_hold`,
  `procurements_zz_three_way_hold`), definer, calling `purchase_has_held_bill`. `purchase_match_on` exits first, so an
  organisation without the match (all ERP organisations by default) never takes the purchase lock or evaluates.
- Writers: `set_three_way_match_settings`, `record_receipt_match_lines`, `record_bill_match_lines`,
  `approve_bill_match_exception`; reader `get_bill_match`. Each re-asserts membership, role and org, locks the purchase
  row first, then acts.
- Tables: `org_three_way_match_settings`, `procurement_receipt_lines`, `procurement_bill_matches` (header, `seq`,
  `recorded_by`), `procurement_bill_match_lines`, `bill_match_exceptions` (append-only).
- No ADR: additive, reversible, follows ADR-0016/0017/0019 and the 0472/0885 patterns.

## Tasks (each 2–5 min; red → green)

1. Write `supabase/tests/three_way_match.test.sql` (AC-TWM-001..012) — red: functions missing.
2. Write `supabase/migrations/1018_three_way_match.sql` §1–§5 (tables, RLS, grants) — table assertions go green.
3. §6 evaluator + `purchase_match_on` / `purchase_has_held_bill` — AC-TWM-002..007 status assertions green.
4. §7 gate triggers — AC-TWM-002/011 refusals green.
5. §8–§11 writers and reader — AC-TWM-001/004/012 green.
6. §12 exception RPC — AC-TWM-008/009 green.
7. `supabase/tests/three_way_match_mutation.test.sql` (AC-TWM-013): rewrite the shipped SoD and over-received sites via
   `pg_get_functiondef` + `replace`; the refused actions go through.
8. `supabase/migrations/rollback/1018_three_way_match_down.sql`.
9. Allow-lists: `supabase/tests/0178_anon_executable_definers.test.sql` (+4 writers, 181);
   `scripts/isolation-probe-denominator.json` (+5 tables, +8 definers); `scripts/isolation-fixtures.sql` (one tenant-A
   row per new table so no probe skips).
10. `docs/glossary.md`: Three-way match, Match exception.

## Verify

```
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase@2.122.1 start
scripts/with-db-lock.sh bash -c 'npx supabase@2.122.1 db reset && npx supabase@2.122.1 test db \
  supabase/tests/three_way_match.test.sql supabase/tests/three_way_match_mutation.test.sql \
  supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0005_force_rls.test.sql \
  supabase/tests/record_changes_catalog_gate.test.sql'
node scripts/check-isolation-denominator.mjs
```

## Traceability

| AC | Owning test |
|---|---|
| AC-TWM-001..012 | pgTAP `supabase/tests/three_way_match.test.sql` |
| AC-TWM-013 | pgTAP `supabase/tests/three_way_match_mutation.test.sql` |

## Next slice (not in this plan)

Repository + DAL (`src/lib/repositories/procurement*`), `can('approve', 'billMatchException')`, receipt/bill lines
editor and match panel on the purchase screen (restructure; EN + ID strings), and the ERP pre-send question (OQ-TWM-2).
