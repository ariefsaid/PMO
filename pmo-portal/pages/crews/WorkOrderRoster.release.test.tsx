import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

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
vi.mock('@/src/hooks/useLeave', () => ({ useLeaveOnDate: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useMedicalRelease', () => ({ useReleaseHolds: () => ({ data: new Map([['w1', 'pending']]) }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));

import { WorkOrderRoster } from './WorkOrderRoster';

describe('AC-MR-008 the roster shows a worker whose medical release is not approved', () => {
  it('marks that worker as release pending and nobody else', () => {
    render(<MemoryRouter initialEntries={['/crews?view=roster&wo=wo1&date=2026-11-05']}><ToastProvider><WorkOrderRoster /></ToastProvider></MemoryRouter>);
    const ana = screen.getByText('Ana').closest('tr') as HTMLElement;
    expect(within(ana).getByText('Release pending')).toBeInTheDocument();
    expect(within(screen.getByText('Budi').closest('tr') as HTMLElement).queryByText('Release pending')).toBeNull();
  });
});
