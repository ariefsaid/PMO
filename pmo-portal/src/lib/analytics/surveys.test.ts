import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  surveys: { find: vi.fn(), canRender: vi.fn(), show: vi.fn(), onCaptured: vi.fn() },
  consent: 'active',
}));
vi.mock('./client', () => ({ analyticsClient: { surveys: h.surveys }, getConsentState: () => h.consent }));
vi.mock('./config', () => ({ getAnalyticsConfig: () => ({ enabled: true }) }));

import { SURVEY_NAMES, buildSurveyContext, onCoreFlowCompleted, showSurvey, surveysLive } from './surveys';

beforeEach(() => {
  Object.values(h.surveys).forEach((f) => f.mockReset());
  h.consent = 'active';
});

describe('AC-PHO-094 survey context carries no record contents', () => {
  it('is the route template and module only, never the raw path or record id', () => {
    const ctx = buildSurveyContext('/projects/8f14e45f-ceea-467a-9575-1f5d6b3d7a10/budget?x=1');
    expect(ctx).toEqual({ module: 'projects', route: '/projects/:projectId/:tab' });
    expect(JSON.stringify(ctx)).not.toContain('8f14e45f');
  });
  it('adds the run id as run_id and $ai_trace_id when it looks like an id, drops it otherwise', () => {
    const id = '0b1c2d3e-aaaa-bbbb-cccc-1234567890ab';
    expect(buildSurveyContext('/projects', id)).toEqual({ module: 'projects', route: '/projects', run_id: id, $ai_trace_id: id });
    expect(buildSurveyContext('/projects', 'Invoice for ACME Ltd')).toEqual({ module: 'projects', route: '/projects' });
  });
});

describe('AC-PHO-094 gating and wrappers', () => {
  it('the four surveys have fixed names the owner publishes', () => {
    expect(Object.values(SURVEY_NAMES)).toEqual([
      '[PMO] Feedback',
      '[PMO] Assistant: what went wrong?',
      '[PMO] First core flow',
      '[PMO] NPS',
    ]);
  });
  it('surveys are live only when analytics is active (not opted out, not Do-Not-Track, not disabled)', () => {
    expect(surveysLive()).toBe(true);
    for (const c of ['opted-out', 'dnt', 'disabled']) {
      h.consent = c;
      expect(surveysLive()).toBe(false);
    }
  });
  it('showSurvey forwards the id, context and anchor', () => {
    showSurvey('s1', { module: 'x' }, '#a');
    expect(h.surveys.show).toHaveBeenCalledWith('s1', { module: 'x' }, '#a');
  });
  it('onCoreFlowCompleted fires for the four business events only', () => {
    let relay: (e: string) => void = () => {};
    h.surveys.onCaptured.mockImplementation((cb: (e: string) => void) => {
      relay = cb;
      return () => {};
    });
    const cb = vi.fn();
    onCoreFlowCompleted(cb);
    for (const e of ['budget_activated', 'invoice_issued', 'payment_recorded', 'purchase_approved']) relay(e);
    relay('app_route_viewed');
    relay('agent_feedback_rated');
    expect(cb).toHaveBeenCalledTimes(4);
  });
});
