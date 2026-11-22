import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** AC-SD-006: changing the site location says it was saved. */
const h = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useDsrStockIssue', () => ({
  useDsrStockSettings: () => ({ data: { enabled: true } }),
  useWorkOrderSiteLocation: () => ({ data: null }),
  useSiteLocations: () => ({ data: [{ id: 'l1', name: 'Site store' }] }),
  useDsrStockMutations: () => ({ setLocation: { mutate: h.mutate, isPending: false, isError: false } }),
}));
import { SiteLocationSection } from './SiteLocationSection';

describe('SiteLocationSection', () => {
  beforeEach(() => { h.mutate.mockReset().mockImplementation((_v, o) => o?.onSuccess?.()); });
  it('confirms the save in words', async () => {
    render(<MemoryRouter><SiteLocationSection workOrderId="w1" projectId="p1" /></MemoryRouter>);
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'l1');
    expect(h.mutate).toHaveBeenCalledWith({ workOrderId: 'w1', warehouseId: 'l1' }, expect.anything());
    expect(await screen.findByTestId('wo-site-location-saved')).toHaveTextContent('Site location saved');
  });
});
