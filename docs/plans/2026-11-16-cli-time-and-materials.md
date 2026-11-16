# Plan: CLI time-and-materials, first slice (#1856)

> **Spec:** `docs/specs/cli-time-and-materials.spec.md` (FR-CTM-*, NFR-CTM-*, AC-CTM-001..018). Map: #459.
> **Executor:** money path → Director-dispatched, one fresh Orca worker per phase (CLAUDE.md routing). Role contract:
> `implementer`. Strict TDD: every behaviour step writes the failing test first, runs it red, then the code.
> **Rulings (Director, binding):** no Project Manager tokens (Q2: Admin/Finance only); no time entry (Q4); a rates file is
> one transaction, all or nothing, and the preview shows every row (Q5).
> **Owner-gated, planned as yes, each a separable LAST task:** Task 20 = `signoff confirm` (Q3), Task 21 = `claim invoice` +
> its guard migration (Q1). A "no" deletes that task and nothing else (one stated line in Task 21 if Q3 is no and Q1 yes).
> **Guard migration number:** `NNNN` is taken from the migration register when Task 21 starts (Fable assigns it). It is the
> only placeholder in this plan.

## 1. Design

### What already exists (read, not re-derived)
- `scripts/lib/pmo-tm.mjs`: T&M reads (`rates list`, `claim preview`, `claim list`), `TM_READ_RPCS`, `MAX_RATE_ROWS`,
  `summarisePreview`, `explainError`, `TmQueryError` (exit 2 "Nothing was sent").
- `scripts/pmo.mjs:1877` `timeAndMaterials()`: the `tm` dispatcher; `readMe()` (role, status), `readNames()`, `Reported`
  (JSON on stdout with an exit code), `requireActiveAdmin()` (the pattern the T&M role gate copies).
- Guard (latest body, `0899_cli_guard_history_corrections.sql`): `tm_write_rpcs` already admits the nine rate and sign-off
  writers for active Admin/Finance tokens; `tm_read_rpcs` admits the three reads. `create_native_tm_invoice` is in no tier.
- The app's data layer (`pmo-portal/src/lib/db/timeAndMaterials.ts:286-392`) fixes the argument names copied below.
- Preview/apply shape: `pmo bid` (`scripts/pmo.mjs:930`, `scripts/lib/pmo-bids.mjs`): plan → refuse with exit 2 and
  `details` → without `--apply` return `{ applied: false, …, next }` → with `--apply` one write. The #1858 correction module
  (`scripts/lib/pmo-correct.mjs`, on `feat/l3-1858-cli-corrections`, not on dev yet) follows the same shape; this plan does
  not depend on it.

### Decisions
- **D1 One new module, `scripts/lib/pmo-tm-write.mjs`.** Plans and writes; takes an `api` object (`rpc`, `get`, `names`),
  so it is unit-testable without HTTP. Reads stay in `pmo-tm.mjs`. Tests go in the existing `scripts/pmo-tm.test.mjs`
  (same fake server, same guard reader); the CI runner picks it up already.
- **D2 Output.** Write commands always print JSON (as `pmo bid`, `pmo attribution set`); `--json` is accepted and changes
  nothing. Exit `0` ok or an `already_*` state; `1` the server refused (or a row was refused on apply); `2` the CLI refused
  before sending a write (role, input, or a preview that already shows a refused row).
- **D3 Claim commands take `--project <id>`.** ⚑ Deviation from spec §3's synopsis: `list_tm_claims(p_project)` is the
  only admitted read that gives a claim's status, people and total, and it is keyed by project; the CLI cannot find a
  claim's project from its id without a new read (server work). So `claim deselect|withdraw`, `signoff prepare|confirm`
  and `claim invoice` require `--project`; the CLI refuses (exit 2) when the claim is not in that project's list.
  `claim sources` needs no project (`list_tm_claim_source_details(p_claim)`).
- **D4 Role gate before any read of state.** `readMe()` → active Admin or Finance, else exit 2 `tm_role_refused`, naming
  the roles and the app screen *Project → Contract & billing → Time and materials* (FR-CTM-004). The guard and every RPC
  still decide; this only refuses earlier.
- **D5 `rates set` (Q5).** Rows are classified `create | new version | unchanged | refused`. Any refused row → nothing is
  sent (exit 2). `unchanged` rows are left out of the call (a stale `expected_version` on an unchanged row would otherwise
  fail the whole file with 40001 on a rerun). The rest go as ONE `save_contract_rate_line({p_line: [...]})` call: the RPC's
  array form is one transaction. A new line gets a key minted by `crypto.randomUUID()` (FR-CTM-012); a preview prints a
  key too, but the key that sticks is the one printed by `--apply`. A rerun of the same file refuses the created rows as
  duplicate labour labels (case-insensitive) before sending.
- **D6 `assign set` is row by row (FR-CTM-015).** Malformed rows are refused locally and not sent; identical rows are
  `skip`; every other row is sent and the server decides. The preview flags a person who is not active, a line that is not
  a current labour line, and an overlap as `warnings` ("the server will refuse this row") — so AC-CTM-007's overlap row is
  refused with the server's own words.
- **D7 Idempotent reruns.** `claim assemble`: a Draft claim for the same project, the same work order (or none) and an
  overlapping window → `already_assembled`, nothing sent (FR-CTM-021). `claim withdraw` on Withdrawn → `already_withdrawn`.
  Task 20: `signoff confirm` on SignedOff → `already_signed_off`. Task 21: server detail `claim-already-invoiced` →
  `already_invoiced`. All exit 0.
- **D8 Unknown outcome (FR-CTM-008).** A write whose request fails with no HTTP status and no code (the transport failed:
  `send()` in `pmo.mjs` throws `Could not reach …`) becomes `TmOutcomeUnknown`: exit 1, code `outcome_unknown`, the read
  command that shows the truth; never retried. `ponytail:` a refresh that fails with no status is also reported as unknown;
  the reads before the write already need a live session, so this is not reached in practice.
- **D9 Bounded reads (NFR-CTM-003).** The plan reads ask `limit = MAX_RATE_ROWS + 1`; more than `MAX_RATE_ROWS` rows →
  refuse (exit 2) rather than plan from a partial card.
- **D10 No amount is computed for a write.** Amounts printed come from `preview_tm_claim`, `list_tm_claims` or the write's
  result. The total-drift warning compares `list_tm_claims.gross_amount` with the existing preview total, both as 2-decimal
  strings (FR-CTM-005, FR-CTM-022).
- **D11 Write-error headlines.** `explainWriteError` maps 42501, 22023, 23505, 23514, 40001, 55000, P0001, P0002 to a
  headline and keeps the server's message after a colon (FR-CTM-006). The read-side `explainError` is unchanged.

### Data flow per command (reads → write → re-read)
| Command | Reads (all admitted) | Write (once) | Re-read |
|---|---|---|---|
| `rates set <file>` | `projects` (currency), `contract_rate_lines` (current) | `save_contract_rate_line` (array) | `contract_rate_lines` |
| `assign set <file>` | `contract_rate_lines`, `contract_rate_assignees`, `profiles` (status) | `set_contract_rate_assignee` per row | (each row's id) |
| `claim assemble` | `preview_tm_claim`, `list_tm_claims` | `assemble_tm_claim` | `list_tm_claims` |
| `claim sources <claim>` | `list_tm_claim_source_details` | none | n/a |
| `claim deselect <claim> <src>…` | `list_tm_claims`, `list_tm_claim_source_details` | `deselect_tm_source` per source | `list_tm_claims` |
| `claim withdraw <claim>` | `list_tm_claims`, `list_tm_claim_source_details` | `withdraw_tm_signoff` | `list_tm_claims` |
| `signoff prepare <claim>` | `list_tm_claims`, `project_documents` | `prepare_tm_signoff` | `list_tm_claims`, `list_tm_claim_source_details` |
| `signoff confirm <claim>` (T20) | `list_tm_claims`, `list_tm_claim_source_details`, `project_documents`, `profiles` | `confirm_tm_signoff` | (its result) |
| `claim invoice <claim>` (T21) | `external_domain_ownership`, `list_tm_claims` | `create_native_tm_invoice` | none admitted (prints id + next step) |

Slice 2 (`rates end`, `assign end`) is not in this plan.

## 2. Traceability

| AC | Owning test (layer) | Task |
|---|---|---|
| AC-CTM-001 | `scripts/pmo-tm.test.mjs` "AC-CTM-001 every write command without --apply sends no writer" (unit) | 14 (+20, 21 rows) |
| AC-CTM-002 | `scripts/pmo-tm.test.mjs` "AC-CTM-002 every write command with --apply calls its one RPC with the app's arguments" (unit) | 14 (+20, 21 rows) |
| AC-CTM-003 | `scripts/pmo-tm.test.mjs` "AC-CTM-003 a PM, Engineer, Executive or inactive Finance member is refused before any RPC" (unit) | 14 (+20, 21 rows) |
| AC-CTM-004 | `scripts/pmo-tm.test.mjs` "AC-CTM-004 …" (unit) | 4, 6 |
| AC-CTM-005 | `scripts/pmo-tm.test.mjs` "AC-CTM-005 …" (unit) | 6 |
| AC-CTM-006 | `scripts/pmo-tm.test.mjs` "AC-CTM-006 …" (unit) + `supabase/tests/tm_rate_sales_items.test.sql` "AC-CTM-006 …" (pgTAP, the transaction itself) | 6, 7 |
| AC-CTM-007 | `scripts/pmo-tm.test.mjs` "AC-CTM-007 …" (unit) | 8 |
| AC-CTM-008 | `scripts/pmo-tm.test.mjs` "AC-CTM-008 …" (unit) | 9 |
| AC-CTM-009 | `scripts/pmo-tm.test.mjs` "AC-CTM-009 …" (unit) | 9 |
| AC-CTM-010 | `scripts/pmo-tm.test.mjs` "AC-CTM-010 …" ×2 (unit) | 3, 14 |
| AC-CTM-011 | `scripts/pmo-tm.test.mjs` "AC-CTM-011 …" (unit); rule owned by pgTAP AC-TM-006 `tm_signoff.test.sql` | 20 |
| AC-CTM-012 | `scripts/pmo-tm.test.mjs` "AC-CTM-012 …" (unit) | 13 |
| AC-CTM-013 | `scripts/pmo-tm.test.mjs` "AC-CTM-013 …" (unit) | 21 |
| AC-CTM-014 | `scripts/pmo-tm.test.mjs` "AC-CTM-014 withdraw…" (12), "…confirm…" (20), "…invoice…" (21) (unit) | 12, 20, 21 |
| AC-CTM-015 | `supabase/tests/1856_cli_tm_invoice_guard.test.sql` (pgTAP) | 21 |
| AC-CTM-016 | `scripts/pmo-tm.test.mjs` "AC-CTM-016 …" (unit, list sync) | 1 (+21) |
| AC-CTM-017 | `pmo-portal/e2e/AC-CTM-017-cli-time-and-materials.spec.ts` (E2E, one journey) | 18 (+20, 21 steps) |
| AC-CTM-018 | `docs/runbooks/pmo-cli.md` recipe 7 (doc review, no test) | 16 (+20, 21 lines) |

FR-CTM-008 (unknown outcome) and FR-CTM-023 (`claim sources`) have no AC of their own; their tests carry the FR id
(Tasks 14, 10). Server rules are not re-proved (pgTAP `tm_*` files own AC-TM-001..026).

## 3. Tasks

Run everything from the worktree root unless a step says `pmo-portal/`. Test command, used by every unit step:

```bash
scripts/with-test-lock.sh node --test scripts/pmo-tm.test.mjs
```

Never type a bare `vitest`/`playwright`/`deno test` (shared-Mac rule). Commit after each task that ends green
(`git add <the task's files>`; message `feat(cli): … (#1856)`; repo identity, no attribution).

### Task 0 — Worktree and baseline (2 min)
1. `git -C /Users/ariefsaid/Coding/PMO fetch origin dev && git -C /Users/ariefsaid/Coding/PMO worktree add --no-track -b feat/1856-cli-tm ~/orca/workspaces/PMO/feat-1856-cli-tm origin/dev`; copy `.env.local` in; link `node_modules` to `~/orca/pmo-shared-deps` (shared-deps note).
2. `git config user.name 'Arief Said' && git config user.email '38366180+ariefsaid@users.noreply.github.com'`
3. Run the test command. Expected: all `AC-TM-017` tests pass. Red here = stop and report (not this plan's code).

### Task 1 — Module skeleton and the writer list (AC-CTM-016) (3 min)
**Test first** — in `scripts/pmo-tm.test.mjs`, add to the imports and append:

```js
import { TM_WRITE_RPCS } from './lib/pmo-tm-write.mjs';

test('AC-CTM-016 the CLI T&M writer list is exactly the database tm_write_rpcs tier (latest api_client_request_guard)', () => {
  assert.deepEqual([...TM_WRITE_RPCS].sort(), guardList('tm_write_rpcs'));
});
```
Run → red (module not found).

**Code** — create `scripts/lib/pmo-tm-write.mjs`:

```js
/**
 * `pmo tm` writes (#1856): the rate card, assignments, claim assembly, deselection, withdrawal and the sign-off.
 * Each command reads the current state, plans, and prints the plan; only `--apply` sends its RPC — the same RPC, with the
 * same argument names, the app's data layer sends (pmo-portal/src/lib/db/timeAndMaterials.ts). The database decides every
 * amount, role and separation-of-duties rule; nothing here prices an hour or sends an org, an author or an amount.
 * Spec: docs/specs/cli-time-and-materials.spec.md · plan docs/plans/2026-11-16-cli-time-and-materials.md.
 * Node 22 standard library only.
 */
import crypto from 'node:crypto';

import { MAX_RATE_ROWS, RATE_LINE_COLUMNS, TmQueryError, isCalendarDate, projectProblem, summarisePreview, validatePreview } from './pmo-tm.mjs';

/** The database's T&M write tier — keep in step with `tm_write_rpcs` in `api_client_request_guard`. */
export const TM_WRITE_RPCS = Object.freeze([
  'assemble_tm_claim', 'confirm_tm_signoff', 'deselect_tm_source', 'end_contract_rate_assignee', 'end_contract_rate_line',
  'prepare_tm_signoff', 'save_contract_rate_line', 'set_contract_rate_assignee', 'withdraw_tm_signoff',
]);
export const TM_WRITER_ROLES = Object.freeze(['Admin', 'Finance']);
export const TM_SCREEN = 'Project → Contract & billing → Time and materials';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const given = (value) => value !== undefined && value !== null;
```
In `scripts/lib/pmo-tm.mjs` export the two helpers the module reuses: change `function isCalendarDate(value)` to
`export function isCalendarDate(value)` and `function projectProblem(project)` to `export function projectProblem(project)`.
Run → green.

### Task 2 — Test harness additions (no behaviour) (3 min)
In `scripts/pmo-tm.test.mjs`:
1. In `fake()`, pass the URL to a function answer and allow a dropped connection:
   ```js
   const answer = handlers[`${req.method} ${url.pathname}`];
   if (answer === undefined) return send(404, { message: `unexpected ${req.method} ${url.pathname}` });
   if (answer === 'drop') return req.socket.destroy();
   const [status, json] = typeof answer === 'function' ? answer(parsed, url) : answer;
   ```
2. Add fixtures and helpers after `ASSIGNEES`:
   ```js
   const FINANCE_A = '66666666-6666-6666-6666-666666666666';
   const OTHER = '77777777-7777-7777-7777-777777777777';
   const DOCUMENT = '88888888-8888-8888-8888-888888888888';
   const SOURCE = '99999999-9999-9999-9999-999999999999';
   const NEW_CLAIM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
   const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
   const DRAFT = { ...CLAIMS[0], status: 'Draft', prepared_by: FINANCE_A, signoff_prepared_by: FINANCE_A, document_id: DOCUMENT };
   const SOURCES = [{
     id: SOURCE, entry_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', entry_date: '2026-01-05', person_id: ENGINEER, person_name: 'Siti Engineer',
     asset_id: null, asset_name: null, basis: 'work', units: 8, unit: 'hour', line_label: 'Site engineer', is_selected: true,
     person_unit_total: 8, total_count: 1, signoff_is_current: true,
   }];
   const DOC = { id: DOCUMENT, project_id: PROJECT, title: 'January hours', revision: 'A', status: 'Issued', file_path: 'org/p/d/jan.pdf' };
   const RATE_ROW = { project_id: PROJECT, kind: 'labour', label: 'Surveyor', unit: 'hour', rate: 60000, currency: 'IDR', effective_from: '2026-01-01' };
   const ASSIGN_ROW = { project_id: PROJECT, line_key: LINE_KEY, user_id: OTHER, effective_from: '2027-01-01' };

   /** The signed-in user (readMe) plus the profile reads a command makes (names, member status). */
   function signedIn(role, { id = FINANCE_A, status = 'active', people = [] } = {}) {
     return {
       'GET /auth/v1/user': [200, { id, email: 'a@example.test' }],
       'GET /rest/v1/profiles': (_body, url) => (url.searchParams.get('select') === 'full_name,role,status'
         ? [200, [{ full_name: 'Signed In', role, status }]]
         : [200, people]),
     };
   }
   /** Every read a write command's plan makes, answered with the fixtures above. */
   const READS = () => ({
     ...signedIn('Finance', { people: [{ id: ENGINEER, full_name: 'Siti Engineer', status: 'active' }, { id: OTHER, full_name: 'Other Person', status: 'active' }] }),
     'GET /rest/v1/projects': [200, [{ id: PROJECT, currency: 'IDR' }]],
     'GET /rest/v1/contract_rate_lines': [200, RATES],
     'GET /rest/v1/contract_rate_assignees': [200, ASSIGNEES],
     'GET /rest/v1/project_documents': [200, [DOC]],
     'GET /rest/v1/external_domain_ownership': [200, []],
     'POST /rest/v1/rpc/preview_tm_claim': [200, PREVIEW_ROWS],
     'POST /rest/v1/rpc/list_tm_claims': [200, [DRAFT]],
     'POST /rest/v1/rpc/list_tm_claim_source_details': [200, SOURCES],
   });
   const ALL_WRITERS = () => [...TM_WRITE_RPCS, 'create_native_tm_invoice'];
   const writesSent = (server) => rpcCalls(server).filter((name) => ALL_WRITERS().includes(name));
   function jsonFile(value) {
     const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-tm-file-'));
     const file = path.join(dir, 'rows.json');
     fs.writeFileSync(file, JSON.stringify(value));
     return file;
   }
   ```
Run → green (existing tests unchanged; `ponytail:` temp files are left in the OS temp dir, as `cli()` does for its config).

### Task 3 — Write-error headlines (AC-CTM-010, unit part) (3 min)
**Test first:**
```js
import { explainWriteError } from './lib/pmo-tm-write.mjs'; // merge into the Task 1 import

test('AC-CTM-010 explainWriteError gives each refusal code a headline and keeps the server\'s words', () => {
  for (const [code, head] of [
    ['42501', /^Not allowed \(role or separation of duties\): server says no$/],
    ['22023', /^Invalid input: server says no$/],
    ['23505', /^Conflicts with an existing record: server says no$/],
    ['23514', /^Does not match the project or its document: server says no$/],
    ['40001', /^Changed since it was read: re-read with `pmo tm rates list` and run again: server says no$/],
    ['55000', /^Not ready to invoice: server says no$/],
    ['P0001', /^Refused in the claim's current state: server says no$/],
    ['P0002', /^Not found: server says no$/],
  ]) assert.match(explainWriteError({ code, message: 'server says no' }), head);
  assert.equal(explainWriteError({ code: 'XX000', message: 'boom' }), 'boom');
});
```
Run → red. **Code** (append to `pmo-tm-write.mjs`):
```js
const WRITE_HEADLINES = {
  42501: 'Not allowed (role or separation of duties)',
  22023: 'Invalid input',
  23505: 'Conflicts with an existing record',
  23514: 'Does not match the project or its document',
  40001: 'Changed since it was read: re-read with `pmo tm rates list` and run again',
  55000: 'Not ready to invoice',
  P0001: "Refused in the claim's current state",
  P0002: 'Not found',
};

/** A headline for a refused write, then the database's own message verbatim (FR-CTM-006). */
export function explainWriteError(error) {
  const head = WRITE_HEADLINES[error?.code];
  if (!head) return error?.message ?? String(error);
  return error.message ? `${head}: ${error.message}` : head;
}

/** A write whose outcome is unknown (the connection failed): never retried; `check` is the read that shows the truth. */
export class TmOutcomeUnknown extends Error {
  constructor(check) {
    super(`The write may or may not have been saved: the connection failed before an answer came back. Do not rerun it blindly; check with \`${check}\`.`);
    this.check = check;
  }
}

