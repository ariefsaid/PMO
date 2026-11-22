import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateTime24Field } from './DateTime24Field';

describe('DateTime24Field (AC-EQM-009 vendor response time on the 24-hour clock)', () => {
  it('offers hours 00 to 23 and no AM/PM', () => {
    render(<DateTime24Field label="Vendor responded" value="2026-09-10T14:30" onChange={vi.fn()} />);
    const hour = screen.getByRole('combobox', { name: /Hour/ });
    expect(hour).toHaveValue('14');
    expect(within(hour).getByRole('option', { name: '23' })).toBeInTheDocument();
    expect(screen.queryByText(/AM|PM/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Minute' })).toHaveValue('30');
  });

  it('keeps the value in the same YYYY-MM-DDTHH:mm form a date-time input holds', async () => {
    const onChange = vi.fn();
    render(<DateTime24Field label="Vendor responded" value="2026-09-10T14:30" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Hour/ }), '07');
    expect(onChange).toHaveBeenLastCalledWith('2026-09-10T07:30');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Minute' }), '05');
    expect(onChange).toHaveBeenLastCalledWith('2026-09-10T14:05');
  });

  it('is empty until a day is chosen', () => {
    render(<DateTime24Field label="Vendor responded" value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: /Hour/ })).toHaveValue('00');
  });
});
