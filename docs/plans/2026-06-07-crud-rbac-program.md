# Plan: App-wide FE CRUD + RBAC + approval gating on a 3-layer (FE / API / BE) seam

## Context
The app is today **view + lifecycle-transition only**. The original AI-Studio prototype's create/edit
forms were *frontend-only mocks* (no persistence); the Supabase rewrite built only the high-value
lifecycle write paths (transitions, budget versions, timesheet entry) and **deferred generic CRUD**; the
UI-polish round then removed the dead disabled "New …" buttons. The owner wants the real thing: **full FE
CRUD for every entity**, with **RBAC** (who may view/create/edit/delete) and **realistic approval gating**,
expressed across **3 layers (FE / API / BE)**, with a **modularity seam** so the BE (Supabase) can later be
swapped for an ERP without rewriting the FE. FE CRUD is the priority; deep BE-adapter modularity may be
deferred (seam now, second adapter later).

**Headline finding (7-front parallel audit, `w981px0ok`):** the schema + RLS **already authorize**
create/edit/delete for the write-roles on almost every table — `projects_write`, `companies_write`,
`tasks_write`, `procurements_insert`, `*_documents_write` are all `FOR ALL`/permissive, and the `0008`
column-grants already let the 4 roles update project header fields. So this is overwhelmingly a **thin-DAL +
FE-forms + role-gated-buttons** job with a few **targeted hardenings** — *not* a backend rebuild. That is
why it parallelizes and moves fast.

## Owner decisions (locked this session)
- **Soft-archive** app-wide (an additive `archived_at`); list queries hide archived by default; **hard-delete
  = Admin only**; companies block-delete-if-referenced; **procurement keeps Cancel** (no hard delete, audit trail).
- **Light SoD on `contract_value`**: a PM may set/estimate it while a deal is pre-win; **changing it on an
  already-WON project requires Executive or Finance** (segregation of duties) via a scoped edit RPC + audit stamp.
- **Work Orders**: defer — **remove the dead `/work-orders` route/nav**; revisit when the model is defined.

## Director decisions (mine, this session)
- **Resolve the impersonation-vs-real-JWT divergence now** (part of the authz primitive): write affordances
  gate on the **real** role; an impersonation **banner** explains "Viewing as X — writes run as your real role Y".
- **Engineer scope:** read-only across most entities, but CAN raise a procurement request, file an incident,
  update **own** task status, and enter **own** timesheet (shipped). Needs one small RLS widening for own-task status.
- **Projects are created as opportunities** (status `Leads`, or `Internal Project`); a project becomes on-hand
  **only via the existing `transition_project` win path** — keep the state-machine seam intact (no direct on-hand create).
- **Finance** is excluded from project deal-origination/edit affordances in the FE (they own money, not delivery),
  even though RLS permits — FE may be stricter than RLS; RLS stays the authority.

## Architecture — the 3 layers + the seam
- **FE** (React pages + forms): every New/Edit/Delete affordance rendered through one policy gate.
- **API (the seam):** a **typed repository interface per entity** (`ProjectRepository`, `CompanyRepository`,
  `ProcurementRepository`, …) — the contract the hooks consume. Today's `pmo-portal/src/lib/db/*` becomes the
  **Supabase implementation** of those interfaces (near-verbatim move). A future ERP/REST backend = a new
  implementation behind the same interface, **zero FE change**.
- **BE** (Supabase): Postgres + **RLS is the real authority** + the security-definer RPCs for SoD/state machines.

### ADRs to author (in the foundation PR)
- **ADR-0016 — FE authorization primitive + impersonation fix.** `pmo-portal/src/auth/policy.ts` exporting
  `can(action, entity, ctx)` + `usePermission()` / a `<CanWrite>` wrapper, consumed everywhere — replaces the
  duplicated role-`Set`s in `ProcurementDetails.tsx`, `ProjectStatusControl.tsx`, `ProjectBudget.tsx`. Writes
  gate on the **real JWT role** (not impersonated `effectiveRole`); add the impersonation banner. RLS/RPC stay authority.
- **ADR-0017 — Repository / API seam (modularity).** Typed repository interfaces mirroring the existing DAL
  signatures + a shared `AppError { code?, message }` (promoting `ProcurementError`/`TimesheetWriteError`).
  Hooks consume a `repositories` object instead of importing DAL fns directly. **Cheap-now:** the interfaces +
  the Supabase impl. **Deferred:** any second (ERP) adapter. This *is* the FE/API/BE modularity the owner asked for.
