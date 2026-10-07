import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EfakturModal } from './EfakturModal';

describe('EfakturModal', () => {
  it('AC-EFK-004 exposes labelled optional fields and saves normalized values, number and date together', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EfakturModal
        recordLabel="SI-2610070001"
        number=""
        date={null}
        loading={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: ' 010.001-26.12345678 ' } });
    fireEvent.change(screen.getByLabelText('e-Faktur date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      efakturNumber: '010.001-26.12345678', efakturDate: '2026-10-01',
    }));
  });

  it('AC-EFK-004 accepts an empty e-Faktur on non-VAT documents and prevents future dates', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EfakturModal
        recordLabel="SI-2610070001"
        number={null}
        date={null}
        loading={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    // the subtitle names the record being edited and states the both-or-neither rule
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'For SI-2610070001. Record the number and its date together, or leave both empty for a non-VAT document.',
    );
    const date = screen.getByLabelText('e-Faktur date');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const future = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: '010-01' } });
    fireEvent.change(date, { target: { value: future } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-EFK-004 bounds the controls: number at 32 characters, date picker at the local today', () => {
    render(
      <EfakturModal
        recordLabel="SI-2610070001"
        number="010-01"
        date="2026-10-01"
        loading={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(screen.getByLabelText('e-Faktur number')).toHaveAttribute('maxLength', '32');
    expect(screen.getByLabelText('e-Faktur number')).toHaveAttribute('placeholder', '010.000-26.12345678');
    expect(screen.getByLabelText('e-Faktur number')).toHaveValue('010-01');
    expect(screen.getByLabelText('e-Faktur date')).toHaveAttribute('max', today);
    expect(screen.getByLabelText('e-Faktur date')).toHaveValue('2026-10-01');
  });

  it('DD-EFK-2 refuses a number without its date (and a date without its number) inline, naming why Save is off', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EfakturModal recordLabel="VI-1" number={null} date={null} loading={false} onClose={vi.fn()} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: '010-01' } });
    expect(screen.getByLabelText('e-Faktur date')).toHaveAccessibleDescription(
      expect.stringContaining('Enter the e-Faktur date as well'),
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('Fix the highlighted e-Faktur value to save.');
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('e-Faktur date'), { target: { value: '2026-10-01' } });
    expect(screen.getByLabelText('e-Faktur number')).toHaveAccessibleDescription(
      expect.stringContaining('Enter the e-Faktur number as well'),
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it.each([
    ['efaktur-incomplete', 'Record the e-Faktur number and its date together.'],
    ['efaktur-cancelled', 'This invoice has been cancelled, so its e-Faktur can no longer be recorded. The list has been refreshed.'],
    ['efaktur-future-date', 'The e-Faktur date cannot be in the future.'],
  ])('AC-EFK-004 maps the server refusal %s to its own message in the dialog', async (details, message) => {
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('raw server text'), { code: '23514', details }));
    render(
      <EfakturModal recordLabel="VI-1" number="010-01" date="2026-10-01" loading={false} onClose={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert', { name: 'Save failed' });
    expect(within(alert).getByText('e-Faktur not saved')).toBeInTheDocument();
    expect(within(alert).getByText(message)).toBeInTheDocument();
    expect(within(alert).queryByText('raw server text')).not.toBeInTheDocument();
  });

  it('AC-EFK-004 a dirty Cancel asks with e-Faktur-specific discard copy', () => {
    const onClose = vi.fn();
    render(
      <EfakturModal recordLabel="VI-1" number={null} date={null} loading={false} onClose={onClose} onSave={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: '010' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard these e-Faktur details?')).toBeInTheDocument();
    expect(screen.getByText('The number and date you entered will not be saved.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
