import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackBar } from '../BackBar';

describe('BackBar', () => {
  it('#707: default renders an always-visible bar (no responsive hide classes)', () => {
    render(<BackBar label="Projects" onBack={() => {}} />);
    const bar = screen.getByRole('button', { name: /back to projects/i }).parentElement!;
    expect(bar.className.split(/\s+/)).toContain('flex');
    expect(bar.className).not.toContain('hidden');
  });

  it('#707: phoneOnly hides the bar by default and shows it at <=920px only', () => {
    render(<BackBar label="Projects" onBack={() => {}} phoneOnly />);
    const bar = screen.getByRole('button', { name: /back to projects/i }).parentElement!;
    expect(bar.className).toContain('hidden');
    expect(bar.className).toContain('max-[920px]:flex');
    // A bare `flex` would override `hidden` and show the bar on desktop.
    expect(bar.className.split(/\s+/)).not.toContain('flex');
  });

  it('#707: phoneOnly still calls onBack (the node stays in the DOM for the phone layout)', async () => {
    const onBack = vi.fn();
    render(<BackBar label="Projects" onBack={onBack} phoneOnly />);
    await userEvent.click(screen.getByRole('button', { name: /back to projects/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
