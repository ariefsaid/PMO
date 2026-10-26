import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Rail } from '../Rail';

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin' }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [{ id: 'view-1', name: 'Saved view' }] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { crm: true, procurement: true, timesheets: true, revenue: true, incidents: true, m365_integration: true } }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...actual, isFeatureEnabled: (key: string) => key === 'userViews' || key === 'agentAssistant' };
});

const renderRail = () => render(<MemoryRouter><Rail /></MemoryRouter>);

describe('UIP-001/UIP-013: rail destination names and decorative icon semantics', () => {
  it('keeps destination names accessible and marks decorative icons hidden', () => {
    renderRail();
    const rail = screen.getByRole('complementary');
    const expected = [
      'Dashboard', 'Projects', 'Sales Pipeline', 'Procurement', 'Meetings', 'Incidents',
      'Sales Invoices', 'Incoming Payments', 'Financial statements',
      'Timesheets', 'Expenses', 'Approvals', 'Companies', 'Contacts', 'Views', 'Saved view',
      'Administration',
    ];
    for (const label of expected) {
      const link = within(rail).getByRole('link', { name: label });
      expect(link).toHaveAccessibleName(label);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(rail).getByRole('button', { name: 'Assistant' })).toHaveAccessibleName('Assistant');
  });

  it('keeps the Dashboard destination available before grouped destinations', () => {
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(nav).getAllByRole('link')[0]).toHaveAccessibleName('Dashboard');
  });
});
