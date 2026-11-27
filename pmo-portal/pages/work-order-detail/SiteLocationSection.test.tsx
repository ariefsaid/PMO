import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** AC-SD-006: changing the site location says it was saved. */
const h = vi.hoisted(() => ({ mutate: vi.fn(), error: false, retry: vi.fn(), location: null as string | null }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useDsrStockIssue', () => ({
  useDsrStockSettings: () => ({ data: { enabled: true } }),
  useWorkOrderSiteLocation: () => ({ data: h.location }),
  useSiteLocations: () => ({ data: h.error ? undefined : [{ id: 'l1', name: 'Site store' }], isError: h.error, refetch: h.retry }),
  useDsrStockMutations: () => ({ setLocation: { mutate: h.mutate, isPending: false, isError: false } }),
}));
import { SiteLocationSection } from './SiteLocationSection';

describe('SiteLocationSection', () => {
  it('retries unavailable location options before showing an assigned site', async () => {
    h.location = 'l1'; h.error = true;
    try {
      const view = render(<MemoryRouter><SiteLocationSection workOrderId="w1" projectId="p1" /></MemoryRouter>);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
      expect(h.retry).toHaveBeenCalled();
      h.error = false;
      view.rerender(<MemoryRouter><SiteLocationSection workOrderId="w1" projectId="p1" /></MemoryRouter>);
      expect(screen.getByRole('combobox')).toHaveValue('l1');
    } finally { h.error = false; h.location = null; }
  });
  beforeEach(() => { h.mutate.mockReset().mockImplementation((_v, o) => o?.onSuccess?.()); });
  it('confirms the save in words', async () => {
    render(<MemoryRouter><SiteLocationSection workOrderId="w1" projectId="p1" /></MemoryRouter>);
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'l1');
    expect(h.mutate).toHaveBeenCalledWith({ workOrderId: 'w1', warehouseId: 'l1' }, expect.anything());
    expect(await screen.findByTestId('wo-site-location-saved')).toHaveTextContent('Site location saved');
  });
});
