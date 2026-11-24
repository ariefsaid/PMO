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
  effectiveRole: null as string | null,
  key: 'billing_officer' as string | null,
  steps: undefined as unknown,
  state: { isError: false, refetch: vi.fn() },
  complete: vi.fn(),
  skip: vi.fn(),
  assign: vi.fn(),
  attach: vi.fn(),
  add: vi.fn(),
  saveAsTemplate: vi.fn(),
  save: vi.fn(),
  checklistEnabled: true,
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.effectiveRole ?? h.role }) }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.checklistEnabled }) }));

vi.mock('@/src/hooks/useBillingSteps', () => ({
  useWorkOrderSteps: () => ({ data: h.steps, ...h.state }),
  useWorkOrderStepMutations: () => ({
    complete: { mutateAsync: h.complete, isPending: false }, skip: { mutateAsync: h.skip, isPending: false },
    assign: { mutateAsync: h.assign, isPending: false }, attach: { mutateAsync: h.attach, isPending: false },
    add: { mutateAsync: h.add, isPending: false }, saveAsTemplate: { mutateAsync: h.saveAsTemplate, isPending: false },
  }),
  useStepTemplateMutations: () => ({
    save: { mutateAsync: h.save, isPending: false }, saveWorkOrder: { mutateAsync: h.saveAsTemplate, isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
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
vi.mock('@/src/lib/refusals', () => ({
  useRefusalLine: () => (e: unknown) => `refused: ${(e as Error).message}`,
  useRefusalText: () => (e: unknown) => ({ known: false, headline: `refused: ${(e as Error).message}`, detail: '' }),
}));
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
  h.effectiveRole=null; h.role = 'Finance'; h.key = 'billing_officer'; h.steps = steps(); h.checklistEnabled = true; h.state = { isError: false, refetch: vi.fn() };
  for (const f of [h.complete, h.skip, h.assign, h.attach, h.add, h.saveAsTemplate, h.save]) f.mockReset().mockResolvedValue(undefined);

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

  describe('editing the list (wo-checklist-edit.spec.md)', () => {
    it('AC-WCE-001 a runner adds a step: its name, owner role and place go to the database, and the form closes', async () => {
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      await user.type(screen.getByLabelText('Step name'), 'Joint survey sign-off');
      await user.selectOptions(screen.getByLabelText('Owner role'), 'quantity_surveyor');
      expect(screen.getByLabelText('Position')).toHaveValue('2');
      await user.selectOptions(screen.getByLabelText('Position'), '3');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(h.add).toHaveBeenCalledWith({ workOrderId: 'w1', afterPosition: 3, step: { name: 'Joint survey sign-off', ownerRoleKey: 'quantity_surveyor' } });
      expect(screen.queryByLabelText('Step name')).not.toBeInTheDocument();
    });

    it('AC-WCE-005 a step is offered a place after the current step or later, never before it', async () => {
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      const options = within(screen.getByLabelText('Position')).getAllByRole('option').map((o) => [o.getAttribute('value'), o.textContent]);
      expect(options).toEqual([['2', 'After Step two'], ['3', 'After Step three']]);
      expect(within(screen.getByLabelText('Owner role')).getAllByRole('option').map((o) => o.textContent)).not.toContain('role:foreman');
    });

    it('AC-WCE-001 a step without a name is not sent, and Cancel closes the form', async () => {
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
      await user.type(screen.getByLabelText('Step name'), '   ');
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Step name')).not.toBeInTheDocument();
    });

    it('AC-WCE-001 a list with nothing open offers one place, the end; a step without an owner role carries only its name', async () => {
      h.steps = [step({ id: 's1', position: 1, name: 'Done long ago', startedOn: '2026-03-01', doneOn: '2026-03-03' })];
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
      await user.type(screen.getByLabelText('Step name'), 'Archive note');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(h.add).toHaveBeenCalledWith({ workOrderId: 'w1', afterPosition: null, step: { name: 'Archive note', ownerRoleKey: null } });
    });

    it('AC-WCE-005 a hidden finished tail is appended after by sending the end sentinel, not the visible row count', async () => {
      h.steps = [
        step({ id: 's1', position: 1, name: 'Plan', startedOn: '2026-03-01', doneOn: '2026-03-03' }),
        step({ id: 's3', position: 3, name: 'Report', startedOn: '2026-03-04', doneOn: '2026-03-05' }),
      ];
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      await user.type(screen.getByLabelText('Step name'), 'Close-out note');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(h.add).toHaveBeenCalledWith({ workOrderId: 'w1', afterPosition: null, step: { name: 'Close-out note', ownerRoleKey: null } });
    });

    it('AC-WCE-003 the refusal sentence shows and the typed step stays when the database refuses', async () => {
      h.add.mockRejectedValue(new AppError('WBS_STEP_CLOSED: a new step goes after the current step', '55000'));
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      await user.type(screen.getByLabelText('Step name'), 'Too early');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('refused: WBS_STEP_CLOSED: a new step goes after the current step');
      expect(screen.getByLabelText('Step name')).toHaveValue('Too early');
    });

    it('AC-WCE-003 a reader who may not run the checklist sees no way to add a step', () => {
      h.key = 'quality_manager'; h.role = 'Project Manager';
      renderIt();
      expect(screen.queryByRole('button', { name: 'Add step' })).not.toBeInTheDocument();
    });

    it('AC-WCE-006 existing organisations see neither checklist edit action while the setting is off', () => {
      h.checklistEnabled = false;
      renderIt();
      expect(screen.queryByRole('button', { name: 'Add step' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
    });

    it('AC-WBS-007 steps cannot be added once the work order is no longer issued; the finished list can still be saved as a template', () => {
      renderIt({ status: 'Closed' });
      expect(screen.queryByRole('button', { name: 'Add step' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save as template' })).toBeInTheDocument();
    });

    it('AC-WCE-002 Save as template sends the list in order with its owner job roles and checklist slots, then says it saved', async () => {
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Save as template' }));
      expect(screen.getByText('3 steps, in this order, with their owner roles.')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Template name'), 'Remote site');
      await user.click(screen.getByRole('button', { name: 'Save template' }));
      expect(h.saveAsTemplate).toHaveBeenCalledWith({ workOrderId: 'w1', name: 'Remote site' });
      expect(h.save).not.toHaveBeenCalled();
      expect(await screen.findByRole('status')).toHaveTextContent('Saved as template "Remote site".');
      expect(screen.queryByLabelText('Template name')).not.toBeInTheDocument();
    });

    it('AC-WCE-002 a template without a name is not saved', async () => {
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Save as template' }));
      expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
      await user.type(screen.getByLabelText('Template name'), '   ');
      expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
    });

    it('AC-WCE-002 a name an active template already uses is said to be taken', async () => {
      h.saveAsTemplate.mockRejectedValue(new AppError('WBS_TEMPLATE_TAKEN: an active template with this name already exists', '23505'));
      const user = renderIt();
      await user.click(screen.getByRole('button', { name: 'Save as template' }));
      await user.type(screen.getByLabelText('Template name'), 'WCE template');
      await user.click(screen.getByRole('button', { name: 'Save template' }));
      expect(await screen.findByText('A template with this name already exists. Choose another name.')).toBeInTheDocument();
      expect(h.save).not.toHaveBeenCalled();
    });

    it('AC-WCE-002 only Finance or an Admin can save a template; anyone who runs the steps can add one', () => {
      h.role = 'Project Manager'; h.key = 'project_manager';
      renderIt();
      expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add step' })).toBeInTheDocument();
    });

    it('AC-WCE-002 nothing is saved from an empty list, but its first step can be added and a refusal there is shown', async () => {
      h.steps = [];
      h.add.mockRejectedValue(new AppError("WBS_STEP_ADD_PM: only the project's manager can add a step to this checklist", '42501'));
      const user = renderIt();
      expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
      expect(screen.getByTestId('wo-billing-steps-empty')).toHaveTextContent('No billing steps to show');
      await user.click(screen.getByRole('button', { name: 'Add step' }));
      await user.type(screen.getByLabelText('Step name'), 'Kick-off record');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(h.add).toHaveBeenCalledWith({ workOrderId: 'w1', afterPosition: null, step: { name: 'Kick-off record', ownerRoleKey: null } });
      expect(await screen.findByRole('alert')).toHaveTextContent('refused: WBS_STEP_ADD_PM');
    });
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

it('AC-SITE-BQ10 an Admin viewing as an Engineer cannot attach extra evidence', () => {
 h.role='Admin'; h.effectiveRole='Engineer';
 h.steps=[step({id:'quality',position:1,name:'Quality',startedOn:'2026-03-10',documents:[]})];
 renderIt();
 expect(screen.queryByRole('combobox',{name:'Additional document'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Attach additional document'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Add step'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Save as template'})).not.toBeInTheDocument();
 expect(h.attach).not.toHaveBeenCalled();
});
