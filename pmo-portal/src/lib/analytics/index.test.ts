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

import {
  trackDemoPersonaSelected,
  trackAuthLoginSucceeded,
  trackAuthLoginFailed,
  trackAuthLogoutSucceeded,
  trackFormValidationFailed,
  trackSaveFailed,
  trackEmptyStateSeen,
  trackSearchUsed,
  trackProjectDetailOpened,
  trackProcurementDetailOpened,
  trackProjectTabViewed,
  trackComingSoonClicked,
  trackFilterApplied,
} from './index';

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

  it('trackAuthLogoutSucceeded calls capture with the event name (role rides the super-property)', () => {
    trackAuthLogoutSucceeded();
    expect(mockCapture).toHaveBeenCalledWith('auth_logout_succeeded', {});
  });

  it('trackFormValidationFailed captures the same safe props the builder produces', () => {
    trackFormValidationFailed('company-form', 1, 'required', 'companies');
    expect(mockCapture).toHaveBeenCalledWith('form_validation_failed', {
      form_id: 'company-form',
      field_count: 1,
      reason_code: 'required',
      module: 'companies',
    });
  });

  it('trackSaveFailed captures the same safe props the builder produces', () => {
    trackSaveFailed('company', 'update', 'network', 'companies');
    expect(mockCapture).toHaveBeenCalledWith('save_failed', {
      entity_type: 'company',
      operation: 'update',
      reason_code: 'network',
      module: 'companies',
    });
  });

  it('trackEmptyStateSeen captures the same safe props the builder produces', () => {
    trackEmptyStateSeen('companies-empty', 'Admin', 'companies');
    expect(mockCapture).toHaveBeenCalledWith('empty_state_seen', {
      state_id: 'companies-empty',
      role: 'Admin',
      module: 'companies',
    });
  });

  it('trackSearchUsed captures surface, result_count, and module — never the query text', () => {
    trackSearchUsed('companies-list', 4, 'companies');
    expect(mockCapture).toHaveBeenCalledWith('search_used', {
      search_surface: 'companies-list',
      result_count: 4,
      module: 'companies',
    });
  });

  it('trackProjectDetailOpened captures a route PATTERN and source, never a raw id', () => {
    trackProjectDetailOpened('/projects/:projectId', 'list');
    expect(mockCapture).toHaveBeenCalledWith('project_detail_opened', {
      route: '/projects/:projectId',
      source: 'list',
    });
  });

  it('trackProcurementDetailOpened captures a route PATTERN and source', () => {
    trackProcurementDetailOpened('/procurement/:procurementId', 'card');
    expect(mockCapture).toHaveBeenCalledWith('procurement_detail_opened', {
      route: '/procurement/:procurementId',
      source: 'card',
    });
  });

  it('trackProjectTabViewed captures a SAFE_TAB_ID-passing tab id verbatim', () => {
    trackProjectTabViewed('budget');
    expect(mockCapture).toHaveBeenCalledWith('project_tab_viewed', { tab_id: 'budget' });
  });

  it('trackProjectTabViewed normalizes a tab id that fails SAFE_TAB_ID to unknown_tab', () => {
    trackProjectTabViewed('Not Safe!');
    expect(mockCapture).toHaveBeenCalledWith('project_tab_viewed', { tab_id: 'unknown_tab' });
  });

  it('trackComingSoonClicked captures feature_id and module', () => {
    trackComingSoonClicked('board-pack-export', 'dashboard');
    expect(mockCapture).toHaveBeenCalledWith('coming_soon_clicked', {
      feature_id: 'board-pack-export',
      module: 'dashboard',
    });
  });

  it('trackFilterApplied captures filter_id and option_count, never the chosen value', () => {
    trackFilterApplied('status', 5, 'projects');
    expect(mockCapture).toHaveBeenCalledWith('filter_applied', {
      filter_id: 'status',
      option_count: 5,
      module: 'projects',
    });
  });
});
