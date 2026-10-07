import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EfakturModal } from './EfakturModal';

describe('EfakturModal', () => {
  it('AC-EFK-004 exposes labelled optional fields and saves normalized values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EfakturModal
        open
        number=""
        date={null}
        loading={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: ' 010.001-26.12345678 ' } });
    fireEvent.change(screen.getByLabelText('e-Faktur date'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      efakturNumber: '010.001-26.12345678', efakturDate: null,
    }));
  });

  it('AC-EFK-004 accepts an empty e-Faktur on non-VAT documents and prevents future dates', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EfakturModal
        open
        number={null}
        date={null}
        loading={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('Leave both fields empty for a non-VAT document.')).toBeInTheDocument();
    const date = screen.getByLabelText('e-Faktur date');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const future = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    fireEvent.change(date, { target: { value: future } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
