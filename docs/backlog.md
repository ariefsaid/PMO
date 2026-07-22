# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

### ⚑⚑⚑ CURRENT FOCUS — P3a Sales/AR write-through (2026-07-15) — built + happy-path green; HARDENING ROUND mid-flight; branch, NOT merged
**Branch `feat/erpnext-adapter-p3`** (off `dev` @ `b549d06`). **HOLD on the branch — NO PR** (owner: dev
is moving with parallel agents). Spec + plan SIGNED OFF:
[`docs/specs/erpnext-adapter-p3a-sales-ar.spec.md`](specs/erpnext-adapter-p3a-sales-ar.spec.md) ·
[`docs/plans/2026-07-14-erpnext-adapter-p3a-sales-ar.md`](plans/2026-07-14-erpnext-adapter-p3a-sales-ar.md).
R9 bench spike frozen: [`docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md`](spikes/2026-07-14-erpnext-si-pe-receive-fields.md).
Owner rulings: `decisions.md` **OD-SAR-GATES · OD-SAR-PMO-IS-THE-UI · OD-SAR-DRAFT-SUBMIT**.
- **✅ Built (8 slices) + happy-path proven:** migs `0104–0107`; revenue domain (SI + PE-receive) full
  write-through through `adapter-dispatch` + the ADR-0058 fenced outbox; **two-person SoD** (SI create
  leaves an ERP DRAFT → a DIFFERENT approver submits — OD-SAR-DRAFT-SUBMIT); process-gates seam;
  inbound feed (lifecycle + adopt); AR aging (reuses P2 report path); FE (SalesInvoices/IncomingPayments/
  RevenueByProject). **Served-fn money e2e: 19/19 GREEN at the live bench** (two-person flow). Gates:
  verify (5,428) · pgTAP (1,506) · deno (69) green at the happy-path checkpoint.
