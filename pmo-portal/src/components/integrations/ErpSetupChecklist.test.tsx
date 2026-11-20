import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImpersonationProvider } from '@/src/auth/impersonation';
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

const readiness = (
  defaults: Partial<ErpSetupReadiness['defaults']>,
  extra: Partial<ErpSetupReadiness> = {},
): ErpSetupReadiness => ({
  defaults: { company: 'Example Co', default_activity_type: 'Delivery', default_receivable_account: 'Debtors', ...defaults },
  domains: ['companies'], unmappedProjects: [], budgetMappedCategories: [], unlinkedEmployeeCount: 0,
  ...extra,
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

const catalogue = (lng: string, ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));

async function renderIndonesian(ui: React.ReactElement) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'id', fallbackLng: 'en', defaultNS: 'common', ns: ['common', 'administration'],
    resources: {
      en: { common: catalogue('en', 'common'), administration: catalogue('en', 'administration') },
      id: { common: catalogue('id', 'common'), administration: catalogue('id', 'administration') },
    },
    interpolation: { escapeValue: false },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <ImpersonationProvider realRole={'Admin'}>
          <MemoryRouter>{ui}</MemoryRouter>
        </ImpersonationProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** Every refusal the set-company-defaults path can return in plain words (migration 0910, the setup function, the adapter seam). */
const REFUSALS: ReadonlyArray<[string, string, string]> = [
  ['BAD_REQUEST', 'Creditors is not in the ERP chart PMO has read, so it cannot be the vendor payable account. Refresh the list and choose again.',
    'Creditors tidak ada dalam bagan akun ERP yang dibaca PMO, jadi tidak dapat menjadi akun utang vendor. Muat ulang daftar lalu pilih lagi.'],
  ['BAD_REQUEST', 'Creditors belongs to another company, so it cannot be the vendor payable account.',
    'Creditors milik perusahaan lain, jadi tidak dapat menjadi akun utang vendor.'],
  ['config-rejected', 'Creditors is a group, so it cannot be the vendor payable account. Choose an account or cost centre under it.',
    'Creditors adalah grup, jadi tidak dapat menjadi akun utang vendor. Pilih akun atau pusat biaya di bawahnya.'],
  ['BAD_REQUEST', 'Main is disabled, so it cannot be the cost centre.', 'Main dinonaktifkan, jadi tidak dapat menjadi pusat biaya.'],
  ['BAD_REQUEST', 'Creditors is not a payable account, so it cannot be the vendor payable account.',
    'Creditors bukan akun utang, jadi tidak dapat menjadi akun utang vendor.'],
  ['BAD_REQUEST', 'Cash is not a cash account, so it cannot be the cash account.', 'Cash bukan akun kas, jadi tidak dapat menjadi akun kas.'],
  ['BAD_REQUEST', 'Bank A is not a bank account, so it cannot be the bank account.', 'Bank A bukan akun bank, jadi tidak dapat menjadi akun bank.'],
  ['config-rejected', 'Site Costs is not an expense account, so it cannot be the default expense account.',
    'Site Costs bukan akun beban, jadi tidak dapat menjadi akun beban default.'],
  ['BAD_REQUEST', 'Connect the ERP and choose its company first.', 'Hubungkan ERP dan pilih perusahaannya terlebih dahulu.'],
  ['BAD_REQUEST', 'Choose at least one company default.', 'Pilih setidaknya satu akun perusahaan.'],
  ['BAD_REQUEST', 'Unknown company default: payables.', 'Akun perusahaan tidak dikenal: payables.'],
  ['BAD_REQUEST', 'Choose a value for every company default you change.', 'Pilih nilai untuk setiap akun perusahaan yang Anda ubah.'],
  ['BAD_REQUEST', 'Setting company defaults from PMO is not available for this ERP yet', 'Akun perusahaan belum dapat diatur dari PMO untuk ERP ini.'],
  ['config-rejected', 'The ERP connection changed; reload and try again', 'Koneksi ERP berubah; muat ulang lalu coba lagi.'],
  ['config-rejected', 'The ERP refused this change.', 'ERP menolak perubahan ini.'],
  ['config-rejected', 'The ERP company could not be read back, so nothing was recorded. Try again.',
    'Perusahaan di ERP tidak dapat dibaca ulang, jadi tidak ada yang dicatat. Coba lagi.'],
  ['config-rejected', 'The ERP did not keep every chosen default, so nothing was recorded. Try again.',
    'ERP tidak menyimpan semua akun yang dipilih, jadi tidak ada yang dicatat. Coba lagi.'],
  ['config-rejected', 'A newer change to the company accounts was saved for this connection, so this one was not recorded.',
    'Perubahan akun perusahaan yang lebih baru sudah disimpan untuk koneksi ini, jadi perubahan ini tidak dicatat.'],
  ['config-rejected', 'The ERP connection changed while this was being set, so nothing was recorded.',
    'Koneksi ERP berubah saat perubahan ini sedang diatur, jadi tidak ada yang dicatat.'],
  ['config-rejected', 'The change was not recorded. Try again.', 'Perubahan tidak dicatat. Coba lagi.'],
  // The ERP's own words (cleaned server-side) are English text PMO cannot translate: Indonesian says the ERP refused.
  ['config-rejected', 'Account Creditors is frozen for posting by the period closing voucher.', 'ERP menolak perubahan ini.'],
];

/** English words that cannot appear in an Indonesian sentence (record names such as "Creditors" are data, not words). */
const ENGLISH = /\b(the|so|cannot|is|not|be|was|choose|try|again|nothing|account|company|refused|could|set|saved|reload|first)\b/i;

describe('ERP company accounts in Indonesian (#1599 ECX-3 critique)', () => {
  it.each(REFUSALS)('ECX3-T6 a %s refusal reads in Indonesian under "Akun perusahaan tidak dapat diatur.": %s', async (code, english, indonesian) => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    repo.setCompanyDefaults.mockRejectedValue(new AppError(english, code));
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Atur akun perusahaan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Akun perusahaan' });
    fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Akun utang vendor' }), { target: { value: 'Creditors' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan akun perusahaan' }));

    const alert = await within(dialog).findByTestId('entity-modal-save-error');
    expect(within(alert).getByText('Akun perusahaan tidak dapat diatur.')).toBeInTheDocument();
    expect(within(alert).getByText(indonesian)).toBeInTheDocument();
    expect(alert.textContent).not.toContain(english);
    expect(alert.textContent).not.toMatch(ENGLISH);
  });
});

