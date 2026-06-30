/**
 * UserViewRenderer — guard state tests and data state tests.
 * AC-VR-001 (loading), AC-VR-002 (not-found), AC-VR-003 (archived),
 * AC-VR-004 (spec-invalid), AC-VR-005 (empty-spec), AC-VR-018 (feature-off redirect).
 * AC-VR-006..010 (data states), AC-VR-012 (axe a11y).
 * AC-VR-019 (network-error page-level state with retry).
 * AC-VR-020 (VITE_APP_ENV=prod hides dev-disclosure details block).
 * AC-VR-021 (ready state renders correctly after two-tick delay).
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

  it('AC-VR-019: renders page-level error state with retry when useUserView returns isError=true', () => {
    mockUseUserView.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderRenderer();
    expect(screen.getByText(/could not load this view/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // Must not show not-found copy (isError should not fall through to not-found guard)
    expect(screen.queryByText(/this view was not found/i)).not.toBeInTheDocument();
  });

  it('AC-VR-020: dev-disclosure <details> is absent when VITE_APP_ENV is "prod"', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    mockUseUserView.mockReturnValue({
      data: { id: 'abc', name: 'Bad View', spec: { version: 1, panels: [{ id: 'p1', primitive: 'PieChart', querySpec: { entity: 'projects', select: ['id'] } }] }, archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1', description: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      isPending: false,
      isError: false,
    });
    mockCompile.mockImplementation(() => {
      throw new ValidationError('UNKNOWN_PRIMITIVE', 'p1');
    });
    renderRenderer();
    // The spec-invalid state should render but not expose the developer <details> block
    expect(screen.getByText(/this view's definition is invalid/i)).toBeInTheDocument();
    expect(document.querySelector('details')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
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

  it('AC-VR-007: per-panel loading state while query is pending (heading visible after compile)', async () => {
    // executeCompiledQuery never resolves in this test
    mockExecute.mockReturnValue(new Promise(() => {}));
    renderRenderer();
    // Wait for compilation to complete: heading appears once compiling=false
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'My KPI' })).toBeInTheDocument();
    });
    // Panel ChartFrame is in loading state (per-panel queries still pending)
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

  it('AC-VR-021: ready state renders correctly after two-tick delay (view resolves → compiledPanels resolves → data resolves)', async () => {
    // Simulate the full timing path: view data is available, effect fires to compile,
    // queries resolve. The ready state (heading + KPI value) must appear after all settle.
    mockExecute.mockResolvedValue([{ total: 5555 }]);
    renderRenderer();
    // After all effects settle and queries resolve, heading and KPI value appear
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'My KPI' })).toBeInTheDocument();
      expect(screen.getByText('5555')).toBeInTheDocument();
    });
    // No loading skeleton remains in the steady state
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
  });

  it('AC-VR-011: DataTable panel hydrates a real <table> from the query rows (not a JSON dump)', async () => {
    const dtView = {
      id: 'abc', name: 'Companies', description: null,
      spec: { version: 1, panels: [{ id: 'p1', primitive: 'DataTable', querySpec: { entity: 'companies', select: ['id', 'name'] } }] },
      archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    mockUseUserView.mockReturnValue({ data: dtView, isPending: false, isError: false });
    mockCompile.mockReturnValue([{
      id: 'p1', primitive: 'DataTable',
      compiledQuery: { entity: 'companies', repositoryMethod: 'company.list', resolvedFilters: [], resolvedSelect: ['id', 'name'] },
      props: {},
    }]);
    mockExecute.mockResolvedValue([{ id: 'c1', name: 'Acme Corp' }, { id: 'c2', name: 'Globex' }]);
    renderRenderer();
    await waitFor(() => {
      // A real semantic table, not the JSON <pre> debug fallback.
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  // ── Remaining primitives wired (category→metric hydration) ──────────────────
  function setupGrouped(primitive: string, props: Record<string, unknown> = {}) {
    mockUseUserView.mockReturnValue({
      data: {
        id: 'abc', name: 'Grouped', description: null,
        spec: { version: 1, panels: [{ id: 'p1', primitive, querySpec: { entity: 'projects', select: ['status'], groupBy: 'status', aggregate: { fn: 'count', column: 'id', alias: 'cnt' } }, props }] },
        archived_at: null, scope: 'private', org_id: 'org1', user_id: 'u1',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      isPending: false, isError: false,
    });
    mockCompile.mockReturnValue([{
      id: 'p1', primitive,
      compiledQuery: { entity: 'projects', repositoryMethod: 'project.list', resolvedFilters: [], resolvedSelect: ['status', 'cnt'], resolvedGroupBy: 'status', resolvedAggregate: { fn: 'count', column: 'id', alias: 'cnt' } },
      props,
    }]);
  }

  it('AC-VR-011b: StatTiles hydrates one tile per grouped row (label + metric)', async () => {
    setupGrouped('StatTiles');
    mockExecute.mockResolvedValue([{ status: 'Active', cnt: 5 }, { status: 'Closed', cnt: 2 }]);
    renderRenderer();
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('AC-VR-011c: Funnel hydrates one stage per grouped row', async () => {
    setupGrouped('Funnel');
    mockExecute.mockResolvedValue([{ status: 'Lead', cnt: 10 }, { status: 'Won', cnt: 3 }]);
    renderRenderer();
    await waitFor(() => expect(screen.getByText('Lead')).toBeInTheDocument());
    expect(screen.getByText('Won')).toBeInTheDocument();
  });

  it('AC-VR-011d: StatusBarChart hydrates an aria summary + legend from grouped rows', async () => {
    setupGrouped('StatusBarChart');
    mockExecute.mockResolvedValue([{ status: 'Open', cnt: 4 }, { status: 'Done', cnt: 6 }]);
    renderRenderer();
    // figure role=img with the aria summary "<entity>, <total> records, most in <top>."
    await waitFor(() => expect(screen.getByRole('img', { name: /10 records/i })).toBeInTheDocument());
    expect(screen.getByRole('img', { name: /most in Done/i })).toBeInTheDocument();
  });

  it('AC-VR-011e: ProgressBar hydrates a scalar value from the first row', async () => {
    setupGrouped('ProgressBar', { 'aria-label': 'Utilization' });
    mockExecute.mockResolvedValue([{ status: 'x', cnt: 42 }]);
    renderRenderer();
    await waitFor(() => {
      const bar = screen.getByRole('progressbar', { name: 'Utilization' });
      expect(bar).toHaveAttribute('aria-valuenow', '42');
    });
  });

  it('AC-VR-011f: Card hydrates a definition list from the first row columns', async () => {
    setupGrouped('Card');
    mockExecute.mockResolvedValue([{ status: 'Active', cnt: 9 }]);
    renderRenderer();
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
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
