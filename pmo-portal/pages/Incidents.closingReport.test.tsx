import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const { settingsState, listState } = vi.hoisted(() => ({
  settingsState: {
    data: { id: 's1', org_id: 'org1', enabled: false, grouping_mode: 'type', updated_at: '2026-01-01T00:00:00Z' },
    isPending: false,
    isError: false,
  },
  listState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useIssueClosingReport', () => ({
  useIssueClosingReportSettings: () => settingsState,
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidentsPage: () => ({
    list: {
      data: { rows: listState.data, total: listState.data.length },
      isPending: listState.isPending,
      isError: listState.isError,
      refetch: listState.refetch,
    },
    allTotal: listState.data.length,
  }),
  useIncidentsExportAll: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIncidentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
  useAssigneeOptions: () => ({ data: [] }),
  useIncidentEvidenceMutations: () => ({
    upload: { mutateAsync: vi.fn(), isPending: false },
    makeTask: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }),
}));

import Incidents from './Incidents';

const renderIncidents = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Incidents />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('Incidents page — Closing time report button (AC-CTR-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT render Closing-time report button when setting is disabled (default zero-drift)', () => {
    settingsState.data = { id: 's1', org_id: 'org1', enabled: false, grouping_mode: 'type', updated_at: '2026-01-01T00:00:00Z' };
    renderIncidents();
    expect(screen.queryByRole('button', { name: /Closing-time report/i })).not.toBeInTheDocument();
  });

  it('renders Closing-time report button when setting is enabled', () => {
    settingsState.data = { id: 's1', org_id: 'org1', enabled: true, grouping_mode: 'type', updated_at: '2026-01-01T00:00:00Z' };
    renderIncidents();
    expect(screen.getByRole('button', { name: /Closing-time report/i })).toBeInTheDocument();
  });
});
