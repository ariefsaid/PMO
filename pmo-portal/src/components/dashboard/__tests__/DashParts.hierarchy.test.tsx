import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WaitsOnYou } from '../DashParts';

describe('WaitsOnYou hierarchy', () => {
  it('uses the waiting surface and a key figure for each count', () => {
    render(
      <MemoryRouter>
        <WaitsOnYou rows={[
          { id: 'approvals', count: 14, label: 'approvals to review', href: '/approvals', tone: 'warn' },
          { id: 'late', count: 2, label: 'tasks overdue', href: '/my-tasks', tone: 'lost' },
        ]} />
      </MemoryRouter>,
    );

    const block = screen.getByTestId('waits-on-you');
    expect(block).toHaveClass('bg-waiting-surface');
    for (const count of ['14', '2']) {
      const figure = within(block).getByText(count);
      expect(figure).toHaveClass('text-metric', 'font-semibold', 'tabular');
    }
  });
});
