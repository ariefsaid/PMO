# Plan: ERPNext adapter — money core (Issue P2, ADR-0055 P2 phase)

> **Spec:** `docs/specs/erpnext-adapter.spec.md` (**SIGNED OFF** — 59 `FR-ENA-` / 14 `NFR-ENA-` / 27
> `AC-ENA-`; OQ-1/3/4/7 DECIDED at the specced defaults: Material Request · report-RPC aging primary ·
> Supplier+Customer(read-only) parties · full AP command surface. OQ-2/5/6/8 resolved in-spec — do NOT
> re-litigate.)
> **ADRs:** ADR-0055 (binding adapter architecture), **ADR-0048** (ERPNext = accounting engine; the
> ledger-sourced-display rule — PMO never recomputes externally-read figures), **ADR-0057 (NEW — this
> issue)** the money-idempotency outbox + atomic recovery algorithm (`docs/adr/0057-erpnext-money-idempotency-outbox.md`).
> **Builds on the shipped P0 seam + P1 ClickUp adapter** — reuses their idioms EXACTLY; do not re-invent:
> `pmo-portal/src/lib/adapterSeam/{contract,router,dispatch,referenceAdapter,refs,watermarks,pendingPush,capabilityMap,ownershipCache}.ts`;
> the `clickup/**` adapter as the one-tier/one-domain template; `supabase/functions/{adapter-dispatch,
> _shared/clickupMirrorDeps,clickup-webhook,clickup-sweep,clickup-onboard}/`; migrations 0087–0094; the
> `0093_clickup_tasks_flip.sql` per-command-RLS flip template.
>
> **No-placeholder rule (binding):** every task below has an exact path, the actual code/diff, its
> `AC-ENA-###`, and an exact verify command. TDD order: the failing-test task precedes its implementation
> task. Types are consistent across tasks (`AdapterCommand`/`CommandResult`/`PmoRecord`/`OwnershipMap`
> from the P0 contract are the shared vocabulary; P2 adds `idempotencyKey` only).
>
> **⚑ Migration numbering (binding — two collisions already this program):** tail at write time is
> `0094_clickup_sweep_cron.sql`; this plan reserves **0095–0101** as below. **The builder MUST re-verify at
> write time** with `ls supabase/migrations | tail -3` and bump every number in this plan if any is taken.
> Renumber consistently. Slice 0 also lands a `scripts/next-migration-number.sh` collision guard so future
> writers stop guessing (none exists today — `ls scripts/` = `with-db-lock.sh` only).
>
> **Confinement invariant (FR-ENA-013/NFR-ENA-CONTRACT-001, mirrors FR-CUA-012):** ERPNext/Frappe
> vocabulary (doctype names, `/api/resource`, `docstatus`, `amended_from`, `grand_total`,
> `X-Frappe-Webhook-Signature`, `exc_type`) lives **only** under `pmo-portal/src/lib/adapterSeam/erpnext/**`
> + `supabase/functions/erpnext-webhook/`. Every module above the adapter contract speaks PMO domain
> language only. The one PMO-side discriminator that crosses the contract is `erp_doc_kind`
> (`'purchase-request'|'rfq'|'quotation'|'purchase-order'|'goods-receipt'|'purchase-invoice'|'payment'` —
> PMO verbs, never Frappe doctype names); the `(kind)→doctype` map lives inside `erpnext/**`.

---

## 0. Job story (from spec §0)

> When a client employs ERPNext as the money source of truth, PMO must let users operate the full buy-side
> chain and read financial truth from PMO while ERPNext remains the sole writer of committed/happened money
> — and every client who does NOT employ ERPNext stays byte-for-byte the pre-P2 system.

