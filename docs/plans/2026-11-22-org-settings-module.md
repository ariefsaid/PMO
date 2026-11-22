# Plan — organisation switch module and one audit line per setting change (#2746)

Spec: `docs/specs/org-settings-module.spec.md` · Decision: `docs/adr/0121-organisation-settings-module.md` · Map: #1533

All paths are from the repo root. App commands run in `pmo-portal/`. DB commands run from the repo root under
`scripts/with-db-lock.sh`. No task needs `db reset` except slice 3 and the money slices (they add a migration).

## Design in one screen

```
pmo-portal/src/lib/repositories/orgSwitches.ts   ORG_SWITCHES registry + column adapter + orgSwitchRepository
pmo-portal/src/hooks/useOrgSwitch.ts             useOrgSwitch(key) · useSetOrgSwitch(key) · orgSwitchKey()
pmo-portal/src/components/admin/OrgSwitchSetting.tsx   the one switch card (slice 2)
supabase/migrations/1510_org_setting_audit.sql   audit_org_setting_change() + triggers (slice 3)
```

- Storage, gates, validation and error text stay where they are (ADR-0121). The registry entry points at the
  switch's existing repository pair, or at an `organizations` column for Admin-only column-grant switches.
- One query key family `['org-setting', orgId, key]`, one freshness policy `SERVER_SESSION_QUERY_OPTIONS`.
- A write calls the existing server write once, then invalidates the switch and its `refreshes` roots (which
  reproduce what each old mutation invalidated).

## Slices

| # | Slice | Changes stored data or server behaviour? | Visible change | Size | Ships |
|---|---|---|---|---|---|
| 1 | Module + hooks; six non-money switches read and written through it | No | None, except switches now refresh on focus / every 5 min | M (≈ 0.5 day) | batch PR |
| 2 | `<OrgSwitchSetting>` replaces the six switch controls | No | Yes: one switch card (owner screenshot glance before merge) | S | batch PR |
| 3 | One `org.setting.change` audit line per change, non-money settings | Adds audit rows on future changes only | Record history label | S | batch PR |
| 4 | Hide prices onto the module | No | Card becomes the switch card | S | alone (security review) |
| 5 | Line planning + purchase types onto the module | No | Cards become the switch card | S | batch PR |
| 6 | Labour cost + idle cost: module + audit (`1511`) | Audit rows only | Cards | S | alone (money) |
| 7 | Spend approval tiers: module + audit (`1512`) | Audit rows only | Card | S | alone (money) |
| 8 | Payment channels: module + audit (`1513`) | Audit rows only | Card | S | alone (money) |
| 9 | Billing plan and monthly equipment plan settings: audit only (`1514`, `1515`) | Audit rows only | None | S | alone each (money / SoD) |

Slices 1–3 are the first batch. Migration numbers reserved: `1510`–`1515`; `1516`–`1529` stay free for
follow-ups. Slice 3 and later need the ADR accepted.

Owning layer per AC: AC-OSM-001/002/003 unit (`useOrgSwitch.test.tsx`), AC-OSM-004/005 unit
(`OrgSwitchSetting.test.tsx`), AC-OSM-006/007 unit (`orgSwitches.test.ts`), AC-OSM-008 e2e (existing
`AC-BIR-001`, `AC-CLR-011`), AC-OSM-020/021 pgTAP (`1510_org_setting_audit.test.sql`), AC-OSM-022 unit
(`historyLabels.test.tsx`). Server writer roles per switch are already proved by: `1245_crew_loans`,
`2707_cleared_for_site`, `1202_profiles_built_in_role`, `1265_discipline_profit`, `safety_days`,
`1314_stock_wo_transfer_setting` (all under `supabase/tests/`).

---

## Slice 1 — the module, no visible change

Branch: `feat/2746-org-switch-module` off `origin/dev`, in its own worktree.

### Task 1.1 — failing registry test (AC-OSM-006, AC-OSM-007)

Create `pmo-portal/src/lib/repositories/orgSwitches.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { can } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';
import { ALL_ROLES } from '@/src/auth/coarseRoles';

const select = vi.fn();
const update = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: () => ({ select: (cols: string) => select(cols), update: (patch: unknown) => update(patch) }) },
}));

import { ORG_SWITCHES, orgSwitch, orgSwitchRepository, type OrgSwitchKey } from './orgSwitches';

const keys = Object.keys(ORG_SWITCHES) as OrgSwitchKey[];

describe('organisation switch registry (#2746)', () => {
  it.each(keys)('AC-OSM-006 can("manage") for %s allows exactly its declared writers', (key) => {
    const { manage, writers } = orgSwitch(key);
    const allowed = (ALL_ROLES as readonly Role[]).filter((realRole) => can('manage', manage, { realRole }));
    expect([...allowed].sort()).toEqual([...writers].sort());
  });

  // The server side of AC-OSM-006: each switch's writers equal its server write's gate. Every slice-1 switch is Admin-only
  // (set_org_crew_loans_enabled, the organizations Admin update policy, set_built_in_roles_enabled,
  // set_org_discipline_profit_enabled, set_safety_records_enabled, set_stock_wo_transfers), proved by the pgTAP files the plan lists.
  it('AC-OSM-006 every slice-1 switch is Admin-only, as its server write is', () => {
    for (const key of keys) expect(orgSwitch(key).writers).toEqual(['Admin']);
  });

  describe('column adapter', () => {
    beforeEach(() => { select.mockReset(); update.mockReset(); });

    it('AC-OSM-007 reads the column of the one visible organisation row', async () => {
      select.mockReturnValue({ limit: () => Promise.resolve({ data: [{ clearance_checklist_enabled: true }], error: null }) });
      await expect(orgSwitchRepository.read('clearance')).resolves.toBe(true);
      expect(select).toHaveBeenCalledWith('clearance_checklist_enabled');
    });

    it('AC-OSM-007 writes by that row id', async () => {
      select.mockReturnValue(Promise.resolve({ data: [{ id: 'org-1' }], error: null }));
      const eq = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ id: 'org-1' }], error: null }) }));
      update.mockReturnValue({ eq });
      await orgSwitchRepository.write('clearance', true);
      expect(update).toHaveBeenCalledWith({ clearance_checklist_enabled: true });
      expect(eq).toHaveBeenCalledWith('id', 'org-1');
    });

    it('AC-OSM-007 refuses when more than one organisation row is visible', async () => {
      select.mockReturnValue(Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }));
      await expect(orgSwitchRepository.write('clearance', true)).rejects.toMatchObject({ code: 'no-org' });
      expect(update).not.toHaveBeenCalled();
    });

    it('AC-OSM-007 a write RLS filtered to nothing is refused with 42501', async () => {
      select.mockReturnValue(Promise.resolve({ data: [{ id: 'org-1' }], error: null }));
      update.mockReturnValue({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) });
      await expect(orgSwitchRepository.write('clearance', true)).rejects.toMatchObject({ code: '42501' });
    });
  });
});
```

