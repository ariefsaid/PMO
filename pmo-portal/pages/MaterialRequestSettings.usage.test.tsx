import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ role: 'Engineer' }));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useApprovalChain: () => ({ ...ok, data: [] }),
  useMaterialRequestCutoff: () => ({ ...ok, data: null }),
  useStandIns: () => ({ ...ok, data: [] }),
  useDeliveryNoteSettings: () => ({ data: { enabled: false, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] } }),
  useMaterialRequestMutations: () => ({ setChain: { mutateAsync: vi.fn() }, setCutoff: { mutateAsync: vi.fn() }, setStandIn: { mutateAsync: vi.fn() }, revokeStandIn: { mutateAsync: vi.fn() }, setDeliveryNoteSettings: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useUsageThreshold', () => ({ useUsageThreshold: () => ({ threshold: null, reload: vi.fn() }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestSettingsPage from './MaterialRequestSettings';

describe('AC-UW-011 usage warning settings are Admin-only', () => {
  it('a non-Admin does not see the threshold fields', () => {
    h.role = 'Engineer';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.queryByText('Usage warning')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Warn at (% of plan)')).not.toBeInTheDocument();
  });
  it('an Admin sees the one field and the save button', () => {
    h.role = 'Admin';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.getByText('Usage warning')).toBeInTheDocument();
    expect(screen.getByLabelText('Warn at (% of plan)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save warning' })).toBeInTheDocument();
  });
});
