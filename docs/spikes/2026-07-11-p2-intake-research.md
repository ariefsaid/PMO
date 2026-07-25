# P2 intake research synthesis — ERPNext money core (2026-07-11)

Inputs: RIS-portal adapter mining, ERPNext v15 REST contract notes (ground truth: local bench frappe 15.86.0 / erpnext 15.83.0), P1→P2 adapter-seam reuse inventory, fresh-bench spike (BLOCKED), edge-serve spike (SERVABLE).

**Owner intake rulings (binding):** full procurement chain in ONE P2 (parties + PR/RFQ/PO/GR/Invoice/Payment flip + AP commands + actuals/AP-AR aging read-back); fresh clean **stock** bench = the dev bed; served-edge-fn e2e infra = P2 slice zero; no hard deadline.

---

## 1. What P2 must build — domain by domain

**Overriding constraint from the stock-bench ruling:** RIS's proven pattern relies on a *custom app* (custom `Purchase Request`/`Procurement` doctypes, custom stage fields written via `db_set`, doc_events hooks, `@cached_api`). A stock bench has NONE of that. So P2 must (a) use **stock ERPNext doctypes** for the ERP side, and (b) keep all operational/stage state **PMO-side** (enhancement columns per the 0093 flip pattern) — which is architecturally cleaner anyway: RIS's own hard lesson ("ERPNext `status` is derived from docstatus/outstanding and cannot be modified; `db_set` survives only until revalidation") says never fight ERPNext's derived status. PMO mirrors ERP truth and derives its own display status locally.

### 1.1 Parties (Supplier + Customer ↔ PMO companies)
- ERP fields (RIS-proven read set): Customer `name, customer_name, customer_type, territory, customer_group, industry, website, payment_terms`; Supplier `name, supplier_name`. Display fallback `*_name or name` everywhere.
- P2 goes BEYOND RIS: RIS never creates parties; PMO flips the `companies` domain so PMO creates/updates Supplier/Customer via `POST /api/resource/Supplier|Customer`. Non-submittable doctypes → plain CRUD, no docstatus ceremony → **easiest flip, do it first** to prove the multi-doctype chain.
- Pull-adopt is mandatory: an ERP client always has existing parties (mixed-state is normal, not the P1 reject-both-non-empty OD-CUA-3 case). Needs at least a name(/tax-id) match runbook.
- Customer `payment_terms` → `Payment Terms Template Detail.credit_days` (default 30) drives due-date derivation — read-only knowledge for aging display.

### 1.2 Purchase Request (PMO PR ↔ stock doctype — see OQ-1)
- Stock candidate: **Material Request** (`material_request_type: Purchase`). RIS avoided MR for a custom doctype with a richer status ladder (Draft→…→Paid) and direct `purchase_order/purchase_receipt/purchase_invoice` link fields — on stock, that chain state lives PMO-side instead.
- Portable RIS creation rules regardless of doctype: qty>0, cost>0, `rate=cost/qty`; company resolution `project.company → user default → Global Defaults.default_company` (throw if none); item resolution name→`Item` with uom fallback `purchase_uom→stock_uom→"Nos"`; `schedule_date = today+7`; totals may need manual stamping pre-insert to satisfy mandatory fields (RIS stamped `total_qty, base_total, total, grand_total, rounded_total`); insert then submit as separate steps.
- Approval semantics: PMO-side approval workflow (approver≠author SoD per ADR-0019 style) gates the *submit* command; rejection reason mandatory; audit via PMO `audit_events` (not `add_comment`). PM-vs-executive threshold (RIS `pm_approval_limit`) is a PMO policy knob, not an ERP field.

### 1.3 RFQ + Supplier Quotation
- RIS treats these as link targets only (`quoted_amount>0`, `valid_till`, `is_selected` with ≤1-selected invariant; selecting stamps supplier onto the parent). Stock doctypes `Request for Quotation` / `Supplier Quotation` exist and are submittable.
- P2 shape: PMO records for RFQ/quote comparison; commands create stock RFQ/Supplier Quotation; the one-selected invariant + supplier stamping is PMO-side logic (it was custom in RIS too).

