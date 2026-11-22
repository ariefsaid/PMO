# Plan: opening stock with movement history

Spec: `docs/specs/opening-stock-history.spec.md`. Ships alone (OD-SCOPE-5). Executor: Director-dispatched Orca worker, Opus (stock ledger).
Read first: `docs/money-path-primer.md`, `0413_stock_posting_engine.sql`, `1046_opening_balances.sql`, `1029_stock_site_work_locations_tags.sql`, the highest-numbered definitions of `reverse_opening_balance` and `opening_balance_report` (1209 or later; confirm with `scripts/prior-art.sh`), `pmo-portal/src/lib/import/stockItemDescriptor.ts`.

## 1. Design (the design changes where it runs the other way)

The balance-only `load_stock_opening` and the history load must be one posting path. So:
- `opening_post_location(p_org, p_warehouse, p_as_of, p_rows jsonb, p_note, p_request uuid)` (internal, definer, not granted): creates the `opening` document + lines, locks balances (`stock_lock_for_document`), writes each entry through `stock_write_entry` with a local copy of the document row carrying the row's date, sets Posted, inserts `opening_balances`. Both entry points call it.
  `load_stock_opening` (restated, same signature, same behaviour) maps counted lines to rows `{item, in, qty, cost}`.
- `opening_history_plan(p_org, p_as_of, p_lines jsonb)` (stable, definer, internal): the single validator and running-balance calculation (date order, file order). Returns one row per input row (verdict, code, running qty and value) used by both preview and confirm; confirm re-runs it inside the transaction under the existing advisory lock so preview and post cannot drift.
- `preview_stock_opening_history(p_as_of, p_lines)` (stable, definer, Admin): plan + closing balance per item and location. Writes nothing.
- `load_stock_opening_history(p_as_of, p_lines, p_client_request_id, p_note) returns setof uuid` (volatile, definer, Admin): atomic; one opening per location; idempotent on the request id.
- `reverse_opening_balance` restated: for history documents (lines with `quantity` + `direction`) it writes one netting entry per item (negative net) instead of negating counted lines.
- Zero cost: `unit_cost` for a zero-cost item is set to 0 by the routine when blank; the existing trigger `guard_stock_line_zero_cost` stays the refusal for a non-zero value. No new rule beside it.
- No second write path: `scripts/stock-single-writer.test.mjs` must still pass; the new functions only call `stock_write_entry`.

## 2. Migrations (1900-1909) and rollbacks (`supabase/migrations/rollback/<n>_..._down.sql`)

- `1900_opening_stock_history_schema.sql`: `stock_document_lines` add `occurred_on date`, `reference text check (reference is null or length(reference) <= 100)` (null on every existing row; `unit_cost`/`direction` columns already exist); grant select of the two new columns to authenticated (cost stays ungranted);
  `opening_balances` add `client_request_id uuid` with a unique index `(org_id, client_request_id, warehouse_id)` where not null. Rollback drops them.
- `1901_opening_stock_history_rpcs.sql`: the functions of section 1 (restating `load_stock_opening` from 1046 and `reverse_opening_balance` from its highest-numbered definition, verbatim plus the change); revokes and grants (`authenticated` for the three public RPCs; none for internals). Rollback restores the previous bodies and drops the new ones.
- `1902_cli_opening_stock_history.sql` only if the Admin command-line tier should carry the two new RPCs: restates `api_client_request_guard` from its highest definition with the names added (decision for the Director; default: yes, same tier as `load_stock_opening`, 1047).
- Gates: `npm run check:restated-functions`, `check:migrations`, anon-definer inventory (new internals not granted to anon).

## 3. Tests (written first)

- `supabase/tests/1900_opening_stock_history.test.sql`: AC-OSH-001..011, with the mutation instruction: "Mutation check: (a) set the zero-cost branch in the routine to keep the given cost, AC-OSH-004 must go red; (b) remove the running-balance check in the plan, AC-OSH-006 must go red; (c) make confirm skip the Admin check, AC-OSH-001 must go red; restore each." Also extends the AC-STK-004 query to `opening` rows (AC-OSH-009).
- `supabase/tests/0646_rls_initplan.test.sql` and the anon-definer inventory must stay green (policies untouched; helpers in new functions are definer-internal).
- Vitest: `pmo-portal/src/lib/import/stockMovementHistoryDescriptor.test.ts` (AC-OSH-013), `pmo-portal/src/lib/db/stockOpening.test.ts` (typed DAL, generated types, no casts), `pmo-portal/pages/stock/StockOpeningHistory.test.tsx` (AC-OSH-014), refusal-sentence test (AC-OSH-015).
- E2E (one journey): `pmo-portal/e2e/AC-OSH-014-opening-stock-history.spec.ts`, serial lane (posts to the ledger); read `docs/e2e-parallel-conventions.md`.

## 4. Front end

- `pmo-portal/src/lib/db/stockOpening.ts` (preview, load, request id) + `pmo-portal/src/lib/repositories/stockOpening.ts` (repository seam, ADR-0017); regenerate types from the migration, no casts.
- `pmo-portal/src/lib/import/stockMovementHistoryDescriptor.ts`: the seven-column template (`wide`, `maxRows` 5000), aliases in EN and ID, template example and downloadable file. Row validation mirrors the preview; the database preview is the oracle.
- `pmo-portal/pages/stock/StockOpeningHistory.tsx` (route in `App.tsx`, link from Stock set-up, gated `can('manage','warehouse')`-level Admin rule via `src/auth/policy.ts`): per spec section Screen. Follow `.claude/skills/restructure/SKILL.md`, `DESIGN.md` tokens, shared primitives, `docs/ux/screen-rules.md`; disabled Confirm says why; EN and ID in `public/locales/{en,id}`; `scripts/ux-proof.sh` on the route at 390 and 1440.
- `pmo-portal/src/lib/refusals.ts` figures where a sentence needs a row number; sentences in `public/locales/{en,id}/refusals.json`.

## 5. Order of work and traceability

1. pgTAP red (AC-OSH-001..011) then 1900/1901. 2. DAL + repository (AC owned by Vitest). 3. Descriptor (AC-OSH-013). 4. Screen (AC-OSH-014). 5. Refusal sentences (AC-OSH-015). 6. e2e. 7. Glossary: "Opening stock history", "Go-live date"; update `docs/specs/opening-balances.spec.md` FR-OPB-006 pointer. 8. Report mutation results.
AC-OSH-012 is the existing single-writer guard (no new test).

## 6. Questions only the customer can answer (recommended answer; what is built meanwhile)

1. Do history `out` rows need a destination (project or work order)? Recommend no: history is the start of the ledger, not project cost, and the file stays one template. Built: no destination column; project cost totals unchanged.
2. How far back does the history go and how many rows per location? Recommend from the first receipt still on hand or the first client-supplied delivery, up to 5000 rows per file. Built: cap 5000, any date up to go-live.
3. For cost items, is the unit cost in the history the purchase price per receipt? Recommend yes (moving average derives from it). Built: required on `in` rows of cost items.
4. Should the closing balance be checked against a physical count in the same file? Recommend not in the file; the preview shows the closing balance to compare, and a count after go-live (existing count document) corrects differences. Built: preview only.
5. May a location that already received an opening counted balance be replaced by a history? Recommend reverse then reload (existing reverse). Built: refused with next step.
