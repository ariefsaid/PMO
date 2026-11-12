import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Rail } from '../Rail';
import { RailDrawerContext } from '../railDrawerContext';

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin' }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [{ id: 'view-1', name: 'Saved view' }] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  // S3: the Assistant toggle and My Views now need BOTH the entitlement and their env kill switch,
  // so the resolved set must include both keys (the env mock below turns the switches on).
  useOrgFeatures: () => ({
    data: {
      crm: true,
      procurement: true,
      timesheets: true,
      revenue: true,
      incidents: true,
      m365_integration: true,
      agent_assistant: true,
      user_views: true,
      sales_pipeline: true,
      management_pack: true,
      financial_statements: true,
      imprest: true,
      stock: true,
    },
  }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...actual, isFeatureEnabled: (key: string) => key === 'userViews' || key === 'agentAssistant' };
});

const renderRail = () => render(<MemoryRouter><RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider></MemoryRouter>);

describe('UIP-001/UIP-013: rail icon semantics and retained sizing', () => {
  it('maps each exposed destination to its entity-specific glyph without changing link names', () => {
    renderRail();
    const rail = screen.getByRole('complementary');
    const expected = [
      ['Dashboard', 'dashboard'], ['Projects', 'projects'],
      ['Sales Pipeline', 'pipeline'], ['Procurement', 'procurement'], ['Meetings', 'meetings'],
      ['Incidents', 'alert'], ['Finance', 'dollar'], ['Receivables', 'download'],
      ['Payables', 'payments'], ['Reports', 'reports'], ['Statements', 'statements'], ['Timesheets', 'clock'],
      ['Expenses', 'expenses'], ['Approvals', 'approvals'], ['Companies', 'companies'],
      ['Contacts', 'contacts'], ['My Views', 'views'], ['Administration', 'admin'],
    ] as const;
    for (const [label, key] of expected) {
      const accessibleName = label;
      const link = within(rail).getByRole('link', { name: accessibleName });
      expect(link.querySelector('svg')).toHaveAttribute('data-icon', key);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(rail).getByRole('button', { name: 'Assistant' }).querySelector('svg'))
      .toHaveAttribute('data-icon', 'message');
  });


  it('every navigation item has its own icon (screen rule: navigation icons are unique per item)', () => {
    renderRail();
    const rail = screen.getByRole('complementary');
    const seen = new Map<string, string>();
    for (const link of within(rail).getAllByRole('link')) {
      const key = link.querySelector('svg')?.getAttribute('data-icon');
      if (!key) continue;
      const name = link.textContent?.trim() ?? '';
      expect(seen.get(key), `${name} shares the "${key}" icon with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, name);
    }
    expect(seen.size).toBeGreaterThan(15);
  });
});