describe('ERP company account lists that fail to load (#1599 ECX-3 critique)', () => {
  it('ECX3-T6 a failed list load offers Retry; Retry loads the lists and Save then works', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    repo.getCompanyDefaultOptions.mockRejectedValueOnce(new AppError('The ERP could not be reached; try again.', 'external-unreachable'));
    repo.setCompanyDefaults.mockResolvedValue({ ok: true, written: ['payable'], defaults: { payable: 'Creditors', expense: null, cash: null, bank: null, cost_centre: null } });
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    const retry = await within(dialog).findByRole('button', { name: 'Try again' });
    expect(within(dialog).getByText('Could not read the account lists.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save company accounts' })).toBeDisabled();

    fireEvent.click(retry);
    const payable = await within(dialog).findByRole('combobox', { name: 'Vendor payable account' });
    expect(repo.getCompanyDefaultOptions).toHaveBeenCalledTimes(2);
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    fireEvent.change(payable, { target: { value: 'Creditors' } });
    const save = within(dialog).getByRole('button', { name: 'Save company accounts' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(repo.setCompanyDefaults).toHaveBeenCalledWith({ payable: 'Creditors' }));
  });

  it('ECX3-T6 in Indonesian the failed list load and its Retry read in Indonesian', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({ default_payable_account: null }));
    repo.getCompanyDefaultOptions.mockRejectedValueOnce(new AppError('x', 'external-unreachable'));
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Atur akun perusahaan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Akun perusahaan' });
    expect(await within(dialog).findByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
    expect(within(dialog).getByText('Daftar akun tidak dapat dibaca.')).toBeInTheDocument();
  });

  it('ECX3-T6 the full name of a long chosen account stays readable (the closed picker carries it as its title)', async () => {
    const long = 'Bank Account Held At A Very Long Named Regional Development Bank Branch - EC';
    repo.getErpSetup.mockResolvedValue(readiness({ default_bank_account: long }));
    repo.getCompanyDefaultOptions.mockResolvedValue({ ...OPTIONS, options: { ...OPTIONS.options, bank: [long] } });
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    // The row is complete only when every default is set; open the dialog through a missing one.
    fireEvent.click(await screen.findByRole('button', { name: 'Set company accounts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Company accounts' });
    expect(await within(dialog).findByRole('combobox', { name: 'Bank account' })).toHaveAttribute('title', long);
  });
});

