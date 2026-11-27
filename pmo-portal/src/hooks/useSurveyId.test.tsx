import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ findSurvey: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ findSurvey: h.findSurvey, surveysLive: () => true }));
vi.mock('@/src/hooks/useFeedbackSurveys', () => ({ useFeedbackSurveysEnabled: () => true }));

import { useSurveyId } from './useSurveyId';

describe('useSurveyId', () => {
  beforeEach(() => h.findSurvey.mockReset());

  it('looks the survey up by default', () => {
    renderHook(() => useSurveyId('nps'));
    expect(h.findSurvey).toHaveBeenCalledTimes(1);
  });

  it('does no lookup and starts no retry timer when the caller does not need the id', () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useSurveyId('nps', false));
      vi.advanceTimersByTime(20_000);
      expect(h.findSurvey).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
