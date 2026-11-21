import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, railParentForPath } from '../routeMatch';

describe('#2681 / #2682 billing pages read Receivables > page, never "Not found"', () => {
  it.each([
    ['/finance/billing-board', 'Billing board', 'finance:billingBoard.title'],
    ['/finance/billing-plan', 'Billing plan', 'finance:billingPlan.title'],
  ])('%s resolves its title with Receivables as the parent', (path, label, i18nKey) => {
    const crumbs = breadcrumbForPath(path);
    expect(crumbs.map((c) => c.label)).toEqual(['Receivables', label]);
    expect(crumbs[1].i18nKey).toBe(i18nKey);
    expect(crumbs[0].href).toBe('/finance/receivables');
    expect(railParentForPath(path)).toBe('/finance/receivables');
  });
});
