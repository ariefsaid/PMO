# Plan: Assistant catalog — `find`, `read`, `act` (issue #3084)

**Spec:** [`docs/specs/assistant-catalog.spec.md`](../specs/assistant-catalog.spec.md) (`FR/NFR/AC-ACG-###`). **ADR:** [`docs/adr/0127-assistant-generated-catalog.md`](../adr/0127-assistant-generated-catalog.md).
**Deadline:** on `dev` and ready for the 15 Dec go-live. **Phase 2 (MCP)** is separate (§ Slice S9) and moves after 15 Dec if the schedule is tight; nothing else drops.
**Ceiling:** release to `dev` only; production is a separate owner yes (CLAUDE.md). No migration in this plan (NFR-ACG-010).
**Execution model:** Orca workers per `docs/orca-dispatch.md` § Batch integration. Integration branch `batch/1215-assistant`; sole writer = the integration worker; CI is the merge gate; no per-branch heavy-proof queues.

## 0. Design in one page

```
 build time                                              request time (agent-chat edge function)
 ┌───────────────┐   ┌──────────────────────┐            ┌──────────────────────────────────────────────┐
 │ local DB       │──▶│ scripts/gen-assistant │──facts──▶ │ catalog/db-facts.generated.json (committed)   │
 │ (grants, cols, │   │ -catalog.mjs          │           │ catalog/catalog.generated.ts    (committed)   │
 │  comments,args)│   │  + catalog.d/*.json   │──emit───▶ │ catalog/guide.generated.ts      (committed)   │
 └───────────────┘   │  + docs/user-guide     │           └───────────────┬──────────────────────────────┘
                      └──────────────────────┘                           │ in-memory, no DB call
   --check  (check:guards, no DB): fragments valid · DAL tables classified · output current
   --check-db (check-schema-registrations.sh): facts == local DB                ▼
                                                      find(query)  → visible.ts (plan switch + role hint) → search.ts
                                                      read(entity…) → entityCatalog.ts resolves from catalog → runRead (today's runQueryEntity)
                                                      act(name,args) → actAction.ts (prepare → proposal → approve → actRunner.ts → caller-JWT rpc/insert)
```

Model tools after cutover: `find`, `read`, `act`, `ask_user`, `compose_view` (+ `notify` while automations are on).
Legacy tools stay registered in `legacy`/`both` modes until the gate (FR-ACG-080/081).

