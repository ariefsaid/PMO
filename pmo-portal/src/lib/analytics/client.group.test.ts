// @vitest-environment jsdom
// Plans S4 (FR-PLN-016) — the consent-gated PostHog group registration.
//
// The plan is a GROUP property (`posthog.group('organisation', orgId, { plan })`), not an event
// property: that is what makes every later event sliceable by plan. It obeys the SAME consent gate as
// every other capture — this suite pins the gate, because a group created for an opted-out browser
// would be an analytics leak that no event-level test would catch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsConfig } from './config';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  group: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

import { analyticsClient } from './client';
import { ORG_GROUP_TYPE } from '@/src/hooks/useOrgPlanGroup';

const base: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  replayAndAutocapture: false,
  posthogKey: 'ph_test',
  posthogHost: 'https://us.i.posthog.com',
  appEnv: 'test',
  isProd: false,
  demoAudience: 'internal',
  demoAccount: 'local',
};

beforeEach(() => {
  posthog.init.mockReset();
  posthog.group.mockReset();
  analyticsClient.__resetForTests();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('analyticsClient.group — FR-PLN-016', () => {
  it('registers the organisation group with its plan once analytics is live', () => {
    analyticsClient.init(base);
    analyticsClient.group(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' });
    expect(posthog.group).toHaveBeenCalledTimes(1);
    expect(posthog.group).toHaveBeenCalledWith('organisation', 'org-1', { plan: 'growth' });
  });

  it('registers nothing before init (analytics not live)', () => {
    analyticsClient.group(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' });
    expect(posthog.group).not.toHaveBeenCalled();
  });

  it('registers nothing when the deployment disables analytics', () => {
    analyticsClient.init({ ...base, enabled: false });
    analyticsClient.group(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' });
    expect(posthog.group).not.toHaveBeenCalled();
  });

  it('registers nothing after the user opts out (no group for a non-consenting browser)', () => {
    analyticsClient.init(base);
    analyticsClient.optOut();
    analyticsClient.group(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' });
    expect(posthog.group).not.toHaveBeenCalled();
  });

  it('registers again after the user opts back in', () => {
    analyticsClient.init(base);
    analyticsClient.optOut();
    analyticsClient.optIn();
    analyticsClient.group(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' });
    expect(posthog.group).toHaveBeenCalledWith('organisation', 'org-1', { plan: 'growth' });
  });
});
