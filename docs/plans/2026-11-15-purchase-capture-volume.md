# Purchase capture at ten times today's volume — implementation plan (#2286)

**Status: draft for owner sign-off. No build has started.** Parent: #2195 (record-only purchases and capture), map #450.
Money tier: the apply batch, the capture fence and its trigger are on the money path. This plan ships as **two PRs**
(see owner question 1): **PR A** covers the read path (items 1, 2, 6, 7 and the read half of 8) and **PR B** covers apply, the lock and resume
(items 3, 4, 5, the trigger half of 8, and 9 if the owner approves). Each PR ships alone with spec-reviewer, code-quality-reviewer and
security-auditor. The ceiling is `dev`.

**What does not change:** RPC names, the edge function's request and response fields (apart from the new fields listed below),
the revision value (`capture_revision(org)`, the same SHA-256 over the same facts), the fence lock keys, Admin-only access, and
`erp_write: false` on every response. PMO still writes nothing to the ERP.

## 1. What was read (the deciding artifacts)

| Artifact | What it decides |
|---|---|
| `supabase/functions/purchase-capture/index.ts` (dev `b321ac02`; last capture fixes `523ac8b6`, `b2b4089a`; B1 merge `78ff44236`) | Orchestrates preview, report, apply and assign. Reads sources in pages of 500 (up to 20 pages) and ledger lines in pages of 500 (up to 20 pages), makes one final revision witness call, then indexes the results in memory. |
| `supabase/migrations/0873_capture_revision_fingerprint.sql` `purchase_capture_source_page` | Source page. Calls `capture_revision(v_org)` on **every** page. The family check `d.erp_name = any(invoice.purchase_orders)` uses no index, and `capture_source_kind(x.erp_doctype)='order'` cannot be used as an index predicate. The supplier lookup joins on `c.id::text = x.pmo_record_id`. |
| `supabase/migrations/0882_capture_invoice_assignment.sql:81` `capture_revision` | Serializes every fingerprinted org row (including all ledger lines, about 15k at 10x) to text, then hashes it. |
| `supabase/migrations/0866_erp_purchase_capture.sql:361` `purchase_capture_ledger_page` | Ledger page. Each page calls `purchase_capture_source_page(null,null,1)` only to get the revision, so it pays for a full fingerprint plus a one-row source page. Each line runs a lateral `jsonb_each_text(project_map)` with a regex. The page reads **every** ledger line of the org, purchase-related or not. |
| `supabase/migrations/0866_erp_purchase_capture.sql:602` `capture_history_batch` | Takes the **exclusive** `capture-fence:<org>` lock for the whole call. A newly created batch computes the revision three times (before insert, after insert, at the end). A call processes up to 25 groups or 500 sources. |
| `supabase/migrations/0868_captured_invoice_payment.sql:707` `capture_history_apply_internal` | Applies one group. Calls `purchase_capture_feed_health()` twice per group (two checks, one read each). |
| `supabase/migrations/0866_erp_purchase_capture.sql:553` `fence_capture_source_change` | A per-row trigger on 22 tables. It runs `to_jsonb(old)` / `to_jsonb(new)` on every row only to read `org_id`. |
| `supabase/functions/erpnext-sweep/index.ts:2128` | Records the ledger feed completion only when `statementReady` is true (chart, references, no statement errors, GL and payment-ledger caught up). |
| `scripts/lib/pmo-capture.mjs:2` `captureHistory` | After an apply, it always reads `report` again, even when the apply stopped part-way. |
| Existing indexes | `erp_gl_entry_mirror_org_voucher_idx (org_id, voucher_type, voucher_no)`, `erp_purchase_documents unique (org_id, erp_doctype, erp_name)`, `erp_journal_line_links_one_purchase unique (org_id, erp_doctype, voucher_no, project_id, account)`, `procurement_erp_links_one_purchase unique (erp_purchase_document_id)`, GIN on `erp_purchase_documents(project_ids)`. **There is no index on `erp_purchase_documents(purchase_orders)`.** |
| `supabase/tests/2195_capture_volume.test.sql` | The existing 10x fixture (970 documents, 15,370 ledger lines, 1,470 accounts, 3,379 refs) with an 8-second statement limit per call. It sets no target for the total time. |
| `supabase/migrations/0882_capture_invoice_assignment.sql:1049` `api_client_request_guard` | The guard lists capture RPCs **by name** (`capture_read_rpcs`, `capture_assign_rpcs`). |
| `scripts/prior-art.sh capture` | Found no prior ruling on capture volume. The only capture rulings are the record-change capture decision (`docs/decisions.md:3157`), which does not apply here. |

What item 6 found ("ledger lookups by voucher have no matching index"): the GL voucher index already exists. The real gap is the
**family lookup** `= any(purchase_orders)`, which has no index. Task A6 changes that lookup to an indexable `@>` against a new GIN index.
Task A0 decides whether a voucher scan remains, from the EXPLAIN output and not from a guess.

**Working hypothesis (Task A0 must confirm or reject it before any fix):** most of the time goes into repeating `capture_revision`.
A whole-org preview at 10x computes it about **34 times**: 2 source pages, 31 ledger pages and 1 witness. An apply adds the full
preview again, then 2 to 3 more computations per batch call, all under the exclusive lock. Cutting the number of pages (item 1) and
the redundant calls removes most of it **without weakening the per-page revision check**.

## 2. Spec additions

These IDs extend the record-only purchases spec (`docs/specs/erp-record-only-purchases.spec.md`, on branch
`docs/2195-record-only-purchases`) under a new prefix `CAPV`, so they cannot collide with the `ROP` series. The build copies this
section into that spec once it is on `dev`.

