/**
 * The overview cards draw what the figure hooks know. The hooks are the seam; these tests pin what each card
 * shows, leaves out and gates — not how it looks.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  canViewProcurement: true,
  schedule: {} as Record<string, unknown>,
  usage: {} as Record<string, unknown>,
  tasks: { data: [], isPending: false, isError: false } as Record<string, unknown>,
  procurements: { data: [], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
}));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => entity !== 'procurement' || action !== 'view' || h.canViewProcurement }));
vi.mock('../useProjectOverviewFigures', () => ({ useScheduleSummary: () => h.schedule, useBudgetUsage: () => h.usage }));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => h.tasks }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => h.procurements }));
vi.mock('../MilestoneStrip', () => ({ default: () => <div>Phase editor</div> }));
vi.mock('../ProjectBlocks', () => ({ BlockAction: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button> }));

import { BudgetBarsCard, OpenPurchasesCard, ProgressCurveCard, ScheduleCard } from '../OverviewCards';
import { BehindPlanPill } from '../ProjectDetail';

const project = { id: 'p1', currency: 'USD', start_date: '2026-01-01', end_date: '2026-12-31' } as unknown as ProjectWithRefs;
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const phase = (over: Record<string, unknown>) => ({ id: 'ph', name: 'Phase', weight: 1, task_count: 2, effective_pct: 0, target_date: '2026-06-30', ...over });
const schedule = (milestones: unknown[], extra: Record<string, unknown> = {}) => ({
  today: '2026-10-01', milestones, progress: 40, planned: 60, endLate: null, lateCount: 0, worst: null, isPending: false, isError: false, retry: () => undefined, ...extra,
});

beforeEach(() => {
  h.canViewProcurement = true;
  h.tasks = { data: [], isPending: false, isError: false };
  h.procurements = { data: [], isPending: false, isError: false, refetch: () => undefined };
});

describe('ScheduleCard', () => {
  it('shows a late chip with percent and days for a started phase past its target, and Done for a finished one', () => {
    h.schedule = schedule([phase({ id: 'a', name: 'Design', effective_pct: 40 }), phase({ id: 'b', name: 'Build', effective_pct: 100 })]);
    wrap(<ScheduleCard project={project} />);
    expect(screen.getByText('40% · 93d')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('draws no actual bar for a phase at 0%', () => {
    h.schedule = schedule([phase({ id: 'a', name: 'Commissioning', effective_pct: 0, task_count: 0, target_date: '2026-12-01' })]);
    wrap(<ScheduleCard project={project} />);
    const bar = screen.getByRole('img', { name: 'Commissioning: 0% complete' });
    expect(bar.querySelectorAll('span.bg-primary, span.bg-destructive, span.bg-warning, span.bg-success')).toHaveLength(0);
  });

  it('says the phases failed to load instead of "No phases yet"', () => {
    h.schedule = schedule([], { isError: true });
    wrap(<ScheduleCard project={project} />);
    expect(screen.getByText("Couldn't load the phase timeline")).toBeInTheDocument();
    expect(screen.queryByText(/No phases yet/)).not.toBeInTheDocument();
  });
});

describe('BudgetBarsCard', () => {
  const base = { pos: { isPending: false, isError: false, hasBudget: true, rows: [] }, committedByCategory: new Map(), committed: null };

  it('shows spent against budget per category, a committed-only Uncategorized row, and marks an overrun', () => {
    h.usage = { ...base, summaryRows: [
      { category: 'Labor', budget: 1000, spent: 400, committed: 100 },
      { category: 'Materials', budget: 500, spent: 700, committed: 0 },
      { category: 'Uncategorized', budget: 0, spent: 0, committed: 300 },
    ] };
    wrap(<BudgetBarsCard project={project} onOpenBudget={() => undefined} />);
    expect(screen.getByRole('img', { name: 'Labor uses 40% of budget' })).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    const over = screen.getByRole('img', { name: /Materials uses/ }).querySelector('i');
    expect(over).toHaveClass('bg-destructive');
  });

  it('says so when there is no active budget', () => {
    h.usage = { ...base, pos: { isPending: false, isError: false, hasBudget: false, rows: [] }, summaryRows: null };
    wrap(<BudgetBarsCard project={project} onOpenBudget={() => undefined} />);
    expect(screen.getByText(/No active budget yet/)).toBeInTheDocument();
  });
});

describe('OpenPurchasesCard', () => {
  const row = (id: string, status: string, created: string) => ({ id, code: `SP-${id}`, title: `Order ${id}`, status, total_value: '1000', currency: 'USD', created_at: created });

  it('lists only purchases still in flight, newest first, with the code on its own line', () => {
    h.procurements = { data: [row('1', 'Ordered', '2026-01-01'), row('2', 'Paid', '2026-02-01'), row('3', 'Cancelled', '2026-03-01'), row('4', 'Approved', '2026-04-01')], isPending: false, isError: false, refetch: () => undefined };
    wrap(<OpenPurchasesCard project={project} />);
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.includes('open='));
    expect(links.map((a) => a.textContent)).toEqual(['SP-4Order 4', 'SP-1Order 1']);
    expect(within(links[0]).getByText('SP-4')).toBeInTheDocument();
  });

  it('is absent for a role that cannot view procurement', () => {
    h.canViewProcurement = false;
    const { container } = wrap(<OpenPurchasesCard project={project} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProgressCurveCard', () => {
  it('renders nothing when no phase has a target date', () => {
    h.schedule = schedule([phase({ target_date: null })]);
    const { container } = wrap(<ProgressCurveCard project={project}>curve</ProgressCurveCard>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('BehindPlanPill', () => {
  it('shows when a started phase is late or the end date has passed, and is hidden otherwise', () => {
    h.schedule = schedule([], { lateCount: 1 });
    const { rerender } = wrap(<BehindPlanPill project={project} />);
    expect(screen.getByText('Behind plan')).toBeInTheDocument();
    h.schedule = schedule([], { lateCount: 0, endLate: 12 });
    rerender(<MemoryRouter><BehindPlanPill project={project} /></MemoryRouter>);
    expect(screen.getByText('Behind plan')).toBeInTheDocument();
    h.schedule = schedule([], { lateCount: 0, endLate: null });
    rerender(<MemoryRouter><BehindPlanPill project={project} /></MemoryRouter>);
    expect(screen.queryByText('Behind plan')).not.toBeInTheDocument();
  });
});
