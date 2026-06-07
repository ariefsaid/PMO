# ADR-0016: FE authorization primitive + impersonation-vs-real-JWT fix

**Status:** Accepted — 2026-06-07
**Deciders:** Director, implementer
**Issue:** CRUD + RBAC program — Phase 1 foundation (`docs/plans/2026-06-07-crud-rbac-program.md`)

---

## Context

The app is becoming write-capable across every entity (full CRUD + RBAC + approval gating).
Today the three existing write surfaces each carry their **own duplicated role `Set`** to
cosmetically gate their affordances:

- `pages/ProcurementDetails.tsx` — `APPROVE_REJECT_ROLES` / `SOURCING_ROLES` / `RECEIPT_ROLES` /
  `INVOICE_PAY_ROLES` inside the `allowedActions` matrix.
- `components/ProjectStatusControl.tsx` — `WRITE_ROLES`.
- `pages/ProjectBudget.tsx` — `WRITE_ROLES`.

This duplication will not scale to ~11 entities × create/edit/archive/delete. Worse, every one
of these gates reads the **impersonated `effectiveRole`** (ADR-0008 client-side view-as), not the
**real JWT role**. That is a real, owner-reported divergence: an impersonating Admin viewing "as
Engineer" was shown gated buttons that the **server then rejected** (the RPC re-checks the real
`auth_role()` from the unchanged JWT), producing a "clicked but nothing happened" experience. The
FE affordance must match what the server will actually honor.

RLS / the security-definer RPCs remain the **enforcement authority** (plan §Architecture). This FE
gate is a *clarity* projection: hiding a button is never the security boundary; an unauthorized
write that slips through still fails at the DB and surfaces a classified toast
(`classifyMutationError`). The FE may be **stricter** than RLS (e.g. Finance excluded from project
create/edit) — RLS stays the authority.

## Decision

### (a) One pure policy function — `can(action, entity, ctx?)`

`pmo-portal/src/auth/policy.ts` exports a single pure predicate:

```ts
can(action: Action, entity: Entity, ctx?: PolicyContext): boolean
```

over `(realRole, action, entity, ctx)`. It encodes the RBAC matrix
(`docs/design/rbac-visibility.md` §K — the `can()` contract) and the locked owner/Director
decisions verbatim:

- `create` — Project: Admin·Exec·PM. Company: Admin·Exec·PM·Finance. Procurement: **all roles**
  (incl. Engineer). Task: Admin·Exec·PM. Incident: **all roles**. Document/procDoc:
  Admin·Exec·PM·Finance. User: Admin only.
- `edit` mirrors create per entity; `taskStatus` additionally allows the assignee Engineer
  (`ctx.record.assignee_id === ctx.currentUserId`).
- `archive` — Project/Company: Admin·Exec. Task: Admin·Exec·PM. (Procurement → Cancel, no archive.)
- `delete` (hard) — Project/Company/Document/Incident: **Admin only**; Task: Admin·Exec·PM.
- `editContractValue` (the contract_value SoD, ADR-0019) — **status-conditional**: a pre-win
  project is editable by Admin·Exec·PM; an already-**WON** project's value is editable only by
  **Executive·Finance** (segregation of duties; Admin is break-glass on a WON value).

`can()` is **pure** (no React, no I/O) so it is trivially unit-tested and reusable from
non-component code. It is deny-by-default: an unknown action/entity or a null role returns `false`.

### (b) The gate reads the REAL JWT role, never the impersonated `effectiveRole`

`pmo-portal/src/auth/impersonation.tsx` already tracks both roles (`realRole` is the true JWT role;
`effectiveRole` is the Admin-only client-side view-as). **Write affordances gate on `realRole`.**
`usePermission()` reads `realRole` from the impersonation context and binds it as `ctx.realRole`
into `can()`. Navigation visibility (`Rail`) continues to read `effectiveRole` (view-as is a
*viewing* feature, ADR-0008); only **write** affordances switch to `realRole`. This makes an
impersonating Admin see exactly the affordances the server will honor under their real role — the
divergence is closed.

### (c) The render-gate primitives — `usePermission()` + `<CanWrite>`

- `usePermission(): (action, entity, ctx?) => boolean` — a hook returning a `can`-bound-to-realRole
  predicate. Components call `const may = usePermission(); may('create', 'project')`.
- `<CanWrite action entity ctx? fallback?>` — a render wrapper that renders `children` only when
  permitted; an optional `fallback` renders a read-only / GateNotice variant. This is the single
  declarative affordance gate for the whole app.

### (d) The impersonation banner

A `<ImpersonationBanner>` component is shown (wired into the shell, below the top `ContextBar`)
**only when `effectiveRole !== realRole`**, reading: *"Viewing as {effectiveRole} — writes run as
your real role, {realRole}."* (ui-ux-pro-max `empty-nav-state`: explain, don't silently mislead.)
It uses DESIGN.md tokens only (a `warning`-tinted strip, AA-darkened text, an `eye` icon — no new
hue). When real === effective (the normal case, and for every non-Admin) it renders nothing.

### (e) Refactor the three existing call-sites onto the primitive — NO behavior change

- `ProjectStatusControl.tsx` — replace `WRITE_ROLES` with `can('transition', 'project')`, read via
  `usePermission()` on `realRole`. (The existing test already mocks `realRole === effectiveRole`.)
- `ProjectBudget.tsx` — replace `WRITE_ROLES` with `can('edit', 'budgetLine')`.
- `ProcurementDetails.tsx` — re-point `allowedActions` at `realRole` and route each role-set check
  through `can('transition'|'create', 'procurement'|…)`. **The matrix is byte-preserved** — the SoD
  identity predicates (`!isRequester`, `!isApprover`) and the legal-transition checks are
  unchanged; only the role-set membership is now expressed via `can()` on the real role.

The gating is identical for every (role × surface) combination; this is pure consolidation.

## Consequences

- **Single source of truth** for "who may write what" — adding an entity is one matrix entry, not a
  new role `Set` per page. The matrix is unit-tested exhaustively against `rbac-visibility.md`.
- **Closes the impersonation divergence:** FE affordances now match the server's real-JWT decision;
  the banner explains the Admin view-as state instead of silently misleading.
- **RLS/RPC remain the authority.** `can()` is documented and tested as a clarity projection, never
  the security boundary. The FE may be stricter than RLS by design (Finance on projects).
- **Test note:** `ProcurementDetails.test`'s impersonation mock is extended to return `realRole`
  (equal to its `effectiveRole`), mirroring the change already made to the `ProjectBudget` /
  `ProjectStatusControl` tests. No assertion or expected behavior changes — the production code now
  reads `realRole`, so the mock must supply it with the same value.
- **Scope guard:** `can()` covers actions the program needs now; entities/actions not yet built
  (incident, document, user, etc.) are encoded from the matrix so the per-entity slices consume a
  ready predicate, but no UI is added here beyond the banner + the three refactors.

## Alternatives considered

- **Keep per-page role `Set`s.** Rejected — does not scale to 11 entities and re-litigates the
  matrix in every file; the impersonation divergence would have to be fixed in each place.
- **Gate on `effectiveRole` and disable-with-reason on mismatch.** Rejected — the owner rule is a
  clean read-only surface, not a wall of disabled controls (`read-only-distinction`); and the
  server honors `realRole`, so gating on it is the truthful affordance.
- **A full RBAC library / CASL.** Rejected (YAGNI) — a single pure function over a small fixed
  matrix is simpler, dependency-free, and exactly testable.
