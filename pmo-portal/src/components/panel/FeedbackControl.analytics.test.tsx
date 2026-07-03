import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

const mockTrackAgentFeedbackRated = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/analytics', () => ({ trackAgentFeedbackRated: mockTrackAgentFeedbackRated }));

import { FeedbackControl } from './FeedbackControl';

beforeEach(() => { mockTrackAgentFeedbackRated.mockClear(); });

describe('FeedbackControl analytics', () => {
  it('AC-APH-011 agent_feedback_rated fires with rating only on thumbs-up', () => {
    render(<FeedbackControl eventId="evt-1" onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good response' }));
    expect(mockTrackAgentFeedbackRated).toHaveBeenCalledWith('up', undefined);
  });

  it('AC-APH-012 agent_feedback_rated fires with rating and reason on thumbs-down', () => {
    render(<FeedbackControl eventId="evt-1" onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bad response' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wrong tool' }));
    expect(mockTrackAgentFeedbackRated).toHaveBeenCalledWith('down', 'wrong_tool');
  });

  it('does not include eventId or run_id in the analytics call', () => {
    render(<FeedbackControl eventId="evt-1" onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good response' }));
    const args = mockTrackAgentFeedbackRated.mock.calls[0];
    expect(args).toEqual(['up', undefined]);
    expect(args).not.toContain('evt-1');
  });
});