PMO = app + user surface; ERPNext = native money objects; Supabase = read-model + PMO-only enhancements.
Commands go down **synchronously** (guarded by idempotency key + durable outbox), change-feed truth comes
up via webhooks + modified-poll sweep, and PMO never recomputes ERP figures beyond mirroring or summing
mirrored ledger rows (ADR-0048). The flip is per-org and reversible; with the shipped-empty ownership map
it is inert (FR-ENA-004 — **P2's critical regression risk**).

---

## 1. Architecture overview (how P2 plugs into P0/P1)

```
 User procurement/party write (forms/Assistant)
   → repositories.procurement.{create*,transition*} / repositories.company.{create,update}
      → routes on routeDomainWrite(<domain>)  [generalized ADR-0056 cache, fail-closed 'pmo']
          ├─ 'pmo'      → EXISTING direct DAL/RPC (byte-for-byte, FR-ENA-004)  ← the invariant path
          └─ 'external' → dispatchDomainCommand(domain, op, record) → POST functions/v1/adapter-dispatch
                             [fault seams live HERE, FR-ENA-003, gated ERPNEXT_TEST_FAULTS=1]
                             → dispatchExternallyOwnedWrite (dispatch.ts)
                                 ├─ non-money (P0/P1)   → adapter.commit() → writeReadModel → recordExternalRef
                                 └─ money (idempotencyKey set, ADR-0057)
                                      → outbox pending(unique guard) → adapter.commit() [two-step create→submit]
                                      → on ok:    mark committed → mirror + ref → confirmed
                                      → on retry: reconcile(outbox.state): confirmed|committed|pending(probe)|failed
                                 → READ_MODEL_WRITERS[domain]  [registry, replaces the if-chain]
 Native ERPNext edit / desk cancel+amend
   → erpnext-webhook (HMAC X-Frappe-Webhook-Signature) → applyWebhookEvent [hint, lossy]
        ↘                                                          ↘
         both apply through the SAME source-mod-guarded full-row upsert + lineage repoint
   → erpnext-sweep (pg_cron) → runSweep(modified-poll cursor, inclusive + dedupe) [convergence authority]
 Accounting read-back (read-only domains)
   → erpnext-sweep → report RPC (Accounts Payable/Receivable, pinned filters) → snapshot-replace
                   → GL Entry summation → erp_actuals_snapshot
```

Ownership is per-org in `external_domain_ownership` (0087) via the Operator RPC
`operator_set_domain_ownership(org,'erpnext',<domain>,'employ')`. The per-org **binding + credentials** live
in a new `external_org_bindings` table (OQ-6 — site URL + resolved Company defaults + version + webhook
secret ref). Reads are **always** the Supabase read-model (FR-ENA-172) — no read is ever routed to ERPNext.

---

## 2. Key design decisions (binding — carry these into every task)

1. **One `erpnext` adapter, many domains — internal doctype registry (OQ-2).** `capabilityMap =
   {'companies','procurement'}`. The procurement domain is internally discriminated by a PMO-side
   `erp_doc_kind` field on `PmoRecord` (PMO verbs, never Frappe names); the `(domain, kind, operation) →
   {doctype, toBody, fromDoc, docstatusPolicy, readOnly?}` registry lives inside `erpnext/doctypeRegistry.ts`.
   Auth/client/rate-limit/site-binding are per-tier (one client per org binding), not per-doctype.
2. **Money idempotency = a durable outbox + atomic recovery (ADR-0057; R1/R3).** `AdapterCommand` gains
   `idempotencyKey?: string` (P0/P1 ignore it). A non-read-only money command writes an
   `external_command_outbox` row `state='pending'` **before** `adapter.commit()`; the unique 4-tuple
   `(org,domain,pmo_record_id,idempotency_key)` makes a concurrent duplicate fail atomically (`23505`). The
   adapter stamps the key into the doctype's `remarks` so a recovery probe (`GET …?filters=[["remarks","like","%<key>%"]]`)
   can find an orphaned commit. A retry reconciles by outbox `state` (confirmed→return / committed→finalize
   only / pending→probe-then-maybe-reissue / failed→reissue) — **never a blind second create** (FR-ENA-043).
3. **`transition` is first-class (R2).** submit (`PUT {docstatus:1}`) / cancel (`{docstatus:2}`) / amend
   (native cancel + create-with-`amended_from`). The adapter **always** uses the R9 **two-step**
   insert-then-submit (separates the idempotency windows) and **re-fetches** derived `status`/`outstanding`
   after submit (the POST-response `status:"Draft"` is stale). Cancel is **chain-reverse**
   (PR-then-PO, PE-then-PI; a blocking `LinkExistsError` is surfaced, never faked). Amend produces a new
   ERP `name` → `external_refs` repoints + an `external_ref_lineage` row; a stale old-name event is a
   no-op via the per-row `erp_modified >=` guard (never clobbers the live amended mirror).
4. **Decimal-string money, numeric-only persistence (R4).** Every money/rate/qty/outstanding/allocated/
   total crosses the contract as a **`string`**; ERP `null`/absent → SQL `NULL`; over-`numeric(14,2)` →
   `commit-rejected`. The **money oracle** is always the mirrored ERP header total, never a PMO recompute.
   `procurement_items.amount` is `GENERATED ALWAYS AS (quantity*rate) STORED` (0001) — **PMO cannot set
   it** — so ERP line `amount` mirrors into a **new `erp_line_amount`** column; the generated `amount` is a
   display convenience, explicitly NOT ERP truth.
5. **Served-edge-function money boundary + named server-side fault seams (FR-ENA-001/003).** Every
   money-command e2e exercises the **real served `adapter-dispatch`** through Kong, **never `page.route`**.
   The faults (`after-commit-before-mirror`, `after-submit-before-mirror`, `unreachable`,
   `reject-validation`, `timeout`) live **in the function**, gated by `ERPNEXT_TEST_FAULTS=1` + header
   `x-erpnext-test-fault`. This is what makes R1/R3/R2 provable at the real boundary.
6. **Multi-domain read-model writer registry + multi-domain resolver.** The dispatch's
   `if (domain===CLICKUP_TASKS_DOMAIN)` becomes `READ_MODEL_WRITERS[domain] = { upsert(canonical), tombstone? }`.
   A new `resolveExternalRef(org, domain, pmoRecordId)→externalId` + reverse map generalizes the
   single-domain `resolveExternalId` so a PO command can resolve Supplier + upstream PO/PR refs (and the
   GR command the **PO item child-row `name`**) through `external_refs` — never raw PMO ids.
7. **Non-ERPNext byte-for-byte invariant FIRST (P1 C1 discipline).** Slice 1 lands the regression net
   (`procurement.external.test.ts` + full `npm run verify` gate) **before** any repository wiring touches
   the procurement/companies path. `routeDomainWrite` defaults to `'pmo'` on a cold/absent map (FR-ENA-005).
8. **Per-org binding, not per-project (OQ-6).** `external_org_bindings` (site URL + resolved Company
   defaults via one `GET Company/<name>` + version + `secret_ref` → vault `AS`/function secrets). No
   secret value ever enters the DB or the browser (NFR-ENA-SEC-002).
9. **Change-feed: modified-poll sweep = convergence authority; webhooks = lossy hints (reuse P1 engine).**
   Hoist `clickup/{webhookApply,sweep}.ts` to `adapterSeam/{applyInboundChange,runSweep}.ts` parameterized
   by `(tier, domain, tableWriter)`; ERPNext reuses them with `modified` (datetime string) as the cursor +
   the `erp_modified` per-row guard. Cancel = `docstatus:2` soft-tombstone (OQ-8 — REST enforces it).

---

## 3. Slice plan (9 independently-mergeable slices; one PR each to `dev`; all green flag-off)

Each slice is a standalone PR that builds and passes `npm run verify` **with no org employing ERPNext** (so
it is behavior-off / byte-for-byte for every existing client). Merge order 0→1→2→…→8 is the natural
dependency order, but each stands alone (later slices' modules are inert until an org is flipped by the
Operator, which no test-or-prod org is).

| Slice | Scope (1 line) | ACs owned | Migrations | Tasks |
|---|---|---|---|---|
| **0** | Served-fn e2e infra: serve wrapper + CI lane + health gate + config.toml:410 comment fix + Docker-v15 bench docs + named fault seams in `adapter-dispatch` + next-migration collision guard | (enables 010/013/040/050/051/052/053/061) | — | 0.1–0.9 |
| **1** | Seam generalization: `idempotencyKey` on `AdapterCommand`; `external_org_bindings` + `external_command_outbox` + `external_ref_lineage`; money-dispatch + atomic recovery; multi-domain read-model-writer registry + resolver; `routeDomainWrite`; **byte-for-byte regression net EARLY** | 001,002,012,054 | `0095_erpnext_seam_tables.sql` | 1.1–1.14 |
| **2** | ERPNext tier core: `erpnext/client.ts` (token auth, `exc_type`/`_server_messages` classifier incl. the 500-`TypeError` non-retryable bucket, 429/`Retry-After` backoff w/ no-blind-retry guard); doctype registry; version-handshake binding; decimal-string money shape; transition policy; lineage module | 011,020,021,022,023,030,031,073 | — | 2.1–2.16 |
| **3** | Parties flip: Supplier + Customer(read-only) create/update + pull-adopt + ambiguous-match + collision-two-rows + `contacts` mirror + companies/contacts flip migration + pgTAP; supplier write-through served-fn e2e | 003(companies),040,041,042,072(companies) | `0096_companies_contacts_erpnext_flip.sql` | 3.1–3.12 |
| **4** | MR + RFQ + Supplier Quotation: first submittable doctypes; procurement_items + purchase_requests + rfqs + procurement_quotations flip migration + pgTAP; one-selected invariant preserved; PR→MR + RFQ/SQ served-fn e2e | 003(procurement),050,051 | `0097_procurement_items_pr_rfq_sq_flip.sql` | 4.1–4.11 |
| **5** | PO + GR: cross-doctype ref resolution incl. the PO item child-row `name`; purchase_orders + procurement_receipts flip migration + pgTAP; PO+GR served-fn e2e | 052 | `0098_purchase_orders_receipts_flip.sql` | 5.1–5.9 |
| **6** | PI + Payment Entry + full AP command surface (R9 frozen): create/update-draft + submit/cancel/amend on PI; create+submit + cancel on PE; procurement_invoices + payments flip migration + pgTAP; **outbox-backed money e2e at the real boundary** (after-commit-before-mirror PE idempotency; PI recovery-adopt) | 053,072(money) | `0099_invoices_payments_flip.sql` | 6.1–6.14 |
| **7** | Actuals + AP/AR aging read-only snapshots: report-RPC primary (pinned filters) + mirrored-ledger fallback (never invoice-only math); 3 snapshot tables + snapshot-replace + provenance; aging served-fn e2e | 060,061 | `0100_erp_accounting_snapshots.sql` | 7.1–7.9 |
| **8** | Webhooks-as-hints + modified-poll sweep + cancel/amend lineage feed: `erpnext-webhook` (HMAC) ingress; `erpnext-sweep` (modified cursor, inclusive + dedupe); sweep cron; lineage wired into the apply path | 070,071 | `0101_erpnext_sweep_cron.sql` | 8.1–8.9 |

**AC-ENA-002** (zero-regression meta-AC) is the `npm run verify` + full pgTAP gate at the end of **every**
slice — no single new test owns it. **Deviation note:** the spec/intake slice map split slice 8's lineage
feed from the core; this plan lands the lineage **module + its unit ACs (020/021/022) in slice 2** (core —
transition policy + lineage are prerequisites for every money doctype) and keeps slice 8 for the
**change-feed integration** of that module (webhook/sweep applying cancel/amend). No AC moves layer; the
owning test files are unchanged from the spec §9 table.

---

## Slice 0 — Served-edge-function money boundary + fault seams + bench docs (no behavior change)

**Goal:** productionize the spike's served-fn e2e recipe (local + CI), fix the stale `config.toml:410`
comment, document the Docker v15 bench as the dev bed, land the named server-side fault seams in
`adapter-dispatch` (inert unless `ERPNEXT_TEST_FAULTS=1`), and add a migration-number collision guard.
**Zero behavior change** for any existing path (no org employs ERPNext; the fault seams are env-gated off).

### 0.1 — `scripts/serve-functions.sh` (local served-fn wrapper) — productionize the spike recipe

**File:** `scripts/serve-functions.sh` (new, executable). Wraps the spike's local recipe inside
`scripts/with-db-lock.sh`: start `supabase functions serve --no-verify-jwt` bg → poll
`/functions/v1/health` (60×2s) → run the caller's command → `kill $CLI_PID` **and**
`docker rm -f supabase_edge_runtime_pmo-portal` (SIGTERM leaks the container — spike fact). Exports
`SUPABASE_FUNCTIONS_URL=http://localhost:54321` for the e2e.

```bash
#!/usr/bin/env bash
# scripts/serve-functions.sh — served-edge-fn e2e wrapper (spike §3.2 productionized).
# Usage: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test e2e/AC-ENA-053-*
set -euo pipefail
# 1. serve bg (self-manages its runtime container; [edge_runtime] enabled=false stays)
supabase functions serve --no-verify-jwt --env-file supabase/functions/.env.local >/tmp/functions-serve.log 2>&1 &
CLI_PID=$!
cleanup() { kill "$CLI_PID" 2>/dev/null || true; docker rm -f supabase_edge_runtime_pmo-portal >/dev/null 2>&1 || true; }
trap cleanup EXIT
# 2. health gate (60×2s)
for i in $(seq 1 60); do
  curl -sf http://localhost:54321/functions/v1/health >/dev/null && break || { sleep 2; }
  [ "$i" = 60 ] && { echo "functions did not become healthy"; cat /tmp/functions-serve.log; exit 1; }
done
export SUPABASE_FUNCTIONS_URL=http://localhost:54321
# 3. run the caller's command (passed after --)
shift $((OPTIND-1)); [ "${1:-}" = "--" ] && shift
"$@"
```

**Verify:** `chmod +x scripts/serve-functions.sh && scripts/with-db-lock.sh scripts/serve-functions.sh -- curl -sf http://localhost:54321/functions/v1/health` → exits 0.

### 0.2 — Rewrite the stale `config.toml:410` comment (spike disproved the deno.land claim)

**File:** `supabase/config.toml` — replace the `[edge_runtime]` comment block (lines ~410-412). Keep
`enabled = false`.

```diff
 [edge_runtime]
-# Disabled for the backend-foundation issue: no Edge Functions in scope; the local Deno image cannot
-# reach deno.land in this environment and its failed health check tears down the whole stack.
+# `supabase functions serve` self-manages its runtime container on demand (image is local/ECR — zero
+# deno.land reach, spike-verified 2026-07-11). Kept disabled so `supabase start` stays lean; the served-fn
+# e2e lane (`scripts/serve-functions.sh`) brings it up per-run. Do NOT re-enable globally.
 enabled = false
```

**Verify:** `grep -A3 "\[edge_runtime\]" supabase/config.toml | head -5` shows the new comment; `supabase start` still boots clean.

### 0.3 — CI integration-lane: served-fn step after `db reset`

**File:** `.github/workflows/integration.yml` (the PR→`main` integration lane). After the existing
`supabase db reset` step, add a served-fn step: `supabase functions serve --no-verify-jwt --env-file
<(printf '%s\n' "$SUPABASE_SECRETS")` bg → same 60×2s health gate → dump `/tmp/functions-serve.log` on
failure. No teardown (ephemeral runner). Secret `SUPABASE_SECRETS` is a GH secret (vault `AS`-sourced).
**Verify:** the lane runs on the next PR→`main`; health gate passes (visible in the run log).

### 0.4 — Docker v15 bench docs (the P2 dev bed)

**File:** `docs/environments.md` — add a `## ERPNext v15 dev bed (P2)` section: stand up from
`~/Coding/frappe-docker-pmo` (`docker compose -p pmo-erpnext -f pwd.yml up -d`), site `frontend` at
`http://localhost:8080`, image `frappe/erpnext:v15.94.3` (frappe 15.96.0 / erpnext 15.94.3), **creds +
admin password live ONLY in `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md` — never in this repo**
(NFR-ENA-SEC-002). Setup-wizard-completed (company `PMO Smoke Co` / IDR / Standard COA) so the full account
tree + cost center + warehouse defaults exist (R9 §0 prerequisite). RAM ~724 MiB, 9 containers, port 8080
(zero overlap with `supabase_*` stacks).
**Verify:** `grep -c "ERPNext v15 dev bed" docs/environments.md` = 1.

### 0.5 — `scripts/with-erpnext-lock.sh` (second shared-resource mutex)

**File:** `scripts/with-erpnext-lock.sh` (new, executable). The ERPNext Docker stack is a **second** shared
resource (the local Supabase stack is the first, already locked by `with-db-lock.sh`). Same flock idiom,
different lockfile (`/tmp/pmo-erpnext.lock`). Money e2e wrap BOTH: `scripts/with-db-lock.sh
scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test …`.
**Verify:** `scripts/with-erpnext-lock.sh echo ok` → `ok`.

### 0.6 — RED: fault-seam behavior test (inert when env off)

**File:** `supabase/functions/adapter-dispatch/faultSeams.test.ts` (new, Deno test). Proves
`maybeFault(seam, {envFaults, header})` is a no-op when `envFaults!=='1'` and throws the mapped fault when
`envFaults==='1'` + header set. (The e2e-level proof of each named seam lands in the slice that owns the
AC — 0.6 proves only the gate logic.)

```ts
// asserts: maybeFault('after-commit-before-mirror', {envFaults:'0', header:'after-commit-before-mirror'}) → undefined (no throw)
//          maybeFault('unreachable', {envFaults:'1', header:'unreachable'}) → throws AdapterError('external-unreachable', …)
//          maybeFault('reject-validation', {envFaults:'1', header:'reject-validation'}) → throws AdapterError('commit-rejected', …)
//          maybeFault('timeout', {envFaults:'1', header:'timeout'}) → sleeps > budget then throws (assertion via injected sleep)
```
**Verify (RED):** `cd supabase/functions/adapter-dispatch && deno test faultSeams.test.ts` → fails (module absent).

### 0.7 — GREEN: `faultSeams.ts` + wire into `adapter-dispatch/index.ts`

**Files:** `supabase/functions/adapter-dispatch/faultSeams.ts` (new) + edit `index.ts`. `maybeFault` reads
`Deno.env.get('ERPNEXT_TEST_FAULTS')` + `req.headers.get('x-erpnext-test-fault')`; honored only when BOTH
match. Inject the seams into the dispatch path (between commit and mirror = `after-commit-before-mirror`;
inside the adapter's submit step = `after-submit-before-mirror`, surfaced via a dep the adapter calls;
`unreachable`/`reject-validation`/`timeout` short-circuit before/at commit). **Inert in every non-test
context** (env off ⇒ no-op, byte-for-byte). Re-run 0.6 → GREEN.
**Verify:** `cd supabase/functions/adapter-dispatch && deno test faultSeams.test.ts` → passes; `deno check index.ts` clean.

### 0.8 — One real-boundary smoke e2e through Kong 54351

**File:** `pmo-portal/e2e/served-fn-smoke.spec.ts` (new). Proves the lane: serve bg → `POST
/functions/v1/adapter-dispatch` (reference domain, no ERPNext) returns the typed 200/401 through Kong.
**Verify:** `scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test served-fn-smoke` → green.

### 0.9 — `scripts/next-migration-number.sh` collision guard

**File:** `scripts/next-migration-number.sh` (new, executable). Prints the next free `NNNN`:
`ls supabase/migrations | sort | tail -1 | cut -c1-4` + 1, zero-padded. Every migration task in slices 1–8
calls it first. **Verify:** `scripts/next-migration-number.sh` → `0095`.

**Slice 0 final gate:** `cd pmo-portal && npm run verify` (full) green; `scripts/with-db-lock.sh supabase
test db` green; `scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test served-fn-smoke` green. No DB migration this slice ⇒ no pgTAP band beyond the existing suite.

---

## Slice 1 — Seam generalization + money infra + the byte-for-byte regression net (EARLY)

**Goal:** generalize the seam for one-tier/many-domains + money; add the 3 money-infra tables; prove the
non-ERPNext invariant is byte-for-byte **before** any repository wiring. AC-ENA-001/002/012/054.

### 1.1 — RED: `procurement.external.test.ts` (AC-ENA-001, the invariant) — EARLY

**File:** `pmo-portal/src/lib/repositories/procurement.external.test.ts` (new). Asserts: with an
empty/cold ownership map, `createPurchaseRequest`/`createRfq`/`createPurchaseOrder`/`createPayment`/
`createQuotation`/`createReceipt`/`createInvoice`/`transitionProcurement` each call the **existing** DAL
(RPC) path and do **not** call `dispatchDomainCommand` (spy on the dispatch client; assert
`not.toHaveBeenCalled()`), and the returned row + thrown `.code` are identical to pre-P2 (snapshot the
call args). Also `companies` create/update. This is the single owning test for AC-ENA-001.
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/repositories/procurement.external.test.ts` → fails (routing not yet generalized).

### 1.2 — `idempotencyKey` on `AdapterCommand` (FR-ENA-040) — additive, P0/P1 ignore it

**File:** `pmo-portal/src/lib/adapterSeam/contract.ts`. Add an optional field (P0/P1 never set it ⇒ their
behavior is byte-for-byte unchanged):

```ts
export interface AdapterCommand {
  domain: PmoDomain;
  operation: AdapterOperation;
  record: PmoRecord;
  /** Client-generated per non-read-only ERPNext money command (FR-ENA-040). P0/P1 ignore it. */
  idempotencyKey?: string;
}
```
**Verify:** `cd pmo-portal && npm run typecheck` → 0 errors.

### 1.3 — `routeDomainWrite(domain)` + `setDomainOwnership` (generalize ADR-0056 cache, FR-ENA-005)

**File:** `pmo-portal/src/lib/adapterSeam/ownershipCache.ts`. Generalize the cache from tasks-only to any
domain; keep `routeTaskWrite()` as `routeDomainWrite('tasks')` (P1 callers unchanged, byte-for-byte):

```ts
let cache: OwnershipMap | null = null;
export function setDomainOwnership(rows: readonly OwnershipRow[]): void { /* same as setTaskOwnership, keyed by domain */ }
export function clearOwnershipCache(): void { cache = null; }
export function routeDomainWrite(domain: PmoDomain): WriteRoute { return cache ? routeWrite(domain, cache) : 'pmo'; }
export const setTaskOwnership = setDomainOwnership;          // back-compat alias (P1)
export function routeTaskWrite(): WriteRoute { return routeDomainWrite('tasks'); }  // back-compat (P1)
```
Add `setDomainOwnership` to the `useOwnershipCacheSync()` seed (C6) — it already loads own-org
`external_domain_ownership`; feed all rows (not just `tasks`) into `setDomainOwnership`.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/ownershipCache.test.ts` green (existing P1 tests unchanged).

### 1.4 — RED: `dispatch.money.test.ts` — the outbox + atomic recovery (AC-ENA-012, FR-ENA-041/043)

**File:** `pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts` (new). Pure unit tests with mocked
outbox/adapter deps. Asserts the full state machine (ADR-0057):
- fresh key → INSERT pending → commit → committed → mirror+ref → confirmed (happy path).
- concurrent duplicate key → INSERT pending throws `23505` → re-read → reconcile to winner (no second commit).
- `confirmed` retry → return stored result, **no ERP call**.
- `committed` retry → finalize (mirror+ref) only, **no second commit**.
- `pending` retry + probe finds doc → adopt (set external_id) → finalize; `pending` + probe empty → reissue.
- `failed` retry → reissue create.
- `commit-rejected` → mark `failed`, throw; `external-unreachable` → leave `pending`, throw.
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.money.test.ts` → fails.

### 1.5 — GREEN: `dispatchMoneyWrite(deps)` in `dispatch.ts` (the outbox guard + reconcile)

**File:** `pmo-portal/src/lib/adapterSeam/dispatch.ts`. Add `dispatchMoneyWrite(deps)` (pure, Deno-importable)
alongside `dispatchExternallyOwnedWrite`. `DispatchMoneyDeps` extends the existing deps with
`{ readOutbox, insertOutboxPending, markOutboxCommitted, markOutboxConfirmed, markOutboxFailed,
probeByRemarksKey }`. `dispatchExternallyOwnedWrite` chooses: if `command.idempotencyKey` set →
`dispatchMoneyWrite`; else the existing path (byte-for-byte for P0/P1). The reconcile algorithm is
`reconcileOutbox(existing)` per ADR-0057 §Decision. Re-run 1.4 → GREEN.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.money.test.ts` → passes.

### 1.6 — Multi-domain read-model writer registry + resolver (replaces the dispatch if-chain)

**Files:** `supabase/functions/adapter-dispatch/readModelWriters.ts` (new) + edit `index.ts`. Replace the
`writeReadModel` inline `if (domain===CLICKUP_TASKS_DOMAIN)` with `READ_MODEL_WRITERS[domain].upsert(...)`
(a `Record<domain, {upsert, tombstone?}>`). ClickUp's `tasks` writer moves in verbatim; ERPNext's
`companies`/`procurement` writers register in their slices. Add `resolveExternalRef(serviceClient, orgId,
domain, pmoRecordId)→externalId|null` + reverse `findPmoRecordId(…)` (multi-domain; the P1 single-domain
`resolveExternalId` in `clickup/dispatchFactory.ts` delegates to it). `external_refs` already has
`unique(org_id,domain,external_record_id)` (0093) — AC-ENA-054's guard is already live; this task only adds the read path.
**Verify:** `cd pmo-portal && npm run typecheck && cd supabase/functions/adapter-dispatch && deno check index.ts` clean; existing ClickUp dispatch tests green.

### 1.7 — RED: `external_command_outbox` + `external_ref_lineage` pgTAP (AC-ENA-012)

**File:** `supabase/tests/external_command_outbox_rls.test.sql` (new). Mirror the
`external_refs_rls.test.sql` idiom. Asserts: the `unique (org_id, domain, pmo_record_id,
idempotency_key)` rejects a concurrent duplicate (`throws_ok … '23505'`); org-isolated SELECT;
service-role-only write; the `state` CHECK (`pending|committed|confirmed|failed`).
**Verify (RED):** `scripts/with-db-lock.sh supabase test db -- -f external_command_outbox_rls` → fails (table absent).

### 1.8 — GREEN: migration `0095_erpnext_seam_tables.sql` (re-verify number first)

**File:** `supabase/migrations/0095_erpnext_seam_tables.sql` (new). Three tables per spec §4.1/§4.2/§4.3 —
all `org_id uuid not null default '…0001'` + `stamp_org_id()` BEFORE-INSERT trigger (0074 pattern), all
machine-written (service-role write + org-member SELECT), each with a reversal block. Concretely:

```sql
-- external_org_bindings (OQ-6): per-org ERPNext binding. secret_ref points into vault AS/fn secrets — NO value stored.
create table public.external_org_bindings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  external_tier       text not null,
  site_url            text not null,
  secret_ref          text not null,
  version_major       int,
  config              jsonb not null default '{}'::jsonb,   -- {company, default_payable_account, default_cash_account, default_bank_account, default_expense_account, cost_center, default_warehouse, aging_report_names, report_filter_shape}
  webhook_secret_ref  text,
  activated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, external_tier)
);
-- external_command_outbox (R1/R3): the durable provisional ref. unique 4-tuple = the idempotency guard.
create table public.external_command_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  domain              text not null,
  pmo_record_id       text not null,
  idempotency_key     text not null,
  external_tier       text not null,
  operation           text not null check (operation in ('create','update','transition')),
  state               text not null check (state in ('pending','committed','confirmed','failed')),
  external_record_id  text,
  payload_digest      text,
  attempt_count       int not null default 0,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, domain, pmo_record_id, idempotency_key)
);
-- external_ref_lineage (R2): cancel/amend history. Index for the "is this ERP name superseded?" lookup.
create table public.external_ref_lineage (
  id                              uuid primary key default gen_random_uuid(),
  org_id                          uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                                    references public.organizations(id) on delete cascade,
  domain                          text not null,
  pmo_record_id                   text not null,
  superseded_external_record_id   text not null,
  successor_external_record_id    text,
  reason                          text not null check (reason in ('cancelled','amended')),
  erp_docstatus                   smallint,
  at                              timestamptz not null default now()
);
create index external_ref_lineage_lookup_idx on public.external_ref_lineage (org_id, domain, superseded_external_record_id);
```
Each table: `enable row level security; force row level security;` + `create policy … for select using
(org_id = public.auth_org_id() and public.is_active_member());` (service-role writes bypass RLS by
construction) + `grant select to authenticated, anon;`. Add `stamp_org_id()` trigger per table (0074
pattern). Re-run 1.7 → GREEN.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f external_command_outbox_rls` → passes; `scripts/with-db-lock.sh supabase db reset` clean.

### 1.9 — RED: `external_refs_adopt_unique.test.sql` (AC-ENA-054 — proves the reused 0093 constraint for the new domains)

**File:** `supabase/tests/external_refs_adopt_unique.test.sql` (new). Inserts an `external_refs` row
`(org, 'procurement', 'MAT-REQ-001')→pmoA`; asserts a second insert mapping the **same**
`(org,'procurement','MAT-REQ-001')` to `pmoB` throws `23505`; same for `'companies'`/`'Supplier:X'`.
**Verify (RED → GREEN immediately):** the `unique(org_id,domain,external_record_id)` from 0093 already
enforces it — this is the proof, so it goes green once written.

### 1.10 — `repositories/procurement.ts` routing (wires the invariant path; external stays unflipped)

**File:** `pmo-portal/src/lib/repositories/procurement.ts` (extend the existing repository). Each create*
/transition method: `if (routeDomainWrite('procurement') === 'external') return dispatchDomainCommand(…);
else <existing RPC call>`. Because no org is flipped, every call takes the `else` (byte-for-byte). Same for
`repositories/company.ts` (`routeDomainWrite('companies')`). `dispatchDomainCommand` POSTs
`functions/v1/adapter-dispatch` (the `dispatchClient.ts` already exists from P0). Re-run 1.1 → GREEN (AC-ENA-001).
**Verify:** `cd pmo-portal && npx vitest run src/lib/repositories/procurement.external.test.ts` → passes.

### 1.11 — `dispatchDomainCommand` + `dispatchClient` typed for `idempotencyKey`

**File:** `pmo-portal/src/lib/adapterSeam/dispatchClient.ts`. Extend the POST body type to include the
optional `idempotencyKey`; the procurement/company repositories mint one per non-read-only money command
(`crypto.randomUUID()`). **Verify:** `cd pmo-portal && npm run typecheck` → 0 errors.

### 1.12 — Hoist `applyInboundChange` + `runSweep` to `adapterSeam/` (reuse for ERPNext, slice 8)

**Files:** `pmo-portal/src/lib/adapterSeam/applyEngine.ts` (new) — move `applyInboundChange`,
`advanceWatermarkMonotonic`, `runSweep` from `clickup/{webhookApply,sweep}.ts` parameterized by
`(tier, domain, maps?)`; `clickup/**` re-exports them (thin wrappers passing `'clickup'`/`'tasks'`/maps) so
P1 tests stay byte-for-byte. ERPNext imports them in slice 8. **Verify:** `cd pmo-portal && npx vitest run
src/lib/adapterSeam/clickup/` → all P1 tests still green.

### 1.13 — ADR-0057 (the money-idempotency outbox + atomic recovery)

**File:** `docs/adr/0057-erpnext-money-idempotency-outbox.md` (new — see §"ADRs" below for full text).
Context/Decision/Consequences for the outbox + reconcile algorithm (R1/R3). **Verify:** file exists.

### 1.14 — Byte-for-byte regression gate (AC-ENA-002, the meta-AC)

Run the **full** existing suite unchanged: `cd pmo-portal && npm run verify` + `scripts/with-db-lock.sh
supabase test db` + `npx playwright test` (existing e2e). Every previously-passing
procurement/companies/tasks test must still pass. **Verify:** all green; this IS the AC-ENA-002 proof.

**Slice 1 final gate:** `cd pmo-portal && npm run verify` (full) + `scripts/with-db-lock.sh supabase test
db` green. No served-fn e2e this slice (none owns an AC yet).

---

## Slice 2 — ERPNext tier core (client, doctype registry, binding, money shape, transition, lineage)

**Goal:** the `erpnext` adapter's reusable core — no flip yet, no FE wiring; pure modules + unit ACs.
AC-ENA-011/020/021/022/023/030/031/073. All Frappe vocabulary confined to `erpnext/**`.

### 2.1 — RED: `erpnext/client.test.ts` (AC-ENA-011 — no blind retry; 500-TypeError bucket)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/client.test.ts` (new). Injected `fetchImpl`. Asserts:
- `Authorization: token <key>:<secret>` header; `/api/resource/Purchase%20Invoice` (space URL-encoded).
- a `417` + `{"exc_type":"MandatoryError", "_server_messages":"…"}` → `ErpError('commit-rejected', …)`.
- a `417` + `{"exc_type":"LinkExistsError"}` → `commit-rejected` (cancel blocked).
- a `404` + `{"exc_type":"DoesNotExistError"}` → `commit-rejected`.
- a **`500` + `TypeError` body** (the R9 empty-items crash) → `ErpError('commit-rejected', …,
  retryable:false)` — the **distinct non-retryable bucket** (FR-ENA-013/042).
- a `429` + `Retry-After` → backoff then succeed; an exhausted `5xx` → `external-unreachable`.
- **no-blind-retry guard:** a non-idempotent `POST` on a retryable transport failure does **not** re-POST
  (asserts fetch call count = 1) — surfaces the guarded-reconciliation need.
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/client.test.ts` → fails.

### 2.2 — GREEN: `erpnext/client.ts` (token auth + classifier + backoff + no-blind-retry)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/client.ts` (new). `erpnextRequest(deps, opts)`:
`Authorization: token ${key}:${secret}`; URL-encode spaces in the doctype path; parse `exc_type` first then
`_server_messages` (JSON-in-JSON) for display; map per 2.1. `withBackoff` (reuse the rate-limit idiom,
token bucket sized for worker-pool concurrency — Frappe rate-limiting is off by default). The
`500`-`TypeError` bucket is classified `commit-rejected` with `retryable=false`. `createDoc` (POST, never
blindly retried) vs `submitDoc`/`cancelDoc` (PUT `{docstatus:1|2}`, idempotent via re-fetch). Re-run 2.1 → GREEN.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/client.test.ts` → passes.

### 2.3 — RED: `erpnext/binding.test.ts` (AC-ENA-073 — v15 handshake gates activation)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts` (new). Mocked `GET
/api/method/frappe.utils.change_log.get_versions` → `{erpnext:{version:'15.94.3'}}` ⇒ `version_major=15` ⇒
`activateBinding` stamps `activated_at`; a `16.x`/`14.x` ⇒ `activated_at` stays null + money commands
refused as config-rejected. Also asserts one `GET Company/<name>` fills the `config` accounts (R9 §6.2).
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/binding.test.ts` → fails.

### 2.4 — GREEN: `erpnext/binding.ts` (handshake + Company-defaults cache + secret resolution)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/binding.ts` (new). `loadBinding(serviceClient, orgId)`:
read `external_org_bindings` row → resolve `secret_ref` to creds (vault `AS`/fn-secret read at the edge fn
boundary, never here — this module receives the resolved `{apiKey, apiSecret, webhookSecret}`); handshake;
`GET Company/<config.company>` → fill `default_payable_account`/`default_cash_account`/`default_bank_account`/
`default_expense_account`/`cost_center`; cache per binding. Re-run 2.3 → GREEN.
**Verify:** passes.

### 2.5 — `erpnext/doctypeRegistry.ts` (the internal `(domain,kind,op)→doctype` map, FR-ENA-014)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` (new). The one place Frappe doctype
names live (confinement). Entries (the R9-frozen bodies fold into the `toBody` fns in 2.6–2.10):

```ts
export type ErpDocKind = 'purchase-request'|'rfq'|'quotation'|'purchase-order'|'goods-receipt'|'purchase-invoice'|'payment'|'supplier'|'customer';
export interface DoctypeEntry { doctype: string; toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown; fromDoc: (doc: unknown) => PmoRecord; submittable: boolean; readOnly?: boolean; }
export const DOCTYPE_REGISTRY: Record<ErpDocKind, DoctypeEntry> = { /* filled 2.6–2.10 + slice 3 */ };
```
**Verify:** `cd pmo-portal && npm run typecheck` clean.

### 2.6 — RED+GREEN: `erpnext/moneyShape.ts` (AC-ENA-030/031, decimal-string, FR-ENA-070/071/072)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (RED) then `moneyShape.ts` (GREEN).
Pure functions: `toDecimalString(v)` (reject over-`numeric(14,2)` → throw `commit-rejected`), `mirrorMoney`
(ERP `null`/absent → SQL `NULL`, not `0`). Asserts (AC-ENA-030): a PI `grand_total:"150000.00"`,
`outstanding_amount:"0.00"`, line `qty:"2"/rate:"100000.00"/amount:"200000.00"` round-trip exactly into the
mirror numerics — **no JS float artifact**, header total is the oracle (not Σ lines). Asserts (AC-ENA-031):
PE `paid_amount`/`allocated_amount` → `payments.amount` exactly; absent optional → `NULL`; over-scale →
`commit-rejected`. The `procurement_items.amount` GENERATED divergence is documented (oracle = `erp_line_amount`).
**Verify:** RED fails, GREEN passes.

### 2.7 — R9-frozen `toBody`/`fromDoc` per doctype (fold the spike ground truth)

**Files:** `erpnext/bodies/{purchaseInvoice,paymentEntry,purchaseOrder,goodsReceipt,materialRequest,rfq,supplierQuotation}.ts`
(new). Each is the `toBody` for its registry entry — the **exact R9 minimal bodies**, no invented fields:

```ts
// purchaseInvoice.ts (R9 §1)
export const piToBody = (rec, ctx): object => ({ supplier: ctx.refs.supplier, items: rec.items.map(i => ({ item_code: i.item_code, qty: i.qty, rate: i.rate })) });
// paymentEntry.ts (R9 §2 — the frozen core): adapter supplies paid_from/paid_to from binding config
export const peToBody = (rec, ctx): object => ({ payment_type:'Pay', party_type:'Supplier', party: ctx.refs.supplier, paid_amount: rec.paid_amount, received_amount: rec.received_amount ?? rec.paid_amount, paid_from: ctx.config.default_cash_account ?? ctx.config.default_bank_account, paid_to: ctx.config.default_payable_account, references: rec.references ?? [] });
// purchaseOrder.ts (R9 §3): schedule_date on the ITEM row is mandatory
export const poToBody = (rec, ctx): object => ({ supplier: ctx.refs.supplier, items: rec.items.map(i => ({ item_code:i.item_code, qty:i.qty, rate:i.rate, schedule_date:i.schedule_date })) });
// goodsReceipt.ts (R9 §4): purchase_order + purchase_order_item (the PO item CHILD-ROW name) per row
export const grToBody = (rec, ctx): object => ({ supplier: ctx.refs.supplier, items: rec.items.map(i => ({ item_code:i.item_code, qty:i.qty, rate:i.rate, purchase_order: ctx.refs.po, purchase_order_item: i.po_item_child_name })) });
// materialRequest.ts (R9 §0 + spec FR-ENA-110): material_request_type='Purchase', company from binding
export const mrToBody = (rec, ctx): object => ({ material_request_type:'Purchase', company: ctx.config.company, items: rec.items.map(i => ({ item_code:i.item_code, qty:i.qty, rate:i.rate, schedule_date:i.schedule_date })) });
// rfq.ts / supplierQuotation.ts: supplier + item rows (FR-ENA-111/112)
```
Each `fromDoc` maps ERP `name`/`docstatus`/`modified`/`grand_total`/`outstanding_amount`/`paid_amount` into
the PMO-shaped `PmoRecord` (decimal strings). **Verify:** `cd pmo-portal && npm run typecheck && npx vitest run src/lib/adapterSeam/erpnext` green.

### 2.8 — RED: `erpnext/transitionPolicy.test.ts` (AC-ENA-023 — update-after-submit→amend; chain-reverse cancel)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` (new). Asserts: a PMO edit to a
submitted (`docstatus=1`) PI routes to cancel+amend (never a `PUT` that would yield
`UpdateAfterSubmitError`); cancelling a PO with a submitted GR against it surfaces the
`LinkExistsError` naming the blocker (not swallowed) and does **not** mutate the PMO mirror; the policy
orders a chain cancel PR-then-PO (and PE-then-PI).
**Verify (RED):** fails.

