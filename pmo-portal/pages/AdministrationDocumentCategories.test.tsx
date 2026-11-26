import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { DocumentCategory } from '@/src/lib/db/documentCategories';

const state = vi.hoisted(() => ({ canManage: true, setAccess: vi.fn(), create: vi.fn(), archive: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.canManage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    documentCategory: {
      list: vi.fn(),
      setAccess: (...a: unknown[]) => state.setAccess(...a),
      create: (...a: unknown[]) => state.create(...a),
      archive: (...a: unknown[]) => state.archive(...a),
      rename: vi.fn(), restore: vi.fn(), reorder: vi.fn(),
    },
  },
}));

import { repositories } from '@/src/lib/repositories';
import AdministrationDocumentCategories from './AdministrationDocumentCategories';

const ALL: DocumentCategory['roles'] = ['Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin'];
const cats: DocumentCategory[] = [
  { id: 'c-draw', name: 'Drawing', is_system: true, sort_order: 10, archived_at: null, roles: ALL },
  { id: 'c-inv', name: 'Invoice', is_system: false, sort_order: 20, archived_at: null, roles: ['Finance', 'Admin'] },
];

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><AdministrationDocumentCategories /></ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.canManage = true;
  state.setAccess.mockResolvedValue(undefined);
  state.create.mockResolvedValue('new-id');
  vi.mocked(repositories.documentCategory.list).mockResolvedValue(cats);
});

describe('AC-DCV-020 Administration › Document categories', () => {
  it('locks the Admin checkbox on, and saves the replaced set when a role is unchecked', async () => {
    const user = userEvent.setup();
    wrap();
    const card = await screen.findByTestId('document-category-c-inv');
    const boxes = within(card).getAllByRole('checkbox');
    const byName = (name: RegExp) => within(card).getByRole('checkbox', { name });
    expect(boxes).toHaveLength(5);
    expect(byName(/Admin/)).toBeDisabled();
    expect(byName(/Admin/)).toBeChecked();
    expect(byName(/Finance/)).toBeChecked();
    expect(byName(/Engineer/)).not.toBeChecked();
    // Save is idle until something changes
    expect(within(card).getByRole('button', { name: /Save who can see it/i })).toBeDisabled();
    await user.click(byName(/Finance/));
    await user.click(byName(/Executive/));
    await user.click(within(card).getByRole('button', { name: /Save who can see it/i }));
    await waitFor(() => expect(state.setAccess).toHaveBeenCalledWith('c-inv', ['Executive', 'Admin'], []));
  });

  it('accepts a save with every non-Admin role unchecked (Admin alone)', async () => {
    const user = userEvent.setup();
    wrap();
    const card = await screen.findByTestId('document-category-c-inv');
    await user.click(within(card).getByRole('checkbox', { name: /Finance/ }));
    await user.click(within(card).getByRole('button', { name: /Save who can see it/i }));
    await waitFor(() => expect(state.setAccess).toHaveBeenCalledWith('c-inv', ['Admin'], []));
  });

  it('creates a category with the chosen roles (Admin always included, never an org id)', async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByTestId('document-category-c-inv');
    await user.click(screen.getByRole('button', { name: 'New category', exact: true }));
    const form = await screen.findByTestId('document-category-new');
    expect(within(form).getByLabelText(/Category name/i)).toHaveFocus();
    await user.type(within(form).getByLabelText(/Category name/i), 'Commercial approval');
    await user.click(within(form).getByRole('checkbox', { name: /Finance/ }));
    await user.click(screen.getByRole('button', { name: /Create category/i }));
    await waitFor(() => expect(state.create).toHaveBeenCalledWith('Commercial approval', ['Finance', 'Admin']));
  });

  it('a system category cannot be renamed or archived from the screen', async () => {
    wrap();
    const user = userEvent.setup();
    const card = await screen.findByTestId('document-category-c-draw');
    // #1126: row actions live in the row's menu.
    await user.click(within(card).getByRole('button', { name: /More actions/ }));
    expect(screen.queryByRole('menuitem', { name: /^Rename$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Archive$/ })).not.toBeInTheDocument();
    expect(within(card).getByText('System')).toBeInTheDocument();
  });

  it('archives a custom category only after confirming', async () => {
    const user = userEvent.setup();
    state.archive.mockResolvedValue(undefined);
    wrap();
    const card = await screen.findByTestId('document-category-c-inv');
    await user.click(within(card).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: /^Archive$/ }));
    expect(state.archive).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'))).getByRole('button', { name: /^Archive$/ }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith('c-inv'));
  });

  it('a viewer without the manage right sees the rules but no controls', async () => {
    state.canManage = false;
    wrap();
    const card = await screen.findByTestId('document-category-c-inv');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    for (const box of within(card).getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.queryByTestId('document-category-new')).not.toBeInTheDocument();
  });
});
