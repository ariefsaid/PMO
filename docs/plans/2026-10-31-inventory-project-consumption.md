# Inventory and project consumption - implementation plan (#1512)

Spec: [`docs/specs/inventory-project-consumption.spec.md`](../specs/inventory-project-consumption.spec.md) (draft, owner sign-off pending; this plan takes the spec's stated defaults). Route item T1 of [`2026-10-30-epc-odoo-build-route.md`](2026-10-30-epc-odoo-build-route.md); map #1481. Decision tickets #1487, #1485, #1486, #1484 (all closed). Ownership: proposed ADR-0094.
Gate: **money path** (stock valuation, keeper and write-off SoD). Executor: Director-dispatched Orca workers, **one worker per slice, each slice its own branch**, never batched with other branches (CLAUDE.md money tier, `docs/orca-dispatch.md`). Role contract: `.claude/agents/eng-planner.md`.
Everything cited below was checked against `origin/dev` at `1ccadb793` (migration head `0409_document_preview_sources.sql`; `0410` is reserved for billing kinds). A path marked **(new)** does not exist yet; every other path was confirmed with `git cat-file -e origin/dev:<path>` (result at the foot of this file).

> **Brief mismatch, resolved:** the dispatch brief said `gh issue view 1471`. #1471 is "Build: contract billing vs other billing" (billing kinds, already planned in `2026-10-31-billing-kinds.md`). The inventory issue is **#1512**; this plan is for #1512.

## Open questions (answer before dispatch, or accept the stated default)

The spec already carries OQ-STK-1..10 with defaults. The plan takes all ten unchanged. The questions below are **new**, found while planning; each default lets a builder start, and each names the one slice that changes if the answer differs.

| # | Question | Default taken | Slice |
|---|---|---|---|
| PQ-1 | Who may **author** (create a Draft or create-and-post) a document? The spec only gates the poster of Receive / Transfer / Issue / Return (FR-STK-061) and the poster of Adjustment / Count (FR-STK-062). | The author of **any** kind must be a keeper of the document's warehouse (Admin exempt, audited when used). Posting Receive / Transfer / Issue / Return additionally re-checks the keeper. Adjustment / Count posters need no keeper, only FR-STK-062 (a PM can approve a write-off on a site they do not keep). | S2a, S4 |
| PQ-2 | A **future** `occurred_on`: FR-STK-016 reads "refuse a future date and a date older than 31 days for anyone but Admin". | Future dates are refused for **everyone**, Admin included; Admin is exempt only from the 31-day limit. AC-STK-021 only asserts non-Admin refusal, so both readings pass it. | S2a |
| PQ-3 | Client-supplied cost on an Issue / Transfer / Return line (FR-STK-017, AC-STK-010 says "ignored or refused"). | **Ignored** (the RPC never reads it; the stored column is null). A refusal would add an error path the offline queue (#1520) then has to explain. | S2a |
| PQ-4 | Receive needs `unit_cost` (required, >= 0) but cost is readable only at rank >= 20 (FR-STK-063). An Engineer storekeeper can type a cost and never read it back. | Accepted. The form labels the field "Unit cost (you will not see it again)" for rank < 20. Alternative (cost from the PO line) is impossible: `procurement_items` is free text. | S3 |
| PQ-5 | Reorder suggestion "to the unit's precision" (FR-STK-051): a fractional unit. | Whole-number unit: `ceil(x)`. Fractional unit: `ceil(x * 1000) / 1000` (the 3-decimal storage scale). | S6 |
| PQ-6 | Who may **accept / edit / clear** a reorder level (FR-STK-053 says "authorised user")? | `role_rank >= 20` (Project Manager and above, the same set as master data). | S6 |
| PQ-7 | Who may set a **material allowance** (FR-STK-050 lists PM, Executive, Finance, Admin; AC-STK-024 refuses "a PM of the project" setting one on another project's line)? | Reuse `may_record_project_progress(project_id)` (0245): Finance rank and above, or the **project's own** PM. This is the only reading under which AC-STK-024 can pass for a PM. | S5 |
| PQ-8 | Navigation: a new org-feature key (`org_features`, migration 0070) to hide Stock until an org opts in? | **No flag.** Stock shows for every role (quantities are visible to all active members, OQ-STK-10; the Engineer is the interim storekeeper). A flag would also need a migration to widen the `org_features` key check. Flip later with a `feature:` on the Rail item. | S3 |
| PQ-9 | Changing a **unit's** "whole numbers only" flag after movements exist would re-interpret history (the item-unit lock FR-STK-008 covers `unit_id`, not the flag). | Refused once any item of that unit is referenced by a document line (`STK_UNIT_LOCKED`). One trigger, no UI. | S2a |
| PQ-10 | E2E data cannot be cleaned up: the ledger is append-only for everyone, including the service role. | Both curated journeys are `self-isolated` and namespace every code with a per-run suffix; leftovers are never read by another spec; `scripts/e2e-local.sh --reset` clears them. `scripts/check-e2e-isolation.sh` must accept the header; the builder runs it. | S3 |

## Spec deltas found while verifying (none change a requirement)

1. **Migration numbers.** The spec reserves none; this plan reserves `0411`-`0417` (table below). Other open spec branches (`spec/odoo-connect-master-data`, `spec/budget-push-v16`) may also want numbers: every slice starts with `scripts/check-migration-collisions.sh` and, on a clash, `scripts/renumber-migration.sh <old> <new>` (never a hand `git mv`).
2. **`quantity` on a Count line.** The spec's `stock_document_lines.quantity` is `> 0`, but a count can legitimately be 0. The plan makes `quantity` nullable and adds a check that exactly one of `quantity` / `counted_quantity` is set (Count lines use `counted_quantity`, all other kinds use `quantity`).
3. **Extra ledger columns.** `seq bigint identity` (total order and keyset cursor), `qty_after`, `value_after` (running balance without a window function), `source_line_id` (return cap and cost-left-at lookup). Spec says "column names are the plan's to finalise"; no requirement changes.
4. **Read RPCs return `jsonb`** (cost keys *omitted* for rank < 20, numerics as strings). Reason: AC-STK-020 says cost fields are "absent from the response" (a typed row can only say `null`), a single `jsonb` value is not subject to PostgREST `max_rows = 1000`, and strings keep quantity and money out of JS floats (NFR-STK-007; precedent `ExactMoney = string` in `pmo-portal/src/lib/projectFinances.ts`). Each RPC refuses (`STK_TOO_MANY`) rather than truncate past 5,000 rows.
5. **Additional stable codes** beyond the spec's list (`STK_INSUFFICIENT`, `STK_NOT_KEEPER`, `STK_OWNED_BY_ERP`, `STK_SELF_APPROVE`, `STK_RANK`, `STK_PROJECT_NOT_ACTIVE`, `STK_BOQ_MISMATCH`, `STK_RETURN_EXCEEDS`, `STK_ARCHIVED`, `STK_FRACTION`, `STK_BACKDATE`): `STK_HAS_STOCK` (archive refused while stock on hand), `STK_UNIT_LOCKED` (PQ-9 and FR-STK-008), `STK_INVALID` (malformed payload / per-kind shape), `STK_NOT_FOUND` (foreign or missing parent id; also the cross-tenant refusal), `STK_TOO_MANY` (report cap), `STK_KIND_UNAVAILABLE` (S2a stubs only, removed by S2b / S4), `STK_IMMUTABLE` (a Posted / Cancelled document, its lines or any ledger row; AC-STK-011).
6. **Draft editing needs an RPC.** FR-STK-011 lets an author edit a Draft, but documents and lines have no client write grant (FR-STK-060). The plan adds `save_stock_draft` (S2a). Count sheets (S4) need it.
7. **AC-STK-004, 019, 034 are completed across slices.** Each has exactly one owning test **file**; later slices append assertions to it (named in the traceability table), because the tables / RPCs they cover arrive later.
8. **`get_stock_on_hand` has no "below reorder level" filter.** Reorder levels arrive in S6. FR-STK-040's filter is the S6 worklist RPC `get_stock_below_reorder`, reached from a toggle on the same screen. No S3 function is rewritten later.
9. **`boq_items` has no seed rows** at `origin/dev` (`grep boq supabase/seed.sql` is empty). Seeds in this plan add BoQ lines only to a project the builder confirms no existing test reads (S5.1).
10. **`stock_document_lines` is not `select *`-able.** Column-level SELECT excludes `unit_cost`; PostgREST rejects `select=*` on such a table. The DAL lists columns explicitly (S3).
11. **Receive has no project**, so FR-STK-020's "and the same project when the case has one" clause is vacuous: a receipt only checks the case is in the caller's org (AC-STK-029). A project clause belongs with #1508 if the receipt ever gains a project.
12. **Adjustment lines need a direction.** Adjust-in and adjust-out share one document kind and the spec has no signed quantity, so the plan adds `stock_document_lines.direction ('in'|'out')`, required on adjustment lines only.
13. **No separate "no residue" mutation case.** `round(q * V / Q, 2)` multiplies before it divides, so for `q = Q` it already returns `V` exactly; the whole-remaining branch is belt and braces. AC-STK-003 is therefore proved twice (all 3 at once; 3 single moves) and bound to the code by the `avg` mutation, not by a case that cannot go red.

## Architecture

### ADR

**One ADR is needed: ADR-0097 "Stock ledger, moving-average valuation and the standalone / connected ownership split".** It is architectural (an append-only money ledger whose valuation source is swapped, not duplicated, when an ERP is employed; it fixes which columns PMO keeps authoritative in each mode, restating ADR-0094 in schema form). The spec assigns it to S2a. **It is written in S2a (Task S2a.0), not now**: ADR-0094 is still *Proposed* and ADR-0097 would rest on an unsigned decision; S2a.0 gives the exact outline. The number is 0097 because 0095 is the head on `dev` and **0096 is already taken on the in-flight branch `feat/posthog-s0`** (`docs/adr/0096-server-operational-telemetry-vs-consent-gated-analytics.md`); re-run `npm run check:adrs` and `git ls-tree origin/<branch> docs/adr/` across remote branches at S2a.0 and take the next free number. No other slice needs an ADR; slice-level choices go to `docs/decisions.md` as `DD-STK-n`.

### Design decisions (one each; the "why" is the spec's unless stated)

- **D1 Single writer, SQL only.** All stock arithmetic lives in plpgsql definer functions. The client never sends a cost for a stock-out, never computes a balance, and has no write grant on any document, ledger or balance table (FR-STK-060, FR-STK-072). `stock_write_entry` is the **only** function that inserts into `stock_ledger` or updates `stock_balances`; a repo-wide grep test (S2a.9) fails if any other migration or function body does.
- **D2 Per-kind logic behind a fixed dispatcher.** `post_stock_document` / `create_stock_document` call one dispatcher `stock_apply(doc, post boolean)` that calls `stock_apply_<kind>(doc, post)`. `post = false` runs the static validation only (project active, work item matches, return cap); `post = true` revalidates and writes. S2a ships real Receive / Transfer and **stubs** for the other four that raise `STK_KIND_UNAVAILABLE`; S2b and S4 `create or replace` only their own `stock_apply_*` functions, so no slice rewrites another slice's body and the dispatcher never changes.
- **D3 Lock order is global and fixed:** (1) the document row `FOR UPDATE`; (2) for a Return, the cited issue lines `FOR UPDATE` in `id` order; (3) every `(item_id, warehouse_id)` balance row `FOR UPDATE` in ascending `(item_id, warehouse_id)` order (`stock_lock_balance` inserts a zero row `ON CONFLICT DO NOTHING` first, then locks). Both legs of a transfer are in the one sorted set. `CHECK (qty_on_hand >= 0 and value_on_hand >= 0 and (qty_on_hand > 0 or value_on_hand = 0))` is the backstop. **How the order is asserted** (NFR-STK-002; pgTAP is single-session): S2b.7 adds a two-session `psql` script in the style of `pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs` that (a) races two issues of 6 against 10 on hand and requires exactly one `STK_INSUFFICIENT`, and (b) fires opposing transfers (A to B, B to A) 50 times in parallel and requires **zero** `40P01` deadlocks.
- **D4 Moving average, exact.** Stock-out value = `round(q * value_on_hand / qty_on_hand, 2)`; a stock-out of the whole remaining quantity takes the whole remaining value (no residue). Stock-in adds `round(q * unit_cost, 2)`. A Return re-enters at the cost its cited issue line left at (the final partial return takes the remainder so cumulative returned value never exceeds issued value). Valuation follows posting order (`seq`), never `occurred_on`.
- **D5 Cost never leaves the server below rank 20.** `stock_ledger`, `stock_balances` and `stock_document_lines.unit_cost` have no client SELECT grant. Read RPCs call `stock_can_see_cost()` = `coalesce(role_rank(auth_role()) >= 20, false)` (ADR-0070: rank, no role list) and omit cost keys otherwise.
- **D6 Ownership guard is first and fails closed.** `stock_assert_standalone(org)` runs before any write in create-and-post and post: `domain_externally_owned(org, 'inventory')` true, null or erroring all refuse `STK_OWNED_BY_ERP`. Reads are unaffected (FR-STK-070).
- **D7 Idempotency.** `unique (org_id, created_by, client_request_id) where client_request_id is not null`; the create RPC `INSERT ... ON CONFLICT DO NOTHING RETURNING`, and on conflict returns the existing document id without touching lines or the ledger (FR-STK-015).
- **D8 Reports aggregate in SQL; paging is keyset on `seq`.** `get_stock_ledger(..., p_before_seq, p_limit <= 200)` is far below `max_rows`, returns `qty_after` / `value_after` as the running balance, and the FE follows the cursor (`seq` of the last row) until a short page.
- **D9 Month = `date_trunc('month', occurred_on)`.** `occurred_on` is already an org-timezone date (defaulted from `organizations.default_timezone`), so the report needs no timezone arithmetic.
- **D10 FE follows ADR-0016/0017.** Pages -> hooks -> `repositories.stock` -> DAL (`src/lib/db/stock*.ts`) -> RPC / RLS. `can()` gates affordances on the **real** role, UX only. No `org_id` is ever sent from the client.

### Slice map (migration numbers are reserved per slice, not per build order)

| Slice | Migration | Tasks | Blocked by | Suggested worker tier |
|---|---|---|---|---|
| **S1 Master data** | `0411_stock_master_data.sql` | S1.1-S1.14 | none | Flash/Luna may build; Terra reviews RLS |
| **S2a Posting engine, in-flows** | `0412_stock_posting_engine.sql` | S2a.0-S2a.13 | S1 | **Terra or Sol** (money) |
| **S2b Posting engine, out-flows** | `0413_stock_out_flows.sql` | S2b.1-S2b.7 | S2a | **Terra or Sol** (money) |
| **S3 Movement screens + read RPCs** | `0414_stock_read_rpcs.sql` | S3.1-S3.13 | S2b | Terra (RPC) then Flash (UI) |
| **S4 Adjustment and count** | `0415_stock_adjust_count.sql` | S4.1-S4.9 | S2a (UI after S3 components) | **Terra or Sol** (SoD) |
| **S5 Allowance and consumption** | `0416_stock_allowance_consumption.sql` | S5.1-S5.10 | S2b, S3 | Terra |
| **S6 Reorder** | `0417_stock_reorder.sql` | S6.1-S6.6 | S2b | Terra |

Order: S1 -> S2a -> S2b -> (S3 and S4 in parallel; S4's UI waits for S3's shared components) -> S5 -> S6. Parallel S3/S4 builders both touch `src/lib/repositories/index.ts`, `types.ts`, `src/auth/policy.ts`, `public/locales/*/stock.json`: **rebase immediately before each PR** (CLAUDE.md #1070 rule) and merge S3 first. Money / SoD slices (S2a, S2b, S4) ship **alone**, not batched.

Each slice branch: `feat/stock-<slice>` off `origin/dev`, own worktree, `.env.local` copied in. Workers push the branch only; the Director opens PRs and merges (no worker PR; owner rule 2026-10-30).

## Conventions every task follows

- **Test files.** pgTAP in `supabase/tests/stock_<topic>.test.sql` (self-contained, begins `begin; create extension if not exists pgtap; select plan(N);` and ends `select * from finish(); rollback;`). Vitest next to the source (`*.test.ts` / `*.test.tsx`). Playwright in `pmo-portal/e2e/AC-STK-###-<slug>.spec.ts` with `// @e2e-isolation:` on line 1 (`docs/e2e-parallel-conventions.md`).
- **AC tag.** The owning test names its AC id as the leading token of the pgTAP description / the `it(...)` title / the `test(...)` title (CLAUDE.md "AC-id tagging").
- **DB commands** run under the lock, reset and test in **one** hold:
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<file>.test.sql'`.
  A task that does not change a migration or seed runs only `scripts/with-db-lock.sh supabase test db supabase/tests/<file>.test.sql`.
- **Per-slice local final gate** (CLAUDE.md, owner rule 2026-10-26), from `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the directly touched vitest files (`npx vitest run <files>`, never `--changed`, never the full suite), touched e2e (`scripts/e2e-local.sh <fragment>`), `scripts/ux-proof.sh <routes>` for UI, touched pgTAP only. No `npm install` on macOS; `package.json` is not touched by this plan.
- **FE test sketches.** pgTAP and DAL / SQL code in this plan is complete. For React screens the plan gives each Vitest/RTL test as its **title plus the exact oracle in a comment** (what must be rendered or called); the builder writes the body on the harness of the named sibling (`pmo-portal/pages/Companies.test.tsx` for pages, `pmo-portal/src/lib/db/companies.test.ts` for a DAL, `pmo-portal/src/lib/repositories/progressBilling.test.ts` for a repository) and the failing run before the implementation is mandatory. Strings come from the `stock` i18n namespace via `useTranslation('stock')`, never inline.
- **Hosted-grants lesson (0185/0210).** Every function ends with explicit `revoke all on function ... from public, anon;` plus `revoke ... from authenticated` for internals; client RPCs then `grant execute ... to authenticated`. Every **client-callable writer** (definer whose body contains insert/update/delete) is added to the allow-list in `supabase/tests/0178_anon_executable_definers.test.sql` (VALUES list `client_callable_rpc_names`, header note, and the hard-coded count; re-derive the count by hand after any rebase). Read-only definers are not swept.
- **Rollback files.** Each migration has `supabase/migrations/rollback/<n>_<slug>_down.sql` (precedent `0409_document_preview_sources_down.sql`), dropping in reverse dependency order. Pre-production reversal is also `supabase db reset`.
- **Types.** After a migration: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`, then `npm run typecheck` (`check:shadow-types` fails on a hand-written shadow of a row type).
- **Public repo.** No tenant data, hostnames, emails or vault names in seeds or docs. Seed users are the existing `*@acme.test` accounts; fixtures use synthetic UUID prefixes `1512....`.
- **Commits.** Conventional, no attribution, no `Co-authored-by`. Before every push: `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must NOT match. Pre-commit hook: `.githooks/pre-commit` (never `--no-verify`).

## Shared pgTAP prelude (Fixture F1, copied verbatim into every stock pgTAP file; extend, never fork)

```sql
begin;
create extension if not exists pgtap;
select plan(0); -- replace 0 with the real count

insert into organizations (id, name, default_currency, default_timezone) values
  ('15120000-0000-0000-0000-000000000001', 'STK Org',       'IDR', 'Asia/Jakarta'),
  ('15120000-0000-0000-0000-000000000002', 'STK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15120000-0000-0000-0000-0000000000a1', 'stk-admin@example.com'),
  ('15120000-0000-0000-0000-0000000000a2', 'stk-fin@example.com'),
  ('15120000-0000-0000-0000-0000000000a3', 'stk-pm@example.com'),
  ('15120000-0000-0000-0000-0000000000a4', 'stk-keep1@example.com'),   -- Engineer, keeps site A
  ('15120000-0000-0000-0000-0000000000a5', 'stk-keep2@example.com'),   -- Engineer, keeps site B
  ('15120000-0000-0000-0000-0000000000a6', 'stk-eng@example.com'),     -- Engineer, keeps nothing
  ('15120000-0000-0000-0000-0000000000b1', 'stk-xorg@example.com');    -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a1', '15120000-0000-0000-0000-000000000001', 'STK Admin', 'stk-admin@example.com', 'Admin', 'active'),
  ('15120000-0000-0000-0000-0000000000a2', '15120000-0000-0000-0000-000000000001', 'STK Fin',   'stk-fin@example.com',   'Finance', 'active'),
  ('15120000-0000-0000-0000-0000000000a3', '15120000-0000-0000-0000-000000000001', 'STK PM',    'stk-pm@example.com',    'Project Manager', 'active'),
  ('15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-000000000001', 'STK Keep1', 'stk-keep1@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a5', '15120000-0000-0000-0000-000000000001', 'STK Keep2', 'stk-keep2@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a6', '15120000-0000-0000-0000-000000000001', 'STK Eng',   'stk-eng@example.com',   'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000b1', '15120000-0000-0000-0000-000000000002', 'STK XOrg',  'stk-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000000001', 'STK Ongoing',  'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000000001', 'STK On Hold',  'On Hold',         1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1', 'Slab pour',   'm3', 50, 1000),
  ('15120000-0000-0000-0000-0000000000e2', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c2', 'W-2', 'Other pour',  'm3', 50, 1000);
-- S1 adds below (master data, as superuser so the fixture does not depend on the RLS under test):
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d1', '15120000-0000-0000-0000-000000000001', 'bag', 'Bag',   true),
  ('15120000-0000-0000-0000-0000000000d2', '15120000-0000-0000-0000-000000000001', 'm',   'Metre', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001001', '15120000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '15120000-0000-0000-0000-0000000000d1'),
  ('15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '15120000-0000-0000-0000-0000000000d2');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000000001', 'CEN',    'Central',  'central'),
  ('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',   'site'),
  ('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',   'site'),
  ('15120000-0000-0000-0000-000000002009', '15120000-0000-0000-0000-000000000002', 'XCEN',   'X Central','central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000a4'),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000a5');
```

Role switching is the repo idiom: `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';` and `reset role;` to return to the superuser.

**Fixture ids** (all valid hex; the last UUID group is 12 digits, prefix `15120000-0000-0000-0000-`). Where a snippet below writes a name in capitals it stands for the literal; `psql -v` variables are not available inside `supabase test db`, so the builder pastes the literal.

| Name | Last group | Meaning |
|---|---|---|
| `U_ADMIN` `U_FIN` `U_PM` `U_K1` `U_K2` `U_ENG` `U_XORG` | `0000000000a1`..`a6`, `0000000000b1` | Admin, Finance, Project Manager (manages `P_ON`), Engineer keeping SITE-A, Engineer keeping SITE-B, Engineer keeping nothing, other-org Admin |
| `ORG` `ORG_X` | `000000000001`, `000000000002` (first four groups `15120000-0000-0000-0000-`) | the two orgs |
| `P_ON` `P_HOLD` | `0000000000c1`, `0000000000c2` | Ongoing Project, On Hold project |
| `BOQ_ON` `BOQ_HOLD` | `0000000000e1`, `0000000000e2` | BoQ lines of `P_ON`, `P_HOLD` |
| `UNIT_BAG` `UNIT_M` | `0000000000d1`, `0000000000d2` | whole-only bag, fractional metre |
| `ITEM_CEM` `ITEM_CAB` | `000000001001`, `000000001002` | cement (bag), cable (m) |
| `WH_CEN` `WH_A` `WH_B` `WH_X` | `000000002001`, `000000002002`, `000000002003`, `000000002009` | central, SITE-A, SITE-B, other-org central |

A tiny helper at the top of every file keeps calls short (created in `public` by the superuser inside the test transaction, so it vanishes at rollback; `pg_temp` is avoided because the `authenticated` role may not resolve a superuser's temp-schema function):

```sql
create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- usage: select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4'); ... reset role;
```

> Call `public.stk_t_as_user` only as the superuser (after `reset role;`): `set local role` cannot be issued twice in a row from the restricted role.

---

# Slice S1 - Master data (`0411_stock_master_data.sql`)

Builds: `stock_units`, `stock_items`, `stock_warehouses`, `stock_warehouse_keepers`; RLS; audit; `set_stock_warehouse_keeper`; DAL, repository, hook, `can()` entities, Setup screen, route and nav, i18n namespace, glossary, seed. Owns: AC-STK-034 (role part), AC-STK-033 (master-data rows), AC-STK-019 (its four tables). FRs: 001-004, 007, 066 (master + keeper audit).

### Task S1.1 - branch and collision check (2 min)
```bash
git fetch origin && git worktree add ../stk-s1 -b feat/stock-s1-master-data origin/dev   # Director does this; worker is handed the worktree
cp /path/to/main/.env.local pmo-portal/.env.local
bash scripts/check-migration-collisions.sh && ls supabase/migrations | tail -3   # expect head 0409 (or later); 0411 free
```
If `0411` is taken, `scripts/renumber-migration.sh 0411_stock_master_data <free>` and carry the new number through every later reference in this slice.

### Task S1.2 - failing pgTAP: master-data roles, keepers, audit (AC-STK-034)
Create `supabase/tests/stock_master_data.test.sql` = prelude F1 **without** the stock inserts (the test creates its own through the RPC/RLS under test) plus:
```sql
select plan(14);
-- 1-3: master-data writers (rank >= 20) can create; Engineer cannot (AC-STK-034)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');          -- U_PM
select lives_ok($$ insert into stock_units (code, name, whole_only) values ('kg','Kilogram',false) $$, 'FR-STK-007 a Project Manager creates a unit');
select lives_ok($$ insert into stock_items (code, name, unit_id) select 'STEEL','Rebar 12mm', id from stock_units where code='kg' $$, 'FR-STK-007 a Project Manager creates an item');
select lives_ok($$ insert into stock_warehouses (code, name, kind) values ('CENTRAL','Central store','central') $$, 'FR-STK-007 a Project Manager creates a warehouse');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');          -- U_ENG
select throws_ok($$ insert into stock_units (code, name) values ('pcs','Pieces') $$, '42501', null,
  'AC-STK-034 an Engineer cannot create a unit');
select throws_ok($$ insert into stock_items (code, name, unit_id) select 'X','X', id from stock_units limit 1 $$, '42501', null,
  'AC-STK-034 an Engineer cannot create an item');
select throws_ok($$ insert into stock_warehouses (code, name, kind) values ('W','W','site') $$, '42501', null,
  'AC-STK-034 an Engineer cannot create a warehouse');
reset role;
-- 7: codes unique per org ignoring case (FR-STK-001)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_units (code, name) values ('KG','Dup') $$, '23505', null, 'FR-STK-001 unit codes are unique ignoring case');
reset role;
-- 8-10: only an Admin changes keepers (AC-STK-034), audited (FR-STK-004)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a2');          -- U_FIN
select throws_ok($$ select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000a4', true) $$,
  '42501', null, 'AC-STK-034 Finance cannot assign a keeper');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');          -- U_ADMIN
select lives_ok($$ select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000a4', true) $$,
  'AC-STK-034 an Admin assigns a keeper');
select throws_ok($$ insert into stock_warehouse_keepers (warehouse_id, user_id) select id, '15120000-0000-0000-0000-0000000000a5' from stock_warehouses where code='CENTRAL' $$,
  '42501', null, 'FR-STK-060 even an Admin has no direct write grant on keepers');
reset role;
select is((select count(*)::int from audit_events where action = 'stock.keeper.assign'), 1, 'FR-STK-004 the keeper assignment is audited with actor and time');
-- 12: tenancy of the parent id (AC-STK-019 for stock_items)
select set_config('stk.unit', (select id::text from stock_units where code = 'kg'), false);   -- superuser reads org A's unit id
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');          -- U_XORG cannot see it, only name it
select throws_ok($$ insert into stock_items (code, name, unit_id) values ('Y','Y', current_setting('stk.unit')::uuid) $$, 'P0001', null,
  'AC-STK-019 an item cannot point at another org''s unit (the parent is invisible to the caller, so it fails closed)');
reset role;
-- 13: org_id is never client-writable
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_units (org_id, code, name) values ('15120000-0000-0000-0000-000000000002','Z','Z') $$, '42501', null,
  'FR-STK-065 org_id in a payload is refused');
-- 14: master changes are audited (FR-STK-066)
reset role;
select ok(exists (select 1 from audit_events where action = 'stock.unit.create'), 'FR-STK-066 master-data creation writes an audit event');
select * from finish();
rollback;
```
Run (expect FAIL: relation `stock_units` does not exist):
`scripts/with-db-lock.sh supabase test db supabase/tests/stock_master_data.test.sql`

### Task S1.3 - migration 0411 (the whole slice schema, one file)
Create `supabase/migrations/0411_stock_master_data.sql`:
```sql
-- 0411_stock_master_data.sql - #1512 S1: units, items, warehouses, keepers (FR-STK-001..008, 060, 066).
-- Spec docs/specs/inventory-project-consumption.spec.md · plan docs/plans/2026-10-31-inventory-project-consumption.md.
-- Reversal: supabase/migrations/rollback/0411_stock_master_data_down.sql (pre-production: supabase db reset).
-- ⚑ Master data is written through RLS + COLUMN grants (the 0250 boq_items pattern). Keepers are written ONLY by
--   set_stock_warehouse_keeper. org_id is never in an INSERT grant: the stamp trigger fills it (FR-STK-065).
-- ⚑ Predicates use role RANK (ADR-0070), never a role list: master data = rank >= 20 (PM, Finance, Executive, Admin);
--   Admin-only = rank >= 50. Hosted grants lesson (0185/0210): every function revokes what it must not expose.

-- §1 helpers ----------------------------------------------------------------------------------------------
create or replace function public.stock_can_see_cost() returns boolean
  language sql stable set search_path = public as $$
  select coalesce(public.role_rank(public.auth_role()) >= 20, false)
$$;
create or replace function public.stock_master_writer() returns boolean
  language sql stable set search_path = public as $$
  select public.is_active_member() and coalesce(public.role_rank(public.auth_role()) >= 20, false)
$$;
create or replace function public.stock_admin() returns boolean
  language sql stable set search_path = public as $$
  select public.is_active_member() and coalesce(public.role_rank(public.auth_role()) >= 50, false)
$$;
revoke all on function public.stock_can_see_cost(), public.stock_master_writer(), public.stock_admin() from public, anon;
grant execute on function public.stock_can_see_cost(), public.stock_master_writer(), public.stock_admin() to authenticated;

-- §2 tables -----------------------------------------------------------------------------------------------
create table public.stock_units (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  code        text not null check (length(btrim(code)) between 1 and 20),
  name        text not null check (length(btrim(name)) between 1 and 80),
  whole_only  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index stock_units_org_code_uniq on public.stock_units (org_id, lower(code));

create table public.stock_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  code           text not null check (length(btrim(code)) between 1 and 40),
  name           text not null check (length(btrim(name)) between 1 and 200),
  description    text check (description is null or length(description) <= 1000),
  unit_id        uuid not null references public.stock_units(id),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index stock_items_org_code_uniq on public.stock_items (org_id, lower(code));
create index stock_items_unit_idx on public.stock_items (unit_id);

create table public.stock_warehouses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  code        text not null check (length(btrim(code)) between 1 and 40),
  name        text not null check (length(btrim(name)) between 1 and 200),
  kind        text not null check (kind in ('central','site')),
  project_id  uuid references public.projects(id),   -- informational default for issues; NOT a restriction
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index stock_warehouses_org_code_uniq on public.stock_warehouses (org_id, lower(code));
create index stock_warehouses_project_idx on public.stock_warehouses (project_id);

create table public.stock_warehouse_keepers (
  org_id       uuid not null references public.organizations(id),
  warehouse_id uuid not null references public.stock_warehouses(id),
  user_id      uuid not null references public.profiles(id),
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  primary key (warehouse_id, user_id)
);
create index stock_warehouse_keepers_user_idx on public.stock_warehouse_keepers (user_id);

-- §3 org stamp + parent-org guards (invoker: the parent is read under the caller's RLS, so another org's row
-- is invisible and fails closed - the 0250 check_boq_item_work_order_same_project precedent).
create trigger stock_units_stamp_org_id      before insert on public.stock_units      for each row execute function public.stamp_org_id();
create trigger stock_items_stamp_org_id      before insert on public.stock_items      for each row execute function public.stamp_org_id();
create trigger stock_warehouses_stamp_org_id before insert on public.stock_warehouses for each row execute function public.stamp_org_id();

create or replace function public.check_stock_item_parent() returns trigger
  language plpgsql set search_path = public as $$
begin
  if (select u.org_id from public.stock_units u where u.id = new.unit_id) is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the unit is not in your organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function public.check_stock_warehouse_parent() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.project_id is not null
     and (select p.org_id from public.projects p where p.id = new.project_id) is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_stock_item_parent(), public.check_stock_warehouse_parent() from public, anon, authenticated;
create trigger stock_items_zz_check_parent      before insert or update on public.stock_items      for each row execute function public.check_stock_item_parent();
create trigger stock_warehouses_zz_check_parent before insert or update on public.stock_warehouses for each row execute function public.check_stock_warehouse_parent();

-- §4 RLS + grants -------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stock_units','stock_items','stock_warehouses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %1$s_select on public.%1$I for select using (org_id = public.auth_org_id() and public.is_active_member())$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert with check (org_id = public.auth_org_id() and public.stock_master_writer())$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update using (org_id = public.auth_org_id() and public.stock_master_writer())
                      with check (org_id = public.auth_org_id() and public.stock_master_writer())$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete using (org_id = public.auth_org_id() and public.stock_admin())$p$, t);
    execute format('revoke all on public.%I from authenticated, anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant delete on public.%I to authenticated', t);   -- Admin only by policy; FK 23503 blocks a referenced row
  end loop;
end $$;
grant insert (id, code, name, whole_only)                                  on public.stock_units      to authenticated;
grant update (code, name, whole_only, archived_at)                         on public.stock_units      to authenticated;
grant insert (id, code, name, description, unit_id, lead_time_days)        on public.stock_items      to authenticated;
grant update (code, name, description, unit_id, lead_time_days, archived_at) on public.stock_items    to authenticated;
grant insert (id, code, name, kind, project_id)                            on public.stock_warehouses to authenticated;
grant update (code, name, kind, project_id, archived_at)                   on public.stock_warehouses to authenticated;

alter table public.stock_warehouse_keepers enable row level security;
alter table public.stock_warehouse_keepers force row level security;
create policy stock_warehouse_keepers_select on public.stock_warehouse_keepers for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.stock_warehouse_keepers from authenticated, anon;
grant select on public.stock_warehouse_keepers to authenticated;      -- NO write grant: set_stock_warehouse_keeper only

-- §5 audit (FR-STK-066). One definer trigger function; log_audit is not client-executable (0076).
create or replace function public.audit_stock_master() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_row record; v_action text;
begin
  if tg_op = 'DELETE' then v_row := old; v_action := 'delete';
  elsif tg_op = 'INSERT' then v_row := new; v_action := 'create';
  else
    v_row := new;
    v_action := case when old.archived_at is null and new.archived_at is not null then 'archive'
                     when old.archived_at is not null and new.archived_at is null then 'restore'
                     else 'update' end;
  end if;
  perform public.log_audit('stock.' || tg_argv[0] || '.' || v_action, v_row.org_id, auth.uid(), v_row.id,
    jsonb_build_object('code', v_row.code, 'name', v_row.name));
  return null;
end $$;
revoke all on function public.audit_stock_master() from public, anon, authenticated;
create trigger stock_units_audit      after insert or update or delete on public.stock_units      for each row execute function public.audit_stock_master('unit');
create trigger stock_items_audit      after insert or update or delete on public.stock_items      for each row execute function public.audit_stock_master('item');
create trigger stock_warehouses_audit after insert or update or delete on public.stock_warehouses for each row execute function public.audit_stock_master('warehouse');

-- §6 keeper assignment (FR-STK-004, FR-STK-007: Admin only). Definer: the table has no client write grant.
create or replace function public.set_stock_warehouse_keeper(p_warehouse_id uuid, p_user_id uuid, p_assigned boolean)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_admin boolean; v_n integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);   -- mut:admin_only
  if not v_admin then
    raise exception 'only an Admin assigns warehouse keepers' using errcode = '42501';
  end if;
  if p_warehouse_id is null or p_user_id is null or p_assigned is null then
    raise exception 'STK_INVALID: warehouse, user and assigned are required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0001';
  end if;
  if p_assigned then
    if exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.archived_at is not null) then
      raise exception 'STK_ARCHIVED: the warehouse is archived' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = p_user_id and pr.org_id = v_org and pr.status = 'active') then
      raise exception 'STK_NOT_FOUND: the user is not an active member of your organisation' using errcode = 'P0001';
    end if;
    insert into public.stock_warehouse_keepers (org_id, warehouse_id, user_id, created_by)
      values (v_org, p_warehouse_id, p_user_id, auth.uid()) on conflict do nothing;
  else
    delete from public.stock_warehouse_keepers where warehouse_id = p_warehouse_id and user_id = p_user_id and org_id = v_org;
  end if;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.log_audit(case when p_assigned then 'stock.keeper.assign' else 'stock.keeper.remove' end,
      v_org, auth.uid(), p_warehouse_id, jsonb_build_object('user_id', p_user_id));
  end if;
end $$;
revoke all on function public.set_stock_warehouse_keeper(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_stock_warehouse_keeper(uuid, uuid, boolean) to authenticated;
```
Run (expect PASS, 14/14): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_master_data.test.sql'`
If assertion 12 fails with a different code, the `zz` trigger name is not sorting after the stamp trigger: rename so it does (`stock_items_stamp_org_id` < `stock_items_zz_check_parent`).

### Task S1.4 - rollback file (2 min)
`supabase/migrations/rollback/0411_stock_master_data_down.sql`:
```sql
drop function if exists public.set_stock_warehouse_keeper(uuid, uuid, boolean);
drop table if exists public.stock_warehouse_keepers;
drop table if exists public.stock_warehouses;
drop table if exists public.stock_items;
drop table if exists public.stock_units;
drop function if exists public.audit_stock_master();
drop function if exists public.check_stock_warehouse_parent();
drop function if exists public.check_stock_item_parent();
drop function if exists public.stock_admin();
drop function if exists public.stock_master_writer();
drop function if exists public.stock_can_see_cost();
```
Verify it parses: `scripts/with-db-lock.sh bash -c 'supabase db reset && psql "$(supabase status -o env | sed -n "s/^DB_URL=//p" | tr -d "\"")" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0411_stock_master_data_down.sql && supabase db reset'` (second reset restores the stack).

### Task S1.5 - ACL allow-list and isolation test (AC-STK-019, its tables)
1. In `supabase/tests/0178_anon_executable_definers.test.sql` add `('set_stock_warehouse_keeper')` to the `client_callable_rpc_names` VALUES list, add a `⚑ AMENDED BY 0411 (#1512)` note to the header, and re-derive the hard-coded retained-count assertion by hand (`grep -n "retained\|count" supabase/tests/0178_anon_executable_definers.test.sql`).
2. Create `supabase/tests/stock_tenant_isolation.test.sql` (prelude F1, with the F1 stock inserts). S1's assertions (later slices append; keep a `-- S2a:` / `-- S2b:` marker comment where each slice's block goes and bump `plan()`):
```sql
select plan(6);   -- 6 assertions: the four `is` counts, the foreign-warehouse refusal, the unchanged-row proof
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');   -- U_XORG sees none of org A
select is((select count(*)::int from stock_units),      0, 'AC-STK-019 stock_units: org B reads none of org A');
select is((select count(*)::int from stock_items),      0, 'AC-STK-019 stock_items: org B reads none of org A');
select is((select count(*)::int from stock_warehouses), 1, 'AC-STK-019 stock_warehouses: org B reads only its own');
select is((select count(*)::int from stock_warehouse_keepers), 0, 'AC-STK-019 stock_warehouse_keepers: org B reads none of org A');
select throws_ok($$ select set_stock_warehouse_keeper('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000b1', true) $$,
  'P0001', null, 'AC-STK-019 set_stock_warehouse_keeper refuses a foreign warehouse id');
update stock_items set name = 'hijack' where id = '15120000-0000-0000-0000-000000001001';      -- RLS hides the row: a silent no-op
reset role;
select is((select name from stock_items where id = '15120000-0000-0000-0000-000000001001'), 'Cement 50kg',
  'AC-STK-019 org B cannot update org A''s item (the row is unchanged)');
select * from finish();
rollback;
```
Run: `scripts/with-db-lock.sh supabase test db supabase/tests/stock_tenant_isolation.test.sql supabase/tests/0178_anon_executable_definers.test.sql` -> PASS.

### Task S1.6 - mutation check (keeper assignment is Admin-only)
Created in S2a.12 as `scripts/stock-mutation-proof.mjs` (harness). S1 contributes its case now so it is not forgotten: add to the S2a case table `{ id: 'admin_only', fn: 'set_stock_warehouse_keeper(uuid,uuid,boolean)', from: /(v_admin := )[^;]+(;\s*-- mut:admin_only)/, to: '$1true$2', test: 'stock_master_data' }`. Expected: assertion 8 (Finance cannot assign) goes red. S1 itself records, in the PR body, a manual run: edit the line to `v_admin := true;`, `supabase db reset`, run the test, see 8 fail, `git checkout` the file.

### Task S1.7 - regenerate types, add DAL (TDD)
1. Types (see Conventions). `npm run typecheck` -> 0 errors.
2. Test first `pmo-portal/src/lib/db/stockMaster.test.ts` (mock `@/src/lib/supabase/client` like `companies.test.ts`):
```ts
vi.mock('@/src/lib/supabase/client', () => ({ supabase: h }));
it('FR-STK-006 archiving sets archived_at and verifies the write landed', async () => {
  h.result = { data: [], error: null };                       // RLS-hidden: zero rows touched
  await expect(archiveStockItem('i1')).rejects.toMatchObject({ code: '42501' });
});
it('FR-STK-004 assigning a keeper calls the RPC and never writes the table', async () => {
  h.rpcResult = { error: null };
  await setWarehouseKeeper({ warehouseId: 'w1', userId: 'u1', assigned: true });
  expect(h.rpc).toHaveBeenCalledWith('set_stock_warehouse_keeper', { p_warehouse_id: 'w1', p_user_id: 'u1', p_assigned: true });
  expect(h.from).not.toHaveBeenCalledWith('stock_warehouse_keepers');
});
it('lists page past the 1000-row cap', async () => { /* 1,203 rows over two .range() pages: all returned once */ });
```
3. Implement `pmo-portal/src/lib/db/stockMaster.ts` **(new)**:
```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type StockUnitRow = Tables<'stock_units'>;
export type StockItemRow = Tables<'stock_items'>;
export type StockWarehouseRow = Tables<'stock_warehouses'>;
export type StockKeeperRow = Tables<'stock_warehouse_keepers'>;
export interface StockUnitInput { code: string; name: string; wholeOnly: boolean }
export interface StockItemInput { code: string; name: string; description: string | null; unitId: string; leadTimeDays: number | null }
export interface StockWarehouseInput { code: string; name: string; kind: 'central' | 'site'; projectId: string | null }

const PAGE = 500;                 // below PostgREST max_rows (1000); a 1,203-row list is three pages, never truncated
const MAX_PAGES = 40;             // 20,000 rows; beyond that the call throws instead of silently truncating
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw toAppError(error);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
  throw new AppError('Too many rows to list; narrow the filter.', 'STK_TOO_MANY');
}

export const listStockUnits = (includeArchived = false) =>
  readAll<StockUnitRow>((a, b) => {
    let q = supabase.from('stock_units').select('*').order('code').order('id').range(a, b);
    if (!includeArchived) q = q.is('archived_at', null);
    return q;
  });
export const listStockItems = (includeArchived = false) =>
  readAll<StockItemRow>((a, b) => {
    let q = supabase.from('stock_items').select('*').order('code').order('id').range(a, b);
    if (!includeArchived) q = q.is('archived_at', null);
    return q;
  });
export const listStockWarehouses = (includeArchived = false) =>
  readAll<StockWarehouseRow>((a, b) => {
    let q = supabase.from('stock_warehouses').select('*').order('code').order('id').range(a, b);
    if (!includeArchived) q = q.is('archived_at', null);
    return q;
  });
export const listWarehouseKeepers = () =>
  readAll<StockKeeperRow>((a, b) => supabase.from('stock_warehouse_keepers').select('*').order('warehouse_id').order('user_id').range(a, b));

export async function createStockUnit(i: StockUnitInput): Promise<StockUnitRow> {
  const { data, error } = await supabase.from('stock_units').insert({ code: i.code.trim(), name: i.name.trim(), whole_only: i.wholeOnly }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockUnit(id: string, i: StockUnitInput): Promise<void> {
  const { data, error } = await supabase.from('stock_units').update({ code: i.code.trim(), name: i.name.trim(), whole_only: i.wholeOnly }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this unit.');
}
export async function createStockItem(i: StockItemInput): Promise<StockItemRow> {
  const { data, error } = await supabase.from('stock_items').insert({
    code: i.code.trim(), name: i.name.trim(), description: i.description?.trim() || null, unit_id: i.unitId, lead_time_days: i.leadTimeDays,
  }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockItem(id: string, i: StockItemInput): Promise<void> {
  const { data, error } = await supabase.from('stock_items').update({
    code: i.code.trim(), name: i.name.trim(), description: i.description?.trim() || null, unit_id: i.unitId, lead_time_days: i.leadTimeDays,
  }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this item.');
}
export async function createStockWarehouse(i: StockWarehouseInput): Promise<StockWarehouseRow> {
  const { data, error } = await supabase.from('stock_warehouses').insert({ code: i.code.trim(), name: i.name.trim(), kind: i.kind, project_id: i.projectId }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockWarehouse(id: string, i: StockWarehouseInput): Promise<void> {
  const { data, error } = await supabase.from('stock_warehouses').update({ code: i.code.trim(), name: i.name.trim(), kind: i.kind, project_id: i.projectId }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this warehouse.');
}
export async function setArchived(table: 'stock_units' | 'stock_items' | 'stock_warehouses', id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from(table).update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot archive this record.');
}
export const archiveStockItem = (id: string) => setArchived('stock_items', id, true);
export async function setWarehouseKeeper(a: { warehouseId: string; userId: string; assigned: boolean }): Promise<void> {
  const { error } = await supabase.rpc('set_stock_warehouse_keeper', { p_warehouse_id: a.warehouseId, p_user_id: a.userId, p_assigned: a.assigned });
  if (error) throw toAppError(error);
}
```
Run: `cd pmo-portal && npx vitest run src/lib/db/stockMaster.test.ts` -> PASS.

### Task S1.8 - error helper (shared by every later slice)
Test first `pmo-portal/src/lib/stockErrors.test.ts`:
```ts
it('FR-STK-080 parses the stable code and the numbers from a P0001 message', () => {
  const e = { code: 'P0001', message: 'STK_INSUFFICIENT: item CEM at SITE-A: available 5, requested 6', details: '{"available":"5","requested":"6"}' };
  expect(parseStockError(e)).toEqual({ code: 'STK_INSUFFICIENT', message: 'item CEM at SITE-A: available 5, requested 6', numbers: { available: '5', requested: '6' } });
});
it('returns null for a non-stock error so classifyMutationError handles it', () => { expect(parseStockError({ code: '42501', message: 'x' })).toBeNull(); });
it('every code in STOCK_ERROR_CODES has en and id copy', () => { /* iterate the catalogue; both locales non-empty */ });
```
Implement `pmo-portal/src/lib/stockErrors.ts` **(new)**: `STOCK_ERROR_CODES` tuple (the 11 spec codes + `STK_HAS_STOCK`, `STK_UNIT_LOCKED`, `STK_INVALID`, `STK_NOT_FOUND`, `STK_TOO_MANY`, `STK_KIND_UNAVAILABLE`), `parseStockError(err: unknown): { code: StockErrorCode; message: string; numbers: Record<string,string> } | null` (regex `^(STK_[A-Z_]+):\s*(.*)$` on `message`; `numbers` = `JSON.parse(details)` when it parses to a flat string map, else `{}`). Run the test -> PASS. (`classifyMutationError` is **not** edited: a P0001 passes its human text through; the Stock screens call `parseStockError` first and fall back to it.)

### Task S1.9 - repository + hook
Test first (add to a new `pmo-portal/src/lib/repositories/stock.test.ts`): `repositories.stock.master.listItems` delegates to the DAL; `setKeeper` delegates; every method is wrapped by `wrap` (a thrown `Error` surfaces as `AppError`). Implement:
- `pmo-portal/src/lib/repositories/types.ts`: add `export interface StockRepository { master: StockMasterRepository }` with `listUnits/listItems/listWarehouses/listKeepers/createUnit/updateUnit/createItem/updateItem/createWarehouse/updateWarehouse/archive(table,id,archived)/setKeeper` (later slices add `documents` and `reports` members).
- `pmo-portal/src/lib/repositories/index.ts`: `const stock: StockRepository = { master: { listUnits: (i) => wrap(() => listStockUnits(i)), ... } }`, add `stock` to the `repositories` object (line ~1335) and to `Repositories` in `types.ts` (line ~906).
- `pmo-portal/src/hooks/useStock.ts` **(new)**: `useStockUnits/Items/Warehouses/Keepers` (`queryKey: ['stock-units', orgId, includeArchived]` etc., `enabled: Boolean(orgId)`) and `useStockMasterMutations()` invalidating the matching key (pattern: `src/hooks/useProgressBilling.ts`).
Run: `npx vitest run src/lib/repositories/stock.test.ts src/lib/db/stockMaster.test.ts` -> PASS.

### Task S1.10 - policy entities (AC-STK-033, master-data rows)
Test first `pmo-portal/src/auth/policy.stock.test.ts` **(new)** (later slices append their rows to this file; it is AC-STK-033's single owner):
```ts
const roles = ['Admin','Executive','Finance','Project Manager','Engineer'] as const;
it.each(roles)('AC-STK-033 %s: stock master data matrix', (role) => {
  const ctx = { realRole: role };
  const writer = ['Admin','Executive','Finance','Project Manager'].includes(role);
  for (const e of ['stockItem','stockUnit','warehouse'] as const) {
    expect(can('view', e, ctx)).toBe(true);
    expect(can('create', e, ctx)).toBe(writer);
    expect(can('edit', e, ctx)).toBe(writer);
    expect(can('archive', e, ctx)).toBe(writer);
    expect(can('delete', e, ctx)).toBe(role === 'Admin');
  }
  expect(can('manage', 'warehouse', ctx)).toBe(role === 'Admin');      // keepers
});
it('AC-STK-033 deny by default and view-as is view-only', () => {
  expect(can('create', 'stockItem', { realRole: null })).toBe(false);
  expect(can('create', 'stockItem', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
});
```
Implement in `pmo-portal/src/auth/policy.ts`: add `'stockItem' | 'stockUnit' | 'warehouse'` to `Entity` (after `'finance'`), and to the matrix next to `boqItem` (~line 234):
```ts
  /** Stock master data (#1512, 0411): mirrors the RLS - rank >= 20 writes, Admin deletes and assigns keepers. UX only. */
  stockItem: stockMaster(),
  stockUnit: stockMaster(),
  warehouse: { ...stockMaster(), manage: (role, ctx) => role === 'Admin' && ctx.record?.viewOnly !== true },
```
with a local `const stockMaster = () => ({ view: allow(ALL), create: viewOk(MASTER_DATA), edit: viewOk(MASTER_DATA), archive: viewOk(MASTER_DATA), delete: viewOk(ADMIN) })` where `viewOk = (roles) => (role, ctx) => has(roles, role) && ctx.record?.viewOnly !== true` (use the file's existing `has`/`allow` helpers; read the file's helper names before writing). Run `npx vitest run src/auth/policy.stock.test.ts src/auth` -> PASS (the existing policy tests must stay green).

### Task S1.11 - i18n namespace
- Add `'stock'` to `NAMESPACES` in `pmo-portal/src/lib/i18n/index.ts` (line 15).
- Create `pmo-portal/public/locales/en/stock.json` and `pmo-portal/public/locales/id/stock.json` **(new)** with the S1 keys (`stock.nav`, `stock.setup.*`, `stock.errors.<STK_CODE>` for all 17 codes, `stock.kinds.*`, `stock.empty.*`); the Indonesian file carries real translations, not copies (`npm run check:i18n` enforces key parity). Later slices append keys to both files in their own commits.
Run: `cd pmo-portal && npm run check:i18n` -> PASS.

### Task S1.12 - Setup screen (units, items, warehouses, keepers)
Test first `pmo-portal/pages/stock/StockSetup.test.tsx` **(new)** (RTL; mock `@/src/lib/repositories`): (a) loading skeleton then rows (AC-STK-032 states: loading, empty with an "Add the first item" action, error with retry and no zero, populated, archived row dimmed with "Restore"); (b) for an Engineer the "Add item" button is absent (`can('create','stockItem')`); (c) the keepers panel renders for Admin only and calls `setKeeper` on toggle; (d) a rejected create shows `parseStockError` copy, else `classifyMutationError`. Implement `pmo-portal/pages/stock/StockSetup.tsx` **(new)** with tabs Units / Items / Warehouses (shared `Tabs`), forms via `EntityFormModal`/`useEntityForm` + `TextField`/`SelectField`/`FormGrid` (reference slice `pages/Companies.tsx`), archive via `ConfirmDialog`. A fractional-vs-whole switch is a labelled checkbox. Strings from the `stock` namespace via `useTranslation('stock')`.
Run `npx vitest run pages/stock/StockSetup.test.tsx` -> PASS.

### Task S1.13 - route, nav, breadcrumb
- `pmo-portal/App.tsx`: `const StockSetupPage = React.lazy(() => import('./pages/stock/StockSetup'));` and `{ path: '/stock/setup', element: <StockSetupPage /> }` in `appRouteConfig` before the `*` route. (S3 adds the other `/stock/...` routes; keep `/stock/setup` a static segment so it outranks `:documentId`.)
- No Rail or `routeMatch.ts` entry in S1: a nav item to a page that does not exist yet would be a dead link. **S3 adds the `Stock` Rail item and the `routeMatch.ts` entry.** `/stock/setup` is reachable by URL and from S3's Stock page for master-data roles.
Test: add `/stock/setup` to the route-table test that asserts every redirect target resolves (grep `appRouteConfig` in `*.test.tsx`; extend the existing list). Run it.

### Task S1.14 - glossary, seed, gate
- `docs/glossary.md`: add **Stock item, Unit, Warehouse, Keeper, Stock document, Stock ledger entry, On hand, Moving-average cost, Work item, Material allowance, Consumption, Reorder level / suggestion** using the spec §3 wording verbatim.
- `supabase/seed.sql` (append a `-- #1512 stock master data` block): 5 units (bag whole, m, kg, pcs whole, L), 12 items across them (codes `CEM-50`, `REBAR-12`, `CABLE-4`, ...), warehouses `CENTRAL` + `SITE-A`/`SITE-B`/`SITE-C` (sites linked to existing seeded Ongoing projects), keepers: ``engineer@acme.test` (id `00000000-0000-0000-0000-0000000000a4`) keeps SITE-A, `pm@acme.test` (`...0a2`) keeps SITE-B; Admin is `admin@acme.test` (`...0a5`). Insert as the superuser with fixed `1512....` UUIDs and `org_id = '00000000-0000-0000-0000-000000000001'`; no ledger rows here (S2a seeds opening stock through the RPC).
- Gate (from `pmo-portal/`): `npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 pages/stock src/lib/db/stockMaster.ts src/lib/stockErrors.ts src/lib/repositories src/hooks/useStock.ts src/auth/policy.ts && npx vitest run pages/stock/StockSetup.test.tsx src/lib/db/stockMaster.test.ts src/lib/stockErrors.test.ts src/lib/repositories/stock.test.ts src/auth/policy.stock.test.ts`; DB: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_master_data.test.sql supabase/tests/stock_tenant_isolation.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`; UI: `scripts/ux-proof.sh /stock/setup`. Then the three reviewers (spec, quality, security) and one design Discover pass on rich seed; every finding graduates (ADR-0030). Commit per task; push the branch; report to the Director.

---

# Slice S2a - Posting engine, in-flows (`0412_stock_posting_engine.sql`)

Builds: `stock_documents`, `stock_document_lines`, `stock_ledger`, `stock_balances`; numbering; `create_stock_document`, `save_stock_draft`, `post_stock_document`, `cancel_stock_document`; **Receive** and **Transfer**; moving-average valuation; negative-stock guard; archive-with-stock, fraction, unit-lock, idempotency, ownership, keeper and backdate rules; ADR-0097; the single-writer guard and the mutation harness. **Money tier: Terra or Sol builds it; ships alone.** Owns: AC-STK-002, 003, 005, 006 (via Transfer; S2b appends the Issue variants to the same files), 010 (Receive, Transfer; S2b appends Issue, Return), 011, 012, 013, 016, 017, 018, 019 (its tables), 021 (ledger part; S5 appends the report part), 029. FRs: 005, 006, 008, 010-017, 020, 021, 030-033, 060, 061, 065, 070-074.

Two-line reading guide for the SQL below: `-- mut:<id>` marks the single line the mutation harness (S2a.12) breaks; keep each guarded decision on **one** line assigned to a `v_..` variable so the mutation is one regex.

### Task S2a.0 - ADR-0097 (architectural; write first, 10 min)
`docs/adr/0097-stock-ledger-and-ownership-split.md` (status Proposed, same date; `npm run check:adrs`). Outline the builder fills in prose (no more than one page): **Context** - ADR-0094 makes quantity and valuation ERP-owned when connected, PMO-owned standalone; stock is money. **Decision** - (1) an append-only `stock_ledger` plus a derived `stock_balances` row per item and warehouse, written by one function; (2) moving-average valuation per item per warehouse, computed in posting order, exact to 2 dp with no residue; (3) the standalone / connected column split of spec section 6 (PMO owns document header, project, work item, actor, time, reason, `client_request_id`, allowance and reorder level; the connected ERP will own quantity, valuation, unit cost and ledger value, with PMO's copy machine-written and shown with freshness); (4) the posting RPC is the one place #1508 swaps the valuation source; an ERP posting status lives in a side-mirror table, never on `stock_documents`; (5) `domain_externally_owned(org, 'inventory')` fails the standalone writer closed. **Consequences** - no FIFO / lot trace, no negative stock, corrections are new documents, history stays readable when an ERP is employed (epoch rule), #1508 must refuse employing while a Draft exists. **Alternatives rejected** - FIFO layers (no lot trace need; ERP reconciliation is like-for-like with moving average), derived-only balances (no cheap row lock, slow reads), mutable documents (breaks the stable push key). Commit alone: `docs(adr): ADR-0097 stock ledger and ownership split (#1512)`.

### Task S2a.1 - failing pgTAP: valuation and negative guard (AC-STK-002, 003, 005, 006)
Create `supabase/tests/stock_valuation.test.sql` = prelude F1 + two helpers + body. S2a proves the arithmetic through **Transfer** (its only out-flow); S2b appends the Issue variants (same assertions, kind `issue`) to this file.
```sql
select plan(12);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;
-- security definer: the ledger and balances have no client SELECT, and these helpers are called while the role is `authenticated`
create function public.stk_t_bal(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = p_wh and item_id = p_item $$;
create function public.stk_t_out(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select coalesce(sum(value_delta), 0)::text from public.stock_ledger where warehouse_id = p_wh and item_id = p_item and kind = 'transfer' and qty_delta < 0 $$;
create function public.stk_t_rows(p_where text) returns integer language plpgsql security definer as $$
declare n integer; begin execute 'select count(*) from public.stock_ledger where ' || p_where into n; return n; end $$;

select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                                                                     -- Admin posts anywhere
-- AC-STK-002: 100 @ 50 then 100 @ 70 -> average 60; moving 50 out takes 3,000
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 100, 50);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 100, 70);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 50);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002'), '150.000/9000.00', 'AC-STK-002 moving average: 50 out of 200 @ avg 60 leaves 150 worth 9,000');
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002'), '50.000/3000.00', 'AC-STK-002 the destination receives the same 3,000');
-- AC-STK-003: 3 bags worth 100.01 -> moving all 3 takes all 100.01, no residue
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 3, 33.3367);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '3.000/100.01', 'AC-STK-003 setup: 3 bags worth 100.01');
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 3);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-STK-003 moving every bag leaves no value residue');
select is(public.stk_t_out('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '-100.01', 'AC-STK-003 the out entry took the whole 100.01');
-- AC-STK-005: 5 on hand, 6 requested -> refused, nothing written
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 2, 10);                                                          -- SITE-A now holds 5 bags (3 moved in + 2)
select throws_like($$ select public.stk_t_xfer('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 6) $$, 'STK_INSUFFICIENT: %available 5%requested 6%', 'AC-STK-005 an over-draw is refused with available 5 / requested 6');
select is(public.stk_t_rows('kind = ''transfer'' and qty_delta = -6'), 0, 'AC-STK-005 no ledger entry exists for the refused transfer');
-- AC-STK-006: 40 central -> site B is atomic; a forced failure on the second leg leaves neither leg
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 40);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') || ' ' || public.stk_t_bal('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002'), '110.000/6600.00 40.000/2400.00',
  'AC-STK-006 central fell by 40 and the site rose by 40 at equal value (60 each)');
-- AC-STK-003 (stepwise): three single-bag moves of 3 bags worth 100.01 leave no residue (33.34 + 33.34 + 33.33)
select public.stk_t_rcv('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 3, 33.3367);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1); select public.stk_t_xfer('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1); select public.stk_t_xfer('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-STK-003 three single-bag moves leave the source at exactly zero value');
select is(public.stk_t_out('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001'), '-100.01', 'AC-STK-003 the three out entries add up to exactly the value received');
reset role;
create function public.stk_t_fail_second_leg() returns trigger language plpgsql as $$
begin if new.kind = 'transfer' and new.qty_delta > 0 then raise exception 'forced second-leg failure'; end if; return new; end $$;
create trigger stk_t_fail_second_leg before insert on public.stock_ledger for each row execute function public.stk_t_fail_second_leg();
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 10) $$, '%forced second-leg failure%', 'AC-STK-006 a failure on the second leg aborts the whole post');
reset role;
drop trigger stk_t_fail_second_leg on public.stock_ledger;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') || ' ' || public.stk_t_bal('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002'), '110.000/6600.00 40.000/2400.00', 'AC-STK-006 neither leg was written (balances unchanged)');
reset role;
select * from finish();
rollback;
```
Run (expect FAIL: `create_stock_document` does not exist): `scripts/with-db-lock.sh supabase test db supabase/tests/stock_valuation.test.sql`

### Task S2a.2 - migration 0412 part 1: tables, constraints, RLS, guard triggers
Create `supabase/migrations/0412_stock_posting_engine.sql` (header in the style of 0411: spec and plan links, rollback path, the single-writer and rank-not-list notes). Section 1:
```sql
create table public.stock_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),               -- no default: the RPC states it (0250 progress_claims)
  number           text not null,
  kind             text not null check (kind in ('receive','transfer','issue','return','adjustment','count')),
  status           text not null default 'Draft' check (status in ('Draft','Posted','Cancelled')),
  warehouse_id     uuid not null references public.stock_warehouses(id),
  to_warehouse_id  uuid references public.stock_warehouses(id),
  project_id       uuid references public.projects(id),
  procurement_id   uuid references public.procurements(id),
  reason           text check (reason is null or length(btrim(reason)) between 1 and 500),
  note             text check (note is null or length(note) <= 1000),
  occurred_on      date not null,
  client_request_id uuid,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  posted_by        uuid references public.profiles(id),
  posted_at        timestamptz,
  cancelled_by     uuid references public.profiles(id),
  cancelled_at     timestamptz,
  constraint stock_documents_number_uniq unique (org_id, number),
  constraint stock_documents_shape check (
        ((kind = 'transfer') = (to_warehouse_id is not null))
    and (kind <> 'transfer' or to_warehouse_id <> warehouse_id)
    and (case kind when 'issue'  then project_id is not null
                   when 'return' then (status <> 'Posted' or project_id is not null)
                   else project_id is null end)
    and (procurement_id is null or kind = 'receive')
    and (kind <> 'adjustment' or reason is not null)
    and ((status = 'Posted') = (posted_at is not null and posted_by is not null))
    and ((status = 'Cancelled') = (cancelled_at is not null and cancelled_by is not null)))
);
create unique index stock_documents_idem_uniq on public.stock_documents (org_id, created_by, client_request_id) where client_request_id is not null;
create index stock_documents_org_created_idx on public.stock_documents (org_id, created_at desc, id desc);
create index stock_documents_warehouse_idx on public.stock_documents (warehouse_id);
create index stock_documents_project_idx on public.stock_documents (project_id) where project_id is not null;

create table public.stock_document_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  document_id       uuid not null references public.stock_documents(id),
  line_no           integer not null check (line_no > 0),
  item_id           uuid not null references public.stock_items(id),
  quantity          numeric(14,3) check (quantity is null or (quantity > 0 and quantity < 'Infinity'::numeric)),
  counted_quantity  numeric(14,3) check (counted_quantity is null or (counted_quantity >= 0 and counted_quantity < 'Infinity'::numeric)),
  expected_quantity numeric(14,3),
  direction         text check (direction in ('in','out')),                       -- adjustment lines only
  unit_cost         numeric(14,4) check (unit_cost is null or (unit_cost >= 0 and unit_cost < 'Infinity'::numeric)),
  boq_item_id       uuid references public.boq_items(id),
  source_line_id    uuid references public.stock_document_lines(id),
  constraint stock_document_lines_one_qty check ((quantity is null) <> (counted_quantity is null)),
  unique (document_id, line_no)
);
create index stock_document_lines_item_idx on public.stock_document_lines (item_id);
create index stock_document_lines_source_idx on public.stock_document_lines (source_line_id) where source_line_id is not null;

create table public.stock_ledger (            -- MACHINE-WRITTEN, append-only (FR-STK-072)
  seq            bigint generated always as identity primary key,
  id             uuid not null unique default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  document_id    uuid not null references public.stock_documents(id),
  line_id        uuid not null references public.stock_document_lines(id),
  item_id        uuid not null references public.stock_items(id),
  warehouse_id   uuid not null references public.stock_warehouses(id),
  project_id     uuid references public.projects(id),
  boq_item_id    uuid references public.boq_items(id),
  source_line_id uuid references public.stock_document_lines(id),
  kind           text not null,
  qty_delta      numeric(14,3) not null check (qty_delta <> 0),
  value_delta    numeric(14,2) not null,
  qty_after      numeric(14,3) not null,
  value_after    numeric(14,2) not null,
  occurred_on    date not null,
  posted_at      timestamptz not null default now(),
  posted_by      uuid not null references public.profiles(id),
  check ((qty_delta > 0 and value_delta >= 0) or (qty_delta < 0 and value_delta <= 0))
);
create index stock_ledger_item_wh_idx   on public.stock_ledger (org_id, item_id, warehouse_id, seq);
create index stock_ledger_project_idx   on public.stock_ledger (org_id, project_id, boq_item_id, occurred_on);
create index stock_ledger_document_idx  on public.stock_ledger (document_id);
create index stock_ledger_source_idx    on public.stock_ledger (source_line_id) where source_line_id is not null;

create table public.stock_balances (          -- MACHINE-WRITTEN
  org_id        uuid not null references public.organizations(id),
  item_id       uuid not null references public.stock_items(id),
  warehouse_id  uuid not null references public.stock_warehouses(id),
  qty_on_hand   numeric(14,3) not null default 0,
  value_on_hand numeric(14,2) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (item_id, warehouse_id),
  check (qty_on_hand >= 0 and value_on_hand >= 0 and (qty_on_hand > 0 or value_on_hand = 0))
);
create index stock_balances_warehouse_idx on public.stock_balances (org_id, warehouse_id);

-- RLS + grants: documents and (cost-free columns of) lines are readable by active members; NOTHING is client-writable;
-- ledger and balances are NOT client-readable (cost is read only through the S3 RPCs, D5).
alter table public.stock_documents      enable row level security;  alter table public.stock_documents      force row level security;
alter table public.stock_document_lines enable row level security;  alter table public.stock_document_lines force row level security;
alter table public.stock_ledger         enable row level security;  alter table public.stock_ledger         force row level security;
alter table public.stock_balances       enable row level security;  alter table public.stock_balances       force row level security;
create policy stock_documents_select      on public.stock_documents      for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy stock_document_lines_select on public.stock_document_lines for select using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.stock_documents, public.stock_document_lines, public.stock_ledger, public.stock_balances from authenticated, anon;
grant select on public.stock_documents to authenticated;
grant select (id, org_id, document_id, line_no, item_id, quantity, counted_quantity, expected_quantity, direction, boq_item_id, source_line_id)
  on public.stock_document_lines to authenticated;                 -- unit_cost deliberately absent

-- Immutability (FR-STK-013, AC-STK-011): a Posted or Cancelled document, its lines and every ledger row never change.
create or replace function public.guard_stock_document_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be changed' using errcode = 'P0001'; end if;
  return new;
end $$;
create or replace function public.guard_stock_line_immutable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_status text; v_doc uuid;
begin
  if tg_op = 'DELETE' then v_doc := old.document_id; else v_doc := new.document_id; end if;
  select d.status into v_status from public.stock_documents d where d.id = v_doc;
  if v_status is distinct from 'Draft' then raise exception 'STK_IMMUTABLE: the lines of a posted or cancelled document cannot change' using errcode = 'P0001'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create or replace function public.guard_stock_ledger_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin raise exception 'STK_IMMUTABLE: the stock ledger is append-only' using errcode = 'P0001'; end $$;
create trigger stock_documents_immutable before update or delete on public.stock_documents for each row execute function public.guard_stock_document_immutable();
create trigger stock_document_lines_immutable before insert or update or delete on public.stock_document_lines for each row execute function public.guard_stock_line_immutable();
create trigger stock_ledger_append_only before update or delete on public.stock_ledger for each row execute function public.guard_stock_ledger_append_only();

-- Master-data rules that need the tables above (FR-STK-006, 008; PQ-9). Definer: balances/lines carry no client read.
create or replace function public.guard_stock_archive() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if (tg_table_name = 'stock_items' and exists (select 1 from public.stock_balances b where b.item_id = new.id and b.qty_on_hand > 0))
       or (tg_table_name = 'stock_warehouses' and exists (select 1 from public.stock_balances b where b.warehouse_id = new.id and b.qty_on_hand > 0)) then
      raise exception 'STK_HAS_STOCK: archive refused while stock is on hand' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create or replace function public.guard_stock_item_unit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.unit_id is distinct from old.unit_id and exists (select 1 from public.stock_document_lines l where l.item_id = new.id) then
    raise exception 'STK_UNIT_LOCKED: the unit of an item with movements cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function public.guard_stock_unit_whole() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.whole_only is distinct from old.whole_only and exists (
       select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where i.unit_id = new.id) then
    raise exception 'STK_UNIT_LOCKED: the whole-numbers flag of a unit with movements cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger stock_items_guard_archive      before update of archived_at on public.stock_items      for each row execute function public.guard_stock_archive();
create trigger stock_warehouses_guard_archive before update of archived_at on public.stock_warehouses for each row execute function public.guard_stock_archive();
create trigger stock_items_guard_unit         before update of unit_id     on public.stock_items      for each row execute function public.guard_stock_item_unit();
create trigger stock_units_guard_whole        before update of whole_only  on public.stock_units      for each row execute function public.guard_stock_unit_whole();
revoke all on function public.guard_stock_document_immutable(), public.guard_stock_line_immutable(), public.guard_stock_ledger_append_only(),
  public.guard_stock_archive(), public.guard_stock_item_unit(), public.guard_stock_unit_whole() from public, anon, authenticated;
```

### Task S2a.3 - migration part 2: helpers and the rule functions
Append to `0412_stock_posting_engine.sql`. Every function below ends with `revoke all on function <sig> from public, anon, authenticated;` (internals; the list is in S2a.6).
```sql
create or replace function public.stock_doc_prefix(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'receive' then 'RCV' when 'transfer' then 'TRF' when 'issue' then 'ISS'
                     when 'return' then 'RTN' when 'adjustment' then 'ADJ' when 'count' then 'CNT' end $$;

create or replace function public.stock_org_today(p_org uuid) returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date $$;

-- D6: first and fail closed. A null or an error from the ownership read refuses.
create or replace function public.stock_assert_standalone(p_org uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_owned boolean; v_allowed boolean;
begin
  begin v_owned := public.domain_externally_owned(p_org, 'inventory');
  exception when others then v_owned := null; end;
  v_allowed := not coalesce(v_owned, true);                                         -- mut:owned
  if not v_allowed then
    raise exception 'STK_OWNED_BY_ERP: inventory is run in your connected ERP, so PMO does not post stock' using errcode = 'P0001';
  end if;
end $$;

-- FR-STK-061: keeper of the warehouse, else Admin (returns true when the Admin override was used, so the caller audits it).
create or replace function public.stock_assert_keeper(p_org uuid, p_warehouse uuid, p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_keeper boolean; v_admin boolean;
begin
  v_keeper := exists (select 1 from public.stock_warehouse_keepers k
                       where k.org_id = p_org and k.warehouse_id = p_warehouse and k.user_id = p_uid);   -- mut:keeper
  if v_keeper then return false; end if;
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);                               -- mut:keeper_admin
  if v_admin then return true; end if;
  raise exception 'STK_NOT_KEEPER: you do not keep this warehouse' using errcode = 'P0001';
end $$;

-- FR-STK-016 + PQ-2: never future (Admin included); older than 31 days only for Admin.
create or replace function public.stock_assert_dates(p_org uuid, p_occurred date) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.stock_org_today(p_org); v_future_ok boolean; v_old_ok boolean;
begin
  v_future_ok := p_occurred <= v_today;                                                                  -- mut:future
  if not v_future_ok then raise exception 'STK_BACKDATE: a stock movement cannot be dated in the future' using errcode = 'P0001'; end if;
  v_old_ok := p_occurred >= v_today - 31 or coalesce(public.role_rank(public.auth_role()) >= 50, false); -- mut:backdate
  if not v_old_ok then raise exception 'STK_BACKDATE: only an Admin may date a movement more than 31 days back' using errcode = 'P0001'; end if;
end $$;

-- Fixed lock order (D3): (2) cited issue lines by id, (3) balances by (item, warehouse). The document row is (1), locked by the caller.
create or replace function public.stock_lock_for_document(p_doc public.stock_documents) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  perform 1 from public.stock_document_lines s
   where s.id in (select l.source_line_id from public.stock_document_lines l where l.document_id = p_doc.id and l.source_line_id is not null)
   order by s.id for update;
  for r in select distinct l.item_id, w.wid as warehouse_id
             from public.stock_document_lines l
             cross join lateral (values (p_doc.warehouse_id), (p_doc.to_warehouse_id)) as w(wid)
            where l.document_id = p_doc.id and w.wid is not null
            order by l.item_id, w.wid                                                                   -- mut:lockorder
  loop
    insert into public.stock_balances (org_id, item_id, warehouse_id) values (p_doc.org_id, r.item_id, r.warehouse_id)
      on conflict (item_id, warehouse_id) do nothing;
    perform 1 from public.stock_balances b where b.item_id = r.item_id and b.warehouse_id = r.warehouse_id for update;
  end loop;
end $$;

-- THE ONLY WRITER of stock_ledger and stock_balances (FR-STK-072, D1). A stock-out value is derived here, never passed in.
create or replace function public.stock_write_entry(
  p_doc public.stock_documents, p_line_id uuid, p_item uuid, p_wh uuid, p_qty_delta numeric,
  p_in_value numeric, p_project uuid, p_boq uuid, p_source_line uuid) returns numeric
  language plpgsql volatile security definer set search_path = public as $$
declare b public.stock_balances; v_out numeric; v_val numeric; v_dv numeric; v_item text; v_wh text;
begin
  select * into b from public.stock_balances x where x.item_id = p_item and x.warehouse_id = p_wh for update;
  if not found then raise exception 'STK_INVALID: balance row was not locked before writing' using errcode = 'P0001'; end if;
  if p_qty_delta < 0 then
    v_out := -p_qty_delta;
    if v_out > b.qty_on_hand then
      select i.code into v_item from public.stock_items i where i.id = p_item;
      select w.code into v_wh   from public.stock_warehouses w where w.id = p_wh;
      raise exception 'STK_INSUFFICIENT: item % at %: available %, requested %', v_item, v_wh, trim_scale(b.qty_on_hand)::text, trim_scale(v_out)::text
        using errcode = 'P0001', detail = jsonb_build_object('item', v_item, 'warehouse', v_wh,
          'available', trim_scale(b.qty_on_hand)::text, 'requested', trim_scale(v_out)::text)::text;
    end if;
    -- Multiply first, then divide: exact for q = Q. The explicit whole-remaining branch is belt and braces so FR-STK-030's
    -- "no residue" does not depend on numeric scale rules (it has no separate mutation case: the formula already returns V).
    v_val := case when v_out = b.qty_on_hand then b.value_on_hand
                  else round(v_out * b.value_on_hand / b.qty_on_hand, 2) end;                                  -- mut:avg
    v_dv := -v_val;
  else
    v_dv := p_in_value;
  end if;
  update public.stock_balances set qty_on_hand = b.qty_on_hand + p_qty_delta, value_on_hand = b.value_on_hand + v_dv, updated_at = now()
   where item_id = p_item and warehouse_id = p_wh;
  insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, boq_item_id, source_line_id, kind,
                                   qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
  values (p_doc.org_id, p_doc.id, p_line_id, p_item, p_wh, p_project, p_boq, p_source_line, p_doc.kind,
          p_qty_delta, v_dv, b.qty_on_hand + p_qty_delta, b.value_on_hand + v_dv, p_doc.occurred_on, auth.uid());
  return v_dv;
end $$;
```
(`trim_scale` needs Postgres 13+; the local stack is newer. `numeric(14,2)` rounding of `v_dv` for stock-in is exact because the caller passes `round(q * cost, 2)`.)

### Task S2a.4 - migration part 3: payload validation and line insert
```sql
-- Static shape + parent-org checks shared by create and save. Raises the stable codes; touches nothing.
create or replace function public.stock_validate_payload(p_org uuid, p_kind text, p_header jsonb, p_lines jsonb) returns void
  language plpgsql stable security definer set search_path = public as $$
declare
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_to uuid := nullif(p_header->>'to_warehouse_id', '')::uuid;
  e jsonb; v_item record; v_q numeric; v_c numeric; v_cost numeric; v_dir text;
begin
  if p_kind is null or p_kind not in ('receive','transfer','issue','return','adjustment','count') then
    raise exception 'STK_INVALID: unknown document kind' using errcode = 'P0001'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'STK_INVALID: a document needs 1 to 200 lines' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.stock_warehouses w where w.id = v_wh and w.org_id = p_org) then
    raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0001'; end if;
  if p_kind = 'transfer' then
    if v_to is null or v_to = v_wh then raise exception 'STK_INVALID: a transfer needs a different destination warehouse' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.stock_warehouses w where w.id = v_to and w.org_id = p_org) then
      raise exception 'STK_NOT_FOUND: the destination warehouse is not in your organisation' using errcode = 'P0001'; end if;
  elsif v_to is not null then
    raise exception 'STK_INVALID: only a transfer has a destination warehouse' using errcode = 'P0001'; end if;
  if exists (select 1 from public.stock_warehouses w where w.id in (v_wh, coalesce(v_to, v_wh)) and w.archived_at is not null) then
    raise exception 'STK_ARCHIVED: the warehouse is archived' using errcode = 'P0001'; end if;
  if nullif(p_header->>'procurement_id', '') is not null and p_kind <> 'receive' then
    raise exception 'STK_INVALID: only a receipt may cite a procurement case' using errcode = 'P0001'; end if;
  if p_kind not in ('issue','return') and nullif(p_header->>'project_id', '') is not null then
    raise exception 'STK_INVALID: only an issue or return names a project' using errcode = 'P0001'; end if;
  if p_kind = 'issue' and nullif(p_header->>'project_id', '') is null then
    raise exception 'STK_INVALID: an issue names a project' using errcode = 'P0001'; end if;
  if p_kind = 'adjustment' and nullif(btrim(p_header->>'reason'), '') is null then
    raise exception 'STK_INVALID: an adjustment needs a reason' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    select i.id, i.archived_at, u.whole_only into v_item
      from public.stock_items i join public.stock_units u on u.id = i.unit_id
     where i.id = (e->>'item_id')::uuid and i.org_id = p_org;
    if v_item.id is null then raise exception 'STK_NOT_FOUND: an item is not in your organisation' using errcode = 'P0001'; end if;
    if v_item.archived_at is not null then raise exception 'STK_ARCHIVED: an item is archived' using errcode = 'P0001'; end if;
    v_q := (e->>'quantity')::numeric;  v_c := (e->>'counted_quantity')::numeric;
    v_cost := (e->>'unit_cost')::numeric;  v_dir := e->>'direction';
    if p_kind = 'count' then
      if v_c is null or v_q is not null or v_c < 0 or v_c <> round(v_c, 3) or v_c >= 100000000000::numeric then
        raise exception 'STK_INVALID: a count line needs a counted quantity of 0 or more (3 decimals at most)' using errcode = 'P0001'; end if;
    else
      if v_q is null or v_c is not null or v_q <= 0 or v_q <> round(v_q, 3) or v_q >= 100000000000::numeric then
        raise exception 'STK_INVALID: a line needs a quantity above 0 (3 decimals at most)' using errcode = 'P0001'; end if;
    end if;
    if v_item.whole_only and coalesce(v_q, v_c) <> trunc(coalesce(v_q, v_c)) then
      raise exception 'STK_FRACTION: this item is counted in whole units' using errcode = 'P0001'; end if;
    if p_kind = 'receive' and (v_cost is null or v_cost < 0 or v_cost <> round(v_cost, 4)) then
      raise exception 'STK_INVALID: a receipt line needs a unit cost of 0 or more (4 decimals at most)' using errcode = 'P0001'; end if;
    if p_kind = 'count' and v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 4)) then
      raise exception 'STK_INVALID: a unit cost is 0 or more (4 decimals at most)' using errcode = 'P0001'; end if;
    if p_kind = 'adjustment' and (coalesce(v_dir, '') not in ('in','out') or (v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 4)))) then
      raise exception 'STK_INVALID: an adjustment line needs a direction (in or out)' using errcode = 'P0001'; end if;
    if p_kind <> 'issue'  and nullif(e->>'boq_item_id', '')    is not null then raise exception 'STK_INVALID: only an issue line names a work item'   using errcode = 'P0001'; end if;
    if p_kind <> 'return' and nullif(e->>'source_line_id', '') is not null then raise exception 'STK_INVALID: only a return line cites an issue line' using errcode = 'P0001'; end if;
  end loop;
end $$;

-- Inserts the lines. PQ-3: a client cost is stored only where a cost is an input (receive; adjust-in; a count line that finds stock where the system has none) and ignored everywhere else.
create or replace function public.stock_insert_lines(p_doc public.stock_documents, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.stock_document_lines (org_id, document_id, line_no, item_id, quantity, counted_quantity, direction, unit_cost, boq_item_id, source_line_id)
  select p_doc.org_id, p_doc.id, t.n::int, (t.e->>'item_id')::uuid,
         case when p_doc.kind <> 'count' then (t.e->>'quantity')::numeric end,
         case when p_doc.kind =  'count' then (t.e->>'counted_quantity')::numeric end,
         case when p_doc.kind = 'adjustment' then t.e->>'direction' end,
         case when p_doc.kind in ('receive','count') or (p_doc.kind = 'adjustment' and t.e->>'direction' = 'in') then (t.e->>'unit_cost')::numeric end,  -- mut:costignore
         case when p_doc.kind = 'issue'  then nullif(t.e->>'boq_item_id', '')::uuid end,
         case when p_doc.kind = 'return' then nullif(t.e->>'source_line_id', '')::uuid end
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
end $$;
```

### Task S2a.5 - migration part 4: per-kind apply (Receive, Transfer, stubs) and the dispatcher
```sql
create or replace function public.stock_apply_receive(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record;
begin
  if p_doc.procurement_id is not null
     and not exists (select 1 from public.procurements pr where pr.id = p_doc.procurement_id and pr.org_id = p_doc.org_id) then
    raise exception 'STK_NOT_FOUND: the procurement case is not in your organisation' using errcode = 'P0001';       -- AC-STK-029
  end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, round(l.quantity * l.unit_cost, 2), null, null, null);
  end loop;                                        -- the procurement case itself is never touched (OQ-STK-9, AC-STK-029)
end $$;

create or replace function public.stock_apply_transfer(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; v_out numeric;
begin
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    v_out := public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, -l.quantity, null, null, null, null);   -- negative value
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.to_warehouse_id, l.quantity, -v_out, null, null, null); -- mut:conserve
  end loop;
end $$;

-- Stubs (D2): S2b replaces issue and return, S4 replaces adjustment and count, each with `create or replace` of its own function only.
create or replace function public.stock_apply_issue(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: issue posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_return(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: return posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_adjustment(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: adjustment posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_count(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: count posting is not enabled yet' using errcode = 'P0001'; end $$;

create or replace function public.stock_apply(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  case p_doc.kind
    when 'receive'    then perform public.stock_apply_receive(p_doc, p_post);
    when 'transfer'   then perform public.stock_apply_transfer(p_doc, p_post);
    when 'issue'      then perform public.stock_apply_issue(p_doc, p_post);
    when 'return'     then perform public.stock_apply_return(p_doc, p_post);
    when 'adjustment' then perform public.stock_apply_adjustment(p_doc, p_post);
    when 'count'      then perform public.stock_apply_count(p_doc, p_post);
  end case;
end $$;
```

### Task S2a.6 - migration part 5: the client RPCs, then the ACL block
```sql
create or replace function public.stock_post_core(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid(); v_override boolean := false;
begin
  select * into d from public.stock_documents x where x.id = p_document_id for update;                   -- lock order (1)
  if not found or d.org_id is distinct from public.auth_org_id() then
    raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status = 'Posted' then return; end if;                                                           -- replay-safe
  if d.status = 'Cancelled' then raise exception 'STK_IMMUTABLE: a cancelled document cannot be posted' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(d.org_id);
  perform public.stock_assert_dates(d.org_id, d.occurred_on);
  if d.kind in ('receive','transfer','issue','return') then
    v_override := public.stock_assert_keeper(d.org_id, d.warehouse_id, v_uid);
  end if;
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode = 'P0001'; end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

create or replace function public.create_stock_document(p_header jsonb, p_lines jsonb, p_post boolean default false, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_kind text; v_wh uuid; v_occ date; v_doc public.stock_documents; v_id uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then                                                               -- D7: replay returns the original
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(p_post, false) then perform public.stock_assert_standalone(v_org); end if;                -- D6, before any write
  v_kind := p_header->>'kind';
  perform public.stock_validate_payload(v_org, v_kind, p_header, p_lines);
  v_wh := (p_header->>'warehouse_id')::uuid;
  perform public.stock_assert_keeper(v_org, v_wh, v_uid);                                               -- PQ-1: authors are keepers (or Admin)
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note,
                                      occurred_on, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix(v_kind)), v_kind, v_wh,
          nullif(p_header->>'to_warehouse_id', '')::uuid, case when v_kind = 'issue' then nullif(p_header->>'project_id', '')::uuid end,
          nullif(p_header->>'procurement_id', '')::uuid, nullif(btrim(p_header->>'reason'), ''), nullif(btrim(p_header->>'note'), ''),
          v_occ, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning * into v_doc;
  if v_doc.id is null then                                                                               -- lost a race to a concurrent replay
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.stock_insert_lines(v_doc, p_lines);
  perform public.stock_apply(v_doc, false);                                                              -- static validation per kind
  if coalesce(p_post, false) then perform public.stock_post_core(v_doc.id); end if;
  return v_doc.id;
end $$;

create or replace function public.save_stock_draft(p_document_id uuid, p_header jsonb, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); d public.stock_documents; v_occ date;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = v_org for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: only a draft can be edited' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid then raise exception 'only the author edits a draft' using errcode = '42501'; end if;
  if coalesce(p_header->>'kind', d.kind) <> d.kind then raise exception 'STK_INVALID: a document''s kind cannot change' using errcode = 'P0001'; end if;
  perform public.stock_validate_payload(v_org, d.kind, p_header, p_lines);
  perform public.stock_assert_keeper(v_org, (p_header->>'warehouse_id')::uuid, v_uid);
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, d.occurred_on);
  perform public.stock_assert_dates(v_org, v_occ);
  update public.stock_documents set warehouse_id = (p_header->>'warehouse_id')::uuid, to_warehouse_id = nullif(p_header->>'to_warehouse_id', '')::uuid,
         project_id = case when d.kind = 'issue' then nullif(p_header->>'project_id', '')::uuid else d.project_id end, procurement_id = nullif(p_header->>'procurement_id', '')::uuid,
         reason = nullif(btrim(p_header->>'reason'), ''), note = nullif(btrim(p_header->>'note'), ''), occurred_on = v_occ
   where id = d.id returning * into d;
  delete from public.stock_document_lines where document_id = d.id;
  perform public.stock_insert_lines(d, p_lines);
  perform public.stock_apply(d, false);
end $$;

create or replace function public.post_stock_document(p_document_id uuid) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_is_active_member();
  perform public.stock_post_core(p_document_id);
  return p_document_id;
end $$;

create or replace function public.cancel_stock_document(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be cancelled' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid and not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'only the author or an Admin cancels a draft' using errcode = '42501'; end if;
  update public.stock_documents set status = 'Cancelled', cancelled_by = v_uid, cancelled_at = now() where id = d.id;
end $$;

-- ACL (hosted grants lesson). Internals: nobody. Client RPCs: authenticated only.
revoke all on function
  public.stock_doc_prefix(text), public.stock_org_today(uuid), public.stock_assert_standalone(uuid), public.stock_assert_keeper(uuid, uuid, uuid),
  public.stock_assert_dates(uuid, date), public.stock_lock_for_document(public.stock_documents),
  public.stock_write_entry(public.stock_documents, uuid, uuid, uuid, numeric, numeric, uuid, uuid, uuid),
  public.stock_validate_payload(uuid, text, jsonb, jsonb), public.stock_insert_lines(public.stock_documents, jsonb),
  public.stock_apply_receive(public.stock_documents, boolean), public.stock_apply_transfer(public.stock_documents, boolean),
  public.stock_apply_issue(public.stock_documents, boolean), public.stock_apply_return(public.stock_documents, boolean),
  public.stock_apply_adjustment(public.stock_documents, boolean), public.stock_apply_count(public.stock_documents, boolean),
  public.stock_apply(public.stock_documents, boolean), public.stock_post_core(uuid)
  from public, anon, authenticated;
revoke all on function public.create_stock_document(jsonb, jsonb, boolean, uuid), public.save_stock_draft(uuid, jsonb, jsonb),
  public.post_stock_document(uuid), public.cancel_stock_document(uuid) from public, anon;
grant execute on function public.create_stock_document(jsonb, jsonb, boolean, uuid), public.save_stock_draft(uuid, jsonb, jsonb),
  public.post_stock_document(uuid), public.cancel_stock_document(uuid) to authenticated;
```
(`stock_org_today` and `stock_doc_prefix` are read-only helpers; they are revoked anyway: only definer code calls them.) Any later `create or replace` of an `stock_apply_*` function must be followed by the same `revoke` for its signature (S2b.5, S4.4 repeat it).

### Task S2a.7 - turn the valuation test green
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_valuation.test.sql'` -> 10/10. Debug order if red: (1) `STK_NOT_FOUND` on the warehouse -> the helper user is not the Admin; (2) `permission denied` for `stock_document_lines` inside `stock_insert_lines` -> the function lost `security definer`; (3) `42883 trim_scale` -> the stack is Postgres 12 (upgrade the local image; do not drop the function).

### Task S2a.8 - guard tests (red, then green)
Create `supabase/tests/stock_immutability_idempotency.test.sql` (AC-STK-011, 012) and `supabase/tests/stock_posting_guards.test.sql` (AC-STK-010 transfer, 013, 016, 017, 018, 021 ledger part, 029). Prelude F1 + the same `stk_t_*` helpers; set `plan(N)` to the count of assertions you write. Required assertions (every one leads with its AC id; the SQL for the money-critical ones is given):
```sql
-- AC-STK-011 (stock_immutability_idempotency): a Posted document, its lines and the ledger never change, for anyone.
-- setup: Admin posts a receive (doc D, line L).
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_ok($$ update public.stock_document_lines set quantity = 1 $$, '42501', null, 'AC-STK-011 even an Admin has no grant to update a line');
reset role;
select throws_like($$ update public.stock_document_lines set quantity = 1 where document_id = (select id from stock_documents limit 1) $$,
  'STK_IMMUTABLE%', 'AC-STK-011 the trigger refuses a line update even with table-owner rights');
select throws_like($$ delete from public.stock_document_lines where document_id = (select id from stock_documents limit 1) $$, 'STK_IMMUTABLE%', 'AC-STK-011 a posted line cannot be deleted');
select throws_like($$ update public.stock_documents set note = 'x' where status = 'Posted' $$, 'STK_IMMUTABLE%', 'AC-STK-011 a posted header cannot be edited');
select throws_like($$ update public.stock_ledger set value_delta = 0 $$, 'STK_IMMUTABLE%', 'AC-STK-011 a ledger row cannot be updated');
select throws_like($$ delete from public.stock_ledger $$, 'STK_IMMUTABLE%', 'AC-STK-011 a ledger row cannot be deleted');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.cancel_stock_document((select id from stock_documents where status = 'Posted' limit 1)) $$,
  'STK_IMMUTABLE%', 'AC-STK-011 a posted document cannot be cancelled, by an Admin either');
-- AC-STK-012: same client_request_id twice -> one document, one set of ledger entries, the second call returns the first.
select is(public.create_stock_document(<header>, <lines>, true, '15120000-0000-0000-0000-0000000f0001'),
          public.create_stock_document(<header>, <lines>, true, '15120000-0000-0000-0000-0000000f0001'), 'AC-STK-012 the replay returns the first document');
select is((select count(*)::int from stock_documents where client_request_id = '15120000-0000-0000-0000-0000000f0001'), 1, 'AC-STK-012 one document exists');
select is((select count(*)::int from stock_ledger where document_id = (select id from stock_documents where client_request_id = '15120000-0000-0000-0000-0000000f0001')), 1,
  'AC-STK-012 one ledger entry exists');

-- AC-STK-013 (stock_posting_guards): keeper A cannot post on warehouse B, on either path; an Admin can, audited.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                            -- U_K1 keeps SITE-A only
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 5, 10) $$,
  'STK_NOT_KEEPER%', 'AC-STK-013 create-and-post on a warehouse you do not keep is refused');
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                -- Admin drafts a receipt at SITE-B
select set_config('stk.draft', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002003'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',5,'unit_cost',10)))::text, false);
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.post_stock_document(current_setting('stk.draft')::uuid) $$, 'STK_NOT_KEEPER%',
  'AC-STK-013 posting a draft on a warehouse you do not keep is refused');
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');                -- U_K2 keeps SITE-B
select lives_ok($$ select public.post_stock_document(current_setting('stk.draft')::uuid) $$, 'AC-STK-013 the keeper of SITE-B posts it');
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 10) $$, 'AC-STK-013 an Admin may post on any warehouse');
reset role;
select is((select count(*)::int from audit_events where action = 'stock.admin_post'), 1, 'AC-STK-013 the Admin override is audited');

-- AC-STK-018: an externally-owned inventory domain refuses every post and writes nothing; reads still work.
insert into external_domain_ownership (org_id, external_tier, domain) values ('15120000-0000-0000-0000-000000000001', 'odoo', 'inventory');
select set_config('stk.docs', (select count(*) from stock_documents)::text || '/' || (select count(*) from stock_ledger)::text, false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 10) $$,
  'STK_OWNED_BY_ERP%', 'AC-STK-018 posting while the domain is ERP-owned is refused');
reset role;
select is((select count(*) from stock_documents)::text || '/' || (select count(*) from stock_ledger)::text, current_setting('stk.docs'),
  'AC-STK-018 nothing was written (no document row, no ledger entry)');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select ok((select count(*) from stock_documents) >= 0, 'AC-STK-018 reads still work while ERP-owned');
```
```sql
-- AC-STK-016: a whole-number item refuses a fraction; a metre item takes it
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1.5, 10) $$, 'STK_FRACTION%', 'AC-STK-016 a fractional quantity of a whole-number item is refused');
select lives_ok($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 1.5, 10) $$, 'AC-STK-016 the same fraction of a metre item posts');
-- AC-STK-017: archive is refused while stock is on hand, allowed with none, and archived rows leave pickers but not history
select throws_like($$ update public.stock_items set archived_at = now() where id = '15120000-0000-0000-0000-000000001002' $$, 'STK_HAS_STOCK%', 'AC-STK-017 an item with stock on hand cannot be archived');
select throws_like($$ update public.stock_warehouses set archived_at = now() where id = '15120000-0000-0000-0000-000000002002' $$, 'STK_HAS_STOCK%', 'AC-STK-017 a warehouse holding stock cannot be archived');
insert into public.stock_items (id, code, name, unit_id) values ('15120000-0000-0000-0000-000000001009', 'TMP', 'Never used', '15120000-0000-0000-0000-0000000000d2');
insert into public.stock_warehouses (id, code, name, kind) values ('15120000-0000-0000-0000-000000002008', 'W-TMP', 'Temporary', 'site');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002008', '15120000-0000-0000-0000-000000001002', 1, 10);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002008', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 1);                       -- the warehouse is empty again
select lives_ok($$ update public.stock_items set archived_at = now() where id = '15120000-0000-0000-0000-000000001009' $$, 'AC-STK-017 an item with no stock archives');
select lives_ok($$ update public.stock_warehouses set archived_at = now() where id = '15120000-0000-0000-0000-000000002008' $$, 'AC-STK-017 an emptied warehouse archives');
select is((select count(*)::int from public.stock_items where archived_at is null and id = '15120000-0000-0000-0000-000000001009'), 0, 'AC-STK-017 the archived item is absent from the active picker query');
select ok((select count(*) from public.stock_documents where warehouse_id = '15120000-0000-0000-0000-000000002008') >= 2, 'AC-STK-017 its history (documents) is still there');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002008', '15120000-0000-0000-0000-000000001002', 1, 10) $$, 'STK_ARCHIVED%', 'AC-STK-017 an archived warehouse takes no new line');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001009', 1, 10) $$, 'STK_ARCHIVED%', 'AC-STK-017 an archived item takes no new line');
-- AC-STK-021 (ledger part): a stale or future date is refused for non-Admins; the Admin may go back but never forward; no earlier value changes
reset role;
select set_config('stk.agg', (select string_agg(value_after::text, ',' order by seq) from public.stock_ledger), false);
select set_config('stk.maxseq', (select max(seq)::text from public.stock_ledger), false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date - 40)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_BACKDATE%', 'AC-STK-021 a keeper cannot date a movement 40 days back');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date + 1)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_BACKDATE%', 'AC-STK-021 a keeper cannot date a movement in the future');
reset role; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date - 40)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'AC-STK-021 an Admin may date a movement 40 days back');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date + 1)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_BACKDATE%', 'AC-STK-021 but not into the future (PQ-2)');
reset role;
select is((select string_agg(value_after::text, ',' order by seq) from public.stock_ledger where seq <= current_setting('stk.maxseq')::bigint), current_setting('stk.agg'),
  'AC-STK-021 the backdated post changed no earlier ledger value');
-- AC-STK-029: a receipt may cite a procurement case of its org, and never changes it
insert into public.procurements (id, org_id, title, status, requested_by_id) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK case', 'Draft', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000f2', '15120000-0000-0000-0000-000000000002', 'STK other-org case', 'Draft', '15120000-0000-0000-0000-0000000000b1');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','procurement_id','15120000-0000-0000-0000-0000000000f1'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'AC-STK-029 a receipt citing a case of its own org posts');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','procurement_id','15120000-0000-0000-0000-0000000000f2'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_NOT_FOUND%', 'AC-STK-029 citing another org''s case is refused');
reset role;
select is((select status::text from public.procurements where id = '15120000-0000-0000-0000-0000000000f1'), 'Draft', 'AC-STK-029 the case''s status is unchanged');
select is((select count(*)::int from public.procurement_receipts where procurement_id = '15120000-0000-0000-0000-0000000000f1'), 0, 'AC-STK-029 and no procurement receipt record was created');
-- AC-STK-010 (Transfer): a client cost on a non-cost line is ignored; the ledger value is the server's
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','15120000-0000-0000-0000-000000002001','to_warehouse_id','15120000-0000-0000-0000-000000002002'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',999)), true);
reset role;
select is((select count(*)::int from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id where d.kind = 'transfer' and l.unit_cost is not null), 0,
  'AC-STK-010 a client cost on a transfer line is not stored');
select is((select max(abs(value_delta))::text from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
            where d.kind = 'transfer' and l.qty_delta = -1 and l.item_id = '15120000-0000-0000-0000-000000001002' and l.warehouse_id = '15120000-0000-0000-0000-000000002001'), '10.00', 'AC-STK-010 the ledger value is the moving average, not 999');
-- FR-STK-060 / 010 / 011 supporting assertions
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into public.stock_balances (org_id, item_id, warehouse_id, qty_on_hand) values ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000002003', 5) $$, '42501', null, 'FR-STK-060 even an Admin cannot write balances directly');
select throws_ok($$ insert into public.stock_documents (org_id, number, kind, warehouse_id, occurred_on, created_by) values ('15120000-0000-0000-0000-000000000001', 'X', 'receive', '15120000-0000-0000-0000-000000002002', current_date, '15120000-0000-0000-0000-0000000000a1') $$, '42501', null, 'FR-STK-060 nor documents');
select matches((select number from public.stock_documents where kind = 'receive' order by created_at limit 1), '^RCV-[0-9]{10}$', 'FR-STK-010 a document number is minted with the kind prefix');
select set_config('stk.dr', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',2,'unit_cost',10)))::text, false);
select lives_ok($$ select public.save_stock_draft(current_setting('stk.dr')::uuid, jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002002','note','edited'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',3,'unit_cost',10))) $$, 'FR-STK-011 the author edits a Draft');
reset role; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.save_stock_draft(current_setting('stk.dr')::uuid, jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10))) $$, '42501', null, 'FR-STK-011 another user cannot edit it');
reset role; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.cancel_stock_document(current_setting('stk.dr')::uuid) $$, 'FR-STK-011 the author cancels the Draft');
reset role;
```
Set `plan(N)` to the exact count of assertions in this file. (The procurement ids `...0f1` / `...0f2` reuse the hex of the F1 company id: different tables, no clash.) The minter format is `PREFIX-YYMMDD####`, hence the ten digits in the `matches` assertion.
**Order inside `stock_posting_guards.test.sql`:** AC-STK-013, 016, 017, 021, 029, 010 and the FR-STK-060 / 010 / 011 block first; the **AC-STK-018 block last**, because it inserts the `external_domain_ownership` row that makes every later post refuse (the file is rolled back at the end, so nothing leaks).

Run each file red first, then after S2a.2-S2a.6 green: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_valuation.test.sql supabase/tests/stock_immutability_idempotency.test.sql supabase/tests/stock_posting_guards.test.sql'`.

### Task S2a.9 - the single-writer guard (FR-STK-072)
Test + implementation in one file `scripts/stock-single-writer.test.mjs` **(new)** (CI already runs `scripts/*.test.mjs` with `node --test`, `.github/workflows/ci.yml` line 217):
```js
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
const DIR = path.resolve(import.meta.dirname, '../supabase/migrations');
const WRITES = /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?(?:public\.)?(stock_ledger|stock_balances)\b/gi;
// function -> tables it may write. Everything else under supabase/migrations/ must not write these two tables.
const ALLOWED = { stock_write_entry: ['stock_ledger', 'stock_balances'], stock_lock_for_document: ['stock_balances'] };
function functionBodies(sql) {                       // [{ name, body }] by `create [or replace] function [public.]name ... $$ ... $$;`
  return [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)[\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi)].map((m) => ({ name: m[1], body: m[3], start: m.index, end: m.index + m[0].length }));
}
test('FR-STK-072 only stock_write_entry writes the ledger and balances; stock_lock_for_document may seed a zero balance row', () => {
  const offenders = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    const fns = functionBodies(sql);
    for (const m of sql.matchAll(WRITES)) {
      const owner = fns.find((fn) => m.index >= fn.start && m.index < fn.end);
      const table = m[2].toLowerCase();
      if (!owner || !(ALLOWED[owner.name] ?? []).includes(table)) offenders.push(`${f}: ${m[0]} (${owner?.name ?? 'top level'})`);
    }
  }
  assert.deepEqual(offenders, [], 'an unexpected writer of stock_ledger / stock_balances');
});
test('the guard is not vacuous: it sees the real writer', () => {
  const sql = fs.readFileSync(path.join(DIR, '0412_stock_posting_engine.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert.ok([...sql.matchAll(WRITES)].length >= 3, 'expected the three real write statements in 0412');
});
test('mutation: a rogue writer is caught', () => {
  const rogue = 'create function public.rogue() returns void language sql as $$ update public.stock_balances set qty_on_hand = 1; $$;';
  const fns = functionBodies(rogue); const m = [...rogue.matchAll(WRITES)][0];
  assert.equal(fns.find((fn) => m.index >= fn.start && m.index < fn.end).name, 'rogue');
  assert.equal((ALLOWED.rogue ?? []).includes('stock_balances'), false);
});
```
Run: `node --test scripts/stock-single-writer.test.mjs` -> 3 pass. (The trigger functions that touch other tables are unaffected: the regex matches only the two table names. A `drop table ... stock_ledger` in a rollback file is not matched.)

### Task S2a.10 - seed opening stock through the RPC
Append to `supabase/seed.sql` a `do $$ ... $$` block that impersonates the seeded Admin (`00000000-0000-0000-0000-0000000000a5`) and posts opening receives with `create_stock_document(..., true, '<fixed client_request_id>')` (fixed ids make a re-run a no-op): central receives of all 12 items at realistic costs; transfers central -> SITE-A / SITE-B / SITE-C so every site holds a few items (SITE-A: cement, rebar, cable). Preamble: `perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);`. No direct ledger insert: the seed must obey the invariant it tests. `grep -rn "stock_" supabase/seed.sql | wc -l` > 0; `supabase db reset` completes. Run the touched existing e2e that read the dashboard once (`scripts/e2e-local.sh AC-701`) to prove the seed addition is inert.

### Task S2a.11 - allow-list, isolation test, rollback, types
1. `supabase/tests/0178_anon_executable_definers.test.sql`: add `create_stock_document`, `save_stock_draft`, `post_stock_document`, `cancel_stock_document` (+4; re-derive the hard-coded count by hand; add the `⚑ AMENDED BY 0412 (#1512)` note).
2. `supabase/tests/stock_tenant_isolation.test.sql` (append at the `-- S2a:` marker; bump `plan()`): org B sees 0 rows of `stock_documents` and `stock_document_lines`; `select * from stock_ledger` and `select * from stock_balances` as `authenticated` throw `42501` (no grant); `create_stock_document` with org A's warehouse id as org B -> `STK_NOT_FOUND%`; with org B's own warehouse but org A's `item_id` -> `STK_NOT_FOUND%`; `post_stock_document(<org A doc id>)` as org B -> `STK_NOT_FOUND%`; `save_stock_draft` and `cancel_stock_document` on an org A draft as org B -> `STK_NOT_FOUND%`.
3. `supabase/migrations/rollback/0412_stock_posting_engine_down.sql`: drop the RPCs and internals (reverse of creation), then `drop table stock_balances, stock_ledger, stock_document_lines, stock_documents cascade`, then the guard functions.
4. Types: regenerate (Conventions), `npm run typecheck`.
Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_tenant_isolation.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`.

### Task S2a.12 - mutation harness and the S1 + S2a cases (money gate)
`scripts/stock-mutation-proof.mjs` **(new)** plus `scripts/stock-mutation-proof.test.mjs` (pure, runs in CI). The harness reads each live function definition, breaks the one `-- mut:` line, runs the owning pgTAP file (it MUST fail), restores the original definition in `finally`, and re-runs the file (it MUST pass). A mutation that does not change the text, or matches twice, is itself a failure (guard polarity, `docs/qa-portfolio.md` "Enforcement").
```js
#!/usr/bin/env node
// Money / SoD mutation proof for #1512 (ADR-0030 Layer 1; CLAUDE.md "mutation-check anything security-critical").
// Usage: scripts/with-db-lock.sh node scripts/stock-mutation-proof.mjs [caseId ...]    (refuses without the DB lock)
import { spawnSync } from 'node:child_process';
const PSQL = process.env.PSQL ?? 'psql';
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const CASES = [
  { id: 'admin_only',   fn: 'public.set_stock_warehouse_keeper(uuid,uuid,boolean)', from: /(v_admin := )[^;]+(;\s*-- mut:admin_only)/,        to: '$1true$2', test: 'supabase/tests/stock_master_data.test.sql' },
  { id: 'owned',        fn: 'public.stock_assert_standalone(uuid)',                from: /(v_allowed := )[^;]+(;\s*-- mut:owned)/,            to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'keeper',       fn: 'public.stock_assert_keeper(uuid,uuid,uuid)',          from: /(v_keeper := )[\s\S]*?(;\s*-- mut:keeper\b)/,       to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'keeper_admin', fn: 'public.stock_assert_keeper(uuid,uuid,uuid)',          from: /(v_admin := )[^;]+(;\s*-- mut:keeper_admin)/,        to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'future',       fn: 'public.stock_assert_dates(uuid,date)',                from: /(v_future_ok := )[^;]+(;\s*-- mut:future)/,         to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'backdate',     fn: 'public.stock_assert_dates(uuid,date)',                from: /(v_old_ok := )[^;]+(;\s*-- mut:backdate)/,          to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'avg',          fn: 'public.stock_write_entry(public.stock_documents,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid)',
                        from: /round\(v_out \* b\.value_on_hand \/ b\.qty_on_hand, 2\)(\s*end;\s*-- mut:avg)/, to: 'round(v_out * b.value_on_hand / b.qty_on_hand, 2) + 1$1', test: 'supabase/tests/stock_valuation.test.sql' },
  { id: 'costignore',   fn: 'public.stock_insert_lines(public.stock_documents,jsonb)', from: /(case when )p_doc\.kind in \('receive','count'\) or \(p_doc\.kind = 'adjustment' and t\.e->>'direction' = 'in'\)(\s*then \(t\.e->>'unit_cost'\)::numeric end,\s*-- mut:costignore)/, to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'insufficient', fn: 'public.stock_write_entry(public.stock_documents,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid)', from: /if v_out > b\.qty_on_hand then/, to: 'if false then', test: 'supabase/tests/stock_valuation.test.sql' },
  { id: 'immutable',    fn: 'public.guard_stock_ledger_append_only()', from: /raise exception 'STK_IMMUTABLE: the stock ledger is append-only' using errcode = 'P0001';/, to: 'return new;', test: 'supabase/tests/stock_immutability_idempotency.test.sql' },
  { id: 'conserve',     fn: 'public.stock_apply_transfer(public.stock_documents,boolean)', from: /-v_out(, null, null, null\);\s*-- mut:conserve)/, to: '-v_out + 1$1', test: 'supabase/tests/stock_valuation.test.sql' },
];
// S2b / S4 / S5 / S6 append their cases to this table in their own slice (ids named in each slice's mutation task).
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const sql = (q) => run(PSQL, [DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]);
// A case names either a pgTAP file (`test`) or a command (`cmd`, e.g. the S2b concurrency script).
const exec = (c) => (c.cmd ? run(c.cmd[0], c.cmd.slice(1)) : run('supabase', ['test', 'db', c.test]));
export function mutate(def, c) {
  const hits = [...def.matchAll(new RegExp(c.from.source, c.from.flags.includes('g') ? c.from.flags : c.from.flags + 'g'))];
  if (hits.length !== 1) throw new Error(`${c.id}: mutation matched ${hits.length} times (expected exactly 1) - the marker moved`);
  const out = def.replace(c.from, c.to);
  if (out === def) throw new Error(`${c.id}: mutation changed nothing`);
  return out;
}
export function runProof(ids = []) {
  if (!process.env.PMO_DB_LOCK_HELD) throw new Error('run under scripts/with-db-lock.sh');
  const results = [];
  for (const c of CASES.filter((x) => !ids.length || ids.includes(x.id))) {
    const orig = sql(`select pg_get_functiondef('${c.fn}'::regprocedure)`).stdout;
    if (!orig) throw new Error(`${c.id}: function ${c.fn} not found`);
    const mutated = mutate(orig, c);
    let red;
    try {
      const apply = run(PSQL, [DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: mutated });
      if (apply.status !== 0) throw new Error(`${c.id}: mutated definition did not load: ${apply.stderr}`);
      red = exec(c).status !== 0;
    } finally {
      const restore = run(PSQL, [DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: orig });
      if (restore.status !== 0) throw new Error(`${c.id}: RESTORE FAILED - run supabase db reset: ${restore.stderr}`);
    }
    const green = exec(c).status === 0;
    results.push({ id: c.id, red, green });
  }
  return results;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runProof(process.argv.slice(2));
  console.table(r);
  process.exit(r.every((x) => x.red && x.green) ? 0 : 1);
}
```
Pure test `scripts/stock-mutation-proof.test.mjs`: `mutate()` returns changed text for a fixture definition, throws on zero and on two matches, `runProof()` throws without `PMO_DB_LOCK_HELD`, and every `CASES` entry has a unique id and a `test` (or last `cmd` argument) path that exists (`fs.existsSync`). Run: `node --test scripts/stock-mutation-proof.test.mjs`.
Then the money gate (evidence for the PR body, the Director reads this table):
`scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/stock-mutation-proof.mjs'` -> every row `red: true, green: true`. A row with `red: false` means the owning test does not bind to the rule: fix the **test**, never the case.

### Task S2a.13 - gate
`npm run check:guards`; `node --test scripts/stock-single-writer.test.mjs scripts/stock-mutation-proof.test.mjs`; the DB chain above for every S1 + S2a pgTAP file together; the mutation table; three reviewers (spec, quality, security-auditor: RLS, definer search_path, tenancy, grants); Director pairs the security pass with Terra or Sol review (money). Commit per task; push `feat/stock-s2a-posting-engine`; report.

---

# Slice S2b - Posting engine, out-flows (`0413_stock_out_flows.sql`)

Builds: real `stock_apply_issue` and `stock_apply_return` (project + work item checks, return cap, server-derived cost), the whole-sequence ledger-equals-balance proof, the lock-order and oversell proof, and the mutation cases for all of it. It replaces **only** those two stubs; the dispatcher, the RPCs and every table are untouched. **Money tier: Terra or Sol; ships alone.** Owns: AC-STK-004 (receive / transfer / issue / return; S4 appends adjustment and count), 007, 008, 009; appends the Issue / Return variants of 002, 003, 005, 010 and 019 to the S2a files. FRs: 022, 023, 014, 017, 031, NFR-STK-002.

### Task S2b.1 - failing pgTAP (AC-STK-007, 008, 009) and the S2a-file appends
Create `supabase/tests/stock_out_flows.test.sql` = prelude F1 + the `stk_t_rcv` helper of S2a.1 + three more one-liners. Org B also needs a client, a project and a BoQ line for AC-STK-007: `insert into companies (id, org_id, name, type) values ('15120000-0000-0000-0000-0000000000f9', '15120000-0000-0000-0000-000000000002', 'X Client', 'Client')`, `insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values ('15120000-0000-0000-0000-0000000000c9', '15120000-0000-0000-0000-000000000002', 'X Ongoing', 'Ongoing Project', 1, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f9')` and `insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values ('15120000-0000-0000-0000-0000000000e9', '15120000-0000-0000-0000-000000000002', '15120000-0000-0000-0000-0000000000c9', 'X-1', 'x', 'm3', 1, 1)` (superuser, before any role switch).
```sql
select plan(15);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_issue(p_wh uuid, p_project uuid, p_item uuid, p_qty numeric, p_boq uuid, p_post boolean default true) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id',p_project),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id',p_boq)), p_post) $$;
create function public.stk_t_line(p_doc uuid) returns uuid language sql as $$
  select id from public.stock_document_lines where document_id = p_doc order by line_no limit 1 $$;
create function public.stk_t_return(p_wh uuid, p_src uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','return','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'source_line_id',p_src)), true) $$;

-- opening: Admin puts 100 cable @ 60 and 3 bags @ 33.3367 (= 100.01) at SITE-A; U_K1 keeps SITE-A.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100, 60);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 3, 33.3367);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- U_K1
-- AC-STK-007: every issue line names a work item OF THE ISSUE'S PROJECT
select throws_like($$ select public.create_stock_document(
    jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002002','project_id','15120000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',5)), true) $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-007 a line with no work item is refused');
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e2') $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-007 a work item of another project is refused');
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e9') $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-007 a work item of another organisation is refused');
select set_config('stk.d1', public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e1', false)::text, false);   -- a valid Draft
reset role;
update public.stock_document_lines set boq_item_id = '15120000-0000-0000-0000-0000000000e2' where document_id = current_setting('stk.d1')::uuid;   -- re-pointed behind the RPC's back
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.post_stock_document(current_setting('stk.d1')::uuid) $$, 'STK_BOQ_MISMATCH%', 'AC-STK-007 the same refusal holds when the draft is posted');
-- AC-STK-008: only an Ongoing, un-archived project takes an issue (create-and-post, archived, and post-time paths)
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e2') $$,
  'STK_PROJECT_NOT_ACTIVE%', 'AC-STK-008 a project that is not Ongoing is refused');
reset role; update public.projects set archived_at = now() where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e1') $$,
  'STK_PROJECT_NOT_ACTIVE%', 'AC-STK-008 an archived project is refused');
reset role; update public.projects set archived_at = null where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.d2', public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e1', false)::text, false);
reset role; update public.projects set status = 'On Hold' where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.post_stock_document(current_setting('stk.d2')::uuid) $$, 'STK_PROJECT_NOT_ACTIVE%', 'AC-STK-008 a draft is refused at post once its project goes On Hold');
reset role; update public.projects set status = 'Ongoing Project' where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
-- AC-STK-009: the cap, the cost left at, net consumption
select set_config('stk.iss', public.stk_t_line(public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 10, '15120000-0000-0000-0000-0000000000e1'))::text, false);   -- 10 @ 60 = 600
select lives_ok($$ select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001002', 7) $$, 'AC-STK-009 a first return of 7 posts');
select throws_like($$ select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001002', 4) $$, 'STK_RETURN_EXCEEDS%', 'AC-STK-009 returning 4 more (cumulative 11 of 10) is refused');
select lives_ok($$ select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001002', 3) $$, 'AC-STK-009 returning the last 3 posts');
reset role;
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'return' and source_line_id = current_setting('stk.iss')::uuid), '600.00',
  'AC-STK-009 the returns restore exactly the issued value (420 + 180)');
select is((select sum(case when kind = 'issue' then -qty_delta else qty_delta end)::text from public.stock_ledger
            where project_id = '15120000-0000-0000-0000-0000000000c1' and boq_item_id = '15120000-0000-0000-0000-0000000000e1'
              and (line_id = current_setting('stk.iss')::uuid or source_line_id = current_setting('stk.iss')::uuid)), '0.000',
  'AC-STK-009 net consumption of that issue is 10 - 7 - 3 = 0');
-- the remainder rule: 3 bags worth 100.01 issued, then returned one at a time: 33.34 + 33.34 + 33.33, never 100.02
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.iss2', public.stk_t_line(public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001001', 3, '15120000-0000-0000-0000-0000000000e1'))::text, false);
select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss2')::uuid, '15120000-0000-0000-0000-000000001001', 1);
select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss2')::uuid, '15120000-0000-0000-0000-000000001001', 1);
select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss2')::uuid, '15120000-0000-0000-0000-000000001001', 1);
reset role;
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'return' and source_line_id = current_setting('stk.iss2')::uuid), '100.01',
  'AC-STK-009 returns of 1 + 1 + 1 restore exactly 100.01 (the last takes the remainder)');
select is((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = '15120000-0000-0000-0000-000000002002' and item_id = '15120000-0000-0000-0000-000000001001'), '3.000/100.01',
  'AC-STK-009 stock re-enters at the cost the issue left at');
select is((select count(*)::int from public.stock_documents d where d.kind = 'return' and d.project_id is distinct from '15120000-0000-0000-0000-0000000000c1'), 0,
  'AC-STK-009 every return took its project from the cited issue, not from the client');
select * from finish();
rollback;
```
Count: 15 assertions.
Also in this task (append at each file's `-- S2b:` marker, bump `plan()`):
- `supabase/tests/stock_valuation.test.sql` - AC-STK-002 issue variant: Admin issues 50 cable from CENTRAL (110 on hand worth 6,600) to `P_ON`/`BOQ_ON`: out entry `-3000.00`, balance `60.000/3600.00`. AC-STK-003 issue variant: Admin issues all 3 bags from CENTRAL (which holds 3 worth 100.01 after the stepwise moves): out `-100.01`, balance `0.000/0.00`. AC-STK-005 issue variant: U_K1 issues 6 bags from SITE-A (holds 5): `STK_INSUFFICIENT%available 5%requested 6%`, no ledger row with `qty_delta = -6`.
- `supabase/tests/stock_posting_guards.test.sql` - AC-STK-010 issue and return variants: an issue line carrying `"unit_cost": 999` stores `unit_cost is null` and the ledger value is the moving-average value; a return line carrying a cost stores null and re-enters at the issue's cost.
- `supabase/tests/stock_tenant_isolation.test.sql` (marker `-- S2b:`) - AC-STK-019 for the out-flow RPC paths: org B posting an issue with org A's `boq_item_id` / `project_id` -> refused; org B's return citing org A's issue line -> `STK_BOQ_MISMATCH%`.
Run (expect FAIL: `STK_KIND_UNAVAILABLE`): `scripts/with-db-lock.sh supabase test db supabase/tests/stock_out_flows.test.sql`

### Task S2b.2 - migration 0413: Issue and Return
Create `supabase/migrations/0413_stock_out_flows.sql`:
```sql
-- 0413_stock_out_flows.sql - #1512 S2b: Issue and Return posting (FR-STK-022, 023, 014, 017). Replaces ONLY the two S2a stubs.
-- Reversal: supabase/migrations/rollback/0413_stock_out_flows_down.sql (restores the stubs).
create or replace function public.stock_apply_issue(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; v_status text; v_archived timestamptz; v_found boolean; v_active boolean; v_boq_ok boolean;
begin
  select p.status::text, p.archived_at, true into v_status, v_archived, v_found
    from public.projects p where p.id = p_doc.project_id and p.org_id = p_doc.org_id;
  if not coalesce(v_found, false) then
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;
  v_active := v_status = 'Ongoing Project' and v_archived is null;                                      -- mut:projactive
  if not v_active then
    raise exception 'STK_PROJECT_NOT_ACTIVE: issues are taken only to an Ongoing, un-archived project' using errcode = 'P0001'; end if;
  v_boq_ok := not exists (select 1 from public.stock_document_lines x
                           where x.document_id = p_doc.id
                             and (x.boq_item_id is null or not exists (select 1 from public.boq_items b
                                   where b.id = x.boq_item_id and b.project_id = p_doc.project_id and b.org_id = p_doc.org_id)));   -- mut:boq
  if not v_boq_ok then
    raise exception 'STK_BOQ_MISMATCH: every line needs a work item of this project' using errcode = 'P0001'; end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, -l.quantity, null, p_doc.project_id, l.boq_item_id, null);
  end loop;
end $$;

create or replace function public.stock_apply_return(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; r record; v_lines int; v_matched int; v_projects int; v_project uuid;
        v_issued numeric; v_issued_val numeric; v_ret numeric; v_ret_val numeric; v_in numeric; v_cap_ok boolean;
begin
  -- Every line cites a POSTED issue line of the same item in this org; one project overall (the project comes from the issue, never the client).
  select count(*) into v_lines from public.stock_document_lines x where x.document_id = p_doc.id;
  select count(*), count(distinct sd.project_id), min(sd.project_id::text)::uuid into v_matched, v_projects, v_project
    from public.stock_document_lines x
    join public.stock_document_lines s on s.id = x.source_line_id and s.item_id = x.item_id
    join public.stock_documents sd on sd.id = s.document_id and sd.kind = 'issue' and sd.status = 'Posted' and sd.org_id = p_doc.org_id
   where x.document_id = p_doc.id;
  if v_matched <> v_lines then
    raise exception 'STK_BOQ_MISMATCH: each return line must cite a posted issue line of the same item' using errcode = 'P0001'; end if;
  if v_projects <> 1 then
    raise exception 'STK_INVALID: a return may cite issue lines of one project only' using errcode = 'P0001'; end if;
  if p_doc.project_id is distinct from v_project then
    update public.stock_documents set project_id = v_project where id = p_doc.id;                         -- Draft header, server-derived
  end if;
  -- Cap pre-check (re-checked under the lock below). Cumulative per cited line, including other lines of this document.
  for r in select x.source_line_id as src, sum(x.quantity) as q from public.stock_document_lines x where x.document_id = p_doc.id group by 1 order by 1 loop
    select -e.qty_delta into v_issued from public.stock_ledger e where e.line_id = r.src and e.kind = 'issue';
    select coalesce(sum(e.qty_delta), 0) into v_ret from public.stock_ledger e where e.source_line_id = r.src and e.kind = 'return';
    v_cap_ok := v_ret + r.q <= v_issued;                                                                 -- mut:cap
    if not v_cap_ok then
      raise exception 'STK_RETURN_EXCEEDS: issued %, already returned %, requested %', trim_scale(v_issued)::text, trim_scale(v_ret)::text, trim_scale(r.q)::text
        using errcode = 'P0001', detail = jsonb_build_object('issued', trim_scale(v_issued)::text, 'returned', trim_scale(v_ret)::text, 'requested', trim_scale(r.q)::text)::text;
    end if;
  end loop;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);               -- also locks the cited issue lines (order 2), so two returns of one line serialise
  for l in select x.*, s.boq_item_id as s_boq, sd.project_id as s_project
             from public.stock_document_lines x
             join public.stock_document_lines s on s.id = x.source_line_id
             join public.stock_documents sd on sd.id = s.document_id
            where x.document_id = p_doc.id order by x.line_no loop
    select -e.qty_delta, -e.value_delta into v_issued, v_issued_val from public.stock_ledger e where e.line_id = l.source_line_id and e.kind = 'issue';
    select coalesce(sum(e.qty_delta), 0), coalesce(sum(e.value_delta), 0) into v_ret, v_ret_val
      from public.stock_ledger e where e.source_line_id = l.source_line_id and e.kind = 'return';
    if v_ret + l.quantity > v_issued then
      raise exception 'STK_RETURN_EXCEEDS: issued %, already returned %, requested %', trim_scale(v_issued)::text, trim_scale(v_ret)::text, trim_scale(l.quantity)::text
        using errcode = 'P0001'; end if;
    -- The cost the issue line left at; the last return takes the remainder so cumulative returned value never differs from issued value.
    v_in := case when v_ret + l.quantity = v_issued then v_issued_val - v_ret_val
                 else round(l.quantity * v_issued_val / v_issued, 2) end;                                -- mut:returncost
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, v_in, l.s_project, l.s_boq, l.source_line_id);
  end loop;
end $$;
revoke all on function public.stock_apply_issue(public.stock_documents, boolean), public.stock_apply_return(public.stock_documents, boolean)
  from public, anon, authenticated;
```
Note on why the project is read from the **source**, not `p_doc.project_id`: `stock_post_core` passes the row it read before apply ran, so for a Return `p_doc.project_id` can still be null on that copy; the ledger and the cap use the cited issue's project and work item. The header column is set for display and for the `status = 'Posted'` shape check (a Posted return must have a project).
Run (expect PASS): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_out_flows.test.sql supabase/tests/stock_valuation.test.sql supabase/tests/stock_posting_guards.test.sql supabase/tests/stock_tenant_isolation.test.sql'`.

### Task S2b.3 - whole-sequence invariant (AC-STK-004)
Create `supabase/tests/stock_ledger_invariant.test.sql` (F1 + helpers). A mixed sequence as Admin / keepers: receive 100 @ 50 (CEN), receive 40 @ 55 (CEN), transfer 30 CEN -> A, issue 20 from A to `P_ON`, return 5 of them to B, transfer 10 A -> B, receive 7.5 cable (fractional) @ 12.3456, issue 7.5 cable, a refused over-draw in the middle (must leave no trace). Then:
```sql
select plan(5);
select is((select count(*)::int from (
  select coalesce(s.item_id, b.item_id) i, coalesce(s.warehouse_id, b.warehouse_id) w
    from (select item_id, warehouse_id, sum(qty_delta) q, sum(value_delta) v from public.stock_ledger group by 1, 2) s
    full join public.stock_balances b on b.item_id = s.item_id and b.warehouse_id = s.warehouse_id
   where coalesce(s.q, 0) <> coalesce(b.qty_on_hand, 0) or coalesce(s.v, 0) <> coalesce(b.value_on_hand, 0)) bad), 0,
  'AC-STK-004 for every item and warehouse the ledger sums equal the balance row (quantity and value)');
select is((select count(*)::int from (
  select qty_after - sum(qty_delta) over (partition by item_id, warehouse_id order by seq) dq,
         value_after - sum(value_delta) over (partition by item_id, warehouse_id order by seq) dv from public.stock_ledger) x
  where dq <> 0 or dv <> 0), 0, 'AC-STK-004 every entry''s running balance equals the cumulative sum up to it');
select is((select count(*)::int from public.stock_balances where qty_on_hand < 0 or value_on_hand < 0), 0, 'AC-STK-004 no balance is negative');
select is((select count(*)::int from public.stock_ledger where qty_delta < 0 and value_delta > 0 or qty_delta > 0 and value_delta < 0), 0, 'AC-STK-004 quantity and value move the same way');
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'transfer'), '0.00', 'FR-STK-032 transfers conserve value across the whole sequence');
select * from finish();
rollback;
```
(The last assertion is FR-STK-032's proof; its description begins `FR-STK-032`, because AC-STK-032 is the UI-states AC.) S4.9 appends adjustment and count steps to this sequence and re-runs the same four assertions.

### Task S2b.4 - rollback file
`supabase/migrations/rollback/0413_stock_out_flows_down.sql` restores the two stubs verbatim from S2a.5 (`create or replace function ... raise exception 'STK_KIND_UNAVAILABLE: ...'`) plus their `revoke`. Verify it parses as in S1.4.

### Task S2b.5 - mutation cases (money gate)
Append to `CASES` in `scripts/stock-mutation-proof.mjs` and run each (`scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/stock-mutation-proof.mjs projactive boq cap returncost lockorder'`):
```js
  { id: 'projactive', fn: 'public.stock_apply_issue(public.stock_documents,boolean)',  from: /(v_active := )[^;]+(;\s*-- mut:projactive)/, to: '$1true$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'boq',        fn: 'public.stock_apply_issue(public.stock_documents,boolean)',  from: /(v_boq_ok := )[\s\S]*?(;\s*-- mut:boq)/,      to: '$1true$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'cap',        fn: 'public.stock_apply_return(public.stock_documents,boolean)', from: /(v_cap_ok := )[^;]+(;\s*-- mut:cap)/,         to: '$1true$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'returncost', fn: 'public.stock_apply_return(public.stock_documents,boolean)', from: /(round\(l\.quantity \* v_issued_val \/ v_issued, 2\))(\s*end;\s*-- mut:returncost)/, to: '$1 + 1$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'lockorder',  fn: 'public.stock_lock_for_document(public.stock_documents)',    from: /(order by l\.item_id, w\.wid)(\s*-- mut:lockorder)/, to: '$1 desc$2', cmd: ['node', 'pmo-portal/src/lib/db/stockPosting.concurrent.integration.mjs'] },
```
Each must print `red: true, green: true`. Put the table in the PR body.

### Task S2b.6 - concurrency proof script (NFR-STK-002; D3)
Create `pmo-portal/src/lib/db/stockPosting.concurrent.integration.mjs` **(new)**, same skeleton as `vendorWithholdingSlips.concurrent.integration.mjs` (`run`, `session`, `role`, own org / users / items / warehouses with `randomUUID()`, `finally` cleanup of its **own rows only - stock rows cannot be deleted, so it uses a fresh throwaway organisation and leaves it**, and a control count of the seed org before and after). Five scenarios; the script exits non-zero on any failed assertion:
1. **Oversell.** 10 on hand. Session A: `begin; <as keeper> select create_stock_document(<issue 6>, ..., true); select pg_sleep(1.5); commit;`. 150 ms later session B runs the same issue. Poll `pg_stat_activity` until B is `wait_event_type = 'Lock'`. Require: A exits 0, B's stderr contains `STK_INSUFFICIENT`, final balance is 4, exactly one issue document is `Posted`.
2. **Lock order, forward.** Session S1 `begin; select 1 from stock_balances where item_id=:i and warehouse_id=:B for update; select pg_sleep(3); commit;`. Session S2 posts a transfer A -> B (A < B by uuid; create the fixtures so it holds) and blocks. A third session runs `select 1 from stock_balances where item_id=:i and warehouse_id=:A for update nowait` and **must fail with `could not obtain lock`**: S2 already holds A while waiting for B, i.e. it locks in ascending order.
3. **Lock order, reverse.** Session S1 holds `:A`. S2 posts a transfer B -> A (source B, destination A) and blocks on `:A`. The third session's `nowait` on `:B` **must succeed**: S2 locked by ascending key, not source-first.
4. **Opposing transfers.** 100 rounds; each round starts A -> B and B -> A together (`Promise.all` of two `session()` calls, each `begin; create_stock_document(...,true); commit;`). Require no stderr contains `deadlock detected` and both balances reconcile to the ledger.
5. **Idempotent race (AC-STK-012, unique-index path).** Two sessions call `create_stock_document(<receive 5>, ..., true, '<one fixed client_request_id>')` at the same instant (A holds its transaction open with `pg_sleep(1)` so B reaches the `INSERT ... ON CONFLICT` while A's row is uncommitted). Require both calls return the **same** document id, exactly one `stock_documents` row and one `stock_ledger` row exist, and the balance moved once.
Run: `scripts/with-db-lock.sh node pmo-portal/src/lib/db/stockPosting.concurrent.integration.mjs` -> exit 0. This script is a builder-run gate (the existing `*.concurrent.integration.mjs` precedent is also not in CI); paste its output in the PR. The `lockorder` mutation above proves scenarios 2 and 3 are not vacuous.

### Task S2b.7 - gate
Local final gate: `npm run check:guards`; `node --test scripts/stock-single-writer.test.mjs scripts/stock-mutation-proof.test.mjs`; the DB chain for `stock_*.test.sql` + `0178_...`; mutation table (all S1, S2a, S2b cases); concurrency output. Reviewers: spec, quality, security-auditor; Director + Terra/Sol review (money). Push `feat/stock-s2b-out-flows`; report.

---

# Slice S3 - Read RPCs and movement screens (`0414_stock_read_rpcs.sql`)

Builds: `get_stock_on_hand`, `get_stock_ledger` (keyset); the stock DAL, repository and hooks; `can()` rows for documents; the Stock pages (on hand, documents, document detail, ledger trace, phone-first Receive / Transfer / Issue / Return forms, Setup entry), the project **Materials** tab shell, nav, i18n; both curated E2E journeys. Owns: AC-STK-001 (E2E), 020 (on hand and trace; S5 appends consumption), 028, 030, 031 (E2E), 032; appends AC-STK-033 rows and AC-STK-019 for the read RPCs. FRs: 040, 041, 044, 045, 063, 064, NFR-STK-003/004/005/007. Blocked by S2b. Executor: Terra for the RPC task (S3.1-S3.4); a UI-capable worker for the rest.

### Task S3.1 - failing pgTAP: cost visibility, paging, filters (AC-STK-020, 028)
Create `supabase/tests/stock_read_rpcs.test.sql` (prelude F1 + `stk_t_rcv`). Setup as Admin: receive 100 cable @ 50 at CEN, transfer 30 to SITE-A, receive 10 bags @ 20 at SITE-A.
```sql
select plan(12);
-- AC-STK-020: below Project Manager, quantities only; PM and above also see cost
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                    -- U_ENG (rank 10)
select is((public.get_stock_on_hand() -> 0) ? 'qty_on_hand', true, 'AC-STK-020 an Engineer sees quantities on hand');
select is(jsonb_path_exists(public.get_stock_on_hand(), '$[*] ? (exists(@.value_on_hand) || exists(@.avg_cost))'), false,
  'AC-STK-020 an Engineer''s on-hand response carries no value or average-cost key');
select is(jsonb_path_exists(public.get_stock_ledger(p_limit => 50) -> 'rows', '$[*] ? (exists(@.value_delta) || exists(@.value_after))'), false,
  'AC-STK-020 an Engineer''s trace carries no value key');
select throws_ok($$ select * from public.stock_ledger $$, '42501', null, 'AC-STK-020 the ledger is not directly readable');
select throws_ok($$ select unit_cost from public.stock_document_lines $$, '42501', null, 'AC-STK-020 line unit cost is not directly readable');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                    -- U_PM (rank 20)
select is(jsonb_path_exists(public.get_stock_on_hand(), '$[*] ? (exists(@.value_on_hand) && exists(@.avg_cost))'), true, 'AC-STK-020 a Project Manager also sees value and average cost');
select is(jsonb_path_exists(public.get_stock_ledger(p_limit => 50) -> 'rows', '$[*] ? (exists(@.value_delta) && exists(@.value_after))'), true, 'AC-STK-020 a Project Manager''s trace carries value');
-- FR-STK-040 / 041 filters
select is(jsonb_array_length(public.get_stock_on_hand(p_warehouse_id => '15120000-0000-0000-0000-000000002002')), 2, 'FR-STK-040 on hand filters by warehouse (SITE-A holds cable and bags)');
select is(jsonb_array_length(public.get_stock_ledger(p_document_id => (select id from stock_documents where kind = 'receive' order by number limit 1)) -> 'rows'), 1, 'FR-STK-041 the trace filters by document');
-- AC-STK-028: more than 1000 ledger rows for one project page out exactly once with a correct running balance
reset role;
insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, boq_item_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
select e.org_id, e.document_id, e.line_id, e.item_id, e.warehouse_id, '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-0000000000e1', 'issue',
       -0.001, -0.00, 1000 - g * 0.001, 0, current_date, e.posted_by
  from (select * from public.stock_ledger order by seq limit 1) e, generate_series(1, 1200) g;     -- direct insert: a test fixture, not a writer under test
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
do $$
declare v_page jsonb; v_cursor bigint := null; v_all jsonb := '[]'::jsonb;
begin
  loop
    v_page := public.get_stock_ledger(p_project_id => '15120000-0000-0000-0000-0000000000c1', p_before_seq => v_cursor, p_limit => 200);
    v_all := v_all || (v_page->'rows');
    v_cursor := (v_page->>'next_before_seq')::bigint;
    exit when v_cursor is null;
  end loop;
  perform set_config('stk.all', v_all::text, false);           -- carried out of the role switch as a GUC; no temp table needed
end $$;
reset role;
select is((select jsonb_array_length(current_setting('stk.all')::jsonb)), 1200, 'AC-STK-028 all 1,200 rows came back');
select is((select count(distinct r->>'seq')::int from jsonb_array_elements(current_setting('stk.all')::jsonb) r), 1200,
  'AC-STK-028 every row appears exactly once (no gap, no repeat at a page boundary)');
select is((select count(*)::int from jsonb_array_elements(current_setting('stk.all')::jsonb) r
            join public.stock_ledger l on l.seq = (r->>'seq')::bigint
           where trim_scale(l.qty_after)::text <> r->>'qty_after'), 0,
  'AC-STK-028 each row''s running balance is the stored balance after it');
select * from finish();
rollback;
```
Also add one assertion that `get_stock_on_hand` raises `STK_TOO_MANY%` when the caller's org has more than 5,000 matching rows (as superuser insert 5,001 items and zero-plus balances with `generate_series`, then call it as the PM), making the plan 13. Set `plan(N)` to the final count.
Run (expect FAIL: function does not exist): `scripts/with-db-lock.sh supabase test db supabase/tests/stock_read_rpcs.test.sql`

### Task S3.2 - migration 0414
Create `supabase/migrations/0414_stock_read_rpcs.sql` (header as 0411; rollback `0414_stock_read_rpcs_down.sql` drops both functions):
```sql
-- Read RPCs (D5, D8). Definer: ledger and balances have no client grant. Cost keys are OMITTED below rank 20 (AC-STK-020).
-- Numerics are returned as text so the client never turns money or quantity into a JS float (NFR-STK-007).
create or replace function public.get_stock_on_hand(p_warehouse_id uuid default null, p_item_id uuid default null, p_include_zero boolean default false)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_n integer; v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:cost
  select count(*) into v_n from public.stock_balances b
   where b.org_id = v_org and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
     and (b.qty_on_hand > 0 or coalesce(p_include_zero, false));
  if v_n > 5000 then raise exception 'STK_TOO_MANY: narrow the filter (more than 5000 rows)' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code, 'whole_only', u.whole_only,
                              'warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name, 'warehouse_kind', w.kind,
                              'qty_on_hand', trim_scale(b.qty_on_hand)::text)
           || case when v_cost then jsonb_build_object('value_on_hand', b.value_on_hand::text,
                                                       'avg_cost', case when b.qty_on_hand > 0 then round(b.value_on_hand / b.qty_on_hand, 4)::text end)
                   else '{}'::jsonb end
           order by w.code, i.code), '[]'::jsonb)
    into v_rows
    from public.stock_balances b
    join public.stock_items i on i.id = b.item_id join public.stock_units u on u.id = i.unit_id join public.stock_warehouses w on w.id = b.warehouse_id
   where b.org_id = v_org and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
     and (b.qty_on_hand > 0 or coalesce(p_include_zero, false));
  return v_rows;
end $$;

create or replace function public.get_stock_ledger(
  p_item_id uuid default null, p_warehouse_id uuid default null, p_project_id uuid default null, p_boq_item_id uuid default null,
  p_document_id uuid default null, p_from date default null, p_to date default null, p_before_seq bigint default null, p_limit integer default 100)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_rows jsonb; v_n integer; v_min bigint;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:cost_ledger
  with page as (
    select l.* from public.stock_ledger l
     where l.org_id = v_org
       and (p_item_id is null or l.item_id = p_item_id) and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
       and (p_project_id is null or l.project_id = p_project_id) and (p_boq_item_id is null or l.boq_item_id = p_boq_item_id)
       and (p_document_id is null or l.document_id = p_document_id)
       and (p_from is null or l.occurred_on >= p_from) and (p_to is null or l.occurred_on <= p_to)
       and (p_before_seq is null or l.seq < p_before_seq)
     order by l.seq desc limit v_limit)
  select coalesce(jsonb_agg(
           jsonb_build_object('seq', g.seq, 'id', g.id, 'document_id', g.document_id, 'document_number', d.number, 'document_status', d.status,
                              'kind', g.kind, 'posted_at', g.posted_at, 'occurred_on', g.occurred_on, 'posted_by', g.posted_by, 'actor_name', pr.full_name,
                              'item_id', g.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'warehouse_id', g.warehouse_id, 'warehouse_code', w.code,
                              'project_id', g.project_id, 'project_name', p.name, 'boq_item_id', g.boq_item_id, 'boq_item_code', b.item_code,
                              'qty_delta', trim_scale(g.qty_delta)::text, 'qty_after', trim_scale(g.qty_after)::text)
           || case when v_cost then jsonb_build_object('value_delta', g.value_delta::text, 'value_after', g.value_after::text) else '{}'::jsonb end
           order by g.seq desc), '[]'::jsonb),
         count(*), min(g.seq)
    into v_rows, v_n, v_min
    from page g
    join public.stock_documents d on d.id = g.document_id
    join public.stock_items i on i.id = g.item_id join public.stock_units u on u.id = i.unit_id
    join public.stock_warehouses w on w.id = g.warehouse_id
    left join public.profiles pr on pr.id = g.posted_by
    left join public.projects p on p.id = g.project_id
    left join public.boq_items b on b.id = g.boq_item_id;
  return jsonb_build_object('rows', v_rows, 'next_before_seq', case when v_n = v_limit then v_min end);
end $$;
revoke all on function public.get_stock_on_hand(uuid, uuid, boolean), public.get_stock_ledger(uuid, uuid, uuid, uuid, uuid, date, date, bigint, integer) from public, anon;
grant execute on function public.get_stock_on_hand(uuid, uuid, boolean), public.get_stock_ledger(uuid, uuid, uuid, uuid, uuid, date, date, bigint, integer) to authenticated;
```
`v_cost` is `public.stock_can_see_cost()`; the harness mutation is `v_cost := true`. Both functions are read-only (no insert / update / delete), so the 0178 sweep does not list them; they still need the explicit `revoke ... from public, anon`.
Run (expect PASS): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_read_rpcs.test.sql'`.

### Task S3.3 - mutation + isolation + types
1. `CASES` append: `{ id: 'cost', fn: 'public.get_stock_on_hand(uuid,uuid,boolean)', from: /(v_cost := )[^;]+(;\s*-- mut:cost)/, to: '$1true$2', test: 'supabase/tests/stock_read_rpcs.test.sql' }` and `cost_ledger` for `get_stock_ledger(uuid,uuid,uuid,uuid,uuid,date,date,bigint,integer)`. Run both: `red: true, green: true`.
2. `stock_tenant_isolation.test.sql` (marker `-- S3:`): org B's `get_stock_on_hand()` and `get_stock_ledger()` return only org B rows (`'[]'` and `[]` for an org that has none); `get_stock_ledger(p_document_id => <org A doc>)` as org B returns no rows. Bump `plan()`.
3. Regenerate types (`stock_documents`, lines, etc. already appeared in S2a; RPC signatures are new).

### Task S3.4 - DAL (TDD)
Test first `pmo-portal/src/lib/db/stockDocuments.test.ts` and `stockReports.test.ts` (mock `@/src/lib/supabase/client`):
```ts
it('FR-STK-015 create sends one stable client_request_id and returns the document id', async () => {
  h.rpcResult = { data: 'doc-1', error: null };
  const id = await createStockDocument({ kind: 'issue', warehouseId: 'w1', projectId: 'p1', lines: [{ itemId: 'i1', quantity: '5', boqItemId: 'b1' }] }, { post: true, clientRequestId: 'req-1' });
  expect(id).toBe('doc-1');
  expect(h.rpc).toHaveBeenCalledWith('create_stock_document', {
    p_header: { kind: 'issue', warehouse_id: 'w1', project_id: 'p1' },
    p_lines: [{ item_id: 'i1', quantity: '5', boq_item_id: 'b1' }], p_post: true, p_client_request_id: 'req-1' });
});
it('NFR-STK-007 quantities travel as strings, never numbers', () => { /* a numeric quantity input is rejected by the type; runtime: JSON body has typeof quantity === "string" */ });
it('FR-STK-041 the trace follows next_before_seq until null and returns every page once', async () => { /* 3 pages of 200 + a short page */ });
it('lists documents without selecting unit_cost (a column-level grant makes select * fail)', async () => { /* the select() argument contains no "*" and no "unit_cost" */ });
it('a failed report RPC throws; it never resolves to an empty array (FR-STK-044)', async () => { h.rpcResult = { data: null, error: { message: 'boom', code: '500' } }; await expect(getStockOnHand({})).rejects.toBeInstanceOf(AppError); });
```
Implement `pmo-portal/src/lib/db/stockDocuments.ts` **(new)**: types `StockDocumentKind`, `StockDocumentRow` (Tables), `StockLineInput { itemId: string; quantity?: string; unitCost?: string; boqItemId?: string; sourceLineId?: string; countedQuantity?: string; direction?: 'in' | 'out' }`, `StockDocumentInput { kind; warehouseId; toWarehouseId?; projectId?; procurementId?; reason?; note?; occurredOn?; lines }`; `createStockDocument(input, { post, clientRequestId })` (maps camel -> snake, omits undefined keys, always sends `p_client_request_id`), `saveStockDraft`, `postStockDocument`, `cancelStockDocument`, `listStockDocuments({ kind?, status?, warehouseId?, projectId?, limit = 50, before?: { createdAt: string; id: string } })` (keyset on `(created_at, id)` desc via `.or(...)`; `limit` clamped to 100), `getStockDocument(id)` (header + lines with an explicit column list `id, line_no, item_id, quantity, counted_quantity, expected_quantity, direction, boq_item_id, source_line_id, item:stock_items(code,name,unit:stock_units(code,whole_only))`), `listIssuableWorkItems(projectId)` (`boq_items` columns `id, line_no, item_code, description, unit` only - **never `rate`**, an Engineer storekeeper must not receive prices through this picker). Implement `pmo-portal/src/lib/db/stockReports.ts` **(new)**: `getStockOnHand({ warehouseId?, itemId?, includeZero? })`, `getStockLedgerPage(filters & { beforeSeq?, limit? })`, `getStockLedgerAll(filters, { maxPages = 25 })` (follows the cursor; throws `STK_TOO_MANY` at the page cap instead of truncating). Row types: `StockOnHandRow { itemId; itemCode; itemName; unitCode; wholeOnly; warehouseId; warehouseCode; warehouseName; qtyOnHand: string; valueOnHand?: string; avgCost?: string }` etc. Run `npx vitest run src/lib/db/stockDocuments.test.ts src/lib/db/stockReports.test.ts` -> PASS.

### Task S3.5 - repository, hooks, policy rows
- `types.ts`: extend `StockRepository` with `documents` (`list/get/create/saveDraft/post/cancel/issuableWorkItems`) and `reports` (`onHand/ledgerPage/ledgerAll`); `index.ts`: wire through `wrap`.
- `pmo-portal/src/hooks/useStock.ts`: `useStockOnHand(filters)`, `useStockLedger(filters)` (infinite query on `next_before_seq`), `useStockDocuments(filters)`, `useStockDocument(id)`, `useIssuableWorkItems(projectId)`, `useStockDocumentMutations()` (create / post / cancel; **every mutation invalidates** `['stock-on-hand']`, `['stock-ledger']`, `['stock-documents']`, `['stock-document']` and, for issue / return, the project's consumption key `['stock-consumption', orgId, projectId]` that S5 defines). Keys carry `orgId`.
- Policy (`pmo-portal/src/auth/policy.ts`): add `'stockDocument'` to `Entity` and `'post'` to `Action`. Matrix (UX only; mirrors FR-STK-061/062):
```ts
  stockDocument: {
    view: allow(ALL),
    create: (role, ctx) => ctx.record?.viewOnly !== true && (ctx.record?.isKeeper === true || role === 'Admin'),
    post: (role, ctx) => ctx.record?.viewOnly !== true && (
      ctx.record?.kind === 'adjustment' || ctx.record?.kind === 'count'
        ? has(MASTER_DATA, role) && !!ctx.currentUserId && ctx.record?.created_by !== ctx.currentUserId   // FR-STK-062 (a zero-variance count by its author is the server's call)
        : ctx.record?.isKeeper === true || role === 'Admin'),
    withdraw: (role, ctx) => ctx.record?.status === 'Draft' && (ctx.record?.created_by === ctx.currentUserId || role === 'Admin'),
  },
```
(`withdraw` is the cancel affordance; reuse the existing action name.) Append to `src/auth/policy.stock.test.ts` (AC-STK-033): for each of the five roles x {keeper, non-keeper} x {receive, issue} x real-vs-impersonated (`viewOnly: true` denies everything), and adjustment / count x {author, other user} x role. The `isKeeper` flag is supplied by the screen from `useStockKeepers()` (`stock_warehouse_keepers` is readable). Run `npx vitest run src/auth/policy.stock.test.ts`.

### Task S3.6 - formatting and shared pieces (TDD)
- `pmo-portal/src/lib/stockFormat.ts` **(new)** with a test: `formatQuantity(value: string, locale)` (exact for 14,3 decimals via `Intl.NumberFormat(...).format(value)` - decimal strings are formatted exactly by modern engines; the test asserts `'1234567890.123'` keeps every digit in `en` and `id`), `formatStockValue(value, currency, locale)` delegating to `formatExactMoney` in `src/lib/format.ts`, `isWholeQuantity(value: string)` (string test, no float). A grep guard in the same test file: `expect(readFileSync('src/lib/db/stockReports.ts','utf8')).not.toMatch(/parseFloat|Number\(/)` (NFR-STK-007).
- `pmo-portal/src/components/stock/ItemPicker.tsx` **(new)**: wraps `Combobox`; options from `useStockItems()`, `label = code - name`, search matches **code or name** case-insensitively (test: typing `cem` finds `CEM-50 - Cement 50kg` and typing `cement` finds it); archived items absent.
- `pmo-portal/src/components/stock/StockError.tsx` **(new)**: renders `parseStockError(err)` with copy from the `stock` namespace (`stock.errors.STK_INSUFFICIENT` interpolating `available` / `requested` from `numbers`), else `classifyMutationError(err)`; `role="alert"`; the shortfall sits next to the quantity field via `FieldError` when `code === 'STK_INSUFFICIENT'` (AC-STK-030).
- `QuantityField` (inside the form file): `inputMode="decimal"`, `step` = `1` for a whole-only unit else `0.001`, rejects a fraction for whole-only units client-side (the server is still the authority, `STK_FRACTION`).

### Task S3.7 - movement forms: Receive, Transfer, Issue, Return (AC-STK-030, 032)
Test first `pmo-portal/pages/stock/StockMovementForm.test.tsx` **(new)** (RTL + `jest-axe`; mock `@/src/lib/repositories`). Titles lead with the AC id:
```tsx
it('AC-STK-030 every field has a label, the item picker finds by code or name, and axe reports no violation', async () => { /* render /stock/new/issue; getByLabelText for Warehouse, Project, Work item, Item, Quantity; type "cem"; expect no axe violations */ });
it('AC-STK-030 a shortfall error is announced beside the quantity', async () => {
  create.mockRejectedValue({ code: 'P0001', message: 'STK_INSUFFICIENT: item CEM at SITE-A: available 5, requested 6', details: '{"available":"5","requested":"6"}' });
  /* fill, submit */ expect(await screen.findByRole('alert')).toHaveTextContent(/5.*6/); expect(quantityInput).toHaveAccessibleDescription(/5/);
});
it('AC-STK-030 a keyboard-only user completes an issue', async () => { /* userEvent.tab / keyboard only; create called once with post:true and a client_request_id */ });
it('FR-STK-015 a failed submit and a retry send the SAME client_request_id; a successful submit mints a new one', async () => { /* two calls, same id; after success, form reset, next submit differs */ });
it('AC-STK-032 loading, empty (no warehouse you keep), error, populated', async () => { /* each state; the error state shows a retry, never a zero */ });
it('FR-STK-064 a user who does not keep the warehouse and is not Admin sees no submit', () => { /* can('create','stockDocument',{record:{isKeeper:false}}) */ });
```
Implement `pmo-portal/pages/stock/StockMovementForm.tsx` **(new)** at `/stock/new/:kind` (kind in `receive|transfer|issue|return`; S4 adds `adjustment|count` to the same page). Single column, no modal (phone-first); sections: **Warehouse** (only warehouses the user keeps, Admin: all), **To warehouse** (transfer), **Project** and **Work item** (issue; work items from `useIssuableWorkItems(projectId)`; project list = Ongoing projects from `repositories.project` list), **Cite the issue** (return: pick from the project's recent issue lines, shows item, quantity, work item), **Lines** (ItemPicker + QuantityField [+ Unit cost on receive, label "Unit cost (you will not see it again)" when `!can-see-cost`]), `occurred_on` (default today, `max=today`), note. The client request id is `useRef(crypto.randomUUID())`, replaced only after success. Submit = `createStockDocument(..., { post: true, clientRequestId })`, toast with the document number, navigate to `/stock/documents/:id`. Reference slice for primitives: `pages/Companies.tsx` + `src/components/ui/FormFields.tsx` (`TextField`, `SelectField`, `FormGrid`, `FieldError`) and `src/components/ui/MobileActionBar.tsx` for the sticky submit. Run `npx vitest run pages/stock/StockMovementForm.test.tsx` -> PASS.

### Task S3.8 - on hand, documents, document detail, ledger trace pages
One test file per page next to it (`StockOnHand.test.tsx`, `StockDocuments.test.tsx`, `StockDocumentDetail.test.tsx`, `StockLedger.test.tsx`), each asserting AC-STK-032's states (loading, empty, error-with-retry, populated, archived) and: on-hand hides value columns when the response has no `value_on_hand` key (not by role - by the data, so a mismatch cannot show a fabricated 0); a "Below reorder level" toggle is rendered but disabled with a hint until S6 (no dead control); the ledger page loads more with an explicit "Load more" and shows running balance; detail shows lines and the entries (`getStockLedgerAll({ documentId })`), with a "Cancel draft" action only when `can('withdraw','stockDocument')`. Pages (all **new**): `pages/stock/StockOnHand.tsx` (`/stock`), `StockDocuments.tsx` (`/stock/documents`), `StockDocumentDetail.tsx` (`/stock/documents/:documentId`), `StockLedger.tsx` (`/stock/ledger`). Tabs strip shared across `/stock*`: On hand | Documents | Ledger | Setup (Setup only for `can('create','stockItem')`). Use the list-page primitives the Companies slice uses (`ListPage`, `ListState`, `PageHeader`, `ErrBanner` under `src/components/ui/`).

### Task S3.9 - project Materials tab shell
- `pages/project-detail/projectDetailAreas.ts`: add `'materials'` to `Area` and `AREAS` (after `'contract'`); `areaFromParam` needs no change. Update the existing test that pins the area list (`grep -rn "AREAS" pages/project-detail --include='*.test.*'`).
- `pages/project-detail/ProjectSections.tsx`: `useAreaLabels` gets `materials: t('projectTabs:materials', 'Materials')`; `AreaContent` renders `<MaterialsTab project={project} />`; `useVisibleAreas` hides it for pipeline (non-delivery) records like the other delivery areas.
- `pages/project-detail/tabs/MaterialsTab.tsx` **(new)**: S3 content = an "Issue material" button (`can('create','stockDocument', { record: { isKeeper } })`, links to `/stock/new/issue?project=<id>`) and the trace for this project (`StockLedger` embedded with `projectId`). S5 adds the consumption report above it. Add `materials` to `public/locales/{en,id}/projectTabs.json`.
Test: `pages/project-detail/tabs/MaterialsTab.test.tsx` (button visibility by role; the embedded trace requests `projectId`).

### Task S3.10 - routes, nav, breadcrumbs, i18n
- `App.tsx`: lazy imports and routes `/stock`, `/stock/documents`, `/stock/documents/:documentId`, `/stock/ledger`, `/stock/new/:kind` (static `/stock/setup` from S1 already first).
- `src/components/shell/Rail.tsx`: `{ to: '/stock', text: 'Stock', icon: <existing IconName>, group: 'Delivery', roles: [all five] }` (PQ-8) and the localised label (`t('shell.nav.stock', 'Stock')`); `routeMatch.ts`: a `stock` module entry with `labelKey: 'shell.nav.stock'`, `path: '/stock'`, `detail: { pattern: '/stock/documents/:documentId', param: 'documentId' }`. Update the route / Rail tests that enumerate entries.
- `public/locales/{en,id}/stock.json`: all remaining keys (kinds, field labels, table headings, states, errors); `shell.nav.stock` in `common.json` is the one allowed `common` key (nav lives there). Run `npm run check:i18n`.

### Task S3.11 - E2E AC-STK-001 (the issue's acceptance journey)
`pmo-portal/e2e/AC-STK-001-issue-to-project-work-item.spec.ts` **(new)**; line 1 `// @e2e-isolation: self-isolated - creates its own uniquely-named item, warehouse, project work item and stock; the append-only ledger cannot be cleaned (PQ-10), so every code carries a per-run suffix.` Journey: Given (fixtures via the **admin user's own JWT**, because a service-role call has no `auth.uid()` and the RPCs refuse it): sign in as `admin@acme.test` with the seed password through `@supabase/supabase-js` (`import { SEED_PASSWORD } from './helpers'`), create an item and a warehouse (RLS inserts), assign the seeded Engineer as keeper (`set_stock_warehouse_keeper`), receive 100 bags there (`create_stock_document` with `post=true`), and insert one `boq_items` line on a seeded Ongoing project (a unique `item_code`). When: sign in as `engineer@acme.test` through the UI (`signIn`), open `/stock/new/issue`, choose the warehouse, the project, the work item, the item, quantity 30, submit. Then the three oracles of AC-STK-001, **in the UI** (the goal, not the plumbing): (1) `/stock` shows 70 for that item at that warehouse; (2) `/stock/ledger?item=<id>` lists the issue with the actor's name, a time, the project and the work item; (3) the project's Materials tab shows the issue (S5 adds the consumption-vs-allowance assertion to this same spec). Assertion text names the goal ("the warehouse shows 70"), never a CSS class. Run: `scripts/e2e-local.sh --reset AC-STK-001` (reset because the seed changed).

### Task S3.12 - E2E AC-STK-031 (the second curated journey)
`pmo-portal/e2e/AC-STK-031-site-storekeeper-chain.spec.ts` **(new)**, `self-isolated` as above. Fixtures as S3.11 (a central and a site warehouse, an item, a BoQ line; the Engineer keeps the **site**; a PM exists in the seed). Journey: the Engineer is **refused** receiving at central (the form lists only warehouses they keep, and a forced API call returns `STK_NOT_KEEPER`; assert the UI, then the RPC code via the admin-JWT client calling as the Engineer's JWT); Admin receives 50 at central (UI); Admin transfers 20 central -> site (UI); the Engineer issues 8 from the site to the work item (UI); the **PM** then sees the full chain - receipt, transfer, issue - on the ledger trace for the item and the issue on the project Materials tab; an Engineer who keeps no warehouse sees no "New issue" action. Run `scripts/e2e-local.sh AC-STK-031`.

### Task S3.13 - gate
`cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 pages/stock src/components/stock src/lib/db/stock*.ts src/lib/stock*.ts src/hooks/useStock.ts src/auth/policy.ts pages/project-detail && npx vitest run <every stock test file touched>`; DB chain for `stock_read_rpcs` + `stock_tenant_isolation` + `0178`; `node scripts/stock-mutation-proof.mjs cost cost_ledger` under the lock; `UX_PROOF_WIDTHS=360,1440 scripts/ux-proof.sh /stock /stock/documents /stock/ledger /stock/new/issue /stock/new/receive /stock/setup`; both E2E specs; the three reviewers; one rendered Discover pass by `design-reviewer` on rich seed (every state, 360 px); each finding graduates to a test and a `routes x oracles` cell (ADR-0030). Push `feat/stock-s3-screens`; report.

---

# Slice S4 - Adjustment and count (`0415_stock_adjust_count.sql`)

Builds: real `stock_apply_adjustment` and `stock_apply_count`, the two-person write-off rule, the counted-vs-system UI, Draft save / post screens, the SoD mutation checks. It replaces **only** those two stubs. **Money / SoD tier: Terra or Sol; ships alone.** Owns: AC-STK-014, 015; completes AC-STK-004 (appends adjustment and count to the S2b sequence) and appends to AC-STK-019 / 033. FRs: 024, 025, 062, 066 (override audit already in S2a). Blocked by S2a (UI after S3's shared components; the DB half can start as soon as S2a merges and runs parallel to S3).

### Task S4.1 - failing pgTAP (AC-STK-014, 015, FR-STK-024)
Create `supabase/tests/stock_adjust_count.test.sql` (prelude F1 + `stk_t_rcv`). Setup: Admin receives 100 cable @ 60 at SITE-A (value 6,000).
```sql
select plan(13);
create function public.stk_t_count(p_wh uuid, p_item uuid, p_counted numeric, p_cost numeric default null, p_post boolean default false) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','count','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'counted_quantity',p_counted,'unit_cost',p_cost)), p_post) $$;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                                                              -- Admin
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100, 60);
-- a Draft count of 92 against 100 on hand (variance -8), authored by the Admin
select set_config('stk.cnt', public.stk_t_count('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 92)::text, false);
select throws_like($$ select public.post_stock_document(current_setting('stk.cnt')::uuid) $$, 'STK_SELF_APPROVE%',
  'AC-STK-014 the author - even an Admin - cannot post a count with a variance');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                                              -- U_K1: Engineer, rank 10, not the author
select throws_like($$ select public.post_stock_document(current_setting('stk.cnt')::uuid) $$, 'STK_RANK%',
  'AC-STK-014 a different user below Project Manager is refused');
reset role;
select is((select count(*)::int from public.stock_ledger where kind = 'count'), 0, 'AC-STK-014 the two refusals wrote nothing');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                                              -- U_PM, not the author
select lives_ok($$ select public.post_stock_document(current_setting('stk.cnt')::uuid) $$, 'AC-STK-014 a different Project Manager posts it');
reset role;
select is((select qty_delta::text || '/' || value_delta::text from public.stock_ledger where kind = 'count' and document_id = current_setting('stk.cnt')::uuid),
  '-8.000/-480.00', 'AC-STK-014 one adjustment entry equals the variance, out at the moving average (8 x 60)');
select is((select expected_quantity::text from public.stock_document_lines where document_id = current_setting('stk.cnt')::uuid), '100.000',
  'AC-STK-014 the system quantity at post time is stamped on the line');
-- AC-STK-015: a count with no variance may be posted by its author and writes nothing (92 counted, 92 now on hand)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.stk_t_count('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 92, null, true) $$, 'AC-STK-015 the author posts a zero-variance count');
reset role;
select is((select count(*)::int from public.stock_ledger where kind = 'count'), 1, 'AC-STK-015 it wrote no ledger entry (only the earlier 8-unit write-off exists)');
select is((select status from public.stock_documents where kind = 'count' order by number desc limit 1), 'Posted', 'AC-STK-015 and the document is Posted');
-- a count that finds stock where the system holds none needs a unit cost (SITE-B holds no cable)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select set_config('stk.cnt2', public.stk_t_count('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5)::text, false);                      -- Admin-authored Draft, no unit cost
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_like($$ select public.post_stock_document(current_setting('stk.cnt2')::uuid) $$, 'STK_INVALID%unit cost%',
  'FR-STK-025 finding stock where the system has none needs a unit cost');
reset role;
-- FR-STK-024: an adjustment needs a reason; adjust-in defaults to the moving average; its author cannot post it
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','adjustment','warehouse_id','15120000-0000-0000-0000-000000002002'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',2,'direction','out'))) $$, 'STK_INVALID%reason%', 'FR-STK-024 an adjustment without a reason is refused');
select set_config('stk.adj', public.create_stock_document(jsonb_build_object('kind','adjustment','warehouse_id','15120000-0000-0000-0000-000000002002','reason','found in the yard'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',3,'direction','in')))::text, false);
select throws_like($$ select public.post_stock_document(current_setting('stk.adj')::uuid) $$, 'STK_SELF_APPROVE%', 'FR-STK-062 the author cannot post their own adjustment either');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.post_stock_document(current_setting('stk.adj')::uuid) $$, 'FR-STK-024 a Project Manager posts it');
reset role;
select is((select value_delta::text from public.stock_ledger where kind = 'adjustment' and document_id = current_setting('stk.adj')::uuid), '180.00',
  'FR-STK-024 adjust-in without a cost enters at the moving average (3 x 60)');
select * from finish();
rollback;
```
Run (expect FAIL: `STK_KIND_UNAVAILABLE`): `scripts/with-db-lock.sh supabase test db supabase/tests/stock_adjust_count.test.sql`

### Task S4.2 - migration 0415
Create `supabase/migrations/0415_stock_adjust_count.sql` (header as 0411; rollback restores the two stubs):
```sql
-- FR-STK-062: a write-off is posted by someone who is NOT its author and has rank >= 20 (ADR-0070). Admin gets no exemption (OD-PROC-8).
create or replace function public.stock_assert_writeoff_approver(p_doc public.stock_documents, p_uid uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_self_ok boolean; v_rank_ok boolean;
begin
  v_self_ok := p_doc.created_by is distinct from p_uid;                                                   -- mut:selfapprove
  if not v_self_ok then raise exception 'STK_SELF_APPROVE: a write-off must be posted by someone other than its author' using errcode = 'P0001'; end if;
  v_rank_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false);                               -- mut:writeoff_rank
  if not v_rank_ok then raise exception 'STK_RANK: only a Project Manager or above posts a write-off' using errcode = 'P0001'; end if;
end $$;

create or replace function public.stock_apply_adjustment(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; b public.stock_balances; v_in numeric;
begin
  if not p_post then return; end if;                    -- reason, direction, cost and quantity shape were checked by stock_validate_payload
  perform public.stock_assert_writeoff_approver(p_doc, auth.uid());                 -- an adjustment is always a non-zero change
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    if l.direction = 'out' then
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, -l.quantity, null, null, null, null);
    else
      select * into b from public.stock_balances x where x.item_id = l.item_id and x.warehouse_id = p_doc.warehouse_id;
      v_in := case when l.unit_cost is not null then round(l.quantity * l.unit_cost, 2)
                   when b.qty_on_hand > 0 then round(l.quantity * b.value_on_hand / b.qty_on_hand, 2) end;
      if v_in is null then raise exception 'STK_INVALID: adjusting stock in where none is on hand needs a unit cost' using errcode = 'P0001'; end if;
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, v_in, null, null, null);
    end if;
  end loop;
end $$;

create or replace function public.stock_apply_count(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; b public.stock_balances; v_var numeric; v_any boolean := false; v_in numeric;
begin
  if exists (select 1 from public.stock_document_lines x where x.document_id = p_doc.id group by x.item_id having count(*) > 1) then
    raise exception 'STK_INVALID: an item appears once per count' using errcode = 'P0001'; end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);                            -- balances locked BEFORE the variance is read
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    select * into b from public.stock_balances x where x.item_id = l.item_id and x.warehouse_id = p_doc.warehouse_id;
    update public.stock_document_lines set expected_quantity = b.qty_on_hand where id = l.id;          -- stamped while the document is still a Draft
    if l.counted_quantity <> b.qty_on_hand then v_any := true; end if;                                 -- mut:variance
  end loop;
  if v_any then perform public.stock_assert_writeoff_approver(p_doc, auth.uid()); end if;
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    select * into b from public.stock_balances x where x.item_id = l.item_id and x.warehouse_id = p_doc.warehouse_id;
    v_var := l.counted_quantity - b.qty_on_hand;
    if v_var < 0 then
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, v_var, null, null, null, null);
    elsif v_var > 0 then
      v_in := case when b.qty_on_hand > 0 then round(v_var * b.value_on_hand / b.qty_on_hand, 2)
                   when l.unit_cost is not null then round(v_var * l.unit_cost, 2) end;
      if v_in is null then raise exception 'STK_INVALID: finding stock where the system has none needs a unit cost' using errcode = 'P0001'; end if;
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, v_var, v_in, null, null, null);
    end if;                                                                                            -- zero variance: nothing is posted
  end loop;
end $$;
revoke all on function public.stock_assert_writeoff_approver(public.stock_documents, uuid),
  public.stock_apply_adjustment(public.stock_documents, boolean), public.stock_apply_count(public.stock_documents, boolean) from public, anon, authenticated;
```
Why the variance flag is computed under the lock and the variance is **re-read** in the second loop: a stock movement between the check and the write would otherwise let an author post a "zero-variance" count that then writes a non-zero variance. The first loop locks nothing new (the balances were locked up front) and the second loop sees the same numbers, because every writer takes the same locks.
Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_adjust_count.test.sql'` -> PASS.

### Task S4.3 - complete the ledger-invariant proof (AC-STK-004)
In `supabase/tests/stock_ledger_invariant.test.sql` (S2b.3) append, at the `-- S4:` marker: an adjustment-out (reason `damaged`, authored by Admin, posted by the PM), an adjustment-in at the default moving average, and a count with a deficit and a count with a surplus (PM posts, Admin authors). Re-run the same four invariant assertions (they are queries over the whole ledger, so they pick the new rows up) and add: `select is((select count(*)::int from public.stock_ledger where kind in ('count','adjustment') and value_delta = 0 and qty_delta <> 0 and false), 0, ...)` is **not** needed; instead assert `select count(*) from stock_ledger where kind = 'count' and document_id in (select id from stock_documents where status = 'Posted' and not exists (select 1 from stock_document_lines l where l.document_id = stock_documents.id and l.expected_quantity is not null))` = 0 (every posted count stamped its system quantity). Bump `plan()`. Run.

### Task S4.4 - isolation and mutation
- `stock_tenant_isolation.test.sql` (marker `-- S4:`): org B posting org A's Draft count -> `STK_NOT_FOUND%`.
- `CASES` append and run (`red: true, green: true` each):
```js
  { id: 'selfapprove',   fn: 'public.stock_assert_writeoff_approver(public.stock_documents,uuid)', from: /(v_self_ok := )[^;]+(;\s*-- mut:selfapprove)/,    to: '$1true$2',  test: 'supabase/tests/stock_adjust_count.test.sql' },
  { id: 'writeoff_rank', fn: 'public.stock_assert_writeoff_approver(public.stock_documents,uuid)', from: /(v_rank_ok := )[^;]+(;\s*-- mut:writeoff_rank)/, to: '$1true$2',  test: 'supabase/tests/stock_adjust_count.test.sql' },
  { id: 'variance',      fn: 'public.stock_apply_count(public.stock_documents,boolean)',           from: /(if l\.counted_quantity )<>( b\.qty_on_hand then v_any := true; end if;\s*-- mut:variance)/, to: '$1=$2', test: 'supabase/tests/stock_adjust_count.test.sql' },
```
(`variance` flips the comparison so a non-zero variance looks like none: the author's own non-zero count then posts, and AC-STK-014's first assertion goes red.)

### Task S4.5 - DAL and repository additions (TDD)
Extend `stockDocuments.ts` with nothing new beyond S3 (`createStockDocument` already carries `reason`, `countedQuantity`, `direction`, `unitCost`). Add `src/lib/db/stockDocuments.test.ts` cases: a count payload maps `countedQuantity` -> `counted_quantity`; an adjustment maps `direction` and `reason`; `saveStockDraft` calls `save_stock_draft` with the same shapes.

### Task S4.6 - Draft screens: Adjustment, Count, Post (AC-STK-032 states, FR-STK-062 UI)
Test first `pmo-portal/pages/stock/StockCount.test.tsx` **(new)**:
```tsx
it('FR-STK-025 the count sheet shows the system quantity next to each counted quantity and the variance preview', async () => { /* counted 92, system 100 -> "-8" */ });
it('FR-STK-062 the author sees "Another person must post this" and no Post button when there is a variance', () => { /* can('post','stockDocument',{record:{kind:'count',created_by:me}}) false */ });
it('FR-STK-062 a Project Manager who did not author it sees Post', () => {});
it('a Draft can be saved, reopened and edited, and posting refreshes on-hand', async () => { /* saveDraft then post; mutation invalidates stock-on-hand */ });
it('AC-STK-032 loading, empty, error (retry, no fabricated zero), populated', async () => {});
```
Implement: extend `pages/stock/StockMovementForm.tsx` kinds to `adjustment | count` (count rows: item, "Counted" input, "System now" read-only from `useStockOnHand({ warehouseId })`, variance preview computed on the **server-returned strings only for display** via a string-decimal subtraction helper in `stockFormat.ts` - no float; adjustment rows: item, direction toggle, quantity, optional unit cost, mandatory reason); "Save draft" (`saveStockDraft`) and, on `StockDocumentDetail`, a Post button for a Draft when `can('post','stockDocument', ...)`. `StockDocuments` gets a "Drafts" filter. `/stock/new/adjustment` and `/stock/new/count` routes work with the existing `:kind` route. i18n keys appended to both locales.
Add to `src/lib/stockFormat.ts` + test: `subtractDecimal(a: string, b: string): string` (BigInt scaled arithmetic, 3 dp), asserting `subtractDecimal('92', '100.000') === '-8'`.

### Task S4.7 - policy append (AC-STK-033)
In `src/auth/policy.stock.test.ts` add the adjustment / count x {author, other} x five roles x real / view-as matrix (already encoded in the S3.5 policy: confirm each cell). Run.

### Task S4.8 - gate
Local final gate for the slice; `scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/stock-mutation-proof.mjs'` (**all** cases to date); `scripts/ux-proof.sh /stock/new/count /stock/new/adjustment /stock/documents`; the three reviewers; Director + Terra/Sol review (SoD). Push `feat/stock-s4-adjust-count`; report.

### Task S4.9 - rollback
`supabase/migrations/rollback/0415_stock_adjust_count_down.sql`: restore the two stubs verbatim and `drop function public.stock_assert_writeoff_approver(public.stock_documents, uuid)`. Verify as S1.4.

---

# Slice S5 - Allowance and consumption report (`0416_stock_allowance_consumption.sql`)

Builds: `boq_material_allowances`; `get_project_consumption`; the allowance editor on the BoQ screen; the project consumption report with the over-allowance flag and the unplanned list; the explain-analyse record. Owns: AC-STK-022, 023, 024; appends the consumption half of AC-STK-020, the report half of AC-STK-021, and the consumption leg of AC-STK-001 (E2E). FRs: 042, 043, 044, 050, NFR-STK-003. Blocked by S2b and S3. Executor: Terra (RPC) then a UI worker.

### Task S5.1 - seed BoQ and allowances for the demo (before writing tests that depend on them)
Find a seeded Ongoing project no BoQ / progress test touches: `grep -rln "40000000-0000-0000-0000-000000000013" supabase/tests pmo-portal/e2e | head` (P013 `Seabridge Terminal Delivery`, Ongoing). If it is clean, append to `supabase/seed.sql` a `-- #1512 BoQ + allowances` block with four `boq_items` lines for it (`org_id = '00000000-0000-0000-0000-000000000001'`, fixed `1512....` ids) and `boq_material_allowances` for two of them (added by this slice's migration); issue some seeded stock to it in the S2a seed block's style so the report has rows in two months. If the project is read by BoQ tests, pick another Ongoing project and say which in the PR. Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0250_progress_billing_boq.test.sql'` still passes.

### Task S5.2 - failing pgTAP: allowance rules (AC-STK-024)
`supabase/tests/stock_allowance.test.sql` (F1 + `stk_t_rcv`). `P_ON` is managed by `U_PM`; add a second Ongoing project `P_OTHER` (id `...0c3`, PM = Admin `U_ADMIN`, `project_manager_id`) with its own BoQ line `BOQ_OTHER` (`...0e3`).
```sql
select plan(8);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                    -- U_PM manages P_ON only
select lives_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001001', 100) $$,
  'FR-STK-050 the project''s own PM sets an allowance on a BoQ line of their project');
select throws_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e3', '15120000-0000-0000-0000-000000001001', 100) $$,
  '42501', null, 'AC-STK-024 a PM cannot set an allowance on another project''s BoQ line');
select lives_ok($$ update boq_material_allowances set planned_quantity = 120 where boq_item_id = '15120000-0000-0000-0000-0000000000e1' $$, 'FR-STK-050 and changes it');
select is((select planned_quantity::text from boq_material_allowances where boq_item_id = '15120000-0000-0000-0000-0000000000e1'), '120.000', 'FR-STK-050 the change landed');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                    -- U_ENG
select throws_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001002', 5) $$,
  '42501', null, 'AC-STK-024 an Engineer cannot set an allowance');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a2');                                    -- U_FIN (rank >= Finance may on any project)
select lives_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e3', '15120000-0000-0000-0000-000000001002', 7) $$, 'PQ-7 Finance sets one on any project');
select lives_ok($$ delete from boq_material_allowances where boq_item_id = '15120000-0000-0000-0000-0000000000e3' $$, 'FR-STK-050 and clears it');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');                                    -- other org
select throws_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001001', 1) $$,
  '42501', null, 'AC-STK-019 org B cannot set an allowance on org A''s BoQ line');
select * from finish();
rollback;
```
Run (expect FAIL: relation does not exist).

### Task S5.3 - migration 0416 part 1: `boq_material_allowances`
```sql
create table public.boq_material_allowances (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  boq_item_id      uuid not null references public.boq_items(id) on delete cascade,
  item_id          uuid not null references public.stock_items(id),
  planned_quantity numeric(14,3) not null constraint boq_material_allowances_qty_check check (planned_quantity > 0 and planned_quantity < 'Infinity'::numeric),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (boq_item_id, item_id)
);
create index boq_material_allowances_item_idx on public.boq_material_allowances (item_id);
create trigger boq_material_allowances_stamp_org_id before insert on public.boq_material_allowances for each row execute function public.stamp_org_id();

-- PQ-7: the BoQ line's project is the scope. Reuses 0245's may_record_project_progress (Finance rank and above, or the project's own PM).
-- Invoker + RLS, the 0250 progress_assessment_line_ok precedent: a foreign BoQ line or item is invisible, so it fails closed.
create or replace function public.boq_allowance_ok(p_boq_item_id uuid, p_item_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (select 1 from public.boq_items b join public.stock_items i on i.org_id = b.org_id
                  where b.id = p_boq_item_id and i.id = p_item_id and i.archived_at is null
                    and public.may_record_project_progress(b.project_id))
$$;
revoke all on function public.boq_allowance_ok(uuid, uuid) from public, anon;
grant execute on function public.boq_allowance_ok(uuid, uuid) to authenticated;

alter table public.boq_material_allowances enable row level security;  alter table public.boq_material_allowances force row level security;
create policy boq_material_allowances_select on public.boq_material_allowances for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy boq_material_allowances_insert on public.boq_material_allowances for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
create policy boq_material_allowances_update on public.boq_material_allowances for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id))
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
create policy boq_material_allowances_delete on public.boq_material_allowances for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
revoke all on public.boq_material_allowances from authenticated, anon;
grant select on public.boq_material_allowances to authenticated;
grant insert (boq_item_id, item_id, planned_quantity) on public.boq_material_allowances to authenticated;
grant update (planned_quantity) on public.boq_material_allowances to authenticated;
grant delete on public.boq_material_allowances to authenticated;
create or replace function public.touch_boq_material_allowance() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function public.touch_boq_material_allowance() from public, anon, authenticated;
create trigger boq_material_allowances_touch before update on public.boq_material_allowances for each row execute function public.touch_boq_material_allowance();
```
Run S5.2 -> PASS (8/8). If the PM-of-another-project assertion passes for the wrong reason (`holds_pipeline_value_authority` true for PM role and `project_manager_id` mismatch), confirm by temporarily making `P_OTHER`'s PM the same user: the insert must then succeed.

### Task S5.4 - failing pgTAP: the consumption report (AC-STK-022, 023, FR-STK-043, AC-STK-020 consumption, AC-STK-021 report half)
`supabase/tests/stock_consumption.test.sql` (F1 + the `stk_t_rcv` / `stk_t_issue` / `stk_t_return` / `stk_t_line` helpers of S2b.1). Dates are relative to the org's today so the test is stable on any run date: `stk.m0` = first day of the current month, `stk.m1` = first day of the previous month (set with `set_config` from `date_trunc('month', (now() at time zone 'Asia/Jakarta'))`). `stock_assert_dates` forbids the future, so the current-month rows use day 1 (never later than today) and the earlier month's rows use days 5 and 20; the poster is Admin, who may date any past day (PQ-2). Setup (superuser, then Admin): a second BoQ line on `P_ON` (`...0e4`, no allowance), an allowance of 100 cable on `BOQ_ON`, `insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001002', 100)`; Admin receives 500 cable @ 10 at SITE-A; Admin issues 60 (day 5) and 40 (day 20) of last month and 25 (day 1) of this month to `BOQ_ON`, 10 to `BOQ_ON2` (day 1), then returns 5 of the 25 (day 1 this month) citing that issue line. Header key for the date: `'occurred_on', current_setting('stk.m1')::date + 4` etc.
```sql
select plan(12);
-- (setup as above)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                                              -- U_PM
select is(jsonb_path_query_array(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) -> 'months',
          '$[*] ? (@.month == $m && @.boq_item_id == $b).net_consumed', jsonb_build_object('m', current_setting('stk.m1'), 'b', '15120000-0000-0000-0000-0000000000e1')),
  '["100"]'::jsonb, 'AC-STK-022 last month''s net for the work item is 60 + 40 = 100');
select is(jsonb_path_query_array(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) -> 'months',
          '$[*] ? (@.month == $m && @.boq_item_id == $b).net_consumed', jsonb_build_object('m', current_setting('stk.m0'), 'b', '15120000-0000-0000-0000-0000000000e1')),
  '["20"]'::jsonb, 'AC-STK-022 this month''s net is 25 issued - 5 returned = 20');
select is(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) #>> '{allowances,0,net_to_date}', '120',
  'AC-STK-022 cumulative net to date equals the sum of the monthly nets (100 + 20)');
select is(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) #>> '{allowances,0,variance}', '20', 'AC-STK-023 variance against the allowance of 100 is +20');
select is(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) #>> '{allowances,0,over_allowance}', 'true', 'AC-STK-023 the row is flagged over allowance');
select is(jsonb_array_length(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) -> 'unplanned'), 1,
  'AC-STK-023 one item was issued under a work item with no allowance');
select is(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) #>> '{unplanned,0,boq_item_id}', '15120000-0000-0000-0000-0000000000e4',
  'AC-STK-023 the unplanned list names that work item');
select is(jsonb_path_exists(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27) -> 'allowances',
          '$[*] ? (@.boq_item_id == $b)', jsonb_build_object('b', '15120000-0000-0000-0000-0000000000e4')), false,
  'AC-STK-023 a work item with no allowance has no variance row and no flag (consumption only)');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                                              -- U_ENG
select is(jsonb_path_exists(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27), '$.**.net_value'), false,
  'AC-STK-020 an Engineer''s consumption report carries no value key');
reset role;
-- AC-STK-021 (report half): an Admin post dated 40 days ago lands in the older month and changes no earlier ledger value
select set_config('stk.before', (select string_agg(value_after::text, ',' order by seq) from public.stock_ledger), false);
select set_config('stk.maxseq', (select max(seq)::text from public.stock_ledger), false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002002','project_id','15120000-0000-0000-0000-0000000000c1','occurred_on',((now() at time zone 'Asia/Jakarta')::date - 40)::text),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true);
reset role;
select is((select string_agg(value_after::text, ',' order by seq) from public.stock_ledger where seq <= current_setting('stk.maxseq')::bigint), current_setting('stk.before'),
  'AC-STK-021 the backdated post changed no earlier ledger value (valuation follows posting order)');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select isnt(jsonb_path_query_array(public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', (now() at time zone 'Asia/Jakarta')::date - 45, (now() at time zone 'Asia/Jakarta')::date) -> 'months',
          '$[*] ? (@.month == $m).net_consumed', jsonb_build_object('m', to_char(date_trunc('month', (now() at time zone 'Asia/Jakarta')::date - 40), 'YYYY-MM-DD'))), '[]'::jsonb,
  'AC-STK-021 the report puts the backdated issue in its own (older) month');
-- FR-STK-044: a report that cannot compute raises; it never returns a fabricated empty report
select throws_like($$ select public.get_project_consumption('15120000-0000-0000-0000-0000000000f1', current_setting('stk.m1')::date, current_setting('stk.m0')::date) $$,
  'STK_NOT_FOUND%', 'FR-STK-044 an unknown project is an error, not an empty report');
reset role;
select * from finish();
rollback;
```
Count: 12 assertions.
Run (expect FAIL until S5.5).

### Task S5.5 - migration 0416 part 2: `get_project_consumption`
```sql
create or replace function public.get_project_consumption(p_project_id uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_months jsonb; v_allow jsonb; v_unplanned jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                  -- mut:cost_consumption
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'STK_INVALID: a valid date range is required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;
  -- per month x work item x item: issued, returned, net (D9: occurred_on is already an org-timezone date)
  select coalesce(jsonb_agg(m.j order by m.month, m.boq_code, m.item_code), '[]'::jsonb) into v_months from (
    select date_trunc('month', l.occurred_on)::date as month, b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('month', date_trunc('month', l.occurred_on)::date, 'boq_item_id', l.boq_item_id, 'boq_item_code', b.item_code, 'boq_description', b.description,
                              'item_id', l.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'issued',       trim_scale(coalesce(sum(-l.qty_delta) filter (where l.kind = 'issue'), 0))::text,
                              'returned',     trim_scale(coalesce(sum(l.qty_delta)  filter (where l.kind = 'return'), 0))::text,
                              'net_consumed', trim_scale(sum(-l.qty_delta))::text)
           || case when v_cost then jsonb_build_object('net_value', sum(-l.value_delta)::text) else '{}'::jsonb end as j
      from public.stock_ledger l join public.boq_items b on b.id = l.boq_item_id join public.stock_items i on i.id = l.item_id join public.stock_units u on u.id = i.unit_id
     where l.org_id = v_org and l.project_id = p_project_id and l.kind in ('issue','return') and l.occurred_on between p_from and p_to
     group by date_trunc('month', l.occurred_on), l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code) m;
  -- cumulative net to the END of the range vs the allowance, for every allowance row (consumption 0 if none yet)
  select coalesce(jsonb_agg(a.j order by a.boq_code, a.item_code), '[]'::jsonb) into v_allow from (
    select b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('boq_item_id', al.boq_item_id, 'boq_item_code', b.item_code, 'item_id', al.item_id, 'item_code', i.code, 'item_name', i.name,
                              'planned_quantity', trim_scale(al.planned_quantity)::text,
                              'net_to_date', trim_scale(coalesce(c.net, 0))::text,
                              'variance',    trim_scale(coalesce(c.net, 0) - al.planned_quantity)::text,
                              'over_allowance', coalesce(c.net, 0) > al.planned_quantity) as j                                  -- mut:overflag
      from public.boq_material_allowances al join public.boq_items b on b.id = al.boq_item_id and b.project_id = p_project_id and b.org_id = v_org
      join public.stock_items i on i.id = al.item_id
      left join lateral (select sum(-l.qty_delta) as net from public.stock_ledger l
                          where l.org_id = v_org and l.project_id = p_project_id and l.boq_item_id = al.boq_item_id and l.item_id = al.item_id
                            and l.kind in ('issue','return') and l.occurred_on <= p_to) c on true) a;
  -- items consumed under a work item with no allowance row (FR-STK-043)
  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'boq_item_code', x.boq_code, 'item_id', x.item_id, 'item_code', x.item_code,
                                               'net_to_date', trim_scale(x.net)::text) order by x.boq_code, x.item_code), '[]'::jsonb) into v_unplanned from (
    select l.boq_item_id, b.item_code as boq_code, l.item_id, i.code as item_code, sum(-l.qty_delta) as net
      from public.stock_ledger l join public.boq_items b on b.id = l.boq_item_id join public.stock_items i on i.id = l.item_id
     where l.org_id = v_org and l.project_id = p_project_id and l.kind in ('issue','return') and l.occurred_on <= p_to
       and not exists (select 1 from public.boq_material_allowances al where al.boq_item_id = l.boq_item_id and al.item_id = l.item_id)
     group by l.boq_item_id, b.item_code, l.item_id, i.code having sum(-l.qty_delta) <> 0) x;
  return jsonb_build_object('project_id', p_project_id, 'from', p_from, 'to', p_to, 'months', v_months, 'allowances', v_allow, 'unplanned', v_unplanned);
end $$;
revoke all on function public.get_project_consumption(uuid, date, date) from public, anon;
grant execute on function public.get_project_consumption(uuid, date, date) to authenticated;
```
Per-month rows carry consumption only (allowances are not periodised, FR-STK-042); the allowance rows are cumulative to the end of the range. Rollback `0416_stock_allowance_consumption_down.sql` drops the function, then the table. Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_allowance.test.sql supabase/tests/stock_consumption.test.sql'` -> PASS.

### Task S5.6 - mutation, isolation, performance record
- `CASES`: `{ id: 'overflag', fn: 'public.get_project_consumption(uuid,date,date)', from: /('over_allowance', )coalesce\(c\.net, 0\) > al\.planned_quantity\)( as j\s*-- mut:overflag)/, to: "$1false)$2", test: 'supabase/tests/stock_consumption.test.sql' }` and `cost_consumption` (`v_cost := true`). Run both red / green.
- `stock_tenant_isolation.test.sql` (marker `-- S5:`): org B's `get_project_consumption(<org A project>, ...)` -> `STK_NOT_FOUND%`; org B reads no `boq_material_allowances` row of org A.
- NFR-STK-003: `supabase/tests/perf/stock_consumption_explain.sql` **(new, not part of `supabase test db`)**: as superuser, in a scratch transaction that rolls back, `insert` 200,000 `stock_ledger` rows over 20 projects x 10 work items x 12 items x 24 months with `generate_series` (kinds issue / return; valid qty / value signs), then `explain (analyze, buffers) select public.get_project_consumption(<one project>, '2025-01-01', '2026-12-31')`. Run `scripts/with-db-lock.sh psql "$DB_URL" -f supabase/tests/perf/stock_consumption_explain.sql` and paste the plan and timing in the PR and in `docs/specs/inventory-project-consumption.spec.md` section 11 (one added sentence with the measured p95). **Target: <= 1 s.** If it misses, the first remedy is a partial index `(org_id, project_id, occurred_on) include (boq_item_id, item_id, qty_delta, value_delta, kind) where kind in ('issue','return')` in a new migration in this slice; do not weaken the target.

### Task S5.7 - DAL, hooks, error states (TDD)
- Test first (`stockReports.test.ts` additions): `getProjectConsumption(projectId, from, to)` returns typed rows with string quantities; an RPC error **throws** (no empty report); decimals stay strings. Implement in `src/lib/db/stockReports.ts`. Allowance DAL in `src/lib/db/stockAllowances.ts` **(new)**: `listAllowances(projectId)` (select `boq_material_allowances` joined to `boq_items` for the project), `setAllowance({ boqItemId, itemId, plannedQuantity: string })` (upsert on `(boq_item_id,item_id)` with `.select('id')` + `assertWriteLanded`), `clearAllowance(id)`.
- Repository `stock.consumption.report(...)`, `stock.allowances.{list,set,clear}`; hooks `useProjectConsumption(projectId, from, to)` (key `['stock-consumption', orgId, projectId, from, to]`), `useAllowances(projectId)`, `useAllowanceMutations(projectId)` (invalidate both keys). `can()`: add `'materialAllowance'` entity (`view: ALL`, `create/edit/delete`: `MASTER_DATA` and, for a PM, `record.project_manager_id === currentUserId`; mirrors `may_record_project_progress`), AC-STK-033 rows appended.

### Task S5.8 - UI: allowance editor and consumption report
Test first `pages/project-detail/tabs/MaterialsTab.test.tsx` additions and `pages/project-detail/MaterialAllowanceModal.test.tsx` **(new)**:
```tsx
it('AC-STK-022 the report renders one row per month x work item x item with issued, returned and net', async () => {});
it('AC-STK-023 a row over its allowance shows the variance and an "Over allowance" flag with text, not colour alone (WCAG)', async () => {});
it('AC-STK-023 an item with no allowance shows consumption only and appears in the "Unplanned" list', async () => {});
it('FR-STK-044 an RPC failure shows an error with retry and never a zero', async () => {});
it('FR-STK-050 the allowance editor is offered to a project''s own PM and Finance, not to an Engineer', () => {});
```
Implement: `MaterialsTab.tsx` renders `ConsumptionReport` (new component in `pages/project-detail/tabs/`; month range selector default current month back 3 months; value columns only when the response has `net_value`) above the S3 trace; `MaterialAllowanceModal.tsx` opened from the BoQ screen's work-item row action "Material allowance" (the BoQ UI is in `pages/project-detail/BoqItemFormModal.tsx`'s neighbours; the row action goes where BoQ lines are listed - find it with `grep -rn "BoqItemFormModal" pages` and add the action next to edit) using `EntityFormModal` + `ItemPicker` + `QuantityField`. After a posted issue, `StockMovementForm` shows the "Over allowance" notice on the confirmation (OQ-STK-7): it refetches `useProjectConsumption` for the project and work item and renders the flag when `over_allowance` is true (no block, no approval).

### Task S5.9 - extend the AC-STK-001 journey with the consumption oracle
In `e2e/AC-STK-001-issue-to-project-work-item.spec.ts` add the fixture allowance (admin JWT, 100 of the item on the work item) and the final oracle: the project's Materials tab shows 30 consumed for that work item and the current month against an allowance of 100. Run `scripts/e2e-local.sh AC-STK-001`.

### Task S5.10 - gate
Local final gate; DB chain for the S5 files + isolation + 0178; mutation table (all cases); `scripts/ux-proof.sh` on `/projects/<seeded id>/materials` (the route is `/projects/:projectId/:tab`); Discover pass; three reviewers. Push `feat/stock-s5-consumption`; report.

---

# Slice S6 - Reorder (`0417_stock_reorder.sql`)

Builds: `stock_reorder_levels`, `get_reorder_suggestions`, `set_stock_reorder_level`, `get_stock_below_reorder`, the accept / edit flow with audit, the worklist. Owns: AC-STK-025, 026, 027. FRs: 051-054, OQ-STK-8. Blocked by S2b. Executor: Terra (SQL), then a UI worker.

### Task S6.1 - failing pgTAP (AC-STK-025, 026, 027)
`supabase/tests/stock_reorder.test.sql` (F1 + `stk_t_rcv`, `stk_t_issue`, `stk_t_xfer` from S2a / S2b). Dated helpers (Admin posts; Admin may date any past day, PQ-2; `stock_assert_dates` forbids the future):
```sql
select plan(18);
create function public.stk_t_today() returns date language sql as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
create function public.stk_t_rcv_on(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric, p_ago int) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh,'occurred_on',(public.stk_t_today() - p_ago)::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_issue_on(p_wh uuid, p_item uuid, p_qty numeric, p_ago int) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id','15120000-0000-0000-0000-0000000000c1','occurred_on',(public.stk_t_today() - p_ago)::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true) $$;
create function public.stk_t_xfer_on(p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_ago int) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to,'occurred_on',(public.stk_t_today() - p_ago)::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;
update public.stock_items set lead_time_days = 14 where id = '15120000-0000-0000-0000-000000001002';
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
-- (A) cable at CENTRAL: 6 issues of 30 over the last 90 days -> 2/day, lead 14, safety 7, cycle 30
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 400, 10, 91);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 85); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 70); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 55);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 40); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 25); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 10);
-- (B) bags at CENTRAL: 78 over 60 days = 1.3/day, whole-number unit
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 100, 20, 60);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 26, 50); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 26, 30); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 26, 10);
-- (C) cable at SITE-B: 27 days of history, 3 issues -> too short
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 100, 10, 27);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 20); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 15); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 5);
-- (D) cable at SITE-A: exactly 28 days of history and exactly 3 movements -> a figure
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100, 10, 28);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7, 20); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7, 14); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7, 7);
-- (E) bags at SITE-A: long history, only 2 movements
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 50, 20, 60);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 4, 30); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 4, 10);
-- (F) bags at SITE-B: 5 transfers INTO the central warehouse are not usage
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 40, 20, 60);
select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 40); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 30); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 20);
select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 10); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 5);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                                              -- U_PM
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') #>> '{suggestion,reorder_level}', '42',  'AC-STK-025 level = ceil(2 x (14 + 7)) = 42');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') #>> '{suggestion,reorder_quantity}', '60', 'AC-STK-025 quantity = ceil(2 x 30) = 60');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') #>> '{inputs,usage}', '180', 'AC-STK-025 the inputs (usage 180 over the window) are returned beside the figures');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001') #>> '{suggestion,reorder_level}', '28', 'AC-STK-025 a whole-number unit rounds up: ceil(1.3 x 21 = 27.3) = 28');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001') #>> '{suggestion,reorder_quantity}', '39', 'AC-STK-025 and the quantity ceil(1.3 x 30) = 39');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002') ->> 'status', 'insufficient_history', 'AC-STK-026 27 days of history is not enough');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002') -> 'suggestion', 'null'::jsonb, 'AC-STK-026 and no figure is returned');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002') #>> '{suggestion,reorder_level}', '15.75', 'AC-STK-026 exactly 28 days and exactly 3 movements DO give a figure (0.75/day x 21)');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001') ->> 'status', 'insufficient_history', 'AC-STK-026 two usage movements are not enough');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001') ->> 'status', 'insufficient_history', 'AC-STK-026 transfers into a central warehouse are not usage');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 8); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 4); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 2);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001') ->> 'status', 'ok', 'AC-STK-026 three transfers to a SITE do count');
-- AC-STK-027: a suggestion changes nothing; accepting sets the level; one audit row records before / after
select is((select count(*)::int from public.stock_reorder_levels), 0, 'AC-STK-027 nobody accepted, so no level exists');
select lives_ok($$ select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 42, 60) $$, 'AC-STK-027 an authorised user accepts');
select is((select reorder_level::text from public.stock_reorder_levels), '42.000', 'AC-STK-027 the level is set');
reset role;                                                                                         -- audit_events is not readable by a PM
select is((select count(*)::int from public.audit_events where action = 'stock.reorder_level.set'), 1, 'AC-STK-027 one audit row');
select is((select detail #>> '{after,reorder_level}' from public.audit_events where action = 'stock.reorder_level.set'), '42', 'AC-STK-027 the audit row carries the after value');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                                              -- U_ENG
select throws_ok($$ select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 10, null) $$, '42501', null, 'PQ-6 an Engineer cannot set a reorder level');
reset role;
select * from finish();
rollback;
```
Count: 18. The "before" half of the audit row is asserted in the UI test (second edit) and by one more `is` you add when you write the file: edit the level to 50 and require `detail #>> '{before,reorder_level}' = '42'`.
Run (expect FAIL).

### Task S6.2 - migration 0417
```sql
create table public.stock_reorder_levels (
  org_id           uuid not null references public.organizations(id),
  item_id          uuid not null references public.stock_items(id),
  warehouse_id     uuid not null references public.stock_warehouses(id),
  reorder_level    numeric(14,3) not null check (reorder_level >= 0 and reorder_level < 'Infinity'::numeric),
  reorder_quantity numeric(14,3) check (reorder_quantity is null or (reorder_quantity > 0 and reorder_quantity < 'Infinity'::numeric)),
  set_by           uuid not null references public.profiles(id),
  set_at           timestamptz not null default now(),
  primary key (item_id, warehouse_id)
);
alter table public.stock_reorder_levels enable row level security; alter table public.stock_reorder_levels force row level security;
create policy stock_reorder_levels_select on public.stock_reorder_levels for select using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.stock_reorder_levels from authenticated, anon;
grant select on public.stock_reorder_levels to authenticated;          -- written only by set_stock_reorder_level

-- OQ-STK-8: the constants live in ONE place.
create or replace function public.stock_reorder_params() returns table (window_days int, safety_days int, order_cycle_days int, default_lead_days int, min_history_days int, min_movements int)
  language sql immutable as $$ select 90, 7, 30, 14, 28, 3 $$;

create or replace function public.set_stock_reorder_level(p_warehouse_id uuid, p_item_id uuid, p_level numeric, p_quantity numeric default null) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_ok boolean; v_before public.stock_reorder_levels;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false);                                    -- mut:reorder_rank (PQ-6)
  if not v_ok then raise exception 'only a Project Manager or above sets a reorder level' using errcode = '42501'; end if;
  if not exists (select 1 from public.stock_items i where i.id = p_item_id and i.org_id = v_org)
     or not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: item or warehouse is not in your organisation' using errcode = 'P0001'; end if;
  select * into v_before from public.stock_reorder_levels where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if p_level is null then                                                                                 -- clearing
    delete from public.stock_reorder_levels where item_id = p_item_id and warehouse_id = p_warehouse_id;
  else
    if p_level < 0 or p_level <> round(p_level, 3) then raise exception 'STK_INVALID: a reorder level is 0 or more, 3 decimals at most' using errcode = 'P0001'; end if;
    insert into public.stock_reorder_levels (org_id, item_id, warehouse_id, reorder_level, reorder_quantity, set_by, set_at)
      values (v_org, p_item_id, p_warehouse_id, p_level, p_quantity, v_uid, now())
      on conflict (item_id, warehouse_id) do update set reorder_level = excluded.reorder_level, reorder_quantity = excluded.reorder_quantity, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
  perform public.log_audit('stock.reorder_level.set', v_org, v_uid, p_item_id,
    jsonb_build_object('warehouse_id', p_warehouse_id,
      'before', case when v_before.item_id is null then null else jsonb_build_object('reorder_level', trim_scale(v_before.reorder_level), 'reorder_quantity', v_before.reorder_quantity) end,
      'after',  case when p_level is null then null else jsonb_build_object('reorder_level', trim_scale(p_level), 'reorder_quantity', p_quantity) end));
end $$;

-- The suggestion (FR-STK-051/052). Changes nothing. usage = issues + transfers out (excluding transfers INTO a central warehouse) - returns in.
create or replace function public.get_reorder_suggestions(p_warehouse_id uuid, p_item_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid; v_today date; prm record; v_lead int; v_whole boolean; v_first date; v_history int; v_window int;
  v_usage numeric; v_moves int; v_avg numeric; v_level numeric; v_qty numeric; v_scale numeric;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into prm from public.stock_reorder_params();
  select coalesce(i.lead_time_days, prm.default_lead_days), u.whole_only into v_lead, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = p_item_id and i.org_id = v_org;
  if v_lead is null or not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: item or warehouse is not in your organisation' using errcode = 'P0001'; end if;
  v_today := public.stock_org_today(v_org);
  select min(l.occurred_on) into v_first from public.stock_ledger l where l.org_id = v_org and l.item_id = p_item_id and l.warehouse_id = p_warehouse_id;
  v_history := case when v_first is null then 0 else v_today - v_first end;
  v_window := least(prm.window_days, v_history);
  select coalesce(sum(case when l.kind = 'issue' then -l.qty_delta
                           when l.kind = 'transfer' and l.qty_delta < 0 and not coalesce(dw.kind = 'central', false) then -l.qty_delta
                           when l.kind = 'return' then -l.qty_delta else 0 end), 0),
         count(*) filter (where l.kind in ('issue') or (l.kind = 'transfer' and l.qty_delta < 0 and not coalesce(dw.kind = 'central', false)))
    into v_usage, v_moves
    from public.stock_ledger l
    join public.stock_documents d on d.id = l.document_id
    left join public.stock_warehouses dw on dw.id = d.to_warehouse_id
   where l.org_id = v_org and l.item_id = p_item_id and l.warehouse_id = p_warehouse_id and l.occurred_on > v_today - v_window and l.occurred_on <= v_today
     and l.kind in ('issue','transfer','return');
  if v_history < prm.min_history_days or v_moves < prm.min_movements then
    return jsonb_build_object('status', 'insufficient_history', 'suggestion', null,
      'inputs', jsonb_build_object('history_days', v_history, 'usage_movements', v_moves, 'min_history_days', prm.min_history_days, 'min_movements', prm.min_movements));
  end if;
  v_avg := v_usage / v_window;
  v_scale := case when v_whole then 1 else 1000 end;                                                      -- PQ-5
  v_level := ceil(v_avg * (v_lead + prm.safety_days) * v_scale) / v_scale;
  v_qty   := ceil(v_avg * prm.order_cycle_days * v_scale) / v_scale;
  return jsonb_build_object('status', 'ok',
    'suggestion', jsonb_build_object('reorder_level', trim_scale(v_level)::text, 'reorder_quantity', trim_scale(v_qty)::text),
    'inputs', jsonb_build_object('window_days', v_window, 'usage', trim_scale(v_usage)::text, 'avg_daily_usage', round(v_avg, 4)::text, 'lead_time_days', v_lead,
                                 'safety_days', prm.safety_days, 'order_cycle_days', prm.order_cycle_days, 'usage_movements', v_moves, 'history_days', v_history));
end $$;

-- FR-STK-054: the worklist. Items at or below a SET level, per warehouse. Creates nothing.
create or replace function public.get_stock_below_reorder() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
            'warehouse_id', w.id, 'warehouse_code', w.code, 'qty_on_hand', trim_scale(coalesce(b.qty_on_hand, 0))::text,
            'reorder_level', trim_scale(r.reorder_level)::text, 'reorder_quantity', trim_scale(r.reorder_quantity)::text) order by w.code, i.code)
       from public.stock_reorder_levels r join public.stock_items i on i.id = r.item_id join public.stock_units u on u.id = i.unit_id
       join public.stock_warehouses w on w.id = r.warehouse_id
       left join public.stock_balances b on b.item_id = r.item_id and b.warehouse_id = r.warehouse_id
      where r.org_id = v_org and i.archived_at is null and w.archived_at is null and coalesce(b.qty_on_hand, 0) <= r.reorder_level), '[]'::jsonb);
end $$;
revoke all on function public.stock_reorder_params() from public, anon, authenticated;
revoke all on function public.set_stock_reorder_level(uuid, uuid, numeric, numeric), public.get_reorder_suggestions(uuid, uuid), public.get_stock_below_reorder() from public, anon;
grant execute on function public.set_stock_reorder_level(uuid, uuid, numeric, numeric), public.get_reorder_suggestions(uuid, uuid), public.get_stock_below_reorder() to authenticated;
```
`stock_reorder_params` is read by `get_reorder_suggestions` (a definer, so the owner's execute applies). Add `set_stock_reorder_level` to the 0178 allow-list (+1; it writes). Rollback drops the three functions, the params function, then the table. Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/stock_reorder.test.sql supabase/tests/0178_anon_executable_definers.test.sql'` -> PASS. The "return" usage sign: returns **into** the warehouse reduce usage, so `-l.qty_delta` of a positive return is negative: correct as written.

### Task S6.3 - mutation and isolation
`CASES`: `{ id: 'reorder_rank', fn: 'public.set_stock_reorder_level(uuid,uuid,numeric,numeric)', from: /(v_ok := )[^;]+(;\s*-- mut:reorder_rank)/, to: '$1true$2', test: 'supabase/tests/stock_reorder.test.sql' }`. `stock_tenant_isolation.test.sql` (marker `-- S6:`): org B's `get_reorder_suggestions(<org A ids>)` -> `STK_NOT_FOUND%`; `get_stock_below_reorder()` returns only org B rows.

### Task S6.4 - DAL, hooks, policy (TDD)
`stockReports.ts`: `getReorderSuggestion(warehouseId, itemId)`, `getBelowReorder()`; `stockDocuments.ts`-style `setReorderLevel({ warehouseId, itemId, level: string | null, quantity?: string })`. Tests first (RPC names and argument maps; errors throw). Repository `stock.reorder.{suggestion,worklist,setLevel}`; hooks `useReorderSuggestion`, `useBelowReorder`, `useSetReorderLevel` (invalidates `['stock-below-reorder']`, `['stock-reorder-suggestion']`). `can()` entity `'reorderLevel'`: `edit` = `MASTER_DATA`.

### Task S6.5 - UI: suggestion, accept / edit, worklist
Test first `pages/stock/StockReorder.test.tsx` **(new)**:
```tsx
it('AC-STK-025 the suggestion shows level, quantity and the inputs beside them', async () => {});
it('AC-STK-026 "not enough history" shows no figure and says why (28 days / 3 movements)', async () => {});
it('AC-STK-027 nothing changes until "Accept" or an edited value is saved', async () => { /* setLevel not called on render */ });
it('FR-STK-054 the worklist lists items at or below their level and has no "Create purchase request" action', async () => {});
it('AC-STK-032 loading, empty ("Nothing is below its reorder level"), error with retry, populated', async () => {});
```
Implement `pages/stock/StockReorder.tsx` **(new)** at `/stock/reorder` (tab "Reorder" in the shared strip; the S3 on-hand toggle "Below reorder level" is enabled and links here). Row actions Accept / Edit / Clear, shown only when `can('edit','reorderLevel')`. Route in `App.tsx`; `routeMatch.ts` untouched (sub-route of `/stock`); i18n appended.

### Task S6.6 - gate
Local final gate; DB chain for S6 + isolation + 0178; the mutation table in full; `scripts/ux-proof.sh /stock/reorder`; three reviewers; Discover pass. Push `feat/stock-s6-reorder`; report.

---

# Traceability: every AC to its one owning test and layer

"File" is the single owning test; where a later slice appends assertions to it, the slice is named. pgTAP files are under `supabase/tests/`, Vitest next to its source, Playwright under `pmo-portal/e2e/`. The lead token of each assertion / title is the AC id.

| AC | Owning test (file) | Layer | Slice (appends) | Mutation case |
|---|---|---|---|---|
| AC-STK-001 | `e2e/AC-STK-001-issue-to-project-work-item.spec.ts` | E2E | S3 (S5 adds the consumption oracle) | - |
| AC-STK-002 | `stock_valuation.test.sql` | pgTAP | S2a (Transfer), S2b (Issue) | `avg` |
| AC-STK-003 | `stock_valuation.test.sql` | pgTAP | S2a, S2b | `avg` (the stepwise sum binds it; see delta 13) |
| AC-STK-004 | `stock_ledger_invariant.test.sql` | pgTAP | S2b, completed in S4 | - (invariant; a broken writer breaks AC-002/003 first) |
| AC-STK-005 | `stock_valuation.test.sql` | pgTAP | S2a (Transfer), S2b (Issue) | `insufficient` |
| AC-STK-006 | `stock_valuation.test.sql` | pgTAP | S2a | `conserve` |
| AC-STK-007 | `stock_out_flows.test.sql` | pgTAP | S2b | `boq` |
| AC-STK-008 | `stock_out_flows.test.sql` | pgTAP | S2b | `projactive` |
| AC-STK-009 | `stock_out_flows.test.sql` | pgTAP | S2b | `cap`, `returncost` |
| AC-STK-010 | `stock_posting_guards.test.sql` | pgTAP | S2a (Receive, Transfer), S2b (Issue, Return) | `costignore` |
| AC-STK-011 | `stock_immutability_idempotency.test.sql` | pgTAP | S2a | `immutable` |
| AC-STK-012 | `stock_immutability_idempotency.test.sql` | pgTAP | S2a | - (two independent mechanisms, the replay lookup and the partial unique index; one regex cannot break both. The test exercises the lookup path; the S2b concurrency script's scenario 5 sends the same `client_request_id` from two sessions at once and requires one document and one ledger entry, which exercises the unique-index path) |
| AC-STK-013 | `stock_posting_guards.test.sql` | pgTAP | S2a | `keeper`, `keeper_admin` |
| AC-STK-014 | `stock_adjust_count.test.sql` | pgTAP | S4 | `selfapprove`, `writeoff_rank`, `variance` |
| AC-STK-015 | `stock_adjust_count.test.sql` | pgTAP | S4 | `variance` |
| AC-STK-016 | `stock_posting_guards.test.sql` | pgTAP | S2a | - |
| AC-STK-017 | `stock_posting_guards.test.sql` | pgTAP | S2a | - |
| AC-STK-018 | `stock_posting_guards.test.sql` | pgTAP | S2a | `owned` |
| AC-STK-019 | `stock_tenant_isolation.test.sql` | pgTAP | S1, S2a, S2b, S3, S4, S5, S6 (one block each) | - |
| AC-STK-020 | `stock_read_rpcs.test.sql` | pgTAP | S3 (S5 appends the consumption leg in `stock_consumption.test.sql`; that leg is part of this AC, not a second owner) | `cost`, `cost_ledger`, `cost_consumption` |
| AC-STK-021 | `stock_posting_guards.test.sql` (ledger part) | pgTAP | S2a (S5 appends the report part in `stock_consumption.test.sql`) | `backdate`, `future` |
| AC-STK-022 | `stock_consumption.test.sql` | pgTAP | S5 | - |
| AC-STK-023 | `stock_consumption.test.sql` | pgTAP | S5 | `overflag` |
| AC-STK-024 | `stock_allowance.test.sql` | pgTAP | S5 | - |
| AC-STK-025 | `stock_reorder.test.sql` | pgTAP | S6 | - |
| AC-STK-026 | `stock_reorder.test.sql` | pgTAP | S6 | - |
| AC-STK-027 | `stock_reorder.test.sql` | pgTAP | S6 | `reorder_rank` |
| AC-STK-028 | `stock_read_rpcs.test.sql` | pgTAP | S3 | - |
| AC-STK-029 | `stock_posting_guards.test.sql` | pgTAP | S2a | - |
| AC-STK-030 | `pages/stock/StockMovementForm.test.tsx` (+ `jest-axe`; 360 px by `UX_PROOF_WIDTHS=360,1440 scripts/ux-proof.sh`) | Unit (RTL) + axe | S3 | - |
| AC-STK-031 | `e2e/AC-STK-031-site-storekeeper-chain.spec.ts` | E2E | S3 | - |
| AC-STK-032 | `StockSetup.test.tsx`, `StockMovementForm.test.tsx`, `StockOnHand.test.tsx`, `StockDocuments.test.tsx`, `StockDocumentDetail.test.tsx`, `StockLedger.test.tsx`, `StockReorder.test.tsx`, `StockCount.test.tsx`, `MaterialsTab.test.tsx` (one `AC-STK-032` state test per screen; the AC is "each screen state", so each screen file is the owner of its own screen) | Unit (RTL) | S1, S3, S4, S5, S6 | - |
| AC-STK-033 | `src/auth/policy.stock.test.ts` | Unit (Vitest) | S1 (master data), S3 (documents), S4 (adjust / count), S5 (allowance), S6 (reorder) | - |
| AC-STK-034 | `stock_master_data.test.sql` (S2a appends the unit-lock assertion: `STK_UNIT_LOCKED` once a line references the item) | pgTAP | S1 (S2a) | `admin_only` |

Money-integrity ACs 005 and 011 get their own mutation cases (`insufficient`, `immutable`) in S2a.12 even though the spec names only 013, 014 and 018 explicitly; 012 is covered by two independent mechanisms, as the table states.

**FRs with no AC of their own** (covered by a named supporting assertion, not a second owner): FR-STK-001/002/003 (S1 `stock_master_data.test.sql`, creation and uniqueness assertions); FR-STK-004, 066 (keeper and master-data audit assertions, same file; `stock.admin_post` in `stock_posting_guards`; `stock.reorder_level.set` in `stock_reorder`); FR-STK-010 (document number is unique and prefixed: one assertion in `stock_immutability_idempotency`); FR-STK-011 (author edits and cancels a Draft, a stranger cannot: assertions in the same file); FR-STK-014 (AC-STK-005); FR-STK-033 (a `grep` assertion in `stockFormat.test.ts`, S3.6); FR-STK-044/045 (AC-STK-032); FR-STK-053 (AC-STK-027); FR-STK-054 (S6 `get_stock_below_reorder` assertion + `StockReorder.test.tsx`); FR-STK-060 (ACL: no client write grant - assertions `42501` in `stock_posting_guards`: direct INSERT into documents / balances by `authenticated` is refused); FR-STK-070-074 (AC-STK-018; `stock-single-writer.test.mjs` for 072; the spec's FR-STK-073 is a #1508 concern, nothing to prove here); NFR-STK-001 (AC-STK-019); NFR-STK-002 (`stockPosting.concurrent.integration.mjs`, S2b.6); NFR-STK-003 (S5.6 explain record); NFR-STK-004/005 (AC-STK-030 + ux-proof axe); NFR-STK-006 (rollback files, verified per slice); NFR-STK-007 (S3.6 grep guard + string decimals); NFR-STK-008 (no existing table or function body changes: `git diff origin/dev --stat -- supabase/migrations` shows only `0411`-`0417` + rollbacks; the only edits to shipped files are `seed.sql`, `policy.ts`, `App.tsx`, `Rail.tsx`, `routeMatch.ts`, `ProjectSections.tsx`, `projectDetailAreas.ts`, `repositories/*`, `i18n/index.ts`); NFR-STK-009 (the five failure buckets are the S2a-S2b review checklist).

---

# Cross-slice rules, risks and follow-ups

- **Merge order and PRs.** S1 -> S2a -> S2b -> S3 -> S4 -> S5 -> S6 (S3 and S4 may build in parallel; merge S3 first). S2a, S2b and S4 ship alone (money / SoD). S1, S3, S5, S6 may be batched 3-5 branches per PR to `dev` with `--no-ff` only if they are ready together; the Director decides. Every slice: migration number re-check at the start and just before the PR (`scripts/check-migration-collisions.sh`; collisions: `scripts/renumber-migration.sh`). Rebase translation files (`public/locales/*/stock.json`) and `0178_anon_executable_definers.test.sql` (count!) immediately before each PR.
- **Dev CI scope** (`scripts/ci-test-scope.mjs`): any `supabase/**` change runs pgTAP; edge functions are untouched, so Deno does not run. Migrations or `ci.yml` do not force a full run unless the scope script says so; do not rely on it - the local gate lists the touched pgTAP files.
- **Browser e2e** runs on the release PR to `main`, not on dev PRs (owner 2026-10-30). The two curated journeys are run locally with `scripts/e2e-local.sh` as evidence; they are not dispatched to CI per slice.
- **Edge functions / adapter seam: none.** Connected posting and reconciliation are #1508; the seams it needs are exactly the six FR-STK-070..074 rules proved above. Nothing here touches `adapterSeam/*`, `supabase/functions/*` or the outbox.
- **Public-repo hygiene.** No open weakness is described here; the rank gates, ownership guard and keeper rule are shipped designs. Unfixed-defect notes found while building go to `docs/private/`, not to a tracked file or issue.
- **Risks the Director should hold.** (1) `stock_write_entry` is the single point of failure for stock value: the hardest review lane, and the reason S2a and S2b are Terra / Sol work. (2) The 0178 allow-list count is a rebase hazard in 5 of 7 slices. (3) The seed adds stock and (S5) BoQ rows: if any existing e2e counts BoQ lines or items on the chosen project it will fail - S5.1 names the check. (4) PQ-1 makes keepers the *authors* of every document; a site with no keeper assigned cannot record anything until Admin assigns one - say so on the Setup empty state. (5) `stock_balances` rows for zero stock accumulate (one per item / warehouse touched); bounded by item x warehouse, no cleanup needed.
- **Follow-ups the spec files and this plan keeps out** (no build here): in-transit transfers (OQ-STK-4), unit conversions, count freeze, per-line goods-receipt matching (OD-PROC-2), purchase-request prefill from the worklist, tunable reorder constants, registration of stock actions in the #902 role matrix, connected posting (#1508), offline queue (#1520), daily site report (#1522), a `Receive` project clause (delta 11). Each becomes an issue when the owner signs the spec; `gh issue create` is the Director's call.

# Path verification

Run at the end of writing, from the repo root: every pre-existing path cited in this plan was checked with `git cat-file -e origin/dev:<path>` after `git fetch` (`origin/dev` = `1ccadb793`). All of these exist:

- **Docs / scripts:** `docs/specs/inventory-project-consumption.spec.md`, `docs/adr/0094-pmo-standalone-erp-route.md`, `docs/plans/2026-10-30-epc-odoo-build-route.md`, `docs/plans/2026-10-31-billing-kinds.md`, `docs/money-path-primer.md`, `docs/orca-dispatch.md`, `docs/e2e-parallel-conventions.md`, `docs/qa-portfolio.md`, `docs/glossary.md`, `docs/decisions.md`, `DESIGN.md`, `.githooks/pre-commit`, `.claude/agents/eng-planner.md`, `scripts/{check-migration-collisions.sh, renumber-migration.sh, with-db-lock.sh, e2e-local.sh, ux-proof.sh, prior-art.sh, ci-test-scope.mjs, check-e2e-isolation.sh, check-adr-collisions.sh}`.
- **Database:** `supabase/migrations/{0006_procurement_lifecycle, 0074_org_id_stamp_trigger, 0076_audit_events, 0087_external_domain_ownership, 0178_sod_class_completeness, 0180_rpc_active_member_gate, 0245_management_pack, 0250_progress_billing, 0409_document_preview_sources}.sql` and `supabase/migrations/rollback/0409_document_preview_sources_down.sql`; `supabase/seed.sql`; `supabase/tests/{0178_anon_executable_definers, 0250_progress_billing_boq}.test.sql`. Functions relied on, each read at the file above: `next_procurement_doc_number(uuid,text)` (0006, definer, owner-only execute), `log_audit(text,uuid,uuid,uuid,jsonb)` (0076), `domain_externally_owned(uuid,text)` (0087), `role_rank(user_role)` and `holds_won_value_authority` (0178), `assert_is_active_member()` (0180), `stamp_org_id()` (0074), `may_record_project_progress(uuid)` (0245), the `boq_items` table and its parent-org trigger (0250).
- **App:** `pmo-portal/{App.tsx, pages/Companies.tsx, pages/project-detail/{projectDetailAreas.ts, ProjectSections.tsx, BoqItemFormModal.tsx}, e2e/helpers.ts}`, `pmo-portal/src/{auth/policy.ts, auth/coarseRoles.ts, lib/db/{companies.ts, progressBilling.ts, vendorWithholdingSlips.concurrent.integration.mjs}, lib/repositories/{index.ts, types.ts}, lib/{format.ts, projectFinances.ts, classifyMutationError.ts, appError.ts}, lib/i18n/index.ts, hooks/useProgressBilling.ts, components/shell/{Rail.tsx, routeMatch.ts}, components/ui/{Combobox, FormFields, MobileActionBar, ListPage, ListState, PageHeader, ErrBanner}.tsx}`, `pmo-portal/public/locales/{en,id}/{common,projectTabs}.json`.
- **Not present at `origin/dev` and therefore marked "(new)" or listed under a slice:** everything named `stock*` (migrations `0411`-`0417`, their rollbacks, `supabase/tests/stock_*.test.sql`, `supabase/tests/perf/stock_consumption_explain.sql`, `scripts/stock-*.mjs`, `pmo-portal/src/lib/db/stock*.ts`, `pmo-portal/src/lib/stock*.ts`, `pmo-portal/src/hooks/useStock.ts`, `pmo-portal/src/components/stock/*`, `pmo-portal/pages/stock/*`, `pmo-portal/pages/project-detail/tabs/MaterialsTab.tsx`, `pmo-portal/pages/project-detail/MaterialAllowanceModal.tsx`, `pmo-portal/public/locales/{en,id}/stock.json`, `pmo-portal/e2e/AC-STK-*.spec.ts`, `docs/adr/0097-stock-ledger-and-ownership-split.md`).
- **Collision scan across remote branches (2026-10-31):** migrations `0408` (`feat/billing-kinds`, will renumber to `0410`) and `0409` (dev) are the only numbers at or above `0408` in use; **ADR-0096 is taken on `feat/posthog-s0`**, hence ADR-0097 here. `spec/odoo-connect-master-data` and `spec/budget-push-v16` were not scanned for planned numbers: slices re-check at start.