### Functional requirements (EARS)

- **FR-CAPV-001** — When an Admin requests a capture preview or report, the capture service shall read only the **capture-relevant**
  ledger lines line by line. A line is capture-relevant when any of these is true: its company differs from the binding company;
  it resolves to a mapped PMO project; it belongs to a mirrored purchase document; or its voucher kind is order, receipt or supplier invoice.
- **FR-CAPV-002** — When the capture service reads ledger lines in the capture scope, it shall return, on the first page, a count and
  an exact net total (debit minus credit) for each voucher kind among the lines left out of the line-by-line read. The total shall be
  null when any of those lines has no debit or no credit.
- **FR-CAPV-003** — The capture service shall produce the same `proposals`, `reports`, `assignments`, `unassigned`, `other_unassigned`,
  `unassigned_documents`, `missing` and `revision` for the same database state as before this change.
- **FR-CAPV-004** — When an apply request names a batch that already exists, the capture service shall continue that batch
  without reading the census and ledger again. It shall still check that the revision, the feed health and the ERP precision equal
  what the batch recorded.
- **FR-CAPV-005** — When an apply call stops before the batch is complete, the capture service shall return `resume: true`,
  `next_index`, `group_count`, and `sources_per_call: 500`. The CLI shall then print how many groups are done out of the total and the
  exact command that continues the batch.
- **FR-CAPV-006** — When an apply stops before the batch is complete, the CLI shall not read the report.
- **FR-CAPV-007** — While the capture fence is held exclusively by an apply batch, the batch shall compute the revision only at the
  points where the database could have changed: once before its first group (once in total for a new batch) and once after its last group.
- **FR-CAPV-008** *(only if owner question 2 is approved)* — When the ledger feed of a sweep run has caught up, with the chart and the
  references ready, the sweep shall record the ledger feed completion even when a financial-statement publication step reported an error.

### Non-functional requirements

- **NFR-CAPV-001** — On the seeded 10x fixture, a whole-org preview shall spend **at most 8 s** in total database time across all
  its RPC calls (today about 22 s for the ledger alone), and no single capture RPC call shall exceed **2 s**. The measured method is §3. Targets are pending owner question 3.
- **NFR-CAPV-002** — On the seeded 10x fixture, one `capture_history_batch` call of 25 groups shall hold the exclusive fence for
  **at most 2 s**, and a resume call shall spend **at most 1 s** in the edge function before its first batch RPC.
- **NFR-CAPV-003** — An in-process preview over 15,000 ledger lines and 1,000 sources shall finish its in-memory indexing and
  reconciliation in **at most 300 ms**. It shall make no more than one linear pass per index it builds (no `find`/`filter` over ledger or sources inside a per-row loop).
- **NFR-CAPV-004** — Rewriting the GL mirror (an upsert of 15,000 unchanged rows) shall spend at least 50% less time in the fence
  trigger than before, as shown by `EXPLAIN (ANALYZE)` trigger timing. It shall take exactly the same advisory locks.
- **NFR-CAPV-005** — None of the following shall change, and each keeps its named proof green with no edit to its assertions:
  authorization, the revision fence, batch idempotency, SoD, money totals, and "nothing written to the ERP" (§6).

### Acceptance criteria (Given/When/Then)

- **AC-CAPV-001** (FR-CAPV-001, FR-CAPV-002) — *Given* an org with 15,370 ledger lines of which 11,000 are unrelated journals and
  payments with no project, *when* an Admin reads the ledger in the capture scope, *then* the pages hold only the capture-relevant lines,
  and the first page's `other_summary` gives each left-out kind with its count and exact net total.
- **AC-CAPV-002** (FR-CAPV-003) — *Given* the seeded 10x fixture, *when* the preview and the report run before and after the change,
  *then* every response field listed in FR-CAPV-003 is identical (a stored golden response).
- **AC-CAPV-003** (FR-CAPV-002) — *Given* a left-out journal line with no debit, *when* the capture-scope ledger is read, *then* that
  kind's total is null, its count is still correct, and the preview still completes.
- **AC-CAPV-004** (FR-CAPV-004) — *Given* an apply that stopped after 25 groups, *when* the same apply command runs again, *then* the
  edge function makes no source-page or ledger-page call before the batch continues, and the batch processes the next groups.
- **AC-CAPV-005** (FR-CAPV-004) — *Given* an apply that stopped part-way, *when* any fingerprinted fact changes and the same apply
  runs again, *then* the batch refuses with `review_stale_or_incomplete` and creates nothing.
- **AC-CAPV-006** (FR-CAPV-004) — *Given* an apply that stopped part-way, *when* the ERP currency precision changes and the same
  apply runs again, *then* the batch refuses with `precision_changed`.
- **AC-CAPV-007** (FR-CAPV-005, FR-CAPV-006) — *Given* an apply that stops part-way, *when* the CLI prints the result, *then* it says
  "groups X of Y applied (up to 500 sources per call)", prints the continue command, and makes no `report` call.
- **AC-CAPV-008** (FR-CAPV-007) — *Given* a new batch of 25 groups, *when* `capture_history_batch` runs, *then* the revision is
  computed exactly twice in that call (counted through a test-only counter on a wrapper), and the result is identical to before.
- **AC-CAPV-009** (NFR-CAPV-001, NFR-CAPV-002) — *Given* the seeded 10x fixture, *when* the benchmark runs, *then* the before and
  after timings and EXPLAIN plans are recorded in §8 of this plan and meet the NFR targets.
