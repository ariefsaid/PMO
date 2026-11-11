import { describe, expect, it } from 'vitest';
import { atRiskCount } from '../metrics';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';

const project = (over: Partial<PMDashboardProject>): PMDashboardProject => ({
  status: 'Ongoing Project', currency: 'USD', budget: 100, budget_currency: 'USD', spent: 10,
  actual_currency: 'USD', actual_complete: true, ...over,
} as PMDashboardProject);

describe('atRiskCount', () => {
  it('counts known at-risk projects exactly when every basis is known', () => {
    expect(atRiskCount([project({ spent: 95 }), project({ spent: 10 })])).toEqual({ count: 1, partial: false });
  });

  it('reports a floor when some projects are unknown but at least one is known to be at risk', () => {
    expect(atRiskCount([project({ spent: 95 }), project({ budget: null })])).toEqual({ count: 1, partial: true });
  });

  it('is unknown when no project is known at risk and some are unknown', () => {
    expect(atRiskCount([project({ spent: 10 }), project({ budget: null })])).toBeNull();
  });
});
