# Spec — Odoo: connect and manage master data (O1, #1504)

- **Status:** Draft for owner sign-off (2026-10-31). Owner approval of this spec and of proposed ADR-0094 is required before any build.
- **Route:** EPC prospect build route (#1481), item O1 of `docs/plans/2026-10-30-epc-odoo-build-route.md`. Blocks O2–O8.
- **Executor tier:** auth / token custody ⇒ the custody and activation slices are **Director-dispatched per issue**; bounded slices are Orca workers (see §12).
- **Grounds (read, not re-derived):** ADR-0055 (adapters, SoT, change feed), ADR-0059 (process ownership, derived keys), ADR-0058 (outbox, held-not-reissued), ADR-0061 (per-org enablement, atomic connect), ADR-0065 (admin connect layer), ADR-0072 (credential resolution fails closed), ADR-0073 (activation at company selection), ADR-0060 (server-side custody principles), proposed ADR-0094 (PMO as the only interface over a headless ERP); decision tickets #1482–#1486 (positioning, native coverage, API research, ownership split, adapter scope); `docs/research/2026-10-30-odoo20-api.md`, `docs/research/2026-10-30-odoo20-native-coverage.md`; shipped `docs/specs/external-admin-connect.spec.md`, `integration-enablement-model.spec.md`, `external-adapter-seam.spec.md`, `erpnext-adapter.spec.md`.
- **ID scheme:** `FR-ODC-###`, `NFR-ODC-###`, `AC-ODC-###`, `DD-ODC-#` (decisions taken here), `OQ-ODC-#` (owner questions), `V#` (Odoo claims to verify on the dev bed).

---

## 0. Open questions for the owner (each with the default taken if unanswered)

**Owner sign-off, 2026-10-31:** defaults OQ-ODC-1..12 approved (they mirror the ERPNext rules). Added binding requirements: connect anytime (four scenarios) and ERPNext/Odoo parity through one adapter contract — see `docs/decisions.md` OD-ERP-ANYTIME-1. Dev-bed corrections to the research land in the plan.

| # | Question | Default taken in this spec |
|---|---|---|
| **OQ-ODC-1** | Can a user create or edit a vendor/client **from PMO** (a command that creates/updates the Odoo partner), or is O1 read-and-map only? | **Yes, as the last slice (S7).** ADR-0094 makes PMO the only interface, so a vendor that can only be created in Odoo's own UI breaks that. Everything before S7 is read-and-map and ships first. |
| **OQ-ODC-2** | Does the prospect's Odoo sit on the **public internet behind HTTPS**, or on a private network next to their PMO Supabase? The shipped ERP host guard refuses private and loopback destinations. | **Public HTTPS hostname only.** Private-network reach is not designed here; it belongs with the open "client-server deployment mode" question on #1481. |
| **OQ-ODC-3** | Is **sweep-only** change detection acceptable for O1 acceptance, with Odoo-pushed webhooks as an optional later slice? A webhook needs an automation rule configured by an admin inside Odoo (a manual step outside PMO). | **Sweep-only is the acceptance bar.** The webhook "nudge" receiver (S8) is optional and cannot be required for any AC. Master data is not latency-critical; O2 (order and receipt status) is where latency matters. |
| **OQ-ODC-4** | Who may link a PMO project to an Odoo analytic account and set the org-wide account defaults? | **Link:** Admin, platform Operator, or that project's Project Manager (the shipped link rule, `assert_integration_link_actor`). **Defaults and unit map:** Admin and Finance only. |
| **OQ-ODC-5** | May PMO **create** the missing analytic account in Odoo when a project has none, or must an Odoo admin create it first? | **PMO may create it** (a small, non-money, idempotent command in S5). PMO is the only interface. |
| **OQ-ODC-6** | API-key lifetime: Odoo keys may expire. Is **manual rotation** (an Admin pastes a new key) acceptable for O1, with PMO warning ahead of an admin-declared expiry date? Programmatic rotation needs an extra Odoo-side setting. | **Manual rotation + warning.** Programmatic rotation is deferred. |
| **OQ-ODC-7** | One PMO org binds to **one Odoo database and one Odoo company**, chosen at activation and set once (as ERPNext's company is)? | **Yes.** Changing either later requires disconnect and an explicit discard of the mirror and mappings, and is refused once any ERP document reference exists. |
| **OQ-ODC-8** | May an org have **both ERPNext and Odoo** bound? | **No.** One ERP tier per org; connecting a second is refused with a clear message. |
| **OQ-ODC-9** | Which Odoo versions are in scope? Research found JSON-2 is the documented API for the new releases and that older releases only have the legacy RPC (removal scheduled for a later major). | **JSON-2 only.** An instance without JSON-2 is refused with a version message. No legacy-RPC fallback is built. (#1482 fixed the target at Odoo 20.) |
| **OQ-ODC-10** | One Odoo partner can be both vendor and client; Odoo has no reliable type field (the vendor/customer rank counters stay 0 until a document is posted; V6). PMO `companies` carry exactly one type. | **One PMO company row per role per partner**, the same collision rule ERPNext uses (`Supplier:x` / `Customer:x`); the role is chosen in the adoption review, with a rank-based suggestion. |
| **OQ-ODC-11** | Item and unit **creation** from PMO (a command)? | **No in O1.** Items and units are read-only mirrors. Item create/edit arrives with inventory (T1) / stock (O5) if wanted. |
| **OQ-ODC-12** | Warehouse annotation in PMO (central vs site, which projects a site serves)? | **No in O1.** Warehouses and locations are a read-only directory plus one default receiving warehouse in the org config. Annotation belongs to T1, which owns the inventory model. |

---

## 1. Problem and job stories

**Problem.** The EPC prospect runs Odoo Community as its accounting and stock system and will use PMO as its only interface (ADR-0094). Today PMO has an ERPNext adapter and no Odoo adapter, so there is nowhere to connect Odoo, nothing to say which Odoo records PMO's projects, vendors, items, warehouses and accounts correspond to, and no way for a user to see that the connection is down. Every later Odoo slice (purchase, invoices, actuals, stock, cash, hours, fleet) needs these mappings first.

**Job stories.**
- *When I am the org admin onboarding the client, I want to connect our self-hosted Odoo with an API key and see right away whether PMO can really use it, so I do not discover a missing module or a bad key a week into the pilot.*
- *When the connection drops, a key expires or a module is removed, I want PMO to say so plainly on the screens I use, and keep showing the last known data with its age, so nobody acts on stale data believing it is fresh.*
- *When I set up the pilot project, I want to pick (or create) the Odoo cost account that this project's costs will land on, and have PMO remember it, so every purchase and invoice later carries the right project.*
- *When we bring over the existing vendors and clients, I want PMO to match them to what is already in PMO and show me only the ambiguous ones, so I never get duplicates and never silently merge two companies.*
- *When a site engineer picks an item or a warehouse, I want the list to be Odoo's real catalogue, so what they request is something the warehouse can actually stock.*

## 2. Scope and out of scope

**In scope (this spec):** connection lifecycle and credential custody for tier `odoo`; stock-API capability discovery; connection state and its visibility; the master-data read model and its change feed (watermark sweep with recovery, deletion census, optional webhook nudge); mappings and PMO screens for **partner, item and unit, project analytic account, warehouse and location, and chart-of-accounts and tax directory plus org account defaults**; PMO-initiated partner create/update and analytic-account create (S5, S7).

**Out of scope (owned by later slices or other tickets):** purchase orders, receipts, vendor bills, payments, withholding (O2 #1505); client invoices, collections, e-Faktur (O3 #1506); journal-line actuals and statements (O4 #1507); stock moves and project consumption posting (O5 #1508); cash journals (O6 #1509); timesheets/labour (O7 #1510); fleet and maintenance (O8 #1511); PMO's own inventory model (T1); user-defined roles (R1/#902); Lark; programmatic API-key rotation; child contacts of partners; item/unit creation; warehouse annotation; Odoo Online, Odoo.sh and Enterprise-only features (not required; nothing here may depend on them); any Odoo customisation, third-party module or Studio change; legacy-RPC fallback.

**Hard constraints carried from the decision record:** stock API only, zero Odoo customisation (ADR-0055 §2, ADR-0094); Odoo Community is the baseline; PMO never holds a competing authoritative copy of an Odoo-owned record; an unavailable or ambiguous outcome is shown honestly, never as success (ADR-0094, ADR-0058).

## 3. Domain terms

Existing terms (defined in `docs/glossary.md`) are used unchanged: **source of truth**, **externally-owned domain**, **read-model (mirror)**, **enhancement**, **capability map**, **adapter**, **adapter contract**, **external tier**, **helper app**.

Proposed glossary additions (added to `docs/glossary.md` when this spec is signed, not before):

- **Connection state** — the machine-derived health of an org's link to an external system: *healthy, degraded, unreachable, credential rejected, credential expiring, not activated, disconnected*. Distinct from *Active* (the binding exists). A connection can be active and unusable.
- **Capability snapshot** — the recorded result of asking a connected system which stock models, fields and permissions it actually offers, with the time and version observed. Later slices read it instead of assuming.
- **Watermark** — the position in an external system's change history up to which PMO has durably applied changes. Recoverable: a failure never advances it, and re-reading from it is always safe.
- **Census** — a periodic full list of the identifiers an external system holds for a kind of record, compared with PMO's mirror to detect deletions that a change feed cannot show.
- **Cost account (Odoo: analytic account)** — the Odoo object a project's costs and revenue are tagged to. PMO's project maps to one cost account; Odoo's Project app is not required.
- **Account defaults** — the org-level choice of Odoo accounts PMO falls back to (payable, receivable, expense, cash, bank, stock valuation, stock consumption).

Odoo terms used (stock models, **verify each on the dev bed**): `res.partner` (party), `product.product` / `product.template` (item), `uom.uom` (unit), `stock.warehouse`, `stock.location`, `account.account`, `account.tax`, `account.analytic.account`, `account.analytic.plan`, `res.company`.

## 4. Data ownership (ADR-0055, ADR-0059, ADR-0094)

| Data | Source of truth | PMO holds | Writable from PMO? |
|---|---|---|---|
| Connection, credential, capability snapshot, connection state | **PMO** | binding row, vault secret, config | Admin only (§8) |
| Partner (name, tax id, active, payment terms) | **Odoo** (party-master exception: Posture A + adopt, as `companies` already works for ERPNext) | `companies` row + `external_refs` | Only as a command to Odoo (S7); never a local-only edit of an Odoo-owned field |
| Partner role (vendor/client), archive flag, PMO notes | **PMO** (Odoo has no such field) | `companies.type`, `archived_at`, … | Yes (enhancements) |
| Item, unit | **Odoo** | read-model rows | No (OQ-ODC-11) |
| Warehouse, location | **Odoo** | read-model rows | No (OQ-ODC-12) |
| Account, tax | **Odoo** | read-model rows | No |
| Cost account (analytic account) existence, name, code | **Odoo** | read-model row | Create only (S5) |
| PMO project ↔ cost account link | **PMO** (enhancement; Odoo has no notion of the PMO project) | `external_project_bindings` row | Admin/Operator/owning PM |
| Account defaults, PMO-unit→Odoo-unit map, default warehouse | **PMO** | binding `config` | Admin, Finance |

A mirrored copy is never a second source of truth (ADR-0094). Edits made in Odoo's own UI are legitimate and arrive through the feed (ADR-0055 §3). No field is writable in two places.

---

## 5. Requirements (EARS)

### 5.1 Connection lifecycle and credential custody

- **FR-ODC-001** — When an org Admin or platform Operator submits a connect request (site URL, database name, API key, optional declared key-expiry date), the system SHALL validate it against the Odoo instance **before** storing anything. Validation SHALL require an `https` URL, SHALL refuse private, loopback, link-local, metadata and otherwise non-public destinations (both A and AAAA answers), SHALL not follow redirects, and SHALL perform one authenticated read through the stock JSON-2 endpoint with the supplied key and database (V1, V2, V3). The shared ERP host guard (`supabase/functions/_shared/erpHostGuard.ts`) SHALL be the single destination check, used again on every later call, not only at connect.
- **FR-ODC-002** — The system SHALL classify a failed validation into distinct, user-safe outcomes: unreachable or timed out; TLS failure; not an Odoo instance; JSON-2 not offered (version too old, OQ-ODC-9); database not found; key rejected; key valid but without access; and SHALL never echo an upstream response body, traceback or secret in the response, log or audit row.
- **FR-ODC-003** — When validation succeeds, the system SHALL store the API key only in the server-side secret store (Supabase Vault, the same custody the ERPNext connect path uses) and record the reference in `external_org_bindings` (tier `odoo`, `site_url`, `secret_ref`, `version_major`, `config`). The key SHALL never be written to `config`, a table column, a log line, an error string, an audit row or any response, and SHALL never reach the browser. All calls to Odoo SHALL be made by PMO edge functions; the browser never contacts Odoo.
- **FR-ODC-004** — The connect SHALL be atomic at the domain boundary (ADR-0061 §3): binding, secret and any ownership change commit as one logical operation; on any failure no active binding remains and a created secret is revoked or deterministically cleaned up (the ClickUp connect already stages the secret, then commits through `finalize_external_connect` and cleans up with `cleanup_external_connect_attempt`, migrations 0147, 0259 and 0346; the ERPNext connect writes the secret and site URL in separate steps and leaves an inert partial binding on failure. Odoo SHALL follow the atomic ClickUp pattern, extended for tier `odoo`, not the ERPNext sequence).
- **FR-ODC-005** — The system SHALL require activation before any read, sweep or mapping runs (ADR-0073): after a successful connect the Admin chooses the Odoo company from the companies the key can access (auto-proposed when there is exactly one); activation records the company and sets `activated_at` once, in one guarded statement. Until activated, the only permitted calls are connect validation and company listing.
- **FR-ODC-006** — When an Admin reconnects (a new key), the system SHALL validate as in FR-ODC-001, replace the secret, and revoke the previous one only after the new binding commits, preserving the mirror, mappings and watermarks. Reconnecting to a **different database or company** SHALL be refused unless the Admin confirms discarding the tier's mirror and mappings, and SHALL be refused outright when any external document reference exists for the org (OQ-ODC-7).
- **FR-ODC-007** — When an Admin disconnects, the system SHALL delete the secret, set the binding `disconnected`, release any ownership it employed, stop all sweeps for the org, keep the mirror and mappings visible but marked disconnected with their last-synced time, and write an audit row. Disconnect SHALL be idempotent. Reconnecting to the same database and company SHALL resume from the retained watermarks.
- **FR-ODC-008** — The system SHALL refuse to connect Odoo while the org has an active binding for another ERP tier (OQ-ODC-8).
- **FR-ODC-009** — While the operator kill-switch is off, no PMO path SHALL call Odoo for any org (fail closed, ADR-0061 §2); the per-org binding, not a deployment flag, is otherwise the enablement authority.
- **FR-ODC-010** — The credential for any Odoo call SHALL be resolved from the active, activated binding and its vault secret at call time; a missing, ambiguous or unresolvable credential SHALL fail closed with a classified refusal (ADR-0072 stance), never fall back to another org's or a global credential.
- **FR-ODC-011** — Every connect, reconnect, activate, disconnect, credential-rejected transition and discovery change SHALL write an audit row carrying actor, org, tier and outcome class, and never a secret or upstream body (ADR-0060 §8 principle).

### 5.2 Capability discovery

- **FR-ODC-020** — On connect, on activation, on reconnect, on explicit re-check, and once per day from the sweep, the system SHALL run capability discovery using only stock JSON-2 calls and record a **capability snapshot** in the binding config: observed Odoo version, JSON-2 available, accessible companies, and for each model PMO uses (required for O1: `res.company`, `res.partner`, `product.product`, `uom.uom`, `stock.warehouse`, `stock.location`, `account.account`, `account.tax`, `account.analytic.account`, `account.analytic.plan`) whether it exists, which of read/create/write/unlink the key has, and whether each field PMO reads is present. The snapshot SHALL also record presence (not use) of the models later slices need (purchase, invoicing, stock moves, hr timesheets, fleet, maintenance) so O2–O8 read it instead of probing again. Discovery SHALL NOT require reading the installed-modules model (V4).
- **FR-ODC-021** — If a model or field required for O1 is missing or inaccessible, the connection state SHALL be *degraded* with the named missing items; the mapping and screens for the affected kind SHALL be disabled with the reason; the connection SHALL not report *healthy*.
- **FR-ODC-022** — The version policy SHALL be: refuse when JSON-2 is absent; allow a version newer than the tested range with an "untested version" notice and no block; record the tested range in code so it can be widened by a code change and a bed run.
- **FR-ODC-023** — A change between two snapshots (module removed, permission lost) SHALL set the connection *degraded* and write an audit row; a restored capability SHALL clear it on the next discovery.

### 5.3 Connection state and visibility

- **FR-ODC-030** — The system SHALL derive and persist (machine-written) a connection state for each Odoo binding: *not activated, healthy, degraded, unreachable, credential rejected, credential expiring, disconnected*, with `last_ok_at`, `last_checked_at` and an error **class** (no raw message). *Credential expiring* SHALL be raised within 14 days of the Admin-declared expiry date (OQ-ODC-6); the key itself may be valid.
- **FR-ODC-031** — A network failure, timeout or 5xx SHALL move the state to *unreachable* only after 3 consecutive failed probes (sweep ticks or user-triggered checks) to avoid flapping; a 401 or 403 on a previously working key SHALL move it to *credential rejected* immediately; any success SHALL clear the failure counter. A user-triggered check SHALL probe immediately.
- **FR-ODC-032** — The Integrations screen SHALL show, for the Odoo connection, the connection state in plain words, its age, and the named reason and next step (reconnect, wait, ask the Odoo admin to restore a module). The state SHALL be visible to every user who can see master-data screens (a banner), not only to the Admin on the settings page.
- **FR-ODC-033** — While the connection is not healthy, every PMO screen that shows Odoo-derived master data SHALL keep showing the last mirrored data with an "as of <time>" label and a persistent notice that Odoo is unavailable; reads SHALL NOT be blocked (ADR-0055 §4). A PMO action that needs Odoo (create analytic account, partner command, re-check) SHALL fail honestly with "Odoo is unreachable, try again" and SHALL never be queued or reported as done.
- **FR-ODC-034** — The system SHALL NOT present *healthy* from the existence of a binding alone, from the last write succeeding, or from a cached flag older than two sweep intervals (the connect leg and the use leg are separate claims).

### 5.4 Master-data read model and change feed

- **FR-ODC-040** — The system SHALL maintain a machine-written read model of these Odoo kinds for the activated company: partner (into `companies`, §5.5), item (`product.product`), unit (`uom.uom`), warehouse, location, account, tax, cost-account plan and cost account (analytic), and the company list. Item rows SHALL carry code, name, unit, active, and the purchasable / sellable / storable flags; account rows SHALL carry code, name, type, active, and company; location rows SHALL carry full path, usage type, parent and owning warehouse. Exact fields per kind are confirmed on the bed (V5–V9) and parsed by one validator per kind; an unparseable row SHALL be skipped and counted, never partially written.
- **FR-ODC-041** — The read model tables SHALL be writable only by the service role. Every write SHALL carry the `org_id` resolved from the verified binding, never an id from a request body; a user JWT SHALL be unable to insert, update or delete a mirror row (`force row level security`, no write policy, no client write grant).
- **FR-ODC-042** — Each (org, tier, kind) SHALL keep a **watermark** cursor of `(write_date, id)` in `external_sync_watermarks`. Each sweep SHALL read changes with `write_date` at or after the cursor minus an overlap window (default 10 minutes), ordered `write_date asc, id asc`, in bounded pages, including archived records (V10), upsert them idempotently keyed `(org_id, external_tier, kind, external_id)`, and advance the cursor **only after** the page is durably applied. An upsert SHALL never replace a row with an older `write_date`. A failure at any point SHALL leave the cursor where it was.
- **FR-ODC-043** — The overlap window exists because a change committed late can carry an earlier `write_date` than already-read changes; the system SHALL therefore treat re-reading as normal and guarantee that doing so changes nothing. The system SHALL NOT use a strict greater-than on `write_date` alone as its cursor.
- **FR-ODC-044** — When no cursor exists the sweep SHALL perform a full, resumable, paged scan; progress SHALL be recorded so an interrupted scan resumes, and a scan that exceeds its per-tick budget SHALL continue on the next tick.
- **FR-ODC-045** — A change feed cannot show hard deletions, so the sweep SHALL run a **census** per kind (at least daily, and after an initial load): fetch the full set of ids (including archived), and for every mirrored id not returned set `tombstoned_at` (never delete the row); a returning id SHALL clear the tombstone. An archived Odoo record (`active = false`) SHALL be mirrored as inactive, not tombstoned.
- **FR-ODC-046** — Sweeps SHALL be single-flight per (org, tier), use at most one in-flight request per org to Odoo, pace requests (default 5 per second; 1 per second and a warning when the host is recognised as Odoo-operated hosting, V11), apply a per-call deadline, and stop at a per-tick budget with the cursor saved. A sweep SHALL only run for an activated, non-disconnected binding with the kill-switch on.
- **FR-ODC-047** — A scheduled tick SHALL trigger the sweep for every activated Odoo binding (same cadence as the ERPNext sweep, 5 minutes) and SHALL be a no-op for orgs without one. An Admin or Finance user SHALL be able to trigger "Refresh now" for their org, rate-limited to once per minute.
- **FR-ODC-048** — An Admin or Operator SHALL be able to reset the cursors of one kind ("resync from scratch"); because every upsert is idempotent the reset SHALL be safe and SHALL itself write an audit row.
- **FR-ODC-049** — *(Optional slice S8.)* Where the Odoo admin has configured an outgoing automation webhook, the system SHALL accept it at a per-org endpoint authenticated by a per-org secret compared in constant time, and SHALL treat the body only as a hint (model and ids): it SHALL trigger a targeted by-id re-read through the authenticated JSON-2 client and SHALL never write mirror data from the webhook payload. A dropped, duplicated, forged or out-of-order webhook SHALL have no effect beyond a redundant re-read; correctness SHALL rest on the sweep (ADR-0055 §3).

### 5.5 Mappings

**Partner**

- **FR-ODC-050** — When the sweep reads an Odoo partner that is a company, or an individual with no parent company, the system SHALL decide one of: *link* to an existing PMO company (a unique match on tax id, or on normalised exact name when neither side has a tax id and exactly one candidate has the chosen role), *create* a PMO company, or *review* (more than one candidate, a name match with conflicting tax ids, or an unset role). The decision SHALL be a pure function of the partner and the candidate snapshot (the `partyAdopt.ts` shape), and SHALL never merge two companies without an Admin or Finance review decision.
- **FR-ODC-051** — Adoption SHALL be exactly-once under concurrency: the `external_refs` uniqueness on `(org_id, domain, external_record_id)` SHALL be the guard, and two simultaneous adoptions of one partner SHALL leave exactly one PMO company.
- **FR-ODC-052** — The partner external id SHALL encode the PMO role (OQ-ODC-10), so one Odoo partner can map to a vendor row and a client row without collision. The role suggestion SHALL come from the partner's vendor/customer rank only as a hint, with the Admin choosing in review (V6; party review rows are Admin-only, account rows Finance, per the connect-anytime setup — DD-ODC-052, 2026-11-02). A PMO company of type Internal SHALL never be linked.
- **FR-ODC-053** — Child contacts of a partner SHALL NOT be mirrored or adopted in O1 (out of scope; matches the shipped contacts-deferred ruling).
- **FR-ODC-054** — While the org employs `companies` under tier `odoo`, native fields of a mirrored company (name, tax id, payment terms, active) SHALL be changeable only through the partner command (S7) or arrive from Odoo; PMO enhancements (role, `archived_at`, notes) SHALL remain editable. The per-command ownership guard SHALL follow the shipped `companies` pattern (`companies_native_mirror_guard`, migration 0097) and SHALL be tier-scoped (migration 0135).
- **FR-ODC-055** — *(S7)* When an authorised user creates or edits a company whose domain is Odoo-owned, the system SHALL send a synchronous command to Odoo (create or update the partner), commit through the adapter, store the external reference, and show Odoo's verdict (including its validation message class) in the form. The command SHALL derive its idempotency key from the PMO company id (never mint per attempt), SHALL look the partner up by a stable anchor (PMO id carried in a stock text field, V12) before creating, and SHALL treat an inconclusive probe after an uncertain outcome as **held for resolution, not reissued** because the anchor is editable in Odoo (ADR-0058 C-1). The command SHALL go through the existing outbox lifecycle (claim, commit, confirm) so a retry cannot create a second partner.

**Item and unit**

- **FR-ODC-060** — PMO SHALL expose Odoo's active, purchasable items (and, separately, sellable items) as a searchable picker backed by the mirror, with code, name and unit; no PMO-authored item catalogue authority exists (as `itemCatalog.ts` for ERPNext, but served from the mirror rather than live reads).
- **FR-ODC-061** — The Admin or Finance user SHALL be able to map each distinct PMO unit text used in the org's work items and procurement lines to an Odoo unit; the map SHALL live in the binding `config` and be written through the actor-checked config RPC. An unmapped PMO unit SHALL be listed as unmapped and SHALL block nothing in O1 (it is consumed from O2 on, where an unmapped unit SHALL refuse the line, fail closed).

**Cost account (analytic)**

- **FR-ODC-070** — The Admin, Operator or owning Project Manager SHALL be able to link a PMO project to one Odoo cost account chosen from the mirror, stored in `external_project_bindings` (tier `odoo`, `external_container_id` = Odoo analytic account id, config carries the plan), through the actor-checked link function (migration 0398 pattern). A cost account SHALL map to at most one PMO project; linking an account already linked, or a project already linked, SHALL be refused with the current holder named by project number only.
- **FR-ODC-071** — Odoo's Project application SHALL NOT be required: the link targets `account.analytic.account` directly (DD-ODC-3). The system SHALL record which analytic plan the project accounts belong to (chosen once at activation, or created through the command in FR-ODC-072) and SHALL list only accounts of that plan as link candidates.
- **FR-ODC-072** — *(S5, OQ-ODC-5)* When a project has no cost account, an authorised user SHALL be able to create one from PMO. The command SHALL name the account with the PMO project number, search for an existing account carrying that code in the chosen plan and company **before** creating, link on a unique hit, and go through the outbox lifecycle so a double click or a timeout-then-retry cannot create two. An ambiguous probe SHALL end *held*, not reissued.
- **FR-ODC-073** — Un-linking or re-linking a project that already has any external document reference (introduced from O2 on) SHALL be refused; in O1 un-linking is permitted and audited. The refusal SHALL be implemented as a single check function that later slices extend, not a copy per slice.
- **FR-ODC-074** — The link SHALL be reconciled by the sweep: if the linked Odoo account is archived, tombstoned or moved to another company, the project's link SHALL show *needs attention* with the reason and SHALL block downstream posting slices (fail closed), without deleting the link.

**Warehouse and location**

- **FR-ODC-080** — PMO SHALL present the warehouses and locations of the activated company as a read-only directory (hierarchy, usage type, active, owning warehouse) from the mirror, with the "as of" label (FR-ODC-033). The org config SHALL hold one **default receiving warehouse**, chosen from active warehouses; deleting or archiving it in Odoo SHALL mark the default *needs attention*.

**Accounts, taxes and defaults**

- **FR-ODC-090** — PMO SHALL present the company's chart of accounts and active taxes (from the Indonesian localisation if installed, V13) as a read-only directory for roles allowed to read financial data, with account type and active flag. The capability snapshot SHALL record whether Indonesian accounts and the PPN / PPh taxes are present (PPN 11% and 12%, withholding); their absence SHALL make the connection *degraded* with a message to the Odoo admin, since PMO does not install localisation.
- **FR-ODC-091** — Admin and Finance SHALL be able to set **account defaults** in the binding config: payable, receivable, expense, cash, bank, stock valuation, stock consumption. Each default SHALL be chosen from the mirror; the system SHALL refuse a default that is a group/view account or an inactive account when the type is known (V8). A default that later becomes inactive or tombstoned SHALL show *needs attention*. Category-to-account attribution for budget-versus-actual is O4's mapping, not O1's (DD-ODC-5).

### 5.6 Interfaces that later slices rely on (contract, not behaviour)

- **FR-ODC-100** — The system SHALL provide one server-side function that returns an authenticated Odoo client for an org (the Odoo analog of `erpClientForOrg`), refusing with a classified reason (`not-found`, `inactive`, `invalid-site`, `credentials`, `company-not-set`, `kill-switch`), and applying the destination guard, deadline and pacing of FR-ODC-001/046. No later slice SHALL build its own client or resolve the key itself.
- **FR-ODC-101** — The adapter SHALL implement the adapter contract (`pmo-portal/src/lib/adapterSeam/contract.ts`): `tier = 'odoo'`, a capability map listing only `companies` as an ownership-flipping domain, `listChangesSinceWatermark` and `getByExternalId` for `companies` and the read-model kinds, and `commit` for `companies` (create/update) and the cost-account create. PMO code above the contract SHALL see no Odoo vocabulary.
- **FR-ODC-102** — The system SHALL expose read helpers for later slices: the capability snapshot, the project's cost account (fail closed when unlinked or needs-attention), the unit map, and the account defaults. A caller that cannot resolve a value SHALL receive an explicit unresolved result, never a silent default.

### 5.7 PMO screens

- **FR-ODC-110** — Administration → Integrations SHALL gain an Odoo card with the connect form (site URL, database, API key as a masked field, optional expiry date), the activation step (company choice), the connection state (FR-ODC-032), reconnect, disconnect with confirmation, re-check, and a setup checklist: connected, activated, capability OK, partners reviewed, projects linked, account defaults set, unit map complete, default warehouse set. The checklist SHALL name what is incomplete without blocking use of the finished parts.
- **FR-ODC-111** — The system SHALL provide read-only directory screens for items and units, warehouses and locations, accounts and taxes, and cost accounts, each searchable, paged over the whole set (no silent truncation at the platform read cap), with the "as of" label, the unavailable notice, and counts of inactive and tombstoned rows.
- **FR-ODC-112** — The system SHALL provide the project-link screen (per project and as a bulk map of all projects, in the manner of the shipped project binding map and `ProjectMatchReview`) and the partner review queue (ambiguous and unset-role partners, with the candidates and the evidence for each).
- **FR-ODC-113** — Every control SHALL be shown only when the real JWT role may use it (`can()`, UX only) and SHALL be refused server-side regardless (§8). Impersonation SHALL grant no authority. All strings SHALL be in English and Bahasa Indonesia with parity (the i18n completeness guard).
- **FR-ODC-114** — UI composition SHALL be designed at build time with the project's design skills against `DESIGN.md` tokens, information-rich rather than bare; tests assert user actions and states, not looks.

---

## 6. Non-functional requirements

- **NFR-ODC-001 (confidentiality)** — The API key SHALL exist in plaintext only inside the server function that calls Odoo, for the duration of the call. No code path outside S1/S2's resolver reads the vault secret. Secret-bearing objects SHALL not be passed to loggers or error reporters; a test SHALL fail if a known sentinel key appears in any log, response, error event or audit row produced by a failing connect.
- **NFR-ODC-002 (tenancy)** — Every table is `org_id`-scoped with the column default and stamp trigger; service-role writers enforce org scoping themselves because RLS does not protect them; a two-org test SHALL prove org A's sweep and webhook cannot write org B's rows and org A's JWT cannot read org B's.
- **NFR-ODC-003 (least privilege in Odoo)** — Documentation (runbook) SHALL tell the client to create a dedicated service user with only the access PMO needs, an empty interactive password, and a key; PMO SHALL not ask for or store an Odoo user password, and SHALL report in the capability snapshot when the key has more access than O1 uses *only* as information.
- **NFR-ODC-004 (performance)** — Initial scan of 50,000 partners / 100,000 items completes in bounded ticks without exceeding the pacing limits; one sweep tick uses a bounded number of Odoo calls and bounded edge-function time; the mirror directory screens page server-side.
- **NFR-ODC-005 (idempotency and recovery)** — Any sweep, census, webhook or command SHALL be safe to repeat and safe to interrupt at any statement; re-running a window produces identical rows.
- **NFR-ODC-006 (honesty)** — No screen, API response or audit row SHALL describe an unconfirmed Odoo outcome as success. Reads from the mirror SHALL always carry their age.
- **NFR-ODC-007 (reversibility)** — Migrations are reversible (documented down steps) and additive to shared tables (`external_org_bindings`, `external_project_bindings`, `external_sync_watermarks`, `external_refs`, `external_command_outbox` are shared; "new tiers add rows, never new tables" for connections, OD-ENA-SHARED-BINDINGS). Dropping the new read-model table loses no PMO-authored data.
- **NFR-ODC-008 (no customisation)** — The adapter SHALL work against a stock Odoo Community with no custom or third-party module and no Studio change; any capability that needs one SHALL be reported *unavailable*, never worked around.
- **NFR-ODC-009 (no Odoo vocabulary above the contract)** — Odoo model names, field names and ids appear only inside `pmo-portal/src/lib/adapterSeam/odoo/**` and the edge functions that wrap it (mirrors NFR-EAS-CONTRACT-001); a guard test SHALL fail if they appear elsewhere in `pmo-portal/src` outside the directory screens' display strings.
- **NFR-ODC-010 (public-repo hygiene)** — Specs, tests, fixtures and runbooks in this repo SHALL use synthetic hostnames, databases and keys only; no client identity, host, tenant or secret coordinate is committed.
- **NFR-ODC-011 (accessibility and responsiveness)** — Screens meet WCAG AA, keyboard operation, and work at 320 px width.

---

## 7. Design decisions taken here (`DD-ODC-#`)

- **DD-ODC-1 — Connection is a row, not a table.** Tier `odoo` is a row in `external_org_bindings` with `status` in (`active`, `disconnected`) as today. Connection health is new additive machine-written columns (or the existing health read extended, builder confirms against `IntegrationHealth` and the sweep-status mechanism before adding columns); no second connection table.
- **DD-ODC-2 — Custody reuses the ERPNext Vault path.** The key is one static bearer credential, so Supabase Vault (the staged-secret pattern `stage_vault_secret_for_org` + `finalize_external_connect`, extended for tier `odoo`) is the right fit; ADR-0060's app-layer encrypted refresh-token store is for rotating OAuth tokens and is not needed. ADR-0060's behavioural rules (server-only, proxied calls, metadata-only audit, stale-on-reject, deletion on disconnect) all apply and are written as FRs above.
- **DD-ODC-3 — Map PMO projects to analytic accounts directly.** Research reported that Odoo's project record points at an analytic account; PMO does not need Odoo's Project application at all, and requiring it would add an installed module the prospect may not run. The link target is `account.analytic.account` in a chosen plan (V9).
- **DD-ODC-4 — One generic read-model table for the master kinds.** A single machine-written table keyed `(org_id, external_tier, kind, external_id)` with typed common columns (code, name, parent, active, tombstone, source write date, as-of) and a validated `attrs` JSON for kind-specific fields. Reason: five-plus kinds that O2/O5/T1 will only read; one set of RLS, sweep and census code; no per-kind migration churn. The existing `erp_account_mirror` is ERPNext-shaped (nested set, report type) and is **not** reused or altered. Partners do not use it: they flow into the existing `companies` table.
- **DD-ODC-5 — Account defaults in O1, category attribution in O4.** The shipped `budget_category_account_map` is an Admin-only bijection built for ERPNext budget push; Odoo Community has no budget object, so reuse is decided when O4 needs actuals attribution (O4 reads that table's DDL and validators first and extends additively if they hard-code ERPNext).
- **DD-ODC-6 — Change detection is sweep-first.** The webhook is a latency nudge only and optional (OQ-ODC-3).
- **DD-ODC-7 — Domain names.** Watermark and external-ref domains: `companies` (partners) and `master:<kind>` for the read-model kinds. Only `companies` is ownership-flipping.
- **DD-ODC-8 — Tested range.** The adapter declares a tested Odoo major range in code; the dev bed run decides it. No claim of support beyond a run on the bed.

---

## 8. Authorization and separation of duties

Authorization is enforced on the server (edge function role gate + security-definer RPC or RLS), never by the UI alone (ADR-0016, ADR-0019). `can()` only hides affordances. Real JWT role decides; view-as grants nothing.

| Action | Roles allowed | Server enforcement | Notes |
|---|---|---|---|
| Connect, reconnect, activate, disconnect, re-check | Admin of the org, platform Operator | edge fn gate (`isAdminOrOperator`) + RPC actor check | Same as ERPNext connect (`external-connect`/`external-disconnect`) |
| Reset a kind's cursors ("resync from scratch") | Admin, Operator | RPC | Audited |
| "Refresh now" | Admin, Finance | edge fn gate, rate limit | |
| Link / un-link a project to a cost account | Admin, Operator, the project's Project Manager | actor-checked link function (migration 0398 pattern) | Re-link refused once documents exist (FR-ODC-073) |
| Create the cost account in Odoo | same as link | edge fn gate + outbox | |
| Account defaults, unit map, default warehouse | Admin, Finance | actor-checked config RPC (`merge_external_org_binding_config` is service-only; the new wrapper checks the actor) | Money-adjacent: defaults decide where later postings land |
| Partner review decisions (link / create / merge) | Admin, Finance | RPC | A merge needs a recorded decision, never automatic |
| Partner create/update command (S7) | roles that may write `companies` today (Admin, Executive, Project Manager, Finance) | existing `companies` write policy + dispatch authorisation | |
| Read items, units, warehouses, locations, cost-account list | all active org members | RLS `org_id = auth_org_id() and is_active_member()` | needed by site users later |
| Read accounts, taxes, account defaults, capability snapshot detail | Admin, Executive, Finance | RLS by kind | Financial structure; widened by R1 (#902) when it lands |
| Read connection state | all active org members | RLS on the binding's non-secret columns | The vault reference column SHALL not be exposed to non-admins |

**SoD.** O1 moves no money, so no approver/author pair applies. The relevant integrity rules are: (a) a mapping edit never rewrites an already-posted document (enforced from O2 by FR-ODC-073); (b) the user who changes account defaults is recorded (`who set the value`), so a later review can see who decided where money lands; (c) a credential change is never silent: it is audited and shown. New actions register in the role × module × action matrix when R1 lands; until then they ride the built-in roles above.

---

## 9. Verify on the dev bed (`V#`)

A parallel worker is standing up a stock Odoo 20 Community bed. **Every claim below comes from research documents and has not been run.** The builder of the owning slice records the bed's actual response in the slice's test fixtures (synthetic data only) before relying on the claim; a mismatch is reported to the Director and this table is amended, not silently worked around.

| # | Claim to verify | Used by |
|---|---|---|
| V1 | `POST /json/2/{model}/{method}` with `Authorization: bearer <key>` works on stock Community 20; request/response shape and error body shape (status codes for bad key, wrong database, no access, missing model). | FR-001/002, client |
| V2 | The `X-Odoo-Database` header is required or optional depending on db filter; behaviour when the database is wrong or absent. | FR-001/002 |
| V3 | The cheapest authenticated "who am I / is this key valid" call that a minimally-privileged service user can make (candidate: `res.users` `context_get`, or a one-row `res.company` read). | FR-001 |
| V4 | Whether a non-admin service user can read the installed-modules model; if not, model/field presence is probed with `fields_get` and an access check instead. Which method name the access check has in 20. Whether a missing model returns a distinguishable error. | FR-020 |
| V5 | `product.product` vs `product.template` field set in 20: purchasable/sellable flags, storable flag (the type/storable split), unit field(s), `active`, `default_code`. | FR-040/060 |
| V6 | `res.partner`: vendor/customer rank semantics (zero until a document is posted?), company vs person (`is_company`, `parent_id`), `vat` for the Indonesian tax id and the localisation's extra tax fields, `ref`, `active`. | FR-050/052 |
| V7 | `uom.uom` model shape in 20 (the unit category and relative-factor design changed across recent versions). | FR-040/061 |
| V8 | `account.account` in 20: company scoping (single company vs company list), type field and values, whether group/view accounts exist, `active`/deprecated flag, code. | FR-040/091 |
| V9 | `account.analytic.account` / `account.analytic.plan`: fields, plan membership, company, whether a default plan exists without the Project app, uniqueness (none expected on `code`), and what the Project app's own link field is called if installed (not used). | FR-070/071/072 |
| V10 | `write_date` on every kind PMO reads: precision (whole seconds?), UTC naive string format, ordering stability, behaviour of `active_test` for archived rows in `search_read` (context key) and whether `search_read` returns archived rows when asked. | FR-042/043/045 |
| V11 | How an Odoo-operated hosted instance is recognisable from its hostname and whether pacing at 1 request per second is needed (used only to warn; self-hosted Community is the target). | FR-046 |
| V12 | A stock text field on `res.partner` and on `account.analytic.account` safe to carry the PMO id as a lookup anchor (`ref` on partner; `code` on analytic account), that it is writable by the service user, not unique-constrained, and how Odoo's own UI treats it. | FR-055/072 |
| V13 | The Indonesian localisation: is it installed on the bed's company, which taxes it creates (PPN 11% / 12%, PPh 21/22/23/4(2)) and their names. | FR-090 |
| V14 | Whether `search_read` with a large `limit` and `offset`/domain cursor behaves stably across pages, and the practical page size on the bed. | FR-042/044 |
| V15 | The webhook automation's payload, headers and any signature, and whether a secret path token is the only available authenticity control. (S8 only.) | FR-049 |
| V16 | API-key behaviours: expiry choices, the error for an expired key versus a wrong key, and whether key age is readable by the key's own user. | FR-030/031 |

---

## 10. Acceptance criteria

Layer key (ADR-0010): **U** = unit (Vitest/RTL; Deno for edge functions), **P** = pgTAP (`supabase test db`, RLS and RPC contracts), **E** = one curated Playwright journey (cross-stack), **B** = live-bed contract test against the stock Odoo bed (Deno, gated on the bed being configured, never on `process.env.CI`; skips are allow-listed per the e2e-skips guard). Each AC has one owning layer; secondary proof is noted only where different layers prove different halves. The owning test names its AC id in its title.

### Connect and custody

- **AC-ODC-001 (FR-001, 003, 004; layer B)** — *Given* a stock bed and a valid key, *when* an Admin connects, *then* the binding is created `active`, the vault holds the key, the binding row and response hold only a reference, and one authenticated JSON-2 read was made. *Secondary U:* private, loopback, link-local, metadata, `http`, redirecting and non-resolving hosts are all refused before any request or write.
- **AC-ODC-002 (FR-002; U)** — *Given* mocked upstream answers (timeout, TLS error, HTML page, 404 on JSON-2, wrong database, 401, 403), *when* validation runs, *then* each maps to its distinct classified outcome and none echoes an upstream body.
- **AC-ODC-003 (NFR-001, FR-011; U)** — *Given* a sentinel key, *when* connect fails at each step (validation, vault write, binding write, finalize), *then* the sentinel appears in no response, log call, error event or audit row, and no active binding or orphan secret remains.
- **AC-ODC-004 (FR-004, 008; P)** — *Given* an org with an active ERPNext binding, *when* connect for Odoo is attempted, *then* it is refused and nothing is written; *given* a failed finalize, *then* no `active` Odoo binding and no secret remain.
- **AC-ODC-005 (FR-005; P)** — *Given* a connected, not activated binding, *when* any read, sweep or mapping write is attempted, *then* it is refused; *when* the Admin activates with a company, *then* `activated_at` is set once and a second activation with another company is refused.
- **AC-ODC-006 (FR-006; B)** — *Given* an activated binding with a mirror, *when* the Admin pastes a new valid key, *then* the old secret is revoked only after the new binding commits and the mirror, mappings and watermarks are unchanged; *when* the new key belongs to another database or company, *then* it is refused unless the discard is confirmed, and refused outright once an external document reference exists.
- **AC-ODC-007 (FR-007; P)** — *Given* an activated binding, *when* disconnect is called twice, *then* the secret is gone, status is `disconnected`, ownership released, sweeps skip the org, mirror rows remain flagged disconnected, and the second call succeeds without effect.
- **AC-ODC-008 (FR-009, 010; U)** — *Given* the kill-switch off, a missing secret, two secrets for one reference, or another org's binding, *when* an Odoo client is requested, *then* a classified refusal results and no request is made.
- **AC-ODC-009 (§8; P)** — *Given* each non-Admin role and an Operator, *when* connect, disconnect and reset RPCs are called with a user JWT, *then* only Admin and Operator succeed; a spoofed `org_id` is ignored; the vault-reference column is unreadable by non-admins.

### Capability and state

- **AC-ODC-010 (FR-020; B)** — *Given* the stock bed, *when* discovery runs, *then* the snapshot records the version, JSON-2, accessible companies, per-model existence and access for every O1 model, field presence, and presence flags for the later-slice models, using no installed-modules read.
- **AC-ODC-011 (FR-021, 090; U+B)** — *Given* a bed (or fixture) where a required model, field or the Indonesian taxes are absent, *when* discovery runs, *then* the state is *degraded* naming the missing items, the affected directory is disabled with the reason, and the state is not *healthy*. Owning layer **U** for the logic, **B** proves the stock bed is *not* wrongly degraded.
- **AC-ODC-012 (FR-022; U)** — *Given* versions with no JSON-2, within the tested range, and newer, *when* policy is applied, *then* the first is refused, the second passes, the third passes with the untested notice.
- **AC-ODC-013 (FR-030, 031; U)** — *Given* a stream of probe outcomes, *when* three consecutive network failures occur, *then* the state becomes *unreachable* (and not before); *when* a 401 follows a success, *then* *credential rejected* is immediate; *when* a probe succeeds, *then* the counter clears; *when* the declared expiry is within 14 days, *then* *credential expiring* shows while the key still works.
- **AC-ODC-014 (FR-032, 033, 034; E)** — *Given* a connected org whose Odoo is then made unreachable, *when* a user opens the item directory and a project's link screen, *then* the last data shows with its age, a persistent "Odoo is unavailable" notice appears on both, creating a cost account fails honestly with a retry message, and nothing is queued. Restoring Odoo clears the notice after the next probe.
- **AC-ODC-015 (FR-033; U)** — *Given* a state last checked more than two sweep intervals ago, *when* the screen renders, *then* it does not show *healthy*.

### Read model and change feed

- **AC-ODC-020 (FR-041, NFR-002; P)** — *Given* two orgs with mirror rows, *when* each org's user JWT reads and attempts insert/update/delete on the read-model table, *then* reads see only the own org, every write is denied with 42501, and a service-role write with the wrong org context cannot touch the other org's rows.
- **AC-ODC-021 (FR-042, 043; U)** — *Given* a page that fails halfway, *when* the sweep is re-run, *then* the cursor did not advance, the replay produces identical rows, and an older `write_date` never overwrites a newer row. *Given* two records sharing one `write_date`, *then* none is skipped across a page boundary. *Given* a record committed late with an earlier `write_date` than the cursor, *then* it is picked up inside the overlap window.
- **AC-ODC-022 (FR-044; U)** — *Given* a first sweep that exceeds its tick budget, *when* the next ticks run, *then* the scan resumes from recorded progress and completes with the same result as an uninterrupted scan.
- **AC-ODC-023 (FR-045; B)** — *Given* mirrored records, *when* one is archived, one hard-deleted and one renamed in Odoo and the sweep and census run, *then* the archived row is inactive, the deleted row is tombstoned and still present, the renamed row is updated; *when* the deleted id returns, *then* the tombstone clears.
- **AC-ODC-024 (FR-040; U)** — *Given* a malformed row of each kind, *when* the sweep parses it, *then* it is skipped and counted and no partial row is written.
- **AC-ODC-025 (FR-046, 047; U)** — *Given* two overlapping sweeps for one org, *then* one runs and the other no-ops; pacing, per-call deadline and per-tick budget are honoured; disconnected, non-activated and kill-switched orgs are skipped. "Refresh now" is accepted once per minute.
- **AC-ODC-026 (FR-048; U+P)** — *Given* a reset of one kind, *when* the sweep reruns, *then* the kind repopulates to the same rows with an audit row written, and only Admin/Operator can reset. Owning layer **P** for the authorization, **U** for the replay.
- **AC-ODC-027 (FR-049; U, S8 only)** — *Given* a forged, replayed, out-of-order or wrongly-authenticated webhook, *then* it triggers at most a redundant by-id re-read and never writes payload content; a valid one triggers one targeted re-read.

### Mappings

- **AC-ODC-030 (FR-050, 051, 052; U)** — *Given* the candidate snapshots (unique tax-id match, unique exact-name match, two name matches, name match with conflicting tax ids, no match, unset role, an Internal company), *when* the decision function runs, *then* the result is respectively link, link, review, review, create, review, never-link; the function is pure (same inputs, same output).
- **AC-ODC-031 (FR-051; P)** — *Given* two concurrent adoptions of one partner, *then* exactly one PMO company and one `external_refs` row exist.
- **AC-ODC-032 (FR-052; U)** — *Given* one Odoo partner with both roles chosen, *then* two PMO rows with distinct external ids exist and neither collides.
- **AC-ODC-033 (FR-054; P)** — *Given* an org employing `companies` under tier `odoo`, *when* a user edits a native field of a mirrored company directly, *then* it is refused (42501); an enhancement field (`archived_at`) edit succeeds; releasing ownership reopens native edits.
- **AC-ODC-034 (FR-055; B, S7)** — *Given* an authorised user creating a vendor in PMO, *when* the command commits, *then* exactly one Odoo partner exists, the external ref is stored and Odoo's validation verdict shows in the form; *when* the response is lost and the user retries, *then* still exactly one partner exists; *when* the anchor was edited in Odoo and the probe is inconclusive, *then* the record ends *held* and no second partner is created.
- **AC-ODC-040 (FR-060; U)** — *Given* mirrored items with mixed flags, *when* the purchase picker and the sales picker load, *then* each lists only active items with the right flag, searchable by code and name, paged over the whole set.
- **AC-ODC-041 (FR-061; P+U)** — *Given* work items and procurement lines using units "m", "m2", "unit", *when* the Admin or Finance user maps two, *then* the third lists as unmapped and blocks nothing; a non-Admin/Finance user's attempt is refused by the RPC (P owns the refusal; U owns the unmapped listing).
- **AC-ODC-050 (FR-070; P)** — *Given* a project and a mirrored cost account, *when* the Admin, the project's PM, and a different PM try to link, *then* the first two succeed and the third is refused; linking an account already held, or a second account on one project, is refused.
- **AC-ODC-051 (FR-071; B)** — *Given* the stock bed with no Project application installed, *when* a project is linked to a cost account of the chosen plan, *then* the link works and the candidate list contains only that plan's accounts.
- **AC-ODC-052 (FR-072; B)** — *Given* a project without a cost account, *when* the user creates one, *then* an account carrying the project number exists once in the chosen plan and company and is linked; a double submit or lost-response retry yields one account; an ambiguous probe ends *held*.
- **AC-ODC-053 (FR-073; U+P)** — *Given* a project link and (from O2 on) an external document reference, *when* un-link or re-link is attempted, *then* it is refused through the single shared check; in O1, with no references, un-link succeeds and is audited.
- **AC-ODC-054 (FR-074; U)** — *Given* a linked account that is archived, tombstoned or moved company in Odoo, *when* the sweep reconciles, *then* the link shows *needs attention* with the reason, the shared resolver (FR-102) returns unresolved, and the link is not deleted.
- **AC-ODC-060 (FR-080; U)** — *Given* mirrored warehouses and locations, *then* the directory shows the hierarchy and usage types; the default receiving warehouse can be chosen only from active warehouses; archiving it in Odoo marks the default *needs attention*.
- **AC-ODC-070 (FR-090, 091; P+U)** — *Given* Admin, Finance, Executive, Project Manager and Engineer, *when* each opens the account directory and attempts to set a default, *then* only Admin, Finance and Executive read it and only Admin and Finance write it (P); a default pointing to a group or inactive account is refused, and a later-inactive default shows *needs attention* (U).
- **AC-ODC-071 (FR-102, FR-100; U)** — *Given* an unlinked project, an unmapped unit, an unset default, and a needs-attention link, *when* a later slice asks for the value, *then* each returns an explicit unresolved result (never a default or a guess).

### Screens and cross-cutting

- **AC-ODC-080 (FR-110, 112, 113; E)** — *Given* a fresh org and a stock bed, *when* the Admin connects, activates the company, reviews one ambiguous partner, links the pilot project to a cost account (created from PMO), sets the account defaults and the default warehouse, *then* the setup checklist shows each step complete and the project's link, the partner and the defaults are visible on re-login. *The curated journey for the ticket's acceptance: master data mapped and read in PMO with no custom module.*
- **AC-ODC-081 (FR-111; U)** — *Given* 2,500 mirrored items, *then* the directory pages server-side over the full set (no silent truncation at the platform read cap) with a correct total.
- **AC-ODC-082 (FR-113; U)** — *Given* each role and an impersonating Admin viewing as a lesser role, *then* only controls the real role may use render, and the server refuses the rest.
- **AC-ODC-083 (NFR-009; U)** — A guard test fails when Odoo model or field names appear in `pmo-portal/src` outside the adapter directory and directory-screen display strings.
- **AC-ODC-084 (NFR-003..011 as applicable; U)** — i18n parity (en/id) passes; screens pass the axe check; mobile 320 px renders without horizontal scroll.
- **AC-ODC-090 (ticket acceptance; B+E)** — *Given* a stock Odoo Community bed with no custom module, *when* a user maps and reads master data in PMO, *then* records and project/account mappings reconcile with Odoo (counts and ids match for every kind; each mapped project resolves to its Odoo account) and, with the bed stopped, the unavailable connection is visible within three probe intervals. Composite of AC-ODC-010, 014, 023, 051, 080; no new test is needed beyond those, and this AC names them as the traceability row for the ticket.

---

## 11. Data model (new and extended; names indicative, builder confirms against the shipped DDL at origin/dev)

All shipped objects named here exist at origin/dev as of this spec (verified 2026-10-31): `external_org_bindings` (0096; `status` active/disconnected 0118; `activated_at` 0216), `external_domain_ownership` (0087), `external_refs` (0088), `external_sync_watermarks` (0089), `external_project_bindings` (0093), `external_command_outbox` and `external_ref_lineage` (0096), `companies` (+ `erp_*` columns, 0097), `erp_account_mirror` (0294, ERPNext-shaped, not reused), `create_vault_secret_for_org` (0118), `merge_external_org_binding_config` (0142), `disconnect_external_integration` (0341), `cleanup_external_connect_attempt` (0346), `activate_external_binding` / `set_external_binding_site_url` (0216), `assert_integration_link_actor` (0398).

New or extended (the migration number is the next free one at build time; a collision is resolved with `scripts/renumber-migration.sh`, never by hand):

1. **`external_master_records`** (new, DD-ODC-4): `id`, `org_id` (default + stamp trigger), `external_tier`, `kind` (check: `product`, `uom`, `warehouse`, `location`, `account`, `tax`, `analytic_plan`, `analytic_account`, `company`), `external_id`, `code`, `name`, `parent_external_id`, `active`, `tombstoned_at`, `attrs` jsonb (validated, kind-specific, never rendered raw), `source_write_date`, `as_of`; `unique (org_id, external_tier, kind, external_id)`; indexes on `(org_id, external_tier, kind, active)` and a trigram/prefix search index on name and code. `force row level security`; select policy by kind (§8), no write policy, no client write grant.
2. **`external_org_bindings`** (extended, additive): tier value `odoo` accepted wherever tiers are enumerated (connect/disconnect functions, sweep enumeration, activation, the Integrations tier list); connection-state columns or an equivalent extension of the existing health read (DD-ODC-1); `config` keys for database, Odoo company, analytic plan, capability snapshot, declared key expiry, account defaults, unit map, default warehouse, pacing.
3. **`external_sync_watermarks`** (reused): `watermark_cursor` holds a small JSON `(write_date, id)` plus scan progress; domains per DD-ODC-7.
4. **`external_refs`** (reused): `companies` partner refs.
5. **`external_project_bindings`** (reused): tier `odoo`, container = Odoo analytic account id.
6. **`companies`** (reused): ownership guard made tier-aware for `odoo`; `erp_*` mirror columns carry the partner's tax id, payment terms, archive timestamp (builder confirms column naming does not leak ERPNext meaning into Odoo rows, or adds tier-neutral columns additively).
7. **Sweep lock / single-flight**: the shipped ERPNext sweep lock is reused if tier-generic, otherwise extended additively by tier (builder verifies).
8. **Scheduler**: a new pg_cron tick for the Odoo sweep, mirroring the ERPNext one (`0102`), reading its URL and sweep secret from Vault (data, created per environment, never committed); a no-op when unset.

New edge functions (names indicative): `odoo-sweep`; connect/disconnect/activate extend the shipped `external-connect`, `external-disconnect` and the company-selection function rather than duplicating them; S8 adds `odoo-webhook`. New shared code: `pmo-portal/src/lib/adapterSeam/odoo/**` (client, discovery, kinds, parsers, partner decision, adapter) and `supabase/functions/_shared/odooClientForOrg.ts`.

## 12. Slice split (each sized for one builder; none may exceed one worker context, split further if it does)

| Slice | Contents | ACs | Blocked by | Executor |
|---|---|---|---|---|
| **S1 — Connect, custody, activation, disconnect** | `odoo` tier in connect/disconnect/finalize/cleanup, destination guard on every call, classified validation, vault custody, atomicity, one-ERP rule, company selection and set-once activation, audit, reconnect/rotation | 001–009 | none; V1–V3, V16 first | **Director-dispatched** (auth/token custody) |
| **S2 — Odoo client, discovery, connection state** | `odooClientForOrg`, JSON-2 client (deadline, pacing, error classification), capability discovery and snapshot, version policy, state machine and persistence, daily re-discovery hook | 010–015 | S1; V4, V16 | **Director-dispatched** (it holds the credential resolver) |
| **S3 — Read model, sweep, watermark, census** | `external_master_records` + RLS, parsers per kind, watermark with overlap and tie-break, initial scan, census/tombstones, single-flight, tick schedule, refresh-now, reset | 020–026 | S2; V5–V10, V14 | Orca worker; `security-auditor` review mandatory (service-role writers, tenancy); DB work under the DB lock |
| **S4 — Directory screens and Integrations card** | Odoo card, setup checklist, items/units, warehouses/locations, accounts/taxes, cost-account directories, state banner, as-of labels, i18n | 040, 060, 081–084 | S3 | Orca UI worker (impeccable, taste, ui-ux-pro-max) |
| **S5 — Project ↔ cost-account link, create command, config** | link RPC reuse, plan selection, bulk project map, create-cost-account command through the outbox, shared re-link refusal, account defaults, unit map, default warehouse, needs-attention reconciliation | 041, 050–054, 060, 070, 071 | S3 (S4 for the UI part) | **Director-dispatched** (adapter commit + outbox + money-adjacent defaults) |
| **S6 — Partner adoption and review** | pure decision function, exactly-once adoption, role encoding, review queue UI, ownership guard for `companies` tier `odoo` | 030–033 | S3 | Orca worker (UI part with design skills); `security-auditor` on the guard |
| **S7 — Partner create/update command** | adapter `commit` for `companies`, derived key, anchor lookup, held-not-reissued, form verdict | 034 | S5, S6 | **Director-dispatched** (outbox) |
| **S8 — Webhook nudge (optional)** | per-org endpoint, constant-time secret, hint-only targeted re-read, runbook for the Odoo-side rule | 027 | S3; V15 | Orca worker; not required for any other AC |
| **S9 — Bed acceptance and runbook** | the live-bed contract suite, the AC-ODC-080/090 journey, the client-side Odoo setup runbook (service user, key, localisation check) with synthetic values only | 080, 090 | S1–S7 | Orca worker (qa-acceptance role) |

Each slice's gate evidence follows the repository's local final gate (guards, typecheck, eslint on touched files, directly touched tests, touched e2e journeys, touched pgTAP files, rendered captures for UI). CI is the full-suite proof. Edge-function tests import the shipped handler and mock `fetch`; no dependency injection in production code.

## 13. Test-layer traceability (ADR-0010)

| Layer | ACs |
|---|---|
| Unit (Vitest/RTL, Deno) | 002, 003, 008, 012, 013, 015, 021, 022, 024, 025, 027, 030, 032, 040, 054, 060, 071, 081–084 (and the logic halves of 011, 026, 041, 053, 070) |
| pgTAP | 004, 005, 007, 009, 020, 031, 033, 050 (and the authorization halves of 026, 041, 053, 070) |
| Live bed contract (Deno, gated on the bed) | 001, 006, 010, 011 (negative half), 023, 034, 051, 052 |
| E2E (one curated journey each) | 014, 080, 090 |

## 14. Risks and notes for the builders

- **Late-committed changes** are the single most likely source of a silently missing record; FR-042/043 and AC-021 exist for it. Do not "simplify" the overlap.
- **Hard deletions** are invisible to any change feed; the census is not optional.
- **Anchors are editable in Odoo.** Treat an inconclusive probe as held (ADR-0058 C-1), not as absent.
- **Do not trust research for Odoo field names.** The two research documents are evidence, not contract (the route plan says so); every `V#` is closed on the bed before code depends on it.
- **Shared tables.** Migrations on `external_org_bindings`, `external_sync_watermarks`, `external_refs` and `companies` change behaviour for ERPNext and ClickUp orgs; every change needs an ERPNext/ClickUp regression assertion (existing suites stay green; no weakened test).
- **Public repo.** Fixtures use synthetic hosts, databases and keys. The runbook and tests contain no client identity or real endpoint.
- **R1 (#902) landing later** will widen the role rules in §8; the server checks here are the floor, not a replacement.
