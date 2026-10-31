# Spec — Connect an ERP at any time, the same way for ERPNext and Odoo (ECA)

- **Status:** Draft for owner sign-off (2026-10-31). Owner requirements of 2026-10-31 (connect anytime, parity, no
  friction) are binding inputs; the defaults in §0 apply until the owner answers.
- **Map:** #1442. Gap slices #1600–#1607 are filed there (§9). Odoo builds O1–O8 (#1504–#1511) must satisfy §6 and the rows
  marked *Odoo* in §9.
- **Grounds (read, not re-derived):** ADR-0055 (adapters, SoT, §5A crossing and epoch), ADR-0059 (Posture A/B,
  never-adopt, derived keys), ADR-0058 (outbox), ADR-0094 (PMO as the only interface; ERP owns ledger, tax, bills,
  payments, stock), ADR-0060 (server-side custody principles), ADR-0048 (ledger-sourced figures);
  `docs/decisions.md` DD-XING-1..6, **OD-XING-1** (history crossing is a connect-time choice, default "start at
  connect"), OD-SEED-4, DD-SETUP-1, DD-UX-1 §4; owner direction 2026-10-16 (map once, PMO proposes, accept all);
  `docs/specs/erpnext-crossing.spec.md`, `procurement-flexible-entry.spec.md` (#1319), `no-erp-revenue.spec.md`,
  `odoo-connect-master-data.spec.md` (#1504), `inventory-project-consumption.spec.md` (#1512); issue #1043.
- **Evidence baseline:** `origin/dev` at `3e0096605`. Every "today" claim in §3 cites the file that decides it.
- **IDs:** `FR-ECA-###`, `NFR-ECA-###`, `AC-ECA-###`, `DD-ECA-#` (decided here), `OQ-ECA-#` (owner questions).

---

## 0. Open questions for the owner (default taken if unanswered)

| # | Question | Default in this spec |
|---|---|---|
| **OQ-ECA-1** | A purchase or expense claim that started in PMO **before** the ERP was connected and continues after it: push its later steps, or finish it in PMO only? | **Finish in PMO only.** Later steps are not sent; the record shows "recorded before the ERP connection, not sent". Matches OD-XING-1 (2): the accountant carries open balances in as an opening entry. Sending a receipt or bill whose order never reached the ERP produces an unlinked ERP document. |
| **OQ-ECA-2** | When the ERP is empty (S-C), may PMO **create** the masters the ERP is missing (clients/vendors, projects, items, employees) after the admin accepts the proposal? | **Yes**, for those four only, after one bulk accept. PMO never creates accounts, taxes or fiscal years: the chart belongs to the accountant (DD-SETUP-1). Missing accounts appear as a setup task. |
| **OQ-ECA-3** | Both sides hold invoices for the same sale (S-D, PMO invoiced before connect and the ERP also holds them individually): which copy counts? | **The ERP copy counts** (ADR-0055 money principle). PMO proposes pairs; once Finance accepts, the paired PMO invoice stops counting and links to the ERP one. Unpaired copies keep counting and stay listed until resolved. |
| **OQ-ECA-4** | An ERP budget already exists for a project and year that PMO would push to (S-D). | **List it; never touch it silently** (already shipped). Offer two actions: *use the ERP figures as a PMO draft version*, or *replace the ERP budget with PMO's active version* (explicit confirm). |

## 1. Problem and job stories

PMO today connects cleanly in one order only: a PMO org that starts with an ERP holding data (S-A). The other
orders either work by accident, break silently, or need an operator. The owner requires all four to work, the
same way for every ERP, with one setup pass.

| Scenario | PMO org | ERP at connect | Job story |
|---|---|---|---|
| **S-A** | new | holds data | *When we connect an ERP we already run, I want PMO to bring in our clients, vendors, projects and items and show our history, so we start with what we have.* |
| **S-B** | new | none | *When we start without an ERP, I want PMO to work fully on its own, so a later connection is a setup step, not a migration.* |
| **S-C** | operational | new, empty | *When we install a fresh ERP after using PMO, I want PMO to fill it with the clients, vendors, projects, items and people it needs, so documents push without hand-keying.* |
| **S-D** | operational | holds data | *When both systems already hold records, I want PMO to pair what is the same, ask only about what is unclear, and never create duplicates or count money twice.* |

## 2. Terms

- **Connect** — the admin activates an ERP binding (`external_org_bindings.activated_at`). **Cut-over** is that
  instant: the epoch the shipped code already reads (`erpnext-crossing.spec.md` notes; `pmo_epoch_at` is not built).
- **Census** — a read-only count of each master kind and each money domain on both sides, taken at connect and on
  demand. It decides the scenario **per kind**, not per org: one org can be S-C for items and S-D for clients.
- **Match proposal** — for one master kind, every row on either side sorted into exactly one outcome:
  **link** (same record, unique strong key), **bring in** (ERP only → create the PMO row; today's "adopt"),
  **send** (PMO only → create the ERP record; "seed"), **review** (ambiguous or conflicting; nothing happens until
  a person chooses). Words shown to users: "Same record", "Bring into PMO", "Create in the ERP", "Needs a decision".
- **Workflow** — one sync behaviour with a stable id (e.g. `party.match`, `purchase.push`, `timesheet.push`). The
  unit of parity between adapters (§6).

## 3. What ERPNext does today, per scenario and entity (origin/dev `3e0096605`)

S-B is "no binding": every domain is PMO-owned and works standalone (ADR-0055 §1; `no-erp-revenue.spec.md`). S-B's
only requirement is that a later connect behaves as S-C or S-D, so it has no column of its own.
"Breaks" names who, doing what, with what wrong outcome. **G-n** = a gap, slice in §9.

| Entity | S-A (new PMO, ERP with data) | S-C (live PMO, empty ERP) | S-D (live PMO, ERP with data) |
|---|---|---|---|
| **Clients / vendors** | Brought in by the sweep once `companies` is employed (`feedKinds.ts:173` polls it; `erpnextFeedDeps.ts:369-388` inserts a new company). Works. | Nothing sends existing PMO companies to the ERP: the only create path is a user creating or editing a company after the flip. A purchase for a pre-connect vendor resolves no supplier (`dispatchFactory.ts:108`, `:1737`) and the ERP rejects it. **Breaks:** a buyer approving the first PO after connect gets a refusal for every old vendor. **G-3** | Two defects. (1) The sweep's bring-in is name-blind: it inserts a new company with a fresh id (`erpnextFeedDeps.ts:369-388`), so a vendor present on both sides becomes **two PMO companies** if the sweep reaches it before the onboarding action. (2) The onboarding action's match branch re-inserts the matched company under its existing id (`onboarding.ts:113-114` → plain insert at `erpnext-onboard/index.ts:116-128`), which the primary key refuses, and one ambiguous party aborts the whole run (`partyAdopt.ts` throws, `onboarding.ts` has no per-party catch). The unit test hides (1)/(2): its fake insert overwrites (`erpnext-onboard/index.test.ts:29-33`). **Breaks:** an admin connecting an ERP that already has the client's vendors gets duplicate vendors, split spend and a failed setup step. **G-1** |
| **Contacts** | Brought in for adopted parties (`erpnext-onboard/index.ts:149-159`). Works. | Not sent; follow parties (G-3). | Follows parties; affected by G-1. |
| **Items** | ERP catalogue is the picker (`itemCatalog.ts:17`). Works. | Empty ERP has no items; PMO purchase lines carry free text as `item_code` (`dispatchFactory.ts:118-122`); the push is refused. **Breaks:** every purchase push after connect fails until someone keys items into the ERP by hand. **G-3** | Lines must use ERP item codes; no proposal pairs PMO line names to ERP items. Friction, not corruption. **G-2** |
| **Projects** | Per-project link with an exact-match suggestion; one click per project, no accept-all (`ProjectMatchReview.tsx:459-476`). **G-2** | "Link ERP project" creates the ERP project when no exact name/code match exists (`external-set-company/setup.ts:538-542`). Per project. **G-2** | Same create-on-no-match: a project named differently in the ERP gets a **duplicate empty ERP project** (#1043). **G-2** |
| **Accounts** | Read-only mirror; category→account proposal exists (`categoryAccountMap.ts:86`, used by `pages/admin/BudgetAccountMap.tsx:93`) but is accepted per category. **G-2** | Chart is whatever the ERP's setup produced; missing direct-cost accounts are the accountant's task (DD-SETUP-1). No setup task lists them. **G-2** | As S-A. |
| **Budgets** | PMO is SoT (Posture B). ERP budgets are never brought in (`erpnextFeedDeps.ts`, `native-budget-not-adopted`). Works by design. | Versions activated before cut-over are never sent (no mirror row is written before dispatch, OD-XING-1). Matches the default. | PMO refuses to amend an ERP budget it does not own (`adapter-dispatch/bfyUnownedLiveOccupant.test.ts`). Safe, but the user is left with a refused push and no way forward. **Breaks:** a PM activating a budget for a project the accountant already budgeted sees a failure with no resolution path. **G-6** |
| **Purchases (PO, receipt, bill, payment)** | ERP documents mirror read-only and link into PMO purchases in bulk without double counting (#1319, `procurement-flexible-entry.spec.md` FR-PFE-035..041; `0335`). Works. | Purchases finished before cut-over stay PMO-only (correct under OD-XING-1). A purchase in flight at cut-over pushes its next step without its parent: a receipt whose order has no ERP ref is sent without the order link (`dispatchFactory.ts:766-778`). **Breaks:** a store keeper receiving goods on a pre-connect PO creates an ERP receipt detached from any order. No employ guard exists for procurement (only revenue has one, `0275_native_revenue.sql:820-847`). **G-4** | As S-A for ERP documents; as S-C for in-flight PMO purchases. **G-4** |
| **Sales invoices / receipts** | Revenue flip brings in every ERP invoice and receipt, all dates (`erpnextFeedDeps.ts:465-530`; poll filters are company/type only, `erpnext-sweep/index.ts:362-381`). Works (ERP is SoT). | Employing revenue is refused while PMO draft invoices are open; unpaid PMO invoices are stamped with the amount to carry as one opening entry (`0275_native_revenue.sql:820-847`). Works. | Nothing detects that a PMO invoice and a brought-in ERP invoice are the same sale. **Breaks:** if the accountant loads past invoices individually (not as the one opening entry the ADR-0055 addendum expects), Finance sees revenue and receivables **counted twice** on the project and in the management pack. **G-5** |
| **Payments (vendor)** | Mirrored read-only; link per #1319. Works. | Same in-flight rule as purchases. **G-4** | As S-A. |
| **Timesheets / employees** | ERP timesheets never brought in (Posture B). Employees brought in as `unlinked`; each must be confirmed by an Admin one at a time (`erpnextFeedDeps.ts:416`, `confirm_erp_employee_link`). **G-2** | Weeks approved before cut-over never sent (`erpnext-sweep/index.ts:2711-2744`). Correct. Empty ERP has no employees, so no week can push until someone keys them. **G-3** | As S-A; employee pairing per person. **G-2** |
| **Expense postings** | Enabling `expenses` is the cut-off; nothing before it posts (DD-EXP-12..22). Works. | As S-A. | As S-A. |
| **Tasks** | Not an ERP domain (PMO, or ClickUp when employed — ADR-0055 §7). No ERP behaviour exists or is needed. | n/a | n/a |
| **Stock** | Not built for ERPNext. Inventory spec FR-STK-073 defers the crossing to #1508. | — | — |

**Cross-cutting:** three separate proposal functions with different rules (`partyAdopt.ts` pickCandidate,
`repositories/projectMatchReview.ts:13`, `budget/categoryAccountMap.ts:86`); none offers accept-all; parties have
no review screen at all (an ambiguous party fails the whole onboarding run). No census exists, so no screen tells an
admin which scenario each kind is in. The adapter contract (`adapterSeam/contract.ts`) covers commit and two reads;
there is no workflow registry and no test suite that a second ERP adapter must pass (**G-7**).

## 4. Requirements (EARS)

### 4.1 Census and scenario

- **FR-ECA-001** — When an Admin activates an ERP binding, and when an Admin asks to re-check, the system SHALL take
  a read-only census of each master kind (clients, vendors, contacts, items, projects, employees, accounts) and each
  money domain (budgets, purchases, invoices, receipts, payments, timesheets) on both sides, and SHALL record per
  kind which scenario applies (PMO empty or not × ERP empty or not).
- **FR-ECA-002** — The setup screen SHALL state the census in plain words per kind ("12 vendors in PMO, 40 in the
  ERP, 9 are the same") and SHALL NOT show internal names, doctype names or table names.
- **FR-ECA-003** — The census SHALL page over the whole set on both sides (no silent truncation at a read cap) and
  SHALL write nothing to the ERP.

### 4.2 Match once, accept in bulk

- **FR-ECA-010** — For each master kind the system SHALL compute a match proposal (link / bring in / send / review)
  with **one shared, tier-agnostic function** (§6.2). Adapters supply normalised records only.
- **FR-ECA-011** — Matching SHALL use deterministic keys in this order: tax id, then code, then normalised exact
  name (case, whitespace, legal-form suffix). A key that matches more than one candidate, or a name match whose tax
  ids conflict, SHALL produce *review*, never a link. Fuzzy similarity MAY be shown as a hint on a review row and
  SHALL NOT produce a link.
- **FR-ECA-012** — The Admin SHALL be able to accept every non-review outcome of one kind, or of all kinds, in one
  action, after a confirm that states the counts. Review rows SHALL be resolvable individually and SHALL NOT block
  accepting the others.
- **FR-ECA-013** — Accepting SHALL be exactly-once: re-running, retrying, or a sweep tick racing the accept SHALL
  leave one PMO row and one external reference per external record (`external_refs` uniqueness is the guard).
- **FR-ECA-014** — When the change feed (sweep or webhook) meets an unmapped ERP master, it SHALL run the same match
  function before creating a PMO row: a unique match links, an ambiguous one becomes a review row with a
  notification, and only a no-match brings in. The feed SHALL never create a PMO master that duplicates an existing
  one. *(Closes G-1's name-blind insert.)*
- **FR-ECA-015** — Each bulk accept SHALL write one audit row (actor, kind, counts) and SHALL be reversible for links
  until a document references the link; the reversibility check SHALL be the single shared re-link check
  (FR-ODC-073).
- **FR-ECA-016** — After setup, newly created records SHALL link themselves through the same function; the admin
  SHALL only see new review rows.

### 4.3 Send PMO masters to the ERP (S-C, and the PMO-only rows of S-D)

- **FR-ECA-020** — Where the Admin accepts *send* rows, the system SHALL create the ERP record for clients/vendors,
  projects, items used on any open or post-cut-over purchase or invoice, and employees with an active PMO profile
  (OQ-ECA-2). It SHALL NOT create accounts, taxes or fiscal years; missing direct-cost accounts SHALL appear as a
  named setup task for the accountant (DD-SETUP-1).
- **FR-ECA-021** — Each send SHALL go through the money outbox with a derived key `seed:<kind>:<pmo_record_id>`
  (ADR-0059 §4) and SHALL look the record up by its matching keys before any create, so a retry after an unknown
  outcome links instead of duplicating.
- **FR-ECA-022** — A send that the ERP rejects SHALL leave the row in *review* with the ERP's reason in plain words;
  it SHALL NOT block the other sends.

### 4.4 Cut-over for records in flight

- **FR-ECA-030** — While a process domain is employed, a PMO purchase, vendor payment or expense claim whose first
  ERP-bound step happened before cut-over SHALL NOT push any later step (OQ-ECA-1) and SHALL show "recorded before
  the ERP connection, not sent" wherever its push state would show.
- **FR-ECA-031** — Employing a process domain SHALL be refused while PMO holds drafts of that domain that would be
  stranded, generalising the shipped revenue guard (`0275` §7) to procurement and expenses, and to inventory when
  #1508 lands (FR-STK-073). The refusal SHALL name the count and the action.
- **FR-ECA-032** — Records before cut-over SHALL remain readable and SHALL keep counting in PMO figures where they
  counted before; the ERP's own history SHALL be read-only in PMO for Posture-B domains (shipped) and brought in for
  Posture-A domains (shipped).

### 4.5 Both sides hold money (S-D)

- **FR-ECA-040** — When revenue is employed and PMO holds its own invoices, the system SHALL propose pairs between
  PMO invoices and brought-in ERP invoices (same client, and same reference or number, and same amount and tax
  treatment; date within the invoice's month). Finance SHALL accept pairs in bulk. An accepted pair SHALL count once,
  as the ERP document (OQ-ECA-3); the PMO copy SHALL link to it and stop counting. Unpaired PMO invoices SHALL be
  listed until resolved.
- **FR-ECA-041** — When a budget push meets an ERP budget PMO does not own, the system SHALL keep refusing to amend it
  (shipped) and SHALL offer the two OQ-ECA-4 actions to an Admin or Finance user. *Replace* SHALL require an
  explicit confirm naming the ERP budget, and SHALL go through the shipped push path.
- **FR-ECA-042** — ERP purchase documents SHALL keep linking through #1319's bulk link; the setup census SHALL show
  their count and point to that screen.

### 4.6 Parity between adapters

- **FR-ECA-050** — Every sync workflow SHALL have a stable id in one registry (§6.3). Every ERP tier SHALL declare,
  for every workflow, one of: *supported*, *unavailable* (with the ERP limitation named), or *pending* (with an issue
  number). A missing declaration SHALL fail typecheck.
- **FR-ECA-051** — The behaviour of each workflow and each scenario SHALL be asserted once, in a shared suite, which
  every tier declaring *supported* runs through its own harness. Tier-local tests MAY assert only wire format.
- **FR-ECA-052** — Each workflow SHALL carry a behaviour version. Changing the shared suite's assertions SHALL bump
  it; a tier whose declaration pins an older version SHALL fail the parity test until it passes the new suite or
  re-declares *unavailable*/*pending* against the new version.
- **FR-ECA-053** — No PMO code above the adapter SHALL branch on the tier for a workflow's behaviour; it SHALL call the
  contract (extends NFR-EAS-CONTRACT-001 and NFR-ODC-009).

## 5. Non-functional

- **NFR-ECA-001 (no duplicates)** — Any census, proposal, accept, send or sweep SHALL be safe to repeat and to
  interrupt at any statement.
- **NFR-ECA-002 (no double count)** — No figure SHALL sum a PMO record and an ERP record that a link or pair names as
  the same thing.
- **NFR-ECA-003 (tenancy)** — Service-role writers (census, sweep, sends) SHALL scope by the org resolved from the
  binding, never from a request body; a two-org test proves it.
- **NFR-ECA-004 (honesty)** — No screen SHALL report a send or link as done before the ERP confirms it.
- **NFR-ECA-005 (scale)** — Census and proposal for 50,000 parties and 100,000 items SHALL finish in bounded ticks;
  the proposal screen pages and filters by outcome.
- **NFR-ECA-006 (language)** — en/id parity; no ERP vocabulary on screen (owner 2026-10-16).

## 6. The shared adapter contract

### 6.1 Layout under `pmo-portal/src/lib/adapterSeam/`

```
contract.ts                 (shipped) commit + reads
connect/
  types.ts                  MasterKind, NormalisedMaster, MatchOutcome, CensusRow, WorkflowId
  match.ts                  proposeMatches() — the one matcher (replaces pickCandidate, proposeProjectMatches,
                            proposeBudgetAccountMap's pairing step)
  census.ts                 scenarioOf(pmoCount, erpCount)
  workflows.ts              WORKFLOWS registry + behaviour versions
contractSuite/
  harness.ts                ErpHarness interface (below)
  scenarios.ts              S-A..S-D fixtures in PMO terms (synthetic data only)
  party.suite.ts            party.match, party.bring-in, party.send
  project.suite.ts          project.match, project.send
  item.suite.ts · employee.suite.ts · account.suite.ts
  purchase.suite.ts · bill.suite.ts · vendor-payment.suite.ts
  invoice.suite.ts · receipt.suite.ts · budget.suite.ts · timesheet.suite.ts · actuals.suite.ts
  cutover.suite.ts          FR-ECA-030..032 per process workflow
  parity.test.ts            every tier × every workflow declared; versions current
erpnext/
  connectAdapter.ts         ConnectAdapter for ERPNext (normalise + send)
  contract.harness.ts       ErpHarness over a mocked ERPNext REST
  contract.test.ts          runs every suite the tier declares supported
odoo/                       (O1+) same three files
```

### 6.2 Interfaces (PMO terms only)

```ts
export type MasterKind = 'party' | 'contact' | 'item' | 'project' | 'employee' | 'account';
export interface NormalisedMaster {
  kind: MasterKind; externalId: string; role?: 'client' | 'vendor';
  taxId?: string | null; code?: string | null; name: string; active: boolean;
}
export type MatchOutcome =
  | { outcome: 'link'; pmoId: string; externalId: string; key: 'tax' | 'code' | 'name' }
  | { outcome: 'bring-in'; externalId: string }
  | { outcome: 'send'; pmoId: string }
  | { outcome: 'review'; pmoIds: string[]; externalIds: string[]; reason: 'ambiguous' | 'tax-conflict' | 'rejected' };
export function proposeMatches(pmo: readonly PmoMaster[], erp: readonly NormalisedMaster[]): MatchOutcome[];

export interface ConnectAdapter {
  readonly tier: string;
  listMasters(kind: MasterKind, cursor: string | null): Promise<{ rows: NormalisedMaster[]; nextCursor: string | null }>;
  countDomain(domain: string): Promise<number>;           // census, read-only
  sendMaster(kind: MasterKind, record: PmoMaster, key: string): Promise<{ externalId: string }>; // lookup-then-create
}

export type Declaration =
  | { status: 'supported'; version: number }
  | { status: 'unavailable'; version: number; reason: string }
  | { status: 'pending'; version: number; issue: number };
export type TierWorkflows = Record<WorkflowId, Declaration>;   // missing key ⇒ typecheck error

export interface ErpHarness {
  tier: string;
  adapter: Adapter & ConnectAdapter;   // built over a fetch mock speaking the tier's wire format
  load(state: ScenarioState): void;    // place canonical fixtures in the fake ERP
  documents(kind: string): unknown[];  // what the fake ERP now holds, in PMO terms
}
```

A suite is `export function partySuite(h: ErpHarness) { describe(...) }`. Each tier's `contract.test.ts` loops over
its `TierWorkflows` and runs the suites marked *supported*. Suites drive the shipped code paths with `fetch` mocked
(the repository's edge-function test rule), never copies of handlers.

### 6.3 Why this is hard to forget

1. Adding a workflow id to `WORKFLOWS` breaks typecheck for every tier until each declares it.
2. Changing what ERPNext does means changing the shared suite (ERPNext's behaviour tests live there), which runs for
   Odoo too: Odoo goes red, or its owner re-declares against the bumped version with a reason or an issue.
3. `parity.test.ts` fails when a declaration pins an old version, so an "unavailable" claim is re-checked every time
   the behaviour changes, which is the owner's "where the ERP allows".

### 6.4 Initial registry (ERPNext declarations today; Odoo per its route items)

| Workflow | ERPNext now | Odoo must declare at |
|---|---|---|
| `census` · `party.match` · `party.bring-in` · `party.send` · `project.match` · `project.send` · `item.match` · `item.send` · `account.match` | supported after slices ECA-1..3 | O1 (#1504) |
| `employee.match` · `employee.send` | supported after ECA-2/3 | O7 (labour) |
| `purchase.push` · `bill.push` · `vendor-payment.push` · `purchase.link-existing` · `cutover.purchase` | supported (shipped) + ECA-4 | O2 (#1505) |
| `invoice.push` · `receipt.read` · `invoice.pair-existing` · `cutover.revenue` | supported (shipped) + ECA-5 | O3 (#1506) |
| `actuals.read` | supported (shipped) | O4 (#1507) |
| `budget.push` · `budget.unowned-occupant` | supported (shipped) + ECA-6 | O4 decides: Odoo Community has no budget object (DD-ODC-5) → likely *unavailable* with that reason |
| `timesheet.push` · `cutover.timesheet` | supported (shipped) | O7 |
| `stock.*` | not built | #1508 / O5 |

## 7. Acceptance criteria (Given / When / Then, owning layer per ADR-0010)

Layers: **U** Vitest · **D** Deno edge-function test (shipped handler, `fetch` mocked) · **P** pgTAP ·
**S** shared contract suite (U, run per tier) · **E** served e2e on the ERPNext bed (`e2e/serial/`).

**Census and matching**
- **AC-ECA-001 (FR-001..003; S)** — Given fixtures for S-A, S-C and S-D per kind, when the census runs, then each
  kind reports the right scenario and the fake ERP records no write.
- **AC-ECA-002 (FR-010, 011; U)** — Given PMO and ERP rows covering unique tax id, unique code, unique name, two name
  matches, name match with conflicting tax ids, no match on either side and an inactive ERP row, when
  `proposeMatches` runs, then each row gets exactly one outcome and no ambiguous or conflicting case is a link.
- **AC-ECA-003 (FR-012; U, RTL)** — Given a proposal with 30 links, 5 bring-ins and 2 review rows, when the Admin
  accepts all, then one confirm states the counts, 35 rows are applied, and the 2 review rows remain open.
- **AC-ECA-004 (FR-013; P)** — Given two concurrent accepts of the same bring-in, then one PMO row and one
  external reference exist.
- **AC-ECA-005 (FR-014; D, `erpnext-sweep`)** — Given a PMO vendor "Acme" with no ERP link and an ERP supplier
  "Acme" with the same tax id, when a sweep tick reads the supplier, then the existing company is linked and no new
  company exists; given two PMO vendors named "Acme", then no company is created and a review row plus a
  notification exist.
- **AC-ECA-006 (G-1; D, `erpnext-onboard`)** — Given a PMO vendor matched by name to an ERP supplier, when onboarding
  runs with the real insert/update wiring, then it succeeds, links the existing company and inserts nothing; given
  one ambiguous party among ten, then nine are applied and one review row exists.
- **AC-ECA-007 (FR-015; P)** — Given a bulk accept, then one audit row carries actor, kind and counts; given a link
  referenced by a pushed document, then unlinking is refused by the shared check.

**Send (S-C)**
- **AC-ECA-010 (FR-020, 021; S)** — Given an empty fake ERP and PMO with 3 vendors, 2 projects, 4 items on open
  purchases and 2 active people, when the Admin accepts all sends, then the ERP holds exactly those records, each
  PMO row has one external reference, and no account or tax was created.
- **AC-ECA-011 (FR-021; S)** — Given a send whose create succeeded in the ERP but whose response was lost, when it is
  retried, then the lookup links the existing ERP record and the ERP holds one copy.
- **AC-ECA-012 (FR-022; S)** — Given one send the ERP rejects, then it becomes a review row with a plain reason and
  the other sends complete.

**Cut-over**
- **AC-ECA-020 (FR-030; S, cutover.suite)** — Given a PMO purchase ordered before cut-over, when its goods are
  received after cut-over, then no ERP document is created and the purchase shows "recorded before the ERP
  connection, not sent".
- **AC-ECA-021 (FR-031; P)** — Given an open PMO purchase draft, when an Admin employs procurement, then the employ is
  refused with the count; after the draft is submitted or cancelled, the employ succeeds. Same for expenses.
- **AC-ECA-022 (FR-032; existing)** — Pre-cut-over timesheets not sent: owned by `AC-XING-001`; ERP history never
  adopted: `AC-XING-003`. Not re-tested.

**Both sides hold money (S-D)**
- **AC-ECA-030 (FR-040; P + U)** — Given a PMO invoice and a brought-in ERP invoice for the same client, reference
  and amount, when Finance accepts the proposed pair, then project revenue and receivables count the amount once
  and the PMO invoice links to the ERP one; given an unpaired PMO invoice, then it still counts and is listed.
- **AC-ECA-031 (FR-041; D, `adapter-dispatch`)** — Given an ERP budget PMO does not own, when an Admin chooses
  *use as draft*, then a PMO Draft version holds the ERP figures and the ERP is unchanged; when the Admin chooses
  *replace* and confirms, then the ERP holds PMO's active version through the push path and one audit row exists.

**Parity**
- **AC-ECA-040 (FR-050; U, typecheck)** — Given a new workflow id added to `WORKFLOWS`, when typecheck runs without an
  Odoo/ERPNext declaration, then it fails.
- **AC-ECA-041 (FR-052; U, `parity.test.ts`)** — Given a bumped behaviour version for `party.match`, when a tier pins
  the old version, then the parity test fails naming the tier and workflow.
- **AC-ECA-042 (FR-051; S)** — Every suite in §6.1 runs for ERPNext and passes; Odoo's `contract.test.ts` exists from
  O1 and runs the suites its declarations mark *supported*.
- **AC-ECA-043 (FR-053; U)** — A guard test fails if code outside `adapterSeam/<tier>/**` and its edge functions
  branches on a tier name for a registered workflow.

**Scenario acceptance (ERPNext bed)**
- **AC-ECA-050 (S-C; E)** — Given a seeded PMO org with history and an empty ERPNext company, when the Admin connects,
  accepts all proposals and approves one new purchase, then the purchase reaches the ERP with the sent vendor, item
  and project, and nothing before cut-over was sent.
- **AC-ECA-051 (S-D; E)** — Given the same PMO org and an ERPNext company holding overlapping vendors, projects and
  invoices, when the Admin connects and accepts all, then every overlapping record is linked once, no duplicate
  exists on either side, and project revenue equals the ERP figure.

## 8. Decisions taken here

- **DD-ECA-1 — Scenario is per kind, from a census, not an org setting.** Orgs are rarely uniform (an ERP with a
  chart but no items). A per-org switch would force the wrong behaviour on some kind.
- **DD-ECA-2 — One matcher for every kind and tier.** Three diverging matchers already exist; a fourth (Odoo
  FR-ODC-050) was about to be written. FR-ODC-050's decision table is adopted as the shared rule.
- **DD-ECA-3 — Sending masters is allowed; sending history is not.** Masters are reference data PMO needs to push
  anything at all (Posture A exception, ADR-0059 §5). History stays OD-XING-1 (2); options (1) and (3) remain
  deferred until a client asks.
- **DD-ECA-4 — Parity is enforced by typecheck plus a shared suite, not by review.** Reviews already missed
  ERPNext-only behaviour; a registry key the compiler checks cannot be skipped.

## 9. Slice split

| Slice | Contents | ACs | Applies to | Executor | Issue |
|---|---|---|---|---|---|
| **ECA-1** Fix party bring-in at connect | onboarding match branch updates instead of inserting; per-party outcomes (one review row does not abort the run); sweep bring-in runs the match before inserting | 005, 006 | ERPNext now | Orca worker; `security-auditor` (service-role writers) | #1600 |
| **ECA-2** Shared matcher, census and one-pass setup | `connect/match.ts`, `census.ts`; one setup screen per kind with accept-all; parties, projects, items, employees, category→account move onto it; project "link" stops creating on no-match (send is explicit) | 001–004, 007 | ERPNext now; Odoo O1 reuses | Orca UI worker (impeccable, taste, ui-ux-pro-max) after a 30-second owner sketch glance | #1605 |
| **ECA-3** Send PMO masters to the ERP | `ConnectAdapter.sendMaster` for ERPNext; outbox with `seed:` keys; lookup-before-create; account setup task | 010–012 | ERPNext now; Odoo O1 (partners, cost accounts), O7 (employees) | Director-dispatched (outbox) | #1606 |
| **ECA-4** Cut-over for records in flight | later steps of pre-cut-over purchases, payments and claims not sent and labelled; employ guards for procurement and expenses | 020, 021 | ERPNext now; Odoo O2, O6; inventory #1508 | Director-dispatched (money) | #1601 |
| **ECA-5** Pair PMO and ERP invoices | pair proposal, bulk accept, count-once in revenue figures | 030 | ERPNext now; Odoo O3 | Director-dispatched (money) | #1602 |
| **ECA-6** Existing ERP budget | *use as draft* / *replace* actions on the refused push | 031 | ERPNext now; Odoo O4 decides | Director-dispatched (money) | #1603 |
| **ECA-7** Workflow registry and shared contract suite | `workflows.ts`, `contractSuite/*`, ERPNext harness; move existing behaviour tests for party, project, budget-occupant and cut-over into suites; parity and tier-branch guards | 040–043 | ERPNext now; **every Odoo slice from O1 registers and runs it** | Orca worker | #1604 |
| **ECA-8** Scenario acceptance on the bed | S-C and S-D served journeys | 050, 051 | ERPNext now; Odoo S9 of #1504 adds its bed run | Orca worker (qa-acceptance) | #1607 |

Order: ECA-1 and ECA-7 first (independent); ECA-2 after ECA-1; ECA-3 after ECA-2; ECA-4..6 independent of each
other after ECA-7; ECA-8 last.

**What the Odoo builds must satisfy:** O1 (#1504) registers `odoo` in `WORKFLOWS`, implements `ConnectAdapter`, and
passes `census`, `party.*`, `project.*`, `item.*`, `account.match` suites, using `connect/match.ts` in place of a
separate FR-ODC-050 implementation; S-C for partners and cost accounts is `party.send`/`project.send`. O2–O7 each
pass their row of §6.4 or declare *unavailable* with the Odoo limitation named.

## 10. Traceability

| Layer | ACs |
|---|---|
| Unit (Vitest/RTL) | 002, 003, 040, 041, 043, 030 (figure rule) |
| Shared suite (per tier) | 001, 010, 011, 012, 020, 042 |
| Deno (shipped handler) | 005, 006, 031 |
| pgTAP | 004, 007, 021, 030 (count-once) |
| Served e2e (ERPNext bed) | 050, 051 |
| Existing, not re-tested | 022 (`AC-XING-001`, `AC-XING-003`) |
