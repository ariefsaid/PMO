/**
 * ViewPreview — in-memory preview tests.
 * AC-VB-012: spec with 1→2 panels triggers 2 executeCompiledQuery calls on the new spec.
 * AC-VB-013: spec with panels:[] shows placeholder; executeCompiledQuery not called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    repositoryMethod: 'company.list',
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
  ChartFrame: ({ state, children }: { state: string; children: React.ReactNode }) =>
    state === 'ready' ? <div data-testid="chart-ready">{children}</div> : <div data-testid={`chart-${state}`} />,
}));
vi.mock('@/src/components/dashboard/layout', () => ({
  DashGrid: ({ children }: { children: React.ReactNode }) => <div data-testid="dash-grid">{children}</div>,
}));
vi.mock('@/src/components/ui/KPITile', () => ({
  KPITile: (props: Record<string, unknown>) => <div data-testid="kpi-tile">{String(props.value ?? '')}</div>,
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
});
