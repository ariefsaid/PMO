# Plan: ERPNext adapter — money core (Issue P2, ADR-0055 P2 phase)

> **Spec:** `docs/specs/erpnext-adapter.spec.md` (**SIGNED OFF** — 59 `FR-ENA-` / 14 `NFR-ENA-` / 27
> `AC-ENA-`; OQ-1/3/4/7 DECIDED at the specced defaults: Material Request · report-RPC aging primary ·
> Supplier+Customer(read-only) parties · full AP command surface. OQ-2/5/6/8 resolved in-spec — do NOT
> re-litigate.)
> **ADRs:** ADR-0055 (binding adapter architecture), **ADR-0048** (ERPNext = accounting engine; the
> ledger-sourced-display rule — PMO never recomputes externally-read figures), **ADR-0058 (NEW — this
> issue)** the money-idempotency outbox + atomic recovery algorithm (`docs/adr/0058-erpnext-money-idempotency-outbox.md`).
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
> Renumber consistently. (A separate `scripts/next-migration-number.sh` collision guard is owned by a
> different session per the Director ruling — builders here just re-verify numbers manually; this plan
> does **not** add that script.)
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
                                 └─ money (idempotencyKey set, ADR-0058)
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
2. **Money idempotency = a durable outbox + atomic recovery (ADR-0058; R1/R3).** `AdapterCommand` gains
   `idempotencyKey?: string` (P0/P1 ignore it). A non-read-only money command writes an
   `external_command_outbox` row `state='pending'` **before** `adapter.commit()`; the unique 4-tuple
   `(org,domain,pmo_record_id,idempotency_key)` makes a concurrent duplicate fail atomically (`23505`). The
   adapter stamps the key into the doctype's `remarks` so a recovery probe (`GET …?filters=[["remarks","like","%<key>%"]]`)
   can find an orphaned commit. A retry reconciles by outbox `state` (confirmed→return / committed→finalize
   only / pending|failed→probe-then-maybe-reissue) — **never a blind second create** (FR-ENA-043). **A stale
   `committing` row is NEVER reclaimed+re-POSTed** (its ERP write may be in flight, unseen by the probe →
   duplicate); it is **quarantined** (`quarantine_committing`, fenced) with a `reconcile_after` visibility
   window and resolved only by the reconciliation path once the window elapses (probe → adopt the in-flight
   POST, or with no ERP hit reissue under the same key). The finalization is **generation-guarded** (re-verify
   the fencing token immediately before the mirror/ref writes) and mirrors the adapter's **real returned
   `canonical`** (persisted on the outbox row at commit), not a `{id}` stub.
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
| **0** | Served-fn e2e infra: serve wrapper + CI lane + health gate + config.toml:410 comment fix + Docker-v15 bench docs + named fault seams in `adapter-dispatch` | (enables 010/013/040/050/051/052/053/061) | — | 0.1–0.8 |
| **1** | Seam generalization: `idempotencyKey` on `AdapterCommand`; `external_org_bindings` + `external_command_outbox` + `external_ref_lineage`; money-dispatch + atomic recovery; multi-domain read-model-writer registry + resolver; `routeDomainWrite`; **byte-for-byte regression net EARLY** | 001,002,012,054 | `0095_erpnext_seam_tables.sql` | 1.1–1.14 |
| **2** | ERPNext tier core: `erpnext/client.ts` (token auth, `exc_type`/`_server_messages` classifier incl. the 500-`TypeError` non-retryable bucket, 429/`Retry-After` backoff w/ no-blind-retry guard); doctype registry; version-handshake binding; decimal-string money shape; transition policy; lineage module | 011,020,021,022,023,030,031,073 | — | 2.1–2.16 |
| **3** | Parties flip: Supplier + Customer(read-only) create/update + pull-adopt + ambiguous-match + collision-two-rows + `contacts` mirror + companies/contacts flip migration + pgTAP; supplier write-through served-fn e2e | 003(companies),040,041,042,072(companies) | `0096_companies_contacts_erpnext_flip.sql` | 3.1–3.12 |
| **4** | MR + RFQ + Supplier Quotation: first submittable doctypes; procurement_items + purchase_requests + rfqs + procurement_quotations flip migration + pgTAP; one-selected invariant preserved; PR→MR + RFQ/SQ served-fn e2e | 003(procurement),050,051 | `0097_procurement_items_pr_rfq_sq_flip.sql` | 4.1–4.11 |
| **5** | PO + GR: cross-doctype ref resolution incl. the PO item child-row `name`; purchase_orders + procurement_receipts flip migration + pgTAP; PO+GR served-fn e2e | 052 | `0098_purchase_orders_receipts_flip.sql` | 5.1–5.9 |
| **6** | PI + Payment Entry + full AP command surface (R9 frozen): create/update-draft + submit/cancel/amend on PI; create+submit + cancel on PE; procurement_invoices + payments flip migration + pgTAP; **outbox-backed money e2e at the real boundary** (after-commit-before-mirror PE idempotency; PI recovery-adopt) | 053,072(money) | `0099_invoices_payments_flip.sql` | 6.1–6.14 |
| **7** | Actuals + AP/AR aging read-only snapshots: report-RPC primary (pinned filters) + **mirrored-ledger** fallback over the `erp_gl_entry_mirror`/`erp_payment_ledger_mirror` read-model (never invoice-only math); 2 ledger-mirror tables + 3 snapshot tables + snapshot-replace + provenance; aging served-fn e2e | 060,061 | `0100_erp_accounting_snapshots.sql` | 7.1–7.9 |
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

### 0.3 — CI integration-lane: served-fn step after `db reset` (ERPNext money e2e scoped local-only)

**File:** `.github/workflows/ci.yml` — the **`integration`** job (the PR→`main` gate; there is no
`integration.yml`). After the existing `Reset DB (migrations + seed)` step and before `E2E tests`, insert:

```yaml
      # ERPNext P2: prove the served adapter-dispatch lane in CI (the money e2e itself is local-only —
      # it needs the Docker v15 bench + 1Password creds, which are a dev-bed concern, not CI's). The CI
      # gate is the non-ERPNext served-fn smoke (AC-ENA-001 boundary) through real Kong, proving the
      # serve/health-gate recipe holds on an ephemeral runner. Money semantics run locally + via unit tests.
      - name: Serve adapter-dispatch (served-fn lane smoke)
        run: |
          printf '%s\n' "$SUPABASE_SECRETS" > /tmp/fn-secrets.env
          supabase functions serve adapter-dispatch --no-verify-jwt --env-file /tmp/fn-secrets.env >/tmp/functions-serve.log 2>&1 &
          CLI_PID=$!
          for i in $(seq 1 60); do curl -sf http://localhost:54321/functions/v1/health >/dev/null && break || sleep 2; done
          curl -sf http://localhost:54321/functions/v1/health >/dev/null || { echo "functions did not become healthy"; cat /tmp/functions-serve.log; kill $CLI_PID; exit 1; }
          # run the non-ERPNext served-fn smoke (no bench dependency)
          cd pmo-portal && SUPABASE_FUNCTIONS_URL=http://localhost:54321 npx playwright test served-fn-smoke --project=chromium
          kill $CLI_PID 2>/dev/null || true
          docker rm -f supabase_edge_runtime_pmo-portal >/dev/null 2>&1 || true
```

`SUPABASE_SECRETS` is a GH secret (vault `AS`-sourced; the same `ERPNEXT_TEST_FAULTS` stays unset in CI so
faults are inert). The full **ERPNext money e2e** (slices 3–7, `AC-ENA-040/050/051/052/053/061`) is
**local-only** against the Docker v15 bench (`scripts/with-erpnext-lock.sh` + `scripts/serve-functions.sh`,
creds in `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md`); its money-idempotency logic is additionally
covered by the Vitest unit tests (1.4/2.x) that DO run in CI. So the CI lane is reproducible and
bench-free, while every money AC still has an owning proof (unit in CI + served-fn locally).
**Verify:** the `integration` job runs on the next PR→`main`; the served-fn smoke step is green in the run log.

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
This is the CI-gated proof (0.3 runs it) and the local dev proof (`scripts/serve-functions.sh`).
**Verify:** `scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test served-fn-smoke` → green.

**Slice 0 final gate:** `cd pmo-portal && npm run verify` (full) green; `scripts/with-db-lock.sh supabase
test db` green; `scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test served-fn-smoke` green. No DB migration this slice ⇒ no pgTAP band beyond the existing suite.

> *(Task 0.9 — the `scripts/next-migration-number.sh` collision guard — is **removed** per the Director
> ruling: that guard is built in a separate session. Builders re-verify migration numbers manually with
> `ls supabase/migrations | tail -3`, as the header note states. Slice 0 is now 0.1–0.8.)*

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