**Reuse, not rewrite:** `runQueryEntity` (`actions.ts`) becomes `runRead` by changing where `entry` comes from; the proposal / approval / journal / re-auth machinery (`toolLoop.ts`, `confirmedAction.ts`, `turnContinuations.ts`, `draftInvoice.ts`'s `prepare` + `validatePrepared`) is reused for `act`; `featureSwitches.ts` keeps `writeRefusal` / `notOnPlanError`; the panel keeps `TranscriptItem`, `ApprovalChip` state machine and the widget registry.

## 1. Slices, owners and who ships alone

| Slice | What | Touches money / auth / RLS? | Ships | Depends on | Worker tier |
|---|---|---|---|---|---|
| **S0** Baseline and gates | token measure script, legacy parity golden, eval baseline (N=10) | no | PR-A | none | B (bounded) |
| **S1** Generator and fragments | generator, `--check`, `--check-db`, 27 core fragments, `skip` classification, README | **yes: defines column and role rules** (reviewed by security-auditor; no runtime effect until S3) | PR-A | S0-T2 | A (strong) for T1.1–T1.6; B for T1.7 |
| **S2** `find`, guide index, language | search, visibility filter, guide generator, terms, `RunContext.language` | no (hint filter only; `find` returns no data rows) | PR-A | S1-T1.4 (types) | B |
| **S6** Panel (P1–P4) | click-to-send, Approval Card, Context Cards, Records Table, OpenUI renderer, a11y/perf | no (data path review for OpenUI) | PR-A (P1, P2), PR-D (P3, P4) | none (P3 needs S3 result shapes) | UI lane, screen-owner runbook |
| **S3** `read` over the catalog | `entityCatalog.ts` from catalog, `runRead`, recipes, suggestions, parity and pgTAP matrix | **YES — role/column rules, price hiding** | **PR-B alone** | S1 | A |
| **S4** `act` | framework, migrate 5 actions, 20 new entries by role group, pgTAP per area | **YES — writes, SoD, re-auth** | **PR-C alone** (framework + all entries; entries are data) | S1, S3 types | A for T4.1–T4.4; B for entries |
| **S5** Prompt, tool registry, modes | catalog prompt, 3 tools, `legacy/both/new` switch | touches the tool contract | PR-D | S2, S3, S4 | A |
| **S7** Guide readiness | how-do-I question list mapped to pages, gaps to #3085 | no | docs to `dev` direct | none | B |
| **S8** Evals and cutover | eval cases, scorer, N=10 runs, gate, delete old tools, `helpCorpus.ts` | the deletion is the cutover | PR-D | S5 | A + Director |
| **S9** MCP (phase 2) | MCP transport over the same modules | auth (DD-API-2) | own PR after 15 Dec | all | A |

PR-A (S0, S1, S2, S6-P1/P2) is dormant on dev: the new tools are unregistered in `legacy` mode, so it carries no
behaviour change except the panel's click-to-send and the removed line. PR-B also moves today's `query_entity`
onto catalog-resolved entities (parity-proven by AC-ACG-014, which is why it ships alone); PR-C adds code the
registry does not yet offer. PR-D registers `both`, then flips the default to `new` after the gate. Money, SoD and auth change
ships alone, as the batch rule says.

## 2. Day-by-day schedule (Sun 29 Nov → Tue 15 Dec 2026)

Weekend days count: workers run through them. CI minutes follow `docs/ci-push-rules.md` (read and `ack` before each push).

| Date | Work | Gate / merge |
|---|---|---|
| Sun 29 Nov | Director + owner sign off spec and plan. **S0** all. **S1** T1.1–T1.3. **S6-P1** starts. | spec signed |
| Mon 30 Nov | **S1** T1.4–T1.6 (generator emits; 27 core fragments; parity green). **S2** T2.1–T2.3 (guide generator, visibility, search). **S6-P1** done. | parity test green on dev head |
| Tue 1 Dec | **S1** T1.7 skip classification (two workers, A–M and N–Z). **S2** T2.4–T2.6. **S6-P2** starts. **S4** T4.1 starts on the types from S1 (separate files from S3). | S1 integrated into `batch/1215-assistant` |
| Wed 2 Dec | **S3** T3.1–T3.3. **S2** integrated. **S4** T4.1–T4.2. | `--check` in `check:guards` |
| Thu 3 Dec | **S3** T3.4–T3.5 (pgTAP matrix, price-hidden handler test). **S6-P2** done. PR-A opened (S0, S1, S2, S6-P1/P2). | PR-A CI (`verify` + affected `unit`) |
| Fri 4 Dec | PR-A merged to `dev`. **S3** T3.6 auditor review + mutation checks. **S4** T4.3 (migrate 5 actions). | PR-A on dev; push-run green |
| Sat 5 Dec | **S3** fixes; PR-B opened (S3 alone). | PR-B CI incl. `pgtap` |
| Sun 6 Dec | PR-B merged. **S4** T4.4 handler wiring; entry fragments start (T4.5–T4.7 in parallel, three workers). | PR-B on dev |
| Mon 7 Dec | **S4** T4.5–T4.7; **S5** T5.1–T5.3 starts; **S6-P3** (OpenUI) starts; **S7** list drafted. | |
| Tue 8 Dec | **S4** entries + pgTAP per area; **S5** T5.4–T5.5; **S8** T8.1–T8.2 (cases and scorer written). | |
| Wed 9 Dec | **S4** T4.8 auditor review + mutation checks; PR-C opened (S4 alone). **S6-P3/P4** continue. | PR-C CI incl. `pgtap` |
| Thu 10 Dec | PR-C merged. **Integration proof on `batch/1215-assistant`**: whole database job on a clean database + whole unit suite before the push (owner rule 2026-11-28); one manual browser run (`scripts/ci-e2e.sh batch/1215-assistant`); **S8** T8.3 eval baseline-vs-both, N=10. | batch proof |
| Fri 11 Dec | **S8** T8.4 gate decision (RG-1..RG-4); PR-D opened (S5, S6-P3/P4, S8 cutover in `both`, default flip prepared). | gate |
| Sat 12 Dec | PR-D merged (default `both`; `new` when the gate passed); push-run on `dev`; fix-forward on `dev` first. | `dev` green |
| Sun 13 Dec | Role-job walks (`friction-walk`), every role, English and Bahasa, phone and desktop; Director rendered review of the panel at actual size (`restructure`). | walk results |
| Mon 14 Dec | Fixes from the walks; `S8` T8.6 deletion of legacy tools if gate passed and walks are clean; roadmap (#1571) and #3084 updated; handoff note. | |
| Tue 15 Dec | Go-live. Production promote is a separate, per-instance owner yes. Phase 2 (MCP) starts only after. | |

**Critical path:** S0-T2 (parity golden) → S1 T1.1–T1.6 → S3 (PR-B) → S4 T4.1–T4.4 → S4 entries → PR-C → batch proof (Thu 10) → eval gate (Fri 11) → PR-D (Sat 12). Slack: 2 days (13–14 Dec). If the gate or the proof slips by more than one day, ship in `both` mode on 12 Dec (the old tools stay, the new ones are offered alongside) and do the deletion after 15 Dec; the user-visible panel work and the catalog are unaffected. If S4 slips, ship with the five migrated actions plus the site group (T4.5) and move the rest to the first week after go-live; if all of it slips, MCP is already after 15 Dec.

**Allocation (parallel on one integration branch):** W1 generator (S1 T1.1–T1.6) · W2 skip classification ×2 (T1.7) · W3 find/guide/language (S2) · W4 panel (S6) · W5 read (S3) · W6 act framework (S4 T4.1–T4.4) · W7–W9 act entries by group (T4.5–T4.7) · W10 prompt/registry (S5) · W11 evals (S8) · Director: review, integration writer, owner contact. At most two heavy local runs on the Mac; DB work under `scripts/with-db-lock.sh`; reset only when a migration or seed changed (none here, so no reset except the one clean-database proof on 10 Dec).

**Batch execution table** (Director copies into each coordinator brief): `batch/ref | sole writer | ready slices | check + runner + executor | evidence/result | next action`

| batch/ref | sole writer | ready slices | check + runner + executor | evidence/result | next action |
|---|---|---|---|---|---|
| `batch/1215-assistant` | integration worker | S0, S1, S2, S6-P1/P2 (PR-A) | `check:guards`, `typecheck`, touched eslint, touched unit — each builder; `verify`+`unit` — CI | candidate SHA, CI run | merge PR-A |
| same | same | S3 (PR-B) | touched unit + `supabase test db supabase/tests/assistant_catalog_read_matrix.test.sql` under `with-db-lock.sh` — W5; full `pgtap` — CI | | merge PR-B |
| same | same | S4 (PR-C) | touched unit + the per-area pgTAP files — W6–W9; full `pgtap` — CI | | merge PR-C |
| same | same | S5, S6-P3/P4, S8 (PR-D) | batch proof (clean DB + whole unit + one browser run) — integration worker; eval N=10 — W11 | eval summary in `docs/evidence/assistant-catalog-gate.md` | gate, PR-D |

## 3. Conventions for every task

- Test first: write the failing test, see it fail for the stated reason, then the code. Edge-function tests are Deno tests that import the SHIPPED module (`scripts/check-edge-fn-test-binding.mjs`); no dependency injection added to production code.
- Local final gate per builder (CLAUDE.md): `cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched files>`, touched test files only. Edge tests: `cd supabase/functions/agent-chat && deno test --no-lock -A <file>` (the repo's own pre-commit hook runs the changed functions' tests). Never `--no-verify`.
- Security-critical rules are mutation-checked: break the rule (the plan says how) and the named test must go red before it is restored.
- Public repo: fragments, fixtures and docs carry no personal data, client names, secrets or environment names.
- Paths: edge function root `supabase/functions/agent-chat/`; new folder `catalog/` and `catalog.d/` under it.

---

## S0 — Baseline and gates (Sun 29 Nov)

**T0.1 Commit the context measure** (NFR-ACG-001). Create `scripts/measure-assistant-context.ts`:

```ts
// Prints the fixed per-round context (tool definitions + system prompt) for one role. Usage:
//   deno run -A --no-lock --config supabase/functions/agent-chat/deno.json scripts/measure-assistant-context.ts [Role]
import { buildTools, buildPlanAwarePrompt } from '../supabase/functions/agent-chat/actionCatalog.ts';
const role = Deno.args[0] ?? 'Finance';
const gates = { composeEnabled: true, automationsEnabled: true, invoiceDraftsEnabled: true, remindersEnabled: true };
const tools = buildTools(true, null);
const prompt = buildPlanAwarePrompt(50, role, { featureSwitches: null } as never, gates, true);
const toolsChars = JSON.stringify(tools).length;
console.log(JSON.stringify({ role, tools: tools.map((t) => t.function.name), toolsChars, promptChars: prompt.length,
  totalChars: toolsChars + prompt.length, approxTokens: Math.round((toolsChars + prompt.length) / 4) }));
```
Verify: `deno run -A --no-lock --config supabase/functions/agent-chat/deno.json scripts/measure-assistant-context.ts Finance` prints `toolsChars` 9707, `promptChars` 27419 on `e879385d3`.

**T0.2 Legacy parity golden** (AC-ACG-014). Create `scripts/snapshot-legacy-agent-entities.ts` (Deno) that, for each key of `AGENT_READ_ENTITIES`, calls `resolveAgentEntity` and writes `supabase/functions/agent-chat/catalog/legacy-parity.golden.json`: `{ key, table, allowedColumns (sorted), numericColumns (sorted), groupableColumns (sorted|null), requiredFilter|null, internalFilters, featureKey|null, moneyRead: AGENT_MONEY_READ_ENTITIES.has(key), moneyRoles: AGENT_MONEY_READ_ROLES }`. Run it, commit the JSON **before any other change**. Verify: file has 27 entries; `git diff --stat` shows only that file and the script.

**T0.3 Tool-set snapshot of the legacy registry.** In the same script also write `legacy-tools.golden.json` (tool names + `JSON.stringify(parameters)` hash). Used by AC-ACG-038 to prove `legacy` mode is unchanged.

**T0.4 Eval baseline on the same head** (RG-1/RG-3). With the agreed model override or key from the process environment: `N=10 scripts/agent-eval-local.sh` (one window under the DB lock; the provider, fixtures and credentials are as in `pmo-portal/evals/README.md`). Record in `docs/evidence/assistant-catalog-baseline.md`: per-case pass counts of the nine cases, the correct-tool rate on completed turns, and from `agent_usage` (`docs/runbooks/agent-cost-measurement.md` Q1/Q2) the median `prompt_tokens`, cost per completed run and p50/p95 seconds. No product or prompt change in this window. Verify: the file exists and the nine case names match `pmo-portal/evals/cases/*.eval.ts`.

---

## S1 — Generator and fragments (W1; T1.7 by two B workers)

**T1.1 Catalog types** (AC-ACG-001). Create `supabase/functions/agent-chat/catalog/types.ts`:

```ts
export type Lang = 'en' | 'id';
export interface Localised { en: string; id: string }
export type BaseRole = 'Admin' | 'Executive' | 'Project Manager' | 'Finance' | 'Engineer';

export interface CatalogColumn { name: string; type: 'text' | 'number' | 'boolean' | 'date' | 'timestamp' | 'uuid' | 'json'; numeric: boolean; groupable: boolean }

export interface CatalogEntity {
  key: string;                       // what the model passes as `entity`
  kind: 'table' | 'recipe';
  table: string;                     // table or masked view the caller's session reads ('' for a recipe)
  recipe?: 'overdue_work' | 'stock_on_hand' | 'stock_movements';
  description: Localised;            // <= 160 chars each
  aliases: string[];                 // search words, en and id mixed
  columns: CatalogColumn[];          // never includes the tenancy column
  requiredFilter?: string;
  internalFilters?: { column: string; value: null }[];
  planKey?: string;                  // undefined = core
  readRoles?: BaseRole[];            // preflight hint; undefined = all
  money: boolean;                    // money-read roles only (FR-ACG-061)
  wave: 1 | 2;
  link?: string;                     // in-app link template, e.g. '/work-orders/:id'
}

export interface ActionArg {
  name: string;                      // model-facing name
  param?: string;                    // database parameter or column when different
  type: 'string' | 'number' | 'integer' | 'boolean' | 'uuid' | 'date' | 'array' | 'object';
  required: boolean;
  enum?: string[]; maxLength?: number; minimum?: number; maximum?: number;
  description: Localised;
  items?: ActionArg[];               // for array of objects
}

export interface CatalogAction {
  name: string;
  kind: 'rpc' | 'insert' | 'custom';
  target: string;                    // rpc name | table | existing AgentAction name for 'custom'
  fixed: Record<string, string | number | boolean | null>;  // applied AFTER model args; the model cannot override
  args: ActionArg[];
  clientRequestParam?: string;       // e.g. 'p_client_request_id', filled from the approval id
  description: Localised;
  aliases: string[];
  summary: Localised;                // template with {arg} holes resolved by the server
  planKey?: string;
  roles?: BaseRole[];                // preflight hint
  can?: { action: string; entity: string };   // deputy re-auth mapping (replaces getPermissionCheck cases)
  job: string;                       // jtbd id(s), documentation only
  link?: string;
  autoApprove?: boolean;             // true only for update_task_status (OP-5)
  group: 'everyone' | 'site' | 'office' | 'finance';
}

export interface GuideChunk { id: string; page: string; title: string; section: string; lang: Lang; roles: string; text: string }
export interface Catalog { version: string; entities: CatalogEntity[]; actions: CatalogAction[]; terms: { key: string; lang: Lang; text: string }[] }
```
Verify: `cd supabase/functions/agent-chat && deno check --no-lock catalog/types.ts`.

**T1.2 Rules module** (AC-ACG-004/006). Create `catalog/rules.ts` exporting `CLOSED_ACTION_PATTERNS` (regex list from FR-ACG-005, each matching a whole word between underscores, `(^|_)(approve|reject|return|decide|post|pay|cancel|void|delete|archive|activate|release|reverse)(_|$)`, plus `^set_`, `_settings$`), `GLOBAL_DENY_COLUMN` (`/^(org_id|import_batch_id|imported_at|import_key|client_request_id|.*(file_url|file_path|storage_path|link|token|secret).*|email|phone)$/`), `MAX_DESC = 160`, and `checkActionTarget(action)`: returns an error string for a closed pattern, for a `transition_*` target whose `fixed` `p_to` is not `'Submitted'`, and for any name in the admin and operator RPC sets read from `scripts/pmo.mjs` (`ADMIN_RPCS`, `LOAD_RPCS`, `OPERATOR_ORG_RPCS` exports; read by the generator, passed in). Failing test `catalog/rules.test.ts`: one case per pattern and the `transition_expense_claim`/`Submitted` allowed case and `transition_expense_claim`/`Approved` refused case. Verify: `deno test --no-lock -A catalog/rules.test.ts`.

**T1.3 Database facts query** (FR-ACG-002). In `scripts/gen-assistant-catalog.mjs` add `readDbFacts()` that runs, through `docker exec -i supabase_db_pmo-portal psql -XqAt` exactly as `scripts/check-schema-registrations.mjs` does (`query()` helper), one SQL returning JSON: for each public table and view: columns `(name, udt_name, ordinal)`, primary key, `obj_description`, `col_description`, and `has_column_privilege('authenticated', oid, attnum, 'SELECT')` per column; and for each public function: name, argument names and types (`pg_get_function_arguments`), `has_function_privilege('authenticated', oid, 'EXECUTE')`. Sort every list; write `catalog/db-facts.generated.json`. Run under `scripts/with-db-lock.sh` (no reset). Failing test (`scripts/gen-assistant-catalog.test.mjs`, node:test, no DB): `normaliseFacts(raw)` is order-independent and drops non-public schemas. Verify: `node --test scripts/gen-assistant-catalog.test.mjs`.

**T1.4 Merge and emit** (AC-ACG-001/005/006/007/009). Add `buildCatalog(facts, fragments, guide)` in `scripts/lib/assistant-catalog.mjs`: for each fragment entity, columns = facts' granted columns − `GLOBAL_DENY_COLUMN` − fragment `hidden`; `numeric` from `udt_name in (numeric, int4, int8, float8)` intersected with fragment `sum` list; `groupable` from fragment `group` list (default: text/enum columns of at most 200 distinct values are not knowable offline, so groupable is **explicit in the fragment**); descriptions required in `en` and `id`, each ≤ 160 (`checkDescription`); action args validated against facts' function arguments (`checkActionAgainstFacts`); `version` = first 12 hex of sha256 of the canonical JSON; emit `catalog/catalog.generated.ts` as `export const CATALOG: Catalog = <JSON> as const;` with a "generated, do not edit" header. **The generated module imports nothing except `import type`** so `readEntities.ts` stays a dependency-free leaf (its header records the 2026-07-04 boot crash from an import cycle); a test asserts the generated files contain no value `import`. Failing tests: determinism (run twice, equal), missing `id` description fails, `org_id` never in columns, an action naming a missing parameter fails. Verify: `node --test scripts/gen-assistant-catalog.test.mjs`.

**T1.5 Checks** (AC-ACG-002/003). Add `--check` (static: fragments schema valid; every action passes `checkActionTarget` and `checkActionAgainstFacts`; regenerate in memory and compare with the committed `catalog.generated.ts`; scan `pmo-portal/src/lib/db/**` and `pmo-portal/src/lib/repositories/**` non-test files with `/\.from\('([a-z_0-9]+)'\)/g` and require each table that facts say `authenticated` may SELECT to be classified (`entity`, `recipe-source` or `skip` with a reason code from `{erp, sync, settings, files, audit, internal, pii, config}`); print the exact fragment line to add) and `--check-db` (regenerate facts from the local DB and compare with the committed file; prints the diff). Wire `--check` into `pmo-portal/package.json` `check:guards` (append `&& node ../scripts/gen-assistant-catalog.mjs --check && node ../scripts/gen-assistant-catalog.mjs --self-test`) and `--check-db` into `scripts/check-schema-registrations.sh`. `--self-test` plants an unclassified table, a bad action target and a stale output and expects three failures (the pattern of `check-migration-registers.mjs --self-test`). Verify: `cd pmo-portal && npm run check:guards`.

**T1.6 Core fragments carry the 27 entities** (AC-ACG-014). Create `catalog.d/entities-core.json` with one entry per current entity: `key`, `table` (the table or masked view from `entityCatalog.ts`/`readEntities.ts`), `columns` = the exact current lists as `include` (so the parity test compares like with like), `sum`, `group`, `requiredFilter`, `internalFilters`, `planKey` (from `ENTITY_FEATURE_KEYS`), `money` (from `AGENT_MONEY_READ_ENTITIES`), descriptions en/id, aliases. Mechanical draft: `node scripts/gen-assistant-catalog.mjs --draft-core > catalog.d/entities-core.json` reads `legacy-parity.golden.json`; a human writes the 54 descriptions. Failing test first: `pmo-portal/src/lib/agent/catalogParity.test.ts` (Vitest, imports `../../../../supabase/functions/agent-chat/catalog/catalog.generated` and the golden JSON) asserts equality cell by cell for all 27 entities. Mutation: delete one column from a fragment and the test goes red. Verify: `cd pmo-portal && npx vitest run src/lib/agent/catalogParity.test.ts`.

**T1.7 Classify the remaining tables** (AC-ACG-002; two workers, split by first letter, A–M / N–Z). `node scripts/gen-assistant-catalog.mjs --draft-skip` prints every unclassified DAL-read table with its `authenticated` SELECT grant and a guessed reason code from its name (`*_erp_mirror` → `erp`, `external_*` → `sync`, `org_*_settings`/`*_settings` → `settings`, `*_files`/`*_photos` → `files`, `email_*`/`agent_*` → `internal`, `people*`/`person_*` → `pii`). The worker confirms each by reading its migration and policy (`pg_policies` at head decides), and writes `catalog.d/skip.json`; any table the §7 list names becomes an entity fragment instead (`catalog.d/entities-<area>.json`, one file per area, Wave 1 first). Role cells are confirmed here against `role_table_grants` and `pg_policies` (OP-3); a cell that differs from the spec is changed in the fragment and listed in the PR body. Verify: `npm run check:guards` passes; `rg -c '"reason"' supabase/functions/agent-chat/catalog.d/skip.json` ≈ the unclassified count printed before (about 215 of 242).

**T1.8 Fragment README** (FR-ACG-010). `catalog.d/README.md`: the five-line entity fragment, the action fragment, deny list, the `skip` reason codes, and "how a new feature joins": add the fragment, run `node scripts/gen-assistant-catalog.mjs`, commit the three generated files.

---

## S2 — `find`, guide index, language (W3)

**T2.1 Guide generator** (AC-ACG-031). `scripts/gen-guide-index.mjs`: walk `docs/user-guide/**/*.md` except `README.md`; per file take the `# ` title, the "**Who can do this:**" line as `roles`, split at the line `## Bahasa Indonesia`; within each half split on `## ` into sections; one `GuideChunk` per section (`id` = `<page>#<slug>:<lang>`), text trimmed to 1,500 characters; the README's "Words this guide uses" section per language is emitted as terms. Output `catalog/guide.generated.ts`. `--check` regenerates and diffs (wired into `check:guards`). Failing tests (`scripts/gen-guide-index.test.mjs`): a fixture page with both languages yields chunks in both; editing one page changes only its chunks; a page without Bahasa yields English only. Verify: `node --test scripts/gen-guide-index.test.mjs`.

**T2.2 Visibility** (AC-ACG-008/012). `catalog/visible.ts`:

```ts
import type { Catalog, CatalogAction, CatalogEntity } from './types.ts';
import { isKeyEnabled } from '../featureSwitches.ts';
export interface VisCtx { role: string | null; switches: Readonly<Record<string, boolean>> | null | undefined }
const roleOk = (roles: readonly string[] | undefined, role: string | null) =>
  roles === undefined || (role !== null && roles.includes(role));
export const entityVisible = (e: CatalogEntity, c: VisCtx) =>
  isKeyEnabled(e.planKey, c.switches) && roleOk(e.readRoles, c.role);
export const actionVisible = (a: CatalogAction, c: VisCtx) =>
  isKeyEnabled(a.planKey, c.switches) && roleOk(a.roles, c.role);
export const visibleEntities = (cat: Catalog, c: VisCtx) => cat.entities.filter((e) => entityVisible(e, c));
export const visibleActions = (cat: Catalog, c: VisCtx) => cat.actions.filter((a) => actionVisible(a, c));
```
Failing test `catalog/visible.test.ts`: plan key off hides; `readRoles` excludes a role; `null` switches show everything not role-excluded (reads fail open, as `isKeyEnabled` does). Verify: `deno test --no-lock -A catalog/visible.test.ts`.

**T2.3 Search** (AC-ACG-010/011). `catalog/search.ts`: tokenise (lowercase, strip diacritics, split on non-alphanumerics, drop tokens of length < 2); BM25 with k1 1.2, b 0.75 over documents built per language (`key + aliases` weight 3, `description` weight 1, guide `title` weight 3, `text` weight 1); a query token of length ≥ 4 also matches document tokens it prefixes; ties by kind order entity, action, guide, term; the user's language first, the other language only for documents with no chunk in the user's language (record the fallback in the result). `findCatalog({ query, kind, limit, lang }, ctx)` returns `Result[]` (typed in `catalog/findTypes.ts`) with the shapes of FR-ACG-013, truncating each result to 600 characters and the whole reply to 3,600. Failing tests: "material request" ranks `material_requests` first; Bahasa "permintaan material" with `lang: 'id'` returns the Indonesian description; hidden entries never appear; unmatched query returns `[]`. Verify: `deno test --no-lock -A catalog/search.test.ts`.

**T2.4 `find` action** (AC-ACG-012/013/032/034). `catalog/findAction.ts` exports `findAction: AgentAction` (`name: 'find'`, `confirm: false`, `inputSchema`: `{ query: string (1..200), kind?: 'record'|'action'|'guide', limit?: integer 1..8 }`, `run` calls `findCatalog` with `ctx.role`, `ctx.featureSwitches` and the language from T2.5). Verify: `deno test --no-lock -A catalog/findAction.test.ts` (calls `findAction.run` against the shipped module; no DB; asserts no `ctx.supabase` call is made, FR-ACG-015).

**T2.5 Language** (AC-ACG-033). Client: add `language?: 'en' | 'id'` to `RunContext` in `pmo-portal/src/lib/agent/runtime/transport.ts` and fill it in `pmoNativeRuntime.ts` from the i18n language (`i18n.language` starting with `id` → `'id'`). Server: validate in `handler.ts` where the context is read (`'en' | 'id'` else `'en'`), carry on `DeputyContext` as `language`, and add the line "Answer in Bahasa Indonesia." / "Answer in English." to the prompt builder (done in S5). Failing tests first: `pmo-portal/src/lib/agent/runtime/transport.test.ts` (language is sent), `supabase/functions/agent-chat/handler.language.test.ts` (invalid value → English). Verify: `cd pmo-portal && npx vitest run src/lib/agent/runtime/transport.test.ts`, then the Deno test.

**T2.6 Terms** (FR-ACG-051). `catalog.d/terms.json`: the 15 plain-language terms of `helpCorpus.ts` ("Terms" section), each in `en` and `id`, replaced where a guide page already says it better. Verify: generator regenerates; `find "committed spend"` returns the term.

**T2.7 Cold start and size** (NFR-ACG-004). Script `scripts/measure-catalog-load.ts` (Deno): time `import()` of catalog + guide index 20 times, print p50/p95 and file sizes. If p95 > 100 ms, split `guide.generated.ts` into `guide.en.generated.ts` and `guide.id.generated.ts` loaded by dynamic import on first use (change `search.ts` only). Verify: output recorded in the PR body.

---

## S3 — `read` over the catalog (W5; ships alone: PR-B)

**T3.1 Resolve entities from the catalog** (AC-ACG-014/019). In `entityCatalog.ts`, replace the two-source body of `resolveAgentEntity` with a lookup in `CATALOG.entities` that returns the same `AgentEntityEntry` shape (`table`, `allowedColumns` set, `numericColumns` set, `groupableColumns`, `requiredFilter`, `internalFilters`); delete `INTERNAL_FILTERS` (now in fragments) and the `ENTITY_WHITELIST` import; keep the exported signature. In `readEntities.ts` make `AGENT_READ_ENTITIES` derive from the catalog's table entities (`CATALOG.entities.filter(kind==='table').map(key)`), and `AGENT_MONEY_READ_ENTITIES` from `money`. Keep `AGENT_READ_ROW_CAP` and the aggregate caps unchanged. `readEntities.ts` imports the generated module for values only through the generated leaf (see T1.4); the `AGENT_READ_ENTITIES` type widens from the literal union to `string` and `QUERY_ENTITY_SCHEMA`'s enum is the catalog's table keys. Failing test first: the existing `actions.queryEntity.test.ts` and `catalogParity.test.ts` must stay green. Verify: `deno test --no-lock -A actions.queryEntity.test.ts`; `cd pmo-portal && npx vitest run src/lib/agent/catalogParity.test.ts`.

**T3.2 `read` action and suggestions** (AC-ACG-018/019). New `readAction.ts` exporting `readAction` (`name: 'read'`, same schema as `QUERY_ENTITY_SCHEMA` but `entity` is a free string with `maxLength: 64`, since the visible list is in `find`, and the prompt names the common keys) whose `run` calls the existing `runQueryEntity` renamed `runRead` (`actions.ts`; keep a `runQueryEntity` alias until cutover). On `unknown entity` or hidden, return `{ error, suggestions: findCatalog({query: entity, kind:'record', limit: 3}, ctx).map(r => r.key) }`. Failing tests: unknown entity returns ≤ 3 visible suggestions and no rows; a hidden entity returns none of its own key. Verify: `deno test --no-lock -A readAction.test.ts`.

**T3.3 Recipes** (AC-ACG-020). `catalog/recipes.ts`: `overdue_work` calls the existing `makeWhatsOverdueAction(...).run`, `stock_on_hand` / `stock_movements` call `queryStockAction.run` with `topic` set; `read` routes `kind: 'recipe'` entities there with the user's `filter` mapped to the recipe's own arguments (`project`, `item`, `warehouse`). The recipes keep their own role and cost rules (nothing re-implemented). Failing tests re-point `overdue.leafOnly.test.ts`/`actions.queryStock.test.ts` cases at `read`; add one case: a role that may not see unit cost gets no cost field. Verify: `deno test --no-lock -A actions.queryStock.test.ts overdue.leafOnly.test.ts readRecipes.test.ts`.

**T3.4 pgTAP column and role matrix** (AC-ACG-007, AC-ACG-017). `supabase/tests/assistant_catalog_read_matrix.test.sql`: for each generated entity (the generator also writes `catalog/read-matrix.generated.json` listing `key, table, columns, money`), as a user of each base role in a seeded org plus a user in a second org, `set local role authenticated` with the user's claims and `select <catalog columns> from <table> limit 1`: (a) never errors on a column outside the grant (proves the catalog's columns ⊆ grants), (b) money entities return zero rows or a permission error for roles outside the four money roles exactly where the 0350 rule says, (c) zero rows from the other org. Use the fixture style of `supabase/tests/0090_agent_query_entity_rls.test.sql`. Verify: `scripts/with-db-lock.sh supabase test db supabase/tests/assistant_catalog_read_matrix.test.sql`.

**T3.5 Price-hidden requester through `read`** (AC-ACG-015). Copy `hidePrices.requester.test.ts` to `readCatalog.hidePrices.test.ts`, with the scripted model call `read` on `procurements`: assert the only procurement path hit is `procurements_masked` and the answer carries no price. Mutation: point the fragment's `table` at `procurements` and the test goes red. Verify: `deno test --no-lock -A readCatalog.hidePrices.test.ts`.

**T3.6 Money-role refusal** (AC-ACG-016). `readCatalog.moneyRoles.test.ts`: table-driven over every `money: true` entity × the five base roles through `runRead`: refusal and zero DB calls outside the four roles. Mutation: set `money: false` for `payments` and the test goes red. Then the **security-auditor** review of S3 (OWASP/STRIDE on the read path: tenancy, column leak, injection through `filter` values and `order_by`); findings go to the PR. Verify: `deno test --no-lock -A readCatalog.moneyRoles.test.ts`.

---

## S4 — `act` (W6 framework; W7–W9 entries; ships alone: PR-C)

**T4.1 Argument validator** (AC-ACG-022). `catalog/validateArgs.ts`: validates an object against `ActionArg[]`: unknown keys refused; `string` with `maxLength`; `uuid` with the UUID regex; `date` as `YYYY-MM-DD` and a real calendar date; `integer`/`number` with bounds and finiteness; `enum`; `array` of objects recursively (max 200 items); returns `{ ok: true, value } | { ok: false, problems: string[] }` with each problem naming the argument. Failing tests: extra key, wrong type, missing required, enum miss, bad date. Verify: `deno test --no-lock -A catalog/validateArgs.test.ts`.

**T4.2 Runner** (AC-ACG-023/024/030). `catalog/actRunner.ts`:

```ts
import type { CatalogAction } from './types.ts';
import type { DeputyContext } from '../../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { asRpc } from '../looseClient.ts';

/** Build the database payload: model args mapped to declared params, then fixed args LAST so they always win. */
export function buildPayload(a: CatalogAction, args: Record<string, unknown>, clientRequestId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const arg of a.args) {
    const v = args[arg.name];
    if (v !== undefined) out[arg.param ?? arg.name] = v;
  }
  if (a.clientRequestParam) out[a.clientRequestParam] = clientRequestId;
  return { ...out, ...a.fixed };
}

export async function runCatalogAction(a: CatalogAction, args: Record<string, unknown>, ctx: DeputyContext, clientRequestId: string) {
  const payload = buildPayload(a, args, clientRequestId);
  if (a.kind === 'rpc') {
    const rpc = asRpc(ctx.supabase);
    if (!rpc) return { error: 'act: rpc is not available in this context' };
    const { data, error } = await rpc.rpc(a.target, payload);
    if (error) return { refused: true, message: (error as { message?: string }).message ?? 'The database refused this change.', code: (error as { code?: string }).code };
    return { ok: true, id: typeof data === 'string' ? data : (data as { id?: string } | null)?.id ?? null, link: a.link };
  }
  if (a.kind === 'insert') {
    const sb = ctx.supabase as import('../../../../pmo-portal/src/lib/agent/runtime/port.ts').SupabaseLikeWithWrites;
    const { data, error } = await sb.from(a.target).insert(payload).select('id').single();
    if (error) return { refused: true, message: (error as { message?: string }).message ?? 'The database refused this change.', code: (error as { code?: string }).code };
    return { ok: true, id: (data as { id?: string } | null)?.id ?? null, link: a.link };
  }
  return { error: 'act: custom actions run through their own handler' };
}
```
Failing tests (`catalog/actRunner.test.ts`): fixed `p_to` wins over a model-supplied `p_to`; only declared names reach the payload; `clientRequestParam` carries the approval id; **mutation**: spreading `a.fixed` before `out` turns the first test red. Verify: `deno test --no-lock -A catalog/actRunner.test.ts`.

**T4.3 `act` action with prepare / approval** (AC-ACG-021/025/026/027/028). New `actAction.ts` exporting `actAction: AgentAction` modelled on `draftInvoiceAction` (`draftInvoice.ts:573`): `name: 'act'`, `confirm: true`, `inputSchema: { name: string, args: object }`, `needsApproval: (input) => !catalogAction(input.name)?.autoApprove`, `prepare(input, ctx)`: find the visible action (role hint + plan key; unknown/hidden → `{ ok: false, error }`), `validateArgs`, resolve labels for the summary (project, work order, item names by one read each under the caller's session), return `{ ok: true, value: { name, args }, summary }` with the template in the user's language; `validatePrepared`: re-validate `value` (the allow-list rebuild at approval); `run`: re-check `writeRefusal(planKey, ctx.featureSwitches)` (fail-closed for every entry with a plan key), then `runCatalogAction`. In `confirmedAction.ts` change `getPermissionCheck(actionName)` to `getPermissionCheck(actionName, input?)` so for `act` it returns the entry's `can`; extend the two callers (`handleDecision` in `turnContinuations.ts`, the auto-approval path in `toolLoop.ts`) to pass the stored arguments. Failing tests (shipped handler, scripted model, mocked fetch, no DI): proposal event with server summary and no write; extra key proposes nothing; approval after role change or plan key off writes nothing and returns `FEATURE_OFF`/`PLAN_UNVERIFIED`; replay returns the first result with one database call (the journal key is `act` + the hash of validated `{ name, args }`); a database refusal returns `refused` and the final text does not claim success; the catalog's action names match none of the closed patterns and number 25 (AC-ACG-028). Verify: `deno test --no-lock -A act.handler.test.ts actCatalog.closedList.test.ts`.

**T4.4 Migrate the five existing actions** (FR-ACG-001). Fragment `catalog.d/actions-migrated.json` with `kind: 'custom'` entries `log_crm_activity` (→ `create_activity`), `update_task_status`, `draft_invoice`, `remind_overdue`, `create_automation` (each keeps its own `validate`/`prepare`/`run`; `autoApprove: true` only on `update_task_status`; plan keys from `TOOL_FEATURE_KEYS`; `AUTOMATIONS_ENABLED`, `INVOICE_DRAFTS_ENABLED`, `REMINDERS_ENABLED` still filter them out of the visible set). `actAction.run` delegates a `custom` entry to `BASE_ACTION_BY_NAME.get(target)` through `dispatchActionForced` after the same checks. Failing tests: the existing `draftInvoice.*.test.ts`, `remindOverdue`, `actions.updateTaskStatus.test.ts` cases driven through `act` give the same proposal and result. Verify: `deno test --no-lock -A actions.updateTaskStatus.test.ts draftInvoice.run.test.ts actMigrated.test.ts`.

**T4.5 Entries: site group** (W7; AC-ACG-029/030). `catalog.d/actions-site.json`, one entry each, with `fixed` and args as the DAL calls them today (`pmo-portal/src/lib/db/*`); S4 starts each by reading the function's latest definition in `pg_proc` / its migration for argument names and role gate (the generator's `checkActionAgainstFacts` then enforces them):

| Action | Target | Fixed | Model args (→ param) | Link |
|---|---|---|---|---|
| `save_material_request_draft` | RPC `mrq_save_draft` | — | `project`, `workOrder`, `neededBy`, `lines[{item, quantity, reason?}]` (mapped to the header/lines JSON the app builds in `materialRequests.ts:448`) | `/material-requests/:id` |
| `submit_material_request` | RPC `mrq_submit` | — | `request` → `p_request_id` | `/material-requests/:id` |
| `save_site_report_draft` | RPC `dsr_save_draft` | — | `workOrder`, `workDate`, summary fields as `DsrDraftInput` | `/site-reports/:id` |
| `submit_site_report` | RPC `dsr_submit` | — | `report` → `p_report` | `/site-reports/:id` |
| `create_incident` | insert `incident_reports` | — | `incident_date`, `type`, `severity`, `location?`, `description?`, `project_id?` | `/incidents/:id` |
| `save_equipment_usage` | RPC `save_equipment_usage` | — | `entry` object as `UsageInput` | `/equipment` |
| `submit_equipment_usage` | RPC `transition_equipment_usage` | `p_to = Submitted` | `usage` → `p_id` | `/equipment` |
| `save_stock_draft` | `custom` in `catalog/customs/stockDraft.ts`: with no `document` argument it calls RPC `create_stock_document` with fixed `p_post = false`; with one it calls RPC `save_stock_draft` (`p_document_id`, header, lines) | `p_post = false` on create | header and lines as `StockDocumentInput`, optional `document` | `/stock/:id` |
| `raise_quantity_change` | RPC `qcr_raise` | — | `workOrder` → `p_work_order_id`, `lines`, `note?` | `/quantity-changes/:id` |
| `submit_quantity_change` | RPC `qcr_submit` | — | `request` → `p_request_id` | `/quantity-changes/:id` |
| `create_expense_claim_draft` | `custom` two-step insert (`expense_claims`, then `expense_claim_lines`) in `catalog/customs/expenseClaim.ts` | — | `kind='claim'`, `title`, `purpose`, `project`, `budgetCategory`, `lines[{date, type, description, amount}]` | `/expenses/:id` |
| `submit_expense_claim` | RPC `transition_expense_claim` | `p_to = Submitted` | `claim` → `p_id` | `/expenses/:id` |

The stock entry carries plan key `stock`. It never calls `post_stock_document`. Site group: 12 entries; with the 5 of T4.6, the 3 of T4.7 and the 5 migrated in T4.4 the catalog holds the 25 actions of spec §8 (AC-ACG-028 asserts the count).

Each entry's tests: argument-builder golden (AC-ACG-030) — fixture args → the payload equal to what the DAL wrapper sends — and a pgTAP file `supabase/tests/assistant_catalog_act_site.test.sql` (AC-ACG-029) calling each target RPC as each offered role with the built payload. Verify: `deno test --no-lock -A actions.site.test.ts` and `scripts/with-db-lock.sh supabase test db supabase/tests/assistant_catalog_act_site.test.sql`.

**T4.6 Entries: everyone group** (W8; AC-ACG-029/030). `catalog.d/actions-everyone.json`: `create_task` (insert `tasks`; refuses when the project's tasks are mastered externally — the app's `routeTaskWrite` rule, mirrored by checking the project's task-source column in `prepare`), `save_timesheet_week` (RPC `save_timesheet_week`, args as `saveTimesheetWeek`), `submit_timesheet` (RPC `transition_timesheet`, fixed `p_to = Submitted`), `submit_leave_request` (RPC `leave_request_submit`: `p_person_id`, `p_type_id`, `p_start`, `p_end`, `p_reason?`), `report_absence` (RPC `report_absence`: `p_reason`, `p_note?`); plus `catalog/customs/` none. pgTAP `assistant_catalog_act_everyone.test.sql`. Verify as T4.5.

**T4.7 Entries: office group** (W9; AC-ACG-029/030). `catalog.d/actions-office.json`: `create_meeting` (insert `meetings`), `create_phase` (insert `project_milestones`), `create_purchase_request_draft` (RPC `create_procurement_with_items`, args as `procurementCrud.ts:131`; the state is what the RPC creates, no transition). pgTAP `assistant_catalog_act_office.test.sql`. Verify as T4.5.

**T4.8 Closed-list proof, mutation checks and review** (AC-ACG-004/028). Mutations, each must turn its test red and is then restored: add `approve_x` to a fragment (generator refuses); `fixed: { p_to: 'Approved' }` on a `transition_*` target (generator refuses); drop the fixed-last order in `buildPayload`; skip `validatePrepared`. Then the **security-auditor** reviews S4 (SoD, re-auth, injection through `args`, confused-deputy via record text, replay) and the **spec-reviewer** and **code-quality-reviewer** run. Verify: `deno test --no-lock -A catalog/` all green after restoring.

---

## S5 — Prompt, tool registry and modes (W10)

**T5.1 Catalog prompt builder** (AC-ACG-035/036/037). New `promptCatalog.ts` exporting `buildCatalogSystemPrompt({ role, lang, offered, unavailableFeatures, rowCap, commonKeys })`: keeps the charter and hard rules 1–11 of `prompt.ts` (rule 7 reworded: read with `read`, change only with `act`), a tool index of at most five lines, skills `find-first` ("search with `find` before saying something is not available; for 'how do I' call `find` with kind `guide`, answer from the steps, name the page, describe only what the user's role may do"), `read-after-find`, `act` ("always `find` the action first; never claim a change before the tool result says so; a card is shown to the user"), `table-not-markdown`, `ask-user`, the not-on-plan paragraph, the language line, and **one line of common keys** (`projects, tasks, companies, contacts, procurements, work_orders, material_requests, daily_site_reports, expense_claims, timesheets, stock_items`, filtered by visibility) so a named type can skip `find`. No entity descriptions, no help text. Failing tests: total (tools + prompt) ≤ 12,000 characters for Finance with all modules on; adding 100 fixture entities leaves the output byte-identical; the output contains no `HELP_CORPUS` text. Verify: `deno test --no-lock -A promptCatalog.test.ts` and `deno run -A --no-lock --config deno.json ../../../scripts/measure-assistant-context.ts Finance` (the script switches on the mode argument added here).

**T5.2 Tool registry with modes** (AC-ACG-036/038). In `actionCatalog.ts` `buildTools(composeEnabled, switches, mode)`: `legacy` = today's list (equal to `legacy-tools.golden.json`), `both` = legacy + `find`, `read`, `act`, `new` = `find`, `read`, `act`, `ask_user`, `compose_view` (+ `notify` while automations are on). The mode is read from a server-side setting at request time (name chosen in the build and recorded in `docs/environments.md`; the default stays `legacy` until PR-D). `handler.ts` picks `buildPlanAwarePrompt` or `buildCatalogSystemPrompt` by mode. In `both` mode the prompt tells the model to prefer the new tools. Failing tests: the three tool sets by mode; `legacy` output equals the golden. Verify: `deno test --no-lock -A actionCatalog.modes.test.ts`.

**T5.3 Step labels** (FR-ACG-075). `stepLabel` in `toolLoop.ts` gains `find` ("Searching the catalog" / the user-language equivalent from `panelStrings`), `read` ("Reading <entity description>"), `act` ("Preparing: <action description>"). Failing test beside the existing step-label tests. Verify: `deno test --no-lock -A toolLoop.stepLabel.test.ts`.

**T5.4 Missing-tool signal** (`missingTool.ts`). `MODULE_GUESSES` stays; add a case that a `find` call returning no result records the same coarse event (module guess only, never text). Verify: `deno test --no-lock -A missingTool.test.ts`.

**T5.5 Telemetry** (FR-ACG-009). Record the `catalog.version` and the mode on the turn's usage row (`aiTelemetry.ts` properties, no question text). Verify: `deno test --no-lock -A aiTelemetry.test.ts`.

---

## S6 — Panel (UI lane; one worker owns the panel per `docs/ux/screen-owner-runbook.md`)

Read first: `DESIGN.md`, `docs/ux/screen-rules.md`, `src/components/panel/THIRD_PARTY_NOTICE.md`, #2047 comments (audit items are acceptance checks). The Chat, Prompt Bar, Thinking, Streaming Text, Tool Chips and loading state already follow beautifului.dev (PR #2430).

**T6.1 (P1) Suggested question sends on click** (AC-ACG-039). Failing test in `EmptyState.suggestion.test.tsx`: clicking a chip calls `onSend(question)`; today's test asserts it only fills the composer — change that assertion deliberately (a deliberate UX change; the goal oracle "the question is sent" is the new one). In `AssistantPanel.tsx` replace `handleChipPick` (line ~437) with a function that calls the same send path as the composer. Remove the `readOnly` line from `EmptyState.tsx` (line ~73) and its i18n key; replace the descriptor with the one-line capability sentence (en/id in `panelStrings`). Verify: `npx vitest run src/components/panel/EmptyState.suggestion.test.tsx src/components/panel/panelStrings.i18n.test.ts`; e2e `AC-ACG-039` file `pmo-portal/e2e/AC-ACG-039-suggestion-sends.spec.ts` (`scripts/e2e-local.sh AC-ACG-039`, scripted frames like `JOB-A10-assistant-answers.spec.ts`; carries its `@e2e-isolation` header per `docs/e2e-parallel-conventions.md`, and gates on the dependency, never on `process.env.CI`).

**T6.2 (P2) Approval Card** (AC-ACG-040/044). Rework `ApprovalChip.tsx` into the beautifului Approval Card in PMO tokens: title from the server summary, key facts as label/value rows (from the proposal's `structuredArgs`), Approve/Deny, states pending → approving → approved / denied / refused; refused shows the database's plain message; focus returns to the composer after a decision; `focus-visible` rings; the success link opens the record. Failing tests: `ApprovalChip.test.tsx` states incl. `refused`; e2e `pmo-portal/e2e/AC-ACG-040-approval-card.spec.ts` as an Engineer-role user via `roleJobUser` (scripted propose frame for `submit_material_request`, then approve), and `AC-ACG-044-approval-refused.spec.ts`. Verify: `npx vitest run src/components/panel/ApprovalChip.test.tsx`; `scripts/e2e-local.sh AC-ACG-040 AC-ACG-044`.

**T6.3 (P2) Context Cards and Records Table.** `ContextCard.tsx` (record summary: title, status, 3 facts, link) and `RecordsTable.tsx` (sortable, row link, sticky header, density per `screen-rules.md`) rendered from the widget registry (`widgets/registry.tsx`) as new kinds in `src/lib/agent/widgets/schema.ts`; zod schema extended; the existing `data_table` renders through `RecordsTable`. Failing tests beside `registry.test.tsx`. Verify: `npx vitest run src/components/panel/widgets`.

**T6.4 (P3) OpenUI answer renderer** (AC-ACG-041; needs the answer shapes of S3). Use `@openuidev/react-lang` already in `package.json` (`1.1.0`): a library definition whose components are exactly `RecordsTable`, `ContextCard`, `KPITile`, `Chart` (a closed registry); the model's answer text may contain an OpenUI block; anything not in the registry, or any raw HTML, renders as plain text (`Markdown.security.test.tsx` pattern); links go through the existing link allow-list (`Markdown.links.test.tsx`). **Security review of the data path before merge** (as #2047 requires): model output never reaches `dangerouslySetInnerHTML`, no network calls from the renderer. Prompt line in S5 teaches the block syntax (≤ 600 characters). Failing tests: `OpenUiAnswer.test.tsx` (registry components render; unknown component and `<script>` render as text). Verify: `npx vitest run src/components/panel/OpenUiAnswer.test.tsx`.

**T6.5 (P4) a11y and performance acceptance** (AC-ACG-042/043; FR-ACG-076/077). `React.memo(TranscriptItem)`, module-level empty defaults for `chipStateMap` / `answeredMap`, memoised widget `safeParse`; `role=status` announcement once per run (no per-second counter in a live region); composer keeps focus after send (do not `disable` the textarea while a run is in flight; block submit instead); Bahasa strings for every new state, extending the all-states test (#2430). Failing tests: Profiler test with five table widgets (`AssistantPanel.stream.profile.test.tsx`), `AssistantPanel.bahasa.test.tsx` extended. Verify: `npx vitest run src/components/panel`.

**T6.6 Rendered review** (Director). `scripts/ux-proof.sh` on `/` with the panel open (empty, streaming, approval, refused, table answer), phone and desktop, en and id; Director looks at actual size; one fix round, no more (`restructure` skill, screen-owner runbook).

---

## S7 — Guide readiness (W12, docs only)

**T7.1** Write `docs/evidence/assistant-howdoi-questions.md`: the 40 most likely "how do I" questions from `docs/jtbd.md` §6 jobs (English and Bahasa), each mapped to the guide page that answers it today (dev, `origin/feat/docs-site`) or marked **missing**; missing ones are added as a comment on #3085 (not as edits to guide pages). Verify: every row has a page path that exists (`test -f`) or `missing`.
**T7.2** After the docs-site branch merges, regenerate the guide index (`node scripts/gen-guide-index.mjs`) and run RG-2's how-do-I cases again.

---

## S8 — Evals and cutover (W11, then Director)

**T8.1 Scorer** (RG-1). In `pmo-portal/evals/harness/scorers.ts` add `usesToolWith(name, predicate)` (the run called `name` and the arguments satisfy the predicate) and `usesAnyTool(names)`; unit-test in `scorers.test.ts`. Re-point the nine baseline cases through a mapping (`whats_overdue` ≡ `read{entity:'overdue_work'}`, `query_stock` ≡ `read{entity:'stock_on_hand'}`, `query_entity` ≡ `read`, `draft_invoice` ≡ `act{name:'draft_invoice'}`, `remind_overdue` ≡ `act{name:'remind_overdue'}`) so the same prompts score against either tool set. Verify: `cd pmo-portal && npx vitest run evals/harness/scorers.test.ts`.

**T8.2 New cases** (RG-2). `pmo-portal/evals/cases/catalog.eval.ts` (each case `runs: 10, minPasses: 9` as the existing 10-run cases): find→read (work orders over plan; material requests waiting for me), find→act (`save_material_request_draft` proposal checked with `proposesAction`; `submit_expense_claim` proposal), how-do-I from the guide in English ("How do I request materials?") and in Bahasa ("Bagaimana cara mengajukan permintaan material?") scored with `contains` on a step phrase and the page title, a Bahasa record question ("Permintaan material apa yang menunggu persetujuan saya?" → `find` then `read`, answer in Bahasa), a non-money role asking for vendor bills (answer says not available for the role — needs a per-role test login in the harness, supplied through the process environment and documented in `pmo-portal/evals/README.md`), a plan-off entity (extends `plans-switch-off.eval.ts`), an injection case in a record's text through `read`. Fixture additions in `pmo-portal/evals/README.md` (work order, material request, expense claim rows). Verify: `scripts/agent-eval-local.sh --dry-run` then `EVAL_CASE_FILES=evals/cases/catalog.eval.ts N=1 scripts/agent-eval-local.sh`.

**T8.3 Runs** (RG-1..RG-4). In `both` mode and in `new` mode: `N=10 scripts/agent-eval-local.sh` each, one window each under the DB lock, no other heavy loads. Record in `docs/evidence/assistant-catalog-gate.md`: per case pass counts vs baseline, correct-tool rate on completed turns, median tokens, cost per run, p50 first word, and every miss with the run trace (a truncated local stream is diagnosed from the serve log before it is called noise, as in #1596).

**T8.4 Gate decision** (Director). RG-1..RG-4 met → default `new`. A recipe case below baseline → that tool stays registered one release and is named in the PR; nothing else waits. Any other miss → stay in `both`, fix from the trace, re-run only the failed cases plus RG-1.

**T8.5 Cutover deletion** (FR-ACG-056/081; only after T8.4). Delete `helpCorpus.ts`, `pmo-portal/src/lib/agent/helpCorpus.test.ts`, the per-feature tools from `BASE_ACTIONS` except those kept by T8.4, `prompt.ts`'s entity and help sections (replaced by `promptCatalog.ts`), `QUERY_ENTITY_SCHEMA` alias, `queryStockAction`/`makeWhatsOverdueAction` registrations (their code stays as recipe sources), and the `legacy` mode. Update the tests that named them (`agentPrompt*.test.ts`, `actions.queryEntity.test.ts` to `read`). Verify: `cd pmo-portal && npm run check:guards && npm run typecheck && npx vitest run src/lib/agent`, `deno test --no-lock -A` in `supabase/functions/agent-chat`.

**T8.6 Records.** Update `docs/specs/deputy-help.spec.md` (already carries the supersede line from the spec), `docs/glossary.md` (**Catalog**, **Action**, **Fragment**), `docs/decisions.md` (a DD entry pointing at ADR-0127 and the three-tool ruling), `docs/environments.md` (the mode setting), #3084 and the roadmap (#1571) in the same session.

---

## S9 — Phase 2: MCP server (after 15 Dec; own PR; auth tier, ships alone)

Requirements (draft, to be signed at the start of phase 2): **FR-ACG-M01** a remote MCP endpoint over streamable HTTP exposing `find`, `read` and `act` with the same catalog, visibility and runners; **M02** sign-in per DD-API-2 (the caller's own OAuth token; no stored tokens); **M03** every call runs under that token's session; `act` returns the proposal to the MCP client, which asks its own human, and executes only on the client's confirmation call carrying the proposal id (DD-API-3: "an MCP client prompts its own human"); **M04** the act allow-list is intersected with DD-API-3's open set for outside callers; **M05** per-user rate limit if an edge proxy is added.
Tasks: T9.1 transport module `supabase/functions/mcp-catalog/` reusing `catalog/*` (no copy); T9.2 OAuth bearer verification as in `agent-chat/index.ts`; T9.3 proposal/confirm pair with the journal; T9.4 contract tests against the MCP SDK client; T9.5 owner-gated enablement of the OAuth server on the hosted project (DD-API-2: infrastructure change, owner yes). Preconditions: the catalog and runners from S1–S4 on `main`; the guard review in M04.

---

## 4. Traceability (AC → owning layer → task)

| AC | Layer | Task | | AC | Layer | Task |
|---|---|---|---|---|---|---|
| 001 | U | T1.4 | | 023 | U | T4.2 |
| 002 | U | T1.5 | | 024 | U | T4.3 |
| 003 | U | T1.5 | | 025 | U | T4.3 |
| 004 | U | T1.2, T4.8 | | 026 | U | T4.3 |
| 005 | U | T1.4 | | 027 | U | T4.3 |
| 006 | U | T1.4 | | 028 | U | T4.3, T4.8 |
| 007 | P | T3.4 | | 029 | P | T4.5–T4.7 |
| 008 | U | T2.2 | | 030 | U | T4.5–T4.7 |
| 009 | U | T1.4 | | 031 | U | T2.1 |
| 010 | U | T2.3 | | 032 | U | T2.4 |
| 011 | U | T2.3 | | 033 | U | T2.5 |
| 012 | U | T2.2, T2.4 | | 034 | U | T2.4 |
| 013 | U | T2.4 | | 035 | U | T5.1, T8.5 |
| 014 | U | T1.6 | | 036 | U | T5.1, T5.2 |
| 015 | U | T3.5 | | 037 | U | T5.1 |
| 016 | U | T3.6 | | 038 | U | T5.2 |
| 017 | P | T3.4 | | 039 | E | T6.1 |
| 018 | U | T3.2 | | 040 | E | T6.2 |
| 019 | U | T3.1 | | 041 | U | T6.4 |
| 020 | U | T3.3 | | 042 | U | T6.5 |
| 021 | U | T4.3 | | 043 | U | T6.5 |
| 022 | U | T4.1 | | 044 | E | T6.2 |

Every FR maps to at least one AC above or to a rollout gate: FR-001..010 → AC-001..009; FR-011..015 → AC-010..013; FR-020..025 → AC-014..020; FR-030..038 → AC-021..030; FR-050..056 → AC-031..035; FR-060..063 → AC-008, AC-014..017; FR-070..077 → AC-039..044; FR-080/081 → AC-038 and RG-1..RG-4.

## 5. Definition of done for the whole feature

1. PR-A..PR-D merged to `dev`, `dev` push-run green (a red push-run is fixed on `dev` first).
2. RG-1..RG-4 recorded in `docs/evidence/assistant-catalog-gate.md` with the model id, N, date and head SHA.
3. Role-job walks (`friction-walk`) done for Engineer (site), Project Manager, Finance, Admin and Executive in English and Bahasa on phone and desktop; each blocked job is a ticket.
4. `helpCorpus.ts` and the per-feature tools are gone (or each kept tool is named with its reason); no unclassified table in `check:guards`.
5. Spec open points OP-1..OP-10 each answered or ticketed; #3084, #1571 and #3085 updated.
