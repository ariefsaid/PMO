import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewToggle } from '../ViewToggle';

const opts = [
  { value: 'table', label: 'Table' },
  { value: 'kanban', label: 'Board' },
  { value: 'cards', label: 'Cards' },
];

describe('ViewToggle (segmented control)', () => {
  it('renders a tablist with one tab per option', () => {
    render(<ViewToggle options={opts} value="table" onChange={() => {}} ariaLabel="View" />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the active option aria-selected + on-classes', () => {
    render(<ViewToggle options={opts} value="kanban" onChange={() => {}} ariaLabel="View" />);
    const active = screen.getByRole('tab', { name: 'Board' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active.className).toContain('bg-background');
    expect(active.className).toContain('font-semibold');
  });

  it('calls onChange with the clicked value', async () => {
    const onChange = vi.fn();
    render(<ViewToggle options={opts} value="table" onChange={onChange} ariaLabel="View" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Cards' }));
    expect(onChange).toHaveBeenCalledWith('cards');
  });

  it('ArrowRight moves selection to the next option', async () => {
    const onChange = vi.fn();
    render(<ViewToggle options={opts} value="table" onChange={onChange} ariaLabel="View" />);
    const first = screen.getByRole('tab', { name: 'Table' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('kanban');
  });

  it('renders a trailing count badge when provided', () => {
    render(
      <ViewToggle
        options={[{ value: 'queue', label: 'Queue', count: 4 }]}
        value="queue"
        onChange={() => {}}
        ariaLabel="Mode"
      />
    );
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('wrapperClassName wraps the option button without adding display to the button (A-MIN-1 clsx-safe hide)', () => {
    // This is the fix for A-MIN-1 / AC-MOB-VT-002: optionClassName cannot safely hide an
    // option because cn() is clsx-only and the base `inline-flex` on the button wins over
    // `hidden`. wrapperClassName puts the hide on a <span> that has no competing display class.
    render(
      <ViewToggle
        options={[
          { value: 'table', label: 'Table', wrapperClassName: 'hidden md:block' },
          { value: 'cards', label: 'Cards' },
        ]}
        value="cards"
        onChange={() => {}}
        ariaLabel="View"
      />
    );
    const tableBtn = screen.getByRole('tab', { name: 'Table' });
    // The button itself must NOT carry 'hidden' — that would conflict with its base inline-flex.
    expect(tableBtn.className).not.toContain('hidden');
    // The wrapper element (parentElement) must carry 'hidden' + the md: restore.
    const wrapper = tableBtn.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain('hidden');
    expect(wrapper!.className).toContain('md:block');
    // The button's parent must not be the tablist itself.
    const tablist = screen.getByRole('tablist', { name: 'View' });
    expect(wrapper).not.toBe(tablist);
  });
});
