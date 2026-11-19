import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ revoke: vi.fn() }));
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
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestSettingsPage from './MaterialRequestSettings';

describe('material request approval settings', () => {
  it('a refused stand-in revoke is shown, not swallowed', async () => {
    h.revoke.mockRejectedValueOnce(new Error('MRQ_STAND_IN: no'));
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(await screen.findByText(/stand-in is not allowed/)).toBeInTheDocument();
  });
});
