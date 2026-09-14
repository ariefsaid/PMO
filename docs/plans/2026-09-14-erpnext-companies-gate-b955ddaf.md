# Plan — Gate the ERPNext companies query on an active binding (#639)

- **Issue:** #639 — Administration fires the ERPNext company list for every org, binding or not
- **Worktree:** `.claude/worktrees/639-erpnext-companies-gate` (branch → PR to `dev`)
- **Scope:** ONE hook file + ONE test file. No UI changes, no deps, no refactor, nothing under `adws/`.
- **Executor gates (from `pmo-portal/`):** `npm run typecheck` · `npm run lint:ci` · `npm test` — all green, zero warnings.

## 1. Defect

`pmo-portal/src/hooks/useIntegrations.ts` (lines 62–67): the `erpnext-companies` React Query is
`enabled: Boolean(orgId)`, so every org — including every org **without** an ERPNext binding — invokes
the `external-companies` edge function on each Administration visit. With no stored credential the
edge fn fails and the ERPNext card renders its error state (observed live on the hosted project, #622 walk).

Its sibling query in the same hook (lines 46–55, AC-449-1 / issue #449) already solved this for
ClickUp: `enabled: Boolean(orgId) && getBinding('clickup')?.status === 'active'`. This change applies
the identical gate to the ERPNext query.

## 2. Design

**The change (one line + comment):** gate `enabled` on the active ERPNext binding, exactly mirroring
the AC-449-1 ClickUp pattern 12 lines above it. While bindings load, the gate is closed; it opens the
moment the binding resolves `status:'active'`.

**Why this is safe for the "Select Company" picker (`IntegrationsView.tsx`):** the picker is shown
only when `isConnectedButNotActivated` — i.e. the org **has** an erpnext binding with
`status:'active'` but no `config.company` yet (connect writes `status:'active'`; company activation
only fills `config.company`). So at the only moment the picker is visible, the gate is open and the
query still feeds it. `IntegrationsView` and its tests are NOT touched (they mock the hook wholesale —
`IntegrationsView.test.tsx` ~line 757 supplies `erpnextCompanies` directly — so no component-test churn).

**Blast radius (verified):** `useIntegrations()` has exactly two consumers —
`components/projects/ProjectIntegrationsCard.tsx` (ClickUp paths only, does not read
`erpnextCompanies`) and `components/integrations/IntegrationsView.tsx` (covered above).

**No ADR:** this mirrors an existing in-repo ruling (AC-449-1), not a new architectural decision.

## 3. Traceability

| AC | Requirement | Owning layer | Owning test |
|---|---|---|---|
| AC-639-1 | The hook does not fetch ERPNext companies unless the org's erpnext binding is `active`; it does fetch when it is | Unit (Vitest/RTL, mocked repo) | `src/hooks/useIntegrations.test.tsx` — `it('AC-639-1: does not fetch ERPNext companies when the org has no active ERPNext binding', …)` + the existing-behaviour-guard `it` below it |

## 4. Tasks

### Task 1 — RED: add the `listCompanies` mock stub and the two AC-639-1 tests

**File:** `pmo-portal/src/hooks/useIntegrations.test.tsx`

**1a.** The hoisted `integrations` mock object (top of file, inside `vi.hoisted`) currently has no
`listCompanies` entry — add one after `listProjectBindings: vi.fn(),`:

```ts
const { integrations } = vi.hoisted(() => ({
  integrations: {
    getBinding: vi.fn(),
    listBindings: vi.fn(),
    connectIntegration: vi.fn(),
    disconnectIntegration: vi.fn(),
    getIntegrationHealth: vi.fn(),
    listProjectLists: vi.fn(),
    linkProject: vi.fn(),
    unlinkProject: vi.fn(),
    listProjectBindings: vi.fn(),
    listCompanies: vi.fn(),
  },
}));
```

**1b.** In `beforeEach`, add the resolve value alongside the others (mirrors how
`IntegrationsView.test.tsx` seeds `erpnextCompanies: [{ name: 'Acme Corp' }, …]`):

```ts
  integrations.listCompanies.mockResolvedValue([{ name: 'Acme Corp' }]);
```

**1c.** At the bottom of the `describe('useIntegrations', …)` block, directly after the second
`AC-449-1` test, add the new section — modelled on those two tests:

```tsx
  // --- Issue #639: gate the ERPNext companies fetch on the ACTIVE org binding ---

  it('AC-639-1: does not fetch ERPNext companies when the org has no active ERPNext binding', async () => {
    // beforeEach default: bindings = [mockBinding] (clickup only) — no erpnext row at all.
    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Flush one cycle so a wrongly-enabled query would have fired by now (the red state).
    await act(async () => { await Promise.resolve(); });

    expect(integrations.listCompanies).not.toHaveBeenCalled();
  });

  it('AC-639-1: fetches ERPNext companies when an active ERPNext binding is present (existing-behaviour guard)', async () => {
    integrations.listBindings.mockResolvedValue([{ ...mockBinding, external_tier: 'erpnext' }]);

    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });

    await waitFor(() => expect(integrations.listCompanies).toHaveBeenCalledWith('org-1', 'erpnext'));
  });
```

**Verify (expect RED on exactly the first new test; everything else green):**

```bash
cd pmo-portal && npx vitest run src/hooks/useIntegrations.test.tsx
```

The first new test fails because the shipped hook still runs the query for any `orgId` (that red IS
the mutation check — the test binds to the shipped behaviour). The guard test passes (existing
behaviour). If the first test is green before the edit, STOP: it isn't binding to the real hook.

### Task 2 — GREEN: gate the query in the hook

**File:** `pmo-portal/src/hooks/useIntegrations.ts` — replace the ERPNext companies query block
(lines 62–67) with (only the comment + `enabled` line change; the destructure and queryKey stay put):

```ts
  // Query: list ERPNext companies for the org (OD-INT-6)
  // AC-639-1 (issue #639): gate on the ACTIVE org ERPNext binding, mirroring the ClickUp lists
  // query above — the external-companies edge fn needs the org credential, so firing it with no
  // binding always fails and rendered the Administration card's error state for every new org.
  const { data: erpnextCompanies = [], isPending: isCompaniesPending, isError: isCompaniesError, error: companiesError, refetch: refetchCompanies } = useQuery<Array<{ name: string }>>({
    queryKey: ['integrations', 'erpnext-companies', orgId],
    queryFn: () => repositories.integrations.listCompanies(orgId!, 'erpnext'),
    enabled: Boolean(orgId) && getBinding('erpnext')?.status === 'active',
  });
```

**Verify (all green):**

```bash
cd pmo-portal && npx vitest run src/hooks/useIntegrations.test.tsx
```

### Task 3 — Full gates

From `pmo-portal/`:

```bash
npm run typecheck && npm run lint:ci && npm test
```

All three must be green with zero warnings. Never weaken, skip, or delete a test to get green. If the
vitest suite hits unrelated timeouts on this shared machine, re-run under
`scripts/with-test-lock.sh` before diagnosing (contention, not regression). Targeted runs above are
inner-loop only — this full gate is the phase transition.

## 5. Constraints & out-of-scope (binding)

- Do NOT touch `IntegrationsView.tsx` / `IntegrationsView.test.tsx`, anything under `adws/`, or any
  migration/edge function. No new dependencies. No hook refactor.
- No rendered/browser self-check (hook-only, no visual change); this worktree has no `.env.local` —
  do NOT start the dev server.
- Code commit subject prefix:
  `fix(integrations): gate the ERPNext company query on an active binding (#639)`
- PR → `dev`, one per issue; full gate must be green before the PR.
