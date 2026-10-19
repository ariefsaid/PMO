# Statement Metadata Readiness Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this bounded plan task by task. The Director supplies the authorized executor; this document does not authorize additional workers or production operations. Steps use checkbox syntax for tracking.

**Goal:** Add an offline-tested, read-only statement metadata readiness check and document the three required ERPNext metadata reads for production API-user setup.

**Architecture:** A small tracked ES module builds three ordinary document requests using the current publication consumer's fields, classifies their responses, and runs them through an injected existing read transport. The existing production operator driver adopts that core in a separately reviewed private step after dev gates; credential acquisition stays at that boundary. No collector, app, database or legacy probe rewrite is needed.

**Tech Stack:** Node 22.22+, native ES modules, `node:test`, `node:assert/strict`; existing ERPNext probe client.

**Spec:** `docs/specs/statement-metadata-readiness-probe.spec.md`.

## Global constraints

- Serial maximum of three GETs, one per dependency; zero retries and at most 20 seconds per read at the adopted client boundary.
- No additional packages, direct network transport, credential loading, grants, role assignments, bindings, schema writes, financial calculations or live operations in the tracked core/build.
- Public docs contain setup requirements and synthetic examples only. All operating coordinates and principal selection remain private.
- Preserve the active consumer and all old probe oracles. Existing publication metadata behavior is defined by `fetchStatementPublicationMetadata`, not its separate legacy export.
- Only dev is an authorized release target; this plan neither authorizes a production run nor changes release gates.

## Design decisions and existing code

`pmo-portal/src/lib/adapterSeam/erpnext/statementMetadata.ts:196–216,331–407` decides consumed fields, validation and optional/default semantics. Company deliberately uses document GET rather than the consumer collection request to establish READ; a successful SELECT collection is insufficient. `scripts/post-deploy-probes.sh` supplies the existing offline regression test for the three tenant probes. The existing operator-held production driver is the adoption point; its exact source and adoption instructions are supplied privately to the Director.

Reuse the ordinary client through an injected callback instead of adding another credential resolver or a new public endpoint. Keep the operational module under `scripts/lib/`, outside the app bundle. Repeating this small response contract is a deliberate operational boundary: the tests name the actual consumer and exact fields, and future consumer schema changes must update this check in the same change. Refactoring publication solely to share this probe would broaden the release-critical patch.

There is no schema, API endpoint, UI or cache change. The existing `org_id` binding selection stays at the private integration-client boundary and must select the intended integration, not a successful alternate principal. At most three bounded serial metadata reads add constant work per deployment, with no pagination scan or per-user runtime cost. Importing the core performs no work. No ADR: this follows existing auth and probe architecture and makes no irreversible decision.

## File ownership and interfaces

- Create `scripts/lib/statementMetadataReadiness.mjs`: request construction, pure response classification, serial orchestration and safe summary.
- Create `scripts/statement-metadata-readiness.test.mjs`: synthetic transport fixtures, behavioral tests and setup-document contract.
- Director only: modify `docs/environments.md`: add `### ERPNext integration API-user setup — statement metadata` immediately before `## ERPNext v15 dev bed (P2)`.
- Director only: add one test command in `.github/workflows/ci.yml`, in the existing `CI integration-order test` multiline command, after the existing Node suites. Preserve concurrent workflow additions.
- Preserve `scripts/post-deploy-probes.sh`, all existing probe scripts, `statementMetadata.ts`, credentials and bindings byte-for-byte.

Use JSDoc in the new JS module to express these signatures (TypeScript notation below describes the interface, not a TypeScript build step):