### 1.2 — `idempotencyKey` on `AdapterCommand` (FR-ENA-040) — additive TYPE; server ENFORCES it for erpnext money

**File:** `pmo-portal/src/lib/adapterSeam/contract.ts`. Add an optional field — optional **in the type** so
P0/P1 never set it ⇒ their behavior is byte-for-byte unchanged. (Enforcement is server-side at the
dispatch boundary — task 1.5/6.4 — NOT in the shared type, so the P0/P1 reference/ClickUp paths that share
this contract are untouched.)

```ts
export interface AdapterCommand {
  domain: PmoDomain;
  operation: AdapterOperation;
  record: PmoRecord;
  /** Client-generated per non-read-only ERPNext money command (FR-ENA-040). P0/P1 ignore it.
   *  REQUIRED for non-read-only `erpnext`-tier commands — enforced server-side in adapter-dispatch
   *  (rejects a missing key as commit-rejected/missing-idempotency-key before the outbox is touched). */
  idempotencyKey?: string;
}
```
**Verify:** `cd pmo-portal && npm run typecheck` → 0 errors.

### 1.3 — RED+GREEN: `routeDomainWrite(domain)` (generalize ADR-0056 cache, FR-ENA-005)

**RED file:** `pmo-portal/src/lib/adapterSeam/ownershipCache.test.ts` (extend the existing P1 test).
Add: `routeDomainWrite('procurement')` / `routeDomainWrite('companies')` return `'external'` when the
map positively asserts that domain→some tier, and `'pmo'` on a cold/absent map (fail-closed,
FR-ENA-005); the existing `routeTaskWrite()` assertions still pass (back-compat).
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/ownershipCache.test.ts` → fails
(`routeDomainWrite` absent).

**GREEN file:** `pmo-portal/src/lib/adapterSeam/ownershipCache.ts`. The shipped cache (`OwnershipMap =
Record<domain, externalTier>`) is **already domain-keyed** — `setTaskOwnership` builds `{[domain]:
externalTier}`, so generalization is the `routeDomainWrite(domain)` addition only (the setter is reused
unchanged):

```ts
import { routeWrite, type OwnershipMap, type WriteRoute } from './router.ts';

export interface OwnershipRow { domain: string; externalTier: string; }
let cache: OwnershipMap | null = null;

/** Build the caller's own-org ownership map (domain→tier) and cache it. Same body for every domain. */
export function setTaskOwnership(rows: readonly OwnershipRow[]): void {
  const map: Record<string, string> = {};
  for (const row of rows) map[row.domain] = row.externalTier;
  cache = map;
}
/** Alias naming the generalized intent (P1 callers keep `setTaskOwnership`); identical body. */
export const setDomainOwnership = setTaskOwnership;
export function clearOwnershipCache(): void { cache = null; }

/** Per-domain write route (ADR-0056 generalized). Fail-closed: null/absent map ⇒ 'pmo'. */
export function routeDomainWrite(domain: string): WriteRoute {
  return cache ? routeWrite(domain, cache) : 'pmo';
}
/** Back-compat (P1) — delegates to the generalized per-domain route. */
export function routeTaskWrite(): WriteRoute { return routeDomainWrite('tasks'); }
```
Then in `useOwnershipCacheSync()` (C6): it already loads own-org `external_domain_ownership` rows and
feeds them to `setTaskOwnership`; that seed now also covers `procurement`/`companies` because the map is
domain-keyed (no extra call needed — confirm by assertion in the RED test). Re-run RED → GREEN.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/ownershipCache.test.ts` green (existing P1 tests unchanged).

### 1.4 — RED: `dispatch.money.test.ts` — the outbox + atomic claim + recovery (AC-ENA-012, FR-ENA-041/043)

**File:** `pmo-portal/src/lib/adapterSeam/dispatch.money.test.ts` (new). Pure unit tests with mocked
outbox/adapter deps (including a mocked `claimOutboxForCommit`). Asserts the full state machine
(ADR-0058 §4) **and the impossible-by-construction claim guarantee**:
- **server-side key enforcement** — a non-read-only `erpnext` command with no `idempotencyKey` is rejected
  `commit-rejected`/`missing-idempotency-key` **before** any outbox/ERP call; a P0/P1-tier command with no
  key still takes the non-money path (byte-for-byte).
- fresh key → INSERT pending → **claim (pending→committing)** → POST → committed → mirror+ref → confirmed.
- concurrent duplicate **insert** → INSERT pending throws `23505` → re-read → reconcile to winner.
- **the reissue race is closed (the review's critical case):** two concurrent retries of the SAME key both
  read `pending`, both probe (empty) — only the one whose `claimOutboxForCommit` mock returns the row
  POSTs; the other's claim returns null → it does **not** POST (assert adapter.commit call count == 1),
  re-reads, and finalizes to the winner's result. A `committing`-fresh row → no POST, re-read on backoff.
- **the fencing token closes the lease-expiry overlap (F4):** `claimOutboxForCommit` returns the row's
  `claim_generation`; `dispatchMoneyWrite` threads that token into **every** post-claim write-back
  (`markOutboxCommitted`/`markOutboxConfirmed`/`markOutboxFailed` + the `external_refs` record). Assert a
  lease-expired claimant holding token `gen=1` whose write-back runs AFTER a reclaimer bumped the row to
  `gen=2`: its `markOutboxCommitted(id, …, 1)` affects **0 rows** (the mock reports 0 rowCount) → the stale
  claimant's result is **discarded** (no state change, no finalize, no duplicate mirror), while the
  reclaimer's `gen=2` write-back applies. (The stale claimant's ERP POST may have fired — the reclaimer's
  `remarks`-key probe adopts that one doc, per ADR-0058 §4.)
- **F1 in-flight-POST overlap (the Critical fix):** a stale `committing` row is **quarantined**, never
  reclaimed+re-POSTed. Model the overlap: claimant A wins the claim and its POST is in flight (not yet
  probe-visible); its lease expires; a reclaimer reconciles → **quarantines** (no POST, surfaces retryable);
  A's POST lands (probe now returns it); after the `reconcile_after` window the reconciliation path claims
  the quarantined row, **probes the remarks key → adopts A's doc → NO second POST, exactly one money doc**.
- `confirmed` retry → return stored result (the persisted `canonical`), **no ERP call, no claim**.
- `committed` retry → finalize (mirror+ref) only — **generation-guarded**, mirroring the persisted
  `canonical` — **no second commit, no claim**.
- `pending`/`failed` retry → **claim first** → probe finds doc → adopt → finalize; probe empty → POST (claim
  winner only). `quarantined` retry → claim only after the window (probe → adopt-or-reissue-same-key).
- `commit-rejected` → mark `failed`, throw; `external-unreachable` → stays `committing` (reclaimable/quarantinable), throw.
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.money.test.ts` → fails.

### 1.5 — GREEN: `dispatchMoneyWrite(deps)` in `dispatch.ts` (server key guard + claim + reconcile)

**File:** `pmo-portal/src/lib/adapterSeam/dispatch.ts`. Add `dispatchMoneyWrite(deps)` (pure,
Deno-importable) alongside `dispatchExternallyOwnedWrite`. **Step 0 — server-side key enforcement**
(FR-ENA-040): at the top of the served-dispatch path (the `adapter-dispatch` edge fn, task 6.4 wires it),
`if (tier==='erpnext' && op!=='read' && !command.idempotencyKey) throw AdapterError('commit-rejected',
'missing-idempotency-key')` — a key-less erpnext money command never reaches the outbox. P0/P1 (other
tiers) are unaffected. `DispatchMoneyDeps` extends the existing deps with `{ readOutbox, insertOutboxPending,
claimOutboxForCommit, markOutboxCommitted, markOutboxConfirmed, markOutboxFailed, probeByRemarksKey }` —
where each `markOutbox*` takes the caller's **fencing token** (`claimGeneration`) and returns the affected
row count (its guarded UPDATE is `… where id = $1 and claim_generation = $token`). `claimOutboxForCommit`
returns the claimed row **including its bumped `claim_generation`**, which `dispatchMoneyWrite` captures as
the token for the rest of the flow. `dispatchExternallyOwnedWrite` chooses: `erpnext`-tier non-read-only
with key → `dispatchMoneyWrite`; else the existing path (byte-for-byte for P0/P1). The deps also include
`quarantineCommitting` (F1) and `verifyClaimGeneration` (the generation-guard, F3); `markOutboxCommitted`
additionally persists the adapter's `canonical` (F2). The reconcile algorithm is `reconcileOutbox(existing)`
per ADR-0058 §4: `confirmed`→return persisted canonical; `committed`→generation-guarded finalize-only;
`committing`-fresh→backoff-re-read; `committing`-stale→**`quarantineCommitting(id)` (NEVER reclaim+re-POST)**
then surface retryable; `quarantined`→claim only after the window then probe→adopt-or-reissue;
`pending`/`failed`→**`claimOutboxForCommit(id)` first; only the winner (non-null return)
probes→adopt-or-POST→mark, threading its `claim_generation` token into every `markOutbox*`/ref write-back;
the loser (null) re-reads and reconciles, never POSTs**. Any write-back that reports **0 rows affected** (a
stale fencing token — a reclaimer/quarantine superseded this claimant mid-flight) is treated as "superseded
→ discard, do NOT finalize" (F4). Re-run 1.4 → GREEN.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.money.test.ts` → passes.

