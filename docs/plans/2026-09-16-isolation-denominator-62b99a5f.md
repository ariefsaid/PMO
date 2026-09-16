# Issue #612 item 1 — standing isolation-probe denominator guard

## Scope and decisions

This plan implements **item 1 only** from issue #612: make the isolation probe's enumerated surface a checked-in, self-cleaning contract. It does not alter probe assertions/RPC lines, create a migration or pgTAP test, add a scheduled/hosted workflow, touch frontend code, or edit `adws/`.

The checked-in JSON is a reviewable manifest, not a second catalog source: the local catalog and `supabase/functions/` are authoritative at CI time. The Node guard will fail closed in both directions:

- an actual table/function/edge-function/bucket absent from the manifest is an **unlisted surface**;
- a manifest entry absent from the actual surface is **stale**;
- a same-named table whose `{table, has_org, pk}` tuple changes is reported as stale plus unlisted, so the probe cannot silently retain an obsolete `has_org` classification or primary-key selector.

No ADR is needed: this is a local CI/runbook enforcement mechanism that reuses the established `scripts/check-*.mjs` guard pattern; it introduces no persistent schema, public API, or cross-cutting architecture decision.

### Plan-local acceptance traceability

Issue #612 supplies detailed executable requirements but no formal feature spec/AC identifiers. The IDs below label its explicit requirements without adding behavior; the builder should retain these titles in the specified Node tests.

| AC | Explicit issue requirement | Owning proof |
|---|---|---|
| AC-612-001 | The checked-in denominator represents every current public table (including `has_org` and `pk`), non-trigger public SECURITY DEFINER function, edge-function directory except `_shared`, and storage bucket. | `node scripts/check-isolation-denominator.mjs` against the reset local catalog in CI `pgtap` |
| AC-612-002 | A catalog/filesystem surface omitted from the JSON fails and names the line to add. | `AC-612-002` test in `scripts/check-isolation-denominator.test.mjs`; `--self-test` missing-table mutation |
| AC-612-003 | A manifest entry that no longer exists fails as stale. | `AC-612-003` test in `scripts/check-isolation-denominator.test.mjs`; `--self-test` fake-definer mutation |
| AC-612-004 | With no `TABLES_JSON` environment value, the hosted probe reads the manifest tables; an explicit environment value remains an override. | TDD shell harness in Task 6 plus `bash -n scripts/isolation-probe.sh` |
| AC-612-005 | The database CI lane runs the guard self-test and real catalog check immediately after reset; operators are told to update the denominator with any new surface. | the two named `pgtap` workflow steps and the two documentation edits |

## Catalog contract and data flow

`check-isolation-denominator.mjs` derives a normalized `actual` object at runtime:

