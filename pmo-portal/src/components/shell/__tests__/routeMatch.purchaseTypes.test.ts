import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, railParentForPath } from '../routeMatch';

describe('purchase type settings navigation', () => {
  it('names the settings page under Procurement', () => {
    const path = '/purchase-types/settings';
    const crumbs = breadcrumbForPath(path);
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Procurement', 'Purchase types']);
    expect(crumbs[0].href).toBe('/procurement');
    expect(crumbs[1].i18nKey).toBe('purchaseTypes:settings.title');
    expect(railParentForPath(path)).toBe('/procurement');
  });
});