Verify (red: module missing): `cd pmo-portal && npx vitest run src/lib/repositories/orgSwitches.test.ts`

### Task 1.2 — the registry

Create `pmo-portal/src/lib/repositories/orgSwitches.ts`:

```ts
/**
 * Organisation switches (#2746, ADR-0121): the on/off organisation settings, one entry each. An entry says where the
 * value is read and written (the switch's existing server pair, or an `organizations` column written under its column
 * grant and the Admin update policy), which `can()` entity gates the card, the roles its server write accepts, and the
 * query roots that depend on it. Storage, gates and validation stay in the database: this is the one front-end seam.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Entity } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';
import { wrap } from './repositoryErrors';
import { crewLoanRepository } from './crews';
import { builtInRolesRepository } from './builtInRoles';
import { disciplineProfitRepository } from './disciplineProfit';
import { safetyDayRepository } from './safetyDays';
import { stockWorkOrderTransferRepository } from './stockWorkOrderTransfer';

// ponytail: a literal until database.types.ts is regenerated (typed-client ticket); then derive it from the organizations Row.
type OrgColumn = 'clearance_checklist_enabled';

export interface OrgSwitch {
  source: { read: () => Promise<boolean>; write: (on: boolean) => Promise<unknown> } | { column: OrgColumn };
  manage: Entity;
  writers: readonly Role[];
  /** Query roots refetched after a change (what the switch's old mutation refreshed). */
  refreshes?: readonly string[];
}

export const ORG_SWITCHES = {
  crewLoans: { source: { read: crewLoanRepository.enabled, write: crewLoanRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] },
  clearance: { source: { column: 'clearance_checklist_enabled' }, manage: 'clearanceItem', writers: ['Admin'], refreshes: ['clearance'] },
  builtInRoles: { source: { read: builtInRolesRepository.getEnabled, write: builtInRolesRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] },
  disciplineProfit: { source: { read: disciplineProfitRepository.isEnabled, write: disciplineProfitRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] },
  safetyRecords: { source: { read: safetyDayRepository.isEnabled, write: safetyDayRepository.setEnabled }, manage: 'safetyLists', writers: ['Admin'], refreshes: ['safety-days'] },
  stockWoTransfers: { source: { read: stockWorkOrderTransferRepository.enabled, write: stockWorkOrderTransferRepository.setEnabled }, manage: 'warehouse', writers: ['Admin'] },
} satisfies Record<string, OrgSwitch>;

export type OrgSwitchKey = keyof typeof ORG_SWITCHES;
export const orgSwitch = (key: OrgSwitchKey): OrgSwitch => ORG_SWITCHES[key];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped organizations access as db/clearance.ts until the types are regenerated
const organizations = (): any => supabase.from('organizations' as never);

async function readColumn(column: OrgColumn): Promise<boolean> {
  const { data, error } = await organizations().select(column).limit(1);
  if (error) throw new AppError(error.message, error.code);
  return data?.[0]?.[column] === true;
}

async function writeColumn(column: OrgColumn, on: boolean): Promise<void> {
  const { data: orgs, error: readError } = await organizations().select('id');
  if (readError) throw new AppError(readError.message, readError.code);
  const id = orgs?.[0]?.id;
  if (!id || orgs.length > 1) throw new AppError('No single organisation is readable for the current user', 'no-org');
  const { data, error } = await organizations().update({ [column]: on }).eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, 'You do not have permission to change this setting.');
}

export const orgSwitchRepository = {
  read: (key: OrgSwitchKey): Promise<boolean> => {
    const s = orgSwitch(key).source;
    return wrap(() => ('column' in s ? readColumn(s.column) : s.read()));
  },
  write: (key: OrgSwitchKey, on: boolean): Promise<void> => {
    const s = orgSwitch(key).source;
    return wrap(async () => { await ('column' in s ? writeColumn(s.column, on) : s.write(on)); });
  },
};
```

If `db/clearance.ts` carries no eslint-disable for its `any`, drop the comment line here too (match it).

Verify (green): `cd pmo-portal && npx vitest run src/lib/repositories/orgSwitches.test.ts`

### Task 1.3 — failing hook test (AC-OSM-001, AC-OSM-002, AC-OSM-003)

