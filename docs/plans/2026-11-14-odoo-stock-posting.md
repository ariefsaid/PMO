# Odoo stock posting — implementation plan (#1508)

**Draft, awaiting Director review and owner sign-off. No build has started.** The [spec](../specs/odoo-stock-posting.spec.md) and Director's 2026-11-14 decision select native project costing only. Missing module or flag blocks connected project issues with an actionable setup message; standalone stock still works. There is no journal fallback in this slice. A separate slice requires a separate decision if the module cannot be enabled. Whether this is a hard pre-14 December promise remains an owner decision and does not hold this draft.

**Execution gates:** Director-dispatched money work only, after sign-off, task 4 match seam lands and its contract is reviewed, and the Director schedules the reset and P0-free DB slot. Tasks 1–3 are mandatory bed discovery, not evidence already obtained. If a discovery oracle fails or produces an ambiguous result, stop, preserve evidence and obtain a revised design before Task 4. Do not change a test to match an unexpected outcome. Actual ERP field names and protocol from those tasks must be recorded before implementation. Bed or DB tasks require resource clearance, one heavy command at a time and the documented lock order. No production deploy is authorized.

## Architecture and contracts

PMO retains `stock_documents` as stable intent and the project/work-item association. `post_stock_document(uuid)` and `stock_post_core(uuid)` in `supabase/migrations/0413_stock_posting_engine.sql` are the existing posting boundary; connected mode must bypass standalone valuation without allowing a second writer. Existing `domain_externally_owned(org,'inventory')` is the ownership authority. ERP state is a side mirror, never a replacement for the immutable stock document. Odoo's completed movement and valuation are authoritative; an unknown outcome is pending or held, not zero or complete.

`pmo-portal/src/lib/adapterSeam/dispatch.ts` provides the existing durable outbox, generation fencing, `probeByRemarksKey`, `markOutboxHeld` and confirmation ordering. Fencing guards write-back, not an external create; configure the stock kind conservatively so inconclusive absence holds, and permit adoption only of one proven same-company, same-intent movement. The match seam must return an org-scoped mapping for each PMO item, location and project, with missing/ambiguous mappings rejected before sending; pass the exact landed task 4 types rather than duplicating mapping tables. Do not assume the external system stores the PMO work item. Read the completed ERP movement and native analytic lines, and compare the entire relevant ledger before marking the issue reconciled. Use paged reads and indexes on `(org_id, stock_document_id)` and ERP reference; cache no financial values outside the mirror.

**Tradeoffs:** native cost avoids duplicate project journals and uses Odoo valuation; unavailable installations must enable the module/flag. The conservative hold may require an operator after lost responses but avoids an unproven reissue. Standalone history and its ownership epoch remain readable; the ERP is the connected inventory and valuation authority. The proposed ADR-0097 already owns this architecture, so no duplicate ADR is proposed.

## Commands and test discipline

Run Deno tests from repo root using `deno test --allow-env --allow-net --allow-read <test-file>`; the concrete commands below replace `<test-file>` with a named file. Bed tests must fail, not skip, when explicitly requested but required bed settings are absent. Use synthetic isolated records, scoped company/project and cleanup in `finally`; never log credentials. For all implementation tasks write the named failing test first, run it to see the expected failure, then implement the minimum and rerun. Use the current next free migration number at execution, renumber with `scripts/renumber-migration.sh` on collision; the example files below use 0867 and must be renamed together if occupied. The Director schedules any reset; none is authorized by this plan itself.

### Task 1 — establish native stock and validation behavior (AC-OSP-002, 003)

1. Create `supabase/functions/_shared/odooStockProtocol.bed.test.ts` using `bindCall` from `pmo-portal/src/lib/adapterSeam/odoo/client.ts` and the dependency setup of `odooPurchaseFeed.bed.test.ts`. Assert installed `project_stock_account`, selected company and operation type; create a synthetic costed item, project and locations. Create and validate a full transfer and a project issue using stock Community APIs. Assert completed movement quantities and locations read back, project association, and exactly the analytic lines generated with flag on; repeat with flag off and assert no native project cost. Record the actual create, quantities, validation and wizard responses, including failure/partial cases, in `docs/research/2026-11-14-odoo-stock-protocol.md` without credentials or client data.
2. After the Director grants bed access, run `scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockProtocol.bed.test.ts'`. Verify the output names each executed test and has zero skips; a missing module, unsupported valuation or non-deterministic wizard blocks implementation. Do not make the test install modules on a shared bed without Director scheduling.

### Task 2 — prove recovery identity and crash windows (AC-OSP-004)

