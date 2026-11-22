import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/src/auth/AuthContext';

const supabaseStub = vi.hoisted(() => ({
  from: vi.fn(),
  row: {
    module_site_day: true,
    module_stock: true,
    module_billing_extras: true,
    performance_indices_enabled: true,
    performance_band_low: 0.9,
    performance_band_high: 1.1,
  },
  selections: [] as string[],
}));
const revenueSettings = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: supabaseStub.from } }));
vi.mock('@/src/lib/repositories/workOrderRevenuePlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories/workOrderRevenuePlan')>();
  return {
    ...actual,
    workOrderRevenuePlanRepository: { ...actual.workOrderRevenuePlanRepository, settings: () => revenueSettings() },
  };
});

import { orgSwitchKey, useModuleOn } from './useOrgSwitch';
import { useRevenuePlanSettings } from './useWorkOrderRevenuePlan';
import { PERFORMANCE_SETTINGS_KEY, usePerformanceSettings } from './useWorkOrderPerformance';
import type { OrgModuleKey } from '@/src/lib/repositories/orgSwitches';

const settingsSelection = 'performance_indices_enabled, performance_band_low, performance_band_high';
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const moduleData = (qc: QueryClient, module: OrgModuleKey) => qc.getQueryData<boolean>(orgSwitchKey('org-1', module));
const waitForModuleData = (qc: QueryClient, module: OrgModuleKey, expected: boolean) =>
  waitFor(() => expect(moduleData(qc, module)).toBe(expected));
const wrapper = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => (
  <AuthContext.Provider value={{ currentUser: { org_id: 'org-1' } } as never}>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  </AuthContext.Provider>
);

function organizationQuery() {
  const builder = {
    select(columns: string) {
      supabaseStub.selections.push(columns);
      return builder;
    },
    limit: () => builder,
    then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [{ ...supabaseStub.row }], error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

beforeEach(() => {
  supabaseStub.from.mockReset();
  supabaseStub.selections.length = 0;
  supabaseStub.row = {
    module_site_day: true,
    module_stock: true,
    module_billing_extras: true,
    performance_indices_enabled: true,
    performance_band_low: 0.9,
    performance_band_high: 1.1,
  };
  supabaseStub.from.mockImplementation((table: string) => {
    if (table !== 'organizations') throw new Error(`Unexpected table read: ${table}`);
    return organizationQuery();
  });
  revenueSettings.mockReset();
  revenueSettings.mockResolvedValue({ enabled: true, workingWeekdays: [1, 2, 3, 4, 5] });
});

describe('usePerformanceSettings shell prerequisite', () => {
  it('does not read the module or performance settings before the shell organization cache is ready', async () => {
    const qc = client();
    const { result } = renderHook(() => usePerformanceSettings(), { wrapper: wrapper(qc) });

    expect(result.current.data).toBeUndefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(supabaseStub.selections).toEqual([]);
    expect(moduleData(qc, 'moduleSiteDay')).toBeUndefined();
    expect(qc.getQueryData([PERFORMANCE_SETTINGS_KEY, 'org-1'])).toBeUndefined();
  });

  it('enables module and performance reads when the shell cache becomes ready while mounted', async () => {
    const qc = client();
    const { result } = renderHook(() => usePerformanceSettings(), { wrapper: wrapper(qc) });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(supabaseStub.selections).toEqual([]);
    expect(moduleData(qc, 'moduleSiteDay')).toBeUndefined();

    act(() => qc.setQueryData(['org-locale-defaults', 'org-1'], { default_timezone: 'Asia/Jakarta' }));

    await waitForModuleData(qc, 'moduleSiteDay', true);
    await waitFor(() => expect(result.current.data?.enabled).toBe(true));

    expect(supabaseStub.selections.filter((selection) => selection === 'module_site_day')).toHaveLength(1);
    expect(supabaseStub.selections.filter((selection) => selection === settingsSelection)).toHaveLength(1);
  });

  it('masks a stored on performance setting when the module is off without changing the stored setting', async () => {
    supabaseStub.row.module_site_day = false;
    supabaseStub.row.performance_indices_enabled = true;
    const qc = client();
    qc.setQueryData(['org-locale-defaults', 'org-1'], { default_timezone: 'Asia/Jakarta' });
    const { result } = renderHook(() => usePerformanceSettings(), { wrapper: wrapper(qc) });

    await waitForModuleData(qc, 'moduleSiteDay', false);
    await waitFor(() => expect(result.current.data?.enabled).toBe(false));

    expect(qc.getQueryData([PERFORMANCE_SETTINGS_KEY, 'org-1'])).toMatchObject({ enabled: true });
  });

  it.each([true, false])('keeps a stored performance setting of %s when the module is on', async (enabled) => {
    supabaseStub.row.module_site_day = true;
    supabaseStub.row.performance_indices_enabled = enabled;
    const qc = client();
    qc.setQueryData(['org-locale-defaults', 'org-1'], { default_timezone: 'Asia/Jakarta' });
    const { result } = renderHook(() => usePerformanceSettings(), { wrapper: wrapper(qc) });

    await waitForModuleData(qc, 'moduleSiteDay', true);
    await waitFor(() => expect(result.current.data?.enabled).toBe(enabled));

    expect(qc.getQueryData([PERFORMANCE_SETTINGS_KEY, 'org-1'])).toMatchObject({ enabled });
  });

  it('queries by default and reflects an off server value for a direct module consumer', async () => {
    supabaseStub.row.module_stock = false;
    const qc = client();
    const { result } = renderHook(() => useModuleOn('moduleStock'), { wrapper: wrapper(qc) });

    await waitForModuleData(qc, 'moduleStock', false);
    await waitFor(() => expect(result.current).toBe(false));

    expect(supabaseStub.selections).toEqual(['module_stock']);
  });

  it('keeps the existing feature-module settings consumer enabled by default and waits for its module', async () => {
    supabaseStub.row.module_billing_extras = false;
    const qc = client();
    const { result } = renderHook(() => useRevenuePlanSettings(), { wrapper: wrapper(qc) });

    await waitForModuleData(qc, 'moduleBillingExtras', false);
    await waitFor(() => expect(result.current.data?.enabled).toBe(false));

    expect(supabaseStub.selections).toEqual(['module_billing_extras']);
    expect(revenueSettings).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(['revenue-plan-settings', 'org-1'])).toMatchObject({ enabled: true });
  });
});