```ts
type Doctype = 'Company' | 'Accounts Settings' | 'Currency';
type Reason = 'ok' | 'authentication' | 'permission' | 'unavailable' | 'malformed' | 'transport';
type ReadRequest = { doctype: Doctype; method: 'GET'; path: string };
type ReadResponse = { status: number; body: unknown };
type Check = { doctype: Doctype; ok: boolean; reason: Reason };
type Result = { ok: boolean; checked: number; passed: number; failed: number; checks: Check[] };
export function buildStatementMetadataReadPlan(company: unknown): ReadRequest[];
export function classifyStatementMetadataRead(doctype: Doctype, response: ReadResponse, company: string): Check;
export function runStatementMetadataReadiness(input: {
  company: string; read: (request: ReadRequest) => Promise<ReadResponse>
}): Promise<Result>;
export function formatStatementMetadataReadiness(result: Result): string;
```

`read(request)` resolves `ReadResponse` or throws. It is supplied by the existing operator client and must enforce the budget and origin protections. The core does not accept a URL, token, credential file or environment-variable name. Invalid configuration throws `TypeError('Statement metadata configuration invalid')` before any callback; the adopting driver reports a fixed configuration failure and exits unsuccessfully.

## Review focus

- Company collection envelopes and identity-only documents must fail even when HTTP is 200 (Task 1).
- Legitimate false/empty settings must not be treated as missing (Tasks 1–2).
- A format-selected Currency still validates the fraction field; blank precision requires an actual supported fallback (Task 2).
- One dependency failure must not suppress the remaining checks or cause retries/fanout (Task 3).
- Thrown errors and extra response fields may contain sensitive values; none enter the result or summary (Task 3).

## Verification conventions

Commands below run from repo root under Node 22.22+. Each task's focused command is run RED before implementation and GREEN afterward. Node unit runs are offline; no DB, ERP or browser is needed. The Director keeps the global maximum of two heavy local jobs and gives statement acceptance work priority. Do not run full local suites to validate this small module.

### Task 1: Build exact requests and validate Company (2–5 minutes)

**Covers:** AC-001. **Files:** create both new module and test files above.

- [ ] Write `AC-001: Company read selects the actual publication fields` first. For `buildStatementMetadataReadPlan('Synthetic Co')`, assert exactly three entries with method `GET` and labels Company, Accounts Settings, Currency. Decode the first query with `new URL(path, 'https://example.test')`: pathname `/api/resource/Company/Synthetic%20Co`, fields `['name','default_currency','default_finance_book']`, no filters/list limit. Assert the two remaining paths and fields match the spec table exactly. Test company `'A & B/Co'` is encoded as one document identity (`A%20%26%20B%2FCo`) without a new path segment or query parameter; `''`, `'  '`, null and 1 throw the fixed TypeError.
- [ ] Write `AC-001: Company requires the matching complete document` using this baseline:

```js
const company = 'Synthetic Co';
const row = { name: company, default_currency: 'IDR', default_finance_book: null };
assert.deepEqual(classifyStatementMetadataRead('Company', { status: 200, body: { data: row } }, company),
  { doctype: 'Company', ok: true, reason: 'ok' });
```

Assert book `''` and `'Accrual'` pass. Independently reject `data:[]`, `data:[row]`, `data:{}`, data null, a name-only document, wrong name, missing currency, currency `USD`, missing book, book `0`, and whitespace-only book. Missing means absent own field; extra fields pass.
- [ ] RED: `scripts/with-test-lock.sh node --test --test-name-pattern='AC-001' scripts/statement-metadata-readiness.test.mjs` → failing import/export or assertions, not a live request.
- [ ] Implement `buildStatementMetadataReadPlan(company)` using `encodeURIComponent(company)` for the document name and `encodeURIComponent(JSON.stringify(fields))` for each fixed field list, fixed paths/field order from the spec, no credential inputs. Implement the Company branch of `classifyStatementMetadataRead(doctype,response,company)`: own-property envelope/row checks and exact values above. Return only the three Check keys; do not retain rows.
- [ ] GREEN: rerun the exact focused command → no failures. No commit/push in this task; freeze for Director review after Task 4.

### Task 2: Validate Accounts Settings and Currency (2–5 minutes)

**Covers:** AC-002, AC-003. **Files:** modify the two files from Task 1. **Consumes:** the Task 1 signatures unchanged.

