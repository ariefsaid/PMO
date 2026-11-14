/**
 * ViewBuilderPage floor rows: My-views Edit entry (1), Go to My Views (3), conflict Continue
 * editing (5), cached-view Retry (6), Compose with AI on the edit page (8), Description (12),
 * Scope (13), Add panel (18), add-panel submit (39).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import React from 'react';

const {
  mockCreate,
  mockUpdate,
  mockUseUserView,
  mockUseUserViews,
  mockCompile,
  mockIsFeatureEnabled,
  refetchView,
  previewSpecs,
  roleState,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockUseUserView: vi.fn(),
  mockUseUserViews: vi.fn(() => ({ data: [], isPending: false, isError: false })),
  mockCompile: vi.fn(),
  mockIsFeatureEnabled: vi.fn((key: string) => key === 'userViews'),
  refetchView: vi.fn(),
  previewSpecs: [] as unknown[],
  roleState: { realRole: 'Engineer' },
}));

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => roleState }));
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserView: mockUseUserView,
  useUserViews: mockUseUserViews,
  useUserViewMutations: () => ({
    create: { mutateAsync: mockCreate, isPending: false },
    update: { mutateAsync: mockUpdate, isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
const stableUser = { id: 'u1', org_id: 'org1' };
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: stableUser, role: 'Admin', session: null, loading: false, profileError: null }),
}));
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: mockCompile,
  compileQuerySpec: vi.fn((qs: unknown) => ({
    entity: (qs as { entity: string }).entity,
    resolvedFilters: [],
    resolvedSelect: ['id', 'name'],
  })),
}));
vi.mock('@/src/lib/viewspec/executor', () => ({ executeCompiledQuery: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/components/builder/ViewPreview', () => ({
  default: ({ spec }: { spec: { panels: unknown[] } }) => {
    previewSpecs.push(spec);
    return <div data-testid="view-preview" data-panels={spec.panels.length} />;
  },
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/lib/features')>(),
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
  FEATURES: {},
}));
vi.mock('@/src/hooks/useAIComposer', () => ({ useAIComposer: () => ({ compose: vi.fn(), status: 'idle', error: null }) }));
vi.mock('@/src/components/builder/AIComposerModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="ai-composer-modal" /> : null),
}));

// refetchView comes from the useUserView read the page makes; expose it through the mock.

vi.mocked(mockUseUserView).mockImplementation(() => {

  return { data: null, isPending: false, isError: false, refetch: refetchView } as never;
});

import ViewBuilderPage from '@/pages/ViewBuilderPage';
import MyViewsPage from '@/pages/MyViewsPage';

const savedView = {
  id: 'v1',
  name: 'Old Name',
  description: 'Old description',
  scope: 'private',
  spec: { version: 1 as const, panels: [{ id: 'a', primitive: 'DataTable', querySpec: { entity: 'companies' as const, select: ['id', 'name'] } }] },
  archived_at: null,
  org_id: 'org1',
  user_id: 'u1',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-28T00:00:00Z',
};

function renderEdit(viewId = 'v1') {
  return render(
    <ToastProvider><MemoryRouter initialEntries={[`/views/${viewId}/edit`]}>
      <Routes>
        <Route path="/views/:viewId/edit" element={<ViewBuilderPage mode="edit" />} />
        <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        <Route path="/views" element={<div data-testid="views-list" />} />
      </Routes>
  </MemoryRouter></ToastProvider>,  );
}

function renderViewsAndBuilder() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/views']}>
        <Routes>
          <Route path="/views" element={<MyViewsPage />} />
          <Route path="/views/new" element={<ViewBuilderPage mode="create" />} />
          <Route path="/views/:viewId/edit" element={<ViewBuilderPage mode="edit" />} />
          <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previewSpecs.length = 0;
  roleState.realRole = 'Engineer';
  mockUpdate.mockResolvedValue(undefined);
  mockCompile.mockReturnValue([
    { id: 'p1', primitive: 'DataTable', compiledQuery: { entity: 'companies', resolvedFilters: [], resolvedSelect: ['id', 'name'] } },
  ]);
  mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false, refetch: refetchView });
});

describe('ViewBuilderPage floor', () => {
  it('floor: Edit on a My Views row opens the editor for that view', async () => {
    mockUseUserViews.mockReturnValue({
      data: [savedView as never],
      isPending: false,
      isError: false,
    });
    mockUseUserView.mockReturnValue({ data: savedView as never, isPending: false, isError: false, refetch: refetchView });
    const user = userEvent.setup();
    renderViewsAndBuilder();

    await user.click(screen.getByText('Old Name').closest('tr')!.querySelector('button[aria-label="Row actions"]')!);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(screen.getByRole('heading', { name: 'Old Name' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: /view name/i })).toHaveValue('Old Name');
  });

  it('floor: Go to My Views leaves the full-page state for the list', async () => {
    // Unknown (never-loaded) view: the view-not-found empty state carries the action.
    mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false, refetch: refetchView });
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole('button', { name: 'Go to My Views' }));
    expect(screen.getByTestId('views-list')).toBeInTheDocument();
  });

  it('floor: conflict Continue editing keeps the local draft in the editor', async () => {
    mockUseUserView.mockReturnValue({ data: savedView as never, isPending: false, isError: false, refetch: refetchView });
    const user = userEvent.setup();
    const { rerender } = renderEdit();
    const nameBox = await screen.findByRole('textbox', { name: /view name/i });
    await user.clear(nameBox);
    await user.type(nameBox, 'My local edits');

    // The saved row changes remotely while the draft is dirty.
    mockUseUserView.mockReturnValue({ data: { ...savedView, name: 'Remote version', updated_at: '2026-07-01T00:00:00Z' } as never, isPending: false, isError: false, refetch: refetchView });
    rerender(
      <ToastProvider>
        <MemoryRouter initialEntries={['/views/v1/edit']}>
          <Routes><Route path="/views/:viewId/edit" element={<ViewBuilderPage mode="edit" />} /></Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Continue editing' }));

    expect(screen.getByRole('textbox', { name: /view name/i })).toHaveValue('My local edits');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('floor: cached-view Retry requests the view refresh again', async () => {
    mockUseUserView.mockReturnValue({ data: savedView as never, isPending: false, isError: true, errorUpdatedAt: 1, refetch: refetchView } as never);
    const user = userEvent.setup();
    renderEdit();
    expect(screen.getAllByRole('alert').some((a) => a.textContent?.toLowerCase().includes('could not refresh this view'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchView).toHaveBeenCalled();
  });

  it('floor: Compose with AI on the edit page opens the composer', async () => {
    mockIsFeatureEnabled.mockImplementation((key: string) => key === 'userViews' || key === 'aiComposer');
    mockUseUserView.mockReturnValue({ data: savedView as never, isPending: false, isError: false, refetch: refetchView });
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole('button', { name: /compose/i }));
    expect(screen.getByTestId('ai-composer-modal')).toBeInTheDocument();
  });

  it('floor: Description and Scope edits reach the update payload', async () => {
    mockUseUserView.mockReturnValue({ data: savedView as never, isPending: false, isError: false, refetch: refetchView });
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('textbox', { name: /view name/i });

    await user.type(screen.getByLabelText(/description/i), ' refreshed');
    await user.selectOptions(screen.getByLabelText(/scope/i), 'shared_org');
    await user.click(screen.getByRole('button', { name: /update view/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const call = mockUpdate.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.description).toContain('refreshed');
    expect(call.input.scope).toBe('shared_org');
  });

  it('floor: Add panel opens the panel editor and submitting adds the panel to the view', async () => {
    mockCompile.mockReturnValue([]);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/views/new']}>
          <Routes>
            <Route path="/views/new" element={<ViewBuilderPage mode="create" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: /add panel/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: /primitive/i }), 'DataTable');
    await user.selectOptions(screen.getByRole('combobox', { name: /entity/i }), 'companies');
    await user.click(screen.getByRole('checkbox', { name: 'id' }));
    await user.type(screen.getByLabelText(/panel label/i), 'Companies table');
    await user.click(screen.getByRole('button', { name: /add panel|confirm/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const panelList = screen.getByRole('list', { name: 'Panel list' });
    expect(panelList).toHaveTextContent('DataTable');
    expect(screen.getByTestId('view-preview')).toHaveAttribute('data-panels', '1');
  });
});
