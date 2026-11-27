import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { StepTemplate } from '@/src/lib/db/billingSteps';

/** #2680 billing step templates (FR-CBS-001/051): the list with step counts and owner roles, archiving
 * and its failure, and the template form — validation, row add/remove/reorder, and the saved payload
 * (documents parsed per line, empty owner/target as null). */
const h = vi.hoisted(() => ({
  templates: { data: [] as StepTemplate[], isPending: false, isError: false },
  save: { mutateAsync: vi.fn(), isPending: false },
  archive: { mutateAsync: vi.fn(), isPending: false },
  defaultId: null as string | null,
  defaultState: { isPending: false, isError: false, refetch: vi.fn() },
  realRole: 'Admin' as string,
  setDefault: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));
vi.mock('@/src/hooks/useBillingSteps', () => ({
  useStepTemplates: () => h.templates,
  useStepTemplateMutations: () => ({ save: h.save, archive: h.archive }),
  useDefaultStepTemplate: () => ({ query: { data: h.defaultId, ...h.defaultState }, set: h.setDefault }),
}));
vi.mock('@/src/hooks/useRoleOptions', () => ({
  useRoleOptions: () => ({
    options: [{ value: 'Engineer', label: 'Engineer' }, { value: 'Project Manager', label: 'Project Manager' }],
    label: (r: string | null | undefined) => (r === 'Engineer' ? 'Engineer' : r === 'Project Manager' ? 'Project Manager' : r ?? ''),
  }),
}));

import BillingStepTemplatesModal from './BillingStepTemplatesModal';

const template = (o: Partial<StepTemplate> = {}): StepTemplate => ({
  id: 't1', name: 'Progress claim', steps: [
    { name: 'Mobilise', ownerRole: 'Project Manager', targetDays: 5, clientSide: false, optional: false, position: 0, documents: [{ name: 'Signed DPR', required: true }, { name: 'Photos', required: false }] },
    { name: 'Measure', ownerRole: null, targetDays: null, clientSide: true, optional: true, position: 1 },
  ],
  ...o,
});
const view = (onClose = vi.fn()) => {
  render(<ToastProvider><BillingStepTemplatesModal onClose={onClose} /></ToastProvider>);
  return onClose;
};

beforeEach(() => {
  h.templates = { data: [], isPending: false, isError: false };
  h.save = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  h.archive = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  h.defaultId = null;
  h.realRole = 'Admin';
  h.setDefault = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
});

describe('BillingStepTemplatesModal', () => {
  it('disables default changes while pending and offers retry after a failed default read', async () => {
    h.templates.data = [template()];
    h.defaultState.isPending = true;
    const view = render(<ToastProvider><BillingStepTemplatesModal onClose={vi.fn()} /></ToastProvider>);
    expect(screen.getByRole('button', { name: 'Use Progress claim for new work orders' })).toBeDisabled();
    h.defaultState.isPending = false;
    h.defaultState.isError = true;
    view.rerender(<ToastProvider><BillingStepTemplatesModal onClose={vi.fn()} /></ToastProvider>);
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(h.defaultState.refetch).toHaveBeenCalled();
    h.defaultState.isError = false;
    h.defaultId = 't1';
    view.rerender(<ToastProvider><BillingStepTemplatesModal onClose={vi.fn()} /></ToastProvider>);
    expect(screen.getByText('Used for new work orders')).toBeInTheDocument();
  });
  it('AC-WQE-006 Admin marks a template step for claim evidence', async () => {
    const user = userEvent.setup(); view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Template name'), 'Quality');
    await user.type(screen.getByLabelText('Step name'), 'Inspection');
    await user.click(screen.getByRole('checkbox', { name: 'Documents here count as claim evidence' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ name: 'Inspection', claimEvidenceEnabled: true })],
    })));
  });

  it('AC-WQE-007 Finance can reorder a marked step without changing its designation', async () => {
    h.realRole = 'Finance';
    const saved = template();
    saved.steps[0] = { ...saved.steps[0], templateStepId: 's1', claimEvidenceEnabled: true };
    saved.steps[1] = { ...saved.steps[1], templateStepId: 's2', claimEvidenceEnabled: false };
    h.templates = { data: [saved], isPending: false, isError: false };
    const user = userEvent.setup(); view();
    await user.click(screen.getByRole('button', { name: 'Edit Progress claim' }));
    const marks = screen.getAllByRole('checkbox', { name: 'Documents here count as claim evidence' });
    expect(marks[0]).toBeChecked();
    expect(marks[0]).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Measure up' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ templateStepId: 's2', claimEvidenceEnabled: false }),
        expect.objectContaining({ templateStepId: 's1', claimEvidenceEnabled: true })],
    })));
  });

  it('no templates yet says so', () => {
    view();
    expect(screen.getByText('No templates yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText('Close', { exact: true })).toBeInTheDocument();
  });

  it('a failed template load says so in place', () => {
    h.templates = { data: [], isPending: false, isError: true };
    view();
    expect(screen.getByText('The templates could not be loaded.')).toBeInTheDocument();
  });

  it('lists templates with step counts and the owner roles used inside', () => {
    h.templates = { data: [template()], isPending: false, isError: false };
    view();
    const row = screen.getByText('Progress claim').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('2 steps');
    expect(row).toHaveTextContent('Project Manager');
  });

  it('archives a template and reports a refusal in place', async () => {
    h.templates = { data: [template()], isPending: false, isError: false };
    h.archive.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Archive Progress claim' }));
    await waitFor(() => expect(h.archive.mutateAsync).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText('The template could not be archived.')).toBeInTheDocument();
  });

  it('a new template needs a name and at least one named step before anything is sent', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Add at least one step and name every step.')).toBeInTheDocument();
    expect(screen.getByText('Name the template.')).toBeInTheDocument();
    expect(h.save.mutateAsync).not.toHaveBeenCalled();
  });

  it('a step with a name but an empty template name is refused too', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getAllByLabelText('Step name')[0], 'Mobilise');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(screen.getByText('Name the template.')).toBeInTheDocument();
    expect(h.save.mutateAsync).not.toHaveBeenCalled();
  });

  it('an out-of-range target is named on the offending row and nothing is sent', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Template name'), 'Q1 steps');
    await user.type(screen.getAllByLabelText('Step name')[0], 'Mobilise');
    await user.type(screen.getByLabelText('Target (days)'), '400');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(screen.getByText('Enter 1 to 365 days, or leave it empty.')).toBeInTheDocument();
    expect(h.save.mutateAsync).not.toHaveBeenCalled();
  });

  it('a valid template saves the parsed steps: documents per line, empty owner/target as null', async () => {
    const user = userEvent.setup();
    const onClose = view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Template name'), 'Q1 steps');
    await user.type(screen.getAllByLabelText('Step name')[0], 'Mobilise');
    fireEvent.change(screen.getByLabelText('Owner role'), { target: { value: 'Project Manager' } });
    await user.type(screen.getByLabelText('Target (days)'), '5');
    await user.type(screen.getByLabelText('Required documents, one per line'), 'Signed DPR\nPhotos');
    await user.type(screen.getByLabelText('Optional documents, one per line'), 'Site diary');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith({
      templateId: null, name: 'Q1 steps',
      steps: [{ name: 'Mobilise', ownerRole: 'Project Manager', ownerRoleKey: null, hiddenFromRoleKeys: [], targetDays: 5, clientSide: false, optional: false, documents: [{ name: 'Signed DPR', required: true }, { name: 'Photos', required: true }, { name: 'Site diary', required: false }] }],
    }));
    // The template form returns to the template list; the page-level modal stays open.
    await waitFor(() => expect(screen.getByText('Close', { exact: true })).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a saved template keeps the flags and blank lines out of the documents', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Template name'), 'Q1');
    await user.type(screen.getAllByLabelText('Step name')[0], 'Measure');
    await user.click(screen.getByRole('checkbox', { name: "In the client's system" }));
    await user.click(screen.getByRole('checkbox', { name: 'Optional stage' }));
    await user.type(screen.getByLabelText('Required documents, one per line'), 'A\n\n \nB');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ name: 'Measure', clientSide: true, optional: true, documents: [{ name: 'A', required: true }, { name: 'B', required: true }] })],
    })));
  });

  it('editing a template prefills the name and rows, and saving updates that template', async () => {
    h.templates = { data: [template()], isPending: false, isError: false };
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Edit Progress claim' }));
    expect(screen.getByLabelText('Template name')).toHaveValue('Progress claim');
    expect(screen.getAllByLabelText('Step name')[0]).toHaveValue('Mobilise');
    await user.clear(screen.getByLabelText('Template name'));
    await user.type(screen.getByLabelText('Template name'), 'Progress claim v2');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', name: 'Progress claim v2' })));
  });

  it('an edited template keeps the target empty as null', async () => {
    h.templates = { data: [template()], isPending: false, isError: false };
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Edit Progress claim' }));
    const targets = screen.getAllByLabelText('Target (days)');
    await user.clear(targets[0]);
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ name: 'Mobilise', targetDays: null }), expect.objectContaining({ name: 'Measure' })],
    })));
  });

  it('steps can be added, removed and reordered', async () => {
    h.templates = { data: [template()], isPending: false, isError: false };
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Edit Progress claim' }));
    let names = screen.getAllByLabelText('Step name');
    expect(names).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    names = screen.getAllByLabelText('Step name');
    expect(names).toHaveLength(3);
    await user.type(names[2], 'Demobilise');
    await user.click(screen.getByRole('button', { name: 'Remove Demobilise' }));
    expect(screen.getAllByLabelText('Step name')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Move Measure up' }));
    expect(screen.getAllByLabelText('Step name').map((x) => (x as HTMLInputElement).value)).toEqual(['Measure', 'Mobilise']);
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ name: 'Measure' }), expect.objectContaining({ name: 'Mobilise' })],
    })));
  });

  it('Close dismisses the list modal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ToastProvider><BillingStepTemplatesModal onClose={onClose} /></ToastProvider>);
    await user.click(screen.getByText('Close', { exact: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-WBS-010 Finance chooses the default template for new work orders', async () => {
    const user = userEvent.setup();
    h.templates = { data: [{ id: 't1', name: 'Standard', steps: [{ position: 1, name: 'Survey' }] }], isPending: false, isError: false };
    h.defaultId = null;
  h.realRole = 'Admin';
    view();
    await user.click(screen.getByRole('button', { name: 'Use Standard for new work orders' }));
    expect(h.setDefault.mutateAsync).toHaveBeenCalledWith('t1');
  });

  it('AC-WBS-010 the default template shows as used and can be cleared', async () => {
    const user = userEvent.setup();
    h.templates = { data: [{ id: 't1', name: 'Standard', steps: [{ position: 1, name: 'Survey' }] }], isPending: false, isError: false };
    h.defaultId = 't1';
    view();
    expect(screen.getByTestId('default-step-template')).toHaveTextContent('Used for new work orders');
    await user.click(screen.getByRole('button', { name: 'Stop using Standard for new work orders' }));
    expect(h.setDefault.mutateAsync).toHaveBeenCalledWith(null);
  });

  it('AC-WBS-004 a step takes an owner role and a hidden-from role, and field roles are not offered', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Template name'), 'Roles');
    await user.type(screen.getAllByLabelText('Step name')[0], 'Certify');
    const owner = screen.getByLabelText('Owner on a work order');
    expect(Array.from(owner.querySelectorAll('option')).map((o) => o.getAttribute('value'))).not.toContain('foreman');
    expect(Array.from(owner.querySelectorAll('option')).map((o) => o.getAttribute('value'))).not.toContain('field_user');
    fireEvent.change(owner, { target: { value: 'quantity_surveyor' } });
    fireEvent.change(screen.getByLabelText('Hide this step from a role'), { target: { value: 'quality_manager' } });
    expect(screen.getByRole('button', { name: /Show to .* again/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ name: 'Certify', ownerRoleKey: 'quantity_surveyor', hiddenFromRoleKeys: ['quality_manager'] })],
    })));
  });

  it('a save or Close inside the modal does not submit the form it is opened from (the Billing terms modal stays open)', async () => {
    const user = userEvent.setup();
    const outerSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onClose = vi.fn();
    render(<ToastProvider><form onSubmit={outerSubmit}><BillingStepTemplatesModal onClose={onClose} /></form></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Template name'), 'Nested');
    await user.type(screen.getAllByLabelText('Step name')[0], 'One');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Close', { exact: true })).toBeInTheDocument());
    await user.click(screen.getByText('Close', { exact: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
