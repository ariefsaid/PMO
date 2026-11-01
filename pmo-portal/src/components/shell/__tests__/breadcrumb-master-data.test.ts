import { expect, it, vi } from 'vitest';
import { breadcrumbForPath } from '../routeMatch';

it('FR-ODC-111 the Odoo directories pages carry the parent trail Administration > Organization integrations > Odoo directories', () => {
  const navigate = vi.fn();
  for (const kind of ['product', 'uom', 'account']) {
    const crumbs = breadcrumbForPath(`/master-data/${kind}`, undefined, navigate);
    expect(crumbs.map((c) => c.label)).toEqual(['Administration', 'Organization integrations', 'Odoo directories']);
    expect(crumbs[2].i18nKey).toBe('administration:odoo.master.title');
    expect(crumbs[2].href).toBeUndefined();
    crumbs[1].onClick?.();
    expect(navigate).toHaveBeenLastCalledWith('/administration/integrations');
  }
});