### 1.6 — Multi-domain read-model writer registry + resolver (replaces the dispatch if-chain)

**RED file:** `supabase/functions/adapter-dispatch/readModelWriters.test.ts` (new, Deno test). Asserts:
`READ_MODEL_WRITERS['tasks'].upsert(…)` writes a task row (the moved ClickUp writer, byte-for-byte); an
unknown domain → throws (no silent skip); `resolveExternalRef(svc, org, 'tasks', pmoId)` returns the
`external_refs` external id and `null` when absent; `findPmoRecordId(…)` is the exact reverse.
**Verify (RED):** `cd supabase/functions/adapter-dispatch && deno test readModelWriters.test.ts` → fails.

**GREEN files:** `supabase/functions/adapter-dispatch/readModelWriters.ts` (new) + edit `index.ts`. Replace
the `writeReadModel` inline `if (domain===CLICKUP_TASKS_DOMAIN)` with `READ_MODEL_WRITERS[domain].upsert(...)`
(`Record<domain, {upsert, tombstone?}>`; unknown-domain throws). ClickUp's `tasks` writer moves in
verbatim; ERPNext's `companies`/`procurement` writers are wired to their real bodies in slices 3–6. Until
then register an explicit **not-yet-wired** writer that fails loud rather than a silent `()=>{}` no-op — a
silent no-op would swallow a real write if a flip ever landed early:

```ts
const notWired = (domain: string) => ({
  upsert(): never { throw new Error(`erpnext read-model writer for '${domain}' is wired in slices 3–6`); },
});
READ_MODEL_WRITERS['companies'] = notWired('companies');
READ_MODEL_WRITERS['procurement'] = notWired('procurement');
```

No org is flipped ⇒ these are never called; if one ever is (a mis-flip), the throw is as loud as the
unknown-domain throw. Add `resolveExternalRef(serviceClient, orgId, domain, pmoRecordId)→externalId|null`
+ reverse `findPmoRecordId(…)` (multi-domain; the P1 single-domain `resolveExternalId` in
`clickup/dispatchFactory.ts` delegates to it). `external_refs` already has
`unique(org_id,domain,external_record_id)` (0093) — AC-ENA-054's guard is already live; this task only adds
the read path. Re-run RED → GREEN.
**Verify:** `cd pmo-portal && npm run typecheck && cd supabase/functions/adapter-dispatch && deno check index.ts && deno test readModelWriters.test.ts` clean/green; existing ClickUp dispatch tests green.

### 1.7 — RED: `external_command_outbox` + `external_ref_lineage` pgTAP (AC-ENA-012)

**File:** `supabase/tests/external_command_outbox_rls.test.sql` (new). Mirror the
`external_refs_rls.test.sql` idiom. Asserts: the `unique (org_id, domain, pmo_record_id,
idempotency_key)` rejects a concurrent duplicate (`throws_ok … '23505'`); org-isolated SELECT;
service-role-only write; the `state` CHECK now includes the **`committing`** claim state
(`pending|committing|committed|confirmed|failed`); and **the atomic claim is at-most-once** — seed a
`pending` row, call `public.claim_outbox_for_commit(id)` twice in succession: the first returns the row
(now `committing`, `claim_generation=1`), the second returns `NULL` (state is `committing`, `updated_at`
fresh) — proving two concurrent reconcilers cannot both win the POST critical section (the review's
critical case). **Plus the fencing-token proof (F4 — stale-generation write-back is discarded):** claim the
seeded row (`claim_generation`→1), backdate its `updated_at` past the 60 s lease, then re-claim it
(`claim_generation`→2, proving the token is monotonic); now assert a **guarded write-back with the STALE
token** — `update external_command_outbox set state='committed' where id = <id> and claim_generation = 1
returning 1` — affects **0 rows** (`is (count) 0`), while the same write-back with the **current** token
(`claim_generation = 2`) affects **1 row**. This is the pgTAP proof that a lease-expired claimant's late
write-back cannot corrupt a row a reclaimer already owns.
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
-- external_command_outbox (R1/R3): the durable provisional ref. unique 4-tuple = the idempotency guard;
-- claim_generation = the FENCING TOKEN (monotonic per claim) that invalidates a stale claimant's write-back.
create table public.external_command_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  domain              text not null,
  pmo_record_id       text not null,
  idempotency_key     text not null,
  external_tier       text not null,
  operation           text not null check (operation in ('create','update','transition')),
  state               text not null check (state in ('pending','committing','committed','confirmed','failed')),
  external_record_id  text,
  payload_digest      text,
  attempt_count       int not null default 0,
  claim_generation    int not null default 0,   -- fencing token: bumped on every claim; write-backs guard on it
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

-- The atomic commit claim (ADR-0058 §2): the ONLY gate from (pending|failed|stale-committing) → committing.
-- Mirrors the 0078 durable-claim discipline (at-most-once in the DB) + 0077 txn-serialization intent. A
-- conditional UPDATE under Postgres' row lock: two concurrent claims serialize, only the winner transitions
-- and RETURNs the row; the loser's UPDATE matches 0 rows (state 'committing', updated_at fresh) → NULL. A
-- 'committing' row past p_lease is re-claimable (recovers a process that died holding the claim). Each win
-- BUMPS claim_generation — the returned value is the caller's FENCING TOKEN: every post-claim write-back
-- (mark committed/confirmed/failed, external_record_id record) is guarded `WHERE claim_generation = <token>`,
-- so a lease-expired-but-still-running claimant that a reclaimer already superseded matches 0 rows on its
-- late write-back and its result is discarded (F4 — closes the lease-expiry double-write). Its ERP POST may
-- still have fired; that orphan is exactly what the remarks-idempotency-key recovery reconciles (§4).
-- SECURITY DEFINER so the policy-less outbox is touched only here + by service_role.
create or replace function public.claim_outbox_for_commit(
  p_id uuid, p_lease interval default interval '60 seconds'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    update public.external_command_outbox
       set state='committing',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,   -- fencing token (F4): monotonic per claim
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='committing' and updated_at < now() - p_lease) )
    returning * into v;
    return v;   -- v.claim_generation is the caller's fencing token; null ⇒ another caller owns it
  end; $$;
-- Reconciler select helper (sweep + retry): the rows a given caller may need to reconcile for an org.
-- NOTE (F11): the state predicate is parenthesized as a whole so `org_id = p_org_id` constrains EVERY branch
-- (incl. the stale-'committing' branch) — without the parens, AND/OR precedence would leak other orgs' stuck
-- 'committing' rows into a caller's reconcile set.
create or replace function public.outbox_reconcile_candidates(p_org_id uuid)
  returns setof public.external_command_outbox
  language sql security definer set search_path = public as $$
  select * from public.external_command_outbox
   where org_id = p_org_id
     and ( state in ('pending','failed','committed')
           or (state='committing' and updated_at < now() - interval '60 seconds') );
  $$;
```
Each table: `enable row level security; force row level security;` + `create policy … for select using
(org_id = public.auth_org_id() and public.is_active_member());` (service-role writes bypass RLS by
construction) + `grant select to authenticated, anon;`. Add `stamp_org_id()` trigger per table (0074
pattern). The two outbox RPCs (`claim_outbox_for_commit`, `outbox_reconcile_candidates`) are SECURITY
DEFINER owned by `postgres` — they are the only non-service-role path to the outbox, and both are
claim/reconcile-only (never a free write). **Reversal block must `drop function … claim_outbox_for_commit;
drop function … outbox_reconcile_candidates;` before `drop table`** (reverse order). Re-run 1.7 → GREEN.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f external_command_outbox_rls` → passes; `scripts/with-db-lock.sh supabase db reset` clean.

### 1.9 — RED: `external_refs_adopt_unique.test.sql` (AC-ENA-054 — proves the reused 0093 constraint for the new domains)

**File:** `supabase/tests/external_refs_adopt_unique.test.sql` (new). Inserts an `external_refs` row
`(org, 'procurement', 'MAT-REQ-001')→pmoA`; asserts a second insert mapping the **same**
`(org,'procurement','MAT-REQ-001')` to `pmoB` throws `23505`; same for `'companies'`/`'Supplier:X'`.
**Verify (RED → GREEN immediately):** the `unique(org_id,domain,external_record_id)` from 0093 already
enforces it — this is the proof, so it goes green once written.