- [ ] Write `AC-002: reporting flags preserve zero and reject missing values`. Baseline `{data:{name:'Accounts Settings',ignore_is_opening_check_for_reporting:0,ignore_account_closing_balance:'1'}}` passes. Cross-product both flags over `[0,1,'0','1']` passes. For each flag, deletion, null, blank string, true, false and 2 fail. Wrong name, list/null envelope and missing `data` fail.
- [ ] Write `AC-003: Currency validates presentation metadata branches`. Use `{data:{name:'IDR',fraction_units:100,number_format:''}}` as baseline. For each of the ten exact format strings in the spec, assert null/blank fraction units and valid format pass; null/blank format with `0`, `1`, `2`, `5`, `100`, `1000`, `'100'` and `1000000000` passes. Null/blank fraction with null/blank format fails. Missing either field, wrong identity, unsupported format, boolean/negative/fractional/unsafe integers, `'01'`, `'1e2'`, `' 100'`, fraction 3 and fraction 10000000000 fail when format blank. Invalid fractions also fail with recognized format `#,###.##`. A valid nonfactorable fraction 3 with a recognized format passes because that format supplies precision. Add extra fields to all baselines and keep passing.
- [ ] RED: `scripts/with-test-lock.sh node --test --test-name-pattern='AC-002|AC-003' scripts/statement-metadata-readiness.test.mjs` → assertions fail for unimplemented branches.
- [ ] Implement the two classifier branches with own-field checks, strict flag set, the ten-format set, safe integer/canonical string parsing and the existing powers-of-2/5 maximum-exponent-9 rule. Helpers remain private to the module. Never use truthiness to decide field presence. Unsupported doctype throws the fixed configuration TypeError.
- [ ] GREEN: rerun the exact focused command, then `scripts/with-test-lock.sh node --test scripts/statement-metadata-readiness.test.mjs` → no failures.

### Task 3: Run three serial checks and emit safe outcomes (2–5 minutes)

**Covers:** AC-004, AC-005, AC-006, AC-007. **Files:** modify both new files. **Produces:** `runStatementMetadataReadiness` and `formatStatementMetadataReadiness` with the signatures above.

- [ ] Write `AC-006: complete metadata uses exactly three serial GETs`. Fake `read` records each request, increments/decrements in-flight around `await Promise.resolve()`, and returns baseline synthetic responses keyed by request doctype. Assert maximum in-flight is 1, calls deep-equal the request plan, every method is GET, and:

```js
assert.deepEqual(result, { ok: true, checked: 3, passed: 3, failed: 0,
  checks: ['Company','Accounts Settings','Currency'].map(doctype => ({ doctype, ok: true, reason: 'ok' })) });
assert.equal(formatStatementMetadataReadiness(result), 'statement-metadata: checked=3 passed=3 failed=0');
```

Use extra unrelated fields, report zeros, book null and valid Currency fallback. Repeat with book blank. No URL/header/env/global-fetch setup exists in this fake.
- [ ] Write `AC-004: each required doctype refuses authentication and permission failures`. For each doctype and status 401/403, change only its fake read. Assert all three calls still occur once, `passed=2`, `failed=1`, `ok=false`, and its reason is `authentication`/`permission`. An identity-only Company 200 fails as `malformed`.
- [ ] Write `AC-005: unsuccessful and malformed dependencies fail without leaking errors`. For each doctype test 404/500 → `unavailable`; 200 with malformed/invalid JSON payload represented as null or string → `malformed`; throwing `Error('synthetic-private-detail')` → `transport`; status 0 → `transport`; invalid/noninteger status → `malformed`. Assert three calls and no thrown transport error escapes. Classifier must evaluate HTTP before the body.
- [ ] Write `AC-007: summary contains only fixed labels counts and setup action`. Assert the exact failure string for Company 403:

```js
assert.equal(formatStatementMetadataReadiness(result),
  "statement-metadata: checked=3 passed=2 failed=1 problems=Company:permission; Verify the existing integration user's read access and required metadata before enabling statements.");
```

