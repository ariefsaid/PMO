import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderStep } from '@/src/lib/db/workOrderBillingSteps';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  key: 'billing_officer' as string | null,
  steps: undefined as unknown,
  state: { isError: false, refetch: vi.fn() },
  complete: vi.fn(),
  skip: vi.fn(),
  assign: vi.fn(),
  attach: vi.fn(),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role }) }));
vi.mock('@/src/hooks/useBillingSteps', () => ({
  useWorkOrderSteps: () => ({ data: h.steps, ...h.state }),
  useWorkOrderStepMutations: () => ({
    complete: { mutateAsync: h.complete, isPending: false }, skip: { mutateAsync: h.skip, isPending: false },
    assign: { mutateAsync: h.assign, isPending: false }, attach: { mutateAsync: h.attach, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [{ id: 'd1', title: 'Survey sheet A', status: 'Approved', file_path: 'o/p/d1/f.pdf' }, { id: 'd2', title: 'Draft note', status: 'Draft', file_path: 'x' }], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [
    { id: 'u1', full_name: 'Dewi Survey', status: 'active', built_in_role: 'quantity_surveyor' },
    { id: 'u2', full_name: 'Field Foreman', status: 'active', built_in_role: 'foreman' },
    { id: 'u3', full_name: 'Gone Person', status: 'inactive', built_in_role: 'engineer' },
  ] }),
}));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useBuiltInRoleName: () => (k: string) => `role:${k}` }));
vi.mock('@/src/lib/refusals', () => ({ useRefusalLine: () => (e: unknown) => `refused: ${(e as Error).message}` }));
import { BillingStepsSection } from './BillingStepsSection';

const step = (p: Partial<WorkOrderStep> & Pick<WorkOrderStep, 'id' | 'position' | 'name'>): WorkOrderStep => ({
  workOrderId: 'w1', projectId: 'p1', ownerRoleKey: null, assigneeId: null, assigneeName: null, targetDays: null, optional: false,
  startedOn: null, doneOn: null, skippedOn: null, documents: [], ...p,
});
const steps = (): WorkOrderStep[] => [
  step({ id: 's1', position: 1, name: 'Step one', ownerRoleKey: 'quantity_surveyor', assigneeName: 'Dewi Survey', targetDays: 3, startedOn: '2026-03-01', doneOn: '2026-03-03',
    documents: [{ id: 'x1', position: 1, name: 'Sheet', required: true, documentId: 'd1' }] }),
  step({ id: 's2', position: 2, name: 'Step two', ownerRoleKey: 'billing_officer', targetDays: 2, startedOn: '2026-03-03',
    documents: [{ id: 'x2', position: 1, name: 'Pack', required: true, documentId: null }] }),
  step({ id: 's3', position: 3, name: 'Step three', optional: true }),
];

function renderIt(props: Partial<React.ComponentProps<typeof BillingStepsSection>> = {}) {
  const auth = { currentUser: { id: 'me', built_in_role: h.key } } as unknown as AuthContextValue;
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><MemoryRouter>
    <BillingStepsSection workOrderId="w1" projectId="p1" status="Issued" today="2026-03-11" {...props} /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
  return userEvent.setup();
}

beforeEach(() => {
  h.role = 'Finance'; h.key = 'billing_officer'; h.steps = steps(); h.state = { isError: false, refetch: vi.fn() };
  for (const f of [h.complete, h.skip, h.assign, h.attach]) f.mockReset().mockResolvedValue(undefined);
});

describe('BillingStepsSection', () => {
  it('AC-WBS-012 shows the chain: step, role, person, target, status, documents', () => {
    renderIt();
    const rows = within(screen.getByRole('list', { name: 'Billing steps' })).getAllByTestId('wo-billing-step');
    expect(rows.map((li) => li.getAttribute('aria-label'))).toEqual(['Step one', 'Step two', 'Step three']);
    expect(within(rows[0]).getByText('Done 3 Mar 2026')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/role:quantity_surveyor · Dewi Survey · Target 3 days/)).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Survey sheet A' })).toHaveAttribute('href', '/projects/p1/documents?open=d1');
    expect(within(rows[1]).getByText('Current')).toBeInTheDocument();
    expect(within(rows[1]).getByText('6 days past target')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Not yet open')).toBeInTheDocument();
    expect(screen.getByTestId('wo-billing-steps-summary')).toHaveTextContent('2 steps not finished');
    expect(screen.getByTestId('wo-billing-steps-summary')).toHaveTextContent('does not block invoicing');
  });

  it('AC-WBS-002 with no list says who chooses the template', () => {
    h.steps = [];
    renderIt();
    expect(screen.getByTestId('wo-billing-steps-empty')).toHaveTextContent('Admin or a Finance person chooses that template');
  });

  it('a Draft work order shows nothing', () => {
    renderIt({ status: 'Draft' });
    expect(screen.queryByText('Billing steps')).not.toBeInTheDocument();
  });

  it('AC-WBS-005 a runner marks the current step done only once its required document is attached, and is told why', async () => {
    const user = renderIt();
    const done = screen.getByRole('button', { name: 'Mark Step two done' });
    expect(done).toBeDisabled();
    expect(screen.getByText('Attach every required document before marking this step done.')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Document for Pack' }), 'd1');
    await user.click(screen.getByRole('button', { name: 'Attach to Pack' }));
    expect(h.attach).toHaveBeenCalledWith({ stepId: 's2', slotId: 'x2', documentId: 'd1' });
  });

  it('AC-WBS-005 the person list offers active full accounts only', () => {
    renderIt();
    const options = within(screen.getByRole('combobox', { name: 'Person on this step' })).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Dewi Survey');
    expect(options).not.toContain('Field Foreman');
    expect(options).not.toContain('Gone Person');
  });

  it('AC-WBS-005 a reader who is not the owner, the named person or a runner sees no controls', () => {
    h.key = 'quality_manager'; h.role = 'Project Manager';
    renderIt();
    expect(screen.queryByRole('button', { name: /Mark .* done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Person on this step' })).not.toBeInTheDocument();
  });

  it('AC-WBS-006 shows the refusal sentence when the database refuses', async () => {
    h.steps = [step({ id: 's9', position: 1, name: 'Only', ownerRoleKey: 'billing_officer', startedOn: '2026-03-10' })];
    h.complete.mockRejectedValue(new AppError('WBS_DATE_FUTURE: nope', '22023'));
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Mark Only done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('refused: WBS_DATE_FUTURE: nope');
  });

  it('an optional current step can be skipped', async () => {
    h.steps = [step({ id: 's8', position: 1, name: 'Maybe', optional: true, ownerRoleKey: 'billing_officer', startedOn: '2026-03-10' })];
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Skip Maybe' }));
    expect(h.skip).toHaveBeenCalledWith('s8');
  });
});

it('AC-SITE-BQ10 an inspector files evidence on an owned step with no template slots', async () => {
 h.role='Engineer'; h.key='quality_inspector';
 h.steps=[step({id:'quality',position:1,name:'Quality',ownerRoleKey:'quality_inspector',startedOn:'2026-03-10',documents:[]})];
 const user=renderIt();
 await user.selectOptions(screen.getByRole('combobox',{name:'Additional document'}),'d1');
 await user.click(screen.getByRole('button',{name:'Attach additional document'}));
 expect(h.attach).toHaveBeenCalledWith({stepId:'quality',slotId:null,documentId:'d1'});
});
