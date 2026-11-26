import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, railParentForPath } from '../routeMatch';

describe('a stock transfer page', () => {
  it('reads Stock > Transfers with both crumbs linked, never a stuck "Loading…", and keeps the Stock rail item lit', () => {
    const crumbs = breadcrumbForPath('/stock/transfers/560287de-ff95-46d0-a71c-eb5667190948');
    expect(crumbs.map((c) => c.i18nKey)).toEqual(['shell.nav.stock', 'stock:tabs.transfers']);
    expect(crumbs.map((c) => c.href)).toEqual(['/stock', '/stock/transfers']);
    expect(railParentForPath('/stock/transfers/560287de')).toBe('/stock');
  });
  it('the delivery note reads the same trail', () => {
    expect(breadcrumbForPath('/stock/transfers/abc/print').map((c) => c.href)).toEqual(['/stock', '/stock/transfers']);
  });
  it('leaves the send page its own crumb', () => {
    expect(breadcrumbForPath('/stock/transfers/new').map((c) => c.i18nKey)).toEqual(['shell.nav.stock', 'stock:transfers.sendTitle']);
  });
});
