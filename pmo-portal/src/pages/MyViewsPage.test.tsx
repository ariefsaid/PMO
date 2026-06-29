/**
 * MyViewsPage — RTL tests.
 * AC-VB-016: archive confirm + success toast.
 * AC-VB-017: empty state shows CTA to /views/new.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const { mockUseUserViews, mockArchive, mockUseAuth, mockToast } = vi.hoisted(() => ({
  mockUseUserViews: vi.fn(),
  mockArchive: vi.fn(),
  mockUseAuth: vi.fn(() => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  })),
  mockToast: vi.fn(),
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: mockUseUserViews,
  useUserViewMutations: () => ({
    archive: { mutateAsync: mockArchive, isPending: false },
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  CanWrite: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});

import MyViewsPage from '@/pages/MyViewsPage';

const VIEW_ROW = {
  id: 'v1',
  name: 'Weekly Status',
  description: null,
  scope: 'private',
  spec: { version: 1, panels: [] },
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-28T10:00:00Z',
  archived_at: null,
  org_id: 'org1',
  user_id: 'u1',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/views']}>
      <MyViewsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockArchive.mockResolvedValue(undefined);
  mockUseUserViews.mockReturnValue({ data: [VIEW_ROW], isPending: false, isError: false });
});

describe('MyViewsPage', () => {
  it('AC-VB-017: empty state shows "Create your first view" CTA linking to /views/new', () => {
    mockUseUserViews.mockReturnValue({ data: [], isPending: false, isError: false });
    renderPage();
    expect(screen.getByText(/create your first view/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /create your first view/i });
    expect(cta).toHaveAttribute('href', '/views/new');
  });

  it('AC-VB-016: archive confirm + success toast + mutation called with view id', async () => {
    const user = userEvent.setup();
    renderPage();
    // Row action menu — open it
    const menuBtn = screen.getByRole('button', { name: /actions/i });
    await user.click(menuBtn);
    const archiveItem = screen.getByRole('menuitem', { name: /archive/i });
    await user.click(archiveItem);
    // ConfirmDialog with tone="destructive" renders role="alertdialog"
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/archive this view/i)).toBeInTheDocument();
    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /^archive$/i });
    await user.click(confirmBtn);
    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith('v1'));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('View archived', VIEW_ROW.name, 'success'),
    );
  });
});