1. It invokes bare `psql` with `-X -A -t -v ON_ERROR_STOP=1 -d <DATABASE_URL>` (defaulting to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`) and parses one JSON object per row for public tables. The query is limited to `pg_class.relkind IN ('r', 'p')` in `public`; `has_org` is an `EXISTS` check for a live, non-dropped `org_id` attribute; the single primary-key attribute is obtained from the primary index in attribute order. Discovery rejects a table with no single-column primary key rather than producing a `pk` the current probe cannot target.
2. It invokes `psql` for `pg_proc.prosecdef AND prorettype <> 'trigger'::regtype` in `public`, using `p.oid::regprocedure::text`, sorted by that rendered signature.
3. It invokes `psql` for `storage.buckets.id`, sorted lexically, and uses `readdirSync(..., { withFileTypes: true })` for each immediate directory in `supabase/functions/` except `_shared`, sorted lexically. Directory discovery intentionally does **not** require `index.ts`: the issue defines the surface as every function directory.
4. A pure comparator compares canonical table tuples and scalar sets without relying on order. It returns structured missing/stale findings, which the CLI renders as one diagnostic per entry. Missing diagnostics include the exact JSON entry line to add; stale diagnostics identify the exact entry to delete.
5. On success it prints exactly one concise `PASS` line containing the four actual counts. It prints findings to stderr and exits 1 on any mismatch, invalid JSON shape/duplicate entry, failed `psql`, missing functions root, or unsupported table key shape.

The initial JSON is generated once after the single locked reset and is intentionally formatted as an object with sorted arrays and each array member on one line. Its table objects retain the key order `table`, `has_org`, `pk`, making review diffs stable. At the issue's head it must contain 83 tables (75 with `has_org: true`), 99 definer signatures, 22 edge-function names, and 3 bucket IDs; a discrepancy is a stop-and-investigate signal, not a value to force into the manifest.

The probe only consumes `tables`; functions, edge functions, and buckets remain enumerated in the manifest so the guard makes their new surface visible even though this item explicitly does not add probes. `isolation-probe.sh` creates and cleans up a temporary tables-only JSON file only when `TABLES_JSON` is unset; a supplied path is left untouched.

## Implementation plan

### Task 1 — Reset the shared local catalog once and capture the baseline

**Files:** `scripts/isolation-probe-denominator.json` (new, generated in Task 4)

1. Before any catalog query, run exactly once from the repository root:
   ```bash
   scripts/with-db-lock.sh supabase db reset
   ```
   Do not reset again in this worktree. Use the returned local DB only for all remaining catalog discovery and final guard commands.
2. Record the expected head snapshot from the issue (83 total tables / 75 `org_id` tables / 99 non-trigger public definers / 22 function directories excluding `_shared` / 3 buckets). If a later generation reports another count, stop and reconcile the catalog query and current branch; do not hand-curate a partial denominator.

**Verify:** the locked reset exits 0. This is a precondition, not a schema change.

---

### Task 2 — Write the pure comparator tests first (RED)

**File:** `scripts/check-isolation-denominator.test.mjs` (new)

Create Node 22 `node:test` coverage that imports only the guard's exported pure `compareDenominators(actual, recorded)` (and, if useful, `formatDenominatorEntry`), using compact in-memory fixtures containing all four categories. Do not start Docker or call `psql` from this unit file.

Write these tests before the guard module exists, so the initial `node --test scripts/check-isolation-denominator.test.mjs` run is red on the missing import:

1. `AC-612-001: identical denominator passes despite array ordering` — reverse every actual and recorded array independently; assert `findings` is empty.
2. `AC-612-002: rejects a catalog table absent from the denominator` — add `{ table: 'new_org_surface', has_org: true, pk: 'id' }` only to actual; assert one missing-table finding identifies that full object and its add-line text.
3. `AC-612-003: rejects a stale definer function in the denominator` — add `public.no_longer_exists()` only to recorded; assert one stale-definer finding identifies that signature.
4. Add a focused table-drift assertion: actual and recorded share the table name but differ in `has_org` or `pk`; assert the result contains an unlisted actual tuple and a stale recorded tuple. This protects the fields the probe uses rather than treating table name alone as coverage.

**Verify (RED before Task 3):**
```bash
node --test scripts/check-isolation-denominator.test.mjs
```
Expected result: non-zero because `./check-isolation-denominator.mjs` has not yet been created. Do not weaken or skip the test after implementing the guard.

---

### Task 3 — Implement the catalog guard, comparator, CLI, and mutation self-test (GREEN)

**File:** `scripts/check-isolation-denominator.mjs` (new)

Implement a cwd-independent ESM Node 22 guard, following `scripts/check-redirect-targets.mjs` for `fileURLToPath`/`pathToFileURL` main-module detection and `scripts/check-promote-stamp.mjs` for concise polarity-proof reporting.

1. Define constants rooted at the repository: `DENOMINATOR_PATH = <repo>/scripts/isolation-probe-denominator.json`, `FUNCTIONS_ROOT = <repo>/supabase/functions`, and the required default `DATABASE_URL`. Use `execFileSync('psql', [...])`/`spawnSync`, never a shell interpolation, with `encoding: 'utf8'`, `-X`, `-A`, `-t`, and `-v ON_ERROR_STOP=1`; set `-d` from `process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL`.
2. Export `readActualCatalog({ databaseUrl, functionsRoot, execFile = execFileSync })`, `readDenominator(filePath)`, `compareDenominators(actual, recorded)`, and `formatDenominator(denominator)`. Keep all filesystem/psql work outside `compareDenominators` so Task 2 remains a real unit test.
3. Use these exact SQL selection rules (ordering is part of the query):
   ```sql
   -- tables: one JSON object per row, ordered by public relation name
   SELECT json_build_object(
     'table', c.relname,
     'has_org', EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = c.oid AND a.attname = 'org_id'
         AND a.attnum > 0 AND NOT a.attisdropped
     ),
     'pk', (
       SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = c.oid AND i.indisprimary
       ORDER BY a.attnum
       LIMIT 1
     )
   )::text
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   ORDER BY c.relname;

   -- non-trigger SECURITY DEFINER functions, canonical signature identity
   SELECT p.oid::regprocedure::text
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.prorettype <> 'trigger'::regtype
   ORDER BY p.oid::regprocedure::text;

   -- storage denominator
   SELECT id FROM storage.buckets ORDER BY id;
   ```
   Validate that every discovered table has a non-empty string `pk` and exactly one primary-key column before it can be emitted; fail with the table name and a request to make the probe's key strategy explicit if not.
4. Validate the parsed manifest has exactly the four required arrays, table objects with `table` string / `has_org` boolean / non-empty `pk` string, strings in the other arrays, and no duplicate canonical entries. Invalid manifests fail rather than being normalized into an accidental pass.
5. Compare full table tuples via a stable canonical representation and the other categories as sets. Render each missing finding as, for example, `MISSING tables: {"table":"new_org_surface","has_org":true,"pk":"id"}` followed by `add to tables: {"table":"new_org_surface","has_org":true,"pk":"id"}`; use the same single-line JSON encoding for functions, edge functions, and buckets. Render stale findings with the category and exact entry to remove. A clean normal invocation prints one line such as `PASS isolation denominator: tables=83 definers=99 edge_functions=22 buckets=3`.
6. Support only `--self-test` and an internal `--denominator <path>` option (the latter lets the self-test run the real CLI against its temporary copy); reject all other argument shapes with exit 2. The normal path reads the checked-in manifest.
7. For `--self-test`, first run the shipped manifest through a child invocation of this same script and require exit 0. Then, in a `mkdtempSync` directory, copy the checked-in JSON twice: remove one existing table from the first copy and append `public.__isolation_denominator_self_test__()` to `definer_functions` in the second. Run the same CLI with `--denominator <temp-copy>` each time, require exit 1, require the captured diagnostics to name the removed table/fake function and respectively `MISSING`/`STALE`, echo those captured planted-defect diagnostics, delete the temporary directory in `finally`, and exit 0 only when both failures were observed. Its final line must state that both missing and stale defects were caught.
8. Implement `formatDenominator` so it emits the root object in fixed category order and every individual table/signature/function/bucket entry on one line. It is an exported generation helper, not a new broad `--write` CLI mode.

**Verify (GREEN):**
```bash
node --test scripts/check-isolation-denominator.test.mjs
```
Expected result: exit 0 with all four comparator cases passing. After Task 4 creates the manifest, also run the two required self-test/normal guard commands from Task 8.

---

### Task 4 — Generate and check in the sorted denominator

**File:** `scripts/isolation-probe-denominator.json` (new)

Using the already-reset local database from Task 1 and the new guard's exported discovery/formatter (so the initial file and future comparison use one canonical representation), generate the manifest without hand-editing catalog entries:

```bash
node --input-type=module <<'NODE' > scripts/isolation-probe-denominator.json
import { formatDenominator, readActualCatalog } from './scripts/check-isolation-denominator.mjs';
process.stdout.write(`${formatDenominator(readActualCatalog({}))}\n`);
NODE
```

Then inspect the generated object before proceeding: keys must be `tables`, `definer_functions`, `edge_functions`, `buckets` in that order; every array must be sorted; each array member must occupy one line; table objects must use `{ "table", "has_org", "pk" }` key order. Confirm the issue-head counts are 83 total tables with 75 `has_org: true`, 99 function signatures, 22 edge functions, and 3 buckets. Do not include `_shared` as an edge function.

**Verify:**
```bash
node scripts/check-isolation-denominator.mjs
```
Expected result: exit 0 and the one-line PASS summary with those four counts.

---

### Task 5 — Wire the self-test and catalog guard into the database CI lane

**File:** `.github/workflows/ci.yml`

In job `pgtap` only, immediately after `Reset DB (migrations + seed)` and immediately before `pgTAP integration tests`, add exactly these two named steps, in this order:

```yaml
      - name: Isolation denominator guard self-test
        run: node scripts/check-isolation-denominator.mjs --self-test

      - name: Isolation denominator guard
        run: node scripts/check-isolation-denominator.mjs
