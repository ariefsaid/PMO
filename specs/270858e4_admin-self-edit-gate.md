# Plan — UX-gate the self-edit affordances on AdminUsers (own-row role + manager)

## Context / Why
Migration `supabase/migrations/0179_profiles_hierarchy_write.sql` (ADR-0070) narrowed
`profiles_admin_write` so an Admin may **never** edit their own `role` or `manager_id` — the
policy no longer matches the caller's own row (verified in the migration header: an Admin JWT
`update profiles set role=… where id=<self>` used to return `UPDATE 1`; now it is denied). The FE
on `pmo-portal/pages/AdminUsers.tsx` still renders the per-row **"Edit role"** and
**"Change manager"** menu items ACTIVE on the signed-in caller's own row, so a self-edit dies at
the DB with a **42501** and surfaces a classified error toast — a dead affordance. Per ADR-0016,
FE affordance gating is **UX-only and may be stricter than RLS**; RLS stays the enforcement
authority. We gate the two self-edit affordances on the own-row so the control never offers a
write the server will refuse.

## Scope fence (binding)
- **CHANGE ONLY:** `pmo-portal/pages/AdminUsers.tsx` **plus ONE new test**
  `pmo-portal/pages/__tests__/AdminUsers.selfedit.test.tsx`.
- **DO NOT TOUCH:** shared components (`src/components/ui/*`, including `DataTable.tsx` /
  `RowMenuItem`), `src/auth/policy.ts`, other pages, e2e specs, migrations, or anything under
  `adws/` or `supabase/`.
- **Never weaken or delete an existing test.** Verified non-conflict: the existing role/manager
  cases in `pmo-portal/pages/AdminUsers.test.tsx` operate on OTHER users' rows — Desmond Achebe
  (`u2`) and Tobias Lindqvist (`u4`) — **never the self-row** (Renata Halloway, `u1`, who is the
  signed-in `currentUser` in that suite). The self-disable cases in
  `pages/__tests__/AdminUsers.disable.test.tsx` use the **Disable** item (left untouched here).
  So this change keeps every existing test green.

## Decision: hide (omit), not "disabled with title"
`RowMenuItem` is exactly `{ label: string; onClick: () => void; danger?: boolean }` — there is
**no `disabled`/`title` field** (`pmo-portal/src/components/ui/DataTable.tsx:41`). Adding one
means editing the shared `DataTable` component, which is **out of scope**. The page's own
convention for an unavailable action is to **omit** it (see the `rowMenu` prop docstring in
`DataTable.tsx`: *"Return `undefined` (or `[]`) for 'no menu for this row'"*) — there is no
"disabled menu item" pattern anywhere in the page. So on the caller's own row we **omit** the two
self-edit items. The own-row menu is **not** emptied: **Disable/Re-enable** stays (it runs through
the `admin_set_user_status` RPC with its caller-agnostic sole-/self-Admin lockout guard — a
separate authority), so the "Row actions" trigger on the own-row still has a meaningful item.

## The change

### 1. `pmo-portal/pages/AdminUsers.tsx` — the `rowMenu` builder (≈ lines 233–249)
`currentUser` is **already destructured** near the top of the component:
`const { currentUser } = useAuth();` (the page already uses `ownOrgId = currentUser?.org_id ?? ''`
a few lines down). `currentUser: Profile | null`; `Profile.id` is the profiles PK that matches
`UserRow.id`. Add an `isSelf` guard and gate the two items. **No new imports, no other edits.**

**Before:**
```tsx
const rowMenu = (u: UserRow): RowMenuItem[] => {
  const items: RowMenuItem[] = [];
  if (canManage) {
    items.push(
      { label: 'Edit role', onClick: () => setEditTarget({ mode: 'role', user: u }) },
      { label: 'Change manager', onClick: () => setEditTarget({ mode: 'manager', user: u }) },
    );
  }
  if (canDisable) {
```

**After:**
```tsx
const rowMenu = (u: UserRow): RowMenuItem[] => {
  const items: RowMenuItem[] = [];
  // Migration 0179 (ADR-0070): an Admin may NOT edit their own role/manager_id —
  // profiles_admin_write no longer matches the caller's own row, so a self-edit dies at the DB
  // with a 42501. Omit the two self-edit items on the caller's own row (this page's convention
  // for an unavailable action is omission; RowMenuItem has no disabled/title field and DataTable
  // is a shared component outside this slice). Disable/Re-enable stays — it runs through the
  // caller-agnostic admin_set_user_status RPC, a separate authority. RLS remains the enforcement
  // authority; this is UX-only gating (ADR-0016).
  const isSelf = !!currentUser?.id && currentUser.id === u.id;
  if (canManage && !isSelf) {
    items.push(
      { label: 'Edit role', onClick: () => setEditTarget({ mode: 'role', user: u }) },
      { label: 'Change manager', onClick: () => setEditTarget({ mode: 'manager', user: u }) },
    );
  }
  if (canDisable) {
```

