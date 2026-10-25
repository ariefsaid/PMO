import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectFinances } from '@/src/lib/projectFinances';
import { formatExactMoney, formatSignedExactMoney } from '@/src/lib/projectFinances';
import { formatCurrency } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import OverviewTab from '../tabs/OverviewTab';
import ProjectDetailHeader from '../ProjectDetailHeader';

const h = vi.hoisted(() => ({
  orgId: 'org-A' as string | null,
  realRole: 'Finance',
  canViewFinance: true,
  getProjectFinances: vi.fn(),
  budget: { data: 40 as number | undefined, isPending: false, isError: false },
  commitments: { data: 10, otherCurrencies: [] as Array<{ currency: string; amount: number }>, isPending: false, isError: false, commitmentSource: 'pmo', ledgerBasis: 'erp' },
}));

vi.mock('@/src/lib/projectFinances', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/projectFinances')>();
  return {
    ...actual,
    buildProjectMoneyPosition: vi.fn(actual.buildProjectMoneyPosition),
  };
});
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.orgId ? { id: 'user', org_id: h.orgId } : null, role: h.realRole }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => entity === 'salesInvoice'
    ? h.canViewFinance
    : action === 'manage' || action === 'edit' || action === 'archive' || action === 'delete'
      ? false
      : true,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    realRole: h.realRole,
    effectiveRole: h.realRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { revenue: { getProjectFinances: h.getProjectFinances } },
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({
  useProjectVatEditability: () => ({
    data: { eligible: false, reason: null, hasInvoices: false },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ ...h.budget, refetch: vi.fn() }),
  useBudgetVersions: () => ({
    data: h.budget.data && h.budget.data > 0 ? [{
      id: 'active-budget', project_id: project.id, org_id: 'org-A', version: 1, name: 'Active', status: 'Active',
      created_at: '2026-01-01', total: h.budget.data,
      line_items: [{ id: 'line-1', budget_version_id: 'active-budget', org_id: 'org-A', category: 'Labor', description: null, budgeted_amount: h.budget.data, actual_amount: 0 }],
    }] : [],
    isPending: h.budget.isPending,
    isError: h.budget.isError,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => h.commitments,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));

import * as projectFinancesModule from '@/src/lib/projectFinances';

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as Record<string, unknown>;
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as Record<string, unknown>;
const localeI18n = createInstance();
const project: ProjectWithRefs = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Sample project',
  status: 'Ongoing Project',
  currency: 'USD',
  contract_value: 100,
  budget: 40,
  tax_treatment: 'exclusive',
  client_id: null,
  project_manager_id: null,
} as unknown as ProjectWithRefs;

const actuals = (
  total: string | null = '10.10',
  categories: ProjectFinances['actuals']['categories'] = [
    { category: 'Labor', mapped: true, amount: total },
  ],
  currency = 'USD',
  excludesRestrictedRows = false,
): ProjectFinances['actuals'] => ({
  currency,
  as_of: '2026-10-17T00:00:00Z',
  total,
  excludes_restricted_rows: excludesRestrictedRows,
  categories,
});

const financeReading = (
  projectId: string,
  overrides: Partial<ProjectFinances> = {},
): ProjectFinances => ({
  project_id: projectId,
  cash_received: {
    state: 'known',
    buckets: [
      { currency: 'USD', amount: '0.00' },
      { currency: 'IDR', amount: '7.50' },
    ],
    receipt_count: 1,
  },
  contract_invoiced: '25.00',
  remaining_to_invoice: '75.00',
  invoices: [{
    currency: 'USD',
    invoice_count: 1,
    invoiced: '25.00',
    settled: '25.00',
    outstanding: '0.00',
    missing_amount: 0,
    missing_outstanding: 0,
    tax_basis: 'exclusive',
    work_revenue: '20.00',
    missing_work: 0,
  }],
  budget: null,
  actuals: actuals(),
  ...overrides,
});

function t(key: string, defaultValue: string) {
  return localeI18n.t(key, { defaultValue });
}

function normalizeSpacing(value: string) {
  return value.replaceAll('\u00a0', ' ');
}

async function setLanguage(language: 'en' | 'id') {
  await localeI18n.changeLanguage(language);
  setActiveLocale({
    locale: language,
    numberLocale: language === 'id' ? 'id-ID' : 'en-US',
    timezone: 'UTC',
  });
}

function renderSurfaces(options: {
  status?: string;
  realRole?: string;
  ledgerBasis?: 'pmo' | 'erp' | 'unavailable';
  committedSpend?: number;
  committedOtherCurrencies?: Array<{ currency: string; amount: number }>;
  includeHeader?: boolean;
  contractValue?: number | null;
} = {}) {
  const {
    status = 'Ongoing Project',
    realRole = 'Finance',
    ledgerBasis = 'erp',
    committedSpend = 10,
    committedOtherCurrencies = [],
    includeHeader = true,
    contractValue,
  } = options;
  h.realRole = realRole;
  h.commitments = {
    data: committedSpend,
    otherCurrencies: committedOtherCurrencies,
    isPending: false,
    isError: false,
    commitmentSource: ledgerBasis === 'pmo' ? 'pmo' : 'not-tracked',
    ledgerBasis,
  };
  const currentProject = { ...project, ...(contractValue !== undefined ? { contract_value: contractValue } : {}), status } as ProjectWithRefs;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <I18nextProvider i18n={localeI18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            {includeHeader && (
              <ProjectDetailHeader
                project={currentProject}
              />
            )}
            <OverviewTab
              project={currentProject}
              committedSpend={committedSpend}
              committedOtherCurrencies={committedOtherCurrencies}
              commitmentSource={ledgerBasis === 'pmo' ? 'pmo' : 'not-tracked'}
              ledgerBasis={ledgerBasis}
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { client, view, currentProject };
}

async function waitForFinance(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState([
    'project-finances',
    h.orgId,
    project.id,
  ])?.status).toBe('success'));
}

