# Plan — Odoo: connect and manage master data (O1, #1504)

- **Spec:** `docs/specs/odoo-connect-master-data.spec.md`. Owner approved its defaults on 2026-10-31 and added three binding
  requirements (relayed by the Director the same day): **connect at any time** (four scenarios), **parity** with ERPNext
  through the shared adapter seam with one contract suite both adapters pass, and **map once** with bulk-accepted
  auto-proposals.
- **Companion spec (binding for the shared parts):** `docs/specs/erp-connect-anytime.spec.md` (ECA, #1442, branch
  `spec/erp-connect-anytime`). This plan uses its names: scenarios **S-A..S-D**, outcomes **link / bring in / send /
  review**, `proposeMatches()` (`adapterSeam/connect/match.ts`), `ConnectAdapter`, `ErpHarness`, `WORKFLOWS`,
  `contractSuite/*`, the send key `seed:<kind>:<pmo_record_id>`. Shared code those names refer to is built by ECA slices
  (ECA-2 #1605, ECA-3 #1606, ECA-7 #1604); O1 plugs Odoo into it and never builds a second copy.
- **Route:** #1481, item O1 of `docs/plans/2026-10-30-epc-odoo-build-route.md`. Blocks O2–O8.
- **Grounds read:** ADR-0055, ADR-0058, ADR-0060, ADR-0061, ADR-0072, ADR-0073, ADR-0094; `docs/money-path-primer.md`;
  the shipped connect path (`supabase/functions/external-connect`, `external-disconnect`, `external-set-company`,
  `_shared/erpClientForOrg.ts`, `_shared/erpHostGuard.ts`); migrations 0087–0097, 0102, 0103, 0118, 0135, 0142, 0147, 0180,
  0216, 0259, 0294, 0341, 0346, 0398; `pmo-portal/src/lib/adapterSeam/{contract,dispatch,watermarks,refs}.ts`,
  `erpnext/{partyAdopt,itemCatalog,binding,adapter}.ts`; `supabase/functions/adapter-dispatch/moneyOutboxDeps.ts`;
  `docs/research/2026-10-31-odoo20-dev-bed-verification.md` (branch `infra/odoo-dev-bed`, "the bed report").
- **Migration numbers:** written `NNNN-A` … `NNNN-E`; the Director assigns real numbers at build
  (`scripts/renumber-migration.sh` on a collision).
- **Every file, function and RPC cited as existing was checked at `origin/dev` (`3e0096605`) on 2026-10-31.** Names marked
  *(new)* do not exist yet; names marked *(ECA)* are created by the named ECA slice.

---

## 0. Open questions for the Director (each with the default this plan builds on)

**Director, 2026-10-31:** PQ-1: #1604 (ECA-7 contract suite) lands first; if it is not on dev when S1 starts, S1 builds `connect/types.ts`, `workflows.ts` and `contractSuite/harness.ts` exactly to ECA §6.2 and #1604 adopts them. PQ-2: follow ECA (`item.send`), conditional on the owner's answer to OQ-ECA-2. PQ-3..12: defaults taken. Migration numbers assigned at build. S0 bases on `infra/odoo-dev-bed`.

| # | Question | Default taken |
|---|---|---|
| **PQ-1** | O1-S1 (contract first) needs ECA-7's `workflows.ts`, `contractSuite/*`, `ErpHarness` and ECA-2's `connect/types.ts` + `connect/match.ts`. Neither is on `dev` yet. | **Sequence ECA-7, then ECA-2's matcher part, before O1-S1.** If the Director wants O1 to start first, O1-S1's worker builds `connect/types.ts`, `workflows.ts` and `contractSuite/harness.ts` exactly to ECA §6.2 and ECA-7 adopts them; never two copies. |
| **PQ-2** | Items. The O1 spec's OQ-ODC-11 default says no item creation from PMO; the ECA spec (FR-ECA-020, OQ-ECA-2) sends items used on open purchases in S-C, and its §9 lists `item.*` for O1. | **Follow ECA:** `item.send` is supported in O1 (create `product.product` for items on open or post-cut-over purchases, after one bulk accept). Free-form item **editing** from PMO stays out (OQ-ODC-11 still holds for edits). |
| **PQ-3** | The O1 spec's slice table puts the Odoo client and `odooClientForOrg` in its S2, but activation (custody slice) already calls Odoo with the stored key. | **Client in S1** (pure, fetch-mocked, used by the harness); `odooClientForOrg` in S2 (custody). |
| **PQ-4** | Binding `config` is readable by every active member (policy `external_org_bindings_select`, migration 0096). O1 §8 wants account defaults and capability detail visible to Admin, Executive and Finance only. ERPNext keeps the same class of setting there. | **Accept for O1.** Config stores Odoo **ids only** for defaults; names come from the role-gated account directory. A column split is filed as a follow-up issue. |
| **PQ-5** | The shipped `companies_native_mirror_guard` (migration 0103 version) locks `type` while `companies` is employed; O1 §4 calls the role an enhancement. | **Keep the guard.** The role is chosen at match time and encoded in the external id (`Vendor:<id>` / `Client:<id>`); AC-ODC-033 proves only `archived_at` stays editable. |
| **PQ-6** | When does the org employ `companies` under tier `odoo`? | **After setup's sends finish** (S8), through the shipped `admin_change_domain_ownership(… 'employ' …)`, as a setup-checklist step. Before that, a new PMO company becomes a *send* row on the next proposal pass (FR-ECA-016). |
| **PQ-7** | O1 lists seven connection states; FR-ODC-034 forbids a stale *healthy* but names no replacement. | **Display-only `unverified`** ("not checked recently"), computed in the browser, never stored. |
| **PQ-8** | Activation set-once: the shipped `activate_external_binding` lets a re-select overwrite the ERPNext company; Odoo must refuse a different company. | **A separate `activate_odoo_binding` RPC** with the same shape and set-once `activated_at`, rather than a branch inside the ERPNext money-path function. |
| **PQ-9** | Reconnect to a different database "unless the Admin confirms discarding". What is discarded, and what counts as an "external document reference" in O1? | Discard = the org's Odoo mirror rows, watermarks, `external_refs` and `external_project_bindings` for tier `odoo`, and the stored company, plan, defaults and unit map. Refused outright when any tier-`odoo` `external_command_outbox` row exists in a state other than `failed`. |
| **PQ-10** | Recovery of a stuck `committing` send or command. ERPNext's sweep runs `reconcileOrgOutbox` from `erpnext-sweep/index.ts`. | **The next sweep tick or a user retry re-runs `dispatchMoneyWrite`**, which quarantines a past-lease row, probes the anchor and links or holds. No separate Odoo recovery pass in O1. |
| **PQ-11** | Odoo version discovery is not covered by the bed report. | **New claim V17** (S0-T17): `POST /web/webclient/version_info`; fallback `ir.module.module` `latest_version` of `base`. |
| **PQ-12** | Setup actions. ERPNext's setup goes through `external-set-company` with a `setupAction` (`readiness`, `list-projects`, `link-project`, `employ-domain`, `onboard-parties`, …) and the browser's `erpSetupRequest`. | **Parity:** Odoo uses the same function and the same verbs with `tier: 'odoo'` (an Odoo router file inside that function). `erpSetupRequest` gains a `tier` argument. No separate Odoo setup function. |

## 1. Spec deltas the O1 spec must absorb

From the bed report:

| # | Spec text | Bed reality | Plan change |
|---|---|---|---|
| **SD-1** | DD-ODC-3 / V9: "what the Project app's own link field is called" | `project.project.account_id`, not `analytic_account_id`. | Unused in O1; record the name in DD-ODC-3 so O4/O7 do not copy the research doc. |
| **SD-2** | OQ-ODC-6 / FR-ODC-030: keys "may expire" | An admin-group user can mint a non-expiring key; the cap is per user group. A least-privilege user (NFR-ODC-003) may get a capped key. | Declared expiry stays optional; *credential expiring* only when declared; the runbook tells the client to declare the expiry they chose. |
| **SD-3** | FR-ODC-049 / V15 | Body `{_action, _id, _model}`, **several deliveries per create**, `base_automation` ships **uninstalled**. | The webhook receiver dedupes `(_model, _id)` within 60 s; the runbook adds "install Automation Rules once" (a stock module, not a customisation). |
| **SD-4** | V7 unit "category" | v20 `uom.uom`: `name, relative_factor, relative_uom_id`; no category seen. | The unit parser stores `relative_factor` and `relative_uom_id`; no category. |
| **SD-5** | V10 deletes | Verified invisible to the feed. | Census mandatory (already FR-ODC-045). |
| **SD-6** | V1/V2 | JSON-2, bearer auth, 401 on bad/missing key, error body `{name, message, arguments, context, debug, timestamp}` verified; `X-Odoo-Database` optional on a single-db host. | V1 closed; V2 stays open for multi-db hosts (always send the header). |
| **SD-7** | NFR-ODC-003 | The bed's API user was an admin-group bot; no minimal group set proven. | S0-T13 records the smallest group set that passes discovery; the runbook quotes it. |

From the owner's 2026-10-31 requirements and the ECA spec:

| # | Change |
|---|---|
| **SD-8** | FR-ODC-050..052's decision function is replaced by the shared `proposeMatches()` (DD-ECA-2). AC-ODC-030 is owned by ECA-2's matcher test; O1 owns only the Odoo normalisation (role from ranks, child contacts excluded, both-roles split). |
| **SD-9** | Add four scenario ACs for Odoo, mirroring AC-ECA-050/051 on the Odoo bed: **AC-ODC-091 (S-A)**, **AC-ODC-092 (S-B)**, **AC-ODC-093 (S-C)**, **AC-ODC-094 (S-D)** (texts in S10 below). |
| **SD-10** | Add **AC-ODC-095 (parity)**: `odoo/contract.test.ts` runs every suite the Odoo declarations mark *supported*, and the declarations cover `census`, `party.*`, `project.*`, `item.*`, `account.match` as *supported* (AC-ECA-042's Odoo half). |
| **SD-11** | Add **AC-ODC-096 (map once)**: account defaults, unit map and default warehouse are proposed together and accepted in one action; only rows with no unique candidate need a choice. |
| **SD-12** | OQ-ODC-11: item creation is in scope for S-C sends (PQ-2). |
| **SD-13** | FR-ODC-072's cost-account create is `project.send` with key `seed:project:<pmo id>` (FR-ECA-021); FR-ODC-055's partner create is `party.send` during setup and the `companies` commit after employ. |
| **SD-14** | Add display-only `unverified` connection state (PQ-7). |

## 2. Design

### 2.1 Shape

Tier `odoo` is one more row in `external_org_bindings`. The browser never talks to Odoo. Connect goes through
`external-connect`; activation, company listing and every setup verb through `external-set-company` (`tier: 'odoo'`);
the 5-minute cron tick through a new `odoo-sweep`. All Odoo access comes from `_shared/odooClientForOrg.ts`. The key lives
in Vault, staged by the shipped `stage_vault_secret_for_org` and committed by a new `finalize_odoo_connect`.

Two adapter faces, both in `pmo-portal/src/lib/adapterSeam/odoo/`:
- **`Adapter`** (`contract.ts`, shipped) — `companies` commit + reads, used by `adapter-dispatch` after employ.
- **`ConnectAdapter`** (ECA §6.2) — `listMasters`, `countDomain`, `sendMaster`, used by the shared census, matcher,
  bulk accept and sends. Same code path for ERPNext and Odoo above the adapter (FR-ECA-053).

Directory data (items, units, warehouses, locations, accounts, taxes, cost accounts) lands in one new machine-written table,
`external_master_records`, through a service-only RPC that upserts a page **and** advances that kind's watermark in one
transaction. Partners become `companies` rows through the shared matcher's outcomes. Project ↔ cost-account links reuse
`external_project_bindings`. Connection state and the capability snapshot are JSON in binding `config`.

### 2.2 The four scenarios, per kind (DD-ECA-1: scenario is per kind)

| Kind | S-A new PMO, Odoo has data | S-B new PMO, no Odoo | S-C live PMO, empty Odoo | S-D live PMO, Odoo has data |
|---|---|---|---|---|
| Parties (`res.partner` companies) | every partner → *bring in*; accept all | no binding: PMO alone; nothing calls Odoo | every PMO vendor/client → *send* (create partner, anchor `ref = pmo:<id>`) | tax id / code / name match → *link*; Odoo-only → *bring in*; PMO-only → *send*; ambiguous → *review* |
| Projects ↔ cost accounts | accounts are mirrored; no PMO project is created from one (projects are PMO-owned) | — | every PMO project → *send* (create analytic account, code = project number) | code = project number or unique name → *link*; PMO-only → *send*; Odoo-only accounts stay mirror-only |
| Items | Odoo catalogue is the picker | — | items on open purchases → *send* (create product) | code / name match → *link*; PMO-only on open purchases → *send* |
| Units, account defaults, default warehouse | auto-proposed from the mirror (unique candidate), accept all | — | Odoo's stock units and chart exist after install; same proposal | same proposal |
| Warehouses, locations, accounts, taxes | mirror + directory | — | mirror (never sent: DD-SETUP-1, FR-ECA-020) | mirror |

After setup, newly seen Odoo partners and new PMO records run through the same matcher on every sweep; clean outcomes apply
automatically, the Admin sees only new *review* rows (FR-ECA-014/016).

### 2.3 Decisions taken in this plan (`PD-#`)

- **PD-1 — No new connection table or state columns.** `config.connection` = `{state, failures, last_ok_at, last_checked_at,
  error_class, missing[]}`; `config.capabilities` = the snapshot. Written through the shipped
  `merge_external_org_binding_config` (service-only).
- **PD-2 — The page-apply RPC owns the cursor.** `apply_odoo_master_page(org, kind, rows, cursor)` upserts with a
  `source_write_date` guard and writes the watermark in the same function. No code path writes a `master:*` watermark directly.
- **PD-3 — Single-flight reuses `erp_sweep_lock`** (migration 0294, keyed by org). FR-ODC-008 allows one ERP tier per org.
- **PD-4 — Host guard reused unchanged.** `isPermittedErpSiteUrl` + `guardedErpFetch`; local served lanes reach the bed via the
  existing `ERPNEXT_ALLOW_LOCAL_BENCH=1` and `ERPNEXT_LOCAL_BENCH_ORIGINS=http://host.docker.internal:8069`.
- **PD-5 — Partner columns reuse the `erp_*` set** on `companies` (already in the guard's column list); Odoo's `write_date` goes
  into `erp_modified`.
- **PD-6 — Cursor JSON** in `external_sync_watermarks.watermark_cursor` per domain `master:<kind>`:
  `{"w":"YYYY-MM-DD HH:MM:SS","id":123,"scan":{"after_id":0,"started_at":"…"}|null,"census":{"run":"…","after_id":0}|null,"census_done_at":"…"}`.
- **PD-7 — Initial-scan handover** sets the cursor to `scan.started_at − overlap` (PMO clock). Ceiling: PMO/Odoo clock skew
  above the 10-minute overlap; upgrade path: take Odoo's clock from the newest `write_date` of the first page.
- **PD-8 — Sends and commands use the money outbox** (`dispatchMoneyWrite` + `createDbMoneyOutboxDeps`), keys
  `seed:<kind>:<pmo id>` for sends (FR-ECA-021) and `odoo:companies:<pmo id>` for post-employ edits,
  `reissueOnInconclusiveAbsence: false` (Odoo anchors are editable, ADR-0058 C-1).
- **PD-9 — Setup verbs through `external-set-company`** (PQ-12): `readiness`, `list-companies`, `recheck`, `refresh`,
  `reset-kind`, `list-projects`, `link-project`, `unlink-project`, `propose-config`, `save-defaults`, `employ-domain`. Census,
  proposals and accept-all use whatever verbs ECA-2 defines, with `tier: 'odoo'`.

### 2.4 File map and slice ownership

`(new)` created by the named slice; **(ECA)** created by an ECA slice and only extended here.

| File | Owner | Later edits |
|---|---|---|
| `adapterSeam/connect/types.ts`, `connect/match.ts`, `connect/census.ts`, `connect/workflows.ts` | (ECA-2/ECA-7) | S1 adds the `odoo` declaration object |
| `adapterSeam/contractSuite/*` | (ECA-7) | — (Odoo runs it; never forks it) |
| `adapterSeam/odoo/client.ts` (new) | S1 | S3 adds pacing |
| `adapterSeam/odoo/normalise.ts` (new) | S1 | — |
| `adapterSeam/odoo/connectAdapter.ts` (new) | S1 | S8 wires `sendMaster` into the outbox caller |
| `adapterSeam/odoo/adapter.ts` (new) | S1 | — |
| `adapterSeam/odoo/workflows.ts` (new, `TierWorkflows` for `odoo`) | S1 | each later Odoo issue (O2–O8) |
| `adapterSeam/odoo/contract.harness.ts`, `contract.test.ts` (new) | S1 | — |
| `adapterSeam/odoo/fakeOdoo.ts` (new, in-memory JSON-2 over a fetch mock) | S1 | S4 adds directory models |
| `adapterSeam/odoo/vocabulary.test.ts` (new) | S1 | — |
| `adapterSeam/odoo/__fixtures__/json2.ts` (new, synthetic shapes) | S0 | every slice appends |
| `adapterSeam/odoo/connect.ts` (new, connect validation) | S2 | — |
| `adapterSeam/odoo/discovery.ts`, `connectionState.ts` (new) | S3 | — |
| `adapterSeam/odoo/kinds.ts`, `sweep.ts` (new) | S4 | — |
| `adapterSeam/odoo/configProposal.ts`, `resolvers.ts` (new) | S7 | — |
| `supabase/functions/_shared/odooClientForOrg.ts` (new) | S2 | S3 (pacing, `recordOdooProbe`) |
| `supabase/functions/_shared/odooSweep.ts` (new) | S4 | S6 (party feed match), S7 (link reconcile), S8 (accepted sends) |
| `supabase/functions/external-connect/index.ts` + `odoo.ts` (new) | S2 | — |
| `supabase/functions/external-disconnect/index.ts` | S2 | — |
| `supabase/functions/external-set-company/index.ts` + `odoo/` (new dir: `router.ts`, one file per verb) | S2 | S3, S4, S6, S7, S8 add verbs |
| `supabase/functions/odoo-sweep/index.ts` (new) | S4 | — |
| `supabase/functions/odoo-webhook/index.ts` (new) | S9 | — |
| `supabase/functions/adapter-dispatch/index.ts` | S8 | — |
| `scripts/check-edge-fn-test-binding.mjs` (`REQUIRED` map) | S2 | S3, S4, S8, S9 |
| Migrations `NNNN-A_odoo_connect_custody` (S2), `NNNN-B_odoo_master_records` (S4), `NNNN-C_odoo_project_links_config` (S6/S7: one file, S6 creates, S7 appends before merge), `NNNN-D_odoo_party_adoption` (S6), `NNNN-E_odoo_webhook` (S9) | as named | — |
| `pmo-portal/src/lib/repositories/types.ts` | S2 (`ExternalTier`, drop `secret_ref`) | S5 |
| `pmo-portal/src/lib/repositories/index.ts` (`erpSetupRequest` tier arg) | S2 | — |
| `pmo-portal/src/lib/repositories/odoo.ts` (new) | S5 | S7 |
| `pmo-portal/src/hooks/useOdoo.ts` (new) | S5 | S7 |
| `pmo-portal/src/components/integrations/IntegrationsView.tsx` | S5 (mount Odoo card) | — |
| `pmo-portal/src/components/integrations/odoo/*` (new) | S5 | S7 |
| `pmo-portal/pages/MasterData.tsx` (new) + route in `App.tsx` | S5 | — |
| `pmo-portal/public/locales/{en,id}/administration.json` | S5 | S6, S7, S8 |
| `pmo-portal/e2e/serial/AC-ODC-09x-*.spec.ts`, `AC-ODC-014-*.spec.ts`, `AC-ODC-080-*.spec.ts` (new) | S10 | — |
| `docs/runbooks/odoo-client-setup.md` (new, synthetic values) | S10 | S9 |

### 2.5 Data model

**`external_master_records`** (new, S4) — the directory mirror:

```sql
create table public.external_master_records (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                       references public.organizations(id) on delete cascade,
  external_tier      text not null,
  kind               text not null check (kind in ('company','partner','product','uom','warehouse','location',
                                                   'account','tax','analytic_plan','analytic_account')),
  external_id        text not null,
  code               text,
  name               text not null,
  parent_external_id text,
  active             boolean not null default true,
  tombstoned_at      timestamptz,
  census_seen_at     timestamptz,
  attrs              jsonb not null default '{}'::jsonb check (jsonb_typeof(attrs) = 'object'),
  source_write_date  text not null,     -- Odoo naive UTC 'YYYY-MM-DD HH:MM:SS' (fixed width, sorts as text)
  as_of              timestamptz not null default now(),
  unique (org_id, external_tier, kind, external_id)
);
create policy external_master_records_select on public.external_master_records for select using (
  org_id = public.auth_org_id() and public.is_active_member()
  and (kind not in ('account','tax','partner') or public.auth_role() in ('Admin','Executive','Finance')));
```

`partner` rows are the raw mirror the census and feed match read; PMO's party record stays `companies`.
Proposal and review rows are **ECA-2's storage** (O1 adds no proposal table).

**Binding `config` keys for tier `odoo`:** `database`, `odoo_company_id`, `odoo_company_name`, `analytic_plan_id`,
`key_expires_on`, `capabilities`, `connection`, `account_defaults` (`{payable, receivable, expense, cash, bank,
stock_valuation, stock_consumption}` → external ids), `unit_map` (`{"<pmo unit>": "<uom id>"}`), `default_warehouse_id`,
each config key with `<key>_set_by` / `<key>_set_at`.

**`external_project_bindings`** (reused): tier `odoo`, `external_container_id` = analytic account id, `config = {plan_id,
attention?}`; new partial unique index so one account maps to one project.

### 2.6 Connection-state machine (S3, pure)

| From | Probe outcome | To |
|---|---|---|
| any | binding disconnected | `disconnected` |
| any | not activated | `not-activated` |
| any | ok, `missing[]` non-empty | `degraded` (failures 0) |
| any | ok, nothing missing, declared expiry ≤ 14 days away | `credential-expiring` (failures 0) |
| any | ok, nothing missing | `healthy` (failures 0, `last_ok_at` = now) |
| any | `key-rejected`, `access-denied`, `no-json2`, `not-odoo`, `database-not-found`, `missing-model`, `validation` | `credential-rejected` immediately (needs an admin) |
| any | `unreachable`, `timeout`, `tls`, `server-error`, `destination-refused` | failures + 1; `unreachable` once failures ≥ 3, else previous state |

Display (browser): a stored `healthy` / `credential-expiring` / `degraded` older than 2 × 5 minutes renders `unverified`.

### 2.7 Sweep tick (S4, extended by S6–S8)

For each activated, active Odoo binding with the kill-switch on: claim `erp_sweep_lock` → resolve the client → per kind in
`company, analytic_plan, analytic_account, account, tax, uom, product, warehouse, location, partner`: incremental (or resumed
initial) pages until caught up or the tick budget (60 calls / 100 s) is spent → census for kinds last censused > 24 h ago →
(S6) feed match for new partners → (S7) link reconciliation → (S8) accepted sends within the remaining budget → daily
re-discovery → write `config.connection` → release the lock.

Incremental page domain, keyset inside one tick, overlap applied once at tick start:

```ts
// start = { w: cursor.w − 600 s, id: 0 }, then start = last row of each page
['|', ['write_date', '>', start.w], '&', ['write_date', '=', start.w], ['id', '>', start.id]]
```

### 2.8 Authorization

| Action | Path | Server check |
|---|---|---|
| connect / reconnect | `external-connect` | `isAdminOrOperator` + `stage_vault_secret_for_org` / `finalize_odoo_connect` actor checks |
| list companies, activate | `external-set-company` | shipped Admin/Operator gate + `actor_authorization_state` + `activate_odoo_binding` |
| disconnect | `external-disconnect` | `disconnect_external_integration` |
| recheck, reset kind | `external-set-company` | Admin/Operator in the Odoo router + `reset_odoo_sync_kind` |
| refresh now | `external-set-company` | Admin/Finance in router + `checkRequestRate` (1 per 60 s per org) |
| link / unlink project | `external-set-company` | `link_odoo_cost_account` / `unlink_odoo_cost_account` → `assert_integration_link_actor` |
| census, proposals, accept-all, review decisions | ECA-2 verbs | ECA-2's checks (Admin; Finance for defaults per O1 §8) |
| defaults, unit map, default warehouse | `external-set-company` `save-defaults` | `set_odoo_org_config` (Admin/Finance via `actor_authorization_state`) |
| sends | sweep (accepted rows) | the accept's recorded actor, re-checked by `dispatchMoneyWrite`'s `reauthorizeRecoveryReissue` |
| partner create/update after employ | `adapter-dispatch` | shipped `companies` dispatch authorization |

### 2.9 Gate evidence and test conventions

Every slice ends with (CLAUDE.md "Local final gate"): `cd pmo-portal && npm run check:guards && npm run typecheck &&
npx eslint --max-warnings=0 <touched files>`; the slice's touched Vitest and Deno files; touched pgTAP files under
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` (reset only when the slice adds a
migration); `scripts/ux-proof.sh <routes>` for UI; bed tests under `scripts/with-odoo-lock.sh`. CI is the full proof.

**Bed tests (layer B):** Deno files `*.bed.test.ts`, gated on the dependency, never on `CI`:

```ts
const BED = Deno.env.get('ODOO_BED_URL');
Deno.test({ name: 'AC-ODC-001 …', ignore: !BED, fn: async () => { /* … */ } });
```

Run: `scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read <file>'`
(sourced, never printed). Bed up first: `scripts/with-odoo-lock.sh scripts/odoo-dev-bed.sh up`. A bed test that also needs
the local Supabase stack takes the locks in order **odoo → db**: `scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c '…'`.
The build branch merges `infra/odoo-dev-bed` before S0.

---

## S0 — Close the open bed claims (Orca worker; no product code)

Each task adds one case to `scripts/odoo-probe.mjs` (claim, status, response **shape** only), runs it, appends the verdict to
`docs/research/2026-10-31-odoo20-dev-bed-verification.md` §8 "O1 follow-ups", and adds a **synthetic** shape sample to
`pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/json2.ts` where a slice needs it.
Verify each: `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs 2>&1 | grep '<claim id>'`.

S0-T1 creates the fixture file:

```ts
// Synthetic shapes recorded from the stock Odoo 20 bed (S0). Values are invented; keys and types are real.
export const ERR_404_JSON = { name: 'werkzeug.exceptions.NotFound', message: 'x', arguments: ['x', 404], context: {}, debug: '', timestamp: 0 };
export const COMPANY_ROWS = [{ id: 1, name: 'Contoh Konstruksi', currency_id: [12, 'IDR'], write_date: '2026-10-31 01:02:03' }];
```

- **S0-T1 (V1/V2):** wrong `X-Odoo-Database` → status + `name`; body shapes for 401, 403 (valid key, model forbidden), 404 unknown model vs 404 unknown method (distinguishable by `name`?).
- **S0-T2 (V3):** `res.company/search_read {fields:['id','name','currency_id'], limit:50}` as the minimal user (after T13).
- **S0-T3 (V4):** as the minimal user: `ir.module.module/search_read` (expect 403), `res.partner/fields_get {attributes:['type']}`, and the access-check method in 20 (`has_access {operation}` vs `check_access_rights {operation, raise_exception:false}`).
- **S0-T4 (V5):** `product.product/fields_get` → `default_code, purchase_ok, sale_ok, is_storable, type, uom_id, active`; `create` with `default_code, name, uom_id, purchase_ok:true` (for `item.send`).
- **S0-T5 (V6):** `res.partner/fields_get` → `is_company, parent_id, vat, ref, active, supplier_rank, customer_rank, property_payment_term_id`; create a partner, read ranks (expect 0).
- **S0-T6 (V7):** `uom.uom/search_read {fields:['name','relative_factor','relative_uom_id','active']}`.
- **S0-T7 (V8):** `account.account/fields_get` → `company_ids` vs `company_id`, `account_type` selection values, `active`/`deprecated`, any non-postable type.
- **S0-T8 (V9):** `account.analytic.plan/search_read` with and without the Project app's plan; `account.analytic.account/fields_get` → `plan_id, company_id, code, active`; is `code` unique-constrained.
- **S0-T9 (V10):** `search_read` with `context:{active_test:false}` returns archived partners; without it, not.
- **S0-T10 (V13):** `account.tax/search_read {fields:['name','amount','type_tax_use','active']}` on the `l10n_id` company: names of PPN 11 %/12 % and PPh rows.
- **S0-T11 (V14):** keyset domain (§2.7) at `limit` 200 and 1000 over 2 500 seeded partners: no gaps, no repeats.
- **S0-T12 (V12):** write `ref` on a partner and `code` on an analytic account as the minimal user; search by each; confirm not unique.
- **S0-T13 (V16, SD-7):** create a minimal internal user; record the exact group xmlids that pass S2-level reads and S8-level creates; mint a key; record the max `expiration_date`; error body for expired vs revoked key.
- **S0-T14 (V11):** document only: hosted instances end in `.odoo.com`.
- **S0-T15 (V-CREATE):** `account.analytic.account/create {vals_list:[{name, code, plan_id, company_id}]}` → `[id]`; `res.partner/create` with `ref`.
- **S0-T16 (V-COUNT):** `res.partner/search_count {domain}` and `product.product/search_count` exist and honour `active_test:false` (census counts, ECA FR-ECA-001).
- **S0-T17 (V17, PQ-11):** `POST /web/webclient/version_info` `{"jsonrpc":"2.0","method":"call","params":{}}` → is `result.server_version_info[0]` present; else the `ir.module.module` fallback.

---

## S1 — Contract first: Odoo client, adapters, harness, declarations (Orca worker, opus-grade; Director review)

ACs: AC-ODC-002, AC-ODC-032, AC-ODC-083, AC-ODC-095 (and, through the shared suites run for Odoo: AC-ECA-001, 010, 011,
012 for Odoo). Blocked by: ECA-7 (`workflows.ts`, `contractSuite/*`, `ErpHarness`) and ECA-2's `connect/types.ts` +
`connect/match.ts` (PQ-1); S0-T1/T4/T5/T8/T12/T15/T16. Pure code: no DB, no custody, `fetch` mocked.

### S1-T1 — Error classes (AC-ODC-002) — failing test first

`pmo-portal/src/lib/adapterSeam/odoo/client.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest';
import { odooCall, OdooError } from './client.ts';
import { ERR_404_JSON } from './__fixtures__/json2.ts';

const deps = (res: () => Promise<Response>) => ({ baseUrl: 'https://odoo.example.test', apiKey: 'SENTINEL-KEY', database: 'db1', fetchImpl: (() => res()) as typeof fetch });
const classOf = async (res: () => Promise<Response>) => { try { await odooCall(deps(res), 'res.company', 'search_read'); } catch (e) { return (e as OdooError).errorClass; } };

describe('odoo/client — AC-ODC-002 classified failures', () => {
  it.each([
    ['timeout', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
    ['tls', () => Promise.reject(new TypeError('invalid peer certificate: UnknownIssuer'))],
    ['unreachable', () => Promise.reject(new TypeError('error sending request: connection refused'))],
    ['destination-refused', () => Promise.reject(new Error('ERPNext destination is not permitted'))],
    ['not-odoo', async () => new Response('<html>hi</html>', { status: 200 })],
    ['not-odoo', async () => new Response('', { status: 302, headers: { location: 'https://x' } })],
    ['no-json2', async () => new Response('<html>404</html>', { status: 404 })],
    ['missing-model', async () => Response.json(ERR_404_JSON, { status: 404 })],
    ['key-rejected', async () => Response.json({ name: 'odoo.exceptions.AccessDenied', message: 'SENTINEL-KEY' }, { status: 401 })],
    ['access-denied', async () => Response.json({ name: 'odoo.exceptions.AccessError', message: 'm' }, { status: 403 })],
    ['validation', async () => Response.json({ name: 'odoo.exceptions.ValidationError', message: 'm' }, { status: 422 })],
    ['server-error', async () => new Response('Traceback SENTINEL-KEY', { status: 500 })],
  ])('maps %s', async (expected, res) => expect(await classOf(res)).toBe(expected));

  it('never carries the upstream body or the key', async () => {
    try { await odooCall(deps(async () => new Response('Traceback SENTINEL-KEY', { status: 500 })), 'm', 'x'); }
    catch (e) { expect(String((e as Error).message)).not.toMatch(/SENTINEL|Traceback/); }
  });
});
```

Run: `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/client.test.ts` → red.

### S1-T2 — `odoo/client.ts` (green)

```ts
/** The Odoo JSON-2 client. Odoo vocabulary stays inside adapterSeam/odoo/** (NFR-ODC-009). */
export type OdooErrorClass =
  | 'unreachable' | 'timeout' | 'tls' | 'not-odoo' | 'no-json2' | 'database-not-found'
  | 'key-rejected' | 'access-denied' | 'missing-model' | 'validation' | 'server-error' | 'destination-refused';

export class OdooError extends Error {
  constructor(readonly errorClass: OdooErrorClass, readonly status?: number) {
    super(`odoo request failed: ${errorClass}`); // never the upstream body (FR-ODC-002)
    this.name = 'OdooError';
  }
}

export const ODOO_CALL_TIMEOUT_MS = 15_000;
export interface OdooClientDeps { baseUrl: string; apiKey: string; database: string; fetchImpl: typeof fetch; deadlineMs?: number; pace?: () => Promise<void> }
export type OdooCall = <T>(model: string, method: string, body?: Record<string, unknown>) => Promise<T>;

function transportClass(err: unknown): OdooErrorClass {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  const msg = err instanceof Error ? err.message : '';
  if (/not permitted/i.test(msg)) return 'destination-refused';
  if (/certificate|tls|ssl/i.test(msg)) return 'tls';
  return 'unreachable';
}

async function httpClass(res: Response): Promise<OdooErrorClass> {
  if (res.status >= 300 && res.status < 400) return 'not-odoo';
  let body: { name?: unknown } | null = null;
  try { body = await res.json(); } catch { body = null; }
  const name = typeof body?.name === 'string' ? body.name : '';
  if (res.status === 401) return 'key-rejected';
  if (res.status === 403) return 'access-denied';
  if (res.status === 404) return body ? (/database/i.test(name) ? 'database-not-found' : 'missing-model') : 'no-json2';
  if (res.status === 422) return 'validation';
  return 'server-error';
}

export async function odooCall<T>(deps: OdooClientDeps, model: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  await deps.pace?.();
  let res: Response;
  try {
    res = await deps.fetchImpl(`${deps.baseUrl.replace(/\/$/, '')}/json/2/${model}/${method}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `bearer ${deps.apiKey}`, 'X-Odoo-Database': deps.database, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.deadlineMs ?? ODOO_CALL_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OdooError(transportClass(err));
  }
  if (!res.ok || res.status >= 300) throw new OdooError(await httpClass(res), res.status);
  try { return (await res.json()) as T; } catch { throw new OdooError('not-odoo', res.status); }
}

export const bindCall = (deps: OdooClientDeps): OdooCall => (model, method, body) => odooCall(deps, model, method, body);
```

The `database-not-found` discriminator and the 404 body/no-body split are provisional until S0-T1; edit those two lines to the
recorded shapes and re-run. Run S1-T1 → green.

### S1-T3 — Fake Odoo for tests

`pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts` (new, test-only helper, imported by tests and the harness): an in-memory
store per model (`Map<number, Record<string, unknown>>`) and a `fetch` implementation that answers
`POST /json/2/<model>/<method>` for `search_read` (domain subset: `=`, `in`, `>`, `>=`, `|`, `&`, `ilike`; `order`, `limit`,
`offset`, `context.active_test`), `search`, `search_count`, `create` (`vals_list` → ids, stamps `write_date`), `write`
(`ids`, `vals`, bumps `write_date`), `unlink`, `fields_get` (keys of a per-model field list), and answers 401 for a wrong key.
Methods: `seed(model, rows)`, `rows(model)`, `failNext(kind: 'transport' | 'lost-response')` (`lost-response` applies the
write then throws a `TypeError` so the caller sees no answer). Test `fakeOdoo.test.ts`: the keyset domain from §2.7 returns
rows in `(write_date, id)` order with no repeat across pages; a `lost-response` create leaves one row.

### S1-T4 — Normalisation (AC-ODC-032, SD-8) — failing test first

`odoo/normalise.test.ts` (new):

```ts
it('AC-ODC-032 a partner that is both vendor and client yields two normalised rows with distinct external ids', () => {
  const rows = normaliseParty({ id: 5, name: 'PT Sinar Baja', vat: '01.234.567.8-901.000', ref: false, is_company: true, parent_id: false, active: true, supplier_rank: 2, customer_rank: 1 });
  expect(rows.map((r) => [r.role, r.externalId])).toEqual([['vendor', 'Vendor:5'], ['client', 'Client:5']]);
});
it('a child contact is excluded (FR-ODC-053)', () => expect(normaliseParty({ ...base, is_company: false, parent_id: [9, 'PT X'] })).toEqual([]));
it('zero ranks → one row with no role (the matcher makes it a review row, FR-ODC-052)', () => expect(normaliseParty({ ...base, supplier_rank: 0, customer_rank: 0 })[0].role).toBeUndefined());
it('a project normalises from an analytic account of the chosen plan; code is the account code', () =>
  expect(normaliseProject({ id: 101, name: 'PRJ-26-0001 Jembatan', code: 'PRJ-26-0001', plan_id: [7, 'Projects'], active: true }))
    .toMatchObject({ kind: 'project', externalId: '101', code: 'PRJ-26-0001', active: true }));
it('an item normalises from product.product; code is default_code', () =>
  expect(normaliseItem({ id: 3, default_code: 'SMN-50', name: 'Semen 50 kg', active: true })).toMatchObject({ kind: 'item', externalId: '3', code: 'SMN-50' }));
```

### S1-T5 — `odoo/normalise.ts` (green)

```ts
import type { NormalisedMaster } from '../connect/types.ts';   // (ECA)
type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export const PARTY_FIELDS = ['name', 'vat', 'ref', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'write_date'];
export const PROJECT_FIELDS = ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'];
export const ITEM_FIELDS = ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'active', 'write_date'];