- **ADR-0018 — Soft-archive + delete policy.** Additive `archived_at` on `projects` + `companies`; default
  list filter hides archived; hard-delete Admin-only; companies delete blocked-if-referenced (FK guard on
  profiles/projects/procurements/quotations); procurement = Cancel.
- **ADR-0019 — `contract_value` SoD edit RPC.** A scoped security-definer RPC re-asserting role + status:
  PM may set on pre-win; Exec/Finance only on won. (May be folded into ADR-0018.)

## RBAC matrix (role × op × entity) — FE gating; **RLS is the enforcement authority**
Flat matrix `Admin / Executive / Project Manager / Finance / Engineer`; Admin = break-glass **except SoD**
(cannot self-approve / self-pay — matches existing 0006/0007).

| Entity | Create | Edit | Archive / Delete | Approval / SoD |
|---|---|---|---|---|
| **Project / Opportunity** | Admin·Exec·PM | Admin·Exec·PM (header) | Archive: Admin·Exec · Hard-delete: Admin | create=Leads/Internal; on-hand only via win-transition; **contract_value-on-won → Exec·Finance** |
| **Company** (client/vendor) | Admin·Exec·PM·Finance | same | Archive: Admin·Exec; **block-if-referenced** | master data, no SoD |
| **Procurement (PR header)** | **ANY member incl Engineer** (requester, server-stamped) | requester while Draft/Rejected | Cancel only | existing procure-to-pay SoD (create≠approve, payer≠approver) — unchanged, server-enforced |
| **Proc items / quotations / docs** | requester + PM·Finance·Admin while Draft | same | — | select-quote RPC sets `is_selected` + syncs header |
| **Budget line-item edit** | (create/delete exist) | Admin·Exec·PM·Finance, Draft only | — | approval = Draft→Active activation (exists) |
| **Task** (+dependencies) | Admin·Exec·PM | assignee **Engineer (own status)** + PM·Exec·Admin (structure) | Admin·Exec·PM | needs RLS widening for Engineer own-task status |
| **Incident** | **ANY member** (file) | managers (investigate/close) | Admin | reporter-stamped; Open→Investigating→Closed |
| **Document (metadata)** | Admin·Exec·PM·Finance | author; status-transition **approver ≠ author** | Admin | files deferred (Storage off) |
| **User / Profile** (Admin module) | Admin | Admin (role, manager_id) | Admin | — |

## Phase 0 — FE design + mockups, a full agent loop (design-architect → ui-implementer → design-reviewer) BEFORE your gate
A complete **plan → implement → review** design loop, so the mockups reach your gate **already skill-reviewed** —
you see polished, vetted **ERP / project-management / CRM** screens, not first drafts (`impeccable` + `taste`
are trusted to carry ~80% of the bar; your gate is the final 20%). Reference baseline: **`ui-ux-pro-max`'s
built-in ERP / PM / CRM UI conventions** + **`DESIGN.md`** + the existing `docs/design-mockups/proposal-*.html`
+ the shipped IA-3 component library. Deliverables (each step names its agent + skills):
1. **PLAN (`design-architect` + `ui-ux-pro-max` + `impeccable shape`)** — the CRUD **component architecture**
   (`docs/design/crud-components.md`): how create/edit/delete/approve
   affordances slot into the existing shell + tokens: the `EntityFormModal` vs inline-edit patterns; where
   **New** lives (index header) vs **Edit/Archive/Delete** (detail header / row menu); FK-picker (`Combobox`)
   patterns; the confirm/approve flows; empty/loading/error/validation states. Reuses existing primitives, not new ones.
2. **Role × affordance VISIBILITY MAP (`docs/design/rbac-visibility.md`)** — the concrete UI projection of the
   RBAC matrix: for **every surface × all 5 roles**, exactly which **button / link / field / tab** is shown,
   hidden, or read-only. e.g. *Project detail:* Engineer = read-only (no New/Edit/Delete); PM = Edit + Archive;
   Admin also = Delete; *Procurement:* Engineer sees **Raise request** but never Approve/Pay; *Admin Users* tab
   only visible to Admin. This map is the spec that drives `can(action, entity, role)`.
