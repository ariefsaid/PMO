import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Project Manager', userId: 'u1', enabled: true, plans: [] as unknown[], canApprove: false,
  save: vi.fn(), submit: vi.fn(), approve: vi.fn(), reject: vi.fn(), reopen: vi.fn(),
}));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useEquipmentPlans', () => ({
  useEquipmentPlanSettings: () => ({ ...ok, data: { enabled: h.enabled, approvalStep: 'spend_approvers', allowSelfApproval: false } }),
  usePlanCategories: () => ({ ...ok, data: [{ id: 'k1', name: 'Cranes', nameId: null, position: 1, active: true }] }),
  usePlansForMonth: () => ({ ...ok, data: h.plans }),
  useCanApprovePlan: () => ({ ...ok, data: h.canApprove }),
  usePlanMutations: () => ({
    save: { mutateAsync: h.save, isPending: false }, submit: { mutateAsync: h.submit, isPending: false }, approve: { mutateAsync: h.approve, isPending: false },
    reject: { mutateAsync: h.reject, isPending: false }, reopen: { mutateAsync: h.reopen, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ ...ok, data: [{ value: 'p1', label: 'Plant upgrade' }] }),
  useVendorOptions: () => ({ ...ok, data: [{ value: 'v1', label: 'Acme Hire' }] }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ ...ok, data: [{ id: 'w1', title: 'Foundations' }] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import EquipmentPlansPage from './EquipmentPlans';

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const plan = (over: Record<string, unknown> = {}) => ({
  id: 'pl1', projectId: 'p1', planMonth: thisMonth(), status: 'Draft', createdBy: 'u1', rejectReason: null,
  lines: [{ id: 'l1', workOrderId: 'w1', categoryId: 'k1', description: 'Mobile crane', quantity: 2, rate: 1500, vendorId: 'v1', dateFrom: thisMonth(), dateTo: thisMonth().replace('-01', '-15'), procurementId: null }],
  ...over,
});
const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentPlansPage /></ToastProvider></MemoryRouter>);
const pickProject = async () => {
  await userEvent.click(screen.getByLabelText('Project'));
  await userEvent.click(await screen.findByText('Plant upgrade'));
};

describe('monthly equipment plan page (#2700)', () => {
  beforeEach(() => {
    h.role = 'Project Manager'; h.userId = 'u1'; h.enabled = true; h.plans = []; h.canApprove = false;
    for (const f of [h.save, h.submit, h.approve, h.reject, h.reopen]) f.mockReset();
  });

  it('AC-EQP-001 with the plan off the screen says so and offers no plan controls', () => {
    h.enabled = false;
    renderPage();
    expect(screen.getByTestId('plan-off')).toBeInTheDocument();
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
  });

  it('AC-EQP-001 an Admin is pointed to the settings when the plan is off', () => {
    h.enabled = false; h.role = 'Admin';
    renderPage();
    expect(screen.getByRole('link', { name: 'Turn it on in the plan settings.' })).toHaveAttribute('href', '/equipment-plans/settings');
  });

  it('AC-EQP-016 a planner adds a line, sees the total, and saves a draft with a client-made id', async () => {
    h.save.mockResolvedValue('pl-new');
    renderPage();
    await pickProject();
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const line = screen.getByTestId('plan-line');
    await userEvent.type(within(line).getByLabelText('What is needed'), 'Excavator');
    await userEvent.click(within(line).getByLabelText('Vendor'));
    await userEvent.click(await screen.findByText('Acme Hire'));
    await userEvent.type(within(line).getByLabelText('Rate'), '500');
    expect(screen.getByTestId('plan-total').textContent).toMatch(/500/);
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(h.save).toHaveBeenCalledTimes(1);
    const call = h.save.mock.calls[0]![0] as { id: string; projectId: string; lines: Array<Record<string, unknown>> };
    expect(call.projectId).toBe('p1');
    expect(call.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.lines[0]).toMatchObject({ description: 'Excavator', vendorId: 'v1', quantity: 1, rate: 500 });
  });

  it('AC-EQP-016 a line missing its vendor is not sent and says what to fix', async () => {
    renderPage();
    await pickProject();
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    await userEvent.type(within(screen.getByTestId('plan-line')).getByLabelText('What is needed'), 'Pump');
    await userEvent.type(within(screen.getByTestId('plan-line')).getByLabelText('Rate'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(h.save).not.toHaveBeenCalled();
    expect(await screen.findByText('Choose a vendor.')).toBeInTheDocument();
  });

  it('AC-EQP-016 a refusal from the server shows on the form in words', async () => {
    h.plans = [plan()];
    h.save.mockRejectedValue(new Error('EQP_LOCKED: the plan is not a Draft, so it cannot change'));
    renderPage();
    await pickProject();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('This plan can no longer be changed.')).toBeInTheDocument();
  });

  it('AC-EQP-017 a Submitted plan offers an approver Approve and Reject, and a non-approver neither', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.canApprove = true;
    const { unmount } = renderPage();
    await pickProject();
    expect(screen.getByRole('button', { name: 'Approve and create orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    unmount();
    h.canApprove = false;
    renderPage();
    await pickProject();
    expect(screen.queryByRole('button', { name: 'Approve and create orders' })).not.toBeInTheDocument();
  });

  it('AC-EQP-017 approving asks first, then calls the approval once', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.canApprove = true;
    h.approve.mockResolvedValue(undefined);
    renderPage();
    await pickProject();
    await userEvent.click(screen.getByRole('button', { name: 'Approve and create orders' }));
    expect(h.approve).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and create orders' }));
    expect(h.approve).toHaveBeenCalledTimes(1);
    expect(h.approve).toHaveBeenCalledWith('pl1');
  });

  it('AC-EQP-017 an Approved plan is read-only and each line links to the order it created', async () => {
    h.plans = [plan({ status: 'Approved', lines: [{ ...(plan().lines[0] as object), procurementId: 'po1' }] })];
    renderPage();
    await pickProject();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add line' })).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-line-order')).toHaveAttribute('href', '/procurement/po1');
  });

  it('AC-EQP-017 the author of a Rejected plan sees the reason and can reopen it', async () => {
    h.plans = [plan({ status: 'Rejected', rejectReason: 'Too many cranes' })];
    h.reopen.mockResolvedValue(undefined);
    renderPage();
    await pickProject();
    expect(screen.getByText('Rejected: Too many cranes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen to edit' }));
    expect(h.reopen).toHaveBeenCalledWith('pl1');
  });
});