export function normaliseParty(r: Raw): NormalisedMaster[] {
  if (r.is_company !== true && r.parent_id !== false) return [];                      // child contact
  const base = { kind: 'party' as const, taxId: str(r.vat), code: str(r.ref), name: String(r.name), active: r.active !== false };
  const roles: Array<'vendor' | 'client'> = [];
  if (Number(r.supplier_rank) > 0) roles.push('vendor');
  if (Number(r.customer_rank) > 0) roles.push('client');
  if (roles.length === 0) return [{ ...base, externalId: String(r.id) }];
  return roles.map((role) => ({ ...base, role, externalId: `${role === 'vendor' ? 'Vendor' : 'Client'}:${r.id}` }));
}
export const normaliseProject = (r: Raw): NormalisedMaster => ({ kind: 'project', externalId: String(r.id), code: str(r.code), name: String(r.name), active: r.active !== false });
export const normaliseItem = (r: Raw): NormalisedMaster => ({ kind: 'item', externalId: String(r.id), code: str(r.default_code), name: String(r.name), active: r.active !== false });
export const normaliseAccount = (r: Raw): NormalisedMaster => ({ kind: 'account', externalId: String(r.id), code: str(r.code), name: String(r.name), active: r.active !== false });
```

A partner with no role: once the reviewer picks one, the external id is written as `Vendor:<id>` / `Client:<id>` (S6). A
`ref` that PMO wrote (`pmo:<uuid>`) is kept as `code`, so a retried send matches its own record by code. Run
`npx vitest run src/lib/adapterSeam/odoo/normalise.test.ts`.

### S1-T6 — `ConnectAdapter` for Odoo — failing test first

`odoo/connectAdapter.test.ts` (new), over `fakeOdoo`:
- `listMasters('party', null)` pages (`limit` 200, keyset on `id`) and returns normalised rows plus `nextCursor` (`'<last id>'`), `null` at the end; `active_test:false` is sent.
- `listMasters('project', …)` lists only analytic accounts whose `plan_id` is the configured plan and whose `company_id` is the company or unset.
- `countDomain('party')` uses `search_count` with the same domain as `listMasters` (S0-T16).
- `sendMaster('party', {id:'c-1', name:'PT Baru', taxId:'02', role:'vendor'}, 'seed:party:c-1')` searches `[['ref','=','pmo:c-1']]` first; none → `create {vals_list:[{name, vat, ref:'pmo:c-1', is_company:true, supplier_rank:1}]}` → `{externalId:'Vendor:<id>'}`; a hit → no create; two hits → `AdapterError('commit-rejected','ambiguous')`.
- `sendMaster('project', {id:'p-1', number:'PRJ-26-0001', name:'Jembatan'}, 'seed:project:p-1')` searches `[['code','=','PRJ-26-0001'],['plan_id','=',plan],['company_id','in',[company,false]]]` before `create`.
- `sendMaster('item', {id:'i-1', code:'SMN-50', name:'Semen 50 kg', unit:'sak'}, …)` searches `default_code` first; create carries `uom_id` from the unit map and `purchase_ok:true`; an unmapped unit → `AdapterError('commit-rejected','unit-unmapped')` before any call.
- Lost response (`fakeOdoo.failNext('lost-response')`) then retry with the same key → one record (the lookup finds it).
- Transport failure → `AdapterError('external-unreachable', …)`; Odoo 422 → `AdapterError('commit-rejected', 'validation')` (fixed text, never Odoo's).

### S1-T7 — `odoo/connectAdapter.ts` (green)

```ts
import { AdapterError } from '../contract.ts';
import type { ConnectAdapter, MasterKind, NormalisedMaster } from '../connect/types.ts';   // (ECA)
import { OdooError, type OdooCall } from './client.ts';
import { normaliseAccount, normaliseItem, normaliseParty, normaliseProject, ITEM_FIELDS, PARTY_FIELDS, PROJECT_FIELDS } from './normalise.ts';

