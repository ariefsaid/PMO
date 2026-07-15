/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
};

const mockErpNextBinding: IntegrationBinding = {
  org_id: 'org-1',
  external_tier: 'erpnext',
  site_url: 'https://erp.example.com',
  secret_ref: 'erpnext_token_org_1',
  status: 'active',
  connected_by: 'u1',
  connected_at: '2026-01-01T00:00:00Z',
  disconnected_at: null,
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

const mockProjectErpNextBinding: ProjectBinding = {
  id: 'binding-2',
  org_id: 'org-1',
  project_id: 'proj-1',
  external_tier: 'erpnext',
  external_container_id: 'COMP-001',
  config: { company: 'COMP-001' },
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
        {ui}
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
      getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
      projectBindings: [],
    } as any);
  });

  describe('Admin view (write controls visible)', () => {
    it('renders both tier cards with Connected (org) status and Link buttons when org connected but project not linked', async () => {
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('External Integrations')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('ERPNext')).toBeInTheDocument());

      // Both tiers show Connected (org) status
      expect(screen.getAllByText('Connected (org)')).toHaveLength(2);
      // Link buttons visible for both
      expect(screen.getByRole('button', { name: /^Link to ClickUp$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Link to ERPNext$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink/i })).not.toBeInTheDocument();
    });

    it('renders Not connected status when org binding does not exist (no Link button)', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn(() => undefined),
        projectBindings: [],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('ERPNext')).toBeInTheDocument());

      // Both tiers show Not connected status
      expect(screen.getAllByText('Not connected')).toHaveLength(2);
      // No Link buttons because org not connected
      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Link to ERPNext$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink/i })).not.toBeInTheDocument();
    });

    it('renders Linked status with details when project is already linked to ClickUp', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      // The ClickUp tier card header shows 'Linked' status pill
      const clickupCard = within(screen.getByTestId('project-integrations-cards').querySelector('[data-tier="clickup"]')!);
      expect(clickupCard.getByText('Linked to ClickUp')).toBeInTheDocument();
      expect(screen.getByText(/Sprint Backlog/)).toBeInTheDocument();
      expect(screen.getByText(/Push \(seed new tasks\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Unlink from ClickUp$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
    });

    it('renders Linked status with ERPNext binding', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [mockProjectErpNextBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ERPNext')).toBeInTheDocument());
      const erpnextCard = within(screen.getByTestId('project-integrations-cards').querySelector('[data-tier="erpnext"]')!);
      expect(erpnextCard.getByText('Linked to ERPNext')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Unlink from ERPNext$/i })).toBeInTheDocument();
    });

    it('opens Link modal with ClickUp List picker when Link to ClickUp is clicked', async () => {
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByRole('button', { name: /^Link to ClickUp$/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Link to ClickUp' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/ClickUp List/i)).toBeInTheDocument());
    });

    it('opens Link modal with ERPNext Company picker when Link to ERPNext is clicked', async () => {
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByRole('button', { name: /^Link to ERPNext$/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^Link to ERPNext$/i }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Link to ERPNext' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/ERPNext Company/i)).toBeInTheDocument());
    });

    it('shows direction radio options for ClickUp link modal', async () => {
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      expect(screen.getByText(/Push \(seed new tasks\)/)).toBeInTheDocument();
      expect(screen.getByText(/Pull \(adopt existing\)/)).toBeInTheDocument();
    });

    it('calls linkProject mutation on modal submit with ClickUp input', async () => {
      const mockLinkProject = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [],
        linkProject: {
          ...baseMockReturn.linkProject,
          mutateAsync: mockLinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      // Select a list from the combobox
      const comboboxTrigger = screen.getByLabelText(/ClickUp List/i);
      fireEvent.click(comboboxTrigger);

      // Wait for listbox to appear
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
      const listbox = screen.getByRole('listbox');
      const firstOption = within(listbox).getByRole('option', { name: /Sprint Backlog/i });
      fireEvent.click(firstOption);

      // Submit
      const dialog = screen.getByRole('dialog', { name: 'Link to ClickUp' });
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockLinkProject).toHaveBeenCalledWith(
          expect.objectContaining({
            tier: 'clickup',
            projectId: 'proj-1',
            listId: expect.any(String),
            direction: expect.any(String),
          })
        );
      });
    });

    it('opens ConfirmDialog when Unlink is clicked', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByRole('button', { name: /^Unlink from ClickUp$/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));

      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      expect(screen.getByText(/Unlink from ClickUp\?/)).toBeInTheDocument();
      expect(screen.getByText(/Synced tasks are retained; syncing stops\./)).toBeInTheDocument();
    });

    it('calls unlinkProject mutation on ConfirmDialog confirm', async () => {
      const mockUnlinkProject = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [mockProjectClickUpBinding],
        unlinkProject: {
          ...baseMockReturn.unlinkProject,
          mutateAsync: mockUnlinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());

      const alertDialog = screen.getByRole('alertdialog');
      const confirmButton = alertDialog.querySelector('button[class*="destructive"]') as HTMLButtonElement;
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockUnlinkProject).toHaveBeenCalledWith({
          tier: 'clickup',
          projectId: 'proj-1',
        });
      });
    });

    it('shows inline error when linkProject fails with 409 action-required', async () => {
      const error = new Error('Mixed state: project has tasks and list is not empty');
      (error as any).code = 'action-required';

      const mockLinkProject = vi.fn().mockRejectedValue(error);
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [],
        linkProject: {
          ...baseMockReturn.linkProject,
          mutateAsync: mockLinkProject,
        },
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const comboboxTrigger = screen.getByLabelText(/ClickUp List/i);
      fireEvent.click(comboboxTrigger);
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
      const listbox = screen.getByRole('listbox');
      const firstOption = within(listbox).getByRole('option', { name: /Sprint Backlog/i });
      fireEvent.click(firstOption);

      const dialog = screen.getByRole('dialog', { name: 'Link to ClickUp' });
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => expect(mockLinkProject).toHaveBeenCalled());
      await waitFor(() => {
        const dialogContent = screen.getByRole('dialog', { name: 'Link to ClickUp' });
        expect(dialogContent).toHaveTextContent(/Mixed state: project has tasks and list is not empty/);
      });
    });

    it('shows loading skeleton while bindings load', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        isBindingsPending: true,
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      expect(screen.getByTestId('project-integrations-loading')).toBeInTheDocument();
    });
  });

  describe('Non-Admin view (read-only, no write controls)', () => {
    it('renders tier cards WITHOUT Link/Unlink buttons for Engineer when project is linked', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Engineer', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());
      const clickupCard = within(screen.getByTestId('project-integrations-cards').querySelector('[data-tier="clickup"]')!);
      expect(clickupCard.getByText('Linked to ClickUp')).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Link to ERPNext$/i })).not.toBeInTheDocument();
    });

    it('renders tier cards WITHOUT Link/Unlink buttons for Project Manager when org connected', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [],
      } as any);

      wrapWithRole('Project Manager', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
    });

    it('renders tier cards WITHOUT Link/Unlink buttons for Finance', async () => {
      wrapWithRole('Finance', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
    });

    it('renders tier cards WITHOUT Link/Unlink buttons for Executive', async () => {
      wrapWithRole('Executive', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Unlink from ClickUp$/i })).not.toBeInTheDocument();
    });
  });

  describe('Empty List set handling', () => {
    it('shows empty state in combobox when no ClickUp lists available', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        clickupLists: [],
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const comboboxTrigger = screen.getByLabelText(/ClickUp List/i);
      fireEvent.click(comboboxTrigger);

      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
      expect(screen.getByText(/No list matches/)).toBeInTheDocument();
    });

    it('shows loading skeleton in combobox while lists load', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        isListsPending: true,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const comboboxTrigger = screen.getByLabelText(/ClickUp List/i);
      fireEvent.click(comboboxTrigger);

      await waitFor(() => expect(screen.getByTestId('combo-loading')).toBeInTheDocument());
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
      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Link to ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');
    });

    it('confirm dialog has alertdialog role', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : mockErpNextBinding)),
        projectBindings: [mockProjectClickUpBinding],
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      fireEvent.click(screen.getByRole('button', { name: /^Unlink from ClickUp$/i }));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    });
  });
});