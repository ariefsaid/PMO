import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../Checkbox';

describe('Checkbox (custom 16px, role=checkbox)', () => {
  it('exposes role=checkbox + aria-checked + tabindex + accessible name', () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Select row" />);
    const box = screen.getByRole('checkbox', { name: 'Select row' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box).toHaveAttribute('tabindex', '0');
  });

  it('click toggles on', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="x" />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Space toggles via keyboard', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="x" />);
    screen.getByRole('checkbox').focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('mixed renders aria-checked=mixed', () => {
    render(<Checkbox checked="mixed" onChange={() => {}} label="all" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('disabled does not toggle + is not a tab stop', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="x" disabled />);
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('tabindex', '-1');
    await userEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });
});