3. **IMPLEMENT (`ui-implementer` + `ui-ux-pro-max build` + `taste`)** — HTML mockups
   (`docs/design-mockups/crud-*.html`) of the representative surfaces **AND their per-role variants** (the *same*
   screen rendered for different roles so you SEE the gating + IA + form design before code): e.g.
   `crud-project-form.html`, `crud-procurement-new-pr.html` (+ line-items), `crud-companies.html`,
   `crud-project-detail-by-role.html` (engineer/PM/admin side-by-side), `crud-admin-users.html`. Strictly DESIGN.md
   tokens + ERP/PM/CRM idioms from the skill.
4. **REVIEW (`design-reviewer` + `design-review`/`impeccable critique`/`taste`) — BEFORE your gate** — audits the
   mockups for token fidelity, IA coherence, **gating correctness** (does each role see exactly the right
   affordances?), AI-slop, and a11y, with a **fix round** until clean. (This is the agent review you asked to
   happen before you ever look.)
5. **YOUR taste-gate (final 20%)** — you review the already-reviewed mockups + the visibility map; on sign-off the
   build proceeds to Phase 1, built **to the approved mockups** (design-reviewer re-audits each built surface
   against them in Phase 2+, per `docs/design-workflow.md`).

## Phase 1 — Shared foundation (build ONCE, sequential; everything depends on it → 1 PR)
1. **Authz primitive** (ADR-0016): `policy.ts` `can()` + `usePermission`/`<CanWrite>` + impersonation banner;
   refactor the 3 existing call-sites onto it (no behavior change, just consolidation).
2. **Repository seam** (ADR-0017): interfaces + the Supabase impl (move existing `src/lib/db/*` behind them) +
   shared `AppError`; promote `classifyMutationError` (currently in `ProcurementDetails.tsx`) to a shared lib.
3. **Form primitives** in `pmo-portal/src/components/ui/`: `<TextField>`, `<NumberField>`, `<SelectField>`,
   `<Combobox>` (FK pickers from `listClientCompanies`/`listProjectManagers`/projects), `<FormRow>`/
   `<FormGrid>`/`<FormActions>`, `<FieldError>`, and an `EntityFormModal` composite. Reuse `ConfirmDialog`
   (delete), `useToast`, `ErrBanner`. A small `useForm`/validation helper. Strictly on DESIGN.md tokens.
4. **Migrations**: `archived_at` (ADR-0018) + list-filter, the `contract_value` SoD RPC (ADR-0019), the
   Engineer own-task-status RLS widening — each reversible, RLS on, org_id seam intact, proven by pgTAP.
