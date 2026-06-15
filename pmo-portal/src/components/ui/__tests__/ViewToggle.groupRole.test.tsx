/**
 * AC-W2-10-01: ViewToggle `semantics="toggle"` uses role="group" + aria-pressed,
 * not role="tab"/aria-selected. Default (no semantics prop) still renders tablist behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewToggle } from '../ViewToggle';

const opts = [
  { value: 'count', label: 'By count', testId: 'toggle-count' },
  { value: 'value', label: 'By value', testId: 'toggle-value' },
];

describe('ViewToggle group semantics (W2-10)', () => {
  it('AC-W2-10-01: semantics="toggle" renders role="group" container + aria-pressed on buttons (no role="tab")', () => {
    render(
      <ViewToggle
        options={opts}
        value="count"
        onChange={() => {}}
        ariaLabel="Win-rate basis"
        semantics="toggle"
      />,
    );

    // Container is a group, not a tablist
    expect(screen.getByRole('group', { name: 'Win-rate basis' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    // Selected option has aria-pressed="true", NOT role="tab"
    const countBtn = screen.getByTestId('toggle-count');
    expect(countBtn).toHaveAttribute('aria-pressed', 'true');
    expect(countBtn).not.toHaveAttribute('role', 'tab');
    expect(countBtn).not.toHaveAttribute('aria-selected');

    // Unselected option has aria-pressed="false"
    const valueBtn = screen.getByTestId('toggle-value');
    expect(valueBtn).toHaveAttribute('aria-pressed', 'false');
    expect(valueBtn).not.toHaveAttribute('role', 'tab');
  });

  it('default (no semantics prop) still renders role="tablist" + role="tab" + aria-selected (regression guard)', () => {
    render(
      <ViewToggle
        options={opts}
        value="count"
        onChange={() => {}}
        ariaLabel="View"
      />,
    );

    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'By count' })).toHaveAttribute('aria-selected', 'true');
  });

  it('semantics="toggle" onChange fires on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ViewToggle
        options={opts}
        value="count"
        onChange={onChange}
        ariaLabel="Win-rate basis"
        semantics="toggle"
      />,
    );

    await user.click(screen.getByTestId('toggle-value'));
    expect(onChange).toHaveBeenCalledWith('value');
  });
});
