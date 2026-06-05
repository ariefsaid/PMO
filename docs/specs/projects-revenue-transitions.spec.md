# Spec: Projects — status-transitions + revenue fields (Issue: build-wave #4)

Fourth issue of the build wave and the **foundation the Sales-pipeline/Dashboard issue (#5) consumes**.
Ships a single `transition_project()` security-definer RPC that drives the project status flow (the pipeline
ramp `Leads → … → Negotiation`, the win/loss decisions `→ Won, Pending KoM` / `→ Loss Tender`, and the
on-hand moves `Ongoing Project / On Hold / Close Out`) with the coarse role gate (Admin/Executive/Project
Manager/Finance) re-asserted internally, plus three new revenue fields on `projects`
(`customer_contract_ref`, `contract_date`, `decided_at`) captured/stamped at the win/loss decision. It also
adds a NEW org-scoped `pipeline_stage_config(org_id, status, win_probability)` seeded lookup table
(OD-SP-2) that #5's weighted-pipeline value reads. This is a **direct application of the established
transition-RPC pattern** (ADR-0011 / ADR-0012) — same `security definer` + internal-authz re-assertion +
map-as-data legality + pinned `search_path = public` + revoke-anon discipline; **no new architectural
decision** (the plan records "follows ADR-0012 pattern").

- **Grounds:** `docs/decisions.md` **OD-SP-1/2/3, OD-MARGIN-2** (binding); ADR-0011 (the `security definer`
  RPC + internal-authz + anon-revoke pattern), ADR-0012 (the procurement transition-RPC = the closest
  mirror); ADR-0009 (read-RPC + anon-revoke precedent); ADR-0010 (test pyramid + AC-id tagging); ADR-0003
  (DAL), ADR-0005 (TanStack Query). Reuses the DAL pattern of `src/lib/db/timesheetTransition.ts` /
  `src/lib/db/procurementLifecycle.ts`, the read-DAL of `src/lib/db/projects.ts`, the hook patterns of
  `src/hooks/useProjects.ts` / `src/hooks/useTimesheetApproval.ts`, the `// @ts-expect-error` +
  `as unknown as <T>` RPC-DAL cast established in `dashboard.ts` / `budgets.ts` / `procurementLifecycle.ts`
  / `timesheetTransition.ts`, and `useEffectiveRole` from `src/auth/impersonation.tsx` for cosmetic
  action gating.
- **Schema baseline — verified `supabase/migrations/0001_init_schema.sql` §5.5:**
  `projects(id, org_id → organizations DEFAULT '0000…0001', code, name, status project_status DEFAULT
  'Leads', client_id → companies, project_manager_id → profiles, contract_value numeric(14,2) DEFAULT 0,
  budget numeric(14,2) DEFAULT 0, spent numeric(14,2) DEFAULT 0, start_date date, end_date date,
  last_update timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), unique(org_id, code))` with
  indexes `projects_org_id_idx`, `projects_org_status_idx (org_id, status)`, `projects_pm_idx`,
  `projects_client_idx`. **No `customer_contract_ref` / `contract_date` / `decided_at` columns today; no
  `pipeline_stage_config` table.** Enum `project_status = ('Leads','PQ Submitted','Quotation Submitted',
  'Tender Submitted','Negotiation','Won, Pending KoM','Ongoing Project','On Hold','Close Out','Loss Tender',
  'Internal Project')` (the win state literal is exactly `'Won, Pending KoM'` — with the comma).
  `user_role = ('Executive','Project Manager','Finance','Engineer','Admin')`.
- **RLS baseline — verified `supabase/migrations/0002_rls.sql` + `0004_force_rls.sql`:** `auth_org_id()` /
  `auth_role()` are `security definer set search_path = public`, sourced from `profiles`. `projects`:
  `projects_select` = `org_id = auth_org_id()` (read-in-org for all authenticated); `projects_write`
  (FOR ALL) = `org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')`
  on both `using` and `with check`. `projects` has `force row level security` (0004). `org_id` is
  client-unspoofable: column default (0001) + `with check (org_id = auth_org_id())` (0002). The coarse
  `projects_write` policy lets an authorized role update `status`/revenue fields directly today — this
  issue introduces the RPC as the **authoritative** transition path (legal-map + decision-field capture +
  `decided_at` stamping), while the coarse policy stays as a non-transition backstop (see §RLS / FR-PR-002).

---

## AS-IS (what exists today)

- **`projects` is read-live, write-mock.** A live read DAL exists (`src/lib/db/projects.ts` —
  `listProjects()` returning `ProjectWithRefs`), a read hook (`useProjects`), and a **live-DAL-backed**
  list page (`pages/Projects.tsx`) rendering Grid / List / Board with status badges, contract value, and
  client/PM names. There is **no write path** for project status from the live app: `pages/Projects.tsx`
  has a non-wired `New Project` button and **no status-change control**; `pages/ProjectDetails.tsx` is the
  un-migrated 1388-line prototype still backed by `data/mockData` (NOT live DAL) and is **out of scope to
  rewrite** this issue (separate decomposition backlog item).
- **No transition mechanism.** There is no `transition_project` RPC. The only mutation surface is the
  coarse `projects_write` RLS policy (an authorized role may `update` any column on an in-org project),
  which has no notion of a legal-transition map, no win/loss decision-field capture, and no `decided_at`
  stamping. A win or loss is therefore unrepresentable as a first-class, audited decision today.
- **No revenue/decision fields.** `projects` has `contract_value` (a single best-estimate number,
  OD-MARGIN-2) but **no** `customer_contract_ref` (the client's inbound contract/PO number — the
  revenue-side award), **no** `contract_date`, and **no** `decided_at` (the field #5's win-rate time
  filter queries). A won project cannot record *which* customer contract won it or *when* it was decided.
- **No stage win-probability config.** Win-probabilities (OD-SP-2) are not stored anywhere; there is no
  `pipeline_stage_config` table, so #5's weighted-pipeline value has nothing to read and would otherwise
  hard-code the ramp (the explicit anti-pattern OD-SP-2 forbids).

## Scope (strict in/out)

**IN:**
1. **Revenue/decision fields (OD-SP-3, OD-MARGIN-2):** migration adds to `projects` three **nullable**
   columns — `customer_contract_ref text` (the CLIENT's contract/PO number issued **to us**, manually
   entered — it is theirs, NOT auto-generated, the mirror of our outbound vendor PO), `contract_date date`
   (the customer contract/PO date), and `decided_at timestamptz` (the decision timestamp; null = still in
   pipeline / undecided — also the seed of the deferred status-history, OD-MARGIN-2).
2. **Stage win-probability config table (OD-SP-2):** a NEW org-scoped lookup table
   `pipeline_stage_config(org_id uuid, status project_status, win_probability numeric(4,3), primary key
   (org_id, status))` with `enable` + `force row level security`, **read-in-org** for all authenticated +
   the **coarse write gate** (Admin/Executive/PM/Finance — see OD-PR-A) and a parent-free org guard
   (`org_id = auth_org_id()`), seeded per org with the OD-SP-2 defaults for the five pipeline stages.
3. **State machine (OD-SP-1):** a centralized transition map defined as **data** driving all status changes
   through a single `transition_project(p_id uuid, p_to project_status, p_customer_contract_ref text
   default null, p_contract_date date default null)` **`security definer`** RPC (mirrors ADR-0012). The map
   is **permissive** (this is sales, not procurement — sensible forward AND back moves allowed): the
   pipeline ramp may step forward or back (`Leads ↔ PQ Submitted ↔ Quotation Submitted ↔ Tender Submitted
   ↔ Negotiation`); any pipeline stage may go to `Loss Tender`; the win edge `Negotiation → Won, Pending
   KoM` (and, pragmatically, any later pipeline stage `Tender Submitted`/`Quotation Submitted` →
   `Won, Pending KoM` to allow skipping); the on-hand set moves freely among `Won, Pending KoM ↔ Ongoing
   Project ↔ On Hold ↔ Close Out`; `Internal Project` is reachable from `Leads` (re-classify a non-revenue
   item) and is otherwise isolated. See FR-PR-003 for the exact map. `Loss Tender` is terminal except a
   re-open back to `Negotiation` (allow correcting a mis-recorded loss). `Close Out` is terminal except
   re-open to `Ongoing Project`.
4. **Decision capture + `decided_at` stamping (OD-SP-3), re-asserted inside the RPC** raising on deny/bad
   input:
   - **Coarse role gate + tenant isolation:** `auth_org_id()` (the project's `org_id`) and `auth_role() in
     ('Admin','Executive','Project Manager','Finance')` are re-asserted internally, raising `42501`
     otherwise.
   - **Win (`→ 'Won, Pending KoM'`)** — the system **requires** a non-null/non-blank
     `p_customer_contract_ref` AND a non-null `p_contract_date`, persists them, and stamps
     `decided_at = p_contract_date::timestamptz` (the decision date = the customer contract/PO date,
     OD-SP-3). Missing either input raises `P0001` ("customer contract ref and date are required to win").
     This requirement applies on **first reach** of the won-set via the win edge; subsequent on-hand moves
     (`Won, Pending KoM → Ongoing Project`, etc.) do NOT re-require it (the project is already decided —
     `decided_at` already set; the customer ref/date persist).
   - **Loss (`→ 'Loss Tender'`)** — no customer PO; stamps `decided_at = now()` (the loss transition time,
     OD-SP-3). `customer_contract_ref` / `contract_date` are left null.
   - **Pipeline / Internal / on-hand-to-on-hand moves** — leave `decided_at` and the customer fields
     **as-is** (null while in pipeline; unchanged once decided).
5. **DAL + hooks:** a thin RPC wrapper `transitionProject(id, to, opts?)` over `transition_project`, plus a
   pure `isLegalProjectTransition(from, to)` helper mirroring the SQL map (single TS source), a pure
   `projectStatusGroup(status)` helper returning `'pipeline' | 'onHand' | 'lost' | 'internal'` (the OD-SP-1
   membership, reused by #5), and a read DAL `listPipelineStageConfig()` returning the org's
   `(status, win_probability)` rows (which #5 consumes). The transition mutation hook
   (`useProjectTransition`) invalidates the `['projects', orgId]` cache key; a `usePipelineStageConfig`
   read hook keys by `['pipeline-stage-config', orgId]`.
6. **UI (minimal, on the live `pages/Projects.tsx`):** a per-project **Change status** control (a small
   inline menu/select on each project row/card, cosmetically gated by `useEffectiveRole` to the four write
   roles — the RPC is the real authority) that lists the legal next statuses for the project's current
   status and invokes the transition. When the chosen target is `'Won, Pending KoM'`, the control prompts
   for the **customer contract reference** + **contract date** before submitting (a small inline form).
   Surfaced win data (the badge already shows status; the win ref/date are shown on the row once set).
   Distinct loading / empty / error+retry states are already present on `pages/Projects.tsx` and are
   preserved; the transition control surfaces RPC errors inline (a toast/inline message + the list refetch
   on success). `pages/ProjectDetails.tsx` is **NOT** rewritten this issue (it is still the mock-backed
   prototype — out of scope).
7. **Seed:** set `customer_contract_ref` / `contract_date` / `decided_at` on the won/lost seeded projects
   so #5's win-rate + pipeline value have data, and seed `pipeline_stage_config` with the OD-SP-2 defaults
   for the default org. (See §Seed enrichment.)

**OUT (explicit non-goals — do not bleed scope):**
- **The dashboard margin re-formula, pipeline weighted value, projected margin, dual win-rate + time
  filter, and the SalesPipeline screen rebuild** — ALL issue #5. This issue ships ONLY the foundation
  (fields + config table + transition + the membership/legality helpers) that #5 reads; it computes no
  margin, no weighted value, and no win-rate.
- **Proposed-vs-final value variance / value-change history** — OD-MARGIN-2 deferred. No `proposed_value`
  column, no value-history table; `contract_value` remains the single best-estimate field (unchanged by
  this issue — the win edge captures the customer *reference* + *date*, not a separate value).
- **`ProjectDetails` full decomposition** (migrating the 1388-line mock-backed prototype to live DAL) — a
  separate backlog issue. This issue does NOT touch `pages/ProjectDetails.tsx`.
- **An admin UI to edit `pipeline_stage_config` win-probabilities** — out of this issue; the table is
  seeded and read-only from the app for now (the admin-settings editing UI is a later Admin-module concern,
  the OD-PROC-6 config bridge). The write RLS is in place (the seam), but no editing screen is built.
- **Configurable per-org transition maps / workflow on-off toggles** — the configurability engine is
  seamed, not built (OD-PROC-6 bridge). The transition map + single-RPC authz choke point ARE the seam;
  no per-org transition-config table this issue.
- **Auto-numbering of `customer_contract_ref`** — it is the CLIENT's number, manually entered (OD-SP-3); it
  is explicitly NOT minted by the `next_*_doc_number` server-side counter pattern (that is the cost-side
  outbound vendor PO, OD-PROC-3).
- **Project creation UI / editing other project fields** — out of this issue; the transition control
  operates on already-seeded projects.

## `[OWNER-DECISION]` flags (assumed defaults — flag, don't silently invent)

Behavior is locked by OD-SP-1/2/3 and OD-MARGIN-2. The following are **implementation defaults** the spec
assumes where the OD items are silent; flag for confirmation (non-blocking for build start, pin before
merge):

- **OD-PR-A (`pipeline_stage_config` write gate = the coarse 4-role gate) — assumed.** OD-SP-2 says the
  table is "admin-configurable" but defers the editing UI. The spec assumes the **write RLS** mirrors every
  other business table's coarse gate (`auth_role() in ('Admin','Executive','Project Manager','Finance')`)
  rather than Admin-only, for consistency with `projects_write` / `budget_versions_write` etc. — the
  fine-grained "only Admin may edit win-probabilities" tightening is deferred to the config bridge
  (OD-PROC-6), exactly as OD-BUDGET-3 deferred "only Finance may mark Active". Read is in-org for all.
  *Confirm* the coarse-gate default (vs Admin-only). (Low stakes: no editing UI ships this issue, so the
  gate is exercised only by pgTAP + seed.)
- **OD-PR-B (permissive transition map — sensible forward AND back) — assumed.** The issue brief asks for a
  "permissive map … allow sensible forward/back moves". The spec assumes the explicit map in FR-PR-003:
  pipeline stages step forward/back one-or-more, any pipeline stage can be lost, win is reachable from the
  late pipeline stages (Negotiation/Tender Submitted/Quotation Submitted), on-hand statuses interconvert
  freely, `Loss Tender` re-opens only to `Negotiation`, `Close Out` re-opens only to `Ongoing Project`,
  and `Internal Project` is reachable from `Leads`. *Confirm* this map (it is the only place the brief
  delegates exact edges to the planner).
- **OD-PR-C (win-edge sources) — assumed.** The win requirement (capture ref+date, stamp `decided_at =
  contract_date`) fires whenever the target is `'Won, Pending KoM'` AND the *from* status is a pipeline
  stage (i.e. the first reach of the won-set). On-hand→on-hand moves never re-trigger it. *Confirm* that a
  late re-entry to `Won, Pending KoM` from another on-hand status (e.g. `On Hold → Won, Pending KoM`) is
  NOT treated as a fresh win (it does not re-require the ref/date and does not re-stamp `decided_at`) — the
  spec assumes such a move is allowed and leaves the already-set decision fields untouched.
- **OD-PR-D (`decided_at` from `contract_date`, date→timestamptz cast) — assumed.** OD-SP-3 says "Won →
  `decided_at = contract_date`". The spec assumes `decided_at = p_contract_date::timestamptz` (midnight UTC
  of the contract date) so the `timestamptz` column is set from the `date` input without a separate time.
  *Confirm* the midnight-cast (vs storing a separate time-of-day, which OD-SP-3 does not require).

## Functional requirements (EARS)

**State machine — transition map (permissive)**
- **FR-PR-001** — The system shall define the legal project status transitions as **data** (a
  status→allowed-next-status map) inside `transition_project()`, and shall reject (`P0001`) any transition
  whose `(from, to)` pair is not in the map (and any no-op `from = to`).
- **FR-PR-002** — The system shall route project status changes through `transition_project()` as the
  authoritative transition path (legal-map + decision-field capture + `decided_at` stamping); the coarse
  `projects_write` RLS policy remains as a non-transition backstop for other project edits and is not the
  transition authority.
- **FR-PR-003** — The transition map shall be (each line `from → {to,…}`):
  `Leads → {PQ Submitted, Loss Tender, Internal Project}`;
  `PQ Submitted → {Quotation Submitted, Leads, Loss Tender}`;
  `Quotation Submitted → {Tender Submitted, PQ Submitted, Won, Pending KoM, Loss Tender}`;
  `Tender Submitted → {Negotiation, Quotation Submitted, Won, Pending KoM, Loss Tender}`;
  `Negotiation → {Won, Pending KoM, Tender Submitted, Loss Tender}`;
  `Won, Pending KoM → {Ongoing Project, On Hold, Close Out}`;
  `Ongoing Project → {On Hold, Close Out}`;
  `On Hold → {Ongoing Project, Close Out}`;
  `Close Out → {Ongoing Project}`;
  `Loss Tender → {Negotiation}`;
  `Internal Project → {}` (terminal — re-classification only into it, from `Leads`).

**Authorization + tenancy (re-asserted inside the RPC)**
- **FR-PR-004** — When a user invokes `transition_project()`, the system shall re-assert, **inside** the
  `security definer` function: (a) the project's `org_id = auth_org_id()` (tenant isolation), and (b)
  `auth_role() in ('Admin','Executive','Project Manager','Finance')` (the coarse write gate) — raising
  `42501` otherwise. These re-assertions are independent of RLS (definer bypasses RLS) and MUST stay
  (ADR-0011/0012 lesson).

**Win / loss decision capture + `decided_at` stamping**
- **FR-PR-005** — *Win.* When the requested transition targets `'Won, Pending KoM'` from a pipeline stage
  (Leads/PQ Submitted/Quotation Submitted/Tender Submitted/Negotiation), the system shall require a
  non-blank `p_customer_contract_ref` AND a non-null `p_contract_date` (raising `P0001` if either is
  missing), persist `customer_contract_ref = p_customer_contract_ref` and `contract_date = p_contract_date`,
  and stamp `decided_at = p_contract_date::timestamptz` (OD-SP-3, OD-PR-D). The status update + the three
  field writes shall be a single atomic statement (NFR-PR-ATOM-001).
- **FR-PR-006** — *Loss.* When the requested transition targets `'Loss Tender'`, the system shall stamp
  `decided_at = now()` (the loss-transition time, OD-SP-3) and shall NOT require or write
  `customer_contract_ref` / `contract_date` (left null). Atomic single statement.
- **FR-PR-007** — *Other moves.* For any transition NOT targeting `'Won, Pending KoM'` (from a pipeline
  stage) or `'Loss Tender'` — i.e. pipeline-to-pipeline, on-hand-to-on-hand, `Close Out`/`Loss Tender`
  re-opens, and `Leads → Internal Project` — the system shall update `status` only and leave `decided_at`,
  `customer_contract_ref`, and `contract_date` **as-is** (OD-PR-C: a later on-hand re-entry to
  `Won, Pending KoM` does not re-trigger the win capture and does not re-stamp `decided_at`).

**Stage win-probability config (OD-SP-2)**
- **FR-PR-008** — The system (migration) shall create `pipeline_stage_config(org_id uuid references
  organizations DEFAULT '0000…0001', status project_status, win_probability numeric(4,3), primary key
  (org_id, status))` with `enable row level security` + `force row level security`, a `pipeline_stage_config
  _select` policy (`using (org_id = auth_org_id())`, read-in-org), and a `pipeline_stage_config_write`
  policy (FOR ALL, `using`/`with check` = `org_id = auth_org_id() and auth_role() in ('Admin','Executive',
  'Project Manager','Finance')` per OD-PR-A). The `org_id` seam is client-unspoofable (column default +
  `with check`).
- **FR-PR-009** — The migration shall seed `pipeline_stage_config` for the default org with the OD-SP-2
  defaults: `Leads → 0.10`, `PQ Submitted → 0.25`, `Quotation Submitted → 0.40`, `Tender Submitted → 0.50`,
  `Negotiation → 0.75` (the five pipeline stages; no row for won/on-hand/lost/internal statuses).

**RPC discipline / tenancy**
- **FR-PR-010** — The system shall never accept a client-supplied `org_id` on any project-transition write;
  `transition_project` is `security definer set search_path = public`, re-asserts `auth_org_id()` /
  authorization internally, and shall `revoke all from public`, `grant execute to authenticated`,
  `revoke execute from anon` (ADR-0011 / ADR-0012 discipline). Table references inside the definer function
  are schema-qualified (`public.…`).

**DAL / read contract + membership helpers (the #5 seam)**
- **FR-PR-011** — The system shall expose a DAL that surfaces the RPC error (deny `42501` / illegal `P0001`)
  to the UI without swallowing it: a thin wrapper `transitionProject(id, to, opts?)` over
  `transition_project` (opts = `{ customerContractRef?, contractDate? }` → `p_customer_contract_ref` /
  `p_contract_date`), sending no `org_id`.
- **FR-PR-012** — The system shall expose pure helpers (single TS source mirroring the SQL):
  `isLegalProjectTransition(from, to): boolean` (mirrors the FR-PR-003 map) and
  `projectStatusGroup(status): 'pipeline' | 'onHand' | 'lost' | 'internal'` (the OD-SP-1 membership:
  pipeline = {Leads, PQ Submitted, Quotation Submitted, Tender Submitted, Negotiation}; onHand =
  {Won, Pending KoM, Ongoing Project, On Hold, Close Out}; lost = {Loss Tender}; internal =
  {Internal Project}). These are the foundation #5 reuses for its lens membership.
- **FR-PR-013** — The system shall expose a read DAL `listPipelineStageConfig()` returning the org's
  `(status, win_probability)` rows (org-scoped by RLS, no `org_id` sent), which #5 reads for weighted
  pipeline value.

## NFR
- **NFR-PR-ATOM-001** — A status transition (status update + the relevant `decided_at` /
  `customer_contract_ref` / `contract_date` writes) shall be a **single atomic** server-side operation; no
  observable partial state (e.g. status `'Won, Pending KoM'` with a null `decided_at`, or `'Loss Tender'`
  with a null `decided_at`).
- **NFR-PR-UI-001** — The project status-transition control shall surface RPC errors (deny / illegal /
  missing win inputs) to the user inline (without swallowing them) and refresh the project list on success;
  the existing `pages/Projects.tsx` loading / empty / error+retry states are preserved (Frontend DoD).
- **NFR-PR-PERF-001** — The transition RPC shall load+lock exactly the target project row by primary key
  (`select … for update where id = p_id`) and the config read shall be a single indexed
  `select … where org_id = auth_org_id()` over `pipeline_stage_config` (PK `(org_id, status)`); no
  table scan, no N+1 (scales to millions of projects — the per-transition cost is one PK lookup).

## RLS (verification this issue owns)

This issue **adds** the `pipeline_stage_config` table + its two policies (FR-PR-008) and **proves**, at the
pgTAP layer:
- the `transition_project` RPC's **internal** authz — tenant isolation (cross-org transition → `42501`) and
  the coarse role gate (an Engineer-role caller → `42501`) — proven independently of RLS (definer bypasses
  RLS — the in-function re-assertion is the gate);
- the legal-transition map (illegal jump rejected `P0001`) and the win-input requirement (`→ Won` with no
  ref/date → `P0001`);
- the win/loss `decided_at` stamping (Won → `decided_at = contract_date`; Loss → `decided_at = now()`) and
  win ref/date persistence, atomically;
- `pipeline_stage_config` RLS: read-in-org works, cross-org read returns nothing, the coarse write gate
  admits an authorized role and blocks an Engineer; the default-org seed has the five OD-SP-2 rows;
- `anon` cannot execute `transition_project` (anon-revoke).
The existing `projects` policies are otherwise reused as-is (the coarse `projects_write` stays as the
non-transition backstop); this issue does not rewrite them.

## Acceptance criteria (Given/When/Then)

AC range **AC-1000..AC-1011** (confirmed unused: Dashboard owns 701–711, Budget owns 720–733, Procurement
owns 800–816, Timesheet-approval owns 900–911; `grep -r 'AC-10\d\d'` across the repo finds nothing). Each
AC names its id as the leading token (traceability) and is annotated with its **owning layer (ADR-0010)**.

- **AC-1000** *(Unit)* — Transition map: legal pairs accepted, illegal rejected.
  Given `isLegalProjectTransition`, When asked `Leads → PQ Submitted`, `Negotiation → Won, Pending KoM`,
  `Tender Submitted → Loss Tender`, `Won, Pending KoM → Ongoing Project`, `On Hold → Ongoing Project`,
  `Close Out → Ongoing Project`, `Loss Tender → Negotiation`, `Leads → Internal Project` Then each is legal;
  When asked `Leads → Won, Pending KoM` (illegal jump), `Internal Project → Leads` (terminal),
  `Ongoing Project → Leads` (no on-hand→pipeline), or `Leads → Leads` (no-op) Then each is rejected.
  *(FR-PR-001/003)*
- **AC-1001** *(Unit)* — Status-group membership helper (the #5 seam).
  Given `projectStatusGroup`, When passed each of the five pipeline statuses Then it returns `'pipeline'`;
  When passed `Won, Pending KoM` / `Ongoing Project` / `On Hold` / `Close Out` Then `'onHand'`; When passed
  `Loss Tender` Then `'lost'`; When passed `Internal Project` Then `'internal'`. *(FR-PR-012)*
- **AC-1002** *(Unit)* — DAL surfaces the RPC error + sends correct params, no org_id.
  Given `transitionProject`, When the RPC resolves an error `{message, code:'42501'}` (or `P0001`) Then the
  DAL rejects with a typed `Error` carrying the message (does not swallow it); And a win call
  `transitionProject(id, 'Won, Pending KoM', {customerContractRef:'CPO-9', contractDate:'2026-03-01'})`
  sends params `{p_id, p_to:'Won, Pending KoM', p_customer_contract_ref:'CPO-9', p_contract_date:
  '2026-03-01'}` and **no** `org_id`; And a non-win call sends `p_customer_contract_ref:null,
  p_contract_date:null`. *(FR-PR-002/011)*
- **AC-1003** *(Unit)* — `listPipelineStageConfig` shape (the #5 seam).
  Given `listPipelineStageConfig`, When invoked Then it selects `pipeline_stage_config` returning
  `(status, win_probability)`, normalises `win_probability` to `Number`, and sends **no** `org_id`
  (RLS scopes it). *(FR-PR-013)*
- **AC-1004** *(Unit)* — Status-transition control: legal options + win-input prompt + states.
  Given the project status control for a `Negotiation` project (signed-in user is a write-role), When
  opened Then it offers exactly the legal next statuses for `Negotiation` (`Won, Pending KoM`,
  `Tender Submitted`, `Loss Tender`) and not illegal ones; When the user selects `Won, Pending KoM` Then a
  customer-contract-ref + contract-date input is required before submit; When the transition mutation
  errors Then the error is surfaced inline (not swallowed). And for a non-write-role the control is not
  offered (cosmetic gate). *(FR-PR-005/011, NFR-PR-UI-001, AC traces to AC-1011 E2E)*
- **AC-1005** *(pgTAP)* — Tenant isolation + role gate inside the RPC.
  Given an org-A user and an org-B project, When the org-A user calls `transition_project` on it Then it
  raises `42501` (project `org_id ≠ auth_org_id()`); And given an **Engineer**-role user in the project's
  own org, When they call `transition_project` Then `42501` (coarse role gate); And given a Project Manager
  in-org, When they call a legal transition Then it succeeds. *(FR-PR-004)*
- **AC-1006** *(pgTAP)* — Legal-map gate + win-input requirement at the DB.
  Given a `Leads` project, When an authorized user calls `transition_project(…, 'Won, Pending KoM', …)`
  (illegal jump from Leads) Then `P0001`; And given a `Negotiation` project, When an authorized user calls
  `transition_project(…, 'Won, Pending KoM', null, null)` (no ref/date) Then `P0001` ("required to win");
  And When called with `from = to` (no-op) Then `P0001`. *(FR-PR-001/003/005)*
- **AC-1007** *(pgTAP)* — Win path: capture + `decided_at = contract_date`, atomically.
  Given a `Negotiation` project and an authorized user, When they call `transition_project(…,
  'Won, Pending KoM', 'CPO-2026-77', '2026-03-15')` Then it succeeds and the row has `status =
  'Won, Pending KoM'`, `customer_contract_ref = 'CPO-2026-77'`, `contract_date = '2026-03-15'`, and
  `decided_at = '2026-03-15'::timestamptz` (decision date = customer contract date, OD-SP-3); no partial
  state. *(FR-PR-005, NFR-PR-ATOM-001)*
- **AC-1008** *(pgTAP)* — Loss path: `decided_at = now()`, no customer fields.
  Given a `Tender Submitted` project and an authorized user, When they call `transition_project(…,
  'Loss Tender')` Then it succeeds and the row has `status = 'Loss Tender'`, `decided_at is not null` (the
  loss-transition time), and `customer_contract_ref` / `contract_date` remain null. *(FR-PR-006,
  NFR-PR-ATOM-001)*
- **AC-1009** *(pgTAP)* — `decided_at` untouched on non-decision moves (OD-PR-C).
  Given a won project (`status = 'Won, Pending KoM'`, `decided_at` set to a known value), When an authorized
  user calls `transition_project(…, 'Ongoing Project')` Then `decided_at` is unchanged (equals the prior
  value) and the customer fields persist; And given a `Leads` project with null `decided_at`, When moved to
  `PQ Submitted` Then `decided_at` stays null. *(FR-PR-007)*
- **AC-1010** *(pgTAP)* — `pipeline_stage_config` RLS + seed + anon-revoke.
  Given the `pipeline_stage_config` table, When an in-org authenticated user SELECTs it Then they read their
  org's rows; When an org-B user SELECTs Then org-A rows are not visible (cross-org isolated); When an
  Engineer-role user attempts an `insert`/`update` Then it is blocked by RLS, and an authorized (PM) write
  succeeds (OD-PR-A); And the default-org seed has exactly the five OD-SP-2 rows with the documented
  probabilities; And the `anon` role cannot execute `transition_project`. *(FR-PR-008/009/010)*
- **AC-1011** *(E2E)* — Win a project end-to-end (single curated journey).
  Given an authorized user (PM) signed in on the Projects page with a project in a late pipeline stage, When
  they open its status control, choose **Won, Pending KoM**, enter a customer contract reference + date, and
  submit Then the project shows status `Won, Pending KoM` and the entered customer contract reference is
  displayed on the row; And (assert the decision was recorded) the project's `decided_at`/contract data is
  reflected (the won badge + customer ref visible after the list refetch). *(FR-PR-001/004/005/011,
  NFR-PR-UI-001)*

## Traceability (FR → AC → owning layer)

| Requirement | AC(s) | Owning layer (ADR-0010) |
|---|---|---|
| FR-PR-001 (transition map legality) | AC-1000, AC-1006, AC-1011 | Unit (pgTAP gate; E2E end-to-end) |
| FR-PR-002 (transitions via RPC) | AC-1002 | Unit |
| FR-PR-003 (the permissive map) | AC-1000, AC-1006 | Unit (pgTAP gate) |
| FR-PR-004 (internal authz: org + role gate) | AC-1005 | pgTAP |
| FR-PR-005 (win capture + decided_at = contract_date) | AC-1007, AC-1006, AC-1004, AC-1011 | pgTAP (UI prompt at Unit; E2E) |
| FR-PR-006 (loss: decided_at = now()) | AC-1008 | pgTAP |
| FR-PR-007 (other moves leave decided_at as-is) | AC-1009 | pgTAP |
| FR-PR-008 (pipeline_stage_config table + RLS) | AC-1010 | pgTAP |
| FR-PR-009 (seed the OD-SP-2 defaults) | AC-1010 | pgTAP |
| FR-PR-010 (org_id not client-supplied + anon-revoke) | AC-1010, AC-1005 | pgTAP |
| FR-PR-011 (DAL error surfacing + params) | AC-1002, AC-1004 | Unit |
| FR-PR-012 (legality + status-group helpers) | AC-1000, AC-1001 | Unit |
| FR-PR-013 (listPipelineStageConfig read) | AC-1003 | Unit |
| NFR-PR-ATOM-001 (atomic transition) | AC-1007, AC-1008 | pgTAP |
| NFR-PR-UI-001 (inline error + refetch; states preserved) | AC-1004, AC-1011 | Unit (E2E end-to-end) |
| NFR-PR-PERF-001 (PK lock + indexed config read) | AC-1007 (lock path exercised) | pgTAP (design-reviewed) |

Per-layer AC split: **Unit** AC-1000/1001/1002/1003/1004 (**5**) · **pgTAP** AC-1005/1006/1007/1008/1009/
1010 (**6**) · **E2E** AC-1011 (**1**, curated win-a-project journey). Authorization, tenancy, the
legal-map + win-input gates, the win/loss `decided_at` stamping, atomicity, and the config-table RLS/seed
all sit at **pgTAP** (the DB is the real gate); the legality + status-group helpers, DAL error surfacing,
the config-read DAL shape, and the UI control gating sit at **Unit**; one end-to-end win journey at **E2E**.
No AC is pushed up a layer to satisfy a convention (ADR-0010).

## Seed enrichment required (verified `supabase/seed.sql` §projects)

To give #5's win-rate + weighted-pipeline value real data without a live transition run:
- **Seed `pipeline_stage_config` for the default org** with the OD-SP-2 defaults (the five pipeline-stage
  rows) — `org_id` omitted on insert (column default keeps the client-unspoofable seam). This is FR-PR-009.
- **Backfill the won + lost decision data on seeded projects.** Today's seed (`supabase/seed.sql` §projects)
  has `P001` (`Ongoing Project`, $5,000,000) and `P003`/`Acme Internal Platform` (`Ongoing Project`,
  $3,000,000) in the on-hand (won) set, plus pipeline rows `P002` (`Tender Submitted`), `P010`
  (`PQ Submitted`). For the two on-hand (won) projects set `customer_contract_ref` (e.g. `CPO-2026-001` /
  `CPO-2026-003`), `contract_date`, and `decided_at = contract_date::timestamptz` so #5's value-weighted
  win-rate numerator + on-hand value have data. **Add at least one `Loss Tender` seeded project** (so #5's
  win-rate denominator is non-trivial) with `decided_at = now()`-style fixed date and null customer fields
  — either re-class an existing pipeline row or add a new project row (keep the `unique(org_id, code)`
  constraint; PM = Alice; client = a Client company). Pipeline rows (`P002`, `P010`) keep `decided_at` null
  (still undecided). Do **not** hard-code `org_id` on any insert/update (column default keeps the seam).
- Respect `unique(org_id, code)` on any new project row; use a fresh `code`.

## Open questions / decisions-applied

**Decisions applied (cited):**
- **OD-SP-1** — pipeline / on-hand / excluded membership ⇒ FR-PR-012 (`projectStatusGroup`), the transition
  map groups (FR-PR-003), AC-1001.
- **OD-SP-2** — stage win-probabilities stored in a seeded org-scoped `pipeline_stage_config` lookup table
  (NOT hard-coded) ⇒ FR-PR-008/009, AC-1010, the read DAL FR-PR-013.
- **OD-SP-3** — win-rate decision date = the customer contract/PO date; `customer_contract_ref` +
  `contract_date` (manual, the inbound revenue-side award) + `decided_at` (Won = contract_date, Loss =
  transition time) ⇒ FR-PR-005/006, the three new columns, AC-1007/1008.
- **OD-MARGIN-2** — single `contract_value` (unchanged); proposed-vs-final variance + value history deferred
  (no extra columns) ⇒ Scope OUT.
- **ADR-0011 / ADR-0012** — `transition_project` is a direct application of the established
  `security definer` transition-RPC pattern (internal authz re-assertion, pinned `search_path`,
  revoke-anon, map-as-data) ⇒ FR-PR-002/004/010. **No new ADR** — the plan records "follows ADR-0012
  pattern".

**Open / needs owner confirmation (flagged above, non-blocking for build start; pin before merge):**
- **OQ-1 → OD-PR-A:** `pipeline_stage_config` write gate = the coarse 4-role gate (vs Admin-only);
  fine-grained tightening deferred to the config bridge. Confirm.
- **OQ-2 → OD-PR-B:** the exact permissive transition map (FR-PR-003) — the only place the brief delegates
  edge choices to the planner. Confirm.
- **OQ-3 → OD-PR-C:** the win capture fires only on first reach of `Won, Pending KoM` from a pipeline
  stage; on-hand re-entry to `Won, Pending KoM` does not re-trigger it nor re-stamp `decided_at`. Confirm.
- **OQ-4 → OD-PR-D:** `decided_at = contract_date::timestamptz` (midnight) on win. Confirm.