- **AC-CAPV-010** (NFR-CAPV-004) — *Given* the fence trigger, *when* any of the 22 fenced tables is written, *then* the same
  shared `capture-fence:<org>` lock is taken for the old and new org, and `organizations` still uses its own `id`.
- **AC-CAPV-011** (FR-CAPV-008, conditional) — *Given* a sweep run where the GL and payment ledger caught up and the statement publish
  failed, *when* the run ends, *then* the ledger feed completion is recorded, and a run where the chart is not ready records none.

## 3. Measured before/after method

The same method runs twice. **Before:** on `origin/dev` at the branch point, before any change (Task A0). **After:** at the end of each PR
(Tasks A9 and B7). Results go into §8 as a table, together with the EXPLAIN plan excerpts (node type, rows, time, buffers).
Timings vary from one run to the next, so each figure is the **median of 5 runs** on the local Supabase stack, measured under
`scripts/with-db-lock.sh`.

1. **Seed.** `scripts/bench/2286-capture-volume-seed.sql` builds the same fixture as `2195_capture_volume.test.sql`: 970 purchase
   documents, 15,370 ledger lines, 1,470 accounts and 3,379 refs. On top of that it adds **11,000 unrelated no-project journal and
   payment lines**, so that item 1 is tested where it matters. It works in its own org id `22860000-…` and runs inside `begin; … rollback;`,
   so nothing persists.
2. **DB timings.** `scripts/bench/2286-capture-volume.sql` times every call of a whole-org preview with `clock_timestamp()` deltas:
   each source page, each ledger page, the feed health read, the witness call, `capture_history_batch` (a new batch of 25 groups, then
   a resume) and an unchanged 15,000-row GL upsert. It emits one `\echo` line per call (`call,ms`) and the totals.
3. **EXPLAIN.** For the first ledger page, the first source page, `capture_revision`, one batch call and the GL upsert:
   `explain (analyze, buffers, format text)`. The upsert's output includes the `Trigger capture_census_fence: time=… calls=…` line.
4. **Edge in-process time.** `supabase/functions/purchase-capture/volume.bench.ts` (`deno bench`) feeds the real handler mocked RPC
   responses at 1,000 sources and 15,000 lines, using the same fetch-mock pattern as `index.test.ts`, and measures the handler's own CPU.
5. **Counts.** The bench counts RPC calls per action (preview, apply-new, apply-resume) and how many times the revision is computed,
   using `pg_stat_user_functions` with `track_functions = 'pl'` set for the session. These counts are deterministic and are the
   assertions; the timings are evidence.

Command (run each time, from the repo root):

```bash
scripts/with-db-lock.sh bash -c 'for i in 1 2 3 4 5; do psql "$(supabase status -o env | sed -n "s/^DB_URL=\"\(.*\)\"/\1/p")" -X -q -f scripts/bench/2286-capture-volume.sql; done' > /tmp/2286-bench-$(git rev-parse --short HEAD).txt
deno bench --allow-env --allow-read supabase/functions/purchase-capture/volume.bench.ts
```

## 4. Design

**A. Read path (PR A, no change to the lock)**

1. *Scoped ledger read (item 1, item 7).* Add `p_scope text default 'all'` to `purchase_capture_ledger_page`. With `'capture'`, only
   FR-CAPV-001 lines are paged, and page 1 also carries `other_summary`, an aggregate over the lines left out. The edge function sends
   `'capture'` and builds `other_unassigned` from `other_summary`. It still runs the same `netTotal` formatting on the total, so the
   output keeps the same digits (the columns are `numeric(14,2)`). The default `'all'` keeps the old behaviour for any other caller. The signature
   changes, so the migration **drops** the old 3-argument function (otherwise PostgREST sees two overloads) and re-grants
   `authenticated`. The function name is unchanged, so `api_client_request_guard` is untouched.
2. *Revision once per ledger page, without the source page.* Replace `public.purchase_capture_source_page(null,null,1)->>'revision'`
   with `public.capture_revision(v_org)` in the ledger page. This is the same value: the source page sets `v_generation := capture_revision(v_org)`.
   The per-page revision check **stays**.
3. *Project map once.* Replace the per-row lateral `jsonb_each_text` + regex with one CTE of `(erp_project → pmo project)` for the
   binding, keeping only names mapped to exactly one id, joined by hash. The resolution rule is the same (a name mapped twice resolves to none).
4. *Source page indexes (items 6, 8).* Add a GIN index on `erp_purchase_documents (purchase_orders)`. Rewrite
   `d.erp_name = any(invoice.purchase_orders)` as `invoice.purchase_orders @> array[d.erp_name]`. Rewrite
   `capture_source_kind(x.erp_doctype)='order'` as `x.erp_doctype = 'Purchase Order'` (and `'Purchase Invoice'` for supplier invoices),
   which is exactly what `capture_source_kind` maps. Rewrite the supplier lookup so it selects `external_refs` through
   `external_refs_org_domain_ext_idx` and joins `companies` on `c.id = case when x.pmo_record_id ~* '<uuid>' then x.pmo_record_id::uuid end`,
   which uses the companies primary key. The output is the same.
5. *Edge indexing (item 2).* Build `ledgerByDocument: Map<string, Line[]>`, `ledgerById`, `sourcesById`, `mappedById`,
   `proposalsById` and `ledgerByProject` once, and replace every `find`/`filter` inside a loop. The logic is otherwise the same.

**B. Apply, lock, resume (PR B, money tier)**