### 1.4 Purchase Order
- Fields: `name, transaction_date, grand_total/total, status, workflow_state, project, supplier, docstatus`. Committed-cost analytic: Σ `total` where `docstatus=1 AND project set`.
- Command: create draft PO (resolving Supplier + source PR via multi-domain external_refs) → submit. Linked-PO presence ⇒ PMO status "Ordered".

### 1.5 Goods Receipt (Purchase Receipt)
- Minimal read set: `posting_date, docstatus`. Presence of submitted PR(receipt) ⇒ "Received". Command: create+submit against PO. Stock/warehouse defaults come from the org binding config (naming-series/company/warehouse slots in `config jsonb`).

### 1.6 Purchase Invoice + AP commands
- Read set: `name, supplier(_name), bill_no, posting_date, due_date, grand_total, outstanding_amount, status, docstatus, items(item_name/item_code/qty/rate/amount)`.
- RIS Kanban stages (Draft/Pending/Approved/Paid + `VALID_TRANSITIONS`) lived in a custom field — P2 keeps the stage machine in PMO enhancement columns, with RIS's fallback mapping from ERP status (Unpaid/Overdue→Pending, Partly Paid→Approved, Paid/Return/Debit Note Issued→Paid, Cancelled→excluded) as the derivation rule.
- RIS's "soft reject" (status flip, docstatus stays 1 so GL stays valid until Finance cancels) is likewise a PMO-side state on stock; real cancel = docstatus 2 via the transition op.
- Paid detection: `outstanding_amount == 0` AND a submitted `Payment Entry Reference` row exists — port verbatim.
- Overdue computed PMO-side: `due_date < today AND status ∉ (Paid, Cancelled)`.

### 1.7 Payment Entry (AP commands — genuinely new territory)
- **RIS never creates Payment Entry, PI, or PO** — P2's write path here has NO mined precedent. The only full create-flow template is RIS's Sales Invoice flow (company→currency→account defaulting chain, `conversion_rate=1`, project stamped header+item, draft-then-explicit-submit) — port that *shape* to PE/PI creation.
- PE needs `references` child rows (`reference_doctype: Purchase Invoice, reference_name, allocated_amount`) + party/paid_from/paid_to accounts. Account defaulting must come from `Company.default_payable_account` etc. — spike on the fresh bench to pin the minimal mandatory field set (spec-phase task).
- Read-back: RIS's proven idiom — query `Payment Entry Reference` filtered `{reference_doctype, reference_name, docstatus:1}`, then batch-fetch parent `Payment Entry` (`payment_type, posting_date, paid_amount, mode_of_payment, reference_no, party, status`). Never N+1.

### 1.8 Actuals + AP/AR aging (read-only domains)
- **Actuals:** GL Entry reads (`account, debit, credit, against, party`, filter `is_cancelled=0` / exclude `docstatus=2`), scoped by cost_center/fiscal_year/project. RIS's account-pattern matching (category → `5%materials%`-style wildcard lists) and committed/spent/remaining math ran in its custom app via doc_events + background jobs — on stock, PMO's sweep does the periodic recompute into a snapshot table (ledger-sourced display per ADR-0048; never recompute totals PMO-side beyond summation of mirrored ledger rows).
- **Aging — two viable sources (OQ-3):** (a) ERPNext report RPC `POST /api/method/frappe.desk.query_report.run` with `report_name: "Accounts Payable"|"Accounts Receivable"(± Summary)` + filters (`report_date, ageing_based_on: Due Date, range1..4`) — server-truth buckets, but filter shapes drift per minor version (introspect once via `get_script`); or (b) RIS's in-app computation: PI/SI where `docstatus=1 AND status ∉ (Paid,Cancelled)`, bucket by `due_date − today` (current/1–30/31–60/60+; AR mirror ≤0/≤30/≤60/>60), risk = %60+ bucket, due-soon ≤7d, skip null due_date/outstanding. (b) is simpler and version-stable; (a) is authoritative. Both are read-only; AR side is **read-only in P2** (no Sales writes).
- These are the first **read-only domains**: in the capability map, but `commit()` rejects; sweep/snapshot only.

