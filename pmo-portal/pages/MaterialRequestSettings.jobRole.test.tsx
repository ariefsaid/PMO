import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  setChain: vi.fn().mockResolvedValue(undefined),
  builtInOn: true,
  chain: [] as Array<Record<string, unknown>>,
}));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useApprovalChain: () => ({ ...ok, data: h.chain }),
  useMaterialRequestCutoff: () => ({ ...ok, data: null }),
  useDeliveryNoteSettings: () => ({ ...ok, data: { enabled: false, signatureBlocks: [] } }),
  useStandIns: () => ({ ...ok, data: [] }),
  useUsageInstalledSource: () => ({ data: 'site_reports', refetch: vi.fn() }),
  useMaterialRequestMutations: () => ({
    setChain: { mutateAsync: h.setChain, isPending: false }, setCutoff: { mutateAsync: vi.fn(), isPending: false },
    setDeliveryNoteSettings: { mutateAsync: vi.fn(), isPending: false },
    setStandIn: { mutateAsync: vi.fn(), isPending: false }, revokeStandIn: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.builtInOn }), useModuleOn: () => true }));
vi.mock('@/src/hooks/useUsageThresholds', () => ({ useUsageThresholds: () => ({ thresholds: { pct1: null, pct2: null }, reload: vi.fn() }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: 'Admin' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestSettingsPage from './MaterialRequestSettings';

const mount = () => render(<MemoryRouter><ToastProvider><MaterialRequestSettingsPage /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.setChain.mockClear();
  h.builtInOn = true;
  h.chain = [];
});

describe('AC-RTD-014 an approval step can name the built-in role that decides it', () => {
  it('an Admin picks a built-in role; the access level follows it, is read-only and says why, and the chain saves both', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    const step = screen.getByTestId('chain-step');
    const jobRole = within(step).getByLabelText('Built-in role that decides') as HTMLSelectElement;
    const options = Array.from(jobRole.options);
    expect(options.some((o) => o.value === 'material_coordinator')).toBe(true);
    expect(options.some((o) => o.value === 'foreman')).toBe(false); // a field account never approves
    await userEvent.selectOptions(jobRole, 'material_coordinator');
    const level = within(step).getByLabelText('Role') as HTMLSelectElement;
    expect(level.value).toBe('Engineer');
    expect(level).toBeDisabled();
    expect(within(step).getByText('Set by the built-in role.')).toBeInTheDocument();
    await userEvent.type(within(step).getByLabelText('What this step checks'), 'Stock check');
    await userEvent.click(screen.getByRole('button', { name: 'Save chain' }));
    expect(h.setChain).toHaveBeenCalledWith([{ role: 'Engineer', jobRole: 'material_coordinator', label: 'Stock check', onlyOverPlan: false }]);
  });

  it('choosing None returns the step to its access level', async () => {
    h.chain = [{ id: 'c1', position: 1, role: 'Project Manager', jobRole: 'construction_manager', label: 'Site check', onlyOverPlan: false }];
    mount();
    const step = screen.getByTestId('chain-step');
    await userEvent.selectOptions(within(step).getByLabelText('Built-in role that decides'), '');
    expect(within(step).getByLabelText('Role')).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save chain' }));
    expect(h.setChain).toHaveBeenCalledWith([{ role: 'Project Manager', jobRole: null, label: 'Site check', onlyOverPlan: false }]);
  });

  it('with built-in roles off, a plain step shows no built-in role control; a step that names one shows it disabled with the reason', () => {
    h.builtInOn = false;
    h.chain = [
      { id: 'c1', position: 1, role: 'Finance', jobRole: null, label: 'Cost check', onlyOverPlan: false },
      { id: 'c2', position: 2, role: 'Engineer', jobRole: 'storekeeper', label: 'Stock check', onlyOverPlan: false },
    ];
    mount();
    const [plain, named] = screen.getAllByTestId('chain-step');
    expect(within(plain).queryByLabelText('Built-in role that decides')).not.toBeInTheDocument();
    expect(within(named).getByLabelText('Built-in role that decides')).toBeDisabled();
    expect(within(named).getByText(/Built-in roles are off, so this cannot change/)).toBeInTheDocument();
  });
});
