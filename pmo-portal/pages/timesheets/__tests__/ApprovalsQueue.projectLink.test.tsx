/**
 * AC-JR-W1-09 — ApprovalsQueue read-only TimesheetGrid renders project name as a
 * /projects/:id link in the expanded breakdown panel (T09 wiring).
 *
 * S-1: Close the traceability gap — this AC had no owning test (spec-reviewer minor).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const { queue } = vi.hoisted(() => ({
  queue: {
    data: [
      {
        id: 's1',
        status: 'Submitted',
        week_start_date: '2026-06-02', // Monday
        owner: { full_name: 'Anita Rao' },
        entries: [
          {
            project_id: 'proj-apollo',
            entry_date: '2026-06-02',
            hours: 8,
            project: { name: 'Apollo Station', code: 'PRJ-014' },
          },
        ],
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queue,
  useTimesheetMutations: () => ({
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
}));

import { ApprovalsQueue } from '../ApprovalsQueue';

const renderPM = () =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <ApprovalsQueue />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

describe('AC-JR-W1-09: ApprovalsQueue expanded row shows /projects/:id link in TimesheetGrid', () => {
  it('AC-JR-W1-09: expanding a timesheet row renders the read-only grid with a project link', () => {
    renderPM();

    // Expand the row via the disclosure chevron
    const chevron = screen.getByRole('button', { name: /Show hours for Anita Rao/i });
    fireEvent.click(chevron);

    // The grid is now expanded — find the project link pointing to /projects/proj-apollo
    const link = screen.getByRole('link', { name: /Open Apollo Station/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/projects/proj-apollo');
  });

  it('AC-JR-W1-09: the project link is inside the expanded breakdown panel', () => {
    renderPM();

    // Expand
    const chevron = screen.getByRole('button', { name: /Show hours for Anita Rao/i });
    fireEvent.click(chevron);

    // The panel id is ts-breakdown-s1
    const panel = document.getElementById('ts-breakdown-s1');
    expect(panel).not.toBeNull();

    // The link must be inside the panel, not elsewhere
    const link = panel!.querySelector('a[href="/projects/proj-apollo"]');
    expect(link).not.toBeNull();
  });

  it('AC-JR-W1-09: before expanding, the project link is NOT in the DOM', () => {
    renderPM();

    // Do NOT expand
    expect(screen.queryByRole('link', { name: /Open Apollo Station/i })).toBeNull();
  });
});