## 2. Seam extensions needed (from the reuse inventory)

Reusable as-is (no changes): contract core, router/dispatch ordering, `ADAPTER_REGISTRY` factory shape, tables+RLS 0087–0089, refs/watermarks helpers, pendingPush, `classifyDispatchError`, capability guard, apply-engine+sweep logic (after hoist), Vault/dedicated-secret cron, constant-time bearer, 0093 flip-migration template, ownership cache lifecycle.

Extensions:
1. **De-ClickUp the entry points:** `routeTaskWrite` → `routeDomainWrite(domain)`; `dispatchTaskCommand` → `dispatchCommand(domain, operation, record)` (both trivial).
2. **Per-domain read-model writer registry** in adapter-dispatch (domain → {table, column map, tombstone}) replacing the `if (domain === tasks)` chain — P2 adds ~8 read-model writers, the if-chain doesn't scale.
3. **Hoist** `clickup/webhookApply.ts` (`applyInboundChange`, `advanceWatermarkMonotonic`) and `clickup/sweep.ts` (`runSweep`) to `adapterSeam/` with tier/domain params — logic already tier-free.
4. **`externalMirrorDeps.ts`:** parameterize `_shared/clickupMirrorDeps.ts` by `(tier, domain, tableWriter)`.
5. **One `erpnext` adapter, many domains:** internal **doctype registry** (domain → {doctype, toBody, fromDoc, docstatus policy, readOnly?}) one level below `ADAPTER_REGISTRY`; `capabilityMap` = its key set. NOT per-domain adapters — auth/client/rate-limit/site-binding are per-tier.
6. **Multi-domain external-ref resolver:** `resolveExternalId` is single-domain; a PO command must resolve Supplier + PR refs (and inbound docs reverse-map) — new dep.
7. **Read-only domain notion:** registry rejects commands cleanly; FE never routes a write; new read shape for report-RPC/snapshot domains beyond `listChangesSinceWatermark`.
8. **Idempotency key on `AdapterCommand`** + provisional-ref/outbox (risk R1/R3 below) — the one *contract* change.
9. **`transition` op gets first-class submit/cancel/amend semantics** (docstatus policy per doctype in the registry; FE ConfirmDialog on irreversible submits/cancels; delete branch → *cancel*, not tombstone-only).
10. **Org-level binding:** ERPNext binding is per-org (site URL + api key/secret + company/warehouse/naming defaults in `config jsonb`), not per-project — reuse `external_project_bindings` with an org-level sentinel row or add `external_org_bindings`; per-org credentials via the Vault/op pattern resolved in the adapter factory (P1's single fn-env token doesn't generalize).
11. **`erpnext/client.ts`** from the `client.ts` template: `Authorization: token key:secret`, `/api/resource/<DocType>` (URL-encode spaces), Frappe `exc`/`_server_messages` error shape, 429/`Retry-After` backoff **with the no-blind-retry-on-non-idempotent-POST guard**, generic token bucket (rate limiting is off-by-default in Frappe — budget for worker-pool concurrency, not a hard quota).
12. **Change feed:** cursor on `modified` (datetime string, sub-second), `>=` + de-dupe by name, page `limit_start/limit_page_length` until short page, per-org × per-doctype watermarks (table already supports). Deletions invisible to the list API → track `Deleted Document` doctype or `on_trash` webhooks; cancellation = docstatus→2 with fresh `modified`.
13. **Webhook ingress:** new fn per Frappe's Webhook doctype — HMAC `X-Frappe-Webhook-Signature` = `base64(HMAC-SHA256(secret, json.dumps(payload)))` over raw body; configure `webhook_json` Jinja (empty payload if unset!); delivery is RQ background, 3 retries → treat as lossy hints, sweep is the reconciler. Binding resolution by org/site, not list_id.
14. **Version handshake:** `GET /api/method/frappe.utils.change_log.get_versions` at binding time; pin v15 semantics; gate report-filter shapes + submit idiom on major (v16: POST-only mutators, new query backend, some RPC removals). Pick v1 (`/api/resource`) uniformly — don't mix with v2.

