/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import type { IntegrationBinding } from '@/src/lib/repositories/types';

import type { IntegrationsRepository } from '@/src/lib/repositories/types';

import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

import { AppError } from '@/src/lib/appError';

import { withErpActivationRefusal } from '@/src/lib/repositories/erpActivationRefusal';

const erpSetup = vi.hoisted(() => ({
  getErpSetup: vi.fn<IntegrationsRepository['getErpSetup']>(async () => ({
    defaults: { company: 'Example Company', default_receivable_account: null, default_activity_type: null },
    domains: [],
    unmappedProjects: [{ id: 'project-2', name: 'Example Delivery', code: 'SYNTH-2' }],
    budgetMappedCategories: [],
    unlinkedEmployeeCount: 2,
  })),
  saveErpDefaults: vi.fn(async () => ({ ok: true })),
  listErpProjects: vi.fn(async () => []),
  linkErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  ensureErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  employErpDomain: vi.fn(async () => ({ ok: true })),
  onboardErpParties: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: erpSetup } }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: vi.fn() }));
vi.mock('@/src/hooks/useIntegrations', () => ({
  useIntegrations: vi.fn(),
  integrationHealthQueryKey: (orgId: string | undefined, tier: string) => ['integrations', 'health', orgId, tier],
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: vi.fn() }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: vi.fn() }));
vi.mock('@/src/lib/m365/connectClient', () => ({ initiateM365OrgApproval: vi.fn() }));

import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

import { useIntegrations } from '@/src/hooks/useIntegrations';

import { useProjects } from '@/src/hooks/useProjects';

import { baseExternalDomainReturn, wrapWithRole, wrapWithRoleAndLocale, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

// ============================================================================
// OD-INT-6 — ERPNext Company selection at ORG level (connected-but-not-activated)
// Regression guard: the picker previously had `value={null}` + a no-op onChange, and submit sent the
// TIER as the companyId — so selecting a Company did nothing and Activate would have written
// config.company='erpnext'. These tests drive the real interaction end-to-end.
// ============================================================================
describe('OD-INT-6 ERPNext Company selection (org-level)', () => {
  const erpnextNotActivated: IntegrationBinding = {
    org_id: 'org-1',
    external_tier: 'erpnext',
    site_url: 'https://erp.example.com',
    secret_ref: 'erpnext_token_org_1',
    status: 'active',
    connected_by: 'u1',
    connected_at: '2026-01-01T00:00:00Z',
    disconnected_at: null,
    config: {}, // <-- no company => connected-but-NOT-activated
  };

  const mockSetCompany = vi.fn().mockResolvedValue({ ok: true });

  const mockReturn = (overrides: Record<string, unknown> = {}) => ({
    bindings: [erpnextNotActivated],
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
    connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
    disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
    getBinding: vi.fn((tier: string) => (tier === 'erpnext' ? erpnextNotActivated : undefined)),
    getHealth: vi.fn().mockResolvedValue(null),
    erpnextCompanies: [{ name: 'Acme Corp' }, { name: 'Beta Ltd' }],
    isCompaniesPending: false,
    setCompany: { mutateAsync: mockSetCompany, isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn);
    vi.mocked(useIntegrations).mockReturnValue(mockReturn() as any);
  });

  it('OD-INT-6 shows connected-but-not-activated for ERPNext with no Company', async () => {
    wrapWithRole('Admin', <IntegrationsView />);
    await waitFor(() => expect(screen.getByText('Awaiting activation — select a Company to activate')).toBeInTheDocument());
    expect(screen.getByText(/ERP sync is paused until a Company is selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Select Company$/i })).toBeInTheDocument();
  });

  it('OD-INT-6 Activate sends the SELECTED Company doc name (not the tier)', async () => {
    const user = userEvent.setup();
    wrapWithRole('Admin', <IntegrationsView />);

    await user.click(await screen.findByRole('button', { name: /^Select Company$/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Pick a Company from the combobox (mirrors the ClickUp List picker interaction).
    await user.click(screen.getByLabelText(/^Company$/i));
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Acme Corp/i }));

    await user.click(screen.getByRole('button', { name: /^Activate$/i }));

    // The regression: this must be the Company name, NOT 'erpnext'.
    await waitFor(() => expect(mockSetCompany).toHaveBeenCalledWith('Acme Corp'));
    expect(mockSetCompany).not.toHaveBeenCalledWith('erpnext');
  });

  it('OD-INT-6 a non-Admin sees no Select Company control (server is the real gate)', async () => {
    wrapWithRole('Engineer', <IntegrationsView />);
    await waitFor(() => expect(screen.getByText('ERPNext')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Select Company$/i })).not.toBeInTheDocument();
  });
})