beforeAll(async () => {
  await localeI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { en: { common: enCatalogue }, id: { common: idCatalogue } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

beforeEach(async () => {
  await setLanguage('en');
  h.orgId = 'org-A';
  h.realRole = 'Finance';
  h.canViewFinance = true;
  h.budget = { data: 40, isPending: false, isError: false };
  h.commitments = { data: 10, otherCurrencies: [], isPending: false, isError: false, commitmentSource: 'pmo', ledgerBasis: 'erp' };
  h.getProjectFinances.mockReset().mockImplementation(async (projectId: string) => financeReading(projectId));
  vi.mocked(projectFinancesModule.buildProjectMoneyPosition).mockClear();
});

describe('project money position consumer parity', () => {
  it.each(['en', 'id'] as const)('AC-PMP-003 preserves complete ERP values and separate receipt cash in %s', async (language) => {
    await setLanguage(language);
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId, {
      actuals: actuals('10.10', [
        { category: 'Labor', mapped: true, amount: '10.00' },
        { category: 'Materials', mapped: true, amount: '0.10' },
      ]),
    }));
    const { client } = renderSurfaces();

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledExactlyOnceWith(project.id));
    await waitForFinance(client);
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).toHaveTextContent(t('uxs01.recordedSpending', 'Recorded spending'));
    expect(cost).toHaveTextContent(formatExactMoney('10.10', 'USD', language)!);
    expect(cost).toHaveTextContent(formatSignedExactMoney('89.90', 'USD', language)!);
    expect(screen.getByTestId('budget-used')).toHaveTextContent('25%');

    const cashField = screen.getByText(t('uxs01.cashReceived', 'Cash received'), { exact: true }).parentElement!;
    expect(normalizeSpacing(cashField.textContent ?? '')).toContain(normalizeSpacing(formatExactMoney('0.00', 'USD', language)!));
    expect(normalizeSpacing(cashField.textContent ?? '')).toContain(normalizeSpacing(formatExactMoney('7.50', 'IDR', language)!));
    // PD-C: the settlement explanation is the title of the "Settled" label, not a paragraph.
    expect(screen.getAllByText(t('projectFinances.settled', 'Settled'))[0]).toHaveAttribute('title', t(
      'projectFinances.settlementNote',
      'Settled against invoices (cash, withholding and credits), not cash received.',
    ));
    expect(projectFinancesModule.buildProjectMoneyPosition).toHaveBeenCalledWith(expect.objectContaining({
      actuals: financeReading(project.id, {
        actuals: actuals('10.10', [
          { category: 'Labor', mapped: true, amount: '10.00' },
          { category: 'Materials', mapped: true, amount: '0.10' },
        ]),
      }).actuals,
    }));
  });

  it('AC-PMP-003 keeps complete mapping coverage when the ERP amount is missing', async () => {
    h.realRole = 'Engineer';
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId, {
      actuals: actuals('10.10', [{ category: 'Labor', mapped: true, amount: null }]),
    }));
    const { client } = renderSurfaces({ realRole: 'Engineer' });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).toHaveTextContent(t('uxs01.actualUnavailable', 'Unavailable'));
    // Full mapping with an unknown amount remains unknown and never becomes a false zero.
    expect(cost).toHaveTextContent(t('projectFinances.unavailable', 'Unavailable'));
    expect(cost).not.toHaveTextContent(/Partial coverage|Cakupan sebagian/);
    expect(projectFinancesModule.buildProjectMoneyPosition).toHaveBeenCalled();
  });

  it('AC-PMP-003 displays source-currency Actual and withholds cross-currency comparisons', async () => {
    h.realRole = 'Engineer';
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId, {
      actuals: actuals('10.10', [{ category: 'Labor', mapped: true, amount: '10.10' }], 'EUR'),
    }));
    const { client } = renderSurfaces({ realRole: 'Engineer' });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).toHaveTextContent(formatExactMoney('10.10', 'EUR', 'en')!);
    // Cross-currency ratios are withheld by omitting the derived measures.
    expect(cost).not.toHaveTextContent(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost'));
    expect(screen.queryByTestId('budget-used')).not.toBeInTheDocument();
    expect(screen.getByText(/Recorded spending · EUR/)).toBeInTheDocument();
    expect(projectFinancesModule.buildProjectMoneyPosition).toHaveBeenCalledWith(expect.objectContaining({
      projectCurrency: 'USD',
      actuals: financeReading(project.id, {
        actuals: actuals('10.10', [{ category: 'Labor', mapped: true, amount: '10.10' }], 'EUR'),
      }).actuals,
    }));
  });

  it('AC-PMP-003 keeps an unstated contract unavailable instead of inventing zero', async () => {
    const { client } = renderSurfaces({ includeHeader: false, contractValue: null });
    await waitForFinance(client);
    const contract = screen.getByTestId('overview-contract-value');
    expect(contract).toHaveTextContent(t('uxs01.actualUnavailable', 'Unavailable'));
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).not.toHaveTextContent(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost'));
  });

  it('AC-PMP-003 preserves known zero contract and a negative contract remainder with the minus sign', async () => {
    const zero = renderSurfaces({ includeHeader: false, contractValue: 0 });
    await waitForFinance(zero.client);
    expect(screen.getByTestId('overview-contract-value')).toHaveTextContent(formatCurrency(0, 'USD'));
    zero.view.unmount();

    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId, {
      actuals: actuals('150.00', [{ category: 'Labor', mapped: true, amount: '150.00' }]),
    }));
    const next = renderSurfaces({ includeHeader: false, contractValue: 100 });
    await waitForFinance(next.client);
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).toHaveTextContent(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost'));
    expect(screen.getByTestId('contract-after-cost')).toHaveTextContent(formatSignedExactMoney('-50.00', 'USD', 'en')!);
  });

  it('AC-PMP-003 preserves PMO placement and zero/positive values for delivery-forward roles', async () => {
    h.realRole = 'Engineer';
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId));
    const { client } = renderSurfaces({
      status: 'Internal Project',
      realRole: 'Engineer',
      ledgerBasis: 'pmo',
      committedSpend: 0,
    });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).toHaveTextContent(t('uxs01.pmoCoverage', 'Committed PMO purchase orders'));
    expect(cost).toHaveTextContent(formatExactMoney('0.00', 'USD', 'en')!);
    expect(cost).toHaveTextContent(formatSignedExactMoney('100.00', 'USD', 'en')!);
    expect(screen.getByTestId('budget-used')).toHaveTextContent('0%');
  });

  it('0373 shows the project-currency committed figure and names other currencies beside it, never in its sum', async () => {
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId));
    const { client } = renderSurfaces({ ledgerBasis: 'pmo', committedSpend: 10, committedOtherCurrencies: [{ currency: 'EUR', amount: 40 }] });
    await waitForFinance(client);
    const cost = screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') });
    expect(cost).toHaveTextContent('$10');
    expect(cost).not.toHaveTextContent('$50');
    expect(within(cost).getByTestId('committed-other-currencies')).toHaveTextContent('Plus amounts in other currencies: €40');
  });

  it('AC-PMP-006 keeps pipeline money out of Overview and disables the delivery finance read', async () => {
    renderSurfaces({ status: 'Leads', realRole: 'Finance' });

    expect(screen.queryByRole('region', { name: t('projectDetail.moneyPosition.title', 'Money position') })).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-finances')).not.toBeInTheDocument();
    expect(h.getProjectFinances).not.toHaveBeenCalled();
    expect(screen.queryByText(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')))
      .not.toBeInTheDocument();
  });

  it.each([
    { name: 'pending', data: undefined, isPending: true, isError: false, expected: null },
    { name: 'failed', data: undefined, isPending: false, isError: true, expected: null },
    { name: 'without an Active budget', data: 0, isPending: false, isError: false, expected: null },
    { name: 'with an Active budget', data: 40, isPending: false, isError: false, expected: '25%' },
  ])('AC-PMP-003 keeps budget position distinct when budget is $name', async ({ data, isPending, isError, expected }) => {
    h.budget = { data, isPending, isError };
    const { client } = renderSurfaces({ includeHeader: false });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    if (expected === null) expect(screen.queryByTestId('budget-used')).not.toBeInTheDocument();
    else expect(screen.getByTestId('budget-used')).toHaveTextContent(expected);
  });

  it('AC-PMP-003 keeps finance-section loading and retry after a failed real repository read', async () => {
    h.getProjectFinances.mockReset()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockImplementation(async (projectId: string) => financeReading(projectId));
    renderSurfaces({ includeHeader: false });

    expect(screen.getByText(t('projectFinances.loading', 'Loading project finances…'))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(t(
      'projectFinances.error',
      "Couldn't load project finances.",
    ))).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: t('projectFinances.retry', 'Retry') }));
    await waitFor(() => expect(screen.getByRole('group', { name: t('projectDetail.moneyPosition.cost', 'Cost') })).toHaveTextContent(
      formatExactMoney('10.10', 'USD', 'en')!,
    ));
    expect(h.getProjectFinances).toHaveBeenCalledTimes(2);
  });
});
