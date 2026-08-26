/**
 * AC-CUA-072 (UI counterpart) — dependency edges whose source OR target task is tombstoned are hidden.
 *
 * A PIN test (the plan's wording): `task_dependencies` rows legitimately survive a ClickUp-native
 * delete (AC-CUA-070 — edges are preserved, keyed on the retained pmo_record_id), so the Gantt's
 * dependency rendering must hide any edge whose endpoint is tombstoned. `buildGanttModel` already
 * skips edges whose predecessor or successor bar is absent (`hiddenEdgeCount`) — and a tombstoned task
 * has NO bar because `listTasks` filters it (AC-CUA-002/C5). This test pins that invariant: an edge to
 * a tombstoned endpoint is counted hidden, never drawn; an edge between two live tasks draws normally.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import ProjectGantt from '../ProjectGantt';

function makeTask(overrides: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs {
  return {
    org_id: 'org-1',
    project_id: 'p1',
    status: 'To Do',
    assignee_id: null,
    milestone_id: 'm1',
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    parent_task_id: null,
    archived_at: null,
    assignee: null,
    dependencies: [],
    start_date: '2026-01-01',
    end_date: '2026-01-10',
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<MilestoneWithProgress> & { id: string; name: string }): MilestoneWithProgress {
  return {
    project_id: 'p1',
    sort_order: 0,
    target_date: '2026-01-15',
    weight: 10,
    input_pct: null,
    task_count: 0,
    calculated_pct: null,
    effective_pct: 0,
    ...overrides,
  };
}

/** The Gantt's figure carries the structural summary as its aria-label (role="img"). */
function ganttSummary(): string {
  return screen.getByRole('img').getAttribute('aria-label') ?? '';
}

describe('AC-CUA-072 Gantt hides dependency edges whose endpoint is tombstoned', () => {
  it('a live predecessor->successor edge is drawn (control)', () => {
    const a = makeTask({ id: 'task-a', name: 'A', start_date: '2026-01-05', end_date: '2026-01-12', dependencies: [{ depends_on_id: 'task-b' }] });
    const b = makeTask({ id: 'task-b', name: 'B', start_date: '2026-01-01', end_date: '2026-01-10' });
    render(<ProjectGantt tasks={[a, b]} milestones={[makeMilestone({ id: 'm1', name: 'M1' })]} />);
    const summary = ganttSummary();
    expect(summary).toMatch(/1 dependency connector drawn/);
    expect(summary).not.toMatch(/hidden/); // no hidden edges when both endpoints are live
  });

  it('an edge to a TOMBSTONED predecessor is hidden, not drawn (the row is filtered from the bars)', () => {
    // A depends on B, but B is tombstoned (deleted in ClickUp) — listTasks excludes it, so the Gantt
    // receives only A. The task_dependencies row survives (AC-CUA-070), so A still carries the edge,
    // but B has no bar -> buildGanttModel counts the edge hidden.
    const a = makeTask({ id: 'task-a', name: 'A', start_date: '2026-01-05', end_date: '2026-01-12', dependencies: [{ depends_on_id: 'task-b' }] });
    render(<ProjectGantt tasks={[a]} milestones={[makeMilestone({ id: 'm1', name: 'M1' })]} />);
    const summary = ganttSummary();
    expect(summary).toMatch(/0 dependency connectors drawn/); // the tombstoned-endpoint edge is NOT drawn
    // Singular now — i18next selects the form via Intl.PluralRules (#575), replacing the welded
    // "(ies)". The oracle is unchanged: the hidden COUNT must reach the screen-reader summary.
    expect(summary).toMatch(/1 dependency hidden/);
  });

  it('an edge from a tombstoned successor is likewise hidden (either endpoint tombstoned)', () => {
    // Only B (the predecessor) is live; A (the successor that carried the dependency) is tombstoned.
    // The edge cannot render without A's bar either.
    const b = makeTask({ id: 'task-b', name: 'B', start_date: '2026-01-01', end_date: '2026-01-10' });
    render(<ProjectGantt tasks={[b]} milestones={[makeMilestone({ id: 'm1', name: 'M1' })]} />);
    const summary = ganttSummary();
    expect(summary).toMatch(/0 dependency connectors drawn/);
  });
});

/**
 * #575: the screen-reader summary is assembled from five independently-translated clauses joined
 * in code. Three of them had NO oracle — a renamed slot or a lost interpolation would degrade the
 * label to "Task Gantt timeline: {{tasks}} across" and nothing would redden. The victim is a
 * screen-reader user, and this string is invisible to sighted QA *and* to the i18n gate (which
 * scans JSX text, not a template-literal aria-label).
 */
describe('the Gantt screen-reader summary states every clause (#575)', () => {
  it('AC-L10N-070: composes head, connectors and scale into one sentence, singular forms', () => {
    const b = makeTask({ id: 'task-b', name: 'B', start_date: '2026-01-01', end_date: '2026-01-10' });
    render(<ProjectGantt tasks={[b]} milestones={[makeMilestone({ id: 'm1', name: 'M1' })]} />);
    // The WHOLE label, not a substring: a clause silently dropped from the join is exactly the
    // failure mode, and a per-clause `toMatch` cannot see a missing neighbour.
    expect(ganttSummary()).toBe(
      'Task Gantt timeline: 1 task across 1 milestone, today at 100% of the span, ' +
        '0 dependency connectors drawn, scale: Month.',
    );
  });

  it('AC-L10N-071: picks the plural form per clause independently, and never leaves a raw {{token}}', () => {
    const a = makeTask({ id: 'task-a', name: 'A', start_date: '2026-01-05', end_date: '2026-01-12', dependencies: [{ depends_on_id: 'task-b' }] });
    const b = makeTask({ id: 'task-b', name: 'B', start_date: '2026-01-01', end_date: '2026-01-10' });
    render(
      <ProjectGantt
        tasks={[a, b]}
        milestones={[makeMilestone({ id: 'm1', name: 'M1' }), makeMilestone({ id: 'm2', name: 'M2' })]}
      />,
    );
    const summary = ganttSummary();
    expect(summary).toContain('2 tasks across 2 milestones');   // both plural
    expect(summary).toContain('1 dependency connector drawn');  // singular, same sentence
    expect(summary).not.toMatch(/\{\{|\}\}/);                   // no unresolved interpolation
  });

  it('AC-L10N-072: the scale clause names the TRANSLATED label, never the raw GanttScale enum', () => {
    const b = makeTask({ id: 'task-b', name: 'B', start_date: '2026-01-01', end_date: '2026-01-10' });
    render(<ProjectGantt tasks={[b]} milestones={[makeMilestone({ id: 'm1', name: 'M1' })]} />);
    // "scale: month" was what shipped — the raw enum, English, inside what will be an Indonesian
    // sentence, while the visible toggle beside it already read its translated label.
    expect(ganttSummary()).toMatch(/scale: Month\.$/);
    expect(ganttSummary()).not.toMatch(/scale: month/);
  });
});