// ============================================================================
// AC-IRUX-005 — ERPNext Company picker recovery states
// ============================================================================
describe('AC-IRUX-005 ERPNext Company picker states', () => {
  const notActivated: IntegrationBinding = {
    org_id: 'org-1',
    external_tier: 'erpnext',
    site_url: 'https://erp.example.com',
    secret_ref: 'erpnext_token_org_1',
    status: 'active',
    connected_by: 'u1',
    connected_at: '2026-01-01T00:00:00Z',
    disconnected_at: null,
    config: {},
  };
  const companyReturn = (overrides: Record<string, unknown> = {}) => ({
    bindings: [notActivated],
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
    connect: { mutateAsync: vi.fn(), isPending: false },
    disconnect: { mutateAsync: vi.fn(), isPending: false },
    getBinding: vi.fn((tier: string) => (tier === 'erpnext' ? notActivated : undefined)),
    getHealth: vi.fn().mockResolvedValue(null),
    erpnextCompanies: [{ name: 'Acme Corp' }],
    isCompaniesPending: false,
    isCompaniesError: false,
    refetchCompanies: vi.fn(),
    setCompany: { mutateAsync: vi.fn().mockResolvedValue({ ok: true }), isPending: false },
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
  });

  it('AC-IRUX-005 opening the picker during Company loading shows a loading state and disables Activate', async () => {
    vi.mocked(useIntegrations).mockReturnValue(companyReturn({ isCompaniesPending: true, erpnextCompanies: [] }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    fireEvent.click(await screen.findByRole('button', { name: /^Select Company$/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByTestId('companies-loading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Activate$/i })).toBeDisabled();
  });

  it('AC-IRUX-005 an unavailable Company read shows a generic error + Retry and disables Activate', async () => {
    const refetchCompanies = vi.fn();
    vi.mocked(useIntegrations).mockReturnValue(companyReturn({ isCompaniesError: true, erpnextCompanies: [], refetchCompanies }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    fireEvent.click(await screen.findByRole('button', { name: /^Select Company$/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText(/Companies unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(refetchCompanies).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Activate$/i })).toBeDisabled();
  });

  it('AC-IRUX-005 a zero-Company result shows an explicit empty state and disables Activate', async () => {
    vi.mocked(useIntegrations).mockReturnValue(companyReturn({ erpnextCompanies: [] }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    fireEvent.click(await screen.findByRole('button', { name: /^Select Company$/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText(/No Companies found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Activate$/i })).toBeDisabled();
  });

  it('AC-IRUX-005 a failed activation keeps the dialog open, retains the selection, shows a generic error, and permits another attempt', async () => {
    const setCompany = { mutateAsync: vi.fn().mockRejectedValue(new Error('boom')), isPending: false };
    vi.mocked(useIntegrations).mockReturnValue(companyReturn({ setCompany }) as any);
    const user = userEvent.setup();
    wrapWithRole('Admin', <IntegrationsView />);
    await user.click(await screen.findByRole('button', { name: /^Select Company$/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await user.click(screen.getByLabelText(/^Company$/i));
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Acme Corp/i }));
    await user.click(screen.getByRole('button', { name: /^Activate$/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/Activation failed/i);
    });
    // Dialog stays open, selection survives (Activate still enabled), generic error visible.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/your selection was kept/i);
    expect(screen.getByRole('button', { name: /^Activate$/i })).not.toBeDisabled();
    expect(setCompany.mutateAsync).toHaveBeenCalledWith('Acme Corp');
    // Another attempt is possible.
    await user.click(screen.getByRole('button', { name: /^Activate$/i }));
    expect(setCompany.mutateAsync).toHaveBeenCalledTimes(2);
  });

  // #656 — an activation refused for a reason the Admin can act on says what to fix, not just "failed".
  async function activateWith(rejection: unknown, render: () => unknown = () => wrapWithRole('Admin', <IntegrationsView />)) {
    const setCompany = { mutateAsync: vi.fn().mockRejectedValue(rejection), isPending: false };
    vi.mocked(useIntegrations).mockReturnValue(companyReturn({ setCompany }) as any);
    const user = userEvent.setup();
    await render();
    await user.click(await screen.findByRole('button', { name: /^(Select Company|Pilih Perusahaan)$/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await user.click(screen.getByLabelText(/^(Company|Perusahaan)$/i));
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Acme Corp/i }));
    await user.click(screen.getByRole('button', { name: /^(Activate|Aktifkan)$/i }));
    return setCompany;
  }

  it('#656 a refusal for missing read permissions names every doctype the integration user cannot read', async () => {
    await activateWith(withErpActivationRefusal(
      new AppError('server text', 'CONFIG_REJECTED'),
      { kind: 'missing-reads', doctypes: ['Timesheet', 'GL Entry'] },
    ));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/cannot read: Timesheet, GL Entry/i));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/grant it read access/i);
    expect(dialog).not.toHaveTextContent(/Activation failed/i);
    // The selection survives so the Admin can retry once access is granted.
    expect(screen.getByRole('button', { name: /^Activate$/i })).not.toBeDisabled();
  });

  it('#656 an unsupported ERPNext version names the version and the supported ones', async () => {
    await activateWith(withErpActivationRefusal(
      new AppError('server text', 'CONFIG_REJECTED'),
      { kind: 'unsupported-version', versionMajor: 14, supportedMajors: [15, 16] },
    ));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/ERPNext 14 is not supported/i));
    expect(screen.getByRole('dialog')).toHaveTextContent(/supports ERPNext 15 and 16/);
  });

  it('#656 the supported versions come from the server, not the copy', async () => {
    await activateWith(withErpActivationRefusal(
      new AppError('server text', 'CONFIG_REJECTED'),
      { kind: 'unsupported-version', versionMajor: 14, supportedMajors: [15, 16, 17] },
    ));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/supports ERPNext 15, 16, and 17/));
  });

  it('#656 the unsupported-version refusal is translated with a Bahasa list (Bahasa Indonesia)', async () => {
    // A Bahasa viewer: the UI language drives both the copy (i18n) and the list conjunction (format seam).
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    onTestFinished(() => resetActiveLocale());
    await activateWith(
      withErpActivationRefusal(new AppError('server text', 'CONFIG_REJECTED'), { kind: 'unsupported-version', versionMajor: 14, supportedMajors: [15, 16] }),
      () => wrapWithRoleAndLocale('Admin', 'id', <IntegrationsView />),
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/ERPNext 14 tidak didukung — PMO mendukung ERPNext 15 dan 16/));
  });

  it('#656 the missing-read refusal is translated (Bahasa Indonesia)', async () => {
    await activateWith(
      withErpActivationRefusal(new AppError('server text', 'CONFIG_REJECTED'), { kind: 'missing-reads', doctypes: ['Timesheet'] }),
      () => wrapWithRoleAndLocale('Admin', 'id', <IntegrationsView />),
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/tidak dapat membaca: Timesheet/i));
  });
})
