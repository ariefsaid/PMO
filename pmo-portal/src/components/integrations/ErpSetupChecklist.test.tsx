import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppError } from '@/src/lib/appError';
import type { ErpSetupReadiness, IntegrationsRepository } from '@/src/lib/repositories/types';

const repo = vi.hoisted(() => ({
  getErpSetup: vi.fn<IntegrationsRepository['getErpSetup']>(),
  getCompanyDefaultOptions: vi.fn<IntegrationsRepository['getCompanyDefaultOptions']>(),
  setCompanyDefaults: vi.fn<IntegrationsRepository['setCompanyDefaults']>(),
  getConnectStatus: vi.fn(async () => ({ run: null, census: [], waitingForSend: 0 })),
  listConnectProposals: vi.fn(async () => ({ proposals: [], nextAfterId: null })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: repo } }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: vi.fn() }));

import { wrapWithRole } from './IntegrationsView.test-helpers';
import { ErpSetupChecklist } from './ErpSetupChecklist';

const readiness = (defaults: Partial<ErpSetupReadiness['defaults']>): ErpSetupReadiness => ({
  defaults: { company: 'Example Co', default_activity_type: 'Delivery', default_receivable_account: 'Debtors', ...defaults },
  domains: ['companies'], unmappedProjects: [], budgetMappedCategories: [], unlinkedEmployeeCount: 0,
});
const OPTIONS = {
  company: 'Example Co',
  options: { payable: ['Creditors'], expense: ['Cost of Goods Sold', 'Site Costs'], cash: ['Cash'], bank: ['Bank A'], cost_centre: ['Main'] },
  pending: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.getCompanyDefaultOptions.mockResolvedValue(OPTIONS);
});

describe('ERP company accounts set from PMO (#1599 ECX-3)', () => {
  it('ECX3-T6 an Admin chooses a missing default from accounts of its kind and only the changed default is sent', async () => {
    repo.getErpSetup
      .mockResolvedValueOnce(readiness({ default_expense_account: 'Cost of Goods Sold', default_cash_account: 'Cash', default_bank_account: 'Bank A', cost_center: 'Main', default_payable_account: null }))
      .mockResolvedValue(readiness({ default_expense_account: 'Cost of Goods Sold', default_cash_account: 'Cash', default_bank_account: 'Bank A', cost_center: 'Main', default_payable_account: 'Creditors' }));
    repo.setCompanyDefaults.mockResolvedValue({ ok: true, written: ['payable'], defaults: { payable: 'Creditors', expense: 'Cost of Goods Sold', cash: 'Cash', bank: 'Bank A', cost_centre: 'Main' } });
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    const payable = await within(dialog).findByRole('combobox', { name: 'Vendor payable account' });
    expect(within(payable).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Creditors']);
    expect(within(dialog).getByRole('combobox', { name: 'Default expense account' })).toHaveValue('Cost of Goods Sold');
    fireEvent.change(payable, { target: { value: 'Creditors' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save company accounts' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Company accounts' })).not.toBeInTheDocument());
    expect(repo.setCompanyDefaults).toHaveBeenCalledWith({ payable: 'Creditors' });
    await waitFor(() => expect(document.getElementById('erp-setup-company-defaults')).toHaveAttribute('hidden'));
    expect(repo.getErpSetup).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/in the ERP/i)).not.toBeInTheDocument();
  });

  it('ECX3-T6 a refusal is shown in plain words and the dialog stays open with the choice kept', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    repo.setCompanyDefaults.mockRejectedValue(new AppError('Creditors belongs to another company, so it cannot be the vendor payable account.', 'config-rejected'));
    wrapWithRole('Finance', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Vendor payable account' }), { target: { value: 'Creditors' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save company accounts' }));

    expect(await within(dialog).findByText('Creditors belongs to another company, so it cannot be the vendor payable account.')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Vendor payable account' })).toHaveValue('Creditors');
  });

  it('ECX3-T6 an unexpected failure shows a generic message, never the raw error', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    repo.setCompanyDefaults.mockRejectedValue(new AppError('upstream detail', 'INTERNAL'));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Vendor payable account' }), { target: { value: 'Creditors' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save company accounts' }));
    expect(await within(dialog).findByText('Could not set the company accounts. Try again.')).toBeInTheDocument();
    expect(within(dialog).queryByText('upstream detail')).not.toBeInTheDocument();
  });

  it('ECX3-T6 Save is disabled while a request for the connection is still being saved', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    repo.getCompanyDefaultOptions.mockResolvedValue({ ...OPTIONS, pending: true });
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Vendor payable account' }), { target: { value: 'Creditors' } });
    expect(within(dialog).getByRole('button', { name: 'Save company accounts' })).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent('A change to the company accounts is still being saved. Reload in a few minutes to see it.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save company accounts' }));
    expect(repo.setCompanyDefaults).not.toHaveBeenCalled();
  });

  it('ECX3-T6 Save is disabled while this person\'s own save is on its way, so it is sent once', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    let finish: (v: Awaited<ReturnType<IntegrationsRepository['setCompanyDefaults']>>) => void = () => {};
    repo.setCompanyDefaults.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Vendor payable account' }), { target: { value: 'Creditors' } });
    const save = within(dialog).getByRole('button', { name: 'Save company accounts' });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent.click(save);
    expect(repo.setCompanyDefaults).toHaveBeenCalledTimes(1);
    finish({ ok: true, written: ['payable'], defaults: { payable: 'Creditors', expense: null, cash: null, bank: null, cost_centre: null } });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Company accounts' })).not.toBeInTheDocument());
  });

  it('ECX3-T6 a company with no bank account yet says so and points to creating one', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_bank_account: null }));
    repo.getCompanyDefaultOptions.mockResolvedValue({ ...OPTIONS, options: { ...OPTIONS.options, bank: [] } });
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    const bank = await within(dialog).findByRole('combobox', { name: 'Bank account' });
    expect(within(bank).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…']);
    expect(bank).toHaveAccessibleDescription('The company has no bank account yet, so there is none to choose. Create the bank account first; it is then listed here.');
    expect(within(dialog).getByRole('combobox', { name: 'Cash account' })).not.toHaveAccessibleDescription(/no bank account/);
  });

  it('ECX3-T6 without a chosen company the accounts cannot be set yet; the company is chosen first', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ company: null }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Review company settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set company accounts' })).not.toBeInTheDocument();
  });
});