/** The one write a step makes. A failure with no HTTP status and no code never reached an answer (FR-CTM-008). */
async function write(api, name, body, check) {
  try {
    return await api.rpc(name, body);
  } catch (error) {
    if (error?.status === undefined && error?.code === undefined) throw new TmOutcomeUnknown(check);
    throw error;
  }
}

/** null when the signed-in member may run T&M writes; otherwise the refusal (FR-CTM-004). */
export function writerRefusal(profile, command) {
  if (TM_WRITER_ROLES.includes(profile?.role) && profile?.status === 'active') return null;
  const who = `${profile?.status && profile.status !== 'active' ? `${profile.status} ` : ''}${profile?.role ?? 'unknown role'}`;
  return `pmo tm ${command} is for an active Admin or Finance member (you are ${who}). Use the app instead: ${TM_SCREEN}.`;
}
```
Run → green.

### Task 4 — Rate-row shape refusals (AC-CTM-004, unit part) (4 min)
**Test first:**
```js
import { rateRowProblems } from './lib/pmo-tm-write.mjs'; // merge

test('AC-CTM-004 rateRowProblems refuses a malformed rate line and names each problem', () => {
  assert.deepEqual(rateRowProblems(RATE_ROW), []);
  assert.deepEqual(rateRowProblems({ ...RATE_ROW, line_key: LINE_KEY, expected_version: 2 }), []);
  for (const [row, re] of [
    [{ ...RATE_ROW, rate: 1.234 }, /at most 2 decimals/],
    [{ ...RATE_ROW, rate: -1 }, /zero or more/],
    [{ ...RATE_ROW, rate: '60000' }, /rate must be a number/],
    [{ ...RATE_ROW, currency: 'idr' }, /three-letter code/],
    [{ ...RATE_ROW, org_id: PROJECT }, /"org_id" is not a rate-line field/],
    [{ ...RATE_ROW, label: '  ' }, /label is required/],
    [{ ...RATE_ROW, unit: 'week' }, /unit must be hour or day/],
    [{ ...RATE_ROW, effective_from: '2026-02-30' }, /effective_from must be a date/],
    [{ ...RATE_ROW, effective_to: '2025-12-31' }, /on or after effective_from/],
    [{ ...RATE_ROW, line_key: LINE_KEY }, /both line_key and expected_version/],
    [{ ...RATE_ROW, standby_rate: 10 }, /only for equipment lines/],
    [{ ...RATE_ROW, kind: 'equipment' }, /asset_id \(uuid\) is required/],
    [{ ...RATE_ROW, sales_item_code: 'a\nb' }, /no control characters/],
  ]) assert.match(rateRowProblems(row).join('; '), re, JSON.stringify(row));
  assert.deepEqual(rateRowProblems('x'), ['each rate line must be a JSON object']);
});
```
Run → red. **Code** (append):
```js
const RATE_KEYS = Object.freeze(['project_id', 'line_key', 'expected_version', 'kind', 'asset_id', 'label', 'unit', 'rate', 'standby_rate', 'currency', 'effective_from', 'effective_to', 'sales_item_code']);
const MONEY = /^\d+(\.\d{1,2})?$/;
const isMoney = (value) => typeof value === 'number' && Number.isFinite(value) && value < 1e12 && MONEY.test(String(value));
const MONEY_RULE = 'must be a number, zero or more, below 1000000000000, with at most 2 decimals';

/** Every reason a rate-line row is refused before anything is sent (the server re-checks each one). */
export function rateRowProblems(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['each rate line must be a JSON object'];
  const problems = Object.keys(row).filter((key) => !RATE_KEYS.includes(key))
    .map((key) => `"${key}" is not a rate-line field (the server sets the organisation, the author and the version)`);
  if (!UUID.test(String(row.project_id ?? ''))) problems.push('project_id must be a project id (uuid)');
  if (!['labour', 'equipment'].includes(row.kind)) problems.push('kind must be labour or equipment');
  const label = typeof row.label === 'string' ? row.label.trim() : '';
  if (label.length < 1 || label.length > 120) problems.push('label is required (at most 120 characters)');
  if (!['hour', 'day'].includes(row.unit)) problems.push('unit must be hour or day');
  if (!isMoney(row.rate)) problems.push(`rate ${MONEY_RULE}`);
  if (row.kind === 'equipment') {
    if (!UUID.test(String(row.asset_id ?? ''))) problems.push('asset_id (uuid) is required for an equipment line');
    if (given(row.standby_rate) && !isMoney(row.standby_rate)) problems.push(`standby_rate ${MONEY_RULE}`);
  } else if (given(row.asset_id) || given(row.standby_rate)) {
    problems.push('asset_id and standby_rate are only for equipment lines');
  }
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) problems.push('currency must be a three-letter code');
  if (!isCalendarDate(row.effective_from)) problems.push('effective_from must be a date (YYYY-MM-DD)');
  if (given(row.effective_to) && (!isCalendarDate(row.effective_to) || row.effective_to < row.effective_from)) {
    problems.push('effective_to must be a date on or after effective_from');
  }
  if (given(row.sales_item_code) && (typeof row.sales_item_code !== 'string' || row.sales_item_code.trim().length > 140 || /\p{Cc}/u.test(row.sales_item_code))) {
    problems.push('sales_item_code must be text of at most 140 characters, with no control characters');
  }
  if ((row.line_key === undefined) !== (row.expected_version === undefined)) {
    problems.push('an edit names both line_key and expected_version (from `pmo tm rates list`); a new line names neither');
  }
  if (row.line_key !== undefined && !UUID.test(String(row.line_key))) problems.push('line_key must be a uuid');
  if (row.expected_version !== undefined && !(Number.isInteger(row.expected_version) && row.expected_version > 0)) {
    problems.push('expected_version must be a positive whole number');
  }
  return problems;
}
```
Run → green.

### Task 5 — Classifying rows against the current card (AC-CTM-004/005, unit part) (5 min)
**Test first** (a stub `api`, no HTTP):
```js
import { planRates } from './lib/pmo-tm-write.mjs'; // merge

const stubApi = ({ card = RATES, currency = 'IDR', rpc } = {}) => ({
  get: async (table) => (table === 'contract_rate_lines' ? card : table === 'projects' ? [{ id: PROJECT, currency }] : []),
  rpc: rpc ?? (async (name) => { throw new Error(`unexpected rpc ${name}`); }),
});

test('AC-CTM-004 planRates classifies each row: create, new version, unchanged or refused', async () => {
  const current = RATES[1];
  const edit = { project_id: PROJECT, line_key: LINE_KEY, expected_version: 2, kind: 'labour', label: 'Site engineer', unit: 'hour', currency: 'IDR' };
  const plan = await planRates(stubApi(), [
    RATE_ROW,
    { ...edit, rate: 55000, effective_from: '2026-07-01' },
    { ...edit, rate: current.rate, effective_from: current.effective_from },
    { ...edit, expected_version: 1, rate: 55000, effective_from: '2026-07-01' },
    { ...RATE_ROW, label: 'site ENGINEER ' },
    { ...RATE_ROW, currency: 'USD', label: 'Driver' },
    { ...edit, line_key: OTHER, rate: 1, effective_from: '2026-07-01' },
  ]);
  assert.deepEqual(plan.map((row) => row.action), ['create', 'new version', 'unchanged', 'refused', 'refused', 'refused', 'refused']);
  assert.match(plan[0].line_key, UUID_RE);
  assert.match(plan[3].problems.join(), /version 2, the file expects 1/);
  assert.match(plan[4].problems.join(), /already has a current labour line labelled "site ENGINEER"/);
  assert.match(plan[5].problems.join(), /not the project's currency \(IDR\)/);
  assert.match(plan[6].problems.join(), /no current rate line has this line_key/);
});

test('AC-CTM-004 two new labour lines with the same label in one file: the second is refused', async () => {
  const plan = await planRates(stubApi(), [RATE_ROW, { ...RATE_ROW, label: 'surveyor' }]);
  assert.deepEqual(plan.map((row) => row.action), ['create', 'refused']);
});

test('NFR-CTM-003 a card read that hits the bound is refused, never planned from', async () => {
  const card = Array.from({ length: 1001 }, (_, i) => ({ ...RATES[1], line_key: `${i}`, label: `L${i}` }));
  await assert.rejects(planRates(stubApi({ card }), [RATE_ROW]), /more than 1000 current rate lines/);
});
```
Run → red. **Code** (append; the reads also serve Tasks 6 and 8):
```js
/** The plan reads the rate card with the sales-item code too, so an unchanged mapping is recognised. */
export const RATE_PLAN_COLUMNS = Object.freeze([...RATE_LINE_COLUMNS, 'sales_item_code']);

/** Bounded read: one more than the bound is asked for, and a full answer is refused rather than planned from (NFR-CTM-003). */
async function readBounded(api, table, query, what) {
  query.set('limit', String(MAX_RATE_ROWS + 1));
  const rows = await api.get(table, query);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > MAX_RATE_ROWS) {
    throw new TmQueryError([`these projects have more than ${MAX_RATE_ROWS} ${what}; the CLI will not plan from a partial list. Use the app: ${TM_SCREEN}`]);
  }
  return list;
}