- **⚑ HARDENING ROUND IN PROGRESS (re-Luna@max NO SHIP):** the first Luna audit's 8 findings were fixed;
  a **max-thinking re-audit** ([`docs/reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md`](reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md))
  found the **dispatch/repo layer has real authz/targeting/reference holes** the happy-path e2e misses
  (it hand-builds correct commands). **DONE + verified:** BLOCK 2/3/4 (dispatch domain-ownership+role+
  kind↔domain gate before ERP write — hardens ALL erpnext money writes, incl. a gap P2 shared;
  repo submit/cancel send verb+externalRecordId; transition targeting bound to the PMO mapping) + BLOCK 5
  (PE references fail-closed). **REMAINING (resume — task tree + the re-audit doc):** BLOCK 6 (cross-org
  FK check PRE-flight, before ERP write — nemotron's RED test was org-blind, needs a coherent rewrite),
  BLOCK 1 (recoveryProbe anchor-key fallback must also filter payment_type/party_type), PE-sweep
  payment_type disambiguation, BLOCK 7 (siFromDoc/peReceiveFromDoc extract customer/links so inbound
  adopt doesn't NULL them), BLOCK 8 (wire the dead `reconcileSiCancelAutoUnlink`), SF9 (project-gate-
  without-ERP-project), SF10 (partial `process_gates` bypass defaults). Then re-run the 2-person e2e +
  **re-Luna `--thinking max` until SHIP** → hold on branch.
- **✅ P3 COMPLETE (2026-07-23).** P3a shipped in #338; **P3b (timesheets) + P3c (budget) are in
  [PR #360](https://github.com/ariefsaid/PMO/pull/360) → `dev`** (branch `feat/erpnext-adapter-p3`,
  head `fabde7c5`, 35 commits). Gates re-run by the Director on the PR head: verify 746 files / 6277
  tests, pgTAP 211/2103, deno 447, **e2e serial 54/54 vs a live ERPNext bench**, visual gates 78/78.
  **11 adversarial audit rounds — 10 NO SHIP, 1 SHIP; ~54 defects, nine of them in fixes made during
  the review.** Full record + the eleven ways a test failed to fail:
  `docs/reviews/2026-07-23-p3bc-audit-program.md` (read it before the next money slice).
  Owner rulings folded in: OQ-BUD-3 (fail closed on multi-FY), OQ-BUD-3b (FY from ERPNext's own
  `Fiscal Year` doctype), OQ-TSP-5 (per-org timezone first-class + mismatch BLOCKS the flip),
  OQ-TSP-6 (ship with the correction gap).
  **⚑ Next issues this spawned, in priority order:** (1) `Approved → Draft` re-open + ERP cancel
  (OQ-TSP-6 — hit far more often than the budget deferral; mistyped timesheets are routine);
  (2) the budget fiscal-year/phasing dimension (OQ-BUD-3(c) — 8 of 54 seeded projects span years);
  (3) **FR-BUD-152 tension needs an owner ruling** — a gate rejection before FY resolution suppresses
  PMO's OWN budget figure on a year with real GL actuals (PMO-SoT data hidden by external push health).
  **Carried risks, deliberate:** `service_role` retains direct DML on the snapshot tables (the RPC is
  the only *production* writer — convention, not structure); the e2e week separator is a random base,
  safe for `--workers=1` but **not** a parallel CI matrix without deriving it from worker index.
- **Next: P4** Odoo (ADR-0055 §8) — **demand-gated, not scheduled**: it starts when a real Odoo client
  signs. There is no P5; P4 is the last defined phase.
- **Substrate (this program):** build → nemotron-3-ultra (NIM, reliable) or zai/glm-5.2 window; FIXES →
  glm-5.2 (owner directive); **money/security review → Luna `--thinking max`** (owner 2026-07-15,
  `docs/pi-delegation.md`). ⚑ ONE op on the shared worktree at a time (verify-while-agent-edits = a
  contaminated read; concurrent heavy dispatches + sibling agents' MCPs + Docker → OOM risk).

### ⚑⚑ ADAPTER PROGRAM — P2 ERPNext money core ✅ MERGED to dev (#315 squash `b549d06`, 2026-07-14)
### ⚑⚑ M365 INTEGRATION — RESUME HERE (2026-07-22) — ✅ MERGED to `dev`; dark code, live connect is the next gate

> **📌 RESUME HERE — cold-start block. A new agent needs nothing but this.**
>
> **State:** everything is **merged to `dev`** and green. There is **no in-flight M365 branch or worktree** —
> nothing half-done to recover. Read the doc-map table below in order.
>
> **Your FIRST action depends on whether the owner has provisioned Microsoft yet:**
> - **NOT provisioned** (the case as of 2026-07-22) → **do NOT start OneDrive doc-linking.** It is specified
>   but its build is gated on one proven live connection (TBD-1). If you want progress without secrets, the
>   only genuinely unblocked work is polish/hardening on what exists — check with the owner first.
> - **Provisioned** → deploy the fn, prove ONE live connect end-to-end, then run the ADR-0060 live
>   `security-auditor` gate, *then* build doc-linking.
>
> **Prove the surface still works before you change anything** (all four; the machine is shared, so wrap DB
> work in the lock and chain reset+test as ONE hold):
> ```
> scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'   # expect Result: PASS
> bash scripts/m365-race-probe.sh        # expect: TOCTOU CLOSED in BOTH interleavings
> bash scripts/m365-deadlock-probe.sh    # expect: legacy REPRODUCED + fixed RESOLVED, both targets
> cd pmo-portal && npm run verify        # full suite + build
> ```
> ⚠️ If the Supabase stack wedges, `supabase stop` then
> `supabase start -x vector,imgproxy,studio,realtime,logflare,supavisor`.
> ⚠️ Unrelated tests failing on **5s timeouts** are almost certainly another worktree running vitest
> concurrently — re-run the named failures in isolation before believing them (backlog track **T2**).
>
> **Do NOT touch** (other agents' live work as of 2026-07-22): the ERPNext P3 branch, `feat/task-model-fields`,
> PR #346, and the ~15 `agent-*`/`wf_*` worktrees. M365 owns only `supabase/functions/m365-token-custody/`,
> `pmo-portal/src/lib/m365/`, `components/integrations/`, migrations `0106–0117`, pgTAP `0144–0154`, and
> `scripts/m365-*-probe.sh`.
>
> **Before you touch the write-guard, the cascade, or the lock order:** the two probes are NOT optional and
> pgTAP cannot replace them (it runs in a single transaction and cannot express a two-session race).

**Status in one line: the whole backend + the connect UI are on `dev` and green, but the runtime has NEVER
talked to Microsoft — nothing is user-visible until an Operator entitles an org AND the edge fn is deployed
with live secrets.**

**Doc map (every M365 doc, so none orphan — read in this order):**
| Doc | What it is |
|---|---|
| [`docs/microsoft-365-integration.md`](microsoft-365-integration.md) | The vision / capability map. Start here. |
| [ADR-0058 *(m365 variant)*](adr/0058-microsoft-365-integration-architecture.md) | Integration architecture (auth≠authz, two-switch, Graph-follows-ADR-0055) |
| [ADR-0059 *(entra variant)*](adr/0059-entra-app-registration-topology.md) | Entra app topology — **Option C**, per-client app in the vendor tenant |
| [ADR-0060](adr/0060-microsoft-graph-token-custody.md) | The 10 binding token-custody controls + the mandatory live security gate |
| [Phase-0 spec](specs/m365-phase0-foundation.spec.md) · [plan](plans/2026-07-14-m365-phase0-foundation.md) | SSO + entitlement + the card |
| [Phase-1 spec](specs/m365-phase1-graph-token-custody.spec.md) · [plan](plans/2026-07-15-m365-phase1-token-custody.md) | The token-custody runtime |
| [**OneDrive doc-linking spec**](specs/m365-onedrive-doc-linking.spec.md) | ⏸️ **NOT BUILT** — the next feature; 22 ACs, `AC-M365DOC-0xx` |
| [Security audit record](spikes/2026-07-15-m365-phase1-security-audit.md) | All 4 adversarial rounds, verbatim |

**Shipped (merged to `dev`):** PR **#333** (Phase-0 + Phase-1 custody) · **#337** (connect wiring +
`connection_status`). Branches/collector deleted. Migrations **`0106–0117`**, pgTAP **`0144–0154`**, edge fn
`supabase/functions/m365-token-custody/`, FE `pmo-portal/src/lib/m365/` + `components/integrations/`.
- **✅ Phase-0** — Sign in with Microsoft (`azure` OAuth; auth-only, authz stays invited-`profiles`+RLS),
  provisioning hardening (graceful not-provisioned state), `m365_integration` entitlement (Operator switch,
  default-off) + `M365ConnectionCard` (two-switch gate, disabled stub). Battery green (spec APPROVE ·
  security SHIP-WITH-FIXES · quality APPROVE-WITH-FIXES → fixes applied).
- **✅ Phase-1 token-custody runtime** — edge fn `supabase/functions/m365-token-custody/` (ADR-0039 pattern:
  Node-testable DI handlers + thin `Deno.serve` index): PKCE initiate → callback code-exchange →
  AES-256-GCM encrypt → store → Graph proxy (server-side decrypt, data-only responses) → refresh rotation +
  reuse-detection → revoke → audit via the `audit_m365_event` SD wrapper. Store `ms_graph_connections`
  (RLS forced, zero policies, ciphertext-only) + `m365_pkce_states` (single-use, TTL, swept).
- **⚑ SECURITY: 4 Luna (gpt-5.6-luna:max) rounds → `SHIP-WITH-FIXES`, all fixes applied.** Full record:
  `docs/spikes/2026-07-15-m365-phase1-security-audit.md`. R1 BLOCK (Critical: cross-account consent-phishing
  harvest; cascade wired to nothing) · R2 BLOCK (Critical: **empirically reproduced** MVCC callback/lifecycle
  race) · R3 BLOCK (**reproduced a real deadlock**, disproving the Director's "deadlock-free" claim; + a
  regex-escape bug that would have installed NONE of the hardening) · **R4 SHIP-WITH-FIXES** (no High/Critical;
  disabled-user + disentitled-org bypass rejected LIVE with 42501). Controls: id_token `tid` assertion,
  **TOFU + enforce-on-reconnect `oid` binding (owner 2026-07-17)** with a write-once DB trigger, a locked
  write-guard (resurrection structurally impossible), ONE global lock order (profiles→org_features→connection)
  via SD RPCs with `service_role` direct-DML revoked, offboard/disentitlement cascade + triggers + one-time
  audited scrub. Probes: `scripts/m365-{race,deadlock}-probe.sh` (two-session, fail-before/pass-after).
  **⚑ Lesson: every defect across all 4 rounds passed the happy-path pgTAP AND the full verify — tests alone
  would have shipped all of them.**
- **⚑ Migrations RENUMBERED TWICE onto dev (2026-07-17):** M365 was cut from a stale base and numbered
  0096–0107, colliding with dev's ERPNext 0096–0103 → renumbered to 0104–0115. Then the **H4 grants work
  merged to `dev` (#336)** taking migrations `0104`/`0105` + test `0142` — the exact numbers — so M365 was
  renumbered AGAIN to **`0106–0117`**, test `0142`→**`0154`** (`0143–0153` were already unique; note
  `0034/0052/0066` duplicate pgTAP prefixes pre-exist on dev, so test numbers are not ordering-critical —
  migrations are). **⚠️ Lesson: GitHub reported PR #333 `MERGEABLE`/`CLEAN` the whole time — git only sees
  different FILENAMES, so a green mergeable status does NOT catch migration-number collisions. Check
  `ls supabase/migrations | sed -E 's/^([0-9]{4})_.*/\1/' | sort | uniq -d` before merging any branch that
  adds migrations.** Cross-refs rewritten in M365 files only; non-M365 refs (0064/0070/0075/0076/0079/0080)
  + the 32 `AC-M365-1xx` ids verified untouched; `docs/spikes/` deliberately left as the historical record.
- **✅ Connect UI wired (#337)** — `M365ConnectionCard` is no longer a stub: Connect → `initiate_connect` →
  **top-level** redirect to Microsoft consent → callback consumed once + query-param cleared → Disconnect
  behind a destructive `ConfirmDialog`; the whole `M365ErrorCode` taxonomy mapped to human copy; in-flight
  guard; **no token/`oid`/raw error ever reaches the DOM**. Client transport `src/lib/m365/connectClient.ts`.
- **✅ `connection_status` action (#337)** — wiring exposed a real defect: `ms_graph_connections` is RLS-forced
  with ZERO client policies (by design), so the browser could never learn a connection existed and a connected
  user was permanently shown "Not connected". Added a **read-only** action reusing the identical gate chain
  (verifyCallerJwt → RLS-scoped org → real-JWT Admin → entitlement), own-row scoped, **explicit column
  allowlist** `status, connected_at, last_refresh_at, scopes` — ciphertext/`key_id`/`oid`/tenant are never even
  *read from the DB*, so a future schema column cannot leak by default. No writes, no RPCs, **no locks** (so it
  cannot perturb the global lock order).

#### ⏸️ TBD — what is NOT done, in dependency order
1. **Live deploy + ONE proven connection (OWNER-GATED — the real next gate).** Needs: KEK `M365_TOKEN_KEK`;
   `M365_CLIENT_SECRET`/`_ID`/`_TENANT_ID` — **a concrete tenant GUID** (`common`/`organizations` are
   unsupported: the callback asserts `id_token.tid === M365_TENANT_ID`, which a wildcard value can never
   satisfy); the allowlisted redirect URI; Entra delegated scopes `Files.Read`+`offline_access`+`openid`+
   `profile` with **admin consent**; then `supabase functions deploy m365-token-custody`.
   **Director recommendation (2026-07-22):** do NOT use a real client's tenant for the first connect. Use an
   own tenant — an EMPTY one first (proves the mechanics with nothing to damage), then a client-*like* one
   (real files/permissions/admin-consent = where the real surprises are). ADR-0059 Option C gives every client
   its own app registration, so testing in one tenant commits nothing to another.
2. **`security-auditor` pass on the LIVE flow** — ADR-0060 mandatory gate, distinct from the 4 code rounds.
3. **OneDrive doc-linking** — [spec written, NOT built](specs/m365-onedrive-doc-linking.spec.md). **Build should
   follow (1)**: it consumes a runtime that has never spoken to Microsoft, so a wrong assumption there reworks
   both layers.
4. Later (vision §3.3+): Teams, Outlook/Calendar, in-app browse/preview, Entra-group→role provisioning.

#### ⚑ GOTCHAS — hard-won, do not rediscover
- **The runtime has NEVER contacted Microsoft.** Every Phase-1 test mocks `fetch`. 4 security rounds + 1,600
  pgTAP + 5,400 unit tests prove the custody *model* (encryption, RLS, races, deadlocks, lifecycle deletion) —
  they prove **nothing** about real consent screens, real token payloads, or Graph behaviour. Expect
  first-live-connect surprises; that is normal and is exactly what gate (1) buys.
- **`common`/`organizations` will silently never work** — see TBD-1. Use a concrete tenant GUID.
- **Tests alone would have shipped every one of the 4 security defects** (two Criticals, a reproduced deadlock,
  and a wrong "deadlock-free" claim by the Director). They ALL passed the happy-path pgTAP *and* the full
  verify. Adversarial review is what caught them — budget for it on any security-critical surface.
- **A green "mergeable" does NOT catch duplicate migration numbers** (git compares filenames). Bit this
  program **twice**. See backlog track **T1** for the proposed CI gate.
- **A linked OneDrive doc will be a URL, not a token-mediated stream** — Microsoft stays the permission
  authority, so a linked row must stay visible even when the connection is stale/revoked (spec §3.4).
- **Our scope gate permitting a Graph path ≠ Microsoft granting it.** `scopeCoversPath` allows GET under
  `/me/drive`,`/drives`,`/sites` with `Files.Read`; SharePoint libraries still need admin-consented
  `Files.Read.All`/`Sites.Read.All` or Microsoft 403s (surfaced as `GRAPH_ERROR`).
- **Two probes exist and must stay green** — `scripts/m365-{race,deadlock}-probe.sh` are two-session concurrency
  probes with fail-before/pass-after semantics. pgTAP runs in ONE transaction and **cannot** express these races;
  if you touch the write-guard, the cascade, or the lock order, run the probes, not just the suite.
- **⚠️ ADR NUMBER COLLISION (debt, not M365-specific):** three ADRs are numbered **0059**
  (`entra-app-registration-topology`, `external-admin-connect`, `pmo-sot-with-external-side-mirror`) and two are
  **0058** (`microsoft-365-integration-architecture`, `erpnext-money-idempotency-outbox`) — same root cause as
  the migration collisions (parallel agents numbering off stale bases). So a bare "ADR-0059" is **ambiguous**;
  always cite ADRs by *filename* in M365 docs. NOT renumbered here: 0058 is cited in ~55 files and 0059 in ~21,
  spanning other programs' work — that is an owner-level call, not a side effect of an M365 doc pass.

### ⚑ H4 GRANTS HARDENING (2026-07-16) — separate branch `fix/revoke-client-truncate-grants` (off `dev`), NOT pushed/PR'd
Spun out of the M365 Luna audit. Commits `57957091` (Tier 1) + `246be744` (Tier 2). **Root cause was bigger than
the finding:** the grants come from Supabase's bootstrap **DEFAULT PRIVILEGES** (`pg_default_acl`), so EVERY new
table silently inherited `truncate` for `anon`+`authenticated` — `0075` was just where it was visible. Fixed at
BOTH layers (`ALTER DEFAULT PRIVILEGES` + a catalog sweep over all 65 public tables). Tier 1 = revoke
`truncate/references/trigger` from both client roles. Tier 2 = revoke `anon` I/U/D (`0109` was the ONLY test
depending on it — its assertion moved "UPDATE affects 0 rows" → `throws_ok 42501`: same goal-oracle, strictly
stronger mechanism). ACs `AC-GRANT-007/010/011/012/013`. Gates: pgTAP 166/1471 PASS · verify exit 0. **Accepted
residual:** a `supabase_admin` default-priv entry can't be revoked (migration runner `postgres` isn't a
superuser/member) — inert (every public table is created BY `postgres`), and `AC-GRANT-010`'s creator-agnostic
catalog sweep catches real drift. **✅ MERGED to `dev` as PR #336 (`adf79e48`, owner) — it KEPT `0104`/`0105`
+ test `0142`; M365 renumbered above it to `0106–0117`/`0154` instead.** Branch deleted.

### ⚑⚑ ADAPTER PROGRAM (2026-07-14) — P2 ERPNext money core MERGING (#315, owner go; CI green)
- **✅ P2 BUILT + FULL BATTERY CLOSED + POST-OPEN HARDENING** (branch `feat/erpnext-adapter-p2`,
  migs `0093/0094 + 0096–0103`, 5 edge fns, live-bench-proven): 9 slices (served-fn e2e infra ·
  fenced money outbox · tier core · parties · MR/RFQ/SQ · PO/GR · PI/PE full AP surface ·
  aging/actuals · change-feed). Battery: Luna money audit ×2 (build round: double-pay C-1 → PE
  composite probe + `held`; finalization TOCTOU → fenced RPC; post-open round: 3 BLOCK + 2 SF all
  fixed — 0097 Internal-exemption bypass, webhook shared-secret ambiguity → 401, future-due aging
  leftover → `current` invariant, fencing-loss re-read, per-currency aging rows) · quality/spec ·
  Discover. **Post-open (2026-07-14): EDGE_JWT_ISSUER (SUPABASE_ env prefix platform-rejected —
  dev's override was dead) · aging parser rewritten for the real per-voucher v15 report ·
  PostgREST NULL-composite in claim/quarantine RPCs · 3s bounded committing-wait · INBOUND FEED
  ARMED LIVE (Frappe Webhook + HMAC → full-fidelity party adopt; sweep GL/PLE mirror; field-level
  inbound re-sync of linked rows deliberately out of P2 scope — lifecycle+adopt only).** Gates:
  verify 5,325 · pgTAP 166/1,458 · serial battery 21/21 + smokes 16/16 (zero skips, live bench).
  Residuals (decisions.md `OD-ENA-*`): contacts-inbound deferred · procurement_items INSERT open
  by design · VendorQuotesTab badge slot · e2e-cleanup un-flips manual fixtures (ops note) ·
  OD-ENA-VAULT-SEAM + OD-ENA-SHARED-BINDINGS (coordination with the OD-INT admin-connect layer).
  **Activation checklist (owner-gated):** per-org `external_org_bindings` + secret_ref fn-secrets ·
  Vault `erpnext_sweep_url/secret` · webhook secret per instance · Frappe Webhook doctype config
  (local demo of ALL of it ran 2026-07-14 on the owner's machine — 2-way sync verified).

### ⚑⚑ SHIPPED TO PROD — v0.7.0 (2026-07-14, owner-instructed full release)
`main`→`production` promoted; release-please cut **v0.7.0** (PR #319 admin-merged). Prod state: **DB at
mig `0095`** (`db-push-prod.sh` applied `0084–0095` — agent_usage cols, external adapter seam, rate-limit,
ClickUp flip/sweep, is_active_member banned_until; all additive/flag-off), **all 10 edge fns deployed at
`99df5fc`** (health reports it), **FE `production`=`99df5fc`** (pmo-bfb.pages.dev). Contents = **ADR-0057
JWT Task 3** (compose-view/adapter-dispatch/agent-chat → local ES256 JWKS caller-JWT verify, dropping
`auth.getUser`; is_active_member also checks `banned_until`) + analytics #324 + e2e-isolation #317/#326.
Plan + prod runbook: [`docs/plans/2026-07-12-jwt-signing-keys.md`](plans/2026-07-12-jwt-signing-keys.md).
- **Deploy gotchas learned (see `deployment.md` memory):** `stamp-edge-fns.sh`/`supabase functions deploy`
  ship the WORKING-TREE code at the CURRENT `HEAD` — `git reset --hard origin/main` BEFORE deploying (a
  stale local `main` briefly regressed prod fns this release, corrected). Docker Desktop file-sharing
  breaks under heavy load → restart Docker if the bundler mount-fails. `db-push-prod` is all-or-nothing
  sequential — check the `--dry-run` list before confirming.
- **Pending (owner, none blocking):** (1) valid-token end-to-end smoke = a live-app login → Assistant
  answers (couldn't mint a prod token safely; reject-path + JWKS(ES256) already green); (2) ClickUp sweep
  cron `0094` idle until Vault secrets (`clickup_sweep_url`/`clickup_sweep_secret`) + fn env set;
  (3) PostHog events need `POSTHOG_PROJECT_KEY` in prod.

### ✅ COMPLETE ON `dev` (2026-07-22) — ClickUp integration + integration enablement
> **COLD-CONTEXT? START HERE →** [`docs/plans/2026-07-20-clickup-integration-completion.md`](plans/2026-07-20-clickup-integration-completion.md)
> Current enablement authority: ADR-0061 + [`docs/specs/integration-enablement-model.spec.md`](specs/integration-enablement-model.spec.md).
> Live-smoke evidence remains in [`docs/spikes/2026-07-17-clickup-live-smoke.md`](spikes/2026-07-17-clickup-live-smoke.md).

The program is merged to `dev` through **PRs #353–#358**. The task feature is complete for every task
column reachable from the UI without requiring ClickUp: description and priority (#350), subtasks,
archive and delivery-rollup exclusion (#352), plus project-aware ownership and routing.

`EXTERNAL_CONNECT_ENABLED` is **default-ON**, not a rollout flag. Unset, empty, and unrecognised values
are enabled; trimmed case-insensitive `false|0|off|no|disabled` disables. It is an operator break-glass
for ClickUp and ERPNext. Per-org active bindings and Vault credentials are the enablement authority, so
production's unset variable does not mean the integration is inert and there is no flag-flip step.
Ownership follows `project_domain_externally_owned` (migration `0146`): mixed ClickUp-owned and PMO-native
projects are supported. An unbound List cannot leak tasks into PMO; zero active bindings is healthy/inert.
**Locked decisions: `docs/decisions.md` OD-INT-1..13** (admin self-serve · personal-token/API-key v1 ·
**Vault-backed `secret_ref`** · one tier-generic layer · sequenced after #315 · **OD-INT-6 ERPNext Company
selected at ORG level** · **OD-INT-7 project↔List link is PROJECT-SCOPED to the owning active PM** ·
**OD-INT-13 status map round 3 — pmo-only outcomes with Blocked defaulting to pmo-only**).

**Still open:**
1. Promote `dev` → `main` (117 commits); only PR→`main` runs integration (pgTAP + full e2e + visual),
   and this work has only used the verify-only fast lane so far.
2. Promote `main` → `production`, owner-gated per instance; this is the deployment, not a flag flip.
3. Correct the owning layer for `AC-IEM-004` and `AC-IEM-007` (specified curated e2e, implemented lower).
4. Add read-only per-status mapping visibility/override to the binding map (OD-INT-13; auto-derivation is
   correct, so this is a transparency gap).
5. Per-org webhook secret remains deliberately deferred for single-org scope (OD-INT-14 / ADR-0047).

Historical design and phase details remain in [`docs/plans/2026-07-13-clickup-admin-integration-flow.md`](plans/2026-07-13-clickup-admin-integration-flow.md); they are not the current completion status.

### ⚑ prior program block (2026-07-10) — P0 seam SHIPPED to dev; P1 ClickUp shipped (#307)
- **✅ P0 external-adapter seam MERGED to `dev`** (PR #299, `2cbacd5`; ADR-0055): migrations
  `0087–0090` (ownership switch + refs + watermarks + reference read-model w/ RLS write-flip),
  `adapterSeam` pure core, `adapter-dispatch` edge fn, read-only Integrations section on
  Administration. Full battery (spec APPROVE · quality/design APPROVE-WITH-FIXES→applied ·
  security SHIP); gates Director-run. Deferred: error-passthrough + payload-bound (security
  L2/L3), display-label map (`OD-EAS-LABELS`), `executeWrite` wiring into real repos (P1).
- **✅ P1 ClickUp adapter (tasks domain) — BUILT, battery-green, PR pending** (branch
  `feat/clickup-adapter-p1`; spec signed off + ADR-0056): 6 slices (schema flip 0093 + Vault-cron
  0094 · adapter module · repo wiring + byte-for-byte net · change-feed webhook/sweep · onboarding
  both directions · view/labels), 35/35 ACs proven, 2 e2e (AC-CUA-090/091, page.route pattern,
  serial-only — shared seed org). Battery: spec/quality/Discover APPROVE-W-F → all applied;
  security SHIP-W-F → HIGH-1 (sweep-cron Vault regression) FIXED + cross-family CONFIRMED-SHIP.
  Gates Director-run: verify 4906 · pgTAP 157/1291 · 4× deno · e2e 2/2. **Mocked-only: live
  ClickUp smoke deferred until a token exists (plan Appendix A; needs CLICKUP_API_BASE_URL seam).**
  Activation checklist (owner-gated): 2 Vault secrets (clickup_sweep_url/secret) + fn envs
  (CLICKUP_API_TOKEN/WEBHOOK_SECRET/SWEEP_SECRET, 1P vault-AS items clickup-api-token/-webhook-secret).
  B2B note: per-org webhook secret before >1 employing org shares a deployment (security LOW-1).
  **P2 prereq (Director): served-edge-fn e2e infra — money commands get the real boundary, not
  page.route.** Next: P2 ERPNext money core, P3 width, P4 Odoo (ADR-0055 §8).

### ⚑⚑ RESUME HERE (2026-07-09) — agent experience SHIPPED to prod; automations HELD for prod
Full detail in memory `agent-multiround-handoff-20260708.md` (loaded each session). Snapshot:
- **⚑ BINDING: agent model = `deepseek/deepseek-v4-flash` — NEVER change without a DIRECT per-instance owner instruction. Browser tests via a Playwright CLI script / `agent-browser`, NEVER the Playwright MCP (it leaks node servers).**
- **✅ SHIPPED TO PROD — `v0.4.0`** (`production` == `main` content; edge fns redeployed to `prwccpsiumjzvnwjlkwq`; verify: `curl .../functions/v1/health` reports the git SHA): run-persistence fix (#271), **multi-turn follow-ups**, **adoptRun** (follow up on a History-loaded convo), **latency ~19s→~6s** (`provider:{sort:'throughput'}` + temp 0.8, model unchanged), **ThinkingBubble interactivity**, **edge-fn versioning** (baked per-fn SHA + `x-deploy-version`), **client-facing cleanup** (removed the `edge·sha` panel label + the GitHub commit link — repo is public). Proven via Playwright-CLI: 8/8 multi-round turns, history persist+reload, follow-up-from-history.
- **⏸️ HELD FOR PROD (owner "hold for productions" 2026-07-09): automation enablement — MERGED to `main` (`d5e97d0`), NOT deployed.** The e2e uncovered + FIXED that automations NEVER fired: `agent-dispatch/mint.ts` read `data.properties.access_token`, which Supabase `admin.generateLink({type:'magiclink'})` NEVER returns (it returns `hashed_token`) → every fire threw `mint failed`. Fixed to the correct **generateLink → verifyOtp(token_hash) → owner session** flow (proven e2e locally: real notification written). Plus: dedicated `AGENT_DISPATCH_SECRET` in **Vault** replaces the master service_role key for the cron→fn auth (mig `0082` — master key no longer in the DB); schedules restricted to **daily/weekly/day-of-month** (minute-0); tick → **hourly**. Security-auditor: **SHIP** (no High/Critical; deputy invariant intact).
- **HELD prod-enablement checklist (owner-gated, on GO):** (1) apply mig `0082` to prod DB (`db-push-prod.sh`; prod at `0081`, `0082` is the only pending, additive); (2) create 2 Vault secrets (`agent_dispatch_url`=fn URL, `agent_dispatch_secret`=fresh `openssl rand`); (3) set `AGENT_DISPATCH_SECRET` fn env = SAME value; (4) redeploy `agent-dispatch`+`agent-chat`; (5) prod fire-test (due automation → notification + confirm NO owner email). **No owner secret input needed** (service_role auto-injected; dispatch secret self-generated).
- **Agent write set** = 4 RLS-scoped, approval-gated actions: `create_activity` (CRM), `update_task_status`, `create_automation`, `notify`. Base agent is read-only; no general "edit project" action yet (would be a new can()+RLS+SoD+approval action). **Audit trails:** `audit_events` (0076, immutable, who/what/from→to for money/transitions/deletes/credits), `procurement_status_events` (0038), `agent_events` (0046, every agent tool call), `0079` agent-denial audit; business tables carry created_at/updated_at.
- **Specs (dev):** ARH/ARM/ATO/ALR/AMT (agent gap-analysis do-now/do-next) — planning docs, NOT built. Token streaming still queued.

### 2026-07-10 — IG backend-checklist audit (@web_pros "Vibecoding a Backend?") → 2 findings
Audited the PMO backend against the post's 15-item shipping checklist + security/scale/production slides.
Result: **12/15 solid, exceeds on authz/secrets/testing**; 3 deliberate skips (Redis cache, ORM, Docker —
YAGNI at single-tenant scale). Two real gaps, prioritized:

- **P1 — request-rate limiting on public/expensive edge fns. ✅ PR'd to `dev` (feat/edge-request-rate-limit).**
  `creditRateGuard` bounds SPEND but there was **no request-FREQUENCY limit** on the public edge fns beyond
  Supabase platform defaults — a burst can't drain credits (reserve_credits closes that) but CAN burn
  invocations + upstream OpenRouter latency; admin-invite abuse can email-bomb. Fixed-window limiter —
  mig `0091_request_rate_limit.sql` (`request_rate_counters` unlogged + RLS force/no-policy;
  `rate_limit_hit(key,limit,window)` SECURITY DEFINER, service-role grant) + shared
  `_shared/requestRateGuard.ts` (fail-OPEN — availability defense, opposite of the credit guard) + wired
  into `agent-chat/index.ts` (post-JWT, keyed `agent-chat:<userId>`, 20/min default via
  `AGENT_RATE_LIMIT_PER_MIN`, 429 + Retry-After). Tests: pgTAP `0140` (9 assert, AC-RL-002..006) +
  `requestRateGuard.test.ts` (6, AC-RL-001). Verified: pgTAP 9/9, vitest 6/6, full `npm run verify` green,
  `deno check` clean. **Supersedes the older scattered "agent-chat rate-limit" Med.** Fast-follows
  **✅ DONE** (PR #304): `compose-view` (model spend, `COMPOSE_RATE_LIMIT_PER_MIN` def 20) +
  `admin-invite-user` (email/user abuse, `INVITE_RATE_LIMIT_PER_MIN` def 10, throttle placed AFTER
  authorization so FR-INV-004 holds — service_role never exercised for an unauthorized caller).
  `health` left unthrottled deliberately (cheap, no spend). Cron fns (`agent-dispatch`,
  `telegram-notify`) are secret-gated, not public — out of scope.
- **P2 — error monitoring: PostHog Error Tracking (NOT Sentry — correction 2026-07-10).** The earlier
  "needs a Sentry-class tracker" framing was WRONG: PostHog *is* the error tracker, already integrated,
  and the **frontend already runs it** — `window.onerror`/`unhandledrejection` (`AnalyticsProvider`) +
  React `ErrorBoundary` → `posthog.captureException`, privacy-redacted (`before_send`), `safeTrack`-wrapped.
  So no Sentry, no new dep, no external account. **✅ Server-side half wired (PR #305):** the universal
  edge-fn logger `logStructuredError` now fire-and-forget fans every error into PostHog Error Tracking via
  `_shared/posthogError.ts` (guarded no-op outside Deno / without `POSTHOG_PROJECT_KEY`; sends only the
  error CODE + fn + non-secret contextId/orgId). Client + server errors now share one issues view.
  **Deploy step (owner, on GO):** set `POSTHOG_PROJECT_KEY` (the phc_ ingestion key, 1Password
  `pmo-posthog-token`) as an edge-function secret in the Cloud project — until then the forward is a
  silent no-op (error_events + Telegram unaffected). `error_events` retention/completeness remains a
  minor separate Med.
- **Plus — PostHog dashboards BUILT (separate deferred item, done this session).** ✅ 3 dashboards /
  19 insights live in project `465502` (Agent adoption+reliability · Auth login health · Product
  usage+friction), provisioned **as code** from the typed event catalog. PR #303
  (`feat/posthog-dashboards`), script `scripts/posthog/provision-dashboards.mjs` (idempotent,
  upsert-by-name), docs `docs/posthog-dashboards.md`. Write-scoped key = 1Password `posthog-personal-api`
  (`phx_`). Partly addresses the GTM observability-floor "PostHog dashboards" line below.

### ⚑ CURRENT STATUS (2026-07-07 late) — read first; trust git over memory

**Branches:** `origin/dev` == `origin/main` == **`c0b0081`** (RECONCILED 2026-07-07 — two parallel agents' work unified: the GTM hardening wave + agent-prod-readiness; only `backlog.md` conflicted, resolved by union). `origin/production` == **`94ce615` (UNTOUCHED — prod NOT deployed** with any of the below; still the OLD prompt/schema, Cloud DB at mig ~`0060`). Migrations → `0075`, pgTAP top `0133`.

**On dev/main now:**
- **7-issue GTM wave** (ops-admin #243 · legal #247 · obs-floor #248 · onboarding #249 · auth #235 · deputy-help #233 · DR #230), each full-loop.
- **org_id-seam hardening** (#250, mig `0074`): `stamp_org_id()` trigger on 42 tables (narrow variant — stamp when null/seed-default, forged foreign org → 42501; `credits`/`org_features` excluded); security SHIP, pgTAP 1119.
- **Agent prod-readiness** (other agent): mig `0061` persistence-for-all-orgs (fixed the real prod bug — `org_id` seed-only default made non-seed users' runs fail RLS silently), 8-entity read-scope (`entityCatalog.ts`), deterministic query-skills (`agent-chat/prompt.ts`), skill-creator vendored, query-selection eval probe (deepseek-v4-flash 100% call rate), CRM flag enabled. Component-verified; the live answer→render→persist loop NOT proven-in-prod (browser harness failed).
- **Deep multi-auditor audit (2026-07-07): GO-WITH-CAVEATS** — foundation is ship-grade (RLS 48/48, org_id seam, SoD RPCs all pgTAP-proven, money uniformly `numeric`, `npm audit` clean, no Critical *security* hole); the blockers cluster in **agent-subsystem reliability + supply-chain + no audit-trail**, not the CRUD/RBAC/RLS foundation. (Full audit body in the 2026-07-07 session transcript.)

**Audit fixes SHIPPED to dev/main:** auth-floor pre-flight enforcement (#251, `check-auth-floor.mjs` gates `provision-client.sh`) · avatar AA-contrast (#252, `--avatar-1..5` tokens) · `auto_expose_new_tables=false` + explicit-grants mig `0075` (#255, column-level-aware mirror) · CORS fail-closed + `||true`-test fix + ADR-0049→0054 (#254) · production-auth-config deploy checklist codified (`environments.md`).

### ⚑ CRITICALS + AUDIT-GAP FIXES LANDED (2026-07-07 — all merged to `dev`, prod untouched) ⚑
Substrate: glm-5.2 (opus alt) + glm-4.7 (sonnet alt) built; Director security-reviewed every diff + verified pgTAP serially. `origin/dev` tip carries ALL of the below; `origin/production` == `94ce615` (UNTOUCHED). **NOT yet promoted to `main`** — see "Next" below.

**MERGED to dev (audit's 3 Criticals + 4 top gaps):**
- **#16 automation double-fire (Rel-Crit)** — PR merged. Mig `0078_automation_fire_claim.sql` (per-`(automation_id,event_id)` PK claim, service-role-only) + `claimTriggerFire` in `dispatcher.ts` + pgTAP `0135`. *(Director fixed glm-4.7's hallucinated `.on().ignore()` supabase-js API + `has_table`/`trigger_on` pgTAP bugs.)*
- **#17 audit_events + log_audit() (Obs-Crit)** — PR #256. Mig `0076_audit_events.sql` (append-only, FORCE RLS, one SELECT policy own-org Admin/Operator, `log_audit()` postgres-owned definer sole writer; wired into `operator_grant_credits`/`set_project_contract_value`/`transition_document_status` + companies/projects AFTER-DELETE triggers) + pgTAP `0133` (28). *(Director caught: transition copied from STALE 0017 → dropped 0025's auto-Supersede → `0066` regressed → re-based on 0025; hardened append-only to privilege-denied; fixed non-runnable frozen-test SQL.)*
- **#15 reserve_credits (Rel-Crit) — DORMANT primitive** — PR #257. Mig `0077_reserve_credits.sql` (`credit_reservations` hold-ledger + `reserve_credits()` under `pg_advisory_xact_lock` + `release_credits()`) + guard `check(orgId, runId?)` + pgTAP `0134`. Director-reviewed (advisory-lock accounting closes the race). **⚠️ DORMANT: no call-site passes a runId + `AGENT_CREDITS_ENFORCED` OFF → reserve/release never invoked → changes no live behavior.** **Deferred wiring (the actual race-closer, tracked below).**
- **#18 agent SoD-refusal audit (Obs-High, gap #1)** — PR #259. Mig `0079_audit_agent_denial.sql` — `authenticated`-callable SECURITY DEFINER wrapper stamping action/org/actor server-side (non-forgeable) → `log_audit`; wired into the 2 `can()`-preflight refusal sites in `agent-chat/handler.ts` (fail-open). pgTAP `0136` (19).
- **#19 agent-dispatch reliability (gap #3) + #16-regression fix** — PR #258. `advanceWatermark` now surfaces `WATERMARK_ADVANCE_FAILED` (was swallowed). **AND fixes a vitest regression #16 landed on dev**: `claimTriggerFire` hit `dispatcher.deputy-invariant.test.ts`'s mock default-throw → AC-AAN-024 failed; taught the mock the `agent_automation_fires` claim. *(gap #4 select_trigger_events org-constraint = NO-OP by design: 0054 is service_role-only + its (org_id,to_status) filter-join IS the tenancy authority; no automation context in the RPC to constrain further. Not changed.)*

**Migrations now `0076–0079`; pgTAP `0133–0136`.** *(Op-lessons this wave: glm agents copy the STALE migration body for `create or replace` RPCs — grep ALL defs, use latest. Frozen RED tests carried non-runnable SQL — non-hex UUIDs, `is(numeric,integer)`, `table_exists`→`has_table`, `profile_status` enum is `active`/`disabled` not `inactive`. Merging on pgTAP-ONLY verify let a VITEST regression reach dev — run BOTH pgTAP + `npm run verify` before merge for anything the dispatcher/handler touch. AC-AUTHF-036 timed out only under heavy concurrent-agent load = flake; CI (isolated) is the reliable gate. A live pi run collides with `db reset` on the shared stack — `pgrep -fl "pi --provider"` before resetting.)*

### Status
- **✅ PROMOTED `dev`→`main`** (PR #261, `e4fc018`) — `main` == `dev` content; `production` UNTOUCHED (`94ce615`). All audit Criticals + gaps + supply-chain/CI + the service_role regression fix are on `main`. Integration lane (full e2e + visual) GREEN.
- **✅ service_role grants regression FIXED** (PR #262, mig `0080` + pgTAP `0137`) — **the promote's e2e caught it**: `0075`'s auto-expose lockdown re-granted `authenticated`/`anon` per-table but **never re-granted `service_role`** → service_role lost DML on all tables → would 42501 `admin-invite-user` + agent persistence IN PRODUCTION. 0080 restores service_role's full DML + `ALTER DEFAULT PRIVILEGES`. **Op-lesson: PR→dev skips e2e, so a service_role/grant regression is invisible until the promote's `integration` lane — pgTAP runs as the superuser migration role (bypasses grants) and cannot catch it. The integration gate earned its keep.**
- **✅ `main`→`production` DEPLOYED (owner-instructed 2026-07-07)** — holistic: prod Cloud DB migrated `0061→0080` (`db-push-prod.sh`, all additive, ✓ applied, dry-run clean) · all 6 edge fns redeployed to `prwccpsiumjzvnwjlkwq` · **`SITE_URL=https://pmo-bfb.pages.dev` set** (was MISSING — would have 500'd admin-invite-user + blocked agent-chat CORS) · FE pushed `git push origin main:production` (`94ce615..e4fc018`, CF Pages build). Smoke: health fn 200 `{ok:true}`, DB at 0080, pages.dev 200. **`production` == `e4fc018` == `main` content.** ⏭ Still to verify: a live login→agent-answer browser smoke (needs prod creds). Auth-floor dashboard config (signup-off/confirmations/Resend) remains the owner-only manual step.

### ✅ Audit HIGHS — ALL 3 MERGED to dev (owner-directed, 2026-07-07, glm-5.2/4.7)
1. **✅ feature-flag server-enforcement** (#265, mig `0081` + pgTAP `0138`) — `org_feature_enabled()` (non-raising twin of `org_has_feature`) conjoined into the WRITE policies of **24 gated tables** via a DO block mirroring 0063's apply-time append. **Director caught 2 real bugs by serial pgTAP** (both would've shipped silently): glm's `cmd in (lowercase)` filter matched nothing vs UPPERCASE `pg_policies.cmd` → gated NOTHING; + precedence paren-wrap so `(A or B) and F` holds. Full suite 1215 PASS.
2. **✅ orphaned-Auth-user compensation** (#264) — `admin-invite-user` now `deleteUser(invite.user.id)` on profile-insert failure (best-effort, distinct `PROFILE_CREATE_CLEANUP_FAILED` code).
3. **✅ e2e blindspots** (#263) — `requireServiceRoleKey()` throws in CI (wired into AC-AUTHF-005/020) + `quarantine-guard.spec.ts` self-validates the 4 quarantined tests' markers + exact count.

**Residuals from the Highs (tracked):** feature-gating the security-definer procurement/timesheet RPCs (they bypass RLS — the direct-PostgREST threat IS closed) · same un-parenthesised-append latent risk in 0063 (empirically proven-safe by the RLS suite) · the crm→companies mapping gates company writes on the CRM feature (confirm companies isn't a cross-feature dependency before enabling crm-off for a client).
**✅ PROMOTED dev→main→production (2026-07-08, owner-instructed):** the 3 Highs + two other-agent features (#267 agent-read-scope, #268 live-step-trail) shipped to dev, promoted dev→main (#269, `1f68058`, integration lane GREEN), verified main push-CI green, then main→production: prod DB `0080→0081` (feature-flag; via `db-push-prod.sh`), edge fns `admin-invite-user`+`agent-chat` redeployed, FE `main:production` (CF Pages). **`main` == `production` == `1f68058`**; smoke: health 200, DB 0081, pages.dev 200. **Op-lesson: `op-get.sh` (1Password SA token) HUNG mid-deploy (5-min+ timeouts, blocking `db-push-prod.sh`) then RECOVERED on retry — verify prod migration state via `supabase migration list --linked` (auths by access token, not op) when op is flaky; the linked project IS prod (`prwccpsiumjzvnwjlkwq`), a valid `--linked` fallback path once verified.**

**Residuals / deferred (tracked, not blockers):**
- **Credit-race WIRING (deferred with #15)** — thread `run_id` through the 3 agent-chat `check()` sites + `release_credits` after each turn; decide compose-view's missing run_id (release-by-reservation-id or a TTL reaper). Coupled pair (reserve-without-release leaks holds→org-lockout). Ships when credits are enabled (owner-gated, GTM launches un-enforced).
- **#18 residual** — `audit_agent_denial` is `authenticated`-callable → a user can inject *own-org, own-actor* denial-audit noise (append-only, low severity, no cross-org forge).
- **Auditor gaps still open (Meds/Lows):** telegram-notify send-ok+stamp-fail dup alerts (`index.ts:86`) · `notifyOwner` swallows errors untraced · health endpoint checks zero deps · `enforce_automation_owner_cap` racy count-then-insert (SHARE ROW EXCLUSIVE pattern at `0065:69`) · `set_project_contract_value` accepts negative (overlaps money `CHECK(>=0)`; #17 logs but doesn't reject) · `spike-rls.yml` `npm install`+service-role-key (pin+ci or delete) · 3 missing runbooks (prod-deploy/secret-rotation/agent-LLM-outage — doc conversions from `environments.md`).
- **Earlier-audit Meds (not started):** agent-persistence stuck-`running` · interactive-create idempotency · `error_events` completeness + retention · S-curve today-position test · PostHog consent-gate · agent-chat rate-limit.

**Audit fixes OUTSTANDING (after the 3 in-flight Criticals land):**
- **#14 supply-chain/CI** — DONE on branch `harden/supply-chain-ci` (6 `deno.lock` + version pins + `--frozen` CI gate; 12 Actions SHA-pinned; new pgTAP-on-PR→dev job). NOT merged — **rebase onto reconciled `dev`**, resolve `ci.yml`, merge LAST.
- **Remaining Meds (not started):** agent-persistence error handling (stuck `running`) · interactive-create idempotency · `error_events` completeness (2 fns + FE) + retention · S-curve today-position deterministic test · money `CHECK (>=0)` · PostHog consent-gate · agent-chat rate-limit.

**OWNER-ONLY (not autonomously doable):** execute a **DR restore drill** before client #1 · agent-tier **eval GH secrets** + **credits-enforce** decision (both deliberately deferred per GTM plan) · **MSA→counsel** (Terms/Privacy are template stubs) · automation `pg_cron` GUCs · prod Cloud auth-config verification · **prod deploy** (owner-gated, per-instance — push migs to Cloud, redeploy edge fns incl. `admin-invite-user`, FE→CF Pages, set `VITE_FEATURES_CRM=true`).

**Substrate (owner directive):** implementations run on **pi/GLM** to spare Anthropic quota; Director (Claude) orchestrates + security-reviews every diff. **Routing (owner 2026-07-07): glm-5.2 = opus alt, glm-4.7 = sonnet alt; run one dispatch per model in parallel (GLM caps parallel per-model).** **NEVER OpenRouter.** GLM/zai RECOVERED 2026-07-07 (both 5.2 + 5.1 + 4.7 responding) — the 3 Criticals above are being built on it now. Node v22 required for pi (`export PATH="/Users/ariefsaid/.nvm/versions/node/v22.20.0/bin:$PATH"`). Dispatch: `Bash(run_in_background:true)` + `< /dev/null` + `--append-system-prompt .claude/agents/implementer.md`; brief the agent NOT to touch the shared DB (Director verifies pgTAP serially). **Op lessons:** 600s watchdog kills long *quiet* verifies → run heavy `verify`/pgTAP in the main session; a live pi run collides with `db reset` on the shared stack (serialize by `pgrep`); glm-4.7 hallucinates supabase-js APIs + pgTAP fn names (`table_exists`→`has_table`) — Director must diff+fix; glm agents copy the WRONG (stale) migration body for `create or replace` RPCs (grep ALL defs, use the latest).
## ▶ GTM / MVP-viability program (owner grill, 2026-07-04 — supersedes scattered GTM notes)

**Decisions of record from the grill (all owner-confirmed):** ADR-0047 (per-client Supabase Cloud
Pro + CF Pages; VPS = documented exit path; the old cloud project is **reclassified STAGING/DEMO**,
`docs/environments.md` updated) · ADR-0048 (ERPNext = headless accounting engine under PMO;
never build accounting; no Odoo; command/query split, single-writer per DocType; accountant
workspace chunked, AR/AP aging pulled into F1; period-close/e-Faktur stays ERPNext) · glossary:
**Operator** (platform persona ≠ org Admin), **Organization = client group**, **Entity =
subsidiary dimension** (never a separate org; intra-group visibility OK for MVP).

**MVP scope (before/at first paying client) — each row ≈ one issue-loop:**
1. **Ops-Admin surface:** (a) user invite/disable (service-role edge fn + `profiles.status` +
   email rails); (b) credits → **org-pool grants** (schema tweak; flip `credits` INSERT RLS from
   role=Admin → **Operator-only** — as-built it lets client Admins self-grant); (c) usage view
   (`agent_usage` aggregates per org/user + provider-USD vs credits **margin column**; Operator
   sees **aggregates only, never transcripts** — owner-locked privacy line); (d) Operator
   mechanism = platform-level grant table, NOT a 6th enum role; (e) `org_features` entitlements
   build with ownership **flipped from the 2026-06-15 note: Operator-write, org-Admin read-only**.
2. **Auth floor (non-negotiable):** Resend SMTP · password-reset flow · email confirm + invite
   emails · redirect allowlist → prod HTTPS only · rotate/kill seed creds · `auto_expose_new_tables=false`.
   Build together with 1a (same rails). Google OAuth = stretch; SAML = out.
3. **Observability floor:** uptime ping + public status page (= the SLA answer) · PostHog error
   tracking (vendor-consolidated; still no Sentry) · one alert webhook consuming the #224 edge-fn
   errorCodes · 2 PostHog dashboards (org usage; agent cost) · real-browser PostHog spot-check.
   Explicitly NOT: log aggregation, APM, tracing.
4. **Legal floor (Indonesia):** MSA/subscription template (lawyer-day, carries manual billing) ·
   ToS + privacy static pages + footer links incl. wa.me help · pinned data-residency answer.
   Skip: GDPR self-service, cookie banner, DPA machinery.
5. **Backup/DR (cloud):** Pro plan per client project · **one restore drill** into a scratch
   project (documented) · 1-page incident runbook (FE rollback via CF, DB restore, alert path,
   client-comms line).
6. **Client onboarding:** provisioning runbook/script (project → migrations → `functions deploy`
   → secrets → org + first Admin → CF env) — this IS "add org" for the Operator; **white-glove**
   import (runbook + wizard idempotency fix) · **historical import script**: summary-grade,
   ≤1yr, terminal-status records with provenance, NO fabricated transition events.
7. **Entity (subsidiary) dimension** — conditional MVP: build when the first group-of-companies
   client signs (schema dimension + filters + rollup).
8. **Support floor:** WhatsApp group per client (response-time line lives in the MSA) · in-app
   help link · **deputy-as-help-desk** (help corpus = glossary + jtbd.md into assistant context)
   + per-role walkthrough videos recorded during onboarding. No written manual until a question
   repeats 3×.

**Deferred follow-up (Director-adjudicated during the build, 2026-07-04):**
`auto_expose_new_tables=false` (NFR-AUTHF-CONF-006) — cross-family review found flipping it strips
DML grants on all 44 tables (no migration issues explicit GRANTs), so it needs a dedicated
per-table GRANT migration + security review, NOT a jam into the auth PR. **Accepted as a tracked
follow-up issue**, not an auth-floor blocker; the auth email flows are unaffected. `config.toml`
keeps it commented with the reason; `docs/environments.md` §7.6 carries the blocking-finding note
for the eventual owner-gated hardening pass.

**CUT from MVP (owner-confirmed):** custom RBAC engine (escape valve = additive read-only
Viewer role) · Stripe/Midtrans (manual MSA billing) · VPS (exit trigger: >$200/mo Supabase or
onshore-data contract; sized playbook in ADR-0047) · homegrown accounting (never) · separate
operator console (<~5 deployments) · shared-project multi-org + org-seam proof (deferred by
per-client isolation) · SAML · GDPR self-service.

**⚑ BUILD-LOOP AUTHORIZED (owner, 2026-07-04):** autonomous session(s) on `dev`, batteries-A
goal directive (full SDD/TDD + 3-lens + rendered battery per issue, PR per issue, owner gates
`dev`→`main`). Build order: auth floor → ops-admin → observability → DR → legal pages →
onboarding tooling → support floor. **Executor policy: pi+GLM first, parallel where possible;
Claude subagents + dynamic workflows when pi quota exhausts.** Locked inputs: **domain/brand
decision DEFERRED until after issues 1–2** — build against env-var seams (`RESEND_API_KEY`,
sender/site URL as config; wire 1Password + DNS later) · Operator = operator@pmo.test ·
alerts → **Telegram bot** · uptime/status = **BetterStack** (professional client-facing status
page > reliability > ease, per owner priority order) · Supabase stays FREE tier as staging/demo;
Pro billing at first client signing · MSA brief drafted by Director (`docs/legal/`), owner takes
to counsel.

**Fast-follow (post-first-clients):** **external-system adapters per ADR-0055 (2026-07-10 grill —
supersedes ADR-0048's `pmo_connector`/F1–F3 plan):** P0 seam (adapter contract, `external_refs`
+ watermarks, pending-push UI state, capability-map config) → **P1 ClickUp adapter, tasks**
(deliberately BEFORE ERPNext — smallest adapter, proves the SoT/enhancement/read-model machinery,
distributor-partnership demo) → P2 ERPNext money core (parties, procurement chain, AP commands +
actuals/AP-AR aging) → P3 ERPNext width (timesheets, budget projection, sales docs = Revenue/AR
spine 4) → P4 Odoo adapter (when an Odoo client signs). Key rules: external system = SoT for
capability-map domains; Supabase = read-model + additive-only enhancements; synchronous
write-through; adapters = PMO-side TS on stock APIs (RIS-portal-2 `api/*.py` = mapping spec +
future helper-app source, NOT a code port). · credits **pricing decision from 2–4 wks of pilot
margin data** (launch un-enforced, then price, then enforce) · Google OAuth · PostHog
product-analytics widening.

### ⚑ GTM BUILD — HANDOFF STATE (2026-07-05, for the resuming agent — READ THIS to continue)

**What this is:** the GTM MVP program (the 8 rows above) is mid-build. **Build ≈ 72% done** (2026-07-05):
3 issues merged to `dev` (auth #235, deputy-help #233, DR #230), ops-admin built+verified awaiting
rendered-pass+PR, legal code-complete awaiting rendered-pass+PR, observability + onboarding
signed-but-not-built, Entity dimension deferred-conditional (Entity #7 excluded from the denominator
until a group client signs). **Build% ≠ ready-for-first-client%** — the gap also needs the owner-side
wiring + promote gates listed at the bottom of this block. Every issue has a signed **spec + plan**
authored via the full 2-model review battery (author → cross-model REVISE review → fix round →
Director commit; plan reviews caught real defects — a disabled-user write hole, two would-be-regressed
security fixes, 7 ACs excluded from CI). SDD docs by issue below — **read the spec then the plan
before touching any issue.** Process is unchanged: `CLAUDE.md` per-issue loop +
`docs/director-playbook.md`; `docs/pi-delegation.md` for GLM dispatch; the **binding
`pr-after-review-battery` rule — full battery (3-lens code review + rendered/Discover pass for UI +
e2e/BDD) green LOCALLY before any PR**; branch flow work→`dev`→`main` (`main` = autonomous ceiling).

**Per-issue status (branch `feat/<name>` in `../PMO-worktrees/<name>`):**
| # | Issue | Spec | Plan | Extra | State |
|---|---|---|---|---|---|
| 1 | Auth floor | `docs/specs/auth-production-floor.spec.md` | `docs/plans/2026-07-04-auth-production-floor.md` | — | ✅ **MERGED to `dev` (PR #235)** — full battery passed |
| 7 | Deputy-help | `docs/specs/deputy-help.spec.md` | `docs/plans/2026-07-04-deputy-help.md` | live-verify = `docs/qa-portfolio.md` (AC-DH-005) | ✅ **MERGED to `dev` (PR #233)** |
| 4 | DR runbooks | — | — | `docs/runbooks/{incident-response,restore-drill}.md` | ✅ **MERGED to `dev` (PR #230)** |
| 2 | Ops-admin | `docs/specs/ops-admin-surface.spec.md` | `docs/plans/2026-07-04-ops-admin-surface.md` | `docs/adr/0049-ops-admin-surface.md` | 🟢 **ALL 7 SLICES BUILT + 3-lens battery hardening VERIFIED — needs only rendered pass + PR** (branch `feat/ops-admin` @ **`e4e135b`, pushed; NO PR yet**). Slices: S1–S5 (`8cd0faa`), **S6** (`eae9d47` — `org_features` mig **0068**, `useFeature`/`FeatureGate`, Features/Credits sections, a11y capstone; pgTAP **0122/0123**), **S7** (`9c978c2` — 3 curated e2e: AC-INV-001 invite, AC-CRE-004 grant, AC-ENT-005 toggle). Migrations **0060–0068**, pgTAP through **0123**. **3-lens review battery ran (spec+code+security)** → hardening applied in `e4e135b` (sec M1 disabled-Operator RPC entry-guards, M2 invite redirectTo from `SITE_URL` not Origin header, L1/L3 credit-attribution + entitlement-probe close, L4 TOCTOU sole-admin `SHARE ROW EXCLUSIVE` lock, L5, code I1/I2/I3, spec I1). **Verified: pgTAP 1041/1041 green + typecheck/lint clean.** ⏭ **RESUME:** rendered Discover pass (AdminUsers/Usage/Features UI) → open PR to `dev`. **Deviations to carry:** CI extended for `admin-invite-user` deno-check/boot-smoke; `errorLog.ts` `EdgeFunctionName` widened; `classifyMutationError` `overrides` param; `AdminUsers.mailto.test.tsx` deleted (FR-INV-006); `deno.lock`s untracked per repo pattern. |
| 5 | Legal pages | `docs/specs/legal-pages.spec.md` | `docs/plans/2026-07-04-legal-pages.md` | — | 🟡 **CODE-COMPLETE** (branch, unpushed) — 2-lens SHIP, e2e 70/70. **NEEDS: rendered Discover pass** (stack) → PR. |
| 3 | Observability | `docs/specs/observability-floor.spec.md` | `docs/plans/2026-07-04-observability-floor.md` | no ADR (uses ADR-0046/0048 precedents) | ⏳ **SIGNED, NOT BUILT** (stack-bound). Renumber migration/pgTAP vs then-current `dev` max at build time. |
| 6 | Onboarding | `docs/specs/onboarding-tooling.spec.md` | `docs/plans/2026-07-04-onboarding-tooling.md` | `OD-ONB-1` in `docs/decisions.md` (on branch) | ⏳ **SIGNED, NOT BUILT** (stack-bound). Renumber at build time. |

**Cross-issue contracts already wired (don't re-derive):** ops-admin's `admin-invite-user` edge fn
passes `redirectTo:<origin>/update-password` + stamps `user_metadata.invite_pending=true` — the
auth-floor invite-accept gate consumes these (in the ops-admin plan).

**Two hard constraints for whoever resumes:**
1. **Single local Supabase stack = serial lock.** `db reset` is global across worktrees, so only
   **ONE stack-driving task at a time** (build with migrations/pgTAP/e2e, or a rendered pass). Order
   the remaining stack work: finish ops-admin build → its rendered pass → legal rendered pass →
   observability build → onboarding build. FE-only/unit/typecheck/lint/build + no-stack reviews may
   run in parallel.
2. **Migration/pgTAP numbers keep moving** as parallel sessions merge to `dev`. **Before building #3
   or #6, `git merge origin/dev` into its branch and re-check `ls supabase/migrations | tail` +
   `ls supabase/tests | tail`, then renumber that plan (+offset) to the next-free numbers.** (ops-admin
   was already shifted +2 → 0060–0068 for exactly this reason.)

**Executor at handoff:** GLM (pi) rate-limited until **~12:04** (2026-07-05); **Claude subagents
available** (reset 03:20). Route per `docs/pi-delegation.md` (glm-5.2 default) when GLM returns;
else Claude implementer/reviewer agents. The ops-admin completion is currently a **Claude sonnet**
agent (owns the stack).

**Owner-pending (not the build agent's to do):** wire `RESEND_API_KEY` + real DNS/sender + domain
decision (deferred); Supabase Pro billing at first client; take `docs/legal/2026-07-04-msa-brief.md`
to counsel; provide the OpenRouter fallback chain. **Deferred tech follow-up:** `auto_expose_new_tables`
GRANT migration (see the "Deferred follow-up" note above).

### ⚑ AGENT EXPERIENCE LAYER + TIER-2 — HANDOFF STATE (2026-07-05, parallel build stream — READ THIS to continue)

**Goal (owner `/goal` 2026-07-04):** full SDD→plan→TDD→review→QA cycle to surface the *built-but-not-wired*
Tier-1 batteries + build Tier-2. Executor: pi+glm first (glm-5.2≈opus / glm-4.7≈sonnet), Claude
sonnet/opus fallback. **This is a SEPARATE stream from the GTM build above — different files (agent panel /
edge fn vs auth/ops-admin); coordinate the SHARED single local Supabase stack (no concurrent `db reset`/
pgTAP/e2e — `docs/environments.md` local-stack hygiene).**

- **SDD (source of truth):** specs `docs/specs/agent-experience-layer.spec.md` (FR-AXP-*) +
  `docs/specs/agent-tier2-capabilities.spec.md` (FR-AT2-*); plan `docs/plans/2026-07-05-agent-experience-layer.md`
  (has a **✅ Progress section** — read it first); ADRs **0049** (safe markdown, supersedes D-A2-8) + **0050**
  (layered agent prompt). Tier-2 open-Q defaults are recorded in the task board / tier-2 spec.
- **DONE on `dev` (flag-gated, NOT promoted):** I1 safe markdown (`f970a14`), I2 layered prompt/skills
  (`f970a14`), I3 context completeness (`87412ea`), Track D drawer UX (`48b932c` + AppShell reflow follow-up),
  and Track E surfacing specs (`AC-AXP-011/012/013/014/016` Playwright specs added and `--list` verified).
  Latest continuation commit also updates this handoff + the plan progress section. Wave-1 review battery green
  (security: no C/H/M; one code-quality Important fixed).
- **Tier-2 progress (2026-07-05, this stream):**
  - **I5 Cmd+K + conditional approvals — SHIPPED to `dev` via PR #236** (`feat/agent-tier2-cmdk-approvals`):
    openPanel(prefill?) + consumePrefill() one-shot prefill; CommandPalette "Ask AI" row on zero-result
    queries behind the flag; route-aware suggestion chips (`suggestionChips.constants.ts`); ADR-0051
    conditional-approval predicate (`AgentAction.needsApproval`, `resolveNeedsApproval`,
    `AGENT_APPROVAL_MONEY_THRESHOLD`, `isDestructiveDeleteAction`); `update_task_status` auto-approves;
    `create_activity`/`create_automation` keep always-chip. AC-AT2-006..013 unit proofs + AC-AT2-007
    Playwright spec. Full `npm run verify` green (548 files / 4386 tests).
  - **I6 agent eval harness — SHIPPED to `dev` via PR #237** (`feat/agent-eval-harness`): ADR-0052
    (Accepted) — the `*.eval.ts` behavior-regression net against the DEPLOYED agent-chat loop.
    `evals/harness/{scorers,runEval}.ts` (usesTool/contains/llmJudge + runEvalCase via test-user JWT →
    decodeSseStream), `evals/cases/tool-selection.eval.ts` (2 anchor cases), `vitest.eval.config.ts`
    (dedicated project; `npm run test:evals`), `vite.config.ts` excludes eval cases from `verify`,
    `.github/workflows/agent-evals.yml` (nightly + dispatch, never push/PR). AC-AT2-015 scorer half
    deterministic (12 tests, in `verify`); the real-loop half + exit-code gate light up once the owner
    provisions the deployed-target GH secrets (§OQ-1). Full `npm run verify` green (545 files / 4388 tests).
  - **I4 attachments — BUILD COMPLETE + FULL BATTERY GREEN on branch `codex/agent-attachments-track-a` @ `b269f9a`
    (pushed; draft PR #239 body still stale — REFRESH it before marking ready).** ADR-0053 + plan
    `docs/plans/2026-07-05-agent-chat-attachments.md`. ✅ **2026-07-06 (Opus Director, pi-orchestrated):**
    - **Committed & verified (11 commits ahead of `origin/dev`, `8f9ef82`→`b269f9a`):** Tracks A/B/C primitives +
      wiring (`8f9ef82`→`58dcd1d`), WIP wiring snapshot (`930947f`), wiring-greened (`9cd612e`), AC-AT2-001
      cross-stack e2e (`692afcf`), **3-lens review battery applied — all 10 findings fixed & verified (`b269f9a`)**.
    - **Review battery (cross-family gpt-5.4): security SHIP, spec+code-quality BLOCK → 1 Critical + 6 Important +
      3 Minor, ALL fixed** (glm-5.2 via TDD; Director-verified): sticky-thread conversation-mixing (Critical);
      resolver ordering, composer error-classification collapse, a11y duplicate "Attach file", per-conversation
      thread-scope on the resolver, honest "could not read / do not fabricate" degradation (FR-009), drag-drop
      target (FR-001) (Important); ADR-0017 seam for `createAgentThread`, e2e id-shape tightening, pgTAP 0112
      hardening (forged path/owner + bucket MIME/size) (Minor).
    - **GATES GREEN (Director-run on the final tree):** `npm run verify` 555 files / **4430 tests** · `supabase
      test db` 121 files / **973 tests** (hardened `0112` ok) · `playwright AC-AT2-001` **1 passed** (flag on) ·
      typecheck 0. Migration `0060_agent_attachments.sql`, pgTAP `0112`.
    - **DEC-7 (image vision) + DEC-8 (PDF text extraction) ship as HONEST graceful-skip** — an unreadable file now
      injects an explicit refuse-don't-fabricate block. Both are **owner-confirmable follow-ups** (supply-chain
      vetting of a Deno PDF extractor; whether prod `deepseek-v4-flash` supports vision) — NOT blockers; the
      capability is spec-complete for text-readable PDFs + the degradation path.
    - **REMAINING before PR→`dev` (the ONLY open I4 work): (1) rendered Discover pass** on the composer attach +
      drag-drop + error/ready states, dark+light (the design/taste lens — not yet done; z.ai was rate-limited so
      no `agent-browser` render); **(2) refresh PR #239 body → open/ready to `dev`.** Nothing else.
    - **Untracked junk NOT in the commits (leave or clean separately):** `prod-*.png`, `docs/design-mockups/redesign/_refs/agent-native/*.png`, `.claude/launch.json`, the 3 `deno.lock`s.
  - **I7 obs-memory — DEFERRED** behind a token-cost trigger (unchanged).
- **PROGRESS ≈ 97% (2026-07-06, Opus Director):** I1–I3 + Track D + Track E + I5 + I6 DONE & on `origin/dev`;
  **I4 build + full test/review battery COMPLETE & pushed (`b269f9a`)** — only the rendered pass + PR→`dev` remain;
  I7 deferred by design.
- **NEXT (for the resuming agent), in order:** **rendered Discover pass on I4 composer attach/drag-drop/error
  states → refresh + open PR #239 to `dev`** → owner-provision the eval-harness GH secrets (I6 §OQ-1) → **I7**
  obs-memory (deferred).
- **⚠ Load-bearing caveat:** the prompt STEERING is unit-tested (text present) but **unverified against the
  live deepseek-v4-flash** (weak tool-selector). The eval harness (I6, shipped) IS the gate once its GH
  secrets are provisioned. Promotion dev→main→production is **owner-gated**.

## ▶ Current state (2026-07-06) — AGENT-EXPERIENCE + TIER-2 WAVE SHIPPED TO PRODUCTION (owner-instructed)

> **RESUME ENTRY POINT (2026-07-06).** The full agent-experience + Tier-2 program (I1 markdown · I2 layered
> prompts · I3 context+drawer · Track D/E · I4 attachments · I5 Cmd+K/approvals · I6 eval harness; I7 deferred)
> is on **`main` = `dev` = `production` in content**, all at **`94ce615`**. **Shipped to prod 2026-07-06 (owner
> "ship to production"):** (1) prod Cloud DB (`prwccpsiumjzvnwjlkwq`) migrated **0057→0060** (0058 procurement
> write-hardening, 0059 agent-automation-bounds, 0060 agent_attachments table+bucket+RLS) via `db-push-prod.sh`;
> (2) edge fns **agent-chat + agent-dispatch + compose-view redeployed** (I2 prompt, I4 attachments resolver,
> help corpus, mint fix); (3) FE **`git push origin origin/main:production`** → CF Pages `94ce615`
> (https://pmo-bfb.pages.dev). **Verified:** agent-chat + compose-view boot clean (401 invalid-JWT, no
> WORKER_ERROR); CF serves 200. **Promote flow this session:** dev→main #240 (agent-xp wave) then #241 (I4);
> the recurring dev→main integration-red was **AC-AUTHF-005 mutating the shared `pm@acme.test` password** (fixed:
> afterEach service-role restore + serial `workers:1` + signIn retry — see [[e2e-shared-auth-mutation-trap]]).
> **Still owner-gated follow-ups:** DEC-7 image-vision + DEC-8 PDF-text (ship as honest graceful-skip), F4 mobile
> assistant entry, OpenRouter fallback chain, agent automations pg_cron GUCs (`app.settings.dispatch_url`/
> `service_role_key`), credits enforcement (default OFF). **Final logged-in UI render-check on prod needs owner
> creds** (db-push never seeds prod). **⚠ SHAs move fast — trust this line + git, not memory.**

## ▶ Current state (2026-07-04, late) — AGENT TIER LIVE IN PRODUCTION (reskin + assistant panel, rendered-verified) + full security/hardening on `dev`=`main`

> **RESUME ENTRY POINT.** **`dev` = `main` in content** (promoted 2026-07-04 via PR #229, merge commit
> `6f75edb` — a real 3-way merge resolving 44 squash-divergence conflicts to `dev`; `git diff origin/main
> origin/dev` is now EMPTY, and `main` carries `dev`'s ancestry so the NEXT promote is a clean ff).
> `main`/`dev` carry the reskin (#210) + the ENTIRE batteries-included-A program (#211–#218) + cross-family
> remediation (#219/#220) + full-codebase-review remediation & 5-wave hardening (#221–#228) + the mint
> fail-closed fix + the agent-e2e/CI gate fix. **Migrations through 0057, pgTAP through 0109, ADRs 0043–0046.**
>
> **✅ BOTH OWNER GATES CLEARED (owner-instructed 2026-07-04):**
> 1. **`dev`→`main` promote — DONE** (PR #229). Full `verify`+`integration` lane green. The integration gate
>    (which only runs on PR→main, never PR→dev) caught 3 agent-e2e that had never executed in CI — all
>    test/CI-config, no app change: AC-AAN-036/AC-AGP-023 needed `VITE_SUPABASE_ANON_KEY` exported to
>    `$GITHUB_ENV` (they build a 2nd anon client); AC-AW-012 raced the ⌘J listener mount (added the
>    wait-for-Assistant-button guard every other agent e2e already had). Fixed on `dev` (`3324b9d`), re-verified.
> 2. **RED-3 + RED-4 → `production` DB — DONE.** `scripts/db-push-prod.sh` applied migs **0042–0057** to the
>    Supabase Cloud DB (prod was at 0041; all 16 were pending — the pre-agent 0042–0045 had also never shipped
>    to prod). All prod-data-safe (0043's FK is on a fresh NULLABLE column; the rest additive/RLS-policy-only).
>    **prod DB now at 0057; the two live-prod tenant-security holes are CLOSED** (RLS-enforced, independent of FE).
>    Legit old-FE flows unaffected — 0051/0052 only block the abuse paths (file-a-PR-as-another-user, non-admin
>    project delete).
>
> 3. **`main`→`production` FE deploy + agent tier LIVE — DONE (owner-instructed 2026-07-04, rendered-verified).**
>    CF Pages `production` = `8e4998e` → https://pmo-bfb.pages.dev (reskin + agent UI). AssistantPanel **flag ON**
>    via a committed `pmo-portal/.env.production` (`VITE_FEATURES_AGENT_ASSISTANT=true`, `git add -f`) — there is
>    NO CF Pages API token in op (only `CF-Access-Client-*` = Zero-Trust Access, not Pages-mgmt), so the flag is a
>    committed build-time toggle (off = revert+rebuild). `agent-chat`+`compose-view` deployed to the Cloud project;
>    `OPENROUTER_API_KEY` set as a function secret (op `openrouter-api-key`/`credential`). **Live E2E verified in
>    the deployed UI**: login → panel → real answer (deputy-JWT → OpenRouter → deepseek-v4-flash); threads persist
>    (History survives reload). Fixed an edge-fn **boot-crash** in the process (actions↔schema circular-import TDZ
>    → WORKER_ERROR; `049d1e2`, now CI-guarded by `scripts/deno-boot-smoke.ts`).
>    **Live agent-chat polish — ✅ FIXED + rendered-verified in prod (PR #234, deployed `56a77e9`):** the
>    `agent_runs` heartbeat 406 (`.single()`→`.maybeSingle()`) and the duplicate user bubble (server `type:'user'`
>    echo de-duped vs the optimistic add). Verified live: 0 console errors, single bubble.
>
> **STILL OWNER-PENDING (separate):**
> - **Agent AUTOMATIONS in prod** — needs `agent-dispatch` fn deploy + pg_cron GUCs (`app.settings.dispatch_url`/
>   `service_role_key`) + live-mint verify. Until then mig 0048's cron is registered-but-idle (per-minute NULL-url
>   → self-pruning no-op, by design). Interactive assistant (above) does NOT need this.
> - **Credits enforcement** — `AGENT_CREDITS_ENFORCED` default OFF (launch un-enforced per the GTM plan; price after
>   pilot-margin data). **F4 mobile assistant entry, OpenRouter fallback chain** still open.
>
> **Seven-dimension audit + hardening wave (2026-07-04, post-promote):** `docs/spikes/2026-07-04-seven-dimension-audit.md`
> is the ledger. 7 read-only audits over `dev`@`8869145` (RED-1..4 + SEC-HIGH-1/2 re-verified CLOSED). Same-day
> fixes on `dev`: **H-1** procurement record tables RPC-only writes + amount CHECKs + Admin-only file DELETE
> (mig `0058`, pgTAP `0110` — was LIVE in prod DB); **C-1** model-call retry ×3 (429/5xx/network); **H-5**
> usage-metering fail-closed after 3 consecutive insert failures; **M-1** automation bounds (mig `0059`, pgTAP
> `0111`); **M-2** dispatcher schedule claim-then-fire (double-fire immunity); **M-4** `AGENT_ALLOWED_ORIGIN`
> CORS seam; **M-11** AuthProvider getSession `.catch`; **M-17** vitest `clearMocks`; root package.json stray
> removed. H-2 (credits OFF) + H-3 (TOCTOU) + H-4 = documented owner decisions/v1 tradeoffs, untouched.
> **Owner-gated follow-ups: push migs 0058–0059 to prod DB + redeploy agent-chat/compose-view (+ set
> `AGENT_ALLOWED_ORIGIN`).** Deferred (ledgered in the spike): H-6 `strict`, M-16 e2e waits, M-14 god
> components, M-6/M-7/M-8/M-9/M-12/M-15 + lows.
>
> **Full-codebase review + hardening (this session's second half):** `docs/spikes/2026-07-04-full-codebase-review.md`
> is the severity-ledger + shipped-vs-deferred truth. 7 gpt-5.5 sweeps found 11 real issues 4 prior review layers
> passed (incl. 2 live-prod); all exploitable ones FIXED (#221–#223), + hardening waves: observability logging
> +readiness script (#224), reliability atomic RPCs +error-boundary (#225), 12 indexes +pagination (#226),
> test-hardening +deno-check CI gate +dependabot bumps (#227/#228). **Deferred (non-exploitable, ledgered):**
> bulk-import idempotency (own slice), ~~`mint.ts` latent bug~~ (✅ fixed `2de2da8`), timesheet
> entry_date week-range, `.select('*')` trim, MED-1/MED-2 org-seam, deno.lock pin, PostHog dashboards (ops).
>
> **What shipped in batteries-included A (2026-07-03→04, one autonomous session, full SDD/TDD/BDD + 3-lens +
> rendered-Discover battery per issue):**
> 1. **#211+#212** — vendor-neutral `ModelClient` + OpenRouter transport (deepseek-v4-flash, DeepInfra-first,
>    fallbacks on; per-request usage capture). Cross-family pi+gpt-5.5 battery confirmed hardening; live
>
> **What shipped (2026-07-03→04, one autonomous session, full SDD/TDD/BDD + 3-lens + rendered-Discover
> battery per issue):**
> 1. **#211+#212** — vendor-neutral `ModelClient` + OpenRouter transport (deepseek-v4-flash, DeepInfra-first,
>    fallbacks on; per-request usage capture). Cross-family pi+gpt-5.5 battery confirmed hardening; live
>    deepseek gate = **GO-WITH-CAVEATS** (AC-MC-023 evidence in the spec).
> 2. **#213** — ADR-0043 persistence: `agent_threads/runs/events` (owner-only RLS, seq-ordered, tool-call
>    journal → durable resume w/ write de-dupe, server heartbeat + stuck-run UX, feedback thumbs), panel
>    history/resume. Review battery caught + fixed a seq-collision Critical and a heartbeat inversion.
> 3. **#214** — handler-debt refactor: shared `runToolLoop`, `MALFORMED_TOOL_CALL` repair-turn, cast cleanup.
> 4. **#215** — PostHog agent events (9 typed builders, no-content privacy NFR proven, `safeTrack`).
> 5. **#216** — `agent_usage` ledger + credits (mig 0047; unbypassable clamp on untrusted usage; preflight
>    guard behind `AGENT_CREDITS_ENFORCED` default OFF; out-of-credits UX). Quality lens caught a missing
>    hot-path index pre-merge.
> 6. **#217** — ADR-0044 automations + notifications (mig 0048 + **ADR-0046** watermark table; pg_cron→
>    `agent-dispatch` fn; **minted-owner-JWT background deputy** w/ cross-tenant gate; NL conditions;
>    bell/inbox). Security lens caught + fixed a HIGH (un-allowlisted trigger source reaching service_role).
> 7. **#218** — ADR-0045 transcript contracts: typed widgets (twice-validated zod → PMO primitives),
>    ask-user via `control('answer')`, live-context grounding hints + thread-scope population.
>
> **✅ CROSS-FAMILY VERIFICATION PASS (pi+gpt-5.5, 2026-07-04) — #219 + #220.** After the 6 issues merged,
> ran the whole tier through an independent gpt-5.5 battery (security · ADR-conformance · quality/interaction),
> which found **11 issues 4 Claude review layers had passed** — incl. a genuine **Critical cross-org tenancy
> breach** (Org-B `procurement_status_events` event firing an Org-A automation + leaking into its condition
> prompt; service_role read had no org filter). All fixed + independently re-audited **CONFIRM-CLOSED**:
> - **#219** (dispatch/tenancy): cross-org org-gate (+ falsy-org hardening), service_role minimal projection,
>   mint-before-audit on every path, watermark `(created_at,id)` compound cursor, **migration 0049** dropping
>   the owner-DELETE append-only violation on agent transcript/audit rows, JWT-TTL honesty (`wallClockTimeoutS`).
> - **#220** (agent-chat/panel): answer-continuation regains write/compose caps, credit-gate ordering (resolve
>   pending interactions at zero balance), pending-question ≠ stuck-run, server cancel path (ADR-0043 §4).
> - **ADR amendments** (this commit): 0044 §3 (JWT TTL not bounded — deputy ceiling is the mitigation, not TTL);
>   0046 (advance-per-attempted, not advance-after-success). **Lesson: cross-family review catches what
>   same-family passes — make it a launch/version gate, not just issue 1.**
>
> **⚠ OPEN before `v0.2.0`→prod (owner-gated):** the promote path deploys DB+FE only — needs
> `supabase functions deploy agent-chat compose-view agent-dispatch` + prod secrets (`OPENROUTER_API_KEY`,
> pg_cron `app.settings.service_role_key` GUC) + flag decisions (`VITE_FEATURES_AGENT_ASSISTANT`,
> `AGENT_CREDITS_ENFORCED`, `AGENT_AUTOMATIONS`) + the **binding live-mint verification** (ADR-0044 —
> `admin.generateLink` mint for a known user → minted client reads only their rows; edge runtime can't run in CI).
>
> **Deferred/owner-pending ledger:** F4 mobile Assistant entry (owner call) · OpenRouter fallback chain
> (owner will provide) · credit grants admin UI (SQL-only v1) · TOCTOU preflight revisit at ADR-0044-scale
> concurrency · free-text-question vs composer dual-input + feedback-affordance polish (decisions.md notes) ·
> chips pending: dependabot vulns (1 high) + `deno check` CI gate for edge-fn entry files (found: they're
> outside every type gate) · e2e mutation-spec isolation flake (pre-existing, recurring).

## ▶ Prior state (2026-07-01) — agent-native assistant SHIPPED to `main`; versioning adopted

> **RESUME ENTRY POINT.** **`production`(prod) UNCHANGED at `fc312eb` / Cloud DB migration 0041 = the
> `v0.1.0` versioning baseline (ADR-0042). `main`=`1c0f747` (agent-native epic A1–A4 promoted, PR #200,
> gated `verify`+`integration` green). `dev` = same content, + the versioning PR landing now.** No prod
> promote happened this session (main is the autonomous ceiling; prod needs a direct owner go).
>
> **What shipped to `main` this session — the agent-native in-app assistant (ADR-0040/0041), the app's
> first server-side tier:** the ⌘J `AssistantPanel` (A2); a streaming **`agent-chat` Deno edge-function
> deputy** (A1) with read-only `query_entity` + approve-gated write actions `create_activity`/
> `update_task_status` (A3) + compose-a-view (A4); the `AgentRuntime` port + `PmoNativeRuntime` adapter.
> Feature-flagged off by default (`VITE_FEATURES_AGENT_ASSISTANT`). Deputy auth = caller JWT, RLS ceiling,
> `ANTHROPIC_API_KEY` server-only. **The `dev→main` integration gate caught 7 real defects the verify-only
> dev lane structurally can't** (pgTAP fixtures, CI flag, SSE-mock shape, panel-hide UX bug, e2e selectors,
> hotkey-open race, save-mock shape) — each fixed honestly (app-bug→fix app; test-bug→fix test; PRs #201–205).
>
> **Versioning adopted (ADR-0042; PR #206):** SemVer, pre-1.0 while single-tenant MVP. `v0.1.0`=current
> prod; `v0.2.0`=next release = composed views + the agent-native edge-function tier (migs 0042–0045).
> The bump rule + release manifest are in the ADR; `CHANGELOG.md` is the per-release record.
>
> **⚠ OPEN before `v0.2.0` can ship to prod (owner-gated — see OPEN debt):** the promote path deploys only
> DB+FE — there is **no `supabase functions deploy` step and no prod `ANTHROPIC_API_KEY` secret**, so the
> agent panel would call a missing endpoint. Edge functions also don't run in CI/this container
> (`[edge_runtime] enabled=false`) → agent e2e are mocked; **live end-to-end test needs a local session**
> (`docs/environments.md` → Edge Functions).
>
> **▶ DECIDED (owner, 2026-07-03) — agent-native sidecar verdict: CHERRY-PICK; Option A is the ONLY user
> surface. Binding record + forward plan: ADR-0040 addendum 2026-07-03.** The pilot (branch
> `feat/agent-native-adoption`, PR #209) was driven live by the owner and the sidecar UI proved
> **builder/admin-grade, not app-user-grade** (workspace file browsing; "sign up with Builder" upsells on
> the add-provider/add-DB/hosted-UI flows; sidecar settings editable from the end-user panel) — retired as
> a user surface on UX/audience grounds, on top of the known ops grounds. Its batteries are host-coupled
> (Nitro + own `agent_native` Drizzle schema), not liftable. **PR #209 closed unmerged; branch retained as
> a reference archive** (mine: `server/middleware/deputy.ts` AsyncLocalStorage deputy seam,
> `server/lib/read-allowlist.ts`, `test/deputy-invariant.gate.test.ts`, OpenRouter/deepseek wiring
> `f6d6eb1`, scoped-CSS embed plugin).
>
> **▶ NEXT BUILD — "batteries-included A" (each item its own SDD → plan → TDD issue):**
> (1) **OpenRouter provider adapter** in `agent-chat` (cut at the injectable `AnthropicLike` seam,
> `handler.ts`; OpenRouter = OpenAI-shape; its per-request cost accounting feeds metering). **Owner-decided
> 2026-07-03:** PMO-central OpenRouter key (function secret; BYO-key maybe later, enterprise) · default model
> **`deepseek/deepseek-v4-flash` routed DeepInfra-first with fallbacks allowed** (fallback chain TBD, owner
> will provide) — gate: an across-the-board quality test
> (chat + read/write tools + `compose_view` structured output) on that model BEFORE any stronger-model
> fallback is added; per-action model map stays env-configurable · seam renamed **vendor-neutral
> `ModelClient`** (OpenAI-shape). Note: the pilot's "DeepInfra pin infeasible" was an agent-native
> settings-store limit — direct OpenRouter API supports `provider: { order: ["DeepInfra"] }`;
> (2) **`agent_threads` + `agent_events`** persistence (RLS/org_id, owner-private, Companies-slice pattern
> like `user_views`) — transcript resume + doubles as the agent audit trail;
> (3) **`agent_usage` ledger + per-user CREDIT balance**, enforced server-side at the existing `RateGuard`
> injection point — the SaaS metering seam (pricing strategy deliberately deferred);
> (4) **PostHog agent events** (ADR-0022; no Sentry).
> **Scope grown by owner 2026-07-03 (Tier-1 + ask-user promoted; ADRs 0043–0045 Accepted, they govern):**
> item (2) is now **ADR-0043** (binding: thread `scope`, tool-call journal/durable resume, progress
> heartbeat + stuck-run UX, per-event feedback — fold into its spec);
> (5) **automations (cron + event-triggered) + notifications inbox** = **ADR-0044** (pg_cron→dispatcher
> edge fn; minted-owner-JWT background deputy — THE security-sensitive piece, security-auditor owns it;
> credits preflight from item 3);
> (6) **transcript interaction contracts** = **ADR-0045** (typed data widgets via renderer registry,
> ask-user question chips via `control('answer')`, live route/entity context as untrusted hints).
> Suggested build order: 1 → 2(0043) → 3 → 4 → 6(0045) → 5(0044) — automations last (needs credits + notifications).
> **Backlogged nice-to-haves (owner 2026-07-03):** view-proposal workflow (user proposes an agent-composed
> view for promotion into the coded app — ADR-0036 §7) · input-form composition primitives (agent-built
> data-entry forms; new primitive class, write-path security — own ADR when picked up).
> **Battery-mining catalog (2026-07-03): `docs/spikes/2026-07-03-agent-native-battery-mining.md`** — the
> exhaustive pass over agent-native (retired-branch dist + upstream docs) for further end-user batteries.
> Tier 1 candidates: automations (cron+event) · notifications inbox · progress/stuck-run UX · typed
> chat-widget results · context awareness. **⚑ Its "design inputs" section is BINDING on items (2)/(4)
> above** (thread↔entity scope, tool-call journal for durable resume, progress heartbeat, feedback fields);
> upstream has NO budget/rate-limit system — validates item (3) as a build-not-borrow differentiator.

## ▶ Prior state (2026-06-21) — PROD CURRENT: procurement case-folder record model + tabbed case-page UI revamp LIVE

> **RESUME ENTRY POINT (model-agnostic).** **`production`(prod) current at `fc312eb` / Cloud DB migration 0041; `main`=`7a65ac7` (the 2026-06-21 procurement IxD + Reserved-budget program promoted, PR #169); `dev`=`d317260`+ a few ahead (the 2 done follow-ups + docs). See IMMEDIATE NEXT ACTION below.** The prod-level case-folder revamp shipped a prior session (owner-direct "push to prod", PRs #158→dev #160→main): the **procurement revamp** — a case folder over ERP-canonical record tables (PR/RFQ/Quotation/PO/GR/VI/Payment; **dual-ID** = minted system# + external ref; **Model-C** = case-spine + optional PO-anchored settlement chain w/ a same-case FK invariant; PO-less is first-class; SoD-gated `transition_procurement` RPC byte-preserved; append-only `procurement_status_events` log; migs **0035–0041**, the 0038 backfill creates PR/PO records from existing prod pr_number/po_number) **+ the tabbed case page** (Overview bento + Progression timeline · Documents dual-ID ledger w/ file view+upload · Vendor-quotes bid comparison) replacing the old accreted stack. Authority: **ADR-0033**; spec `docs/specs/procurement-records.spec.md`; plans `docs/plans/2026-06-19-procurement-{records,ui-revamp}.md`; design `docs/design/procurement-redesign/`. Security-audited (1 Medium fixed); pgTAP 0076–0083; procurement e2e retargeted to the tabs.
> **⚑ BINDING (owner): work→`dev`→`main`; `main` is the autonomous ceiling. NEVER promote to `production` (FE push or `db-push-prod.sh`) without a DIRECT per-instance owner instruction.** (`fc312eb` was such an instruction.) Promote = `db-push-prod.sh` typed-`prod` (**NO reseed** — seed §R/§S/§T procurement enrichment is local-only) → `git push origin main:production` (clean ff). ⚠ `db-push-prod.sh --check` hangs **silently in `op-get.sh`** if 1Password is locked (zero output; looks like a DB hang but isn't — unlock 1Password first).
>
> **⭐ IMMEDIATE NEXT ACTION — none blocking; `dev` is 9 commits ahead of `main` (the 2 procurement follow-ups + a full backlog debt sweep), optional promote.** **`main`=`7a65ac7` (PROMOTED 2026-06-21, owner "ship to main", PR #169, gated green)** carries the procurement IxD + Reserved-budget program (#162–168). **`dev`=`42c1522` is 9 ahead** — all `verify`-green, promote whenever (gated `verify`+`integration`). **`production` UNTOUCHED — `fc312eb`/mig 0041, now well behind `main`; a prod promote needs a direct per-instance owner go (would push migs 0042–0044 to the cloud DB + FE to `production`).**
>
> **▶ Backlog debt sweep (2026-06-22/23, owner "do it including the minors") — DONE on `dev` (#170–176):**
> - **#170** `0001_rls_enabled` catalog-driven · **#171** `vi-*` testids single-sourced (`vendorInvoiceTestIds.ts`).
> - **#172** doc query-key org-scoping + 3 minors (TZ-flake UTC-fix, kanban Won/Close-Out color split via `--violet`, Projects `<ExportButton>`). **#173** odd-count `StatTiles` last tile spans both mobile columns (fixes the half-empty 5-tile cell; render-verified @390).
> - **#174** **incident→project FK** (gap #8): mig `0043` `incident_reports.project_id` + same-org guard trigger (42501, mirrors 0039) + flag-gated UI; **security-audited clean** + render-verified + pgTAP `0086`. **#175** dashboard status-set literals → shared SQL helpers (mig `0044` + pgTAP `0087`; byte-identical, `0069` drift-guard green). **#176** **axe-core a11y gate** (component-layer, 8 surfaces, runs in `verify`) + e2e retry-isolation (unique-named fixtures on AC-PROC-001/AC-DEL-022).
> - **Already-done/stale (reconciled, NOT debt):** OD-D3 per-role-dashboard real-data (audited — every figure already real-query-backed; the old `*0.4` fabrication long gone) · `<ListState>` adoption (already widely adopted; the 3 hand-rolled spots are legitimately bespoke) · Vite-8 upgrade (done #141) · Projects Export (now #172).
> - **Deferred (assessed, NOT a minor — own issues):** **transition-map drift guard** — a real SQL↔TS guard needs re-emitting the byte-preserved SoD `transition_procurement` RPC to expose its legal-map (material refactor); confirmed in-sync today. **Engineer-dashboard "tasks" tile** — needs a tasks-by-assignee query + RLS that doesn't exist yet (a fresh feature, surfaced by the OD-D3 audit).
> - **OWNER-GATED, NOT auto (need your go — deploy/prod-config):** **Signed-URL TTL hardening** [Medium] — move signed-URL minting to an Edge function with a hard max TTL; feature-sized (new Edge fn + prod deploy), not a minor. **Auth prod cutover** [Medium] — email-confirm/real-SMTP/redirect-allowlist/replace-dev-seed-pw on the LIVE cloud project; matters before real users (repo is public ⇒ project ref discoverable).
>
> **The 2026-06-21 program promoted to main (#162–168):**
> - **#162** tenancy seam — `procurementFiles.prepareUpload` server-fetches `org_id` (was client-threaded; ADR-0017 fix) + `0005_force_rls` catalog-driven. **#164** charter-audit minors — 11 FK/hot-path indexes (mig `0042` + pgTAP `0084`), 6 `hsl()`→DESIGN.md tokens, e2e-count guidance re-baselined.
> - **#163** GR/VI inline capture folded into `RecordCaptureForm` (`onStage` confirm path) + `ProcurementDecisionZone` extracted → `ProcurementDetails.tsx` 1393→988.
> - **#165** decision-strip moved from sticky-footer to a compact non-sticky bar **under the stepper** (Notes progressive-disclosure, SoD hint one line) + `LedgerCaptureRow` data-driven (`ledgerCapture.ts`) so it stops over-prompting "Capture PR" once a PR exists. Render-verified.
> - **#166** **stepper is 6 stages, not 7** — "Approved" removed as a node (owner: approval is a *gate* across steps, not a stage); approving advances PR→done + Vendor Quote→current, status pill still shows "Approved". Applies to detail stepper + by-stage board + list pips; reverses PROC-002 (kept approval visible). Render-verified both surfaces.
> - **#167** **Reserved budget layer** (ADR-0034, owner-signed spec): `Available = Budget − Committed − Reserved`; Reserved = Σ approved-not-ordered `{Approved, Vendor Quoted, Quote Selected}`, a NEW org-scoped read (`getProjectReservedSpend`, pgTAP `0085` proves cross-org denial) — **Committed basis + dashboards UNCHANGED** (OD-BUDGET-2 amended, not redefined). Panel visible **request+approval only** `{Draft, Requested, Approved}` (OWNER-DECISION-2 tight); per-stage double-count fix (at Approved the case is already in Reserved → After == Available). UI term "Reserved" (never "encumbered"). **Full 3-reviewer battery + Director render passed.** **#168** extracted the per-stage math into a pure `computeBudgetSignal()` helper (+11 unit tests).
> - **Retro-review (this session):** security-auditor + code-quality ran over the previously-Director-only-reviewed #162–166 → **CLEAN** (no SoD/RLS/org_id regression; stepper confirmed presentation-only).
>
>
> **Gantt fix (#149→dev→#150→main, prod-live):** the project Timeline was built as TWO nested scroll contexts (outer `overflow-y-auto` + left `sticky` block + right pane's own `overflow-x-auto`) → table & timeline desynced vertically once the task list exceeded 60vh (owner caught "Commissioning misaligned, 2 scrollbars, not 1 unit"). Fixed to ONE `data-gantt-scroll` container (`overflow:auto` both axes) with the task column + header frozen via per-element `sticky` (corner z-40 > column z-30 > axis z-20 > bars). Geometry/zoom/milestones/dependency-lines/activation untouched. Regression test (RED-on-old/GREEN-on-new). **Director render-verified on dev (scrolled to Commissioning: sticky header, frozen column, aligned) THEN on prod.** This is the canonical example: a UI bug the deterministic gates structurally miss → caught by a rendered review (the QA gap the owner flagged; QA-hardening plan parked per owner, but the ratchet test was added).
>
> **⚠ INCIDENT + LESSON (2026-06-17): the /timesheets toolbar shipped visually broken** (owner caught it). Root cause: the shared `<Icon>` (`src/components/ui/icons.tsx`) had **no default size** — sizing depended on the caller passing `className` OR being inside `<Button>` (which sizes child svgs via `[&_svg]`). Hand-rolled controls (timesheet "Review N awaiting" `<Link>` + "Add project" `<label>`, added 2026-06-14) used **classless `<Icon>`** → icons rendered at intrinsic ~77px → blew out the layout. **69 of 123 `<Icon>` usages were classless** (latent footgun). **Why it slipped:** (a) the only deterministic UI gate `AC-MOBILE-OVERFLOW-001` checks *bleed*, and an oversized icon doesn't exceed viewport width; (b) ADR-0030's promised visual-regression gate was never actually built; (c) `npm run verify` renders zero pixels — a build can be green with a broken layout; (d) I shipped two timesheet-touching PRs (#135, #139) + the promote **without rendering that page**. **Fixes:** **#144** gave `<Icon>` a default `width="1em" height="1em"` (SVG attrs — override-safe given the repo's clsx-only `cn`, no tailwind-merge) → fixes all 69 classless usages; **#145** the durable net (below). **Standing rule reinforced: render the affected pages before shipping/promoting UI — verify-green is necessary, not sufficient.**
>
> **Shipped to main this session:**
> - **#135** — mobile horizontal-bleed killed app-wide @390/360 + the measuring gate `e2e/AC-MOBILE-OVERFLOW-001` (every route×{390,360}, no element right-edge > viewport — the deterministic L1 gate the 4-lens reviews structurally couldn't be) + **PostHog fixed** (our `property_denylist` stripped PostHog's own `token` field → tokenless `/e/` → 401; posthog-js#3438) + valid-`phc_`-key guard. **#134** (earlier) = prod-promote ops docs + `scripts/db-seed-prod.sh`.
> - **#136** — S-curve real cumulative ACTUAL line (ADR-0032): `tasks.completed_at` trigger-stamped (migration 0034) + hybrid client-side `buildSCurve(milestones, asOf, tasks?)`. Rendered review caught 2 bugs unit tests missed (seed stamped all completions `today`→ seed backfill block; axis-label overlap → `evenAxisTicks`). The verify-red (full-suite `useTasks` mocks across 3 suites + a tsc error) was fixed before merge.
> - **#139** — whole-row/card clickable: nav-lists (projects/procurement/etc.) → open detail; **/approvals + procurement preview** → expand-in-place (carve-out preserved). **Director rendered Discover pass PASSED** (live Playwright click-through on local Supabase, Admin: projects/procurement row→detail, approvals row→expand budget-impact, nested "Open project" link + preview chevron don't double-fire, no console errors). 12 AC-ROWCLICK-* tests.
> - **#140** — debts: +6 pgTAP 0028 RLS regression assertions, `tsToIso` helper, DRY'd the migration↔seed `completed_at` backfill via `task_completion_proxy()`.
> - **#141** — coordinated **Vite 8** toolchain bump (vite 8 + @vitejs/plugin-react 6 + vitest 4.1.9 + @vitest/coverage-v8 4.1.9 + @tailwindcss/vite 4.3.1); `vite.config.ts` `manualChunks` object→function (Vite 8 = rolldown, function form only). **Supersedes dependabot #138 (closed)** — which bumped vite alone → peer/typecheck break. Gotcha: a local `npm install` lockfile omitted rolldown's `@emnapi/*` optionals → CI `npm ci` EUSAGE; fixed by clean-regen + proving against `npm ci`.
> - **#144** — `<Icon>` default `1em` size → fixes the /timesheets toolbar icon-blowup (see INCIDENT above). Render-verified by the Director on the fix branch (timesheet tidy @desktop+390, dashboard un-regressed) before merge → promoted to prod (`d3d50b0`).
> - **#145** — **tiered CI + the visual-invariant gate.** (1) CI tiering: `dev` push/PR = `verify` only (fast lane); **PRs → `main`** = `verify` + `integration` (pgTAP + e2e incl. the visual gate) — so `main` is always clean + the prod promote stays a no-op (`integration.if` now `pull_request && base_ref=='main'`). (2) **`e2e/AC-VISUAL-ICON-001`** — deterministic gate: every route × {1280, 390}, no `svg[viewBox="0 0 24 24"]` (the shared-Icon family; recharts excluded) may exceed 40px. **Self-proven: passes on fixed main, FAILS with `77×77 timesheets@desktop` when the bug is re-introduced.** This is the net that would have caught the incident; chosen over pixel-screenshot regression (flaky/high-maintenance on a data-driven UI — available as a follow-up if wanted).
>
> **Executor switch (owner directive):** role work runs on **Claude Task subagents, NOT pi** ("use subagents here instead of pi for now"). Background dispatch via Agent `run_in_background:true` (+ `isolation:'worktree'` for parallel-safe edits) + auto-reinvoke = context economy. **Director still verifies every claim + does the rendered visual pass** (caught 2 real bugs in #136 + ran the #139 live click-through). New durable gotcha: a worktree-isolated agent's `npm install` can yield a lockfile that local verify accepts but CI's strict `npm ci` rejects — always prove a lockfile change against `npm ci`, not just `npm install`.
>
> Authoritative self-contained handoff: **this block + `docs/qa-portfolio.md` (QA model) + `docs/adr/0032-scurve-actual-series.md`**. Everything below the "⟨SHIPPED & SUPERSEDED⟩" header is HISTORY.

**Shipped to `main` this session (all gated PRs, `verify`+`integration` green except docs-only=admin):**
- **#122 ADR-0030 — QA portfolio** (`docs/adr/0030-…`, `docs/qa-portfolio.md`): the review model is now **Discover → Graduate → Cover** (open-ended Discover finds unknown-unknowns → every finding *graduates* into a test + a `routes×oracles` matrix cell + a DESIGN/decision note → enumerated sweeps + deterministic L1 gate-tests *cover* it). A **`review mode` switch** (`portfolio` default | `4-lens` | `3-lens`) at the top of `qa-portfolio.md` makes it **reversible** — the legacy 4-lens battery + `design-reviewer` agent + `design-workflow.md` §1a/§2.3 are kept intact. **Vendoring policy "buy-the-engine/build-the-skin"** (headless-first, MIT/permissive, supply-chain hygiene; 3rd outcome = build-and-own referencing MIT source).
- **#123 S-curve** time-axis fix (was categorical → today plotted far-right) — the *worked example*: graduated into a position test + a DESIGN.md "charts use a time axis" rule.
- **#124** process docs synced to the portfolio loop (`director-playbook`/`design-workflow`/`product-expectations`/`CLAUDE.md`).
- **#125 Gantt v2 (ADR-0031, BUILD-AND-OWN not vendored):** on-axis milestone diamonds + dependency connector lines (frappe-MIT blueprint) + MS-Project split table/timeline + day/week/month/quarter zoom + pixel-aware geometry/edge model + D1 mobile fallback (`useIsNarrow` 640px → List/Board notice). Vendor spike killed SVAR (GPLv3+R19-crash) & Frappe (no-a11y).
- **#119** housekeeping · **#120** CLAUDE.md model-tiering rule · **#121** Incidents hidden behind interim feature flag (`src/lib/features.ts`, re-enable=flip flag) · **#126** `pi-delegation.md` hardened (subagent must run pi blocking-foreground; GLM-only degraded mode).

**▶ pi/GLM QA-ORCHESTRATION TRIAL ✅ SUCCEEDED** (`docs/reviews/2026-06-16-qa-orchestration-trial-gantt.md`): a **separate opus orchestrator** ran the full portfolio loop on the Gantt D1 fix **from the docs alone**, dispatching **pi/GLM** for all work (build `glm-5.2` → review `glm-5.1` → fold), self-verified gates (3128/3128); Director only verified + hardened docs. **GLM verdict: keep both** (glm-5.2 first-pass-correct). **gpt-5.4/openai-codex is UNAVAILABLE → GLM-ONLY routing.** Prompting lesson: a Claude subagent gets NO background re-invoke → must run pi blocking-foreground within its turn.

**▶ OUTSTANDING (owner-gated / next):**
1. **PROD PROMOTE ✅ DONE 2026-06-17** — `production`=`d3d50b0` / Cloud DB **migration 0034** (two promotes: 5ce5a39 then d3d50b0 for the timesheet fix). All of mobile + PostHog + S-curve + row-clickable + Vite 8 + timesheet-icon-fix are LIVE. (1 dependabot-high esbuild dismissed not-affected.)
2. **PostHog real-browser spot-check (optional, owner):** the automation browser shows PostHog requests blocked by Chrome **Private Network Access** ("local address space") — an automation artifact, NOT user-facing. Since PostHog matters for the demo, confirm capture in a real browser (the #135 token-denylist 401 fix was verified at the time).
3. **Pixel-screenshot visual regression (optional follow-up):** the standing visual gate is the deterministic `AC-VISUAL-ICON-001` (flake-free). True pixel-diff (`toHaveScreenshot`) can be added if wanted — needs Linux baselines + tolerance tuning + churns on intentional UI changes; deferred deliberately.
4. **Vendoring:** date-fns ✅ #130 · TanStack Table ✅ DEFER #131. Closed.
5. **Minor doc residual** (non-blocking): breakpoint-doc 768-vs-640.

**Open feature tracks** (owner-scope-gated, not started): feature entitlements/per-org gating (backlogged, UI-hide-first); Reports module (`/reports` placeholder); Commitment-governance; Admin RBAC config engine; later spines (Revenue/AR, Resources/Assets, Service/O&M).

## ▶ KNOWN ISSUES

_None blocking._ (Prod migration push **DONE 2026-06-13** — `scripts/db-push-prod.sh` applied 0024+0025+0026+0027
to the Supabase Cloud project; `production` branch promoted to `main`@094406c → Cloudflare prod FE redeployed.
'Budget used', document file upload + the prod storage bucket, and the at-risk `>=` boundary are now LIVE.
The migration-0023 immutability bug behind this was fixed in PR #80; 0023 is byte-identical to its #74 prod content.)

## ⟨COMPLETED — MERGED to `main`⟩ KANNA gap-closing (waves 0–3 + coherence; detail in `history.md`)
> Not active. KANNA shipped long ago (via #118 + the squash PRs); `kanna-program.md` is archived. Kept below for reference only.
**Execution plan + wave sequencing: [`docs/kanna-program.md`](kanna-program.md)** — read it before any fan-out.
Gap analysis (what's missing): `docs/reviews/2026-06-11-kanna-gap-analysis.md`. Model: **parallel waves of ≤3–4
independent issues** (worktree + PR each; CI verifies in parallel on the public repo), with all owner-interactive
gates (grill-with-docs + owner-approved mockup) **front-loaded & serialized through the Director** per wave.
Role work via the **pi CLI** (`docs/pi-delegation.md`) or Task subagents.
- **✅ Issue #1 — document file upload — DONE & MERGED (PR #78).** Decisions OD-DOC-1..5; migrations 0024+0025;
  private org-scoped bucket; Draft-only upload/replace; download + preview; New-revision auto-Supersede (SoD);
  5 MB bumpable + allowlist. Security PASS. **Live on prod** (pushed 2026-06-13).
- **✅ Wave 0 — BUILT & on `dev` (PRs #84–#91):** 8 mobile/UX @390 fixes (exec dashboard glanceable · shell touch-targets · DataTable card-clip · scrollable filters · bottom-sheet confirm · procurement-detail mobile · day-stacked timesheet · project-detail back).
- **✅ Wave 1 — BUILT & on `dev` (PRs #92–#94):** Bulk **Export** (#92) · Project **Calendar** (#93) · **Procurement attachments** (#94, migration 0028). Grill + mockup skipped per owner directive; Director locked `[OWNER-DECISION]`s.
- **✅ Wave 2 — BUILT & on `dev` (PRs #95–#97):** **S-Curve** (#95) · **Kanban** (#96) · drift fix (#97).
- **✅ Wave 3 — BUILT & on `dev` (PRs #98–#101):** **Gantt** (#98) · **Import wizard** (#99) · **CRM** contacts+activity (#100, migration 0030) · CRM companies-drawer (#101).
- **✅ Coherence wave — BUILT & on `dev` (PRs #103–#112 + #111 + #114):** whole-app pattern unification. Design verdict: **SHIP.** Follow-up residuals resolved in #114 (sticky record-action zone + procurement header Edit + "deal" copy leak).
- **▶ Next after promote:** candidates per kanna-program.md §3 — Sub-projects · Append-only audit events · Commitment-governance spec · Spine-4 Revenue/AR. Default SOP = **series + pi** (the parallel burst consumed the Claude weekly-quota window and is now closed).

## ▶ OPEN feature tracks (owner-scope-gated — not started)
- **Feature entitlements / per-org gating (owner-decided 2026-06-15, BACKLOGGED)** — deactivate features per
  org ("not every company needs Incidents") on the *same axis* that later becomes paid tiers. **Decision of
  record (owner):** build the **entitlement seam + per-org toggles**; **UI-hide now, server-enforce later**
  (defer RLS per feature until it becomes a paywall); **NO billing/Stripe** yet. **First build:** `org_features`
  table (`org_id`,`feature_key`,`enabled`) + a feature registry (`incidents`,`crm`,`procurement`,`timesheets`,
  `import_export`,…; core never-gated = Projects/Dashboard/Approvals/Admin) + `org_has_feature(key)` SQL fn
  (ships now, *unused by gated tables* — the later-enforcement hook); FE `useFeature()`/`<FeatureGate>` mirroring
  `usePermission`/`<CanWrite>` gating **rail item + route (redirect, not just hidden nav) + affordances**; an
  Admin `/administration` "Features" toggle section. **Hold-the-line even in UI-first:** `org_features` itself
  gets real RLS (read-own-org, **admin-only write**); disable = **hide, never destroy** (re-enable restores).
  **Deferred:** `plans`/`plan_features`, billing, and the `AND org_has_feature(...)` RLS on each gated module.
  Orthogonal to RBAC (entitlement = per-*org* feature; RBAC = per-*role* action) — both UX-gate + (eventually)
  RLS-enforce. **Own issue via full loop** (grill → spec → **ADR-00NN** [pre-assign] + plan → TDD → 3 reviewers →
  mockup+design-review for the Admin toggle/gated nav → ship). The ADR must record the UI-first bypass risk
  explicitly. May expand the registry once the owner's broader app feedback lands.
- **Commitment-governance (OD-W5-5)** — (a) a server-enforced **PO-commitment approval gate** (distinct
  authority signs off the order commitment vs budget+cashflow before PO): new state-machine state + RPC +
  ADR; (b) a **cash-position/cashflow data domain** (opening balance, in/out-flows, runway — none exists
  today). Spec together.
- **Admin RBAC config engine (OD-PROC-6)** — configurable roles + access; re-enables Engineer-as-manager
  approvals (OD-W2-2, currently FE-off / RPC-dormant). Also the home for per-category document access
  (OD-DOC-4). The B2B-multitenancy bridge.
- **Reports module** — `/reports` is a placeholder; needs owner definition (read-only dashboards/exports).
  Export affordances (Sales, board pack) route here.
- **Design-system normalization (H2/H4)** — full arbitrary-px-spacing sweep + off-scale-font normalization
  (only a scoped subset done in the coherence wave); touches dozens of components → own track with a rendered diff audit.
- **Later spines:** Revenue/AR (progress billing, retention, change orders — spine 4; ties into milestones),
  Resources/Assets (spine 8), Service/O&M (spine 9). See `docs/roadmap-spines.md`.

## ▶ OPEN debt / follow-ups (tracked, none mandate-blocking)

### Edge-function operationalization + versioning (from the agent epic + ADR-0042)
- **Edge-function prod deploy step** [Medium, OWNER-GATED — blocks `v0.2.0` to prod]: the promote path
  (`docs/environments.md`) deploys only DB+FE. Add `supabase functions deploy agent-chat compose-view` +
  set the prod `ANTHROPIC_API_KEY` secret (`supabase secrets set`, once). Without it a prod with the agent
  panel calls a missing endpoint. Runbook + local-dev already documented in `docs/environments.md` → Edge Functions.
- **Local edge-function dev enablement** [Low, done — scaffolding]: `supabase/functions/.env.example` +
  the `functions serve` runbook (`docs/environments.md`). Live end-to-end agent testing needs a **local
  session** (this container has `[edge_runtime] enabled=false` + no `deno.land`/API key). Not automatable here.
- **`release-please` automation** [Low, ADR-0042 adoption]: GitHub Action on `main` to maintain
  `CHANGELOG.md` + compute the next `vX.Y.Z` from Conventional Commits, so the version is never hand-argued.
- **`VITE_APP_VERSION` in-app surfacing** [Low, ADR-0042 adoption]: inline the version at build, show it
  next to `<EnvBadge>` (`vX.Y.Z · <sha>`) so a running instance reports exactly what it is.

### Deferred-debt ledger from the 2026-06-14 `dev` burst (fold in before promote where noted)
- **Procurement attachments — 2 LOW pgTAP regression assertions** [Low, security-acked on #94]: add (a) an explicit
  `org_id=B` override-insert test (caller in org A supplies `org_id=B` → expect `42501` from WITH CHECK) and (b) an
  anon-read=0 assertion on the three `procurement_*_files` metadata tables. Code is provably safe (stamp-trigger guard
  mirrors 0015 + force-RLS); these only pin the regression. **Migration 0028 is unshipped to prod — fold in before promote.**
- **Projects xlsx Export opt-in** [Low]: the Export button was wired to Companies/Incidents/Procurement/SalesPipeline but
  **deliberately skipped on `pages/Projects.tsx`** (collision-avoidance with the Calendar/Kanban view-mode stream). Add the
  one-line `<ExportButton entity=…>` to the Projects toolbar now that those merged.
- ~~**B-MIN-1 noun consistency**~~ — **RESOLVED by CW-1** (one noun "Project" + one create-verb, coherence wave).
- **Detail-page metric-tile strip clips a tile @390** [Low, pre-existing]: project/procurement detail metric tiles render
  as a horizontal-scroll strip with the right-edge tile cut (no page overflow, no content loss). Pre-existing; surfaced by
  Wave-0 audit, outside its scope.
- **S-Curve actual model = single as-of-today point** (OBS-SC-001 / ADR-0025) [Low, by design]: no per-date actual history
  exists; a future `project_milestones.completed_on` (or progress-history) migration upgrades the actual to a stepped curve
  with **no FE rewrite** (`buildSCurve` already consumes a `{date, cumulativePct}` list).
- **Procurement attachments v1 scope** [Low]: quotation/GR/VI phases only; **PR/PO-header attachments + legacy
  `procurement_quotations.file_url` backfill** deferred (ADR-0023).
- **Kanban status-dot color reuse** [Minor]: Won + Close Out share the green status dot (disambiguated by label) — assign
  distinct DESIGN.md status tokens.
- **Coherence wave minor follow-up** [Low]: two residuals to land in a follow-up PR — sticky action zone + procurement
  header Edit button; "No deals in <stage>" → "No projects" copy leak.
- **Pre-existing TZ flake** [Low, known]: `src/lib/db/procurementLifecycle.test.ts` AC-803 fails under a behind-UTC TZ
  (e.g. UTC-8 local); passes in CI/UTC. Fix: use UTC-fixed date construction in the test.

### ⚑ TEST + BRANCH INFRA UNDER PARALLEL AGENTS (2026-07-22, Director — evidence from the M365 session)
**Why this is its own track:** the repo went from a handful of worktrees to **~15 concurrent agent worktrees**
during one session. Every item below cost real time, produced a *false* signal (a green that lied or a red that
lied), and **will recur** — they are all consequences of parallelism, not of any one branch. Ordered by how
badly each misleads.

> **STATUS 2026-07-22 (branch `chore/test-infra-parallelism`).** Shipped: **T1 complete**
> (`check-migration-collisions.sh` CI gate already existed; **`scripts/renumber-migration.sh`** added —
> auto-rewrites filename-form refs, **hard-fails if the sweep silently no-ops**, lists bare-form refs for
> manual review rather than corrupting unrelated 4-digit numbers) · **T2** (**`scripts/with-test-lock.sh`** —
> a machine-global lock so only one full vitest suite runs at a time; the three lock wrappers now share
> **`scripts/lib/flock-run.sh`** instead of being three copies, with a documented **`erpnext → db → test`**
> acquisition order) · **T4** (**`scripts/supabase-start-lean.sh`**) · **T3 mitigation only** — the chained
> one-hold recipe is now the documented default in CLAUDE.md.
> Proof: `node --test scripts/parallel-infra.test.mjs` (8 tests), **mutation-checked in both directions** —
> swapping `LOCK_EX`→`LOCK_SH` makes the serialisation test interleave, and sabotaging the sed sweep makes
> the renumber guard fail.
>
> **STILL OPEN — T3's real fix: give each worktree its OWN database** (per-worktree Supabase port/project id).
> The lock only *serialises* access to one shared Postgres; it cannot stop schema drift between two agents'
> resets. That single change retires T3 outright and takes most of T2's pressure with it. Deliberately out of
> scope here — it is an environment change affecting every agent at once.
> **T5/T6 stay as written**: they are judgement lessons (verify-by-content-diff; the zsh no-op sweep) — though
> T6's trap is now encoded in `renumber-migration.sh` rather than left to memory.
>
> **Cross-family review (gpt-5.6-luna, `--thinking max`, 2026-07-22) — no Criticals; 3 confirmed defects FIXED:**
> (a) the sweep matched the bare prefix `NNNN_`, so renumbering migration 0052 would have rewritten **7
> unrelated `supabase/tests/0052_*.test.sql`** references — prefix reuse in pgTAP is *deliberate and tolerated*.
> It now matches the full basename `NNNN_<slug>`. (b) `git mv` staged the rename while the `sed` edits stayed
> **unstaged**, so a plain `git commit` shipped a half-applied renumber; everything is staged now. (c)
> `supabase-start-lean.sh` was committed non-executable. Both (a) and (b) have regression tests, each
> mutation-checked. Also: the documented lock order was **flipped to `erpnext → db → test`** to match the live
> P3c runbooks, which already nest erpnext outermost — a documented order that contradicts real call sites is a
> deadlock waiting to happen. The infra tests now run in CI's `verify` job.
>
> **Accepted / still open from that review:** bare `npm run verify` stays lock-free (CI is a single dedicated
> runner); **`npm run verify:locked` is the shared-machine entry point**, so the lock is opt-in *by design* and
> relies on agents following CLAUDE.md · the renumber remote-safety check is prefix-based, so it can
> false-refuse when another branch holds the same prefix (override `RENUMBER_FORCE=1`) and cannot detect a
> migration applied only to a local DB · the lock tests use fixed 150/300 ms settle waits, which could flake
> under extreme load · `with-erpnext-lock.sh` and `supabase-start-lean.sh` have no direct test coverage.

- **T1 — `MERGEABLE`/`CLEAN` does NOT catch migration-number collisions** [High, BURNED US TWICE].
  Git compares *filenames*, so two branches adding `0104_a.sql` and `0104_b.sql` merge "cleanly" and leave
  duplicate numeric prefixes in `supabase/migrations/`. Hit twice in one session: M365 vs dev's ERPNext
  (`0096–0103`), then M365 vs the merged H4 grants work (`0104`/`0105`) — GitHub reported CLEAN throughout
  **both** times. Detection today is a manual command; it should be a **CI gate on every PR that adds a
  migration**:
  `ls supabase/migrations | sed -E 's/^([0-9]{4})_.*/\1/' | sort | uniq -d` → fail if non-empty.
  (Note pgTAP duplicates are tolerated — `0034/0052/0066` pre-exist — because test files have no ordering
  semantics. Migrations do. Gate migrations only.)
  **Bonus fix:** renumbering is currently hand-rolled `git mv` + a cross-reference sweep (comments cite
  migrations by number, and a stale reference in a *reversibility* note actively misleads a rollback). A
  `scripts/renumber-migration.sh` would make this safe and repeatable.
- **T2 — the unit suite is not parallel-safe: 5s timeouts + a shared machine** [High, recurring, produces
  FALSE REDs]. `npm run verify` is ~5,400 tests with 5s per-test timeouts. When another worktree runs vitest
  concurrently, **unrelated** tests fail on timeout — observed 4× in one session, a *different* test set each
  time (`authFloorAnalytics`+`PanelEditorForm`, then `ProjectFormModal`, then `Companies.pushRouting`+
  `authFloorAnalytics`), **every one passing in isolation**, with run timings blowing out to
  `environment 1541s / import 1774s`. The tell that it is contention and not a regression: **a real regression
  fails the same test deterministically; contention moves.** Options: raise the timeout for render-heavy
  jsdom tests, cap `poolOptions` threads, or (best) a machine-level **test lock** mirroring
  `scripts/with-db-lock.sh` so only one full suite runs at a time. Until then the rule is: *re-run the named
  failures in isolation before believing them* — and CI on a clean runner is the authoritative answer.
- **T3 — the shared local Supabase DB can drift mid-run even under the lock** [High, produces FALSE REDs
  *and* FALSE GREENs]. `with-db-lock.sh` serialises commands, but a reset in worktree A between worktree B's
  `db reset` and its `supabase test db` leaves B testing a **different schema than it migrated**. Observed:
  the grants agent's suite failed against a schema missing its own migration (82 aborted tests) and passed
  once re-run as a single lock hold. Mitigations: always chain as ONE hold —
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` (make this the documented
  default everywhere, incl. CLAUDE.md) — and longer-term give each worktree its **own DB** (per-worktree
  port/project) so agents stop sharing one Postgres at all. That single change would retire T3 outright.
- **T4 — heavy concurrent runs OOM the machine** [Medium]. A full `verify` + a pi build + other worktrees'
  vitest exhausted RAM and killed the session mid-build (work was recovered from disk, uncommitted). Related:
  the Supabase stack's `analytics`/`vector` containers wedge under load and block `db reset`; the reliable
  recovery is `supabase stop` then
  `supabase start -x vector,imgproxy,studio,realtime,logflare,supavisor` (worth documenting, or excluding
  those containers locally by default since CI already skips them).
- **T5 — stale worktrees/branches accumulate silently** [Medium]. Squash-merges leave branches looking
  "unmerged", so dead and live work are indistinguishable at a glance; two 12-day-old local-only ClickUp
  branches sat around until audited (both superseded — see the Slice E/F notes in
  `docs/plans/2026-07-10-clickup-adapter.md`). **Never delete on appearance:** verify by *content diff* and
  check each branch-only line, not line counts — line counts would have reached the right answer by luck
  and would have missed genuinely dropped work. A periodic `git worktree prune` + a "verify-then-delete"
  checklist would keep this cheap.
- **T6 — a `sed`/glob loop that silently does nothing** [Low, but it faked a clean result]. In zsh an
  unquoted file-list variable does not word-split, so `for f in $FILES; sed -i '' … "$f"` passed the whole
  list as one filename ("File name too long") and changed **nothing** — while the follow-up grep, mangled the
  same way, reported "clean". Use `while IFS= read -r f; do … done < filelist` for repo-wide sweeps, and
  always re-grep for the *old* value afterwards to prove the rewrite happened.

### Standing debt
- **Signed-URL TTL hardening** [Medium, owner-acked on #78] — client can mint long-TTL download URLs; move
  signing to a server/Edge Function with a hard max TTL. Own issue.
- ~~**Prod migration push**~~ — **DONE 2026-06-13** (0024–0027 applied to prod; `production` promoted; FE redeployed).
- ~~**At-risk classification consolidation**~~ — **DONE (PR #82).** One shared rule in `dashboardConstants`
  (private predicate; `isAtRisk`/`isAtRiskByCommitted` delegate), all surfaces (PMDashboard/Projects/OverviewTab)
  call it; server `projects_at_risk` reconciled `>`→`>=` via new migration 0027 (0009 untouched); dead
  `calculatedPct` prop removed; pgTAP 0069 drift-guard pins the three committed-spend definitions in agreement;
  fixed a latent bug (PMDashboard counted inactive projects as at-risk). `budgetUtilPct` dead export left
  (unrelated pre-existing). Reviewed SHIP; 2214 unit + 459 pgTAP green.
- **Vite 8 upgrade (real esbuild remediation)** [Medium, from PR #80] — esbuild GHSA-gv7w-rqvm-qjhr (build-time
  devDep, not shipped) has no in-range fix; the blocking CI audit was scoped to prod deps (`--omit=dev`, clean)
  with a non-blocking full audit (`.github/workflows/ci.yml`). The actual patch is the Vite 6→8 major (moves to
  patched esbuild); requires the legacy-browser-target check (esbuild 0.28 dropped destructuring downlevel for
  chrome87/safari14). Own track.
- **e2e mutation-spec isolation** [Minor→Medium, recurring] — mutation specs (AC-PROC-001 just flaked in CI with
  a strict-mode duplicate; AC-DEL-022 hit it too; prior AC-1011/AC-816/AC-911) create rows that persist across
  Playwright *retries* on the shared DB → duplicate-element / dirty-precondition failures on retry. Harden with
  dedicated per-spec seed rows / unique-named fixtures (the P011/P013 pattern) so a flaked attempt-1 doesn't
  poison the retry.
- **Document query-key consistency** [Minor] — document React-Query keys are project-only (pre-existing
  across all document hooks); align to the org-scoped key convention in a consistency pass.
- **Per-role sub-dashboards real data (OD-D3)** — Engineer/PM/Finance views still carry some hard-coded
  figures; wire to real per-role queries.
- **Auth prod cutover** — email confirmations + real SMTP; `site_url`/redirect allowlist to HTTPS prod only;
  replace dev seed password; `auto_expose_new_tables=false`. (Cloud is demo/staging-grade today.)
- **JWT role fast-path** — `auth_role()` reads `profiles.role` (authoritative); re-introducing an
  `app_metadata.role` JWT claim needs GoTrue signing + an audited sync trigger.
- **Transition-map drift guard** — `transition_procurement`'s SQL legal-map/role-matrix and
  `procurementLifecycle.ts` (TS, cosmetic) are hand-maintained duplicates; add a sync test before the
  matrix grows.
- **SQL helper extraction** — dashboard on-hand/pipeline status-set literals duplicated across the 3 RPCs in
  `0009_dashboard_margin.sql`; extract a shared helper before the taxonomy changes.
- **e2e seed-coupling** — a few mutation specs (AC-1011/AC-816/AC-911) share seeded entities → can fail in
  some *local* full-suite orderings (CI passes); harden with dedicated per-spec seed rows (the P011 pattern).
- **Shared `<ListState>`** — loading/empty/error markup duplicated across list pages; extract + memoize
  list filters consistently. Minor.
- **Admin user disable/invite** — needs a `profiles` status column + server-side Supabase auth-admin API.
- **Monitoring** (Sentry/uptime) — deferred. Optional CF API token in op vault `AS` for non-interactive CI.
- **Automated a11y gate (charter Gap 4)** [Medium] — WCAG-AA is a charter DoD but enforced only by the
  manual design-review 4-lens battery (review-time). No `axe-core` in CI/e2e, so a11y regressions between
  reviews can slip. Add axe assertions at the e2e/component layer as a regression net. (Charter Gaps 1–3
  closed: coverage gate now CI-enforced via `scripts/changed-lines-coverage.mjs`; Part B synced to
  3-reviewer + twice-design-review; DB-index review assigned to code-quality.)
- **Lens D — Product / Intent (JTBD) codified + first pass run, 2026-06-14** — `docs/jtbd.md` is the
  role × job-story oracle (Lens D grades every FE screen against it); wired into
  `docs/design-workflow.md` §2.3(d), `design-reviewer` agent, `docs/director-playbook.md` intake hook,
  `DESIGN.md` §7, and Part C of `docs/product-expectations.md`. **(b) DONE:** the dual-substrate
  (Opus + gpt-5.4) JTBD walkthrough on `dev` → [`docs/reviews/2026-06-14-jtbd-walkthrough.md`](reviews/2026-06-14-jtbd-walkthrough.md):
  3 anchors re-confirmed (a HOLDS·Critical, b HOLDS, c PARTIALLY-RESOLVED+re-appears-pre-win), **9
  confirmed intent gaps** (1 Crit / 6 Imp / 2 Min) clustering in 2 classes (dead-display, preview-asymmetry).
- **✅ intent-fix wave — DELIVERED** (branch `intent-fix-wave` → PR to `main`, 2026-06-14; plan
  `docs/plans/2026-06-14-intent-fix-wave.md`). Closed **all 9 JTBD gaps + all 3 anchors** (render-verified):
  (1) procurement **preview-in-place** in `/approvals` (the Critical — inline budget preview + Approve/Reject,
  no drill-in); (2) **dead-display sweep** (exec BvA rows + at-risk link, calendar milestone chips,
  S-curve→tabs + overdue lever); (3) **pre-win record layout** (sales levers first, S-curve hidden pre-win);
  (4) company-detail related objects + My-Tasks urgency/log-time; (5) **seed** contacts+activity.
  Gap #8 (incident→project link) deferred — needs a `project_id` FK (schema), tracked below.
  Full battery: spec ✅ · security ✅ (RPC+RLS authority intact) · code-quality ✅ (incl. new
  `procurements_vendor_idx`, **migration 0031**) · rendered Lens-D ✅. **All review Minors fixed (none backlogged)**
  per owner directive. 10 commits, gates green (2721 tests).
- **✅ Wave-0 mobile audit (`review/mobile-audit/`) — RECONCILED + CLOSED, 2026-06-14.** 13/18 findings FIXED
  (render-verified @390), 2 SUPERSEDED by the coherence wave (noun-soup, approvals-duplication), 2 adjudicated
  non-defects (A-MIN-3, B-MIN-2). The 3 that were "outstanding": **A-MIN-1** (Projects no-op view-toggle
  visible @390 — a cw5 regression masked by a class-string-only test) **FIXED** in the intent-fix wave
  (wrapperClassName + test hardened to computed-visibility); **A-MIN-2** (kanban first-scroll affordance)
  **ADDED** (owner ruling); **B-IMP-3** (timesheet approve confirm on mobile) **kept by design** (owner
  ruling — consistent with procurement approvals + SoD gravity; thumb-zone already fixed by S5). Ledger now zero-open.
- **▶ Deferred (small, tracked):** gap #8 — link an incident's `location`/project to `/projects/:id` needs an
  `incident_reports.project_id` FK + migration; do as a tiny schema issue when convenient.

## Run locally
- One-time: `claude plugin install superpowers@claude-plugins-official --scope project`;
  `scripts/vendor-skills.sh` (vendored skills, gitignored); `cd pmo-portal && npm install`;
  `npx playwright install chromium`.
- Backend: `supabase start && supabase db reset` (seeds professional-services data + credentialed users,
  password `Passw0rd!dev`). Put the printed URL/anon key in `pmo-portal/.env.local`.
- App: `cd pmo-portal && npm run dev`. Gates: `npm run typecheck` · `npm run lint:ci` · `npm test` ·
  `npm run build` · `npx playwright test` (stack up, from `pmo-portal/`) · `supabase test db` (pgTAP).
- **Parallel-worktree caution:** one shared local Supabase stack — serialize DB-driving work; `db reset`
  between an e2e run and pgTAP. See `docs/environments.md` "Local stack hygiene".
- **Worktree e2e caution:** worktrees lack `.env.local` (gitignored) — copy it from the main checkout and
  use a fresh port to avoid auth failures.
