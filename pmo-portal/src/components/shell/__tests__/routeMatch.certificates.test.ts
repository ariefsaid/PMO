import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, railParentForPath } from '../routeMatch';

describe('#2584 progress certificates read Procurement > Progress certificates, never "Not found"', () => {
  it('the list sits under Procurement in the breadcrumb and the rail', () => {
    const crumbs = breadcrumbForPath('/subcontract-certificates');
    expect(crumbs.map((c) => c.label)).toEqual(['Procurement', 'Progress certificates']);
    expect(crumbs[0].href).toBe('/procurement');
    expect(railParentForPath('/subcontract-certificates')).toBe('/procurement');
  });
  it('a certificate links back to the list it came from', () => {
    const crumbs = breadcrumbForPath('/subcontract-certificates/abc');
    expect(crumbs.map((c) => c.label)).toEqual(['Procurement', 'Progress certificates']);
    expect(crumbs[1].href).toBe('/subcontract-certificates');
    expect(railParentForPath('/subcontract-certificates/abc')).toBe('/procurement');
  });
});