```

Do not alter `verify` or `integration`; the guard deliberately runs where the local database has just been reset. The workflow's existing Node runtime is not required in this job because the GitHub runner has Node 22; do not add dependency installation or a new job.

**Verify:**
```bash
node scripts/check-isolation-denominator.mjs --self-test
node scripts/check-isolation-denominator.mjs
```
Expected result: each exits 0; the first prints both the planted missing-table and stale-definer diagnostics it caught, and the second prints the one-line PASS summary.

---

### Task 6 — Make the hosted probe default to the checked-in tables (TDD first)

**File:** `scripts/isolation-probe.sh`

Before editing the probe, demonstrate the current RED behavior with a temporary harness: set all existing required probe inputs to inert values, put a fake `curl` that writes `null` to its requested `-o` output and returns `401` first on `PATH`, set `RPC_ONLY=1`, unset `TABLES_JSON`, and invoke the script. It must fail at the existing `${TABLES_JSON:?}` required-variable check. Preserve this command/output as the task's TDD evidence.

Then make only the input-source change; leave the table loops, anon checks, RPC lines, request bodies, leak accounting, and exit behavior untouched:

1. Derive `SCRIPT_DIR` from `${BASH_SOURCE[0]}` before the required-input assertion.
2. Change the required-input assertion to require `BASE`, `ANON`, `JWT_B`, `A_ORG`, `B_ORG`, and `A_ROWS_JSON`, but not `TABLES_JSON`.
3. Initialize an empty temp-path variable. When `${TABLES_JSON:-}` is empty, create a `mktemp` file under `${TMPDIR:-/tmp}`, write `jq -e '.tables | arrays' "$SCRIPT_DIR/isolation-probe-denominator.json"` into it, assign that path to `TABLES_JSON`, and install an EXIT trap that deletes only this generated temporary file. If `TABLES_JSON` is already set, do not create, overwrite, or delete any caller file.
4. Keep the existing `TABLES_JSON` variable name and all subsequent `jq` selectors exactly as they are so the explicit hosted override remains compatible.

Repeat the harness after the edit. In its default run, read the first table name from `scripts/isolation-probe-denominator.json`, log fake-curl request URLs, and assert that the table appears in a REST URL. Repeat once with `TABLES_JSON` set to a one-entry temporary override named `override_table`; assert the log contains `override_table` and not the manifest's first table. Both green harness runs prove the default and override without calling a hosted project.

**Verify:**
```bash
bash -n scripts/isolation-probe.sh
```
Expected result: exit 0. Also retain the red-then-green harness evidence described above in the implementation report for AC-612-004.

---

### Task 7 — Add the two narrowly scoped documentation rules

**Files:** `docs/qa-portfolio.md`, `docs/environments.md`

1. In `docs/qa-portfolio.md`, directly after the existing **Enforcement** paragraph in the e2e isolation section, add one short paragraph naming `scripts/check-isolation-denominator.mjs` and `scripts/isolation-probe-denominator.json`. State the enforcement rule precisely: any PR that creates a public table, non-trigger public SECURITY DEFINER function, edge-function directory, or storage bucket must add its catalog entry to the denominator in that same PR, where the author reviews whether the hosted probe covers it; missing and stale entries fail the database CI lane.
2. In `docs/environments.md` § **After every prod push**, immediately before the paragraph that tells the operator to run `scripts/isolation-probe.sh`, add the tables-input recipe:
   ```bash
   TABLES_JSON="$(mktemp)"
   jq -e '.tables | arrays' scripts/isolation-probe-denominator.json > "$TABLES_JSON"
   export TABLES_JSON
   ```
   State in the surrounding sentence that this is the checked-in denominator used by the probe (and the script performs the same extraction when `TABLES_JSON` is unset), that it should be removed after the run, and that the guard must be green before a new surface is used. Do not edit other runbook material or expose credentials.

**Verify:**
```bash
grep -n "check-isolation-denominator\|isolation-probe-denominator" docs/qa-portfolio.md docs/environments.md
```
Expected result: exit 0 with the new enforcement paragraph and after-prod-push recipe as the only planned documentation additions.

---

### Task 8 — Run the required completion gates and report literal results

Run from the repository root unless noted; do not run another `supabase db reset`, do not read any `.env*` file, do not regenerate `package-lock.json`, push, or open a PR.

```bash
node scripts/check-isolation-denominator.mjs --self-test
node scripts/check-isolation-denominator.mjs
node --test scripts/check-isolation-denominator.test.mjs
bash -n scripts/isolation-probe.sh
(cd pmo-portal && npm run lint)
(cd pmo-portal && npm run typecheck)
```

Record every command above and its exit code verbatim in the builder report. The first command is insufficient if it merely passes: its output must visibly include the planted missing-table and stale-definer failures that the self-test intentionally caught. `npm run lint`'s ESLint config is scoped to `pmo-portal`, so the plain Node guard is covered by its Node tests/CLI self-test rather than pretending that app lint scanned it.

## Scaling and review focus

- The guard uses three small, ordered catalog reads and one directory listing; it runs once per database CI job and has no application runtime path, cache, or customer-data query. It scales with surface count linearly and intentionally trades a small CI cost for an explicit review denominator.
- Review the SQL against actual `pg_class`/`pg_proc` semantics, especially the table relation-kind filter, non-dropped `org_id` detection, one-column-PK failure mode, and `oid::regprocedure` identity. Review that subprocess arguments remain non-shell-interpolated and errors fail closed.
- Security review should confirm the manifest contains only names/metadata, no credentials or tenant data; that the CI guard queries only the local database; and that the hosted probe still receives operator inputs solely through the existing environment contract.
