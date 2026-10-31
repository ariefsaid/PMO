import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

type Analytics = typeof import('@/src/lib/analytics');
const ask = vi.hoisted(() => vi.fn<Analytics['askWhatWentWrong']>());
vi.mock('@/src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<Analytics>()),
  trackAgentFeedbackRated: vi.fn(),
  askWhatWentWrong: ask,
}));

import { FeedbackControl } from './FeedbackControl';

beforeEach(() => ask.mockClear());

describe('AC-PHO-097 thumbs-down asks one optional "what went wrong?"', () => {
  it('after the reason is picked it asks, anchored beside this answer and tied to its run', () => {
    render(<FeedbackControl eventId="evt-1" runId="run-1" onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bad response' }));
    expect(ask).not.toHaveBeenCalled(); // choosing "Bad" alone asks nothing: the reason picker comes first
    fireEvent.click(screen.getByRole('button', { name: 'Wrong tool' }));
    expect(ask).toHaveBeenCalledTimes(1);
    const [runId, anchor] = ask.mock.calls[0];
    expect(runId).toBe('run-1');
    expect(document.querySelector(anchor)).not.toBeNull();
  });

  it('never asks on a thumbs-up', () => {
    render(<FeedbackControl eventId="evt-1" runId="run-1" onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good response' }));
    expect(ask).not.toHaveBeenCalled();
  });
});
