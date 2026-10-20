/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import React from 'react';
import { ProjectIntegrationsCard } from '../ProjectIntegrationsCard';
import type { ClickUpListItem, ProjectBinding, IntegrationBinding } from '@/src/lib/repositories/types';

vi.mock('@/src/hooks/useIntegrations', () => ({
  useIntegrations: vi.fn(),
}));

import { useIntegrations } from '@/src/hooks/useIntegrations';

const mockClickUpLists: ClickUpListItem[] = [
  { id: 'list-1', name: 'Sprint Backlog', space_name: 'Engineering', folder_name: 'Sprints' },
  { id: 'list-2', name: 'Bug Triage', space_name: 'Engineering', folder_name: null },
  { id: 'list-3', name: 'Product Roadmap', space_name: 'Product', folder_name: 'Planning' },
];

const mockClickUpBinding: IntegrationBinding = {
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

const mockProjectClickUpBinding: ProjectBinding = {
  id: 'binding-1',
  org_id: 'org-1',
  project_id: 'proj-1',
  external_tier: 'clickup',
  external_container_id: 'list-1',
  config: { direction: 'push-seed', statusMap: {}, memberMap: {} },
  linked_by: 'u1',
  linked_at: '2026-01-02T00:00:00Z',
  disconnected_at: null,
};

const baseMockReturn = {
  clickupLists: mockClickUpLists,
  isListsPending: false,
  linkProject: {
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
  },
  unlinkProject: {
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
  },
  projectBindings: [],
  isBindingsPending: false,
  refetchBindings: vi.fn(),
  getBinding: vi.fn(),
};

const wrapWithRole = (role: string, ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role as any}>
        <MemoryRouter>{ui}</MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>
  );
};

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('ProjectIntegrationsCard', () => {
  beforeEach(() => {
    vi.mocked(useIntegrations).mockReturnValue({
      ...baseMockReturn,
      getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
      projectBindings: [],
    } as any);
  });

  describe('Admin view (write controls visible)', () => {
    it('renders ClickUp tier card with Connected (org) status and Link button when org connected but project not linked', async () => {
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('External Integrations')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      // ERPNext tier should NOT be rendered
      expect(screen.queryByText('ERPNext')).not.toBeInTheDocument();

      // ClickUp shows Connected (org) status
      expect(screen.getByText('Connected (org)')).toBeInTheDocument();
      // Link button visible for ClickUp
      expect(screen.getByRole('button', { name: /^Link to ClickUp$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink/i })).not.toBeInTheDocument();
    });

    it('SUB-F renders nothing at all when ClickUp is neither connected nor linked', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn(() => undefined),
        projectBindings: [],
      } as any);

      const { container } = wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" compact />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText('ClickUp')).not.toBeInTheDocument();
      expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
      expect(screen.queryByText(/Set up ClickUp|Ask an integration administrator/)).not.toBeInTheDocument();
    });

    it('keeps link review unavailable while the list choices are loading', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        isListsPending: true,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      const linkButton = await screen.findByRole('button', { name: /^Link to ClickUp$/i });
      expect(linkButton).toBeDisabled();
    });

    it('renders Linked status with details when project is already linked to ClickUp', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      // SUB-F: a linked project is ONE line — the list and an Unlink — with no card chrome around it.
      const clickupCardElement = await waitFor(() => {
        const el = screen.getByTestId('project-integrations-cards').querySelector<HTMLElement>('[data-tier="clickup"]');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(clickupCardElement).toHaveTextContent('Linked to ClickUp list Sprint Backlog');
      expect(screen.queryByText('Linked')).not.toBeInTheDocument();
      expect(clickupCardElement).not.toHaveTextContent(/Initial source/i);
      expect(screen.queryByText(/Initial task transfer is not confirmed/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Unlink from ClickUp$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
    });

    it('opens Link modal with ClickUp List picker when Link to ClickUp is clicked', async () => {
      const user = userEvent.setup();
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByRole('button', { name: /^Link to ClickUp$/i })).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Review ClickUp link' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'ClickUp List' })).toBeInTheDocument());
    });

    it('offers an explicit initial task source for ClickUp links', async () => {
      const user = userEvent.setup();
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      expect(screen.getByRole('radio', { name: /Start with PMO tasks/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Start with existing list tasks/i })).toBeInTheDocument();
      expect(screen.queryByText('Sync Direction')).not.toBeInTheDocument();
    });

    it('AC-S21-003 reviews the project, stable list, and initial source before writing the link', async () => {
      const user = userEvent.setup();
      const mockLinkProject = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
        linkProject: {
          ...baseMockReturn.linkProject,
          mutateAsync: mockLinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" projectName="Delivery Alpha" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      const dialog = await screen.findByRole('dialog', { name: 'Review ClickUp link' });
      await user.click(within(dialog).getByRole('combobox', { name: 'ClickUp List' }));
      const listbox = await screen.findByRole('listbox');
      await user.click(within(listbox).getByRole('option', { name: /Sprint Backlog/i }));
      await user.click(within(dialog).getByRole('radio', { name: /Start with PMO tasks/i }));

      expect(mockLinkProject).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: /Review link/i }));

      const reviewed = screen.getByRole('dialog', { name: 'Review ClickUp link' });
      expect(reviewed).toHaveTextContent('Delivery Alpha');
      expect(reviewed).toHaveTextContent('Sprint Backlog');
      expect(reviewed).toHaveTextContent(/Start with PMO tasks/i);
      expect(reviewed).toHaveTextContent(/initial task transfer only/i);
      expect(mockLinkProject).not.toHaveBeenCalled();

      await user.click(within(reviewed).getByRole('button', { name: /Confirm ClickUp link/i }));
      await waitFor(() => expect(mockLinkProject).toHaveBeenCalledWith({
        tier: 'clickup',
        projectId: 'proj-1',
        listId: 'list-1',
        direction: 'push-seed',
      }));
    });

    it('AC-S21-003 keeps the selected list and initial source visible after link failure', async () => {
      const user = userEvent.setup();
      const mockLinkProject = vi.fn().mockRejectedValue(new Error('temporary connection failure'));
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
        linkProject: {
          ...baseMockReturn.linkProject,
          mutateAsync: mockLinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" projectName="Delivery Alpha" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      const dialog = await screen.findByRole('dialog', { name: 'Review ClickUp link' });
      await user.click(within(dialog).getByRole('combobox', { name: 'ClickUp List' }));
      const listbox = await screen.findByRole('listbox');
      await user.click(within(listbox).getByRole('option', { name: /Bug Triage/i }));
      await user.click(within(dialog).getByRole('radio', { name: /Start with existing list tasks/i }));
      await user.click(within(dialog).getByRole('button', { name: /Review link/i }));
      await user.click(within(dialog).getByRole('button', { name: /Confirm ClickUp link/i }));

      const failedReview = await screen.findByRole('dialog', { name: 'Review ClickUp link' });
      expect(failedReview).toHaveTextContent('Delivery Alpha');
      expect(failedReview).toHaveTextContent('Bug Triage');
      expect(failedReview).toHaveTextContent(/Start with existing list tasks/i);
      expect(failedReview).toHaveTextContent(/temporary connection failure/i);
      expect(mockLinkProject).toHaveBeenCalledTimes(1);
      expect(mockLinkProject).toHaveBeenCalledWith({
        tier: 'clickup',
        projectId: 'proj-1',
        listId: 'list-2',
        direction: 'pull-adopt',
      });
    });

    it('AC-S21-003 preserves a saved list ID in the one-line link when its list is unavailable', async () => {
      const unavailableBinding: ProjectBinding = {
        ...mockProjectClickUpBinding,
        external_container_id: 'list-archived-17',
        config: { direction: 'pull-adopt' },
      };
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        projectBindings: [unavailableBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" projectName="Delivery Alpha" />);

      expect(await screen.findByText(/List unavailable.*list-archived-17/i)).toBeInTheDocument();
      expect(screen.getByTestId('project-integrations-cards')).not.toHaveTextContent(/Initial source|Start with existing list tasks/i);
      expect(screen.queryByText(/Initial task transfer is not confirmed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Direction:/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Synced/i)).not.toBeInTheDocument();
    });

    it('AC-S21-003 retains the accepted list link when the ClickUp list read fails', async () => {
      const refetchLists = vi.fn();
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        projectBindings: [mockProjectClickUpBinding],
        clickupLists: [],
        isListsError: true,
        refetchLists,
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" projectName="Delivery Alpha" />);

      const card = screen.getByTestId('project-integrations-cards');
      expect(card).toHaveTextContent('Linked to ClickUp');
      expect(card).toHaveTextContent(/saved list ID: list-1/i);
      expect(card).not.toHaveTextContent(/Initial task transfer is not confirmed/i);
      await userEvent.setup().click(within(card).getByRole('button', { name: 'Retry list details' }));
      expect(refetchLists).toHaveBeenCalledTimes(1);
    });

    it('SUB-F never assumes or shows an initial source — an unrecorded one renders the same one-line link', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        projectBindings: [{ ...mockProjectClickUpBinding, config: {} }],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      const card = screen.getByTestId('project-integrations-cards');
      expect(card).toHaveTextContent('Linked to ClickUp list Sprint Backlog');
      expect(card).not.toHaveTextContent(/Initial source|Initial task transfer|Start with PMO tasks/i);
    });

    it('calls linkProject mutation on modal submit with ClickUp input', async () => {
      const user = userEvent.setup();
      const mockLinkProject = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
        linkProject: {
          ...baseMockReturn.linkProject,
          mutateAsync: mockLinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      // Select a list from the combobox
      const dialog = screen.getByRole('dialog', { name: 'Review ClickUp link' });
      const comboboxTrigger = within(dialog).getByRole('combobox', { name: 'ClickUp List' });
      await user.click(comboboxTrigger);

      // Wait for listbox to appear
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
      const listbox = screen.getByRole('listbox');
      const firstOption = within(listbox).getByRole('option', { name: /Sprint Backlog/i });
      await user.click(firstOption);

      // Submit
      await user.click(within(dialog).getByRole('radio', { name: /Start with PMO tasks/i }));
      await user.click(within(dialog).getByRole('button', { name: 'Review link' }));
      expect(mockLinkProject).not.toHaveBeenCalled();
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitButton).toHaveAccessibleName('Confirm ClickUp link');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockLinkProject).toHaveBeenCalledWith({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        });
      });
    });

    it('opens ConfirmDialog when Unlink is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByRole('button', { name: /^Unlink from ClickUp$/i })).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));

      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      expect(screen.getByText(/Unlink from ClickUp\?/)).toBeInTheDocument();
      expect(screen.getByText(/Synced tasks are retained; syncing stops\./)).toBeInTheDocument();
    });

    it('calls unlinkProject mutation on ConfirmDialog confirm', async () => {
      const user = userEvent.setup();
      const mockUnlinkProject = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
        unlinkProject: {
          ...baseMockReturn.unlinkProject,
          mutateAsync: mockUnlinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());

      const alertDialog = screen.getByRole('alertdialog');
      const confirmButton = alertDialog.querySelector('button[class*="destructive"]') as HTMLButtonElement;
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockUnlinkProject).toHaveBeenCalledWith({
          tier: 'clickup',
          projectId: 'proj-1',
        });
      });
    });

    it('AC-V24P-013 shows a persistent failure and keeps the link after a failed unlink, then retries deliberately', async () => {
      const user = userEvent.setup();
      const denied = Object.assign(new Error('permission denied for table integration_project_bindings'), { code: '42501' });
      const mockUnlinkProject = vi
        .fn()
        .mockRejectedValueOnce(denied)
        .mockResolvedValueOnce({ ok: true });
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
        unlinkProject: { ...baseMockReturn.unlinkProject, mutateAsync: mockUnlinkProject },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));
      const confirmDialog = await screen.findByRole('alertdialog');
      await user.click(within(confirmDialog).getByRole('button', { name: /^Unlink from ClickUp$/i }));

      // The user SEES why it failed, in the card (the link modal is closed) ...
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/Could not unlink from ClickUp\. The project is still linked\./);
      expect(alert).toHaveTextContent(/Your role does not allow this change/);
      expect(alert).not.toHaveTextContent(/integration_project_bindings/);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      // ... and the accepted link is still shown as linked, with a deliberate way to retry.
      expect(screen.getByText(/Linked to ClickUp list/)).toBeInTheDocument();
      expect(mockUnlinkProject).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      const retryDialog = await screen.findByRole('alertdialog');
      await user.click(within(retryDialog).getByRole('button', { name: /^Unlink from ClickUp$/i }));

      await waitFor(() => expect(mockUnlinkProject).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('shows inline error when linkProject fails with 409 action-required', async () => {
      const user = userEvent.setup();
      const error = new Error('Mixed state: project has tasks and list is not empty');
      (error as any).code = 'action-required';

      const mockLinkProject = vi.fn().mockRejectedValue(error);
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
        linkProject: {
          ...baseMockReturn.linkProject,
          mutateAsync: mockLinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const dialog = screen.getByRole('dialog', { name: 'Review ClickUp link' });
      const comboboxTrigger = within(dialog).getByRole('combobox', { name: 'ClickUp List' });
      await user.click(comboboxTrigger);
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
      const listbox = screen.getByRole('listbox');
      const firstOption = within(listbox).getByRole('option', { name: /Sprint Backlog/i });
      await user.click(firstOption);

      await user.click(within(dialog).getByRole('radio', { name: /Start with existing list tasks/i }));
      await user.click(within(dialog).getByRole('button', { name: 'Review link' }));
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
      await user.click(submitButton);

      await waitFor(() => expect(mockLinkProject).toHaveBeenCalled());
      await waitFor(() => {
        const dialogContent = screen.getByRole('dialog', { name: 'Review ClickUp link' });
        expect(dialogContent).toHaveTextContent(/Mixed state: project has tasks and list is not empty/);
        expect(dialogContent).toHaveTextContent(/Start with existing list tasks/i);
      });
    });

    it('SUB-F shows nothing while bindings load (no skeleton for a card that may not exist)', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        isBindingsPending: true,
      } as any);

      const { container } = wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" compact />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('Non-Admin view (PM sees Link/Unlink via org-wide hint; server enforces project scope)', () => {
    it('renders tier cards WITH Link/Unlink buttons for Project Manager when org connected', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
      } as any);

      wrapWithRole('Project Manager', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      // PM sees Link button (org-wide DELIVERY hint via can('edit','project'))
      expect(screen.getByRole('button', { name: /^Link to ClickUp$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
      // NOTE: Server enforces project-scoped PM check — PM of a DIFFERENT project gets 403
    });

    it('renders tier cards WITH Unlink button for Project Manager when project is linked', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Project Manager', <ProjectIntegrationsCard projectId="proj-1" />);

      const clickupCard = within(await screen.findByTestId('project-integrations-cards').then((c) => c.querySelector<HTMLElement>('[data-tier="clickup"]')!));
      expect(clickupCard.getByText(/Linked to ClickUp list/)).toBeInTheDocument();

      // PM sees Unlink button (org-wide DELIVERY hint)
      expect(screen.getByRole('button', { name: /^Unlink from ClickUp$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      // NOTE: Server enforces project-scoped PM check — PM of a DIFFERENT project gets 403
    });

    it('renders tier cards WITHOUT Link/Unlink buttons for Engineer', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Engineer', <ProjectIntegrationsCard projectId="proj-1" />);

      const clickupCard = within(await screen.findByTestId('project-integrations-cards').then((c) => c.querySelector<HTMLElement>('[data-tier="clickup"]')!));
      expect(clickupCard.getByText(/Linked to ClickUp list/)).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Link to ERPNext$/i })).not.toBeInTheDocument();
    });

    it('renders tier cards WITHOUT Link/Unlink buttons for Finance', async () => {
      wrapWithRole('Finance', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('Connected (org)')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
    });

    it('renders tier cards WITH Link button for Executive (DELIVERY role)', async () => {
      wrapWithRole('Executive', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      // Executive is in DELIVERY role, so sees Link button (org-wide hint)
      expect(screen.getByRole('button', { name: /^Link to ClickUp$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
    });
  });

  describe('Empty List set handling', () => {
    it('shows empty state in combobox when no ClickUp lists available', async () => {
      const user = userEvent.setup();
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        clickupLists: [],
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const dialog = screen.getByRole('dialog', { name: 'Review ClickUp link' });
      const comboboxTrigger = within(dialog).getByRole('combobox', { name: 'ClickUp List' });
      await user.click(comboboxTrigger);

      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
      expect(screen.getByText(/No list matches/)).toBeInTheDocument();
    });
  });

  describe('A11y', () => {
    it('has proper data-testid on tier cards container', async () => {
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      const container = screen.getByTestId('project-integrations-cards');
      expect(container).toBeInTheDocument();
    });

    it('modal has proper role and accessible name', async () => {
      const user = userEvent.setup();
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');
    });

    it('confirm dialog has alertdialog role', async () => {
      const user = userEvent.setup();
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await user.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    });
  });

  describe('Issue #449: disconnected org never shows an integration error; transport text never reaches the DOM', () => {
    const transportError = new Error('Failed to send a request to the Edge Function: fetch failed');

    it("AC-449-2: unlinked project + disconnected org + stale lists error renders nothing, never an error card", async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn(() => undefined), // org ClickUp NOT active
        projectBindings: [],                // project not linked
        isListsError: true,                 // a late/stale lists failure must not hijack the card
        listsError: transportError,
        refetchLists: vi.fn(),
      } as any);

      const { container } = wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" compact />);

      // Quiet state: nothing at all
      expect(container).toBeEmptyDOMElement();
      // No integration-error UI of any kind
      expect(screen.queryByText('Failed to load lists')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Edge Function/i)).not.toBeInTheDocument();
      // Not connected ⇒ no Link affordance
      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
    });

    it('AC-449-3: lists failure on a connected org shows human copy, never the raw transport message', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
        isListsError: true,
        listsError: transportError,
        refetchLists: vi.fn(),
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('Failed to load lists')).toBeInTheDocument());
      // Human copy in the app's established "Couldn't …" voice
      expect(screen.getByText(/Couldn't reach ClickUp/i)).toBeInTheDocument();
      // Raw transport string never reaches the DOM
      expect(screen.queryByText(/Edge Function/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed to send a request/i)).not.toBeInTheDocument();
      // Retry affordance is preserved
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
  });
});
