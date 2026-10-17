/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, screen } from '@testing-library/react';

import type { IntegrationsRepository } from '@/src/lib/repositories/types';

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

import { baseExternalDomainReturn, wrapWithRoleAndLocale, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

describe('AC-IRUX-010 readiness copy in English and Bahasa (with role gates)', () => {
  const notActivated = (overrides: Record<string, unknown> = {}) => ({
    org_id: 'org-1',
    external_tier: 'erpnext',
    site_url: 'https://erp.example.com',
    secret_ref: 'erpnext_token_org_1',
    status: 'active',
    connected_by: 'u1',
    connected_at: '2026-01-01T00:00:00Z',
    disconnected_at: null,
    config: {},
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
    vi.mocked(useIntegrations).mockReturnValue({
      bindings: [notActivated()],
      isPending: false,
      isError: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
      connect: { mutateAsync: vi.fn(), isPending: false },
      disconnect: { mutateAsync: vi.fn(), isPending: false },
      getBinding: vi.fn((tier: string) => (tier === 'erpnext' ? notActivated() : undefined)),
      getHealth: vi.fn().mockResolvedValue(null),
      erpnextCompanies: [{ name: 'Acme Corp' }],
      isCompaniesPending: false,
      isCompaniesError: false,
      setCompany: { mutateAsync: vi.fn(), isPending: false },
    } as any);
  });

  it('renders English readiness copy for an Admin on an unactivated ERPNext binding', async () => {
    await wrapWithRoleAndLocale('Admin', 'en', <IntegrationsView />);
    expect(await screen.findByText('Awaiting activation — select a Company to activate')).toBeInTheDocument();
    expect(screen.getByText(/ERP sync is paused until a Company is selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Select Company$/i })).toBeInTheDocument();
  });

  it('renders Bahasa readiness copy for an Admin on an unactivated ERPNext binding', async () => {
    await wrapWithRoleAndLocale('Admin', 'id', <IntegrationsView />);
    expect(await screen.findByText('Menunggu aktivasi — pilih Perusahaan untuk mengaktifkan')).toBeInTheDocument();
    expect(screen.getByText(/Sinkronisasi ERP dijeda sampai sebuah Perusahaan dipilih/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pilih Perusahaan$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Pilih Perusahaan$/i }));
    expect(screen.getByRole('dialog', { name: 'Pilih Perusahaan ERPNext' })).toBeInTheDocument();
    expect(screen.getByLabelText('Perusahaan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  });

  it('renders Bahasa readiness copy for the unknown binding state', async () => {
    vi.mocked(useIntegrations).mockReturnValue({
      bindings: [],
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error('x'),
      refetch: vi.fn(),
      connect: { mutateAsync: vi.fn(), isPending: false },
      disconnect: { mutateAsync: vi.fn(), isPending: false },
      getBinding: vi.fn(() => undefined),
      getHealth: vi.fn().mockResolvedValue(null),
    } as any);
    await wrapWithRoleAndLocale('Admin', 'id', <IntegrationsView />);
    expect(await screen.findAllByText('Status koneksi tidak tersedia')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Muat ulang status$/i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Hubungkan ClickUp$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Coba lagi$/i })).toBeInTheDocument();
  });

  it('a read-only viewer in Bahasa sees the truthful state text but no mutation controls', async () => {
    await wrapWithRoleAndLocale('Engineer', 'id', <IntegrationsView />);
    expect(await screen.findByText('Menunggu aktivasi — pilih Perusahaan untuk mengaktifkan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pilih Perusahaan$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Aktifkan$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Connect ERPNext$/i })).not.toBeInTheDocument();
  });
})
