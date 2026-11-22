import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
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

describe('MarkLeftDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.markLeft.mockReset().mockResolvedValue(undefined);
    h.isPending = false;
  });

  it('renders truthful label and helper stating first day off crew roster, not Last day of work', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Mark Budi Santoso as left' })).toBeInTheDocument();
    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });
    expect(input).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^First day off crew roster/i)).toBe(input);
    expect(input).toHaveAccessibleDescription('First day off crew roster');
    expect(within(dialog).queryByText(/Last day of work/i)).toBeNull();
    expect(screen.queryByText(/Last day of work/i)).toBeNull();
  });

  it('proves a concrete selected calendar date is sent unchanged to markLeft mutation', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('alertdialog');

    const input = within(dialog).getByRole('textbox', { name: /^First day off crew roster/i });
    // The field opens on today; the admin replaces it with the day the person is first off the roster.
    await user.clear(input);
    expect(input).toHaveValue('');
    await user.type(input, '2026-12-15');
    // Leaving the field commits the typed day — the DateField's own documented journey — so the form
    // holds the day the admin picked, not the default it opened on.
    await user.tab();
    expect(input).toHaveValue('15 Dec 2026');

    const confirmButton = within(dialog).getByRole('button', { name: 'Mark as left' });
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    expect(h.markLeft).toHaveBeenCalledWith({
      id: 'p-100',
      leftOn: '2026-12-15',
    });
  });

  it('preserves supplied calendar date default when date is not manually changed', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('alertdialog');

    const confirmButton = within(dialog).getByRole('button', { name: 'Mark as left' });
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    expect(h.markLeft).toHaveBeenCalledWith({
      id: 'p-100',
      leftOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('renders localized truthful copy in Bahasa Indonesia', () => {
    renderDialogBahasa();
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Tandai Budi Santoso sudah keluar' })).toBeInTheDocument();
    const input = within(dialog).getByRole('textbox', { name: /^Hari pertama keluar dari susunan kru/i });
    expect(input).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Hari pertama keluar dari susunan kru/i)).toBe(input);
    expect(input).toHaveAccessibleDescription('Hari pertama keluar dari susunan kru');
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
