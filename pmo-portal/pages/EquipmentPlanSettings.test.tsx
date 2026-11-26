import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ role: 'Admin', enabled: true, setSettings: vi.fn(), upsert: vi.fn(), setActive: vi.fn() }));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useEquipmentPlans', () => ({
  useEquipmentPlanSettings: () => ({ ...ok, data: { enabled: h.enabled, approvalStep: 'spend_approvers', allowSelfApproval: false } }),
  usePlanCategories: () => ({ ...ok, data: [
    { id: 'k1', name: 'Cranes', nameId: 'Derek', position: 1, active: true },
    { id: 'k2', name: 'Pumps', nameId: null, position: 2, active: false },
  ] }),
  usePlanSettingsMutations: () => ({
    setSettings: { mutateAsync: h.setSettings, isPending: false }, upsertCategory: { mutateAsync: h.upsert, isPending: false }, setCategoryActive: { mutateAsync: h.setActive, isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import EquipmentPlanSettingsPage from './EquipmentPlanSettings';

const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentPlanSettingsPage /></ToastProvider></MemoryRouter>);

describe('monthly plan settings (#2700)', () => {
  beforeEach(() => { h.role = 'Admin'; h.enabled = true; h.setSettings.mockReset(); h.upsert.mockReset(); h.setActive.mockReset(); });

  it('AC-EQP-018 a non-Admin sees no save, add or retire control', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByText('Only an Admin can change the plan settings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
  });

  it('AC-EQP-018 an Admin sees the categories as data, a retired one marked and restorable', () => {
    renderPage();
    expect(screen.getAllByTestId('plan-category-row')).toHaveLength(2);
    expect(screen.getByDisplayValue('Pumps')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('AC-EQP-018 an Admin adds a category with any name', async () => {
    h.upsert.mockResolvedValue(undefined);
    renderPage();
    const fresh = screen.getByTestId('plan-category-new');
    await userEvent.type(fresh.querySelector('input') as HTMLElement, 'Scaffolding');
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(h.upsert).toHaveBeenCalledWith({ id: null, name: 'Scaffolding', nameId: null, position: 3 });
  });

  it('AC-EQP-018 an Admin changes the approval step and self-approval, and saves them', async () => {
    h.setSettings.mockResolvedValue(undefined);
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Approval step'), 'senior_role');
    await userEvent.click(screen.getByLabelText('The author may approve their own plan'));
    await userEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(h.setSettings).toHaveBeenCalledWith({ enabled: true, approvalStep: 'senior_role', allowSelfApproval: true });
  });

  it('AC-EQP-018 a refusal from the server is shown in words, not swallowed', async () => {
    h.setSettings.mockRejectedValue(new Error('EQP_PREREQ: turn on purchase types first'));
    renderPage();
    await userEvent.click(screen.getByLabelText('The author may approve their own plan'));
    await userEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByText('Turn on purchase types and keep an active rental type first.')).toBeInTheDocument();
  });

  it('AC-EQP-001 the category list is hidden while the plan is off', () => {
    h.enabled = false;
    renderPage();
    expect(screen.queryAllByTestId('plan-category-row')).toHaveLength(0);
  });
});