### 2.9 — GREEN: `erpnext/transitionPolicy.ts`

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts` (new). `routeEdit(rec, docstatus)`:
`docstatus===1 && content-change → 'amend'`; `docstatus===0 → 'update'`. `cancelChain(deps)`: topological
reverse-order cancel; on `LinkExistsError` → surface (don't catch). Re-run 2.8 → GREEN.
**Verify:** passes.

### 2.10 — RED: `erpnext/lineage.test.ts` (AC-ENA-020/021/022)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` (new). Asserts:
- **AC-ENA-020** cancel (`docstatus 2`) → soft-tombstone (`erp_cancelled_at`, `erp_docstatus=2`), retain
  `external_refs`, write `external_ref_lineage(reason='cancelled')`.
- **AC-ENA-021** amend (new `name`, `amended_from`=old) → `external_refs` repoints to the new name for the
  same `pmo_record_id`, `erp_amended_from` stamped, lineage `reason='amended'`, **no duplicate mirror row**.
- **AC-ENA-022** a stale old-name `modified` event arriving AFTER the amend repointed → applies only to the
  lineage tombstone (or no-op via `erp_modified >=`), never overwrites the live amended row.
**Verify (RED):** fails.

### 2.11 — GREEN: `erpnext/lineage.ts`

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/lineage.ts` (new). `applyCancel`, `applyAmend`
(repoint + lineage insert, guarded by the unique `(org,domain,external_record_id)` so no dup mirror),
`isSupersededName(org, domain, erpName)` (index lookup on `external_ref_lineage`), and the `erp_modified`
`>=` guard helper used by the apply path. Re-run 2.10 → GREEN.
**Verify:** passes.

### 2.12 — `erpnext/adapter.ts` (the `tier:'erpnext'`, `capabilityMap:{companies,procurement}` adapter)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts` (new). `createErpAdapter(deps): Adapter` —
`commit()` dispatches by `record.erp_doc_kind` through the doctype registry; two-step create→submit;
re-fetch after submit; stamp `idempotencyKey` into `remarks`; the rate-limiter + client + binding resolved
per-org in the factory (2.13). Reads: `listChangesSinceWatermark` (modified-poll, slice 8) +
`getByExternalId`. **Verify:** `cd pmo-portal && npm run typecheck` clean.

