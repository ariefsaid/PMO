/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { screen, waitFor, within } from '@testing-library/react';

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

import { useAssignableProfiles } from '@/src/hooks/useTasks';

import { baseExternalDomainReturn, bindingMapIntegrations, emptyProfilesReturn, mockBinding, profile, wrapWithRole, wrapWithRoleAndLocale, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

// ============================================================================
// AC-M365SEP-017 — M365 organisation approval (step 2) on the admin integrations surface.
// The affordance renders BESIDE ClickUp and ERPNext for an org Admin. It is its OWN block, NOT a
// TIERS entry (M365 has no external_org_bindings row / health probe / SoT domains). The FE gate is
// Admin-only; the edge fn re-enforces Admin-of-org OR Operator (ADR-0016 — FE authz is UX-only).
// ============================================================================
describe('AC-M365SEP-017 — M365 organisation approval on the admin surface', () => {
  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations() as any);
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
  });

  it('AC-M365SEP-017: renders the M365 organisation-approval affordance for an org Admin, beside ClickUp and ERPNext', async () => {
    wrapWithRole('Admin', <IntegrationsView />);

    // The admin integrations surface renders the M365 org-approval block ALONGSIDE the tier cards
    // — it sits on the same surface, not a parallel one (FR-M365SEP-009).
    expect(await screen.findByTestId('m365-org-approval')).toBeInTheDocument();
    expect(screen.getByText('ClickUp')).toBeInTheDocument();
    expect(screen.getByText('ERPNext')).toBeInTheDocument();

    // The affordance is a labelled action button visible to an Admin.
    expect(
      screen.getByRole('button', { name: /approve in microsoft 365/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('m365-org-approval')).toHaveTextContent(/only if microsoft asks/i);
    // It is NOT a TIERS entry — no data-tier attribute, no credential Connect form. M365 is its own
    // block (a mutation here guards against someone forcing it into the TIERS array).
    const m365Card = screen.getByTestId('m365-org-approval');
    expect(m365Card.getAttribute('data-tier')).toBeNull();
  });

  it('AC-M365SEP-017: the M365 organisation-approval affordance is NOT rendered for a non-Admin (FE Admin-only; edge re-enforces)', async () => {
    wrapWithRole('Engineer', <IntegrationsView />);
    await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

    // A non-Admin sees the tier cards (read-only) but NOT the M365 org-approval block.
    expect(screen.queryByTestId('m365-org-approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve in microsoft 365/i })).not.toBeInTheDocument();
  });
})

describe('IntegrationsView — organization ownership scope label (AC-ADMIA-006)', () => {
  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations() as any);
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
  });

  it('labels the panel as organization-owned and separate from the personal route', async () => {
    wrapWithRole('Admin', <IntegrationsView />);
    const scope = await screen.findByTestId('integrations-owner-scope');
    // The org surface labels its scope explicitly…
    expect(scope).toHaveTextContent(/organization/i);
    // A personal connection never activates organization integrations.
    expect(scope).toHaveTextContent(/personal connections do not activate organization integrations/i);
  });

  it('AC-ADMIA-006: the org scope copy names the personal surface by label, never a raw route string', async () => {
    wrapWithRole('Admin', <IntegrationsView />);
    const scope = await screen.findByTestId('integrations-owner-scope');
    // The personal surface is referenced by its user-facing name "My integrations"…
    expect(screen.getByRole('link', { name: /my integrations/i })).toHaveAttribute('href', '/integrations');
    // The personal surface is a real navigation destination, not a route string in prose.
    expect(scope.textContent).not.toContain('/integrations');
  });
})

