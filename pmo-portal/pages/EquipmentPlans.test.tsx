import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Project Manager', userId: 'u1', enabled: true, plans: [] as unknown[], canApprove: false,
  routeData: undefined as unknown, routePending: false, routeError: false, routeRefetch: vi.fn(), routeCalls: [] as Array<[string | undefined, boolean]>,
  save: vi.fn(), submit: vi.fn(), approve: vi.fn(), reject: vi.fn(), reopen: vi.fn(),
}));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useEquipmentPlans', () => ({
  useEquipmentPlanSettings: () => ({ ...ok, data: { enabled: h.enabled, approvalStep: 'spend_approvers', allowSelfApproval: false } }),
  usePlanCategories: () => ({ ...ok, data: [{ id: 'k1', name: 'Cranes', nameId: null, position: 1, active: true }] }),
  usePlansForMonth: () => ({ ...ok, data: h.plans }),
  useCanApprovePlan: () => ({ ...ok, data: h.canApprove }),
  useEquipmentPlanApprovalRoute: (id: string | undefined, enabled: boolean) => {
    h.routeCalls.push([id, enabled]);
    return { isPending: h.routePending, isError: h.routeError, data: h.routeData, refetch: h.routeRefetch };
  },
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
    h.routeData = undefined; h.routePending = false; h.routeError = false; h.routeCalls.length = 0;
    for (const f of [h.save, h.submit, h.approve, h.reject, h.reopen, h.routeRefetch]) f.mockReset();
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

  it('#2788 with prices hidden, re-saving a saved line leaves its unknown rate and vendor out (the stored ones stay)', async () => {
    h.save.mockResolvedValue('pl1');
    h.plans = [plan({ lines: [{ ...plan().lines[0], rate: null, vendorId: null }] })];
    renderPage();
    await pickProject();
    const line = screen.getByTestId('plan-line');
    expect(within(line).getByLabelText('Rate')).toHaveValue('');
    await userEvent.type(within(line).getByLabelText('What is needed'), ' 25t');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(h.save).toHaveBeenCalledTimes(1);
    const sent = (h.save.mock.calls[0]![0] as { lines: Array<Record<string, unknown>> }).lines[0]!;
    expect(sent).toMatchObject({ id: 'l1', description: 'Mobile crane 25t', quantity: 2 });
    expect('rate' in sent || 'vendorId' in sent).toBe(false);
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

  // ── fix-waiting item 3: the plan says who it waits for, from the database's own route (1565) ──────────────────────
  it('AC-EQP-008 a Submitted plan names who it waits for, with that person\'s own role, and invents no step', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeData = { kind: 'project', approvers: [{ id: 'u9', name: 'Ani', role: 'Finance' }] };
    renderPage();
    await pickProject();
    const waiting = screen.getByTestId('plan-waiting-for');
    expect(waiting.textContent).toBe('Waiting for Ani, Finance');
    expect(waiting.textContent).not.toMatch(/step/i); // the plan is one decision: no invented "step 1 of 2"
    expect(h.routeCalls.at(-1)).toEqual(['pl1', true]);
  });

  it('AC-EQP-008 two eligible approvers of one role are joined, and the role is stated once', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeData = { kind: 'project', approvers: [{ id: 'u9', name: 'Ani', role: 'Finance' }, { id: 'u10', name: 'Budi', role: 'Finance' }] };
    renderPage();
    await pickProject();
    expect(screen.getByTestId('plan-waiting-for').textContent).toBe('Waiting for Ani or Budi, Finance');
  });

  it('AC-EQP-008 approvers of different roles are named without claiming one role for all of them', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeData = { kind: 'project', approvers: [{ id: 'u9', name: 'Ani', role: 'Finance' }, { id: 'u10', name: 'Budi', role: 'Project Manager' }] };
    renderPage();
    await pickProject();
    const text = screen.getByTestId('plan-waiting-for').textContent ?? '';
    expect(text).toBe('Waiting for Ani or Budi');
    expect(text).not.toMatch(/Finance|Project Manager/);
  });

  it('AC-EQP-008 a configured route with nobody eligible says so instead of naming a person', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeData = { kind: 'project', approvers: [] };
    renderPage();
    await pickProject();
    const text = screen.getByTestId('plan-waiting-for').textContent ?? '';
    expect(text).toBe('No one can approve this plan yet.');
    expect(text).not.toMatch(/Waiting for/);
  });

  it('AC-EQP-008 while the route is being read the plan keeps its own status and content', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routePending = true;
    renderPage();
    await pickProject();
    expect(screen.getByTestId('plan-waiting-for').textContent).toBe('Finding who this plan waits for…');
    expect(screen.getByText('Submitted')).toBeInTheDocument(); // the plan's own status is not replaced by the route
    expect(screen.getByTestId('plan-line')).toBeInTheDocument();
  });

  it('AC-EQP-008 a failed route read says so and offers a retry that refetches the same route', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeError = true;
    renderPage();
    await pickProject();
    expect(screen.getByText("Couldn't read who approves this plan")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.routeRefetch).toHaveBeenCalledTimes(1);
  });

  it('AC-EQP-008 an errored refetch never also prints the cached "no one can approve" answer', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeData = { kind: 'project', approvers: [] }; // the last successful answer, which TanStack keeps
    h.routeError = true; // ...while the refetch that raised on submit/approve failed
    renderPage();
    await pickProject();
    const waiting = screen.getByTestId('plan-waiting-for');
    expect(waiting.textContent).toContain("Couldn't read who approves this plan");
    expect(waiting.textContent).not.toContain('No one can approve this plan yet.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.routeRefetch).toHaveBeenCalledTimes(1);
  });

  it('AC-EQP-008 an errored refetch never also names the cached approver', async () => {
    h.plans = [plan({ status: 'Submitted', createdBy: 'someone-else' })];
    h.routeData = { kind: 'project', approvers: [{ id: 'u9', name: 'Ani', role: 'Finance' }] };
    h.routeError = true;
    renderPage();
    await pickProject();
    const text = screen.getByTestId('plan-waiting-for').textContent ?? '';
    expect(text).toContain("Couldn't read who approves this plan");
    expect(text).not.toContain('Waiting for Ani');
    expect(text).not.toContain('Finance');
  });

  it('AC-EQP-008 a plan that is not waiting asks for no route and says nothing about waiting', async () => {
    h.plans = [plan()]; // Draft
    renderPage();
    await pickProject();
    expect(screen.queryByTestId('plan-waiting-for')).not.toBeInTheDocument();
    expect(h.routeCalls.at(-1)).toEqual(['pl1', false]);
  });
});
