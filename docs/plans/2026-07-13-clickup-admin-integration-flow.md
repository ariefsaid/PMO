# Scoping plan — external-system admin-connect layer (ClickUp + ERPNext), admin self-serve

> **Framing (locked 2026-07-14):** this is NOT ClickUp-only. It is a **tier-generic admin-connect
> layer** serving ClickUp (P1) and ERPNext (P2/#315) — one Connect flow, one Vault-backed per-org
> secret model, tier-specific only in credential shape + link granularity. See §11 (discussion
> outcome), the locked decisions **OD-INT-1..5** in `docs/decisions.md`, and the backlog "EXTERNAL-
> SYSTEM ADMIN-CONNECT" section. Sequenced **after #315 (ERPNext P2) merges**.

- **Date:** 2026-07-13 (scoped) · 2026-07-14 (generalised + decisions locked)
- **Author:** Director (scoping; eng-planner produces the granular per-phase task plans on commit)
- **Depends-on ADRs:** ADR-0055 (external adapters / SoT), ADR-0016 (`can()` UX + RLS authority),
  ADR-0019 (server-enforced privileged actions via security-definer RPC), ADR-0017 (repository seam),
  ADR-0018 (soft-archive). Vault pattern precedent: mig `0082` (automation dispatch).
- **Status:** SCOPE for owner review — several product/security decisions flagged in §8 need a call
  before eng-planner writes the build plan.

## 1. Goal + job stories

Let an **org admin self-serve** the ClickUp integration from the app, instead of the current
operator-CLI-only path:

- *When I'm an org admin, I want to connect our org's ClickUp with one API token, so PMO becomes a
  two-way sync with our ClickUp workspace without a platform operator doing it for me.*
- *When I'm a PM/admin on a PMO project, I want to link it to a ClickUp List, so tasks sync both ways
  for that project (pull existing ClickUp tasks in, and push PMO task changes out).*
- *When I'm an admin, I want to see the connection's health (connected / last sync / errors) and be
  able to unlink a project or disconnect the org.*

## 2. Current state (already built — ADR-0055 ClickUp P1, Slices A–E)

The **sync engine exists**; this plan adds the self-serve operator/admin layer on top.

| Piece | Exists | Role |
|---|---|---|
| `external_domain_ownership` (org, tier, domain) | ✅ | the org-level "on" state (row = ClickUp owns tasks) |
| `external_project_bindings` (project ↔ List + status/member maps) | ✅ | the per-project link |
| `adapter-dispatch` edge fn | ✅ | outbound PMO→ClickUp (create/update/delete) |
| `clickup-webhook` edge fn | ✅ | inbound ClickUp→PMO (HMAC-verified) |
| `clickup-sweep` edge fn + cron (mig 0094) | ✅ | inbound reconciliation (polling) |
| `clickup-onboard` edge fn (provision / push-seed / pull-adopt) | ✅ | **service-role-only** onboarding |
| `IntegrationsView` (Admin page) | ✅ | **read-only** display of employed tiers/domains |
| Token/secrets | ✅ (single global fn secret) | `CLICKUP_API_TOKEN` etc. — set via CLI/dashboard |

**Gaps this plan closes:** (a) no self-serve UI (onboard is service-role CLI; the admin panel is
read-only); (b) a single global token (not per-org, not admin-managed); (c) provisional/mocked-only
live wire shapes.

## 3. Key design decisions

**D1 — Token storage: `secret_ref` → Vault (NOT a DB column, NOT a global fn secret).**
An admin enters the ClickUp token in the UI; it is POSTed once to a server endpoint that (i) validates
it against ClickUp, (ii) `vault.create_secret(token, 'clickup_token_<org_id>')`, (iii) stores only a
**`secret_ref`** on an org-connection row. The token is **write-only** from the UI (never returned).
Edge fns resolve the per-org token from Vault via `secret_ref` at request time (a locked-down
security-definer reader, mirroring mig `0082`). This is the multi-org-ready model and avoids a plaintext
token in an RLS-readable column. **Coordination:** the per-org `secret_ref` shape is also designed in the
unmerged ERPNext P2 branch (#315) — align the column/table so the two don't diverge (§9).

**D2 — Auth: admin JWT + `can()` + server RPC/edge-gate (ADR-0016/0019), not service-role from the UI.**
New admin endpoints run under the caller's JWT; the FE gates affordances with `can('manage','integration')`
(new Entity `integration` + action, added to `policy.ts`), and the **server** re-enforces Admin/Operator
role before any Vault write or ownership insert (security-definer RPC or an edge fn that role-checks the
verified caller — reuse the ADR-0057 `verifyCallerJwt` + a `profiles.role`/`is_operator()` check).
`clickup-onboard` stays service-role for the heavy provisioning; the admin endpoints call it internally
(or a shared handler) after the role gate.

**D3 — Hierarchy mapping.** PMO **project → ClickUp List** (ClickUp has no first-class "project":
Workspace → Space → Folder → List → Task). Connect is at the **Workspace** (org) level; link is at the
**List** level. The link picker fetches the workspace's Spaces/Folders/Lists via the org token.

**D4 — Explicit linking, not blanket import.** Connecting the org does not import anything; each PMO
project is explicitly linked to a chosen List, with a **direction** at link time (`push-seed` = PMO is
source into an empty List · `pull-adopt` = adopt the List's tasks into PMO · reject the mixed case, as
`clickup-onboard` already does).

**D5 — Reversibility.** Unlink a project (soft: drop the binding, keep read-model rows tombstoned per
existing delete-aware dispatch) and Disconnect the org (remove ownership + revoke the Vault secret).

## 4. Architecture delta

- **DB (migration):** `org_external_connections` (or extend `external_domain_ownership`) carrying
  `org_id, tier, secret_ref, status, connected_by, connected_at`; RLS = own-org Admin/Operator read,
  write only via the RPC. Vault reader security-definer fn (per `0082`). pgTAP for RLS + role gate.
- **Edge fns:** (a) `clickup-connect` — validate token → Vault → connection row → set ownership;
  (b) `clickup-lists` — list the workspace's Lists for the picker; (c) `clickup-link` / `clickup-unlink`
  — provision/adopt/seed a project↔List binding (wraps `clickup-onboard`). All admin-JWT + role-gated.
  Refactor `adapter-dispatch`/`clickup-sweep`/`clickup-webhook` to resolve the token per-org via
  `secret_ref` instead of the global `CLICKUP_API_TOKEN` (keep the global as a fallback during migration).
- **FE (repository seam + UI):** an `integrations` repository (`functions.invoke`), a **Connect ClickUp**
  card in the Administration → Integrations panel (replacing the read-only-only view with an
  admin-gated connect/disconnect + status), and a **"Link to ClickUp List"** control on the project
  Tasks tab / project settings (List picker + direction choice + unlink). Gate every affordance with
  `<CanWrite>`/`can('manage','integration')`.

## 5. Phased plan (build order — de-risk first)

- **Phase 0 — Live-ClickUp validation (do FIRST).** Run the §7 live-smoke against a real ClickUp
  workspace to confirm the provisional wire shapes (`types.ts`/`mapping.ts`) before building UI on them.
  Output: fixes to the wire shapes + a `docs/` live-smoke appendix. *(No UI yet.)*
- **Phase 1 — Per-org token model (`secret_ref`/Vault).** DB + Vault reader + refactor the 4 edge fns
  to resolve the token per org. Behind the existing flag-off (no behavior change until an org connects).
- **Phase 2 — Org Connect/Disconnect flow.** `clickup-connect` endpoint (validate→Vault→ownership) +
  the admin UI card + `can('manage','integration')` + pgTAP for the role/RLS gate.
- **Phase 3 — Project Link/Unlink flow.** `clickup-lists` + `clickup-link`/`unlink` endpoints + the
  project-level List picker + direction choice, wrapping `clickup-onboard`.
- **Phase 4 — Connection health + observability.** Connected/last-sync/error surface on the
  Integrations panel (sweep/webhook last-run, outbox failures), unlink/disconnect confirmations
  (`ConfirmDialog`), audit events for connect/disconnect/link (log_audit, mig 0076).

## 6. Security & gates (binding)

- `can('manage','integration')` = **UX only**; the server RPC/edge fn re-enforces Admin/Operator on the
  verified JWT (ADR-0016). Token write path is admin-only + validated-before-store.
- Token **never** returned to the client, **never** in an RLS-readable column — Vault only (D1).
- Every privileged write (connect/link/disconnect) is a security-definer RPC or role-gated edge fn +
  a pgTAP proof (ADR-0019). Audit each (mig 0076 `log_audit`).
- `security-auditor` pass on the token handling + the new admin endpoints before merge (mandatory —
  new secret-handling + privileged surface).
- e2e (curated): admin connects → links a project → a PMO task change reflects in the (mocked) List
  and back (AC-CUA-* extended). Deterministic gate-tests for the mapping (ADR-0030 layer-1).

## 7. Live-smoke checklist (Phase 0 — against a real ClickUp workspace)

1. **Token validation** — a Workspace-admin personal token authenticates; a bad token → clean error.
2. **Workspace read** — fetch Spaces/Folders/Lists (the picker source); pagination/`archived` handling.
3. **Status map capture** — a List's statuses map to PMO `To Do/In Progress/Done/Blocked` by convention;
   confirm the `include_closed` finding (2026-07-11: ClickUp omits closed statuses without it).
4. **Outbound round-trip** — PMO create → ClickUp task appears (authored by the token user); update →
   status reflects; delete → tombstone. Verify the money/no-`org_id`-leak invariants (AC-EAS-023).
5. **Inbound webhook** — a ClickUp change fires the webhook with a valid `X-Signature`; PMO read-model
   converges; bad signature → 401 no-op.
6. **Sweep** — a change missed by the webhook is reconciled by the poll; verify the sweep's Vault-secret
   auth (mig 0094 `clickup_sweep_url`/`clickup_sweep_secret`).
7. **Member map** — assignee mapping (ClickUp member ↔ PMO profile); confirm operator-configured empty
   default doesn't break create/update.
8. **Rate limits / errors** — ClickUp 429 backoff (client.ts) behaves; no blind retry (money invariant).

## 8. Open questions for the owner (decide before eng-planner)

1. **Who connects — org Admin, or platform Operator only?** (Affects the `can()` entity + which role.)
   Recommendation: **org Admin** (self-serve is the point), Operator retains the CLI path.
2. **Token entry UX:** paste-a-personal-token (simplest, matches ClickUp) vs. ClickUp **OAuth** app
   (nicer UX, no long-lived token, but requires registering a ClickUp app + redirect). Recommendation:
   **personal token for v1**, OAuth as a later upgrade.
3. **Link granularity:** one PMO project ↔ one ClickUp List (recommended, matches the model) — confirm
   we don't need project ↔ Folder/Space.
4. **Rollout:** single-tenant now (one org) — do we build the per-org model immediately (recommended,
   it's the same effort and future-proofs B2B) or a single-org shortcut?

## 9. Dependencies / coordination

- **#315 (ERPNext P2, unmerged, CONFLICTING)** contains the per-org `secret_ref`/Vault design for the
  adapter seam. **Align the `secret_ref` column/table with #315** (or land #315's seam first) so the
  ClickUp token model and the ERPNext one share one shape — don't fork it. This is the main sequencing
  risk; resolve before Phase 1.
- Live-ClickUp validation (Phase 0) needs a real ClickUp workspace + admin token (owner-provided).

## 11. Discussion outcome (2026-07-14) — decisions locked + #315 alignment

**Locked owner decisions (see `docs/decisions.md` OD-INT-1..5):**
- **OD-INT-1** — **Admin self-serve** (org Admin connects; Operator retains the CLI path). Not operator-only.
- **OD-INT-2** — **Personal token / API-key v1** (ClickUp personal token · ERPNext `apiKey:apiSecret`);
  ClickUp **OAuth** app is a later upgrade, out of v1 scope.
- **OD-INT-3** — **Vault-backed `secret_ref`** is the secret backend for BOTH tiers. The admin enters
  the credential once → a role-gated server endpoint `vault.create_secret(...)` → the DB stores only a
  `secret_ref` (Vault name); write-only, never returned. This is what makes self-serve possible
  (function secrets can't be written from the app; Vault can — precedent mig `0082`/`0094`).
- **OD-INT-4** — **One tier-generic Connect layer**, not per-tier forks. Shared: `external_org_bindings`
  (#315's table) + Vault `secret_ref` + the Connect endpoint + admin UI card. Tier-specific (thin):
  credential shape, the validation call, link granularity (ClickUp → **List** per project · ERPNext →
  **Company/module** per org).
- **OD-INT-5** — **Sequenced after #315 merges** (build on the merged `external_org_bindings`
  foundation, not on the unmerged/conflicting branch).

**What #315 (ERPNext P2) actually has vs. needs — verified 2026-07-14 against `origin/feat/erpnext-adapter-p2`:**
- ✅ HAS the right per-org data model: **`external_org_bindings`** (mig `0096`: `org_id, external_tier,
  site URL, secret_ref, webhook_secret_ref`, RLS own-org active-member) + `external_command_outbox` +
  `external_ref_lineage`; an `erpnext-onboard` fn; a clean credential-resolution **seam** (`erpnext/
  credentials.ts` — "never reads secret_ref/vault/env itself").
- ⚠ DIVERGES on the backend: #315's `secret_ref` resolves to **per-org FUNCTION secrets** (`Deno.env`,
  UPPER_SNAKE prefix), which are **operator-provisioned** — NOT admin-self-serve. Adopting OD-INT-3
  means swapping that resolution from `Deno.env` → a **Vault reader** keyed by `secret_ref`. Because it's
  already behind the `credentials.ts` seam, this is a **contained swap, not a rewrite**.
- ⚠ ClickUp P1 (on `main`) does NOT use `external_org_bindings` (it uses `external_domain_ownership` +
  `external_project_bindings`, single global `CLICKUP_API_TOKEN`). Alignment = **ClickUp adopts
  `external_org_bindings`** for the org connection + Vault `secret_ref`.

**Coordination with the in-flight #315 implementer agent (do NOT hand it this layer):**
- The #315 agent stays on its current job (ERPNext P2 sync hardening) and **lands #315 as-is**
  (operator-provisioned, function-secret backend is fine for its scope). Two heads-up notes only:
  (1) the `secret_ref` backend will move to **Vault** later — keep the `credentials.ts` resolver seam
  clean (it already is); (2) confirm `external_org_bindings` is THE shared per-org connection table.
- This admin-connect layer is a **separate feature** the Director orchestrates **after #315 merges**
  (its own spec → eng-planner plan → PRs; security-auditor mandatory on the token path). An ADR
  (extending ADR-0055, or a new one) gets written at that build time — not pre-emptively here.

**ERPNext fits this even better than ClickUp** — it is inherently per-org (each org has its own
instance URL + `apiKey:apiSecret` from an ERPNext System Manager). The identical Connect flow applies:
enter URL + key + secret → validate against that instance → Vault → `external_org_bindings`.

## 10. Not in scope

- ClickUp OAuth app (Q2 upgrade), multi-List-per-project, custom-field mapping beyond status/member,
  ERPNext/other-tier admin UI (this plan is ClickUp-specific but the endpoints/UI should be
  tier-generic where cheap).
