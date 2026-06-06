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
});
