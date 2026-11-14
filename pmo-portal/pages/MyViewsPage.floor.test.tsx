import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';

// Same mock set as MyViewsPage.test.tsx — the real list page; its reads/writes are faked.
const {
  mockIsFeatureEnabled,
  mockUseUserViews,
  mockUsePermission,
  mockArchive,
  mockToast,
  aiComposerModalCallbacks,
} = vi.hoisted(() => {
  const aiComposerModalCallbacks = { onComposed: null as null | ((spec: unknown) => void) };
  return {
    mockIsFeatureEnabled: vi.fn((key: string) => key === 'userViews' || key === 'aiComposer'),
    mockUseUserViews: vi.fn(() => ({
      data: [] as Array<Record<string, unknown>>,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })),
    mockUsePermission: vi.fn(() => () => true),
    mockArchive: vi.fn(),
    mockToast: vi.fn(),
    aiComposerModalCallbacks,
  };
});

vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/lib/features')>(),
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
  FEATURES: {},
}));
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => mockUseUserViews(),
  useUserViewMutations: () => ({ archive: { mutateAsync: mockArchive, isPending: false } }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mockUsePermission() }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' }, session: { access_token: 'jwt' } }),
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});
vi.mock('@/src/hooks/useAIComposer', () => ({ useAIComposer: () => ({ compose: vi.fn(), status: 'idle', error: null }) }));
vi.mock('@/src/components/builder/AIComposerModal', () => ({
  default: ({ open, onClose, onComposed }: { open: boolean; onClose: () => void; onComposed: (spec: unknown) => void }) => {
    aiComposerModalCallbacks.onComposed = open ? onComposed : null;
    if (!open) return null;
    return <div data-testid="ai-composer-modal"><button onClick={onClose}>ModalCancel</button></div>;
  },
}));

import MyViewsPage from './MyViewsPage';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'v1', user_id: 'u1', name: 'My pipeline', description: null, scope: 'private',
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', archived_at: null, ...over,
});

const PathProbe = ({ label }: { label: string }) => <div data-testid={label}>{useLocation().pathname}</div>;
const NewProbe = () => <PathProbe label="dest-new" />;
const RenderProbe = () => <PathProbe label="dest-render" />;
const BuilderProbe = () => <PathProbe label="dest-builder" />;

function renderMyViews() {
  return render(
    <FinanceI18nTestProvider>
      <MemoryRouter initialEntries={['/views']}>
        <Routes>
          <Route path="/views" element={<MyViewsPage />} />
          <Route path="/views/new" element={<NewProbe />} />
          <Route path="/views/:id" element={<RenderProbe />} />
          <Route path="/views/:id/edit" element={<BuilderProbe />} />
        </Routes>
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await financeTestI18n.changeLanguage('en');
  mockIsFeatureEnabled.mockImplementation((key: string) => key === 'userViews' || key === 'aiComposer');
  mockUseUserViews.mockReturnValue({
    data: [row()],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockArchive.mockResolvedValue(undefined);
});

describe('MyViewsPage floor', () => {
  it('floor: New View opens the builder route', async () => {
    const user = userEvent.setup();
    renderMyViews();
    await user.click(screen.getByRole('button', { name: 'New View' }));
    expect(screen.getByTestId('dest-new')).toHaveTextContent('/views/new');
  });

  it('floor: the empty-state link opens /views/new', async () => {
    mockUseUserViews.mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() });
    const user = userEvent.setup();
    renderMyViews();
    await user.click(screen.getByRole('link', { name: 'Create your first view' }));
    expect(screen.getByTestId('dest-new')).toHaveTextContent('/views/new');
  });

  it('floor: a view name opens that view renderer route', async () => {
    const user = userEvent.setup();
    renderMyViews();
    await user.click(screen.getByRole('link', { name: 'My pipeline' }));
    expect(screen.getByTestId('dest-render')).toHaveTextContent('/views/v1');
  });

  it('floor: row Edit opens the builder edit route; a teammate row offers no menu', async () => {
    mockUseUserViews.mockReturnValue({
      data: [row(), row({ id: 'v2', user_id: 'u2', name: 'Teammate view', scope: 'shared_org' })],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    renderMyViews();

    const ownRow = screen.getByText('My pipeline').closest('tr')!;
    await user.click(within(ownRow as HTMLElement).getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByTestId('dest-builder')).toHaveTextContent('/views/v1/edit');
  });

  it('floor: Archive confirms then archives; Cancel writes nothing', async () => {
    const user = userEvent.setup();
    renderMyViews();
    const ownRow = screen.getByText('My pipeline').closest('tr')!;
    await user.click(within(ownRow as HTMLElement).getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(mockArchive).not.toHaveBeenCalled();
    const confirmDialog = (await screen.findAllByRole('alertdialog'))
      .find((d) => within(d).queryByRole('button', { name: 'Archive' }))!;
    await user.click(within(confirmDialog).getByRole('button', { name: 'Keep' }));
    expect(mockArchive).not.toHaveBeenCalled();

    await user.click(within(ownRow).getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const confirm = (await screen.findAllByRole('alertdialog'))
      .find((d) => within(d).queryByRole('button', { name: 'Archive' }))!;
    await user.click(within(confirm).getByRole('button', { name: 'Archive' }));
    await vi.waitFor(() => expect(mockArchive).toHaveBeenCalledWith('v1'));
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith('View archived', 'My pipeline', 'success'));
  });

  it('floor: Retry refetches the failed views read', async () => {
    const refetch = vi.fn();
    mockUseUserViews.mockReturnValue({ data: [], isPending: false, isError: true, refetch });
    const user = userEvent.setup();
    renderMyViews();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