## 3. Dev/test topology

### 3.1 ERP dev bed
- **Existing bench is BROKEN — do not resurrect.** `/Users/ariefsaid/Coding/frappe-bench` has no `env/` venv (every bench command dies `FileNotFoundError`), idle since Nov 2025, and brew MariaDB is 12.0.2 (Frappe v15 wants 10.6/11.x — second blocker even after env rebuild). Bench spike stopped per brief; no site created.
- **This aligns with the owner ruling, not contradicts it:** "fresh clean stock bench" ⇒ stand up a fresh **Docker `frappe_docker` ERPNext v15** stack (the bench spike's own recommendation) rather than repairing the RIS bench. Pin frappe 15.86.x / erpnext 15.83.x to keep the API-contract notes ground-truth-valid. No custom apps installed (stock ruling). Mint per-user api_key/api_secret; store outside the PMO repo (op/Vault pattern), never committed.
- One residual courtesy: confirm with owner the old bench's env deletion was deliberate before anything deletes further (it may be someone's cleanup in progress).

### 3.2 Served-edge-fn e2e infra = slice zero (owner-ruled)
Edge-serve spike verdict: **servable now, zero config change.** Facts: CLI 2.105.0; `supabase functions serve --no-verify-jwt` self-manages its runtime container with `[edge_runtime] enabled = false` untouched; all 10 fns served; health 200 in ~2s; adapter-dispatch returns typed 401 (real handler + npm deps resolve); the config.toml:410 "deno.land teardown" blocker is **stale/disproven** (image local/ECR, zero deno.land imports).
- **Slice-zero deliverables:** (a) the with-db-lock serve+test wrapper script (spike's local recipe: serve bg → poll `/functions/v1/health` → playwright → kill CLI **and** `docker rm -f supabase_edge_runtime_pmo-portal` — SIGTERM leaks the container); (b) CI integration-lane step after `db reset` (serve bg with `--env-file` from GH secrets, 60×2s health gate, dump `/tmp/functions-serve.log` on failure; no teardown needed, ephemeral runner); (c) rewrite the stale config.toml:410 comment (keep `enabled = false`, re-justified as "serve-on-demand, keeps `supabase start` lean"); (d) one real-boundary smoke e2e through Kong 54321 proving the lane.
- Money e2e then run against **served adapter-dispatch + the Docker ERPNext bench** — the real-boundary bed the P1 stub tests never had.
- Parallel-agent hygiene applies: serve window inside `scripts/with-db-lock.sh`; the ERPNext Docker stack is a second shared resource — same lock or a dedicated one.

## 4. Risk register

| # | Risk | Detail / mitigation |
|---|---|---|
| R1 | **Money idempotency — no command idempotency key** | `client.ts` `withBackoff` retries 429/5xx; a timeout-after-commit duplicate task is tolerable, a duplicate PI/Payment Entry is a financial defect. Mitigate: client-generated idempotency key on `AdapterCommand`, ERPNext-side dedupe (query-by-key before create), never blind-retry non-idempotent POSTs. |
| R2 | **docstatus vs synchronous write-through** | Submitted docs are immutable (`UpdateAfterSubmitError`); "update" = cancel+amend → NEW name; `external_refs` re-point (upsert handles it) but the old id's webhook events then look like unmapped adopts → duplicate-mirror risk. Transitions enforced 0→1→2 server-side; cancel fails on linked submitted docs (the chain cancels in reverse order). Needs first-class transition op + FE confirm + amend-lineage handling in adopt logic. |
| R3 | **Partial-failure window (commit ok, mirror/ref write failed)** | Money committed in ERP but invisible in PMO until sweep; worse, ref not recorded → sweep **adopt-mints a duplicate mirror row** for a PMO-created record. Mitigate: provisional ref keyed by idempotency key before/atomic-with commit, or dispatch-side outbox; UX distinguishes commit-rejected vs post-commit-mirror-failure (retry of the latter must not re-commit — compounds R1). |
| R4 | **Float money through JSON** | `PmoRecord` values cross `JSON.stringify` as JS numbers. Pin amounts as strings or integer minor units at the contract boundary; PMO columns `numeric` never `float8`; never recompute totals PMO-side (full-row upsert mirrors only — keeps re-apply idempotent). |
| R5 | **Multi-doctype ownership atomicity** | 0087 flips per `(org,tier,domain)`; a PR whose PO lives elsewhere is incoherent. Either one `procurement` domain with sub-doctype routing, or N domains + an atomic-flip provisioning invariant (OQ-2). Parties similar. |
| R6 | **Watermark semantics re-derivation** | Frappe `modified` = datetime string (server-TZ), not epoch-ms; inclusive-boundary (`>=` + de-dupe) and idempotent-reapply discipline must be re-proven per doctype; list feed only sees what the API user can read → the integration user needs full read perms or the feed silently under-syncs. |
| R7 | **PMO triggers mutating ERP-truth mirrors** | Any trigger/derivation on flipped procurement tables (à la `stamp_task_completed_at`) needs the service-role/flipped bypass — audit every table in its flip migration or mirror writes corrupt ERP truth. |
| R8 | **ERPNext derived-status volatility** | `status` recalculated on save; RIS's `db_set` stage fields survive only until revalidation. P2 avoids by ruling: never write ERP status/custom fields; all stage state PMO-side (stock bench has no custom fields anyway). |
| R9 | **Payment Entry create flow unproven** | No RIS precedent (§1.7); mandatory-field/account-defaulting unknowns. Mitigate: spec-phase spike on the fresh bench before committing the command schema. |
| R10 | **Report-RPC filter drift** (if OQ-3 chooses report RPC) | Aging filter keys change across minors; introspect via `get_script`, pin per version handshake. |
| R11 | **Webhooks lossy** | RQ delivery, 3 retries, empty payload if `webhook_json` unconfigured. Webhooks = latency hints only; sweep = source of convergence (P1 pattern holds). |
| R12 | **Docker-bench drift vs contract notes** | Contract ground truth is 15.86.0/15.83.0 from the (now dead) bench; pin the Docker stack to the same minors, and version-handshake anyway. |
| R13 | **Permission doctrine on the ERP side** | RIS lesson: `get_all` ignores permissions, `get_doc` isn't a permission boundary. P2's adapter acts as ONE integration user per org — grant it exactly the buy-side + report perms; PMO RLS remains the user-facing authority. |

**Contradictions found across inputs (flagged):**
- **RIS pattern vs stock-bench ruling:** RIS's request layer is a custom app (custom PR/Procurement doctypes, custom fields, hooks). Owner ruled stock — so RIS transfers as *field/rule knowledge and idioms*, NOT as doctype design. Resolved as §1's "stage state lives PMO-side" doctrine; leaves OQ-1 open.
- **Aging source:** RIS computes in-app; contract notes offer the report RPC. Genuine either/or → OQ-3.
- **Edge-serve spike vs config.toml:410 comment:** comment claims serve tears down the stack via deno.land pulls — disproven; slice zero fixes the comment.
- **Rate limiting:** reuse inventory says "parameterize for Frappe's limits"; contract notes say Frappe rate limiting is OFF by default. Keep the token bucket modest + 429 handling, but don't design around a hard quota.
- **Reuse-inventory note:** migrations were renumbered mid-inventory (tasks-flip = 0093, sweep cron = 0094) and another writer is active in this worktree — re-verify migration numbers at plan time.

## 5. Open questions for the spec phase (genuinely open)

- **OQ-1 — PMO PR ↔ which stock doctype?** Material Request (type Purchase) is the stock fit but lacks supplier/grand_total/chain-link fields RIS's custom PR had; alternative is PMO-only PR (no ERP mirror) with the chain starting at RFQ/PO. Determines domain count.
- **OQ-2 — Domain granularity for the chain:** one `procurement` domain (sub-doctype routing in record/operation) vs per-doctype domains + atomic-flip invariant. (Owner's "one P2" rules scope, not this.)
- **OQ-3 — Aging source:** ERPNext report RPC (authoritative, drift-prone) vs in-app bucket math on mirrored PI/SI rows (stable, RIS-proven). Also: snapshot cadence.
- **OQ-4 — Parties scope:** Suppliers certain; are Customers/AR parties flipped too (PMO `companies` covers both) or read-only in P2 given no Sales writes?
- **OQ-5 — Amount representation at the contract boundary:** strings vs integer minor units (R4 forces one; pick affects every toBody/fromDoc).
- **OQ-6 — Per-org credential storage + binding shape:** org-sentinel row in `external_project_bindings` vs new `external_org_bindings`; where the api secret lives (Vault vs op) and who provisions.
- **OQ-7 — AP command surface:** which transitions are PMO commands (submit PI? create+submit PE? cancel?) vs desk-only in v1 of P2; each submit is irreversible-ish and needs its confirm UX + SoD rule.
- **OQ-8 — Deletion tracking:** `Deleted Document` polling vs `on_trash` webhooks vs "cancel-only, never delete" policy for money docs (likely the latter).

## 6. Recommended slice map (plan phase)

0. **Slice 0 — served-edge-fn e2e infra** (owner-ruled): serve wrapper script + CI step + health gate + config.toml comment fix + one real-boundary smoke e2e. **0b:** fresh Docker ERPNext v15 stock bench (pinned minors) + API key mint + curl smoke; document as the P2 dev bed.
1. **Seam generalization (no ERPNext yet):** routeDomainWrite/dispatchCommand, read-model writer registry, hoist apply+sweep to `adapterSeam/`, externalMirrorDeps parameterization, idempotency key + provisional-ref, multi-domain resolver, read-only-domain notion. All proven by existing ClickUp tests still green.
2. **ERPNext tier core:** `erpnext/client.ts` (auth, errors, backoff+idempotency guard), doctype registry skeleton, version handshake, org binding + per-org credentials, watermark cursor on `modified` proven against the bench.
3. **Parties flip:** Supplier(+Customer per OQ-4) commands + pull-adopt + flip migration + pgTAP; first end-to-end money-adjacent domain, no docstatus.
4. **PR + RFQ/Supplier Quotation** (per OQ-1/OQ-2): first submittable doctypes → transition op lands here; quote-selection invariant PMO-side.
5. **PO + GR:** cross-doctype ref resolution (Supplier+PR→PO; PO→GR); committed-cost read-back.
6. **PI + AP commands + Payment Entry:** the R1/R2/R3/R9 concentration — PE spike first, then commands with idempotency + confirm UX; paid-detection read-back.
7. **Read-only domains:** actuals (GL sweep → snapshot) + AP/AR aging (per OQ-3); sweep fan-out orgs × doctypes.
8. **Webhook ingress + reconcile hardening:** Frappe webhook fn (HMAC), amend-lineage adopt handling, deletion/cancel tracking, mixed-onboarding parties reconcile runbook.

Each flipped table ships its own 0093-template migration + pgTAP; every slice ends with the served-edge-fn e2e lane green against the Docker bench.
