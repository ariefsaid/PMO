# Feature: Client onboarding tooling (GTM / MVP-viability program, item 6)

> **Authority:** `docs/backlog.md` ▶ *GTM / MVP-viability program* item 6 (owner grill, 2026-07-04;
> **grill DONE — this spec encodes the owner-approved decisions, it does not re-open them**).
> **Controlling / Related ADRs:** ADR-0047 (per-client Supabase Cloud Pro projects — provisioning
> *is* the Operator's "add org") is **binding** for Deliverable 1. ADR-0048 (ERPNext headless
> accounting engine) is **Related, out of scope v1** — the ERPNext provisioning leg is noted as a
> seam only (§Observations), and is the cited authority (not OD-PROC-3) for the historical import's
> legacy-reference-reconciliation rationale — see **OD-ONB-1** (`docs/decisions.md`, dual-reference
> decision: `reference_number` vs `import_key`). ADR-0033 (procurement case folder; dual-ID; append-only
> `procurement_status_events`; business `date` ≠ system `created_at`), ADR-0035 (procurement-cycle
> bulk-import), ADR-0027 (generic `ImportDescriptor` + reuse-create write path) are **binding** for
> Deliverables 2 & 3. ADR-0010 (test pyramid) governs test ownership. ADR-0016/0017/0018/0019
> (authz/repository seam/soft-archive/server-enforced SoD) are binding on every write path touched.
> OD-BUDGET-2 (`docs/decisions.md`; committed spend = Σ `total_value` for statuses Ordered..Paid) is
> **binding** for Deliverable 3's case-level value handling (see §"Committed-spend correctness" below).
> **Related docs:** `docs/environments.md` (registry + secret pattern + edge-fn deploy),
> `docs/spikes/2026-07-04-full-codebase-review.md` (the deferred "bulk-import idempotency" finding),
> `docs/glossary.md` (Operator, Organization, Entity, System-assigned number, External reference
> number, Procurement record).
> **Glossary terms used as binding nouns:** *Operator* (platform persona ≠ org Admin), *Organization
> / org* (the tenant = one client group), *Entity* (subsidiary dimension inside the org — NOT a
> separate org), *System-assigned number* (PMO-minted, per-org, gap-tolerant), *External reference
> number* (the outside-world id; optional, free-form), *Procurement record* (PR/RFQ/Quotation/PO/
> GR/VI/Payment — typed evidence, never the status authority).

## Overview

Onboarding a paying client is today a sequence of undocumented, error-prone manual steps performed
by the **Operator** against three surfaces (Supabase Cloud, Cloudflare Pages, 1Password) plus the
database. Item 6 of the GTM program turns that sequence into **three deliverables**, each ≈ one
issue-loop:

1. **Deliverable 1 — Provisioning runbook + script** (`scripts/provision-client.sh` + a readiness
   check modeled on `scripts/check-agent-prod-readiness.mjs`): create/link a per-client Supabase
   Cloud **Pro** project, apply migrations, deploy the edge functions, set secrets (names only;
   values from 1Password vault `AS` via the `op-get.sh` convention), create the **org** row + the
   **first Admin** user, wire the Cloudflare Pages env, and verify. Per ADR-0047 this script **is**
   the Operator's "add org" operation at the <~5-deployment scale — **no in-app UI is built.** The
   runbook's manual-vs-CLI split is explicit (the CLI cannot create a project, purchase Pro, or
   touch the Cloudflare dashboard). `docs/environments.md` gains a per-client registry row.