### 2.13 — `erpnext/dispatchFactory.ts` (per-org binding + cred resolution; mirrors ClickUp's factory)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` (new). `resolveErpDispatchAdapter({
serviceClient, orgId, command, fetchImpl, apiKey, apiSecret, rateLimiter })`: `loadBinding` →
`createErpAdapter`. Creds (`apiKey`/`apiSecret`/`webhookSecret`) resolved at the **edge-fn boundary** from
`secret_ref` (vault `AS`/fn secret), passed in — never read here (NFR-ENA-SEC-002). Throws
`AppError('BINDING_NOT_ACTIVATED','config-rejected')` if `activated_at` is null. **Verify:** typecheck clean.

### 2.14 — Register the erpnext adapter in `adapter-dispatch` (inert — no org flipped)

**File:** `supabase/functions/adapter-dispatch/index.ts`. Add to `ADAPTER_REGISTRY`:
`['companies'] = resolveErpDispatchAdapter` and `['procurement'] = resolveErpDispatchAdapter` (one tier, two
domains — `routeDomainWrite` generalization). Register the ERPNext `companies`/`procurement`
`READ_MODEL_WRITERS` (filled per slice 3–6; stub `{upsert:()=>{}}` here is fine — no flip ⇒ never called).
Wire the fault-seam call between commit and mirror (`after-commit-before-mirror`) and inside submit
(`after-submit-before-mirror`) via the adapter's deps. **Verify:** `deno check index.ts` clean; `npm run verify` green.

### 2.15 — `erpnext/_shared/erpnextMirrorDeps.ts` (parameterize `_shared/clickupMirrorDeps.ts`)

**File:** `supabase/functions/_shared/erpnextMirrorDeps.ts` (new). Mirrors `clickupMirrorDeps.ts` but
`(tier='erpnext', domain, tableWriter)` — the callbacks resolve/read/write the procurement + companies
mirror tables with the `erp_modified` source-mod guard + the `erp_*` tombstone columns. Filled per slice 3–8.
**Verify:** typecheck.

### 2.16 — Full slice-2 gate

**Verify:** `cd pmo-portal && npm run verify` (full) + `scripts/with-db-lock.sh supabase test db` green. All unit ACs (011/020/021/022/023/030/031/073) green.

---

## Slice 3 — Parties flip (Supplier + Customer read-only; companies/contacts)

**Goal:** the first end-to-end ERPNext domain — non-submittable doctypes (plain CRUD, no docstatus), the
easiest proof of the multi-doctype chain. AC-ENA-003(companies)/040/041/042/072(companies). OQ-4 default:
flip both Supplier + Customer (Customer read-only).

### 3.1 — RED: `erpnext/partyAdopt.test.ts` (AC-ENA-041/042)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.test.ts` (new). Asserts:
- **AC-ENA-041** a pre-existing ERP Supplier with no PMO mapping, adopted twice "concurrently" → exactly
  one `companies` mirror + one `external_refs` (`unique(org,'companies','Supplier:<name>')`); an
  **ambiguous** match (same name, differing/absent `tax_id`) → surfaced `action-required`, never auto-merged.
