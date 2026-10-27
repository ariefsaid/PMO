import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, modulesForRole } from '../routeMatch';
import { UserRole } from '@/types';

describe('Finance route matching', () => {
  it('uses Finance and Finance › area breadcrumbs for Finance routes', () => {
    expect(breadcrumbForPath('/finance')).toEqual([
      { label: 'Finance', i18nKey: 'shell.nav.finance' },
    ]);
    expect(breadcrumbForPath('/finance/receivables')).toEqual([
      { label: 'Finance', i18nKey: 'shell.nav.finance', href: '/finance', onClick: expect.any(Function) },
      { label: 'Receivables', i18nKey: 'finance:area.receivables' },
    ]);
  });

  it('exposes one Finance destination to Exec, Finance and Admin in route navigation', () => {
    for (const role of [UserRole.Executive, UserRole.Finance, UserRole.Admin]) {
      expect(modulesForRole(role).filter((item) => item.module === 'finance')).toMatchObject([
        { path: '/finance', labelKey: 'shell.nav.finance' },
      ]);
    }
    for (const role of [UserRole.ProjectManager, UserRole.Engineer]) {
      expect(modulesForRole(role).some((item) => item.module === 'finance')).toBe(false);
    }
  });
});
