# Plan: CLI undo of an imported purchase (#2321)

Spec: `docs/specs/cli-undo-imported-purchase.spec.md`. Executor: Orca worker (money-adjacent, destructive: DB-enforced, pgTAP-proven).
Prior art: `undo_captured_purchase` (0896), `import_purchase_history` (0890), guard tier (0899), `pmo purchases undo-record-only`.

## Files
- `supabase/migrations/1030_undo_imported_purchase.sql` (+ `rollback/1030_undo_imported_purchase_down.sql`): security-definer `undo_imported_purchase(text, text, boolean default true)`.
- `supabase/migrations/1031_cli_guard_undo_import.sql` (+ `rollback/1031_cli_guard_undo_import_down.sql`): `api_client_request_guard()` = the 0899 body plus the `history_undo_rpcs` active-Admin tier.
- `supabase/tests/2321_undo_imported_purchase.test.sql` (pgTAP).
- `scripts/lib/pmo-purchases.mjs` (`validateUndoImport`, `runUndoImport`), `scripts/pmo.mjs` (`purchases undo-import`), tests in `scripts/pmo-purchases.test.mjs` and `scripts/pmo.test.mjs`.
- `scripts/isolation-probe-denominator.json` (the new definer is listed). `docs/runbooks/pmo-cli.md`, `docs/glossary.md`.

## Tasks (test first)
1. CLI unit tests (AC-CLUI-001..004) red, then `runUndoImport` / `validateUndoImport` / command wiring green.
2. pgTAP file (AC-CLUI-005..011) written against the spec; migration 1030 makes it green (CI `pgtap`; not runnable without Docker).
3. Migration 1031 and its rollback; the guard-coverage and tier-match node tests stay green.
4. Mutation checks (see the pgTAP header) run where Docker exists.
5. Runbook and glossary.

## Owning layer per AC
| AC | Layer | Owner |
|---|---|---|
| AC-CLUI-001, 002, 003 | unit (node:test, mocked client) | `scripts/pmo-purchases.test.mjs`, `scripts/pmo.test.mjs` |
| AC-CLUI-004 | unit (reads the migration) | `scripts/pmo-purchases.test.mjs` |
| AC-CLUI-005 .. 011 | pgTAP | `supabase/tests/2321_undo_imported_purchase.test.sql` |

## Verify
`node --test scripts/pmo-purchases.test.mjs scripts/pmo.test.mjs scripts/api-client-guard-coverage.test.mjs`; in `pmo-portal/`: `npm run check:guards`, `npm run typecheck`; CI `pgtap` for the SQL.
