import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stub useMilestones ───────────────────────────────────────────────────────
const milestoneState = {
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const milestoneMutations = {
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => milestoneMutations,
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

let mockIsDesktop = true;
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => mockIsDesktop,
}));

import MilestoneStrip from '../MilestoneStrip';

const render$ = (projectId = 'p1') =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <MilestoneStrip projectId={projectId} />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('fillClass priority (I1, I4)', () => {
  // We test the bar fill color by inspecting the rendered span's class.
  // The fill bar is the <span className={...}> inside each even-segment track slot.
  // Requirement: continuous bar — no rounded-full on inner fills.
  const getFillClass = (milestone: MilestoneWithProgress) => {
    milestoneState.data = [milestone];
      const { container } = render$();
    const fills = container.querySelectorAll<HTMLSpanElement>('span.delivery-fill');
    // First such span is the fill inside the continuous delivery track.
    return fills[0]?.className ?? '';
  };

  it('I1: current phase with past target date gets bg-primary (not bg-warning)', () => {
    const cls = getFillClass({
      id: 'm1',
      project_id: 'p1',
      name: 'Current Phase',
      sort_order: 0,
      target_date: '2020-01-01', // past target
      weight: 1,
      input_pct: null,
      task_count: 3,
      calculated_pct: 40,
      effective_pct: 40, // < 100, so it's the current (first incomplete)
    });
    expect(cls).toContain('bg-primary');
    expect(cls).not.toContain('bg-warning');
  });

  it('I1: 100% complete phase gets bg-success', () => {
    const cls = getFillClass({
      id: 'm2',
      project_id: 'p1',
      name: 'Done Phase',
      sort_order: 0,
      target_date: '2020-01-01',
      weight: 1,
      input_pct: 100,
      task_count: 5,
      calculated_pct: 100,
      effective_pct: 100,
    });
    expect(cls).toContain('bg-success');
  });

  it('I4: 0% future phase (not started, past target) gets bg-primary NOT bg-warning', () => {
    // A phase with effective_pct=0, no tasks, past target — it's 'not started', not overdue.
    const cls = getFillClass({
      id: 'm3',
      project_id: 'p1',
      name: 'Future Phase',
      sort_order: 0,
      target_date: '2020-01-01', // past
      weight: 1,
      input_pct: null,
      task_count: 0, // not started
      calculated_pct: null,
      effective_pct: 0,
    });
    expect(cls).not.toContain('bg-warning');
    expect(cls).toContain('bg-primary');
  });

  it('I1/I4: overdue (started + past target + <100%) gets bg-warning', () => {
    // The overdue phase must NOT be the current (first incomplete) one.
    // So: phase 1 is current (40%), phase 2 is overdue (started + past + <100%).
    milestoneState.data = [
      {
        id: 'm0',
        project_id: 'p1',
        name: 'Current Phase',
        sort_order: 0,
        target_date: null,
        weight: 1,
        input_pct: null,
        task_count: 3,
        calculated_pct: 40,
        effective_pct: 40,
      },
      {
        id: 'm4',
        project_id: 'p1',
        name: 'Overdue Phase',
        sort_order: 1,
        target_date: '2020-01-01',
        weight: 1,
        input_pct: 25,
        task_count: 5,
        calculated_pct: 25,
        effective_pct: 25,
      },
    ];
    const { container } = render$();
    const fills = container.querySelectorAll<HTMLSpanElement>('span.delivery-fill');
    // First fill = current (bg-primary), second fill = overdue (bg-warning)
    expect(fills[0]?.className ?? '').toContain('bg-primary');
    expect(fills[1]?.className ?? '').toContain('bg-warning');
  });
});

describe('MilestoneStrip display (AC-DEL-008, AC-DEL-009)', () => {
  it('AC-DEL-008: renders a single segmented track plus the effective headline, weight share, and NO From tasks on desktop', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Engineering design',
        sort_order: 0,
        target_date: '2026-08-15',
        weight: 1,
        input_pct: 75,
        task_count: 5,
        calculated_pct: 60,
        effective_pct: 75,
      },
      {
        id: 'm2',
        project_id: 'p1',
        name: 'Procurement',
        sort_order: 1,
        target_date: null,
        weight: 1,
        input_pct: null,
        task_count: 0,
        calculated_pct: null,
        effective_pct: 0,
      },
    ];
    render$();

    expect(screen.getByRole('list', { name: 'Delivery phases' })).toBeInTheDocument();
    expect(screen.getByText('Engineering design')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Target 15 Aug')).toBeInTheDocument();
    // Weight share: both milestones have weight 1 out of 2 total = 50% each
    expect(screen.getAllByText('50% of project')).toHaveLength(2);
    // Desktop cards should NOT show 'From tasks' anymore
    expect(screen.queryByText(/From tasks/i)).not.toBeInTheDocument();
    expect(screen.queryByText('PM input')).not.toBeInTheDocument();
  });

  it('I2: header shows "Delivery phases" heading and weight-weighted rollup', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Phase A',
        sort_order: 0,
        target_date: null,
        weight: 2,
        input_pct: 80,
        task_count: 4,
        calculated_pct: 80,
        effective_pct: 80,
      },
      {
        id: 'm2',
        project_id: 'p1',
        name: 'Phase B',
        sort_order: 1,
        target_date: null,
        weight: 1,
        input_pct: 20,
        task_count: 2,
        calculated_pct: 20,
        effective_pct: 20,
      },
    ];
    render$();

    // Heading changed from 'Milestones' to 'Delivery phases'
    expect(screen.getByText('Delivery phases')).toBeInTheDocument();
    // Rollup: (2*80 + 1*20) / (2+1) = 180/3 = 60%
    const rollup = screen.getByLabelText('Project delivery 60%');
    expect(rollup).toBeInTheDocument();
    expect(screen.getByText('Project delivery')).toBeInTheDocument();
    // The big tabular % is rendered
    const bigPct = screen.getByText('60%');
    expect(bigPct.className).toContain('text-[23px]');
  });

  it('AC-DEL-009: null calculated renders 0% effective headline and weight share, no From tasks on desktop', () => {
    milestoneState.data = [
      {
        id: 'm2',
        project_id: 'p1',
        name: 'Procurement',
        sort_order: 1,
        target_date: null,
        weight: 1,
        input_pct: null,
        task_count: 0,
        calculated_pct: null,
        effective_pct: 0,
      },
    ];
    render$();

    expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(1);
    // Weight share: 1/1 * 100 = 100%
    expect(screen.getByText('100% of project')).toBeInTheDocument();
    // Desktop cards should NOT show 'From tasks' anymore
    expect(screen.queryByText(/From tasks/i)).not.toBeInTheDocument();
    expect(screen.queryByText('PM input')).not.toBeInTheDocument();
  });
});