6. *Resume without a re-read (items 3, 5).* `capture_history_batch` with `p_precision = null` becomes a **probe**. It returns
   `batch_not_found`, or `batch_found` with `precision_kinds` (the keys of the stored precision), and does nothing else. On apply,
   the edge function first probes. If the batch is found, it reads the ERP precision for exactly those kinds and calls the batch with
   `p_groups = null`. The batch keeps every check: actor, request conflict, `precision_changed`, `batch_contains_undone_capture`,
   revision against `current_revision`, and feed health. A probe takes the fence **shared**, not exclusive, because it only reads one
   batch row. If no batch is found, the flow is today's: full read, then a call with groups.
7. *Fewer revision computations under the lock (item 4).* In `capture_history_batch`, when the batch row was inserted in this same
   call, skip the second revision and health check: the exclusive fence is held, so no fenced write can happen between them. Use
   `capture_revision(v_org)` directly instead of the source page. In `capture_history_apply_internal`, read feed health once per group, not twice.
8. *Output (item 5).* The batch returns `group_count`, and the edge function adds `sources_per_call: 500`. `captureHistory` in
   `scripts/lib/pmo-capture.mjs` skips the report when `resume === true || complete !== true`, and prints the progress line and the continue command.
9. *Fence trigger cost (item 8).* `fence_capture_source_change()` reads `old.org_id` / `new.org_id` directly. A new
   `fence_capture_org_change()` is used on `organizations` only (`id`). Same lock key, same order (distinct, sorted), same tables.
10. *Feed completion (item 9, only if owner question 2 is approved).* In `erpnext-sweep`, gate `record_capture_feed_completion` on
    `chartReady && referencesCheckedBefore && referencesResolved && glCaughtUp && pleCaughtUp && !rawError`, so statement
    publication errors no longer block it. A failed completion write still goes into `statementErrors`.

**Tradeoffs.** Scoping the read keeps the per-page revision control and cuts the page count, instead of weakening the control by
sampling the revision less often. Content hashing stays because an unchanged hourly resync has to keep the same revision; a write counter
would move it every hour. A write counter would also make concurrent writers in one org wait on a single row. The probe call costs one
cheap extra RPC on a new apply in exchange for a resume that does no re-read. **No ADR:** nothing here is architectural or irreversible.
Every change is behind the same RPC names and has a down migration.

## 5. Guard chain

**`api_client_request_guard()`'s body does not change.** Every RPC keeps its name, and the guard matches by name. If, during the build,
any task finds it needs a **new** RPC name (none is planned), it must stop and come back to the Director. That migration would then be
placed **after #1857's** guard migration in the chain and would carry the `api_client_request_guard.test.sql` update.

## 6. Correctness controls that must not change, and their proofs

None of these files may have an assertion edited. Each runs green at the end of every PR.

| Control | Proof (owning test) |
|---|---|
| Admin-only, active member, live authorization | `supabase/tests/2195_capture_authorization.test.sql`; the 401/403 cases in `supabase/functions/purchase-capture/index.test.ts` |
| Revision fingerprint covers the same facts | `supabase/tests/2195_capture_revision.test.sql` (moved-revision cases per table) |
| Fence: writers shared, apply exclusive | `supabase/tests/2195_capture_fence.test.sql`, `supabase/tests/2195_capture_census.test.sql` |
| Batch idempotency, request conflict, stale review, undone capture | `supabase/tests/2195_capture_batch.test.sql` |
| Money totals and reconciliation (ledger vs documents, bridge, journals) | `pmo-portal/src/lib/adapterSeam/captureHistory.test.ts`, `captureHistory.contract.test.ts`, `supabase/tests/2195_capture_ledger.test.sql`, `supabase/tests/2195_b1_ledger.test.sql`, `supabase/tests/2195_b1_performance.test.sql` (independent sum) |
| SoD and record-only: a capture never dispatches to the ERP nor enters approval | `pmo-portal/src/lib/adapterSeam/dispatch.captured.test.ts`, `supabase/tests/2195_capture_purchases.test.sql`, the B1 "never calls the ERP or queues dispatch" cases in `index.test.ts` |
| Statement limits at 10x | `supabase/tests/2195_capture_volume.test.sql` (AC-ROP-065/066) |
| Unassigned blocking vs information-only lines | `index.test.ts` AC-ROP-073 cases |

A mutation check (Task B6) breaks the revision comparison on resume (`if false and v_current is distinct from …`). `2195_capture_batch.test.sql`
and AC-CAPV-005 must go red. The change is then reverted.

## 7. Tasks

Commands and conventions: pgTAP runs through `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` from the
repo root, as **one lock hold**. Deno runs with `deno test --allow-env --allow-net --allow-read <file>`. Vitest runs from `pmo-portal/`
as `npx vitest run <file>`. The CLI tests run with `node --test <file>`. Migrations are named `NNNN_capture_volume_reads.sql` (PR A)
and `MMMM_capture_volume_apply.sql` (PR B), each with a `_down.sql` next to it as in 0882. **The numbers are assigned on request** by
the Director when the build starts. For every task: write the failing test, see it fail for the expected reason, write the minimum code,
then see it pass.

### PR A — read path

**A0 — baseline (before any change).** Create `scripts/bench/2286-capture-volume-seed.sql` (the seed from §3.1, copied from
the seed section of `2195_capture_volume.test.sql` (everything before its first assertion), plus the 11,000 unrelated lines) and `scripts/bench/2286-capture-volume.sql`, which does `\i` on the seed
and runs the timed calls and EXPLAINs. Run the §3 commands on `origin/dev` and record the "before" numbers and plan excerpts in §8.
Accept the hypothesis in §1 only if the revision calls take more than 50% of the preview's DB time. If they do not, stop and send the
numbers to the Director before A1.

