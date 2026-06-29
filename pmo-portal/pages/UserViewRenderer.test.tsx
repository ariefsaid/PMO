/**
 * UserViewRenderer — guard state tests and data state tests.
 * AC-VR-001 (loading), AC-VR-002 (not-found), AC-VR-003 (archived),
 * AC-VR-004 (spec-invalid), AC-VR-005 (empty-spec), AC-VR-018 (feature-off redirect).
 * AC-VR-006..010 (data states), AC-VR-012 (axe a11y).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockUseUserView, mockUseAuth, mockFeatureEnabled } = vi.hoisted(() => ({
  mockUseUserView: vi.fn(),
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
  mockFeatureEnabled: vi.fn(() => true),
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserView: mockUseUserView,
  useUserViews: vi.fn(() => ({ data: [], isPending: false, isError: false })),
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: mockUseAuth }));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: mockFeatureEnabled,
  FEATURES: { userViews: true },
}));

// Mock compileCompositionSpec + executeCompiledQuery to isolate renderer logic
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: vi.fn(),
  compileQuerySpec: vi.fn(),
}));
vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: vi.fn(),
}));

import UserViewRenderer from './UserViewRenderer';
import { ValidationError } from '@/src/lib/viewspec/types';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';

const mockCompile = compileCompositionSpec as ReturnType<typeof vi.fn>;
const mockExecute = executeCompiledQuery as ReturnType<typeof vi.fn>;

function renderRenderer(viewId = 'abc') {
  return render(
    <MemoryRouter initialEntries={[`/views/${viewId}`]}>
      <UserViewRenderer viewId={viewId} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  });
  mockFeatureEnabled.mockReturnValue(true);
});

// ── Guard states ──────────────────────────────────────────────────────────────

describe('UserViewRenderer — guard states', () => {
  it('AC-VR-001: renders loading skeleton while useUserView is pending', () => {
    mockUseUserView.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderRenderer();
    // Expect at least one ChartFrame loading state (liststate-loading testid from ListState)
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });

  it('AC-VR-002: renders not-found state when useUserView returns null', () => {
    mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false });
    renderRenderer();
    expect(screen.getByText(/this view was not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it('AC-VR-003: renders not-found state when view has non-null archived_at', () => {
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Archived', spec: { version: 1, panels: [] }, archived_at: '2026-01-01T00:00:00Z', scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    renderRenderer();
    expect(screen.getByText(/this view was not found/i)).toBeInTheDocument();
  });

  it('AC-VR-004: renders spec-invalid error state when compileCompositionSpec throws', () => {
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Bad View', spec: { version: 1, panels: [{ id: 'p1', primitive: 'PieChart', querySpec: { entity: 'projects', select: ['id'] } }] }, archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    mockCompile.mockImplementation(() => {
      throw new ValidationError('UNKNOWN_PRIMITIVE', 'p1');
    });
    renderRenderer();
    expect(screen.getByText(/this view's definition is invalid/i)).toBeInTheDocument();
    expect(screen.queryByText(/PieChart/i)).not.toBeInTheDocument(); // no partial render
  });

  it('AC-VR-005: renders empty-spec state when spec has zero panels', () => {
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Empty View', spec: { version: 1, panels: [] }, archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    mockCompile.mockReturnValue([]);
    renderRenderer();
    expect(screen.getByRole('heading', { name: 'Empty View' })).toBeInTheDocument();
    expect(screen.getByText(/this view has no panels yet/i)).toBeInTheDocument();
  });

  it('AC-VR-018: FeatureRoute does not render UserViewRenderer when userViews feature is off', async () => {
    // FeatureRoute uses isFeatureEnabled — already mocked above via vi.mock('@/src/lib/features').
    // When feature is off the route renders <Navigate to="/"> instead of the element.
    mockFeatureEnabled.mockReturnValue(false);
    mockUseUserView.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { FeatureRoute } = await vi.importActual<{ FeatureRoute: React.FC<{ feature: string; element: React.ReactNode; redirectTo?: string }> }>(
      '@/src/components/FeatureRoute'
    );

    render(
      <MemoryRouter>
        <FeatureRoute feature="userViews" element={<UserViewRenderer viewId="abc" />} />
      </MemoryRouter>
    );
    // UserViewRenderer is NOT rendered when feature is off — no loading skeleton or not-found text
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
    expect(screen.queryByText(/this view was not found/i)).not.toBeInTheDocument();
  });
});

// ── Data states (AC-VR-006..010) ──────────────────────────────────────────────

const VALID_KPITILE_VIEW = {
  id: 'abc', name: 'My KPI', description: null,
  spec: {
    version: 1,
    panels: [{
      id: 'p1', primitive: 'KPITile',
      querySpec: { entity: 'projects', select: ['contract_value'], aggregate: { fn: 'sum', column: 'contract_value', alias: 'total' } },
      props: { icon: 'doc', tone: 'blue', label: 'Total Contract Value' },
    }],
  },
  archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

const COMPILED_KPITILE = [{
  id: 'p1', primitive: 'KPITile',
  compiledQuery: {
    entity: 'projects',
    repositoryMethod: 'project.list',
    resolvedFilters: [],
    resolvedSelect: ['contract_value'],
    resolvedAggregate: { fn: 'sum', column: 'contract_value', alias: 'total' },
  },
  props: { icon: 'doc', tone: 'blue', label: 'Total Contract Value' },
}];

describe('UserViewRenderer — data states (AC-VR-006..010)', () => {
  beforeEach(() => {
    mockCompile.mockReturnValue(COMPILED_KPITILE);
    mockUseUserView.mockReturnValue({ data: VALID_KPITILE_VIEW, isPending: false, isError: false });
  });

  it('AC-VR-006: KPITile is hydrated with value from executeCompiledQuery data', async () => {
    mockExecute.mockResolvedValue([{ total: 1234567 }]);
    renderRenderer();
    await waitFor(() => {
      expect(screen.getByText('Total Contract Value')).toBeInTheDocument();
      expect(screen.getByText('1234567')).toBeInTheDocument();
    });
  });

  it('AC-VR-007: per-panel loading state while query is pending (heading already visible)', async () => {
    // executeCompiledQuery never resolves in this test
    mockExecute.mockReturnValue(new Promise(() => {}));
    renderRenderer();
    // Page heading IS rendered (row has resolved)
    expect(screen.getByRole('heading', { name: 'My KPI' })).toBeInTheDocument();
    // Panel ChartFrame is in loading state
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });

  it('AC-VR-008: per-panel error state with retry button; page heading stays', async () => {
    const { AppError } = await import('@/src/lib/appError');
    mockExecute.mockRejectedValue(new AppError('DB error', '42501'));
    renderRenderer();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'My KPI' })).toBeInTheDocument();
  });

  it('AC-VR-009: per-panel empty state when query returns []', async () => {
    mockExecute.mockResolvedValue([]);
    renderRenderer();
    await waitFor(() => {
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });
  });

  it('AC-VR-010: multi-panel layout with colSpan hint applies grid-column style', async () => {
    const twoPanel = [
      { ...COMPILED_KPITILE[0], id: 'p1', layout: { colSpan: 2 } },
      { ...COMPILED_KPITILE[0], id: 'p2' },
    ];
    mockCompile.mockReturnValue(twoPanel);
    mockExecute.mockResolvedValue([{ total: 99 }]);
    renderRenderer();
    await waitFor(() => {
      const wrappers = document.querySelectorAll('[style*="grid-column: span 2"]');
      expect(wrappers.length).toBe(1);
    });
  });
});

// ── Axe a11y (AC-VR-012, NFR-VR-A11Y-001..004) ───────────────────────────────

import { axeViolations } from '@/src/components/__tests__/axe';

describe('UserViewRenderer — axe a11y (AC-VR-012, NFR-VR-A11Y-001..004)', () => {
  it('AC-VR-012: loading state passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { container } = renderRenderer();
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });

  it('AC-VR-012: not-found state passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: null, isPending: false, isError: false });
    const { container } = renderRenderer();
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });

  it('AC-VR-012: spec-invalid error state passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: VALID_KPITILE_VIEW, isPending: false, isError: false });
    mockCompile.mockImplementation(() => { throw new ValidationError('UNKNOWN_PRIMITIVE', 'p1'); });
    const { container } = renderRenderer();
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });

  it('AC-VR-012: ready state (KPITile) passes axe at zero critical/serious violations', async () => {
    mockUseUserView.mockReturnValue({ data: VALID_KPITILE_VIEW, isPending: false, isError: false });
    mockCompile.mockReturnValue(COMPILED_KPITILE);
    mockExecute.mockResolvedValue([{ total: 42000 }]);
    const { container } = renderRenderer();
    await waitFor(() => screen.getByText('42000'));
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});