- **AC-ENA-042** a party existing as both Supplier + Customer same `name` → two `companies` rows
  (`type='Vendor'` keyed `Supplier:<name>`, `type='Client'` keyed `Customer:<name>`), not merged.
**Verify (RED):** fails.

### 3.2 — GREEN: `erpnext/partyAdopt.ts` (pull-adopt + collision rule + ambiguous, FR-ENA-090..093)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts` (new). `adoptParty(org, erpParty)`:
discriminator `Supplier→type='Vendor'`, `Customer→type='Client'` (`Internal` never flipped); match by ERP
`name` + `erp_tax_id`; ambiguous → throw `action-required`. External id encodes doctype
(`Supplier:<name>`/`Customer:<name>`) so the collision rule is deterministic under the unique constraint.
Re-run 3.1 → GREEN.
**Verify:** passes.

### 3.3 — Supplier/Customer `toBody`/`fromDoc` + commands (FR-ENA-092, R9 §0)

**Files:** `erpnext/bodies/{supplier,customer}.ts`. `supplierToBody = { supplier_name }` minimal (R9 §0);
`customerToBody = { customer_name }`. `commit` for `create`/`update` (no docstatus — non-submittable).
Customer: **no write beyond party create/update** (OQ-4). Contacts: read-only mirror only
(`first_name/last_name→full_name`, `email_id→email`, `phone→phone`, link `company_id`) — FR-ENA-095, no
write command. **Verify:** typecheck + unit tests.

### 3.4 — RED: companies/contacts flip pgTAP (AC-ENA-003/072 companies)

