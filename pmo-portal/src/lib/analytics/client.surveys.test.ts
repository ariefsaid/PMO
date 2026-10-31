// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnalyticsConfig } from './config';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  getSurveys: vi.fn(),
  canRenderSurvey: vi.fn(),
  displaySurvey: vi.fn(),
  on: vi.fn(),
  register: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

import { analyticsClient, buildPosthogInitOptions } from './client';

const config: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  analyticsEnabled: true,
  replayAndAutocapture: false,
  posthogKey: 'phc_' + 'a'.repeat(24),
  posthogHost: 'https://us.i.posthog.com',
  appEnv: 'test',
  isDev: false,
  isProd: false,
  demoAudience: 'internal',
  demoAccount: 'local',
};

beforeEach(() => {
  Object.values(posthog).forEach((f) => f.mockReset());
  analyticsClient.__resetForTests();
  localStorage.clear();
});

describe('AC-PHO-103 the SDK never pops a survey by itself', () => {
  it('init options turn automatic display off, so only the app decides when a survey shows', () => {
    expect(buildPosthogInitOptions(config)?.disable_surveys_automatic_display).toBe(true);
  });
});

describe('AC-PHO-103 survey methods', () => {
  it('find resolves a survey id by exact name and null when it is not published', () => {
    analyticsClient.init(config);
    posthog.getSurveys.mockImplementation((cb: (s: unknown[]) => void) =>
      cb([{ id: 's1', name: '[PMO] NPS' }, { id: 's2', name: '[PMO] Feedback' }]),
    );
    const got: Array<string | null> = [];
    analyticsClient.surveys.find('[PMO] Feedback', (id) => got.push(id));
    analyticsClient.surveys.find('[PMO] Missing', (id) => got.push(id));
    expect(got).toEqual(['s2', null]);
  });

  it('canRender follows the SDK verdict (wait period, targeting, already seen)', () => {
    analyticsClient.init(config);
    posthog.canRenderSurvey.mockReturnValueOnce({ visible: true }).mockReturnValueOnce({ visible: false, disabledReason: 'wait' });
    expect(analyticsClient.surveys.canRender('s1')).toBe(true);
    expect(analyticsClient.surveys.canRender('s1')).toBe(false);
  });

  it('show opens PostHog\'s own popover with the context properties; nextTo anchors it', () => {
    analyticsClient.init(config);
    analyticsClient.surveys.show('s1', { module: 'projects' });
    expect(posthog.displaySurvey).toHaveBeenLastCalledWith('s1', {
      displayType: 'popover', ignoreConditions: true, ignoreDelay: true, properties: { module: 'projects' },
    });
    analyticsClient.surveys.show('s1', {}, '#fb');
    expect(posthog.displaySurvey).toHaveBeenLastCalledWith('s1', expect.objectContaining({ position: 'next_to_trigger', selector: '#fb' }));
  });

  it('onCaptured relays captured event names and stops after unsubscribe', () => {
    analyticsClient.init(config);
    const off = vi.fn();
    posthog.on.mockReturnValue(off);
    const seen: string[] = [];
    const unsubscribe = analyticsClient.surveys.onCaptured((e) => seen.push(e));
    expect(posthog.on).toHaveBeenCalledWith('eventCaptured', expect.any(Function));
    const handler = posthog.on.mock.calls[0][1] as (e: unknown) => void;
    handler({ event: 'budget_activated', properties: { a: 1 } });
    handler({ nonsense: true });
    expect(seen).toEqual(['budget_activated']);
    unsubscribe();
    expect(off).toHaveBeenCalled();
  });

  it('is inert before init, and after the user opts out nothing reaches the SDK', () => {
    const cb = vi.fn();
    analyticsClient.surveys.find('[PMO] NPS', cb);
    expect(cb).toHaveBeenCalledWith(null);
    expect(analyticsClient.surveys.canRender('s1')).toBe(false);

    analyticsClient.init(config);
    analyticsClient.optOut();
    posthog.getSurveys.mockClear();
    const cb2 = vi.fn();
    analyticsClient.surveys.find('[PMO] NPS', cb2);
    expect(cb2).toHaveBeenCalledWith(null);
    expect(analyticsClient.surveys.canRender('s1')).toBe(false);
    analyticsClient.surveys.show('s1', {});
    expect(posthog.getSurveys).not.toHaveBeenCalled();
    expect(posthog.displaySurvey).not.toHaveBeenCalled();
  });
});

describe('AC-PHO-103 survey answers carry no record contents', () => {
  const run = (event: string, properties: Record<string, unknown>) => {
    const out = buildPosthogInitOptions(config)!.before_send as (r: unknown) => { properties: Record<string, unknown> } | null;
    return out({ uuid: 'u', event, properties })!.properties;
  };

  it('scrubs an email, a token and a long id from free text, in every response key', () => {
    const p = run('survey sent', {
      $survey_response: 'invoice for jane.doe@example.com failed, key sk-abcdef123456 id 0123456789abcdef0123456789abcdef0123',
      $survey_response_q2: ['picked', 'mail me bob@example.org'],
      $survey_id: 'keep-me',
    });
    expect(JSON.stringify(p)).not.toMatch(/jane\.doe|sk-abcdef|0123456789abcdef|bob@/);
    expect(p.$survey_id).toBe('keep-me');
    expect(String(p.$survey_response)).toContain('invoice');
  });

  it('leaves numeric answers (rating, NPS) alone', () => {
    expect(run('survey sent', { $survey_response: 7 }).$survey_response).toBe(7);
  });

  it('does not touch other events', () => {
    const p = run('app_route_viewed', { $survey_response: 'a@b.co' });
    expect(p.$survey_response).toBe('a@b.co');
  });
});
