/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, screen, within } from '@testing-library/react';

import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';

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

import { bindingMapIntegrations, wrapWithRole, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

describe('AC-EAS-015 the read-only Integrations view renders both states with no write affordances', () => {
  it('AC-EAS-015 (a) empty ownership ⇒ connect cards render with Not connected status, Employed domains section empty', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: [], isPending: false, isError: false, isSuccess: true, isLoading: false, isFetching: false, refetch: vi.fn(), status: 'success' as const, dataUpdatedAt: 0, error: null, isPlaceholderData: false, fetchStatus: 'idle', isLoadingError: false, isRefetchError: false, errorUpdatedAt: 0, failureCount: 0, failureReason: null, isPaused: false } as any);
    vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByTestId('integrations-connect-cards')).toBeInTheDocument();
    expect(screen.getByText('ClickUp')).toBeInTheDocument();
    expect(screen.getByText('ERPNext')).toBeInTheDocument();
    expect(screen.getAllByText('Not connected')).toHaveLength(2);
    // AC-IRUX-007: empty ownership renders an explicit read-only empty state (not a blank section)
    // and offers no write affordances.
    expect(screen.getByTestId('integrations-tier-list')).toBeInTheDocument();
    expect(within(screen.getByTestId('integrations-tier-list')).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('integrations-tier-list')).queryByRole('button')).toBeNull();
  });

  it('M1 the loading skeleton renders inside the framed container (sibling-section idiom)', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: undefined, isPending: true, isError: false } as never);
    vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: true, isError: false, isSuccess: false, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
    wrapWithRole('Admin', <IntegrationsView />);
    const skeleton = screen.getByTestId('liststate-loading');
    expect(skeleton.parentElement).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-card');
  });

  it('AC-EAS-015 (b) an employed tier owning {clickup: tasks, erpnext: procurement} lists the tier + domains, no write affordance', () => {
    const rows: ExternalDomainOwnershipRow[] = [
      { id: '1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' },
      { id: '2', orgId: 'org-1', externalTier: 'erpnext', domain: 'procurement' },
    ];
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
    vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
    wrapWithRole('Admin', <IntegrationsView />);
    const list = screen.getByTestId('integrations-tier-list');
    expect(within(list).getByRole('heading', { name: 'ClickUp' })).toBeInTheDocument();
    expect(within(list).getByRole('heading', { name: 'ERPNext' })).toBeInTheDocument();
    const chipTexts = within(list).getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(chipTexts).toEqual(expect.arrayContaining(['Tasks', 'Procurement']));
    expect(within(list).queryByRole('button')).toBeNull();
  });

  describe('NFR-CUA-LOCALITY-001 ClickUp tier renders with human label and data-locality note', () => {
    it('ClickUp tier heading renders as "ClickUp" not raw slug', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
      wrapWithRole('Admin', <IntegrationsView />);
      const list = screen.getByTestId('integrations-tier-list');
      const heading = within(list).getByRole('heading', { name: 'ClickUp' });
      expect(heading).toBeInTheDocument();
      const rawSlugFound = Array.from(document.querySelectorAll('*')).some(
        (el) => el.textContent === 'clickup' && el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT',
      );
      expect(rawSlugFound).toBe(false);
    });

    it('ClickUp tier renders the US-hosted data-locality note', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
      wrapWithRole('Admin', <IntegrationsView />);
      const list = screen.getByTestId('integrations-tier-list');
      expect(within(list).getByText(/ClickUp is US-hosted SaaS — task-domain data resides with ClickUp/)).toBeInTheDocument();
    });

    it('Non-ClickUp tiers do NOT render the data-locality note', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'erpnext', domain: 'tasks' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
      wrapWithRole('Admin', <IntegrationsView />);
      const list = screen.getByTestId('integrations-tier-list');
      expect(within(list).queryByText(/US-hosted SaaS/)).toBeNull();
    });
  });

  describe('ERPNext tier renders with human label and a self-hosted residency note', () => {
    it('ERPNext tier heading renders as "ERPNext" not the raw slug', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'erpnext', domain: 'procurement' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
      wrapWithRole('Admin', <IntegrationsView />);
      const list = screen.getByTestId('integrations-tier-list');
      expect(within(list).getByRole('heading', { name: 'ERPNext' })).toBeInTheDocument();
    });

    it('ERPNext tier renders the self-hosted data-locality note', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'erpnext', domain: 'procurement' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
      wrapWithRole('Admin', <IntegrationsView />);
      const list = screen.getByTestId('integrations-tier-list');
      expect(
        within(list).getByText(/Self-hosted ERP — data resides on your ERPNext instance/),
      ).toBeInTheDocument();
    });
  });
})

// ============================================================================
// AC-IRUX-007 — employed-domain ownership loading / unavailable / empty states
// ============================================================================
describe('AC-IRUX-007 employed-domain ownership states', () => {
  beforeEach(() => {
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
  });

  it('AC-IRUX-007 shows a loading state while ownership loads (read only)', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: undefined, isPending: true, isError: false } as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations() as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    const tierList = screen.getByTestId('integrations-tier-list');
    expect(within(tierList).queryByRole('button')).toBeNull();
  });

  it('AC-IRUX-007 unavailable ownership shows an explicit error + Retry and no write controls', () => {
    const refetch = vi.fn();
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: [], isPending: false, isError: true, refetch } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations() as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByTestId('ownership-error')).toBeInTheDocument();
    expect(screen.getByText(/Automatic updates unavailable/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /^Retry$/i });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalled();
    const tierList = screen.getByTestId('integrations-tier-list');
    // Read-only section: the only button is the read Retry, never a mutation control.
    expect(within(tierList).queryByRole('button', { name: /connect|disconnect|select/i })).toBeNull();
  });

  it('AC-IRUX-007 empty ownership shows an explicit empty state and no write controls', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: [], isPending: false, isError: false, isSuccess: true } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations() as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByText(/No information is set to update automatically/i)).toBeInTheDocument();
    const tierList = screen.getByTestId('integrations-tier-list');
    expect(within(tierList).queryByRole('button')).toBeNull();
  });
})
