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
  useUsageInstalledSource: () => ({ data: 'site_reports', refetch: vi.fn() }),
  useDeliveryNoteSettings: () => ({ data: { enabled: false, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] } }),
  useMaterialRequestMutations: () => ({ setChain: { mutateAsync: vi.fn() }, setCutoff: { mutateAsync: vi.fn() }, setStandIn: { mutateAsync: vi.fn() }, revokeStandIn: { mutateAsync: vi.fn() }, setDeliveryNoteSettings: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useUsageThresholds', () => ({ useUsageThresholds: () => ({ thresholds: { pct1: null, pct2: null }, reload: vi.fn() }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestSettingsPage from './MaterialRequestSettings';

describe('AC-MUT-010 usage warning settings are Admin-only', () => {
  it('a non-Admin does not see the threshold fields', () => {
    h.role = 'Engineer';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.queryByText('Usage warnings')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('First warning (% of plan)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Installed material comes from')).not.toBeInTheDocument();
  });
  it('an Admin sees both fields and the save button', () => {
    h.role = 'Admin';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.getByText('Usage warnings')).toBeInTheDocument();
    expect(screen.getByLabelText('First warning (% of plan)')).toBeInTheDocument();
    expect(screen.getByLabelText('Second warning (% of plan)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save warnings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Installed material comes from')).toBeInTheDocument();
  });
});
