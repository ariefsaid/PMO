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

import { useModuleOn } from './useOrgSwitch';
import { useRevenuePlanSettings } from './useWorkOrderRevenuePlan';
import { PERFORMANCE_SETTINGS_KEY, usePerformanceSettings } from './useWorkOrderPerformance';

const settingsSelection = 'performance_indices_enabled, performance_band_low, performance_band_high';
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    expect(qc.getQueryData([PERFORMANCE_SETTINGS_KEY, 'org-1'])).toBeUndefined();
  });

  it('reads the module once after the shell cache is ready', async () => {
    const qc = client();
    qc.setQueryData(['org-locale-defaults', 'org-1'], { default_timezone: 'Asia/Jakarta' });
    const { result } = renderHook(() => usePerformanceSettings(), { wrapper: wrapper(qc) });

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

    await waitFor(() => expect(result.current.data?.enabled).toBe(false));

    expect(qc.getQueryData([PERFORMANCE_SETTINGS_KEY, 'org-1'])).toMatchObject({ enabled: true });
  });

  it.each([true, false])('keeps a stored performance setting of %s when the module is on', async (enabled) => {
    supabaseStub.row.module_site_day = true;
    supabaseStub.row.performance_indices_enabled = enabled;
    const qc = client();
    qc.setQueryData(['org-locale-defaults', 'org-1'], { default_timezone: 'Asia/Jakarta' });
    const { result } = renderHook(() => usePerformanceSettings(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.data?.enabled).toBe(enabled));

    expect(qc.getQueryData([PERFORMANCE_SETTINGS_KEY, 'org-1'])).toMatchObject({ enabled });
  });

  it('keeps other module consumers active with the default enabled argument', async () => {
    const { result } = renderHook(() => useModuleOn('moduleStock'), { wrapper: wrapper(client()) });

    await waitFor(() => expect(result.current).toBe(true));

    expect(supabaseStub.selections).toEqual(['module_stock']);
  });

  it('keeps an existing feature-module settings consumer active by default', async () => {
    const { result } = renderHook(() => useRevenuePlanSettings(), { wrapper: wrapper(client()) });

    await waitFor(() => expect(result.current.data?.enabled).toBe(true));

    expect(supabaseStub.selections).toEqual(['module_billing_extras']);
    expect(revenueSettings).toHaveBeenCalledTimes(1);
  });
});