Completeness note: `setEditTarget({ mode: 'role' | 'manager', … })` — the **only** entry point to
the `RoleFormModal` / `ManagerFormModal` — is invoked exclusively from these two `rowMenu` items,
so gating them fully gates the affordance (no other code path opens those modals).

### 2. NEW test `pmo-portal/pages/__tests__/AdminUsers.selfedit.test.tsx` (write FIRST → RED)
Mirror the scaffold of `pages/__tests__/AdminUsers.disable.test.tsx` exactly — same six module
mocks (`useUsers`, `useAuth`, `useIsOperator`, `useUsage`, `useOrgFeatures`, `repositories`), the
same `LockoutError`-free seed, and the same `renderPage` providers
(`QueryClientProvider` → `ImpersonationProvider realRole="Admin"` → `MemoryRouter` →
`ToastProvider` → `<AdminUsers/>`). `ImpersonationProvider realRole="Admin"` makes
`canManage = may('edit','user')` true, so the role/manager items DO render on non-self rows (the
behavior under test).

**Seed:** `{ id:'self-admin', full_name:'Sole Admin', email:'admin@example.com', role:'Admin', manager_id:null, org_id:'org-1', status:'active' }`
and `{ id:'eng-1', full_name:'Engineer One', email:'eng@example.com', role:'Engineer', manager_id:null, org_id:'org-1', status:'active' }`.
**`useAuth` mock:** `useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' })`
(so `currentUser.id === 'self-admin'` identifies the own-row).

Row-menu open pattern (copy the disable-test idiom): find the row by name, get its closest `tr`
(or `div` for the card branch), and click `within(row).getByRole('button', { name: /Row actions/i })`.
Menuitems are portaled, but `screen` queries `document.body`, so
`screen.queryByRole('menuitem', { name: … })` reaches them (the disable test relies on this).

**Two `it` cases:**
- **(a) own-row — the fix:** open the **Sole Admin** (self) row's "Row actions" menu, then
  - `expect(await screen.findByRole('menuitem', { name: /disable/i })).toBeInTheDocument()` —
    proves the menu actually opened (the user is active, so Disable is the expected remaining
    item; a null on the next two lines must NOT be explainable by "menu never opened").
  - `expect(screen.queryByRole('menuitem', { name: /edit role/i })).not.toBeInTheDocument()`
  - `expect(screen.queryByRole('menuitem', { name: /change manager/i })).not.toBeInTheDocument()`
- **(b) other-row unaffected:** open the **Engineer One** (`eng-1`) row's menu, then
  - `expect(await screen.findByRole('menuitem', { name: /edit role/i })).toBeInTheDocument()`
  - `expect(await screen.findByRole('menuitem', { name: /change manager/i })).toBeInTheDocument()`

**Binding mutation-check (the test must catch a broken gate):** temporarily remove the `!isSelf`
guard (or force `const isSelf = false`) and case (a) MUST go RED (the two items reappear on the
own-row). A suite that stays green while the guard is broken is not a suite.

## TDD order (binding — red, then green, then full suite)
1. **Write `AdminUsers.selfedit.test.tsx`** → `npm test -- AdminUsers.selfedit` → **RED** (case a
   fails: the two items are still present on the own-row because `rowMenu` is unchanged).
2. **Apply the `rowMenu` change** in `AdminUsers.tsx` → `npm test -- AdminUsers.selfedit` → **GREEN**.
3. `npm run typecheck` → **0 errors**.
4. **Full gate (binding — the WHOLE suite, not just touched files):** from `pmo-portal/` run
   `npm run verify` (= `check:migrations && check:e2e-isolation && check:edge-test-binding &&
   typecheck && typecheck:edge && lint:ci && test && build`) → **GREEN**. This confirms the
   existing `AdminUsers.test.tsx` role/manager cases (Desmond u2 / Tobias u4 — non-self) and
   `AdminUsers.disable.test.tsx` stay green, and nothing else regressed.

## Verify commands (all run from `pmo-portal/`)
- `npm test -- AdminUsers.selfedit` — new spec, red→green (inner loop only).
- `npm test -- AdminUsers` — every AdminUsers unit spec green.
- `npm run typecheck` — 0 errors.
- `npm run verify` — the binding pre-push gate (full 8-gate suite). **Required before any phase
  transition / push.**

## Out of scope / watch-items (no action needed — listed so the builder doesn't re-derive)
- The e2e `pmo-portal/e2e/serial/AC-AU-001-admin-users-crud.spec.ts` exercises role/manager edits
  on a **non-self** row (a signed-in admin editing another seeded user) → **unaffected** by this
  change; do **not** modify it (scope fence). It should remain green under `npm run verify`.
- Operator path: `isSelf = currentUser?.id === u.id` is role-agnostic, so it is correct for an
  Operator too (an Operator signed in via a non-Admin profile still cannot self-edit role/manager
  under 0179). No special-casing required.
- This is **UX-only** gating; the RLS in 0179 is the enforcement authority. **No migration or DB
  change** — migration 0179 is already shipped.
