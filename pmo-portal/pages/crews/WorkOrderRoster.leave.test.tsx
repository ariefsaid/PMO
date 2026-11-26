import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ onLeave: [] as string[] }));
vi.mock('@/src/hooks/useCrews', () => ({
  useWorkOrderRoster: () => ({
    data: [{
      crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', field_controller_id: null,
      members: [{ worker_id: 'w1', display_name: 'Ana', standard_role_id: null }, { worker_id: 'w2', display_name: 'Budi', standard_role_id: null }],
      roles: [], shortfall: 0,
    }],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  useWorkOrderCrews: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useCrews: () => ({ data: [], isPending: false, isError: false }),
  useCrewWorkOrders: () => ({ data: [{ id: 'wo1', wo_number: 'WO-1', title: 'Pipe rack' }], isLoading: false, isError: false, refetch: vi.fn() }),
  useCrewMutations: () => ({ roster: { mutateAsync: vi.fn() }, endRoster: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useLeave', () => ({ useLeaveOnDate: () => ({ data: h.onLeave }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager' as Role, effectiveRole: 'Project Manager' as Role }) }));

import { WorkOrderRoster } from './WorkOrderRoster';

const open = () => render(<MemoryRouter initialEntries={['/crews?view=roster&wo=wo1&date=2026-11-05']}><ToastProvider><WorkOrderRoster /></ToastProvider></MemoryRouter>);

describe('roster leave marker (#2708)', () => {
  beforeEach(() => { h.onLeave = []; });
  it('AC-LV-014 a member on approved leave carries a marker; the others do not', () => {
    h.onLeave = ['w1'];
    open();
    const crew = screen.getByRole('region', { name: /Crew one/ });
    expect(within(crew).getAllByText('On leave')).toHaveLength(1);
    expect(within(within(crew).getByText('Ana').closest('tr')!).getByText('On leave')).toBeInTheDocument();
  });
  it('AC-LV-014 with no leave the roster shows no marker', () => {
    open();
    expect(screen.queryByText('On leave')).toBeNull();
  });
});
