# Plan — Odoo fleet and maintenance register (O8, #1511)

- **Route:** #1481, item O8 of `docs/plans/2026-10-30-epc-odoo-build-route.md` (owner-signed 2026-10-30; ADR-0094 accepted 2026-10-31). Extends #899 only in that Odoo becomes the asset register; depreciation stays #899's.
- **Acceptance (the issue's):** Given a registered asset, when a user records or updates maintenance in PMO, then the authoritative ERP record and PMO view reconcile.
- **Blocked by:** O1 (#1504) — shipped on `dev` (directory mirror 0421, sweep, discovery, companies commands through the outbox, S8). **Executor:** Orca bounded worker per slice (route item says so: no money posting, no SoD rule, no token custody change). F2 and F4 add service-role writers, so **security-auditor is mandatory** on those two.
- **Spec:** none exists. §1 below carries the requirements (EARS) and acceptance criteria (`FR-OFM-*`, `AC-OFM-*`) the slices build to; they only operationalise the signed route item and ADR-0094. **The Director confirms §0 and §1 with the owner before F2** (F1 is pure and reversible, so it may start now). If the owner wants a separate spec file, §1 moves verbatim to `docs/specs/odoo-fleet-maintenance.spec.md`.
- **Baseline:** every file cited as existing was read at `origin/dev` `97d781c5f` (2026-11-09). Migration head there is `0770`. Names marked *(new)* do not exist yet.
- **Migration numbers: 0795–0799 only.** Used: **0795** (F2), **0796** (F2), **0797** (F3). **0798 and 0799 are returned unused.** Collision: `scripts/renumber-migration.sh <old> <new>`.
- **Public repo:** fixtures use invented names (`PT Sinar Baja`, plate `B 1234 XY`, serial `EXC-001`), synthetic UUID prefix `15110000-`, `@example.com` emails, no client names or hosts.
- **Owner override (2026-11-09):** builders write the failing test first and the code that makes it pass, but **run no tests or heavy commands** (no vitest, Playwright, pgTAP, `db reset`, `ux-proof`, typecheck, build). Allowed: `npx eslint --max-warnings=0 <touched files>`, `npm run check:guards`, pure self-tests (`node scripts/check-isolation-denominator.mjs --self-test`). CI is the test gate. The verify commands in each task are what CI (or a builder, once the override lifts) runs; they are written out so the slice is complete either way.

---

## 0. Decisions (default taken; Director overrides)

| # | Question | Default taken | Why |
|---|---|---|---|
| **D1** | Where does PMO keep its copy of the register and maintenance records? | **In the shipped Odoo directory mirror** `external_master_records` (0421), as seven new kinds. No new table. | The mirror already gives per-org RLS, never-older-over-newer upserts, write-date cursors, daily census with tombstones, reset-kind and discard. Seven `KindSpec` lines reuse all of it. `ponytail:` a register is hundreds of rows per org and maintenance a few thousand a year; give maintenance its own table when an org passes 50k rows (the #1761 trigger). |
| **D2** | What is "the asset" in PMO? | **`equipment_assets` stays the one PMO asset handle** (usage, costing, T&M rates point at it). A linked asset carries `external_tier = 'odoo'`, `external_ref = '<kind>:<odoo id>'` in the columns #1519 reserved for exactly this (`0447_equipment_usage.sql:27-28`, OQ-9). | #1519 OQ-9 ruling: "adopted to the mirror when #1511/#899 ship (match by code, never auto-merge, Admin confirms)". No second asset table. |
| **D3** | Which Odoo models? | Fleet: `fleet.vehicle`, `fleet.vehicle.model`, `fleet.vehicle.log.services`, `fleet.service.type`. Maintenance: `maintenance.equipment`, `maintenance.request`, `maintenance.stage`. Anchor: `ir.model.data`. All stock Community; **both apps required** to employ. | Bed has both installed (`scripts/odoo-dev-bed.sh:16`, bed report row "fleet.vehicle … maintenance.request: verified readable"). A fleet-less org is a follow-up when a client asks. |
| **D4** | What does PMO write? | Create and update of: a vehicle, an equipment item, a maintenance request (equipment), a service log (vehicle). Archive = update `active = false`. **No delete, no odometer push, no usage hours to Odoo.** | The issue: PMO is the only interface, so the register and its maintenance must be editable without Odoo's UI. Usage stays PMO-owned (ADR-0094, #1519); pushing hours or odometer to Odoo is a follow-up, not required by any AC. |
| **D5** | How do writes reach Odoo? | Through **`adapter-dispatch` and the shipped outbox** (`dispatchMoneyWrite`, `MONEY_TIERS` includes `odoo`, `adapterSeam/dispatch.ts:766`), domain **`equipment`**, exactly as Odoo companies do (`adapter-dispatch/odooCompanies.ts`). A create is keyed by the server from the PMO record id; a probe miss on a create is **held, never reissued**; an update is a plain field write and may be resent. | Same recovery semantics as the shipped partner sends (Q3 of `2026-11-07-odoo-master-data.md`): Odoo has no unique key on these models, so a miss cannot prove the create never landed. |
| **D6** | Anchor for a PMO-made Odoo record | Stock external identifier (`ir.model.data`, module `pmo`, name from the key), written right after create — the purchase precedent (`procurementAdapter.ts:99-104`). | Survives edits in Odoo; the create-to-anchor gap ends held for a person, which is acceptable for a non-money record. |
| **D7** | Who may write? | **Register** (vehicle, equipment): Admin and Project Manager (the shipped asset rule, `equipment_assets` RLS FR-EQU-022). **Maintenance** (request, service log): every active role (Admin, Executive, Project Manager, Finance, Engineer). Server-enforced in dispatch; `can()` mirrors it as UX. | Crews report breakdowns; the register is the asset book. When #902 lands these become matrix actions `equipmentRegister.write` and `maintenance.write`. |
| **D8** | While Odoo owns `equipment`, can a person still hand-make a PMO-only asset? | **No.** Restrictive RLS refuses client insert, update and delete on `equipment_assets` while the org employs `equipment` under Odoo; new assets come from the register (created in PMO through Odoo, or brought in from Odoo). | ADR-0094: the connected ERP owns the asset register; a second hand-kept list would diverge. Before employ, nothing changes for anyone. |
| **D9** | Adoption at employ time | **One screen, auto-proposed, "Accept all"** (owner rule 2026-10-16: integrations map once at setup, no per-item clicking). Each Odoo asset is proposed as *link to the PMO asset whose code equals its plate (vehicle) or serial (equipment)*, else *add as a new PMO asset*. Ties and doubtful pairs are proposed as *add new*, never merged. A row can be overridden before accepting. | OQ-9 "match by code, never auto-merge, Admin confirms". |
| **D10** | What the feed changes on a linked PMO asset | **Name** follows Odoo; **archived in Odoo ⇒ archived in PMO** (one way). The PMO **code never changes** after link. | Code is the key in T&M, CLI and costing; renaming it from a feed would break those. One-way archive: an Odoo restore cannot collide with the live-code unique index (`equipment_assets_code_live`) and pin the cursor. `ponytail:` restore from Odoo is a follow-up. |
| **D11** | Service log cost (`fleet.vehicle.log.services.amount`) | Read and written as **"cost recorded in Odoo"**, shown separately; **it posts nothing to the ledger and feeds no PMO figure.** | It is a fleet register field, not a journal line (V-OFM-7 checks no `account.move` is created). Equipment actual-cost allocation (#1519 S3) reads the ledger only, so nothing is counted twice. |
| **D12** | Feature gate | **None new.** The screens appear when the org employs `equipment` under Odoo; the equipment rail item is already ungated (`Rail.tsx:72-73`). | No new entitlement to manage; ownership is the switch. |
| **D13** | Recovery of an unconfirmed command | The **sync path** (same idempotency key; the asset page's "Check again") plus the **sweep's inbound read**, which converges the view within one tick whatever happened. **No outbox recovery pass for `equipment`** in this issue. | The companies precedent. `ponytail:` add an `equipment` branch to `_shared/odooOutboxRecovery.ts` if held rows pile up in practice. |

---

## 1. Requirements and acceptance criteria

### 1.1 Functional requirements (EARS)

- **FR-OFM-001** — When an Admin employs `equipment` under Odoo, the system SHALL refuse unless the Odoo connection is activated, no ERPNext connection is active, and the stored capability snapshot shows every D3 model present, readable, and (for vehicle, equipment, maintenance request, service log and `ir.model.data`) creatable and writable; the refusal SHALL name the first missing model.
- **FR-OFM-002** — Where an org employs `equipment` under ERPNext, the system SHALL refuse with "The equipment register is available with Odoo only".
- **FR-OFM-010** — While the org employs `equipment` under Odoo, the sweep SHALL mirror the seven D3 kinds into `external_master_records` within its tick budget, never writing older over newer, and SHALL tombstone (never delete) what the daily census no longer sees.
- **FR-OFM-011** — While the org does not employ `equipment`, or the snapshot does not show a model readable, the sweep SHALL read none of these kinds and SHALL NOT fail the tick.
- **FR-OFM-012** — When the feed applies a vehicle or equipment row linked to a PMO asset, the system SHALL set the PMO asset's name to Odoo's and SHALL archive the PMO asset when Odoo archived or removed it; it SHALL NOT change the PMO code.
- **FR-OFM-020** — When an Admin opens asset matching, the system SHALL propose, for every unlinked mirrored vehicle and equipment item, a link to the one live unlinked PMO asset whose code equals the plate or serial (trimmed, case-insensitive), else a new PMO asset; two candidates SHALL be proposed as new, never linked.
- **FR-OFM-021** — When an Admin accepts the matches, the system SHALL apply every accepted pair in one transaction, audited, refusing a PMO asset or Odoo asset already linked and a foreign-org id.
- **FR-OFM-022** — While the org employs `equipment` under Odoo, the system SHALL refuse client inserts, updates and deletes of `equipment_assets`.
- **FR-OFM-030** — When an Admin or Project Manager saves a vehicle or equipment item in PMO, the system SHALL create or update it in Odoo through the outbox and, on Odoo's confirmation, SHALL show the Odoo record and (for a create) a linked PMO asset; nothing SHALL be shown as saved before Odoo confirmed.
- **FR-OFM-031** — When any active member records or updates a maintenance request (equipment) or service log (vehicle) in PMO, the system SHALL create or update it in Odoo through the outbox and, on Odoo's confirmation, SHALL show the Odoo record in PMO.
- **FR-OFM-032** — If a create's outcome is unknown and the anchor probe finds nothing, then the system SHALL hold the command for a person and SHALL NOT create it again; the asset page SHALL show the held change.
- **FR-OFM-033** — The system SHALL refuse a register write from a role other than Admin or Project Manager, a maintenance write from an inactive member, a maintenance record for a PMO asset not linked to an Odoo asset of the matching kind, and a target in another org, each before any outbox row.
- **FR-OFM-040** — When a user opens an asset, the system SHALL show its register fields, its maintenance records (newest first, bounded), when PMO last read them from Odoo, and the connection state when Odoo is not healthy.
- **FR-OFM-041** — While Odoo cannot be reached, the system SHALL keep showing the last copy with its time and SHALL disable register and maintenance writes with the reason.

### 1.2 Non-functional

- **NFR-OFM-001** — No Odoo customisation: stock models and fields only; every field name lives in `adapterSeam/odoo/assets/*` and the bed verdicts.
- **NFR-OFM-002** — The new kinds add at most 2 calls per kind to a tick's reserve and only for orgs that employ `equipment`.
- **NFR-OFM-003** — All copy in English and Indonesian.

### 1.3 Acceptance criteria (Given/When/Then; owning layer in §6)

- **AC-OFM-001** — Given an activated Odoo connection whose snapshot lacks `maintenance.request` create access, when an Admin employs `equipment`, then it is refused naming `maintenance.request`, and with a full snapshot it succeeds and is audited.
- **AC-OFM-002** — Given an org that employs `equipment` under ERPNext is attempted, then it is refused with the Odoo-only words.
- **AC-OFM-010** — Given Odoo rows of each new kind, when parsed, then each yields its directory row and a malformed row is rejected whole.
- **AC-OFM-011** — Given an org that does not employ `equipment`, when the sweep ticks, then no asset kind is read and the reserve is unchanged; given it does, then the seven kinds are read in order after the directory kinds.
- **AC-OFM-012** — Given a PMO asset linked to Odoo equipment 42, when a page renames equipment 42 and a later page archives it, then the PMO asset has the new name, then is archived, and its code is unchanged; an older page after a newer one changes nothing.
- **AC-OFM-020** — Given PMO assets `EXC-001` and `GEN-01` and Odoo equipment with serials `exc-001 ` and none, when matching is proposed, then the first is proposed as a link and the second as new.
- **AC-OFM-021** — Given accepted matches, when applied, then links and new assets exist, an already-linked target is refused, a non-Admin is refused, and one audit row records the batch.
- **AC-OFM-022** — Given an org that employs `equipment` under Odoo, when a Project Manager inserts, renames or deletes an `equipment_assets` row directly, then each is refused; before employ, the same writes succeed.
- **AC-OFM-030** — Given a lost answer after Odoo created a maintenance request, when the same command is sent again, then exactly one request exists in Odoo and PMO shows it once; with the anchor removed in Odoo, the command is held and nothing is created again.
- **AC-OFM-031** — Given an Engineer, when they send a vehicle create, then it is refused before any outbox row; when they send a maintenance request for a linked asset, then it is accepted.
- **AC-OFM-040** — Given an asset with maintenance records, when its page renders, then the register card, the records newest first, the "last read from Odoo" time and every state of §5 render with the right copy.
- **AC-OFM-090** *(the issue's acceptance, cross-stack, on the bed)* — Given a registered Odoo equipment item linked to a PMO asset, when a user records a maintenance request in PMO and then moves it to a done stage, then Odoo holds one request with that subject, type, schedule and done stage, and the PMO asset page shows the same; when the request is edited directly in Odoo, then after one sweep PMO shows the edit.

---

## 2. Data flow

```
                         PMO UI (asset list · match · asset detail · record maintenance)
                                │ reads (RLS)                       │ writes
                                ▼                                   ▼
 external_master_records (kinds vehicle, vehicle_model,     repositories.equipment ─► dispatchDomainCommand('equipment', …)
   equipment, maintenance_request, maintenance_stage,                                  │
   vehicle_service, service_type)  +  equipment_assets               adapter-dispatch: authGuard (owner tier, role, kind→domain)
                ▲      ▲ name / archive (FR-OFM-012)                  → resolveOdooEquipmentAdapter (kind role gate, link check,
                │      │                                                 capability gap) → dispatchMoneyWrite (outbox, claim,
                │      │                                                 probe by ir.model.data anchor, held on create miss)
                │  apply_odoo_master_rows ◄── readModel/equipment.ts ◄── commit result (row read back from Odoo)
                │  record_odoo_asset_created (create of a vehicle/equipment also inserts + links the PMO asset)
                │                                                      │
 apply_odoo_master_page ◄── odoo-sweep tick (asset kinds gated by     ▼
   (cursor + rows)            employ + snapshot)  ◄──── Odoo JSON-2 (stock fleet + maintenance) ◄── create / write
```

- **Odoo is authoritative** for the register and maintenance records (ADR-0094 "asset and maintenance register"). PMO's copy is the mirror plus the linked `equipment_assets` row. PMO never shows a write as done until Odoo answered (FR-OFM-030/031).
- **Where #1511 meets #1519** (equipment usage, shipped as 0447/0460/0471/0497/0536/0680):
  - `equipment_assets` is shared and **not forked**: #1511 fills its reserved `external_tier/external_ref`, renames and archives it from the feed (D10), and stops hand edits while Odoo owns the register (D8). Usage entries, costing settings and T&M rate lines keep pointing at the same ids, so an adopted asset keeps all its history.
  - Usage (hours, days, fuel, trips) stays PMO-owned and is never sent to Odoo (D4). Costing is untouched: actual-cost allocation reads the ledger (#1519 S3), and the service-log cost is not a ledger line (D11).
  - The asset detail page (`pages/equipment/EquipmentAssetDetail.tsx`, built by #1519 S6) gains the register card and the maintenance section beside its costing and allocations; the asset list gains the register columns.
- **Not a Posture-B side mirror** (ADR-0059): the ERP owns these records, so nothing is added to the 0136 side-mirror inventory.

---

## 3. What exists on dev (reuse; never re-invent)

| Need | Exists | Where |
|---|---|---|
| Directory mirror table, RLS, service-only page apply, census, reset, discard | `external_master_records`, `apply_odoo_master_page`, `mark_odoo_census_seen`, `finish_odoo_census`, `reset_odoo_sync_kind`, `discard_odoo_mirror` | `0421_odoo_master_records.sql:14-148`; kind list last widened by `0509_odoo_journal_kind.sql:6-17` (the pattern F2 copies) |
| Kind specs and parsers | `DIRECTORY_KINDS`, `KIND_SPECS`, `KindSpec`, `parsePage`, `missingForKind`, `companyDomain` | `pmo-portal/src/lib/adapterSeam/odoo/kinds.ts` |
| Discovery snapshot | `discoverCapabilities`, `O1_MODELS`, `LATER_MODELS` (already lists `fleet.vehicle`, `maintenance.equipment`), `probeModel` | `odoo/discovery.ts:20-110` |
| Capability gap pattern | `procurementCapabilityGap` | `odoo/purchase/capabilities.ts` |
| Sweep tick, kind loop, reserve | `ODOO_KIND_ORDER`, `RESERVE_PER_KIND`, `readable`, `kindDeps`, loop at `:235-245` | `supabase/functions/_shared/odooSweep.ts:20-245` |
| Generic kind runner | `runKind(spec, cursor, deps)`, `runCensus`, `odooKindReaders(call, spec, companyId)` | `odoo/sweep.ts:66-124` |
| Non-money Odoo command through the outbox | companies: `resolveOdooCompaniesAdapter`, `resolveOdooCompaniesMoneyOutboxDeps` (create → anchor probe, held; update → resend) | `adapter-dispatch/odooCompanies.ts` |
| Odoo registry and outbox deps router | `ODOO_ADAPTER_REGISTRY`, `resolveOdooMoneyOutboxDeps` | `adapter-dispatch/odooAdapters.ts:139`, `odooMoneyOutbox.ts:172-176` |
| Owner tier lookup, role gate, kind→domain | `OWNING_TIERS`, `moneyWriteRolesForDomain`, `KIND_DOMAIN` check | `adapter-dispatch/authGuard.ts:58,107-160`, `_shared/moneyWriteRoles.ts:18-32`, `adapterSeam/erpnext/feedKinds.ts:20` |
| Post-commit read-model writer registry | `READ_MODEL_WRITERS` | `adapter-dispatch/readModelWriters.ts:31-40`, writers in `readModel/` |
| `ir.model.data` anchor write and probe | `anchorDocument`, `probeOdooByAnchor`, `externalIdentifier`, `odooExternalRef` | `odoo/procurementAdapter.ts:96-104`, `odoo/purchase/anchors.ts`, `odoo/purchase/recoveryProbe.ts` |
| Employ guard | `admin_change_domain_ownership` (latest body), `odoo_companies_employ_blocker` | `0743_companies_employ_guard.sql` |
| Employ verb | `employDomain`, `EMPLOYABLE` | `external-set-company/odoo/purchasing.ts:11-31` |
| FE connection state | `useOdooConnection`, `OdooConnectionBanner`, `displayedConnection` | `src/hooks/useOdoo.ts:7`, `src/components/integrations/odoo/OdooConnectionBanner.tsx` |
| FE setup checklist | `OdooSetupChecklist` rows | `src/components/integrations/odoo/OdooSetupChecklist.tsx:89-101` |
| FE dispatch transport | `dispatchDomainCommand(domain, op, record, { idempotencyKey })` | `src/lib/adapterSeam/dispatchClient.ts:132` |
| FE error copy | `pushErrorCopy` | `src/lib/adapterSeam/pushErrorCopy.ts` |
| Equipment DAL, hooks, pages, copy | `listAssets/createAsset/updateAsset/deleteAsset`, `useEquipmentAssets/useCreateAsset/…`, `EquipmentAssets.tsx`, `EquipmentAssetDetail.tsx`, `public/locales/{en,id}/equipment.json` | `src/lib/db/equipment.ts`, `src/hooks/useEquipment.ts`, `pages/equipment/*` |
| Policy entities | `equipmentAsset`, `equipmentUsage`, `equipmentCosting` | `src/auth/policy.ts:123-125,723-735` |
| Bed and bed-gated e2e pattern | `scripts/odoo-dev-bed.sh` (fleet + maintenance installed), `scripts/with-odoo-lock.sh`, `e2e/AC-OCI-100-…spec.ts:11-27`, allowlist `scripts/check-e2e-skips.mjs:43-47` | |

---

## 4. Bed claims to verify (V-OFM), and what F1 assumes meanwhile

F1's fake and parsers are written to the stock field names below (Odoo 17–19 sources; the research cites `addons/fleet` and `addons/maintenance`). **F0 confirms each on the Odoo 20 bed** when heavy commands are allowed again; a verdict that differs is a one-line change in `odoo/assets/kinds.ts` or `bodies.ts` plus its fixture. F7 does not start until F0 is recorded.

| V | Claim | Used by |
|---|---|---|
| V-OFM-1 | `fleet.vehicle` fields `name, license_plate, vin_sn, model_id, driver_id, odometer, odometer_unit, acquisition_date, company_id, active, write_date`; `model_id` is required on create | kinds, vehicle body |
| V-OFM-2 | `fleet.vehicle.model` fields `name, brand_id, write_date` (no company field) | kinds |
| V-OFM-3 | `maintenance.equipment` fields `name, serial_no, category_id, model, location, company_id, active, write_date`; only `name` required | kinds, equipment body |
| V-OFM-4 | `maintenance.request` fields `name, equipment_id, maintenance_type (corrective/preventive), stage_id, request_date, schedule_date, close_date, duration, priority, description (html), company_id, archive, write_date`; `maintenance_team_id` defaults; `active` absent (archive flag instead) | kinds, request body |
| V-OFM-5 | `maintenance.stage` fields `name, sequence, done, write_date`; moving a request to a `done` stage sets `close_date`; `write_date` moves on a stage change | kinds, AC-OFM-090 |
| V-OFM-6 | `fleet.vehicle.log.services` fields `vehicle_id, service_type_id (required), date, state (new/running/done/cancelled), amount, odometer, vendor_id, description, notes, company_id, active, write_date` | kinds, service body |
| V-OFM-7 | Creating or editing a service log with an amount creates no `account.move` | D11 |
| V-OFM-8 | `fleet.service.type` fields `name, category, write_date` | kinds |
| V-OFM-9 | The integration user can `has_access` read/create/write on the four writable models and create on `ir.model.data` (the elevated grant the purchase slice already requires; an OWNER go-live check) | discovery, employ |
| V-OFM-10 | An `ir.model.data` row with module `pmo` survives edits and archive of the anchored record | anchor probe |

---

## 5. Screens and every state (UI lane; F6)

Tokens and primitives only (`DESIGN.md`; `ListPage`, `DataTable`, `StatusPill`, `EntityFormModal`, `useEntityForm`, `TextField`, `SelectField`, `Combobox`, `FormGrid`, `ConfirmDialog`, `ListState`, `OdooConnectionBanner`). Composition: the Director's one rendered review (impeccable + taste), owner judges screenshots. Dates via the shared formatters; the em dash only as the empty marker.

### 5.1 Equipment assets list — `/equipment/assets` (existing page, extended)

When the org employs `equipment` under Odoo (else the page is exactly today's):
- Description becomes "Your equipment and vehicles, kept in Odoo. Open one to see its maintenance, costing and what each project carries."
- Columns: Code · Name · **Type** (Vehicle / Equipment) · **Plate or serial** · Default unit · **Register** pill (Linked to Odoo · Archived in Odoo · Removed from Odoo · Not in the Odoo register) · **Open maintenance** (count of not-done requests / not-done service logs; em dash when none).
- Primary action "New asset" (Admin, PM; `CanWrite entity="equipmentRegister"`) opens the register form (§5.4), not the thin form.
- Row menu: no Archive/Delete (they are refused by D8); "Archive in Odoo" (Admin, PM) opens a `ConfirmDialog` and sends `active = false`.
- **Admin banner** when unlinked Odoo assets exist: "{{count}} Odoo assets are not matched to PMO yet." + button "Review matches" → `/equipment/assets/match`.
- States: loading (`ListState loading`), error with Retry, empty ("No equipment or vehicles in Odoo yet" / "An Admin or Project Manager adds them here; they are saved in Odoo."), truncated note (existing), Odoo not healthy → `OdooConnectionBanner` above the table and "New asset" disabled with the reason as its tooltip and `aria-describedby`.

### 5.2 Match Odoo assets — `/equipment/assets/match` (new route, Admin only)

- Title "Match Odoo assets"; subtitle "PMO proposed a match for every Odoo vehicle and equipment item. Check the list, then accept all."
- Table: Odoo asset (name, plate/serial, type) · Proposal (`SelectField` per row: "Link to {{code}} {{name}}" for each candidate, "Add as a new PMO asset", "Skip for now") · Why ("Same code" / "No PMO asset has this code" / "Two PMO assets have this code").
- Footer: "Accept all" (primary) and "Cancel". One `ConfirmDialog`: "Apply {{linked}} links and add {{added}} new assets?".
- States: loading; error with Retry; nothing to match ("Every Odoo asset is matched." + link back); saving (button busy, table read-only); partial refusal (a row already linked by someone else: inline row error "Already linked. Refresh the list.", others not applied because it is one transaction → the whole batch is refused, the alert names the row); success toast "Matches applied" → back to the list. Non-Admin: route renders the not-allowed state of `FeatureRoute`/policy.

### 5.3 Asset detail — `/equipment/assets/:assetId` (existing page, extended)

- **Register card** (when linked): Type, Plate/serial, Model (vehicle model or equipment model), Driver (vehicle) or Category (equipment), Odometer with unit (vehicle), Acquired (vehicle) or Location (equipment), "Last read from Odoo {{time}}" (`as_of`). Action "Edit in register" (Admin, PM) → §5.4 prefilled.
- **Not linked** (Odoo owns the register but this PMO asset has no link): info strip "This asset is not in the Odoo register. An Admin can match it." (+ "Review matches" for Admin). No maintenance section.
- **Maintenance section**: heading "Maintenance"; action "Record maintenance" (all active roles). Equipment: table Subject · Type (Corrective / Preventive) · Stage · Scheduled · Closed · Duration (h). Vehicle: table Service · Date · State (New / In progress / Done / Cancelled) · Cost recorded in Odoo · Odometer · Vendor. Newest first, 50 rows, "Showing {{shown}} of {{total}}". Row activates the edit modal.
- **Waiting strip** (outbox rows for this asset's records in state `pending|committing|committed|quarantined`): "Waiting for Odoo to confirm {{count}} change(s)." + "Check again" (re-sends the same command with its stored idempotency key). **Held** rows: "Odoo did not confirm {{count}} change(s). An Admin needs to check them in Odoo before anything is sent again." (no button).
- States: loading; error with Retry; empty maintenance ("No maintenance recorded yet."); Odoo not healthy → banner, write buttons disabled with reason; archived in Odoo → pill and write buttons hidden.

### 5.4 Register form (modal; create and edit)

- Type toggle (create only): Vehicle / Equipment.
- Vehicle: Plate (required; becomes the PMO code), Model (`Combobox` over mirrored `vehicle_model`, required), VIN, Acquired (date), Default unit (hours/days, PMO-side).
- Equipment: Name (required), Serial number (required; becomes the PMO code), Model, Location, Default unit.
- Submit "Save in Odoo". While sending: busy; success toast "Saved in Odoo"; held → toast warning "Odoo did not confirm yet. The asset page shows it as waiting."; refusal → `SubmitError` from `pushErrorCopy` (plain words, names the field or model).

### 5.5 Maintenance form (modal; create and edit)

- Equipment request: Subject (required), Type (Corrective/Preventive, default Corrective), Stage (`SelectField` over mirrored stages by sequence; default the first), Scheduled (date-time), Duration (hours, ≥ 0), Notes (plain text, ≤ 2000).
- Vehicle service: Service (`SelectField` over mirrored service types, required), Date (required, default today), State (New/In progress/Done/Cancelled), Cost recorded in Odoo (money, optional, "Not posted to accounts" help text), Odometer (≥ 0), Notes.
- Submit "Save in Odoo"; same busy/success/held/refused handling as §5.4.

### 5.6 Odoo setup checklist (existing)

New row "Equipment and maintenance in Odoo" (done when `equipment` is owned by `odoo`), hint "After this, Odoo keeps the equipment register and maintenance; PMO keeps usage." and, for an Admin when not done, a "Use Odoo for equipment" button calling `useOdooSetup('employ-domain')` with `{ domain: 'equipment' }`; the database's refusal text is shown inline.

### 5.7 Copy (en | id) — new keys

Namespace `equipment` unless marked `administration`. Builders add **both** files in the same commit.

| Key | en | id |
|---|---|---|
| `register.descriptionOdoo` | Your equipment and vehicles, kept in Odoo. Open one to see its maintenance, costing and what each project carries. | Peralatan dan kendaraan Anda, disimpan di Odoo. Buka salah satunya untuk melihat pemeliharaan, pembiayaan, dan beban tiap proyek. |
| `register.type` | Type | Jenis |
| `register.vehicle` | Vehicle | Kendaraan |
| `register.equipment` | Equipment | Peralatan |
| `register.plateOrSerial` | Plate or serial | Pelat atau nomor seri |
| `register.status` | Register | Register |
| `register.linked` | Linked to Odoo | Terhubung ke Odoo |
| `register.archived` | Archived in Odoo | Diarsipkan di Odoo |
| `register.removed` | Removed from Odoo | Dihapus dari Odoo |
| `register.notLinked` | Not in the Odoo register | Tidak ada di register Odoo |
| `register.openMaintenance` | Open maintenance | Pemeliharaan terbuka |
| `register.emptyOdoo` | No equipment or vehicles in Odoo yet | Belum ada peralatan atau kendaraan di Odoo |
| `register.emptyOdooSub` | An Admin or Project Manager adds them here; they are saved in Odoo. | Admin atau Manajer Proyek menambahkannya di sini; data disimpan di Odoo. |
| `register.unmatched` | {{count}} Odoo assets are not matched to PMO yet. | {{count}} aset Odoo belum dicocokkan dengan PMO. |
| `register.reviewMatches` | Review matches | Tinjau kecocokan |
| `register.archiveInOdoo` | Archive in Odoo | Arsipkan di Odoo |
| `register.archiveInOdooBody` | {{name}} is archived in Odoo and leaves the pickers. Its past usage, costing and maintenance stay. | {{name}} diarsipkan di Odoo dan tidak muncul lagi di pilihan. Riwayat pemakaian, pembiayaan, dan pemeliharaannya tetap ada. |
| `register.lastRead` | Last read from Odoo {{time}} | Terakhir dibaca dari Odoo {{time}} |
| `register.notInRegister` | This asset is not in the Odoo register. An Admin can match it. | Aset ini tidak ada di register Odoo. Admin dapat mencocokkannya. |
| `register.edit` | Edit in register | Ubah di register |
| `register.newTitle` | New asset in Odoo | Aset baru di Odoo |
| `register.editTitle` | Edit {{name}} | Ubah {{name}} |
| `register.plate` | Plate | Pelat nomor |
| `register.model` | Model | Model |
| `register.vin` | VIN | Nomor rangka (VIN) |
| `register.acquired` | Acquired | Tanggal perolehan |
| `register.serial` | Serial number | Nomor seri |
| `register.location` | Location | Lokasi |
| `register.driver` | Driver | Pengemudi |
| `register.category` | Category | Kategori |
| `register.odometer` | Odometer | Odometer |
| `register.save` | Save in Odoo | Simpan di Odoo |
| `register.saved` | Saved in Odoo | Tersimpan di Odoo |
| `register.held` | Odoo did not confirm yet. The asset page shows it as waiting. | Odoo belum mengonfirmasi. Halaman aset menampilkannya sebagai menunggu. |
| `register.writesOff` | Odoo cannot be reached, so changes are paused. | Odoo tidak dapat dihubungi, jadi perubahan dijeda. |
| `match.title` | Match Odoo assets | Cocokkan aset Odoo |
| `match.subtitle` | PMO proposed a match for every Odoo vehicle and equipment item. Check the list, then accept all. | PMO mengusulkan kecocokan untuk setiap kendaraan dan peralatan di Odoo. Periksa daftarnya, lalu terima semua. |
| `match.odooAsset` | Odoo asset | Aset Odoo |
| `match.proposal` | Proposal | Usulan |
| `match.why` | Why | Alasan |
| `match.linkTo` | Link to {{code}} {{name}} | Hubungkan ke {{code}} {{name}} |
| `match.addNew` | Add as a new PMO asset | Tambahkan sebagai aset PMO baru |
| `match.skip` | Skip for now | Lewati dulu |
| `match.sameCode` | Same code | Kode sama |
| `match.noCode` | No PMO asset has this code | Tidak ada aset PMO dengan kode ini |
| `match.twoCodes` | Two PMO assets have this code | Dua aset PMO memakai kode ini |
| `match.acceptAll` | Accept all | Terima semua |
| `match.confirm` | Apply {{linked}} links and add {{added}} new assets? | Terapkan {{linked}} hubungan dan tambahkan {{added}} aset baru? |
| `match.none` | Every Odoo asset is matched. | Semua aset Odoo sudah cocok. |
| `match.alreadyLinked` | Already linked. Refresh the list. | Sudah terhubung. Muat ulang daftar. |
| `match.applied` | Matches applied | Kecocokan diterapkan |
| `maintenance.title` | Maintenance | Pemeliharaan |
| `maintenance.record` | Record maintenance | Catat pemeliharaan |
| `maintenance.subject` | Subject | Perihal |
| `maintenance.kind` | Type | Jenis |
| `maintenance.corrective` | Corrective | Korektif |
| `maintenance.preventive` | Preventive | Preventif |
| `maintenance.stage` | Stage | Tahap |
| `maintenance.scheduled` | Scheduled | Dijadwalkan |
| `maintenance.closed` | Closed | Selesai pada |
| `maintenance.duration` | Duration (h) | Durasi (jam) |
| `maintenance.notes` | Notes | Catatan |
| `maintenance.service` | Service | Layanan |
| `maintenance.date` | Date | Tanggal |
| `maintenance.state` | State | Status |
| `maintenance.stateNew` | New | Baru |
| `maintenance.stateRunning` | In progress | Sedang berjalan |
| `maintenance.stateDone` | Done | Selesai |
| `maintenance.stateCancelled` | Cancelled | Dibatalkan |
| `maintenance.cost` | Cost recorded in Odoo | Biaya tercatat di Odoo |
| `maintenance.costHelp` | Not posted to accounts. | Tidak dibukukan ke akun. |
| `maintenance.vendor` | Vendor | Pemasok |
| `maintenance.empty` | No maintenance recorded yet. | Belum ada pemeliharaan yang dicatat. |
| `maintenance.showing` | Showing {{shown}} of {{total}} | Menampilkan {{shown}} dari {{total}} |
| `maintenance.waiting` | Waiting for Odoo to confirm {{count}} change(s). | Menunggu Odoo mengonfirmasi {{count}} perubahan. |
| `maintenance.checkAgain` | Check again | Periksa lagi |
| `maintenance.heldStrip` | Odoo did not confirm {{count}} change(s). An Admin needs to check them in Odoo before anything is sent again. | Odoo tidak mengonfirmasi {{count}} perubahan. Admin perlu memeriksanya di Odoo sebelum ada yang dikirim ulang. |
| `maintenance.newTitle` | Record maintenance | Catat pemeliharaan |
| `maintenance.editTitle` | Edit maintenance | Ubah pemeliharaan |
| `administration:odoo.checklist.equipment` | Equipment and maintenance in Odoo | Peralatan dan pemeliharaan di Odoo |
| `administration:odoo.checklist.equipmentHint` | After this, Odoo keeps the equipment register and maintenance; PMO keeps usage. | Setelah ini, Odoo menyimpan register peralatan dan pemeliharaan; PMO menyimpan pemakaian. |
| `administration:odoo.checklist.equipmentEmploy` | Use Odoo for equipment | Gunakan Odoo untuk peralatan |

`pushErrorCopy` codes added in F4 (namespace as the file uses): `equipment-not-linked` → "This asset is not linked to the Odoo register yet." / "Aset ini belum terhubung ke register Odoo."; `equipment-kind-mismatch` → "A vehicle takes a service log; equipment takes a maintenance request." / "Kendaraan memakai catatan servis; peralatan memakai permintaan pemeliharaan."; `register-role` → "Only an Admin or Project Manager can change the register." / "Hanya Admin atau Manajer Proyek yang dapat mengubah register.".

---

## 6. Traceability (each AC has exactly one owning test)

| AC | Owning layer | File (new unless noted) | Slice |
|---|---|---|---|
| AC-OFM-001 | pgTAP | `supabase/tests/odoo_equipment_employ.test.sql` | F2 |
| AC-OFM-002 | pgTAP | `supabase/tests/odoo_equipment_employ.test.sql` | F2 |
| AC-OFM-010 | Vitest | `pmo-portal/src/lib/adapterSeam/odoo/assets/kinds.test.ts` | F1 |
| AC-OFM-011 | Deno | `supabase/functions/odoo-sweep/odooSweep.test.ts` (append) | F2 |
| AC-OFM-012 | pgTAP | `supabase/tests/odoo_equipment_mirror.test.sql` | F2 |
| AC-OFM-020 | pgTAP | `supabase/tests/odoo_equipment_adoption.test.sql` | F3 |
| AC-OFM-021 | pgTAP | `supabase/tests/odoo_equipment_adoption.test.sql` | F3 |
| AC-OFM-022 | pgTAP | `supabase/tests/odoo_equipment_adoption.test.sql` | F3 |
| AC-OFM-030 | Deno | `supabase/functions/adapter-dispatch/odooEquipment.test.ts` | F4 |
| AC-OFM-031 | Deno | `supabase/functions/adapter-dispatch/odooEquipment.test.ts` | F4 |
| AC-OFM-040 | Vitest/RTL | `pmo-portal/pages/equipment/EquipmentAssetDetail.test.tsx` (append) | F6 |
| AC-OFM-090 | Playwright, bed-gated | `pmo-portal/e2e/AC-OFM-090-odoo-equipment-maintenance.spec.ts` | F7 |

Supporting (not owning) tests: discovery cases in `odoo/discovery.test.ts`, capability gap in `odoo/assets/capabilities.test.ts`, request bodies in `odoo/assets/bodies.test.ts`, adapter cases against `fakeOdoo` in `odoo/assets/adapter.test.ts`, the bed composite in `adapter-dispatch/odooEquipment.bed.test.ts`, DAL/hook tests, list and match page tests, i18n parity.

---

## 7. Slice map

| Slice | Contents | ACs owned | Migration | Blocked by | Worker tier | Ships |
|---|---|---|---|---|---|---|
| **F0** Bed verdicts | V-OFM-1..10 on the bed; record in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §"O8 findings" | evidence | none | heavy commands allowed again | cheap worker (GLM/DeepSeek) | docs only, push to dev |
| **F1** Read contract (pure) | asset kind specs + parsers, HTML-to-text, discovery `assets` block, capability gap, fake Odoo models | 010 | none | none | **Sonnet, ~2 h** | batchable |
| **F2** Mirror, sweep gate, employ | kinds in the DB, row apply split, asset name/archive propagation, sweep gating, employ blocker + ownership guard, employ verb | 001, 002, 011, 012 | **0795**, **0796** | F1 | Sonnet; **security-auditor mandatory** | alone (service-role writer + ownership guard) |
| **F3** Adoption and the PMO-asset guard | match proposal read, accept RPC, created-asset recorder, restrictive policies | 020, 021, 022 | **0797** | F2 | Sonnet | batchable with F5 |
| **F4** Commands through the outbox | Odoo equipment adapter, bodies, anchor, dispatch wiring, read-model writer, role and link gates, error copy | 030, 031 | none | F2, F3 | Sonnet (opus-grade review); **security-auditor mandatory** | alone |
| **F5** Data layer | DAL, repository, hooks, policy entities | (supporting) | none | F3 (types) | Sonnet / GLM | batchable with F3 |
| **F6** Screens | §5 screens, routes, checklist row, i18n en+id | 040 | none | F4, F5 | Sonnet UI lane | batchable |
| **F7** Acceptance and docs | bed composite, curated e2e (bed-gated, allowlisted), workflow declarations, runbook, roadmap | 090 | none | F0, F6 | Sonnet | batchable |

Order: F1 → F2 → F3 → (F4 ∥ F5) → F6 → F7; F0 any time the override lifts, before F7. Branches `feat/1511-f<n>` off `origin/dev`, own worktree, `.env.local` copied in; workers push branches only; the Director batches and opens PRs.

---

## Conventions every task follows

- **TDD:** each task names its failing test first, then the code. Under the 2026-11-09 override the builder writes both and runs neither; the reasoning that the test fails before and passes after goes in the commit body in one sentence.
- **Local gate the builder may run:** `cd pmo-portal && npm run check:guards && npx eslint --max-warnings=0 <touched files>`; for migrations also `scripts/check-migration-collisions.sh && scripts/check-migration-collisions.sh --self-test`; for the denominator `node scripts/check-isolation-denominator.mjs --self-test`.
- **What CI runs (and the builder once the override lifts):** `V` = `cd pmo-portal && npx vitest run <files>`; `D` = `cd supabase/functions/<fn> && deno test --allow-env --allow-net --allow-read <files>` (see `scripts/deno-test-edge-fns.sh`); `P` = `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` from the repo root, output grepped for `Parse errors`.
- **Migrations:** reversible, `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`, reverse order, header repeats the reverse. Every function ends `revoke all … from public, anon, authenticated;`; service writers `grant execute … to service_role`; client RPCs `grant execute … to authenticated`; definers `set search_path = public`. Rebuilt bodies are copied from the **newest** definition at build time: `grep -liE "function +(public\.)?<name> *\(" supabase/migrations/*.sql | sort | tail -1`.
- **CI traps per migration slice:** pgTAP 0137 (service_role grants on new functions), 0178 (`supabase/tests/0178_anon_executable_definers.test.sql`: add each new **client-callable definer writer** to `client_callable_rpc_names` with `-- ⚑ AMENDED BY <NNNN> (#1511)` and re-derive the 162 count by hand from the VALUES list after rebase), 0646 initplan guard (policies call `(select public.auth_org_id())` etc., never bare), the isolation denominator (`scripts/isolation-probe-denominator.json`: every new non-trigger SECURITY DEFINER function under `definer_functions` as its `regprocedure` text), 0136 side-mirror inventory (unchanged: D1/§2), sibling suites that mock changed modules (grep the module name under `pmo-portal/src`, `pmo-portal/pages`, `supabase/functions` and update them).
- **Edge-fn tests** import the shipped handler or module (never copies) and mock `globalThis.fetch` (`scripts/check-edge-fn-test-binding.mjs`).
- **Git:** conventional commits, no attribution trailers; `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must find nothing; never `--no-verify`; push only `feat/1511-f<n>`.

---

## F0 — Bed verdicts (no product code)

**F0-T1** (5 min) Bring the bed up: `scripts/with-odoo-lock.sh scripts/odoo-dev-bed.sh up` then `status`; confirm `fleet` and `maintenance` installed.
**F0-T2** (15 min) Extend `scripts/odoo-probe.mjs` §8 (`:899-905`) to `fields_get` the seven D3 models and print, per model, the V-OFM fields present and their `required` flag; run it under `scripts/with-odoo-lock.sh` (env sourced, never printed).
**F0-T3** (15 min) With the bed's integration key: create one equipment, one request, move it to the done stage, read `close_date` and `write_date`; create one vehicle (with a model), one service log with `amount = 150000`; `search_count` `account.move` before/after (V-OFM-5, -7); `has_access` per V-OFM-9; write and re-read an `ir.model.data` anchor through edit and archive (V-OFM-10).
**F0-T4** (10 min) Record verdicts `verified` / `differs: <actual>` per V-OFM row in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` under a new "O8 findings (#1511)" heading; a differing name becomes an issue-comment-free note in this plan's §4 (edit the row). Push docs direct to `dev` (docs-only rule).

---

## F1 — Read contract, pure (no migration; Sonnet, ~2 h)

Files: `pmo-portal/src/lib/adapterSeam/odoo/assets/kinds.ts` *(new)*, `…/assets/kinds.test.ts` *(new)*, `…/assets/capabilities.ts` *(new)*, `…/assets/capabilities.test.ts` *(new)*, `…/odoo/discovery.ts`, `…/odoo/discovery.test.ts`, `…/odoo/fakeOdoo.ts`, `…/odoo/fakeOdoo.test.ts`.

Why a separate spec map: `kinds.test.ts:93-97` requires every `KIND_SPECS` field to be in `O1_MODELS`, and every `O1_MODELS` gap degrades the connection (`connectionState.ts:34`). Asset kinds must not degrade an org that has no fleet app, so they live in `ASSET_KIND_SPECS` with their own discovery block that never feeds `missing`.

### F1-T1 (5 min) Failing test: the seven parsers (AC-OFM-010)
Create `odoo/assets/kinds.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ASSET_KINDS, ASSET_KIND_SPECS, htmlToText, type AssetKind } from './kinds.ts';
import { ASSET_MODELS } from '../discovery.ts';

const W = '2026-11-09 08:00:00';
const FIXTURES: Record<AssetKind, { raw: Record<string, unknown>; row: Record<string, unknown> }> = {
  vehicle: { raw: { id: 7, name: 'Hilux/B 1234 XY', license_plate: 'B 1234 XY', vin_sn: 'MR0XX', model_id: [3, 'Hilux'], driver_id: [9, 'Budi'], odometer: 15230.5, odometer_unit: 'kilometers', acquisition_date: '2025-02-01', active: true, write_date: W },
    row: { external_id: '7', code: 'B 1234 XY', name: 'Hilux/B 1234 XY', parent_external_id: null, active: true,
      attrs: { model_id: '3', model_name: 'Hilux', vin: 'MR0XX', driver_name: 'Budi', odometer: 15230.5, odometer_unit: 'kilometers', acquisition_date: '2025-02-01' } } },
  vehicle_model: { raw: { id: 3, name: 'Hilux', brand_id: [2, 'Toyota'], write_date: W },
    row: { external_id: '3', code: null, name: 'Hilux', parent_external_id: null, active: true, attrs: { brand: 'Toyota' } } },
  equipment: { raw: { id: 42, name: 'Excavator 20t', serial_no: 'EXC-001', category_id: [4, 'Heavy'], model: 'PC200', location: 'Site A', active: true, write_date: W },
    row: { external_id: '42', code: 'EXC-001', name: 'Excavator 20t', parent_external_id: null, active: true, attrs: { category: 'Heavy', model: 'PC200', location: 'Site A' } } },
  maintenance_request: { raw: { id: 11, name: 'Hydraulic leak', equipment_id: [42, 'Excavator 20t'], maintenance_type: 'corrective', stage_id: [1, 'New Request'], request_date: '2026-11-08', schedule_date: '2026-11-10 01:00:00', close_date: false, duration: 2.5, priority: '2', description: '<p>Leak at &amp; boom</p>', archive: false, write_date: W },
    row: { external_id: '11', code: null, name: 'Hydraulic leak', parent_external_id: '42', active: true,
      attrs: { type: 'corrective', stage_id: '1', stage_name: 'New Request', request_date: '2026-11-08', schedule_date: '2026-11-10 01:00:00', close_date: null, duration: 2.5, priority: '2', notes: 'Leak at & boom' } } },
  maintenance_stage: { raw: { id: 4, name: 'Repaired', sequence: 30, done: true, write_date: W },
    row: { external_id: '4', code: null, name: 'Repaired', parent_external_id: null, active: true, attrs: { sequence: 30, done: true } } },
  vehicle_service: { raw: { id: 5, vehicle_id: [7, 'Hilux/B 1234 XY'], service_type_id: [2, 'Oil change'], date: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, vendor_id: [8, 'PT Sinar Baja'], description: 'Oil + filter', notes: false, active: true, write_date: W },
    row: { external_id: '5', code: null, name: 'Oil change', parent_external_id: '7', active: true,
      attrs: { service_type_id: '2', date: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, vendor_name: 'PT Sinar Baja', description: 'Oil + filter', notes: null } } },
  service_type: { raw: { id: 2, name: 'Oil change', category: 'service', write_date: W },
    row: { external_id: '2', code: null, name: 'Oil change', parent_external_id: null, active: true, attrs: { category: 'service' } } },
};

describe('odoo/assets/kinds — AC-OFM-010', () => {
  it.each(ASSET_KINDS)('AC-OFM-010 a %s fixture row parses to its directory row', (kind) => {
    expect(ASSET_KIND_SPECS[kind].parse(FIXTURES[kind].raw)).toEqual({ ...FIXTURES[kind].row, source_write_date: W });
  });
  it.each(ASSET_KINDS)('AC-OFM-010 a malformed %s row is rejected whole', (kind) => {
    const raw = FIXTURES[kind].raw;
    expect(ASSET_KIND_SPECS[kind].parse({ ...raw, id: undefined })).toBeNull();
    expect(ASSET_KIND_SPECS[kind].parse({ ...raw, write_date: '9 Nov' })).toBeNull();
  });
  it('AC-OFM-010 a request whose equipment link is malformed, or a service with no service type, is rejected', () => {
    expect(ASSET_KIND_SPECS.maintenance_request.parse({ ...FIXTURES.maintenance_request.raw, equipment_id: 'x' })).toBeNull();
    expect(ASSET_KIND_SPECS.vehicle_service.parse({ ...FIXTURES.vehicle_service.raw, service_type_id: false })).toBeNull();
  });
  it('AC-OFM-010 an archived request is inactive', () => {
    expect(ASSET_KIND_SPECS.maintenance_request.parse({ ...FIXTURES.maintenance_request.raw, archive: true })?.active).toBe(false);
  });
  it('htmlToText drops tags, decodes the five basic entities and trims', () => {
    expect(htmlToText('<p>a &lt;b&gt; &quot;c&quot; &#39;d&#39;</p><br/>')).toBe('a <b> "c" \'d\'');
    expect(htmlToText(false)).toBeNull();
  });
  it('every field an asset kind reads or scopes by is one discovery checks', () => {
    for (const spec of Object.values(ASSET_KIND_SPECS)) {
      expect(ASSET_MODELS[spec.model], spec.model).toEqual(expect.arrayContaining([...spec.fields, ...(spec.company ? [spec.company] : [])]));
    }
  });
});
```
Verify (CI): `V src/lib/adapterSeam/odoo/assets/kinds.test.ts` → red (module missing).

### F1-T2 (15 min) `odoo/assets/kinds.ts`
Export `ASSET_KINDS = ['vehicle_model','vehicle','equipment','maintenance_stage','maintenance_request','service_type','vehicle_service'] as const` (this order is the sweep order: pickers before the rows that reference them), `type AssetKind`, `htmlToText(v: unknown): string | null`, and `ASSET_KIND_SPECS: Record<AssetKind, KindSpec>` reusing `KindSpec` from `../kinds.ts`. To reuse the private helpers, **export** `base`, `withAttrs`, `m2o`, `m2oName`, `str` from `odoo/kinds.ts` (no behaviour change; `kinds.test.ts` stays green). Specs:
- `vehicle`: model `fleet.vehicle`, fields `['name','license_plate','vin_sn','model_id','driver_id','odometer','odometer_unit','acquisition_date','active','write_date']`, company `company_id`; `withAttrs(base(r, r.name, r.license_plate, false), { model_id: m2o(r.model_id), model_name: m2oName(r.model_id), vin: str(r.vin_sn), driver_name: m2oName(r.driver_id), odometer: typeof r.odometer === 'number' ? r.odometer : null, odometer_unit: str(r.odometer_unit), acquisition_date: str(r.acquisition_date) })`.
- `vehicle_model`: `fleet.vehicle.model`, `['name','brand_id','write_date']`, company `null`; attrs `{ brand: m2oName(r.brand_id) }`.
- `equipment`: `maintenance.equipment`, `['name','serial_no','category_id','model','location','active','write_date']`, `company_id`; code `r.serial_no`; attrs `{ category: m2oName(r.category_id), model: str(r.model), location: str(r.location) }`.
- `maintenance_stage`: `maintenance.stage`, `['name','sequence','done','write_date']`, `null`; reject when `typeof r.sequence !== 'number'`; attrs `{ sequence: r.sequence, done: r.done === true }`.
- `maintenance_request`: `maintenance.request`, `['name','equipment_id','maintenance_type','stage_id','request_date','schedule_date','close_date','duration','priority','description','archive','write_date']`, `company_id`; parent `r.equipment_id`; `active` from `r.archive !== true` (set after `base`, which reads `r.active`); attrs `{ type: str(r.maintenance_type), stage_id: m2o(r.stage_id), stage_name: m2oName(r.stage_id), request_date: str(r.request_date), schedule_date: str(r.schedule_date), close_date: str(r.close_date), duration: typeof r.duration === 'number' ? r.duration : null, priority: str(r.priority), notes: htmlToText(r.description) }`.
- `service_type`: `fleet.service.type`, `['name','category','write_date']`, `null`; attrs `{ category: str(r.category) }`.
- `vehicle_service`: `fleet.vehicle.log.services`, `['vehicle_id','service_type_id','date','state','amount','odometer','vendor_id','description','notes','active','write_date']`, `company_id`; name = `m2oName(r.service_type_id)` (so `null` rejects the row in `base`), parent `r.vehicle_id`; attrs `{ service_type_id: m2o(r.service_type_id), date: str(r.date), state: str(r.state), amount: typeof r.amount === 'number' ? r.amount : null, odometer: typeof r.odometer === 'number' ? r.odometer : null, vendor_name: m2oName(r.vendor_id), description: str(r.description), notes: str(r.notes) }`.
`htmlToText`: non-string or empty → `null`; else `replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,'')`, decode `&lt; &gt; &quot; &#39; &amp;` (`&amp;` last), `trim()`, empty → `null`. `ponytail:` five entities only; Odoo's editor emits these. Header comment cites V-OFM-1..8.
Verify (CI): F1-T1 file green.

### F1-T3 (5 min) Failing test: discovery probes the asset models without degrading
Append to `odoo/discovery.test.ts`:
- `'AC-OFM-001 the asset models are probed with access and recorded under assets'`: with the full fixture, `Object.keys(snap.assets).sort()` equals `Object.keys(ASSET_MODELS).sort()`, each `exists/read/create/write` true.
- `'AC-OFM-001 a missing fleet app is recorded as absent and does not add to missing'`: fixture without `fleet.vehicle` → `snap.assets['fleet.vehicle'].exists === false` and `snap.missing` equals the full-fixture `missing` (`[]`).
- Update the shipped full-fixture case (`:32-38`) only by adding the `assets` expectation; do not loosen its existing assertions.
Verify (CI): `V src/lib/adapterSeam/odoo/discovery.test.ts` → red.

### F1-T4 (10 min) Discovery `assets` block
In `odoo/discovery.ts`: export `ASSET_MODELS: Record<string, readonly string[]>` = the seven spec models with their F1-T2 fields **plus** `company_id` where scoped, plus `'ir.model.data': ['module','name','model','res_id']`. Add `assets: Record<string, ModelProbe>` to `CapabilitySnapshot` (optional in the type for old snapshots: `assets?: …`). After the `LATER_MODELS` loop: `const assets: Record<string, ModelProbe> = {}; for (const [m, f] of Object.entries(ASSET_MODELS)) assets[m] = await probeModel(call, m, f, true);` and return it. It never touches `missing`. Leave `LATER_MODELS` as is (two entries overlap; harmless, one extra call each — `ponytail:` drop them from `LATER_MODELS` once nothing reads `later['fleet.vehicle']`; grep shows nothing does today).
Extend `fakeOdoo.ts` so `fields_get`/`has_access` answer for the seven models and `ir.model.data` (F1-T6 adds rows).
Verify (CI): F1-T3 cases green; `V src/lib/adapterSeam/odoo/discovery.test.ts` whole file green.

### F1-T5 (10 min) Capability gap, test first
`odoo/assets/capabilities.test.ts` *(new)*: `equipmentCapabilityGap(null)` → `'fleet.vehicle'` (fails closed, first in list); full snapshot → `null`; `maintenance.request` with `create: false` → `'maintenance.request:create'`; `fleet.vehicle.model` with `create: false` → `null` (read-only model); `fields_missing: ['serial_no']` on `maintenance.equipment` → `'maintenance.equipment:serial_no'`; `ir.model.data` without create → `'ir.model.data:create'`.
`odoo/assets/capabilities.ts`: `export const EQUIPMENT_WRITE_MODELS = ['fleet.vehicle','maintenance.equipment','maintenance.request','fleet.vehicle.log.services','ir.model.data'] as const;` and `equipmentCapabilityGap(snapshot: { assets?: Record<string, ModelProbe | undefined> } | null | undefined): string | null` walking `Object.keys(ASSET_MODELS)` in order: absent/unreadable → model name; a field missing → `model:field`; a write model without create or write (for `ir.model.data`: create only) → `model:create` / `model:write`. Header: "The SQL twin is `odoo_equipment_employ_blocker` (0796); keep them in step."
Verify (CI): `V src/lib/adapterSeam/odoo/assets/capabilities.test.ts`.

### F1-T6 (15 min) Fake Odoo models
In `fakeOdoo.ts` add the seven models to its model/field table (the `'ir.model.data': [...]` line at `:27` is the shape) with `create`, `write`, `search_read`, `fields_get`, `has_access`; `write_date` bumps on every write; `maintenance.request` write of a `stage_id` whose stage has `done: true` sets `close_date` to the fake's today (V-OFM-5); `fleet.vehicle` create without `model_id` raises a validation error (V-OFM-1); `fleet.vehicle.log.services` create without `service_type_id` raises. Failing test first in `fakeOdoo.test.ts`: one case per behaviour above.
Verify (CI): `V src/lib/adapterSeam/odoo/fakeOdoo.test.ts`.

### F1-T7 (5 min) Gate and push
`cd pmo-portal && npm run check:guards && npx eslint --max-warnings=0 src/lib/adapterSeam/odoo/assets/*.ts src/lib/adapterSeam/odoo/kinds.ts src/lib/adapterSeam/odoo/discovery.ts src/lib/adapterSeam/odoo/discovery.test.ts src/lib/adapterSeam/odoo/fakeOdoo.ts src/lib/adapterSeam/odoo/fakeOdoo.test.ts`. Grep sibling mocks: `grep -rln "odoo/discovery\|fakeOdoo" pmo-portal/src supabase/functions` and confirm none asserts the exact snapshot keys without `assets` (update any that do). Commit `feat(odoo): fleet and maintenance kinds, asset discovery and capability gap (#1511 F1)`; push `feat/1511-f1`.

---

## F2 — Mirror, sweep gate, employ (0795, 0796; security-auditor mandatory)

### F2-T1 (10 min) Failing pgTAP: rows apply, propagation (AC-OFM-012)
Create `supabase/tests/odoo_equipment_mirror.test.sql`: `begin; select plan(10);` fixture = one org `15110000-0000-0000-0000-000000000001` with an activated odoo binding (copy the fixture block of `supabase/tests/odoo_master_records_rls.test.sql`), PMO asset `…00d1` code `EXC-001` name `Old name` linked `external_tier='odoo', external_ref='equipment:42'`; `set local role service_role`; then:
- `apply_odoo_master_rows(org,'equipment','[{"external_id":"42","code":"EXC-001","name":"Excavator 20t","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"}]')` returns 1; `AC-OFM-012 the linked PMO asset takes Odoo's name` (`name = 'Excavator 20t'`); code still `EXC-001`.
- a page with `source_write_date` `2026-11-08 …` and name `Stale` → name unchanged (`AC-OFM-012 an older page changes nothing`).
- a page with `active:false` at `2026-11-10 …` → `archived_at is not null`; a later `active:true` page → still archived (D10 one-way).
- a row carrying `"pmo_id":"15110000-0000-0000-0000-0000000000e1"` for kind `maintenance_request` inserts with that id; a malformed `pmo_id` raises `22023`.
- `apply_odoo_master_page` still writes the `master:equipment` cursor (regression of 0421).
- census: `mark_odoo_census_seen` for run R without id `42`, then `finish_odoo_census(org,'equipment',R,…)` → the mirror row is tombstoned and the linked PMO asset archived (`AC-OFM-012 a record removed from Odoo archives its PMO asset`).
- kind `bogus` → `22023`; as `authenticated` → `42501`.
`select * from finish(); rollback;`
Verify (CI): `P supabase/tests/odoo_equipment_mirror.test.sql` → red.

### F2-T2 (15 min) Migration `0795_odoo_equipment_mirror.sql`
Header: purpose, `#1511 F2`, reverse block. Body:
1. Kind check (0509 pattern): `alter table public.external_master_records drop constraint external_master_records_kind_check; … add constraint … check (kind in ('company','partner','product','uom','warehouse','location','account','tax','analytic_plan','analytic_account','journal','vehicle','vehicle_model','equipment','maintenance_request','maintenance_stage','vehicle_service','service_type'));` and `create or replace function public.assert_odoo_master_kind` with the same list (copy 0509's body).
2. `create index external_master_records_parent_idx on public.external_master_records (org_id, kind, parent_external_id) where parent_external_id is not null;` (per-asset maintenance list).
3. `create function public.apply_odoo_master_rows(p_org_id uuid, p_kind text, p_rows jsonb) returns integer language plpgsql security definer set search_path = public` = 0421's apply body **without** the cursor insert, with `id` = `case when r ? 'pmo_id' then public.odoo_pmo_id(r->>'pmo_id') else gen_random_uuid() end` on insert only (never changed on conflict), then for `p_kind in ('vehicle','equipment')`:
```sql
update public.equipment_assets a
   set name = left(btrim(m.name), 120),
       archived_at = case when m.active and m.tombstoned_at is null then a.archived_at else coalesce(a.archived_at, now()) end
  from public.external_master_records m
 where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = p_kind
   and m.external_id in (select r->>'external_id' from jsonb_array_elements(p_rows) r)
   and a.org_id = p_org_id and a.external_tier = 'odoo' and a.external_ref = p_kind || ':' || m.external_id;
```
   Service-role check first (copy 0421 `:65`), `assert_odoo_activated`, `assert_odoo_master_kind`. Helper `public.odoo_pmo_id(text) returns uuid` immutable plain function: regex-checked uuid else `raise … errcode '22023'`.
4. `create or replace function public.apply_odoo_master_page(...)` = `v_n := public.apply_odoo_master_rows(p_org_id, p_kind, p_rows);` + 0421's cursor upsert; same signature, grants unchanged.
4b. `create or replace function public.finish_odoo_census(...)` = 0421's body plus, for `p_kind in ('vehicle','equipment')`, `update public.equipment_assets a set archived_at = coalesce(a.archived_at, now()) from public.external_master_records m where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = p_kind and m.tombstoned_at is not null and a.org_id = p_org_id and a.external_tier = 'odoo' and a.external_ref = p_kind || ':' || m.external_id and a.archived_at is null;` (a record removed from Odoo archives its PMO asset, FR-OFM-012). Same signature and grants.
5. Grants: `revoke all on function public.apply_odoo_master_rows(uuid,text,jsonb), public.odoo_pmo_id(text) from public, anon, authenticated; grant execute on function public.apply_odoo_master_rows(uuid,text,jsonb) to service_role;`.
6. Self-assertion `do $$` raising if `authenticated` can execute `apply_odoo_master_rows`.
Rollback `rollback/0795_odoo_equipment_mirror_down.sql`: restore 0421's `apply_odoo_master_page` and `finish_odoo_census` bodies verbatim; drop `apply_odoo_master_rows`, `odoo_pmo_id`, the index; `delete from external_master_records where kind in (<7 new>)`; restore 0509's check and assert body.
Denominator: add `apply_odoo_master_rows(uuid,text,jsonb)` to `definer_functions`. 0137: the function is granted to `service_role` (check the test's expectation shape and add nothing else).
Verify (CI): F2-T1 green; `P supabase/tests/odoo_master_records_rls.test.sql supabase/tests/odoo_journal_default.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql` green.

### F2-T3 (10 min) Failing pgTAP: employ guard (AC-OFM-001, AC-OFM-002)
Create `supabase/tests/odoo_equipment_employ.test.sql` (fixture: org, Admin, PM, activated odoo binding whose `config.capabilities.assets` is the full JSON of seven models + `ir.model.data` with all flags true):
- Admin JWT `admin_change_domain_ownership(org,'odoo','equipment','employ')` lives; `external_domain_ownership` row exists; one `integration.domain_ownership.employ` audit row (`AC-OFM-001 …`).
- reset; set `config #- '{capabilities,assets,maintenance.request,create}'` false → throws `P0001` with message `Odoo is missing maintenance.request:create` (`AC-OFM-001 the refusal names the model`).
- no `assets` key (old snapshot) → `P0001` `Odoo is missing fleet.vehicle`.
- an active ERPNext binding → `P0001` (copy 0743's words).
- `p_external_tier = 'erpnext'` → `P0001` `The equipment register is available with Odoo only` (`AC-OFM-002`).
- PM JWT → `42501`.
Verify (CI): `P supabase/tests/odoo_equipment_employ.test.sql` → red.

### F2-T4 (15 min) Migration `0796_odoo_equipment_employ.sql`
1. `public.odoo_equipment_employ_blocker(p_org_id uuid) returns text` stable security definer (0743 `odoo_companies_employ_blocker` shape): ERPNext active → its words; not activated → its words; then for each model of `array['fleet.vehicle','fleet.vehicle.model','maintenance.equipment','maintenance.request','maintenance.stage','fleet.vehicle.log.services','fleet.service.type','ir.model.data']` read `v_p := b.config #> array['capabilities','assets', m]`; `v_p is null or not (v_p->>'exists')::boolean or not (v_p->>'read')::boolean` → `'Odoo is missing ' || m`; `jsonb_array_length(coalesce(v_p->'fields_missing','[]')) > 0` → `'Odoo is missing ' || m || ':' || (v_p->'fields_missing'->>0)`; for the write models (`fleet.vehicle`, `maintenance.equipment`, `maintenance.request`, `fleet.vehicle.log.services`) missing `create` / `write`, and for `ir.model.data` missing `create` → `'Odoo is missing ' || m || ':create'` / `':write'`. Comment: "TS twin `odoo/assets/capabilities.ts`; keep in step." Grants: revoke from public/anon/authenticated, `grant execute … to service_role`.
2. `create or replace function public.admin_change_domain_ownership(…)` = the newest body (0743 at baseline; re-check with the grep in Conventions) with: the guarded list `p_domain in ('procurement','revenue','companies','equipment')`; before the "already employed on another ERP" check: `if p_domain = 'equipment' and p_external_tier = 'erpnext' then raise exception 'The equipment register is available with Odoo only' using errcode = 'P0001'; end if;`; the `case` gains `when 'equipment' then public.odoo_equipment_employ_blocker(p_org_id)`. Grants unchanged (`create or replace` keeps them).
3. `public.org_employs_odoo_equipment(p_org uuid) returns boolean language sql stable set search_path = public` (invoker): `select exists (select 1 from public.external_domain_ownership where org_id = p_org and external_tier = 'odoo' and domain = 'equipment')`. `revoke all … from public, anon; grant execute … to authenticated, service_role;` (used by F3's policies and F2-T6's sweep gate; invoker, so not on the denominator).
Rollback: restore 0743's `admin_change_domain_ownership` verbatim; drop the two new functions.
Denominator: add `odoo_equipment_employ_blocker(uuid)`.
Verify (CI): F2-T3 green; `P supabase/tests/odoo_equipment_employ.test.sql` plus every test that greps `admin_change_domain_ownership` (`grep -l admin_change_domain_ownership supabase/tests/*.sql`).

### F2-T5 (5 min) Employ verb
`supabase/functions/external-set-company/odoo/purchasing.ts:12`: `const EMPLOYABLE = new Set(['procurement', 'companies', 'equipment']);` and the comment at `:11` names 0796. Failing test first: append to the router/verb test that exercises `employDomain` (`grep -rln "employ-domain" supabase/functions/external-set-company`) a case "employ equipment calls admin_change_domain_ownership with domain equipment"; a refusal `P0001 Odoo is missing fleet.vehicle` returns 422 with the "Check the connection again" hint (existing branch).
Verify (CI): `D` on that test file.

### F2-T6 (15 min) Sweep gate, test first (AC-OFM-011)
Append to `supabase/functions/odoo-sweep/odooSweep.test.ts` (reuse its fetch-mock helpers):
- `'AC-OFM-011 an org that does not employ equipment reads no asset kind'`: ownership RPC answers false → no `fleet.vehicle`/`maintenance.*` request in the fetch log; the recovery cap equals the shipped value for the same fixture.
- `'AC-OFM-011 an employing org reads the seven kinds after the directory, in ASSET_KINDS order'`: ownership true, snapshot `assets` all readable → requests for the seven models appear after `res.partner`, in order; each page goes to `apply_odoo_master_page` with `p_kind` the asset kind.
- `'AC-OFM-011 an asset model the snapshot shows unreadable is skipped, and the tick does not fail'`.
Green, in `supabase/functions/_shared/odooSweep.ts`:
- import `ASSET_KINDS, ASSET_KIND_SPECS, type AssetKind` from `odoo/assets/kinds.ts`;
- `type MirrorKind = DirectoryKind | AssetKind; const SPECS: Record<MirrorKind, KindSpec> = { ...KIND_SPECS, ...ASSET_KIND_SPECS };` and use `SPECS[kind]` in `kindDeps` and the loop (`:242`), widening `kindDeps`/`readCursor` parameter types to `MirrorKind`;
- `async function equipmentFeedEmployed(sc, orgId)`: `rpc('org_employs_odoo_equipment', { p_org: orgId })` (service client; answers for the org) — an error is "not employed" for this tick (no read, logged without data);
- `const assetKinds = (await equipmentFeedEmployed(sc, orgId)) ? ASSET_KINDS.filter((k) => assetReadable(capabilities, ASSET_KIND_SPECS[k].model)) : [];` where `assetReadable` = `capabilities?.assets?.[model]` exists, read, no fields missing (absent ⇒ **not** readable, unlike `readable`);
- `const kinds = [...ODOO_KIND_ORDER.filter(…), ...assetKinds];` (the reserve then counts them automatically: NFR-OFM-002).
Update `external-set-company/odoo/sweepVerbs.ts:24` to accept `ASSET_KINDS` too for reset-kind. Grep sibling tests that mock `_shared/odooSweep.ts` (`grep -rln "odooSweep" supabase/functions`) and keep their expectations (non-employing fixtures must be byte-for-byte unchanged).
Verify (CI): `D supabase/functions/odoo-sweep` (whole dir).

### F2-T7 (5 min) Gate and push
Collision check, `node scripts/check-isolation-denominator.mjs --self-test`, eslint on touched TS, `npm run check:guards`. Commit `feat(odoo): mirror fleet and maintenance, employ equipment under Odoo (#1511 F2, migrations 0795 0796)`; push `feat/1511-f2`. PR body asks security-auditor to check: service-role only on the row writer, org filter on the propagation update, the employ guard's ERPNext refusal, the gate failing closed on an unreadable ownership answer.

---

## F3 — Adoption and the PMO-asset guard (0797)

### F3-T1 (15 min) Failing pgTAP (AC-OFM-020, -021, -022)
Create `supabase/tests/odoo_equipment_adoption.test.sql`. Fixture: org A employing `equipment` under odoo, org B; Admin A1, PM A3, Engineer A6, Admin B1; unlinked PMO assets `EXC-001`, `GEN-01`, `TIE-1` (two live PMO assets cannot share a code, so the tie is two Odoo rows to one PMO asset); org-A mirror rows equipment 42 serial `exc-001 `, equipment 43 serial null, vehicle 7 plate `B 1234 XY`, vehicle 8 plate `tie-1`, equipment 44 serial `TIE-1`; an org-B mirror equipment 42. Cases:
- `AC-OFM-020` as Admin A1: `list_equipment_asset_matches()` returns for `equipment:42` `action='link'`, `asset_id = EXC-001's id`, `reason='same-code'`; for `equipment:43` `action='add'`, `reason='no-code'`; for `vehicle:8` and `equipment:44` `action='add'`, `reason='two-codes'` (one PMO asset, two Odoo rows: never linked); org B's row absent.
- `AC-OFM-021` `accept_equipment_asset_matches('[{"ref":"equipment:42","action":"link","asset_id":"<EXC-001>"},{"ref":"equipment:43","action":"add","default_unit":"hours"}]')` returns `{"linked":1,"added":1}`; EXC-001 has `external_ref='equipment:42'`; a new asset with `code='ODOO-E43'`, name from the mirror, `external_ref='equipment:43'`; one `equipment.register.matched` audit row with the counts. Repeating the link → `23505` and nothing applied (one transaction). Linking org B's ref → `P0002`. PM A3 → `42501`. `vehicle:7` add → code `B 1234 XY`.
- `AC-OFM-022` as PM A3 (org employs): `insert into equipment_assets (code,name) values ('X','X')` → `42501`; `update equipment_assets set name='Y' where id=<EXC-001>` → 0 rows; `delete` as Admin → 0 rows. Release the ownership row (as superuser in the test), repeat → insert succeeds.
- `record_odoo_asset_created(org,'vehicle', <row json>, '15110000-…-0000000000f1', 'hours')` as service role inserts the mirror row and a PMO asset with that id, code = plate, linked; as authenticated → `42501`.
Verify (CI): `P supabase/tests/odoo_equipment_adoption.test.sql` → red.

### F3-T2 (15 min) Migration `0797_odoo_equipment_adoption.sql`
1. `public.list_equipment_asset_matches()` returns `table (ref text, kind text, external_id text, odoo_name text, odoo_code text, action text, asset_id uuid, asset_code text, asset_name text, reason text)`, `language sql stable security invoker set search_path = public`: unlinked live mirror rows of kinds `vehicle`/`equipment` (`not exists` an `equipment_assets` row with that `external_ref`), left-joined to live, unlinked PMO assets on `lower(btrim(a.code)) = lower(btrim(m.code))`; a PMO asset matched by more than one mirror row, or a mirror row matching more than one asset, → `action 'add', reason 'two-codes'`; one-to-one → `'link','same-code'`; none → `'add','no-code'`. Filtered by `(select public.auth_org_id())`. `revoke all … from public, anon; grant execute … to authenticated;` (reads only; the page itself is Admin-gated, and every member may already read both tables).
2. `public.accept_equipment_asset_matches(p_pairs jsonb) returns jsonb` security definer: `assert_is_active_member()`; caller role `Admin` else `42501`; org = `auth_org_id()`; `org_employs_odoo_equipment(org)` else `P0001 'Odoo does not keep the equipment register for this organization'`; for each element (max 1000, else `22023`): `ref ~ '^(vehicle|equipment):[0-9]+$'` else `22023`; the mirror row must exist in the caller's org (else `P0002`); `link`: the asset is the caller's, live, unlinked (else `P0002`/`23505`), set its `external_tier/external_ref`; `add`: insert with `code = coalesce(nullif(btrim(m.code),''), 'ODOO-' || upper(left(kind,1)) || external_id)`, `name = left(btrim(m.name),120)`, `default_unit = coalesce(p->>'default_unit','hours')` (checked by the table), linked; a live-code clash raises `23505` naming the code; `skip` does nothing. Then `log_audit('equipment.register.matched', org, auth.uid(), null, jsonb_build_object('linked', n1, 'added', n2))`. Returns `{"linked":n1,"added":n2}`. Writes bypass the F3 restrictive policies because the function runs as its owner.
3. `public.record_odoo_asset_created(p_org_id uuid, p_kind text, p_row jsonb, p_asset_id uuid, p_default_unit text) returns void` security definer, service-role only: `p_kind in ('vehicle','equipment')` else `22023`; `perform public.apply_odoo_master_rows(p_org_id, p_kind, jsonb_build_array(p_row))`; insert the PMO asset `id = p_asset_id`, code/name as above, linked; `on conflict (id) do nothing` (a replayed finalize is a no-op). Grants: service_role only.
4. Restrictive policies (0646 initplan form):
```sql
create policy equipment_assets_odoo_owned_insert on public.equipment_assets as restrictive for insert to authenticated
  with check (not public.org_employs_odoo_equipment((select public.auth_org_id())));
create policy equipment_assets_odoo_owned_update on public.equipment_assets as restrictive for update to authenticated
  using (not public.org_employs_odoo_equipment((select public.auth_org_id())))
  with check (not public.org_employs_odoo_equipment((select public.auth_org_id())));
create policy equipment_assets_odoo_owned_delete on public.equipment_assets as restrictive for delete to authenticated
  using (not public.org_employs_odoo_equipment((select public.auth_org_id())));
```
   Check whether `0646_rls_initplan.test.sql` or `0696` pins the full policy list of `equipment_assets` (`grep -n equipment_assets supabase/tests/0646_rls_initplan.test.sql supabase/tests/*0696*`); if so add the three rows there.
5. Self-assertion: `accept_equipment_asset_matches` not executable by `anon`; `record_odoo_asset_created` not executable by `authenticated`.
Rollback: drop the three policies and three functions; `update equipment_assets set external_tier = null, external_ref = null where external_tier = 'odoo'` is **not** done (a down migration must not lose links made in use; the columns predate 0797). Note this in the header.
0178: add `('accept_equipment_asset_matches'),  -- ⚑ AMENDED BY 0797 (#1511)` and raise both counts by 1 (re-derive). Denominator: add `accept_equipment_asset_matches(jsonb)`, `record_odoo_asset_created(uuid,text,jsonb,uuid,text)`.
Verify (CI): F3-T1 green; `P supabase/tests/odoo_equipment_adoption.test.sql supabase/tests/equipment_rls.test.sql supabase/tests/equipment_usage.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0646_rls_initplan.test.sql` (`equipment_rls`/`equipment_usage` prove #1519 unchanged for non-employing orgs).

### F3-T3 (5 min) Types, gate, push
Types regenerate in CI's type job, or `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'` once the override lifts; until then hand-add the two RPC signatures to `database.types.ts` under `Functions` (copy an adjacent entry's shape) so F5 typechecks in CI. Commit `feat(equipment): match Odoo assets once and keep the register in Odoo (#1511 F3, migration 0797)`; push `feat/1511-f3`.

---

## F4 — Commands through the outbox (no migration; security-auditor mandatory)

### F4-T1 (10 min) Failing test: request bodies
`pmo-portal/src/lib/adapterSeam/odoo/assets/bodies.test.ts` *(new)*, for `buildEquipmentBody(kind, record, ctx)`:
- `register-vehicle` create `{ license_plate:'B 1234 XY', model_id:'3', vin:'MR0XX', acquisition_date:'2025-02-01' }` → `{ license_plate:'B 1234 XY', model_id:3, vin_sn:'MR0XX', acquisition_date:'2025-02-01', company_id: ctx.companyId }`; no `model_id` → refused `'vehicle-model-required'`; update with `active:false` → `{ active:false }` only (no company on update).
- `register-equipment` create `{ name:'Excavator 20t', serial_no:'EXC-001', model:'PC200', location:'Site A' }` → those four + `company_id`; empty name → `'name-required'`.
- `maintenance-request` create `{ subject:'Hydraulic leak', type:'corrective', stage_id:'1', schedule_date:'2026-11-10T08:00:00+07:00', duration_hours:2.5, notes:'Leak <b>' }` with `ctx.odooEquipmentId = 42` → `{ name:'Hydraulic leak', equipment_id:42, maintenance_type:'corrective', stage_id:1, schedule_date:'2026-11-10 01:00:00', duration:2.5, description:'<p>Leak &lt;b&gt;</p>', company_id }` (UTC naive, HTML-escaped); type `'other'` → `'maintenance-type-invalid'`; negative duration → `'duration-invalid'`; notes over 2000 → `'notes-too-long'`.
- `vehicle-service` create `{ service_type_id:'2', date:'2026-11-01', state:'done', amount:150000, odometer:15000, notes:'x' }` with `ctx.odooVehicleId = 7` → `{ vehicle_id:7, service_type_id:2, date:'2026-11-01', state:'done', amount:150000, odometer:15000, notes:'x', company_id }`; state `'open'` → `'service-state-invalid'`; amount `NaN`/negative → `'amount-invalid'`.
Refusals are `{ outcome:'refused', code }` (the revenue `buildInvoiceBody` shape, `odooAdapters.ts:118-119`).
Verify (CI): red.

### F4-T2 (10 min) `odoo/assets/bodies.ts`
Pure builders per the cases. Field names only here and in `kinds.ts` (NFR-OFM-001). `toOdooDatetime(iso)` → `new Date(iso).toISOString().slice(0,19).replace('T',' ')`; invalid → refused `'date-invalid'`. HTML-escape `& < > " '` then wrap in `<p>…</p>`, newlines → `<br>`. Only keys present in the record are sent on update (a PATCH, so an edit never blanks a field it did not show).
Verify (CI): F4-T1 green.

### F4-T3 (15 min) Failing test, then the adapter
`odoo/assets/adapter.test.ts` *(new)* against `fakeOdoo`: create of each kind → one record, an `ir.model.data` row `module 'pmo'`, name `equipment_<uuid with _>`; `commit` returns `{ externalRecordId: '<model>:<id>', canonical: { kind: '<mirror kind>', row: <DirectoryRow parsed by ASSET_KIND_SPECS from a search_read of the new id> } }`; a second create with the same record id where the anchor already exists → no second record (adopt); an anchor pointing at another record → `commit-rejected 'ambiguous-anchor'`; update → `write` on the id from `record.external_id`, then the same read-back; `probe(record)` → the anchored id or `null`.
`odoo/assets/adapter.ts` *(new)*: `createOdooEquipmentAdapter({ call, ctx })` implementing `Adapter` (`contract.ts`): `equipmentKey(record)` = `equipment:<uuid>` (UUID-validated, else `commit-rejected 'record-id-invalid'`); anchor write/probe reuse `externalIdentifier` and `probeOdooByAnchor`'s query shape from `purchase/anchors.ts` / `purchase/recoveryProbe.ts` — import, do not copy; if their key regex refuses `equipment:` keys, add an `EQUIPMENT_KEY_RE` beside `PURCHASE_KEY_RE` in `purchase/anchors.ts` and accept it in `externalIdentifier` (one regex, one test case in `purchase/anchors` tests). Read-back: `search_read` with `ASSET_KIND_SPECS[kind].fields` and `[['id','=',id]]`, parse, `null` → `commit-rejected 'unreadable-after-write'`. Kind map: `register-vehicle → vehicle`, `register-equipment → equipment`, `maintenance-request → maintenance_request`, `vehicle-service → vehicle_service`.
Verify (CI): `V src/lib/adapterSeam/odoo/assets/adapter.test.ts`.

### F4-T4 (15 min) Failing served test: dispatch wiring (AC-OFM-030, AC-OFM-031)
`supabase/functions/adapter-dispatch/odooEquipment.test.ts` *(new; add to `scripts/check-edge-fn-test-binding.mjs` `REQUIRED` importing the shipped `resolveOdooEquipmentAdapter`)*, fetch mocked as a fake JSON-2 server (helpers from `odooCompanies.test.ts`), served through the shipped `index.ts` handler:
1. `AC-OFM-031` Engineer sends `register-vehicle` create → 403/`register-role`, no outbox row, no Odoo call.
2. `AC-OFM-031` Engineer sends `maintenance-request` create for a PMO asset linked `equipment:42` → 200; one `maintenance.request/create` with `equipment_id: 42`; one outbox row keyed `equipment:<record id>`; `apply_odoo_master_rows` called with kind `maintenance_request` and a row whose `pmo_id` is the record id.
3. Request for an unlinked asset → `equipment-not-linked`, no outbox row; a vehicle-linked asset with `maintenance-request` → `equipment-kind-mismatch`; an asset id of another org → refused before the outbox (`assertCommandLinksSameOrg` pattern).
4. `AC-OFM-030` lost answer: the fake stores the create then the fetch throws; re-send the same command → probe finds the anchor; **one** `maintenance.request` in the fake; the mirror apply runs once with that id.
5. `AC-OFM-030` held: create stored, anchor deleted in the fake, outbox row forced past its quarantine window, re-send → outbox `held`, **no second create**.
6. Update with a fresh key after a lost answer → `write` sent again (resend allowed), one record.
7. Connection refused (`odooClientForOrg` refusal) → `config-rejected`, no outbox row.
8. Snapshot missing `maintenance.request:create` → `config-rejected` naming it.
9. `register-equipment` create by a PM → `record_odoo_asset_created` called with the record id as `p_asset_id`.
**Mutation checks (paste in PR):** set `reissueOnInconclusiveAbsence: () => true` → case 5 red; skip the role gate → case 1 red; skip the link check → case 3 red; restore.
Verify (CI): `D supabase/functions/adapter-dispatch/odooEquipment.test.ts` → red.

### F4-T5 (15 min) Dispatch parts `adapter-dispatch/odooEquipment.ts` *(new)*
Mirror `odooCompanies.ts`:
- `EQUIPMENT_KIND_DOMAIN = { 'register-vehicle': 'equipment', 'register-equipment': 'equipment', 'maintenance-request': 'equipment', 'vehicle-service': 'equipment' }` exported from `odoo/assets/kinds.ts`.
- `resolveOdooEquipmentAdapter(ctx)`: `assertCommandLinksSameOrg`; `odooClientForOrg` refusal → `config-rejected`; `equipmentCapabilityGap` → `config-rejected` "Odoo equipment needs {{gap}} …" (the procurement wording); role: register kinds need `Admin`/`Project Manager` (read with `actor_authorization_state` as `authGuard.ts:124` does; else `AppError('register-role','commit-rejected')`); resolve the PMO asset (`record.asset_id`) to its `external_ref` in the caller's org: for `maintenance-request` it must start `equipment:`, for `vehicle-service` `vehicle:` (`equipment-not-linked` / `equipment-kind-mismatch`); for update, `record.external_id` must be a mirror row of the matching kind in the org; dry-build the body (refusal → `config-rejected` with the code) before returning `createOdooEquipmentAdapter`.
- `resolveOdooEquipmentMoneyOutboxDeps(ctx)`: as companies (`odooCompanies.ts:45-68`): `reissueOnInconclusiveAbsence: operation === 'update'`, `probeByRemarksKey: create ? () => adapter.probe(record) : async () => null`.
- Wire: `ODOO_ADAPTER_REGISTRY.equipment` (`odooAdapters.ts:139`); `odooMoneyOutbox.ts:175` gains `if (ctx.command.domain === 'equipment') return resolveOdooEquipmentMoneyOutboxDeps(ctx);`; `authGuard.ts:58` `OWNING_TIERS.equipment = [ODOO_TIER]`; the kind→domain check (`authGuard.ts:146-158`) reads `{ ...KIND_DOMAIN, ...EQUIPMENT_KIND_DOMAIN }`; `_shared/moneyWriteRoles.ts` `equipment: ['Admin','Executive','Project Manager','Finance','Engineer']` with a comment that register kinds are narrowed in `odooEquipment.ts`; `index.ts` derives the create key server-side for `equipment` like `odooCompanyKeyDerivedByServer` (`index.ts:396`): `equipment:<record.id>`.
Verify (CI): F4-T4 green; `D` on `authGuard.test.ts`, `odooAdapters.test.ts`, `odooMoneyOutbox.test.ts`, `odooCompanies.test.ts` (unchanged behaviour for other domains).

### F4-T6 (10 min) Read-model writer
`adapter-dispatch/readModel/equipment.ts` *(new)*, registered in `READ_MODEL_WRITERS` (`readModelWriters.ts:31`): `upsert(ctx, canonical, command)` → for a register create, `rpc('record_odoo_asset_created', { p_org_id, p_kind, p_row: canonical.row, p_asset_id: command.record.id, p_default_unit: command.record.default_unit ?? 'hours' })`; otherwise `rpc('apply_odoo_master_rows', { p_org_id, p_kind, p_rows: [{ ...canonical.row, ...(command.operation === 'create' ? { pmo_id: command.record.id } : {}) }] })`. Error → `AppError(error.message, error.code)`. Failing test first: append to `readModelWriters.modules.test.ts` (registry has `equipment`) and a new `readModelWriters.equipment.test.ts` (the two RPC calls with exact args; an RPC error throws).
Verify (CI): `D` on both files.

### F4-T7 (10 min) Workflow declarations and error copy
`connect/workflows.ts`: add `'equipment.push': { version: 1, summary: 'create or update a register asset or maintenance record in the ERP once, by key' }` and `'equipment.read': { version: 1, summary: 'read the ERP asset register and maintenance records into PMO' }`. Every tier must declare them (typecheck): ERPNext `unavailable` "ERPNext asset and maintenance screens are not built; the equipment register is available with Odoo only"; Odoo `pending` with `issue: 1511` until F7 flips them. Grep other `TierWorkflows` declarations (`grep -rln "TierWorkflows" pmo-portal/src`) and add the rows to each. `pushErrorCopy.ts`: the three §5.7 codes, failing case first in `pushErrorCopy.test.ts`.
Verify (CI): `V src/lib/adapterSeam/pushErrorCopy.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts`.

### F4-T8 (5 min) Gate and push
eslint on touched TS (portal and functions), `npm run check:guards`. Commit `feat(odoo): record equipment and maintenance in Odoo through the outbox (#1511 F4)`; push `feat/1511-f4`. PR body: the mutation evidence, and for security-auditor: the per-kind role narrowing, the link check before any outbox row, the server-derived create key, no payload echo in error text.

---

## F5 — Data layer (no migration)

### F5-T1 (10 min) DAL, test first
Append to `pmo-portal/src/lib/db/equipment.test.ts` (mock `supabase` as that file does): `listRegister()` selects `external_master_records` `id, kind, external_id, code, name, active, tombstoned_at, attrs, as_of` with `external_tier = 'odoo'`, `kind in ('vehicle','equipment')`, limit `LIST_LIMIT + 1` → `Bounded`; `listMaintenance(ref)` selects kind `maintenance_request` for `equipment:<id>` (or `vehicle_service` for `vehicle:<id>`) where `parent_external_id = <id>`, ordered `source_write_date desc`, limit 51, with `count: 'exact'`; `listPickers(kind)` for `vehicle_model | maintenance_stage | service_type` (active, not tombstoned; stages ordered by `attrs->sequence`); `listPendingChanges(recordIds)` reads `external_command_outbox` `pmo_record_id, state, idempotency_key, updated_at` with `domain = 'equipment'`, `state in ('pending','committing','committed','quarantined','held')`; `listAssetMatches()` → `rpc('list_equipment_asset_matches')`; `acceptAssetMatches(pairs)` → `rpc('accept_equipment_asset_matches', { p_pairs })`; `sendEquipmentCommand(operation, record, key)` → `dispatchDomainCommand('equipment', operation, record, { idempotencyKey: key })`.
Implement in `src/lib/db/equipment.ts`.
Verify (CI): `V src/lib/db/equipment.test.ts`.

### F5-T2 (5 min) Repository and contract
Add the new functions to the equipment repository and its contract (the #1519 S5.2 files; `grep -rn "repositories.equipment\|equipmentRepository" pmo-portal/src/lib/repositories`), so pages never import the DAL (ADR-0017).

### F5-T3 (10 min) Hooks, test first
Append to `src/hooks/useEquipment.test.tsx`: `useRegister()`, `useAssetMaintenance(ref)`, `useEquipmentPickers(kind)`, `usePendingEquipmentChanges(ids)`, `useAssetMatches(enabled)`, `useAcceptAssetMatches()`, `useSendEquipmentCommand()`; org id in every query key (the file's convention); a successful send invalidates `register`, `maintenance(ref)`, `pending` and `assets`; `useOdooEquipmentOwned()` = `useExternalDomainOwnership()` contains `{ externalTier:'odoo', domain:'equipment' }`.
Implement in `src/hooks/useEquipment.ts`. Grep sibling suites that mock `@/src/hooks/useEquipment` (`grep -rln "hooks/useEquipment" pmo-portal/pages pmo-portal/src`) and add the new hooks to their mocks.

### F5-T4 (5 min) Policy (UX only)
`src/auth/policy.ts`: entities `equipmentRegister` (create/edit: Admin, Project Manager; mirrors D7) and `maintenance` (create/edit: Admin, Executive, Project Manager, Finance, Engineer); `can()` refuses both while viewing-as (the existing `viewOnly` rule). Failing case first in the policy test file (`grep -ln "equipmentAsset" pmo-portal/src/auth/*.test.ts`).

### F5-T5 (5 min) Gate and push
eslint touched files, `npm run check:guards`. Commit `feat(equipment): register and maintenance data layer (#1511 F5)`; push `feat/1511-f5`.

---

## F6 — Screens (UI lane; impeccable + taste + ui-ux-pro-max loaded; one rendered review)

### F6-T1 (15 min) Failing RTL: asset detail states (AC-OFM-040)
Append to `pages/equipment/EquipmentAssetDetail.test.tsx` (mock hooks as the file does), one `it` per state, titles prefixed `AC-OFM-040`: linked equipment shows register card fields and "Last read from Odoo"; maintenance rows newest first with stage and closed date; vehicle shows service rows with "Cost recorded in Odoo"; empty maintenance copy; not-linked strip (Admin sees "Review matches", Engineer does not); waiting strip with "Check again" calling the send hook with the stored key; held strip without a button; Odoo unreachable → banner and "Record maintenance" disabled with the reason; archived in Odoo → write buttons hidden; an Engineer sees "Record maintenance" but not "Edit in register"; a non-employing org renders exactly today's page (no register card, no maintenance section).
Verify (CI): red.

### F6-T2 (15 min) Asset detail
`EquipmentAssetDetail.tsx`: when `useOdooEquipmentOwned()`, render `RegisterCard` and `MaintenanceSection` *(new, `pages/equipment/RegisterCard.tsx`, `pages/equipment/MaintenanceSection.tsx`)* above the costing card; `OdooConnectionBanner` from `useOdooConnection()`. Rows activate `MaintenanceForm`. "Showing x of y" from the exact count.
Verify (CI): F6-T1 green.

### F6-T3 (15 min) Forms, test first
`pages/equipment/RegisterForm.test.tsx`, `MaintenanceForm.test.tsx` *(new)*: required fields block submit; the type toggle swaps fields; submit sends the record shape F4-T1 expects with a fresh `crypto.randomUUID()` id (create) and a per-open idempotency key; held result → warning toast and close; refusal → `SubmitError` from `pushErrorCopy`; the Stage picker lists stages by sequence; the cost field shows "Not posted to accounts.". Then `RegisterForm.tsx`, `MaintenanceForm.tsx` with `EntityFormModal`/`useEntityForm`/`TextField`/`SelectField`/`Combobox`/`FormGrid`.

### F6-T4 (10 min) Asset list, test first
Append to `pages/equipment/EquipmentAssets.test.tsx`: employing org shows Type, Plate or serial, Register pill per state, Open maintenance; "New asset" opens `RegisterForm`; no Archive/Delete in the row menu, "Archive in Odoo" with confirm sends `active:false`; Admin banner with the unmatched count; a non-employing org is unchanged. Implement in `EquipmentAssets.tsx` (open-maintenance count from one `useRegister` + a grouped maintenance count read in the DAL — `ponytail:` count client-side over the bounded register; a count RPC when registers exceed `LIST_LIMIT`).

### F6-T5 (10 min) Match page, test first
`pages/equipment/EquipmentAssetMatch.test.tsx` *(new)*: proposals render with their reason; changing a row's select changes the payload; "Accept all" confirms then calls accept with every non-skip row; nothing-to-match state; error with Retry; a `23505` refusal shows the alert and keeps the table; non-Admin sees the not-allowed state. Implement `pages/equipment/EquipmentAssetMatch.tsx`; route `{ path: '/equipment/assets/match', element: <EquipmentAssetMatchPage /> }` **before** `/equipment/assets/:assetId` in `App.tsx:384-387`, its chunk entry beside `App.tsx:202-204`, breadcrumb label in `Rail.tsx:248` map.

### F6-T6 (5 min) Checklist row
`OdooSetupChecklist.tsx:100`: add the §5.6 row and button (`useOdooSetup('employ-domain')`, `{ domain: 'equipment' }`, Admin only). Failing case first in `OdooSetupChecklist.test.tsx`.

### F6-T7 (10 min) i18n
Add every §5.7 key to `public/locales/en/equipment.json` and `public/locales/id/equipment.json` (and the three `administration` keys to both `administration.json`); run the i18n catalogue/parity test the #1519 S6.7 task used (`grep -rln "locales/id" pmo-portal/src/lib/i18n`). No key in one file only.

### F6-T8 (5 min) Gate and push
eslint touched files, `npm run check:guards`, `node scripts/affected-e2e.mjs` (lists specs visiting `/equipment*`; CI's release run executes them). `scripts/ux-proof.sh /equipment/assets /equipment/assets/match /equipment/assets/<seed id>` is run by the Director's rendered review once allowed. Commit `feat(equipment): register, maintenance and asset matching screens (#1511 F6)`; push `feat/1511-f6`.

---

## F7 — Acceptance, declarations, docs

### F7-T1 (15 min) Bed composite
`supabase/functions/adapter-dispatch/odooEquipment.bed.test.ts` *(new)*, gated `ignore: !(BED && ORG)` on the dependency variables (`ODOO_BED_URL`, `ODOO_BED_ORG`; never `CI`): create equipment → anchor exists → request create → stage to a `done` stage → `close_date` set in Odoo and in the mirror after `apply_odoo_master_rows`; service log create with amount → `account.move` count unchanged (V-OFM-7). Run (when allowed): `scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; … deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooEquipment.bed.test.ts'` (sourced, never printed).

### F7-T2 (15 min) Curated journey (AC-OFM-090)
`pmo-portal/e2e/AC-OFM-090-odoo-equipment-maintenance.spec.ts` *(new)*, header `// @e2e-isolation: dedicated-row` + reason, gated exactly like `AC-OCI-100` (`:11-27`: partial config throws, none skips). Journey: an Admin employs equipment (Integrations checklist button) → creates "Excavator 20t / EXC-OFM-<random>" in **New asset** → opens it → **Record maintenance** "Hydraulic leak", Corrective, schedule tomorrow → sees it in the table → edits it to the done stage → **goal oracle:** read Odoo over JSON-2: one `maintenance.request` with that subject, `maintenance_type 'corrective'`, the done stage, `close_date` set; the PMO row shows the same stage and closed date. Then write `name = 'Hydraulic leak (Odoo edit)'` directly in Odoo, trigger "Refresh now" (`odoo/sweepVerbs.ts`), and assert the PMO row shows the edit. Add the allowlist entry to `scripts/check-e2e-skips.mjs` (shape of `:43-47`, `verified: <run date>`, restore = the AC-OCI-100 wording with `AC-OFM-090`).

### F7-T3 (5 min) Declarations
Flip Odoo `equipment.push` and `equipment.read` to `supported` once F7-T1/T2 are green on the bed; if a shared contract suite is required for `supported` by `contractSuite/parity.test.ts`, add `contractSuite/equipment.suite.ts` (create → read back → replay same key → one record → update) registered under `equipment.push`, run against `fakeOdoo` via `contract.harness.ts`.

### F7-T4 (10 min) Runbook and roadmap
`docs/runbooks/odoo-equipment.md` *(new)*: employ prerequisites (both apps, the integration user's groups incl. the elevated external-identifier grant, V-OFM-9), the match-once step, what PMO writes and never writes (D4, D11), held changes and how an Admin resolves them (find the record in Odoo by the PMO subject, then "Check again" or leave), sync timing (≤ 5 minutes + Refresh now). `docs/runbooks/pmo-cli.md`: one line that equipment register writes are app-only for now. Update the roadmap issue's Now/Next per CLAUDE.md (Director, not the worker: workers post nothing to GitHub). Push docs direct to `dev`.

---

## 8. Risks and ceilings

| Risk | Where closed |
|---|---|
| A fleet-less Odoo degrades the connection | asset models never feed `missing` (F1-T4); sweep reads them only when the snapshot shows them (F2-T6) |
| Tick budget: seven more kinds | only employing orgs; 2 reserved calls each, counted by the shipped reserve (NFR-OFM-002). Ceiling: an org with large maintenance history spends its first ticks backfilling; the directory and money feeds keep their shares |
| Duplicate Odoo record after a lost answer | anchor + probe; create miss held, never reissued (F4-T4 cases 4–5, mutation-checked) |
| A feed page pinned by a PMO constraint | propagation never un-archives and never renames a code (D10); name truncated to the column's limit |
| Divergent hand-kept PMO assets | restrictive policies while employed (F3) |
| Exposure: vehicle driver names visible to every member | accepted (members already see colleagues); revisit with #902's scopes |
| Field names differ on Odoo 20 | F0 verdicts before F7; names live in two files |
| Maintenance volume in the directory table | `ponytail:` own table past 50k rows per org (#1761 trigger) |

## 9. Follow-ups (not built here; file as issues when the Director accepts the plan)

Restore from Odoo archive; odometer and engine-hours push from usage; outbox recovery pass for `equipment`; fleet-less orgs; preventive recurrence fields; maintenance teams and technicians; #902 matrix actions `equipmentRegister.write` / `maintenance.write`; CLI verbs for register and maintenance.