async function readCurrentLines(api, projects) {
  const query = new URLSearchParams({ select: RATE_PLAN_COLUMNS.join(','), project_id: `in.(${projects.join(',')})`, is_current: 'eq.true', order: 'project_id.asc,label.asc' });
  return (await readBounded(api, 'contract_rate_lines', query, 'current rate lines')).filter((line) => line.is_current);
}

async function readProjectCurrencies(api, projects) {
  const rows = await api.get('projects', new URLSearchParams({ select: 'id,currency', id: `in.(${projects.join(',')})` }));
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row.currency]));
}

const projectsOf = (rows) => [...new Set(rows.map((row) => String(row?.project_id ?? '').toLowerCase()).filter((id) => UUID.test(id)))];

function sameContent(row, line) {
  const norm = (value) => (given(value) ? value : null);
  const money = (value) => (given(value) ? Number(value) : null);
  return row.kind === line.kind && norm(row.asset_id) === norm(line.asset_id) && row.label.trim() === line.label
    && row.unit === line.unit && money(row.rate) === money(line.rate) && money(row.standby_rate) === money(line.standby_rate)
    && row.effective_from === line.effective_from && norm(row.effective_to) === norm(line.effective_to)
    && (!('sales_item_code' in row) || norm(row.sales_item_code?.trim() || null) === norm(line.sales_item_code));
}

/** Each row as create | new version | unchanged | refused, against the current card (FR-CTM-011, FR-CTM-012). */
export async function planRates(api, rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TmQueryError(['the rates file must be a non-empty JSON array of rate lines']);
  const projects = projectsOf(rows);
  const card = projects.length ? await readCurrentLines(api, projects) : [];
  const currencies = projects.length ? await readProjectCurrencies(api, projects) : new Map();
  const newLabels = new Set();
  return rows.map((row, index) => {
    const refused = (...problems) => ({ index, action: 'refused', problems });
    const problems = rateRowProblems(row);
    if (problems.length) return refused(...problems);
    const project = row.project_id.toLowerCase();
    const currency = currencies.get(project);
    if (!currency) return refused('project not found (or not visible to you)');
    if (row.currency !== currency) return refused(`currency ${row.currency} is not the project's currency (${currency})`);
    if (row.line_key === undefined) {
      if (row.kind === 'labour') {
        const label = row.label.trim().toLowerCase();
        const key = `${project}|${label}`;
        if (newLabels.has(key) || card.some((line) => line.project_id === project && line.kind === 'labour' && line.label.toLowerCase() === label)) {
          return refused(`the project already has a current labour line labelled "${row.label.trim()}": edit it with its line_key and expected_version (\`pmo tm rates list --project ${project}\`)`);
        }
        newLabels.add(key);
      }
      return { index, action: 'create', line_key: crypto.randomUUID(), send: row };
    }
    const lineKey = row.line_key.toLowerCase();
    const current = card.find((line) => line.project_id === project && line.line_key === lineKey);
    if (!current) return refused(`no current rate line has this line_key on the project; list them with \`pmo tm rates list --project ${project}\``);
    if (sameContent(row, current)) return { index, action: 'unchanged', line_key: lineKey, version: current.version };
    if (row.expected_version !== current.version) {
      return refused(`the line is at version ${current.version}, the file expects ${row.expected_version}: re-read with \`pmo tm rates list --project ${project}\``);
    }
    if (row.kind !== current.kind || (row.asset_id ?? null) !== (current.asset_id ?? null)) {
      return refused('a rate line keeps its kind and asset: end it in the app and add a new line');
    }
    return { index, action: 'new version', line_key: lineKey, send: row };
  });
}
```
Run → green.

### Task 6 — `rates set` end to end, all or nothing (AC-CTM-004, -005, -006) (5 min)
**Test first:**
```js
test('AC-CTM-004 a rates file with a refused row sends nothing, with or without --apply', async () => {
  const f = await fake(READS());
  try {
    const file = jsonFile([RATE_ROW, { ...RATE_ROW, label: 'A', currency: 'USD' }, { ...RATE_ROW, label: 'B', rate: 1.234 }, { ...RATE_ROW, label: 'C', rate: -1 }, { ...RATE_ROW, label: 'site engineer' }]);
    for (const extra of [[], ['--apply']]) {
      const r = await cli(['tm', 'rates', 'set', file, ...extra], f);
      assert.equal(r.code, 2, r.out);
      assert.deepEqual(r.json.rows.map((row) => row.action), ['create', 'refused', 'refused', 'refused', 'refused']);
      assert.match(r.json.note, /Nothing was sent: 4 row\(s\) refused/);
    }
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-005 a created line prints its minted line_key; rerunning the file refuses it as a duplicate label without a write', async () => {
  const card = [...RATES];
  const f = await fake({
    ...READS(),
    'GET /rest/v1/contract_rate_lines': () => [200, card],
    'POST /rest/v1/rpc/save_contract_rate_line': (body) => {
      for (const line of body.p_line) card.push({ ...line, version: 1, is_current: true });
      return [200, body.p_line.map((line) => ({ id: line.line_key, line_key: line.line_key, version: 1, changed: true }))];
    },
  });
  try {
    const file = jsonFile([RATE_ROW]);
    const first = await cli(['tm', 'rates', 'set', file, '--apply'], f);
    assert.equal(first.code, 0, JSON.stringify(first.error));
    assert.match(first.json.saved[0].line_key, UUID_RE);
    assert.equal(first.json.current[0].label, 'Surveyor');
    const second = await cli(['tm', 'rates', 'set', file, '--apply'], f);
    assert.equal(second.code, 2);
    assert.match(second.json.rows[0].problems.join(), /already has a current labour line labelled "Surveyor"/);
    assert.deepEqual(writesSent(f), ['save_contract_rate_line'], 'one write, from the first run only');
  } finally { await f.close(); }
});

test('AC-CTM-006 a three-row file is one call; the server refusing it is reported, exit 1', async () => {
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/save_contract_rate_line': [409, { code: '23505', message: 'a new rate version cannot rewrite an already applied effective window' }],
  });
  try {
    const r = await cli(['tm', 'rates', 'set', jsonFile([RATE_ROW, { ...RATE_ROW, label: 'Driver' }, { ...RATE_ROW, label: 'Welder' }]), '--apply'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, '23505');
    assert.equal(r.error.message, 'Conflicts with an existing record: a new rate version cannot rewrite an already applied effective window');
    const saves = f.requests.filter((q) => q.path === '/rest/v1/rpc/save_contract_rate_line');
    assert.equal(saves.length, 1);
    assert.equal(saves[0].body.p_line.length, 3);
  } finally { await f.close(); }
});
```
Run → red. **Code** — append to `pmo-tm-write.mjs`:
```js
/** `tm rates set <file>`: every row in ONE save_contract_rate_line call, or nothing (Q5). */
export async function setRates(api, rows, { apply }) {
  const plan = await planRates(api, rows);
  const shown = plan.map(({ send, ...row }) => row);
  const refused = plan.filter((row) => row.action === 'refused').length;
  const toSend = plan.filter((row) => row.send);
  if (refused > 0) {
    return { exit: 2, result: { applied: false, rows: shown, note: `Nothing was sent: ${refused} row(s) refused. The file saves completely or not at all; fix them and run again.` } };
  }
  if (toSend.length === 0) return { exit: 0, result: { applied: false, rows: shown, note: 'Nothing to save: every row matches the current rate card.' } };
  if (!apply) {
    return { exit: 0, result: { applied: false, rows: shown, next: 'Run the same command with --apply to save these rows in one transaction. A new line keeps the line_key printed by --apply.' } };
  }
  const lines = toSend.map((row) => ({ ...row.send, line_key: row.line_key }));
  const saved = await write(api, 'save_contract_rate_line', { p_line: lines }, `pmo tm rates list --project ${lines[0].project_id}`);
  const keys = new Set(lines.map((line) => line.line_key));
  const current = (await readCurrentLines(api, projectsOf(lines))).filter((line) => keys.has(line.line_key));
  return { exit: 0, result: { applied: true, rows: shown, saved, current } };
}
```
In `scripts/pmo.mjs`:
1. Import after the `pmo-tm.mjs` import:
   ```js
   import { TmOutcomeUnknown, explainWriteError, setRates, writerRefusal } from './lib/pmo-tm-write.mjs';
   ```
   (Tasks 8–13 add their function names to this import.)
2. Add `'work-order', 'document'` to `VALUE_FLAGS`.
3. Above `timeAndMaterials`:
   ```js
   /** The `pmo tm` commands that write (each a preview unless --apply), for an active Admin or Finance member only. */
   const TM_WRITE_COMMANDS = new Set(['rates set']);

   async function tmFile(ctx, arg) {
     if (!arg) throw usage('Give a JSON file of rows (or - for stdin).');
     const text = await readText(ctx, arg);
     try {
       return JSON.parse(text);
     } catch (e) {
       throw usage(`${arg} is not valid JSON (${e.message})`);
     }
   }

   async function tmWrite(ctx, api, command, args, flags) {
     const opts = { apply: Boolean(flags.apply) };
     switch (command) {
       case 'rates set': return setRates(api, await tmFile(ctx, args[0]), opts);
       default: throw usage(`Unknown tm command '${command}'.`);
     }
   }
   ```
4. In `timeAndMaterials`, add `names` to `api`, widen `explain`, and dispatch writes before the reads:
   ```js
   const api = {
     rpc: (name, body) => authed(ctx, 'POST', `/rest/v1/rpc/${name}`, { body }),
     get: (table, query) => authed(ctx, 'GET', `/rest/v1/${table}?${query}`),
     names: (ids) => readNames(ctx, 'profiles', 'full_name', ids),
   };
   const explain = (error, describe = explainTmError) => {
     if (error instanceof TmQueryError) {
       return new CliError(`Nothing was sent: ${error.problems.length} problem(s).`, { exit: 2, code: 'invalid_tm_query', details: error.problems });
     }
     if (error instanceof TmOutcomeUnknown) return new CliError(error.message, { code: 'outcome_unknown', details: { check: error.check } });
     if ((error instanceof CliError && error.exit === 2) || error?.code === undefined) return error;
     return new CliError(describe(error), { code: error.code, status: error.status, hint: error.hint });
   };
   const command = [area, action].filter(Boolean).join(' ');
   if (TM_WRITE_COMMANDS.has(command)) {
     try {
       const { profile } = await readMe(ctx);
       const refusal = writerRefusal(profile, command);
       if (refusal) throw new CliError(refusal, { exit: 2, code: 'tm_role_refused' });
       const outcome = await tmWrite(ctx, api, command, positionals.slice(2), flags);
       return new Reported(outcome.result, outcome.exit);
     } catch (error) {
       throw explain(error, explainWriteError);
     }
   }
   ```
Run → green (AC-CTM-004/005/006 and every AC-TM-017 test).

### Task 7 — The rates transaction itself (AC-CTM-006, pgTAP) (3 min)
In `supabase/tests/tm_rate_sales_items.test.sql` change `select plan(32);` to `select plan(34);` and insert, directly after
the test titled `'AC-TM-018 ending a mapped rate line keeps its sales item on the new current version'` (Finance claims
are set there) and before `reset role;`:
```sql
select throws_ok($q$select save_contract_rate_line(
  '[{"line_key":"18020000-0000-0000-0000-0000000000e7","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Bulk A","unit":"hour","rate":1000,"currency":"IDR","effective_from":"2026-11-01"},{"line_key":"18020000-0000-0000-0000-0000000000e8","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Bulk B","unit":"hour","rate":2000,"currency":"IDR","effective_from":"2026-11-01"},{"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Bulk C","unit":"hour","rate":3000,"currency":"USD","effective_from":"2026-11-01"}]')$q$,
  '23514', null, 'AC-CTM-006 a rates array whose third row is refused raises that refusal');
select is((select count(*)::int from public.contract_rate_lines
            where line_key in ('18020000-0000-0000-0000-0000000000e7', '18020000-0000-0000-0000-0000000000e8')), 0,
  'AC-CTM-006 a refused rates array saves none of its rows (one transaction)');
```
Verify: `scripts/with-db-lock.sh supabase test db supabase/tests/tm_rate_sales_items.test.sql` → 34/34. (Already green:
this proves the shipped RPC; mutation-check by temporarily giving the third row `"currency":"IDR"` → the throws_ok goes
red, then restore.)

### Task 8 — `assign set` (AC-CTM-007) (5 min)
**Test first:**
```js
test('AC-CTM-007 assign set: an identical row is skipped, an overlap is refused in the server\'s words, a new row is created', async () => {
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/set_contract_rate_assignee': (body) => (body.p_user === ENGINEER
      ? [409, { code: '23505', message: 'person already has a labour line over those dates' }]
      : [200, 'cccccccc-cccc-cccc-cccc-cccccccccccc']),
  });
  try {
    const rows = [
      { project_id: PROJECT, line_key: LINE_KEY, user_id: ENGINEER, effective_from: '2026-01-01' },
      { project_id: PROJECT, line_key: LINE_KEY, user_id: ENGINEER, effective_from: '2026-06-01', effective_to: '2026-06-30' },
      { project_id: PROJECT, line_key: LINE_KEY, user_id: OTHER, effective_from: '2026-01-01' },
    ];
    const preview = await cli(['tm', 'assign', 'set', jsonFile(rows)], f);
    assert.equal(preview.code, 0, JSON.stringify(preview.error));
    assert.deepEqual(preview.json.rows.map((row) => row.action), ['skip', 'create', 'create']);
    assert.match(preview.json.rows[1].warnings.join(), /overlaps this person's assignment from 2026-01-01/);
    assert.deepEqual(writesSent(f), []);
    const r = await cli(['tm', 'assign', 'set', jsonFile(rows), '--apply'], f);
    assert.equal(r.code, 1);
    assert.deepEqual(r.json.rows.map((row) => row.action), ['skip', 'refused', 'created']);
    assert.equal(r.json.rows[1].problems[0], 'Conflicts with an existing record: person already has a labour line over those dates');
    assert.equal(r.json.rows[2].assignment_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
    const sent = f.requests.filter((q) => q.path === '/rest/v1/rpc/set_contract_rate_assignee').map((q) => q.body);
    assert.deepEqual(sent, [
      { p_project: PROJECT, p_line_key: LINE_KEY, p_user: ENGINEER, p_from: '2026-06-01', p_to: '2026-06-30' },
      { p_project: PROJECT, p_line_key: LINE_KEY, p_user: OTHER, p_from: '2026-01-01', p_to: null },
    ]);
  } finally { await f.close(); }
});