**A1 — golden preview (characterization).** In `supabase/functions/purchase-capture/volume.test.ts`, build the 10x mocked RPC
responses with `pmo-portal/src/lib/adapterSeam/__fixtures__/capture10x.ts` (a seeded, deterministic generator), call
`handlePurchaseCaptureRequest` for `preview` and `report`, and compare against `supabase/functions/purchase-capture/__golden__/preview10x.json`.
Generate the golden file from **unchanged** code and commit it (AC-CAPV-002). Run it with `deno test --allow-env --allow-net --allow-read supabase/functions/purchase-capture/volume.test.ts`. It passes now and has to keep passing.

**A2 — edge indexing (item 2).** Add a pass-count assertion to `volume.test.ts`: wrap `ledger.items` in a counting proxy and require
at most 3 full iterations per request (NFR-CAPV-003). This fails today. Then refactor `index.ts` as in §4.5:

```ts
const ledgerByDocument = new Map<string, CaptureLedgerEvidence[]>();
const ledgerById = new Map<string, CaptureLedgerEvidence>();
for (const line of ledger.items) {
  ledgerById.set(line.id, line);
  if (line.documentId) (ledgerByDocument.get(line.documentId) ?? ledgerByDocument.set(line.documentId, []).get(line.documentId)!).push(line);
}
const sourcesById = new Map(sources.map(source => [source.id, source]));
// classifications: const related = ledgerByDocument.get(source.id) ?? [];
// describe(): ledgerById.get(entry.id), sourcesById.get(line?.documentId ?? '')
```

The golden test and all 42 cases of `index.test.ts` stay green.

**A3 — failing pgTAP for the scoped ledger.** Create `supabase/tests/2286_capture_ledger_scope.test.sql` with a small fixture:
one mapped-project journal line, one purchase invoice line with no project, one line of another company, two unrelated payments
(7.00 and 3.50) and one journal with a null debit. Assert the following:
`purchase_capture_ledger_page(null,500,null,'capture')` returns exactly the first three lines, and `other_summary` equals
`[{"kind":"journal","count":1,"total":null},{"kind":"supplier_payment","count":2,"total":"10.50"}]` (AC-CAPV-001, AC-CAPV-003). Also assert that
`'all'` returns all six lines in `id` order. This must fail with "function does not exist".

**A4 — migration: the scoped ledger page.** In `supabase/migrations/NNNN_capture_volume_reads.sql`, add
`drop function public.purchase_capture_ledger_page(uuid,integer,uuid);` and recreate it with
`p_scope text default 'all'` (`check p_scope in ('all','capture')`, otherwise `22023`). Revision is `public.capture_revision(v_org)`.
Project map:

```sql
with map as (
  select entry.value as erp_project, min(entry.key)::uuid as project_id
  from public.external_org_bindings b cross join lateral jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) entry
  where b.id = v_binding and entry.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  group by entry.value having count(distinct entry.key) = 1
), lines as (
  select g.*, d.id as document_id, l.procurement_id as document_purchase_id, case when g.company = v_company then map.project_id end as project_id
  from public.erp_gl_entry_mirror g
  left join public.erp_purchase_documents d on g.company = v_company and d.org_id = g.org_id and d.erp_doctype = g.voucher_type and d.erp_name = g.voucher_no
  left join public.procurement_erp_links l on l.erp_purchase_document_id = d.id
  left join map on map.erp_project = g.project
  where g.org_id = v_org and not g.is_cancelled
), scoped as (
  select *, (company is distinct from v_company or project_id is not null or document_id is not null
     or public.capture_source_kind(voucher_type) in ('order','receipt','supplier_invoice')) as relevant from lines
)
```

Keep the journal-link and account-classification joins exactly as at `0866:385–392`, applied to the page rows. When
`p_scope='capture'`, page `where relevant`, and on the first page (`p_cursor is null`) add
`other_summary` = `jsonb_agg` over `not relevant` grouped by `capture_source_kind(voucher_type)` (null kind → `'other'`), with
`count(*)` and `case when bool_or(debit is null or credit is null) then null else (sum(debit) - sum(credit))::text end`, ordered by kind.
Then `revoke all … from public, anon; grant execute … to authenticated;`. The `_down.sql` drops the 4-argument function and restores
the `0866:361–404` body exactly. Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2286_capture_ledger_scope.test.sql supabase/tests/2195_capture_ledger.test.sql supabase/tests/2195_capture_volume.test.sql supabase/tests/2195_b1_ledger.test.sql'`.

**A5 — edge uses the scope.** In `index.test.ts`, add a case where the mocked ledger RPC asserts `p_scope === 'capture'` and returns
`other_summary`, and expect `other_unassigned` to be built from it. The existing AC-ROP-073 cases are converted to give the same
lines through `other_summary`, with the same expected output and the assertions unchanged. In `index.ts`, pass `p_scope: 'capture'`
and map `data.other_summary` from page 1 through `netTotal`-equivalent formatting (`formatNet(total)` = pad to two decimal places; null stays null).
Then remove the `otherByKind` loop. The golden test (A1) must stay green, with the golden mocks regenerated to the scoped shape
**from the same seeded generator**, and the expected JSON file unchanged.