export const ODOO_TIER = 'odoo';
export const LIST_PAGE = 200;
export interface OdooConnectCtx { companyId: number; analyticPlanId: number | null; unitMap: Record<string, string> }

const TRANSIENT = new Set(['unreachable', 'timeout', 'tls', 'server-error', 'destination-refused']);
export function toAdapterError(err: unknown): never {
  if (err instanceof AdapterError) throw err;
  if (err instanceof OdooError) throw new AdapterError(TRANSIENT.has(err.errorClass) ? 'external-unreachable' : 'commit-rejected', err.errorClass);
  throw err;
}

const SPECS: Record<'party' | 'project' | 'item' | 'account', { model: string; fields: string[]; domain: (c: OdooConnectCtx) => unknown[]; norm: (r: Record<string, unknown>) => NormalisedMaster[] }> = {
  party: { model: 'res.partner', fields: PARTY_FIELDS, domain: () => [['parent_id', '=', false]], norm: normaliseParty },
  project: { model: 'account.analytic.account', fields: PROJECT_FIELDS, domain: (c) => [['plan_id', '=', c.analyticPlanId], ['company_id', 'in', [c.companyId, false]]], norm: (r) => [normaliseProject(r)] },
  item: { model: 'product.product', fields: ITEM_FIELDS, domain: (c) => [['company_id', 'in', [c.companyId, false]]], norm: (r) => [normaliseItem(r)] },
  account: { model: 'account.account', fields: ['code', 'name', 'account_type', 'active', 'write_date'], domain: () => [], norm: (r) => [normaliseAccount(r)] },
};

export function createOdooConnectAdapter(call: OdooCall, ctx: OdooConnectCtx): ConnectAdapter {
  const spec = (kind: MasterKind) => { const s = SPECS[kind as keyof typeof SPECS]; if (!s) throw new AdapterError('commit-rejected', `kind ${kind} unavailable`); return s; };
  const one = async (model: string, domain: unknown[]) => {
    const hits = await call<{ id: number }[]>(model, 'search_read', { domain, fields: ['id'], limit: 2, context: { active_test: false } });
    if (hits.length > 1) throw new AdapterError('commit-rejected', 'ambiguous');
    return hits[0]?.id ?? null;
  };
  return {
    tier: ODOO_TIER,
    async listMasters(kind, cursor) {
      const s = spec(kind);
      try {
        const rows = await call<Record<string, unknown>[]>(s.model, 'search_read', {
          domain: [...s.domain(ctx), ['id', '>', Number(cursor ?? 0)]], fields: ['id', ...s.fields], order: 'id asc', limit: LIST_PAGE, context: { active_test: false } });
        return { rows: rows.flatMap(s.norm), nextCursor: rows.length < LIST_PAGE ? null : String(rows.at(-1)!.id) };
      } catch (err) { toAdapterError(err); }
    },
    async countDomain(domain) {
      const s = spec(domain as MasterKind);
      try { return await call<number>(s.model, 'search_count', { domain: s.domain(ctx), context: { active_test: false } }); } catch (err) { toAdapterError(err); }
    },
    async sendMaster(kind, record, _key) {
      try {
        if (kind === 'party') {
          const role = record.role === 'client' ? 'Client' : 'Vendor';
          const anchor = `pmo:${record.id}`;
          const found = await one('res.partner', [['ref', '=', anchor]]);
          if (found) return { externalId: `${role}:${found}` };
          const [id] = await call<number[]>('res.partner', 'create', { vals_list: [{ name: record.name, vat: record.taxId ?? false, ref: anchor, is_company: true, [role === 'Vendor' ? 'supplier_rank' : 'customer_rank']: 1 }] });
          return { externalId: `${role}:${id}` };
        }
        if (kind === 'project') {
          const found = await one('account.analytic.account', [['code', '=', record.code], ...SPECS.project.domain(ctx)]);
          if (found) return { externalId: String(found) };
          const [id] = await call<number[]>('account.analytic.account', 'create', { vals_list: [{ name: `${record.code} ${record.name}`, code: record.code, plan_id: ctx.analyticPlanId, company_id: ctx.companyId }] });
          return { externalId: String(id) };
        }
        if (kind === 'item') {
          const uom = record.unit ? ctx.unitMap[String(record.unit)] : undefined;
          if (record.unit && !uom) throw new AdapterError('commit-rejected', 'unit-unmapped');
          const found = await one('product.product', [['default_code', '=', record.code]]);
          if (found) return { externalId: String(found) };
          const [id] = await call<number[]>('product.product', 'create', { vals_list: [{ default_code: record.code, name: record.name, purchase_ok: true, ...(uom ? { uom_id: Number(uom) } : {}) }] });
          return { externalId: String(id) };
        }
        throw new AdapterError('commit-rejected', `send ${kind} unavailable`);
      } catch (err) { toAdapterError(err); }
    },
  };
}
```

The `PmoMaster` field names (`id`, `name`, `taxId`, `role`, `code`, `unit`) follow ECA-2's `connect/types.ts`; the builder
renames to whatever ECA-2 shipped. The send **key** is used by the outbox caller (S8), not here. The project send is the
spec's FR-ODC-072 create (SD-13). Run `npx vitest run src/lib/adapterSeam/odoo/connectAdapter.test.ts`.

### S1-T8 — `Adapter` (companies) — failing test first, then code

`odoo/adapter.test.ts` (new): `capabilityMap` is `{companies}`; `commit({domain:'companies', operation:'create', record:{id:'c-1', name, type:'Vendor', erp_tax_id}})`
goes through the same lookup-then-create as `sendMaster('party')` and returns `{externalRecordId:'Vendor:<id>', canonical}` with
`canonical.id === 'c-1'` and canonical keys ⊆ the `companies` columns (`name, type, erp_party_type, erp_tax_id, erp_modified`);
`update` → `write {ids:[<id from 'Vendor:<id>'>], vals:{name, vat}}`; `getByExternalId('companies','Vendor:5')` → the PMO-shaped
partner or `null` when absent; `listChangesSinceWatermark('companies', cursor)` returns partners with `write_date` keyset after the
cursor (shared helper with S4's `keysetDomain`, imported from `odoo/sweep.ts` once S4 lands — S1 inlines the four-line domain
and S4 moves it); any other domain → `AdapterError('commit-rejected')`.

```ts
export function createOdooAdapter(call: OdooCall, ctx: OdooConnectCtx): Adapter {
  const connect = createOdooConnectAdapter(call, ctx);
  const partnerId = (externalId: string) => Number(externalId.split(':')[1]);
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set(['companies']),
    async commit(cmd) {
      if (cmd.domain !== 'companies') throw new AdapterError('commit-rejected', 'unsupported domain');
      const r = cmd.record as { id: string; name: string; type: 'Vendor' | 'Client'; erp_tax_id?: string | null; externalRecordId?: string };
      if (cmd.operation === 'create') {
        const { externalId } = await connect.sendMaster('party', { id: r.id, name: r.name, taxId: r.erp_tax_id ?? null, role: r.type === 'Client' ? 'client' : 'vendor' }, `odoo:companies:${r.id}`);
        return { externalRecordId: externalId, canonical: { id: r.id, name: r.name, type: r.type, erp_party_type: r.type, erp_tax_id: r.erp_tax_id ?? null } };
      }
      if (cmd.operation === 'update' && r.externalRecordId) {
        try { await call('res.partner', 'write', { ids: [partnerId(r.externalRecordId)], vals: { name: r.name, vat: r.erp_tax_id ?? false } }); } catch (err) { toAdapterError(err); }
        return { externalRecordId: r.externalRecordId, canonical: { id: r.id, name: r.name, type: r.type, erp_tax_id: r.erp_tax_id ?? null } };
      }
      throw new AdapterError('commit-rejected', `unsupported operation ${cmd.operation}`);
    },
    async getByExternalId(domain, externalRecordId) {
      if (domain !== 'companies') throw new AdapterError('commit-rejected', 'unsupported domain');
      try {
        const [row] = await call<Record<string, unknown>[]>('res.partner', 'search_read', { domain: [['id', '=', partnerId(externalRecordId)]], fields: ['name', 'vat', 'write_date'], limit: 1, context: { active_test: false } });
        return row ? toPmoCompany(externalRecordId, row) : null;
      } catch (err) { toAdapterError(err); }
    },
    async listChangesSinceWatermark(domain, cursor) {
      if (domain !== 'companies') throw new AdapterError('commit-rejected', 'unsupported domain');
      const k = cursor ? (JSON.parse(cursor) as { w: string; id: number }) : null;
      try {
        const rows = await call<Record<string, unknown>[]>('res.partner', 'search_read', {
          domain: [['parent_id', '=', false], ...(k ? ['|', ['write_date', '>', k.w], '&', ['write_date', '=', k.w], ['id', '>', k.id]] : [])],
          fields: ['name', 'vat', 'supplier_rank', 'customer_rank', 'is_company', 'parent_id', 'ref', 'active', 'write_date'], order: 'write_date asc, id asc', limit: LIST_PAGE, context: { active_test: false } });
        const last = rows.at(-1) as { id: number; write_date: string } | undefined;
        return {
          changes: rows.flatMap((r) => normaliseParty(r).filter((n) => n.role).map((n) => toPmoCompany(n.externalId, r))),
          nextCursor: last && rows.length === LIST_PAGE ? JSON.stringify({ w: last.write_date, id: last.id }) : null,
        };
      } catch (err) { toAdapterError(err); }
    },
  };
}

// PMO companies shape only (NFR-EAS-CONTRACT-001): the role comes from the external id prefix.
const toPmoCompany = (externalId: string, r: Record<string, unknown>): PmoRecord => {
  const type = externalId.startsWith('Client:') ? 'Client' : 'Vendor';
  return { id: externalId, name: String(r.name), type, erp_party_type: type, erp_tax_id: typeof r.vat === 'string' ? r.vat : null, erp_modified: String(r.write_date) };
};
```

### S1-T9 — Harness, declarations, contract test (AC-ODC-095)

`odoo/contract.harness.ts` (new) implements ECA's `ErpHarness` over `fakeOdoo`:

```ts
export function createOdooHarness(): ErpHarness {
  const fake = createFakeOdoo({ key: 'test-key' });
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'test-key', database: 'db1', fetchImpl: fake.fetch });
  const ctx = { companyId: 1, analyticPlanId: 7, unitMap: { sak: '11', m: '12' } };
  return {
    tier: ODOO_TIER,
    adapter: Object.assign(createOdooAdapter(call, ctx), createOdooConnectAdapter(call, ctx)),
    load: (state) => loadScenarioIntoFake(fake, state),   // ECA ScenarioState (PMO terms) → seeded res.partner / analytic accounts / products
    documents: (kind) => readBackInPmoTerms(fake, kind),
  };
}
```

`odoo/workflows.ts` (new) — the `TierWorkflows` declaration (ECA §6.4):

```ts
export const ODOO_WORKFLOWS: TierWorkflows = {
  census: { status: 'supported', version: 1 },
  'party.match': { status: 'supported', version: 1 }, 'party.bring-in': { status: 'supported', version: 1 }, 'party.send': { status: 'supported', version: 1 },
  'project.match': { status: 'supported', version: 1 }, 'project.send': { status: 'supported', version: 1 },
  'item.match': { status: 'supported', version: 1 }, 'item.send': { status: 'supported', version: 1 },
  'account.match': { status: 'supported', version: 1 },
  'employee.match': { status: 'pending', version: 1, issue: 1510 }, 'employee.send': { status: 'pending', version: 1, issue: 1510 },
  'purchase.push': { status: 'pending', version: 1, issue: 1505 }, 'bill.push': { status: 'pending', version: 1, issue: 1505 },
  'vendor-payment.push': { status: 'pending', version: 1, issue: 1505 }, 'purchase.link-existing': { status: 'pending', version: 1, issue: 1505 },
  'cutover.purchase': { status: 'pending', version: 1, issue: 1505 },
  'invoice.push': { status: 'pending', version: 1, issue: 1506 }, 'receipt.read': { status: 'pending', version: 1, issue: 1506 },
  'invoice.pair-existing': { status: 'pending', version: 1, issue: 1506 }, 'cutover.revenue': { status: 'pending', version: 1, issue: 1506 },
  'actuals.read': { status: 'pending', version: 1, issue: 1507 },
  'budget.push': { status: 'pending', version: 1, issue: 1507 }, 'budget.unowned-occupant': { status: 'pending', version: 1, issue: 1507 },
  'timesheet.push': { status: 'pending', version: 1, issue: 1510 }, 'cutover.timesheet': { status: 'pending', version: 1, issue: 1510 },
};
```

These are ECA §6.4's ids; if ECA-7 ships more (e.g. `stock.*`), typecheck names each missing key and the builder declares it
*pending* on its O-issue (#1508 for stock).

Versions equal ECA-7's current version per id (the builder reads them from `connect/workflows.ts`; the parity test fails otherwise).
`odoo/contract.test.ts` (new) is ECA's per-tier runner: `for (const [id, d] of Object.entries(ODOO_WORKFLOWS)) if (d.status === 'supported') SUITES[id](createOdooHarness())`.
Register `odoo` in ECA's tier list so `parity.test.ts` covers it. Run:
`cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts`.
A suite that fails for Odoo is fixed in the Odoo adapter, never by editing the shared suite (FR-ECA-051); a genuine Odoo
limitation becomes an *unavailable* declaration with the reason, reported to the Director.

### S1-T10 — Vocabulary guard (AC-ODC-083)

`odoo/vocabulary.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

const MODELS = ['res.partner', 'res.company', 'product.product', 'product.template', 'uom.uom', 'stock.warehouse', 'stock.location',
  'account.account', 'account.tax', 'account.analytic.account', 'account.analytic.plan', 'purchase.order', 'account.move'];
describe('AC-ODC-083 Odoo model names stay below the adapter contract', () => {
  it('appear in pmo-portal/src only under adapterSeam/odoo/', () => {
    let out = '';
    try { out = execSync(`git grep -n -F ${MODELS.map((m) => `-e '${m}'`).join(' ')} -- src`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { out = ''; }
    expect(out.split('\n').filter(Boolean).filter((l) => !l.startsWith('src/lib/adapterSeam/odoo/'))).toEqual([]);
  });
});
```

Mutation check: put `'res.partner'` in a file under `src/hooks/` locally → red; revert. Run
`npx vitest run src/lib/adapterSeam/odoo/vocabulary.test.ts`.

---

## S2 — Connect, custody, client resolver, activation, disconnect (Director-dispatched)

ACs: 001, 003–009. Bed claims: V1, V2, V3, V16, V17. Shared-table regression set (re-run, must stay green):
`supabase/tests/0259_connect_rotate_compensation.test.sql`, `0346_connect_attempt_secret_cleanup.test.sql`,
`external_admin_connect_rls.test.sql`, `supabase/functions/external-connect/connect.test.ts`,
`supabase/functions/external-disconnect/disconnect.test.ts`, `supabase/functions/external-set-company/set-company.test.ts`.

### S2-T1 — Connect validation — failing test first

`odoo/connect.test.ts` (new): `validateOdooConnection` refuses `http:` (unless `allowHttp`) and a non-URL with
`destination-refused` and **no fetch**; returns `{companies:[{id,name}], versionMajor}` from `fakeOdoo` + a mocked
`version_info`; rethrows `OdooError` for `no-json2` / `key-rejected`.

### S2-T2 — `odoo/connect.ts` (green)

```ts
import { odooCall, OdooError, type OdooClientDeps } from './client.ts';
export interface OdooCompany { id: number; name: string }
export interface ConnectInput { siteUrl: string; database: string; apiKey: string; fetchImpl: typeof fetch; allowHttp?: boolean }

export async function fetchOdooVersionMajor(deps: Pick<OdooClientDeps, 'baseUrl' | 'fetchImpl' | 'deadlineMs'>): Promise<number | null> {
  try {   // V17 (S0-T17)
    const res = await deps.fetchImpl(`${deps.baseUrl.replace(/\/$/, '')}/web/webclient/version_info`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }), signal: AbortSignal.timeout(deps.deadlineMs ?? 5_000) });
    const major = (await res.json())?.result?.server_version_info?.[0];
    return Number.isInteger(major) ? major : null;
  } catch { return null; }
}

export async function validateOdooConnection(input: ConnectInput): Promise<{ companies: OdooCompany[]; versionMajor: number | null }> {
  let url: URL;
  try { url = new URL(input.siteUrl); } catch { throw new OdooError('destination-refused'); }
  if (url.protocol !== 'https:' && !(input.allowHttp && url.protocol === 'http:')) throw new OdooError('destination-refused');
  const deps: OdooClientDeps = { baseUrl: url.origin, apiKey: input.apiKey, database: input.database, fetchImpl: input.fetchImpl, deadlineMs: 5_000 };
  const companies = await odooCall<OdooCompany[]>(deps, 'res.company', 'search_read', { domain: [], fields: ['id', 'name'], limit: 50 });
  return { companies: companies.map(({ id, name }) => ({ id, name })), versionMajor: await fetchOdooVersionMajor(deps) };
}
```

Run `npx vitest run src/lib/adapterSeam/odoo/connect.test.ts`.

### S2-T3 — pgTAP first for migration `NNNN-A` (AC-ODC-004, 005, 006 DB half, 007, 009)

`supabase/tests/odoo_connect_custody.test.sql` (new). Fixture: org A with Admin, Finance, Project Manager, Engineer; an
operator; org B with an Admin. Descriptions start with the AC id:

1. `AC-ODC-004` with an active `erpnext` binding for A, `finalize_odoo_connect(...)` throws `another ERP tier is active`; after
   `cleanup_external_connect_attempt`, no tier-`odoo` row for A remains.
2. `AC-ODC-004` finalize with the kill switch false → throws; after cleanup no `active` odoo row and no `vault.secrets` row with the staged name.
3. `AC-ODC-005` `activate_odoo_binding` before finalize → throws; after → a timestamp; again with the same company → the same
   timestamp; with another company → throws `company already chosen`; `assert_odoo_activated(A)` throws before, passes after.
4. `AC-ODC-006` reconnect (stage a second ref, finalize) → the first ref's `vault.secrets` row is gone only after finalize returns;
   watermarks and `external_project_bindings` rows for tier odoo unchanged; finalize with another database and `p_discard=false` →
   throws `confirm discard`; with `p_discard=true` and a `pending` tier-odoo outbox row → throws `documents already reference`.
5. `AC-ODC-007` `disconnect_external_integration(A,'odoo',admin)` twice → both return 1; status `disconnected`; no
   `external_domain_ownership` row for (A, odoo); `config->>'odoo_company_id'` kept.
6. `AC-ODC-009` as each role's JWT: `finalize_odoo_connect` not executable by `authenticated`; `select secret_ref from
   external_org_bindings` raises `42501`; `select status, config from external_org_bindings` succeeds.
7. `AC-ODC-009` finalize with a Finance actor → `42501`; with the operator → ok; with org B's Admin on org A → `42501`.

Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/odoo_connect_custody.test.sql'` → red.

### S2-T4 — `supabase/migrations/NNNN-A_odoo_connect_custody.sql` (green)

Rollback `supabase/migrations/rollback/NNNN-A_odoo_connect_custody_down.sql`: drop the four new functions, re-create
`disconnect_external_integration` from migration 0341, restore `grant select on public.external_org_bindings to authenticated, anon`.