**File:** `supabase/tests/erpnext_companies_flip_rls.test.sql` (new). Seed org A
(`companies`→`erpnext`) + org B (not flipped). Asserts: org-A user-JWT `INSERT`/`UPDATE` of a native
mirror col (`name`,`type`,`erp_supplier_name`) → `42501`; org-A service-role write → `lives_ok`; org-A user
`UPDATE` of `archived_at` (enhancement) → `lives_ok`; org-B user native write → `lives_ok` (byte-for-byte).
**Verify (RED):** fails.

### 3.5 — GREEN: migration `0096_companies_contacts_erpnext_flip.sql`

**File:** `supabase/migrations/0096_companies_contacts_erpnext_flip.sql` (re-verify number). Add the
`companies` mirror cols (`erp_party_type`, `erp_supplier_name`, `erp_customer_name`, `erp_tax_id`,
`erp_payment_terms_days`, `erp_cancelled_at`) + `contacts` mirror behavior (no new cols beyond reusing
`full_name`/`email`/`phone`; `archived_at`/`title`/`notes` stay enhancement). Per-command RLS split
following the **0093 template** (INSERT/UPDATE/DELETE gated on `not
domain_externally_owned(auth_org_id(),'companies')` for native cols; enhancement cols stay permissive;
service-role bypass on the trigger gated `service_role` claim + `domain_externally_owned`). Add the reversal
block. `stamp_org_id()`/`companies_stamp_org_id` (0074) override null/seed only — **state this per table**
(FR-ENA-171); no new trigger needed for `contacts` (0030 + 0074's blanket hardening both override null/seed
only — confirmed). Re-run 3.4 → GREEN.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f erpnext_companies_flip_rls` passes; `db reset` clean.

### 3.6 — Register `companies` read-model writer + resolver

**File:** `supabase/functions/adapter-dispatch/readModelWriters.ts` + `_shared/erpnextMirrorDeps.ts`.
`companies` writer: upsert `{name, type, erp_party_type, erp_supplier_name, erp_customer_name, erp_tax_id,
erp_payment_terms_days}`; enhancement (`archived_at`) never overwritten by the mirror. Contacts writer:
upsert `{full_name, email, phone, company_id}` (read-only). **Verify:** typecheck + deno check.

### 3.7 — RED+GREEN: served-fn e2e `AC-ENA-040-supplier-write-through.spec.ts`

**File:** `pmo-portal/e2e/AC-ENA-040-supplier-write-through.spec.ts` (new). Real served boundary
(`scripts/serve-functions.sh` + Docker v15 bench). Org flipped `companies`→`erpnext`; create a vendor in
PMO → POST `adapter-dispatch` → ERPNext `Supplier` created (body `{supplier_name}`), `companies.name` ←
`supplier_name`, `type='Vendor'`, `erp_party_type` set, `external_refs` recorded; **no `page.route`**.
Assert ERP-side `GET /api/resource/Supplier/<name>` exists. **Verify:** `scripts/with-db-lock.sh
scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test AC-ENA-040` → green.

### 3.8–3.12 — FE wiring + pull-adopt onboarding + contacts read + gates

**3.8** `repositories/company.ts`: route create/update on `routeDomainWrite('companies')` (slice 1.10
already stubbed; fill the dispatch payload). **3.9** `erpnext-onboard`-style pull-adopt edge fn
(`supabase/functions/erpnext-onboard/index.ts`) — enumerate ERP Supplier/Customer → `adoptParty` (idempotent).
**3.10** Contacts read mirror in the sweep (slice 8 wires the full feed; here the read path is proven).
**3.11** Confirm `Internal`-type companies are never flipped (policy guard in the adapter). **3.12** Full
slice gate.
**Verify each:** unit/e2e green.

**Slice 3 final gate:** `npm run verify` (full) + `with-db-lock supabase test db` + the AC-ENA-040 served-fn e2e.

---

## Slice 4 — Material Request + RFQ + Supplier Quotation (first submittable doctypes)

**Goal:** the first procurement sub-doctypes with the transition op; prove the one-selected invariant
survives the flip; procurement_items + 3 record tables flip. AC-ENA-003(procurement)/050/051.

### 4.1 — RED: procurement_items + purchase_requests/rfqs/quotations flip pgTAP (AC-ENA-003/072 procurement)

**File:** `supabase/tests/erpnext_procurement_flip_rls.test.sql` (new). Mirrors 3.4 for the procurement
record tables + items. Critical item: `procurement_items.amount` (GENERATED) is **never** service-role
written — assert a service-role write that sets `erp_line_amount` (NOT `amount`) → `lives_ok`, and the
generated `amount` is unaffected; a user native write → `42501`. Assert `procurement_quotations.is_selected`
stays user-writable + the `procurement_quotations_one_selected_idx` intact under flip.
**Verify (RED):** fails.

### 4.2 — GREEN: migration `0097_procurement_items_pr_rfq_sq_flip.sql`

**File:** `supabase/migrations/0097_…` (re-verify number). Add to `procurement_items`: `erp_line_amount
numeric(14,2)`, `erp_docstatus smallint`, `erp_modified text`, `erp_amended_from text`, `erp_cancelled_at
timestamptz`. Add the `erp_*` mirror cols to `purchase_requests`, `rfqs`, `procurement_quotations`. Per
0093-template RLS: native mirror cols machine-only under `domain_externally_owned(…,'procurement')`;
`procurement_quotations.is_selected` + `procurements` (case aggregate) stay user-writable
(FR-ENA-101/130/170). **`procurement_items.amount` is GENERATED — never add it to any service-role
write** (FR-ENA-071). Reversal block. Re-run 4.1 → GREEN.
**Verify:** pgTAP passes; `db reset` clean.

### 4.3 — `materialRequest`/`rfq`/`supplierQuotation` registry wiring (R9 bodies from 2.7)

Wire 2.7's `toBody`/`fromDoc` into `DOCTYPE_REGISTRY`. `materialRequest`: `material_request_type='Purchase'`,
company from binding; qty>0 client pre-check (FR-ENA-110). `rfq`: supplier + items via `external_refs`.
`supplierQuotation`: `grand_total→total_amount` (oracle), `valid_till→valid_until`; `is_selected` is
PMO-only (never sent to ERP). **Verify:** unit tests for each `toBody`/`fromDoc`.

### 4.4 — Transition op for submittable doctypes (submit = `PUT {docstatus:1}`, two-step)

`erpnext/adapter.ts` `commit('transition', {verb:'submit'})` → two-step insert→submit + re-fetch
(FR-ENA-044/117). Client pre-validates non-empty `items` (the 500-TypeError guard, FR-ENA-042). **Verify:** unit.

### 4.5 — Register procurement read-model writers (pr/rfq/quotation/items)

`readModelWriters.ts` + `erpnextMirrorDeps.ts`: upsert `purchase_requests` (`pr_number`, `erp_docstatus`,
`erp_modified`), `rfqs`, `procurement_quotations` (`total_amount`, `valid_until`, `vq_number`),
`procurement_items` (`quantity`,`rate`,`erp_line_amount` — NOT `amount`). **Verify:** typecheck.

### 4.6 — RED+GREEN: served-fn e2e `AC-ENA-050-purchase-request.spec.ts`

Real boundary: create+submit a PR → ERP `Material Request` (purchase) two-step → `purchase_requests`
mirrors (`pr_number`, `erp_docstatus`) + `external_refs`. **Verify:** `… npx playwright test AC-ENA-050` green.

### 4.7 — RED+GREEN: served-fn e2e `AC-ENA-051-rfq-quotation.spec.ts`

Real boundary: one RFQ + two Supplier Quotations pushed; select one in PMO → ERP holds the native docs,
`procurement_quotations.total_amount` mirrors ERP `grand_total`, **exactly one** `is_selected=true` per
`procurement_id` (`procurement_quotations_one_selected_idx` intact). **Verify:** green.

### 4.8–4.11 — FE routing for procurement record creates + the invariant gate

**4.8** `repositories/procurement.ts` create* methods route on `routeDomainWrite('procurement')` (slice
1.10 stub; fill dispatch payloads with `erp_doc_kind`). **4.9** Confirm `transition_procurement` RPC stays
the PMO path (case aggregate status is PMO-derived, FR-ENA-101). **4.10** Adapter derives record-table
`status` CHECK from `erp_docstatus` (Draft/Submitted/…). **4.11** Full slice gate.
**Verify:** `npm run verify` + pgTAP + the two served-fn e2e.

---

## Slice 5 — Purchase Order + Goods Receipt (cross-doctype ref resolution)

**Goal:** PO + GR with cross-doctype ref resolution incl. the **PO item child-row `name`**. AC-ENA-052.

### 5.1 — RED+GREEN: pgTAP `erpnext_po_receipts_flip_rls.test.sql` + migration `0098_purchase_orders_receipts_flip.sql`

Mirror 4.1/4.2 for `purchase_orders` + `procurement_receipts`. Native mirror cols (`po_number`, `amount`,
`gr_number`, `receipt_date`, `reference_number`, `po_id`, `erp_*`) machine-only; `po_id` FK preserved
(FR-ENA-130c). Reversal block. **Verify:** pgTAP green; `db reset` clean.

### 5.2 — `purchaseOrder`/`goodsReceipt` registry wiring (R9 §3/§4 bodies from 2.7)

`poToBody`: item-row `schedule_date` mandatory (R9 §3). `grToBody`: `purchase_order` + `purchase_order_item`
(the PO item **child-row `name`**, fetched from the PO doc) per row (R9 §4). **Verify:** unit tests for both bodies.

### 5.3 — Multi-domain ref resolver: resolve Supplier + PO + PO-item-child-row (FR-ENA-103)

`erpnext/dispatchFactory.ts` + `resolveExternalRef`: a GR command resolves the supplier (companies domain),
the PO `name` (procurement domain), AND fetches the PO doc to extract the matching item's child-row `name`
for `purchase_order_item`. Never a raw PMO id. **Verify:** unit (mocked PO doc).

### 5.4 — Register po/receipt read-model writers

`purchase_orders` (`po_number`, `amount`←`grand_total` oracle, `erp_*`); `procurement_receipts`
(`gr_number`, `po_id`←ERP PO link, `reference_number`←supplier delivery-note, `erp_*`). **Verify:** typecheck.

### 5.5 — RED+GREEN: served-fn e2e `AC-ENA-052-po-gr.spec.ts`

Real boundary: create+submit PO (item-row `schedule_date` supplied) → ERP `To Receive and Bill`; then GR
(carrying `purchase_order` + `purchase_order_item`) → submit → PO flips `To Bill`/`per_received:100`; PMO
mirrors `purchase_orders` + `procurement_receipts.po_id`. Adapter resolves ERP ids via `external_refs`.
**Verify:** green.

### 5.6–5.9 — FE routing + status derivation + gate

**5.6** `repositories` PO/GR creates route on `routeDomainWrite('procurement')`. **5.7** PO status CHECK
derived; GR `procurement_receipt_status` derived. **5.8** `payments.invoice_id` / `procurement_receipts.po_id`
FK integrity under service-role write (the same-case invariant holds — adapter resolves within the case).
**5.9** Full slice gate.
**Verify:** `npm run verify` + pgTAP + the served-fn e2e.

---

## Slice 6 — Purchase Invoice + Payment Entry + full AP command surface + outbox-backed money e2e (the R1/R2/R3 heart)

**Goal:** the R9-frozen AP flow with the full command surface (create/update-draft + submit/cancel/amend on
PI; create+submit + cancel on PE) + the **outbox-backed money e2e at the real served boundary** with the
`after-commit-before-mirror` fault seam. AC-ENA-053 + the money-flip pgTAP (AC-ENA-072 money).

### 6.1 — RED+GREEN: pgTAP `erpnext_money_flip_rls.test.sql` + migration `0099_invoices_payments_flip.sql`

`procurement_invoices` mirror cols: add `erp_outstanding_amount numeric(14,2)`, `erp_docstatus`,
`erp_modified`, `erp_amended_from`, `erp_cancelled_at` (it already has `amount`, `reference_number`,
`vi_number`, `po_id` from 0040/0035). `payments` mirror cols: `erp_*`. Native mirror machine-only;
`payments.invoice_id` FK + same-case invariant preserved (FR-ENA-130d); `*_amount_nonneg` CHECKs preserved
(FR-ENA-072 nulls→NULL). This migration also finalizes `procurement_items.erp_line_amount` usage. Reversal
block. **Verify:** pgTAP green; `db reset` clean.

### 6.2 — `purchaseInvoice`/`paymentEntry` registry wiring (R9 §1/§2 frozen bodies from 2.7)

`piToBody` (R9 §1): `{supplier, items:[{item_code,qty,rate}]}`; ERP server-defaults `credit_to`,
`posting_date`/`due_date`, totals. `peToBody` (R9 §2 frozen): the adapter supplies `paid_from`/`paid_to`
from binding `config` (`default_cash_account`/`default_bank_account`→`paid_from`;
`default_payable_account`→`paid_to`), `received_amount` explicit, `references[]` to the PI. Client
pre-validates non-empty items (the 500-TypeError guard). **Verify:** unit tests asserting the exact bodies.

### 6.3 — AP command surface (FR-ENA-115/116, OQ-7 full surface)

PI: `create` + `update` (draft) + `transition{submit|cancel|amend}`. PE: `create`+`submit` (two-step) +
`cancel` (amend is desk-only in P2). Amend = cancel + create-with-`amended_from` (lineage module from 2.11).
After a referenced-PE submit → re-fetch the PI → mirror `erp_outstanding_amount` (R9 paid-detection: PI
flips `Paid`/`outstanding 0` server-side). **Verify:** unit tests per transition.

### 6.4 — Outbox integration into the dispatch for money commands (wire ADR-0057)

`adapter-dispatch/index.ts`: when `command.idempotencyKey` set, route through `dispatchMoneyWrite` (slice
1.5). The outbox `readOutbox`/`insertOutboxPending`/`markOutbox*` callbacks operate on
`external_command_outbox` via the service client. The adapter stamps the key into the doctype `remarks`
(`toBody` appends `idempotencyKey`). **Verify:** unit (mocked service client) — the full reconcile state machine.

### 6.5 — Register invoice/payment read-model writers

`procurement_invoices` (`vi_number`, `amount`←`grand_total` oracle, `erp_outstanding_amount`, `po_id`,
`reference_number`←`bill_no`, `erp_*`); `payments` (`pay_number`, `amount`←`paid_amount`/`allocated_amount`
oracle, `invoice_id`←resolved PI, `reference_number`, `erp_*`). **Verify:** typecheck.

### 6.6 — RED+GREEN: served-fn e2e `AC-ENA-053-pi-payment.spec.ts` (the AP flow, real boundary)

Real boundary: create+submit a PI (non-empty items) → ERP commits; then create+submit a PE
(adapter-supplied `paid_from`/`paid_to`, `references[]` to the PI) → PI flips `Paid`/`outstanding 0`
(mirrored); `payments.amount` = allocated; `payments.invoice_id` links the PI in the same case. **No
`page.route`.** **Verify:** green.

### 6.7 — RED+GREEN: served-fn e2e `AC-ENA-010-payment-idempotency.spec.ts` (R1/R3, the fault seam)

Real boundary + `ERPNEXT_TEST_FAULTS=1` + header `x-erpnext-test-fault: after-commit-before-mirror`: a PE
command with an `idempotencyKey` whose ERP commit succeeds but the function's response path is interrupted
**server-side**; retry the exact command → ERPNext holds **one** PE, the outbox reconciles
(pending/committed→confirmed via the `remarks`-key probe or committed-finalize), PMO holds **one** `payments`
mirror row, no duplicate. **Verify:** green.

### 6.8 — RED+GREEN: served-fn e2e `AC-ENA-013-pi-recovery-adopt.spec.ts` (R3 recovery)

Real boundary + `after-commit-before-mirror`: a PI whose ERP create committed but the outbox is left
`pending`/`committed`; the sweep/retry runs → adopts the existing ERP doc (via `committed` finalize or the
`remarks`-key probe) and finishes **one** `procurement_invoices` mirror row — never a second. **Verify:** green.

### 6.9–6.14 — FE routing + cancel/amend e2e + status derivation + same-case invariant + gates

**6.9** `repositories` invoice/payment creates route on `routeDomainWrite('procurement')`. **6.10** PI
cancel/amend served-fn flow (lineage repoint + tombstone). **6.11** PE cancel served-fn flow. **6.12** PI
status derived (`erp_outstanding_amount==0`⇒Paid). **6.13** `create_payment` same-case invariant under
service-role write (FR-ENA-130d). **6.14** Full slice gate.
**Verify:** `npm run verify` (full) + `with-db-lock supabase test db` + the 3 served-fn money e2e.

---

## Slice 7 — Actuals + AP/AR aging read-only snapshots (ADR-0048 ledger-sourced)

**Goal:** read-only accounting read-backs — actuals from `GL Entry` summation; AP/AR aging from the
report RPC primary (pinned filters) with the mirrored-ledger fallback; **never invoice-only local math**
(FR-ENA-162 prohibition). AC-ENA-060/061.

### 7.1 — RED+GREEN: migration `0100_erp_accounting_snapshots.sql` + pgTAP

Three snapshot tables per spec §4.4 (`erp_actuals_snapshot`, `erp_ap_aging_snapshot`,
`erp_ar_aging_snapshot`) — org-scoped, machine-written, org-member SELECT, snapshot-replacement per scope
(`snapshot_id` + delete-prior-scope-in-tx). `numeric(14,2)` buckets; `range_labels jsonb`; provenance cols
(`as_of`, `source_report`, `report_version`). pgTAP: org isolation + machine-only write +
single-snapshot-per-scope after refresh. Reversal block. **Verify:** pgTAP green; `db reset` clean.

### 7.2 — RED: `erpnext/actualsSnapshot.test.ts` (AC-ENA-060)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts` (new). Asserts: from mirrored
`GL Entry` rows (`is_cancelled=0`, exclude `docstatus=2`), `refreshActuals` produces
`erp_actuals_snapshot` sums only (no PMO-authored figure), **replaces** the prior scope snapshot (single
`as_of`), stamps `source_report`/`as_of`. **Verify (RED):** fails.

