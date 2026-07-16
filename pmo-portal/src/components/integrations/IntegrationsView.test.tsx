/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import React from 'react';
import { IntegrationsView } from './IntegrationsView';
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';
import type { IntegrationBinding, IntegrationHealth } from '@/src/lib/repositories/types';

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: vi.fn(),
}));

vi.mock('@/src/hooks/useIntegrations', () => ({
  useIntegrations: vi.fn(),
}));

import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { useIntegrations } from '@/src/hooks/useIntegrations';

const mockBinding: IntegrationBinding = {
  org_id: 'org-1',
  external_tier: 'clickup',
  site_url: 'https://api.clickup.com',
  secret_ref: 'clickup_token_org_1',
  status: 'active',
  connected_by: 'u1',
  connected_at: '2026-01-01T00:00:00Z',
  disconnected_at: null,
  config: {},
};

const _mockHealth: IntegrationHealth = {
  tier: 'clickup',
  status: 'active',
  connected_by: 'u1',
  connected_at: '2026-01-01T00:00:00Z',
  last_sync: '2026-01-02T00:00:00Z',
  error_count: 0,
};

const baseExternalDomainReturn = {
  data: [],
  isPending: false,
  isError: false,
  isSuccess: true,
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
  status: 'success' as const,
  dataUpdatedAt: 0,
  error: null,
  isPlaceholderData: false,
  fetchStatus: 'idle',
  isLoadingError: false,
  isRefetchError: false,
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  isPaused: false,
  isRefetching: false,
  isStale: false,
} as any;

const wrapWithRole = (role: string, ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role as any}>
        {ui}
      </ImpersonationProvider>
    </QueryClientProvider>
  );
};

afterEach(() => { vi.clearAllMocks(); cleanup(); });

describe('AC-EAS-015 the read-only Integrations view renders both states with no write affordances', () => {
  it('AC-EAS-015 (a) empty ownership ⇒ connect cards render with Not connected status, Employed domains section empty', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: [], isPending: false, isError: false, isSuccess: true, isLoading: false, isFetching: false, refetch: vi.fn(), status: 'success' as const, dataUpdatedAt: 0, error: null, isPlaceholderData: false, fetchStatus: 'idle', isLoadingError: false, isRefetchError: false, errorUpdatedAt: 0, failureCount: 0, failureReason: null, isPaused: false } as any);
    vi.mocked(useIntegrations).mockReturnValue({ bindings: [], isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(), connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: undefined, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 }, getBinding: vi.fn(() => undefined), getHealth: vi.fn().mockResolvedValue(null) } as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByTestId('integrations-connect-cards')).toBeInTheDocument();
    expect(screen.getByText('ClickUp')).toBeInTheDocument();
    expect(screen.getByText('ERPNext')).toBeInTheDocument();
    expect(screen.getAllByText('Not connected')).toHaveLength(2);
    const tierList = screen.getByTestId('integrations-tier-list');
    expect(tierList).toBeInTheDocument();
    expect(within(tierList).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(tierList).queryByRole('button')).toBeNull();
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
});

// ============================================================
// NEW TESTS: Connect/Disconnect cards (AC-EAC-016, AC-EAC-017)
// ============================================================

