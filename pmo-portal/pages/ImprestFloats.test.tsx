import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  floats: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  positions: {} as Record<string, unknown>,
  establish: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloats: () => h.floats,
  useImprestPosition: (id: string) => ({ data: h.positions[id], isPending: !(id in h.positions), isError: false }),
  useEstablishFloat: () => h.establish,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Site Alpha', short_name: null, project_manager_id: 'u-pm' }] }) }));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [
    { id: 'u-pm', full_name: 'Pia Manager', role: 'Project Manager' },
    { id: 'u-fin', full_name: 'Finn Finance', role: 'Finance' },
    { id: 'u-eng', full_name: 'Eli Engineer', role: 'Engineer' },
  ] }),
}));
let realRole: Role = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import ImprestFloatsPage from './ImprestFloats';

const pos = (over: Record<string, unknown> = {}) => ({
  float_id: 'f1', float_amount: 5000000, cash_book: 1200000, advances_out: 300000, receipts_waiting: 3500000,
  replenishment_in_flight: 0, gap: 0, last_count_at: null, last_count_variance: null, month: '2026-11-01', plan_lines: [], ...over,
});
const float = (id: string, project: string, custodian: string) => ({
  id, project_id: 'p1', custodian_id: 'u-fin', currency: 'IDR', float_amount: 5000000, archived_at: null,
  project: { name: project }, custodian: { full_name: custodian },
});
const renderPage = () => render(<MemoryRouter><ToastProvider><ImprestFloatsPage /></ToastProvider></MemoryRouter>);

describe('/imprest list (AC-IMP-082)', () => {
  beforeEach(() => {
    realRole = 'Finance';
    h.floats = { data: { rows: [float('f1', 'Site Alpha', 'Finn Finance'), float('f2', 'Site Beta', 'Pia Manager')], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
    h.positions = { f1: pos(), f2: pos({ float_id: 'f2', gap: 250000 }) };
  });

  it('AC-IMP-082 the list shows each float\'s position', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Site Alpha/ });
    expect(within(row).getByText('Finn Finance')).toBeInTheDocument();
    expect(within(row).getByText(/1,200,000/)).toBeInTheDocument(); // cash
    expect(within(row).getByText(/300,000/)).toBeInTheDocument(); // advances out
    expect(within(row).getByText(/3,500,000/)).toBeInTheDocument(); // receipts waiting
    expect(screen.getByRole('row', { name: /Site Beta/ })).toBeInTheDocument();
  });

  it('AC-IMP-082 a non-zero gap is flagged in text', () => {
    renderPage();
    expect(within(screen.getByRole('row', { name: /Site Beta/ })).getByText('Books do not balance')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Site Alpha/ })).queryByText('Books do not balance')).toBeNull();
  });

  it('AC-IMP-082 a failed read shows the error state, never a zero', () => {
    h.floats = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Couldn't load site cash floats")).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it('AC-IMP-082 a truncated list says so', () => {
    h.floats = { ...h.floats, data: { rows: [float('f1', 'Site Alpha', 'Finn Finance')], truncated: true } };
    renderPage();
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });

  it('AC-IMP-082 a failed position read shows no zero cell for that row', () => {
    h.positions = { f1: undefined };
    renderPage();
    expect(within(screen.getByRole('row', { name: /Site Alpha/ })).queryByText(/Rp\s?0|^0$/)).toBeNull();
  });

  it('AC-IMP-082 only Admin or Finance may establish a float', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Establish float' })).toBeInTheDocument();
  });
  it('AC-IMP-082 a Project Manager sees no Establish float button', () => {
    realRole = 'Project Manager';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Establish float' })).toBeNull();
  });
});