1. Create `supabase/functions/_shared/odooStockRecovery.bed.test.ts` with independent synthetic records. Exercise a create response lost before any anchor, an anchored draft before validation, validation with a lost response, a repeated probe, and a second same-looking transfer in the same company. Test the stock external identifier approach used by `pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts`, including whether it survives read-back and whether an unrelated or edited identifier can be distinguished. Assert a unique proven identity adopts, and absent, multiple, edited or otherwise ambiguous evidence holds with no additional create. Capture exact read/write calls and the safe crash-window rule in the protocol report. If no unique anchor can be proven, hold every uncertain create and do not invent a composite that adopts a look-alike.
2. Run `scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockRecovery.bed.test.ts'`. Require every case executed; send the Director any unresolvable crash window before proceeding.

### Task 3 — establish the whole-ledger oracle (AC-OSP-003)

1. Extend `supabase/functions/_shared/odooStockProtocol.bed.test.ts`: snapshot the synthetic company's relevant project analytic lines and accounting ledger before issue; issue known quantity from known-cost stock; read all affected lines after it, with pagination and source identities. Assert the signed delta in project cost matches the native valued issue exactly once, and enumerate any inventory/GL lines without treating both accounting representations as separate project expense. Repeat a recovery/read-back and assert no added project cost. Record valuation configuration, currency rounding, evidence and limitations in `docs/research/2026-11-14-odoo-stock-protocol.md`.
2. Repeat Task 1's exact command. A difference, missing valuation or inability to identify all relevant lines blocks the build; escalate its observed facts rather than adding a journal.

### Task 4 — capability preflight (AC-OSP-001)

1. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/capability.test.ts`: fake the existing `bindCall` boundary to return installed module/flag true, absent module, false flag, missing operation type, wrong company and a read failure. Assert only the first passes, the messages identify install `project_stock_account` or enable analytic costs as appropriate, and every refused case makes zero stock-write calls.
2. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/capability.ts`, export `checkStockCapability` taking the existing Odoo call, configured company and operation type, and return a typed success or actionable refusal. Read `ir.module.module` and `stock.picking.type` using fields verified by Task 1 and official source; never cache a success across a failed recheck. Verify from `pmo-portal/`: `npx vitest run src/lib/adapterSeam/odoo/stock/capability.test.ts`.

### Task 5 — setup gate (AC-OSP-001)

1. Add a failing case to `supabase/functions/external-set-company/odoo.test.ts`: missing module and disabled flag each return the setup reason and never activate connected inventory; a read error refuses activation. Add a standalone case proving the same missing capability does not block standalone stock.
2. Wire `checkStockCapability` into `supabase/functions/external-set-company/odoo/activate.ts` at the inventory enablement boundary, without changing unrelated domains. Verify `deno test --allow-env --allow-net --allow-read supabase/functions/external-set-company/odoo.test.ts` from repo root. Setup must identify the operation type, not silently toggle it.

### Task 6 — ownership and authorization guard (AC-OSP-005, 006)

1. Create `supabase/tests/odoo_stock_posting.test.sql` with transaction and rollback, following `supabase/tests/stock_tenant_isolation.test.sql`: assert draft documents prevent employment, historical standalone ledger persists, and non-keeper, foreign org, foreign company and mismatched project/work item cannot create a connected command. Assert no outbox row on refusal.
2. Add `supabase/migrations/0867_odoo_stock_posting.sql` and `supabase/migrations/rollback/0867_odoo_stock_posting_down.sql`. At the existing employment and posting boundaries enforce those checks and lock ownership/document consistently; do not add a standalone writer or accept `org_id` from a client. Verify after scheduled reset: `scripts/with-db-lock.sh supabase test db supabase/tests/odoo_stock_posting.test.sql`. Inspect the full TAP output and `finish()` for zero failures and parse errors.

### Task 7 — side mirror (AC-OSP-007)

1. Extend `supabase/tests/odoo_stock_posting.test.sql` to assert one mirror per org/document, cross-org reads/writes refused, service writes scoped to both org and company, and pending/held/failed/stale states cannot masquerade as confirmed.
2. Extend migration and rollback from Task 6 with a side mirror keyed by org and stock document, external model-qualified ref, state, source timestamps, completed quantity/value and exception; FORCE RLS, restricted grants, parent-org checks, unique/indexed org/document and scoped ref lookups. Values remain nullable until ERP evidence exists. Rerun Task 6's exact command.

### Task 8 — preflight mappings (AC-OSP-001, 006)

1. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/mappings.test.ts`: fake task 4's landed match seam, with mapped records, missing and ambiguous item/location/project, foreign company and foreign organization. Assert successful output is company-scoped and each invalid case returns before a write or outbox claim.
2. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/mappings.ts` consuming the landed seam directly. Return a read-only mapping bundle and a typed failure; require a project for issues and preserve PMO work-item identity separately. Verify from `pmo-portal/`: `npx vitest run src/lib/adapterSeam/odoo/stock/mappings.test.ts`. If the landed seam cannot provide these guarantees, stop and ask the Director rather than invent a second mapping path.

