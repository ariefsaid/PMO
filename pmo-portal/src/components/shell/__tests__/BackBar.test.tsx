import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackBar } from '../BackBar';

describe('BackBar', () => {
  it('#707: phoneOnly still calls onBack (the node stays in the DOM for the phone layout)', async () => {
    const onBack = vi.fn();
    render(<BackBar label="Projects" onBack={onBack} phoneOnly />);
    await userEvent.click(screen.getByRole('button', { name: /back to projects/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