describe('Next fiscal year operator task notice (#1599 ECX-5)', () => {
  it('hides the fiscal year line when fiscalYear is null, ready, or not-due', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: null }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).toHaveAttribute('hidden'));

    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'ready', next: '2027' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).toHaveAttribute('hidden'));

    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'not-due' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).toHaveAttribute('hidden'));
  });

  it('unhides and renders missing-role in English and Indonesian', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'needs-operator', reason: 'missing-role' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemEn = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemEn).getByText('Next fiscal year')).toBeInTheDocument();
    expect(within(itemEn).getByText('Operator task: the integration user needs the role that creates fiscal years. We do this at onboarding; nothing is needed from you.')).toBeInTheDocument();

    cleanup();
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemId = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemId).getByText('Tahun fiskal berikutnya')).toBeInTheDocument();
    expect(within(itemId).getByText('Tugas Operator: pengguna integrasi memerlukan peran yang dapat membuat tahun fiskal. Kami menyiapkannya saat penyiapan awal; Anda tidak perlu melakukan apa pun.')).toBeInTheDocument();
  });

  it('unhides and renders no-current-year in English and Indonesian', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'needs-operator', reason: 'no-current-year' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemEn = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemEn).getByText('Operator task: the ERP has no fiscal year for today, so PMO cannot tell when the next one starts. We do this at onboarding; nothing is needed from you.')).toBeInTheDocument();

    cleanup();
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemId = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemId).getByText('Tugas Operator: ERP belum memiliki tahun fiskal untuk hari ini, sehingga PMO tidak dapat menentukan kapan tahun berikutnya dimulai. Kami menyiapkannya saat penyiapan awal; Anda tidak perlu melakukan apa pun.')).toBeInTheDocument();
  });

  it('unhides and renders disabled-year in English and Indonesian with year interpolation', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'needs-operator', reason: 'disabled-year', year: '2027' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemEn = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemEn).getByText('Operator task: a disabled fiscal year with these dates exists (2027). PMO does not switch it back on; we will resolve it, nothing is needed from you.')).toBeInTheDocument();

    cleanup();
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemId = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemId).getByText('Tugas Operator: ada tahun fiskal nonaktif dengan tanggal yang sama (2027). PMO tidak mengaktifkannya kembali; kami akan menyelesaikannya, Anda tidak perlu melakukan apa pun.')).toBeInTheDocument();
  });

  it('unhides and renders held state in English and Indonesian', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'needs-operator', reason: 'held', intentId: 'intent-uuid-1' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemEn = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemEn).getByText('Operator task: we could not confirm the next fiscal year. We will resolve it; nothing is needed from you.')).toBeInTheDocument();

    cleanup();
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    const itemId = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemId).getByText('Tugas Operator: kami belum dapat mengonfirmasi tahun fiskal berikutnya. Kami akan menyelesaikannya; Anda tidak perlu melakukan apa pun.')).toBeInTheDocument();
  });

  it('unhides and renders refused state with and without reason in English and Indonesian', async () => {
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'refused', message: 'Forbidden' } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    let itemEn = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemEn).getByText('Operator task: PMO could not create the next fiscal year (Forbidden). We will resolve it; nothing is needed from you.')).toBeInTheDocument();

    cleanup();
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    let itemId = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemId).getByText('Tugas Operator: PMO tidak dapat membuat tahun fiskal berikutnya (Forbidden). Kami akan menyelesaikannya; Anda tidak perlu melakukan apa pun.')).toBeInTheDocument();

    cleanup();
    repo.getErpSetup.mockResolvedValue(readiness({}, { fiscalYear: { state: 'refused', message: null } }));
    wrapWithRole('Admin', <ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    itemEn = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemEn).getByText('Operator task: PMO could not create the next fiscal year. We will resolve it; nothing is needed from you.')).toBeInTheDocument();

    cleanup();
    await renderIndonesian(<ErpSetupChecklist orgId='org-1' onRefreshCompany={vi.fn()} />);
    await waitFor(() => expect(document.getElementById('erp-setup-fiscal-year')).not.toHaveAttribute('hidden'));
    itemId = document.getElementById('erp-setup-fiscal-year')!;
    expect(within(itemId).getByText('Tugas Operator: PMO tidak dapat membuat tahun fiskal berikutnya. Kami akan menyelesaikannya; Anda tidak perlu melakukan apa pun.')).toBeInTheDocument();
  });
});
