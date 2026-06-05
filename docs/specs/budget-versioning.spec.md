# Spec: Budget-versioning module — budget authority (Issue: build-wave #1)

First issue of the new build wave. Makes `budget_versions` + `budget_line_items` the **authoritative**
source of a project's budget and ships the write/lifecycle module (create version → add line-items →
activate → archive). This is the **MVP-load-bearing** consequence locked in **OD-BUDGET-1**.

- **Grounds:** `docs/decisions.md` OD-BUDGET-1/2/3 + OD-MARGIN-1; target-arch §5.7/§6; ADR-0003 (DAL),
  ADR-0005 (TanStack Query), ADR-0010 (test pyramid). Reuses the write/DAL patterns of
  `src/lib/db/projects.ts` / `procurements.ts`, the hook pattern of `src/hooks/*`, and `formatCurrency`
  from `src/lib/format.ts`.
- **Schema — already present, verified `supabase/migrations/0001_init_schema.sql` §5.7 (no migration
  needed for the core tables):**
  `budget_versions(id, org_id, project_id, version int, name text, status budget_status DEFAULT 'Draft',
  created_at)` with `unique(project_id, version)` and the **partial unique index**
  `budget_versions_one_active_idx on budget_versions(project_id) where status = 'Active'`.
  `budget_line_items(id, org_id, budget_version_id, category budget_category, description, budgeted_amount
  numeric(14,2), actual_amount numeric(14,2))` with `budget_line_items_version_idx`.
  Enums: `budget_status = ('Draft','Active','Archived')`; `budget_category =
  ('Labor','Materials','Subcontractors','Equipment','Permits & Fees','Overheads','Contingency')`.
