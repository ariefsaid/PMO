/**
 * MyViewsPage — "Compose with AI" entry (FR-AS-014, Task 23).
 * AC-AS tests for the My Views list page AI composer entry point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
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
    mockUseUserViews: vi.fn(() => ({ data: [], isPending: false, isError: false, refetch: vi.fn() })),
    mockUsePermission: vi.fn(() => () => true),
    mockArchive: vi.fn(),
    mockToast: vi.fn(),
    aiComposerModalCallbacks,
  };
});

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
  FEATURES: {},
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => mockUseUserViews(),
  useUserViewMutations: () => ({
    archive: { mutateAsync: mockArchive, isPending: false },
  }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => mockUsePermission(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    session: { access_token: 'jwt' },
  }),
}));

vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});

vi.mock('@/src/hooks/useAIComposer', () => ({
  useAIComposer: () => ({ compose: vi.fn(), status: 'idle', error: null }),
}));

// Stub AIComposerModal — captures onComposed for tests
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
    aiComposerModalCallbacks.onComposed = open ? onComposed : null;
    if (!open) return null;
    return (
      <div data-testid="ai-composer-modal">
        <button onClick={onClose}>ModalCancel</button>
      </div>
    );
  },
}));

import MyViewsPage from './MyViewsPage';

const SAMPLE_SPEC = {
  version: 1 as const,
  panels: [
    {
      id: 'p1',
      primitive: 'DataTable',
      querySpec: { entity: 'projects' as const, select: ['id', 'name'] },
    },
  ],
};

function renderMyViews() {
  return render(
    <MemoryRouter initialEntries={['/views']}>
      <Routes>
        <Route path="/views" element={<MyViewsPage />} />
        <Route path="/views/new" element={<div data-testid="builder-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFeatureEnabled.mockImplementation(
    (key: string) => key === 'userViews' || key === 'aiComposer',
  );
});

describe('MyViewsPage — "Compose with AI" entry (FR-AS-014)', () => {
  it('renders a "Compose with AI" button when userViews+aiComposer are enabled', () => {
    renderMyViews();
    expect(screen.getByRole('button', { name: /compose.*ai/i })).toBeInTheDocument();
  });

  it('hides the "Compose with AI" button when userViews is false', () => {
    mockIsFeatureEnabled.mockImplementation(
      (key: string) => key === 'aiComposer', // userViews off
    );
    renderMyViews();
    expect(screen.queryByRole('button', { name: /compose.*ai/i })).not.toBeInTheDocument();
  });

  it('hides the "Compose with AI" button when aiComposer is false', () => {
    mockIsFeatureEnabled.mockImplementation(
      (key: string) => key === 'userViews', // aiComposer off
    );
    renderMyViews();
    expect(screen.queryByRole('button', { name: /compose.*ai/i })).not.toBeInTheDocument();
  });

  it('opens the AIComposerModal when the button is clicked', async () => {
    renderMyViews();
    await userEvent.click(screen.getByRole('button', { name: /compose.*ai/i }));
    expect(screen.getByTestId('ai-composer-modal')).toBeInTheDocument();
  });

  it('navigates to /views/new carrying the composed spec when onComposed fires', async () => {
    renderMyViews();
    await userEvent.click(screen.getByRole('button', { name: /compose.*ai/i }));

    // Trigger the onComposed callback
    aiComposerModalCallbacks.onComposed?.(SAMPLE_SPEC);

    await waitFor(() => {
      expect(screen.getByTestId('builder-page')).toBeInTheDocument();
    });
  });
});
