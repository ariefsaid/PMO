import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  revoke: vi.fn(),
  setDeliveryNoteSettings: vi.fn().mockResolvedValue(undefined),
  role: 'Engineer',
  dnSettings: { data: { enabled: false, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] }, isPending: false, isError: false, refetch: vi.fn() },
}));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useApprovalChain: () => ({ ...ok, data: [] }),
  useMaterialRequestCutoff: () => ({ ...ok, data: null }),
  useDeliveryNoteSettings: () => h.dnSettings,
  useStandIns: () => ({ ...ok, data: [{ id: 's1', delegatorId: 'u1', standInId: 'u2', startsOn: '2026-11-20', endsOn: '2026-11-22', revokedAt: null }] }),
  useUsageInstalledSource: () => ({ data: 'site_reports', refetch: vi.fn() }),
  useMaterialRequestMutations: () => ({
    setChain: { mutateAsync: vi.fn(), isPending: false }, setCutoff: { mutateAsync: vi.fn(), isPending: false },
    setDeliveryNoteSettings: { mutateAsync: h.setDeliveryNoteSettings, isPending: false },
    setStandIn: { mutateAsync: vi.fn(), isPending: false }, revokeStandIn: { mutateAsync: h.revoke },
  }),
}));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [{ id: 'u1', full_name: 'Una', status: 'active' }, { id: 'u2', full_name: 'Dua', status: 'active' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: 'Engineer' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: false }), useModuleOn: () => true }));

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
    expect(screen.queryByLabelText(/^Time$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('AC-MRQ-021 an Admin sees the cut-off control and can save it', () => {
    h.role = 'Admin';
    render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
    expect(screen.getByText('Daily cut-off')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Time$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  describe('#2687 printable delivery note settings', () => {
    it('a non-Admin does not see delivery note settings', () => {
      h.role = 'Engineer';
      render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);
      expect(screen.queryByTestId('delivery-note-settings-editor')).not.toBeInTheDocument();
    });

    it('AC-DNP-006 an Admin sees delivery note settings, with no on/off switch (on for everyone, #2746), and can save signature blocks', async () => {
      h.role = 'Admin';
      h.dnSettings = {
        data: { enabled: true, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
      render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);

      expect(screen.getByTestId('delivery-note-settings-editor')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /Enable printable delivery note/i })).toBeNull();

      // Signature block inputs exist
      expect(screen.getByTestId('signature-block-input-0')).toBeInTheDocument();
      expect(screen.getByTestId('signature-block-input-1')).toBeInTheDocument();
      expect(screen.getByTestId('signature-block-input-2')).toBeInTheDocument();

      // Change a block, then save
      await userEvent.type(screen.getAllByRole('textbox', { name: /Signature block 3/i })[0], ' (site)');
      const saveBtn = screen.getByRole('button', { name: 'Save' });
      await userEvent.click(saveBtn);

      expect(h.setDeliveryNoteSettings).toHaveBeenCalledWith({
        enabled: true,
        signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by (site)'],
      });
    });
  });
});