test('AC-CTM-007 a malformed assignment row is refused locally and never sent', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'assign', 'set', jsonFile([{ ...ASSIGN_ROW, user_id: 'nobody' }]), '--apply'], f);
    assert.equal(r.code, 1);
    assert.match(r.json.rows[0].problems.join(), /user_id must be a person id/);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});
```
Run → red. **Code** (append):
```js
const ASSIGN_KEYS = Object.freeze(['project_id', 'line_key', 'user_id', 'effective_from', 'effective_to']);

export function assignRowProblems(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['each assignment must be a JSON object'];
  const problems = Object.keys(row).filter((key) => !ASSIGN_KEYS.includes(key)).map((key) => `"${key}" is not an assignment field`);
  if (!UUID.test(String(row.project_id ?? ''))) problems.push('project_id must be a project id (uuid)');
  if (!UUID.test(String(row.line_key ?? ''))) problems.push('line_key must be a rate line key (uuid) from `pmo tm rates list`');
  if (!UUID.test(String(row.user_id ?? ''))) problems.push('user_id must be a person id (uuid); list them with `pmo get profiles`');
  if (!isCalendarDate(row.effective_from)) problems.push('effective_from must be a date (YYYY-MM-DD)');
  if (given(row.effective_to) && (!isCalendarDate(row.effective_to) || row.effective_to < row.effective_from)) {
    problems.push('effective_to must be a date on or after effective_from');
  }
  return problems;
}

async function readAssignees(api, projects) {
  const query = new URLSearchParams({ select: 'id,project_id,line_key,user_id,effective_from,effective_to', project_id: `in.(${projects.join(',')})`, order: 'project_id.asc,user_id.asc' });
  return readBounded(api, 'contract_rate_assignees', query, 'assignments');
}

const OPEN_END = '9999-12-31';

/** `tm assign set <file>`: one set_contract_rate_assignee per row; a refused row does not stop the rest (FR-CTM-014/015). */
export async function setAssignees(api, rows, { apply }) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TmQueryError(['the assignments file must be a non-empty JSON array']);
  const valid = rows.filter((row) => assignRowProblems(row).length === 0);
  const projects = projectsOf(valid);
  const users = [...new Set(valid.map((row) => row.user_id.toLowerCase()))];
  const lines = projects.length ? await readCurrentLines(api, projects) : [];
  const held = projects.length ? await readAssignees(api, projects) : [];
  const members = users.length ? await api.get('profiles', new URLSearchParams({ select: 'id,status', id: `in.(${users.join(',')})` })) : [];
  const active = new Set((Array.isArray(members) ? members : []).filter((member) => member.status === 'active').map((member) => member.id));
  const plan = rows.map((row, index) => {
    const problems = assignRowProblems(row);
    if (problems.length) return { index, action: 'refused', problems };
    const [project, lineKey, user] = [row.project_id, row.line_key, row.user_id].map((id) => id.toLowerCase());
    const to = row.effective_to ?? null;
    if (held.some((a) => a.project_id === project && a.line_key === lineKey && a.user_id === user && a.effective_from === row.effective_from && (a.effective_to ?? null) === to)) {
      return { index, action: 'skip', reason: 'this assignment already exists' };
    }
    const warnings = [];
    if (!active.has(user)) warnings.push('not an active member of the organisation: the server will refuse this row');
    if (!lines.some((line) => line.project_id === project && line.line_key === lineKey && line.kind === 'labour')) {
      warnings.push('not a current labour line on this project: the server will refuse this row');
    }
    const clash = held.find((a) => a.project_id === project && a.user_id === user && a.effective_from <= (to ?? OPEN_END) && row.effective_from <= (a.effective_to ?? OPEN_END));
    if (clash) warnings.push(`overlaps this person's assignment from ${clash.effective_from}${clash.effective_to ? ` to ${clash.effective_to}` : ''}: the server will refuse this row`);
    const body = { p_project: project, p_line_key: lineKey, p_user: user, p_from: row.effective_from, p_to: to };
    return { index, action: 'create', ...(warnings.length ? { warnings } : {}), body };
  });
  const shown = () => plan.map(({ body, ...row }) => row);
  if (!apply) {
    return { exit: plan.some((row) => row.action === 'refused') ? 2 : 0, result: { applied: false, rows: shown(), next: 'Run the same command with --apply. Each row is saved on its own; a refused row does not stop the others.' } };
  }
  for (const step of plan.filter((row) => row.body)) {
    try {
      step.assignment_id = await write(api, 'set_contract_rate_assignee', step.body, `pmo tm rates list --project ${step.body.p_project} --assignees`);
      step.action = 'created';
    } catch (error) {
      if (error instanceof TmOutcomeUnknown) throw error;
      Object.assign(step, { action: 'refused', code: error.code, problems: [explainWriteError(error)] });
    }
  }
  return { exit: plan.some((row) => row.action === 'refused') ? 1 : 0, result: { applied: true, rows: shown() } };
}
```
`pmo.mjs`: add `setAssignees` to the import, `'assign set'` to `TM_WRITE_COMMANDS`, and to `tmWrite`:
`case 'assign set': return setAssignees(api, await tmFile(ctx, args[0]), opts);`. Run → green.

### Task 9 — `claim assemble` (AC-CTM-008, -009) (5 min)
**Test first:**
```js
test('AC-CTM-008 an overlapping Draft claim for the same project and work order is reported already_assembled; no writer is called', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'claim', 'assemble', '--project', PROJECT, '--from', '2026-01-10', '--to', '2026-01-20', '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.status, 'already_assembled');
    assert.equal(r.json.claim.id, CLAIM);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-009 an assembled total that differs from the preview prints both with a warning', async () => {
  let listed = 0;
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/list_tm_claims': () => (listed++ === 0
      ? [200, []]
      : [200, [{ ...DRAFT, id: NEW_CLAIM, period_from: '2026-02-01', period_to: '2026-02-28', gross_amount: 6400000 }]]),
    'POST /rest/v1/rpc/assemble_tm_claim': [200, NEW_CLAIM],
  });
  try {
    const r = await cli(['tm', 'claim', 'assemble', '--project', PROJECT, '--from', '2026-02-01', '--to', '2026-02-28', '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.claim_id, NEW_CLAIM);
    assert.deepEqual(r.json.warning.total_changed, { preview: '6000000.00', assembled: '6400000.00' });
    assert.deepEqual(f.requests.find((q) => q.path === '/rest/v1/rpc/assemble_tm_claim').body, { p_project: PROJECT, p_from: '2026-02-01', p_to: '2026-02-28' });
  } finally { await f.close(); }
});
```
Run → red. **Code** (append):
```js
const listClaims = async (api, project) => {
  const rows = await api.rpc('list_tm_claims', { p_project: project });
  return Array.isArray(rows) ? rows : [];
};

/** `tm claim assemble`: preview the window, refuse a second Draft for it, then assemble once (FR-CTM-020..022). */
export async function assembleClaim(api, { project, from, to, workOrder }, { apply }) {
  const body = validatePreview({ project, from, to });
  if (given(workOrder)) {
    if (!UUID.test(String(workOrder))) throw new TmQueryError(['--work-order must be a work order id (uuid)']);
    body.p_work_order = String(workOrder).toLowerCase();
  }
  const preview = summarisePreview(await api.rpc('preview_tm_claim', { p_project: body.p_project, p_from: body.p_from, p_to: body.p_to }));
  const existing = (await listClaims(api, body.p_project)).find((claim) => claim.status === 'Draft'
    && (claim.work_order_id ?? null) === (body.p_work_order ?? null) && claim.period_from <= body.p_to && body.p_from <= claim.period_to);
  if (existing) return { exit: 0, result: { status: 'already_assembled', claim: existing, note: 'A Draft claim already covers this window; nothing was sent.' } };
  if (!apply) return { exit: 0, result: { applied: false, preview, next: 'Run the same command with --apply to assemble this Draft claim.' } };
  const claimId = await write(api, 'assemble_tm_claim', body, `pmo tm claim list --project ${body.p_project}`);
  const claim = (await listClaims(api, body.p_project)).find((row) => row.id === claimId) ?? null;
  const result = { applied: true, claim_id: claimId, claim };
  const assembled = claim ? Number(claim.gross_amount).toFixed(2) : null;
  if (assembled !== preview.total) {
    result.warning = { total_changed: { preview: preview.total, assembled }, note: 'Hours were approved or changed between the preview and the assembly: review the claim before preparing its sign-off.' };
  }
  return { exit: 0, result };
}
```
`pmo.mjs`: import `assembleClaim`; add `'claim assemble'`; `tmWrite` case:
`case 'claim assemble': return assembleClaim(api, { project: flags.project, from: flags.from, to: flags.to, workOrder: flags['work-order'] }, opts);`.
Run → green.

### Task 10 — `claim sources` (FR-CTM-023) (3 min)
**Test first:**
```js
test('FR-CTM-023 claim sources lists each source, whether it is still in the claim, and whether the sign-off is current', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'claim', 'sources', CLAIM], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['list_tm_claim_source_details']);
    assert.deepEqual(f.requests[0].body, { p_claim: CLAIM });
    assert.equal(r.json.signoff_is_current, true);
    assert.deepEqual(r.json.sources, [{ source_id: SOURCE, date: '2026-01-05', who: 'Siti Engineer', units: 8, unit: 'hour', line: 'Site engineer', basis: 'work', in_claim: true }]);
  } finally { await f.close(); }
});
```
Run → red. **Code** (append):
```js
function claimId(claim) {
  if (!UUID.test(String(claim ?? ''))) throw new TmQueryError(['name the claim: <claim-id> (uuid) from `pmo tm claim list --project <id>`']);
  return String(claim).toLowerCase();
}

const readSources = async (api, claim) => {
  const rows = await api.rpc('list_tm_claim_source_details', { p_claim: claim });
  return Array.isArray(rows) ? rows : [];
};

/** `tm claim sources <claim>` (read): each source and whether a prepared sign-off still matches the claim. */
export async function claimSources(api, { claim }) {
  const id = claimId(claim);
  const sources = await readSources(api, id);
  return {
    claim_id: id,
    signoff_is_current: sources[0]?.signoff_is_current ?? null,
    sources: sources.map((s) => ({ source_id: s.id, date: s.entry_date, who: s.person_name ?? s.asset_name ?? s.person_id ?? s.asset_id, units: s.units, unit: s.unit, line: s.line_label, basis: s.basis, in_claim: s.is_selected })),
  };
}
```
`pmo.mjs`: import `claimSources`; in the read section of `timeAndMaterials` (inside the existing `try`), add
`if (area === 'claim' && action === 'sources') return await claimSources(api, { claim: positionals[2] });`. Run → green.

### Task 11 — `claim deselect` (FR-CTM-024) (4 min)
**Test first:**
```js
test('FR-CTM-024 claim deselect removes each named source once, skips one already out, then prints the new total', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/deselect_tm_source': [200, null] });
  try {
    const gone = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const r = await cli(['tm', 'claim', 'deselect', CLAIM, SOURCE, gone, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json.sources.map((s) => s.action), ['deselect', 'skip']);
    assert.deepEqual(f.requests.filter((q) => q.path === '/rest/v1/rpc/deselect_tm_source').map((q) => q.body), [{ p_claim: CLAIM, p_source: SOURCE }]);
    assert.equal(r.json.claim.gross_amount, 6000000);
  } finally { await f.close(); }
});

