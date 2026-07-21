import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axeViolations } from '../__tests__/axe';
import { EmployeeLinkConfirm } from './EmployeeLinkConfirm';
import type { ProposedEmployeeLink } from '@/src/lib/db/timesheetPush';

/**
 * P3b (OQ-TSP-10(C), the owner ruling) — the Employee-adopt-link Admin queue. A proposed link is
 * NEVER auto-confirmed; a human (Admin) confirms it via an explicit ConfirmDialog step (an identity
 * decision — re-pointing whose cost a week of ERP hours is attributed to).
 */
const LINK: ProposedEmployeeLink = {
  id: 'emp-1',
  employee_name: 'Jane Doe',
  work_email: 'jane@co.test',
  link_proposed_reason: 'unique work_email match',
  profile_id: 'profile-1',
};

describe('EmployeeLinkConfirm', () => {
  it('renders nothing when there are no proposed links (never a blocked/empty-error render)', () => {
    const { container } = render(
      <EmployeeLinkConfirm links={[]} canConfirm onConfirm={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-TSP-092(ux): an Admin (canConfirm=true) sees the proposed employee + match reason + a Confirm affordance', () => {
    render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/unique work_email match/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('AC-TSP-092(ux): a non-Admin (canConfirm=false) sees the proposed link but NO Confirm affordance', () => {
    render(<EmployeeLinkConfirm links={[LINK]} canConfirm={false} onConfirm={() => {}} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
  });

  it('OQ-TSP-10(C): clicking Confirm opens a confirm step — the link is NEVER confirmed on a single click', () => {
    const onConfirm = vi.fn();
    render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    // The confirm STEP is now showing (a dialog), but the callback has not fired yet.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('confirming the dialog calls onConfirm with the proposed link', () => {
    const onConfirm = vi.fn();
    render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button', { name: /confirm/i })[0]);
    expect(onConfirm).toHaveBeenCalledWith(LINK);
  });

  it('shows the confirming row as loading while confirmingId matches', () => {
    render(
      <EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} confirmingId="emp-1" />,
    );
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });

  it('a11y: the Admin view has no critical/serious axe violations', async () => {
    const { container } = render(
      <EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});
