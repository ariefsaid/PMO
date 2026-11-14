import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  floats: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  projects: { data: [{ id: 'p1', name: 'Site Alpha', short_name: null, project_manager_id: 'u-pm' }] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  users: { data: undefined as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  positions: {} as Record<string, unknown>,
  establish: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloats: () => h.floats,
  useImprestPosition: (id: string) => ({ data: h.positions[id], isPending: !(id in h.positions), isError: false }),
  useEstablishFloat: () => h.establish,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => h.projects }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => h.users }));
let realRole: Role = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import ImprestFloatsPage from './ImprestFloats';

const pos = (over: Record<string, unknown> = {}) => ({
  float_id: 'f1', float_amount: 5000000, cash_book: 1200000, advances_out: 300000, receipts_waiting: 3500000,
  replenishment_in_flight: 0, gap: 0, funded_total: 5000000, last_count_at: null, last_count_variance: null, month: '2026-11-01', plan_lines: [], ...over,
});
const float = (id: string, projectName: string, custodian: string) => ({
  id, project_id: 'p1', custodian_id: 'u-fin', currency: 'IDR', float_amount: 5000000, archived_at: null,
  project: { name: projectName }, custodian: { full_name: custodian },
});
const renderTree = () => (
  <MemoryRouter initialEntries={['/imprest']}>
    <ToastProvider>
      <Routes>
        <Route path="/imprest" element={<ImprestFloatsPage />} />
        <Route path="/imprest/:floatId" element={<p>float record</p>} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);
const renderPage = () => render(renderTree());

const users = [
  { id: 'u-pm', full_name: 'Pia Manager', role: 'Project Manager' },
  { id: 'u-fin', full_name: 'Finn Finance', role: 'Finance' },
  { id: 'u-eng', full_name: 'Eli Engineer', role: 'Engineer' },
];

beforeEach(() => {
  realRole = 'Finance';
  h.floats = { data: { rows: [float('f1', 'Site Alpha', 'Finn Finance'), float('f2', 'Site Beta', 'Pia Manager')], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  h.projects = { data: [{ id: 'p1', name: 'Site Alpha', short_name: null, project_manager_id: 'u-pm' }], isPending: false, isError: false, refetch: vi.fn() };
  h.users = { data: users, isPending: false, isError: false, refetch: vi.fn() };
  h.positions = { f1: pos(), f2: pos({ float_id: 'f2', cash_book: 950000, gap: 250000 }) };
  h.establish.mutateAsync.mockReset();
  h.establish.mutateAsync.mockResolvedValue('f9');
  h.establish.isPending = false;
});

describe('Imprest float list floor', () => {
  it('floor: empty-state Establish float opens the form and navigates to the new float', async () => {
    h.floats = { ...h.floats, data: { rows: [], truncated: false } };
    renderPage();
    const establishButtons = screen.getAllByRole('button', { name: 'Establish float' });
    await userEvent.click(establishButtons[1]);
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('combobox', { name: /Project/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Site Alpha/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Custodian/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Finn Finance/ }));
    await userEvent.type(within(dialog).getByLabelText(/Float amount/), '5000000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Establish float' }));

    await waitFor(() => expect(h.establish.mutateAsync).toHaveBeenCalledWith({ projectId: 'p1', custodianId: 'u-fin', amount: 5000000 }));
    expect(await screen.findByText('float record')).toBeInTheDocument();
  });

  it('floor: activating a float row opens that float record', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('row', { name: /Site Alpha/ }));

    expect(await screen.findByText('float record')).toBeInTheDocument();
  });

  it('floor: list Retry refetches floats and renders recovered rows', async () => {
    const retry = vi.fn(() => {
      h.floats = { data: { rows: [float('f1', 'Site Alpha', 'Finn Finance')], truncated: false }, isPending: false, isError: false, refetch: retry };
    });
    h.floats = { data: undefined, isPending: false, isError: true, refetch: retry };
    const view = renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(renderTree());
    expect(await screen.findByRole('row', { name: /Site Alpha/ })).toBeInTheDocument();
  });

  it('floor: custodian Retry refetches and offers the eligible candidates', async () => {
    const retry = vi.fn(() => {
      h.users = { data: users, isPending: false, isError: false, refetch: retry };
    });
    h.users = { data: undefined, isPending: false, isError: true, refetch: retry };
    const view = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Establish float' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Project/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Site Alpha/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Custodian/ }));

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(renderTree());
    expect(await screen.findByRole('option', { name: /Finn Finance/ })).toBeInTheDocument();
  });

  it('floor: Establish float stays disabled until all required fields are complete', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Establish float' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Establish float' });
    expect(submit).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('combobox', { name: /Project/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Site Alpha/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Custodian/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Finn Finance/ }));
    await userEvent.type(within(dialog).getByLabelText(/Float amount/), '5000000');

    expect(submit).toBeEnabled();
  });
});
