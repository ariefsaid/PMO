/**
 * ViewPreview — in-memory preview tests.
 * AC-VB-012: spec with 1→2 panels triggers 2 executeCompiledQuery calls on the new spec.
 * AC-VB-013: spec with panels:[] shows placeholder; executeCompiledQuery not called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ── Hoisted stable refs — prevents new-object-per-render infinite useEffect loop ─
// useAuth() is called on every render; if it returns a NEW currentUser object each
// time, ViewPreview's useEffect([spec, currentUser]) sees a changed ref and re-runs
// indefinitely → OOM. Use vi.hoisted() to create a stable object that can be
// referenced inside the vi.mock() factory (which runs before module imports).
const { mockExecute, STABLE_USER } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  STABLE_USER: { id: 'u1', org_id: 'org1' } as { id: string; org_id: string },
}));

vi.mock('@/src/lib/viewspec/executor', () => ({
  executeCompiledQuery: mockExecute,
}));
vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: vi.fn(),
  compileQuerySpec: vi.fn((qs: unknown) => ({
    entity: (qs as { entity: string }).entity,
    resolvedFilters: [],
    resolvedSelect: ['id', 'name'],
    resolvedAggregate: undefined,
  })),
}));
// STABLE_USER reference never changes between renders — effect dependency is stable.
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: STABLE_USER }),
}));
// Stub heavy dashboard components to avoid jsdom OOM from large component trees
vi.mock('@/src/components/dashboard/ChartFrame', () => ({
  ChartFrame: ({ state, onRetry, children }: { state: string; onRetry?: () => void; children: React.ReactNode }) =>
    state === 'ready' || state === 'empty' ? <div data-testid={`chart-${state}`}>{children}</div>
      : state === 'error' ? <div data-testid={`chart-${state}`}><button type="button" onClick={onRetry}>Retry</button></div>
        : <div data-testid={`chart-${state}`} />,
}));
vi.mock('@/src/components/dashboard/layout', () => ({
  DashGrid: ({ children }: { children: React.ReactNode }) => <div data-testid="dash-grid">{children}</div>,
}));
vi.mock('@/src/components/dashboard/HydratedPrimitive', () => ({
  HydratedPrimitive: ({ panel, data }: { panel: { primitive: string }; data: unknown[] }) => (
    <div data-testid={`hydrated-${panel.primitive}`}>{data.length} hydrated rows</div>
  ),
}));
import ViewPreview from '@/src/components/builder/ViewPreview';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const ONE_PANEL_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'DataTable',
      querySpec: { entity: 'companies', select: ['id', 'name'] },
    },
  ],
};

const TWO_PANEL_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'DataTable',
      querySpec: { entity: 'companies', select: ['id', 'name'] },
    },
    {
      id: 'p2',
      primitive: 'DataTable',
      querySpec: { entity: 'companies', select: ['id', 'name'] },
    },
  ],
};

const EMPTY_SPEC: CompositionSpec = { version: 1, panels: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([]);
});

describe('ViewPreview', () => {
  it('AC-VB-013: empty spec shows placeholder; executeCompiledQuery not called', () => {
    render(<ViewPreview spec={EMPTY_SPEC} />);
    expect(
      screen.getByText(/your preview will appear here once you add a panel/i),
    ).toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('AC-VB-012: updating spec from 1 panel to 2 panels triggers 2 executeCompiledQuery calls', async () => {
    const { rerender } = render(<ViewPreview spec={ONE_PANEL_SPEC} />);
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));

    mockExecute.mockClear();
    rerender(<ViewPreview spec={TWO_PANEL_SPEC} />);
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(2));
  });

  it('CMP-004: previews every supported primitive through the shared hydration component', async () => {
    mockExecute.mockResolvedValue([{ id: 'row1', name: 'Project' }]);
    render(<ViewPreview spec={ONE_PANEL_SPEC} />);

    expect(await screen.findByTestId('hydrated-DataTable')).toHaveTextContent('1 hydrated rows');
    expect(screen.queryByText(/\{"id": "row1"/)).not.toBeInTheDocument();
  });

  it('retries only the panel query that failed', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 'row1', name: 'Recovered project' }]);
    render(<ViewPreview spec={ONE_PANEL_SPEC} />);

    const errorPanel = await screen.findByTestId('chart-error');
    fireEvent.click(within(errorPanel).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('1 hydrated rows')).toBeInTheDocument();
    expect(screen.getByTestId('hydrated-DataTable')).toBeInTheDocument();
  });
});