```sql
-- 1. Commit point for an Odoo connect (FR-ODC-003/004/006/008): the ClickUp atomic pattern (0259) plus site + database.
create or replace function public.finalize_odoo_connect(
  p_org_id uuid, p_secret_ref text, p_site_url text, p_database text, p_key_expires_on date,
  p_discard boolean, p_kill_switch_enabled boolean, p_actor_id uuid
) returns text language plpgsql security definer set search_path = public as $$
declare v_row public.external_org_bindings%rowtype; v_prev jsonb; v_same boolean;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_actor_id is null or not (
       exists (select 1 from public.profiles where id = p_actor_id and org_id = p_org_id and role = 'Admin')
       or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not p_kill_switch_enabled then raise exception 'integration disabled by operator' using errcode = 'P0001'; end if;
  if exists (select 1 from public.external_org_bindings where org_id = p_org_id and external_tier = 'erpnext' and status = 'active') then
    raise exception 'another ERP tier is active' using errcode = 'P0001';
  end if;
  if coalesce(p_site_url, '') = '' or coalesce(btrim(p_database), '') = '' then raise exception 'site and database are required' using errcode = '22023'; end if;

  select * into v_row from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo' and secret_ref = p_secret_ref for update;
  if not found or v_row.status <> 'active' then raise exception 'binding is not active' using errcode = 'P0001'; end if;
  v_prev := v_row.config -> 'prev_binding';
  v_same := coalesce(v_row.site_url, '') in ('', p_site_url) and coalesce(v_row.config ->> 'database', p_database) = p_database;
  if not v_same then
    if not p_discard then raise exception 'different Odoo database; confirm discard' using errcode = 'P0001'; end if;
    if exists (select 1 from public.external_command_outbox where org_id = p_org_id and external_tier = 'odoo' and state <> 'failed') then
      raise exception 'Odoo documents already reference this connection' using errcode = 'P0001';
    end if;
    perform public.discard_odoo_mirror(p_org_id, p_actor_id);
  end if;

  update public.external_org_bindings
     set site_url = p_site_url,
         config = (coalesce(config, '{}'::jsonb) - 'prev_binding') || jsonb_build_object('database', p_database, 'key_expires_on', p_key_expires_on),
         activated_at = case when v_same then activated_at else null end,
         updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and secret_ref = p_secret_ref;
  if v_prev is not null and v_prev ->> 'status' = 'active' and v_prev ->> 'secret_ref' <> p_secret_ref then
    perform public.delete_vault_secret(v_prev ->> 'secret_ref');   -- old key revoked only after the new row commits
  end if;
  perform public.log_audit('integration.connect.finalize', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', 'odoo', 'actor', p_actor_id, 'rotated', v_prev is not null, 'discarded', not v_same));
  return 'active';
end $$;
revoke all on function public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid) from public, anon, authenticated;
grant execute on function public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid) to service_role;

-- Discard seam; S4's migration re-creates it to also clear the mirror table.
create or replace function public.discard_odoo_mirror(p_org_id uuid, p_actor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.external_sync_watermarks where org_id = p_org_id and external_tier = 'odoo';
  delete from public.external_project_bindings where org_id = p_org_id and external_tier = 'odoo';
  delete from public.external_refs where org_id = p_org_id and external_tier = 'odoo';
  update public.external_org_bindings
     set config = config - 'odoo_company_id' - 'odoo_company_name' - 'analytic_plan_id' - 'account_defaults' - 'unit_map' - 'default_warehouse_id' - 'capabilities'
   where org_id = p_org_id and external_tier = 'odoo';
  perform public.log_audit('integration.odoo.discard', p_org_id, p_actor_id, null, jsonb_build_object('tier', 'odoo'));
end $$;
revoke all on function public.discard_odoo_mirror(uuid,uuid) from public, anon, authenticated, service_role;

-- 2. Set-once activation (FR-ODC-005, PQ-8).
create or replace function public.activate_odoo_binding(
  p_org_id uuid, p_version_major int, p_company_id int, p_company_name text, p_config_patch jsonb, p_actor_id uuid
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_stamp timestamptz;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not (exists (select 1 from public.profiles where id = p_actor_id and org_id = p_org_id and role = 'Admin')
          or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_version_major is null or p_version_major < 20 then   -- FR-ODC-022 tested minimum; keep in step with odoo/discovery.ts ODOO_TESTED_MAJORS
    raise exception 'unsupported odoo major version %', coalesce(p_version_major::text, 'null') using errcode = 'P0001';
  end if;
  if p_company_id is null then raise exception 'company is required to activate' using errcode = '22023'; end if;
  select config into v_cfg from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and coalesce(site_url, '') <> '' for update;
  if not found then raise exception 'binding is not connectable' using errcode = 'P0001'; end if;
  if v_cfg ? 'odoo_company_id' and (v_cfg ->> 'odoo_company_id')::int <> p_company_id then
    raise exception 'company already chosen' using errcode = 'P0001';
  end if;
  update public.external_org_bindings
     set version_major = p_version_major,
         config = coalesce(config, '{}'::jsonb) || coalesce(p_config_patch, '{}'::jsonb)
                  || jsonb_build_object('odoo_company_id', p_company_id, 'odoo_company_name', p_company_name),
         activated_at = coalesce(activated_at, now()), updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo'
  returning activated_at into v_stamp;
  perform public.log_audit('integration.activate', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', 'odoo', 'actor', p_actor_id, 'company_id', p_company_id, 'version_major', p_version_major));
  return v_stamp;
end $$;
revoke all on function public.activate_odoo_binding(uuid,int,int,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.activate_odoo_binding(uuid,int,int,text,jsonb,uuid) to service_role;

create or replace function public.assert_odoo_activated(p_org_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and activated_at is not null) then
    raise exception 'Odoo connection is not activated' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_odoo_activated(uuid) from public, anon, authenticated;
grant execute on function public.assert_odoo_activated(uuid) to service_role;
```

