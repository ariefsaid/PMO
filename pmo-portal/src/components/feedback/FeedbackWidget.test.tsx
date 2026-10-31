import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({
  enabled: true,
  live: true,
  published: 'survey-feedback' as string | null,
  show: vi.fn(),
}));
vi.mock('@/src/hooks/useFeedbackSurveys', () => ({ useFeedbackSurveysEnabled: () => h.enabled }));
vi.mock('@/src/lib/analytics', () => ({
  surveysLive: () => h.live,
  findSurvey: (_k: string, done: (id: string | null) => void) => done(h.published),
  showSurvey: (...a: unknown[]) => h.show(...a),
  buildSurveyContext: (p: string) => ({ module: 'projects', route: p }),
}));

import { FeedbackWidget } from './FeedbackWidget';

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <FeedbackWidget />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  h.enabled = true;
  h.live = true;
  h.published = 'survey-feedback';
  h.show = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('AC-PHO-095 Feedback button', () => {
  it('is always there when the org switch is on, analytics is live and the survey is published; it never opens by itself', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeInTheDocument();
    expect(h.show).not.toHaveBeenCalled();
  });

  it('opens the feedback survey beside the button with module and route context only', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }));
    expect(h.show).toHaveBeenCalledWith('survey-feedback', { module: 'projects', route: '/projects' }, '#pmo-feedback-trigger');
  });

  it.each([
    ['the org Admin switched it off', () => (h.enabled = false)],
    ['the user opted out or analytics is off', () => (h.live = false)],
    ['the survey is not published yet', () => (h.published = null)],
  ])('is absent when %s', (_n, arrange) => {
    arrange();
    mount();
    expect(screen.queryByRole('button', { name: 'Feedback' })).toBeNull();
  });

  it('keeps looking for the survey while the analytics SDK finishes starting, then appears', () => {
    h.published = null;
    mount();
    expect(screen.queryByRole('button', { name: 'Feedback' })).toBeNull();
    h.published = 'survey-feedback';
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeInTheDocument();
  });
});