### 1.10 — Repository-seam routing (wires the invariant path; external stays unflipped)

**File:** `pmo-portal/src/lib/repositories/index.ts` (the single repository assembler — there is **no**
`repositories/procurement.ts` or `repositories/company.ts`; the seam assembles `repositories.procurement.*`
and `repositories.company.*` as thin `wrap(() => <DAL>(…))` wrappers). Add the routing guard inside each
write method of the `procurement` and `company` consts, **before** the existing `wrap(() => …)` call, so a
non-flipped org takes the unchanged DAL path byte-for-byte:

```ts
// procurement const — each create/transition method (the underlying DAL fns live in db/*):
//   createPurchaseRequest/createRfq/createPurchaseOrder/createPayment → db/procurementRecords.ts
//   createQuotation/createReceipt/createInvoice/transitionProcurement → db/procurementLifecycle.ts
createPurchaseRequest: (procurementId, referenceNumber, status, date, amount) =>
  routeDomainWrite('procurement') === 'external'
    ? dispatchDomainCommand('procurement', 'create', { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-request' })
    : wrap(() => createPurchaseRequest(procurementId, referenceNumber, status, date, amount)),
// …same guard shape for createRfq/createPurchaseOrder/createPayment (procurementRecords.ts),
//   createQuotation/createReceipt/createInvoice/transition (procurementLifecycle.ts) —
//   each passes the PMO-side erp_doc_kind discriminator ONLY on the external branch.
// company const — create/update (DAL fns in db/companies.ts):
create: (input) =>
  routeDomainWrite('companies') === 'external'
    ? dispatchDomainCommand('companies', 'create', { ...input, erp_doc_kind: 'supplier' })
    : wrap(() => createCompany(input)),
```

Because no org is flipped, every call takes the `else` (byte-for-byte). `dispatchDomainCommand` POSTs
`functions/v1/adapter-dispatch` via the existing `dispatchClient.ts` (P0). The 1.1 test targets
`repositories.procurement.*`/`repositories.company.*` from this file. Re-run 1.1 → GREEN (AC-ENA-001).
**Verify:** `cd pmo-portal && npx vitest run src/lib/repositories/procurement.external.test.ts` → passes.

### 1.11 — `dispatchDomainCommand` + `dispatchClient` typed for `idempotencyKey`; repositories mint keys

**File:** `pmo-portal/src/lib/adapterSeam/dispatchClient.ts`. Extend the POST body type to include the
optional `idempotencyKey`. Then in `pmo-portal/src/lib/repositories/index.ts` (1.10), the **external**
branch of each non-read-only procurement/company method mints one — `dispatchDomainCommand(domain, op,
{ …record, erp_doc_kind }, { idempotencyKey: crypto.randomUUID() })` — because the served dispatch
**enforces** a key for erpnext money commands (1.5/6.4: a missing key is rejected
`commit-rejected`/`missing-idempotency-key` before the outbox is touched). P0/P1 paths never mint a key
(byte-for-byte). **Verify:** `cd pmo-portal && npm run typecheck` → 0 errors.

### 1.12 — Hoist `applyInboundChange` + `runSweep` to `adapterSeam/` (reuse for ERPNext, slice 8)