Part 3 — re-create `disconnect_external_integration` **verbatim from migration 0341** plus one block after the ClickUp release
(the shipped `- 'company'` config strip leaves Odoo's `odoo_company_id`, so a reconnect to the same company resumes):

```sql
  if p_external_tier = 'odoo' then
    delete from public.external_domain_ownership where org_id = p_org_id and external_tier = 'odoo';
    perform public.log_audit('integration.domain_ownership.release', p_org_id, p_actor_id, null, jsonb_build_object('tier', 'odoo', 'actor', p_actor_id));
  end if;
```

Part 4 — column privileges (AC-ODC-009). List the columns at head (`\d public.external_org_bindings`) and grant all except
`secret_ref` and `webhook_secret_ref`:

```sql
revoke select on public.external_org_bindings from authenticated, anon;
grant select (org_id, external_tier, site_url, status, connected_by, connected_at, disconnected_at,
              config, activated_at, version_major, created_at, updated_at /* + every other non-secret column at head */)
  on public.external_org_bindings to authenticated;
```

Run S2-T3 → green; then the regression set.

### S2-T5 — The browser stops reading the reference column

Failing test `pmo-portal/src/lib/repositories/integrations.binding.test.ts` (new): the column string passed to `.select(...)` by
`integrations.getBinding` and `listBindings` has no `secret_ref`. Change `repositories/index.ts` (drop the column),
`repositories/types.ts` (drop `secret_ref` from `IntegrationBinding`; `export type ExternalTier = 'clickup' | 'erpnext' | 'odoo';`),
and give `erpSetupRequest` a tier argument (PQ-12):
`async function erpSetupRequest<T>(setupAction: string, input: Record<string, unknown> = {}, tier: 'erpnext' | 'odoo' = 'erpnext')`.
Fix every `npm run typecheck` error (a consumer that read `secret_ref` to mean "connected" uses `status === 'active'`).
Run `cd pmo-portal && npx vitest run src/lib/repositories/integrations.binding.test.ts && npm run typecheck`.

### S2-T6 — `odooClientForOrg` (AC-ODC-008) — failing Deno test first

`supabase/functions/_shared/odooClientForOrg.test.ts` (new; `_shared/testing/edgeTestKit.ts`): each case asserts the refusal and
**zero** fetches to the Odoo origin — kill switch `off` → `kill-switch`; no row → `not-found`; disconnected → `inactive`;
not activated with `requireActivated` → `inactive`; vault null → `credentials`; a two-part value (`a:b`) → `credentials`;
site `http://10.0.0.5` → `invalid-site`; no `odoo_company_id` with `requireCompany` → `company-not-set`. The binding read filters
`org_id` = the given org and `external_tier='odoo'`.
Run `cd supabase/functions/_shared && deno test odooClientForOrg.test.ts --allow-env --allow-net --allow-read` → red.

### S2-T7 — `_shared/odooClientForOrg.ts` (green)

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardedErpFetch, isPermittedErpSiteUrl } from './erpHostGuard.ts';
import { externalConnectEnabled } from './externalConnectEnabled.ts';
import type { OdooClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

export type OdooClientRefusal = 'not-found' | 'inactive' | 'invalid-site' | 'credentials' | 'company-not-set' | 'kill-switch';
export type OdooClientForOrgResult = { client: OdooClientDeps; config: Record<string, unknown>; companyId: number | null } | { refusal: OdooClientRefusal };

/** The ONLY place an Odoo key is resolved (NFR-ODC-001, FR-ODC-100). */
export async function odooClientForOrg(sc: SupabaseClient, orgId: string,
  options: { requireActivated?: boolean; requireCompany?: boolean } = {}): Promise<OdooClientForOrgResult> {
  if (!externalConnectEnabled()) return { refusal: 'kill-switch' };
  const { data: b, error } = await sc.from('external_org_bindings').select('site_url,secret_ref,status,activated_at,config')
    .eq('org_id', orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error || !b) return { refusal: 'not-found' };
  if (b.status !== 'active' || (options.requireActivated !== false && !b.activated_at)) return { refusal: 'inactive' };
  const config = (b.config ?? {}) as Record<string, unknown>;
  const companyId = Number.isInteger(config.odoo_company_id) ? (config.odoo_company_id as number) : null;
  if (options.requireCompany !== false && companyId === null) return { refusal: 'company-not-set' };
  if (!(await isPermittedErpSiteUrl(b.site_url))) return { refusal: 'invalid-site' };
  const { data: key, error: keyError } = await sc.rpc('read_vault_secret', { p_secret_ref: b.secret_ref });
  if (keyError || typeof key !== 'string' || key === '' || key.includes(':')) return { refusal: 'credentials' };
  return { client: { baseUrl: b.site_url, apiKey: key, database: String(config.database ?? ''), fetchImpl: guardedErpFetch(b.site_url) }, config, companyId };
}
```

Run S2-T6 → green.

### S2-T8 — `external-connect` Odoo branch — failing Deno tests (AC-ODC-003, wire classes)

`supabase/functions/external-connect/connect.odoo.test.ts` (new; add to `REQUIRED` with `handleConnectRequest`):
- `AC-ODC-003` key `SENTINEL-ODOO-KEY`; fail validation (Odoo 500 body with the sentinel), then `stage_vault_secret_for_org`, then
  `finalize_odoo_connect`. For each: the response body, every `console.*` call (spied), and every captured RPC argument except
  `stage_vault_secret_for_org.p_secret_value` lack the sentinel; on finalize failure `cleanup_external_connect_attempt` ran with the staged ref.
- Wire: `key-rejected` → 422 `{error:'key-rejected'}`; `no-json2` → 422; `timeout` → 502; `database-not-found` → 422.
- FR-ODC-008: an active `erpnext` row → 409 `another-erp-active` and no `stage_vault_secret_for_org` call.
- Success: `{ ok:true, binding:{status:'active'}, companies:[…], versionMajor }`, no `secret_ref`, no key.

### S2-T9 — `external-connect/odoo.ts` + three lines in `index.ts` (green)

In `index.ts`: widen `ConnectBody.tier` to `'clickup' | 'erpnext' | 'odoo'` and the credential type with `database`,
`keyExpiresOn`, `confirmDiscard`; widen the tier check; right after the kill-switch check:
`if (tier === 'odoo') return await connectOdoo(serviceClient, profile.org_id, userId, credential, killSwitchEnabled);`.
Also add to the ERPNext branch the same pre-check for an active `odoo` row (FR-ODC-008, both directions).

```ts
export async function connectOdoo(sc: SupabaseClient, orgId: string, userId: string, c: OdooCredential, killSwitch: boolean): Promise<Response> {
  const { siteUrl, database, apiKey } = c;
  if (!siteUrl || !database || !apiKey) return errorResponse('siteUrl, database and apiKey are required', 'BAD_REQUEST', 400);
  const { data: other } = await sc.from('external_org_bindings').select('external_tier').eq('org_id', orgId).eq('external_tier', 'erpnext').eq('status', 'active').maybeSingle();
  if (other) return errorResponse(COPY['another-erp-active'], 'another-erp-active', 409);
  if (!(await isPermittedErpSiteUrl(siteUrl))) return errorResponse(COPY['destination-refused'], 'destination-refused', 422);
  let validated;
  try {
    validated = await validateOdooConnection({ siteUrl, database, apiKey, fetchImpl: guardedErpFetch(siteUrl), allowHttp: isLocalBenchSite(siteUrl) });
  } catch (err) {
    const cls = err instanceof OdooError ? err.errorClass : 'unreachable';
    return errorResponse(COPY[cls], cls, ['unreachable', 'timeout', 'server-error'].includes(cls) ? 502 : 422);
  }
  const ref = stagedSecretName('odoo', orgId);   // same naming scheme as the shipped connect's staged secret (builder copies it)
  const { error: stageError } = await sc.rpc('stage_vault_secret_for_org', { p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: apiKey, p_secret_name: ref, p_actor_id: userId });
  if (stageError) return errorResponse(COPY['not-committed'], 'CONNECT_NOT_COMMITTED', 500);
  const { error: finalizeError } = await sc.rpc('finalize_odoo_connect', {
    p_org_id: orgId, p_secret_ref: ref, p_site_url: new URL(siteUrl).origin, p_database: database, p_key_expires_on: c.keyExpiresOn ?? null,
    p_discard: c.confirmDiscard === true, p_kill_switch_enabled: killSwitch, p_actor_id: userId });
  if (finalizeError) {
    await sc.rpc('cleanup_external_connect_attempt', { p_org_id: orgId, p_external_tier: 'odoo', p_secret_ref: ref, p_actor_id: userId });
    const code = /different Odoo database/.test(finalizeError.message) ? 'confirm-discard'
      : /documents already reference/.test(finalizeError.message) ? 'target-locked' : 'CONNECT_NOT_COMMITTED';
    return errorResponse(COPY[code] ?? COPY['not-committed'], code, code === 'CONNECT_NOT_COMMITTED' ? 500 : 409);
  }
  return json({ ok: true, binding: { status: 'active' }, companies: validated.companies, versionMajor: validated.versionMajor });
}
```

`COPY` is a fixed English `Record<string,string>` in this file (the browser localises by `error` code). Never interpolate an
RPC or upstream message into a response. Run
`cd supabase/functions/external-connect && deno test connect.odoo.test.ts connect.test.ts deadline.test.ts --allow-env --allow-net --allow-read`.

### S2-T10 — `external-disconnect` accepts `odoo` (AC-ODC-007 wire)

Failing case in `disconnect.test.ts`: tier `odoo` → `disconnect_external_integration` with `p_external_tier:'odoo'`, 200. Change the
body type and the tier check in `external-disconnect/index.ts`. Run
`cd supabase/functions/external-disconnect && deno test disconnect.test.ts --allow-env --allow-net --allow-read`.

### S2-T11 — Odoo router in `external-set-company`: list companies + activate — test first

`supabase/functions/external-set-company/odoo.test.ts` (new; `REQUIRED` entry `handleSetCompanyRequest`):
`{tier:'odoo', setupAction:'list-companies'}` → `{companies}` from `fakeOdoo` via the stored key (resolver with
`requireActivated:false, requireCompany:false`); `{tier:'odoo', companyId:1}` → `activate_odoo_binding` with the version from
`version_info` and the company name; a company the key cannot see → 404 `company-not-found`, no RPC; RPC `company already chosen`
→ 409 `company-locked`; an unknown Odoo verb → 400.

### S2-T12 — `external-set-company/odoo/router.ts` + `activate.ts` (green)

In `index.ts` widen `SetCompanyBody.tier` to `'erpnext' | 'odoo'` and insert **before** the shipped ERPNext role gate (step 4),
right after the body is parsed:
`if (body.tier === 'odoo') return await routeOdoo({ sc: serviceClient, orgId: profile.org_id, userId, role: profile.role, operator: !!isOperator, body });`
(the router runs `actor_authorization_state` itself and applies per-verb gates, because Odoo verbs allow Finance and PMs).

```ts
// external-set-company/odoo/router.ts
export interface OdooCtx { sc: SupabaseClient; orgId: string; userId: string; role: string; operator: boolean; body: Record<string, unknown> }
const GATES: Record<string, (c: OdooCtx) => boolean> = {
  'list-companies': (c) => c.role === 'Admin' || c.operator,
  activate: (c) => c.role === 'Admin' || c.operator,
};
const VERBS: Record<string, (c: OdooCtx) => Promise<Response>> = { 'list-companies': listCompanies, activate };
export async function routeOdoo(c: OdooCtx): Promise<Response> {
  const verb = String(c.body.setupAction ?? 'activate');
  const { data: state } = await c.sc.rpc('actor_authorization_state', { p_org_id: c.orgId, p_user_id: c.userId });
  if ((state as { active?: unknown } | null)?.active !== true) return errorResponse('Only an active member can do this', 'FORBIDDEN', 403);
  if (!VERBS[verb]) return errorResponse('Unknown action', 'BAD_REQUEST', 400);
  if (!GATES[verb](c)) return errorResponse('Not allowed for your role', 'FORBIDDEN', 403);
  return await VERBS[verb](c);
}
```

```ts
// external-set-company/odoo/activate.ts
export async function activate(c: OdooCtx): Promise<Response> {
  const r = await odooClientForOrg(c.sc, c.orgId, { requireActivated: false, requireCompany: false });
  if ('refusal' in r) return errorResponse('Odoo connection is not usable', r.refusal, 422);
  let companies: OdooCompany[];
  try { companies = await odooCall<OdooCompany[]>(r.client, 'res.company', 'search_read', { domain: [], fields: ['id', 'name'], limit: 50 }); }
  catch (err) { return errorResponse('Odoo did not answer', err instanceof OdooError ? err.errorClass : 'unreachable', 502); }
  const chosen = companies.find((x) => x.id === Number(c.body.companyId));
  if (!chosen) return errorResponse('That company is not available to this key', 'company-not-found', 404);
  const versionMajor = await fetchOdooVersionMajor(r.client);
  const { data: activatedAt, error } = await c.sc.rpc('activate_odoo_binding', {
    p_org_id: c.orgId, p_version_major: versionMajor, p_company_id: chosen.id, p_company_name: chosen.name, p_config_patch: {}, p_actor_id: c.userId });
  if (error) return errorResponse('Activation was refused', /already chosen/.test(error.message) ? 'company-locked' : 'activation-refused', 409);
  return json({ ok: true, companyId: chosen.id, versionMajor, activatedAt });
}
```

`listCompanies` is the first half of `activate`. S3 inserts discovery before the RPC. Run
`cd supabase/functions/external-set-company && deno test odoo.test.ts set-company.test.ts setup.test.ts --allow-env --allow-net --allow-read`.

### S2-T13 — Bed contract: connect (AC-ODC-001), reconnect (AC-ODC-006 wire)

`supabase/functions/external-connect/connect.odoo.bed.test.ts` (new, gated; `REQUIRED` entry): `handleConnectRequest` against the
real bed (`ERPNEXT_ALLOW_LOCAL_BENCH=1`, `SUPABASE_URL=http://127.0.0.1:54321`, `ERPNEXT_LOCAL_BENCH_ORIGINS=$ODOO_BED_URL`), Supabase
RPCs mocked by `supabaseRpc`:
- `AC-ODC-001`: 200; `stage_vault_secret_for_org.p_secret_value` = the bed key; `finalize_odoo_connect` args and the response carry
  no key; exactly one `/json/2/` request (a spy wrapping the real fetch).
- `AC-ODC-006`: a second connect with a freshly minted bed key (`res.users.apikeys/generate`, bed report §2) calls `stage` then
  `finalize`, in that order; another `database` without `confirmDiscard` → 409 `confirm-discard`.
Secondary U for AC-ODC-001 (private, loopback, link-local, metadata, `http`, redirecting, non-resolving hosts refused before any
request or write): `connect.odoo.test.ts`, one case each. Run per §2.9.

---

## S3 — Pacing, discovery, connection state, recheck (Director-dispatched)

ACs: 010–013. Bed claims: V4, V8, V13, V16.

### S3-T1 — Pacer (FR-ODC-046) — test then code

Test (append `odoo/client.test.ts`): with fake timers, `createPacer(5)` resolves the third call ≥ 400 ms after the first. Code:

```ts
export function createPacer(rps: number, now = () => Date.now(), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const gap = 1000 / rps; let next = 0;
  return async () => { const t = now(); const wait = Math.max(0, next - t); next = Math.max(t, next) + gap; if (wait) await sleep(wait); };
}
export const paceFor = (siteUrl: string) => (new URL(siteUrl).hostname.endsWith('.odoo.com') ? 1 : 5); // V11
```

`odooClientForOrg` adds `pace: createPacer(paceFor(b.site_url))` to the returned client.

### S3-T2 — Version policy (AC-ODC-012) — test first, then code

`odoo/discovery.test.ts` (new):

```ts
it.each([[null, false, { ok: false, reason: 'no-json2' }], [20, true, { ok: true, untested: false }], [21, true, { ok: true, untested: true }], [19, true, { ok: false, reason: 'below-tested' }]])(
  'AC-ODC-012 version %s json2=%s', (major, json2, expected) => expect(versionPolicy(major, json2)).toEqual(expected));
```

```ts
export const ODOO_TESTED_MAJORS: readonly number[] = [20]; // DD-ODC-8; keep in step with activate_odoo_binding
export type VersionVerdict = { ok: true; untested: boolean } | { ok: false; reason: 'no-json2' | 'below-tested' };
export function versionPolicy(major: number | null, hasJson2: boolean): VersionVerdict {
  if (!hasJson2) return { ok: false, reason: 'no-json2' };
  if (major === null || major < Math.min(...ODOO_TESTED_MAJORS)) return { ok: false, reason: 'below-tested' };
  return { ok: true, untested: !ODOO_TESTED_MAJORS.includes(major) };
}
```

### S3-T3 — Discovery (AC-ODC-011 owning U) — test first

Append to `discovery.test.ts`, over `fakeOdoo`: `missing` contains `'account.tax:type_tax_use'` when that field is absent,
`'stock.location'` when the model 404s, `'l10n_id:ppn'` when no tax with amount 11 or 12 exists, `[]` for the full fixture; the fake
saw no `ir.module.module` call; `later['purchase.order']` is a boolean.

### S3-T4 — `discoverCapabilities` (green)

```ts
export const O1_MODELS: Record<string, readonly string[]> = {   // FINAL only after S0-T3..T10; field names live here and in kinds.ts/normalise.ts
  'res.company': ['name', 'currency_id'],
  'res.partner': ['name', 'vat', 'ref', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'write_date'],
  'product.product': ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'active', 'write_date'],
  'uom.uom': ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'],
  'stock.warehouse': ['name', 'code', 'lot_stock_id', 'view_location_id', 'active', 'write_date'],
  'stock.location': ['complete_name', 'usage', 'location_id', 'warehouse_id', 'active', 'write_date'],
  'account.account': ['code', 'name', 'account_type', 'active', 'write_date'],
  'account.tax': ['name', 'amount', 'type_tax_use', 'active', 'write_date'],
  'account.analytic.plan': ['name', 'write_date'],
  'account.analytic.account': ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'],
};
export const LATER_MODELS = ['purchase.order', 'account.move', 'stock.picking', 'stock.move', 'account.analytic.line', 'fleet.vehicle', 'maintenance.equipment'] as const;

export interface ModelProbe { exists: boolean; read: boolean; create: boolean; write: boolean; fields_missing: string[] }
export interface CapabilitySnapshot { observed_at: string; version_major: number | null; untested_version: boolean; companies: { id: number; name: string }[]; models: Record<string, ModelProbe>; later: Record<string, boolean>; missing: string[] }

async function probeModel(call: OdooCall, model: string, fields: readonly string[]): Promise<ModelProbe> {
  try {
    const got = await call<Record<string, unknown>>(model, 'fields_get', { attributes: ['type'] });
    const access = (op: string) => call<boolean>(model, 'has_access', { operation: op }).catch(() => false); // method name per S0-T3
    return { exists: true, read: await access('read'), create: await access('create'), write: await access('write'), fields_missing: fields.filter((f) => !(f in got)) };
  } catch (err) {
    if (err instanceof OdooError && err.errorClass === 'missing-model') return { exists: false, read: false, create: false, write: false, fields_missing: [...fields] };
    throw err;   // transport/auth failures are connection-state input, not "missing"
  }
}

export async function discoverCapabilities(call: OdooCall, ctx: { versionMajor: number | null; now: Date }): Promise<CapabilitySnapshot> {
  const models: Record<string, ModelProbe> = {};
  for (const [model, fields] of Object.entries(O1_MODELS)) models[model] = await probeModel(call, model, fields);
  const later: Record<string, boolean> = {};
  for (const model of LATER_MODELS) later[model] = (await probeModel(call, model, [])).exists;
  const missing = Object.entries(models).flatMap(([m, p]) => (!p.exists ? [m] : !p.read ? [`${m}:read`] : p.fields_missing.map((f) => `${m}:${f}`)));
  if (models['account.tax']?.read) {
    const ppn = await call<number>('account.tax', 'search_count', { domain: [['amount', 'in', [11, 12]], ['type_tax_use', 'in', ['purchase', 'sale']]] });
    if (!ppn) missing.push('l10n_id:ppn');
  }
  const companies = await call<{ id: number; name: string }[]>('res.company', 'search_read', { domain: [], fields: ['id', 'name'] });
  const v = versionPolicy(ctx.versionMajor, true);
  return { observed_at: ctx.now.toISOString(), version_major: ctx.versionMajor, untested_version: v.ok && v.untested, companies, models, later, missing };
}
```

The capability snapshot records `create`/`write` for `res.partner`, `account.analytic.account` and `product.product`; when a kind's
send is declared *supported* but the key lacks `create`, `missing` gets `'<model>:create'` and the connection is *degraded* with the
reason (the sends would fail honestly anyway). Run `npx vitest run src/lib/adapterSeam/odoo/discovery.test.ts`.

### S3-T5 — State machine (AC-ODC-013) — test first, then code

`odoo/connectionState.test.ts` (new): table over sequences — two `unreachable` → previous state; third → `unreachable`; `ok` then
`key-rejected` → `credential-rejected` in one step; after two failures, `ok` → failures 0 `healthy`; `ok` with expiry in 10 days →
`credential-expiring`; in 20 days → `healthy`; `ok` with `missing` → `degraded`; `no-json2` → `credential-rejected`;
disconnected → `disconnected`. `displayedConnection` turns an 11-minute-old `healthy` into `unverified`.

```ts
export type ConnectionStateName = 'not-activated' | 'healthy' | 'degraded' | 'unreachable' | 'credential-rejected' | 'credential-expiring' | 'disconnected';
export interface ConnectionRecord { state: ConnectionStateName; failures: number; last_ok_at: string | null; last_checked_at: string | null; error_class: OdooErrorClass | null; missing: string[] }
export type ProbeOutcome = { ok: true; missing: string[] } | { ok: false; errorClass: OdooErrorClass };
export const UNREACHABLE_AFTER = 3;
export const EXPIRY_WARNING_DAYS = 14;
const TRANSIENT: ReadonlySet<OdooErrorClass> = new Set(['unreachable', 'timeout', 'tls', 'server-error', 'destination-refused']);
export const INITIAL_CONNECTION: ConnectionRecord = { state: 'not-activated', failures: 0, last_ok_at: null, last_checked_at: null, error_class: null, missing: [] };

export function nextConnection(prev: ConnectionRecord, o: ProbeOutcome, ctx: { now: Date; keyExpiresOn: string | null; activated: boolean; disconnected: boolean }): ConnectionRecord {
  const at = ctx.now.toISOString();
  if (ctx.disconnected) return { ...prev, state: 'disconnected', last_checked_at: at };
  if (!ctx.activated) return { ...prev, state: 'not-activated', last_checked_at: at };
  if (o.ok) {
    const expiring = ctx.keyExpiresOn !== null && Date.parse(ctx.keyExpiresOn) - ctx.now.getTime() <= EXPIRY_WARNING_DAYS * 86_400_000;
    return { state: o.missing.length ? 'degraded' : expiring ? 'credential-expiring' : 'healthy', failures: 0, last_ok_at: at, last_checked_at: at, error_class: null, missing: o.missing };
  }
  if (!TRANSIENT.has(o.errorClass)) return { ...prev, state: 'credential-rejected', failures: 0, last_checked_at: at, error_class: o.errorClass };
  const failures = prev.failures + 1;
  return { ...prev, failures, state: failures >= UNREACHABLE_AFTER ? 'unreachable' : prev.state, last_checked_at: at, error_class: o.errorClass };
}

/** FR-ODC-034 / PQ-7: never show a stale "healthy". Browser-only. */
export function displayedConnection(rec: ConnectionRecord | null, now: Date, sweepIntervalMs = 300_000): ConnectionStateName | 'unverified' {
  if (!rec) return 'not-activated';
  const stale = !rec.last_checked_at || now.getTime() - Date.parse(rec.last_checked_at) > 2 * sweepIntervalMs;
  return stale && ['healthy', 'credential-expiring', 'degraded'].includes(rec.state) ? 'unverified' : rec.state;
}
```

### S3-T6 — `recordOdooProbe` + discovery at activation (FR-ODC-020/021/023)

Append to `_shared/odooClientForOrg.ts`:

```ts
export async function recordOdooProbe(sc: SupabaseClient, orgId: string, prevConfig: Record<string, unknown>, outcome: ProbeOutcome, snapshot?: CapabilitySnapshot): Promise<ConnectionRecord> {
  const prev = (prevConfig.connection as ConnectionRecord | undefined) ?? INITIAL_CONNECTION;
  const next = nextConnection(prev, outcome, { now: new Date(), keyExpiresOn: (prevConfig.key_expires_on as string | null) ?? null, activated: true, disconnected: false });
  await sc.rpc('merge_external_org_binding_config', { p_org_id: orgId, p_external_tier: 'odoo', p_patch: snapshot ? { connection: next, capabilities: snapshot } : { connection: next } });
  const prevMissing = ((prevConfig.capabilities as CapabilitySnapshot | undefined)?.missing ?? []).join(',');
  if (snapshot && prevMissing !== snapshot.missing.join(',')) await audit(sc, orgId, 'integration.odoo.capability_change', { missing: snapshot.missing });
  if (next.state === 'credential-rejected' && prev.state !== 'credential-rejected') await audit(sc, orgId, 'integration.odoo.credential_rejected', { error_class: next.error_class });
  return next;
}
```

`audit` wraps the shipped `log_audit` RPC (builder matches its argument names at head; see `external-disconnect/index.ts`).
In `external-set-company/odoo/activate.ts`, between the company check and the RPC: run `discoverCapabilities`; refuse 422 with
`versionPolicy`'s reason; pass `p_config_patch: { capabilities, connection }`. Tests: append to `_shared/odooClientForOrg.test.ts`
(a `missing` change writes one audit row; equal lists none; the patch has no key) and `external-set-company/odoo.test.ts`
(the patch carries `capabilities.missing` and `connection.state`; `below-tested` → 422, no RPC).

### S3-T7 — `recheck` verb (FR-ODC-020, FR-ODC-031 user probe)

Test (append `external-set-company/odoo.test.ts`): Engineer → 403; Admin with a healthy fake → `merge_external_org_binding_config`
with `connection.state='healthy'`; Odoo 401 → `connection.state='credential-rejected'`, response 200 `{state}` (the probe ran).
Code `external-set-company/odoo/recheck.ts`: resolve; `fetchOdooVersionMajor` + `discoverCapabilities`; `recordOdooProbe` with ok or
the error class; gate Admin/Operator in `GATES`.

### S3-T8 — Bed contract: discovery (AC-ODC-010, AC-ODC-011 negative half)

`supabase/functions/external-set-company/discovery.bed.test.ts` (new, gated; `REQUIRED` entry): `discoverCapabilities` against the
bed with the minimal user's key from S0-T13 (`ODOO_BED_MIN_KEY`; falls back to `ODOO_BED_KEY` with a printed note):
`AC-ODC-010` every O1 model `exists && read`, `version_major === 20`, `companies.length >= 1`, `later['purchase.order'] === true`, no
`ir.module.module` request (fetch spy); `AC-ODC-011` `missing` equals `[]`. Run per §2.9.

---

## S4 — Directory mirror, sweep, watermark, census (Orca worker; security-auditor mandatory; DB lock)

ACs: 020–026. Bed claims: V5–V10, V14. Shared-table regression set: `supabase/tests/external_sync_watermarks_rls.test.sql`,
`supabase/functions/erpnext-sweep/statementSingleFlight.test.ts`, `supabase/functions/erpnext-sweep/sweepWedge.test.ts`
(`erp_sweep_lock` reuse).

### S4-T1 — Mirror RLS pgTAP first (AC-ODC-020)

`supabase/tests/odoo_master_records_rls.test.sql` (new). Orgs A and B, `product` and `account` rows in each (inserted as `postgres`):
- `AC-ODC-020` A's Engineer: own `product` rows only, B's invisible, `account` → 0 rows; A's Finance sees A's `account` rows.
- A's Admin `insert`, `update`, `delete` each `throws_ok(…,'42501')`.
- `apply_odoo_master_page` as `authenticated` → `42501`; as `service_role` for A with a row whose `external_id` equals one of B's →
  B's row unchanged.
- the `stamp_org_id` trigger behaviour for a service insert without `org_id` (builder asserts what it does at head).
Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/odoo_master_records_rls.test.sql'` → red.

### S4-T2 — `NNNN-B_odoo_master_records.sql` part 1: table, RLS, indexes

Table and policy from §2.5, plus:

```sql
create trigger external_master_records_stamp_org_id before insert or update on public.external_master_records
  for each row execute function public.stamp_org_id();
create index external_master_records_kind_idx on public.external_master_records (org_id, external_tier, kind, active);
create index external_master_records_code_idx on public.external_master_records (org_id, kind, code);
create index external_master_records_name_trgm on public.external_master_records using gin (name gin_trgm_ops);  -- create extension if not exists pg_trgm first, if absent at head
alter table public.external_master_records enable row level security;
alter table public.external_master_records force row level security;
revoke all on public.external_master_records from anon;
revoke insert, update, delete on public.external_master_records from authenticated;
grant select on public.external_master_records to authenticated;
grant all on public.external_master_records to service_role;
```

Rollback `rollback/NNNN-B_odoo_master_records_down.sql`: drop the RPCs below, `select cron.unschedule('odoo-sweep-tick')`, drop
`odoo_sweep_tick()`, drop the table, re-create `discard_odoo_mirror` from NNNN-A.

### S4-T3 — Part 2: page apply (AC-ODC-021 DB half) — pgTAP first

Append: page P (two rows) + cursor C1 → two rows and watermark `master:product` = C1; re-apply P → identical rows (`results_eq` on
`(external_id, name, source_write_date)`), watermark C1; r1 again with an older `source_write_date` and a new name → name unchanged; a
page containing a row with `name` null → the call errors and the watermark is still C1.

```sql
create or replace function public.apply_odoo_master_page(p_org_id uuid, p_kind text, p_rows jsonb, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  insert into public.external_master_records as m
    (org_id, external_tier, kind, external_id, code, name, parent_external_id, active, attrs, source_write_date, as_of, tombstoned_at)
  select p_org_id, 'odoo', p_kind, r->>'external_id', r->>'code', r->>'name', r->>'parent_external_id',
         coalesce((r->>'active')::boolean, true), coalesce(r->'attrs', '{}'::jsonb), r->>'source_write_date', now(), null
    from jsonb_array_elements(p_rows) r
  on conflict (org_id, external_tier, kind, external_id) do update set
    code = excluded.code, name = excluded.name, parent_external_id = excluded.parent_external_id, active = excluded.active,
    attrs = excluded.attrs, source_write_date = excluded.source_write_date, as_of = now(), tombstoned_at = null
  where m.source_write_date <= excluded.source_write_date;   -- never older over newer (FR-ODC-042)
  get diagnostics v_n = row_count;
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'master:' || p_kind, p_cursor, now())
  on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  return v_n;
end $$;
revoke all on function public.apply_odoo_master_page(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_odoo_master_page(uuid,text,jsonb,text) to service_role;
```

### S4-T4 — Part 3: census, reset, discard (AC-ODC-023 DB half, AC-ODC-026 P half) — pgTAP first

Append: `mark_odoo_census_seen(A,'product',run,array['1','2'])` + `finish_odoo_census(A,'product',run,cursor)` → row 3 tombstoned and
still present, rows 1–2 not; a later page containing id 3 clears `tombstoned_at`; an archived row seen by the census is not
tombstoned. `AC-ODC-026` `reset_odoo_sync_kind(A,'product',finance)` → `42501`; with the Admin → the `master:product` watermark row is
gone, mirror rows kept, one `audit_log` row `integration.odoo.reset`.

```sql
create or replace function public.mark_odoo_census_seen(p_org_id uuid, p_kind text, p_run timestamptz, p_ids text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  update public.external_master_records set census_seen_at = p_run
   where org_id = p_org_id and external_tier = 'odoo' and kind = p_kind and external_id = any (p_ids);
end $$;

create or replace function public.finish_odoo_census(p_org_id uuid, p_kind text, p_run timestamptz, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  update public.external_master_records set tombstoned_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and kind = p_kind and tombstoned_at is null and (census_seen_at is null or census_seen_at < p_run);
  get diagnostics v_n = row_count;
  update public.external_sync_watermarks set watermark_cursor = p_cursor, updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and domain = 'master:' || p_kind;
  return v_n;
end $$;

create or replace function public.reset_odoo_sync_kind(p_org_id uuid, p_kind text, p_actor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not (exists (select 1 from public.profiles where id = p_actor_id and org_id = p_org_id and role = 'Admin')
          or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'Admin or Operator required' using errcode = '42501';
  end if;
  delete from public.external_sync_watermarks where org_id = p_org_id and external_tier = 'odoo' and domain = 'master:' || p_kind;
  perform public.log_audit('integration.odoo.reset', p_org_id, p_actor_id, null, jsonb_build_object('tier', 'odoo', 'kind', p_kind));
end $$;
-- discard_odoo_mirror: re-create NNNN-A's body plus `delete from public.external_master_records where org_id = p_org_id and external_tier = 'odoo';`
```

Each: `revoke … from public, anon, authenticated; grant execute … to service_role`. Run S4-T1 → green.

### S4-T5 — Part 4: cron tick (FR-ODC-047)

Copy migration 0102's `erpnext_sweep_tick()` into `public.odoo_sweep_tick()` reading its own URL and sweep-secret Vault entries (named as 0102's, with the Odoo prefix; created per environment, never committed);
`revoke all … from public`; `select cron.schedule('odoo-sweep-tick', '*/5 * * * *', 'select public.odoo_sweep_tick()');`.
pgTAP append: `select is((select count(*)::int from cron.job where jobname = 'odoo-sweep-tick'), 1, 'odoo sweep tick registered');`
and `select lives_ok('select public.odoo_sweep_tick()', 'tick is a no-op without Vault secrets');`.

### S4-T6 — Kind parsers (AC-ODC-024) — test first

`odoo/kinds.test.ts` (new): each kind's fixture row parses to the expected `MasterRow`; missing `id`, non-string `name`, malformed
`write_date` (`'2026/10/31'`), or a many2one that is neither `false` nor `[number, string]` → `null`; `parsePage` returns
`{rows, skipped}` with no partial row.

### S4-T7 — `odoo/kinds.ts` (green)

```ts
export type MasterKind = 'company' | 'partner' | 'product' | 'uom' | 'warehouse' | 'location' | 'account' | 'tax' | 'analytic_plan' | 'analytic_account';
export interface MasterRow { external_id: string; code: string | null; name: string; parent_external_id: string | null; active: boolean; attrs: Record<string, unknown>; source_write_date: string }
type Raw = Record<string, unknown>;
const WRITE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const m2o = (v: unknown): string | null | undefined => (v === false || v == null ? null : Array.isArray(v) && typeof v[0] === 'number' ? String(v[0]) : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
function base(r: Raw, name: unknown, code: unknown, parent: unknown): MasterRow | null {
  const p = m2o(parent);
  if (typeof r.id !== 'number' || typeof name !== 'string' || !name || typeof r.write_date !== 'string' || !WRITE_DATE.test(r.write_date) || p === undefined) return null;
  return { external_id: String(r.id), code: str(code), name, parent_external_id: p, active: r.active !== false, attrs: {}, source_write_date: r.write_date };
}
const withAttrs = (row: MasterRow | null, attrs: Record<string, unknown>) => (row ? { ...row, attrs } : null);

export interface KindSpec { model: string; fields: string[]; companyScoped: boolean; parse: (r: Raw) => MasterRow | null }
export const KIND_SPECS: Record<MasterKind, KindSpec> = {
  company: { model: 'res.company', fields: ['name', 'currency_id', 'write_date'], companyScoped: false, parse: (r) => withAttrs(base(r, r.name, null, false), { currency: m2o(r.currency_id) }) },
  partner: { model: 'res.partner', fields: ['name', 'vat', 'ref', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'write_date'], companyScoped: false,
    parse: (r) => withAttrs(base(r, r.name, r.ref, r.parent_id), { vat: str(r.vat), is_company: r.is_company === true, supplier_rank: Number(r.supplier_rank ?? 0), customer_rank: Number(r.customer_rank ?? 0) }) },
  product: { model: 'product.product', fields: ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'type', 'active', 'write_date'], companyScoped: true,
    parse: (r) => withAttrs(base(r, r.name, r.default_code, false), { uom_id: m2o(r.uom_id), purchasable: r.purchase_ok === true, sellable: r.sale_ok === true, type: str(r.type) }) },
  uom: { model: 'uom.uom', fields: ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'], companyScoped: false,
    parse: (r) => (typeof r.relative_factor !== 'number' ? null : withAttrs(base(r, r.name, null, r.relative_uom_id), { relative_factor: r.relative_factor })) },
  warehouse: { model: 'stock.warehouse', fields: ['name', 'code', 'lot_stock_id', 'view_location_id', 'active', 'write_date'], companyScoped: true,
    parse: (r) => withAttrs(base(r, r.name, r.code, false), { stock_location_id: m2o(r.lot_stock_id), view_location_id: m2o(r.view_location_id) }) },
  location: { model: 'stock.location', fields: ['complete_name', 'usage', 'location_id', 'warehouse_id', 'active', 'write_date'], companyScoped: true,
    parse: (r) => withAttrs(base(r, r.complete_name, null, r.location_id), { usage: str(r.usage), warehouse_id: m2o(r.warehouse_id) }) },
  account: { model: 'account.account', fields: ['code', 'name', 'account_type', 'active', 'write_date'], companyScoped: true,
    parse: (r) => withAttrs(base(r, r.name, r.code, false), { account_type: str(r.account_type) }) },
  tax: { model: 'account.tax', fields: ['name', 'amount', 'type_tax_use', 'active', 'write_date'], companyScoped: true,
    parse: (r) => (typeof r.amount !== 'number' ? null : withAttrs(base(r, r.name, null, false), { amount: r.amount, use: str(r.type_tax_use) })) },
  analytic_plan: { model: 'account.analytic.plan', fields: ['name', 'write_date'], companyScoped: false, parse: (r) => base(r, r.name, null, false) },
  analytic_account: { model: 'account.analytic.account', fields: ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'], companyScoped: true,
    parse: (r) => withAttrs(base(r, r.name, r.code, r.plan_id), { company_id: m2o(r.company_id) }) },
};
export function parsePage(spec: KindSpec, rows: unknown[]): { rows: MasterRow[]; skipped: number } {
  const out: MasterRow[] = []; let skipped = 0;
  for (const r of rows) { const p = r && typeof r === 'object' ? spec.parse(r as Raw) : null; if (p) out.push(p); else skipped++; }
  return { rows: out, skipped };
}
```

