import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const loaded = vi.hoisted(() => ({ usage: 0, integrations: 0, features: 0 }));
const pendingIntegrations = vi.hoisted(() => new Promise<Record<string, never>>(() => {}));

vi.mock('./AdministrationUsage', () => { loaded.usage += 1; return { AdministrationUsage: () => null }; });
vi.mock('@/src/components/admin/AgentCostMetrics', () => ({ AgentCostMetrics: () => null }));
vi.mock('@/src/components/integrations/IntegrationsView', () => { loaded.integrations += 1; return { IntegrationsView: () => null }; });
vi.mock('./AdministrationFeatures', () => { loaded.features += 1; return { default: () => null }; });
vi.mock('./AdminUsers', async () => {
  const ReactModule = await import('react');
  return { default: () => ReactModule.createElement('div', { 'data-testid': 'admin-users-loaded' }) };
});
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-test' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useOperatorMembership: () => ({ isOperator: true, isPending: false, isError: false, retry: vi.fn() }) }));

const renderAt = async (path: string) => {
  const { default: Administration } = await import('./Administration');
  return render(<MemoryRouter initialEntries={[path]}><Administration /></MemoryRouter>);
};

describe('Administration section code loads on demand (#2098)', () => {
  beforeEach(() => {
    vi.resetModules();
    loaded.usage = 0;
    loaded.integrations = 0;
    loaded.features = 0;
  });

  it('opening Users loads none of the Integrations, Usage or Features section code', async () => {
    await renderAt('/administration/users');
    expect(await screen.findByTestId('admin-users-loaded')).toBeInTheDocument();
    expect(loaded).toEqual({ usage: 0, integrations: 0, features: 0 });
  });

  it('keeps the navigation available while a section chunk is still loading', async () => {
    vi.doMock('./admin-panels/IntegrationsPanel', () => pendingIntegrations);
    await renderAt('/administration/integrations');
    expect(screen.getByRole('navigation', { name: 'Administration sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organization integrations' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('administration-panel-integrations')).not.toBeInTheDocument();
  });
});
