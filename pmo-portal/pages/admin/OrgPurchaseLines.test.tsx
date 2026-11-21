import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), list: vi.fn(), save: vi.fn(), archive: vi.fn(), canManage: true,
}));
vi.mock('@/src/lib/db/procurementLinePlanning', () => ({
  getPurchaseLinePlanning: h.get, setPurchaseLinePlanning: h.set, listPurchaseLineCategories: h.list,
  savePurchaseLineCategory: h.save, archivePurchaseLineCategory: h.archive,
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));

import OrgPurchaseLines from './OrgPurchaseLines';

const cat = (id: string, name: string, archived_at: string | null = null) => ({ id, name, archived_at, org_id: 'o', position: 1, created_at: '' });
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgPurchaseLines /></QueryClientProvider>,
);

describe('AC-PLP-011 OrgPurchaseLines', () => {
  beforeEach(() => { vi.clearAllMocks(); h.canManage = true; h.list.mockResolvedValue([]); });

  it('an Admin turns line planning on', async () => {
    h.get.mockResolvedValue(false);
    h.set.mockResolvedValue(true);
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Show a category and a needed-by date on each request line' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('line-category-list')).toBeNull();
    await userEvent.click(toggle);
    expect(h.set).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId('line-category-list')).toBeInTheDocument();
  });

  it('an Admin adds, renames and retires a category', async () => {
    h.get.mockResolvedValue(true);
    h.list.mockResolvedValue([cat('c1', 'Alpha'), cat('c2', 'Gone', '2026-01-01')]);
    h.save.mockResolvedValue('c3');
    h.archive.mockResolvedValue(undefined);
    renderIt();
    await screen.findByText('Alpha');
    expect(screen.queryByText('Gone')).toBeNull();

    await userEvent.type(screen.getByRole('textbox', { name: 'Category name' }), 'Beta');
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(null, 'Beta'));

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const box = screen.getAllByRole('textbox', { name: 'Category name' })[0];
    await userEvent.clear(box);
    await userEvent.type(box, 'Alpha 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('c1', 'Alpha 2'));

    await userEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retire category' }));
    await waitFor(() => expect(h.archive).toHaveBeenCalledWith('c1'));
  });

  it('a non-Admin sees no controls', async () => {
    h.canManage = false;
    h.get.mockResolvedValue(true);
    h.list.mockResolvedValue([cat('c1', 'Alpha')]);
    renderIt();
    await screen.findByText('Alpha');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });

  it('a refused save shows the reason', async () => {
    h.get.mockResolvedValue(false);
    h.set.mockRejectedValue(new Error('Only an Admin can change purchase rules.'));
    renderIt();
    await userEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByText(/Only an Admin can change purchase rules/)).toBeInTheDocument();
  });
});