// ============================================================================
// #680 — Readable organization connector identity (AC-ICI-001..004)
// The card resolves `connected_by` against the org-scoped profile source and shows a readable name
// or a translated neutral fallback — never the raw actor value. Profile-read state is display-only
// and must not change the independently derived binding/health/authorization states.
// ============================================================================
describe('AC-ICI readable organization connector identity (#680)', () => {
  const activeClickUp = (player: Record<string, unknown> = {}) => ({
    ...bindingMapIntegrations(),
    bindings: [mockBinding],
    getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockBinding : undefined)),
    getHealth: vi.fn().mockResolvedValue({
      tier: 'clickup',
      status: 'active',
      connected_by: mockBinding.connected_by,
      connected_at: mockBinding.connected_at,
      last_sync: null,
      state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 },
    }),
    ...player,
  } as any);

  it('AC-ICI-001 resolves a same-org profile name beside the connection date, never the raw actor', () => {
    vi.mocked(useAssignableProfiles).mockReturnValue({ ...emptyProfilesReturn, data: [profile('u1', 'Ada Lovelace')] } as any);
    vi.mocked(useIntegrations).mockReturnValue(activeClickUp());
    wrapWithRole('Admin', <IntegrationsView />);
    const card = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
    // The readable display name is shown…
    expect(card.getByText('Ada Lovelace')).toBeInTheDocument();
    // …beside the existing formatted connection date…
    expect(card.getByText(/Jan 1, 2026/)).toBeInTheDocument();
    // …and the raw technical actor value is never interpolated.
    expect(card.queryByText('u1', { exact: true })).not.toBeInTheDocument();
  });

  it.each([
    ['an unmatched actor', { connected_by: 'actor-999' }, [profile('u1', 'Ada Lovelace')]],
    ['a whitespace-only profile name', { connected_by: 'u1' }, [profile('u1', '   ')]],
    ['a missing actor', { connected_by: null }, []],
  ])('AC-ICI-002 %s shows the neutral fallback, keeps the date, and hides the raw actor', (_label, bp, profiles) => {
    const binding = { ...mockBinding, ...(bp as object) };
    vi.mocked(useAssignableProfiles).mockReturnValue({ ...emptyProfilesReturn, data: profiles as any } as any);
    vi.mocked(useIntegrations).mockReturnValue(activeClickUp({
      bindings: [binding],
      getBinding: vi.fn((tier: string) => (tier === 'clickup' ? binding : undefined)),
    }));
    wrapWithRole('Admin', <IntegrationsView />);
    const card = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
    // The translated neutral fallback is shown…
    expect(card.getByText('Former or unavailable user')).toBeInTheDocument();
    // …beside the retained connection date…
    expect(card.getByText(/Jan 1, 2026/)).toBeInTheDocument();
    // …and the raw actor value is never rendered.
    const actor = (bp as { connected_by: string | null }).connected_by;
    if (actor) expect(card.queryByText(actor, { exact: true })).not.toBeInTheDocument();
  });

  it('AC-ICI-002 shows the translated fallback in Bahasa and never the English string', async () => {
    vi.mocked(useAssignableProfiles).mockReturnValue(emptyProfilesReturn);
    vi.mocked(useIntegrations).mockReturnValue(activeClickUp());
    await wrapWithRoleAndLocale('Admin', 'id', <IntegrationsView />);
    const card = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
    expect(card.getByText('Pengguna sebelumnya atau tidak tersedia')).toBeInTheDocument();
    expect(card.queryByText('Former or unavailable user')).not.toBeInTheDocument();
    expect(card.getByText(/Jan 1, 2026/)).toBeInTheDocument();
  });

  it.each([
    ['pending', { data: undefined, isPending: true, isError: false, isSuccess: false }],
    ['errored', { data: undefined, isPending: false, isError: true, isSuccess: false }],
  ])('AC-ICI-003 a %s profile read keeps binding, health, and allowed actions truthful', async (_state, qs) => {
    vi.mocked(useAssignableProfiles).mockReturnValue({ ...emptyProfilesReturn, ...(qs as object) } as any);
    vi.mocked(useIntegrations).mockReturnValue(activeClickUp());
    wrapWithRole('Admin', <IntegrationsView />);
    const card = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
    // …the separately derived health read stays truthful (await the async read)…
    await waitFor(() => expect(card.getByText(/No updates waiting/i)).toBeInTheDocument());
    // The identity display has a safe fallback…
    expect(card.getByText('Former or unavailable user')).toBeInTheDocument();
    // …while the independent binding state stays Connected…
    expect(card.getByText('Connected')).toBeInTheDocument();
    // …and the Admin's already-permitted control remains available.
    expect(card.getByRole('button', { name: /^disconnect clickup$/i })).toBeInTheDocument();
    // Neither case relabels the binding as unavailable/disconnected.
    expect(card.queryByText('Connection state unavailable')).not.toBeInTheDocument();
    expect(card.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  it('AC-ICI-004 a read-only Engineer at 390px in Bahasa sees fallback + date and no management controls', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      vi.mocked(useAssignableProfiles).mockReturnValue(emptyProfilesReturn);
      vi.mocked(useIntegrations).mockReturnValue(activeClickUp());
      await wrapWithRoleAndLocale('Engineer', 'id', <IntegrationsView />);
      const card = within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="clickup"]')!);
      // Translated fallback + retained date sit inside the card's metadata container…
      const fallback = card.getByText('Pengguna sebelumnya atau tidak tersedia');
      const metadata = fallback.closest('.flex.flex-wrap')!;
      expect(metadata).toHaveTextContent(/Jan 1, 2026/);
      expect(card.getByText(/Jan 1, 2026/)).toBeInTheDocument();
      // …and the read-only viewer gets no management controls.
      expect(card.queryByRole('button', { name: /^hubungkan clickup$/i })).not.toBeInTheDocument();
      expect(card.queryByRole('button', { name: /^putuskan koneksi clickup$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^pilih perusahaan$/i })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });
})
