/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';

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

import { baseExternalDomainReturn, bindingMapIntegrations, project, wrapWithRole, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

describe('Admin ClickUp binding map (AC-IEM-013, AC-IEM-016)', () => {
  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations() as any);
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
  });

  it('AC-IEM-013 renders bound and PMO-native projects from the exact binding relation', () => {
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'Harbor Upgrade'), project('p2', 'Office Fitout')] } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
      projectBindings: [{ id: 'b1', org_id: 'org-1', project_id: 'p1', external_tier: 'clickup', external_container_id: 'l1', config: {}, linked_by: null, linked_at: null, disconnected_at: null }],
      clickupLists: [{ id: 'l1', name: 'Harbor List', space_name: 'Delivery', folder_name: null }],
    }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    const map = screen.getByTestId('clickup-binding-map');
    expect(within(map).getByRole('row', { name: /Harbor Upgrade.*Harbor List.*Bound/i })).toBeInTheDocument();
    expect(within(map).getByRole('row', { name: /Office Fitout.*PMO-native/i })).toBeInTheDocument();
  });

  it('AC-IEM-016 shows an untracked ClickUp List alongside both PMO project states', () => {
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'P1'), project('p2', 'P2')] } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
      projectBindings: [{ id: 'b1', org_id: 'org-1', project_id: 'p1', external_tier: 'clickup', external_container_id: 'l1', config: {}, linked_by: null, linked_at: null, disconnected_at: null }],
      clickupLists: [
        { id: 'l1', name: 'L1', space_name: 'Space', folder_name: null },
        { id: 'l2', name: 'L2', space_name: 'Space', folder_name: 'Folder' },
      ],
    }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByRole('row', { name: /P1.*L1.*Bound/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /P2.*PMO-native/i })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Untracked ClickUp Lists' })).getByText(/L2/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Untracked ClickUp Lists' })).getByText(/PMO does not track/)).toBeInTheDocument();
  });

  it('AC-S21-003 leaves an exact list proposal unwritten until the Admin reviews and confirms it', async () => {
    const linkProject = vi.fn().mockResolvedValue({ ok: true });
    const refetchBindings = vi.fn();
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'Harbor Upgrade')] } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
      projectBindings: [],
      clickupLists: [{ id: 'list-42', name: 'Harbor Upgrade', space_name: 'Delivery', folder_name: null }],
      linkProject: { mutateAsync: linkProject, isPending: false },
      refetchBindings,
    }) as any);
    wrapWithRole('Admin', <IntegrationsView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Review list match' }));
    const review = await screen.findByRole('dialog', { name: 'Review ClickUp link' });
    expect(review).toHaveTextContent('Harbor Upgrade');
    expect(review).toHaveTextContent(/suggested exact name match/i);
    expect(linkProject).not.toHaveBeenCalled();

    fireEvent.click(within(review).getByRole('radio', { name: /Start with existing list tasks/i }));
    fireEvent.click(within(review).getByRole('button', { name: 'Review link' }));
    expect(review).toHaveTextContent('Harbor Upgrade');
    expect(review).toHaveTextContent(/Start with existing list tasks/i);
    expect(linkProject).not.toHaveBeenCalled();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm ClickUp link' }));
    await waitFor(() => expect(linkProject).toHaveBeenCalledWith({
      tier: 'clickup',
      projectId: 'p1',
      listId: 'list-42',
      direction: 'pull-adopt',
    }));
  });

  it('renders a neutral empty map when ClickUp is active with zero bindings', () => {
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'P1')] } as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(within(screen.getByTestId('integrations-connect-cards')).getByText('Connected')).toBeInTheDocument();
    expect(screen.getByTestId('clickup-binding-map-empty')).toHaveTextContent(/No PMO projects are bound to ClickUp yet/i);
    expect(screen.getByTestId('clickup-binding-map-empty')).not.toHaveClass('text-destructive');
  });

  it('keeps the PMO map visible when ClickUp Lists are unavailable', () => {
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'P1')] } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({ isListsError: true, listsError: new Error('unavailable') }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByRole('row', { name: /P1.*Unknown/i })).toBeInTheDocument();
    expect(screen.getByText(/ClickUp lists are unavailable/i)).toBeInTheDocument();
  });
})