`companyScoped` uses `company_id in [company, false]` or `company_ids` per S0-T7/T8 (one branch in `odooSweep.ts`). Field names
change only here, in `discovery.ts` and in `normalise.ts`. Run `npx vitest run src/lib/adapterSeam/odoo/kinds.test.ts`.

### S4-T8 — Cursor maths (AC-ODC-021 logic) — test first

`odoo/sweep.test.ts` (new), over `fakeOdoo`: `parseCursor('')` → `{w:null,id:0,scan:null,census:null}` and round-trips;
`overlapStart({w:'2026-10-31 10:10:00',id:9})` → `{w:'2026-10-31 10:00:00',id:0}`; `keysetDomain` equals the §2.7 domain;
five rows sharing one `write_date` at page size 2 are each applied once; a late row (`write_date` = cursor − 120 s, inserted after the
cursor was saved) is picked up on the next run; an `apply` that throws leaves the stored cursor unchanged (the fake `apply` is the only
cursor writer).

### S4-T9 — `odoo/sweep.ts` (green)

```ts
export const OVERLAP_SECONDS = 600;
export const PAGE_SIZE = 200;         // practical size per S0-T11
export const CENSUS_PAGE_SIZE = 2_000;
export const CENSUS_EVERY_MS = 86_400_000;
export interface Cursor { w: string | null; id: number; scan: { after_id: number; started_at: string } | null; census: { run: string; after_id: number } | null; census_done_at?: string }

export function parseCursor(raw: string): Cursor {
  try { const c = JSON.parse(raw); return { w: c.w ?? null, id: c.id ?? 0, scan: c.scan ?? null, census: c.census ?? null, census_done_at: c.census_done_at }; }
  catch { return { w: null, id: 0, scan: null, census: null }; }
}
export const formatCursor = (c: Cursor) => JSON.stringify(c);
const toOdoo = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const fromOdoo = (w: string) => Date.parse(`${w.replace(' ', 'T')}Z`);
export const overlapStart = (c: { w: string; id: number }) => ({ w: toOdoo(fromOdoo(c.w) - OVERLAP_SECONDS * 1000), id: 0 });
export const keysetDomain = (k: { w: string; id: number }) => ['|', ['write_date', '>', k.w], '&', ['write_date', '=', k.w], ['id', '>', k.id]];
export const scanHandoverCursor = (startedAt: string) => toOdoo(Date.parse(startedAt) - OVERLAP_SECONDS * 1000);

export interface KindRunDeps {
  read: (domain: unknown[], order: string, limit: number) => Promise<unknown[]>;   // search_read, active_test false
  readIds: (afterId: number, limit: number) => Promise<number[]>;                 // search, 'id asc'
  apply: (rows: MasterRow[], cursor: string) => Promise<void>;                     // apply_odoo_master_page
  censusSeen: (run: string, ids: string[]) => Promise<void>;
  censusFinish: (run: string, cursor: string) => Promise<void>;
  budget: { spend: () => boolean };
  now: () => Date;
}

export async function runKind(spec: KindSpec, raw: string, d: KindRunDeps): Promise<{ applied: MasterRow[]; skipped: number; done: boolean }> {
  let c = parseCursor(raw); const applied: MasterRow[] = []; let skipped = 0;
  if (c.w === null) {                                                               // initial or resumed full scan (FR-ODC-044)
    c.scan ??= { after_id: 0, started_at: d.now().toISOString() };
    while (c.w === null && d.budget.spend()) {
      const page = (await d.read([['id', '>', c.scan!.after_id]], 'id asc', PAGE_SIZE)) as { id: number }[];
      const parsed = parsePage(spec, page);
      c = page.length < PAGE_SIZE ? { ...c, w: scanHandoverCursor(c.scan!.started_at), id: 0, scan: null } : { ...c, scan: { ...c.scan!, after_id: page.at(-1)!.id } };
      await d.apply(parsed.rows, formatCursor(c)); applied.push(...parsed.rows); skipped += parsed.skipped;
    }
    if (c.w === null) return { applied, skipped, done: false };
  }
  let key = overlapStart({ w: c.w, id: c.id });
  while (d.budget.spend()) {
    const page = (await d.read(keysetDomain(key), 'write_date asc, id asc', PAGE_SIZE)) as { id: number; write_date: string }[];
    const parsed = parsePage(spec, page);
    if (page.length) { const l = page.at(-1)!; key = { w: l.write_date, id: l.id }; c = { ...c, w: l.write_date, id: l.id }; }
    await d.apply(parsed.rows, formatCursor(c)); applied.push(...parsed.rows); skipped += parsed.skipped;
    if (page.length < PAGE_SIZE) return { applied, skipped, done: true };
  }
  return { applied, skipped, done: false };
}

export async function runCensus(raw: string, d: KindRunDeps): Promise<boolean> {
  let c = parseCursor(raw);
  if (!c.census && c.census_done_at && d.now().getTime() - Date.parse(c.census_done_at) < CENSUS_EVERY_MS) return true;
  c.census ??= { run: d.now().toISOString(), after_id: 0 };
  while (d.budget.spend()) {
    const ids = await d.readIds(c.census.after_id, CENSUS_PAGE_SIZE);
    await d.censusSeen(c.census.run, ids.map(String));
    if (ids.length < CENSUS_PAGE_SIZE) {
      const run = c.census.run;
      c = { ...c, census: null, census_done_at: d.now().toISOString() };
      await d.censusFinish(run, formatCursor(c));
      return true;
    }
    c.census.after_id = ids.at(-1)!;
  }
  // ponytail: census progress lives in memory between pages; an interrupted census restarts its run next tick (bounded, safe:
  // nothing is tombstoned until finish_odoo_census runs on an exhausted id list).
  return false;
}
```

Budget test (AC-ODC-022, append): a 7-page scan with `spend` allowing 3 pages per tick reaches the same rows as an unbounded run after
3 ticks, and the cursor between ticks has `scan.after_id > 0`. Replay test (AC-ODC-026 U half): after a full run, a reset (`''`) and a
re-run apply the same row set. Move S1-T8's inlined keyset into an import of `keysetDomain`. Run
`npx vitest run src/lib/adapterSeam/odoo/sweep.test.ts`.

### S4-T10 — `_shared/odooSweep.ts` for one org (AC-ODC-025) — test first, then code

`supabase/functions/_shared/odooSweep.test.ts` (new): `claim_erp_sweep_lock` false → no fetch, `{skipped:'lock-held'}`; disconnected,
not activated, kill-switch → refusal, no fetch; calls ≤ `ODOO_SWEEP_TICK_MAX_CALLS`; `release_erp_sweep_lock` runs in `finally` even when
a kind throws; a 401 mid-sweep → `recordOdooProbe` with `{ok:false, errorClass:'key-rejected'}` and remaining kinds skipped; a clean run
→ `recordOdooProbe({ok:true, missing})`; two concurrent calls for one org → one runs (the fake lock grants once).

```ts
export const ODOO_KIND_ORDER: MasterKind[] = ['company', 'analytic_plan', 'analytic_account', 'account', 'tax', 'uom', 'product', 'warehouse', 'location', 'partner'];
export const ODOO_SWEEP_TICK_MAX_CALLS = 60;
export const ODOO_SWEEP_TICK_TIME_BUDGET_MS = 100_000;

export async function sweepOdooOrg(sc: SupabaseClient, orgId: string, opts: { maxCalls?: number; timeBudgetMs?: number } = {}) {
  const holder = crypto.randomUUID();
  const { data: claimed } = await sc.rpc('claim_erp_sweep_lock', { p_org_id: orgId, p_holder: holder, p_ttl: '15 minutes' });
  if (!claimed) return { skipped: 'lock-held' as const };
  try {
    const r = await odooClientForOrg(sc, orgId);
    if ('refusal' in r) return { skipped: r.refusal };
    const started = Date.now(); let calls = 0;
    const budget = { spend: () => ++calls <= (opts.maxCalls ?? ODOO_SWEEP_TICK_MAX_CALLS) && Date.now() - started < (opts.timeBudgetMs ?? ODOO_SWEEP_TICK_TIME_BUDGET_MS) };
    try {
      for (const kind of ODOO_KIND_ORDER) {
        const spec = KIND_SPECS[kind];
        const deps = kindDeps(sc, orgId, kind, spec, r.client, r.companyId!, budget);
        const run = await runKind(spec, await readCursor(sc, orgId, kind), deps);
        await AFTER_APPLY[kind]?.(sc, orgId, run.applied);   // S6: party feed match
        if (run.done) await runCensus(await readCursor(sc, orgId, kind), deps);
        if (!budget.spend()) break;
      }
      for (const step of AFTER_SWEEP) await step(sc, orgId, r, budget);   // S7: link reconcile · S8: accepted sends
      const snapshot = isOlderThanDay(r.config.capabilities) ? await discoverCapabilities(bindCall(r.client), { versionMajor: await fetchOdooVersionMajor(r.client), now: new Date() }) : undefined;
      await recordOdooProbe(sc, orgId, r.config, { ok: true, missing: (snapshot ?? (r.config.capabilities as CapabilitySnapshot | undefined))?.missing ?? [] }, snapshot);
    } catch (err) {
      if (err instanceof OdooError) await recordOdooProbe(sc, orgId, r.config, { ok: false, errorClass: err.errorClass });
      else throw err;
    }
    return { ok: true as const, calls };
  } finally {
    await sc.rpc('release_erp_sweep_lock', { p_org_id: orgId, p_holder: holder });
  }
}
```

`AFTER_APPLY` and `AFTER_SWEEP` are module-level registries (`Partial<Record<MasterKind, Fn>>` and `Fn[]`), empty in S4; S6–S8 each add
one entry. `kindDeps` builds `read` = `odooCall(client, spec.model, 'search_read', {domain:[...domain, ...companyDomain(spec, company)],
fields:['id', ...spec.fields], order, limit, context:{active_test:false}})`, `readIds` = `search`, and the three RPCs (any returned `error`
is thrown, so nothing but the RPC writes a cursor). Run
`cd supabase/functions/_shared && deno test odooSweep.test.ts --allow-env --allow-net --allow-read`.

### S4-T11 — `odoo-sweep` function (FR-ODC-047) — test first, then code

