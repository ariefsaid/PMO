import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, modulesForRole, railParentForPath } from '../routeMatch';
import { UserRole } from '@/types';

describe('Finance route matching', () => {
  it('uses Finance and Finance › area breadcrumbs for Finance routes', () => {
    expect(breadcrumbForPath('/finance')).toEqual([
      { label: 'Finance', i18nKey: 'financeHub:nav.finance' },
    ]);
    expect(breadcrumbForPath('/finance/receivables')).toEqual([
      { label: 'Finance', i18nKey: 'financeHub:nav.finance', href: '/finance', onClick: expect.any(Function) },
      { label: 'Receivables', i18nKey: 'financeHub:hub.receivables' },
    ]);
    expect(breadcrumbForPath('/sales-invoices/invoice-1').map((part) => part.label)).toEqual(['Finance', 'Receivables', 'Invoice record']);
    expect(breadcrumbForPath('/incoming-payments/receipt-1').map((part) => part.label)).toEqual(['Finance', 'Receivables', 'Payment record']);
    expect(railParentForPath('/sales-invoices/invoice-1')).toBe('/finance/receivables');
  });

  it('exposes the five Finance destinations to Exec, Finance and Admin only', () => {
    const expected = ['/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements'];
    for (const role of [UserRole.Executive, UserRole.Finance, UserRole.Admin]) {
      expect(modulesForRole(role).filter((item) => item.module.startsWith('finance')).map((item) => item.path)).toEqual(expected);
    }
    for (const role of [UserRole.ProjectManager, UserRole.Engineer]) {
      expect(modulesForRole(role).some((item) => item.module.startsWith('finance'))).toBe(false);
    }
  });
});