// ============================================================================
// AC-IRUX-006 — ClickUp binding map: per-source loading / unavailable states with
// Unknown (never PMO-native) rows and source-specific Retry.
// ============================================================================
describe('AC-IRUX-006 ClickUp binding map source states', () => {
  beforeEach(() => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'P1')], isPending: false, isError: false, refetch: vi.fn() } as any);
  });

  it('AC-IRUX-006 lists loading shows a source notice and Unknown rows, never PMO-native', () => {
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({ isListsPending: true }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByText(/Loading ClickUp lists…/i)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /P1.*Unknown/i })).toBeInTheDocument();
    expect(screen.queryByText(/PMO-native/i)).not.toBeInTheDocument();
  });

  it('AC-IRUX-006 lists unavailable shows a generic notice + Retry wired to refetchLists, rows Unknown', () => {
    const refetchLists = vi.fn();
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({ isListsError: true, refetchLists }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByText(/ClickUp lists are unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry lists/i }));
    expect(refetchLists).toHaveBeenCalled();
    expect(screen.getByRole('row', { name: /P1.*Unknown/i })).toBeInTheDocument();
    expect(screen.queryByText(/PMO-native/i)).not.toBeInTheDocument();
  });

  it('AC-IRUX-006 project-bindings unavailable shows a generic notice + Retry wired to refetchBindings, rows Unknown', () => {
    const refetchBindings = vi.fn();
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({ isBindingsError: true, isBindingsPending: false, refetchBindings }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByText(/Project bindings are unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry bindings/i }));
    expect(refetchBindings).toHaveBeenCalled();
    expect(screen.getByRole('row', { name: /P1.*Unknown/i })).toBeInTheDocument();
  });

  it('AC-IRUX-006 project-bindings loading shows a source notice and keeps project identities with Unknown values', () => {
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({ isBindingsPending: true }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByText(/Loading project bindings…/i)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /P1.*Unknown/i })).toBeInTheDocument();
    expect(screen.queryByText(/PMO-native/i)).not.toBeInTheDocument();
  });

  it('AC-IRUX-006 projects unavailable shows a generic notice + Retry wired to projectsQuery.refetch', () => {
    const projectsRefetch = vi.fn();
    vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: true, refetch: projectsRefetch } as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByText(/Projects are unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry projects/i }));
    expect(projectsRefetch).toHaveBeenCalled();
  });

  it('AC-IRUX-006 a healthy map still displays Bound and PMO-native classifications', () => {
    vi.mocked(useProjects).mockReturnValue({ data: [project('p1', 'Harbor Upgrade'), project('p2', 'Office Fitout')], isPending: false, isError: false } as any);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
      projectBindings: [{ id: 'b1', org_id: 'org-1', project_id: 'p1', external_tier: 'clickup', external_container_id: 'l1', config: {}, linked_by: null, linked_at: null, disconnected_at: null }],
      clickupLists: [{ id: 'l1', name: 'Harbor List', space_name: 'Delivery', folder_name: null }],
    }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(screen.getByRole('row', { name: /Harbor Upgrade.*Harbor List.*Bound/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Harbor Upgrade' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Office Fitout.*PMO-native/i })).toBeInTheDocument();
  });

  it.each(['isListsError', 'isBindingsError'])('AC-IRUX-006 cached map rows become Unknown when %s is true', (failedSource) => {
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
      projectBindings: [{ id: 'b1', org_id: 'org-1', project_id: 'p1', external_tier: 'clickup', external_container_id: 'l1', config: {}, linked_by: null, linked_at: null, disconnected_at: null }],
      clickupLists: [{ id: 'l1', name: 'Cached List', space_name: 'Delivery', folder_name: null }],
      [failedSource]: true,
    }) as any);
    wrapWithRole('Admin', <IntegrationsView />);
    const row = screen.getByRole('row', { name: /P1/i });
    expect(row).toHaveTextContent('Unknown');
    expect(row).not.toHaveTextContent('Cached List');
    expect(row).not.toHaveTextContent('Bound');
  });
})
