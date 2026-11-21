import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  lines: vi.fn(), openReports: vi.fn(), photos: vi.fn(), settings: vi.fn(),
  addLine: vi.fn(), updateLine: vi.fn(), report: vi.fn(), correct: vi.fn(), close: vi.fn(), setSettings: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/crewTools', () => ({ crewToolRepository: h }));
import { CREW_TOOL_QUERY_ROOTS, useOpenToolReports, useToolLines, useToolMutations, useToolSettings } from './useCrewTools';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue(null); });

it('lines, open reports and settings wait for the crew (settings only for the org)', async () => {
  const idle = renderHook(() => useToolLines(null), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.lines.mockResolvedValue([{ id: 'l1', name: 'Hammer' }]);
  const lines = renderHook(() => useToolLines('c1'), { wrapper: wrapper() });
  await waitFor(() => expect(lines.result.current.data).toEqual([{ id: 'l1', name: 'Hammer' }]));
  expect(h.lines).toHaveBeenCalledWith('c1');

  const idleReports = renderHook(() => useOpenToolReports(null), { wrapper: wrapper() });
  expect(idleReports.result.current.fetchStatus).toBe('idle');
  h.openReports.mockResolvedValue([{ id: 'r1' }]);
  const reports = renderHook(() => useOpenToolReports('c1'), { wrapper: wrapper() });
  await waitFor(() => expect(reports.result.current.data).toEqual([{ id: 'r1' }]));
  expect(h.openReports).toHaveBeenCalledWith('c1');

  h.settings.mockResolvedValue({ coordinator_id: null, task_due_days: 3 });
  const settings = renderHook(() => useToolSettings(), { wrapper: wrapper() });
  await waitFor(() => expect(settings.result.current.data).toMatchObject({ task_due_days: 3 }));
  expect(h.settings).toHaveBeenCalledOnce();
});

it('the tool mutations forward their payloads: add, update, report, correct, close, settings', async () => {
  const { result } = renderHook(() => useToolMutations(), { wrapper: wrapper() });
  h.addLine.mockResolvedValue(undefined);
  const line = { crew_id: 'c1', name: 'Saw', code: null, serial: 'S1', held_qty: 1, note: null };
  await act(async () => { await result.current.addLine.mutateAsync(line); });
  expect(h.addLine).toHaveBeenCalledWith(line);
  h.updateLine.mockResolvedValue(undefined);
  await act(async () => { await result.current.updateLine.mutateAsync({ id: 'l1', patch: { held_qty: 4 } }); });
  expect(h.updateLine).toHaveBeenCalledWith('l1', { held_qty: 4 });
  h.report.mockResolvedValue('r1');
  const report = { reportId: 'r9', lineId: 'l1', kind: 'damaged' as const, qty: 1, note: null, photos: [] };
  await act(async () => { await result.current.report.mutateAsync(report); });
  expect(h.report).toHaveBeenCalledWith(report);
  h.correct.mockResolvedValue(undefined);
  await act(async () => { await result.current.correct.mutateAsync({ reportId: 'r1', kind: 'lost', qty: 2, reason: 'miscounted' }); });
  expect(h.correct).toHaveBeenCalledWith('r1', 'lost', 2, 'miscounted');
  h.close.mockResolvedValue(undefined);
  await act(async () => { await result.current.close.mutateAsync({ reportId: 'r1', resolution: 'written_off' }); });
  expect(h.close).toHaveBeenCalledWith('r1', 'written_off');
  h.setSettings.mockResolvedValue(undefined);
  await act(async () => { await result.current.setSettings.mutateAsync({ coordinatorId: 'u1', dueDays: 5 }); });
  expect(h.setSettings).toHaveBeenCalledWith('u1', 5);
});

it('the query roots stay the four families the writes invalidate', () => {
  expect(CREW_TOOL_QUERY_ROOTS).toEqual(['crew-tool-lines', 'crew-tool-reports', 'crew-tool-photos', 'crew-tool-settings']);
});