2. **Deliverable 2 — Import idempotency fix**: the deferred "bulk-import idempotency" defect from
   `docs/spikes/2026-07-04-full-codebase-review.md` (Reliability ledger: *"bulk procurement import
   — retry duplicates, no idempotency key"*). The real defect site is
   `pmo-portal/src/lib/import/procurementCycle/commit.ts` (`commitCase` → `createProcurement` +
   `createRecord`, no pre-existence check; confirmed: no unique constraint catches a re-run, so a
   corrected re-import silently duplicates every previously-succeeded row). The fix is **re-run-safe
   skip semantics driven by a stable per-row import key + an `import_batch_id`/`imported_at`
   provenance stamp**, plus a **dry-run conflict report** in the existing zero-write preview step.
   The same defect exists symmetrically on the generic `ImportDescriptor` path (ADR-0027); this spec
   fixes the flagged procurement site and declares the generic-path parity as a fast-follow.

3. **Deliverable 3 — Historical import script** (`scripts/import-historical.mjs`, Operator-run,
   service-role, summary-grade, ≤ 1 yr): loads **CLOSED projects** and **procurement cases at their
   terminal status** so a new client begins life with their recent history visible. Status is **set
   directly** on the row (the script does **not** call `transition_procurement` — see §"No fabricated
   history" decision); key dates are carried as **data columns** (business `date`, not system
   `created_at`, per ADR-0033); every imported row carries a **provenance marker**
   (`import_batch_id` + `imported_at`). **No fabricated `procurement_status_events`** — the
   append-only transition log stays honest.

**User value (the Operator, doing white-glove onboarding):** *As the Operator, I want a single
documented runbook + a small set of scripts that take a signed client from "empty Supabase account"
to "running tenant with their recent history imported, verified, and registered" — repeatably,
without silently duplicating data or fabricating a fake audit trail — so onboarding client #2 is as
low-risk as client #1 and I never have to hand-edit a cloud schema or remember a manual step.*

This is the whole of backlog GTM item 6. **Out of scope (v1):** the ERPNext provisioning leg
(ADR-0048 seam only — §Observations); an in-app Operator console (ADR-0047: not at <~5 deployments);
the Stripe/billing auto-onboard (manual MSA billing); the Entity (subsidiary) dimension itself (GTM
item 7, conditional — the scripts reserve the seam); any per-row "update-existing" semantics beyond
skip (insert-or-skip v1, mirroring ADR-0027 §"Insert-only v1"); and **re-opening the no-fabricated-
history decision** (the owner-locked decision below is normative).

---

## Binding decisions (owner-locked at grill 2026-07-04 — do not re-open)

- **Per-client isolation.** One Supabase Cloud **Pro** project per client org (ADR-0047); one
  Cloudflare Pages project (or branch/env) per client. The legacy `prod` cloud project is
  **STAGING/DEMO** — no paying client lives on it. Provisioning targets a **new** project.
- **Provisioning = "add org".** There is no in-app "create org" UI at this scale. The script creates
  the org row + the first Admin; subsequent users come via the **ops-admin invite path (MVP item 1a,
  dependency — see §Dependencies)** once it ships, and until then via a documented Supabase CLI
  `auth-admin invite` step inside this script.
- **White-glove, summary-grade, ≤ 1 yr.** The historical import carries the **recent** closed work
  (last ≤ 1 year) at **summary grade** (final numbers + terminal status + key dates), not a full
  forensic migration of every transition. (Owner: "we are not reconstructing history we never had.")
- **No fabricated history.** Historical cases get their terminal `status` set directly on the row.
  The script does **not** synthesize a sequence of `procurement_status_events` transitions it did not
  observe. The append-only transition log is either **empty** for an imported case, or — optionally,
  opt-in — carries **exactly one** honest provenance row ("imported at terminal status X"). The
  owner decision is that an empty transition log is acceptable; whether to stamp the one provenance
  row is the operator's call per client (§"Provenance event" FR-HIST-013/014).
- **org_id is explicit, never inferred.** Deliverable 3 runs as the **service role** (RLS is
  bypassed), so `org_id` is a **required, typed-confirmed argument** — it is never read from a
  session. The data loaded is RLS-correct for normal users the moment it lands (the `org_id` stamp is
  what the read policies key on).

---

## Context (what exists today — the seams this feature reuses)

### Provisioning precedents
- `scripts/db-push-prod.sh` — the **typed-confirm + op-get.sh-secret + explicit `--db-url`** pattern
  this script follows. `--check` is the read-only "is it usable?" mode; the push requires typing the
  literal string `prod`. `scripts/db-seed-prod.sh` is the same family with a `prod-seed` confirm.
- `scripts/check-agent-prod-readiness.mjs` — the **read-only readiness-check precedent**: probes
  (HTTP reachability expecting 401 without auth / 2xx with auth), **presence-only** secret checks
  (never a value), documented-not-automatable items (pg_cron GUCs), an opt-in `--live` dry-run, and
  **SKIPPED-not-FAILED** when an input is missing. `scripts/check-client-readiness.mjs` (specified
  here as part of Deliverable 1) is its sibling for a freshly-provisioned tenant.
- `docs/environments.md` — the **registry table** (project ref / API URL / anon key / frontend /
  migrations / seed). A per-client row is added at provisioning. The **secrets-via-1Password**
  pattern: `op-get.sh <item> <vault> <field>` loads the service-account token itself; only the
  **coordinates** (`supabase/op.<env>.env`) are committed; the script never reads the token file.
- `scripts/op-get.sh` — the sanctioned host tool (lives at `~/.local/bin/op-get.sh` or on `PATH`).
- The three edge functions in `supabase/functions/`: **`agent-chat`**, **`compose-view`**,
  **`agent-dispatch`** (the set enumerated by `check-agent-prod-readiness.mjs`'s `AGENT_FUNCTIONS`).
  They are deployed-but-flag-OFF for a new client until that client licenses the agent tier
  (`VITE_FEATURES_AGENT_ASSISTANT` default OFF). Migration 0048's per-minute `agent-dispatch` cron is
  registered-but-idle unless the dispatch GUCs are set.

### Import precedents
- `pmo-portal/src/lib/import/procurementCycle/{types,parse(? — sheet parse lives in the generic
  layer),group,validate,commit}.ts` — the **pure** `group`/`validate`/`types` layer and the
  **committing** `commit.ts` (the defect site). The commit layer calls the audited security-definer
  create RPCs (`create_purchase_request` / `create_rfq` / `create_quotation` / `create_purchase_order`
  / `create_receipt` / `create_procurement_invoice` / `create_payment`) and `createProcurement` for
  the case header; `org_id` is never client-supplied.
- `pmo-portal/src/lib/import/{types,parseWorkbook,autoMap,validateRows,companyDescriptor,…}.ts` +
  `src/components/import/{ImportButton,ImportWizard,useImportWizard}.ts(x)` — the **generic**
  ADR-0027 `ImportDescriptor<Input>` path (Companies/Contacts/Projects/Procurement-header). Same
  re-run-duplicates flaw; the specced fix targets the procurement site and names the generic path as
  parity fast-follow.
- The dry-run **preview** step already exists (ADR-0027/0035 FSM: `upload → map → preview → commit →
  result`) and **performs zero writes**; Deliverable 2 adds the conflict report *to* that step.
- `procurement_status_events` (migration 0038) — **append-only, RPC-only** (no INSERT policy; only
  `transition_procurement` writes it, using `auth.uid()` as the actor). `from_status` is **nullable**
  (NULL = "Created"). A service-role script bypasses RLS and *can* insert, but `transition_procurement`
  cannot be called honestly by a service-role script (no `auth.uid()`) and would fabricate a legal-map
  transition sequence the importer never observed — hence the direct-set + optional-one-provenance-row
  decision.
- The procurement-history union (`pmo-portal/src/lib/db/procurementHistory.ts`,
  `buildProcurementHistory` / `buildProgressionTimeline`) iterates `detail.statusEvents ?? []` and
  the per-record arrays; an **empty** `statusEvents` renders a **record-only** timeline without
  crashing. The seed (`supabase/seed.sql`, two `insert into procurements` statements at lines 747 and
  950) sets `procurements.status` **directly** on the large majority of seeded cases and seeds a full
  transition history via only **three** `insert into procurement_status_events` statements total
  (lines 1585, 1879, 1936) — so most seeded cases already carry an empty `statusEvents` log, and the
  app **already** renders empty-log cases. **This is the finding that settles the "does the UI require
  a non-empty log?" question: it does not.** (Note: the seeded procurement rows also stamp
  `total_value` directly alongside their directly-set `status` — including on 'Paid'/'Ordered' rows —
  which is the same pattern Deliverable 3's committed-spend fix below requires; see
  §"Committed-spend correctness".)

### Schema facts the spec leans on
- `procurements` has `unique (org_id, code)` — but `code` is the freshly-**minted system number**, so
  it is **not** a re-run dedupe key (each create mints a new one). `procurements` and `projects` case/
  project headers carry **no** external-reference column at all — only the system `code`; there is
  **no `external_ref` column anywhere in the schema** (confirmed by migration grep). The 7 procurement
  record tables (`purchase_requests`, `rfqs`, `procurement_quotations`, `purchase_orders`,
  `procurement_receipts`, `procurement_invoices`, `payments`) carry a real **`reference_number text`**
  column (migrations 0035:42/55/68/82, 0040, 0041); `procurement_quotations` additionally has a
  `reference` column (0001:128) predating 0035. See **OD-ONB-1** (`docs/decisions.md`) for the
  dual-purpose (`reference_number` for reconciliation, `import_key` for idempotency) decision.
- No unique constraint exists on `reference_number` on any record table (confirmed by migration grep)
  → a re-run duplicates silently today.
- **Committed-spend correctness (OD-BUDGET-2, binding on Deliverable 3).**
  `COMMITTED_STATUSES = ['Ordered','Received','Vendor Invoiced','Paid']`
  (`pmo-portal/src/lib/db/procurements.ts:28-32`); committed spend = `Σ procurements.total_value WHERE
  status IN COMMITTED_STATUSES` (`procurements.ts:36-44`). `procurements.total_value` is written by
  **exactly one** existing path — `select_procurement_quote` (migration 0015:78-83) — and defaults to
  `0` (migration 0001:101); **no trigger** derives it from child records. Deliverable 3 sets `status`
  directly and bypasses quote-selection entirely, so **the historical-import script must itself stamp
  `procurements.total_value`** on every imported case, or an imported terminal case in a committed
  status would silently contribute `0` to every committed-spend figure. (Confirming precedent: the seed
  data's directly-status-set procurement rows already stamp `total_value` alongside `status` in the
  same INSERT — the same pattern this fix requires, not a new one.)
- Every record table carries a user-set business **`date`** distinct from immutable `created_at`
  (ADR-0033) → historical key dates land as **data**, not as fabricated `created_at`.

---

## Deliverable 1 — Provisioning runbook + script

### Manual vs CLI split (binding — the CLI cannot do the manual steps)

**Manual, in the Supabase dashboard (operator, once per client):**
1. **Create the project** (`supabase projects create` can do this from the CLI in principle, but plan
   selection + region + the **Pro** purchase + IPv4 add-on are dashboard-verified) — note the
   **project ref**.
2. Confirm the plan is **Pro** (managed daily backups, 7-day retention; ADR-0047 / MVP item 5).
3. Create the **Direct (port 5432) or Session-pooler** connection URI in **Settings → Database**
   (**not** the 6543 transaction pooler — it breaks DDL; see `docs/environments.md`).
4. In **1Password vault `AS`**, create item `pmo-supabase-<client-slug>` with a field `URL` = that
   URI (matches the `op-get.sh` convention). Commit only the coordinates
   `supabase/op.<client-slug>.env`.

**Manual, in the Cloudflare dashboard (operator, once per client):**
5. Create (or branch/env) the **Cloudflare Pages** project pointing at this client's backend; set the
   Production env vars per `docs/environments.md` (§ below). **Preview deploys stay OFF** (free-quota
   conservation). (A future CF API token in vault `AS` could automate this; out of scope v1.)

**CLI — what `scripts/provision-client.sh <client-slug>` does (after the typed confirm):**
6. `supabase link --project-ref <ref>` (repo↔cloud pointer; no DB touched).
7. `supabase db push --db-url <resolved-from-1Password>` — applies the full migration set.
8. `supabase functions deploy agent-chat compose-view agent-dispatch` — the edge tier (deployed,
   flag-OFF by default).
9. `supabase secrets set <NAMES>` — sets **names**; **values come from the operator's shell** (loaded
   via `op-get.sh` from vault `AS`). The script **never** reads a secret from a file and **never**
   echoes a value (presence-only, per the readiness-script precedent).
