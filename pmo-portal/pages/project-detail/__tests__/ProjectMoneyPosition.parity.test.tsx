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
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import OverviewTab from '../tabs/OverviewTab';
import ProjectDetailHeader from '../ProjectDetailHeader';

const h = vi.hoisted(() => ({
  orgId: 'org-A' as string | null,
  realRole: 'Finance',
  canViewFinance: true,
  getProjectFinances: vi.fn(),
  budget: { data: 40 as number | undefined, isPending: false, isError: false },
  commitments: { data: 10, isPending: false, isError: false, commitmentSource: 'pmo', ledgerBasis: 'erp' },
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
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
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
  showFinanceSummary?: boolean;
  ledgerBasis?: 'pmo' | 'erp' | 'unavailable';
  committedSpend?: number;
  includeHeader?: boolean;
  includeOverview?: boolean;
} = {}) {
  const {
    status = 'Ongoing Project',
    realRole = 'Finance',
    showFinanceSummary = false,
    ledgerBasis = 'erp',
    committedSpend = 10,
    includeHeader = true,
    includeOverview = true,
  } = options;
  h.realRole = realRole;
  h.commitments = {
    data: committedSpend,
    isPending: false,
    isError: false,
    commitmentSource: ledgerBasis === 'pmo' ? 'pmo' : 'not-tracked',
    ledgerBasis,
  };
  const currentProject = { ...project, status } as ProjectWithRefs;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <I18nextProvider i18n={localeI18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            {includeHeader && (
              <ProjectDetailHeader
                project={currentProject}
                committedSpend={committedSpend}
                commitmentSource={ledgerBasis === 'pmo' ? 'pmo' : 'not-tracked'}
                ledgerBasis={ledgerBasis}
              />
            )}
            {includeOverview && (
              <OverviewTab
                project={currentProject}
                committedSpend={committedSpend}
                commitmentSource={ledgerBasis === 'pmo' ? 'pmo' : 'not-tracked'}
                ledgerBasis={ledgerBasis}
                showFinanceSummary={showFinanceSummary}
              />
            )}
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

function statTile(label: string) {
  const tile = screen.getAllByTestId('stat-tile')
    .find((candidate) => within(candidate).queryByText(label, { exact: true }));
  expect(tile, `expected a statistic tile labelled ${label}`).toBeDefined();
  return tile!;
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
  h.commitments = { data: 10, isPending: false, isError: false, commitmentSource: 'pmo', ledgerBasis: 'erp' };
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
    const actualTile = statTile(t('projectDetail.header.tile.actual', 'Actual'));
    expect(within(actualTile).getByText(formatExactMoney('10.10', 'USD', language)!)).toBeInTheDocument();
    expect(actualTile).toHaveTextContent(t('uxs01.completeCoverage', 'Complete category coverage'));
    expect(within(statTile(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')))
      .getByText(formatSignedExactMoney('89.90', 'USD', language)!)).toBeInTheDocument();
    expect(statTile(t('projectDetail.header.tile.spend', 'Spend'))).toHaveTextContent('25%');

    const financeSection = screen.getByTestId('project-finances');
    expect(financeSection).toHaveTextContent(formatExactMoney('10.10', 'USD', language)!);
    const cashField = screen.getByText(t('uxs01.cashReceived', 'Cash received'), { exact: true }).parentElement!;
    expect(normalizeSpacing(cashField.textContent ?? '')).toContain(normalizeSpacing(formatExactMoney('0.00', 'USD', language)!));
    expect(normalizeSpacing(cashField.textContent ?? '')).toContain(normalizeSpacing(formatExactMoney('7.50', 'IDR', language)!));
    expect(screen.getByText(t(
      'projectFinances.settlementNote',
      'Settled against invoices (cash, withholding and credits), not cash received.',
    ))).toBeInTheDocument();
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
    const { client } = renderSurfaces({ realRole: 'Engineer', showFinanceSummary: true });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    const aside = screen.getByTestId('financial-summary');
    expect(within(statTile(t('projectDetail.overview.finance.actual', 'Actual')))
      .getByText(t('uxs01.actualUnavailable', 'Unavailable'))).toBeInTheDocument();
    expect(aside).not.toHaveTextContent(t('uxs01.completeCoverage', 'Complete category coverage'));
    const financeSection = screen.getByTestId('project-finances');
    expect(financeSection).toHaveTextContent(t('uxs01.completeCoverage', 'Complete category coverage'));
    expect(financeSection).toHaveTextContent(t('projectFinances.unavailable', 'Unavailable'));
    expect(projectFinancesModule.buildProjectMoneyPosition).toHaveBeenCalled();
  });

  it('AC-PMP-003 displays source-currency Actual and withholds cross-currency comparisons', async () => {
    h.realRole = 'Engineer';
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId, {
      actuals: actuals('10.10', [{ category: 'Labor', mapped: true, amount: '10.10' }], 'EUR'),
    }));
    const { client } = renderSurfaces({ realRole: 'Engineer', showFinanceSummary: true });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    const aside = screen.getByTestId('financial-summary');
    expect(within(statTile(t('projectDetail.overview.finance.actual', 'Actual')))
      .getByText(formatExactMoney('10.10', 'EUR', 'en')!)).toBeInTheDocument();
    // PD-A: cross-currency ratios are withheld by omitting the tiles, not by prose.
    expect(screen.queryByText(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('projectDetail.overview.finance.spend', 'Spend'))).not.toBeInTheDocument();
    expect(aside).toBeInTheDocument();
    expect(screen.getByText(/Recorded spending · EUR/)).toBeInTheDocument();
    expect(projectFinancesModule.buildProjectMoneyPosition).toHaveBeenCalledWith(expect.objectContaining({
      projectCurrency: 'USD',
      actuals: financeReading(project.id, {
        actuals: actuals('10.10', [{ category: 'Labor', mapped: true, amount: '10.10' }], 'EUR'),
      }).actuals,
    }));
  });

  it('AC-PMP-003 preserves PMO placement and zero/positive values for delivery-forward roles', async () => {
    h.realRole = 'Engineer';
    h.getProjectFinances.mockImplementation(async (projectId: string) => financeReading(projectId));
    const { client } = renderSurfaces({
      status: 'Internal Project',
      realRole: 'Engineer',
      showFinanceSummary: true,
      ledgerBasis: 'pmo',
      committedSpend: 0,
    });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    const aside = screen.getByTestId('financial-summary');
    expect(aside).toHaveTextContent(t('uxs01.pmoCoverage', 'Committed PMO purchase orders'));
    expect(within(statTile(t('projectDetail.overview.finance.actual', 'Actual')))
      .getByText(formatExactMoney('0.00', 'USD', 'en')!)).toBeInTheDocument();
    expect(within(statTile(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')))
      .getByText(formatSignedExactMoney('100.00', 'USD', 'en')!)).toBeInTheDocument();
    expect(within(statTile(t('projectDetail.overview.finance.spend', 'Spend'))).getByText('0%')).toBeInTheDocument();
  });

  it('AC-PMP-006 keeps pipeline Project finances visible and fetching beside the hidden header', async () => {
    renderSurfaces({ status: 'Leads', realRole: 'Finance' });

    expect(screen.getByTestId('project-finances')).toBeInTheDocument();
    expect(screen.queryByTestId('financial-summary')).not.toBeInTheDocument();
    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledExactlyOnceWith(project.id));
    expect(screen.queryByText(t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')))
      .not.toBeInTheDocument();
  });

  it.each([
    { name: 'pending', data: undefined, isPending: true, isError: false, expected: null },
    { name: 'failed', data: undefined, isPending: false, isError: true, expected: null },
    { name: 'without an Active budget', data: 0, isPending: false, isError: false, expected: null },
    { name: 'with an Active budget', data: 40, isPending: false, isError: false, expected: '25%' },
  ])('AC-PMP-003 keeps header budget precedence $name', async ({ data, isPending, isError, expected }) => {
    h.budget = { data, isPending, isError };
    const { client } = renderSurfaces({ includeOverview: false });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledOnce());
    await waitForFinance(client);
    // PD-A: no Active budget (or still loading) → no Spend tile at all, never "No active budget" prose.
    if (expected === null) expect(screen.queryByText(t('projectDetail.header.tile.spend', 'Spend'))).not.toBeInTheDocument();
    else expect(statTile(t('projectDetail.header.tile.spend', 'Spend'))).toHaveTextContent(expected);
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
    await waitFor(() => expect(screen.getByTestId('project-finances')).toHaveTextContent(
      formatExactMoney('10.10', 'USD', 'en')!,
    ));
    expect(h.getProjectFinances).toHaveBeenCalledTimes(2);
  });
});