### 7.3 — GREEN: `erpnext/actualsSnapshot.ts`

`refreshActuals(serviceClient, orgId, scope)`: sum mirrored GL rows → new `snapshot_id` → delete prior
scope rows in-tx → insert. **Verify:** passes.

### 7.4 — RED+GREEN: `erpnext/agingSnapshot.ts` (report-RPC primary, FR-ENA-160/161/162)

`refreshAging`: `POST /api/method/frappe.desk.query_report.run` (`report_name:'Accounts
Payable'|'Accounts Receivable'`, filters from binding `config.report_filter_shape` — version-pinned via
`get_script` introspection, R10). Mirror returned buckets + `range_labels` verbatim. **Fallback (only if
the report-shape probe fails for a minor):** bucket **mirrored `GL Entry`/`Payment Ledger Entry`** rows
(also ERP truth) — **NEVER** `procurement_invoices` `due_date−today` math (the FR-ENA-162 prohibition).
`report_version` stamped. Snapshot-replace per scope. **Verify:** unit (mocked report RPC + the fallback).

### 7.5 — Sweep fan-out: actuals + aging refresh per employing org

`erpnext-sweep` (slice 8) calls `refreshActuals` + `refreshAging` per org after the doctype sweep. Binding
config carries `aging_report_names` + `report_filter_shape`. **Verify:** unit.

### 7.6 — RED+GREEN: served-fn e2e `AC-ENA-061-aging-readback.spec.ts`

Real boundary: an ERPNext org with open AP/AR → refresh → `erp_ap_aging_snapshot`/`erp_ar_aging_snapshot`
hold report-backed buckets with `report_date`/`range_labels`/`ageing_based_on`/`as_of`/`report_version`,
snapshot-replaced, and **no** bucket computed by invoice-only local math (assert the
`erp_ap_aging_snapshot` row count == report row count; assert no `procurement_invoices`-derived bucket
column exists). **Verify:** green.

### 7.7–7.9 — Read path + provenance UI + gate

**7.7** Repository read for the snapshot tables (org-scoped SELECT). **7.8** UI shows `as_of`/source
provenance (read-only). **7.9** Full slice gate.
**Verify:** `npm run verify` + pgTAP + the served-fn e2e.

---

## Slice 8 — Webhooks-as-hints + modified-poll sweep + cancel/amend lineage feed

**Goal:** the change-feed — ERPNext webhook ingress (HMAC) + the modified-poll reconciliation sweep
(convergence authority) — wiring the lineage module (slice 2.11) into the apply path. AC-ENA-070/071.

### 8.1 — RED: `erpnext-webhook/index.test.ts` (AC-ENA-070 — HMAC is the trust boundary)

