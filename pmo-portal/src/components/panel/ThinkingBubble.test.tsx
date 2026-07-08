import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ThinkingBubble } from './ThinkingBubble';

afterEach(cleanup);

describe('ThinkingBubble', () => {
  it('renders a live status region and uses the step label, not the neutral fallback', () => {
    render(<ThinkingBubble label="Checking your projects" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    // With a step label present, the neutral fallback copy is NOT used.
    expect(screen.queryByText('Working on your answer')).not.toBeInTheDocument();
    expect(screen.getByText(/Checking your projects/)).toBeInTheDocument();
  });

  it('falls back to "Working on your answer" with no label', () => {
    render(<ThinkingBubble label={null} />);
    expect(screen.getByText('Working on your answer')).toBeInTheDocument();
  });

  it('reveals a ticking elapsed counter after 3s (the not-stuck signal)', () => {
    vi.useFakeTimers();
    try {
      render(<ThinkingBubble label={null} />);
      // Under 3s: no counter yet (avoids clutter on fast replies).
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.queryByText(/·\s*\d+s/)).not.toBeInTheDocument();
      // At/after 3s: the counter appears and ticks.
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByText(/·\s*4s/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
