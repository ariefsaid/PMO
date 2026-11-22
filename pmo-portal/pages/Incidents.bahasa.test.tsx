/**
 * #2497 — Incidents shipped hard-coded English. Rendered under the real `id` catalogue the list,
 * severity pills, empty state, filing form and delete prompt must read as Bahasa. The stored values
 * (severity enum, status enum, free-text type) never change; only what the reader sees does.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

const { listState } = vi.hoisted(() => ({ listState: { data: [] as Array<Record<string, unknown>> } }));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidentsPage: () => ({
    list: { data: { rows: listState.data, total: listState.data.length }, isPending: false, isError: false, refetch: vi.fn() },
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
  useIncidentEvidenceMutations: () => ({ upload: { mutateAsync: vi.fn(), isPending: false }, makeTask: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useIncidentTypes', () => ({
  useIncidentTypes: () => ({ data: [{ id: 't1', label: 'Near Miss', archived_at: null }, { id: 't2', label: 'Spill', archived_at: null }] }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [] }) }));

vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));

import Incidents from './Incidents';

const renderPage = () => render(
  <BahasaProvider>
    <MemoryRouter><ToastProvider><Incidents /></ToastProvider></MemoryRouter>
  </BahasaProvider>,
);

describe('Incidents in Bahasa (#2497)', () => {
  it('reads the empty state and the filing form in Bahasa', async () => {
    listState.data = [];
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Insiden' })).toBeInTheDocument();
    expect(screen.getByText('Belum ada insiden')).toBeInTheDocument();
    expect(screen.queryByText('No incidents reported')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Laporkan insiden' })[0]);
    expect(await screen.findByText('Apa yang terjadi')).toBeInTheDocument();
    expect(screen.getByLabelText(/Tingkat/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Kritis' })).toBeInTheDocument();
  });

  it('shows severity in Bahasa while the stored value stays English', () => {
    listState.data = [{ id: 'i1', org_id: 'o', incident_date: '2026-03-15', type: 'Near Miss', severity: 'High', location: 'Site B', description: null, status: 'Open', reported_by: 'u', created_at: '2026-03-15T00:00:00Z' }];
    renderPage();
    expect(screen.getByText('Tinggi')).toBeInTheDocument();
    expect(screen.queryByText('High')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Tingkat/ })).toBeInTheDocument();
  });
});
