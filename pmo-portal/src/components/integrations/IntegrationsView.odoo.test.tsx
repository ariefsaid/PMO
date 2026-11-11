import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { IntegrationsView } from './IntegrationsView';
import { useIntegrations } from '@/src/hooks/useIntegrations';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { useProjects } from '@/src/hooks/useProjects';
import { bindingMapIntegrations, baseExternalDomainReturn, installIntegrationDefaults, mockBinding, wrapWithRole } from './IntegrationsView.test-helpers';

vi.mock('@/src/hooks/useIntegrations', () => ({ useIntegrations: vi.fn(), integrationHealthQueryKey: (o: unknown, t: unknown) => ['integrations', 'health', o, t] }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: vi.fn() }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: vi.fn() }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: vi.fn() }));
installIntegrationDefaults();

const show = (erpnext: 'active' | undefined, over: Record<string, unknown> = {}) => {
  vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({
    getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockBinding : tier === 'erpnext' && erpnext ? { ...mockBinding, external_tier: 'erpnext', status: erpnext } : undefined)),
    ...over,
  }) as never);
  vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn);
  vi.mocked(useProjects).mockReturnValue({ data: [], isPending: false, isError: false } as never);
  wrapWithRole('Admin', <IntegrationsView />);
};

it('FR-ODC-110 the Odoo section is on the Integrations page while no ERPNext binding is active', () => {
  show(undefined);
  expect(screen.getByTestId('odoo-section-stub')).toBeInTheDocument();
});
it('FR-ODC-008 one ERP per org: an active ERPNext binding hides Odoo', () => {
  show('active');
  expect(screen.queryByTestId('odoo-section-stub')).not.toBeInTheDocument();
});
it('FR-ODC-110 a failed binding read does not offer Odoo', () => {
  show(undefined, { isError: true, isSuccess: false });
  expect(screen.queryByTestId('odoo-section-stub')).not.toBeInTheDocument();
});