**File:** `supabase/functions/erpnext-webhook/index.test.ts` (new, Deno test). Asserts: invalid/absent
`X-Frappe-Webhook-Signature` (vs `base64(HMAC-SHA256(secret, raw_body))`) → `401`, no side effect; valid →
applied as a hint (idempotent, source-mod-guarded). **Verify (RED):** fails.

### 8.2 — GREEN: `supabase/functions/erpnext-webhook/index.ts`

Verify HMAC over the **raw body** (constant-time compare — reuse `_shared/constantTimeBearerEquals.ts`);
resolve binding by org/site; if valid → `applyWebhookEvent` (the hoisted engine from slice 1.12,
parameterized `tier='erpnext'`, domain from the payload doctype). Lossy hint semantics (FR-ENA-083).
**Verify:** passes.

### 8.3 — RED: `erpnext/sweepCursor.test.ts` (AC-ENA-071 — inclusive, deduped, out-of-order-guarded)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.test.ts` (new). Asserts: two ERP changes
sharing a `modified` timestamp at the watermark boundary both seen exactly once (inclusive `>=` + dedupe by
ERP `name`); watermark advances to max `modified` (monotonic); a later older change is a no-op via the
per-row `erp_modified >=` guard (FR-ENA-053/080/081). **Verify (RED):** fails.

### 8.4 — GREEN: `erpnext/sweepCursor.ts` + wire `runSweep` (modified-poll, FR-ENA-080..084)

`listChangesSinceWatermark`: `GET /api/resource/<DocType>?filters=[["modified",">=","<cursor>"]]&limit_page_length=…`
page until short page; `nextCursor`=max `modified`; dedupe by `name`. `runSweep` (hoisted, slice 1.12)
applies each through the source-mod-guarded full-row upsert. Per-org × per-doctype watermark on
`external_sync_watermarks` (the `modified` string). **Verify:** passes.

### 8.5 — Lineage wired into the apply path (cancel/amend feed, FR-ENA-052/053)

The apply path: a `docstatus:2` event → `applyCancel` (tombstone + lineage); an `amended_from` event →
`applyAmend` (repoint + lineage); a stale old-name event → `isSupersededName` check → no-op. All full-row
upserts (FR-ENA-073). **Verify:** unit (cancel/amend/out-of-order through the full apply path).

### 8.6 — `supabase/functions/erpnext-sweep/index.ts` (the cron entry)

Iterate employing orgs × doctypes → `runSweep` → then `refreshActuals`/`refreshAging` (slice 7). Interactive
priority over bulk (NFR-ENA-PERF-001). **Verify:** deno check + unit.

### 8.7 — migration `0101_erpnext_sweep_cron.sql` (mirror 0094)

`pg_cron` schedule for `erpnext-sweep` (idle-until-configured — no employing org ⇒ no-op). Reversal: drop
the schedule. **Verify:** `db reset` clean.

### 8.8 — Permission-doctrine precondition check (FR-ENA-084, R13)

Binding activation asserts the integration user has full **read** perms on the flipped doctypes + reports
(a probe at activation; warn + refuse if not). PMO RLS stays the user-facing authority. **Verify:** unit.

### 8.9 — Full slice gate + final program gate

**Verify:** `cd pmo-portal && npm run verify` (full) + `scripts/with-db-lock.sh supabase test db` (full
pgTAP) + `scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright
test` (all served-fn e2e). This is the AC-ENA-002 program-final regression gate.

---

## 4. AC traceability (AC → slice → task → owning test file @ layer — self-verified vs spec §9)

| AC | Slice | Task(s) | Owning test file @ layer (matches spec §9) |
|---|---|---|---|
| AC-ENA-001 | 1 | 1.1,1.10 | `pmo-portal/src/lib/repositories/procurement.external.test.ts` [Vitest unit] |
| AC-ENA-002 | every | final gate | full `npm run verify` + pgTAP + e2e suite (meta-AC) [cross-layer regression gate] |
| AC-ENA-003 | 3,4 | 3.4,4.1 | `supabase/tests/erpnext_procurement_flip_rls.test.sql` (+ companies) [pgTAP] |
| AC-ENA-010 | 6 | 6.7 | `pmo-portal/e2e/AC-ENA-010-payment-idempotency.spec.ts` [served-fn e2e] |
| AC-ENA-011 | 2 | 2.1,2.2 | `pmo-portal/src/lib/adapterSeam/erpnext/client.test.ts` [Vitest unit] |
| AC-ENA-012 | 1 | 1.7,1.8 | `supabase/tests/external_command_outbox_rls.test.sql` [pgTAP] |
| AC-ENA-013 | 6 | 6.8 | `pmo-portal/e2e/AC-ENA-013-pi-recovery-adopt.spec.ts` [served-fn e2e] |
| AC-ENA-020 | 2 | 2.10,2.11 | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` [Vitest unit] |
| AC-ENA-021 | 2 | 2.10,2.11 | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` [Vitest unit] |
| AC-ENA-022 | 2 | 2.10,2.11 | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` [Vitest unit] |
| AC-ENA-023 | 2 | 2.8,2.9 | `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` [Vitest unit] |
| AC-ENA-030 | 2 | 2.6 | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` [Vitest unit] |
| AC-ENA-031 | 2 | 2.6 | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` [Vitest unit] |
| AC-ENA-040 | 3 | 3.7 | `pmo-portal/e2e/AC-ENA-040-supplier-write-through.spec.ts` [served-fn e2e] |
| AC-ENA-041 | 3 | 3.1,3.2 | `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.test.ts` [Vitest unit] |
| AC-ENA-042 | 3 | 3.1,3.2 | `pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.test.ts` [Vitest unit] |
| AC-ENA-050 | 4 | 4.6 | `pmo-portal/e2e/AC-ENA-050-purchase-request.spec.ts` [served-fn e2e] |
| AC-ENA-051 | 4 | 4.7 | `pmo-portal/e2e/AC-ENA-051-rfq-quotation.spec.ts` [served-fn e2e] |
| AC-ENA-052 | 5 | 5.5 | `pmo-portal/e2e/AC-ENA-052-po-gr.spec.ts` [served-fn e2e] |
| AC-ENA-053 | 6 | 6.6 | `pmo-portal/e2e/AC-ENA-053-pi-payment.spec.ts` [served-fn e2e] |
| AC-ENA-054 | 1 | 1.9 | `supabase/tests/external_refs_adopt_unique.test.sql` [pgTAP] |
| AC-ENA-060 | 7 | 7.2,7.3 | `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts` [Vitest unit] |
| AC-ENA-061 | 7 | 7.6 | `pmo-portal/e2e/AC-ENA-061-aging-readback.spec.ts` [served-fn e2e] |
| AC-ENA-070 | 8 | 8.1,8.2 | `supabase/functions/erpnext-webhook/index.test.ts` [Vitest unit] |
| AC-ENA-071 | 8 | 8.3,8.4 | `pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.test.ts` [Vitest unit] |
| AC-ENA-072 | 3,4,6 | 3.4,4.1,6.1 | `supabase/tests/erpnext_money_flip_rls.test.sql` (+ per-table §7 files) [pgTAP] |
| AC-ENA-073 | 2 | 2.3,2.4 | `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts` [Vitest unit] |

**Coverage check:** all 27 `AC-ENA-` are mapped (001–003, 010–013, 020–023, 030–031, 040–042, 050–054,
060–061, 070–073). Every AC's owning test file matches spec §9 byte-for-byte; no AC changed layer.
**NFR coverage:** NFR-ENA-IDEM-001→AC-010/013 · DOC-001→AC-021/022 · MONEY-001→AC-030/031 ·
FEED-001→AC-071 · SEC-003/004→AC-072 · the structural NFRs (SEC-001/002, CONTRACT-001, PERF-001/002,
REV-001, DEVBED-001) proven transitively per spec §9 note + reviewed at each slice gate.

---

## 5. Final gates per slice (binding — run the WHOLE suite, never just touched files)

Every slice PR to `dev` closes with ALL of:
1. `cd pmo-portal && npm run verify` (= `typecheck && lint:ci && test && build`) — **full**, mirrors CI's `verify` job.
2. `scripts/with-db-lock.sh supabase test db` — **full** pgTAP (never just the new file).
3. Where the slice owns a served-fn e2e (slices 0,3,4,5,6,7): `scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test <AC-ENA-###>` against the Docker v15 bench (`http://localhost:8080`, creds in `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md`).
4. AC-ENA-002 (zero-regression): the unchanged existing procurement/companies/tasks suite stays green — the gate, not a new test.

**Branch flow (binding):** each slice is a feature branch → PR to `dev` (verify-only fast lane) → promoted
to `main` (verify + integration: pgTAP + served-fn e2e + visual gates). **Never promote to `production`**
without a direct owner instruction.

---

## 6. Open questions for the Director (none blocking slice 0–2)

1. **Report-filter introspection timing (R10):** the `get_script` probe to pin `config.report_filter_shape`
   runs against the bench at slice 7. If the report shape differs from the R9-bench v15.94.3, the fallback
   (mirrored-ledger bucketing) is already designed (FR-ENA-162) — flag if the owner wants the probe
   promoted to a pre-slice-7 spike.
2. **PE amend (OQ-7 residual):** spec keeps PE amend desk-only in P2. If finance wants PE amend as a PMO
   command later, it's an additive slice (cancel+create-with-`amended_from`, same lineage path) — no schema change.
3. **`erp_doc_kind` as the contract discriminator:** this plan uses a PMO-side `erp_doc_kind` field on
   `PmoRecord` (PMO verbs) rather than adding a `subType` to `AdapterCommand` (which would widen the P0
   contract). Confirm acceptable — it keeps the contract change to `idempotencyKey` only (FR-ENA-040).
4. **Collision-guard script:** `scripts/next-migration-number.sh` (slice 0.9) is new tooling; if the owner
   prefers it lands separately on `dev` first, slice 0 drops 0.9 with no dependency loss.

---

## 7. ADRs (this issue)

- **`docs/adr/0057-erpnext-money-idempotency-outbox.md` (NEW)** — the money-idempotency contract extension
  (`idempotencyKey` on `AdapterCommand`) + the durable `external_command_outbox` provisional-ref + the
  atomic recovery algorithm (R1/R3). Money-safety, irreversible once shipped ⇒ ADR. (Full text written
  alongside this plan, task 1.13.)

PLAN-DONE