describe('continuous desktop delivery track (no rounded per-segment fills)', () => {
  it('desktop bar: inner fills are NOT rounded and use weighted contribution widths', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Phase A',
        sort_order: 0,
        target_date: null,
        weight: 15,
        input_pct: 100,
        task_count: 3,
        calculated_pct: 100,
        effective_pct: 100,
      },
      {
        id: 'm2',
        project_id: 'p1',
        name: 'Phase B',
        sort_order: 1,
        target_date: null,
        weight: 35,
        input_pct: 71,
        task_count: 1,
        calculated_pct: 71,
        effective_pct: 71,
      },
      {
        id: 'm3',
        project_id: 'p1',
        name: 'Phase C',
        sort_order: 2,
        target_date: '2020-01-01',
        weight: 40,
        input_pct: 25,
        task_count: 1,
        calculated_pct: 25,
        effective_pct: 25,
      },
      {
        id: 'm4',
        project_id: 'p1',
        name: 'Phase D',
        sort_order: 3,
        target_date: null,
        weight: 10,
        input_pct: null,
        task_count: 0,
        calculated_pct: null,
        effective_pct: 0,
      },
    ];
    mockIsDesktop = true;
    const { container } = render$();
    const track = container.querySelector('.delivery-track');
    expect(track).toBeInTheDocument();
    // Outer track may be rounded, but inner fills must NOT have rounded-full
    const fills = track!.querySelectorAll('.delivery-fill');
    expect(fills.length).toBe(4);
    expect((fills[0] as HTMLElement).style.width).toBe('15%');
    expect((fills[1] as HTMLElement).style.width).toBe('24.85%');
    expect((fills[2] as HTMLElement).style.width).toBe('10%');
    expect((fills[3] as HTMLElement).style.width).toBe('0%');
    for (const fill of fills) {
      expect(fill.classList.contains('rounded-full')).toBe(false);
    }
  });
});

describe('C2: mobile stepper reflow', () => {
  const phases: MilestoneWithProgress[] = [
    {
      id: 'm1',
      project_id: 'p1',
      name: 'Phase A',
      sort_order: 0,
      target_date: null,
      weight: 1,
      input_pct: 80,
      task_count: 3,
      calculated_pct: 80,
      effective_pct: 80,
    },
    {
      id: 'm2',
      project_id: 'p1',
      name: 'Phase B',
      sort_order: 1,
      target_date: null,
      weight: 1,
      input_pct: null,
      task_count: 0,
      calculated_pct: null,
      effective_pct: 0,
    },
  ];

  it('C2: desktop renders horizontal continuous bar + responsive phase cards grid', () => {
    milestoneState.data = phases;
    mockIsDesktop = true;
    const { container } = render$();
    // Desktop: should render the horizontal bar (flex h-3)
    const bar = container.querySelector('.delivery-track');
    expect(bar).toBeInTheDocument();
    // Desktop/tablet: phase cards should be in a responsive grid, not an inline fixed-column style.
    const grid = screen.getByTestId('milestone-card-grid');
    expect(grid).toBeInTheDocument();
  });

  it('C2: mobile renders vertical rows with per-phase progress and no horizontal desktop grid', () => {
    milestoneState.data = phases;
    mockIsDesktop = false;
    const { container } = render$();
    // Mobile: NO horizontal bar
    expect(container.querySelector('.delivery-track')).not.toBeInTheDocument();
    // Mobile: NO grid
    expect(screen.queryByTestId('milestone-card-grid')).not.toBeInTheDocument();
    // Mobile: should render both phase names in stacked compact rows
    expect(screen.getByText('Phase A')).toBeInTheDocument();
    expect(screen.getByText('Phase B')).toBeInTheDocument();
    // Mobile: per-phase progress remains visible in each row.
    expect(screen.getAllByText('80%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(1);
    const mobileFills = screen.getAllByTestId('milestone-mobile-fill');
    expect(mobileFills.length).toBe(2);
  });
});