Inject synthetic sensitive text into extra response fields and thrown errors; assert serialized result and summary contain neither that text nor `'Synthetic Co'` nor an origin. Repeat multiple failures and assert fixed plan order, e.g. `Company:permission,Accounts Settings:transport`. Invalid company rejects before read is called. Importing the module with `globalThis.fetch` replaced by a throwing fake must not call it; restore globals.
- [ ] RED: `scripts/with-test-lock.sh node --test --test-name-pattern='AC-004|AC-005|AC-006|AC-007' scripts/statement-metadata-readiness.test.mjs` → missing exports/assertions fail.
- [ ] Implement status classification, then a `for...of` loop awaiting `read(request)` once per planned request, catching thrown transport failures into fixed `transport` checks. Compute counts from Check objects and `ok = failed === 0`. Formatter includes only counts and failing fixed labels/reasons; use the exact suffix above on failure. No raw value or error message reaches a result.
- [ ] GREEN: rerun focused command and the full new Node test file → no failures. Mutation proof: temporarily classify 403 as success, run AC-004 and observe failure; restore. Temporarily dispatch an extra POST or parallelize reads, run AC-006 and observe failure; restore, then rerun GREEN. Keep mutations out of final diff.

### Task 4: Publish setup requirements and register the gate (2–5 minutes)

**Covers:** AC-008, AC-009 (tracked regression portion). **Files:** builder modifies the new Node test; Director owns `docs/environments.md` and `.github/workflows/ci.yml` edits. No legacy probe edits.

- [ ] Write `AC-008: API-user setup documents the three consumed metadata reads`. Read `docs/environments.md`, select the text between the new subsection heading and the following `## ERPNext v15 dev bed (P2)`, and assert it contains the three named doctypes, `READ`, all six nonidentity consumed field names, `before statements go live`, and `rerun`. Do not assert absence of pre-existing unrelated operational details elsewhere in this legacy document.
- [ ] RED: `scripts/with-test-lock.sh node --test --test-name-pattern='AC-008' scripts/statement-metadata-readiness.test.mjs` → missing section fails.
- [ ] Director inserts exactly this subsection immediately before the dev-bed section:

```markdown
### ERPNext integration API-user setup — statement metadata

The integration API user requires **READ** on **Company**, **Accounts Settings** and
**Currency** for statement metadata. Company document READ must return the configured company with
`default_currency` and `default_finance_book`; Accounts Settings must return
`ignore_is_opening_check_for_reporting` and `ignore_account_closing_balance`; Currency must
return `fraction_units` and `number_format` for the company's currency. These are ordinary
resource reads with the fields consumed by statement display; identity-only results do not
establish readiness. Zero reporting flags and a null/blank default finance book are valid.

The existing production deployment probes must check these reads as that same integration
API user and report aggregate readiness without response values. If a check fails, the
operator arranges the required ERPNext role or metadata setup correction **before statements go live**, then **rerun** the read-only check. This check does not change roles, credentials,
bindings or ERPNext records.
```

- [ ] GREEN: rerun AC-008, then `scripts/with-test-lock.sh node --test scripts/statement-metadata-readiness.test.mjs` → no failures.
- [ ] Director adds `node --test scripts/statement-metadata-readiness.test.mjs` to the existing CI command block described under ownership. The builder may prepare that one-line patch privately; do not overwrite concurrent workflow changes.
- [ ] Verify legacy AC-009 offline: `scripts/with-test-lock.sh bash scripts/post-deploy-probes.sh --self-test` → existing PASS summary; no real tenant/ERP operation. Verify `git diff -- scripts/post-deploy-probes.sh scripts/second-org-smoke.sh scripts/second-org-roles-smoke.sh scripts/isolation-probe.sh pmo-portal/src/lib/adapterSeam/erpnext/statementMetadata.ts` is empty. Run `git diff --check` → clean.

## Traceability