**RED file:** `pmo-portal/src/lib/adapterSeam/applyEngine.test.ts` (new). Parameterize the existing P1
assertions by `(tier, domain)`: `applyInboundChange({tier:'clickup',domain:'tasks'}, evt)` behaves
byte-for-byte as the P1 `clickup/webhookApply.ts` path; `advanceWatermarkMonotonic` never rewinds;
`runSweep({tier,domain,tableWriter})` applies each change through the writer. ERPNext is exercised in slice 8.
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/applyEngine.test.ts` → fails.

**GREEN files:** `pmo-portal/src/lib/adapterSeam/applyEngine.ts` (new) — move `applyInboundChange`,
`advanceWatermarkMonotonic`, `runSweep` from `clickup/{webhookApply,sweep}.ts` parameterized by
`(tier, domain, tableWriter, maps?)`; `clickup/**` re-exports them as thin wrappers passing
`{tier:'clickup',domain:'tasks',…}` so P1 tests stay byte-for-byte. ERPNext imports them in slice 8. Re-run
RED → GREEN; then `cd pmo-portal && npx vitest run src/lib/adapterSeam/clickup/` → all P1 tests still green.
**Verify:** both green.

### 1.13 — ADR-0058 (the money-idempotency outbox + atomic recovery)

**File:** `docs/adr/0058-erpnext-money-idempotency-outbox.md` (new — see §"ADRs" below for full text).
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
names live (confinement). This task ships the **complete static table** (doctype name + flags) —
`toBody`/`fromDoc` are added by the named tasks below (2.6–2.7 + slice 3), so no placeholder appears:

```ts
import type { PmoRecord } from '../../contract.ts';
export type ErpDocKind =
  | 'purchase-request' | 'rfq' | 'quotation' | 'purchase-order'
  | 'goods-receipt' | 'purchase-invoice' | 'payment' | 'supplier' | 'customer';
export interface ErpCtx { refs: Record<string, string|null>; config: Record<string, unknown>; }
export interface DoctypeEntry {
  doctype: string; submittable: boolean; readOnly?: boolean;
  toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown;   // assigned per entry by 2.7 (money) + slice 3 (parties)
  fromDoc: (doc: unknown) => PmoRecord;               // assigned per entry by 2.7 + slice 3
}
// The static registry — Frappe doctype names confined HERE. `submittable` drives the two-step create→submit.
export const DOCTYPE_REGISTRY: Record<ErpDocKind, Pick<DoctypeEntry,'doctype'|'submittable'|'readOnly'>> = {
  'purchase-request': { doctype: 'Material Request',     submittable: true  },
  'rfq':              { doctype: 'Request for Quotation', submittable: true  },
  'quotation':        { doctype: 'Supplier Quotation',   submittable: true  },
  'purchase-order':   { doctype: 'Purchase Order',       submittable: true  },
  'goods-receipt':    { doctype: 'Purchase Receipt',     submittable: true  },
  'purchase-invoice': { doctype: 'Purchase Invoice',     submittable: true  },
  'payment':          { doctype: 'Payment Entry',        submittable: true  },
  'supplier':         { doctype: 'Supplier',             submittable: false },
  'customer':         { doctype: 'Customer',             submittable: false }, // write scope settled in slice 3 (OQ-4)
};
// 2.7 + slice 3 attach each entry's toBody/fromDoc via a side table DOCTYPE_BODIES: Record<ErpDocKind, {toBody,fromDoc}>
// merged into the adapter at commit time — keeping this file the single source of Frappe names.
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
domains — `routeDomainWrite` generalization). The ERPNext `companies`/`procurement` `READ_MODEL_WRITERS`
entries are the **not-yet-wired throwing writers** already registered in task 1.6 (`notWired('companies')`
/`notWired('procurement')`) — real bodies land per slice 3–6; no flip ⇒ never called, and a mis-flip throws
loud rather than silently no-op'ing.
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

### 3.4 — RED: companies/contacts flip pgTAP — **§7 per-table proof** (references AC-ENA-072; does NOT own it)

**File:** `supabase/tests/erpnext_companies_flip_rls.test.sql` (new — the spec §7-mandated per-table proof for
`companies` + `contacts`). Seed org A (`companies`→`erpnext`) + org B (not flipped). Asserts the §7 row
for these two tables: org-A user-JWT `INSERT`/`UPDATE` of a native mirror col (`name`,`type`,
`erp_supplier_name`,`erp_customer_name`,`erp_tax_id`,`erp_payment_terms_days`) → `42501`; org-A
service-role write → `lives_ok`; org-A user `UPDATE` of `archived_at` (enhancement) → `lives_ok`;
`Internal`-type row never flipped (user write still `lives_ok`); org-B user native write → `lives_ok`
(byte-for-byte); contacts native (`full_name`/`email`/`phone`) user write → `42501`, enhancement
(`title`/`notes`/`archived_at`) user write → `lives_ok`. **AC ownership note:** this file is the §7
per-table proof — the single OWNER of AC-ENA-003 is `erpnext_procurement_flip_rls.test.sql` (slice 4) and
the single OWNER of AC-ENA-072 is `erpnext_money_flip_rls.test.sql` (slice 6); this file's leading
comment REFERENCES both (so `grep AC-ENA-072` finds it) but the slice-3 gate does not re-own them.
**Verify (RED):** fails.

### 3.5 — GREEN: migration `0096_companies_contacts_erpnext_flip.sql` (per-§7 enumeration)

**File:** `supabase/migrations/0096_companies_contacts_erpnext_flip.sql` (re-verify number). Mirrors the
**0093 per-command-RLS template**; each table below is enumerated per spec §7 (native / enhancement /
trigger / grant / pgTAP).

**`companies`** — add mirror cols `erp_party_type text`, `erp_supplier_name text`, `erp_customer_name
text`, `erp_tax_id text`, `erp_payment_terms_days int`, `erp_cancelled_at timestamptz`. Native mirrored
(§7): `name`, `type` (Vendor/Client only), + the six new `erp_*` cols. PMO-owned enhancement (§7):
`archived_at`; `Internal`-type rows never flipped. RLS: split the shipped `companies_write` (0002) into
INSERT/UPDATE/DELETE gated `... and not domain_externally_owned(auth_org_id(),'companies')` **for native
cols** (a trigger `companies_native_mirror_guard` raises `42501` if a user JWT sets a native col while
flipped — the 0093 `enforce_assignee_status_only` pattern, column-pinned to the `erp_*`+`name`+`type`
set); `archived_at` UPDATE stays permissive. Trigger (FR-ENA-171): `companies_stamp_org_id` (0074)
overrides null/seed org only — safe; the dispatch sets `org_id` explicitly; **state this in a comment**.
Grant: `authenticated`/`anon` keep SELECT+enhancement-write; service_role bypasses RLS. Reversal block.

**`contacts`** — no new mirror cols (§7: reuse `full_name`/`email`/`phone` from ERP `Contact`, link
`company_id`). PMO-owned enhancement: `archived_at`, `title`, `notes` (no ERP `Contact` equivalent mirrored
in P2 — FR-ENA-095). RLS: split `contacts_write` (0030) the same way — native (`full_name`/`email`/`phone`/
`company_id`) user-write gated `... and not domain_externally_owned(auth_org_id(),'companies')` via a
`contacts_native_mirror_guard` trigger; enhancement cols stay permissive. Trigger (FR-ENA-171): `contacts`
shipped (0030) with **no dedicated stamp trigger**; `contacts_stamp_org_id` (0074's 42-table blanket
hardening) overrides null/seed org only — safe; **the flip adds NO new trigger** (state this). Grant: as
shipped. Reversal block. Re-run 3.4 → GREEN.
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

### 3.8–3.12 — FE wiring + pull-adopt onboarding + contacts read + gates (atomic)

**3.8 (RED+GREEN, finding-3 path fix)** `pmo-portal/src/lib/repositories/index.ts` — fill the **external**
branch of the `company.create`/`company.update` methods (1.10 left the shape; here the dispatch payload is
complete with `erp_doc_kind:'supplier'`/`'customer'` + a minted `idempotencyKey`). RED:
`src/lib/repositories/procurement.external.test.ts` extended to assert a flipped org routes
`company.create`→`dispatchDomainCommand` (mocked) and a non-flipped org still calls `createCompany`
(`db/companies.ts`). GREEN: the branch. **Verify:** `npx vitest run src/lib/repositories/procurement.external.test.ts`.
**3.9 (RED+GREEN)** `supabase/functions/erpnext-onboard/index.ts` (new) — RED `index.test.ts` (Deno):
enumerating ERP Supplier/Customer → `adoptParty` is idempotent (two runs ⇒ one mirror + one
`external_refs`). GREEN: the fn calls `adoptParty` per party. **Verify:** `deno test erpnext-onboard/index.test.ts`.
**3.10 (RED+GREEN)** Contacts read mirror — RED `contactsMirror.test.ts`: a `Contact` webhook/sweep event
upserts `{full_name,email,phone,company_id}` (native) and never overwrites `title`/`notes`/`archived_at`.
GREEN: the contacts writer registered in `readModelWriters` (slice 1.6). **Verify:** `npx vitest run … contactsMirror`.
**3.11 (RED+GREEN)** `Internal`-type never flipped — RED `partyAdopt.test.ts` extended: `adoptParty` for an
`Internal`-shaped source throws `config-rejected`. GREEN: the guard in `partyAdopt.ts`. **Verify:** unit green.
**3.12 (gate)** Full slice gate.
**Verify:** `npm run verify` (full) + `with-db-lock supabase test db` + the AC-ENA-040 served-fn e2e.

**Slice 3 final gate:** `npm run verify` (full) + `with-db-lock supabase test db` + the AC-ENA-040 served-fn e2e.

---

## Slice 4 — Material Request + RFQ + Supplier Quotation (first submittable doctypes)

**Goal:** the first procurement sub-doctypes with the transition op; prove the one-selected invariant
survives the flip; procurement_items + 3 record tables flip. AC-ENA-003(procurement)/050/051.

### 4.1 — RED: procurement flip pgTAP — **OWNS AC-ENA-003** (org-scoped procurement flip) + §7 per-table proof

**File:** `supabase/tests/erpnext_procurement_flip_rls.test.sql` (new — the spec §9-named OWNER of
**AC-ENA-003** + the §7 per-table proof for `procurement_items`/`purchase_requests`/`rfqs`/
`procurement_quotations`). **AC-ENA-003 (the owner):** Given org A `procurement`→`erpnext` and org B not
flipped, a delivery-role member of org B performing a native procurement write (`createPurchaseRequest`
path) succeeds via the direct DAL (org B byte-for-byte pre-P2); the same write in org A is RLS-denied on
native cols. **§7 per-table proofs:**
- `procurement_items`: service-role write setting `erp_line_amount` (NOT `amount`) → `lives_ok` and the
  GENERATED `amount` is unaffected (FR-ENA-071); a user native write to `quantity`/`rate`/`erp_line_amount`
  → `42501`.
- `purchase_requests`/`rfqs`: user native write (`pr_number`/`amount`/`erp_*`) → `42501`; service-role
  → `lives_ok`; `status` CHECK preserved; org-isolated.
- `procurement_quotations`: native (`total_amount`/`vq_number`/`erp_*`) user write → `42501`; **enhancement
  `is_selected` stays user-writable**; `procurement_quotations_one_selected_idx` intact under flip.
- `procurements` (case aggregate): **stays user-writable even when `procurement` is externally-owned**
  (the case folder is PMO's — FR-ENA-073/101).
This file REFERENCES AC-ENA-072 in its leading comment but does NOT own it (owner = slice 6
`erpnext_money_flip_rls.test.sql`).
**Verify (RED):** fails.

### 4.2 — GREEN: migration `0097_procurement_items_pr_rfq_sq_flip.sql` (per-§7 enumeration)

**File:** `supabase/migrations/0097_procurement_items_pr_rfq_sq_flip.sql` (re-verify number). 0093-template
per-command RLS; per spec §7:
- **`procurement_items`** — add `erp_line_amount numeric(14,2)` (the ERP line oracle — FR-ENA-071),
  `erp_docstatus smallint`, `erp_modified text`, `erp_amended_from text`, `erp_cancelled_at timestamptz`.
  Native mirrored: `quantity`,`rate`,`erp_line_amount`,`erp_docstatus`,`erp_modified` (+ the new cols).
  PMO-owned: `name`. Trigger (FR-ENA-171): `procurement_items_stamp_org` (parent-inherit 0015) +
  `_stamp_org_id` (0074) override null/seed only — safe; **`amount` GENERATED — never in any service-role
  write** (state this). A `procurement_items_native_mirror_guard` trigger raises `42501` on user native
  writes while flipped.
- **`purchase_requests`** / **`rfqs`** — add `erp_docstatus`,`erp_modified`,`erp_amended_from`,
  `erp_cancelled_at`. Native: `pr_number`/`rfq_number`,`reference_number`,`amount`,`date`,`erp_*`. Trigger:
  `purchase_requests_stamp_org`/`rfqs_stamp_org` (0035) + `_stamp_org_id` (0074) safe (state this). Native
  user-write gated; `status` CHECK preserved.
- **`procurement_quotations`** — add the same `erp_*` cols. Native: `total_amount`,`valid_until`,`rfq_id`,
  `vq_number`,`reference`,`received_date`,`erp_*`. **PMO-owned enhancement `is_selected` (+ the
  one-selected unique index) stays user-writable** (FR-ENA-130). Trigger: `procurement_quotations_stamp_org_id` safe.
Grant: `authenticated`/`anon` keep SELECT+enhancement-write; service_role bypasses. Reversal block.
Re-run 4.1 → GREEN.
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

### 4.8–4.11 — FE routing for procurement record creates + the invariant gate (atomic; finding-3 path fix)

**4.8 (RED+GREEN)** `pmo-portal/src/lib/repositories/index.ts` — fill the **external** branch of the
`procurement.createPurchaseRequest`/`createRfq`/`createPurchaseOrder`/`createPayment` methods (DAL fns in
`db/procurementRecords.ts`) + `createQuotation`/`createReceipt`/`createInvoice` (`db/procurementLifecycle.ts`):
each external branch carries the `erp_doc_kind` + a minted `idempotencyKey`. RED: the 1.1 test extended to
assert a flipped org routes these to `dispatchDomainCommand`; non-flipped still calls the DAL byte-for-byte.
GREEN: the branches. **Verify:** `npx vitest run src/lib/repositories/procurement.external.test.ts`.
**4.9 (assert)** `transition_procurement` RPC stays the PMO path — case aggregate status is PMO-derived
(FR-ENA-101); a pgTAP assertion confirms `procurements` stays user-writable under flip (part of 4.1).
**4.10 (RED+GREEN)** Adapter derives each record-table `status` CHECK value from `erp_docstatus`
(Draft/Submitted/Cancelled). RED `doctypeRegistry.status.test.ts`; GREEN the mapper. **Verify:** unit green.
**4.11 (gate)** Full slice gate.
**Verify:** `npm run verify` + pgTAP + the two served-fn e2e.

---

## Slice 5 — Purchase Order + Goods Receipt (cross-doctype ref resolution)

**Goal:** PO + GR with cross-doctype ref resolution incl. the **PO item child-row `name`**. AC-ENA-052.

### 5.1 — RED+GREEN: pgTAP `erpnext_po_receipts_flip_rls.test.sql` + migration `0098_purchase_orders_receipts_flip.sql` (per-§7)

**RED file** `supabase/tests/erpnext_po_receipts_flip_rls.test.sql` (new — §7 per-table proof, REFERENCES
AC-ENA-072; does not own it). Per spec §7:
- **`purchase_orders`** — native mirrored: `po_number`,`reference_number`,`amount`,`date`,`erp_*`
  (`erp_docstatus`,`erp_modified`,`erp_amended_from`,`erp_cancelled_at`). User native write → `42501`;
  service-role → `lives_ok`; `status` CHECK preserved; org-isolated. Trigger: `purchase_orders_stamp_org`
  (0035) + `_stamp_org_id` (0074) override null/seed only — safe (state this).
- **`procurement_receipts`** — native mirrored: `gr_number`,`receipt_date`,`reference_number`,`po_id`,
  `erp_*`. User native write → `42501`; service-role → `lives_ok`; **`po_id` FK preserved (FR-ENA-130c)**;
  `procurement_receipt_status` enum derived. Trigger: `procurement_receipts_stamp_org_id` safe.
**GREEN migration** `0098_purchase_orders_receipts_flip.sql` (re-verify number): add the `erp_*` cols to
both tables; 0093-template native-write gate via a `*_native_mirror_guard` trigger; grants as shipped;
reversal block. Re-run RED → GREEN.
**Verify:** pgTAP green; `db reset` clean.

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

### 5.6–5.9 — FE routing + status derivation + gate (atomic; finding-3 path fix)

**5.6 (RED+GREEN)** `pmo-portal/src/lib/repositories/index.ts` — fill the **external** branch of
`procurement.createPurchaseOrder` (DAL `createPurchaseOrder` in `db/procurementRecords.ts`) and the
GR create path, each with `erp_doc_kind` (`'purchase-order'`/`'goods-receipt'`) + a minted `idempotencyKey`.
RED: 1.1 test extended to assert flipped-org routing for PO/GR; non-flipped still calls the DAL. GREEN: branches.
**Verify:** `npx vitest run src/lib/repositories/procurement.external.test.ts`.
**5.7 (RED+GREEN)** PO `status` CHECK derived; GR `procurement_receipt_status` derived — RED unit, GREEN mapper.
**5.8 (pgTAP)** `payments.invoice_id` / `procurement_receipts.po_id` FK integrity under service-role write
(the same-case invariant holds — adapter resolves within the case) — add the assertion to the money-flip pgTAP (6.1).
**5.9 (gate)** Full slice gate.
**Verify:** `npm run verify` + pgTAP + the served-fn e2e.

---

## Slice 6 — Purchase Invoice + Payment Entry + full AP command surface + outbox-backed money e2e (the R1/R2/R3 heart)

**Goal:** the R9-frozen AP flow with the full command surface (create/update-draft + submit/cancel/amend on
PI; create+submit + cancel on PE) + the **outbox-backed money e2e at the real served boundary** with the
`after-commit-before-mirror` fault seam. AC-ENA-053 + the money-flip pgTAP (AC-ENA-072 money).

### 6.1 — RED+GREEN: pgTAP `erpnext_money_flip_rls.test.sql` (**OWNS AC-ENA-072**) + migration `0099_invoices_payments_flip.sql` (per-§7)

**RED file** `supabase/tests/erpnext_money_flip_rls.test.sql` (new — the spec §9-named OWNER of
**AC-ENA-072**; it consolidates the cross-table contract first asserted incrementally by the §7 per-table
proofs in slices 3/4/5). Per spec §7:
- **`procurement_invoices`** — add `erp_outstanding_amount numeric(14,2)`, `erp_docstatus`,`erp_modified`,
  `erp_amended_from`,`erp_cancelled_at` (it already has `amount`,`reference_number`,`vi_number`,`po_id` from
  0040/0035). Native mirrored: `vi_number`,`invoice_date`,`reference_number`,`amount`,`po_id`,
  `erp_outstanding_amount`,`erp_*`. User native write → `42501`; service-role → `lives_ok`; `amount`/`po_id`
  preserved. Trigger: `procurement_invoices_stamp_org_id` safe (state this).
- **`payments`** — add `erp_*`. Native mirrored: `pay_number`,`reference_number`,`amount`,`date`,`invoice_id`,
  `erp_*`. User native write → `42501`; service-role → `lives_ok`; **`invoice_id` FK + same-case invariant
  preserved (FR-ENA-130d)**; `payments_amount_nonneg` CHECK preserved (nulls→NULL, FR-ENA-072).
**AC-ENA-072 (the owner) — cross-table assertions:** for an org with `procurement`+`companies` flipped, a
user-JWT write to a native mirror col on `procurement_invoices.amount`, `purchase_orders.po_number`, AND
`companies.name` → `42501`; service-role writes succeed; a user write to an enhancement
(`procurement_quotations.is_selected`, `companies.archived_at`) AND the `procurements` case aggregate still
succeeds. (This single file owns the AC; the slice-3/4/5 §7 files reference it.)
**GREEN migration** `0099_invoices_payments_flip.sql` (re-verify number): add the cols; 0093-template
native-write gate via a `*_native_mirror_guard` trigger per table; grants as shipped; reversal block.
Re-run RED → GREEN.
**Verify:** pgTAP green; `db reset` clean.

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

### 6.4 — Outbox + server-side key enforcement + atomic claim wired into the dispatch (ADR-0058)

`supabase/functions/adapter-dispatch/index.ts`:
1. **Server-side key enforcement (FR-ENA-040, finding 5):** at the top of the served path, `if
   (command.tier==='erpnext' && command.operation!=='read' && !command.idempotencyKey) respond
   commit-rejected / missing-idempotency-key` — a key-less erpnext money command never reaches the outbox.
   P0/P1 (other tiers) are unaffected (byte-for-byte).
2. **Money dispatch:** route through `dispatchMoneyWrite` (slice 1.5). The outbox callbacks operate on
   `external_command_outbox` via the service client: `insertOutboxPending` (INSERT `pending`, unique guard
   → `23505` on dup), `claimOutboxForCommit` (RPC `claim_outbox_for_commit` — the atomic claim, finding 4),
   `markOutboxCommitted/Confirmed/Failed`, `readOutbox`, `probeByRemarksKey` (`GET …?filters=[["remark(s)",
   "like","%<key>%"]]`).
3. **Reconcile under the claim:** `confirmed`→return; `committed`→finalize-only; `committing`-fresh→
   backoff-re-read; `pending`/`failed`/stale-`committing`→**claim first; winner probes→adopt-or-POST→mark;
   loser (null return) re-reads, never POSTs**.
4. The adapter stamps the key into the doctype `remarks` (`toBody` appends `idempotencyKey`).
**Verify:** `cd supabase/functions/adapter-dispatch && deno test` (mocked service client) — the full
reconcile state machine incl. the **two-concurrent-retry claim case** (only one POST) and the
**key-less-reject case**.

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

### 6.9–6.14 — FE routing + cancel/amend e2e + status derivation + same-case invariant + gates (atomic; finding-3 path fix)

**6.9 (RED+GREEN)** `pmo-portal/src/lib/repositories/index.ts` — fill the **external** branch of
`procurement.createInvoice` (`createInvoice` in `db/procurementLifecycle.ts`) and `createPayment`
(`createPayment` in `db/procurementRecords.ts`): each carries `erp_doc_kind` (`'purchase-invoice'`/
`'payment'`) + a minted `idempotencyKey` (server-enforced, 6.4). RED: 1.1 test extended to assert
flipped-org routing for invoice/payment; non-flipped still calls the DAL. GREEN: branches.
**Verify:** `npx vitest run src/lib/repositories/procurement.external.test.ts`.
**6.10 (RED+GREEN served-fn e2e)** PI cancel/amend — `e2e/AC-ENA-023-pi-cancel-amend.spec.ts` (real
boundary): cancel→soft-tombstone+lineage; amend→`external_refs` repoint + `erp_amended_from`. GREEN adapter path.
**6.11 (RED+GREEN served-fn e2e)** PE cancel — `e2e/AC-ENA-023b-pe-cancel.spec.ts`: PE cancel→tombstone; references the PI.
**6.12 (RED+GREEN unit)** PI status derived (`erp_outstanding_amount==0`⇒Paid) — RED `piStatus.test.ts`, GREEN mapper.
**6.13 (pgTAP)** `create_payment` same-case invariant under service-role write (FR-ENA-130d) — asserted in 6.1.
**6.14 (gate)** Full slice gate.
**Verify:** `npm run verify` (full) + `with-db-lock supabase test db` + the 3 served-fn money e2e.

---

## Slice 7 — Actuals + AP/AR aging read-only snapshots (ADR-0048 ledger-sourced)

**Goal:** read-only accounting read-backs — actuals from summing **mirrored** `GL Entry` rows; AP/AR aging
from the report RPC primary (pinned filters, OQ-3) with the **mirrored-ledger** fallback (bucketing
`erp_gl_entry_mirror`/`erp_payment_ledger_mirror` rows); **never invoice-only local math** (FR-ENA-162
prohibition). The ledger mirrors are a machine-written read-model fed by the sweep (slice 8), matching the
signed spec's "sum **mirrored** ledger rows" (FR-ENA-150) and "bucket **mirrored** `GL Entry`/`Payment
Ledger Entry` rows" (FR-ENA-162). AC-ENA-060/061.

### 7.1 — RED+GREEN: migration `0100_erp_accounting_snapshots.sql` + pgTAP

**Two ledger-mirror read-model tables + three snapshot tables** — all org-scoped, machine-written (service-
role write + org-member SELECT), `org_id` default + `stamp_org_id()` trigger, reversal block.

**Ledger mirror read-model (the mirrored-rows basis FR-ENA-150/162 require):**
```sql
-- erp_gl_entry_mirror: mirrored GL Entry truth (ADR-0048); the actuals-sum + aging-fallback basis.
create table public.erp_gl_entry_mirror (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001') references public.organizations(id) on delete cascade,
  erp_name      text not null,                    -- GL Entry `name`
  account       text not null,
  cost_center   text,
  fiscal_year   text,
  project       text,
  party_type    text,
  party         text,
  voucher_type  text,
  voucher_no    text,
  posting_date  date,
  debit         numeric(14,2),
  credit        numeric(14,2),
  is_cancelled  boolean not null default false,
  erp_docstatus smallint,
  erp_modified  text not null,                    -- per-row source-mod cursor (FR-CUA-049 pattern; feed guard)
  as_of         timestamptz not null default now(),
  unique (org_id, erp_name)
);
-- erp_payment_ledger_mirror: mirrored Payment Ledger Entry truth (the aging fallback's second source).
create table public.erp_payment_ledger_mirror (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001') references public.organizations(id) on delete cascade,
  erp_name              text not null,            -- Payment Ledger Entry `name`
  account               text not null,
  party_type            text,
  party                 text,
  against_voucher_type  text,
  against_voucher_no    text,
  amount                numeric(14,2),
  posting_date          date,
  due_date              date,
  erp_docstatus         smallint,
  erp_modified          text not null,
  as_of                 timestamptz not null default now(),
  unique (org_id, erp_name)
);
```
The `unique (org_id, erp_name)` makes the feed an idempotent upsert; the `erp_modified` column is the
per-row source-mod guard so a re-fed older row is a no-op (the slice-8 feed applies `erp_modified >=`).
These are **read-only accounting truth, never PMO-written** — no doctype-registry entry, no user write path,
no flip migration (they are not a flippable domain, they are a downstream ledger mirror).

**Three snapshot tables** per spec §4.4 (`erp_actuals_snapshot`, `erp_ap_aging_snapshot`,
`erp_ar_aging_snapshot`) — snapshot-replacement per scope (`snapshot_id` + delete-prior-scope-in-tx),
`numeric(14,2)` buckets, `range_labels jsonb`, provenance cols (`as_of`, `source_report`, `report_version`).

pgTAP: org isolation + machine-only write on all five tables; the ledger mirrors' `unique (org_id,
erp_name)` upsert-idempotency; single-snapshot-per-scope after refresh. **Verify:** pgTAP green; `db reset` clean.

### 7.2 — RED+GREEN: `erpnext/ledgerFetch.ts` (the confined ERP ledger fetch — feeds the mirror)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/ledgerFetch.ts` (new) + `ledgerFetch.test.ts` (RED).
Two confined fetchers over the `erpnext/client.ts` list endpoint (all Frappe vocabulary stays in
`erpnext/**`) — the source the **slice-8 sweep feed** (8.x) reads to populate the two ledger-mirror tables:
`fetchGlEntries(client, {company, since})` → `GET /api/resource/GL Entry?filters=[["is_cancelled","=",0],["docstatus","!=",2],["modified",">=","<since>"],…]&fields=[…]&limit_page_length=0` (paged), returning
decimal-string `{name, account, cost_center, fiscal_year, project?, party_type?, party?, voucher_type,
voucher_no, posting_date, debit, credit, modified}` rows; `fetchPaymentLedgerEntries(client, {company,
since})` → the same over `Payment Ledger Entry`. RED asserts: paging accumulates all rows,
`is_cancelled=0`/`docstatus≠2`/`modified≥since` filters are sent, money fields are decimal-strings, and
**nothing is persisted here** (pure fetch — persistence is the feed's job, 8.x). GREEN: the two fetchers.
**Verify (RED→GREEN):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/ledgerFetch.test.ts`.

### 7.3 — RED+GREEN: `erpnext/actualsSnapshot.ts` (AC-ENA-060 — sum MIRRORED GL rows → snapshot)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts` (RED) then `actualsSnapshot.ts`
(GREEN). `refreshActuals(serviceClient, orgId, scope)`: **(1)** `SELECT` the scope's **mirrored**
`erp_gl_entry_mirror` rows (`org_id` + `company`→via account/cost-center + project/fiscal-year filters,
`is_cancelled=false`) — the read-model, **not** a live ERP fetch; **(2)** sum debit/credit/net **per
(cost_center, account, fiscal_year)** (summing mirrored ERP rows = ERP truth, ADR-0048 — no PMO-authored
figure); **(3)** new `snapshot_id` → delete prior-scope `erp_actuals_snapshot` rows **in the same
service-role tx** → insert the summed rows stamping `source_report='GL Entry'`/`as_of`. RED asserts
(AC-ENA-060): given a fixed `erp_gl_entry_mirror` seed, the snapshot holds the exact sums, replaces the
prior scope snapshot (single `as_of`), and **never reads/writes `procurement_invoices`**. **Verify
(RED→GREEN):** `npx vitest run …/actualsSnapshot.test.ts`.

### 7.4 — RED+GREEN: `erpnext/agingSnapshot.ts` (report-RPC primary + MIRRORED-ledger fallback, FR-ENA-160/161/162)

`refreshAging(serviceClient, client, orgId, scope)`: **primary (OQ-3)** — `POST
/api/method/frappe.desk.query_report.run` (`report_name:'Accounts Payable'|'Accounts Receivable'`, filters
from binding `config.report_filter_shape` — **already pinned by the R10 pre-slice-7 spike**, §6 constraint
1; this task only **consumes** the pinned shape, no inline `get_script`). Mirror returned buckets +
`range_labels` verbatim; stamp `report_version`. **Fallback (only when the pinned shape rejects on a
minor):** bucket the **mirrored** `erp_payment_ledger_mirror` + `erp_gl_entry_mirror` rows (`SELECT` from
the read-model, ERP truth, version-pinned) by their `posting_date`/`due_date` into the same `range1..4`
boundaries — **NEVER** `procurement_invoices` `due_date−today` math (the FR-ENA-162 prohibition; assert no
`procurement_invoices` read on either path). Snapshot-replace per scope.
**Verify:** unit (mocked report RPC primary + the mirrored-ledger fallback over seeded mirror rows).

### 7.5 — Sweep fan-out: mirror-fed actuals + aging refresh per employing org

`erpnext-sweep` (slice 8.6) runs, per employing org and **after** the ledger-mirror feed (8.x) has refreshed
`erp_gl_entry_mirror`/`erp_payment_ledger_mirror`: `refreshActuals` (reads the freshly-fed GL mirror) +
`refreshAging` (report primary, mirror fallback). No cross-org state; each org reads only its own mirror
rows (RLS `org_id`). Binding `config` carries `aging_report_names` + the R10-pinned `report_filter_shape`.
**Verify:** unit (fan-out calls both refreshers per org after the feed step).

### 7.6 — RED+GREEN: served-fn e2e `AC-ENA-061-aging-readback.spec.ts`

Real boundary: an ERPNext org with open AP/AR → refresh → `erp_ap_aging_snapshot`/`erp_ar_aging_snapshot`
hold report-backed buckets with `report_date`/`range_labels`/`ageing_based_on`/`as_of`/`report_version`,
snapshot-replaced, and **no** bucket computed by invoice-only local math (assert the
`erp_ap_aging_snapshot` row count == report row count; assert no `procurement_invoices`-derived bucket
column exists). **Verify:** green.

### 7.7 — RED+GREEN: snapshot read repository (`src/lib/repositories/index.ts` + `db/erpSnapshots.ts`)

**Files:** `pmo-portal/src/lib/db/erpSnapshots.ts` (new DAL) + wire into `src/lib/repositories/index.ts`.
Read-only, org-scoped `SELECT` over `erp_actuals_snapshot`/`erp_ap_aging_snapshot`/`erp_ar_aging_snapshot`
(RLS org-member SELECT; no write path — snapshots are machine-written). RED
`db/erpSnapshots.test.ts`: returns the current-scope rows (single `as_of`) and empty for a
non-employing org. GREEN: the three read fns + `repositories.erpSnapshots.{actuals,apAging,arAging}`
wrappers. **Verify:** `cd pmo-portal && npx vitest run src/lib/db/erpSnapshots.test.ts`.

### 7.8 — RED+GREEN: provenance display (read-only `as_of`/source on the actuals/aging read surface)

**File:** the actuals/aging read component (RTL unit only — no new route). RED
`<component>.test.tsx`: renders `as_of` + `source_report`/`report_version` provenance from a seeded
snapshot row and shows an empty-state when no snapshot exists. GREEN: the read-only provenance line
(strictly `DESIGN.md` tokens). **Verify:** `npx vitest run <component>.test.tsx`.

### 7.9 — Full slice-7 gate

**Verify:** `cd pmo-portal && npm run verify` (full) + `scripts/with-db-lock.sh supabase test db` +
`scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test AC-ENA-061`.

---

## Slice 8 — Webhooks-as-hints + modified-poll sweep + cancel/amend lineage feed

**Goal:** the change-feed — ERPNext webhook ingress (HMAC) + the modified-poll reconciliation sweep
(convergence authority) — wiring the lineage module (slice 2.11) into the apply path, plus the
**ledger-mirror feed** that populates `erp_gl_entry_mirror`/`erp_payment_ledger_mirror` for slice 7's
mirror-sourced actuals/aging. AC-ENA-070/071.

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

### 8.6 — RED+GREEN: `erpnext-sweep` outbox recovery + cron entry (`supabase/functions/erpnext-sweep/index.ts`)

This is the sweep-side of ADR-0058 §Consequences — the **same** recovery path as the retry flow (one
algorithm, described identically in ADR and plan, closing the ADR/plan drift).

**RED file:** `supabase/functions/erpnext-sweep/outboxRecovery.test.ts` (new, Deno; mocked service client +
adapter). Asserts the sweep runs an explicit **`reconcileOutbox` pass BEFORE the doctype sweep**: for each
employing org it selects every `pending`/`failed`/`committing`-past-lease/`committed` row via
`outbox_reconcile_candidates(org)` (RPC from mig 0095) and applies the ADR-0058 §4 algorithm **exactly** —
- `committed` → finalize-only (idempotent read-model upsert + `external_refs`) → `confirmed`; **no ERP create**.
- `pending`/`failed`/stale-`committing` → `claim_outbox_for_commit(id)` **first**; only the claim winner
  probes ERP by the stamped `remarks` key → adopt (`committed`→finalize→`confirmed`) or `POST` under the
  same row; the loser (null return) is skipped (**no POST**).
Proves an orphaned commit left `committed`/`pending` because the original retry never returned is
reconciled to **exactly one** mirror row with **no duplicate ERP doc**, and a stuck `committing` past lease
is re-claimed. **Verify (RED):** `cd supabase/functions/erpnext-sweep && deno test outboxRecovery.test.ts` → fails.

**GREEN file:** `supabase/functions/erpnext-sweep/index.ts` (new, the cron entry). Per employing org:
**(1)** the `reconcileOutbox` pass above — reusing the **exact** `dispatchMoneyWrite` reconcile deps from
slice 1.5/6.4 (`claimOutboxForCommit`/`markOutbox*`/`probeByRemarksKey`/finalize), so the retry path and
the sweep path share one implementation; **(2)** `runSweep` per doctype (the modified-poll convergence);
**(3)** the **ledger-mirror feed** (task 8.6b) — `feedLedgerMirrors(serviceClient, client, orgId)` fetches
`GL Entry` + `Payment Ledger Entry` rows via `ledgerFetch.ts` (7.2) since the per-org ledger watermark and
upserts them into `erp_gl_entry_mirror`/`erp_payment_ledger_mirror` (idempotent on `unique(org_id,
erp_name)`, `erp_modified >=` source-mod guard), advancing the watermark; **(4)** `refreshActuals`/
`refreshAging` (slice 7) reading the freshly-fed mirror. Interactive priority over bulk (NFR-ENA-PERF-001).
Re-run RED → GREEN. **Verify:** `deno test outboxRecovery.test.ts` green + `deno check index.ts` clean.

### 8.6b — RED+GREEN: `erpnext/ledgerMirrorFeed.ts` (fetch → upsert the ledger read-model)

**File:** `pmo-portal/src/lib/adapterSeam/erpnext/ledgerMirrorFeed.ts` (new) + `ledgerMirrorFeed.test.ts`
(RED). `feedLedgerMirrors(serviceClient, client, orgId)`: read the per-org ledger watermark
(`external_sync_watermarks`, one row per mirror source); `fetchGlEntries`/`fetchPaymentLedgerEntries` (7.2)
`since` that watermark; **upsert** each row into `erp_gl_entry_mirror`/`erp_payment_ledger_mirror` on
`unique(org_id, erp_name)` applying the `erp_modified >=` guard (an older re-fed row is a no-op — reuses the
P1 source-mod-guard idiom); advance the watermark to max `modified`. RED asserts: a fixed fetched GL/PLE set
lands as mirror rows (decimal-strings intact), a re-feed of an older `modified` is a no-op, the watermark
advances monotonically, and a cancelled row (`is_cancelled=1`/`docstatus=2`) is filtered out at fetch (7.2).
This is the **feed** that makes "mirrored ledger rows" (FR-ENA-150/162) real; actuals/aging read the mirror,
never live ERP. **Verify (RED→GREEN):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/ledgerMirrorFeed.test.ts`.

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
| AC-ENA-003 | 4 | 4.1 | `supabase/tests/erpnext_procurement_flip_rls.test.sql` [pgTAP] |
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
| AC-ENA-072 | 6 | 6.1 | `supabase/tests/erpnext_money_flip_rls.test.sql` (+ per-table §7 files) [pgTAP] |
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

## 6. Recorded constraints (Director rulings — settled, not open questions)

These were raised at intake and are **decided**; recorded here so no slice re-litigates them.

1. **Report-filter introspection (R10) = a pre-slice-7 spike (RULED).** The `get_script` probe that pins
   `config.report_filter_shape` runs as a **dedicated spike BEFORE slice 7 starts** — not inline in 7.4.
   Task 7.4 only **consumes** the pinned shape; the mirrored-ledger fallback (FR-ENA-162, §7.3/7.4 over
   `erp_gl_entry_mirror`/`erp_payment_ledger_mirror`) remains the designed safety net if the report shape
   drifts on a v15 minor.
2. **PE amend = desk-only in P2 (RULED).** Payment Entry amend is **not** a PMO command in this issue
   (OQ-7 residual). A future PMO PE-amend is an additive slice (cancel + create-with-`amended_from`, the
   same lineage path from 2.11, no schema change) — out of scope here.
3. **`erp_doc_kind` accepted as the PMO-side discriminator (RULED).** The plan carries a PMO-verb
   `erp_doc_kind` field on `PmoRecord` rather than widening `AdapterCommand` with a `subType`; the **only**
   P2 contract change is `idempotencyKey` (FR-ENA-040). The confinement invariant holds — the
   `(kind)→doctype` map lives inside `erpnext/**`, never a Frappe doctype name above the contract.

---

## 7. ADRs (this issue)

- **`docs/adr/0058-erpnext-money-idempotency-outbox.md` (NEW)** — the money-idempotency contract extension
  (`idempotencyKey` on `AdapterCommand`) + the durable `external_command_outbox` provisional-ref + the
  atomic recovery algorithm (R1/R3). Money-safety, irreversible once shipped ⇒ ADR. (Full text written
  alongside this plan, task 1.13.)

PLAN-DONE