### Task 9 — transfer command (AC-OSP-002)

1. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/transfer.test.ts`: given authorized mapped stock and the protocol from Task 1, assert the outgoing ERP request expresses source, destination, item and quantity; rejected capability/mapping sends nothing; completed ERP values, not input-derived costs, are returned.
2. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/transfer.ts` using the exact observed stock API sequence, outbox contract, and model-qualified external references from `odoo/purchase/anchors.ts`. Refuse unhandled validation wizards. Verify from `pmo-portal/`: `npx vitest run src/lib/adapterSeam/odoo/stock/transfer.test.ts`.

### Task 10 — project issue (AC-OSP-003)

1. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/issue.test.ts`: assert the verified operation type and mapped `project_id` are passed on the transfer, the PMO work item is retained, and no `account.move` project journal is sent. Assert missing capability/mapping produces no stock write.
2. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/issue.ts` using Task 1's proven sequence and Task 8's mappings. The client never provides issue cost. Verify from `pmo-portal/`: `npx vitest run src/lib/adapterSeam/odoo/stock/issue.test.ts`.

### Task 11 — outbox recovery (AC-OSP-004)

1. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/recovery.test.ts`: simulate response loss at each Task 2 crash window, concurrent retries, a unique proven match, two matches, wrong company and a missing/mutable anchor. Assert one adopted transfer only when proven, all ambiguous states held, and no second create.
2. Create `pmo-portal/src/lib/adapterSeam/odoo/stock/recovery.ts`; integrate its probe through the existing `MoneyOutboxDeps` contract in `pmo-portal/src/lib/adapterSeam/dispatch.ts` and its Odoo caller. Set inconclusive reissue to false. Apply the Task 2 evidence, never a guessed anchor. Verify from `pmo-portal/`: `npx vitest run src/lib/adapterSeam/odoo/stock/recovery.test.ts`. Mutate the hold branch to reissue; this test must fail, then restore it.

### Task 12 — mirror and mismatch handling (AC-OSP-007)

1. Create `supabase/functions/_shared/odooStockMirror.test.ts`: assert missing lines, quantity mismatch, unreadable valuation and stale data remain pending or held with source and exception; a complete, matching read stores ERP quantity/value and source without inventing zero.
2. Create `supabase/functions/_shared/odooStockMirror.ts` and connect it to the existing outbox finalization path: verify org, company and document, write the mirror under the winning generation, then confirm only after complete evidence. Verify `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockMirror.test.ts`.

### Task 13 — integrated Odoo proof (AC-OSP-002, 003)

1. Extend `supabase/functions/_shared/odooStockProtocol.bed.test.ts` to invoke the shipped connected posting seam against a real synthetic PMO document and Odoo bed, with actual side-mirror reads. Assert transfer and project issue, work-item trace, valuation reconciliation and the whole-ledger oracle from Task 3; replay once and prove exactly one movement and one project cost. Use the same lock order as `odooPurchaseFeed.bed.test.ts`.
2. Run `scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY ODOO_BED_SUPABASE=1 deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockProtocol.bed.test.ts'`. Require actual executed tests, no skips, correct ledger deltas and cleanup.

### Task 14 — gates and reviews (all ACs)

From `pmo-portal/`, run `npm run check:guards`, `PMO_TEST_LOCK_SLOTS=1 ../scripts/with-test-lock.sh npm run typecheck`, and `npx eslint --max-warnings=0 src/lib/adapterSeam/odoo/stock/*.ts`. Run each directly touched test from Tasks 4–13 and touched e2e journeys only; no full local suite. Run the Task 6 pgTAP and Task 13 bed command only in the scheduled slot. Mutate the native-cost/no-extra-journal assertion and the recovery hold separately and show each owning test goes red; restore, rerun green. Review spec, quality and security, including money/SoD, tenancy, whole-ledger reconciliation and mutation evidence; acceptance maps each AC to its owning test. Ship alone through the Director's release process.

## Traceability

| AC | Owning test | Supporting tasks |
|---|---|---|
| 001 | `pmo-portal/src/lib/adapterSeam/odoo/stock/capability.test.ts` | 4, 5, 8 |
| 002 | `supabase/functions/_shared/odooStockProtocol.bed.test.ts` | 1, 9, 13 |
| 003 | `supabase/functions/_shared/odooStockProtocol.bed.test.ts` | 1, 3, 10, 13 |
| 004 | `pmo-portal/src/lib/adapterSeam/odoo/stock/recovery.test.ts` | 2, 11 |
| 005, 006 | `supabase/tests/odoo_stock_posting.test.sql` | 6, 7, 8 |
| 007 | `supabase/functions/_shared/odooStockMirror.test.ts` | 7, 12 |
