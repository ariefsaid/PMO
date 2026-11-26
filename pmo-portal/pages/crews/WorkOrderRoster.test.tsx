import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  roster: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  placements: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  rosterArgs: [] as unknown[],
}));
vi.mock('@/src/hooks/useCrews', () => ({
  useWorkOrderRoster: (wo: string | null, date: string | null) => { h.rosterArgs.push([wo, date]); return h.roster; },
  useWorkOrderCrews: () => h.placements,
  useCrews: () => ({ data: [{ id: 'c1', code: 'CR-1', name: 'Crew one' }], isPending: false, isError: false }),
  useCrewWorkOrders: () => ({ data: [{ id: 'wo1', wo_number: 'WO-1', title: 'Pipe rack' }], isLoading: false, isError: false, refetch: vi.fn() }),
  useCrewMutations: () => ({ roster: { mutateAsync: vi.fn() }, endRoster: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));

import { WorkOrderRoster } from './WorkOrderRoster';

const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><ToastProvider><WorkOrderRoster /></ToastProvider></MemoryRouter>);

describe('work-order roster for a date (#2528)', () => {
  beforeEach(() => {
    h.rosterArgs = [];
    h.roster = {
      data: [{
        crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', field_controller_id: null,
        members: [
          { worker_id: 'w1', display_name: 'Ana', kind: 'own', has_login: true, standard_role_id: 'r1' },
          { worker_id: 'w2', display_name: 'Budi', kind: 'vendor', has_login: false, standard_role_id: 'r2' },
        ],
        roles: [
          { standard_role_id: 'r1', name: 'Foreman', headcount: 1, placed: 1, shortfall: 0 },
          { standard_role_id: 'r2', name: 'Welder', headcount: 3, placed: 1, shortfall: 2 },
        ],
        shortfall: 2,
      }],
      isPending: false, isError: false, refetch: vi.fn(),
    };
  });

  it('AC-CRW-004 the roster for a date shows each crew\'s members and its role shortfall', () => {
    renderAt('/crews?view=roster&wo=wo1&date=2026-11-05');
    expect(h.rosterArgs).toContainEqual(['wo1', '2026-11-05']);
    const crew = screen.getByRole('region', { name: /Crew one/ });
    expect(within(crew).getByText('Ana')).toBeInTheDocument();
    expect(within(crew).getByText('Budi')).toBeInTheDocument();
    const welder = within(crew).getByRole('row', { name: /Welder/ });
    expect(within(welder).getByText('1 of 3')).toBeInTheDocument();
    expect(within(welder).getByText('2 short')).toBeInTheDocument();
    expect(within(within(crew).getByRole('row', { name: /Foreman/ })).queryByText(/short/)).toBeNull();
    expect(within(crew).getByText('2 short in total')).toBeInTheDocument();
  });

  it('AC-CRW-004 with no crew rostered that day it says so and offers to roster one', () => {
    h.roster = { ...h.roster, data: [] };
    renderAt('/crews?view=roster&wo=wo1&date=2026-11-05');
    expect(screen.getByText('No crew serves this work order that day')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Roster a crew' }).length).toBeGreaterThan(0);
  });

  it('fix/walk-people item 6: people whose crew role was never set are named, with why the figures are short and where to fix it', () => {
    const crewData = (h.roster.data as Array<{ members: unknown[] }>)[0];
    crewData.members.push({ worker_id: 'w3', display_name: 'Citra', kind: 'own', has_login: false, standard_role_id: null });
    renderAt('/crews?view=roster&wo=wo1&date=2026-11-05');
    const crew = screen.getByRole('region', { name: /Crew one/ });
    expect(within(crew).getByText('Crew role not set')).toBeInTheDocument();
    expect(within(crew).getByTestId('roster-no-role-note')).toHaveTextContent('Not counted above: 1 with no crew role set');
    expect(within(crew).getByRole('link', { name: 'Set their crew role under Crews' })).toHaveAttribute('href', '/crews');
    expect(within(crew).queryByText('Role')).toBeNull();
  });

  it('fix/walk-people item 11: the roster opens on the work order used last when the address names none', () => {
    window.localStorage.setItem('pmo.crews.lastWorkOrder', 'wo1');
    renderAt('/crews?view=roster');
    expect(h.rosterArgs.some((a) => (a as unknown[])[0] === 'wo1')).toBe(true);
    window.localStorage.removeItem('pmo.crews.lastWorkOrder');
  });

  it('#1126 with no date in the address the roster opens on the organisation\'s day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    try {
      renderAt('/crews?view=roster&wo=wo1');
      expect(h.rosterArgs).toContainEqual(['wo1', '2026-11-26']);
    } finally {
      resetActiveLocale();
      vi.useRealTimers();
    }
  });

  it('asks for a work order first', () => {
    renderAt('/crews?view=roster');
    expect(screen.getByText('Choose a work order to see who serves it')).toBeInTheDocument();
  });
});
