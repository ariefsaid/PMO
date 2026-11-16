/**
 * DateField — behaviour and accessibility only: what a person types is read, an ISO day goes out,
 * the calendar opens and closes from the keyboard, and a phone gets the system date picker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { DateField } from './DateField';
import { BahasaProvider } from '@/test/bahasa';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const Harness: React.FC<{ initial?: string; onValue?: (v: string) => void; min?: string; max?: string }> = ({ initial = '', onValue, min, max }) => {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="Date"
      value={value}
      min={min}
      max={max}
      onChange={(v) => { setValue(v); onValue?.(v); }}
    />
  );
};

const field = () => screen.getByLabelText('Date') as HTMLInputElement;
const day = (iso: string) => document.querySelector<HTMLButtonElement>(`button[data-day="${iso}"]`);

const stubPointer = (coarse: boolean) => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('pointer: coarse') ? coarse : true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return () => { window.matchMedia = original; };
};

afterEach(() => vi.restoreAllMocks());

describe('DateField (desktop)', () => {
  it('shows an ISO value the way screen rules write dates', () => {
    render(<Harness initial="2026-11-16" />);
    expect(field()).toHaveValue('16 Nov 2026');
  });

  it('shows month names in the app language', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    render(<BahasaProvider><Harness initial="2026-08-17" /></BahasaProvider>);
    expect(field()).toHaveValue('17 Agu 2026');
    expect(screen.getByRole('button', { name: 'Buka kalender' })).toBeInTheDocument();
  });

  it.each(['16 Nov 2026', '16/11/2026', '16-11-2026', '2026-11-16'])('reads %s and sends the ISO day on blur', async (typed) => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(field(), typed);
    await user.tab();
    expect(onValue).toHaveBeenLastCalledWith('2026-11-16');
    expect(field()).toHaveValue('16 Nov 2026');
  });

  it('reads a Bahasa Indonesia month name', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(field(), '17 Agu 2026');
    await user.tab();
    expect(onValue).toHaveBeenLastCalledWith('2026-08-17');
  });

  it('commits a filled ISO day at once, as a scripted journey fills it', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(field(), { target: { value: '2026-11-16' } });
    expect(onValue).toHaveBeenCalledWith('2026-11-16');
  });

  it('commits on Enter', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(field(), '16/11/2026{Enter}');
    expect(onValue).toHaveBeenLastCalledWith('2026-11-16');
  });

  it('does not send a half-typed date', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(field(), '16 Nov 20');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('shows the field error for text it cannot read and keeps the last valid value', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2026-11-16" onValue={onValue} />);
    await user.clear(field());
    onValue.mockClear();
    await user.type(field(), 'next tuesday');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a date like 16 Nov 2026');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(onValue).not.toHaveBeenCalledWith('next tuesday');
    // Enter on unreadable text must not submit the surrounding form.
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={submit}><DateField label="Other" value="" onChange={() => {}} /></form>);
    const other = screen.getByLabelText('Other');
    await user.type(other, 'nope{Enter}');
    expect(submit).not.toHaveBeenCalled();
  });

  it('clears the date when the text is emptied', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2026-11-16" onValue={onValue} />);
    await user.clear(field());
    expect(onValue).toHaveBeenLastCalledWith('');
  });

  it('keeps its accessible name and marks a required field', () => {
    render(<DateField label="Due date" value="" onChange={() => {}} required />);
    const input = screen.getByLabelText(/Due date/);
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getAllByLabelText(/Due date/)).toHaveLength(1);
  });

  it('opens the calendar from the button, marks today, starts weeks on Monday and picks a day', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2026-11-16" onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await waitFor(() => expect(day('2026-11-16')).not.toBeNull());
    expect(document.querySelector('thead th')).toHaveAttribute('aria-label', 'Monday');
    await user.click(day('2026-11-20')!);
    expect(onValue).toHaveBeenLastCalledWith('2026-11-20');
    expect(field()).toHaveValue('20 Nov 2026');
    await waitFor(() => expect(day('2026-11-20')).toBeNull());
  });

  it('marks today in the calendar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await waitFor(() => expect(document.querySelector('[data-today="true"]')).not.toBeNull());
  });

  it('disables days outside min and max', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2026-11-16" min="2026-11-10" max="2026-11-20" onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await waitFor(() => expect(day('2026-11-16')).not.toBeNull());
    expect(day('2026-11-09')).toBeDisabled();
    expect(day('2026-11-21')).toBeDisabled();
    expect(day('2026-11-15')).not.toBeDisabled();
  });

  it('closes on Escape and returns focus to the field', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-11-16" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await waitFor(() => expect(day('2026-11-16')).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(day('2026-11-16')).toBeNull());
    expect(field()).toHaveFocus();
  });

  it('moves with the arrow keys and picks with Enter', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2026-11-16" onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await waitFor(() => expect(day('2026-11-16')).toHaveFocus());
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(day('2026-11-17')).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(onValue).toHaveBeenLastCalledWith('2026-11-17');
    await waitFor(() => expect(field()).toHaveFocus());
  });
});

describe('DateField (phone)', () => {
  it('renders the operating system date input, with the same label and an ISO value', () => {
    const restore = stubPointer(true);
    try {
      const onValue = vi.fn();
      render(<Harness initial="2026-11-16" onValue={onValue} />);
      expect(field()).toHaveAttribute('type', 'date');
      expect(field()).toHaveValue('2026-11-16');
      expect(screen.queryByRole('button', { name: 'Open calendar' })).toBeNull();
      fireEvent.change(field(), { target: { value: '2026-12-01' } });
      expect(onValue).toHaveBeenLastCalledWith('2026-12-01');
    } finally {
      restore();
    }
  });
});
