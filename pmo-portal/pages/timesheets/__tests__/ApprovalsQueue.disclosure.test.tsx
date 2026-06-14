/**
 * AC-JR-W3-01 — ApprovalsQueue routes the expand chevron through the
 * ApprovalRow `disclosure` prop (T20 consistency).
 *
 * The chevron must sit at the LEADING edge (before the avatar) because it is
 * passed as `disclosure`, not as the first `children`. The structural check
 * reads the data-approval-row element's child order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const { queue } = vi.hoisted(() => ({
  queue: {
    data: [
      {
        id: 's1',
        status: 'Submitted',
        week_start_date: '2026-06-01',
        owner: { full_name: 'Anita Rao' },
        entries: [
          { project_id: 'pA', entry_date: '2026-06-01', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } },
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
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <ApprovalsQueue />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  queue.isPending = false;
  queue.isError = false;
});

describe('AC-JR-W3-01: ApprovalsQueue routes disclosure chevron via disclosure prop (T20)', () => {
  it('AC-JR-W3-01: the expand chevron appears BEFORE the avatar in the approval row', () => {
    const { container } = renderPM();

    // The approval row root element is marked with data-approval-row
    const row = container.querySelector('[data-approval-row]')!;
    expect(row).not.toBeNull();

    // Children order: disclosure (chevron button) → avatar span → name div → spacer → status → actions
    const children = Array.from(row.children);

    // The disclosure button contains the expand icon and has aria-expanded
    const disclosureIdx = children.findIndex(
      (el) => el.querySelector('[aria-expanded]') !== null || el.getAttribute('aria-expanded') !== null,
    );
    // The avatar is the aria-hidden="true" span (decorative initial)
    const avatarIdx = children.findIndex(
      (el) => el.getAttribute('aria-hidden') === 'true',
    );

    expect(disclosureIdx).toBeGreaterThanOrEqual(0);
    expect(avatarIdx).toBeGreaterThanOrEqual(0);
    // disclosure must come before the avatar
    expect(disclosureIdx).toBeLessThan(avatarIdx);
  });

  it('AC-JR-W3-01: the chevron is aria-expanded=false by default and true after click', async () => {
    const { user } = { user: (await import('@testing-library/user-event')).default.setup() };
    renderPM();

    const chevron = screen.getByRole('button', { name: /show hours for Anita Rao/i });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');

    await user.click(chevron);
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
  });

  it('AC-JR-W3-01: ApprovalRow uses solid border-border (not border-dashed) consistent with procurement row', () => {
    const { container } = renderPM();
    const row = container.querySelector('[data-approval-row]')!;
    expect(row.className).not.toContain('border-dashed');
    expect(row.className).toContain('border-b');
  });

  it('AC-JR-W3-01: disclosure button is scoped inside the data-approval-row element (not outside)', () => {
    renderPM();
    const row = document.querySelector('[data-approval-row]')!;
    const chevron = within(row as HTMLElement).getByRole('button', { name: /show hours/i });
    expect(chevron).toBeInTheDocument();
  });
});
