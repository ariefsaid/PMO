import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
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
const localeI18n = createInstance();
const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as Record<string, unknown>;
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as Record<string, unknown>;
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
  it('AC-PFIN-009 renders Indonesian attribution and correction copy from the shipped catalogue', async () => {
    await localeI18n.init({
      lng: 'id', fallbackLng: 'en', defaultNS: 'common',
      resources: { en: { common: enCatalogue }, id: { common: idCatalogue } },
      interpolation: { escapeValue: false }, react: { useSuspense: false },
    });
    const user = userEvent.setup();
    const view = render(<I18nextProvider i18n={localeI18n}>
      <InvoiceProjectModal invoice={invoice('project-1')} projects={projects} loadProjects={async () => projects}
        currentProjectName="Project One" loading={false} onClose={vi.fn()} onSave={vi.fn().mockResolvedValue(undefined)} />
    </I18nextProvider>);
    expect(screen.getByRole('dialog', { name: 'Ubah proyek' })).toBeInTheDocument();
    // The subtitle composes "SI-100 · <scope>" into one text node — assert the scope copy within it.
    expect(screen.getByText('SI-100 · Hanya atribusi PMO; tagihan ERP tidak berubah.')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Proyek' }));
    await user.click(await screen.findByRole('option', { name: 'Project Two' }));
    await user.click(screen.getByRole('button', { name: 'Simpan proyek' }));
    expect(screen.getByRole('dialog', { name: 'Ubah proyek' })).toHaveAccessibleDescription(
      'Dari Project One ke Project Two. Hanya atribusi PMO; tagihan ERP tidak berubah.',
    );
    expect(screen.queryByText(/^(projectFinances|invoiceProject)\./)).not.toBeInTheDocument();
    expect(await axe(view.container)).toHaveNoViolations();
  });
  it('AC-PFIN-009 keeps selection through correction confirmation Escape and keyboard focus', async () => {
    const user = userEvent.setup();
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One' });
    await selectProject('Project Two');
    const selector = screen.getByRole('combobox', { name: 'Project' });
    selector.focus();
    expect(document.activeElement).toBe(selector);
    await user.tab();
    await user.tab();
    const save = screen.getByRole('button', { name: 'Save project' });
    expect(document.activeElement).toBe(save);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Change project' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByText('Project Two')).toBeInTheDocument();
  });

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
    const { container } = renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave, onClose });
    await selectProject('Project Two');
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByText('Project Two')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
