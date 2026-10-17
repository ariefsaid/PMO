/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import type { IntegrationsRepository } from '@/src/lib/repositories/types';

import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

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

import { baseExternalDomainReturn, mockBinding, wrapWithRole, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

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
      getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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

      expect(screen.getByText('Connected')).toBeInTheDocument();
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
    });

    it('AC-PLC-005: dates connection instants on the viewer-timezone calendar day', async () => {
      const current = vi.mocked(useIntegrations)();
      vi.mocked(useIntegrations).mockReturnValue({
        ...current,
        getBinding: vi.fn((tier: string) => (tier === 'clickup'
          ? { ...mockBinding, status: 'disconnected', connected_at: '2026-06-14T23:30:00Z', disconnected_at: '2026-06-15T23:30:00Z' }
          : undefined)),
      } as any);
      try {
        setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
        const { unmount } = wrapWithRole('Admin', <IntegrationsView />);
        await waitFor(() => expect(screen.getByText('Jun 15, 2026')).toBeInTheDocument());
        expect(screen.getByText('Jun 14, 2026')).toBeInTheDocument();
        unmount();

        setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
        wrapWithRole('Admin', <IntegrationsView />);
        await waitFor(() => expect(screen.getByText('Jun 16, 2026')).toBeInTheDocument());
        expect(screen.getByText('Jun 15, 2026')).toBeInTheDocument();
        expect(screen.queryByText('Jun 14, 2026')).not.toBeInTheDocument();
      } finally {
        resetActiveLocale();
      }
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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
      fireEvent.click(clickupCard.getByText('Connection options'));
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
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

      // NFR: the dialog surfaces FIXED generic task-level copy, never a raw transport/credential
      // detail (the rejected error's message must not leak into the UI).
      await waitFor(() => {
        const dialogContent = screen.getByRole('dialog', { name: 'Connect ClickUp' });
        expect(dialogContent).toHaveTextContent(/Could not connect/i);
        expect(dialogContent).not.toHaveTextContent(/Invalid ClickUp token/);
        expect(dialogContent).not.toHaveTextContent(/bad-token/);
      });
    });
  })

describe('Non-Admin view (read-only, AC-EAC-017)', () => {
    it('renders cards WITHOUT Connect/Disconnect buttons for Engineer', async () => {
      wrapWithRole('Engineer', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.getByText('Connected')).toBeInTheDocument();
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
  })

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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    });

    it('AC-IRUX-001 binding-read failure: connection state is unknown (not disconnected), Retry is offered, and the permitted Connect remains (no Disconnect from an unknown binding)', async () => {
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
        getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: '2026-01-02T00:00:00Z', state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      // Design-review finding (graduated): a failed status load must NOT hide the Connect affordance.
      // The scoped error banner shows AND the tier cards still render.
      expect(screen.getByTestId('integrations-status-error')).toBeInTheDocument();
      expect(screen.getByTestId('integrations-connect-cards')).toBeInTheDocument();
      // AC-IRUX-001: connection state is labelled unknown per card, never Disconnected/Not connected.
      expect(screen.getAllByText('Connection state unavailable')).toHaveLength(2);
      expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
      expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
      // Retry is offered per card and via the scoped banner.
      expect(screen.getAllByRole('button', { name: /Retry status/i })).toHaveLength(2);
      // The permitted Connect action remains reachable; Disconnect is never offered from an unknown binding.
      expect(screen.getByRole('button', { name: /^connect clickup$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^connect erpnext$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^disconnect clickup$/i })).not.toBeInTheDocument();
    });
  })
});

// ============================================================================
// AC-IRUX-008 — disconnect failure keeps the dialog open and permits Retry
// ============================================================================
describe('AC-IRUX-008 disconnect failure recovery', () => {
  it('keeps the confirm dialog open with a generic failure, relabels Retry, and allows another attempt without implying syncing stopped', async () => {
    const disconnect = { mutateAsync: vi.fn().mockRejectedValue(new Error('boom')), isPending: false };
    vi.mocked(useIntegrations).mockReturnValue({
      bindings: [mockBinding],
      isPending: false,
      isError: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
      connect: { mutateAsync: vi.fn(), isPending: false },
      disconnect,
      getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockBinding : undefined)),
      getHealth: vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: null, state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } }),
    } as any);
    wrapWithRole('Admin', <IntegrationsView />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^disconnect clickup$/i }));
    const dialog = screen.getByRole('alertdialog');
    const confirm = dialog.querySelector('button[class*="destructive"]') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    await user.click(confirm);

    await waitFor(() => expect(disconnect.mutateAsync).toHaveBeenCalledWith('clickup'));
    // Dialog stays open; generic failure is visible; no implication syncing stopped.
    const dlg = screen.getByRole('alertdialog');
    expect(dlg).toBeInTheDocument();
    expect(dlg).toHaveTextContent(/Disconnect did not complete/i);
    expect(dlg).toHaveTextContent(/connection and syncing may be unchanged/i);
    // Confirm relabels to a retry and works.
    const retry = within(dlg).getByRole('button', { name: /Try disconnect again/i });
    await user.click(retry);
    expect(disconnect.mutateAsync).toHaveBeenCalledTimes(2);
  });
})