10. **Create the org row + first Admin** (service-role INSERT — §FR-PROV-006/007).
11. Print the manual-only remaining steps (CF env vars, dashboard backup-confirm) + run the readiness
    check.
12. Append a **registry row** to `docs/environments.md` (or emit it for the operator to paste; refs/
    URL/anon key are public-safe).

### Functional requirements (EARS)

- **FR-PROV-001 (typed confirm).** When the Operator runs `scripts/provision-client.sh <slug>` without
  `--check`, the script shall require the Operator to type the literal slug back before performing any
  state-changing step, and shall abort on mismatch (mirrors `db-push-prod.sh`'s `prod` confirm).
- **FR-PROV-002 (`--check` is read-only).** Where the Operator passes `--check`, the script shall
  resolve the secret via `op-get.sh`, confirm DB reachability, confirm the project is linked, and
  report readiness — performing **zero** state-changing steps.
- **FR-PROV-003 (secret via op-get, never a file value).** The script shall obtain the DB URL through
  `op-get.sh "<item>" "AS" "<field>"` using coordinates from `supabase/op.<slug>.env`, shall fall back
  to a gitignored `supabase/.env.<slug>` only when `op-get.sh` is absent, and shall never print a
  secret value (presence-only).
- **FR-PROV-004 (CLI steps).** When the typed confirm succeeds, the script shall run, in order:
  `supabase link --project-ref`, `supabase db push --db-url`, `supabase functions deploy` for the
  three edge functions, and `supabase secrets set` for the required secret **names**; and shall stop
  on the first failing step with a diagnosable message.
- **FR-PROV-005 (seed NEVER).** The script shall never run `seed.sql` or `db-seed-prod.sh` against a
  real client project (a real tenant is never demo-seeded — `docs/environments.md`).
- **FR-PROV-006 (create the org).** When the DB is reachable, the script shall create exactly one row
  in `organizations` for the client group, with an operator-supplied `name` + `slug`, and shall
  refuse to proceed if a row with that slug already exists (idempotent re-run reports "already
  provisioned" and exits without duplicating).
- **FR-PROV-007 (create the first Admin).** When the org row exists, the script shall create the first
  Admin via the **ops-admin invite path when it has shipped (MVP item 1a — dependency)**; until then,
  via a documented `supabase auth-admin invite` step that creates the `auth.users` row + a `profiles`
  row (`role = Admin`, `org_id = <new org>`, `status = active`) linked to it, and shall print the
  dependency note that the invite **email** requires SMTP (Resend, MVP item 2 — dependency).
- **FR-PROV-008 (CF env wiring = documented manual).** The script shall print the **exact**
  Cloudflare Pages Production env vars to set (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_APP_ENV=prod`, and conditionally `VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`; **never**
  `VITE_DEMO_MODE` for a real tenant) and shall mark the CF step manual (no CF API token is wired v1).
- **FR-PROV-009 (registry row).** When provisioning completes, the script shall emit (and, where the
  repo is writable, append) a `docs/environments.md` registry row carrying the **public-safe**
  project ref / API URL / anon key / frontend URL / "migrations: current" / "seed: none", and shall
  not emit any secret.
- **FR-PROV-010 (verification).** When provisioning completes, the script shall run the readiness
  check (FR-PROV-011) and fail loudly if any **automatable** check fails.
- **FR-PROV-011 (readiness check, read-only).** The readiness check shall, modeled on
  `check-agent-prod-readiness.mjs`: (a) probe each edge function expecting **401 without auth**;
  (b) confirm the migration count equals the repo's current migration count; (c) report
  **presence-only** (never the value) of `OPENROUTER_API_KEY` in the invoking shell and remind to
  confirm deployed secrets via `supabase secrets list`; (d) document the `SHOW app.settings.*` GUC
  commands to run manually; (e) confirm the org row + first Admin exist and the Admin's `org_id`
  matches; (f) confirm an anon read of a business table returns empty/denied (RLS sanity); and shall
  report **SKIPPED**, not FAILED, when an optional input is unset.
- **FR-PROV-012 (ERPNext seam, not built).** The script shall expose a no-op, documented hook
  `# ERPNext provisioning leg — ADR-0048, out of scope v1` and shall not perform any ERPNext step.

### Non-functional requirements

- **NFR-ONB-001 (safety).** The script is **Operator-run**, not CI. It must never run without an
  explicit `<slug>` arg + typed confirm; `--check` is the only zero-side-effect mode. No secret value
  is ever logged or echoed.
- **NFR-ONB-002 (idempotency).** A re-run against an already-provisioned client (same slug) shall be
  a **no-op-on-existing**: org not duplicated, migrations re-applied harmlessly (they are
  `create or replace` / additive), functions redeployed, secrets re-set — and the readiness check
  re-run.
- **NFR-ONB-003 (reversibility).** Provisioning creates a project + a CF env + an org row + one
  Admin; de-provisioning (offboarding) is the documented reverse (archive the org via ADR-0018
  `archived_at`, rotate/destroy the 1Password item, suspend the Admin) and is **out of scope v1** but
  the runbook names it.

---

## Deliverable 2 — Import idempotency fix (the deferred defect)

### The defect (encoded)

`docs/spikes/2026-07-04-full-codebase-review.md` Reliability ledger, deferred item: *"bulk
procurement import — retry duplicates, no idempotency key."* Real defect site:
`pmo-portal/src/lib/import/procurementCycle/commit.ts` — `commitCase` unconditionally calls
`createProcurement` then `createRecord` for every valid group/row. There is **no pre-existence
check**, **no dedupe key**, and **no unique constraint** catches a duplicate (confirmed: only
`procurements.unique(org_id, code)` exists, where `code` is freshly minted). A corrected re-import
(or a retry after a partial failure / network blip) therefore **silently duplicates** every
previously-succeeded case and record. The generic `ImportDescriptor` path (ADR-0027) has the same
flaw; this fix targets the flagged procurement site and declares the generic path a parity
fast-follow (§Out of Scope).

### Fix (spec'd, not implemented)

Three coordinated changes:

1. **Provenance columns (new migration, additive + nullable).** Add nullable `import_batch_id uuid`
   and `imported_at timestamptz` to `procurements` and to each of the 7 procurement record tables —
   `purchase_requests`, `rfqs`, `procurement_quotations`, `purchase_orders`, `procurement_receipts`
   (GR), `procurement_invoices` (VI), `payments`. NULL for non-imported rows (fully
   backward-compatible). These same columns carry Deliverable 3's provenance marker — **one column
   set serves both deliverables** (and the historical script's re-run-safety).
2. **Re-run-safe skip on a stable per-row key.** The commit layer gains an optional, stable
   **`import_key text`** (new nullable column on `procurements` + record tables) stamped by the
   importer from a stable source: the sheet's `case_ref` for the case header; the record's
   `reference_number` for records (falling back to a deterministic content fingerprint when
   `reference_number` is absent). Before each insert, the commit layer queries for an existing row
   matching `(org_id, import_key)` (case) / `(procurement_id, import_key)` (record) **within the same
   `import_batch_id`**; a match is **skipped** and reported, not duplicated. NULL `import_key` = legacy
   create-only behavior (opt-in, never silently changes existing flows). The skip query is
   **pgTAP-proven** to return the existing row and to return nothing for a genuinely-new key.
   **Case-skip and per-record skip are independent decisions**, evaluated separately per row — see the
   partial-failure semantics below.
3. **Dry-run conflict report in the preview step.** The existing zero-write preview (ADR-0027/0035
   FSM) gains a conflict breakdown: **"would create N · would skip M (already imported in batch <id>)
   · would collide K (same import_key, different batch — re-run will skip unless you mean to merge)"**.
   The commit FSM surfaces a `--batch-id` (or auto-generates + displays one) so a literal retry of the
   same file is detected as the same batch.

### Partial-failure retry semantics (child-record idempotency — closes I4)

`commit.ts`'s existing model is **best-effort per-record within a case** (`commitCase`,
`commit.ts:153-213`): the case header is created (or fails) once, then each child record is attempted
independently in a loop — one record's failure does not abort the remaining records in that case. The
idempotency fix must preserve and extend this, not collapse it into a single case-level gate:

- **The case-header check and each record's check are separate `(key, scope)` lookups, never a single
  group-level short-circuit.** A case-header skip (existing case found for `(org_id, import_key,
  import_batch_id)`) means "do not re-create the header" — it does **not** mean "do not process this
  case's child rows." The commit loop still walks every child row of a skipped case and evaluates each
  one's own `(procurement_id, import_key)` independently (resolving `procurement_id` from the
  pre-existing case row when the header itself was skipped).
- **Crash-mid-batch → re-run behavior (exact semantics).** If a run is interrupted after creating the
  case header and 2 of 5 child records, a re-run with the same `import_batch_id` shall: skip the header
  (already exists for this batch), skip the 2 already-created records (their own `(procurement_id,
  import_key)` already exists in this batch), and create the remaining 3 — regardless of whether the
  header itself was newly created or skipped on this re-run. The commit result reports the case as
  `partial: 2 skipped, 3 created` (or equivalent), never as a single pass/fail verdict for the whole
  case.
- This closes FR-IDEM-005's "create only the previously-failed" promise: without this clause, an
  implementer skipping the whole case group on a header hit would silently strand previously-failed
  children forever on every re-run.

### Functional requirements (EARS)

- **FR-IDEM-001 (provenance stamp).** When the importer creates a case or record, the system shall
  stamp `import_batch_id` (a single UUID per import run) and `imported_at = now()` on the created row,
  and shall leave both NULL on rows created outside any import (forms, RPCs, the Assistant).
- **FR-IDEM-002 (stable import key).** When the importer commits a group, the system shall compute a
  stable `import_key` per case (from `case_ref`, else a fingerprint of title+project) and per record
  (from `reference_number`, else a fingerprint of type+date+amount+vendor) and shall stamp it on the
  row; rows created outside any import shall have NULL `import_key`.
- **FR-IDEM-003 (skip-if-exists within batch, case AND record, independently).** Where a **case**
  header already exists with the same `(org_id, import_key)` **and the same `import_batch_id`**, the
  importer shall **skip** the header insert and record it as `skipped`; independently, for **each
  child record** of that case, where a record already exists with the same
  `(procurement_id, import_key)` **and the same `import_batch_id`**, the importer shall **skip** that
  record's insert and record it as `skipped` (not `created`, not `failed`) in the commit result. A
  case-header skip does **not** skip its child rows — every child row is still evaluated against its
  own key (§"Partial-failure retry semantics" above).
- **FR-IDEM-004 (re-run = no duplicates).** When the Operator re-runs the exact same file with the
  same `import_batch_id`, the system shall create **zero** new rows and shall report every case and
  every record as `skipped: already imported (batch <id>)`.
- **FR-IDEM-005 (partial-failure retry = create-only-missing, per row not per group).** When the
  Operator re-runs a corrected file with the same `import_batch_id` after a mid-batch crash or partial
  failure, the system shall — independently for the case header and for **each** child record — skip
  the rows that already exist for `(org_id/procurement_id, import_key, import_batch_id)` and create
  only the rows that do not yet exist, leaving the previously-succeeded set untouched. This holds even
  when the case header itself was among the previously-succeeded rows (a skipped header does not
  prevent its still-missing children from being created on re-run).
- **FR-IDEM-006 (cross-batch collision = skip, not duplicate).** Where a row exists with the same
  `(org_id, import_key)` but a **different** `import_batch_id`, the importer shall skip the insert
  (report `skipped: import_key already present from batch <other-id>`) rather than duplicate, so a
  fresh import of overlapping data does not create dupes.
- **FR-IDEM-007 (dry-run conflict report, zero writes).** The preview step shall, without performing
  any write, report per group the `would-create / would-skip / would-collide` counts derived from a
  read-only existence query against `import_key`.
- **FR-IDEM-008 (no authority change).** The fix shall introduce **no new write authority**: every
  create still goes through the existing audited security-definer RPCs / `createProcurement`; the only
  new surface is read-only existence queries + additive nullable columns. (RLS remains the sole
  enforcement authority; `org_id` is still never client-supplied — ADR-0017.)

### Non-functional requirements

- **NFR-ONB-004 (backward compatibility).** The migration is **additive + nullable**; existing rows,
  forms, RPCs, and tests are unchanged. No existing test regresses (the full `verify` gate, not a
  targeted run — AGENTS.md "Pre-push full verify").
- **NFR-ONB-005 (parity fast-follow).** The generic `ImportDescriptor` path (ADR-0027) shall be noted
  as carrying the same flaw; its fix reuses this pattern and is a fast-follow, not built here.

---

## Deliverable 3 — Historical import script (Operator-run, summary-grade, ≤ 1 yr)

### Shape

`scripts/import-historical.mjs` — an **Operator-run, service-role** Node script that loads two CSV
templates into a freshly-provisioned client org:

1. **`projects.csv`** — CLOSED projects (terminal project statuses only) with final numbers + key
   dates. Status set **directly** on INSERT; `import_batch_id` + `imported_at` stamped.
2. **`procurement_cases.csv`** — procurement cases **at their terminal status** with their constituent
   records, in the **long, `type`-column shape of the ADR-0035 importer** (one row per record; case
   attributes on the group). The script **reuses the procurementCycle pure layer**
   (`group`/`validate`/`types`) for parse + group + validate, then **diverges at commit**: a
   service-role direct INSERT (status-set-directly, provenance-stamped) instead of the audited RPCs.
   This gives one validated parse/validate layer and two commit strategies (FE-wizard → RPC for live
   entry; this script → service-role-direct for historical migration).

### "No fabricated history" decision (binding — do not re-open)

- The script sets `procurements.status` (and each record's terminal `status`) **directly** via
  service-role INSERT. It does **not** call `transition_procurement` (which would (a) require a legal
  from→to path the importer never observed, (b) use `auth.uid()` that a service role has no honest
  value for, and (c) fabricate a transition sequence).
- The `procurement_status_events` append-only log is **empty** for an imported case by default.
- **Finding (settles the conditional):** the UI **does not** require a non-empty log
  (`buildProcurementHistory` renders `statusEvents ?? []` gracefully; the seed sets the large majority
  of its procurement rows' `status` directly and seeds transition history via only three
  `procurement_status_events` inserts total). Therefore **no synthetic event is required for the UI to
  render.**
- **Optional provenance row (operator opt-in).** The script MAY, behind `--mark-provenance`, insert
  **exactly one** row per imported case into `procurement_status_events`:
  `from_status = NULL`, `to_status = <the terminal status>`, `actor_id = <the first Admin (a real
  user) or NULL>`, `notes = 'Historical import: terminal status <X> (batch <id>, <YYYY-MM-DD>)'`. This
  is **honest provenance** (it records the true fact that the status arrived via import, not a
  fabricated from→to transition) and uses the column's nullable `from_status`. It is **off by
  default**; the baseline import writes no event.

### CSV column contracts (the input templates the spec defines)

**`projects.csv`** (one row per closed project):

| Column | Required | Notes |
|---|---|---|
| `code` | yes | Stable per-org project code (the system id; PMO does not renumber). Used as `import_key`. |
| `title` | yes | |
| `client_company` | no | Resolved to a `companies` row (created if absent, type=Client); blank = no client. |
| `entity` | no | Entity (subsidiary) name — **seam only** (GTM item 7); ignored/stored if the Entity dimension exists, else warned-and-ignored. |
| `status` | yes | Must be a **terminal/closed** project status (the closed set); the script rejects a non-terminal value. Set directly. |
| `contract_value` | yes | Final signed value. |
| `start_date` / `end_date` | end required | Business dates (ADR-0033); `end_date` = handover/close. |
| `project_manager_email` | no | Resolved to a `profiles` row; blank = unassigned. |
| `budget_total` | no | Final budget (one active `budget_versions` row + one line item if provided). |
| `external_ref` | no | Legacy/ERP project number (free-form; the future ERPNext adapter seam). **Note:** `projects` has no dedicated external-reference column in the schema today; the script stores this value only if such a column exists (see OBS-ONB-002), else warns-and-ignores it — it is never dropped silently. |

**`procurement_cases.csv`** (long shape, `type` column — mirrors ADR-0035):

| Column | Required | Notes |
|---|---|---|
| `case_ref` | yes | **Stable grouping key within the file** (NOT persisted as a number; the case's `import_key` is derived from it). |
| `type` | yes | `PR`/`RFQ`/`Quotation`/`PO`/`GR`/`VI`/`Payment` (ADR-0035). |
| `title` / `project_code` | title-or-project | Case attributes; first non-empty row in the group wins. `project_code` resolves to a `projects` row (the one just imported, or an existing one). |
| `terminal_status` | yes (case row) | A **terminal** `procurement_status`; set directly on the case. |
| `total_value` | **required when `terminal_status` ∈ `COMMITTED_STATUSES`** | **Case-level committed value.** First non-empty value in the group wins (case attribute, like `title`). Stamped directly onto `procurements.total_value` — this is the **only** write path for that column when the script bypasses `select_procurement_quote` (OD-BUDGET-2; see FR-HIST-004). Mandatory whenever `terminal_status` is one of `COMMITTED_STATUSES` (`Ordered`/`Received`/`Vendor Invoiced`/`Paid`); the script **rejects** a committed-status case row with a blank `total_value` (per-row error, not inserted) rather than silently importing it as `0`. Optional (may be blank) for non-committed terminal statuses. |
| `reference_number` | no | Legacy/vendor record number (per-record; e.g. supplier delivery-note or invoice number — see migrations 0035/0040/0041). Stamped into the record's `reference_number` column, and used as the record's `import_key` when present (falling back to a content fingerprint per FR-IDEM-002) — dual purpose per **OD-ONB-1** (`docs/decisions.md`). |
| `status` | per type | The record's terminal status (e.g. VI `Paid`, Payment `Paid`). Set directly. |
| `date` | yes | Business date (ADR-0033). |
| `amount` | per type | Final amount (per-record; this is the existing per-record `amount`, distinct from the case-level `total_value` above). |
| `vendor` | Quotation/VI | Resolved to a `companies` row (type=Vendor; created if absent). |

### Functional requirements (EARS)

- **FR-HIST-001 (service role + explicit org_id).** The script shall run as the service role and
  shall require an explicit `--org-id <uuid>` plus a typed confirm of the **org name** (resolved from
  `organizations`) before any write; it shall refuse to run with an inferred or absent `org_id`.
- **FR-HIST-002 (RLS-correct result).** Every row the script inserts shall carry the explicit
  `org_id`, so that — for normal users — the imported data is readable only inside that org (the read
  policies key on `org_id`); the script's service-role bypass is the **load mechanism only**.
- **FR-HIST-003 (terminal-only).** The script shall reject any `projects.csv` row whose `status` is
  not in the closed set, and any `procurement_cases.csv` row whose `terminal_status` is not a terminal
  `procurement_status`, with a per-row error and shall not insert it.
- **FR-HIST-004 (status set directly, committed spend correct on landing).** The script shall set
  `procurements.status` and each record's `status` directly on INSERT and shall **not** call
  `transition_procurement`. Because this bypasses `select_procurement_quote` — the sole existing writer
  of `procurements.total_value` (migration 0015:78-83) — the script shall **also** stamp
  `procurements.total_value` directly from the CSV's case-level `total_value` column on every case row
  it inserts, and shall **reject** (not insert, per-row error) any case row whose `terminal_status` is
  in `COMMITTED_STATUSES` (`Ordered`/`Received`/`Vendor Invoiced`/`Paid` —
  `pmo-portal/src/lib/db/procurements.ts:28-32`) and whose `total_value` is blank. This ensures an
  imported terminal case in a committed status contributes its real value to committed-spend
  (OD-BUDGET-2) from the moment it lands, never a silent `0`.
- **FR-HIST-005 (no fabricated transitions).** The script shall insert **zero** rows into
  `procurement_status_events` unless `--mark-provenance` is passed (FR-HIST-013).
- **FR-HIST-006 (provenance stamp).** Every imported row shall carry `import_batch_id` (one UUID per
  run, printed at start) and `imported_at = now()`.
- **FR-HIST-007 (key dates as data).** Every imported date shall land in the entity's business
  `date`/`start_date`/`end_date` column, never as a backdated `created_at` (`created_at` is the real
  import moment — ADR-0033).
- **FR-HIST-008 (reuse pure layer).** The script shall reuse `procurementCycle`'s `group`/`validate`
  pure layer for parse + group + validate, and shall diverge only at commit (service-role direct
  INSERT).
- **FR-HIST-009 (summary grade).** The script shall accept exactly the columns in the CSV contracts
  above and shall not require line-item detail beyond what those columns carry (summary grade).
- **FR-HIST-010 (≤ 1 yr advisory).** The script shall **warn** (not block) when a row's `date` is more
  than 1 year before the run date, so the summary-grade scope is surfaced without hard-enforcing it.
- **FR-HIST-011 (re-run-safe).** The script shall be re-run-safe via the same `import_key` +
  `import_batch_id` mechanism as Deliverable 2: re-running the same file with the same `--batch-id`
  creates zero new rows; re-running with a different batch skips on `(org_id, import_key)` collisions.
- **FR-HIST-012 (reference resolution).** The script shall resolve `client_company`/`vendor`/
  `project_code`/`project_manager_email` to existing rows, **creating** a `companies`/`profiles`
  stub where one is missing (so a historical case is never orphaned), and shall report each
  resolution (found / created) in the summary.
- **FR-HIST-013 (optional provenance event, org_id explicit).** Where `--mark-provenance` is passed,
  the script shall insert **exactly one** `procurement_status_events` row per imported case with
  **`org_id = <the explicit --org-id argument>`** (never the column's own default, which is the
  seed/demo org UUID — `procurement_status_events.org_id not null default
  '00000000-0000-0000-0000-000000000001'`, migration 0038; the read policy is `org_id = auth_org_id()`,
  so an omitted `org_id` would silently orphan the row into the demo org, invisible to the client's real
  users), `from_status = NULL`, `to_status = <terminal>`, and a `notes` value identifying it as a
  historical import (batch + date); it shall insert **no** from→to transition rows.
- **FR-HIST-014 (summary report).** At completion the script shall print a summary: cases created /
  skipped / failed; records created / skipped / failed by type; projects created / skipped / failed;
  references resolved / created; and the `import_batch_id` for traceability.
- **FR-HIST-015 (ERPNext seam, not built).** The script shall carry the record-level legacy number
  (the CSV's `reference_number` column) into each record's real, persisted `reference_number` column
  (migrations 0035/0040/0041) so a future ERPNext adapter (ADR-0048) can reconcile against it, and
  shall not perform any ERPNext sync. See **OD-ONB-1** (`docs/decisions.md`) for the rationale: this is
  the same column FR-IDEM-002 also reads as the `import_key` fallback source — one column, two uses,
  never a fabricated `external_ref` column.

### Non-functional requirements

- **NFR-ONB-006 (operator-only).** The script is Operator-run, never FE code, never CI. It has no UI.
  It is RLS-bypassing by construction (service role) and is therefore gated by `--org-id` + typed
  org-name confirm + `--batch-id`.
- **NFR-ONB-007 (no secret logging).** The service-role key comes from the operator's shell (via
  `op-get.sh` from vault `AS`, per `docs/environments.md`); the script never reads a file for it and
  never echoes it.
- **NFR-ONB-008 (no schema fabrication).** The script performs **no** DDL; it relies on the migration
  from Deliverable 2 for `import_batch_id`/`imported_at`/`import_key`. (Order: D2 migration ships
  before D3 can run.)

---

## Error handling

| Code / condition | Detection | Response | Owner layer |
|---|---|---|---|
| `PROV-E001` op-get.sh fails to resolve the secret | `op-get.sh` non-zero | Abort with the exact "create the 1Password item" hint (mirrors `db-push-prod.sh`) | script (manual) |
| `PROV-E002` org slug already exists | pre-INSERT lookup | Report "already provisioned"; run `--check`; exit 0 without duplicating (NFR-ONB-002) | Unit (helper) + manual verify |
| `PROV-E003` edge function not deployed (404 probe) | readiness probe | Report "not deployed" with the exact `functions deploy` command | readiness script |
| `PROV-E004` secret unset in shell | presence-only classify | Report `NOT SET (this shell)`; SKIPPED-not-FAILED if optional | Unit (`classifyEnvSecrets` pattern) |
| `IDEM-E001` re-run without `--batch-id` | missing arg | Auto-generate + **display** the batch id; warn that a fresh batch will skip on `import_key` collisions | Unit |
| `IDEM-E002` `import_key` collision, different batch | pre-INSERT lookup | Skip + report the other batch id (FR-IDEM-006); never duplicate | pgTAP (skip query) |
| `HIST-E001` non-terminal `status`/`terminal_status` | validate against the terminal set | Per-row error; row excluded; counted in summary | Unit (validate) |
| `HIST-E002` `--org-id` missing or name mismatch | arg + typed-confirm gate | Refuse to run; print the resolved org name for the typed confirm | Unit |
| `HIST-E003` unresolved reference (`project_code` etc.) | resolution pass | Create a stub (FR-HIST-012) OR fail the row per a `--strict-refs` flag (default: create stub) | Unit |
| `HIST-E004` `--mark-provenance` on a case with no terminal status | guard | Skip the event insert for that case; warn | Unit |

---

## Test strategy (ADR-0010 — owning layer per requirement; the pipeline is a documented dry-run, not CI)

**The pipeline runs (provisioning against a real new project; historical load against a real DB with
a service role) cannot run in CI** — they need a live Supabase project + 1Password + a service-role
key, none of which exist in the CI/container env (per `docs/environments.md` and the
`check-agent-prod-readiness.mjs` philosophy). They are verified by a **documented manual dry-run**,
not a CI gate. The **deterministic, CI-owned** coverage is the **pure helpers** under them.

| AC id | Statement (Given/When/Then) | Owning layer |
|---|---|---|
| AC-PROV-001 | Given a `supabase/op.<slug>.env`, when `provision-client.sh --check` runs, then it resolves the secret via `op-get.sh`, confirms reachability, and performs zero state-changing steps. | documented manual (script run) |
| AC-PROV-002 | Given the script is invoked without `--check`, when the Operator types a slug ≠ `<slug>`, then it aborts before any state-changing step. | Unit (confirm-prompt helper) |
| AC-PROV-003 | Given an already-provisioned slug, when the script re-runs, then it reports "already provisioned", does not duplicate the org or Admin, and re-runs the readiness check. | documented manual |
| AC-PROV-004 | Given the readiness check, when an edge function returns 404, then it reports "not deployed" with the exact deploy command (SKIPPED/FAIL, not a crash). | Unit (`classifyProbeResult` sibling) |
| AC-PROV-005 | Given the readiness check, when `OPENROUTER_API_KEY` is unset in the shell, then it reports `NOT SET (this shell)` and does not echo any value. | Unit (`classifyEnvSecrets` pattern) |
| AC-PROV-006 | Given provisioning completes, when the registry row is emitted, then it contains only public-safe fields (ref/URL/anon key/frontend/migrations/seed=none) and no secret. | Unit (row-builder) |
| AC-PROV-007 | Given the org + Admin step, when it runs, then exactly one `organizations` row and one `profiles` row (`role=Admin`, `org_id=<org>`, `status=active`) exist and are linked. | documented manual |
| AC-IDEM-001 | Given a procurement case row, when the importer creates it, then `import_batch_id` and `imported_at` are stamped and non-NULL. | pgTAP (column defaults/stamp) |
| AC-IDEM-002 | Given two groups with the same `case_ref`, when committed in the same batch, then exactly one case is created and the second is `skipped`. | Unit (commit orchestration, mocked repo) |
| AC-IDEM-003 | Given a previously-succeeded batch, when the same file is re-run with the same `--batch-id`, then zero new rows are created and all groups report `skipped: already imported`. | documented manual (live re-run) + Unit (skip-decision helper) |
| AC-IDEM-004 | Given a corrected file re-run with the same `--batch-id`, when it commits, then only the previously-failed rows are created; succeeded rows are untouched. | documented manual |
| AC-IDEM-004a | Given a case whose header succeeded but 2 of 5 child records failed (mid-batch crash), when the same file is re-run with the same `--batch-id`, then the header is skipped, the 2 already-created records are skipped, and the remaining 3 records are created — the case-header skip does not prevent its still-missing children from being created (closes I4). | Unit (commit orchestration, mocked repo, per-record independent skip) + documented manual |
| AC-IDEM-005 | Given the preview step, when it runs against a sheet whose keys already exist, then it reports `would-create / would-skip / would-collide` counts and performs zero writes. | Unit (`buildDryRunConflictReport`) |
| AC-IDEM-006 | Given the skip-query, when a row exists with `(org_id, import_key, batch)`, then the query returns it; when none exists, it returns nothing. | pgTAP (skip-query proof) |
| AC-IDEM-007 | Given the migration, when it applies on a populated DB, then existing rows have NULL `import_batch_id`/`imported_at`/`import_key` and no existing test regresses. | full `verify` gate (regression) |
| AC-HIST-001 | Given `import-historical.mjs` without `--org-id`, when it runs, then it refuses and exits non-zero before any write. | Unit (arg/confirm gate) |
| AC-HIST-002 | Given a `projects.csv` row with a non-terminal `status`, when the script validates, then the row is rejected with a per-row error and is not inserted. | Unit (status-set validate) |
| AC-HIST-003 | Given a valid closed-project row, when the script loads it, then `projects.status` is the terminal value, `start_date`/`end_date` are the business dates, `created_at` is the import moment, and `import_batch_id`/`imported_at` are stamped. | documented manual (load + inspect) |
| AC-HIST-004 | Given a procurement case loaded at terminal status, when the script runs (no `--mark-provenance`), then `procurements.status` is the terminal value and `procurement_status_events` has **zero** rows for that case. | documented manual + pgTAP (post-load count) |
| AC-HIST-004a | Given a `procurement_cases.csv` case row with `terminal_status = 'Paid'` and a non-blank `total_value`, when the script loads it, then `procurements.total_value` equals the CSV value and the case appears in that project's committed-spend sum (`Σ total_value WHERE status IN COMMITTED_STATUSES`, OD-BUDGET-2, `pmo-portal/src/lib/db/procurements.ts:28-44`) — proving committed spend is correct from day one, not silently `0` (closes C1). | documented manual (load + query `getProjectCommittedSpend`/equivalent) + Unit (case-row builder stamps `total_value`) |
| AC-HIST-005 | Given `--mark-provenance`, when the script loads a case, then exactly **one** `procurement_status_events` row exists with `from_status = NULL`, `to_status = <terminal>`, and a `notes` value naming the import; and no from→to transition rows exist. | documented manual + Unit (event-builder) |
| AC-HIST-006 | Given the historical file re-run with the same `--batch-id`, when it commits, then zero new rows are created (FR-HIST-011). | documented manual |
| AC-HIST-007 | Given a `client_company`/`vendor` name not in `companies`, when the script resolves it, then a stub `companies` row is created and reported (FR-HIST-012). | Unit (resolver) + documented manual |
| AC-HIST-008 | Given the summary report, when the script completes, then it prints created/skipped/failed counts by entity + the `import_batch_id`. | Unit (summary builder) |
| AC-HIST-009 | Given a row whose `date` is > 1 year old, when the script runs, then it warns (does not block) per FR-HIST-010. | Unit |
| AC-HIST-010 | Given the historical import has landed into org A, when the post-load verification queries run, then, for **every** imported table (`projects`, `procurements`, `purchase_requests`, `rfqs`, `procurement_quotations`, `purchase_orders`, `procurement_receipts`, `procurement_invoices`, `payments`, `budget_versions` — plus `procurement_status_events` when `--mark-provenance` was used), `SELECT count(*) FILTER (WHERE org_id <> '<org-A-id>')` over the batch's `import_batch_id` returns **zero**; an anonymous (unauthenticated) read of each table returns nothing; an authenticated read as an **org-A** Admin returns the imported rows; and an authenticated read as an Admin of a **second, different** org (org B) returns **zero** rows from every one of those tables — proving cross-org isolation, not just anon+same-org scoping (closes I5). | documented manual (live per-table query, two authenticated sessions) |

**Manual dry-run procedure (the pipeline verification — documented, not CI):**
provision a **scratch** client project (Deliverable 1) → run `import-historical.mjs` against it with a
fixture CSV → assert the post-load state by direct query (counts; `status` values; empty
`procurement_status_events` by default; provenance stamps) → run the **per-table cross-org verification**
(AC-HIST-010): for every imported table, a `count(*) FILTER (WHERE org_id <> <target-org-id>)` query
returns zero; an anon read returns nothing; an in-org Admin read returns the imported rows; **and** a
second, different-org authenticated Admin read returns zero rows — → re-run with the same `--batch-id`
→ assert zero new rows (including per-child-record, per AC-IDEM-004a) → re-run with `--mark-provenance`
→ assert exactly one provenance event per case, each carrying the explicit target `org_id` (AC per
FR-HIST-013). This is the
`check-agent-prod-readiness.mjs`-grade verification: **ops-run against a real target, read-only
assertions, never a secret in CI.**

---

## Dependencies (binding — name them, don't hide them)

- **MVP item 1a (ops-admin: user invite/disable edge fn + `profiles.status` + email rails)** — the
  **audited first-Admin invite path** (FR-PROV-007 v2). Until it ships, provisioning uses a documented
  `supabase auth-admin invite` step (v1). The script prints this dependency.
- **MVP item 2 (auth floor: Resend SMTP + password-reset + email-confirm + invite emails + redirect
  allowlist)** — the invite **email** does not arrive without SMTP. Provisioning can create the
  `auth.users` + `profiles` rows without it, but the user cannot sign in until the auth floor ships.
- **MVP item 5 (backup/DR cloud)** — provisioning verifies the project is **Pro** (managed daily
  backups) and names the one-restore-drill + incident-runbook items as co-dependent.
- **Deliverable 2's migration must ship before Deliverable 3 can run** (the historical script depends
  on `import_batch_id`/`imported_at`/`import_key`). Build order: D2 → D3; D1 is independent.
- **`op-get.sh` + 1Password vault `AS`** — the secret substrate for both scripts (no fallback is
  acceptable for a real client; the gitignored plaintext fallback is dev-only).

---

## Observations (OBS — legacy / seam notes, not requirements)

- **OBS-ONB-001 (ERPNext provisioning leg — out of scope v1, seam only).** ADR-0048's packaged offer
  is PMO + a per-client ERPNext instance. Provisioning gains an ERPNext leg in a future issue
  (create/Frappe-Cloud-link the instance; record its URL in the registry; **no sync** — the
  command/query split + single-writer-per-DocType rules are F1+). FR-PROV-012 reserves the hook.
- **OBS-ONB-002 (ERPNext reconciliation seam in the historical import).** The record-level
  `reference_number` columns this import populates (migrations 0035/0040/0041; see **OD-ONB-1**,
  `docs/decisions.md`) are the **legacy numbers** a future ERPNext adapter (ADR-0048 F1) reconciles
  against. Carrying them now is cheap and forward-compatible (FR-HIST-015). `projects.csv`'s
  `external_ref` column has no persisted column to land in today (`projects` has no external-reference
  column in the schema) — it is stored only if/when such a column is added, else warned-and-ignored,
  same seam-reservation treatment as OBS-ONB-004's `entity` column.
- **OBS-ONB-003 (generic import-path parity).** The ADR-0027 `ImportDescriptor` path
  (Companies/Contacts/Projects/Procurement-header) carries the **same** re-run-duplicates flaw as the
  procurement site. The Deliverable 2 fix (provenance cols + `import_key` + skip + dry-run report) is
  designed to be **reusable on that path**; applying it there is a fast-follow (NFR-ONB-005), not
  built here.
- **OBS-ONB-004 (Entity dimension seam).** The `projects.csv` `entity` column is accepted but
  no-op'd unless the Entity (subsidiary) dimension (GTM item 7) exists. The column is reserved so a
  historical import does not have to be re-run when that dimension lands.
- **OBS-ONB-005 (offboarding).** De-provisioning (archive org via `archived_at` (ADR-0018), suspend
  the Admin, rotate/destroy the 1Password item, tear down the CF env) is the documented reverse of
  provisioning and is explicitly out of scope v1 (NFR-ONB-003 names it).
- **OBS-ONB-006 (seed-grade vs real-tenant divergence).** The legacy `prod` project is
  demo/staging-grade (demo-seeded); a real client project is **never** seeded (FR-PROV-005). The
  registry's "seed" column makes this explicit per row.

---

## Implementation TODO checklist (≈ one issue-loop per deliverable)

> Conventions (`AGENTS.md`): exact paths, real code, exact verify commands, 2–5 min tasks; each issue
> is full SDD → plan → TDD → 3 reviewers → ship; `npm run verify` (full suite) is the pre-push gate.

### Deliverable 1 — Provisioning
- [ ] 1.1 Spec sign-off (this doc) → `docs/specs/onboarding-tooling.spec.md`.
- [ ] 1.2 Plan → `docs/plans/YYYY-MM-DD-onboarding-provisioning.md` (manual-vs-CLI split table; exact
      `supabase` commands; `op-get.sh` coordinate file template; readiness-check probe list).
- [ ] 1.3 `scripts/provision-client.sh` (typed-confirm + `--check` + op-get + CLI steps + org/Admin +
      registry-row emit + readiness invocation), modeled on `db-push-prod.sh`.
- [ ] 1.4 `supabase/op.<client-slug>.env.template` (coordinates only — item/vault/field).
- [ ] 1.5 `scripts/check-client-readiness.mjs` + `.test.mjs` (pure classification helpers Unit-owned;
      modeled on `check-agent-prod-readiness.mjs`; reachability + presence-only secrets + migration
      count + org/Admin existence + RLS anon-read sanity; SKIPPED-not-FAILED).
- [ ] 1.6 Documented manual dry-run against a scratch project → record evidence in the plan.
- [ ] 1.7 3 reviewers (spec-reviewer / code-quality-reviewer / security-auditor on the service-role
      org/Admin insert + secret handling).
- [ ] 1.8 Ship (branch → PR → `dev`); update `docs/environments.md` registry convention.

### Deliverable 2 — Idempotency fix
- [ ] 2.1 Plan → `docs/plans/YYYY-MM-DD-onboarding-import-idempotency.md` (migration; commit-layer
      skip; dry-run report; pgTAP proofs; verify commands).
- [ ] 2.2 Migration `00NN_import_provenance.sql`: additive nullable `import_batch_id uuid`,
      `imported_at timestamptz`, `import_key text` on `procurements` + the 7 record tables. (No policy
      changes; no authority changes.)
- [ ] 2.3 `commit.ts`: `import_key` derivation + within-batch skip-if-exists + cross-batch collision
      skip; `skipped` result state.
- [ ] 2.4 `validate.ts`/preview: `buildDryRunConflictReport` (would-create / would-skip /
      would-collide; zero writes).
- [ ] 2.5 Unit tests (`computeImportKey`, `buildDryRunConflictReport`, skip-decision helper) +
      pgTAP (skip-query proof; AC-IDEM-006) + full `verify` (AC-IDEM-007 regression).
- [ ] 2.6 Documented manual dry-run (load → re-load same batch → assert 0 new; load overlapping new
      batch → assert skip).
- [ ] 2.7 3 reviewers (security-auditor confirms **no new write authority**; spec-reviewer confirms
      ADR-0027/0035 conformance).
- [ ] 2.8 Ship → `dev`.

### Deliverable 3 — Historical import
- [ ] 3.1 Plan → `docs/plans/YYYY-MM-DD-onboarding-historical-import.md` (CSV contracts; pure-layer
      reuse; commit divergence; `--org-id`/`--batch-id`/`--mark-provenance` flags; verify commands).
- [ ] 3.2 `scripts/import-historical.mjs` (arg/confirm gate; service-role load; reuses
      `procurementCycle` `group`/`validate`; direct-INSERT commit with status-set-directly +
      provenance; reference resolver with stub-create; summary report).
- [ ] 3.3 CSV template files under `docs/` or `scripts/templates/` (`projects.csv`,
      `procurement_cases.csv` with header rows + one example row each).
- [ ] 3.4 Unit tests (status-set validate; org-id gate; reference resolver; provenance event-builder;
      summary builder; `>1yr` advisory) — pure helpers only.
- [ ] 3.5 Documented manual dry-run against the scratch project (the pipeline verification above).
- [ ] 3.6 3 reviewers (security-auditor on the service-role `org_id`-explicit discipline + the
      optional direct `procurement_status_events` insert; spec-reviewer on the no-fabricated-history
      decision).
- [ ] 3.7 Ship → `dev` (after D2's migration is on `dev`).

---

## Self-verify (deviations from the dispatch brief)

- **Dispatch asked:** "deploy edge functions ×N". **Encoded:** N = 3 (`agent-chat`, `compose-view`,
  `agent-dispatch` — the set in `check-agent-prod-readiness.mjs` `AGENT_FUNCTIONS`), deployed but
  flag-OFF for a new client until the agent tier is licensed. No deviation.
- **Dispatch asked:** "create org + first Admin user (invite path once ops-admin ships — name the
  dependency)". **Encoded:** FR-PROV-007 v1 = `auth-admin invite` today; v2 = ops-admin invite fn
  (MVP item 1a) once shipped; SMTP dependency (MVP item 2) named. No deviation.
- **Dispatch asked:** "import idempotency fix at the real defect site". **Encoded:** site located
  (`commit.ts` `commitCase`); root cause confirmed (no dedupe key + no catching unique constraint).
  **Addition (not a deviation):** the fix's provenance columns are shared with Deliverable 3 (one
  migration serves both) — stated explicitly, reduces total schema churn.
- **Dispatch asked:** "record ONE synthetic event 'imported at terminal status X' IF the UI requires
  a non-empty log — check whether it does". **Finding (checked):** the UI does **not** require a
  non-empty log (`buildProcurementHistory` renders `statusEvents ?? []` gracefully; the seed's two
  `insert into procurements` statements set most rows' `status` directly, against only three total
  `insert into procurement_status_events` statements). **Decision encoded:** no synthetic event by
  default; an **optional, opt-in** (`--mark-provenance`) **single honest provenance row**
  (`from_status = NULL`, `org_id` explicitly the target org — never the column's demo-org default) is
  offered as audit hygiene — clearly distinguished from a fabricated transition. This is the brief's
  instruction followed exactly (the conditional resolved to "the UI does not require it").
- **Dispatch asked:** "RLS-respecting path (service-role script with org_id explicit)". **Encoded:**
  FR-HIST-001/002 + NFR-ONB-006: service role is the **load mechanism only**; `org_id` is explicit +
  typed-confirmed; the loaded data is RLS-correct for users on landing. No deviation.
- **Dispatch asked:** "DO NOT implement / build ERP sync / re-open the no-fabricated-history
  decision." **Honored:** this is a spec only; ERPNext is a named seam (OBS-ONB-001/002,
  FR-PROV-012, FR-HIST-015), not built; the no-fabricated-history decision is recorded as
  owner-locked and not re-opened.
- **Dispatch asked:** "ADR-0010 owning layers (scripts → pure transform fns unit-owned; the pipeline
  → a documented dry-run verification, not CI)". **Encoded:** the traceability table assigns every
  pure helper to Unit/pgTAP and every pipeline run to a documented manual dry-run; no pipeline AC is
  claimed as CI-owned. No deviation.
- **Test-layer note (honest):** AC-IDEM-003 ("re-run = 0 new") and AC-HIST-006 are listed as
  "documented manual + Unit (skip-decision helper)" — the live re-run is manual, the *decision* that
  drives the skip is Unit-owned. This is the most CI can honestly claim for a service-role/DB
  pipeline; flagged here as the one place the owning layer is split across the manual/Unit boundary.

SPEC-DONE
