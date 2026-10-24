import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Switch } from '../Switch';

describe('Switch', () => {
  it('is a named switch that reports its state and toggles with the pointer and the keyboard', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Approval required before payment" />);
    const toggle = screen.getByRole('switch', { name: 'Approval required before payment' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    toggle.focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('offers the next value, not the current one, from the on state', async () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Rule" />);
    await userEvent.click(screen.getByRole('switch', { name: 'Rule' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('a disabled switch does not toggle', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Rule" disabled />);
    await userEvent.click(screen.getByRole('switch', { name: 'Rule' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Rule' })).toBeDisabled();
  });

  it('takes its name from visible text via labelledBy and its help text via describedBy', () => {
    render(<><span id="l">Receipt required</span><span id="d">Holds invoices until a receipt exists.</span><Switch checked onChange={() => {}} labelledBy="l" describedBy="d" /></>);
    const toggle = screen.getByRole('switch', { name: 'Receipt required' });
    expect(toggle).toHaveAccessibleDescription('Holds invoices until a receipt exists.');
  });

  it.each([false, true])('has no axe violations (checked=%s, labelled and disabled variants)', async (checked) => {
    const { container } = render(<><Switch checked={checked} onChange={() => {}} label="Rule" /><Switch checked={checked} onChange={() => {}} label="Locked rule" disabled /></>);
    expect((await axe(container)).violations).toEqual([]);
  });
});
