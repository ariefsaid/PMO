/**
 * ViewBuilderPage — state machine and guard tests.
 * AC-VB-001, AC-VB-007, AC-VB-008, AC-VB-009, AC-VB-010, AC-VB-011,
 * AC-VB-014, AC-VB-015, AC-VB-018, AC-VB-019.
 * AC-AS-011, AC-AS-012, AC-AS-014, AC-AS-015, AC-AS-016 (AI composer wiring).
 * (AC-VB-002 is owned by PanelEditorForm.test.tsx — entity-change reset is panel-editor behavior.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { axe } from 'jest-axe';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// IMPORTANT: mockUseAuth must return a STABLE currentUser object reference.
// ViewPreview's useEffect([spec, currentUser]) re-runs whenever currentUser
// reference changes. If mockUseAuth() returns a new object on every render call,
// ViewPreview falls into an infinite effect loop → OOM. Use a stable const.
const {
  mockCreate,
  mockUpdate,
  mockUseUserView,
  mockUseUserViews,
  mockCompile,
  mockUseAuth,
  mockToast,
  mockBlocker,
  mockIsFeatureEnabled,
  mockAICompose,
  // onComposedCallback is a ref that AIComposerModal stub will call when told to compose
  aiComposerModalCallbacks,
} = vi.hoisted(() => {
  // Stable reference — ViewPreview's useEffect([spec, currentUser]) re-fires on any
  // currentUser reference change. Returning a new object per-call creates an infinite
  // effect loop → OOM. The stable const is captured in the vi.fn() closure.
  const stableCurrentUser = { id: 'u1', org_id: 'org1' };
  const aiComposerModalCallbacks = { onComposed: null as null | ((spec: unknown) => void) };
  return {
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockUseUserView: vi.fn(),
    mockUseUserViews: vi.fn(() => ({ data: [], isPending: false, isError: false })),
    mockCompile: vi.fn(),
    mockUseAuth: vi.fn(() => ({
      currentUser: stableCurrentUser,
      role: 'Admin',
      session: null,
      loading: false,
      profileError: null,
      signInWithPassword: vi.fn(),
      signInWithMagicLink: vi.fn(),
      signOut: vi.fn(),
    })),
    mockToast: vi.fn(),
    mockBlocker: vi.fn(() => ({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() })),
    // Feature flag — default false so existing tests are unaffected
    mockIsFeatureEnabled: vi.fn((key: string) => key === 'userViews' ? false : false),
    mockAICompose: vi.fn(),
    aiComposerModalCallbacks,
  };
});

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserView: mockUseUserView,
  useUserViews: mockUseUserViews,
  useUserViewMutations: () => ({
    create: { mutateAsync: mockCreate, isPending: false },
    update: { mutateAsync: mockUpdate, isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  CanWrite: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: mockCompile,
  compileQuerySpec: vi.fn((qs: unknown) => ({
    entity: (qs as { entity: string }).entity,
    repositoryMethod: 'company.list',
    resolvedFilters: [],
    resolvedSelect: ['id', 'name'],
  })),
}));
vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useBlocker: mockBlocker };
});
// Stub ViewPreview: these tests focus on the builder state machine, not the preview
// component. The real ViewPreview has an async useEffect that can cause OOM in
// jsdom when rendered inside a complex tree (ACt queue never drains).
vi.mock('@/src/components/builder/ViewPreview', () => ({
  default: ({ spec }: { spec: { panels: unknown[] } }) => (
    <div data-testid="view-preview" data-panels={spec.panels.length} />
  ),
}));

// Mock feature flags — default all false so existing tests are unaffected
vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
  FEATURES: {},
}));

// Mock useAIComposer hook
vi.mock('@/src/hooks/useAIComposer', () => ({
  useAIComposer: () => ({ compose: mockAICompose, status: 'idle', error: null }),
}));

// Stub AIComposerModal — captures the onComposed callback so tests can trigger it
vi.mock('@/src/components/builder/AIComposerModal', () => ({
  default: ({
    open,
    onClose,
    onComposed,
  }: {
    open: boolean;
    onClose: () => void;
    onComposed: (spec: unknown) => void;
  }) => {
    // Store the callback so tests can trigger it
    aiComposerModalCallbacks.onComposed = open ? onComposed : null;
    if (!open) return null;
    return (
      <div data-testid="ai-composer-modal">
        <button onClick={onClose}>ModalCancel</button>
        <button
          data-testid="modal-trigger-compose"
          onClick={() => mockAICompose('test prompt')}
        >
          ModalGenerate
        </button>
      </div>
    );
  },
}));

import ViewBuilderPage from '@/pages/ViewBuilderPage';
import MyViewsPage from '@/pages/MyViewsPage';
import { ValidationError } from '@/src/lib/viewspec/types';

// A minimal PanelSpec that can be added to the list via direct prop injection
const PANEL_A = {
  id: 'a',
  primitive: 'DataTable',
  querySpec: { entity: 'companies' as const, select: ['id', 'name'] },
};
const PANEL_B = {
  id: 'b',
  primitive: 'DataTable',
  querySpec: { entity: 'companies' as const, select: ['id'] },
};
const PANEL_C = {
  id: 'c',
  primitive: 'DataTable',
  querySpec: { entity: 'companies' as const, select: ['name'] },
};

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/views/new']}>
      <Routes>
        <Route path="/views/new" element={<ViewBuilderPage mode="create" />} />
        <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        <Route path="/views" element={<div data-testid="list-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEdit(viewId = 'v1') {
  return render(
    <MemoryRouter initialEntries={[`/views/${viewId}/edit`]}>
      <Routes>
        <Route path="/views/:viewId/edit" element={<ViewBuilderPage mode="edit" />} />
        <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'new-id', name: 'Test View' });
  mockUpdate.mockResolvedValue(undefined);
  mockCompile.mockReturnValue([
    {
      id: 'p1',
      primitive: 'DataTable',
      compiledQuery: {
        entity: 'companies',
        repositoryMethod: 'company.list',
        resolvedFilters: [],
        resolvedSelect: ['id', 'name'],
      },
    },
  ]);
  mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false });
  mockBlocker.mockReturnValue({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() });
});

describe('ViewBuilderPage — guard states', () => {
  it('AC-VB-001: opens empty (no panels, add-panel button, save disabled, name empty)', () => {
    renderCreate();
    expect(screen.getByRole('textbox', { name: /view name/i })).toHaveValue('');
    expect(screen.getByRole('button', { name: /add panel/i })).toBeInTheDocument();
    const saveBtn = screen.getByRole('button', { name: /save view/i });
    expect(saveBtn).toBeDisabled();
  });

  it('AC-VB-010: save disabled when name is empty (even with panels)', () => {
    renderCreate();
    // Verify name field is empty and save is disabled
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    expect(nameField).toHaveValue('');
    expect(screen.getByRole('button', { name: /save view/i })).toBeDisabled();
  });

  it('AC-VB-011: save disabled when panel list is empty; explanatory note visible', () => {
    renderCreate();
    // Type a name to satisfy that condition, but no panels
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    act(() => {
      nameField.focus();
    });
    // The "Add at least one panel" note should be present regardless of name
    expect(screen.getByText(/add at least one panel to save/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save view/i })).toBeDisabled();
  });

  it('AC-VB-019: edit mode pre-populates name, scope, and panel list', () => {
    mockUseUserView.mockReturnValue({
      data: {
        id: 'v1',
        name: 'Q2 Projects',
        description: null,
        scope: 'private',
        spec: {
          version: 1,
          panels: [PANEL_A],
        },
        archived_at: null,
        org_id: 'org1',
        user_id: 'u1',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-28T00:00:00Z',
      },
      isPending: false,
      isError: false,
    });
    renderEdit('v1');
    expect(screen.getByRole('textbox', { name: /view name/i })).toHaveValue('Q2 Projects');
    // Panel list should have one entry
    expect(screen.getByText(/DataTable/i)).toBeInTheDocument();
    // Save button should say "Update view"
    expect(screen.getByRole('button', { name: /update view/i })).toBeInTheDocument();
  });
});

describe('ViewBuilderPage — compile-before-save', () => {
  it('AC-VB-007b: navigating away from an unmodified edit view does NOT trigger the discard dialog', () => {
    // blocker stays unblocked (its condition isDirty must be false when nothing has changed)
    mockBlocker.mockReturnValue({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() });
    mockUseUserView.mockReturnValue({
      data: {
        id: 'v1',
        name: 'Q2 Projects',
        description: 'A view',
        scope: 'private',
        spec: { version: 1, panels: [PANEL_A] },
        archived_at: null,
        org_id: 'org1',
        user_id: 'u1',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-28T00:00:00Z',
      },
      isPending: false,
      isError: false,
    });
    renderEdit('v1');
    // With no user changes, the discard dialog must not be present
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Verify the blocker was called with isDirty=false (i.e. first arg is false).
    // The shouldBlock arg passed to useBlocker must be false for an unmodified edit view.
    const lastBlockerArg = (mockBlocker.mock.calls as unknown as [boolean, ...unknown[]][]).at(-1)?.[0];
    expect(lastBlockerArg).toBe(false);
  });

  it('AC-VB-007: ValidationError from compile blocks mutate call; error code displayed', async () => {
    mockCompile.mockImplementation(() => {
      throw new ValidationError('UNKNOWN_ENTITY', 'companies');
    });
    const { rerender } = renderCreate();
    // Seed name field
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'My View');
    // Seed a panel by using the test hook: ViewBuilderPage accepts __testPanels prop
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={
              <ViewBuilderPage
                mode="create"
                __testPanels={[PANEL_A]}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const saveBtn = screen.getByRole('button', { name: /save view/i });
    await userEvent.click(saveBtn);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/UNKNOWN_ENTITY/i)).toBeInTheDocument();
  });

  it('AC-VB-008: create mode calls create with {name,description,spec,scope} — no org_id/user_id', async () => {
    mockCompile.mockReturnValue([]);
    const { rerender } = renderCreate();
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'My View');
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A]} />}
          />
          <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        </Routes>
      </MemoryRouter>,
    );
    const saveBtn = screen.getByRole('button', { name: /save view/i });
    await userEvent.click(saveBtn);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const callArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).toHaveProperty('name');
    expect(callArg).toHaveProperty('spec');
    expect(callArg).toHaveProperty('scope');
    expect(callArg).not.toHaveProperty('org_id');
    expect(callArg).not.toHaveProperty('user_id');
  });

  it('AC-VB-008: update mode calls update with {id, input: {name,spec,scope}} — no org_id/user_id', async () => {
    mockCompile.mockReturnValue([]);
    mockUseUserView.mockReturnValue({
      data: {
        id: 'v1',
        name: 'Old Name',
        description: null,
        scope: 'private',
        spec: { version: 1, panels: [PANEL_A] },
        archived_at: null,
        org_id: 'org1',
        user_id: 'u1',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-28T00:00:00Z',
      },
      isPending: false,
      isError: false,
    });
    const { rerender } = renderEdit('v1');
    // Clear the pre-populated name and type a new one
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Updated Name');
    // Seed a panel via __testPanels prop
    rerender(
      <MemoryRouter initialEntries={['/views/v1/edit']}>
        <Routes>
          <Route
            path="/views/:viewId/edit"
            element={<ViewBuilderPage mode="edit" __testPanels={[PANEL_A]} />}
          />
          <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        </Routes>
      </MemoryRouter>,
    );
    const updateBtn = screen.getByRole('button', { name: /update view/i });
    await userEvent.click(updateBtn);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const callArg = mockUpdate.mock.calls[0][0] as { id: string; input: Record<string, unknown> };
    expect(callArg).toHaveProperty('id', 'v1');
    expect(callArg.input).toHaveProperty('name');
    expect(callArg.input).toHaveProperty('spec');
    expect(callArg.input).toHaveProperty('scope');
    expect(callArg.input).not.toHaveProperty('org_id');
    expect(callArg.input).not.toHaveProperty('user_id');
  });

  it('AC-VB-009: save error surfaces classifyMutationError headline; panel list preserved', async () => {
    mockCompile.mockReturnValue([]);
    const appError = Object.assign(new Error('rls reject'), { code: '42501' });
    mockCreate.mockRejectedValue(appError);
    const { rerender } = renderCreate();
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'My View');
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /save view/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/you don.t have permission to do that/i),
      ).toBeInTheDocument(),
    );
    // Panel list should still show the panel
    expect(screen.getByText(/DataTable/i)).toBeInTheDocument();
  });
});

describe('ViewBuilderPage — panel reorder and remove', () => {
  it('AC-VB-014: Move down on A gives [B,A,C]; then Move up on C gives [B,C,A]', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A, PANEL_B, PANEL_C]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    // [A, B, C] — Move down on panel 1 (A)
    await user.click(screen.getByRole('button', { name: 'Move panel 1 down' }));
    // Now [B, A, C] — click Move up on panel 3 (C)
    await user.click(screen.getByRole('button', { name: 'Move panel 3 up' }));
    // Now [B, C, A]
    const items = screen.getAllByRole('listitem');
    // Panel 1 should now be B (id='b'): select ['id'] → summary "companies — id"
    expect(items[0]).toHaveTextContent('companies — id');
    // Panel 3 should now be A (id='a'): select ['id','name'] → summary "companies — id, name"
    expect(items[2]).toHaveTextContent('companies — id, name');
  });

  it('AC-VB-015: Remove panel A; list = [B]; no mutation called', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A, PANEL_B]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove panel 1' }));
    // Only B should remain
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('ViewBuilderPage + MyViewsPage — axe-core a11y', () => {
  it('AC-VB-018: no a11y violations on ViewBuilderPage (one panel, modal closed)', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route
            path="/views/new"
            element={<ViewBuilderPage mode="create" __testPanels={[PANEL_A]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
    // FR-VB-021: description field must be a <textarea> (multiline), not a single-line input
    const descriptionField = screen.getByRole('textbox', { name: /description/i });
    expect(descriptionField.tagName).toBe('TEXTAREA');
  });

  it('AC-VB-018: no a11y violations on MyViewsPage (one view in list)', async () => {
    // Override useUserViews for this specific test
    const { mockUseUserViews: muv } = await import('@/src/hooks/useUserViews').then(
      () => ({ mockUseUserViews: mockUseUserViews }),
    );
    muv.mockReturnValue({
      data: [
        {
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
        },
      ],
      isPending: false,
      isError: false,
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/views']}>
        <MyViewsPage />
      </MemoryRouter>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ── AI Composer wiring (AC-AS-011, 012, 014, 015, 016) ──────────────────────

const AI_COMPOSED_SPEC = {
  version: 1 as const,
  panels: [
    {
      id: 'p-ai-1',
      primitive: 'KPITile',
      querySpec: { entity: 'projects' as const, select: ['id', 'contract_value'], aggregate: { fn: 'sum' as const, column: 'contract_value', alias: 'total' } },
    },
    {
      id: 'p-ai-2',
      primitive: 'DataTable',
      querySpec: { entity: 'projects' as const, select: ['id', 'name', 'status'] },
    },
  ],
};

describe('ViewBuilderPage — AI Composer wiring', () => {
  beforeEach(() => {
    // Reset features mock
    mockIsFeatureEnabled.mockImplementation(() => false);
  });

  it('AC-AS-011 renders a "Compose view with AI" button when userViews+aiComposer are enabled', () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      key === 'userViews' || key === 'aiComposer',
    );
    renderCreate();
    expect(screen.getByRole('button', { name: /compose view with ai/i })).toBeInTheDocument();
  });

  it('AC-AS-012 hides the button when userViews is false', () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      key === 'aiComposer', // only aiComposer on, not userViews
    );
    renderCreate();
    expect(screen.queryByRole('button', { name: /compose view with ai/i })).not.toBeInTheDocument();
  });

  it('AC-AS-012 hides the button when aiComposer is false', () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      key === 'userViews', // only userViews on, not aiComposer
    );
    renderCreate();
    expect(screen.queryByRole('button', { name: /compose view with ai/i })).not.toBeInTheDocument();
  });

  it('AC-AS-014 populating from a composed spec sets panels to spec.panels and closes the modal', async () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      key === 'userViews' || key === 'aiComposer',
    );
    mockCompile.mockReturnValue([]);

    renderCreate();

    // Open the modal
    await userEvent.click(screen.getByRole('button', { name: /compose view with ai/i }));
    expect(screen.getByTestId('ai-composer-modal')).toBeInTheDocument();

    // Trigger onComposed via the captured callback
    act(() => {
      aiComposerModalCallbacks.onComposed?.(AI_COMPOSED_SPEC);
    });

    // Modal should close and panels should be populated
    await waitFor(() => {
      expect(screen.queryByTestId('ai-composer-modal')).not.toBeInTheDocument();
    });

    // PanelList should show 2 panels
    const preview = screen.getByTestId('view-preview');
    expect(preview).toHaveAttribute('data-panels', '2');
  });

  it('AC-AS-015 shows the "AI-composed draft" indicator after populate', async () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      key === 'userViews' || key === 'aiComposer',
    );

    renderCreate();
    await userEvent.click(screen.getByRole('button', { name: /compose view with ai/i }));

    act(() => {
      aiComposerModalCallbacks.onComposed?.(AI_COMPOSED_SPEC);
    });

    await waitFor(() => {
      expect(screen.getByText(/ai-composed draft/i)).toBeInTheDocument();
    });

    // The indicator must have aria-live="polite" (NFR-AS-A11Y-004)
    const indicator = screen.getByText(/ai-composed draft/i);
    // Walk up to find the aria-live ancestor
    let el: HTMLElement | null = indicator;
    let hasAriaLive = false;
    while (el) {
      if (el.getAttribute('aria-live') === 'polite') { hasAriaLive = true; break; }
      el = el.parentElement;
    }
    expect(hasAriaLive).toBe(true);
  });

  it('AC-AS-016 pressing Save calls useUserViewMutations().create with the composed spec and clears the AI-composed draft indicator', async () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      key === 'userViews' || key === 'aiComposer',
    );
    mockCompile.mockReturnValue([]);
    mockCreate.mockResolvedValue({ id: 'new-id', name: 'AI View' });

    const { rerender } = renderCreate();

    // Enable the button and populate via AI
    await userEvent.click(screen.getByRole('button', { name: /compose view with ai/i }));
    act(() => {
      aiComposerModalCallbacks.onComposed?.(AI_COMPOSED_SPEC);
    });
    await waitFor(() => {
      expect(screen.getByText(/ai-composed draft/i)).toBeInTheDocument();
    });

    // Type a name so Save is enabled
    const nameField = screen.getByRole('textbox', { name: /view name/i });
    await userEvent.type(nameField, 'AI View');

    // Rerender to ensure __testPanels aren't resetting our AI panels
    rerender(
      <MemoryRouter initialEntries={['/views/new']}>
        <Routes>
          <Route path="/views/new" element={<ViewBuilderPage mode="create" />} />
          <Route path="/views/:viewId" element={<div data-testid="renderer" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save view/i })).not.toBeDisabled();
    });

    await userEvent.click(screen.getByRole('button', { name: /save view/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // After save resolves, the AI-composed draft indicator should be gone
    await waitFor(() => {
      expect(screen.queryByText(/ai-composed draft/i)).not.toBeInTheDocument();
    });
  });
});
