import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { InvoiceProjectModal } from './InvoiceProjectModal';

const invoice = (projectId: string | null, billingKind: 'contract' | 'other' = 'contract'): SalesInvoiceRow => ({
  id: 'invoice-1', project_id: projectId, si_number: 'SI-100', billing_kind: billingKind,
} as unknown as SalesInvoiceRow);
const projects = [
  { value: 'project-1', label: 'Project One' },
  { value: 'project-2', label: 'Project Two' },
];
const localeI18n = createInstance();
const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as Record<string, unknown>;
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as Record<string, unknown>;
const enFinance = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/finance.json'), 'utf8')) as Record<string, unknown>;
const idFinance = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/finance.json'), 'utf8')) as Record<string, unknown>;
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
      resources: { en: { common: enCatalogue, finance: enFinance }, id: { common: idCatalogue, finance: idFinance } },
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
    // The billing kind select now sits right after the project: one more stop before Cancel and Save (deliberate, #1471).
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Billing kind' }));
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
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('project-1', 'contract'));
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
  it('AC-008 offers both billing kinds with an explanation and defaults a new choice to Contract billing', async () => {
    const user = userEvent.setup();
    renderModal();
    const kind = screen.getByRole('combobox', { name: 'Billing kind' });
    expect(kind).toHaveValue('contract');
    expect(within(kind).getByRole('option', { name: 'Contract billing' })).toBeInTheDocument();
    expect(within(kind).getByRole('option', { name: 'Other billing' })).toBeInTheDocument();
    expect(kind).toHaveAccessibleDescription(/reduces Remaining to invoice/);
    await user.selectOptions(kind, 'other');
    expect(kind).toHaveAccessibleDescription(/never reduces Remaining to invoice/);
  });

  it('AC-008 shows the saved kind when editing', () => {
    renderModal({ invoice: invoice('project-1', 'other'), currentProjectName: 'Project One' });
    expect(screen.getByRole('combobox', { name: 'Billing kind' })).toHaveValue('other');
  });

  it('AC-008 a kind-only change enables Save and saves without the project-change confirmation', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave, onClose });
    expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Billing kind' }), 'other');
    expect(screen.getByRole('button', { name: 'Save project' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('project-1', 'other'));
    expect(screen.queryByText(/From Project One to/)).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-008 Save stays disabled when neither project nor kind changed', () => {
    renderModal({ invoice: invoice('project-1', 'other'), currentProjectName: 'Project One' });
    expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled();
  });

  it('AC-008 blocks a duplicate submit while saving', async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onSave = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Billing kind' }), 'other');
    const save = screen.getByRole('button', { name: 'Save project' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox', { name: 'Billing kind' })).toBeDisabled();
    resolveSave();
  });

  it('AC-008 failure retains the project and kind and lets the user retry', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValueOnce(Object.assign(new Error('refused'), { code: '42501' })).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderModal({ onSave, onClose });
    await selectProject('Project Two');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Billing kind' }), 'other');
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Project Two')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Billing kind' })).toHaveValue('other');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenNthCalledWith(2, 'project-2', 'other');
  });

  it('AC-008 cancel persists nothing', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave, onClose });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Billing kind' }), 'other');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-008 locks the project for a native or PMO-authored invoice but keeps the kind editable', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderModal({ invoice: invoice('project-1'), currentProjectName: 'Project One', onSave, projectLocked: true });
    expect(screen.getByRole('dialog', { name: 'Change billing kind' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Billing kind' }), 'other');
    await user.click(screen.getByRole('button', { name: 'Save billing kind' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('project-1', 'other'));
  });

  it('AC-008 renders the billing kind control in Indonesian from the shipped catalogue, axe clean', async () => {
    await localeI18n.init({
      lng: 'id', fallbackLng: 'en', defaultNS: 'common',
      resources: { en: { common: enCatalogue, finance: enFinance }, id: { common: idCatalogue, finance: idFinance } },
      interpolation: { escapeValue: false }, react: { useSuspense: false },
    });
    const view = render(<I18nextProvider i18n={localeI18n}>
      <InvoiceProjectModal invoice={invoice('project-1', 'other')} projects={projects} loadProjects={async () => projects}
        currentProjectName="Project One" loading={false} onClose={vi.fn()} onSave={vi.fn().mockResolvedValue(undefined)} />
    </I18nextProvider>);
    const kind = screen.getByRole('combobox', { name: 'Jenis penagihan' });
    expect(within(kind).getByRole('option', { name: 'Penagihan kontrak' })).toBeInTheDocument();
    expect(within(kind).getByRole('option', { name: 'Penagihan lainnya' })).toBeInTheDocument();
    expect(screen.queryByText(/^(invoiceProject|finance:billingKind)\./)).not.toBeInTheDocument();
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
