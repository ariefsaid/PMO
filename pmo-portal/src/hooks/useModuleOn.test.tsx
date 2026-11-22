import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { ModuleGate } from '@/src/components/admin/ModuleGate';

// The module switches (#2746): stored values per key; a module off hides its features, UI only.
const stored: Record<string, boolean> = {};
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/orgSwitches', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/repositories/orgSwitches')>()),
  orgSwitchRepository: { read: (k: string) => Promise.resolve(stored[k] ?? true), write: vi.fn() },
}));
const leaveSettings = vi.fn();
vi.mock('@/src/lib/repositories/leave', () => ({ leaveRepository: { settings: () => leaveSettings(), types: vi.fn(), visible: vi.fn(), onDate: vi.fn() } }));

import { ORG_MODULES, ORG_SWITCHES, type OrgModuleKey, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';
import { useModuleOn, useOrgSwitch } from './useOrgSwitch';
import { useLeaveEnabled } from './useLeave';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client()}><AuthContext.Provider value={{ currentUser: { org_id: 'org-1' } } as never}>{children}</AuthContext.Provider></QueryClientProvider>
);

beforeEach(() => { for (const k of Object.keys(stored)) delete stored[k]; leaveSettings.mockReset(); });

describe('useModuleOn (#2746)', () => {
  it('counts a module as on while its read is loading, so a page does not flash empty', () => {
    const { result } = renderHook(() => useModuleOn('moduleStock'), { wrapper: wrap });
    expect(result.current).toBe(true);
  });

  it.each(ORG_MODULES)('reads %s off once the server says off', async (module) => {
    stored[module] = false;
    const { result } = renderHook(() => useModuleOn(module), { wrapper: wrap });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('makes no request and counts as on outside a session (shared chrome renders there)', () => {
    const { result } = renderHook(() => useModuleOn('modulePeopleCrews'));
    expect(result.current).toBe(true);
  });
});

describe('ModuleGate: the one check an Admin list or panel sits behind', () => {
  it.each(ORG_MODULES)('hides its children while %s is off and shows them while it is on', async (module: OrgModuleKey) => {
    stored[module] = false;
    const off = render(<ModuleGate module={module}><p>panel</p></ModuleGate>, { wrapper: wrap });
    await waitFor(() => expect(screen.queryByText('panel')).toBeNull());
    off.unmount();
    stored[module] = true;
    render(<ModuleGate module={module}><p>panel</p></ModuleGate>, { wrapper: wrap });
    expect(await screen.findByText('panel')).toBeInTheDocument();
  });
});

describe('a feature in a module reads off while its module is off (the stored value is untouched)', () => {
  const inModule = (Object.keys(ORG_SWITCHES) as OrgSwitchKey[]).filter((k) => 'module' in ORG_SWITCHES[k]);
  const moduleOf = (k: OrgSwitchKey): OrgModuleKey => (ORG_SWITCHES[k] as { module: OrgModuleKey }).module;

  it('covers the six registry switches that live in a module', () => {
    expect(inModule.sort()).toEqual(['builtInRoles', 'clearance', 'crewLoans', 'disciplineProfit', 'safetyRecords', 'stockWoTransfers']);
  });

  it.each(inModule)('%s: stored on, module on reads on; module off reads off', async (key) => {
    const module = moduleOf(key);
    stored[key] = true;
    const on = renderHook(() => useOrgSwitch(key), { wrapper: wrap });
    await waitFor(() => expect(on.result.current.data).toBe(true));
    on.unmount();
    stored[module] = false;
    const off = renderHook(() => useOrgSwitch(key), { wrapper: wrap });
    await waitFor(() => expect(off.result.current.data).toBe(false));
  });

  it('the leave navigation entry: leave stored on, People and crews off, hides it', async () => {
    leaveSettings.mockResolvedValue({ enabled: true, approver_role: null });
    const on = renderHook(() => useLeaveEnabled(), { wrapper: wrap });
    await waitFor(() => expect(on.result.current).toBe(true));
    on.unmount();
    stored.modulePeopleCrews = false;
    const off = renderHook(() => useLeaveEnabled(), { wrapper: wrap });
    await waitFor(() => expect(leaveSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(off.result.current).toBe(false));
  });
});
