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
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mark Budi Santoso as left' })).toBeInTheDocument();
    expect(screen.getByLabelText('First day off crew roster')).toBeInTheDocument();
    expect(screen.getByText('First day off crew roster', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/Last day of work/i)).toBeNull();
  });

  it('proves a concrete selected calendar date is sent unchanged to markLeft mutation', async () => {
    const user = userEvent.setup();
    renderDialog();

    const input = screen.getByLabelText('First day off crew roster');
    await user.clear(input);
    await user.type(input, '2026-12-15');

    const confirmButton = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as left' });
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

    const confirmButton = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as left' });
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    expect(h.markLeft).toHaveBeenCalledWith({
      id: 'p-100',
      leftOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('renders localized truthful copy in Bahasa Indonesia', () => {
    renderDialogBahasa();
    expect(screen.getByRole('heading', { name: 'Tandai Budi Santoso sudah keluar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hari pertama keluar dari susunan kru')).toBeInTheDocument();
    expect(screen.queryByText(/Hari kerja terakhir/i)).toBeNull();
  });

  it('cancels without calling mutation and triggers onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(person, onClose);

    const cancelButton = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(h.markLeft).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays refusal message when markLeft mutation rejects', async () => {
    const user = userEvent.setup();
    h.markLeft.mockRejectedValue(new Error('PPL_NOT_FOUND'));
    renderDialog();

    const confirmButton = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as left' });
    await user.click(confirmButton);

    expect(h.markLeft).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
