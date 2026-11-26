import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { setActiveLocale, setActiveOrgTimezone, resetActiveLocale } from '@/src/lib/locale/activeLocale';

const { milestoneState, tasksState } = vi.hoisted(() => ({
  milestoneState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  tasksState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useMilestones', () => ({ useMilestones: () => milestoneState }));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => tasksState }));

import { DeliveryBlock } from '../ProjectBlocks';

const milestone = {
  id: 'ms-1', project_id: 'p1', name: 'Foundations', sort_order: 0, weight: 1,
  input_pct: null, task_count: 2, calculated_pct: 0, effective_pct: 0,
  target_date: '2026-06-01',
};

/**
 * #2088 (WIG, Locale & i18n) — the phase timeline decides "this phase is past its target" against
 * the ORGANIZATION's day. The old UTC day left a phase due "today" (org time) unflagged for the
 * first hours of the day in UTC+7 — the exact hours a site engineer reviews the plan.
 */
describe('#2088 DeliveryBlock — phase lateness follows the organization day', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    milestoneState.data = [milestone];
    milestoneState.isPending = false;
    milestoneState.isError = false;
    tasksState.data = [];
    tasksState.isPending = false;
    tasksState.isError = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetActiveLocale();
  });

  it('#2088: a phase whose target was yesterday (org time) reads overdue at 03:00 org-local', () => {
    // 2026-06-01 20:00 UTC == 2026-06-02 03:00 in Asia/Jakarta: the target (Jun 1) is past.
    vi.setSystemTime(new Date('2026-06-01T20:00:00Z'));
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    render(
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <DeliveryBlock projectId="p1" />
        </ImpersonationProvider>
      </MemoryRouter>,
    );

    // A phase past its target reads "late" (overdue is for tasks and invoices, screen rules).
    expect(screen.getByText(/^1 days? late/)).toBeInTheDocument();
  });
});