Foundation PR runs the full loop incl. **security-auditor** (it's authz + RLS + an RPC).

## Phase 2+ — Per-entity build (PARALLEL vertical slices, to the approved mockups)
Each entity = repository methods (create/update/archive) + any RLS/RPC hardening + FE index/forms/gated
affordances + tests. Entities touch disjoint files → **parallel worktrees**, each its own PR + CI. Value order:
1. **Companies** — index page (replaces placeholder) + create/edit/archive; unblocks project/procurement FK pickers.
2. **Projects / Opportunities** — create-deal form, edit-header, archive, the contract_value-SoD affordance.
3. **Procurement** (biggest) — New PR + **line-items CRUD** (add items to `DETAIL_SELECT` first) + **quotation-entry**
   (wire the already-built `createQuotation`) + **select-quote RPC** (currently `is_selected` never set — real bug) +
   Draft-header-edit + the **Documents tab** (`procurement_documents` is a dead table today).
4. **Tasks** (+ the Engineer own-status RLS) — per-project list/board + create/edit/assign/status/delete + dependencies.
5. **Incidents** — new route + index + file-incident + investigate/close workflow.
6. **Documents (metadata)** — per-project register + metadata CRUD + status workflow (file upload deferred until Storage).
7. **Admin Users module** — profiles table + invite/create + role/manager assignment (Admin-only).
8. **Budget line-item inline edit** — small (DAL/hook/schema already support it; just the missing Edit affordance).

Each slice runs the per-issue loop (spec/plan → TDD → spec+quality review → security where it touches RLS/RPC
→ qa-acceptance e2e → PR → CI). Planning, reviews, and independent slices **fan out in parallel** (the speed lever),
while each slice keeps every gate.

## Test strategy (ADR-0010)
Per entity: **Unit** (form render/validation, `can()` gating, hook mutations) · **pgTAP** (the RLS/RPC write
contract — who can/can't C/U/D, the SoD, archive semantics, the companies FK-guard) · **1 curated e2e** per CRUD
journey with a **dedicated seed row** (P011 pattern) to avoid seed-coupling. Current e2e covers only transitions;
every new CRUD op gets coverage at its owning layer. Per the **binding BDD rule**, e2e encodes the real user
journey + asserts the goal — never weakened to match the app.

## Deferred (noted, non-blocking)
Work Orders (define-or-drop) · Reports module · Storage/file-upload for documents (re-enable Storage first) ·
the second (ERP) repository adapter (interfaces land now) · `pipeline_stage_config` admin editing ·
fine-grained $-threshold approvals (OD-PROC-6 config bridge).

### Admin Users — `disable/Status` + `invite/create` DEFERRED (UI-polish round, 2026-06-08)
Both Admin-Users write paths in §9.10 / §J that need **server-side** capability are deferred until that capability
exists; the FE is kept **honest** in the meantime (no affordance implying the feature is available):
- **User disable / Status** — needs a `profiles.status` (active/disabled) column **and** a server-side auth-admin
  call to actually revoke sign-in. **Not built.** There is **no** disable/Status row affordance in `AdminUsers.tsx`
  (not even a greyed dead control) — the row menu carries only **Edit role** + **Change manager** (both fully wired).
- **Invite / create user** — creating an auth account needs the Supabase **admin API (service-role key)**, which is
  server-side only. **Not built.** The header **Add user** affordance is rendered as a **disabled control with a
  reason** (`aria-label`/tooltip "Inviting users arrives with server-side auth"), matching the Documents "Attach file"
  deferred pattern — **not** a button that opens a "coming soon" modal dead-end (the prior `InviteFollowUpModal` was
  removed). Editing existing profiles' **role + manager** is fully wired and unaffected.

When the server side lands, both become real affordances behind the existing `can('create'|'edit','user')` Admin gate.

### Document-approval SoD — now SERVER-ENFORCED (server stage, this program)
The project-Documents status transition (`Issued → Approved/Rejected`) SoD (**approver ≠ author**) is no longer
FE-cosmetic-only: it is enforced **server-side** (RLS/RPC is the authority, per §Architecture). The FE still hides the
Approve/Reject affordance from a document's own author and explains the block via a `GateNotice`, but a slip-through is
rejected at the DB and surfaces a classified toast (`classifyMutationError`) — consistent with the procurement
create≠approve / payer≠approver SoD. Hiding the button is clarity, not the security boundary.

## Critical files
- New: `pmo-portal/src/auth/policy.ts`, `pmo-portal/src/lib/repositories/*` (interfaces + Supabase impl),
  `pmo-portal/src/components/ui/{TextField,NumberField,SelectField,Combobox,FormRow,FormActions,FieldError,EntityFormModal}.tsx`,
  `pmo-portal/src/lib/appError.ts`, migrations `00NN_archived_at.sql` / `00NN_project_value_sod.sql` /
  `00NN_task_engineer_status.sql`, ADRs `docs/adr/0016..0019-*.md`, entity pages/forms under `pmo-portal/pages/*`.
- Reuse: `src/components/ui/ConfirmDialog.tsx`, `useToast`, `ErrBanner`, `classifyMutationError` (to be promoted),
  `src/auth/impersonation.tsx` (`useEffectiveRole`/`effectiveRole` + add `realRole`), `src/lib/db/*` (becomes the repo impl),
  `listClientCompanies`/`listProjectManagers` (FK pickers).

## Verification
Per slice: `npm run typecheck`/`lint`/`test` green (≥80% changed) · `supabase test db` green (RLS/SoD/archive/FK
proofs) · curated e2e green · CI **verify + integration** green on the PR. End-to-end smoke: each role logs in →
sees only its authorized New/Edit/Delete affordances → completes a CRUD cycle → an unauthorized write is blocked
by RLS (pgTAP + a negative check). Impersonation banner shows; writes gate on the real role.

## Sequencing for speed
**Phase 0 design + mockups** (design-architect; **your taste-gate**) — parallel mock authoring, one review gate.
**Phase 1 foundation** = 1 sequential PR (blocks everything). **Phase 2+ entities** = **parallel worktrees**, each
its own PR/CI, built to the approved mockups, with reviews/security/qa fanning out. That parallelism (plus the
"BE-already-authorizes-it" finding) is where the speed comes from without sacrificing gates.
