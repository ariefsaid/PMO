import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StackedBar } from './StackedBar';

describe('project stacked bar', () => {
  it('shows the name and value of a slice too narrow for an on-bar label', () => {
    render(<StackedBar
      ariaLabel="Tasks by status"
      otherLabel="Other"
      segments={[
        { key: 'done', label: 'Done', value: 19, display: '19' },
        { key: 'blocked', label: 'Blocked', value: 1, display: '1', accent: true },
      ]}
    />);

    const legend = screen.getByRole('img', { name: 'Tasks by status legend: Blocked' });
    expect(legend).toBeVisible();
    expect(legend).toHaveTextContent('Blocked');
  });
});