**A6 — failing pgTAP for source-page indexes.** Create `supabase/tests/2286_capture_source_index.test.sql`. Assert that
`pg_indexes` has `erp_purchase_documents_purchase_orders_idx` (GIN). Using the 970-document fixture, run
`explain (format json)` of the family subquery and assert that it uses that index and not a `Seq Scan` on `erp_purchase_documents`,
following the plan-walk pattern of `2195_b1_performance.test.sql`. It fails today.

**A7 — migration: source page.** Append to `NNNN_capture_volume_reads.sql`:
`create index erp_purchase_documents_purchase_orders_idx on public.erp_purchase_documents using gin (purchase_orders);`. Then
`create or replace function public.purchase_capture_source_page`, copied from `0873:49–119` with exactly these replacements:
`public.capture_source_kind(orders.erp_doctype)='order'` → `orders.erp_doctype='Purchase Order'`;
`public.capture_source_kind(invoice.erp_doctype)='supplier_invoice'` → `invoice.erp_doctype='Purchase Invoice'`;
`d.erp_name=any(invoice.purchase_orders)` → `invoice.purchase_orders @> array[d.erp_name]`; and the supplier subquery becomes
`from public.external_refs x join public.companies c on c.id = case when x.pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then x.pmo_record_id::uuid end and c.org_id = x.org_id`.
The down migration drops the index and restores the `0873` body. Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2286_capture_source_index.test.sql supabase/tests/2195_capture_matching.test.sql supabase/tests/2195_capture_purchases.test.sql supabase/tests/2195_capture_revision.test.sql supabase/tests/2195_capture_volume.test.sql'`.

**A8 — rollback proof.** Add `scripts/2286-capture-volume-rollback.test.sql` and a runner `scripts/test-2286-capture-rollback.sh`,
following `scripts/test-2195-b1-rollback.sh`. It applies the up migration, then the down migration, and asserts that the 3-argument
signature exists again, that the GIN index is gone, and that `purchase_capture_source_page` returns the same JSON on a two-document
fixture before and after. Run: `scripts/with-db-lock.sh scripts/test-2286-capture-rollback.sh`.

**A9 — measure after, and gates.** Rerun §3 and record the "after A" column and plans in §8. Then run the §6 proofs for the files PR A
touches, the local final gate (`npm run check:guards`, `npm run typecheck`,
`npx eslint --max-warnings=0 supabase/functions/purchase-capture/index.ts supabase/functions/purchase-capture/volume.test.ts`), and
`deno test --allow-env --allow-net --allow-read supabase/functions/purchase-capture/`. Hand over to the three reviewers.

### PR B — apply, lock, resume (money tier, ships alone)

**B1 — failing pgTAP: probe and resume.** Create `supabase/tests/2286_capture_batch_resume.test.sql` from the
`2195_capture_batch.test.sql` fixture, with 30 groups. Assert the following:
(a) `capture_history_batch(actor, null, req, rev, null, null)` returns `batch_not_found` and writes nothing;
(b) after a first call with groups, which processes 25, the probe returns `batch_found` with `precision_kinds` equal to `["order","supplier_invoice"]`;
(c) a resume with `p_groups=null` processes the remaining 5 and returns `group_count` 30 and `complete` true;
(d) after an insert into `erp_purchase_document_marks` between the calls, the resume returns `review_stale_or_incomplete` and creates no purchase (AC-CAPV-005);
(e) a resume with changed precision returns `precision_changed` (AC-CAPV-006).

**B2 — failing pgTAP: revision count.** Create `supabase/tests/2286_capture_batch_revision_count.test.sql`. With
`set local track_functions = 'pl'`, read `pg_stat_xact_user_functions.calls` for `capture_revision` before and after one new 25-group
batch call, and assert the difference is `2` (AC-CAPV-008). Today it is 3 through the source page. Also assert that the batch result JSON equals the result stored for the same fixture.

**B3 — migration: batch and apply.** In `MMMM_capture_volume_apply.sql`, `create or replace function public.capture_history_batch`,
copied from `0866:602–692` with these changes:
the probe branch, placed right after the actor checks (if `p_precision is null`: take
`pg_advisory_xact_lock_shared(hashtextextended('capture-fence:'||v_org::text,0))`, then return `batch_found` with
`(select jsonb_agg(k order by k) from jsonb_object_keys(v_batch.precision) k)` or `batch_not_found`). Note that the probe branch has to come
**before** the existing exclusive lock, which then moves below it. Every `public.purchase_capture_source_page(null,null,1)->>'revision'` becomes `public.capture_revision(v_org)`;
the `set_config` claims swap stays only around `purchase_capture_feed_health()`. A boolean `v_created` is set in the insert branch,
and the second check is skipped when it is true. Add `'group_count', v_group_count` to the final object. In
`capture_history_apply_internal` (body from `0868:707`), read `v_health := public.purchase_capture_feed_health()` once and test
`caught_up` and `ledger_currency` from it. The down migration restores both bodies exactly. Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2286_capture_batch_resume.test.sql supabase/tests/2286_capture_batch_revision_count.test.sql supabase/tests/2195_capture_batch.test.sql supabase/tests/2195_capture_fence.test.sql supabase/tests/2195_capture_volume.test.sql supabase/tests/2195_capture_purchases.test.sql'`.

**B4 — fence trigger.** Create `supabase/tests/2286_capture_fence_trigger.test.sql`. For each of the 22 fenced tables (the `0866:575` list minus the three snapshot tables dropped in `0873:123–125`, plus
`erp_capture_invoice_assignments`), assert that a `capture_census_fence` trigger exists. Assert that `organizations` uses
`fence_capture_org_change` and every other table uses `fence_capture_source_change`. Assert that an update moving a row between two orgs
holds the shared locks for both orgs, checked in `pg_locks` with `locktype='advisory'` (AC-CAPV-010). This fails today on the
function name. In `MMMM_capture_volume_apply.sql`:

```sql
create or replace function public.fence_capture_source_change() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid;
begin
  for v_org in select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.org_id end, case when tg_op <> 'DELETE' then new.org_id end]) x where x is not null order by x loop
    perform pg_advisory_xact_lock_shared(hashtextextended('capture-fence:' || v_org::text,0));
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
```

Add `fence_capture_org_change()`, the same with `old.id`/`new.id`. Recreate the `organizations` trigger on it, and revoke both
functions from `public, anon, authenticated, service_role`. The down migration restores the `0866:553` body and the trigger.
Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2286_capture_fence_trigger.test.sql supabase/tests/2195_capture_fence.test.sql supabase/tests/2195_capture_census.test.sql supabase/tests/2195_capture_isolation.test.sql'`.

**B5 — edge resume and CLI output.** In `index.test.ts`, add AC-CAPV-004: the RPC mock records its calls, an apply whose probe returns
`batch_found` makes **no** call to `purchase_capture_source_page` or `purchase_capture_ledger_page`, reads precision only for
`precision_kinds`, and returns `resume`, `next_index`, `group_count` and `sources_per_call: 500`. In `scripts/pmo-capture.test.mjs`,
add AC-CAPV-007: for a `resume: true` result, `captureHistory` makes no `report` call, and the formatter prints
`groups 25 of 30 applied (up to 500 sources per call)` followed by the same apply command. Then implement this in `index.ts` (probe before the full read,
resume path) and in `scripts/lib/pmo-capture.mjs`:

```js
const result = await api.capture(payload);
if (dryRun || result.resume === true || result.complete !== true) return result;
```

Add the progress line to the formatter, and document it in `docs/runbooks/pmo-cli.md` under the capture section. Run:
`deno test --allow-env --allow-net --allow-read supabase/functions/purchase-capture/index.test.ts` and `node --test scripts/pmo-capture.test.mjs scripts/pmo.test.mjs`.

**B6 — mutation check.** Temporarily change the resume revision comparison in the batch to `if false and v_current is distinct from …`.
`2195_capture_batch.test.sql` and `2286_capture_batch_resume.test.sql` (d) must go red. Revert the change and record the red output in the PR body.

**B7 — feed completion (only if owner question 2 is approved).** In `supabase/functions/erpnext-sweep/index.test.ts`, add AC-CAPV-011:
with GL and payment ledger caught up and the statement publish failing, `record_capture_feed_completion` is called for `ledger`; with
`chartReady` false, it is not. Then change the gate at `erpnext-sweep/index.ts:2131` as in §4.10. Run:
`deno test --allow-env --allow-net --allow-read supabase/functions/erpnext-sweep/index.test.ts`.

**B8 — measure after, and gates.** Rerun §3 and record the "after B" column in §8. Run the full §6 proof list as targeted files
(it is the money tier), plus `supabase/tests/0137_service_role_grants.test.sql` and `supabase/tests/api_client_request_guard.test.sql`,
which must stay unchanged and green, and the local final gate. Hand over to the three reviewers. The PR body names every control from §6 with its run.

## 8. Measurements (filled in by A0, A9 and B8)

| Call (10x seed, median of 5) | Before | After A | After B |
|---|---|---|---|
| Source page ×N (ms each / total) | ×2: 486 max / 948 | ×2: 472 max / 932 | |
| Ledger page ×N (ms each / total) | ×53: about 435 each, 577 max / 23,041 | ×16 (`'capture'`): about 420 each, 547 max (page 1, with the summary) / 6,816 | |
| `capture_revision` (ms; calls per preview) | 449; 56 calls | 381; 19 calls | |
| Whole-org preview, DB total (ms) | 24,415 | **8,123** (runs 7,818–8,313) | |
| Batch, new 25 groups (ms = fence hold) | 1,848 (`capture_revision` 5 and feed health 63 calls across new + resume) | 1,824 (unchanged; PR B) | |
| Batch resume (ms) and edge time before the first batch RPC | 950 (last 5 groups); edge time not measured in PR A | 1,064 (unchanged; PR B) | |
| GL upsert 15k rows: fence trigger time (ms) | 714 (30,000 calls; upsert 1,976) | 668 (unchanged; PR B) | |
| Edge in-process preview (ms, `deno bench`) | 243 avg (1,000 sources, 9,616 lines); the 14,816-line fixture stops at the 20-page ledger limit | 43–46 avg on both fixtures; the 14,816-line one now completes | |

Seed and method: `scripts/bench/2286-capture-volume-seed.sql` is the `2195_capture_volume.test.sql` fixture plus 11,000 unrelated
no-project journal and payment lines (26,370 ledger lines in total), analyzed inside the rolled-back transaction. Timings are
`clock_timestamp()` deltas per call inside one transaction on the local stack (`scripts/bench/2286-capture-volume.sql`, run 5 times
under `scripts/with-db-lock.sh`); call counts come from `pg_stat_xact_user_functions` with `track_functions = 'all'` and are identical
in all 5 runs.