| Task | Acceptance criteria | Lowest sufficient proof |
|---|---|---|
| 1 | AC-001 | Node request/Company unit tests |
| 2 | AC-002, AC-003 | Node response-contract unit tests |
| 3 | AC-004, AC-005, AC-006, AC-007 | Node serial transport and result unit tests |
| 4 | AC-008, AC-009 tracked portion | Node document contract; existing offline shell self-test |
| Director private adoption | AC-009 completion; FR-001/009 production wiring; NFR-002 | Offline test against adopted operator driver; separate operator-run production receipt |

## Director adoption and release boundary

The accompanying private handoff identifies the exact existing operator driver, the current absence of an ERP client there, and the required adapter implementation and offline review before additive integration. The public helper alone does not complete production wiring. Do not publish its path or inputs. After source review and dev green, the Director adopts the module using the existing production integration client, exact configured company and fixed three GETs. All production DB reads for binding/credential resolution must pass through `scripts/prod-read.sh`, with output captured in memory and never echoed. Direct DB REST/SQL shortcuts are outside this plan. Its adapter calls the existing request client under the existing probe budget and statement origin/language wrapper, maps safe HTTP status/body into the callback contract, and never logs the resolved pair or caught raw exception. The adopted ERP stage must run in an isolated child with stdout/stderr captured: forward only the validated fixed summary, and discard raw child diagnostics. The offline adoption test must bind this redaction to the real client failure path.

Preserve each legacy probe invocation, assertion, ordering and existing classification. Append the metadata summary and ensure metadata failure makes the combined run nonzero. One private owning Node test titled `AC-009 preserves old probes and metadata gate` must exercise the actual adopted driver with synthetic subprocess/client seams: all legacy stages still run, each legacy failure remains a failure, metadata 403 per doctype fails, all clean responses pass, no write is dispatched by the metadata stage, and no synthetic private text reaches logs. Production execution is outside the builder's scope and is not claimed complete by offline tests. No new production role, key or binding is permitted in this work.

## Bounded builder brief and final evidence

Build Tasks 1–4 in a fresh Director-assigned code worktree. Own only the two new script files; the Director owns the setup subsection, workflow registration and private adoption. Preserve other workers' edits. No app/sweep source, credentials, secret files, DB/browser/ERP access, commits or pushes without the Director's subsequent instruction.

After focused RED/GREEN evidence, run the normal applicable final gate with Node 22.22+: from `pmo-portal/`, `../scripts/with-test-lock.sh npm run typecheck`, `../scripts/with-test-lock.sh npx vitest run --changed origin/dev --passWithNoTests`; report a zero-selected Vitest honestly because Node tests own this change. From repo root run `scripts/with-test-lock.sh node --experimental-test-coverage --test scripts/statement-metadata-readiness.test.mjs` and report at least 80% changed executable lines. The app ESLint config covers TypeScript and cannot silently lint these out-of-app JS files; run this scoped equivalent from repo root using installed app dependencies:

```bash
node --input-type=module <<'JS'
import { ESLint } from './pmo-portal/node_modules/eslint/lib/api.js';
import js from './pmo-portal/node_modules/@eslint/js/src/index.js';
import globals from './pmo-portal/node_modules/globals/index.js';
const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [
  js.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { sourceType: 'module', ecmaVersion: 2022, globals: globals.node } },
] });
const results = await engine.lintFiles(['scripts/lib/statementMetadataReadiness.mjs', 'scripts/statement-metadata-readiness.test.mjs']);
process.stdout.write(await (await engine.loadFormatter('stylish')).format(results));
process.exitCode = results.some(result => result.errorCount || result.warningCount) ? 1 : 0;
JS
```

Zero diagnostics means the scoped lint passes. CI's normal four unit shards, verify and pgTAP remain required before dev integration. No new cross-stack journey is introduced and no browser or DB local run is needed for this standalone operational module.

Freeze exact file hashes and the test output bodies for the Director's spec, quality and security review. The Director records private adoption/offline proof separately and then requests the operator's actual production probe at the authorized release point. No owner question is open in this bounded requirement; the remaining boundary is reviewed implementation and separately authorized operation.
