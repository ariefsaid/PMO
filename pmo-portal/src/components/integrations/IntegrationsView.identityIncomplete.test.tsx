/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: {} } }));
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
import { baseExternalDomainReturn, bindingMapIntegrations, mockBinding, wrapWithRole, installIntegrationDefaults } from './IntegrationsView.test-helpers';
import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

function setup(config: Record<string, unknown>) {
  const binding = { ...mockBinding, config };
  vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as any);
  vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as any);
  vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
    bindings: [binding],
    getBinding: vi.fn((tier: string) => (tier === 'clickup' ? binding : undefined)),
  }) as any);
}

describe('#1941 — connection saved without its identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows "Setup incomplete" and Retry for an Admin; Retry re-opens the connect step that re-saves the identity', async () => {
    setup({ identity_incomplete: true });
    wrapWithRole('Admin', <IntegrationsView />);
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('dialog', { name: 'Connect ClickUp' })).toBeInTheDocument();
  });

  it('shows the notice but no Retry for a non-Admin', async () => {
    setup({ identity_incomplete: true });
    wrapWithRole('Engineer', <IntegrationsView />);
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows neither for a complete connection', async () => {
    setup({ identity_incomplete: false });
    wrapWithRole('Admin', <IntegrationsView />);
    await screen.findByText('ClickUp');
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
