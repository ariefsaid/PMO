import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** AC-LOAN-010 — the loans card: off means nothing renders; on shows loans; only a crew manager lends. */
const h = vi.hoisted(() => ({
  enabled: false, canManage: true, lend: vi.fn().mockResolvedValue(undefined), endLoan: vi.fn().mockResolvedValue(undefined),
  loans: [{ id: 'l1', worker_id: 'w1', home_crew_id: 'a', host_crew_id: 'b', valid_from: '2999-01-01', valid_to: '2999-01-05', version: 1 }] as unknown[],
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/hooks/useCrews', () => ({
  useCrews: () => ({ data: [{ id: 'a', code: 'A1', name: 'Home crew', archived_at: null }, { id: 'b', code: 'B1', name: 'Host crew', archived_at: null }] }),
  useCrewWorkers: () => ({ data: [{ id: 'w1', display_name: 'Lent Worker' }] }),
  useCrewMembers: (crewId: string | null) => ({ data: crewId === 'a' ? [{ id: 'm1', crew_id: 'a', worker_id: 'w1', valid_from: '2000-01-01', valid_to: null }] : [] }),
}));
vi.mock('@/src/hooks/useCrewLoans', () => ({
  useCrewLoansEnabled: () => ({ data: h.enabled }),
  useCrewLoans: () => ({ data: h.loans, isPending: false, isError: false }),
  useCrewLoanMutations: () => ({ lend: { mutateAsync: h.lend }, endLoan: { mutateAsync: h.endLoan } }),
}));
import { CrewLoans } from './CrewLoans';

const view = () => render(<ToastProvider><CrewLoans /></ToastProvider>);

describe('AC-LOAN-010 crew loans card', () => {
  beforeEach(() => { h.enabled = true; h.canManage = true; h.lend.mockClear(); h.endLoan.mockClear(); });

  it('renders nothing while the setting is off (the Crews page is as it was)', () => {
    h.enabled = false;
    view();
    expect(screen.queryByText('Crew loans')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crew-loans')).not.toBeInTheDocument();
  });

  it('lists the loans when on, and a non-manager sees no Lend action', () => {
    h.canManage = false;
    view();
    expect(screen.getByText('Lent Worker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lend worker' })).not.toBeInTheDocument();
  });

  it('lends a worker from the home crew to another crew', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getAllByRole('button', { name: 'Lend worker' })[0]);
    await user.selectOptions(screen.getByRole('combobox', { name: /Home crew/ }), 'a');
    await user.selectOptions(screen.getByRole('combobox', { name: /Person/ }), 'w1');
    await user.selectOptions(screen.getByRole('combobox', { name: /Host crew/ }), 'b');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lend worker' }));
    await waitFor(() => expect(h.lend).toHaveBeenCalledWith(expect.objectContaining({ worker_id: 'w1', home_crew_id: 'a', host_crew_id: 'b' })));
  });
});
