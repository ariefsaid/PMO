/**
 * AC-EAC-018 (moved down from the browser): an Admin connects ClickUp, then links a project to a
 * ClickUp List. The REAL useIntegrations hook, Integrations card and project card run over an
 * in-memory integrations repository, so the connection and the link each become visible state
 * because the repository now reports them, not because a mock was told to render them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IntegrationBinding, ProjectBinding } from '@/src/lib/repositories/types';

const db = vi.hoisted(() => ({
  bindings: [] as unknown[],
  projectBindings: [] as unknown[],
  connect: vi.fn(),
  link: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'admin-1', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    integrations: {
      listBindings: vi.fn(async () => [...db.bindings]),
      connectIntegration: vi.fn(async (_org: string, credential: unknown) => {
        db.connect(credential);
        db.bindings = [
          {
            org_id: 'org-1', external_tier: 'clickup', site_url: 'https://api.clickup.com', secret_ref: 'vault-ref',
            status: 'active', connected_by: 'admin-1', connected_at: '2026-01-01T00:00:00Z', disconnected_at: null, config: {},
          } satisfies IntegrationBinding,
        ];
        return { ok: true, binding: { secret_ref: 'vault-ref', status: 'active' } };
      }),
      getIntegrationHealth: vi.fn(async (_org: string, tier: string) => ({
        tier, status: 'active', connected_by: 'admin-1', connected_at: '2026-01-01T00:00:00Z', last_sync: null,
        state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 },
      })),
      listProjectLists: vi.fn(async () => [{ id: 'list-9001', name: 'Probe List', space_name: 'Space', folder_name: null }]),
      listProjectBindings: vi.fn(async () => [...db.projectBindings]),
      linkProject: vi.fn(async (_org: string, input: { projectId: string; listId: string; direction: string }) => {
        db.link(input);
        db.projectBindings = [
          {
            id: 'pb-1', org_id: 'org-1', project_id: input.projectId, external_tier: 'clickup',
            external_container_id: input.listId, config: { direction: input.direction }, linked_by: 'admin-1',
            linked_at: '2026-01-02T00:00:00Z', disconnected_at: null,
          } satisfies ProjectBinding,
        ];
        return { ok: true };
      }),
      getErpSetup: vi.fn(async () => ({
        defaults: { company: null, default_receivable_account: null, default_activity_type: null },
        domains: [], unmappedProjects: [], budgetMappedCategories: [], unlinkedEmployeeCount: 0,
      })),
    },
  },
}));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: () => ({ data: [], isPending: false, isError: false, isSuccess: true, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/lib/m365/connectClient', () => ({ initiateM365OrgApproval: vi.fn() }));

import { IntegrationsView } from './IntegrationsView';
import { ProjectIntegrationsCard } from '@/src/components/projects/ProjectIntegrationsCard';

afterEach(() => {
  cleanup();
  db.bindings = [];
  db.projectBindings = [];
  vi.clearAllMocks();
});

describe('Connect then link ClickUp (AC-EAC-018)', () => {
  it('AC-EAC-018: connecting shows the connection and its owner, then linking a project names the list on the project card', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ImpersonationProvider realRole="Admin">
          <MemoryRouter>
            <IntegrationsView />
            <ProjectIntegrationsCard projectId="proj-1" />
          </MemoryRouter>
        </ImpersonationProvider>
      </QueryClientProvider>,
    );

    const clickupCard = within(
      (await screen.findByTestId('integrations-connect-cards')).querySelector('[data-tier="clickup"]') as HTMLElement,
    );
    // Not connected yet: the project card offers nothing to link to.
    expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();

    // WHEN-a: connect with a personal token.
    await user.click(await clickupCard.findByRole('button', { name: /^Connect ClickUp$/i }));
    const connectDialog = await screen.findByRole('dialog', { name: /Connect ClickUp/i });
    await user.type(within(connectDialog).getByLabelText(/personal api token/i), 'pk_mock_token');
    await user.click(within(connectDialog).getByRole('button', { name: /^Connect ClickUp$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Connect ClickUp/i })).not.toBeInTheDocument());
    expect(db.connect).toHaveBeenCalledWith({ tier: 'clickup', credential: { token: 'pk_mock_token' } });

    // THEN: the card reads Connected, with who connected it.
    expect(await clickupCard.findByText('Connected', { exact: true })).toBeInTheDocument();
    expect(clickupCard.getByText(/Connected by:/i)).toBeInTheDocument();

    // WHEN-b: the project card now offers the link; pick the List, start from PMO tasks, review, confirm.
    await user.click(await screen.findByRole('button', { name: /^Link to ClickUp$/i }));
    const linkDialog = await screen.findByRole('dialog', { name: /Review ClickUp link/i });
    await user.click(within(linkDialog).getByRole('combobox', { name: /ClickUp List/i }));
    await user.click(await screen.findByRole('option', { name: /Probe List/ }));
    await user.click(within(linkDialog).getByRole('radio', { name: /Start with PMO tasks/i }));
    await user.click(within(linkDialog).getByRole('button', { name: /Review link/i }));
    expect(linkDialog).toHaveTextContent('Probe List');
    expect(linkDialog).toHaveTextContent('Start with PMO tasks');
    expect(linkDialog).toHaveTextContent(/Saving this link does not confirm that the initial task transfer has completed/i);
    expect(db.link).not.toHaveBeenCalled();
    await user.click(within(linkDialog).getByRole('button', { name: /Confirm ClickUp link/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Review ClickUp link/i })).not.toBeInTheDocument());
    expect(db.link).toHaveBeenCalledWith({ tier: 'clickup', projectId: 'proj-1', listId: 'list-9001', direction: 'push-seed' });

    // THEN: the project is one line naming the list.
    expect(await screen.findByText(/Linked to ClickUp list Probe List/)).toBeInTheDocument();
  });
});