**A0 finding (before).** `capture_revision` took 360–480 ms per call and ran 56 times in one whole-org preview (2 source pages,
53 ledger pages through `purchase_capture_source_page(null,null,1)`, 1 witness): about 22–25 s of the 24.4 s, well over the 50%
threshold, so the §1 hypothesis holds. Inside a ledger page the revision costs about 410 ms and the page query itself about 37 ms.
At this volume the whole-org preview also cannot complete in the edge function today: 53 ledger pages exceed its 20-page read
limit, so it answers `ledger_limit_exceeded` (the 2195 fixture alone, 15,370 lines, is already 31 pages).

EXPLAIN excerpts are pasted below the table: first ledger page, first source page, `capture_revision`, batch, and the GL upsert.

**After A, against the targets (owner question 3).**

| Target at 10x | After A | Met? |
|---|---|---|
| Whole-org preview ≤ 8 s of database time | 8,123 ms median (2 of 5 runs under 8 s) | **No, by about 120 ms.** 19 revision computations cost about 7.2 s of it (one per page is kept on purpose). |
| No single capture call over 2 s | slowest call 547 ms (first ledger page) | Yes |
| Fence held ≤ 2 s per batch call | 1,824 ms for 25 groups | Yes, narrowly; PR A does not touch the batch (PR B) |

The preview also changed from *cannot complete* to *completes*: 7,927 of the 26,370 lines are capture-relevant, 16 pages, within the
edge function's 20-page limit. The page limit now counts only capture-relevant lines; every preview that completed before still
returns the same response (AC-CAPV-002), and one that stopped at the limit only because of unrelated lines now completes.

**EXPLAIN excerpts** (`-v explain=1`, `explain (analyze, buffers)` through auto_explain; nested statements over 5 ms).

- *First source page:* the revision dominates it before and after (417 and 421 ms). The page query took 207 ms before and 53 ms
  after under EXPLAIN ANALYZE; the invoice-to-order subplan went from 0.073 to 0.005 ms per loop (246 loops) once the document type
  became part of the `erp_purchase_documents_org_id_erp_doctype_erp_name_key` index condition, and the supplier subplan from 0.018 to
  0.011 ms per loop (500 loops). In the timed runs the two source pages moved only from 948 to 932 ms, within run-to-run noise.
  The companies table is tiny in this seed, so the planner still scans it; the primary-key join matters for a large one. In a
  whole-org read the order-family subplan is a one-time `false` filter, so the GIN index serves project-scope reads.
- *First ledger page, before:* 465 ms, of which the one-row source page (that is, the revision) took 411 ms and the page itself 37 ms.
  *After:* 702 ms under EXPLAIN ANALYZE (547 ms timed), of which the revision is 478 ms, the page rows 18 ms (`Index Scan using
  erp_gl_entry_mirror_pkey`, stopping at 501 rows) and the left-out summary 160 ms (a `Seq Scan` of 25,885 rows with one document
  lookup per row; it runs on the first page only).
- *`capture_revision`:* 353–377 ms per call, before and after (PR A does not change it).
- *Batch, new 25 groups:* 2,000 ms under EXPLAIN ANALYZE; it computes the revision three times through the source page plus once
  per group in the apply, all under the exclusive fence (unchanged, PR B).
- *GL upsert, 15,000 unchanged rows:* `Trigger capture_census_fence: time=714 calls=30000` (insert and update triggers both fire for
  an `on conflict do update`), before and after (PR B).
- *Family lookup (`2286_capture_source_index.test.sql`):* with the GIN index the invoice-by-order check reads through
  `erp_purchase_documents_purchase_orders_idx`, never a `Seq Scan` on `erp_purchase_documents`.

## 9. Traceability (ADR-0010: one owning test per AC at the lowest layer that can prove it)

| AC | Owning layer | Owning test |
|---|---|---|
| AC-CAPV-001 | pgTAP | `supabase/tests/2286_capture_ledger_scope.test.sql` |
| AC-CAPV-002 | Unit (Deno) | `supabase/functions/purchase-capture/volume.test.ts` (golden) |
| AC-CAPV-003 | pgTAP | `supabase/tests/2286_capture_ledger_scope.test.sql` |
| AC-CAPV-004 | Unit (Deno) | `supabase/functions/purchase-capture/index.test.ts` |
| AC-CAPV-005 | pgTAP | `supabase/tests/2286_capture_batch_resume.test.sql` |
| AC-CAPV-006 | pgTAP | `supabase/tests/2286_capture_batch_resume.test.sql` |
| AC-CAPV-007 | Unit (node:test) | `scripts/pmo-capture.test.mjs` |
| AC-CAPV-008 | pgTAP | `supabase/tests/2286_capture_batch_revision_count.test.sql` |
| AC-CAPV-009 | Benchmark evidence (not a CI gate) | `scripts/bench/2286-capture-volume.sql` + `volume.bench.ts`, recorded in §8 |
| AC-CAPV-010 | pgTAP | `supabase/tests/2286_capture_fence_trigger.test.sql` |
| AC-CAPV-011 | Unit (Deno) | `supabase/functions/erpnext-sweep/index.test.ts` (conditional) |

The 8-second statement limits stay owned by `2195_capture_volume.test.sql` (AC-ROP-065/066). No browser e2e is needed: there is no UI change.

## 10. Owner questions (each with a recommended answer)

1. Ship as two PRs (read path first, then apply/lock/resume as a lone money-tier PR)? **Recommended: yes.**
2. Should the ledger feed completion stop waiting on financial-statement publishing, while still waiting on the chart and the references (item 9)? **Recommended: yes.**
3. Targets at 10x: whole-org preview ≤ 8 s of database time, no call over 2 s, and the fence held ≤ 2 s per batch call? **Recommended: yes, and revise them after the A0 baseline if it shows something else.**