describe('IntegrationsView — Connect/Disconnect cards (AC-EAC-016, AC-EAC-017)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIntegrations).mockReturnValue({
      bindings: [{ org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null }],
      isPending: false,
      isError: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
      connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
      disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
      getBinding: vi.fn((tier: string) => (tier === 'clickup' ? { org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null } : undefined)),
      getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
    } as any);
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Admin view (write controls visible)', () => {
    it('renders a Connect/Disconnect card for each tier with status badge and metadata', async () => {
      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('ERPNext')).toBeInTheDocument());

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText(/Connected by/)).toBeInTheDocument();
      expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^connect clickup$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^disconnect clickup$/i })).toBeInTheDocument();

      expect(screen.getByText('Not connected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^connect erpnext$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect erpnext$/i })).not.toBeInTheDocument();
    });

    it('shows Connect button for a tier that is not connected', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('ERPNext')).toBeInTheDocument());

      expect(screen.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^connect erpnext$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect erpnext$/i })).not.toBeInTheDocument();
    });

    it('shows Disconnected status when binding exists but status is disconnected', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [{ org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null }],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? { ...mockBinding, status: 'disconnected', connected_at: null, disconnected_at: '2026-01-03T00:00:00Z' } : undefined)),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
    });

    it('opens Connect modal with tier-specific fields when Connect is clicked', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      const clickupCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      await waitFor(() => expect(clickupCard.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument());
      fireEvent.click(clickupCard.getByRole('button', { name: /^connect clickup$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Connect ClickUp' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/Personal API token/i)).toBeInTheDocument());
      expect(screen.getByLabelText(/Personal API token/i)).toHaveAttribute('type', 'password');
    });

    it('opens Connect modal with ERPNext fields when ERPNext Connect is clicked', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      const erpnextCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="erpnext"]')!);
      await waitFor(() => expect(erpnextCard.getByRole('button', { name: /^connect erpnext$/i })).toBeInTheDocument());
      fireEvent.click(erpnextCard.getByRole('button', { name: /^connect erpnext$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Connect ERPNext' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/Instance URL/i)).toBeInTheDocument());
      await waitFor(() => expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument());
      await waitFor(() => expect(screen.getByLabelText(/API Secret/i)).toHaveAttribute('type', 'password'));
    });

    it('opens ConfirmDialog when Disconnect is clicked', async () => {
      wrapWithRole('Admin', <IntegrationsView />);

      const clickupCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      await waitFor(() => expect(clickupCard.getByRole('button', { name: /^disconnect clickup$/i })).toBeInTheDocument());
      fireEvent.click(clickupCard.getByRole('button', { name: /^disconnect clickup$/i }));

      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      expect(screen.getByText(/Disconnect ClickUp\?/)).toBeInTheDocument();
      expect(screen.getByText(/Existing synced data is retained; syncing stops\./)).toBeInTheDocument();
    });

    it('calls connect mutation on modal submit with tier-specific credentials', async () => {
      const mockConnect = {
        mutateAsync: vi.fn().mockResolvedValue({ ok: true, binding: { secret_ref: 'new', status: 'active' } }),
        isPending: false,
        isError: false,
        isSuccess: true,
        isIdle: false,
        data: { ok: true, binding: { secret_ref: 'new', status: 'active' } },
        variables: undefined,
        failureCount: 0,
        failureReason: null,
        isPaused: false,
        mutate: vi.fn(),
        reset: vi.fn(),
        status: 'success' as const,
        submittedAt: 0,
      };

      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: mockConnect,
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      const clickupCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      await waitFor(() => expect(clickupCard.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument());
      fireEvent.click(clickupCard.getByRole('button', { name: /^connect clickup$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/Personal API token/i), { target: { value: 'test-token-123' } });
      const dialog = screen.getByRole('dialog', { name: 'Connect ClickUp' });
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(vi.mocked(useIntegrations).mock.results[0].value.connect.mutateAsync).toHaveBeenCalledWith({
          tier: 'clickup',
          credential: { token: 'test-token-123' },
        });
      });
    });

    it('calls disconnect mutation on ConfirmDialog confirm', async () => {
      const mockDisconnect = {
        mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        isPending: false,
        isError: false,
        isSuccess: true,
        isIdle: false,
        data: { ok: true },
        variables: undefined,
        failureCount: 0,
        failureReason: null,
        isPaused: false,
        mutate: vi.fn(),
        reset: vi.fn(),
        status: 'success' as const,
        submittedAt: 0,
      };

      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [{ org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null }],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: mockDisconnect,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? { org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null } : undefined)),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      const clickupCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      await waitFor(() => expect(clickupCard.getByRole('button', { name: /^disconnect clickup$/i })).toBeInTheDocument());
      fireEvent.click(clickupCard.getByRole('button', { name: /^disconnect clickup$/i }));

      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      const alertDialog = screen.getByRole('alertdialog');
      const confirmButton = alertDialog.querySelector('button[class*="destructive"]') as HTMLButtonElement;
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(vi.mocked(useIntegrations).mock.results[0].value.disconnect.mutateAsync).toHaveBeenCalledWith('clickup');
      });
    });

    it('shows error state inline when connect fails (422 invalid credential)', async () => {
      const error = new Error('Invalid ClickUp token');
      (error as any).code = 'config-rejected';

      const mockConnect = {
        mutateAsync: vi.fn().mockRejectedValue(error),
        isPending: false,
        isError: true,
        isSuccess: false,
        isIdle: false,
        error,
        data: undefined,
        variables: undefined,
        failureCount: 1,
        failureReason: error,
        isPaused: false,
        mutate: vi.fn(),
        reset: vi.fn(),
        status: 'error' as const,
        submittedAt: Date.now(),
      };

      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: mockConnect,
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      const clickupCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      await waitFor(() => expect(clickupCard.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument());
      fireEvent.click(clickupCard.getByRole('button', { name: /^connect clickup$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const dialog = screen.getByRole('dialog', { name: 'Connect ClickUp' });
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;

      fireEvent.change(screen.getByLabelText(/Personal API token/i), { target: { value: 'bad-token' } });
      fireEvent.click(submitButton);

      await waitFor(() => expect(vi.mocked(useIntegrations).mock.results[0].value.connect.mutateAsync).toHaveBeenCalled());

      await waitFor(() => {
        const dialogContent = screen.getByRole('dialog', { name: 'Connect ClickUp' });
        expect(dialogContent).toHaveTextContent(/Invalid ClickUp token/);
      });
    });
  });

  describe('Non-Admin view (read-only, AC-EAC-017)', () => {
    it('renders cards WITHOUT Connect/Disconnect buttons for Engineer', async () => {
      wrapWithRole('Engineer', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText(/Connected by/)).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^connect clickup$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^connect erpnext$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect erpnext$/i })).not.toBeInTheDocument();
    });

    it('renders cards WITHOUT Connect/Disconnect buttons for Project Manager', async () => {
      wrapWithRole('Project Manager', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /^connect clickup$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
    });

    it('renders cards WITHOUT Connect/Disconnect buttons for Finance', async () => {
      wrapWithRole('Finance', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /^connect clickup$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
    });
  });

  describe('Loading and error states', () => {
    it('shows loading skeleton while fetching', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: true,
        isError: false,
        isSuccess: false,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    });

    it('renders connect cards + a scoped error banner on status-load failure (does not hide the panel)', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [],
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error('Failed to load'),
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn(() => undefined),
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', error_count: 0 }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      // Design-review finding (graduated): a failed status load must NOT hide the Connect affordance.
      // The scoped error banner shows AND the tier cards still render (status falls back to Not connected).
      expect(screen.getByTestId('integrations-status-error')).toBeInTheDocument();
      expect(screen.getByTestId('integrations-connect-cards')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument();
    });
  });

  describe('Health surface (AC-EAC-016)', () => {
    it('shows last sync and error count when health data available', async () => {
      const mockGetHealth = vi.fn().mockResolvedValue({
        tier: 'clickup',
        status: 'active',
        connected_by: 'u1',
        connected_at: '2026-01-01T00:00:00Z',
        last_sync: '2026-01-02T12:30:00Z',
        error_count: 3,
      });

      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [{ org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null }],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? { org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null } : undefined)),
        getHealth: mockGetHealth,
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText(/Last sync/)).toBeInTheDocument());
      expect(screen.getByText(/Jan 2, 2026/)).toBeInTheDocument();
      expect(screen.getByText(/3 errors/)).toBeInTheDocument();
    });

    it('shows zero errors when error_count is 0', async () => {
      const mockGetHealth = vi.fn().mockResolvedValue({
        tier: 'clickup',
        status: 'active',
        connected_by: 'u1',
        connected_at: '2026-01-01T00:00:00Z',
        last_sync: '2026-01-02T00:00:00Z',
        error_count: 0,
      });

      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [{ org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null }],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true, binding: { secret_ref: 'new', status: 'active' } }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        disconnect: { mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: true, isIdle: false, data: { ok: true }, variables: undefined, failureCount: 0, failureReason: null, isPaused: false, mutate: vi.fn(), reset: vi.fn(), status: 'success', submittedAt: 0 },
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? { org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'clickup_token_org_1', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null } : undefined)),
        getHealth: mockGetHealth,
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      expect(screen.queryByText(/errors?/i)).not.toBeInTheDocument();
    });
  });
});