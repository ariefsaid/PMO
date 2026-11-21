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
}));
vi.mock('@/src/hooks/useBillingSteps', () => ({
  useStepTemplates: () => h.templates,
  useStepTemplateMutations: () => ({ save: h.save, archive: h.archive }),
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
});

describe('BillingStepTemplatesModal', () => {
  it('no templates yet says so', () => {
    view();
    expect(screen.getByText('No templates yet.')).toBeInTheDocument();
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
      steps: [{ name: 'Mobilise', ownerRole: 'Project Manager', targetDays: 5, clientSide: false, optional: false, documents: [{ name: 'Signed DPR', required: true }, { name: 'Photos', required: true }, { name: 'Site diary', required: false }] }],
    }));
    // The template form returns to the template list; the page-level modal stays open.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument());
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

  it('Done closes the list modal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ToastProvider><BillingStepTemplatesModal onClose={onClose} /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
