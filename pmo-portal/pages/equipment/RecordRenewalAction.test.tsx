import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/src/hooks/useDocumentExpiry', () => ({ useRecordRenewal: () => ({ mutateAsync: h.mutateAsync, isPending: false }) }));
import { AppError } from '@/src/lib/appError';
import RecordRenewalAction from './RecordRenewalAction';

const doc = { id: 'd1', subject_name: 'Person One', type_name: 'Work permit', expires_on: '2026-12-20' };
const renderIt = () => render(<ToastProvider><RecordRenewalAction doc={doc} /></ToastProvider>);

describe('RecordRenewalAction (AC-EXM-004)', () => {
  beforeEach(() => h.mutateAsync.mockReset().mockResolvedValue(undefined));

  it('records the new expiry date for the document', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Record renewal for Person One' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(/New expiry date/), '2027-02-10');
    await user.click(dialog.getByRole('button', { name: 'Record renewal' }));
    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalledWith({ id: 'd1', expiresOn: '2027-02-10' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks for a date before saving', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Record renewal for Person One' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record renewal' }));
    expect(await screen.findAllByText('Enter the new expiry date')).not.toHaveLength(0);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows what to do next when the database refuses (not your person)', async () => {
    const user = userEvent.setup();
    h.mutateAsync.mockRejectedValueOnce(new AppError('DXR_NOT_YOUR_PERSON: You can record renewals only for the people you manage.', '42501'));
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Record renewal for Person One' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(/New expiry date/), '2027-02-10');
    await user.click(dialog.getByRole('button', { name: 'Record renewal' }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toMatch(/only for the people you manage/));
  });
});
