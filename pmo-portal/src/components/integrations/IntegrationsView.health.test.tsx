/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, screen, waitFor, within } from '@testing-library/react';

import type { IntegrationHealth } from '@/src/lib/repositories/types';

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

import { baseExternalDomainReturn, wrapWithRole, installIntegrationDefaults } from './IntegrationsView.test-helpers';

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

describe('Health surface (AC-EAC-016 / AC-IRUX-003 / AC-IRUX-004)', () => {
    const activeBinding = {
      org_id: 'org-1',
      external_tier: 'clickup',
      site_url: 'https://api.clickup.com',
      secret_ref: 'clickup_token_org_1',
      status: 'active' as const,
      connected_by: 'u1',
      connected_at: '2026-01-01T00:00:00Z',
      disconnected_at: null,
    };
    const baseReturn = (getHealthFn: unknown) => ({
      orgId: 'org-1',
      bindings: [activeBinding],
      isPending: false,
      isError: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
      connect: { mutateAsync: vi.fn(), isPending: false },
      disconnect: { mutateAsync: vi.fn(), isPending: false },
      getBinding: vi.fn((tier: string) => (tier === 'clickup' ? activeBinding : undefined)),
      getHealth: getHealthFn,
    });

    it('AC-IRUX-002: a successful binding is labelled Connected, and absent connector identity is not shown as a blank field', async () => {
      const binding = { ...activeBinding, connected_by: null };
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseReturn(vi.fn().mockResolvedValue({ tier: 'clickup', status: 'active', connected_by: null, connected_at: binding.connected_at, last_sync: null, state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } })),
        bindings: [binding],
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? binding : undefined)),
      } as any);
      wrapWithRole('Admin', <IntegrationsView />);
      const card = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      expect(card.getByText('Connected')).toBeInTheDocument();
      // #680 (AC-ICI-002): an absent/blank actor now renders the translated neutral fallback on the
      // always-present Connector line — never a blank field and never a raw actor value.
      expect(card.getByText(/Connected by/i)).toBeInTheDocument();
      expect(card.getByText('Former or unavailable user')).toBeInTheDocument();
    });

    it('AC-IRUX-003: an unavailable health read names outbound work status as unknown', async () => {
      vi.mocked(useIntegrations).mockReturnValue(baseReturn(vi.fn().mockRejectedValue(new Error('unavailable'))) as any);
      wrapWithRole('Admin', <IntegrationsView />);
      await waitFor(() => expect(screen.getByText(/Outbound work status unavailable/i)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /Retry outbound status/i })).toBeInTheDocument();
    });

    it('AC-IRUX-004: a non-null watermark time is never rendered as a sync time or data-progress proof; outstanding outbound work is labelled and a live record check is offered', async () => {
      const mockGetHealth = vi.fn().mockResolvedValue({
        tier: 'clickup',
        status: 'active',
        connected_by: 'u1',
        connected_at: '2026-01-01T00:00:00Z',
        last_sync: '2026-01-02T12:30:00Z',
        state_counts: { pending: 2, failed: 1, quarantined: 1, held: 1 },
      });
      vi.mocked(useIntegrations).mockReturnValue(baseReturn(mockGetHealth) as any);
      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('2 updates waiting to send')).toBeInTheDocument());
      // No last-sync claim and no rendered timestamp (the watermark row time is not a sync proof).
      expect(screen.queryByText(/Last sync/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Jan 2, 2026/)).not.toBeInTheDocument();
      // Waiting is quiet and distinct from actionable failures.
      expect(screen.getByText('2 updates waiting to send')).toBeInTheDocument();
      expect(screen.getByText('1 failed update needs attention')).toBeInTheDocument();
      expect(screen.getByText('1 quarantined update needs attention')).toBeInTheDocument();
      expect(screen.getByText('1 held update needs attention')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Review failed updates' })).toHaveAttribute('href', '/projects');
      expect(screen.getByRole('link', { name: 'Review quarantined updates' })).toHaveAttribute('href', '/projects');
      expect(screen.getByRole('link', { name: 'Review held updates' })).toHaveAttribute('href', '/projects');
      expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /review connected records/i })).toHaveAttribute('href', '/projects');
    });

    it('AC-IRUX-004: a null watermark with a single outstanding item renders the singular label and no sync-time claim', async () => {
      const mockGetHealth = vi.fn().mockResolvedValue({
        tier: 'clickup',
        status: 'active',
        connected_by: 'u1',
        connected_at: '2026-01-01T00:00:00Z',
        last_sync: null,
        state_counts: { pending: 1, failed: 0, quarantined: 0, held: 0 },
      });
      vi.mocked(useIntegrations).mockReturnValue(baseReturn(mockGetHealth) as any);
      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('1 update waiting to send')).toBeInTheDocument());
      expect(screen.queryByText(/Last sync/i)).not.toBeInTheDocument();
      expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
    });

    it('AC-IRUX-003: one tier’s unavailable health leaves a healthy sibling’s recorded progress legible, with a Retry on the failed card', async () => {
      const clickupBinding = activeBinding;
      const erpnextBinding = { ...activeBinding, external_tier: 'erpnext' as const, config: { company: 'Acme Corp' } };
      const getHealth = vi.fn().mockImplementation((tier: string) =>
        tier === 'clickup'
          ? Promise.resolve({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: null, state_counts: { pending: 1, failed: 1, quarantined: 0, held: 0 } })
          : Promise.reject(new Error('health read failed')),
      );
      vi.mocked(useIntegrations).mockReturnValue({
        orgId: 'org-1',
        bindings: [clickupBinding, erpnextBinding],
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false },
        disconnect: { mutateAsync: vi.fn(), isPending: false },
        getBinding: vi.fn((tier: string) => {
          if (tier === 'clickup') return clickupBinding;
          if (tier === 'erpnext') return erpnextBinding;
          return undefined;
        }),
        getHealth,
      } as any);

      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('1 failed update needs attention')).toBeInTheDocument());
      // The failed tier labels its own data-progress read unavailable and offers Retry, without
      // blanking the healthy sibling’s progress.
      const erpnextCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="erpnext"]')!);
      expect(within(erpnextCard.getByText(/Outbound work status unavailable/i).closest('div')!).getByRole('button', { name: /Retry outbound status/i })).toBeInTheDocument();
      const clickupCard = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      const clickupHealthWrap = clickupCard.getByText('1 update waiting to send').closest('div')!;
      expect(clickupHealthWrap).toHaveTextContent(/not yet verified/i);
    });

    it('AC-IRUX-003: a slow ERPNext read does not delay ClickUp outbound status', async () => {
      const erpnextBinding = { ...activeBinding, external_tier: 'erpnext' as const, config: { company: 'Example Company' } };
      const getHealth = vi.fn((tier: string) =>
        tier === 'clickup'
          ? Promise.resolve({ tier: 'clickup', status: 'active', connected_by: 'u1', connected_at: activeBinding.connected_at, last_sync: null, state_counts: { pending: 2, failed: 0, quarantined: 0, held: 0 } })
          : new Promise<IntegrationHealth>(() => {}),
      );
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseReturn(getHealth),
        bindings: [activeBinding, erpnextBinding],
        getBinding: vi.fn((tier: string) => tier === 'clickup' ? activeBinding : tier === 'erpnext' ? erpnextBinding : undefined),
      } as any);
      wrapWithRole('Admin', <IntegrationsView />);

      const cards = screen.getByTestId('integrations-connect-cards');
      const clickupCard = within(cards.querySelector('[data-tier="clickup"]')!);
      const erpnextCard = within(cards.querySelector('[data-tier="erpnext"]')!);
      await waitFor(() => expect(clickupCard.getByText('2 updates waiting to send')).toBeInTheDocument());
      expect(erpnextCard.getByText(/Checking outbound work status/i)).toBeInTheDocument();
    });

    it('AC-IRUX-004: available health with zero outstanding work still reports a localized zero count, never a silent blank', async () => {
      const mockGetHealth = vi.fn().mockResolvedValue({
        tier: 'clickup',
        status: 'active',
        connected_by: 'u1',
        connected_at: '2026-01-01T00:00:00Z',
        last_sync: null,
        state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 },
      });
      vi.mocked(useIntegrations).mockReturnValue(baseReturn(mockGetHealth) as any);
      wrapWithRole('Admin', <IntegrationsView />);

      await waitFor(() => expect(screen.getByText('No updates waiting to send')).toBeInTheDocument());
      expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
      expect(screen.queryByText(/Last sync/i)).not.toBeInTheDocument();
    });

    it('FR-IRUX-009: health tiers derive only from a successful binding read — a failed read cannot feed a health probe from stale cached data', async () => {
      // bindings + getBinding advertise an active ClickUp binding (stale/cached), but the query is
      // NOT a success (failed read).
      const getHealth = vi.fn();
      vi.mocked(useIntegrations).mockReturnValue({
        bindings: [activeBinding],
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error('binding read failed'),
        refetch: vi.fn(),
        connect: { mutateAsync: vi.fn(), isPending: false },
        disconnect: { mutateAsync: vi.fn(), isPending: false },
        getBinding: vi.fn(() => activeBinding),
        getHealth,
      } as any);
      wrapWithRole('Admin', <IntegrationsView />);

      // The card labels connection state unknown (AC-IRUX-001) and the health probe must NOT run.
      expect(screen.getAllByText('Connection state unavailable')).toHaveLength(2);
      expect(getHealth).not.toHaveBeenCalled();
      expect(screen.queryByText(/outbound items pending/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId('clickup-binding-map')).not.toBeInTheDocument();
    });

    it('FR-IRUX-010: the tier header reflows (flex-wrap) so the long activation status never overflows at 390px', async () => {
      vi.mocked(useIntegrations).mockReturnValue(baseReturn(vi.fn().mockResolvedValue(null)) as any);
      wrapWithRole('Admin', <IntegrationsView />);
      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      const card = screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!;
      const header = card.querySelector('.flex');
      expect(header).not.toBeNull();
      expect(header!.className).toContain('flex-wrap');
      const status = within(card as HTMLElement).getByText('Connected', { exact: true });
      expect(status.className).toContain('whitespace-normal');
      expect(status.className).toContain('max-w-full');
    });
  })
});
