/**
 * StatusBarChart hides the cramped rotated x-axis on mobile; legend is the key (2026-06-17)
 *
 * On narrow viewports (<640px) the rotated X-axis tick labels are hidden because
 * they are cramped and 100% redundant — the <figcaption> legend already lists
 * every status with dot + name + count. On desktop the axis labels remain.
 *
 * Strategy:
 * - vi.mock useIsNarrow → control the narrow/wide branch.
 * - vi.mock recharts BarChart → render its children so XAxis (also mocked to a
 *   data-* div) actually mounts in the DOM. Recharts treats XAxis as config data,
 *   not a React child, so the BarChart must be a pass-through to surface the stub.
 * - Legend assertions use the real figcaption output (unaffected by mocks).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockIsNarrow } = vi.hoisted(() => ({ mockIsNarrow: vi.fn(() => false as boolean) }));

vi.mock('@/src/components/ui/useIsNarrow', () => ({
  useIsNarrow: mockIsNarrow,
}));

// Mock the recharts module:
// • ResponsiveContainer → plain div pass-through (no ResizeObserver needed)
// • BarChart → renders its children array so XAxis component mounts
// • XAxis → div stub with data-* attributes exposing its props for assertion
// • Everything else → identity stubs (not exercised in these tests)
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: ({ tick, height, angle, textAnchor }: {
    tick?: boolean | object;
    height?: number;
    angle?: number;
    textAnchor?: string;
  }) => (
    <div
      data-testid="xaxis-stub"
      data-tick={JSON.stringify(tick)}
      data-height={String(height)}
      data-angle={String(angle)}
      data-text-anchor={textAnchor ?? ''}
    />
  ),
  YAxis: () => <div data-testid="yaxis-stub" />,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

// ── import after mocks ─────────────────────────────────────────────────────────
import { StatusBarChart } from '../StatusBarChart';

// ── fixtures ───────────────────────────────────────────────────────────────────
const data = [
  { status: 'Draft' as const, count: 2 },
  { status: 'Ordered' as const, count: 5 },
  { status: 'Paid' as const, count: 3 },
];

const toneFor = () => 'hsl(142 70% 45%)';

afterEach(() => {
  mockIsNarrow.mockReset();
  mockIsNarrow.mockReturnValue(false); // reset to desktop default
});

// ── tests ─────────────────────────────────────────────────────────────────────
describe('StatusBarChart hides the cramped rotated x-axis on mobile; legend is the key (2026-06-17)', () => {
  it('NARROW: XAxis rendered with tick={false} on mobile (labels hidden)', () => {
    mockIsNarrow.mockReturnValue(true);

    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
        />
      </MemoryRouter>,
    );

    const xaxis = screen.getByTestId('xaxis-stub');
    // tick={false} means recharts renders no tick labels on mobile
    expect(xaxis.dataset.tick).toBe('false');
  });

  it('NARROW: XAxis has small height on mobile (reclaims vertical space)', () => {
    mockIsNarrow.mockReturnValue(true);

    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
        />
      </MemoryRouter>,
    );

    const xaxis = screen.getByTestId('xaxis-stub');
    const h = Number(xaxis.dataset.height);
    // Mobile height must be much smaller than the desktop 64px (labels are gone)
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(20);
  });

  it('NARROW: legend still lists every status with dot + count on mobile', () => {
    mockIsNarrow.mockReturnValue(true);

    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
        />
      </MemoryRouter>,
    );

    // The figcaption legend is the canonical key on mobile — all statuses present
    const caption = document.querySelector('figcaption');
    expect(caption, 'figcaption legend must be present on mobile').not.toBeNull();
    for (const d of data) {
      expect(caption!.textContent).toContain(d.status);
      expect(caption!.textContent).toContain(String(d.count));
    }
  });

  it('DESKTOP: XAxis retains tick style with angle={-30} on wide viewports', () => {
    mockIsNarrow.mockReturnValue(false);

    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
        />
      </MemoryRouter>,
    );

    const xaxis = screen.getByTestId('xaxis-stub');
    // tick must NOT be false on desktop (axisTickStyle object is passed)
    expect(xaxis.dataset.tick).not.toBe('false');
    // angle={-30} and textAnchor="end" are the desktop rotated-label config
    expect(xaxis.dataset.angle).toBe('-30');
    expect(xaxis.dataset.textAnchor).toBe('end');
    // desktop height is 64 (the original value)
    expect(xaxis.dataset.height).toBe('64');
  });

  it('DESKTOP: aria summary is unchanged on desktop', () => {
    mockIsNarrow.mockReturnValue(false);

    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
        />
      </MemoryRouter>,
    );

    // a11y role and summary unchanged on desktop
    const region = screen.getByRole('img', { name: /Procurement by status/i });
    expect(region).toHaveAccessibleName(/10 requests/i);
    expect(region).toHaveAccessibleName(/most in Ordered/i);
  });
});
