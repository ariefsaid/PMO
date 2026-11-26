import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { formatIsoDay } from '@/src/lib/format';
import { BahasaProvider } from '@/test/bahasa';
import { MarkLeftDialog } from './MarkLeftDialog';

const h = vi.hoisted(() => ({
  markLeft: vi.fn(),
  isPending: false,
}));

vi.mock('@/src/hooks/usePeople', () => ({
  usePeopleMutations: () => ({
    markLeft: { mutateAsync: h.markLeft, isPending: h.isPending },
  }),
}));

const person = { id: 'p-100', name: 'Budi Santoso' };

const renderDialog = (p: { id: string; name: string } | null = person, onClose = vi.fn()) =>
  render(
    <ToastProvider>
      <MarkLeftDialog person={p} onClose={onClose} />
    </ToastProvider>,
  );

const renderDialogBahasa = (p: { id: string; name: string } | null = person, onClose = vi.fn()) =>
  render(
    <BahasaProvider locale="id">
      <ToastProvider>
        <MarkLeftDialog person={p} onClose={onClose} />
      </ToastProvider>
    </BahasaProvider>,
  );

/** The suite pins the formatter locale to `en`/UTC (test/setup.ts, AC-L10N-061), so the organisation's
 *  calendar day is the UTC day. Derived here independently of the dialog's own helper. */
const orgToday = () => new Date().toISOString().slice(0, 10);

/** Opens, closes and re-opens the same dialog instance, the way the People register does. */
const ReopenHarness = ({ onClose }: { onClose: () => void }) => {
  const [open, setOpen] = useState(true);
  return (
    <ToastProvider>
      <button type="button" data-testid="reopen-mark-left" onClick={() => setOpen(true)}>Reopen Mark as left</button>
      <MarkLeftDialog person={open ? person : null} onClose={() => { setOpen(false); onClose(); }} />
    </ToastProvider>
  );
};

describe('MarkLeftDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.markLeft.mockReset().mockResolvedValue(undefined);
    h.isPending = false;
  });

  it('#2814 explains the roster effect of the first day off', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Mark Budi Santoso as left' })).toBeInTheDocument();
    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });
    expect(input).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^First day off crew roster/i)).toBe(input);
    expect(input).toHaveAccessibleDescription('From this date onward, this person will no longer appear on crew rosters.');
    expect(within(dialog).queryByText(/Last day of work/i)).toBeNull();
    expect(screen.queryByText(/Last day of work/i)).toBeNull();
  });

  it('proves a concrete selected calendar date is sent unchanged to markLeft mutation', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('alertdialog');

    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });
    // The field opens on today; the admin clears it — it must stay blank, not snap back to today — and types
    // the day the person is first off the roster.
    await user.clear(input);
    expect(input).toHaveValue('');
    await user.type(input, '2026-12-15');
    // Leaving the field commits the typed day — the DateField's own documented journey — so the form
    // holds the day the admin picked, not the default it opened on.
    await user.tab();
    expect(input).toHaveValue('15 Dec 2026');

    const confirmButton = within(dialog).getByRole('button', { name: 'Mark as left' });
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    expect(h.markLeft).toHaveBeenCalledWith({
      id: 'p-100',
      leftOn: '2026-12-15',
    });
  });

  it('leaves a cleared day blank and cannot mark left until a real day is entered', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });
    const confirmButton = within(dialog).getByRole('button', { name: 'Mark as left' });

    await user.clear(input);
    expect(input).toHaveValue('');
    expect(confirmButton).toBeDisabled();
    // The confirm is natively disabled, and React drops an onClick dispatched at a disabled button
    // (react-dom getListener), so nothing is written. The dialog's own `!leftOn` guard is
    // defence-in-depth for that state and is NOT exercised by this click.
    fireEvent.click(confirmButton);
    expect(h.markLeft).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();

    // A real day makes the dialog actionable again.
    await user.type(input, '2026-12-15');
    await user.tab();
    expect(confirmButton).toBeEnabled();
  });

  it('reopens on the organisation\'s today instead of carrying an abandoned selected day', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReopenHarness onClose={onClose} />);
    const dialog = screen.getByRole('alertdialog');
    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });

    await user.clear(input);
    // A day that is provably NOT the organisation's today, so "not carried" cannot pass by coincidence
    // and the two assertions cannot contradict on the one calendar day they would otherwise collide.
    const abandonedDay = orgToday() === '2026-12-15' ? '2026-12-16' : '2026-12-15';
    await user.type(input, abandonedDay);
    await user.tab();
    expect(input).toHaveValue(formatIsoDay(abandonedDay));

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    await user.click(screen.getByTestId('reopen-mark-left'));
    const reopened = screen.getByRole('alertdialog');
    const reopenedInput = within(reopened).getByRole('textbox', { name: /^First day off crew roster/i });
    expect(reopenedInput).toHaveValue(formatIsoDay(orgToday()));
    expect(reopenedInput).not.toHaveValue(formatIsoDay(abandonedDay));
  });

  it('preserves supplied calendar date default when date is not manually changed', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });
    // Untouched, the field shows — and sends — the organisation's today, not a blank or a stale day.
    expect(input).toHaveValue(formatIsoDay(orgToday()));

    const confirmButton = within(dialog).getByRole('button', { name: 'Mark as left' });
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    expect(h.markLeft).toHaveBeenCalledWith({
      id: 'p-100',
      leftOn: orgToday(),
    });
  });

  it('renders localized truthful copy in Bahasa Indonesia', () => {
    renderDialogBahasa();
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Tandai Budi Santoso sudah keluar' })).toBeInTheDocument();
    const input = within(dialog).getByRole('textbox', { name: /^Hari pertama keluar dari susunan kru/i });
    expect(input).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Hari pertama keluar dari susunan kru/i)).toBe(input);
    expect(input).toHaveAccessibleDescription('Mulai tanggal ini, orang ini tidak lagi tercantum dalam susunan kru.');
    expect(within(dialog).queryByText(/Hari kerja terakhir/i)).toBeNull();
    expect(screen.queryByText(/Hari kerja terakhir/i)).toBeNull();
  });

  it('cancels without calling mutation and triggers onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(person, onClose);
    const dialog = screen.getByRole('alertdialog');

    const cancelButton = within(dialog).getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(h.markLeft).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays refusal message when markLeft mutation rejects', async () => {
    const user = userEvent.setup();
    h.markLeft.mockRejectedValue(new Error('PPL_NOT_FOUND: the person was not found, or has already left'));
    renderDialog();
    const dialog = screen.getByRole('alertdialog');

    const confirmButton = within(dialog).getByRole('button', { name: 'Mark as left' });
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    const inlineError = await within(dialog).findByRole('alert');
    expect(inlineError).toBeInTheDocument();
    expect(inlineError).toHaveTextContent('That person was not found, or has already left.');
    expect(dialog).toBeInTheDocument();
  });
});
