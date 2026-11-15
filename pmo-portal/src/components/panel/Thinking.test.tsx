import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { Thinking } from './Thinking';

afterEach(cleanup);

describe('Thinking', () => {
  it('renders a live status region and uses the step label, not the neutral fallback', () => {
    render(<Thinking label="Checking your projects" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    // With a step label present, the neutral fallback copy is NOT used.
    expect(screen.queryByText('Working on your answer')).not.toBeInTheDocument();
    expect(screen.getByText(/Checking your projects/)).toBeInTheDocument();
  });

  it('falls back to "Working on your answer" with no label', () => {
    render(<Thinking label={null} />);
    expect(screen.getByText('Working on your answer')).toBeInTheDocument();
  });

  it('reveals a ticking elapsed counter after 3s (the not-stuck signal)', () => {
    vi.useFakeTimers();
    try {
      render(<Thinking label={null} />);
      // Under 3s: no counter yet (avoids clutter on fast replies).
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.queryByText(/^\d+s$/)).not.toBeInTheDocument();
      // At/after 3s: the counter appears and ticks.
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByText('4s')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-2047-A11Y-1 announces once: the status text does not change while the counter ticks', () => {
    vi.useFakeTimers();
    try {
      render(<Thinking label={null} />);
      const status = screen.getByRole('status');
      const before = status.textContent;
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(status.textContent).toBe(before);
      // The counter still ticks, but outside the live region and hidden from assistive tech.
      const counter = screen.getByText('10s');
      expect(status).not.toContainElement(counter);
      expect(counter).toHaveAttribute('aria-hidden', 'true');
    } finally {
      vi.useRealTimers();
    }
  });
});
