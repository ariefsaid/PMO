import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DeliveryPctChip } from '../DeliveryPctChip';

describe('DeliveryPctChip (AC-DEL-013)', () => {
  it('AC-DEL-013: a project with no delivery % (null) renders nothing', () => {
    const { container } = render(<DeliveryPctChip pct={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a mini-bar + value pair when pct=32', () => {
    const { container } = render(<DeliveryPctChip pct={32} />);
    expect(screen.getByText('32%')).toBeInTheDocument();
    const summary = screen.getByLabelText('Delivery 32%');
    expect(summary).toBeInTheDocument();
    expect(container.querySelector('[class*="h-1.5"][class*="w-12"]')).not.toBeNull();
  });

  it('rounds fractional pct to nearest integer', () => {
    render(<DeliveryPctChip pct={67.7} />);
    expect(screen.getByText('68%')).toBeInTheDocument();
  });
});