test('D3 a claim command refuses a claim that is not on the named project, before any write', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/list_tm_claims': [200, []] });
  try {
    const r = await cli(['tm', 'claim', 'deselect', CLAIM, SOURCE, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 2);
    assert.match(r.error.details.join(), /no claim .* on project/);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});
```
Run → red. **Code** (append):
```js
async function findClaim(api, { claim, project }) {
  const problems = [];
  if (!UUID.test(String(claim ?? ''))) problems.push('name the claim: <claim-id> (uuid) from `pmo tm claim list --project <id>`');
  const problem = projectProblem(project);
  if (problem) problems.push(problem);
  if (problems.length) throw new TmQueryError(problems);
  const [id, projectId] = [String(claim).toLowerCase(), String(project).toLowerCase()];
  const found = (await listClaims(api, projectId)).find((row) => row.id === id);
  if (!found) throw new TmQueryError([`no claim ${id} on project ${projectId}: list them with \`pmo tm claim list --project ${projectId}\``]);
  return found;
}

const claimView = (claim) => ({ claim_id: claim.id, status: claim.status, period: `${claim.period_from} → ${claim.period_to}`, currency: claim.currency, gross_amount: claim.gross_amount, lines: claim.lines });

/** `tm claim deselect <claim> <source>…`: one deselect_tm_source per source still in the Draft claim. */
export async function deselectSources(api, { claim, project, sources }, { apply }) {
  const found = await findClaim(api, { claim, project });
  const ids = (sources ?? []).map((id) => String(id).toLowerCase());
  if (ids.length === 0 || ids.some((id) => !UUID.test(id))) throw new TmQueryError(['name one or more source ids (uuid) from `pmo tm claim sources <claim-id>`']);
  if (found.status !== 'Draft') throw new TmQueryError([`only a Draft claim can be changed (this one is ${found.status})`]);
  const details = await readSources(api, found.id);
  const plan = ids.map((id) => {
    const source = details.find((row) => row.id === id);
    if (!source || !source.is_selected) return { source_id: id, action: 'skip', reason: source ? 'already out of the claim' : 'not a source of this claim' };
    return { source_id: id, action: 'deselect', date: source.entry_date, who: source.person_name ?? source.asset_name, units: source.units, unit: source.unit, line: source.line_label };
  });
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), sources: plan, next: 'Run the same command with --apply to take these sources out of the claim.' } };
  for (const step of plan.filter((row) => row.action === 'deselect')) {
    await write(api, 'deselect_tm_source', { p_claim: found.id, p_source: step.source_id }, `pmo tm claim sources ${found.id}`);
  }
  return { exit: 0, result: { applied: true, sources: plan, claim: claimView(await findClaim(api, { claim: found.id, project })) } };
}
```
`pmo.mjs`: import `deselectSources`; add `'claim deselect'`; in `tmWrite` add `const [claim, ...rest] = args;` at the top
and `case 'claim deselect': return deselectSources(api, { claim, project: flags.project, sources: rest }, opts);`.
Run → green.

### Task 12 — `claim withdraw` (FR-CTM-025, AC-CTM-014 withdraw) (4 min)
**Test first:**
```js
test('AC-CTM-014 withdrawing a claim that is already withdrawn reports already_withdrawn and sends nothing', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/list_tm_claims': [200, [{ ...DRAFT, status: 'Withdrawn' }]] });
  try {
    const r = await cli(['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { status: 'already_withdrawn', claim_id: CLAIM });
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('FR-CTM-025 the withdraw preview shows the status and what it releases', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.claim.status, 'Draft');
    assert.match(r.json.releases, /^1 source\(s\) become claimable again/);
  } finally { await f.close(); }
});
```
Run → red. **Code** (append):
```js
/** `tm claim withdraw <claim>`: withdraw_tm_signoff once; a Withdrawn claim is reported, not withdrawn twice. */
export async function withdrawClaim(api, { claim, project }, { apply }) {
  const found = await findClaim(api, { claim, project });
  if (found.status === 'Withdrawn') return { exit: 0, result: { status: 'already_withdrawn', claim_id: found.id } };
  const live = (await readSources(api, found.id)).filter((row) => row.is_selected).length;
  const releases = `${live} source(s) become claimable again${found.status === 'SignedOff' ? '; a signed-off claim with an invoice, or an ERP raise in flight, is refused: cancel the invoice instead' : ''}`;
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), releases, next: 'Run the same command with --apply to withdraw the claim.' } };
  await write(api, 'withdraw_tm_signoff', { p_claim: found.id }, `pmo tm claim list --project ${String(project).toLowerCase()}`);
  const after = await findClaim(api, { claim: found.id, project });
  return { exit: 0, result: { applied: true, claim_id: found.id, status: after.status } };
}
```
`pmo.mjs`: import `withdrawClaim`; add `'claim withdraw'`; `case 'claim withdraw': return withdrawClaim(api, { claim, project: flags.project }, opts);`.
Run → green.

### Task 13 — `signoff prepare` (FR-CTM-030, AC-CTM-012) (5 min)
**Test first:**
```js
test('AC-CTM-012 preparing against a Draft document or one without a file warns that confirmation will refuse it', async () => {
  for (const [doc, re] of [[{ ...DOC, status: 'Draft' }, /Issued or Approved/], [{ ...DOC, file_path: null }, /has no file/]]) {
    const f = await fake({ ...READS(), 'GET /rest/v1/project_documents': [200, [doc]] });
    try {
      const r = await cli(['tm', 'signoff', 'prepare', CLAIM, '--project', PROJECT, '--document', DOCUMENT], f);
      assert.equal(r.code, 0, JSON.stringify(r.error));
      assert.match(r.json.warnings.join(), re);
      assert.deepEqual(writesSent(f), []);
    } finally { await f.close(); }
  }
});

