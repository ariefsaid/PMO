import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { InvoiceProjectModal } from './InvoiceProjectModal';

const invoice = (projectId: string | null): SalesInvoiceRow => ({
  id: 'invoice-1', project_id: projectId, si_number: 'SI-100',
} as unknown as SalesInvoiceRow);
const projects = [
  { value: 'project-1', label: 'Project One' },
  { value: 'project-2', label: 'Project Two' },
];
const renderModal = (props: Partial<React.ComponentProps<typeof InvoiceProjectModal>> = {}) => {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  const result = render(<InvoiceProjectModal invoice={invoice(null)} projects={projects}
    loadProjects={async () => projects} currentProjectName={null} loading={false}
    onClose={vi.fn()} onSave={onSave} {...props} />);
  return { ...result, onSave };
};

async function selectProject(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Project' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('InvoiceProjectModal', () => {
  it('AC-PFIN-009 requires an accessible project selection before saving', async () => {
    const { container, onSave } = renderModal();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled();
    await selectProject('Project One');
    expect(screen.getByRole('button', { name: 'Save project' })).toBeEnabled();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('project-1'));
  });

  it('AC-PFIN-009 keeps the selection after a rejected save and prevents concurrent saves', async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }))
      .mockRejectedValueOnce(new Error('retry failed'));
    renderModal({ onSave });
    await selectProject('Project Two');
    const save = screen.getByRole('button', { name: 'Save project' });
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    resolveSave();
  });

  it('AC-PFIN-009 asks before correcting an existing project and Cancel performs no write', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave });
    await selectProject('Project Two');
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'From Project One to Project Two. PMO attribution only; the ERP invoice is unchanged.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByText('Project Two')).toBeInTheDocument();
  });

  it('AC-PFIN-009 confirms a correction once and retains the selected project after failure for retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(Object.assign(new Error('refused'), { code: '42501' }))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave, onClose });
    await selectProject('Project Two');
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByText('Project Two')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
