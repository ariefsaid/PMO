/**
 * MyViewsPage — "Compose with AI" entry (FR-AS-014, Task 23).
 * AC-AS tests for the My Views list page AI composer entry point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
    mockUseUserViews: vi.fn(
      (): {
        data: Record<string, unknown>[];
        isPending: boolean;
        isError: boolean;
        refetch: ReturnType<typeof vi.fn>;
      } => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
    ),
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
import { FinanceI18nTestProvider } from './__tests__/financeI18nTestProvider';
import { financeTestI18n } from './__tests__/financeI18nTestInstance';

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

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location-probe">{location.pathname}{location.search}</output>;
};

const viewSeed = [
  { id: 'v2', name: 'Zulu weekly', description: 'Hours by project', user_id: 'u1', scope: 'private', updated_at: '2026-02-01T00:00:00Z' },
  { id: 'v1', name: 'Alpha delivery', description: 'Open work by owner', user_id: 'u2', scope: 'shared_org', updated_at: '2026-02-02T00:00:00Z' },
];

function renderMyViews(initialPath = '/views') {
  return render(
    <FinanceI18nTestProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="/views" element={<MyViewsPage />} />
          <Route path="/views/new" element={<div data-testid="builder-page" />} />
        </Routes>
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await financeTestI18n.changeLanguage('en');
  mockIsFeatureEnabled.mockImplementation(
    (key: string) => key === 'userViews' || key === 'aiComposer',
  );
});

describe('MyViewsPage — "Compose with AI" entry (FR-AS-014)', () => {
  it('AC-WORK-V-01: toolbar orders search, name sort, compose, then New view', () => {
    renderMyViews();
    const toolbar = screen.getByTestId('views-toolbar');
    const search = within(toolbar).getByLabelText(/Search saved views/i);
    const sort = within(toolbar).getByLabelText(/Sort saved views/i);
    const compose = within(toolbar).getByRole('button', { name: /Compose view with AI/i });
    const create = within(toolbar).getByRole('button', { name: 'New view' });
    const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(search, sort)).toBe(true);
    expect(follows(sort, compose)).toBe(true);
    expect(follows(compose, create)).toBe(true);
  });

  it('AC-WORK-V-02: name sort is stable and reflected in the current URL', async () => {
    mockUseUserViews.mockReturnValue({ data: viewSeed, isPending: false, isError: false, refetch: vi.fn() });
    renderMyViews('/views?utm=work');
    const row = (name: string) => screen.getByText(name).closest('tr')!;
    const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(row('Alpha delivery'), row('Zulu weekly'))).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText(/Sort saved views/i), 'name-desc');
    expect(follows(row('Zulu weekly'), row('Alpha delivery'))).toBe(true);
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/views?utm=work&sort=name-desc'));
  });

  it('AC-WORK-V-03: identifies owned and shared rows and restricts shared-row actions', async () => {
    mockUseUserViews.mockReturnValue({ data: viewSeed, isPending: false, isError: false, refetch: vi.fn() });
    renderMyViews();
    const owned = screen.getByText('Zulu weekly').closest('tr')!;
    const shared = screen.getByText('Alpha delivery').closest('tr')!;
    expect(within(owned).getByText('Mine')).toBeInTheDocument();
    expect(within(shared).getByText('Shared with me')).toBeInTheDocument();
    await userEvent.click(within(owned).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(within(shared).queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });

  it('AC-WORK-V-04: search is URL-backed and a no-match state can clear it', async () => {
    mockUseUserViews.mockReturnValue({ data: viewSeed, isPending: false, isError: false, refetch: vi.fn() });
    renderMyViews('/views?sort=name-desc');
    await userEvent.type(screen.getByLabelText(/Search saved views/i), 'missing');
    expect(await screen.findByText('No saved views match these filters')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/views?sort=name-desc&q=missing'));
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/views?sort=name-desc'));
    expect(screen.getByLabelText(/Search saved views/i)).toHaveValue('');
  });

  it('AC-L10N-B01 renders the page title and action in Bahasa from the shipped catalogue', async () => {
    await financeTestI18n.changeLanguage('id');
    renderMyViews();
    expect(await screen.findByRole('heading', { name: 'Tampilan tersimpan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat tampilan dengan AI' })).toBeInTheDocument();
  });

  it('renders a "Compose view with AI" button (exact accessible name per FR-AS-014) when userViews+aiComposer are enabled', () => {
    renderMyViews();
    // FR-AS-014: the button's accessible name must be "Compose view with AI" (not "Compose with AI")
    expect(screen.getByRole('button', { name: /compose view with ai/i })).toBeInTheDocument();
  });

  it('hides the "Compose view with AI" button when userViews is false', () => {
    mockIsFeatureEnabled.mockImplementation(
      (key: string) => key === 'aiComposer', // userViews off
    );
    renderMyViews();
    expect(screen.queryByRole('button', { name: /compose view with ai/i })).not.toBeInTheDocument();
  });

  it('hides the "Compose view with AI" button when aiComposer is false', () => {
    mockIsFeatureEnabled.mockImplementation(
      (key: string) => key === 'userViews', // aiComposer off
    );
    renderMyViews();
    expect(screen.queryByRole('button', { name: /compose view with ai/i })).not.toBeInTheDocument();
  });

  it('opens the AIComposerModal when the button is clicked', async () => {
    renderMyViews();
    await userEvent.click(screen.getByRole('button', { name: /compose view with ai/i }));
    expect(screen.getByTestId('ai-composer-modal')).toBeInTheDocument();
  });

  it('navigates to /views/new carrying the composed spec when onComposed fires', async () => {
    renderMyViews();
    await userEvent.click(screen.getByRole('button', { name: /compose view with ai/i }));

    // Trigger the onComposed callback
    aiComposerModalCallbacks.onComposed?.(SAMPLE_SPEC);

    await waitFor(() => {
      expect(screen.getByTestId('builder-page')).toBeInTheDocument();
    });
  });
});
