import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  employee_number: 'HR-EMP-00087',
  work_email: 'jane@co.test',
  link_proposed_reason: 'unique work_email match',
  profile_id: 'profile-1',
  profile_name: 'Jane Q. Doe',
  profile_email: 'jane.doe@pmo.test',
};

const ACTIVE_PROFILE_OPTIONS = [
  { value: 'profile-a', label: 'Casey Reviewer · candidate-a@example.test', email: 'candidate-a@example.test' },
  { value: 'profile-b', label: 'Casey Reviewer · candidate-b@example.test', email: 'candidate-b@example.test' },
];

type EmployeeLinkConfirmWithOptionsProps = React.ComponentProps<typeof EmployeeLinkConfirm> & {
  profileOptions: typeof ACTIVE_PROFILE_OPTIONS;
};
const EmployeeLinkConfirmWithOptions = EmployeeLinkConfirm as React.ComponentType<EmployeeLinkConfirmWithOptionsProps>;

async function chooseProfile(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'PMO user to attribute hours to' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

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

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ⚑ C-6 / C-7 (rendered Discover pass, 2026-07-22) — AN IDENTITY DECISION WITH THE IDENTITY
  // WITHHELD. This component's own docstring calls re-pointing a week of ERP hours too consequential
  // to auto-confirm — and then presented the decision with the DESTINATION hidden: the dialog said
  // the hours go "to the matched PMO user" and never named that user, though `profile_id` is on the
  // row. Worse, Confirm was offered on rows identifying nobody at all (`Unknown employee` / `No
  // email`) while `employee_number` — the one stable identifier — was fetched and never shown.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('C-6/C-7 — both parties to the link are named, or there is no decision to make', () => {
    it('C-7 the card names the ERP employee AND its stable employee number', () => {
      render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />);
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText(/HR-EMP-00087/)).toBeInTheDocument();
    });

    it('C-6 the card names the PMO USER the hours would be attributed to', () => {
      render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />);
      expect(screen.getByText(/Jane Q\. Doe/)).toBeInTheDocument();
    });

    it('C-6 the DIALOG names both parties — the decision is made there, so the facts belong there', () => {
      render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getAllByText(/Jane Doe/).length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText(/Jane Q\. Doe/).length).toBeGreaterThan(0);
      expect(within(dialog).queryByText(/the matched PMO user/i)).not.toBeInTheDocument();
    });

    it('C-7 WITHHOLDS Confirm when the ERP side identifies nobody, and says why', () => {
      const anonymous: ProposedEmployeeLink = {
        ...LINK,
        employee_name: null,
        employee_number: null,
        work_email: null,
      };
      render(<EmployeeLinkConfirm links={[anonymous]} canConfirm onConfirm={() => {}} />);
      expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
      expect(screen.getByText(/cannot be confirmed/i)).toBeInTheDocument();
    });

    it('C-6 WITHHOLDS Confirm when the PMO side identifies nobody', () => {
      const noDestination: ProposedEmployeeLink = { ...LINK, profile_id: null, profile_name: null, profile_email: null };
      render(<EmployeeLinkConfirm links={[noDestination]} canConfirm onConfirm={() => {}} />);
      expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
      expect(screen.getByText(/cannot be confirmed/i)).toBeInTheDocument();
    });

    it('C-7 an employee number alone is enough to identify the ERP side', () => {
      const numberOnly: ProposedEmployeeLink = { ...LINK, employee_name: null, work_email: null };
      render(<EmployeeLinkConfirm links={[numberOnly]} canConfirm onConfirm={() => {}} />);
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
      expect(screen.getAllByText(/HR-EMP-00087/).length).toBeGreaterThan(0);
    });

    it('AC-S30-001: blank and whitespace-only ERP identity facts withhold confirmation', () => {
      const blankIdentity: ProposedEmployeeLink = {
        ...LINK,
        employee_name: '   ',
        employee_number: '',
        work_email: '\t ',
      };
      render(<EmployeeLinkConfirm links={[blankIdentity]} canConfirm onConfirm={() => {}} />);
      expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
      expect(screen.getByText(/cannot be confirmed/i)).toBeInTheDocument();
    });

    it('AC-S30-001: blank PMO identity facts withhold confirmation', () => {
      const blankDestination: ProposedEmployeeLink = {
        ...LINK,
        profile_name: '  ',
        profile_email: '\t ',
      };
      render(<EmployeeLinkConfirm links={[blankDestination]} canConfirm onConfirm={() => {}} />);
      expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
      expect(screen.getByText(/cannot be confirmed/i)).toBeInTheDocument();
    });

    it('AC-S30-001: a blank ERP display name falls back to the employee number in the decision title', () => {
      const unnamed: ProposedEmployeeLink = {
        ...LINK,
        employee_name: '  ',
        employee_number: 'WORKER-021',
        work_email: null,
      };
      render(<EmployeeLinkConfirm links={[unnamed]} canConfirm onConfirm={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
      expect(screen.getByRole('dialog')).toHaveTextContent("Attribute WORKER-021's hours");
    });
  });

  it('a11y: the Admin view has no critical/serious axe violations', async () => {
    const { container } = render(
      <EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});

describe('EmployeeLinkConfirm deliberate alternate identity (AC-S30-001/002)', () => {
  const unlinked: ProposedEmployeeLink = {
    ...LINK,
    id: 'emp-unlinked-synthetic',
    employee_name: 'Synthetic ERP Worker',
    employee_number: 'WORKER-017',
    work_email: 'worker-017@example.test',
    link_proposed_reason: 'No confident PMO match was found',
    profile_id: null,
    profile_name: null,
    profile_email: null,
  };

  it('AC-S30-001: names the alternate identity before explicit confirmation and sends the exact selected profile', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async (_link: ProposedEmployeeLink) => {});
    render(
      <EmployeeLinkConfirmWithOptions
        links={[unlinked]}
        canConfirm
        profileOptions={ACTIVE_PROFILE_OPTIONS}
        onConfirm={onConfirm}
      />,
    );

    await chooseProfile(user, 'Casey Reviewer · candidate-b@example.test');
    expect(screen.getByText(/Hours would be attributed to/)).toHaveTextContent(/Casey Reviewer/);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Synthetic ERP Worker');
    expect(dialog).toHaveTextContent('Casey Reviewer');
    expect(dialog).toHaveTextContent('candidate-b@example.test');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm link' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      ...unlinked,
      profile_id: 'profile-b',
      profile_name: 'Casey Reviewer',
      profile_email: 'candidate-b@example.test',
    }));
  });

  it('AC-S30-001: lets an Admin replace a wrong proposed identity with another eligible profile', async () => {
    const user = userEvent.setup();
    const proposedLink: ProposedEmployeeLink = {
      ...LINK,
      id: 'emp-wrong-proposal',
      employee_name: 'Synthetic ERP Worker',
      employee_number: 'WORKER-018',
      work_email: 'worker-018@example.test',
      profile_id: 'profile-current',
      profile_name: 'Wrong Candidate',
      profile_email: 'wrong-candidate@example.test',
    };
    const onConfirm = vi.fn(async (_link: ProposedEmployeeLink) => {});
    render(
      <EmployeeLinkConfirmWithOptions
        links={[proposedLink]}
        canConfirm
        profileOptions={ACTIVE_PROFILE_OPTIONS}
        onConfirm={onConfirm}
      />,
    );

    await chooseProfile(user, 'Casey Reviewer · candidate-b@example.test');
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Synthetic ERP Worker');
    expect(dialog).toHaveTextContent('Casey Reviewer');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm link' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      ...proposedLink,
      profile_id: 'profile-b',
      profile_name: 'Casey Reviewer',
      profile_email: 'candidate-b@example.test',
    }));
  });

  it('AC-S30-002: keeps the selected candidate through failure and cancel/reopen, blocks double-submit, then closes on retry success', async () => {
    const user = userEvent.setup();
    let resolveRetry: (() => void) | undefined;
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error('synthetic conflict'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRetry = resolve; }));
    render(
      <EmployeeLinkConfirmWithOptions
        links={[unlinked]}
        canConfirm
        profileOptions={ACTIVE_PROFILE_OPTIONS}
        onConfirm={onConfirm}
      />,
    );

    await chooseProfile(user, 'Casey Reviewer · candidate-a@example.test');
    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't confirm this employee link/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'PMO user to attribute hours to' })).toHaveTextContent('candidate-a@example.test');

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'PMO user to attribute hours to' })).toHaveTextContent('candidate-a@example.test');
    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));

    const retry = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm link' });
    await user.click(retry);
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ profile_id: 'profile-a' }));
    resolveRetry?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('AC-S30-001: withholds confirmation when the active candidate set is empty', () => {
    render(
      <EmployeeLinkConfirmWithOptions
        links={[unlinked]}
        canConfirm
        profileOptions={[]}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Confirm$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no active PMO profiles are available/i)).toBeInTheDocument();
  });

  it('AC-S30-001: withholds alternate confirmation when the ERP employee has no identity', () => {
    const unidentified: ProposedEmployeeLink = {
      ...unlinked,
      employee_name: null,
      employee_number: null,
      work_email: null,
    };
    const onConfirm = vi.fn();
    render(
      <EmployeeLinkConfirmWithOptions
        links={[unidentified]}
        canConfirm
        profileOptions={ACTIVE_PROFILE_OPTIONS}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'PMO user to attribute hours to' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/this link cannot be confirmed/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('AC-S30-002: blocks a selected identity that leaves the active candidate set before confirmation', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async (_link: ProposedEmployeeLink) => {});
    const view = render(
      <EmployeeLinkConfirmWithOptions
        links={[unlinked]}
        canConfirm
        profileOptions={ACTIVE_PROFILE_OPTIONS}
        onConfirm={onConfirm}
      />,
    );

    await chooseProfile(user, 'Casey Reviewer · candidate-a@example.test');
    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));
    view.rerender(
      <EmployeeLinkConfirmWithOptions
        links={[unlinked]}
        canConfirm
        profileOptions={[ACTIVE_PROFILE_OPTIONS[1]]}
        onConfirm={onConfirm}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Casey Reviewer');
    expect(dialog).toHaveTextContent('candidate-a@example.test');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/selected PMO profile is no longer active/i);
    const confirm = within(dialog).getByRole('button', { name: 'Confirm link' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/**
 * ⚑ NEW-7 / NEW-8 (rendered re-verification, 2026-07-22) — an identity decision must not look like a
 * bug in the very fact it asks you to trust. With no `employee_name` on record, the ERP identity falls
 * back to the employee NUMBER — and both the card and the dialog then printed that number twice, e.g.
 * "ERP employee HR-EMP-00112 (HR-EMP-00112) will have their ERP timesheet hours attributed to…". On an
 * irreversible attribution dialog that reads as a defect, and it costs the operator confidence exactly
 * where confidence is the whole point of the step.
 */
describe('EmployeeLinkConfirm — an identity is stated once (NEW-7/NEW-8)', () => {
  const NUMBER_ONLY: ProposedEmployeeLink = {
    ...LINK,
    id: 'emp-2',
    employee_name: null,
    employee_number: 'HR-EMP-00112',
    work_email: null,
  };

  const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it('NEW-8 the CARD states the employee number once, not as both its title and its detail line', () => {
    const { container } = render(<EmployeeLinkConfirm links={[NUMBER_ONLY]} canConfirm onConfirm={() => {}} />);
    expect(occurrences(container.textContent ?? '', 'HR-EMP-00112')).toBe(1);
  });

  it('NEW-7 the DIALOG names the employee once — never "HR-EMP-00112 (HR-EMP-00112)"', () => {
    render(<EmployeeLinkConfirm links={[NUMBER_ONLY]} canConfirm onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent ?? '').not.toContain('HR-EMP-00112 (HR-EMP-00112)');
    // …and the number is still THERE — de-duplicating must not remove the only identifier on screen.
    expect(dialog.textContent ?? '').toContain('HR-EMP-00112');
  });

  it('NEW-7 a NAMED employee still gets its number as the disambiguator — the fix is de-duplication, not removal', () => {
    render(<EmployeeLinkConfirm links={[LINK]} canConfirm onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent ?? '').toContain('Jane Doe (HR-EMP-00087)');
  });
});