- **RLS — already present, verified `supabase/migrations/0002_rls.sql`:** `budget_versions` and
  `budget_line_items` both have read-in-org (`org_id = auth_org_id()`) and the coarse write gate
  `auth_role() in ('Admin','Executive','Project Manager','Finance')`; `budget_line_items_write` also
  carries the parent-org guard (parent `budget_version` must be in the caller's org). `org_id` is
  client-unspoofable: column default (0001) + `with check` (0002). **This issue reuses these policies
  as-is** — no RLS rewrite is required for create/edit/activate/archive (all are inserts/updates on
  these two tables, already gated). See §RLS below for the verification this issue owns.

## AS-IS (what exists today)

- The tables `budget_versions` / `budget_line_items` exist and are seeded for **one** project (P001:
  an Archived v1 + an Active v2 whose line-items sum to 4,700,000). They are **not authoritative** and
  nothing reads them — no DAL, no hook, no UI.
- `projects.budget numeric(14,2)` is a **static header scalar** hand-set in the seed (e.g. P001 = 4,700,000)
  and is what the Dashboard currently reads. Schema comment already marks it "authority DEFERRED §14".
- Projects **P002, P003 (P003=`Acme Internal Platform`), P010** have **no budget version at all** and a
  hand-set `budget` (P002=0, P010=0, P003=2,000,000). Under OD-BUDGET-1 these will derive budget 0 (P003
  silently loses its 2,000,000) — the seed gap this issue must close.
- `budget_status`/`budget_category` enums, the partial-unique Active index, and the coarse RLS write
  gate are all in place (verified above). pgTAP `0003_partial_unique_indexes.test.sql` already proves
  AC-108 (a second Active version is rejected) — this issue does **not** re-prove the index, it builds on it.

## Scope (strict in/out)

**IN:**
1. **Budget authority (OD-BUDGET-1):** a project's budget = **Σ `budgeted_amount` of its Active
   `budget_version`**. A read-time derivation (DAL function / SQL), NOT a stored-column trigger.
   No Active version ⇒ budget = 0.
2. **Version lifecycle** `Draft → Active → Archived`: create a Draft version (auto-assigned
   `version` = max+1 per project); **activate** a Draft (atomically archives the previously-Active one,
   exactly one Active per project); **archive** an Active version. Archived versions are terminal/read-only.
3. **Line-item CRUD** within a **Draft** version (category ∈ `budget_category`, description,
   `budgeted_amount`). Editing line-items is allowed **only while the owning version is Draft**.
4. **Active is read-only; clone-to-revise:** to change an Active budget the user **clones** it to a new
   Draft (copies the line-items), edits the Draft, then re-activates (which archives the old Active).
5. **`projects.budget` becomes a derived cache, not the source of truth:** budget reads compute from the
   Active version. This issue does not delete the column (Dashboard re-formula is a later issue) but
   stops treating it as authority on the budget screen.
6. **Seed requirement (OD-BUDGET-1):** update `supabase/seed.sql` so **every seeded project has exactly
   one Active budget version with line-items** (see §Seed). Future project-creation producing an Active
   version is a downstream concern noted, not built here.
7. **RLS / authorization (OD-BUDGET-3):** reads in-org; all writes (create/edit versions + line-items,
   activate, archive, clone) gated to `Admin/Executive/Project Manager/Finance`; `org_id` never
   client-supplied. Reuse existing policies; verify at the pgTAP layer.
8. **UI — a Budget view/tab for a project:** list versions (status badge + total via `formatCurrency`),
   create a version, add/edit/delete line-items on a Draft, activate a Draft, archive an Active, clone an
   Active to a new Draft. Real loading / empty / error+retry states (Frontend DoD). Show the project's
   derived budget (Σ Active) on the screen.

**OUT (explicit non-goals — do not bleed scope):**
- **Dashboard margin re-formula** (OD-MARGIN dual-lens: `contract_value`, weighted pipeline/on-hand). A
  later issue; also needs procurement `spent`. This issue only establishes budget authority + the module.
- **`spent` derivation from procurement** (OD-BUDGET-2, Committed basis). Depends on the procurement-write
  module — **out of scope**. Named here only as the downstream consumer of budget authority.
- **Project fields** `customer_contract_ref` / `contract_date` / `decided_at` (OD-SP/OD-MARGIN — sales-
  pipeline/projects issue).
- **Per-category roll-up of actuals** into `budget_line_items.actual_amount` (mapping procurement spend →
  category). Later refinement; `actual_amount` is left as-seeded this issue.
- **Admin-config / fine-grained authz** (e.g. only Finance may Activate) — OD-PROC-6 / OD-BUDGET-3 bridge,
  deferred. Coarse 4-role gate only.
- **Configurable budget categories** — the 7-value `budget_category` enum stays **fixed** for MVP
  (OD-BUDGET-4); making it admin-editable (enum → lookup table) is deferred to the config bridge.
  `Contingency` = risk reserve only (not a generic "Other"); misc indirect spend → `Overheads`.
- **Rewriting RLS / adding migrations** beyond what (if anything) the activate-atomicity RPC needs (§OQ-2).

## `[OWNER-DECISION]` flags (assumed defaults — flag, don't silently invent)

- **OD-BUDGET-A (Active edit policy) — assumed:** Active versions are **read-only**; the only way to
  change an active budget is **clone → Draft → edit → re-activate** (archives the old Active). This is the
  recommendation called out in OD-BUDGET-1's spirit but not explicitly locked. *Confirm.* If the owner
  instead wants in-place Active editing, FR-BV-006/007 and AC-723/AC-731 change.
- **OD-BUDGET-B (archive without successor) — assumed:** archiving the **Active** version with no Draft
  promoted leaves the project with **no Active version ⇒ budget = 0** (and it silently drops out of
  margin/at-risk KPIs, per OD-BUDGET-1). The UI **warns** before this transition but does not block it.
  *Confirm* the warn-not-block behavior.
- **OD-BUDGET-C (delete vs archive of a Draft) — assumed:** an unwanted **Draft** version may be **hard
  deleted** (cascade to its line-items); only Active→Archived uses the archive transition. Archived
  versions are never deleted (audit trail). *Confirm.*
- **OD-BUDGET-D (line-item delete) — assumed:** deleting a line-item from a Draft is a hard delete (no
  soft-delete/audit on line-items for MVP). *Confirm.*

## Functional requirements (EARS)

**Budget authority / derivation**
- **FR-BV-001** — The system shall compute a project's budget as the **sum of `budgeted_amount` across
  the line-items of that project's single Active `budget_version`**.
- **FR-BV-002** — Where a project has **no** Active `budget_version`, the system shall report its budget
  as **0** (and the spec records the consequence: such a project is silently excluded from any KPI
  guarded on `budget > 0`).
- **FR-BV-003** — The system shall derive budget at **read time** (DAL function / SQL aggregate) and
  shall **not** require a trigger to maintain `projects.budget`; `projects.budget` is treated as a
  non-authoritative cache on this screen.

**Version lifecycle / single-Active**
- **FR-BV-004** — When an authorized user creates a budget version for a project, the system shall insert
  it with status `Draft` and `version` = (max existing `version` for that project) + 1.
- **FR-BV-005** — While a version's status is `Draft`, when an authorized user activates it, the system
  shall set that version to `Active` **and** archive (set to `Archived`) the project's previously-Active
  version in the **same atomic operation**, such that **at most one Active version exists per project at
  all times** (enforced by `budget_versions_one_active_idx`).
- **FR-BV-006** — While a version's status is `Active`, the system shall treat it as **read-only**: its
  line-items shall not be created, edited, or deleted (OD-BUDGET-A).
- **FR-BV-007** — When an authorized user **clones** an Active (or Archived) version, the system shall
  create a new `Draft` version (next `version` number) copying every line-item (`category`, `description`,
  `budgeted_amount`; `actual_amount` reset to 0) of the source.
- **FR-BV-008** — When an authorized user archives the Active version, the system shall set it to
  `Archived`; the project then has no Active version until another is activated (FR-BV-002 applies;
  warn-not-block per OD-BUDGET-B).
- **FR-BV-009** — Where a version's status is `Archived`, the system shall treat it as **terminal**: it
  shall not be edited or re-activated, and its line-items shall not be mutated (clone-to-Draft instead).

**Line-item CRUD (Draft only)**
- **FR-BV-010** — While the owning version is `Draft`, the system shall allow an authorized user to
  create / edit / delete line-items (`category` ∈ `budget_category`, `description`, `budgeted_amount`).
- **FR-BV-011** — The system shall reject any line-item create/edit/delete whose owning version is not
  `Draft` (enforces FR-BV-006/009).

**Seed / tenancy / authorization**
- **FR-BV-012** — The system (seed data) shall ensure **every seeded project has exactly one Active
  `budget_version` with at least one line-item**, so no seeded project derives budget 0 unintentionally
  (OD-BUDGET-1). `supabase/seed.sql` shall be updated accordingly (§Seed).
- **FR-BV-013** — The system shall permit budget **reads** to any authenticated user **in the same org**
  (`org_id = auth_org_id()`), and restrict all budget **writes** (version create/activate/archive/clone,
  line-item CRUD) to roles `Admin / Executive / Project Manager / Finance` (OD-BUDGET-3).
- **FR-BV-014** — The system shall never accept a client-supplied `org_id` on any budget write; `org_id`
  is defaulted from the row's org context and re-checked by RLS `with check`, consistent with all other
  business tables.

## NFR
- **NFR-BV-PERF-001** — A project's derived budget shall be computed in a **single** indexed query
  (`budget_versions_one_active_idx` to find the Active version, `budget_line_items_version_idx` to sum its
  items) — no N+1 / client-side cross-product over all versions.
- **NFR-BV-ATOM-001** — Activation (FR-BV-005) shall be atomic and concurrency-safe: two concurrent
  activations on the same project shall not both succeed (the partial unique index is the backstop;
  see §OQ-2 for the RPC-vs-two-statement decision).
- **NFR-BV-UI-001** — The Budget view shall render distinct **loading**, **empty** (no versions yet), and
  **error + retry** states (Frontend DoD), and format every monetary value via shared `formatCurrency`.

## RLS (verification this issue owns)

No new policies. This issue proves, at the pgTAP layer, that the **existing** `0002_rls.sql` policies
deliver the OD-BUDGET-3 contract for the new write paths:
- read-in-org for all roles; write blocked for `Engineer`; write allowed for the 4 roles;
- cross-org write/read blocked (tenant isolation);
- `budget_line_items` parent-org guard holds (cannot attach a line-item to another org's version).
If §OQ-2 concludes activation needs a `security definer` RPC, that RPC must re-assert `auth_role()` ∈ the
4 roles and `auth_org_id()` internally (do not rely on RLS being bypassed by definer rights) — and that
authorization is itself proven at pgTAP.

## Acceptance criteria (Given/When/Then)

Each AC names its id as the leading token (traceability) and is annotated with its **owning layer (ADR-0010)**.

- **AC-720** *(Unit)* — Budget = Σ Active version line-items.
  Given a project whose Active version has line-items {2,000,000; 1,700,000; 1,000,000}, When the budget
  DAL derives the project budget, Then it returns 4,700,000. *(FR-BV-001)*
- **AC-721** *(Unit)* — No Active version ⇒ budget 0.
  Given a project with only a Draft (or only Archived) version and no Active, When the budget DAL derives
  its budget, Then it returns 0. *(FR-BV-002)*
- **AC-722** *(Unit)* — Read-time derivation ignores the stale header.
  Given a project whose `projects.budget` header = 9,999,999 but whose Active version sums to 4,700,000,
  When the budget DAL derives the budget, Then it returns 4,700,000 (header is not the source of truth).
  *(FR-BV-003)*
- **AC-723** *(Unit)* — Line-item mutation rejected unless Draft.
  Given the DAL/guard for line-item writes, When asked to edit a line-item whose owning version is Active
  (or Archived), Then it is rejected; And when the owning version is Draft, Then it succeeds. *(FR-BV-006/009/010/011)*
- **AC-724** *(Unit)* — Next version number.
  Given a project with existing versions {1,2}, When a new version is created, Then it is `Draft` with
  `version` = 3. *(FR-BV-004)*
- **AC-725** *(Unit)* — Clone copies line-items into a new Draft.
  Given an Active version with 3 line-items, When it is cloned, Then a new `Draft` version exists with the
  same 3 line-items (category/description/budgeted_amount copied, `actual_amount`=0) and the source is
  unchanged. *(FR-BV-007)*
- **AC-726** *(Unit)* — Budget view loading / empty / error+retry states.
  Given the Budget view, When the query is pending Then a loading skeleton (`budget-loading`) renders;
  When it resolves to zero versions Then the empty state (`budget-empty`) renders; When it errors Then an
  error + Retry renders and Retry re-runs the query. *(NFR-BV-UI-001)*
- **AC-727** *(pgTAP)* — Single-Active invariant on activation.
  Given a project with Active v1 and Draft v2, When v2 is activated, Then v2 is `Active`, v1 is `Archived`,
  and exactly one row satisfies `(project_id) where status='Active'`. *(FR-BV-005, NFR-BV-ATOM-001)*
- **AC-728** *(pgTAP)* — Engineer read allowed, write blocked (role gate).
  Given a signed-in `Engineer`, When they SELECT the org's budget versions/line-items Then rows are
  returned; When they attempt to INSERT/UPDATE a budget version or line-item Then it is rejected by RLS.
  *(FR-BV-013)*
- **AC-729** *(pgTAP)* — Authorized roles may write.
  Given a signed-in `Project Manager` (and, separately, `Finance`), When they create a Draft version and
  add a line-item, Then both writes succeed. *(FR-BV-013)*
- **AC-730** *(pgTAP)* — Cross-org isolation + client `org_id` ignored.
  Given org-A and org-B budget data, When an org-A user reads/writes, Then they see/affect only org-A rows;
  And when an insert supplies a foreign/explicit `org_id`, Then RLS `with check` rejects it (no cross-org
  attach; `budget_line_items` parent-org guard holds). *(FR-BV-013/014)*
- **AC-731** *(pgTAP)* — Line-item mutation on a non-Draft version is rejected at the DB contract.
  Given an Active version and its line-items, When a line-item INSERT/UPDATE/DELETE targets it, Then it is
  rejected (the not-Draft guard, whether enforced by RPC or trigger/policy per §OQ-2). *(FR-BV-006/011)*
- **AC-732** *(E2E)* — Create version → add line-items → activate → project shows the budget (single
  curated journey).
  Given a signed-in PM on a project's Budget tab with no Active version, When they create a Draft version,
  add line-items {600,000; 400,000}, and Activate it, Then the version shows status `Active`, and the
  project's displayed budget reads `formatCurrency(1,000,000)`. *(FR-BV-001/004/005/010, NFR-BV-UI-001)*
- **AC-733** *(pgTAP)* — Seed invariant: every project has one Active version with line-items.
  Given the seeded database, When versions are grouped by project, Then **every** project has exactly one
  `Active` `budget_version` and that version has ≥1 line-item (so no seeded project derives budget 0).
  *(FR-BV-012)*

## Traceability (FR → AC → owning layer)

| Requirement | AC(s) | Owning layer (ADR-0010) |
|---|---|---|
| FR-BV-001 (budget = Σ Active) | AC-720, AC-732 | Unit (E2E proves end-to-end) |
| FR-BV-002 (no Active ⇒ 0) | AC-721 | Unit |
| FR-BV-003 (read-time derivation) | AC-722 | Unit |
| FR-BV-004 (create Draft, next version) | AC-724, AC-732 | Unit (E2E end-to-end) |
| FR-BV-005 (activate archives prior, single Active) | AC-727, AC-732 | pgTAP |
| FR-BV-006 (Active read-only) | AC-723, AC-731 | Unit + pgTAP |
| FR-BV-007 (clone → Draft copies items) | AC-725 | Unit |
| FR-BV-008 (archive Active) | AC-727 (state side) | pgTAP |
| FR-BV-009 (Archived terminal) | AC-723, AC-731 | Unit + pgTAP |
| FR-BV-010 (line-item CRUD on Draft) | AC-723, AC-732 | Unit (E2E end-to-end) |
| FR-BV-011 (reject non-Draft mutation) | AC-723, AC-731 | Unit + pgTAP |
| FR-BV-012 (seed invariant) | AC-733 | pgTAP |
| FR-BV-013 (read-in-org / role write gate) | AC-728, AC-729, AC-730 | pgTAP |
| FR-BV-014 (org_id not client-supplied) | AC-730 | pgTAP |
| NFR-BV-ATOM-001 (atomic activation) | AC-727 | pgTAP |
| NFR-BV-UI-001 (loading/empty/error states) | AC-726, AC-732 | Unit (E2E end-to-end) |

Per-layer AC split: **Unit** AC-720/721/722/723/724/725/726 (7) · **pgTAP** AC-727/728/729/730/731/733 (6)
· **E2E** AC-732 (1, curated journey). AC-723/AC-731 are co-owned (Unit owns the DAL/guard logic; pgTAP
owns the DB-level enforcement) but each is a single canonical proof per layer.

## Seed enrichment required (verified `supabase/seed.sql` §projects/§budget)

Current state (verified): **P001** has Archived v1 + Active v2 (items 2,000,000+1,700,000+1,000,000 =
4,700,000, matching its header). **P002, P003 (`Acme Internal Platform`, header budget 2,000,000), P010**
have **no** budget version → under OD-BUDGET-1 they derive **0** (P003 silently loses 2,000,000). This
breaks AC-733 and would drop projects off future KPIs.

**Enrich** so FR-BV-012 / AC-733 hold — add exactly one Active version + line-items to each project that
lacks one (keep P001 as-is):
- **P002** (`Northwind ERP Rollout`): Active v1 with line-items summing to a sensible budget (e.g. Labor +
  Materials). Tender-stage project still gets an Active version (OD-MARGIN-1: pipeline projects carry a
  budget version too).
- **P003** (`Acme Internal Platform`): Active v1 whose line-items sum to **2,000,000** (preserve the
  intent of its current header so derived = old header).
- **P010** (`Regional Services Program`): Active v1 with line-items (e.g. Labor + Subcontractors).
Constraints to respect: `unique(project_id, version)`; the partial unique index (exactly one Active per
project); reuse existing project ids; supply `org_id` via the column default (do **not** hard-code it on
inserts — keeps the seed consistent with the client-unspoofable seam). Leave each project's `projects.budget`
header as-is (now a cache; the derived value is authority).

## Open questions / decisions-applied

**Decisions applied (cited):**
- **OD-BUDGET-1** — budget authority = Σ Active version line-items; header `projects.budget` is a derived
  cache; no Active ⇒ 0; seed/creation must produce an Active version. ⇒ FR-BV-001/002/003/012, AC-720/721/733.
- **OD-BUDGET-3** — coarse 4-role write gate (`Admin/Executive/Project Manager/Finance`); fine-grained
  (e.g. Finance-only Activate) deferred. ⇒ FR-BV-013, AC-728/729.
- **OD-MARGIN-1** (context) — budget (Active version) is the *cost* leg of both margin lenses; pipeline
  projects also carry budget versions. ⇒ shapes the seed (P002/P010 get versions) and the OUT-of-scope
  note that the margin re-formula consumes this but is a later issue.

**Open / needs owner confirmation (flagged above, non-blocking for build start but pin before merge):**
- **OQ-1 → OD-BUDGET-A:** Active is read-only + clone-to-revise (recommended) vs in-place Active edit. Spec
  assumes read-only.
- **OQ-2 (implementation, for the plan — not an owner decision):** activation atomicity. Two viable shapes:
  (a) a `security definer` RPC `activate_budget_version(version_id)` that archives the prior Active and sets
  the new one in one transaction (re-asserting `auth_role()`/`auth_org_id()` internally), or (b) two
  client statements in a transaction relying on the partial unique index to reject the race. The plan
  (eng-planner) picks; this spec only requires atomicity + single-Active (NFR-BV-ATOM-001, AC-727). The
  not-Draft line-item guard (FR-BV-011) likewise lands as RPC-side check or a trigger — decided in the plan.
- **OQ-3 → OD-BUDGET-B:** archive-Active-with-no-successor warns but does not block (project → budget 0).
  Confirm warn-not-block.
- **OQ-4 → OD-BUDGET-C/D:** Draft version + line-item deletes are hard deletes; Archived versions are never
  deleted. Confirm no soft-delete/audit needed for MVP.