test('FR-CTM-030 a document from another project is refused before sending', async () => {
  const f = await fake({ ...READS(), 'GET /rest/v1/project_documents': [200, [{ ...DOC, project_id: OTHER }]] });
  try {
    const r = await cli(['tm', 'signoff', 'prepare', CLAIM, '--project', PROJECT, '--document', DOCUMENT, '--apply'], f);
    assert.equal(r.code, 2);
    assert.match(r.error.details.join(), /must belong to the claim's project/);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});
```
Run → red. **Code** (append):
```js
async function readDocument(api, id) {
  const rows = await api.get('project_documents', new URLSearchParams({ select: 'id,project_id,title,revision,status,file_path', id: `eq.${id}` }));
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

/** Why confirmation would refuse this document (it re-checks both at confirm). */
function documentWarnings(doc) {
  const warnings = [];
  if (!['Issued', 'Approved'].includes(doc.status)) warnings.push(`the document is ${doc.status}: confirmation will refuse it until it is Issued or Approved (Project → Documents)`);
  if (!String(doc.file_path ?? '').trim()) warnings.push('the document has no file: confirmation will refuse it until one is uploaded (`pmo documents upload`)');
  return warnings;
}

const documentView = (doc) => ({ document_id: doc.id, title: doc.title, revision: doc.revision, status: doc.status, has_file: Boolean(String(doc.file_path ?? '').trim()) });

/** `tm signoff prepare <claim> --document <id>`: prepare_tm_signoff once (FR-CTM-030). */
export async function prepareSignoff(api, { claim, project, document, note }, { apply }) {
  const found = await findClaim(api, { claim, project });
  const problems = [];
  if (!UUID.test(String(document ?? ''))) problems.push('--document must be the signed project document id (uuid) from `pmo documents list --project <id>`');
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > 500) problems.push('--note may have at most 500 characters');
  if (found.status !== 'Draft') problems.push(`only a Draft claim can be prepared for sign-off (this one is ${found.status})`);
  const doc = problems.length ? null : await readDocument(api, String(document).toLowerCase());
  if (!problems.length && !doc) problems.push('document not found (or not visible to you)');
  // list_tm_claims carries no project id: the claim was found under --project, so the document must be on that project.
  if (doc && doc.project_id !== String(project).toLowerCase()) problems.push("the sign-off document must belong to the claim's project");
  if (problems.length) throw new TmQueryError(problems);
  const warnings = documentWarnings(doc);
  const body = { p_claim: found.id, p_document: doc.id, ...(text ? { p_note: text } : {}) };
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), document: documentView(doc), warnings, next: 'Run the same command with --apply to prepare the sign-off.' } };
  await write(api, 'prepare_tm_signoff', body, `pmo tm claim sources ${found.id}`);
  const after = await findClaim(api, { claim: found.id, project });
  const current = (await readSources(api, found.id))[0]?.signoff_is_current ?? null;
  return { exit: 0, result: { applied: true, claim_id: found.id, prepared_by: after.signoff_prepared_by, document_id: after.document_id, signoff_is_current: current, warnings } };
}
```
`pmo.mjs`: import `prepareSignoff`; add `'signoff prepare'`; `case 'signoff prepare': return prepareSignoff(api, { claim, project: flags.project, document: flags.document, note: flags.note }, opts);`.
Run → green.

### Task 14 — Cross-command contracts (AC-CTM-001, -002, -003, -010, FR-CTM-008) (5 min)
These pin the whole surface; each is mutation-checked below. Append:
```js
/** One row per write command: its preview argv, its apply argv, its RPC, the exact body the app sends, the server's answer. */
const COMMANDS = () => [
  { argv: ['tm', 'rates', 'set', jsonFile([RATE_ROW])], rpc: 'save_contract_rate_line', answer: [200, [{ id: 'r1', line_key: LINE_KEY, version: 1, changed: true }]],
    body: (b) => { assert.deepEqual(Object.keys(b), ['p_line']); const { line_key, ...rest } = b.p_line[0]; assert.match(line_key, UUID_RE); assert.deepEqual(rest, RATE_ROW); } },
  { argv: ['tm', 'assign', 'set', jsonFile([ASSIGN_ROW])], rpc: 'set_contract_rate_assignee', answer: [200, 'cccccccc-cccc-cccc-cccc-cccccccccccc'],
    body: { p_project: PROJECT, p_line_key: LINE_KEY, p_user: OTHER, p_from: '2027-01-01', p_to: null } },
  { argv: ['tm', 'claim', 'assemble', '--project', PROJECT, '--from', '2026-02-01', '--to', '2026-02-28'], rpc: 'assemble_tm_claim', answer: [200, CLAIM],
    body: { p_project: PROJECT, p_from: '2026-02-01', p_to: '2026-02-28' } },
  { argv: ['tm', 'claim', 'deselect', CLAIM, SOURCE, '--project', PROJECT], rpc: 'deselect_tm_source', answer: [200, null], body: { p_claim: CLAIM, p_source: SOURCE } },
  { argv: ['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT], rpc: 'withdraw_tm_signoff', answer: [200, null], body: { p_claim: CLAIM } },
  { argv: ['tm', 'signoff', 'prepare', CLAIM, '--project', PROJECT, '--document', DOCUMENT], rpc: 'prepare_tm_signoff', answer: [200, null], body: { p_claim: CLAIM, p_document: DOCUMENT } },
];

test('AC-CTM-001 every write command without --apply sends only reads and calls no writer', async () => {
  for (const { argv } of COMMANDS()) {
    const f = await fake(READS());
    try {
      const r = await cli(argv, f);
      assert.equal(r.code, 0, `${argv.join(' ')} → ${JSON.stringify(r.error ?? r.json)}`);
      assert.equal(r.json.applied, false);
      assert.deepEqual(writesSent(f), [], argv.join(' '));
      for (const q of f.requests) {
        assert.ok(q.method === 'GET' || TM_READ_RPCS.includes(q.path.slice('/rest/v1/rpc/'.length)), `${argv.join(' ')} sent ${q.method} ${q.path}`);
      }
    } finally { await f.close(); }
  }
});

test('AC-CTM-002 every write command with --apply calls its one RPC once, with the app\'s arguments and no org, caller or amount', async () => {
  for (const { argv, rpc, answer, body } of COMMANDS()) {
    const f = await fake({ ...READS(), [`POST /rest/v1/rpc/${rpc}`]: answer });
    try {
      const r = await cli([...argv, '--apply'], f);
      assert.equal(r.code, 0, `${argv.join(' ')} → ${JSON.stringify(r.error ?? r.json)}`);
      assert.deepEqual(writesSent(f), [rpc]);
      const sent = f.requests.find((q) => q.path === `/rest/v1/rpc/${rpc}`).body;
      if (typeof body === 'function') body(sent); else assert.deepEqual(sent, body);
      const posted = JSON.stringify(f.requests.filter((q) => q.method !== 'GET').map((q) => q.body));
      assert.doesNotMatch(posted, /"(org_id|p_org|created_by|prepared_by|amount|gross_amount|p_amount)"/);
      assert.equal(posted.includes(FINANCE_A), false, 'the caller\'s id is never sent');
    } finally { await f.close(); }
  }
});

test('AC-CTM-003 a Project Manager, Engineer, Executive or inactive Finance member is refused before any RPC, naming the app', async () => {
  for (const [role, status] of [['Project Manager', 'active'], ['Engineer', 'active'], ['Executive', 'active'], ['Finance', 'disabled']]) {
    for (const { argv } of COMMANDS()) {
      for (const extra of [[], ['--apply']]) {
        const f = await fake({ ...READS(), ...signedIn(role, { status }) });
        try {
          const r = await cli([...argv, ...extra], f);
          assert.equal(r.code, 2, `${role} ${argv.join(' ')}`);
          assert.equal(r.error.code, 'tm_role_refused');
          assert.match(r.error.message, /active Admin or Finance member/);
          assert.match(r.error.message, /Contract & billing → Time and materials/);
          assert.deepEqual(rpcCalls(f), []);
        } finally { await f.close(); }
      }
    }
  }
});

test('AC-CTM-010 a server refusal prints its headline and the server\'s own message, exit 1', async () => {
  for (const code of ['42501', 'P0001', 'P0002', '22023', '23505', '23514', '40001', '55000']) {
    const f = await fake({ ...READS(), 'POST /rest/v1/rpc/withdraw_tm_signoff': [400, { code, message: `server reason ${code}` }] });
    try {
      const r = await cli(['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT, '--apply'], f);
      assert.equal(r.code, 1);
      assert.equal(r.error.code, code);
      assert.equal(r.error.message, explainWriteError({ code, message: `server reason ${code}` }));
      assert.ok(r.error.message.endsWith(`: server reason ${code}`));
    } finally { await f.close(); }
  }
});

test('FR-CTM-008 a write whose connection drops reports an unknown outcome, names the read to check, and is not retried', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/withdraw_tm_signoff': 'drop' });
  try {
    const r = await cli(['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, 'outcome_unknown');
    assert.match(r.error.details.check, /^pmo tm claim list --project /);
    assert.equal(writesSent(f).length, 1, 'sent once, never retried');
  } finally { await f.close(); }
});
```
Run → green. **Mutation checks** (do each, see red, revert): in `assembleClaim` call `assemble_tm_claim` before the
`if (!apply)` → AC-CTM-001 red; in `tmWrite` skip the `writerRefusal` call → AC-CTM-003 red; add `org_id: 'x'` to the
withdraw body → AC-CTM-002 red; in `write()` retry once on failure → FR-CTM-008 red.

### Task 15 — The deliberate change to the old "unknown command" test, usage text (3 min)
`rates set` and `claim assemble` now exist, so the existing test `'AC-TM-017 a bad query is refused before any request (exit 2)'`
must stop calling them unknown. Its goal — refused before any request, exit 2 — stays; this is a deliberate UX change,
not a weakened assertion. In that test:
1. Leave `cases` as it is. Replace the second loop's list with commands that still do not exist:
   ```js
   for (const argv of [['tm', 'wipe'], ['tm', 'rates', 'delete'], ['tm', 'claim', 'approve']]) {
   ```
2. Append a new test (the write commands read the signed-in profile first, so they get their own fake):
   ```js
   test('AC-CTM-001 a write command with missing input is refused before any RPC (exit 2)', async () => {
     const f = await fake(READS());
     try {
       for (const argv of [['tm', 'rates', 'set'], ['tm', 'claim', 'assemble', '--project', PROJECT], ['tm', 'claim', 'withdraw', 'not-a-uuid', '--project', PROJECT]]) {
         const r = await cli(argv, f);
         assert.equal(r.code, 2, `${argv.join(' ')} → ${JSON.stringify(r.error)}`);
       }
       assert.deepEqual(rpcCalls(f), []);
     } finally { await f.close(); }
   });
   ```
3. `scripts/pmo.mjs`: in the header comment and in `USAGE` (after the `tm claim list` lines, `scripts/pmo.mjs:863-867`) add:
   ```
     pmo tm rates set <file.json|-> [--apply]   (active Admin, Finance; one transaction: every row or none — #1856)
     pmo tm assign set <file.json|-> [--apply]   (active Admin, Finance; row by row)
     pmo tm claim assemble --project <id> --from <date> --to <date> [--work-order <id>] [--apply]   (active Admin, Finance)
     pmo tm claim sources <claim-id>   (each source, and whether the prepared sign-off is current)
     pmo tm claim deselect <claim-id> <source-id>... --project <id> [--apply]   (active Admin, Finance; Draft claims)
     pmo tm claim withdraw <claim-id> --project <id> [--apply]   (active Admin, Finance)
     pmo tm signoff prepare <claim-id> --project <id> --document <document-id> [--note <text>] [--apply]   (active Admin, Finance)
   ```
   and change the final `throw usage(…)` in `timeAndMaterials` to
   `Use rates list|set, assign set, claim preview|list|assemble|sources|deselect|withdraw or signoff prepare.`
Run → green. `scripts/with-test-lock.sh node --test scripts/pmo.test.mjs` → green (USAGE is printed there).

### Task 16 — Runbook recipe 7 (AC-CTM-018) (5 min)
In `docs/runbooks/pmo-cli.md`:
1. Line 10 (what the CLI can do): replace `read-only T&M inspection` with `T&M rate cards, assignments, claim assembly and
   sign-off preparation`.
2. Line 14 (roles): append `T&M writes (rates, assignments, claims, sign-off) are for an active Admin or Finance member;
   a Project Manager uses the app for the same steps.`
3. Replace the body of `### 7. Time and materials` (lines 538–554) with:
   ````markdown
   ### 7. Time and materials

   **Who:** reads for Admin, Finance, Executive or the project's Project Manager; every write for an active Admin or Finance
   member (a Project Manager does the same steps in the app).

   **Every write previews first.** Without `--apply` a command reads, prints what it would do and every problem it sees, and
   writes nothing. With `--apply` it writes once and prints what the server now holds. A preview is advice: the server
   re-checks everything. If a write's outcome is unknown (`outcome_unknown`), run the read it names; never rerun blindly.

   ```bash
   node scripts/pmo.mjs tm rates list --project <project-uuid> --assignees --json
   node scripts/pmo.mjs tm rates set rates.json            # preview; then again with --apply
   node scripts/pmo.mjs tm assign set assignments.json --apply
   node scripts/pmo.mjs tm claim preview --project <project-uuid> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
   node scripts/pmo.mjs tm claim assemble --project <project-uuid> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --apply
   node scripts/pmo.mjs tm claim sources <claim-uuid>
   node scripts/pmo.mjs tm claim deselect <claim-uuid> <source-uuid>... --project <project-uuid> --apply
   node scripts/pmo.mjs tm signoff prepare <claim-uuid> --project <project-uuid> --document <document-uuid> --apply
   node scripts/pmo.mjs tm claim withdraw <claim-uuid> --project <project-uuid> --apply
   ```

   **Rates file:** a JSON array of `{project_id, kind, label, unit, rate, currency, effective_from}` (optional
   `effective_to`, `asset_id` + `standby_rate` for equipment, `sales_item_code`). To change a line, add its `line_key` and
   `expected_version` from `rates list`. The whole file saves or none of it does; the preview marks each row create, new
   version, unchanged or refused. A new line's key is printed by `--apply`; running the same file again refuses it as a
   duplicate label. **Assignments file:** `{project_id, line_key, user_id, effective_from}` (optional `effective_to`); each
   row is saved on its own, an identical row is skipped.

   **Reruns are safe:** an overlapping Draft claim is reported `already_assembled`, a withdrawn claim `already_withdrawn`;
   nothing is sent.

   **Stays in the app:** entering and approving time (**Timesheets**), issuing the signed document (**Project →
   Documents**; `pmo documents create|upload` registers a Draft and its file), raising an invoice when an ERP owns revenue,
   and approving any invoice (**Project → Contract & billing**).

   **How to verify:** after each `--apply`, the printed state is the server's; compare `claim list` with the app's T&M panel.

   **Common errors:** `tm_role_refused` (sign in as Admin or Finance); a refused rates row (fix the file; nothing was saved);
   `Changed since it was read` (re-read `rates list`); `Refused in the claim's current state` (the claim is no longer Draft,
   or an hour in it is no longer approved).
   ````
4. Line 663 (command scope): replace `author T&M data,` with `enter or approve time, approve an invoice,`.
Doc review: every slice-1 command is listed with roles, the preview/apply rule and the app-only steps (AC-CTM-018).

### Task 17 — Share the CLI e2e harness (5 min, behaviour-preserving)
Move the CLI-driving helpers out of `pmo-portal/e2e/AC-CLI-001-cli-oauth-login.spec.ts` so AC-CTM-017 reuses them instead of
a second copy. Create `pmo-portal/e2e/support/pmoCli.ts` (the bodies are AC-CLI-001's, lines 60–160, 203–215 and 174–184 at
dev `d2320be80`, with `clientId` / `clientName` moved into a closure so each spec keeps its own OAuth client):
```ts
import { expect, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedContextOptions, requireServiceRoleKey, SEED_PASSWORD } from '../helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../../scripts/pmo.mjs');
const REGISTER = path.resolve(HERE, '../../../scripts/register-oauth-client.mjs');
export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  json: unknown;
  error: { message: string; code?: string; status?: number; details?: unknown } | null;
}

export function parseResult(code: number | null, stdout: string, stderr: string): CliResult {
  let json: unknown = null;
  let error: CliResult['error'] = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    /* no stdout JSON */
  }
  const last = stderr.trim().split('\n').pop() ?? '';
  try {
    error = (JSON.parse(last) as { error: CliResult['error'] }).error;
  } catch {
    /* no error JSON */
  }
  return { code, stdout, stderr, json, error };
}

const serviceHeaders = () => ({ apikey: requireServiceRoleKey() ?? '', authorization: `Bearer ${requireServiceRoleKey()}` });

/** One spec's CLI: its own registered OAuth client (named `<clientPrefix><run>`), the CLI spawned under it, Playwright as the browser. */
export function createCliHarness(clientPrefix: string) {
  let clientId = '';
  let clientName = '';

  function cliEnv(configDir: string): NodeJS.ProcessEnv {
    return { ...process.env, PMO_CONFIG_DIR: configDir, PMO_SUPABASE_URL: SUPABASE_URL, PMO_SUPABASE_KEY: ANON_KEY, PMO_CLIENT_ID: clientId };
  }

  function pmo(configDir: string, args: string[]): Promise<CliResult> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { env: cliEnv(configDir) });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve(parseResult(code, stdout, stderr)));
    });
  }

  /**
   * `pmo login --no-browser`, with Playwright as the browser: open the printed sign-in URL, sign in on /login (the consent
   * screen sent us there), check the consent screen, click Allow. A user who already allowed this client is not asked again.
   */
  async function loginAs(
    browser: Browser,
    configDir: string,
    user: { email: string },
    contextOptions: ReturnType<typeof ownedContextOptions>,
    { consent = 'ask' }: { consent?: 'ask' | 'already' } = {},
  ): Promise<CliResult> {
    const child = spawn(process.execPath, [CLI, 'login', '--no-browser', '--timeout', '90'], { env: cliEnv(configDir) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    const done = new Promise<CliResult>((resolve) => child.on('close', (code) => resolve(parseResult(code, stdout, stderr))));
    const authorizeUrl = await new Promise<string>((resolve, reject) => {
      child.stderr.on('data', (d) => {
        stderr += d;
        const m = stderr.match(/https?:\/\/\S+\/auth\/v1\/oauth\/authorize\?\S+/);
        if (m) resolve(m[0]);
      });
      child.on('close', () => reject(new Error(`pmo login exited before printing a URL:\n${stderr}`)));
    });
    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage();
      await page.goto(authorizeUrl);
      await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(SEED_PASSWORD);
      await page.getByRole('button', { name: /sign in/i }).click();
      if (consent === 'ask') {
        await expect(page).toHaveURL(/\/oauth\/consent\?authorization_id=/, { timeout: 20_000 });
        await expect(page.getByRole('heading', { level: 1, name: `Allow ${clientName} to access your PMO account?` })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
        await page.getByRole('button', { name: 'Allow' }).click();
      }
      await expect(page.getByRole('heading', { name: 'Signed in to PMO' })).toBeVisible({ timeout: 20_000 });
    } finally {
      await context.close();
    }
    return done;
  }

  /** The one-time admin setup, run for real: registers a PUBLIC client with the CLI's loopback URIs. */
  async function register(run: string): Promise<void> {
    clientName = `${clientPrefix}${run}`;
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [REGISTER, '--name', clientName], {
        env: { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: requireServiceRoleKey() },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`register failed: ${stderr}`))));
    });
    clientId = (JSON.parse(out) as { client_id: string }).client_id;
  }

  /** Delete every OAuth client this harness's prefix names (a crashed earlier run's included). */
  async function sweepClients(): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/oauth/clients?per_page=1000`, { headers: serviceHeaders() });
    const { clients = [] } = (await res.json()) as { clients?: { client_id: string; client_name: string }[] };
    for (const c of clients.filter((x) => x.client_name.startsWith(clientPrefix))) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/oauth/clients/${c.client_id}`, { method: 'DELETE', headers: serviceHeaders() });
    }
  }

  return { register, sweepClients, pmo, loginAs };
}
```
In AC-CLI-001:
1. Delete `CLI`, `REGISTER`, `SUPABASE_URL`, `ANON_KEY`, `clientId`, `clientName`, `interface CliResult`, `parseResult`,
   `cliEnv`, `pmo` and `loginAs`; add `import { ANON_KEY, SUPABASE_URL, createCliHarness } from './support/pmoCli';` and
   `const cli = createCliHarness(CLIENT_PREFIX);` and `const { pmo, loginAs } = cli;` (every call site stays as it is;
   `loginAs` already receives a `Fixture`, which has `email`). Drop imports that become unused (`spawn`, `fileURLToPath`,
   `expect` stays — the tests use it).
2. In `sweep()`, replace the client list + DELETE loop (its last 11 lines) with `await cli.sweepClients();`.
3. In `beforeAll`, replace the `clientName = …` line, the `REGISTER` spawn and the `clientId = …` line with
   `await cli.register(RUN);`.
The prefixes do not collide: AC-CLI-001's `'PMO CLI e2e '` is not a prefix of AC-CTM-017's `'PMO CLI CTM e2e '` and the
reverse, so neither spec's sweep deletes the other's client mid-run.
Verify: `cd pmo-portal && npx eslint --max-warnings=0 e2e/support/pmoCli.ts e2e/AC-CLI-001-cli-oauth-login.spec.ts && npm run typecheck`,
then `scripts/e2e-local.sh AC-CLI-001` → the same 5 tests pass as before the move.

### Task 18 — The curated journey, base steps (AC-CTM-017) (5 min)
Read `docs/e2e-parallel-conventions.md` first. Create `pmo-portal/e2e/AC-CTM-017-cli-time-and-materials.spec.ts`:
```ts
// @e2e-isolation: self-isolated — registers its OWN OAuth client; creates run-scoped users (a second Finance member and an engineer whose line manager is the seeded PM) and a project named "E2E CTM-017 <run>". Claims are immutable once signed off, so the project is archived and the run's users disabled at the end, never deleted.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownedContextOptions, requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { ANON_KEY, SUPABASE_URL, createCliHarness } from './support/pmoCli';

/**
 * AC-CTM-017 (#1856) — one T&M month run from the command line against the real stack: Finance A keeps the rate card,
 * assigns the engineer, and (after the engineer's week is entered and approved through the app's own calls) assembles the
 * claim and prepares its sign-off. The CLI's logic is unit-tested in scripts/pmo-tm.test.mjs; this proves the guard,
 * RLS and the RPCs accept exactly what the CLI sends.
 */
test.describe.configure({ mode: 'default' });
test.setTimeout(240_000);

const SEED_ORG = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FINANCE_A = 'finance@acme.test';
const MANAGER = 'pm@acme.test';
const HOURS = 8;
const RATE = 50_000;
const cli = createCliHarness('PMO CLI CTM e2e ');

let admin: SupabaseClient;
let projectId = '';
let documentId = '';
let weekStart = '';
const users = {} as Record<'financeB' | 'engineer', { id: string; email: string }>;
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-ctm-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-ctm-b-'));

const day = (iso: string, add: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + add * 86_400_000).toISOString().slice(0, 10);
function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
/** A browser-equivalent session (no client_id): the app's own RPC calls, as the Timesheets screen makes them. */
async function appSession(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`AC-CTM-017 sign-in ${email}: ${error.message}`);
  return client;
}
async function fixtureUser(role: 'Finance' | 'Engineer', label: string, extra: Record<string, unknown> = {}) {
  const email = `e2e-ctm-017-${label}-${RUN}@acme.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`AC-CTM-017 fixture user: ${error?.message}`);
  const profile = await admin.from('profiles').upsert({ id: data.user.id, org_id: SEED_ORG, email, full_name: `CTM ${label}`, role, status: 'active', ...extra }, { onConflict: 'id' });
  if (profile.error) throw new Error(`AC-CTM-017 fixture profile: ${profile.error.message}`);
  return { id: data.user.id, email };
}

test.beforeAll(async () => {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('AC-CTM-017 requires the local Supabase stack');
  admin = createClient(SUPABASE_URL, requireServiceRoleKey() ?? '', { auth: { persistSession: false } });
  await cli.register(RUN);
  const manager = await admin.from('profiles').select('id').eq('email', MANAGER).single();
  if (manager.error) throw new Error(`AC-CTM-017 seeded manager: ${manager.error.message}`);
  users.financeB = await fixtureUser('Finance', 'fin-b');
  users.engineer = await fixtureUser('Engineer', 'eng', { manager_id: manager.data.id });
  const today = new Date();
  weekStart = day(today.toISOString().slice(0, 10), -((today.getUTCDay() + 6) % 7));
  const company = await admin.from('companies').insert({ org_id: SEED_ORG, name: `E2E CTM-017 ${RUN} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-CTM-017 client: ${company.error.message}`);
  const project = await admin.from('projects').insert({
    org_id: SEED_ORG, name: `E2E CTM-017 ${RUN}`, status: 'Ongoing Project', currency: 'IDR', client_id: company.data.id,
    project_manager_id: manager.data.id, contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false,
    tax_rate: null, tax_base_numerator: 1, tax_base_denominator: 1, start_date: weekStart, end_date: day(weekStart, 365),
  }).select('id').single();
  if (project.error) throw new Error(`AC-CTM-017 project: ${project.error.message}`);
  projectId = project.data.id;
  documentId = randomUUID();
  const doc = await admin.from('project_documents').insert({
    id: documentId, org_id: SEED_ORG, project_id: projectId, category: 'Client sign-off', title: `Approved hours ${RUN}`,
    revision: 'A', status: 'Issued', file_path: `${SEED_ORG}/${projectId}/${documentId}/hours.pdf`, author_id: manager.data.id,
  });
  if (doc.error) throw new Error(`AC-CTM-017 document: ${doc.error.message}`);
});

test.afterAll(async () => {
  if (!admin) return;
  if (projectId) await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId);
  const ids = Object.values(users).map((u) => u.id);
  if (ids.length) await admin.from('profiles').update({ status: 'disabled' }).in('id', ids);
  await cli.sweepClients();
  for (const dir of [dirA, dirB]) fs.rmSync(dir, { recursive: true, force: true });
});

test('AC-CTM-017 Finance runs the T&M month from the CLI: rates, assignment, assembly and sign-off on approved hours', async ({ browser }, testInfo) => {
  const loginA = await cli.loginAs(browser, dirA, { email: FINANCE_A }, ownedContextOptions(testInfo));
  expect(loginA.code, loginA.stderr).toBe(0);

  // A keeps the rate card: the preview writes nothing, --apply saves the line.
  const rates = writeJson(dirA, 'rates.json', [{ project_id: projectId, kind: 'labour', label: 'Field engineer', unit: 'hour', rate: RATE, currency: 'IDR', effective_from: weekStart }]);
  const preview = await cli.pmo(dirA, ['tm', 'rates', 'set', rates]);
  expect(preview.code, preview.stderr).toBe(0);
  expect((await admin.from('contract_rate_lines').select('id').eq('project_id', projectId)).data).toEqual([]);
  const saved = await cli.pmo(dirA, ['tm', 'rates', 'set', rates, '--apply']);
  expect(saved.code, saved.stderr).toBe(0);
  const lineKey = (saved.json as { saved: { line_key: string }[] }).saved[0].line_key;
  const assign = writeJson(dirA, 'assign.json', [{ project_id: projectId, line_key: lineKey, user_id: users.engineer.id, effective_from: weekStart }]);
  const assigned = await cli.pmo(dirA, ['tm', 'assign', 'set', assign, '--apply']);
  expect(assigned.code, assigned.stderr).toBe(0);

  // The engineer enters the week and the line manager approves it: the app's own calls (no CLI).
  const engineer = await appSession(users.engineer.email);
  const sheet = await engineer.rpc('save_timesheet_week', { p_timesheet_id: null, p_week_start_date: weekStart, p_upserts: [{ project_id: projectId, entry_date: weekStart, hours: HOURS, notes: 'CTM-017' }], p_delete_ids: [] });
  expect(sheet.error).toBeNull();
  expect((await engineer.rpc('transition_timesheet', { p_timesheet_id: sheet.data, p_to: 'Submitted' })).error).toBeNull();
  const manager = await appSession(MANAGER);
  expect((await manager.rpc('transition_timesheet', { p_timesheet_id: sheet.data, p_to: 'Approved' })).error).toBeNull();

  // A assembles the approved hours at the contract rate; a rerun assembles nothing more.
  const window = ['--project', projectId, '--from', weekStart, '--to', day(weekStart, 6)];
  const assembled = await cli.pmo(dirA, ['tm', 'claim', 'assemble', ...window, '--apply']);
  expect(assembled.code, assembled.stderr).toBe(0);
  const claim = assembled.json as { claim_id: string; claim: { lines: { units: number; rate: number; amount: number }[] } };
  expect(claim.claim.lines).toEqual([expect.objectContaining({ units: HOURS, rate: RATE, amount: HOURS * RATE })]);
  const again = await cli.pmo(dirA, ['tm', 'claim', 'assemble', ...window, '--apply']);
  expect((again.json as { status: string }).status).toBe('already_assembled');

  // A prepares the sign-off against the Issued document.
  const prepared = await cli.pmo(dirA, ['tm', 'signoff', 'prepare', claim.claim_id, '--project', projectId, '--document', documentId, '--apply']);
  expect(prepared.code, prepared.stderr).toBe(0);
  expect(prepared.json).toMatchObject({ applied: true, document_id: documentId, signoff_is_current: true });
  // Task 20 (confirm) and Task 21 (invoice) continue the journey here.
});
```
Verify: `cd pmo-portal && npx eslint --max-warnings=0 e2e/AC-CTM-017-cli-time-and-materials.spec.ts && npm run check:e2e-isolation`,
then `scripts/e2e-local.sh AC-CTM-017` → 1 passed. (If an app RPC refuses a step, read its message and fix the fixture or
the app; never seed timesheet or claim rows directly — the journey must go through the app's calls.)

### Task 19 — Slice gate and commit (5 min)
From the worktree root, each in the foreground:
```bash
scripts/with-test-lock.sh node --test scripts/pmo-tm.test.mjs scripts/pmo.test.mjs scripts/api-client-guard-coverage.test.mjs
(cd pmo-portal && npm run check:guards && npm run typecheck \
  && npx eslint --max-warnings=0 e2e/support/pmoCli.ts e2e/AC-CLI-001-cli-oauth-login.spec.ts e2e/AC-CTM-017-cli-time-and-materials.spec.ts)
scripts/e2e-local.sh AC-CLI-001 && scripts/e2e-local.sh AC-CTM-017
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
node scripts/check-isolation-denominator.mjs --self-test && node scripts/check-isolation-denominator.mjs
git log --format='%an %ae %cn %ce%n%B' origin/dev..HEAD | grep -iE 'claude|anthropic|co-authored|generated with'   # prints nothing
```
The whole pgTAP suite runs because Task 7 changes a SQL test (one lock hold, after a reset). `api-client-guard-coverage`
runs because it scans `scripts/lib/*.mjs`. Script step: touched files only, full step left to CI. Report pass/fail counts
from the output body, not `$?`.

---

### Task 20 — OWNER-GATED (Q3): `signoff confirm` from the CLI
Delete this whole task if the owner answers **no** (then `signoff confirm` stays in the app). Its own tests and its own
commit (`feat(cli): pmo tm signoff confirm (#1856)`). No server change: `confirm_tm_signoff` is already in `tm_write_rpcs`.

**20.1 Tests first (3 min)** — append to `scripts/pmo-tm.test.mjs`:
```js
test('AC-CTM-011 a confirmer who assembled or prepared the claim is warned, and the server\'s refusal is shown verbatim', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/confirm_tm_signoff': [403, { code: '42501', message: 'separation of duties: the preparer cannot confirm this sign-off' }] });
  try {
    const preview = await cli(['tm', 'signoff', 'confirm', CLAIM, '--project', PROJECT], f);
    assert.equal(preview.code, 0, JSON.stringify(preview.error));
    assert.match(preview.json.warnings.join(), /you assembled or prepared this claim: the server refuses your confirmation unless you are the organisation's only active member/);
    const r = await cli(['tm', 'signoff', 'confirm', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.message, 'Not allowed (role or separation of duties): separation of duties: the preparer cannot confirm this sign-off');
  } finally { await f.close(); }
});

test('AC-CTM-014 confirming a claim already signed off reports already_signed_off with who confirmed it', async () => {
  const f = await fake({
    ...READS(),
    ...signedIn('Finance', { id: OTHER, people: [{ id: FINANCE_A, full_name: 'Finance A' }] }),
    'POST /rest/v1/rpc/list_tm_claims': [200, [{ ...DRAFT, status: 'SignedOff', confirmed_by: FINANCE_A, confirm_basis: 'standard' }]],
  });
  try {
    const r = await cli(['tm', 'signoff', 'confirm', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { status: 'already_signed_off', claim_id: CLAIM, confirmed_by: 'Finance A', confirm_basis: 'standard' });
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('FR-CTM-032 a confirmation prints the basis and gross the server returned', async () => {
  const f = await fake({
    ...READS(),
    ...signedIn('Finance', { id: OTHER }),
    'POST /rest/v1/rpc/confirm_tm_signoff': [200, { claim_id: CLAIM, basis: 'standard', gross_amount: 6000000 }],
  });
  try {
    const r = await cli(['tm', 'signoff', 'confirm', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { applied: true, claim_id: CLAIM, basis: 'standard', gross_amount: 6000000 });
  } finally { await f.close(); }
});
```
Add the row to `COMMANDS()` (so AC-CTM-001/002/003 cover it):
```js
  { argv: ['tm', 'signoff', 'confirm', CLAIM, '--project', PROJECT], rpc: 'confirm_tm_signoff', answer: [200, { claim_id: CLAIM, basis: 'standard', gross_amount: 6000000 }], body: { p_claim: CLAIM } },
```
Run → red.

**20.2 Code (4 min)** — append to `pmo-tm-write.mjs`:
```js
/** `tm signoff confirm <claim>`: confirm_tm_signoff once, by someone other than its assembler and preparer (FR-CTM-031/032). */
export async function confirmSignoff(api, { claim, project, me }, { apply }) {
  const found = await findClaim(api, { claim, project });
  const people = await api.names([found.prepared_by, found.signoff_prepared_by, found.confirmed_by].filter(Boolean));
  const name = (id) => (id ? people.get(id) ?? id : null);
  if (found.status === 'SignedOff') {
    return { exit: 0, result: { status: 'already_signed_off', claim_id: found.id, confirmed_by: name(found.confirmed_by), confirm_basis: found.confirm_basis } };
  }
  const problems = [];
  if (found.status !== 'Draft') problems.push(`this claim is ${found.status}: only a Draft claim with a prepared sign-off can be confirmed`);
  if (!found.signoff_prepared_by || !found.document_id) problems.push('prepare the sign-off first (`pmo tm signoff prepare`)');
  if (problems.length) throw new TmQueryError(problems);
  const doc = await readDocument(api, found.document_id);
  const current = (await readSources(api, found.id))[0]?.signoff_is_current ?? false;
  const warnings = doc ? documentWarnings(doc) : ['the sign-off document is not visible to you'];
  if (!current) warnings.push('the claim changed after its sign-off was prepared: prepare it again, or the server refuses');
  if ([found.prepared_by, found.signoff_prepared_by].includes(me.id)) {
    warnings.push("you assembled or prepared this claim: the server refuses your confirmation unless you are the organisation's only active member");
  }
  const view = { ...claimView(found), assembled_by: name(found.prepared_by), prepared_by: name(found.signoff_prepared_by), document: doc ? documentView(doc) : null, signoff_is_current: current };
  if (!apply) return { exit: 0, result: { applied: false, claim: view, warnings, next: 'Run the same command with --apply to confirm the client sign-off.' } };
  const confirmed = await write(api, 'confirm_tm_signoff', { p_claim: found.id }, `pmo tm claim list --project ${String(project).toLowerCase()}`);
  return { exit: 0, result: { applied: true, claim_id: found.id, basis: confirmed?.basis ?? null, gross_amount: confirmed?.gross_amount ?? null } };
}
```
`pmo.mjs`: import `confirmSignoff`; add `'signoff confirm'` to `TM_WRITE_COMMANDS`; in the write branch change
`const { profile } = await readMe(ctx);` to `const { user, profile } = await readMe(ctx);` and pass `{ id: user.id }` as a
sixth argument to `tmWrite(ctx, api, command, positionals.slice(2), flags, { id: user.id })`; give `tmWrite` a `me`
parameter and add `case 'signoff confirm': return confirmSignoff(api, { claim, project: flags.project, me }, opts);`.
Add to `USAGE` and the header comment:
`  pmo tm signoff confirm <claim-id> --project <id> [--apply]   (active Admin, Finance; not the claim's assembler or preparer)`
and to the final usage message `… or signoff prepare|confirm.` Run → green.

**20.3 Runbook (2 min)** — in recipe 7 add `node scripts/pmo.mjs tm signoff confirm <claim-uuid> --project <project-uuid> --apply`
after the `signoff prepare` line, and after "Reruns are safe": `A second Admin or Finance member — not the one who
assembled or prepared the claim — confirms it, signed in on their own CLI; a claim already confirmed is reported
\`already_signed_off\`.`

**20.4 Journey step (3 min)** — in `AC-CTM-017-cli-time-and-materials.spec.ts`, replace the comment line
`// Task 20 (confirm) and Task 21 (invoice) continue the journey here.` with:
```ts
  // A may not confirm a claim they assembled and prepared; Finance B, on their own CLI, confirms it.
  const selfConfirm = await cli.pmo(dirA, ['tm', 'signoff', 'confirm', claim.claim_id, '--project', projectId, '--apply']);
  expect(selfConfirm.code).toBe(1);
  expect(selfConfirm.error?.code).toBe('42501');
  expect(selfConfirm.error?.message).toMatch(/separation of duties/);
  const loginB = await cli.loginAs(browser, dirB, users.financeB, ownedContextOptions(testInfo));
  expect(loginB.code, loginB.stderr).toBe(0);
  const confirmed = await cli.pmo(dirB, ['tm', 'signoff', 'confirm', claim.claim_id, '--project', projectId, '--apply']);
  expect(confirmed.code, confirmed.stderr).toBe(0);
  expect(confirmed.json).toMatchObject({ applied: true, basis: 'standard', gross_amount: HOURS * RATE });
  // Task 21 (invoice) continues the journey here.
```
and rename the test title to `'AC-CTM-017 Finance runs the T&M month from the CLI: rates, assignment, assembly, sign-off and a second person\'s confirmation'`.

**20.5 Gate + commit (3 min)** — `scripts/with-test-lock.sh node --test scripts/pmo-tm.test.mjs scripts/pmo.test.mjs scripts/api-client-guard-coverage.test.mjs`,
`cd pmo-portal && npx eslint --max-warnings=0 e2e/AC-CTM-017-cli-time-and-materials.spec.ts && npm run typecheck`,
`scripts/e2e-local.sh AC-CTM-017`. Mutation check: drop the `me.id` warning → AC-CTM-011 red; revert. Commit.

---

### Task 21 — OWNER-GATED (Q1): `claim invoice` for an org with no ERP, and its guard migration
Delete this whole task if the owner answers **no** (then the invoice stays the app's **Create invoice**; no migration). Its
own tests, its own commit (`feat(cli): pmo tm claim invoice drafts the no-ERP invoice (#1856)`). Money path: ships alone if
the Director batches. `NNNN` = the number Fable assigns at the start of this task; one guard change open at a time.
**If Q3 is no and Q1 is yes:** the journey step 21.6 needs a confirmed claim; replace its first line with the app-session
confirmation `expect((await (await appSession(users.financeB.email)).rpc('confirm_tm_signoff', { p_claim: claim.claim_id })).error).toBeNull();`
(the app's own call, as B) — the only edit outside this task.

**21.1 Guard test first (4 min)** — create `supabase/tests/1856_cli_tm_invoice_guard.test.sql`:
```sql
-- 1856 AC-CTM-015: a command-line sign-in (a token with a client_id claim) may POST rpc/create_native_tm_invoice as an active
-- Admin or Finance member, the RPC's own role set, so `pmo tm claim invoice` can draft the invoice of a signed-off claim on
-- an org with no ERP. Every other role, an inactive member and any other method stay refused; an app session is untouched.
-- The rest of the guard's tiers stay proved by api_client_request_guard, 1857_cli_document_register_guard and
-- 0899_cli_guard_history_corrections, which run against the latest guard body.
begin;
select plan(9);

insert into organizations (id, name, default_currency) values ('18560000-0000-0000-0000-00000000000a', 'CTM guard org', 'IDR');
insert into auth.users (id, email) values
  ('18560000-0000-0000-0000-0000000000a1', 'ctm-admin@example.com'), ('18560000-0000-0000-0000-0000000000a2', 'ctm-fin@example.com'),
  ('18560000-0000-0000-0000-0000000000a3', 'ctm-pm@example.com'), ('18560000-0000-0000-0000-0000000000a4', 'ctm-exec@example.com'),
  ('18560000-0000-0000-0000-0000000000a5', 'ctm-eng@example.com'), ('18560000-0000-0000-0000-0000000000a6', 'ctm-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18560000-0000-0000-0000-0000000000a1', '18560000-0000-0000-0000-00000000000a', 'Admin', 'ctm-admin@example.com', 'Admin', 'active'),
  ('18560000-0000-0000-0000-0000000000a2', '18560000-0000-0000-0000-00000000000a', 'Fin', 'ctm-fin@example.com', 'Finance', 'active'),
  ('18560000-0000-0000-0000-0000000000a3', '18560000-0000-0000-0000-00000000000a', 'PM', 'ctm-pm@example.com', 'Project Manager', 'active'),
  ('18560000-0000-0000-0000-0000000000a4', '18560000-0000-0000-0000-00000000000a', 'Exec', 'ctm-exec@example.com', 'Executive', 'active'),
  ('18560000-0000-0000-0000-0000000000a5', '18560000-0000-0000-0000-00000000000a', 'Eng', 'ctm-eng@example.com', 'Engineer', 'active'),
  ('18560000-0000-0000-0000-0000000000a6', '18560000-0000-0000-0000-00000000000a', 'Off', 'ctm-off@example.com', 'Finance', 'disabled');

create function pg_temp.passes(p_sub text, p_method text, p_path text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
          set_config('request.method', p_method, true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true);
  perform public.api_client_request_guard();
  return true;
exception when sqlstate '42501' then
  return false;
end $$;

set local role authenticated;
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a1', 'POST', '/rpc/create_native_tm_invoice'), true, 'AC-CTM-015 client: active Admin POSTs create_native_tm_invoice');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a2', 'POST', '/rpc/create_native_tm_invoice'), true, 'AC-CTM-015 client: active Finance POSTs create_native_tm_invoice');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a3', 'POST', '/rpc/create_native_tm_invoice'), false, 'AC-CTM-015 client: Project Manager is refused create_native_tm_invoice');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a4', 'POST', '/rpc/create_native_tm_invoice'), false, 'AC-CTM-015 client: Executive is refused create_native_tm_invoice');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a5', 'POST', '/rpc/create_native_tm_invoice'), false, 'AC-CTM-015 client: Engineer is refused create_native_tm_invoice');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a6', 'POST', '/rpc/create_native_tm_invoice'), false, 'AC-CTM-015 client: a disabled Finance member is refused create_native_tm_invoice');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a1', 'GET', '/rpc/create_native_tm_invoice'), false, 'AC-CTM-015 client: create_native_tm_invoice only by POST, even for an active Admin');
select is(pg_temp.passes('18560000-0000-0000-0000-0000000000a2', 'POST', '/rpc/transition_native_sales_invoice'), false, 'AC-CTM-015 client: invoice approval stays refused for Finance');
select set_config('request.jwt.claims', '{"role":"authenticated","session_id":"s1"}', true), set_config('request.method', 'POST', true),
       set_config('request.path', '/rpc/create_native_tm_invoice', true), set_config('request.headers', '{}', true);
select lives_ok('select public.api_client_request_guard()', 'AC-CTM-015 browser session: create_native_tm_invoice passes the guard (no client_id)');

reset role;
select * from finish();
rollback;
```
Verify red: `scripts/with-db-lock.sh supabase test db supabase/tests/1856_cli_tm_invoice_guard.test.sql` → the two `true`
cases fail (the RPC is in no tier yet).

**21.2 Migration (5 min)** — create `supabase/migrations/NNNN_cli_tm_native_invoice_guard.sql`:
1. Header:
   ```sql
   -- NNNN (#1856): the command line may draft the invoice of a signed-off time-and-materials claim on an org with no ERP.
   -- `create_native_tm_invoice` (POST rpc) joins the guard for an active Admin or Finance token — the RPC's own role set; the RPC
   -- still refuses when an ERP owns revenue, re-checks the claim, and adds its creator to the invoice authors (approver SoD).
   -- Body of the api_client_request_guard() from 0899_cli_guard_history_corrections.sql copied verbatim; the only additions
   -- are the lines marked NNNN.
   ```
   First run `grep -l "function public.api_client_request_guard()" supabase/migrations/*.sql | grep -v _down | sort | tail -1`.
   It prints `supabase/migrations/0899_cli_guard_history_corrections.sql` as of dev `d2320be80`; if it prints a higher file,
   copy from that file and name it in the header instead of 0899 (rule: copy the highest guard body on dev).
2. Copy that migration's whole `create or replace function public.api_client_request_guard()` statement, through its
   closing `$$;` and the `revoke`/`grant`/`alter function` lines that follow it, byte for byte. Do NOT copy its other
   statements (0899's trigger functions and triggers stay where they are).
3. Insert after the `tm_read_rpcs constant …` line:
   ```sql
     -- NATIVE T&M INVOICE TIER (`pmo tm claim invoice`, #1856): active Admin/Finance, as the RPC's own check — keep in step with scripts/lib/pmo-tm-write.mjs TM_INVOICE_RPCS.  -- NNNN
     tm_invoice_rpcs constant text[] := array['create_native_tm_invoice'];  -- NNNN
   ```
4. Insert after the `tm_read_rpcs` `if … end if;  -- 0518` block:
   ```sql
       if method = 'POST' and target = any (tm_invoice_rpcs) then  -- NNNN
         if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- NNNN
           return;  -- NNNN
         end if;  -- NNNN
       end if;  -- NNNN
   ```
5. Create `supabase/migrations/NNNN_cli_tm_native_invoice_guard_down.sql`: header
   `-- Down NNNN: restore the api_client_request_guard() body of 0899_cli_guard_history_corrections.sql.` (or the file named
   in step 1) then the same statement copied in step 2, unchanged.
Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/1856_cli_tm_invoice_guard.test.sql supabase/tests/api_client_request_guard.test.sql supabase/tests/1857_cli_document_register_guard.test.sql supabase/tests/0899_cli_guard_history_corrections.test.sql'`
→ all pass. `cd pmo-portal && npm run check:migrations`. Mutation check: change `'Finance'` to `'Executive'` in the new block
→ the Finance case goes red; revert. Builder rule: `grep -rln "api_client_request_guard\|create_native_tm_invoice" supabase/tests scripts pmo-portal/src`
and run every test file it lists that the gate below does not already cover.

**21.3 CLI tests first (4 min)** — append to `scripts/pmo-tm.test.mjs` (and merge `TM_INVOICE_RPCS` into the import):
```js
test('AC-CTM-016 the CLI invoice tier is exactly the database tm_invoice_rpcs tier', () => {
  assert.deepEqual([...TM_INVOICE_RPCS].sort(), guardList('tm_invoice_rpcs'));
});

test('AC-CTM-013 when an ERP owns revenue, claim invoice refuses before sending and names the app\'s Create invoice', async () => {
  const f = await fake({ ...READS(), 'GET /rest/v1/external_domain_ownership': [200, [{ domain: 'revenue', external_tier: 'erpnext' }]] });
  try {
    for (const extra of [[], ['--apply']]) {
      const r = await cli(['tm', 'claim', 'invoice', CLAIM, '--project', PROJECT, ...extra], f);
      assert.equal(r.code, 2);
      assert.match(r.error.details.join(), /raised in the connected ERP .*Create invoice/);
    }
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-014 a claim already invoiced is reported already_invoiced (exit 0)', async () => {
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/list_tm_claims': [200, [{ ...DRAFT, status: 'SignedOff' }]],
    'POST /rest/v1/rpc/create_native_tm_invoice': [400, { code: 'P0001', message: 'this claim already has an invoice', details: 'claim-already-invoiced' }],
  });
  try {
    const r = await cli(['tm', 'claim', 'invoice', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { status: 'already_invoiced', invoice_id: CLAIM });
  } finally { await f.close(); }
});

test('FR-CTM-041 the drafted invoice prints its id and that a different Admin or Finance member approves it in the app', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/list_tm_claims': [200, [{ ...DRAFT, status: 'SignedOff' }]], 'POST /rest/v1/rpc/create_native_tm_invoice': [200, CLAIM] });
  try {
    const r = await cli(['tm', 'claim', 'invoice', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.invoice_id, CLAIM);
    assert.equal(r.json.status, 'Draft');
    assert.match(r.json.next, /different active Admin or Finance member .* approves it in the app/);
  } finally { await f.close(); }
});
```
Add to `COMMANDS()`:
```js
  { argv: ['tm', 'claim', 'invoice', CLAIM, '--project', PROJECT], rpc: 'create_native_tm_invoice', answer: [200, CLAIM], body: { p_claim: CLAIM } },
```
Run → red.

**21.4 Code (4 min)** — append to `pmo-tm-write.mjs`:
```js
/** The no-ERP invoice draft (#1856 Q1) — keep in step with `tm_invoice_rpcs` in `api_client_request_guard`. */
export const TM_INVOICE_RPCS = Object.freeze(['create_native_tm_invoice']);

/** `tm claim invoice <claim>`: create_native_tm_invoice once, Draft only; an ERP-owned org uses the app (FR-CTM-040..042). */
export async function invoiceClaim(api, { claim, project }, { apply }) {
  const owners = await api.get('external_domain_ownership', new URLSearchParams({ select: 'domain,external_tier', domain: 'eq.revenue' }));
  const owner = Array.isArray(owners) ? owners[0] : null;
  if (owner) throw new TmQueryError([`customer invoices for this organisation are raised in the connected ERP (${owner.external_tier}): use the app's Create invoice (${TM_SCREEN})`]);
  const found = await findClaim(api, { claim, project });
  const warnings = found.status === 'SignedOff' ? [] : [`the claim is ${found.status}: the server drafts an invoice only for a signed-off claim`];
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), revenue_owner: 'PMO', warnings, next: 'Run the same command with --apply to draft the invoice.' } };
  let invoiceId;
  try {
    invoiceId = await write(api, 'create_native_tm_invoice', { p_claim: found.id }, `pmo tm claim list --project ${String(project).toLowerCase()}`);
  } catch (error) {
    if (error?.details === 'claim-already-invoiced') return { exit: 0, result: { status: 'already_invoiced', invoice_id: found.id } };
    throw error;
  }
  return { exit: 0, result: { applied: true, invoice_id: invoiceId, status: 'Draft', next: "A different active Admin or Finance member — not the claim's assembler, preparer, confirmer or this draft's author — approves it in the app: Project → Contract & billing." } };
}
```
`pmo.mjs`: import `invoiceClaim`; add `'claim invoice'`; `case 'claim invoice': return invoiceClaim(api, { claim, project: flags.project }, opts);`
(the server error reaches `invoiceClaim` with its `details` before `explain` runs). Add to `USAGE` and the header comment:
`  pmo tm claim invoice <claim-id> --project <id> [--apply]   (active Admin, Finance; orgs with no ERP; drafts only)`
and to the final usage message `claim preview|list|assemble|sources|deselect|withdraw|invoice`. Run → green.

**21.5 Runbook (2 min)** — recipe 7: add `node scripts/pmo.mjs tm claim invoice <claim-uuid> --project <project-uuid> --apply`
as the last command; after "Reruns are safe" add `On an organisation with no ERP, \`claim invoice\` drafts the invoice of a
signed-off claim (\`already_invoiced\` on a rerun); a different Admin or Finance member approves it in the app. When an ERP
owns revenue the CLI refuses and points to the app's Create invoice.`; in "Stays in the app" keep "raising an invoice when
an ERP owns revenue, and approving any invoice".

**21.6 Journey step (3 min)** — replace `// Task 21 (invoice) continues the journey here.` with:
```ts
  // B drafts the invoice: it carries the approved units at the contract rate; approval stays in the app.
  const invoiced = await cli.pmo(dirB, ['tm', 'claim', 'invoice', claim.claim_id, '--project', projectId, '--apply']);
  expect(invoiced.code, invoiced.stderr).toBe(0);
  expect(invoiced.json).toMatchObject({ applied: true, invoice_id: claim.claim_id, status: 'Draft' });
  const invoice = await admin.from('sales_invoices').select('status, native_lines').eq('id', claim.claim_id).single();
  expect(invoice.error).toBeNull();
  expect(invoice.data?.status).toBe('Draft');
  expect(invoice.data?.native_lines).toEqual([expect.objectContaining({ qty: HOURS, rate: RATE, amount: HOURS * RATE })]);
```
and end the test title with `…, a second person's confirmation and the invoice draft'`.

**21.7 Gate + commit (5 min)** —
```bash
scripts/with-test-lock.sh node --test scripts/pmo-tm.test.mjs scripts/pmo.test.mjs scripts/api-client-guard-coverage.test.mjs
cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 e2e/AC-CTM-017-cli-time-and-materials.spec.ts && cd ..
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
node scripts/check-isolation-denominator.mjs --self-test && node scripts/check-isolation-denominator.mjs
scripts/e2e-local.sh AC-CTM-017
```
The whole pgTAP suite after the reset is mandatory (a migration changes). The guard is SECURITY INVOKER and adds no table,
so the isolation manifest should need no entry; if the guard reports one, add it as it says. Mutation check: remove
`'create_native_tm_invoice'` from `TM_INVOICE_RPCS` → AC-CTM-016 red; revert. Commit; the security-auditor review covers
this task (guard change).

## 4. Review and ship
- Reviews (step 5): spec-reviewer, code-quality-reviewer, security-auditor (the role gate, the bodies sent, and in Task 21
  the guard change: only `create_native_tm_invoice`, only POST, only active Admin/Finance).
- Ship: one PR to `dev`, alone (money path). Release-engineer reads this task list's gate evidence; nothing beyond `dev`.

## 5. Open points for the Director
1. **D3 `--project` on claim commands** departs from spec §3's synopsis; it is forced by the admitted reads. If a shorter
   form is wanted later, a `claim_project(p_claim)` read (server work) would drop the flag.
2. The e2e journey seeds the Issued document with the service role (issuing a document is an app step outside the CLI);
   time entry and approval go through the app's own RPC calls with password sessions, not UI clicks — the browser part of
   the app is already proved by AC-TM-018.
