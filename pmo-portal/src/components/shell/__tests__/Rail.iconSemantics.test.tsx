import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Rail } from '../Rail';

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Admin' }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [{ id: 'view-1', name: 'Saved view' }] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { crm: true, procurement: true, timesheets: true, revenue: true, incidents: true, m365_integration: true } }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...actual, isFeatureEnabled: (key: string) => key === 'userViews' || key === 'agentAssistant' };
});

const renderRail = () => render(<MemoryRouter><Rail /></MemoryRouter>);

describe('UIP-001/UIP-013: rail icon semantics and retained sizing', () => {
  it('maps each exposed destination to its entity-specific glyph without changing link names', () => {
    renderRail();
    const rail = screen.getByRole('complementary');
    const expected = [
      ['Dashboard', 'dashboard'], ['My integrations', 'plug'], ['Projects', 'projects'],
      ['Sales Pipeline', 'pipeline'], ['Procurement', 'procurement'], ['Meetings', 'cal'],
      ['Incidents', 'alert'], ['Sales Invoices', 'invoices'], ['Incoming Payments', 'payments'],
      ['Revenue by Project', 'table'], ['Management pack', 'reports'], ['Timesheets', 'clock'],
      ['Expenses', 'expenses'], ['Approvals', 'approvals'], ['Companies', 'companies'],
      ['Contacts', 'contacts'], ['Saved view', 'views'], ['Administration', 'admin'],
    ] as const;
    for (const [label, key] of expected) {
      const link = within(rail).getByRole('link', { name: label });
      expect(link.querySelector('svg')).toHaveAttribute('data-icon', key);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(rail).getByRole('button', { name: 'Assistant' }).querySelector('svg'))
      .toHaveAttribute('data-icon', 'message');
  });

  it('keeps rail glyphs at 17px and group overlines at the DESIGN 11px token', () => {
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const dashboard = within(nav).getByRole('link', { name: 'Dashboard' });
    expect(dashboard).toHaveClass('[&_svg]:size-[17px]');
    expect(within(nav).getByText('Overview')).toHaveClass('text-[11px]');
  });
});
