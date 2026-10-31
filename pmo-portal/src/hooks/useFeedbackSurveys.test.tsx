import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const state = vi.hoisted(() => ({ demoMode: false, features: {} as Record<string, boolean | undefined> }));
vi.mock('@/src/lib/analytics/config', () => ({ getAnalyticsConfig: () => ({ demoMode: state.demoMode }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: state.features }) }));

import { useFeedbackSurveysEnabled } from './useFeedbackSurveys';

beforeEach(() => {
  state.demoMode = false;
  state.features = {};
});

describe('AC-PHO-101 useFeedbackSurveysEnabled', () => {
  it('a real org with no stored row is on (absence = included)', () => {
    expect(renderHook(() => useFeedbackSurveysEnabled()).result.current).toBe(true);
  });
  it('a real org whose Admin switched it off is off', () => {
    state.features = { feedback_surveys: false };
    expect(renderHook(() => useFeedbackSurveysEnabled()).result.current).toBe(false);
  });
  it('the demo deployment is on whatever the row says', () => {
    state.demoMode = true;
    state.features = { feedback_surveys: false };
    expect(renderHook(() => useFeedbackSurveysEnabled()).result.current).toBe(true);
  });
});