`supabase/functions/odoo-sweep/sweep.test.ts` (new; `REQUIRED` entry `handleOdooSweepRequest`): wrong bearer → 401
(`constantTimeBearerEquals` against the Odoo sweep secret in the function environment, named as the ERPNext sweep's with the Odoo prefix); the org query filters tier `odoo`, `status='active'`, `activated_at not null`;
zero orgs → 200 `{orgs:0}` and no Odoo call (S-B, AC-ODC-092 U half); two orgs → two `claim_erp_sweep_lock` calls.

```ts
export async function handleOdooSweepRequest(req: Request): Promise<Response> {
  const secret = Deno.env.get(ODOO_SWEEP_SECRET_ENV) ?? '';   // constant defined beside the handler
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!secret || !(await constantTimeBearerEquals(bearer, secret))) return json({ error: 'UNAUTHORIZED' }, 401);
  const sc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, testSupabaseOptions);
  const { data: orgs } = await sc.from('external_org_bindings').select('org_id').eq('external_tier', 'odoo').eq('status', 'active').not('activated_at', 'is', null);
  const results = [];
  for (const { org_id } of orgs ?? []) results.push({ org_id, ...(await sweepOdooOrg(sc, org_id)) });
  return json({ orgs: results.length, results });
}
if (import.meta.main) serveWithErrorReporting('odoo-sweep', handleOdooSweepRequest);
```

Add `supabase/functions/odoo-sweep/deno.json` (copy of `erpnext-sweep/deno.json` without `test.exclude`) and the function's
`verify_jwt = false` entry in `supabase/config.toml` beside `erpnext-sweep`'s (builder copies its form at head). Run
`cd supabase/functions/odoo-sweep && deno test sweep.test.ts --allow-env --allow-net --allow-read`.

### S4-T12 — `refresh` and `reset-kind` verbs (FR-ODC-047/048)

Tests (append `external-set-company/odoo.test.ts`): Finance `refresh` → `rate_limit_hit` with key `odoo-refresh:<org>`, limit 1, window
60, then `sweepOdooOrg`; a second call within the window → 429 `retryAfterSeconds:60`; Engineer → 403; Admin `reset-kind {kind:'product'}`
→ `reset_odoo_sync_kind`; unknown kind → 400; Finance → 403. Gates: `refresh` Admin/Finance; `reset-kind` Admin/Operator.

### S4-T13 — Bed contract: archive / delete / rename (AC-ODC-023)

`supabase/functions/_shared/odooSweep.bed.test.ts` (new, gated; local Supabase; locks odoo → db): seed an activated odoo binding for a
test org by SQL; create three products on the bed; sweep; archive one, `unlink` one, rename one; sweep with the census forced due; assert
archived → `active=false`, not tombstoned; deleted → tombstoned and present; renamed → new name. (The returning-id half is pgTAP, S4-T4:
Odoo never reuses an id.) Run
`scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT … deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooSweep.bed.test.ts'`.

---

## S5 — Odoo card, banner, directories, pickers; Odoo in the shared setup screen (Orca UI worker)

ACs: 015, 040, 081, 082, 084. Loads `impeccable`, `taste`, `ui-ux-pro-max`; `DESIGN.md` tokens; shared primitives
(`EntityFormModal`, `TextField`, `SelectField`, `Combobox`, `ConfirmDialog`, `classifyMutationError`). Information-rich, not bare
(owner rule). The per-kind proposal screen with accept-all is **ECA-2's** (#1605); this slice only makes it receive `tier: 'odoo'`.
Tests assert actions and states, never looks.

### S5-T1 — Directory repository (AC-ODC-081) — test first

`pmo-portal/src/lib/repositories/odoo.test.ts` (new): `odoo.listMasterRecords({kind:'product', search:'semen', page:3, pageSize:50, purpose:'purchase'})`
calls `.from('external_master_records').select('id,external_id,code,name,parent_external_id,active,tombstoned_at,attrs,as_of', {count:'exact'})`,
`.eq('external_tier','odoo').eq('kind','product')`, `.or('name.ilike.%semen%,code.ilike.%semen%')`, `.eq('attrs->>purchasable','true')`,
`.range(100,149)`; with `count: 2500` returns `total: 2500` (no cap). `odoo.getConnection()` returns `{status, activated, connection, capabilities}`
for tier `odoo`.

### S5-T2 — `repositories/odoo.ts` (green)

```ts
export interface MasterRecord { id: string; external_id: string; code: string | null; name: string; parent_external_id: string | null; active: boolean; tombstoned_at: string | null; attrs: Record<string, unknown>; as_of: string }
export type DirectoryKind = 'product' | 'uom' | 'warehouse' | 'location' | 'account' | 'tax' | 'analytic_account';
export interface ListMasterInput { kind: DirectoryKind; search?: string; page: number; pageSize: number; purpose?: 'purchase' | 'sale'; includeInactive?: boolean }
const escapeFilter = (s: string) => s.replace(/[%_,()\\]/g, (ch) => `\\${ch}`);

export const odooRepository = {
  listMasterRecords: (input: ListMasterInput) => wrap(async () => {
    let q = supabase.from('external_master_records').select('id,external_id,code,name,parent_external_id,active,tombstoned_at,attrs,as_of', { count: 'exact' })
      .eq('external_tier', 'odoo').eq('kind', input.kind);
    if (input.search) q = q.or(`name.ilike.%${escapeFilter(input.search)}%,code.ilike.%${escapeFilter(input.search)}%`);
    if (input.purpose) q = q.eq(input.purpose === 'purchase' ? 'attrs->>purchasable' : 'attrs->>sellable', 'true');
    if (!input.includeInactive) q = q.eq('active', true).is('tombstoned_at', null);
    const from = (input.page - 1) * input.pageSize;
    const { data, error, count } = await q.order('name').range(from, from + input.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as MasterRecord[], total: count ?? 0 };
  }),
  getConnection: () => wrap(async () => {
    const { data, error } = await supabase.from('external_org_bindings').select('status,activated_at,config').eq('external_tier', 'odoo').maybeSingle();
    if (error) throw error;
    const cfg = (data?.config ?? {}) as Record<string, unknown>;
    return { status: data?.status ?? 'disconnected', activated: !!data?.activated_at, connection: cfg.connection ?? null, capabilities: cfg.capabilities ?? null };
  }),
  setup: <T>(setupAction: string, input: Record<string, unknown> = {}) => erpSetupRequest<T>(setupAction, input, 'odoo'),
};
```

Register `odoo: odooRepository` in `repositories/index.ts`. Only PMO kind names here (AC-ODC-083 stays green). Run
`npx vitest run src/lib/repositories/odoo.test.ts`.

### S5-T3 — `hooks/useOdoo.ts`

`useOdooConnection()` (`['odoo','connection',orgId]`, refetch 60 s), `useMasterRecords(input)` (`['odoo','master',orgId,input]`,
`placeholderData: keepPreviousData`), `useOdooSetup(verb)` (mutation; invalidates `['odoo']` and the `integrationHealthQueryKey` family).
Test `useOdoo.test.tsx`: every key includes `orgId`.

### S5-T4 — Banner (AC-ODC-015) — test first, then component

`src/components/integrations/odoo/OdooConnectionBanner.test.tsx` (new): a `healthy` checked 11 minutes ago renders "Not checked recently",
never "Connected"; `unreachable` → persistent `role="status"` notice with the age ("as of 14:05") and the next step; fresh `healthy` →
nothing. Component `OdooConnectionBanner.tsx` uses `displayedConnection`; mounted at the top of `pages/MasterData.tsx` and of the project
cost-account panel (S7). Strings under `odoo.state.*` / `odoo.banner.*` in both locale files (`npm run check:i18n`).

### S5-T5 — Connection card (FR-ODC-110) — test first, then component

`src/components/integrations/odoo/OdooConnectionCard.test.tsx` (new): Admin submits site URL, database, masked key
(`type="password"`, `autocomplete="off"`), optional expiry → `integrations.connectIntegration({tier:'odoo', credential:{siteUrl, database, apiKey, keyExpiresOn}})`;
the key field clears after submit either way; `key-rejected` shows its localised message; `confirm-discard` opens `ConfirmDialog` and resubmits
with `confirmDiscard:true`; one company → activation pre-selected; two → `SelectField`; activate → `odoo.setup('activate', {companyId})`;
connected → state label, age, Re-check, Refresh now (Admin/Finance), Disconnect (`ConfirmDialog`); Finance sees state and Refresh only.
Mount in `IntegrationsView.tsx` beside the ERPNext card, rendered when no ERPNext binding is active.

### S5-T6 — Odoo in the shared setup screen

ECA-2's setup screen and checklist take a `tier`; pass `'odoo'` when the active ERP binding is Odoo. Add the Odoo-only checklist items
through ECA-2's extension point (or, if it has none, a `tier`-keyed list in its step function): connected, activated, capability OK
(`missing.length === 0`), map once (S7's config proposal accepted), sends finished (S8), manage vendors and clients in Odoo (employ, S8).
Test: the checklist for an Odoo org lists these items and none of ERPNext's activity-type or budget-category items.

### S5-T7 — Directory page (FR-ODC-111) — test first

`pages/MasterData.test.tsx` (new): route `/master-data/:kind`; tabs items, units, warehouses & locations, cost accounts, and for
Admin/Executive/Finance only accounts and taxes; search debounced 300 ms; pager "1–50 of 2,500"; inactive and tombstoned counts; "as of"
from the newest `as_of`; a kind whose model is in `capabilities.missing` is disabled with the reason; warehouses tab groups locations under
their warehouse with `usage`. Route in `App.tsx`: `{ path: '/master-data/:kind', element: <MasterDataPage /> }` (lazy), plus a nav entry
next to the Administration links (builder follows the existing nav pattern).

### S5-T8 — Item pickers (AC-ODC-040)

`src/components/integrations/odoo/OdooItemPicker.tsx` (new) + test: `Combobox` over `useMasterRecords({kind:'product', purpose})`; the
purchase picker lists only active purchasable rows, the sales picker only sellable; typing searches code and name; reaching the end loads
page 2. Wired into procurement forms by O2.

### S5-T9 — Role-gated controls (AC-ODC-082)

`src/components/integrations/odoo/OdooRoleControls.test.tsx` (new): card, directory and checklist rendered for Admin, Executive, Finance,
Project Manager, Engineer and an Admin viewing as Engineer: only what `can()` allows renders; the impersonating Admin sees no write control.
`src/auth/policy.ts` under `integration`: `manage_external_bindings` (Admin), `setValue` (Admin, Finance) for defaults and refresh, `view`
of the financial directory (Admin, Executive, Finance). Server refusals are proven in S2-T3 and S3/S4 router tests.

### S5-T10 — a11y, i18n, 320 px (AC-ODC-084)

`pages/MasterData.a11y.test.tsx` and `OdooConnectionCard.a11y.test.tsx` (new) with the project's axe helper (copy the import from
`pages/admin/OrgProjectClassificationOptions.a11y.test.tsx`); `npm run check:i18n`;
`scripts/ux-proof.sh /administration/integrations /master-data/product /master-data/account`.

---

## S6 — Connect at any time: parties and project links (Director-dispatched; security-auditor on the guard)

ACs: 031, 033, 050, 053 (and AC-ECA-004/005/007 for tier `odoo` through the shared tests). Blocked by ECA-2 (census, proposals,
accept-all storage and verbs) and S1/S4. Bed claims: V6, V9.

### S6-T1 — Odoo in the shared census and proposal (S-A, S-D)

ECA-2's census and proposal run per tier through `ConnectAdapter`. Wire the Odoo adapter in the place ECA-2 resolves a tier's adapter
(`createOdooConnectAdapter(bindCall(client), {companyId, analyticPlanId, unitMap})` from `odooClientForOrg`). Test (append to ECA-2's
census/proposal Deno test, parameterised by tier): for an Odoo org over `fakeOdoo`, census counts parties/projects/items on both sides and
writes nothing to Odoo; proposals for an overlapping fixture give link / bring in / send / review as AC-ECA-002 expects. No Odoo-specific
matcher exists (SD-8).

### S6-T2 — Exactly-once bring-in and link for Odoo (AC-ODC-031) — pgTAP first

`supabase/tests/odoo_party_adoption.test.sql` (new): two `adopt_odoo_partner(org, 'Vendor:5', '{"name":"PT Sinar Baja","type":"Vendor",…}')` calls
(the second plays the race loser) → one `companies` row, one `external_refs` row, the second returns the first's id; linking to an existing
PMO company (`p_existing_company`) inserts no company; linking a PMO company that already has a `companies` ref → `P0001`
(the caller turns it into a review row). If ECA-2 ships a tier-agnostic bring-in/link RPC, this test runs it with tier `odoo`
and S6-T3 is skipped.

### S6-T3 — `NNNN-D_odoo_party_adoption.sql` (green, only if ECA-2 has no tier-agnostic RPC)

```sql
create or replace function public.adopt_odoo_partner(p_org_id uuid, p_external_id text, p_company jsonb, p_existing_company uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  select pmo_record_id::uuid into v_id from public.external_refs where org_id = p_org_id and domain = 'companies' and external_record_id = p_external_id;
  if v_id is not null then return v_id; end if;
  if p_existing_company is not null and exists (select 1 from public.companies where id = p_existing_company and (org_id <> p_org_id or type = 'Internal')) then
    raise exception 'company cannot take this partner' using errcode = 'P0001';
  end if;
  -- external_refs is unique on (org, domain, pmo_record_id) as well as (org, domain, external_record_id) (0088, 0093):
  -- a PMO company already linked to another partner is a review case, never a silent no-op.
  if p_existing_company is not null and exists (select 1 from public.external_refs
       where org_id = p_org_id and domain = 'companies' and pmo_record_id = p_existing_company::text) then
    raise exception 'company already linked to another partner' using errcode = 'P0001';
  end if;
  v_id := coalesce(p_existing_company, gen_random_uuid());
  if p_existing_company is null then
    insert into public.companies (id, org_id, name, type, erp_party_type, erp_tax_id, erp_modified)
    values (v_id, p_org_id, p_company ->> 'name', p_company ->> 'type', p_company ->> 'type', p_company ->> 'tax_id', p_company ->> 'write_date');
  end if;
  begin
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values (p_org_id, 'companies', v_id::text, 'odoo', p_external_id);
  exception when unique_violation then
    if p_existing_company is null then delete from public.companies where id = v_id; end if;   -- lost the race: keep the winner's row
    select pmo_record_id::uuid into v_id from public.external_refs where org_id = p_org_id and domain = 'companies' and external_record_id = p_external_id;
  end;
  return v_id;
end $$;
revoke all on function public.adopt_odoo_partner(uuid,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.adopt_odoo_partner(uuid,text,jsonb,uuid) to service_role;
```

The builder confirms `external_refs`' column names and that `companies_native_mirror_guard`'s service-role branch admits these columns.
Rollback drops it. Run
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/odoo_party_adoption.test.sql supabase/tests/external_refs_adopt_unique.test.sql'`.

### S6-T4 — Companies guard under tier `odoo` (AC-ODC-033)

Append to `odoo_party_adoption.test.sql`: with `external_domain_ownership(org,'odoo','companies')` in the fixture, an Admin JWT
`update companies set name='x'` on a mirrored row → `42501`; `set archived_at = now()` → ok; delete the ownership row → the name update
succeeds. No migration: the shipped guard is tier-agnostic (`domain_externally_owned`, migration 0103 version).

### S6-T5 — Feed match for new partners (FR-ECA-014/016)

`supabase/functions/_shared/odooPartyFeed.ts` (new) + `odooPartyFeed.test.ts`: registered as `AFTER_APPLY.partner` in `odooSweep.ts`.
For partner rows applied in a page that have no `external_refs`: normalise (`normaliseParty`), load candidate PMO companies (same
normalised name or same `erp_tax_id`, ≤ 20, paged per ECA's rule), run the shared `proposeMatches`; *link* / *bring in* apply through the
RPC when the org's party kind has been accepted once (ECA-2's "auto-apply after setup" state); otherwise the outcome is stored as a proposal
row; *review* is stored and notified. Test: the four outcomes call the right writer; nothing is written for a partner that already has a
ref; a thrown writer error does not roll back the page (the hook runs after `apply_odoo_master_page` returned; the next overlap read repeats
the decision, which is idempotent).

### S6-T6 — Project link RPCs (AC-ODC-050, AC-ODC-053) — pgTAP first

`supabase/tests/odoo_project_links_config.test.sql` (new). Fixture: activated binding with `analytic_plan_id='7'`; mirror
`analytic_account` 101, 102 (plan 7), 201 (plan 8); projects P1 (PM pm1), P2 (PM pm2).
- `AC-ODC-050` `link_odoo_cost_account(org, admin, P1, '101')` ok; `(org, pm1, P2, '102')` → `42501`; `(org, pm2, P2, '102')` ok;
  `(org, admin, P2, '101')` → `23505` naming P1's project number only; a second account on P1 → refused; `'201'` → `not a cost account of
  the chosen plan`; a tombstoned account → refused.
- `AC-ODC-053` `unlink_odoo_cost_account(org, admin, P1)` → binding gone, audit row `integration.odoo.unlink`;
  `odoo_project_link_in_use(org, P1)` is false.

### S6-T7 — `NNNN-C_odoo_project_links_config.sql` part 1 (green)

```sql
create unique index external_project_bindings_odoo_account_uq on public.external_project_bindings (org_id, external_container_id) where external_tier = 'odoo';

-- FR-ODC-073 / FR-ECA-015: the ONE re-link check later slices extend (O2 adds its document tables). O1: nothing references a link yet.
create or replace function public.odoo_project_link_in_use(p_org_id uuid, p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$ select false $$;
revoke all on function public.odoo_project_link_in_use(uuid,uuid) from public, anon, authenticated;

create or replace function public.link_odoo_cost_account(p_org_id uuid, p_actor_id uuid, p_project_id uuid, p_account_id text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan text; v_id uuid; v_holder text;
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, p_project_id);
  perform public.assert_odoo_activated(p_org_id);
  if public.odoo_project_link_in_use(p_org_id, p_project_id) then raise exception 'project link is in use' using errcode = 'P0001'; end if;
  select config ->> 'analytic_plan_id' into v_plan from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo';
  if not exists (select 1 from public.external_master_records where org_id = p_org_id and external_tier = 'odoo' and kind = 'analytic_account'
                  and external_id = p_account_id and parent_external_id = v_plan and active and tombstoned_at is null) then
    raise exception 'not a cost account of the chosen plan' using errcode = 'P0001';
  end if;
  select p.pmo_project_number into v_holder from public.external_project_bindings b join public.projects p on p.id = b.project_id
   where b.org_id = p_org_id and b.external_tier = 'odoo' and b.external_container_id = p_account_id;
  if v_holder is not null then raise exception 'cost account already linked to %', v_holder using errcode = '23505'; end if;
  insert into public.external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
  values (p_org_id, p_project_id, 'odoo', p_account_id, jsonb_build_object('plan_id', v_plan), p_actor_id, now()) returning id into v_id;
  perform public.log_audit('integration.odoo.link', p_org_id, p_actor_id, p_project_id, jsonb_build_object('account', p_account_id));
  return v_id;
end $$;

create or replace function public.unlink_odoo_cost_account(p_org_id uuid, p_actor_id uuid, p_project_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, p_project_id);
  if public.odoo_project_link_in_use(p_org_id, p_project_id) then raise exception 'project link is in use' using errcode = 'P0001'; end if;
  delete from public.external_project_bindings where org_id = p_org_id and project_id = p_project_id and external_tier = 'odoo';
  perform public.log_audit('integration.odoo.unlink', p_org_id, p_actor_id, p_project_id, '{}'::jsonb);
end $$;
```

Both granted to `service_role` only; `pmo_project_number` confirmed at head (migration 0231). ECA-2's bulk *link* outcome for kind
`project` calls `link_odoo_cost_account` per row inside its accept (one audit row per accept per FR-ECA-015 — the per-row audit above is
kept as the link's own trail). Verbs in the Odoo router: `list-projects` (cost accounts of the plan), `link-project`, `unlink-project`, gate
`() => true` (the SQL actor check decides). Run
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/odoo_project_links_config.test.sql'`.

### S6-T8 — Bed contract: link without the Project app (AC-ODC-051)

`supabase/functions/external-set-company/costAccount.bed.test.ts` (new, gated; local Supabase; odoo → db): on the bed's analytic plan
(created via JSON-2 if S0-T8 finds none), after a sweep the `list-projects` verb returns only that plan's accounts; `link-project`
succeeds; no `project.project` call was made (fetch spy).

---

## S7 — Map once: account defaults, unit map, default warehouse; link reconciliation; resolvers (Director-dispatched)

ACs: 041, 054, 060, 070, 071, AC-ODC-096. Bed claim: V8.

### S7-T1 — Config proposal (AC-ODC-096) — test first

`odoo/configProposal.test.ts` (new): given mirror rows, `proposeOdooConfig({accounts, uoms, warehouses, pmoUnits})` returns, per key, either
`{key, value, reason:'unique'}` or `{key, candidates:[…], reason:'choose'}`:
- payable ← the only active `liability_payable` account; receivable ← the only `asset_receivable`; two `asset_cash` accounts → bank and
  cash are `choose`; expense / stock valuation / stock consumption follow the type map recorded in S0-T7;
- each PMO unit text maps to the uom whose normalised name equals it (`'m2'` ↔ `'m²'` is **not** equal → `choose`);
- one active warehouse → proposed; two → `choose`.
Pure, deterministic (same inputs, same output).

### S7-T2 — `odoo/configProposal.ts` (green)

```ts
export const DEFAULT_TYPES: Record<string, readonly string[]> = {   // FINAL after S0-T7
  payable: ['liability_payable'], receivable: ['asset_receivable'], bank: ['asset_cash'], cash: ['asset_cash'],
  expense: ['expense', 'expense_direct_cost'], stock_valuation: ['asset_current'], stock_consumption: ['expense_direct_cost'],
};
export type ConfigProposal = { key: string; value: string; reason: 'unique' } | { key: string; candidates: string[]; reason: 'choose' };
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function proposeOdooConfig(input: { accounts: MasterRecord[]; uoms: MasterRecord[]; warehouses: MasterRecord[]; pmoUnits: string[] }): ConfigProposal[] {
  const live = (r: MasterRecord) => r.active && !r.tombstoned_at;
  const pick = (key: string, rows: MasterRecord[]): ConfigProposal =>
    rows.length === 1 ? { key, value: rows[0].external_id, reason: 'unique' } : { key, candidates: rows.map((r) => r.external_id), reason: 'choose' };
  const out = Object.entries(DEFAULT_TYPES).map(([key, types]) =>
    pick(`account_defaults.${key}`, input.accounts.filter((a) => live(a) && types.includes(String(a.attrs.account_type)))));
  for (const unit of input.pmoUnits) out.push(pick(`unit_map.${unit}`, input.uoms.filter((u) => live(u) && norm(u.name) === norm(unit))));
  out.push(pick('default_warehouse_id', input.warehouses.filter(live)));
  return out;
}
```

### S7-T3 — `set_odoo_org_config` pgTAP first (AC-ODC-070 P, AC-ODC-041 P)

Append to `odoo_project_links_config.test.sql`:
- `AC-ODC-070` `set_odoo_org_config(org, finance, 'account_defaults', '{"payable":"11"}')` ok and stamps `account_defaults_set_by`;
  Engineer, PM, Executive → `42501`; a non-postable account type (S0-T7) → `P0001`; an inactive account → `P0001`; unknown key → `22023`.
  Read side: Executive sees `kind='account'` rows; PM and Engineer see none.
- `AC-ODC-041` `set_odoo_org_config(org, admin, 'unit_map', '{"m":"5","m2":"6"}')` ok; Engineer → `42501`; a value that is not a mirrored
  `uom` → `P0001`. `default_warehouse_id` only from an active warehouse.

### S7-T4 — `set_odoo_org_config` (green; `NNNN-C` part 2)

```sql
create or replace function public.set_odoo_org_config(p_org_id uuid, p_actor_id uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_state jsonb; v_kind text; v text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  v_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if not coalesce((v_state ->> 'active')::boolean, false) or v_state ->> 'role' not in ('Admin', 'Finance') then
    raise exception 'Admin or Finance required' using errcode = '42501';
  end if;
  perform public.assert_odoo_activated(p_org_id);
  v_kind := case p_key when 'account_defaults' then 'account' when 'unit_map' then 'uom' when 'default_warehouse_id' then 'warehouse' end;
  if v_kind is null then raise exception 'unknown config key' using errcode = '22023'; end if;
  if p_key = 'account_defaults' and exists (select 1 from jsonb_object_keys(p_value) k
       where k not in ('payable','receivable','expense','cash','bank','stock_valuation','stock_consumption')) then
    raise exception 'unknown default' using errcode = '22023';
  end if;
  for v in select case when jsonb_typeof(p_value) = 'object' then e.value #>> '{}' end
             from jsonb_each(case when jsonb_typeof(p_value) = 'object' then p_value else jsonb_build_object('v', p_value) end) e
           union all select p_value #>> '{}' where jsonb_typeof(p_value) <> 'object' loop
    continue when v is null;
    if not exists (select 1 from public.external_master_records where org_id = p_org_id and external_tier = 'odoo' and kind = v_kind
                    and external_id = v and active and tombstoned_at is null
                    and (v_kind <> 'account' or coalesce(attrs ->> 'account_type', '') <> all (array['view']))) then   -- S0-T7 non-postable types
      raise exception 'not a usable %', v_kind using errcode = 'P0001';
    end if;
  end loop;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(p_key, p_value, p_key || '_set_by', p_actor_id, p_key || '_set_at', now()), updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo';
  perform public.log_audit('integration.odoo.config', p_org_id, p_actor_id, null, jsonb_build_object('key', p_key));   -- who set the value (§8 SoD b)
end $$;
revoke all on function public.set_odoo_org_config(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.set_odoo_org_config(uuid,uuid,text,jsonb) to service_role;
```

### S7-T5 — `propose-config` and `save-defaults` verbs (AC-ODC-096 wire, AC-ODC-041 U)

Tests (append `external-set-company/odoo.test.ts`): `propose-config` (Admin/Finance) returns `proposeOdooConfig` over the org's mirror plus
the distinct PMO unit texts (`boq_items.unit` and procurement line units; builder confirms the second column at head) with each unit's mapped
state — three units, two mapped → one `unmapped`; `save-defaults {account_defaults, unit_map, default_warehouse_id}` (Admin/Finance) calls
`set_odoo_org_config` once per key with the whole object (merge done here, not in SQL); Engineer → 403. One request applies every *unique*
proposal ("Accept all"); `choose` rows are picked in the same form.

### S7-T6 — Map-once screen (AC-ODC-096 U, AC-ODC-070 U half)

`src/components/integrations/odoo/OdooMapOnce.tsx` (new) + test: renders three groups (accounts, units, warehouse); every `unique` proposal is
pre-filled; one primary "Accept all" sends `save-defaults` once with every value; `choose` rows show a `Combobox` of candidates and block only
themselves; a later-inactive saved default shows "Needs attention"; non-postable accounts are not offered. Mounted in the Odoo setup flow (S5-T6).

### S7-T7 — Link reconciliation (AC-ODC-054) — test first

Append `_shared/odooSweep.test.ts`: `reconcile_odoo_links(org)` sets `external_project_bindings.config.attention` to `archived`,
`tombstoned` or `moved-company` for a linked account whose mirror row is inactive, tombstoned, or whose `attrs.company_id` differs from the
binding's company; clears it when fixed; never deletes. SQL in `NNNN-C` part 3:

```sql
create or replace function public.reconcile_odoo_links(p_org_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer; v_company text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select config ->> 'odoo_company_id' into v_company from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo';
  update public.external_project_bindings b
     set config = case
       when m.id is null or m.tombstoned_at is not null then b.config || '{"attention":"tombstoned"}'
       when not m.active then b.config || '{"attention":"archived"}'
       when coalesce(m.attrs ->> 'company_id', v_company) <> v_company then b.config || '{"attention":"moved-company"}'
       else b.config - 'attention' end
    from public.external_project_bindings b2
    left join public.external_master_records m on m.org_id = b2.org_id and m.external_tier = 'odoo' and m.kind = 'analytic_account' and m.external_id = b2.external_container_id
   where b.id = b2.id and b.org_id = p_org_id and b.external_tier = 'odoo';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
```

Registered as an `AFTER_SWEEP` step; pgTAP assertion appended to `odoo_project_links_config.test.sql`.

### S7-T8 — Resolvers for later slices (AC-ODC-071) — test first, then code

`odoo/resolvers.test.ts` (new): `resolveProjectCostAccount` → `{resolved:false, reason:'unlinked'}` / `{resolved:false, reason:'needs-attention', detail:'archived'}` /
`{resolved:true, accountId:'101'}`; `resolveUnit('m3')` unmapped → `{resolved:false, reason:'unmapped'}`; `resolveAccountDefault('bank')` unset →
`unset`; a default whose mirror row is inactive → `needs-attention`.

```ts
export type Resolved<T> = ({ resolved: true } & T) | { resolved: false; reason: 'unlinked' | 'unmapped' | 'unset' | 'needs-attention'; detail?: string };
export interface ResolverReads {
  config(): Promise<Record<string, unknown> | null>;
  projectLink(projectId: string): Promise<{ external_container_id: string; config: Record<string, unknown> } | null>;
  master(kind: string, id: string): Promise<{ active: boolean; tombstoned_at: string | null } | null>;
}
export async function resolveProjectCostAccount(r: ResolverReads, projectId: string): Promise<Resolved<{ accountId: string }>> {
  const link = await r.projectLink(projectId);
  if (!link) return { resolved: false, reason: 'unlinked' };
  if (link.config.attention) return { resolved: false, reason: 'needs-attention', detail: String(link.config.attention) };
  return { resolved: true, accountId: link.external_container_id };
}
async function resolveFromConfig(r: ResolverReads, path: [string, string], kind: string, missing: 'unmapped' | 'unset'): Promise<Resolved<{ id: string }>> {
  const id = ((await r.config())?.[path[0]] as Record<string, string> | undefined)?.[path[1]];
  if (!id) return { resolved: false, reason: missing };
  const row = await r.master(kind, id);
  if (!row || !row.active || row.tombstoned_at) return { resolved: false, reason: 'needs-attention', detail: 'inactive' };
  return { resolved: true, id };
}
export const resolveUnit = (r: ResolverReads, unit: string) => resolveFromConfig(r, ['unit_map', unit], 'uom', 'unmapped');
export const resolveAccountDefault = (r: ResolverReads, key: string) => resolveFromConfig(r, ['account_defaults', key], 'account', 'unset');
```

### S7-T9 — Default warehouse and project panel UI (AC-ODC-060, FR-ODC-112)

`src/components/integrations/odoo/OdooWarehouseDefault.test.tsx` (new): choices are active, non-tombstoned warehouses only; saving calls
`save-defaults` with `default_warehouse_id`; an archived chosen warehouse shows "Needs attention: the default warehouse was archived in Odoo".
`pages/project-detail/ProjectOdooLink.tsx` (new; mounted where `ProjectErpLink` is mounted in `ProjectDetailHeader.tsx` /
`ProjectDetailRail.tsx`, only for an Odoo org) + test: shows the linked cost account or a picker of the plan's accounts; "Create in Odoo" sends
the project as a single *send* (S8 verb); `409` shows "Already linked to PRJ-…"; `503 odoo-unavailable` shows the retry message and the banner;
`needs-attention` shows the reason; a PM of another project sees no controls.

---

## S8 — Send PMO masters to Odoo; companies command after employ (Director-dispatched; outbox)

ACs: 034, 052, AC-ECA-010/011/012 for Odoo (suite in S1; served half here). Bed claims: V12, V-CREATE.

### S8-T1 — Odoo sends through the shared send path — test first

ECA-3 (#1606) builds the send caller: accepted *send* rows → `dispatchMoneyWrite` with key `seed:<kind>:<pmo id>` →
`ConnectAdapter.sendMaster`. Wire Odoo's adapter into it (`createOdooConnectAdapter` + `createDbMoneyOutboxDeps({ externalTier:'odoo',
reissueOnInconclusiveAbsence:false, probeByRemarksKey: odooSendProbe, … })`). `odooSendProbe` (new, `odoo/connectAdapter.ts`) runs the same
lookup `sendMaster` does (ref / code / default_code) and returns the hit, `null`, or throws on two hits so the row is held.
Test `supabase/functions/_shared/odooSends.test.ts` (new): three accepted vendor sends → three `res.partner/create` and three
`external_refs`; a lost response then a re-run → one partner (probe hit); a 422 → the row becomes *review* with the plain reason
`validation`, the others complete (FR-ECA-022); a quarantined row whose probe misses → `held`, no create; the outbox key is
`seed:party:<pmo id>` regardless of attempt.

### S8-T2 — Sends from the sweep

Register `sendAcceptedOdoo` as an `AFTER_SWEEP` step: takes accepted *send* rows for tier `odoo` (ECA-2's storage) oldest first and runs the
send caller while `budget.spend()` holds, so a 300-vendor S-C setup finishes over a few ticks, paced. Honest progress ("42 of 300 sent") comes
from the rows' states; nothing is shown as sent before Odoo confirmed it (NFR-ECA-004). A refusal from `odooClientForOrg` leaves the rows
accepted and untouched (never "queued as done"). Test (append `odooSweep.test.ts`): a budget of 5 calls sends at most the rows that fit.

### S8-T3 — Single send for one project (FR-ODC-072 via `project.send`)

Router verb `send-project {projectId}` (gate `() => true`; the link actor check decides): resolve the client (refusal → 503
`odoo-unavailable`, nothing stored); run the send caller for one row with key `seed:project:<id>`; apply the new account to the mirror with
`apply_odoo_master_page` (current cursor passed back unchanged) so `link_odoo_cost_account` finds it; link. `command-held` → 200
`{state:'held'}` with copy "We could not confirm whether Odoo created the account. An administrator will resolve it."
Test in `external-set-company/odoo.test.ts`: success links once; double submit → one create; Odoo down → 503 and no outbox row.

### S8-T4 — Bed contract: project send (AC-ODC-052)

`supabase/functions/external-set-company/costAccount.bed.test.ts` (append, gated; local Supabase; odoo → db): send for a fresh project →
exactly one bed account with `code = project number` in the plan and company, linked; a second `send-project` → still one; a lost response
(fetch wrapper throws after the bed answered) then retry → still one; the bed account's `code` edited to `X` and the outbox row forced
quarantined past its window → retry ends `held`, bed count still one.

### S8-T5 — Companies commit after employ (FR-ODC-055) — test first

`supabase/functions/adapter-dispatch/odooCompanies.test.ts` (new; `REQUIRED` entry with the handler symbol the existing adapter-dispatch tests
import): an org employing `companies` under tier `odoo` → dispatch resolves `createOdooAdapter`, not ERPNext; the outbox key is
`odoo:companies:<company id>` whatever key the client sent; a lost response then a second dispatch → no second create; two probe hits → `held`.
Change `adapter-dispatch/index.ts`: add the Odoo resolver to the adapter registry and route `adapter.tier === 'odoo'` through
`dispatchMoneyWrite` with `createDbMoneyOutboxDeps({ externalTier:'odoo', reissueOnInconclusiveAbsence:false, probeByRemarksKey: odooSendProbe })`
and the client from `odooClientForOrg`. Re-run `cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net --allow-read`
(ERPNext and ClickUp dispatch unchanged).

### S8-T6 — Employ step and form verdict

Verb `employ-domain {domain:'companies'}` (Admin/Operator) in the Odoo router → shipped `admin_change_domain_ownership(org,'odoo','companies','employ',actor)`;
refused while any accepted *send* row for parties is unfinished (409 `sends-pending`). Add Odoo's `commit-rejected` codes (`validation`,
`ambiguous`, `unit-unmapped`) and `held` to `pmo-portal/src/lib/adapterSeam/pushErrorCopy.ts` with a `pushErrorCopy.test.ts` case each.

### S8-T7 — Bed contract: partner command (AC-ODC-034)

`supabase/functions/adapter-dispatch/odooCompanies.bed.test.ts` (new, gated; local Supabase; odoo → db): create a vendor through the dispatch
handler → one bed partner with `ref = 'pmo:<id>'` and one `external_refs` row; repeat with the response dropped after the bed answered → still
one; the bed partner's `ref` edited, the outbox row forced quarantined past its window, retry → `held`, still one partner; an invalid VAT (if
`l10n_id` validates it on the bed; else that case is skipped with a note) → the verdict code reaches the response.

---

## S9 — Webhook nudge (optional; Orca worker)

AC: 027. Bed claim: V15 (bed report §6, SD-3).

- **S9-T1 — pgTAP + `NNNN-E_odoo_webhook.sql`:** service-only `set_odoo_webhook_secret(p_org_id, p_actor_id)` (Admin/Operator) stores a random
  Vault secret referenced from `external_org_bindings.webhook_secret_ref` and returns the path token once;
  `odoo_webhook_seen(p_org_id, p_model, p_id)` returns true when the same `(model, id)` arrived within 60 s (table `external_webhook_dedupe`
  keyed `(org_id, model, external_id)` with `seen_at`, service-only, old rows purged by the same function). Test `supabase/tests/odoo_webhook.test.sql`.
- **S9-T2 — test first:** `supabase/functions/odoo-webhook/webhook.test.ts` (`REQUIRED` entry `handleOdooWebhookRequest`): unknown org → 404, no
  write; wrong token → 401 (`constantTimeBearerEquals`); valid `{_model:'res.partner', _id:5, name:'forged'}` → one `search_read [['id','=',5]]`
  through `odooClientForOrg` and one `apply_odoo_master_page` with the **fetched** row (the applied name is the fetched one, not `forged`); the same
  body twice within 60 s → one re-read; a model outside `KIND_SPECS` → 202, no read.
- **S9-T3 — `odoo-webhook/index.ts`:** path `/odoo-webhook/<org id>/<token>`; the re-read writes through `apply_odoo_master_page` with the
  **current** cursor read first and passed back unchanged, so a webhook never moves the watermark.
- **S9-T4 — runbook section** in `docs/runbooks/odoo-client-setup.md`: install Automation Rules once; a webhook server action with the URL; one
  automation rule per model on create/write; no fields selected. Synthetic URL only.

---

## S10 — Bed acceptance: four scenarios, unavailable journey, setup journey, runbook (Orca worker, qa-acceptance role)

ACs: 014, 080, 090, 091–094. Needs S1–S8. Specs live in `pmo-portal/e2e/serial/` (they reset or stop a shared bed), follow
`docs/e2e-parallel-conventions.md`, gate on the dependency (`ODOO_BED_URL`, `SUPABASE_FUNCTIONS_URL`), never on `CI`; a skip needs an
allowlist entry in `scripts/check-e2e-skips.mjs` with a restore path ("runs when the Odoo bed is configured in the integration job").
Run: `scripts/with-odoo-lock.sh scripts/e2e-local.sh AC-ODC-0`.

Order inside one serial file group, because S-C needs an empty bed: `scripts/odoo-dev-bed.sh reset` (in `beforeAll` through a shell helper)
→ S-C → S-A → S-D.

- **S10-T1 — `AC-ODC-093-odoo-empty-erp.spec.ts` (S-C):** a seeded PMO org (3 vendors, 1 client, 2 projects, items on 2 open purchases)
  connects to the freshly reset bed → setup census shows "3 vendors in PMO, 0 in Odoo" → Accept all (one confirm with counts) → after the sends
  finish (poll the progress line) the bed holds exactly 4 partners with `ref = pmo:<id>`, 2 analytic accounts with the project numbers, the items as
  products, and no account or tax was created (bed `search_count` before = after); every PMO row has one external reference; accepting again
  creates nothing.
- **S10-T2 — `AC-ODC-091-odoo-new-org-existing-erp.spec.ts` (S-A):** seed the bed with 20 partners and 5 products by JSON-2; a fresh PMO org
  connects → census "0 in PMO, 20 in Odoo" → Accept all → 20 PMO companies (one per role), zero review rows, item picker lists the 5 products.
- **S10-T3 — `AC-ODC-094-odoo-both-have-data.spec.ts` (S-D):** PMO has vendors A (tax id T1), B (name only), C (PMO-only), and two PMO companies
  named E; the bed has A' (T1), B' (same name as B), D (Odoo-only), E' → proposal: link A, link B, send C, bring in D, review E → Accept all →
  exactly one PMO row per partner, one partner per PMO company (bed count = 5), E remains a review row; resolving E links it; project with a
  matching code links instead of creating a second account (#1043's duplicate does not occur).
- **S10-T4 — S-B (AC-ODC-092):** owned below the browser: `odoo-sweep/sweep.test.ts` (zero bindings → no Odoo call, S4-T11) plus one assertion in
  `odoo_connect_custody.test.sql`: with no odoo binding, `domain_owned_by_tier(org,'companies','odoo')` is false, so company writes stay PMO-local.
  A later connect is then S-C or S-D, covered above.
- **S10-T5 — `AC-ODC-080-odoo-setup-journey.spec.ts`:** fresh org Admin → Integrations → Odoo card → connect → activate the single company →
  setup → map once (Accept all) → link the pilot project by sending it → review one partner → Employ → log out and in → every checklist item complete,
  the project shows its cost account, the defaults are set. Goal oracle: the project's cost-account code and the defaults equal the bed's values
  (read back by JSON-2 in the test).
- **S10-T6 — `AC-ODC-014-odoo-unavailable.spec.ts`:** connected org → `scripts/odoo-dev-bed.sh down` → three Re-checks → item directory and the
  project panel show the last data with "as of" and the unavailable notice; "Create in Odoo" says "Odoo is unreachable, try again" and no
  `external_command_outbox` row exists (service-role read helper) → `up` → Re-check → the notice clears.
- **S10-T7 — AC-ODC-090 reconciliation:** append to `odooSweep.bed.test.ts`: per kind, active mirror rows = the bed's `search_count` with the same
  company domain; every linked project's account id exists on the bed. AC-ODC-090 = 010 + 014 + 023 + 051 + 080 + this check.
- **S10-T8 — `docs/runbooks/odoo-client-setup.md` (new):** the service user with the group set from S0-T13 (no password, key only); mint a key and
  note its expiry; confirm `l10n_id` and PPN/PPh taxes; the connect form; what each connection state means and its next step; what "Accept all"
  will create in Odoo for an empty database. Synthetic hostnames (`odoo.example.test`) and databases only.

---

## Traceability (every AC → one owning test, one layer)

| AC | Owning test | Layer | Slice |
|---|---|---|---|
| AC-ODC-001 | `supabase/functions/external-connect/connect.odoo.bed.test.ts` (secondary U: `connect.odoo.test.ts`) | B | S2 |
| AC-ODC-002 | `pmo-portal/src/lib/adapterSeam/odoo/client.test.ts` | U | S1 |
| AC-ODC-003 | `supabase/functions/external-connect/connect.odoo.test.ts` | D | S2 |
| AC-ODC-004 | `supabase/tests/odoo_connect_custody.test.sql` | P | S2 |
| AC-ODC-005 | `supabase/tests/odoo_connect_custody.test.sql` | P | S2 |
| AC-ODC-006 | `supabase/functions/external-connect/connect.odoo.bed.test.ts` (DB half: `odoo_connect_custody.test.sql`) | B | S2 |
| AC-ODC-007 | `supabase/tests/odoo_connect_custody.test.sql` | P | S2 |
| AC-ODC-008 | `supabase/functions/_shared/odooClientForOrg.test.ts` | D | S2 |
| AC-ODC-009 | `supabase/tests/odoo_connect_custody.test.sql` | P | S2 |
| AC-ODC-010 | `supabase/functions/external-set-company/discovery.bed.test.ts` | B | S3 |
| AC-ODC-011 | `pmo-portal/src/lib/adapterSeam/odoo/discovery.test.ts` (negative half: `discovery.bed.test.ts`) | U | S3 |
| AC-ODC-012 | `pmo-portal/src/lib/adapterSeam/odoo/discovery.test.ts` | U | S3 |
| AC-ODC-013 | `pmo-portal/src/lib/adapterSeam/odoo/connectionState.test.ts` | U | S3 |
| AC-ODC-014 | `pmo-portal/e2e/serial/AC-ODC-014-odoo-unavailable.spec.ts` | E | S10 |
| AC-ODC-015 | `pmo-portal/src/components/integrations/odoo/OdooConnectionBanner.test.tsx` | U | S5 |
| AC-ODC-020 | `supabase/tests/odoo_master_records_rls.test.sql` | P | S4 |
| AC-ODC-021 | `pmo-portal/src/lib/adapterSeam/odoo/sweep.test.ts` (atomicity half: `odoo_master_records_rls.test.sql`) | U | S4 |
| AC-ODC-022 | `pmo-portal/src/lib/adapterSeam/odoo/sweep.test.ts` | U | S4 |
| AC-ODC-023 | `supabase/functions/_shared/odooSweep.bed.test.ts` (tombstone-clear half: `odoo_master_records_rls.test.sql`) | B | S4 |
| AC-ODC-024 | `pmo-portal/src/lib/adapterSeam/odoo/kinds.test.ts` | U | S4 |
| AC-ODC-025 | `supabase/functions/_shared/odooSweep.test.ts` (rate limit: `external-set-company/odoo.test.ts`) | D | S4 |
| AC-ODC-026 | `supabase/tests/odoo_master_records_rls.test.sql` (replay half: `odoo/sweep.test.ts`) | P | S4 |
| AC-ODC-027 | `supabase/functions/odoo-webhook/webhook.test.ts` | D | S9 |
| AC-ODC-030 | ECA-2's `adapterSeam/connect/match.test.ts` (AC-ECA-002; SD-8) — Odoo normalisation: `odoo/normalise.test.ts` | U | (ECA-2) / S1 |
| AC-ODC-031 | `supabase/tests/odoo_party_adoption.test.sql` | P | S6 |
| AC-ODC-032 | `pmo-portal/src/lib/adapterSeam/odoo/normalise.test.ts` | U | S1 |
| AC-ODC-033 | `supabase/tests/odoo_party_adoption.test.sql` | P | S6 |
| AC-ODC-034 | `supabase/functions/adapter-dispatch/odooCompanies.bed.test.ts` | B | S8 |
| AC-ODC-040 | `pmo-portal/src/components/integrations/odoo/OdooItemPicker.test.tsx` | U | S5 |
| AC-ODC-041 | `supabase/tests/odoo_project_links_config.test.sql` (unmapped listing: `external-set-company/odoo.test.ts`) | P | S7 |
| AC-ODC-050 | `supabase/tests/odoo_project_links_config.test.sql` | P | S6 |
| AC-ODC-051 | `supabase/functions/external-set-company/costAccount.bed.test.ts` | B | S6 |
| AC-ODC-052 | `supabase/functions/external-set-company/costAccount.bed.test.ts` (logic: `odoo/connectAdapter.test.ts`) | B | S8 |
| AC-ODC-053 | `supabase/tests/odoo_project_links_config.test.sql` | P | S6 |
| AC-ODC-054 | `supabase/functions/_shared/odooSweep.test.ts` (resolver half: `odoo/resolvers.test.ts`) | D | S7 |
| AC-ODC-060 | `pmo-portal/src/components/integrations/odoo/OdooWarehouseDefault.test.tsx` | U | S7 |
| AC-ODC-070 | `supabase/tests/odoo_project_links_config.test.sql` (needs-attention: `OdooMapOnce.test.tsx`) | P | S7 |
| AC-ODC-071 | `pmo-portal/src/lib/adapterSeam/odoo/resolvers.test.ts` | U | S7 |
| AC-ODC-080 | `pmo-portal/e2e/serial/AC-ODC-080-odoo-setup-journey.spec.ts` | E | S10 |
| AC-ODC-081 | `pmo-portal/src/lib/repositories/odoo.test.ts` (page UI: `pages/MasterData.test.tsx`) | U | S5 |
| AC-ODC-082 | `pmo-portal/src/components/integrations/odoo/OdooRoleControls.test.tsx` | U | S5 |
| AC-ODC-083 | `pmo-portal/src/lib/adapterSeam/odoo/vocabulary.test.ts` | U | S1 |
| AC-ODC-084 | `pmo-portal/pages/MasterData.a11y.test.tsx` + `npm run check:i18n` + `scripts/ux-proof.sh` | U | S5 |
| AC-ODC-090 | composite 010 + 014 + 023 + 051 + 080 + S10-T7 reconciliation | B+E | S10 |
| AC-ODC-091 (S-A, SD-9) | `pmo-portal/e2e/serial/AC-ODC-091-odoo-new-org-existing-erp.spec.ts` | E | S10 |
| AC-ODC-092 (S-B, SD-9) | `supabase/functions/odoo-sweep/sweep.test.ts` (P half: `odoo_connect_custody.test.sql`) | D | S4 / S10 |
| AC-ODC-093 (S-C, SD-9) | `pmo-portal/e2e/serial/AC-ODC-093-odoo-empty-erp.spec.ts` | E | S10 |
| AC-ODC-094 (S-D, SD-9) | `pmo-portal/e2e/serial/AC-ODC-094-odoo-both-have-data.spec.ts` | E | S10 |
| AC-ODC-095 (parity, SD-10) | `pmo-portal/src/lib/adapterSeam/odoo/contract.test.ts` (+ ECA's `contractSuite/parity.test.ts`) | S | S1 |
| AC-ODC-096 (map once, SD-11) | `pmo-portal/src/lib/adapterSeam/odoo/configProposal.test.ts` (UI: `OdooMapOnce.test.tsx`) | U | S7 |

Layers: U Vitest · D Deno shipped-handler test · P pgTAP · S shared contract suite (per tier) · B live-bed contract (Deno, gated) · E served e2e.
Where the O1 spec's §13 names a different owner, this table follows each AC's own layer in O1 §10, except AC-ODC-030 (SD-8) and
AC-ODC-015 (owned by the rendered banner).

## Slice order and executors

S0 → S1 (after ECA-7 + ECA-2 matcher) → S2 → S3 → S4 → {S5, S6 (after ECA-2), S7} → S8 (after ECA-3) → S10; S9 optional any time after S4.
Director-dispatched: S2, S3, S6, S7, S8 (custody, service-role writers to `companies`, money-adjacent defaults, outbox). Orca workers: S0, S1,
S4 (+ security-auditor), S5 (UI), S9, S10.

## Risks for the builders

- **Late commits** (FR-042/043): keep the overlap and the keyset; AC-021's late-commit case guards them.
- **Odoo field names are provisional until S0.** They live only in `discovery.ts` `O1_MODELS`, `kinds.ts` `KIND_SPECS` and `normalise.ts`.
- **Shared tables:** `NNNN-A` changes `disconnect_external_integration` and the `external_org_bindings` select grant for every tier. Re-run the
  ClickUp/ERPNext suites under S2 and `git grep -n secret_ref -- pmo-portal/src` after S2-T5.
- **One cursor writer.** Only `apply_odoo_master_page`, `finish_odoo_census` and `reset_odoo_sync_kind` write a `master:*` watermark.
- **Never fork the shared suite or matcher.** An Odoo failure in a shared suite is fixed in the Odoo adapter or declared *unavailable* with the
  reason (FR-ECA-051/052).
- **Sends create real records in the client's Odoo.** Every send is behind a bulk accept with counts, keyed `seed:<kind>:<id>`, looked up before
  create, held (never reissued) on an inconclusive probe.
- **Public repo:** fixtures and runbooks use invented names (`PT Sinar Baja`, `odoo.example.test`); never a client name, host or key.
