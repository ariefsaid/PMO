import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ revoke: vi.fn(), role: 'Engineer' }));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useApprovalChain: () => ({ ...ok, data: [] }),
  useMaterialRequestCutoff: () => ({ ...ok, data: null }),
  useStandIns: () => ({ ...ok, data: [{ id: 's1', delegatorId: 'u1', standInId: 'u2', startsOn: '2026-11-20', endsOn: '2026-11-22', revokedAt: null }] }),
  useMaterialRequestMutations: () => ({
    setChain: { mutateAsync: vi.fn(), isPending: false }, setCutoff: { mutateAsync: vi.fn(), isPending: false },
    setStandIn: { mutateAsync: vi.fn(), isPending: false }, revokeStandIn: { mutateAsync: h.revoke },
  }),
}));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [{ id: 'u1', full_name: 'Una', status: 'active' }, { id: 'u2', full_name: 'Dua', status: 'active' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: 'Engineer' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestSettingsPage from './MaterialRequestSettings';

describe('material request approval settings', () => {
  it('a refused stand-in revoke is shown, not swallowed', async () => {
    h.revoke.mockRejectedValueOnce(new Error('MRQ_STAND_IN: no'));
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(await screen.findByText(/stand-in is not allowed/)).toBeInTheDocument();
  });

  it('AC-MRQ-021 a non-Admin does not see the cut-off control', () => {
    h.role = 'Engineer';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.queryByText('Daily cut-off')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Time \(24-hour/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save cut-off' })).not.toBeInTheDocument();
  });

  it('AC-MRQ-021 an Admin sees the cut-off control and can save it', () => {
    h.role = 'Admin';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.getByText('Daily cut-off')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Time \(24-hour/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save cut-off' })).toBeInTheDocument();
  });
});
