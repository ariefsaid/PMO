# RBAC Visibility Map — PMO Portal

**Status:** Design-plan (Phase 0, step 2). The concrete UI projection of the plan's RBAC matrix + the locked owner/Director decisions. This is the spec for `can(action, entity, ctx)` (ADR-0016), for `<CanWrite>`, and for every per-role mockup (`docs/design-mockups/crud-project-detail-by-role.html`, etc.).
**Plan:** `docs/plans/2026-06-07-crud-rbac-program.md` (§RBAC matrix, §Owner/Director decisions).
**Component patterns:** `docs/design/crud-components.md`.
**Skills applied:** `impeccable shape`, `ui-ux-pro-max` (ERP role-based access conventions, `empty-nav-state`, `destructive-nav-separation`).

---

## Reading rules (binding)

1. **Three affordance states per cell:** **SHOWN** (rendered + enabled) · **HIDDEN** (not rendered at all) · **READ-ONLY** (rendered as a static value / disabled-with-reason, never as a live control). A field/button is exactly one of these per role per surface.
2. **Gate on the REAL JWT role, not the impersonated `effectiveRole`** (ADR-0016, Director decision). Navigation visibility (`Rail`) reads `effectiveRole` (view-as is a *viewing* feature); **write affordances read `realRole`**. When real ≠ effective, the impersonation **banner** is shown: "Viewing as {effectiveRole}. Writes run as your real role, {realRole}." (ui-ux-pro-max `empty-nav-state`: explain, don't silently mislead.)
3. **RLS / RPC is the enforcement authority.** This map is a *clarity* projection. Hiding a button is never the security boundary; an unauthorized write that slips through still fails at the DB and surfaces a classified toast (`classifyMutationError`). The FE may be **stricter** than RLS (e.g. Finance on projects) — RLS stays the authority (plan Director decision).
4. **Admin = break-glass EXCEPT SoD.** Admin sees create/edit/delete everywhere, but the procurement SoD (create ≠ approve, payer ≠ approver) and document SoD (approver ≠ author) still bind Admin server-side; the FE shows Admin those actions only when the SoD permits (matches existing 0006/0007 + `isApprover`/`isRequester` checks).
5. **READ-ONLY is a real designed state**, not a hidden one (ui-ux-pro-max `read-only-distinction`): static value rows, no Edit/New/Delete chrome, no greyed-out "dead" buttons. A role that cannot write a surface sees a clean read-only surface, not a wall of disabled controls.
6. **Roles** (5): **Admin · Executive · Project Manager (PM) · Finance · Engineer.** The role strings are the existing `UserRole` enum values.

Legend: ● SHOWN · ○ HIDDEN · ◐ READ-ONLY · ◆ SHOWN but SoD/context-conditional (see note).

---

## A. Global shell (Rail nav, top bar, command palette)

Navigation visibility is already implemented in `Rail.tsx` (reads `effectiveRole`). This map records it as the canonical spec; CRUD adds no new nav items except `/incidents`. `/work-orders` is **removed** (owner decision).

| Nav item / route | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard `/` | ● | ● | ● | ● | ● |
| Projects `/projects` | ● | ● | ● | ● | ● |
| Sales Pipeline `/sales` | ● | ● | ● | ● | ○ |
| Procurement `/procurement` | ● | ● | ● | ● | ○* |
| Timesheets `/timesheets` | ● | ● | ● | ○ | ● |
| Approvals `/approvals` | ● | ● | ● | ○ | ● |
| Tasks `/tasks` | ● | ○ | ● | ○ | ● |
| Companies `/companies` | ● | ● | ● | ● | ○ |
| Reports `/reports` | ● | ● | ● | ● | ○ |
| **Incidents `/incidents`** (new) | ● | ● | ● | ● | ● |
| Administration `/administration` | ● | ● | ○ | ○ | ○ |
| **`/work-orders`** | ○ removed | ○ | ○ | ○ | ○ |
| Top-bar `⌘K` command palette | ● | ● | ● | ● | ● |
| Impersonation control (view-as) | ● | ○ | ○ | ○ | ○ |
| **Impersonation banner** (when real≠effective) | ● shown | n/a | n/a | n/a | n/a |

\* Engineer cannot browse the Procurement index, but reaches a PR they raised via their own context (dashboard / a deep link); the **Raise request** create path is available to Engineer. If `/procurement` is opened by an Engineer it shows only their own requests (RLS-scoped) — `empty-nav-state` copy if none.

Notes: Administration nav is already Exec+Admin in `Rail`, but the **module contents** are Admin-only (Exec sees the surface but user-management affordances are read-only / hidden — see §J). The `/work-orders` route + nav item are deleted, not hidden-per-role.

---

## B. Projects / Opportunities — index `/projects`

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View list + drill into a row | ● | ● | ● | ● | ● |
| Toolbar filters / search / view-toggle | ● | ● | ● | ● | ● |
| Header **New deal** (primary) | ● | ● | ● | ○ | ○ |
| Row `⋯` → **Edit** | ● | ● | ● | ○ | ○ |
| Row `⋯` → **Archive** | ● | ● | ○ | ○ | ○ |
| Row `⋯` → **Delete** (hard) | ● | ○ | ○ | ○ | ○ |
| "Show archived" toggle | ● | ● | ● | ○ | ○ |

Finance & Engineer: clean read-only index (no header CTA, no row write menu). Finance is **excluded from project create/edit in the FE** even though RLS permits (Director decision — Finance owns money, not delivery).

## B2. Project / Opportunity — detail `/projects/:id`

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| Header **Edit** (inline header edit: name, client, PM, ref) | ● | ● | ● | ○ | ○ |
| Header **Archive** | ● | ● | ○ | ○ | ○ |
| Header overflow **Delete** | ● | ○ | ○ | ○ | ○ |
| `contract_value` field — pre-win | ◐→● editable | ● | ● | ◐ | ◐ |
| `contract_value` field — **on WON project** | ●◆ (SoD: Exec/Finance authority; Admin via break-glass + audit) | ● | ◐ read-only | ● | ◐ |
| Lifecycle control (win / lose / hold) `ProjectStatusControl` | ● | ● | ● | ○ | ○ |
| Overview / Budget / Procurement / Tasks / Documents tabs | ● | ● | ● | ● | ● (read scope varies per tab below) |

`contract_value` SoD (ADR-0019): pre-win, a PM may set/estimate it (●). Once the project is WON, the value becomes ◐ read-only for PM; editing it requires Exec or Finance (●) via the scoped RPC + an audit-stamped confirm whose copy names the SoD. This is the single most carefully-gated field in the app.

## B3. Budget tab (within project detail)

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View budget versions + line items | ● | ● | ● | ● | ◐ (read-only) |
| Create / add budget line item | ● | ● | ● | ● | ○ |
| **Edit** line item (Draft version only) | ● | ● | ● | ● | ○ |
| Delete line item (Draft only) | ● | ● | ● | ● | ○ |
| Activate version (Draft→Active approval) | ● | ● | ● | ● | ○ |

---

## C. Sales Pipeline `/sales`
Same gating as the Projects index (opportunities are projects in pre-win states). Engineer: HIDDEN nav (○). New-deal create = Admin·Exec·PM (●); Finance ◐ read-only board.

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View pipeline board / drill | ● | ● | ● | ● | ○ (no nav) |
| Header **New deal** | ● | ● | ● | ○ | ○ |
| Move stage (kanban / lifecycle) | ● | ● | ● | ○ | ○ |

---

## D. Companies `/companies` (index + detail)

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View list / detail | ● | ● | ● | ● | ○ (no nav) |
| Header **New company** | ● | ● | ● | ● | ○ |
| **Edit** company | ● | ● | ● | ● | ○ |
| **Archive** | ● | ● | ○ | ○ | ○ |
| **Delete** (hard) — *blocked if referenced* | ● | ○ | ○ | ○ | ○ |
| When delete blocked → GateNotice + **Archive** fallback | ● | (Archive: Exec ●) | ○ | ○ | ○ |

Master data, no SoD. Create/edit is the widest write set (incl. Finance). Delete is Admin-only and additionally **blocked-if-referenced** at the RPC; the FE shows the block GateNotice + an Archive path (crud-components §5.3).

---

## E. Procurement — index `/procurement`

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View index (all PRs) | ● | ● | ● | ● | ○* |
| Header **Raise request** (create) | ● | ● | ● | ● | ●* |
| Row drill into a PR | ● | ● | ● | ● | ● (own only) |

\* Engineer has no Procurement nav item but **can raise a request** (the create path is surfaced from their context, e.g. a dashboard action / project context); Engineer sees only their own requests (RLS-scoped).

## E2. Procurement — detail `/procurement/:id`
The richest gating surface. The shipped `allowedActions` matrix is byte-preserved (ADR-0016 only re-points it at the **real role** + routes it through `can()`); this table is its visibility projection. Lifecycle actions are SoD-conditional (◆) and additionally enforced by the RPC.

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View detail + lifecycle stepper | ● | ● | ● | ● | ● (own) |
| **Edit PR header** (Draft/Rejected only) | ● | ◆ requester | ◆ requester | ◆ requester | ◆ requester (own, Draft) |
| Submit Request (Draft→Requested) | ● | ● | ● | ● | ● (own) |
| **Approve / Reject** (Requested→) — *not the requester* (SoD-a) | ●◆ | ●◆ | ●◆ | ●◆ | ○ |
| Request Vendor Quotes / Generate PO (sourcing) | ● | ● | ● | ● | ○ |
| Add / edit **line items** (Draft) | ● | ◆ requester+ | ● | ● | ◆ requester (own, Draft) |
| Add **quotation** / **Select Quote** | ● | ○ | ● | ● | ○ |
| Confirm Receipt (Ordered→Received) | ● | ○ | ● | ○ | ◆ requester |
| Mark Vendor Invoiced (Received→) | ● | ○ | ○ | ● | ○ |
| **Mark as Paid** (Invoiced→Paid) — *not the approver* (SoD-b) | ●◆ | ○ | ○ | ●◆ | ○ |
| **Cancel** (no hard delete; audit) | ●◆ canCancel | ◆ | ◆ | ◆ | ◆ requester |
| **Documents** sub-section (metadata) | ● | ● | ● | ● | ◐ (own, read) |
| SoD **GateNotice** (blocked: requester can't self-approve, etc.) | ● shown when blocked | ● | ● | ● | ● |

◆ notes: **Approve/Reject** is shown only to PM·Finance·Exec·Admin AND only when the viewer is **not** the requester (SoD-a). **Mark as Paid** is shown only to Finance·Admin AND only when the viewer is **not** the user who approved (SoD-b). When the only blocker is SoD/identity, the action is HIDDEN and the **GateNotice** explains why (existing `sodGateMessage` copy). The RPC rejects any slip-through with `P0001`/`42501` → classified toast.

---

## F. Tasks `/tasks` + project Tasks tab

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View tasks (list / board) | ● | ● | ● | ○ (no nav) | ● |
| Header **New task** | ● | ● | ● | ○ | ○ |
| **Edit task structure** (title, assignee, due, deps) | ● | ● | ● | ○ | ○ |
| **Change task STATUS** | ● (any) | ● (any) | ● (any) | ○ | ◆ own only |
| Delete task | ● | ● | ● | ○ | ○ |
| Drag on board to change status | ● | ● | ● | ○ | ◆ own only |

Engineer is the key read-only-vs-editable split: on **their own assigned task**, the **status `SelectField` is the only editable control** (●◆); title/assignee/due/dependencies are ◐ read-only; on tasks assigned to others, the whole row is ◐ read-only (no status control). Requires the RLS widening for Engineer own-task status (plan). Finance has no Tasks nav (delivery, not finance).

---

## G. Incidents `/incidents` (new route)

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View incidents | ● | ● | ● | ● | ● |
| Header **File incident** (create) | ● | ● | ● | ● | ● |
| **Investigate / Close** workflow | ● | ● | ● | ○ | ○ |
| Edit incident (managers) | ● | ● | ● | ○ | ○ |
| Delete incident | ● | ○ | ○ | ○ | ○ |

ANY member can file (reporter server-stamped). Only managers (PM·Exec·Admin) investigate/close. A reporter who is an Engineer can file but cannot self-close beyond the initial filing (◆ on close = HIDDEN for non-managers; GateNotice explains).

---

## H. Documents (project-level metadata register — Documents tab)

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| View register | ● | ● | ● | ● | ● |
| **Add document** (metadata) | ● | ● | ● | ● | ○ |
| **Edit** (author) | ● | ◆ author | ◆ author | ◆ author | ○ |
| **Approve / status transition** — *approver ≠ author* (SoD) | ●◆ | ●◆ | ●◆ | ●◆ | ○ |
| Delete | ● | ○ | ○ | ○ | ○ |
| **Attach file** | ◐ disabled "coming soon" | ◐ | ◐ | ◐ | ◐ |

Document status transition is SoD-gated (approver ≠ author) — shown only to a non-author manager. File upload is universally ◐ disabled-with-tooltip until Storage is re-enabled (deferred); never a broken control.

---

## I. Timesheets `/timesheets` + Approvals `/approvals` (shipped; recorded for completeness)

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| Timesheets nav | ● | ● | ● | ○ | ● |
| Enter **own** timesheet | ● | ● | ● | ○ | ● |
| Approvals nav | ● | ● | ● | ○ | ● |
| Approve **others'** timesheets (not own) | ●◆ | ●◆ | ●◆ | ○ | ○ |

Engineer enters own timesheet (shipped) but does not approve. Finance is excluded from the workforce surfaces. Approval cannot be self-approval (◆, existing).

---

## J. Administration / Users `/administration`

| Affordance | Admin | Executive | PM | Finance | Engineer |
|---|:--:|:--:|:--:|:--:|:--:|
| Open Administration surface | ● | ● | ○ | ○ | ○ |
| View user list | ● | ◐ read-only | ○ | ○ | ○ |
| **Add user** (invite/create) | ● | ○ | ○ | ○ | ○ |
| **Edit** user role / manager_id | ● | ○ | ○ | ○ | ○ |
| Archive / disable user | ● | ○ | ○ | ○ | ○ |
| Other admin config (pipeline stages, etc. — deferred) | ◐ deferred | ○ | ○ | ○ | ○ |

Executive can *open* Administration (existing `Rail` gate) but user-management is **Admin-only** — Exec sees a read-only user list (◐), no create/edit/delete chrome. PM/Finance/Engineer: surface HIDDEN. Admin role changes are high-impact → routed through a confirm.

---

## K. Cross-cutting affordance rules (the `can()` contract)

`can(action, entity, ctx)` where `action ∈ {view, create, edit, archive, delete, transition}`, `entity ∈ {project, company, procurement, procItem, quotation, procDoc, task, taskStatus, incident, incidentClose, document, documentStatus, budgetLine, user, timesheet, approval}`, `ctx = { realRole, currentUserId, record? }`. Derived directly from the tables above:

- **`view`** follows nav visibility (§A) + RLS read scope (Engineer often scoped to own/assigned).
- **`create`** — Project: Admin·Exec·PM. Company: Admin·Exec·PM·Finance. Procurement: ALL (incl. Engineer). Task: Admin·Exec·PM. Incident: ALL. Document/procDoc: Admin·Exec·PM·Finance. User: Admin.
- **`edit`** mirrors create, but **record-scoped**: PR header / line items / procDoc edit require `ctx.record.requested_by_id === currentUserId` while Draft/Rejected; document edit requires authorship; task structure = Admin·Exec·PM; **`taskStatus`** = managers OR (`ctx.record.assignee_id === currentUserId` for Engineer).
- **`archive`** — Project/Company: Admin·Exec. Task: Admin·Exec·PM. (Procurement has no archive → Cancel.)
- **`delete`** (hard) — Project/Company/Document/Incident: **Admin only**; Task: Admin·Exec·PM; companies additionally **blocked-if-referenced** server-side. Procurement: never (Cancel only).
- **`transition`** (lifecycle/approval) — defers to the existing RPCs + the SoD predicates `!isRequester` (approve), `!isApprover` (pay), `approver ≠ author` (document), `!self` (timesheet approval). The FE shows the action only when the predicate holds; the RPC is the authority.
- **Impersonation:** every `can(...)` consumes `ctx.realRole` (the JWT role), never `effectiveRole`. `<CanWrite>` is the render wrapper; `usePermission()` the hook.

---

## L. Per-role mockup checklist (what the by-role mockups must SHOW)

The `docs/design-mockups/crud-*-by-role.html` set must render the *same screen for different roles* so the gate is visible before code. Minimum coverage:

- **Project detail by role:** Engineer (read-only: no Edit/Archive/Delete, contract_value static) · PM (Edit + Archive, contract_value editable pre-win / read-only on won) · Finance (read-only + contract_value editable on won) · Admin (all incl. Delete + impersonation banner).
- **Procurement detail by role:** Engineer-requester (Submit + Cancel own, no Approve/Pay) · PM non-requester (Approve/Reject + sourcing) · Finance (Mark Invoiced/Paid, blocked if they approved → GateNotice) · Admin (all, SoD still binds).
- **Tasks by role:** Engineer (own task status editable, rest read-only) vs PM (full structure edit).
- **Companies / Admin Users:** PM (create/edit company, no Admin nav) vs Admin (full + Users module) vs Exec (read-only Users list).

Each mockup is strictly DESIGN.md-tokened; READ-ONLY renders as clean static surfaces (not greyed dead buttons); HIDDEN affordances are absent (not disabled).

---

## M. Open questions / proposed additions for owner sign-off

1. **Executive on Tasks** — the plan's RBAC matrix lists Task create/edit/delete as "Admin·Exec·PM" yet `Rail` currently HIDES the Tasks nav from Executive. *Conflict to resolve:* either (a) give Exec the Tasks nav (matches the matrix), or (b) keep Tasks PM/Engineer/Admin-only and treat Exec task rights as access-via-project-detail-tab only. **Proposed:** (b) — Exec edits tasks through the project Tasks tab, no top-level Tasks nav (delivery is PM-led). **Needs sign-off — this is the one place the matrix and the shipped nav disagree.**
2. **Executive in Administration** — Exec currently sees the Administration nav (shipped) but user-management is Admin-only. *Proposed:* Exec gets a **read-only** Administration view (org chart / user list, no edits), per §J. Confirm, or hide Administration from Exec entirely.
3. **Engineer Procurement reachability** — Engineer can raise a PR but has no Procurement nav. *Proposed:* surface "Raise request" from the Engineer dashboard + project context, and if `/procurement` is reached, scope it to their own requests with an explanatory empty state. Confirm the entry points.
4. **Finance on projects (FE-stricter-than-RLS)** — confirmed by the Director decision (Finance excluded from project create/edit in FE though RLS permits). Flagged here only so the reviewer doesn't read it as a gate bug: it is intentional, RLS remains the authority.
5. **`contract_value` pre-win editability for Finance** — pre-win the matrix lets PM set value; should Finance also set pre-win value, or only Exec/Finance on won? *Proposed:* pre-win = Admin·Exec·PM set; Finance gains edit rights only at the won-SoD boundary (cleanest segregation). Confirm.
