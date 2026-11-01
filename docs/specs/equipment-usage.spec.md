# Spec: Equipment usage and allocation (#1519)

> **Status:** Owner-signed 2026-11-01: all nine §10 defaults accepted.
> Route: `docs/plans/2026-10-30-epc-odoo-build-route.md` item T8 (owner-signed 2026-10-30); owner rulings in #1498.
> IDs: `FR-EQU-###`, `NFR-EQU-###`, `AC-EQU-###`. Executor: Director-dispatched (money).
> Extends, does not duplicate: cost attribution (#1271, `docs/specs/cost-attribution.spec.md`), the timesheet
> approval pattern (`timesheets-approval.spec.md`), the adapter contract (ADR-0055/0058/0059/0094).
> Migration number: next free at build time (`scripts/renumber-migration.sh` if it collides). Rollback required.

## 0. Job story

> **When** one machine (a loader, a truck, a generator) works for several projects in a month, **I want** to log
> its hours or days, fuel and trips against each project, and have the cost split across those projects the way
> my organisation decided, **so that** each project carries a fair, explainable equipment cost even though we
> have no internal hire rate for most machines.

## 1. Context (what ships today, what this adds)

- Project cost actuals come from mirrored ERP ledger lines. Lines with no ERP project reach no project unless a
  **cost attribution rule** (#1271) assigns them by fixed percentages, read-side, never writing to the ERP.
- Timesheets (PMO-owned, approved before they count) are the pattern for "operational usage entered and approved
  in PMO" (ADR-0059 side-mirror posture). Equipment usage is the same shape for assets.
- ADR-0094: the ERP owns the asset and maintenance register and the ledger; **PMO owns project usage**. The
  register screens are #1511 (Odoo) and #899 (fixed-asset register); this spec only *references* an asset.
- Owner ruling (#1498): most clients have no internal rate per asset, so PMO must not require one. The always-on
  minimum is the usage record. Costing is the organisation's choice per asset.

## 2. Scope

**In**
1. A per-asset **usage log**: hours or days per asset per project per day, with optional fuel (litres) and trips,
   and a work/standby marker. Draft → submitted → approved; only approved usage counts.
2. A per-asset **costing setting** (effective-dated, versioned, audited), one of:
   - **None** (default): usage is recorded and visible, no amount computed.
   - **Hire rate**: rate × approved units, optional standby rate.
   - **Actual cost by usage**: the asset's real cost (depreciation, fuel, maintenance ledger lines, chosen by
     the same account / cost-centre match as cost attribution) shared across projects in proportion to a chosen
     **driver** (hours/days, fuel, trips).
3. **Explainable allocation read model** per asset, period and project, plus a project-level view and a
   preview before saving a setting.
4. Allocated amounts reach project actuals through the existing attributed-cost path and category map.
5. Screens (log usage, approve, costing setting, allocation drill-down) and CLI list/preview, reusing the
   shared form primitives and `can()` gating.

**Out of scope (follow-ups, each listed in §11)**
- The vehicle/equipment **register** and maintenance records (#1511, #899): the ERP owns them.
- Billing equipment to the client by contract rate (route item T-billing, separate issue).
- Offline/phone capture of equipment logs (T9) and the daily site report (T10); this spec's entry shape is what
  they will write.
- Telematics/GPS import, per-trip routing, operator licensing, depreciation computation (ERP-owned).
- Posting the allocation to the ERP ledger (see OQ-1; the contract is sketched in §7 but not built).

## 3. Functional requirements (EARS)

**AC-1 Usage record**
- FR-EQU-001 The system shall hold per-org usage entries: asset, project, work date, quantity with unit
  (`hours` or `days`), kind (`work` or `standby`), optional fuel litres, optional trips, optional note.
- FR-EQU-002 When an entry is saved, the system shall refuse a project outside the caller's org, a negative
  quantity, quantity over 24 h or 1 day for one asset/project/date row, and a work date in the future.
- FR-EQU-003 While an asset is used on more than one project on the same day, the system shall accept one entry
  per (asset, project, date, kind) and shall warn (not refuse) when the day's total for the asset exceeds 24 h.
- FR-EQU-004 The system shall never require a rate, a cost, or a costing setting to record usage.

**AC-2 Approval and SoD**
- FR-EQU-010 Entries shall move draft → submitted → approved | rejected only through a security-definer
  transition RPC; clients have no direct write to `status`.
- FR-EQU-011 The approver of an entry shall not be its author (ADR-0019 pattern); the RPC re-asserts it.
- FR-EQU-012 Only approved entries shall count in any allocation, project figure or export. An approved entry is
  immutable; a correction is a reversing entry or reopen by Admin, audited (same path as timesheet correction).
- FR-EQU-013 Every transition shall write an `audit_events` row (actor, time, before/after).

**AC-3 Asset reference**
- FR-EQU-020 The system shall hold a thin per-org equipment asset reference (id, code, name, unit default,
  optional `external_ref` + tier). It shall not duplicate register fields (make, serial, maintenance).
- FR-EQU-021 Where an ERP asset register mirror exists for the org, the asset picker shall read from the mirror
  and an entry shall point at the mirrored asset; PMO shall never write an ERP-owned asset field.
- FR-EQU-022 Where no ERP is connected, an Admin/PM may create the thin reference by hand so usage still works.

**AC-4 Costing setting**
- FR-EQU-030 Per asset, the system shall hold effective-dated, versioned costing settings with `basis` in
  `none | hire_rate | actual_cost`, using the version / `expected_version` / audit mechanics of FR-CAT-011..013.
- FR-EQU-031 `hire_rate` shall carry a work rate per unit, and optionally a standby rate per unit. Where no
  standby rate is set, standby usage is recorded but charges nothing.
- FR-EQU-032 `actual_cost` shall carry the ledger match (account or account group, optional cost centre, optional
  party) exactly as FR-CAT-002/003, and a `driver` in `units | fuel | trips`. `units` uses the entry unit; an
  asset whose entries mix hours and days shall be refused for `units` (one unit per asset per setting).
- FR-EQU-033 Only Admin and Finance shall save or end a setting (security-definer RPCs, as FR-CAT-040).
- FR-EQU-034 The system shall refuse `actual_cost` for an asset whose match would overlap a cost attribution
  rule of equal or greater specificity over the same window, and shall refuse a second current setting for an
  asset over overlapping dates. At read time one line goes to exactly one winner (no double count; FR-CAT-031).

**AC-5 Allocation (the acceptance)**
- FR-EQU-040 For `hire_rate`: allocated amount per (asset, period, project) = approved work units × work rate
  + approved standby units × standby rate, rounded to cents per project.
- FR-EQU-041 For `actual_cost`: the pool for an asset and period is the net (debit − credit) of its matched,
  uncancelled, project-less ledger lines (FR-CAT-004) posted in that period. Each project's share is its
  approved driver total ÷ the asset's approved driver total for the period. Rounded to cents per project, last
  project taking the remainder, so allocations sum exactly to the pool (FR-CAT-022).
- FR-EQU-042 The period shall be the calendar month of the ledger line's posting date (for `actual_cost`) or of
  the work date (for `hire_rate`). A period with a pool and zero approved driver total shall allocate nothing
  and shall show the pool as **unallocated** with that reason; it shall never be dropped or guessed.
- FR-EQU-043 When the asset has no costing setting, or `basis = none`, the system shall show usage totals per
  project and shall show no amount. This is a valid state, not an error.
- FR-EQU-044 Every allocated amount shall expose its inputs: units, rate or pool, share, driver, setting
  version, and the contributing entry count, so a user can recompute it by hand.
- FR-EQU-045 A rate or setting change shall apply from its `effective_from`; earlier periods keep the version
  that was current on their dates (no silent restatement).

**AC-6 Project actuals**
- FR-EQU-050 `actual_cost` allocations shall reach project actuals through the attributed-cost path of #1271 as
  another rule basis (usage share), through the same account → budget category map, with `tagged_to_date`
  unchanged and `attributed_to_date` carrying them. With no equipment settings every existing figure is
  byte-identical to before.
- FR-EQU-051 `hire_rate` allocations are a management charge, not a ledger line. They shall be reported in a
  separate field (`equipment_charge_to_date`) in the project finances view, labelled as an internal charge, and
  shall count in `actuals_to_date` only per OQ-3's answer (recommended default below).
- FR-EQU-052 The system shall never write to the ERP, `erp_gl_entry_mirror` or `erp_actuals_snapshot` for an
  allocation (read-side only, FR-CAT-006).

**AC-7 Access**
- FR-EQU-060 Active Engineer-or-above members of the org shall create and submit their own usage entries.
- FR-EQU-061 Project Manager (for projects they manage), Executive, Finance and Admin shall approve; the
  approver ≠ author rule applies to all of them.
- FR-EQU-062 Usage and allocations shall be readable by Admin, Finance, Executive and Project Manager; an
  Engineer reads their own entries and each asset's usage totals but no amounts. Other orgs read nothing.
- FR-EQU-063 Clients have no direct INSERT/UPDATE/DELETE on settings or allocations; entries are written through
  RPCs or column-pinned own-row policies, with `org_id` stamped by default/trigger, never sent.
- FR-EQU-064 Entries are soft-archived (`archived_at`), never hard-deleted, except by Admin (ADR-0018/0019).

**AC-8 Preview, screens, CLI**
- FR-EQU-070 When a draft setting is previewed, the system shall return the allocations per project per month
  computed by the same code a saved setting uses, with the same validation and conflict refusal.
- FR-EQU-071 Screens: Equipment → Usage (week/day grid by asset and project, log, submit, approve queue);
  Equipment → asset detail (costing setting, allocation table with FR-EQU-044 drill-down); a project's
  Finances panel lists equipment usage and allocated amounts per asset. CLI: `pmo equipment usage list`,
  `pmo equipment costing preview|set|list`.

## 4. Non-functional requirements

- NFR-EQU-001 Org scope from the JWT (`auth_org_id()`), never an argument.
- NFR-EQU-002 Money is `numeric`, never float; totals are rounded once per project per period, not summed
  from rounded parts of a different grain.
- NFR-EQU-003 Allocation read for one project/month completes in under 2 s with 50k ledger lines and 200
  assets (index on usage by (org, asset, work_date, status); reuse #1271's partial ledger index). Dashboards
  read once per call, as NFR-CAT-004.
- NFR-EQU-004 Dates and periods use the org's configured timezone for the work-date cut, stored as `date`.
- NFR-EQU-005 Every user-visible string goes through i18n (ID and EN); numbers use the shared formatters.
- NFR-EQU-006 Accessibility: the grid is keyboard operable with labelled inputs; AA contrast; no colour-only
  status (`axe-core` gate).

## 5. Data model sketch (contract for build; names final at plan time)

| table | key columns |
|---|---|
| `equipment_assets` | id, org_id, code, name, default_unit, external_tier null, external_ref null, archived_at |
| `equipment_usage_entries` | id, org_id, asset_id, project_id, work_date, quantity numeric(6,2), unit `hours\|days`, kind `work\|standby`, fuel_litres null, trips int null, note, status, author_id, approver_id null, approved_at null, archived_at; unique (org, asset, project, work_date, kind) |
| `equipment_costing_settings` | id, org_id, asset_id, setting_key, version, is_current, basis, work_rate null, standby_rate null, rate_unit null, driver null, match_account / match_account_group / match_cost_center / match_party_type / match_party (as `cost_attribution_rules`), effective_from, effective_to null, created_by, created_at |

RPCs (security definer, org from JWT): `transition_equipment_usage(p_id, p_to)`,
`save_equipment_costing(p_setting jsonb)`, `end_equipment_costing(p_setting_key, p_effective_to, p_expected_version)`,
`preview_equipment_costing(p_setting jsonb)`, `list_equipment_allocations(p_asset_id, p_from, p_to)`,
`list_equipment_usage_totals(p_project_id|p_asset_id, p_from, p_to)`.
Errors reuse #1271's codes: `42501`, `22023`, `P0002`, `23505`, `40001`.

`actual_cost` plugs into `cost_attribution_allocations()` as a rule whose targets come from usage share per period
instead of fixed percent rows (a `basis` discriminator), so the winner/specificity logic and rounding stay in one
place. Do not create a second allocation engine.

## 6. Roles and SoD

| Action | Who | Server enforcement |
|---|---|---|
| Log, submit own usage | Engineer and above | own-row RLS, column-pinned |
| Approve / reject usage | PM (own projects), Executive, Finance, Admin; never the author | transition RPC re-asserts approver ≠ author + org + role + project |
| Set / end costing basis and rates | Admin, Finance | RPC; versioned; audited |
| Read amounts | Admin, Finance, Executive, PM | RLS / RPC audience |
| Hard delete | Admin | restrictive DELETE policy; default is archive |

Money-setting (rates, driver, match) is separated from usage approval by role: a PM can approve hours but cannot
change what an hour is worth. pgTAP proves each denial (a hidden button is not enough, ADR-0019).

## 7. ERP posting via the adapter contract

- **Reads (in scope, when #1511/#899 land):** the asset register is read through the existing
  `getByExternalId` / `listChangesSinceWatermark` contract for an `assets` domain, into a machine-written mirror,
  for ERPNext and Odoo alike. PMO resolves `equipment_assets.external_ref` against it. Until then the thin
  reference (FR-EQU-022) is the fallback and works without an ERP.
- **Writes (not built in v1, default per OQ-1):** nothing is posted. The ledger already holds the real cost for
  `actual_cost` (allocation only re-divides it); a `hire_rate` charge nets to zero company-wide.
- **If OQ-1 is answered "post":** one command per (org, project, asset, period) with a deterministic idempotency
  key through the ADR-0058 fenced outbox, draft-then-submit, a different user submits (OD-SAR-DRAFT-SUBMIT),
  honest outcome states (never "posted" before the ERP commits), mirror reconciliation, and the full
  money-path invariants (`docs/money-path-primer.md`). ERPNext maps to a Journal Entry carrying project and cost
  centre; Odoo maps to analytic lines on the project's analytic account (the O7 labour-cost pattern). Parity is
  required before either ships: same canonical `PmoRecord`, per-adapter body builders and recovery probe. That
  would be its own money-tier slice with its own spec.
- Usage itself stays **PMO-owned** (ADR-0094): approvals, entries and settings live in PMO; the ERP never
  becomes writer of a usage record.

## 8. Acceptance criteria (Given / When / Then)

| AC | Given / When / Then | Owner |
|---|---|---|
| AC-EQU-001 | **Issue acceptance.** Given one asset with approved usage on projects P1 (6 h) and P2 (2 h) and **no rate set**, when the org's configured `actual_cost` allocation is applied to a 800.00 pool, then usage shows 6 h / 2 h, P1 is allocated 600.00 and P2 200.00, the drill-down shows pool, driver, shares and version, and no rate was needed | pgTAP + Vitest |
| AC-EQU-002 | Given an asset with `basis = none` or no setting, when usage is logged and approved on two projects, then usage totals show per project and no amount is shown or computed | pgTAP |
| AC-EQU-003 | Given `hire_rate` 50.00/h work and 20.00/h standby, when 10 h work and 4 h standby are approved on P1, then the charge is 580.00 | pgTAP |
| AC-EQU-004 | Given a pool of 100.00 split 1/3 : 1/3 : 1/3 over three projects, when allocated, then amounts are 33.33, 33.33, 33.34 and sum to 100.00 | pgTAP |
| AC-EQU-005 | Given a month with a pool and zero approved driver units, when allocated, then nothing is allocated and the pool shows as unallocated with the reason | pgTAP |
| AC-EQU-006 | Given draft and rejected entries, when allocating, then only approved entries count | pgTAP |
| AC-EQU-007 | Given an entry's author, when they approve it, then the RPC refuses; another permitted user succeeds; every transition has an audit row | pgTAP |
| AC-EQU-008 | Given a setting v1 and a later v2 with `effective_from` mid-year, when allocating the whole year, then periods before the change use v1, after use v2; a stale `expected_version` is refused | pgTAP |
| AC-EQU-009 | Given a ledger line matched by a cost attribution rule and an equal-or-less specific equipment setting, when allocating, then the line goes to one winner only, and a conflicting save is refused | pgTAP |
| AC-EQU-010 | Given `actual_cost` allocations and an account mapped to a budget category, then `attributed_to_date` in that category rises, `tagged_to_date` is unchanged, and org-wide tagged + attributed ≤ ledger total | pgTAP |
| AC-EQU-011 | Given no equipment settings, then `project_mapped_actuals`, `get_project_finances` and both dashboards are byte-identical to before | pgTAP |
| AC-EQU-012 | Given roles: Engineer logs own usage, cannot approve or read amounts; PM approves own-project usage, cannot save a setting; Finance/Admin save settings; other org reads nothing and cannot target a foreign project/asset; no direct table writes | pgTAP |
| AC-EQU-013 | Given an OAuth API client, when Finance/Admin call preview/save/list it succeeds and an Engineer client is refused | pgTAP |
| AC-EQU-014 | Given a draft setting, when previewed then saved, then preview rows equal the saved allocations per project per month | pgTAP |
| AC-EQU-015 | Given an asset logged in hours, when a `units` setting is saved after a day entry exists in the window, then the save is refused (mixed units) | pgTAP |
| AC-EQU-016 | Given connected ERP and an allocation, then no ERP write is attempted and no mirror/snapshot row changes | pgTAP + deno |
| AC-EQU-017 | Given the usage grid, when a user logs, submits and an approver approves, then totals and the project panel update; keyboard-only operable | Vitest/RTL + axe |
| AC-EQU-018 | CLI `usage list`, `costing preview`, `costing set --dry-run`, `costing list` | Vitest (CLI) |
| AC-EQU-019 | One curated e2e journey: log on two projects, approve, set actual-cost basis, see both allocated amounts on the project Finances panel | Playwright (one) |

## 9. Risks the build must design against

1. **Double count:** allocated cost counted twice (ledger tagged + attributed + recharge). One winner per line;
   `hire_rate` charge kept out of the ledger-derived figures unless OQ-3 says otherwise, and always labelled.
2. **Silent drop:** pools with no usage vanish. They show as unallocated (FR-EQU-042).
3. **Wrong number on screen:** drill-down must recompute from the same inputs; PostgREST 1000-row cap on any
   usage list read (page or aggregate in SQL).
4. **Self-approval and rate/approval collusion:** separated by role (§6).
5. **Restatement:** approved usage immutable; setting changes are forward-effective and versioned.

## 10. Open questions (owner signs; recommended default in bold)

- **OQ-1 Post to the ERP ledger?** Default: **no, read-side management costing only** (like #1271), the ledger
  already holds the real cost. Revisit as its own money slice if a client wants intra-company recharges booked.
- **OQ-2 What is "another approved allocation basis"?** Default: **a choice of driver among logged measures
  (units, fuel litres, trips)**, plus fixed percentages via the existing cost attribution rule. Anything else
  (revenue share, custom weights) is a follow-up.
- **OQ-3 Does a hire-rate charge count in budget-vs-actual (`actuals_to_date`)?** Default: **yes, in a category
  the org maps for equipment, shown as a separate internal-charge field**, because that is the point of a hire
  rate. Risk: project totals exceed the ledger by the recharge. Alternative: show beside, not inside.
- **OQ-4 Allocation period.** Default: **calendar month** (matches budget phasing and statements). Per-day or
  per-week is a follow-up.
- **OQ-5 Who logs?** Default: **any Engineer-or-above logs for any asset on projects they are a member of;**
  assigning named operators per asset is a follow-up.
- **OQ-6 Standby.** Default: **a recorded kind, charged only when a standby rate exists;** under
  `actual_cost` standby units count toward the driver at weight 1 only if the org ticks "count standby" (default
  off, so idle time does not shift cost onto projects).
- **OQ-7 Same-day over 24 h.** Default: **warn, do not block** (shifts and rounding); block only per-row
  limits.
- **OQ-8 Entry approval granularity.** Default: **per entry, with bulk approve for one asset-week;** no
  separate daily sheet.
- **OQ-9 Asset reference before the register exists.** Default: **thin hand-made reference now, adopted to the
  mirror when #1511/#899 ship;** merge rule: match by code, never auto-merge, Admin confirms.

## 11. Follow-ups (not in this issue)

Client billing by contract rate; offline/phone capture (T9) and site daily report (T10) writing these entries;
register and maintenance screens (#1511, #899); ledger posting of recharges (OQ-1); telematics import;
per-operator assignment; depreciation by usage (units-of-production) as an ERP-side setting; per-day periods.
