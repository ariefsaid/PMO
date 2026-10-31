import { expect, it } from 'vitest';
import { breadcrumbForPath } from '../routeMatch';

it('FR-ODC-111 the Odoo directories pages have a breadcrumb, not "Not found"', () => {
  for (const kind of ['product', 'uom', 'account']) {
    expect(breadcrumbForPath(`/master-data/${kind}`)).toEqual([{ label: 'Odoo directories', i18nKey: 'odoo.master.title' }]);
  }
});