Create `pmo-portal/src/hooks/useOrgSwitch.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
const read = vi.fn();
const write = vi.fn();
vi.mock('@/src/lib/repositories/orgSwitches', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/repositories/orgSwitches')>()),
  orgSwitchRepository: { read: (k: string) => read(k), write: (k: string, on: boolean) => write(k, on) },
}));

import { useOrgSwitch, useSetOrgSwitch } from './useOrgSwitch';

const wrapper = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Reader() { const q = useOrgSwitch('crewLoans'); return <p>{q.data === undefined ? 'loading' : q.data ? 'on' : 'off'}</p>; }

describe('useOrgSwitch (#2746)', () => {
  beforeEach(() => { read.mockReset(); write.mockReset(); });

  it('AC-OSM-001 two readers of one switch share one server read', async () => {
    read.mockResolvedValue(true);
    const qc = client();
    render(<QueryClientProvider client={qc}><Reader /><Reader /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByText('on')).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('AC-OSM-002 a mounted switch re-reads when the window regains focus', async () => {
    read.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const qc = client();
    render(<QueryClientProvider client={qc}><Reader /></QueryClientProvider>);
    await screen.findByText('off');
    // staleTime is 5 minutes: make the cached value stale, then focus.
    act(() => { qc.getQueryCache().findAll().forEach((q) => q.setState({ dataUpdatedAt: 0 })); });
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await screen.findByText('on');
  });

  it('AC-OSM-003 a change writes once, re-reads the switch and refreshes its dependent queries', async () => {
    read.mockResolvedValue(false);
    write.mockResolvedValue(undefined);
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetOrgSwitch('clearance'), { wrapper: wrapper(qc) });
    await act(() => result.current.mutateAsync(true));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('clearance', true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org-setting', 'org-1', 'clearance'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['clearance'] });
  });
});
```

Verify (red): `cd pmo-portal && npx vitest run src/hooks/useOrgSwitch.test.tsx`

### Task 1.4 — the hooks

Create `pmo-portal/src/hooks/useOrgSwitch.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { orgSwitch, orgSwitchRepository, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';

/** Organisation switches (#2746, ADR-0121): one cached value per org and key, refreshed on focus and every 5 minutes. */
export const orgSwitchKey = (orgId: string | undefined, key: OrgSwitchKey) => ['org-setting', orgId, key] as const;

export function useOrgSwitch(key: OrgSwitchKey, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: orgSwitchKey(orgId, key),
    queryFn: () => orgSwitchRepository.read(key),
    enabled: enabled && Boolean(orgId),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
}

/** Calls the switch's own server write once; the server decides (ADR-0016). Then re-reads it and what depends on it. */
export function useSetOrgSwitch(key: OrgSwitchKey) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (on: boolean) => orgSwitchRepository.write(key, on),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: orgSwitchKey(orgId, key) }),
      ...(orgSwitch(key).refreshes ?? []).map((root) => qc.invalidateQueries({ queryKey: [root] })),
    ]),
  });
}
```

Verify (green): `cd pmo-portal && npx vitest run src/hooks/useOrgSwitch.test.tsx`

### Task 1.5 — clearance through the module

Edit, replacing `useClearanceEnabled()` with `useOrgSwitch('clearance')` and `useSetClearanceEnabled()` with
`useSetOrgSwitch('clearance')` (import from `@/src/hooks/useOrgSwitch`):
`pmo-portal/pages/Administration.tsx:431`, `pages/admin/ClearanceSetting.tsx:16-17`, `pages/admin/Clearance.tsx:151`,
`pages/admin/PersonClearance.tsx:58`, `pages/equipment/PersonDetail.tsx:17`.

Delete `useClearanceEnabled` and `useSetClearanceEnabled` from `src/hooks/useClearance.ts`; delete
`getClearanceEnabled`/`setClearanceEnabled` from `src/lib/db/clearance.ts`, `enabled`/`setEnabled` from
`src/lib/repositories/clearance.ts` and from `src/lib/repositories/contracts/clearance.ts`.

In tests that mocked the old hook (`pages/__tests__/Administration.hidePricesHold.test.tsx:21`, and any other
`grep -rln "useClearanceEnabled" pages src` lists), mock `@/src/hooks/useOrgSwitch` instead, returning the same
data; leave every assertion as it is.

Verify:
```
cd pmo-portal && npx vitest run src/lib/db/clearance.test.ts pages/admin/Clearance.bahasa.test.tsx pages/admin/PersonClearance.test.tsx pages/__tests__/Administration.hidePricesHold.test.tsx src/lib/repositories/orgSwitches.test.ts
grep -rn "useClearanceEnabled\|getClearanceEnabled" pages src   # expect no output
```

### Task 1.6 — crew loans through the module

`pages/crews/CrewLoans.tsx:85` → `useOrgSwitch('crewLoans')`. `pages/admin/OrgCrewLoans.tsx`: replace
`useCrewLoansEnabled()` with `useOrgSwitch('crewLoans')` and its local `useMutation` with `useSetOrgSwitch('crewLoans')`
(`mutation.mutate(next)`; drop the `setQueryData` and the `CREW_LOANS_ENABLED_KEY` import). Delete
`useCrewLoansEnabled` and `CREW_LOANS_ENABLED_KEY` from `src/hooks/useCrewLoans.ts`. Repository `enabled`/`setEnabled`
stay (the registry adapter). Update the mocks in `pages/crews/CrewLoans.test.tsx` and `pages/admin/OrgCrewLoans.test.tsx`
to `@/src/hooks/useOrgSwitch`, assertions unchanged.

Verify: `cd pmo-portal && npx vitest run pages/crews/CrewLoans.test.tsx pages/admin/OrgCrewLoans.test.tsx`

### Task 1.7 — built-in roles through the module

