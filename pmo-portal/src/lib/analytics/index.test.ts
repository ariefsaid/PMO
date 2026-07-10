import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock analyticsClient.capture ─────────────────────────────────────────
const mockCapture = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  analyticsClient: { capture: mockCapture },
}));

// AnalyticsProvider re-export triggers React/router imports — mock it away.
vi.mock('./AnalyticsProvider', () => ({
  AnalyticsProvider: () => null,
}));

import { trackDemoPersonaSelected, trackAuthLoginSucceeded, trackAuthLoginFailed } from './index';

beforeEach(() => {
  mockCapture.mockClear();
});

describe('analytics facade helpers', () => {
  it('trackDemoPersonaSelected calls capture with event name and persona_role', () => {
    trackDemoPersonaSelected('Executive');
    expect(mockCapture).toHaveBeenCalledWith('demo_persona_selected', { persona_role: 'Executive' });
  });

  it('trackDemoPersonaSelected passes each valid persona label', () => {
    const labels = ['Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin'] as const;
    for (const label of labels) {
      trackDemoPersonaSelected(label);
    }
    expect(mockCapture).toHaveBeenCalledTimes(5);
    const calls = mockCapture.mock.calls.map((c: unknown[]) => c[1] as Record<string, unknown>);
    expect(calls.map((p) => p.persona_role)).toEqual([
      'Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin',
    ]);
  });

  it('trackAuthLoginSucceeded calls capture with event name and method', () => {
    trackAuthLoginSucceeded('password');
    expect(mockCapture).toHaveBeenCalledWith('auth_login_succeeded', { method: 'password' });
  });

  it('trackAuthLoginSucceeded accepts magic_link method', () => {
    trackAuthLoginSucceeded('magic_link');
    expect(mockCapture).toHaveBeenCalledWith('auth_login_succeeded', { method: 'magic_link' });
  });

  it('trackAuthLoginFailed calls capture with event name, method, and reason_code', () => {
    trackAuthLoginFailed('password', 'invalid_credentials');
    expect(mockCapture).toHaveBeenCalledWith('auth_login_failed', {
      method: 'password',
      reason_code: 'invalid_credentials',
    });
  });

  it('trackAuthLoginFailed accepts auth_error reason_code', () => {
    trackAuthLoginFailed('magic_link', 'auth_error');
    expect(mockCapture).toHaveBeenCalledWith('auth_login_failed', {
      method: 'magic_link',
      reason_code: 'auth_error',
    });
  });
});