`pages/AdminUsers.tsx:60` → `useOrgSwitch('builtInRoles').data === true`. `pages/admin/OrgBuiltInRoles.tsx`: query →
`useOrgSwitch('builtInRoles')`; mutation → `useSetOrgSwitch('builtInRoles')` keeping its `onSuccess` toast and
`onError` handler as `mutate` options. Delete `useBuiltInRolesEnabled` and `BUILT_IN_ROLES_ENABLED_KEY` from
`src/hooks/useBuiltInRoles.ts` (keep the file's other exports). Update mocks in `pages/admin/OrgBuiltInRoles.test.tsx`
and any `AdminUsers` test that mocks the old hook.

Verify: `cd pmo-portal && npx vitest run pages/admin/OrgBuiltInRoles.test.tsx` then `grep -rn "useBuiltInRolesEnabled" pages src` (expect none).

### Task 1.8 — revenue per discipline through the module

`useDisciplineProfitEnabled(x)` → `useOrgSwitch('disciplineProfit', x)` in `pages/ManagementPackEarned.tsx:24`,
`pages/project-detail/DisciplineProfit.tsx:25`, `BoqDisciplinePicker.tsx:20`, `EarnedBilledProfit.tsx:25`, and
`pages/admin/OrgDisciplineProfit.tsx:17` (no argument). `useSetDisciplineProfitEnabled()` → `useSetOrgSwitch('disciplineProfit')`
in `OrgDisciplineProfit.tsx:18`. Delete both from `src/hooks/useDisciplineProfit.ts`. Update mocks in
`pages/ManagementPackEarned.test.tsx`, `pages/project-detail/__tests__/{BoqDisciplinePicker,EarnedBilledProfit,DisciplineProfit}.test.tsx`,
`pages/admin/OrgDisciplineProfit.test.tsx`.

Verify: `cd pmo-portal && npx vitest run pages/ManagementPackEarned.test.tsx pages/project-detail/__tests__/BoqDisciplinePicker.test.tsx pages/project-detail/__tests__/EarnedBilledProfit.test.tsx pages/project-detail/__tests__/DisciplineProfit.test.tsx pages/admin/OrgDisciplineProfit.test.tsx`

### Task 1.9 — safety records through the module

`useSafetyEnabled()` → `useOrgSwitch('safetyRecords')` in `pages/SafetySummary.tsx:34`,
`pages/work-order-detail/SafetySection.tsx:33`, `pages/admin/SafetyLists.tsx:75`. In `SafetyLists.tsx` the switch's
`m.setEnabled.mutateAsync(v)` → `const setOn = useSetOrgSwitch('safetyRecords')` and `setOn.mutateAsync(v)`, same toast.
Delete `useSafetyEnabled`, `safetyKeys.enabled` and the `setEnabled` mutation from `src/hooks/useSafetyDays.ts`; delete
their cases from `src/hooks/useSafetyDays.test.tsx` (moved to AC-OSM-003, which covers the `safety-days` refresh via
`refreshes`). Update mocks in `pages/SafetySummary.test.tsx`, `pages/work-order-detail/SafetySection.test.tsx`.

Verify: `cd pmo-portal && npx vitest run pages/SafetySummary.test.tsx pages/work-order-detail/SafetySection.test.tsx src/hooks/useSafetyDays.test.tsx`

### Task 1.10 — work-order stock transfers through the module

`useWoTransfersEnabled()` (returns a boolean) → `useOrgSwitch('stockWoTransfers').data === true` in
`pages/stock/StockDocuments.tsx:43`, `pages/stock/StockWorkOrderTransfer.tsx:26`, `pages/stock/StockWorkOrderTransferDetail.tsx:15`.
`src/components/stock/WoTransferToggle.tsx`: its `useQuery`/`useMutation` → `useOrgSwitch('stockWoTransfers')` /
`useSetOrgSwitch('stockWoTransfers')`, same `onError` text. Delete `useWoTransfersEnabled` from
`src/hooks/useStockWorkOrderTransfer.ts`. Update mocks in `pages/stock/StockWorkOrderTransfer.test.tsx`,
`pages/stock/StockDocuments.woTransfer.test.tsx`, `src/components/stock/WoTransferToggle.test.tsx`.

Verify: `cd pmo-portal && npx vitest run pages/stock/StockWorkOrderTransfer.test.tsx pages/stock/StockDocuments.woTransfer.test.tsx src/components/stock/WoTransferToggle.test.tsx`

### Task 1.11 — slice gate

```
cd pmo-portal
grep -rnE "use(Clearance|CrewLoans|BuiltInRoles|DisciplineProfit|Safety)Enabled|useWoTransfersEnabled|CREW_LOANS_ENABLED_KEY|BUILT_IN_ROLES_ENABLED_KEY|'stock-wo-transfers-enabled'|'discipline-profit-enabled'" pages src   # expect none
npm run check:guards && npm run typecheck
npx eslint --max-warnings=0 $(git diff --name-only origin/dev -- . | grep -E '\.(ts|tsx)$' | sed 's|^pmo-portal/||')
npx vitest run $(git diff --name-only origin/dev -- . | grep -E '\.test\.(ts|tsx)$' | sed 's|^pmo-portal/||')
node ../scripts/affected-e2e.mjs        # list only; slice 1 changes no screen
```
Every importer of the six deleted hooks is in the touched-test list (shared-module rule). Commit:
`refactor(settings): read and write six organisation switches through one module (#2746)`.

---

## Slice 2 — one switch card (visible; owner glance)

Same branch family: `feat/2746-org-switch-card` off slice 1.

### Task 2.1 — failing card test (AC-OSM-004, AC-OSM-005)

Create `pmo-portal/src/components/admin/OrgSwitchSetting.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let canManage = true;
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => canManage }));
const state = { data: false as boolean | undefined, isError: false };
const mutate = vi.fn();
const mutation = { mutate, reset: vi.fn(), isPending: false, isError: false, error: null as unknown };
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: () => ({ ...state, refetch: vi.fn() }),
  useSetOrgSwitch: () => mutation,
}));

import { OrgSwitchSetting } from './OrgSwitchSetting';

const card = () => render(<OrgSwitchSetting setting="stockWoTransfers" label="Transfer stock to work orders" helper="Helper text" />);

describe('OrgSwitchSetting (#2746)', () => {
  beforeEach(() => { canManage = true; state.data = false; mutate.mockReset(); mutation.isError = false; mutation.error = null; });

  it('AC-OSM-004 a refusal shows under the switch and the switch keeps the stored value', () => {
    mutation.isError = true;
    mutation.error = Object.assign(new Error('STK_OWNED_BY_ERP: the ERP owns stock for this organisation'), { code: 'P0001' });
    card();
    expect(screen.getByRole('switch', { name: 'Transfer stock to work orders' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/the ERP owns stock/)).toBeInTheDocument();
  });

  it('AC-OSM-004 an Admin flipping the switch sends the new value once', async () => {
    card();
    await userEvent.click(screen.getByRole('switch', { name: 'Transfer stock to work orders' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(true);
  });

  it('AC-OSM-005 a person who may not change it sees it disabled with who can, and sends nothing', async () => {
    canManage = false;
    card();
    const sw = screen.getByRole('switch', { name: 'Transfer stock to work orders' });
    expect(sw).toBeDisabled();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
    await userEvent.click(sw);
    expect(mutate).not.toHaveBeenCalled();
  });
});
```

If `classifyMutationError` maps this error to a headline without the message, assert on the headline it returns
instead (read `src/lib/classifyMutationError.ts` first); the oracle is "the refusal is visible under the switch".

Verify (red): `cd pmo-portal && npx vitest run src/components/admin/OrgSwitchSetting.test.tsx`

### Task 2.2 — the card

Create `pmo-portal/src/components/admin/OrgSwitchSetting.tsx`:

```tsx
import React, { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { orgSwitch, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';
import { useOrgSwitch, useSetOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { FieldError, ListState, Switch } from '@/src/components/ui';

interface Props {
  setting: OrgSwitchKey;
  label: string;
  helper: string;
  /** With a title the card is its own Administration section and keeps its existing anchor id. */
  title?: string;
  id?: string;
  /** Shown only while the switch is on (for example the built-in roles seat report). */
  children?: ReactNode;
}

/** One organisation switch (#2746, ADR-0121). UX only: the switch's own server write decides (ADR-0016). */
export function OrgSwitchSetting({ setting, label, helper, title, id, children }: Props) {
  const { t } = useTranslation('administration');
  const labelId = useId();
  const helperId = useId();
  const canManage = usePermission()('manage', orgSwitch(setting).manage);
  const q = useOrgSwitch(setting);
  const m = useSetOrgSwitch(setting);
  const err = m.isError ? classifyMutationError(m.error) : null;
  const body = q.isError ? <ListState variant="error" title={t('orgSwitch.loadError', "Couldn't load this setting")} onRetry={() => void q.refetch()} />
    : q.data === undefined ? <ListState variant="loading" rows={1} />
    : (
      <>
        <label className="flex min-h-11 items-start gap-3 py-1.5 text-control">
          <Switch checked={q.data} onChange={(next) => { m.reset(); m.mutate(next); }} labelledBy={labelId} describedBy={helperId}
            disabled={!canManage || m.isPending} className="mt-0.5" />
          <span className="min-w-0">
            <span id={labelId} className="block font-medium">{label}</span>
            <span id={helperId} className="block text-muted-foreground">{helper}</span>
          </span>
        </label>
        {!canManage && <p className="mt-2 text-control text-muted-foreground">{t('orgSwitch.adminOnly', 'Only an Admin can change this.')}</p>}
        {err && <FieldError>{err.detail || err.headline}</FieldError>}
        {q.data && children}
      </>
    );
  if (!title) return <div className="max-w-md">{body}</div>;
  return (
    <section id={id} tabIndex={-1} className="scroll-mt-4 mt-6" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-group font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 max-w-md">{body}</div>
    </section>
  );
}
```

Add to `pmo-portal/public/locales/en/administration.json` under the top level: `"orgSwitch": { "loadError":
"Couldn't load this setting", "adminOnly": "Only an Admin can change this." }`, and to `id/administration.json`:
`"orgSwitch": { "loadError": "Pengaturan ini tidak dapat dimuat", "adminOnly": "Hanya Admin yang dapat mengubah ini." }`.
Rebase the locale files on `origin/dev` right before the PR (#1070).

Verify (green): `cd pmo-portal && npx vitest run src/components/admin/OrgSwitchSetting.test.tsx`

### Task 2.3 — Administration cards become one line each

Replace each file's body with the card, keeping its existing i18n keys and anchor id:

- `pages/admin/OrgCrewLoans.tsx` → `<OrgSwitchSetting setting="crewLoans" id="org-crew-loans" title={t('admin.crewLoans.title', 'Crew loans')} label={t('admin.crewLoans.label', …)} helper={t('admin.crewLoans.helper', …)} />` (copy the two default strings verbatim from the current file).
- `pages/admin/ClearanceSetting.tsx` → same shape with its current title, label and helper keys and its section id.
- `pages/admin/OrgBuiltInRoles.tsx` → `setting="builtInRoles"`, `id="org-built-in-roles"`, title/helper from its keys, label `t('admin.builtInRoles.label', 'Offer built-in roles')` (new key, en + id `"Tawarkan peran bawaan"`), and `{canManage && <SeatReport />}` as children.
- `pages/admin/OrgDisciplineProfit.tsx` → `setting="disciplineProfit"` with its current title and helper keys; label = its current on-option text.

Each file's old test (`OrgCrewLoans.test.tsx`, `OrgBuiltInRoles.test.tsx`, `OrgDisciplineProfit.test.tsx`) is replaced by
one case per file: the card renders with that file's label as the switch's accessible name. Their toggle, refusal
and read-only cases are now AC-OSM-004/005; delete them in the same commit and say so in the commit body.

Verify: `cd pmo-portal && npx vitest run pages/admin/OrgCrewLoans.test.tsx pages/admin/OrgBuiltInRoles.test.tsx pages/admin/OrgDisciplineProfit.test.tsx pages/AdministrationShell.test.tsx`

### Task 2.4 — the two embedded switches

- `pages/admin/SafetyLists.tsx` lines 81-85: replace the `Switch` row with
  `<OrgSwitchSetting setting="safetyRecords" label={t('admin.enable', 'Record daily safety on work orders')} helper={t('admin.helper', …)} />`
  and drop the paragraph that repeated the helper above it.
- `src/components/stock/WoTransferToggle.tsx`: body becomes
  `<OrgSwitchSetting setting="stockWoTransfers" label={t('workOrderTransfer.setting')} helper={t('workOrderTransfer.settingHelp')} />`.
  Its test keeps one case (renders with that label); the rest is AC-OSM-004.

`SafetyLists` has no test file today; the switch row is covered by AC-OSM-004/005 and its page by `AdministrationShell.test.tsx`.

Verify: `cd pmo-portal && npx vitest run src/components/stock/WoTransferToggle.test.tsx pages/AdministrationShell.test.tsx`

### Task 2.5 — journeys and render proof (AC-OSM-008)

`e2e/serial/AC-BIR-001-built-in-roles-assignment.spec.ts:47-52`: the step changes from the button "Turn on built-in
roles" to `page.getByRole('switch', { name: 'Offer built-in roles' }).click()` and the check to
`toHaveAttribute('aria-checked', 'true')` (a deliberate UX change: the journey's goal oracle, a person holding the
role, stays). `AC-CLR-011` writes the column directly and needs no change; run it to confirm.

```
scripts/e2e-local.sh AC-BIR-001
scripts/e2e-local.sh AC-CLR-011
cd pmo-portal && node ../scripts/affected-e2e.mjs --run
scripts/ux-proof.sh /administration /stock/setup /administration/clearance
```

Send the `/administration` People and Projects sections and the stock transfer settings, before and after, at
actual size, to the owner (the card look changes; nothing moves). Merge only after that glance.

Gate as Task 1.11. Commit: `feat(settings): one switch card for the organisation switches (#2746)`.

---

## Slice 3 — one audit line per setting change (non-money)

Branch: `feat/2746-org-setting-audit` off `origin/dev`. DB work under `scripts/with-db-lock.sh`.

### Task 3.1 — failing pgTAP (AC-OSM-020, AC-OSM-021)

Create `supabase/tests/1510_org_setting_audit.test.sql`:

```sql
-- 1510_org_setting_audit.test.sql — #2746. Migration under test: 1510. AC-OSM-020/021: every organisation setting change writes one
-- org.setting.change event, whichever path wrote it; an unchanged write writes none.
-- Mutation check: drop 'crew_loans_enabled' from the organizations trigger arguments: the crew loans case goes red.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('27460000-0000-0000-0000-00000000000a', 'OSA Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('27460000-0000-0000-0000-0000000000a1', 'osa-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27460000-0000-0000-0000-0000000000a1', '27460000-0000-0000-0000-00000000000a', 'OSA Admin', 'osa-admin@example.com', 'Admin', 'active');
create function public.osa_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.osa_events(p_setting text) returns int language sql security definer as $$
  select count(*)::int from public.audit_events
   where action = 'org.setting.change' and org_id = '27460000-0000-0000-0000-00000000000a' and detail ->> 'setting' = p_setting $$;
create function public.osa_last(p_setting text) returns jsonb language sql security definer as $$
  select detail || jsonb_build_object('actor', actor_id) from public.audit_events
   where action = 'org.setting.change' and detail ->> 'setting' = p_setting order by created_at desc, id desc limit 1 $$;

select osa_as('27460000-0000-0000-0000-0000000000a1');

-- an RPC path
select set_org_crew_loans_enabled(true);
select is(osa_events('organizations.crew_loans_enabled'), 1, 'AC-OSM-020 a setter RPC change writes one event');
select is(osa_last('organizations.crew_loans_enabled'),
  jsonb_build_object('setting', 'organizations.crew_loans_enabled', 'from', false, 'to', true, 'actor', '27460000-0000-0000-0000-0000000000a1'),
  'AC-OSM-020 the event carries setting, from, to and the actor');
select set_org_crew_loans_enabled(true);
select is(osa_events('organizations.crew_loans_enabled'), 1, 'AC-OSM-021 an unchanged write writes no event');

-- the column-grant path
update organizations set clearance_checklist_enabled = true where id = '27460000-0000-0000-0000-00000000000a';
select is(osa_events('organizations.clearance_checklist_enabled'), 1, 'AC-OSM-020 a direct column write writes one event');
update organizations set attendance_target_rate = 92.5 where id = '27460000-0000-0000-0000-00000000000a';
select is(osa_last('organizations.attendance_target_rate') ->> 'to', '92.5', 'AC-OSM-020 a numeric setting records its new value');

-- a grouped setting writes one event per changed column
select set_leave_settings(true, 'Project Manager');
select is(osa_events('organizations.leave_requests_enabled') + osa_events('organizations.leave_approver_role'), 2,
  'AC-OSM-020 a two-column save writes one event per changed column');

-- a settings table (first save inserts the row)
select set_safety_records_enabled(true);
select is(osa_events('organizations.safety_records_enabled'), 1, 'AC-OSM-020 safety records');
select set_email_locale('id');
select is(osa_events('email_org_settings.locale'), 1, 'AC-OSM-020 a settings-table insert writes one event');
select set_email_locale('id');
select is(osa_events('email_org_settings.locale'), 1, 'AC-OSM-021 and an unchanged save writes none');

-- every column the trigger names exists (a renamed column fails here, not silently)
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where t.tgname = 'zz_audit_org_setting_change' and c.relnamespace = 'public'::regnamespace), 9,
  'AC-OSM-020 the audit trigger sits on organizations and the eight non-money settings tables');
select * from finish();
rollback;
```

Read `audit_events` columns (`supabase/migrations/0076_audit_events.sql`) before running; adjust `created_at`/`id`
ordering if the names differ. Run (red: function and triggers missing):
`scripts/with-db-lock.sh supabase test db supabase/tests/1510_org_setting_audit.test.sql`

### Task 3.2 — the migration

Create `supabase/migrations/1510_org_setting_audit.sql`:

```sql
-- 1510_org_setting_audit.sql — #2746 / ADR-0121: one org.setting.change audit event for every organisation setting change, whichever
-- path wrote it (a setter RPC, a column-grant update, a settings-table write). Setters that already write their own domain event keep
-- it; no function body is restated. The setting columns are the trigger arguments: a new setting adds its column name here.
-- Rollback: supabase/migrations/rollback/1510_org_setting_audit_down.sql

create function public.audit_org_setting_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  c text;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
  v_org uuid := coalesce((n ->> 'org_id')::uuid, (n ->> 'id')::uuid);
begin
  foreach c in array tg_argv loop
    if (o -> c) is distinct from (n -> c) then
      perform public.log_audit('org.setting.change', v_org, auth.uid(), v_org,
        jsonb_build_object('setting', tg_table_name || '.' || c, 'from', o -> c, 'to', n -> c)
          || case when n ? 'event_key' then jsonb_build_object('event_key', n -> 'event_key') else '{}'::jsonb end);
    end if;
  end loop;
  return new;
end; $$;
revoke all on function public.audit_org_setting_change() from public, anon, authenticated;

create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role', 'crew_loans_enabled',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate');

create trigger zz_audit_org_setting_change after insert or update on public.org_crew_tool_settings for each row
  execute function public.audit_org_setting_change('coordinator_id', 'task_due_days');
create trigger zz_audit_org_setting_change after insert or update on public.org_revenue_plan_settings for each row
  execute function public.audit_org_setting_change('enabled', 'working_weekdays');
create trigger zz_audit_org_setting_change after insert or update on public.work_order_stock_settings for each row
  execute function public.audit_org_setting_change('issue_progress_threshold_pct');
create trigger zz_audit_org_setting_change after insert or update on public.org_purchase_type_settings for each row
  execute function public.audit_org_setting_change('enabled');
create trigger zz_audit_org_setting_change after insert or update on public.issue_closing_report_settings for each row
  execute function public.audit_org_setting_change('enabled', 'grouping_mode');
create trigger zz_audit_org_setting_change after insert or update on public.purchase_order_settings for each row
  execute function public.audit_org_setting_change('print_enabled', 'signature_blocks', 'authorised_collectors');
create trigger zz_audit_org_setting_change after insert or update on public.email_org_settings for each row
  execute function public.audit_org_setting_change('locale');
create trigger zz_audit_org_setting_change after insert or update on public.email_event_settings for each row
  execute function public.audit_org_setting_change('enabled', 'extra_roles');
```

Create `supabase/migrations/rollback/1510_org_setting_audit_down.sql`:

```sql
-- Rollback of 1510_org_setting_audit.sql. Audit rows already written stay.
drop trigger if exists zz_audit_org_setting_change on public.organizations;
drop trigger if exists zz_audit_org_setting_change on public.org_crew_tool_settings;
drop trigger if exists zz_audit_org_setting_change on public.org_revenue_plan_settings;
drop trigger if exists zz_audit_org_setting_change on public.work_order_stock_settings;
drop trigger if exists zz_audit_org_setting_change on public.org_purchase_type_settings;
drop trigger if exists zz_audit_org_setting_change on public.issue_closing_report_settings;
drop trigger if exists zz_audit_org_setting_change on public.purchase_order_settings;
drop trigger if exists zz_audit_org_setting_change on public.email_org_settings;
drop trigger if exists zz_audit_org_setting_change on public.email_event_settings;
drop function if exists public.audit_org_setting_change();
```

Verify (green, one lock hold): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/1510_org_setting_audit.test.sql'`

### Task 3.3 — standing sweeps and the setters' own tests

The new function is a security definer: run the standing definer sweeps and every setter test the trigger now fires
under, in one lock hold:

```
scripts/with-db-lock.sh supabase test db supabase/tests/2711_light_account_boundary_sweep.test.sql supabase/tests/0173_rpc_active_member_gate.test.sql \
  supabase/tests/1245_crew_loans.test.sql supabase/tests/2707_cleared_for_site.test.sql supabase/tests/1202_profiles_built_in_role.test.sql \
  supabase/tests/1265_discipline_profit.test.sql supabase/tests/safety_days.test.sql supabase/tests/1314_stock_wo_transfer_setting.test.sql \
  supabase/tests/1215_hide_prices.test.sql
```

If a sweep lists `audit_org_setting_change`, add it to that sweep's allowlist with the reason "trigger function, not
executable by any API role", and re-run. A setter test that counts every `audit_events` row of the org (not by action)
now sees one more row: change its count to filter by its own action, which is what it means; say so in the commit.
Then the whole pgTAP suite once on the branch merged with `dev` (DB-branch rule):
`scripts/with-db-lock.sh supabase test db`.

### Task 3.4 — record history label (AC-OSM-022)

Add to `pmo-portal/src/components/history/__tests__/historyLabels.test.tsx`:

```tsx
it('AC-OSM-022 labels an organisation setting change', () => {
  expect(auditActionLabels(translate as never)['org.setting.change']).toBe('Organisation setting changed');
});
```

Add to `auditActionLabels` in `pmo-portal/src/components/history/historyLabels.ts`, after the
`org.down_payment_item.change` line:
`'org.setting.change': t('history.action.org_setting_change', 'Organisation setting changed'),`
and to `public/locales/en/common.json` / `id/common.json` under `history.action`:
`"org_setting_change": "Organisation setting changed"` / `"Pengaturan organisasi diubah"`.

Verify: `cd pmo-portal && npx vitest run src/components/history/__tests__/historyLabels.test.tsx`

Gate: Task 1.11's commands plus Task 3.3. Commit: `feat(audit): one audit line for every organisation setting change (#2746)`.

---

## Slice 4 — hide prices onto the module (ships alone; security review)

Files: `src/lib/repositories/orgSwitches.ts` (entry `hidePrices: { source: { read: hidePricesRepository.getEnabled, write: hidePricesRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] }`),
`src/hooks/useHidePrices.ts` (`useHidePricesEnabled` → `useOrgSwitch('hidePrices')`; the `usePriceVisibilitySync`
invalidation predicate must also skip `q.queryKey[0] === 'org-setting'`, or flipping the read path refetches every
switch), `pages/admin/OrgHidePrices.tsx` (→ `<OrgSwitchSetting setting="hidePrices" id="org-hide-prices" …/>`, its
saved toast dropped), `pages/__tests__/Administration.hidePricesHold.test.tsx` (mock moves to `useOrgSwitch`).
Freshness stays 5 minutes (the module's window), and now also refreshes on focus.
Tests: AC-OSM-006 covers the entry; `src/hooks/useHidePrices.test.tsx` gains "flipping the read path does not
refetch the organisation switches". Run `scripts/e2e-local.sh hide-prices` and every e2e `affected-e2e.mjs` lists.
Review: spec, quality and security (price visibility). Size S.

## Slice 5 — line planning and purchase types onto the module

Entries in `src/lib/repositories/orgSwitches.ts`:
`purchaseLinePlanning: { source: { read: getPurchaseLinePlanning, write: setPurchaseLinePlanning }, manage: 'orgAccounting', writers: ['Admin'], refreshes: ['org-purchase-line-categories'] }`
(imported from `@/src/lib/db/procurementLinePlanning`; the root is `LINE_CATEGORIES_KEY` in `src/hooks/usePurchaseLinePlanning.ts`)
and `purchaseTypes: { source: { read: purchaseTypeRepository.enabled, write: purchaseTypeRepository.setEnabled }, manage: 'purchaseType', writers: ['Admin'] }`
(the export name in `src/lib/repositories/purchaseTypes.ts`).
Readers move to `useOrgSwitch`: `pages/ProcurementCreate.tsx`, `pages/procurement/LinePlanningPanel.tsx`,
`pages/admin/OrgPurchaseLines.tsx`, `src/components/procurement/PurchaseTypeFields.tsx`, `pages/PurchaseTypeSettings.tsx`;
`useLinePlanningEnabled()` becomes `useOrgSwitch('purchaseLinePlanning').data === true` (a pending or failed read still
means off, as its comment requires) and is deleted with `LINE_PLANNING_KEY`; `usePurchaseTypesEnabled` is deleted. Only the switch row of each card
becomes `<OrgSwitchSetting>`; the category and type lists stay. First-turn-on seeding stays in the server write.
Tests: AC-OSM-006 gains both entries; the readers' existing tests with the mock moved. Size S.

## Slices 6–9 — money path, one at a time, each alone

Each money slice: (a) the registry entry and card swap where it is one on/off value, (b) its audit trigger migration,
(c) a pgTAP case in a new `supabase/tests/151N_<name>_setting_audit.test.sql` written like Task 3.1, (d) the full
review battery (security included), (e) its own PR to `dev`.

| Slice | Entry / card | Migration (audit trigger) | Notes |
|---|---|---|---|
| 6 | `labourCost` (`manage: 'labourCost'`, writers Admin + Finance) and `idleCost` (same); cards `LabourCostSettings.tsx` switch row, `IdleCostSwitch.tsx`. The idle card keeps its "needs labour cost" state by reading `useOrgSwitch('labourCost')`; the card's writers note becomes `t('orgSwitch.adminFinanceOnly', 'Only an Admin or Finance can change this.')`, chosen when `writers` includes Finance. Reads stay gated on `can('view', 'labourCost')` via `useOrgSwitch(key, canView)`. | `1511_labour_idle_setting_audit.sql`: triggers on `labour_cost_settings('enabled')`, `idle_cost_settings('enabled')` | first turn-on seeding stays in `save_labour_cost_settings` |
| 7 | `spendTiers: { source: { read: spendApprovalSettingsRepository.getTiersEnabled, write: spendApprovalSettingsRepository.setTiersEnabled }, manage: 'orgAccounting', writers: ['Admin'] }`; the switch row of `pages/admin/SpendApprovers.tsx` | `1512_spend_tiers_setting_audit.sql`: trigger on `spend_approval_settings('tiers_enabled')` | its own audit trigger stays |
| 8 | `paymentChannels: { source: { read: paymentChannelRepository.enabled, write: paymentChannelRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] }` (export name in `src/lib/repositories/paymentChannels.ts`); the switch row of `pages/admin/OrgPaymentChannels.tsx` | `1513_payment_channel_setting_audit.sql`: trigger on `org_payment_channel_settings('enabled')` | `enabled_at` stamping stays in the setter |
| 9 | none (grouped settings keep their forms) | `1514_billing_plan_setting_audit.sql` on `org_billing_plan_settings('monthly_target','target_currency','done_not_claimed_reminder_on')`; `1515_equipment_plan_setting_audit.sql` on `org_equipment_plan_settings('enabled','approval_step','allow_self_approval')` | the equipment plan one touches an approval rule: security review |

Each money migration gets its `rollback/151N_*_down.sql` (drop the one trigger). The AC-OSM-020 trigger-count case
in `1510_org_setting_audit.test.sql` counts only the non-money tables; each money test asserts its own trigger.

## Done (ticket #2746)

- A new Admin-only on/off setting is: a migration of three lines (column, `grant update`, its name in the 1510
  trigger arguments via `create or replace trigger` in that migration), one registry entry, one `<OrgSwitchSetting>`
  line, and its en + id strings.
- `docs/glossary.md` carries **organisation setting** and **organisation switch** (this branch).
- Roadmap #1571 / map #1533 updated when slice 3 ships; the private audit matrix's detail may then go public.
