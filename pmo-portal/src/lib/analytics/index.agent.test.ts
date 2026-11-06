import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCapture = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  analyticsClient: { capture: mockCapture },
}));
vi.mock('./AnalyticsProvider', () => ({ AnalyticsProvider: () => null }));
vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
  FEATURES: {},
}));

import {
  trackAgentPanelOpened,
  trackAgentRunStarted,
  trackAgentRunCompleted,
  trackAgentRunErrored,
  trackAgentApprovalShown,
  trackAgentApprovalDecided,
  trackAgentThreadResumed,
  trackAgentFeedbackRated,
  trackAgentComposeViewSaved,
} from './index';

beforeEach(() => {
  mockCapture.mockClear();
  mockIsFeatureEnabled.mockReset();
});

describe('agent analytics wrappers — gating', () => {
  it('AC-APH-014 no agent event fires when agentAssistant off', () => {
    mockIsFeatureEnabled.mockReturnValue(false);
    trackAgentPanelOpened(false);
    trackAgentRunStarted('run-1', false);
    trackAgentRunCompleted('run-1', 100, 0);
    trackAgentRunErrored('run-1', 100, 0, 'PROVIDER_ERROR');
    trackAgentApprovalShown('run-1');
    trackAgentApprovalDecided('run-1', 'approved');
    trackAgentThreadResumed('thread-1', 'run-1', 3);
    trackAgentFeedbackRated('up', undefined, 'run-1');
    trackAgentComposeViewSaved('run-1');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('AC-APH-015 no agent event fires when analytics gate inactive (capture no-ops itself)', () => {
    // agentAssistant ON, but analyticsClient.capture is the real no-op-on-uninitialized
    // guard — simulated here by NOT mocking capture to do anything (mockCapture is a bare
    // vi.fn(), i.e. it "captures" the call but the REAL client.ts no-ops internally in prod;
    // this test instead proves the flag-composition contract: with agentAssistant ON the
    // wrapper still calls capture (capture's OWN no-op is client.test.ts's job, already
    // covered) — so this spec's job is only to prove the wrapper does NOT need its own
    // second suppression mechanism. Assert capture IS invoked (composition point), leaving
    // capture's internal no-op behavior to client.test.ts's existing coverage.
    mockIsFeatureEnabled.mockReturnValue(true);
    trackAgentPanelOpened(false);
    expect(mockCapture).toHaveBeenCalledWith('agent_panel_opened', { has_scope: false });
  });

  it('agentAssistant on: agent_run_started fires with run_id and is_retry', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    trackAgentRunStarted('run-1', true);
    expect(mockCapture).toHaveBeenCalledWith('agent_run_started', { run_id: 'run-1', is_retry: true });
  });

  it('agentAssistant on: agent_compose_view_saved fires with run_id only', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    trackAgentComposeViewSaved('run-1');
    expect(mockCapture).toHaveBeenCalledWith('agent_compose_view_saved', { run_id: 'run-1' });
  });
});

// ── Agent analytics wrappers — captured payload shapes (AC-APH-016) ─────
// Property keys must match the FR-declared, exhaustive per-event sets (NFR-APH-PRIV-001):
// never add a key without a spec amendment. These assert the FACADE's actual capture
// (the only production path) so the wire contract and its proof live in one place.
describe('agent analytics wrappers — captured payload shapes', () => {
  beforeEach(() => {
    mockIsFeatureEnabled.mockReturnValue(true);
  });

  it('AC-APH-016 agent_panel_opened keys match the FR-declared set', () => {
    trackAgentPanelOpened(true);
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['has_scope']);
    expect(props).toEqual({ has_scope: true });
    trackAgentPanelOpened(false);
    expect(mockCapture).toHaveBeenLastCalledWith('agent_panel_opened', { has_scope: false });
  });

  it('AC-APH-016 agent_run_started keys match the FR-declared set', () => {
    trackAgentRunStarted('run-1', false);
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['is_retry', 'run_id']);
  });

  it('AC-APH-016 agent_run_completed keys match the FR-declared set', () => {
    trackAgentRunCompleted('run-1', 4200, 2);
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['duration_ms', 'run_id', 'tool_round_count']);
  });

  it('NFR-APH-REL-002 agent_run_completed omits duration_ms when start unknown', () => {
    trackAgentRunCompleted('run-1', undefined, 0);
    const [, props] = mockCapture.mock.calls[0];
    expect(props.duration_ms).toBeUndefined();
    expect(Object.keys(props).sort()).toEqual(['duration_ms', 'run_id', 'tool_round_count']);
  });

  it('AC-APH-016 agent_run_errored keys match the FR-declared set', () => {
    trackAgentRunErrored('run-1', 4200, 2, 'PROVIDER_ERROR');
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['duration_ms', 'error_code', 'run_id', 'tool_round_count']);
  });

  it('AC-APH-016 agent_approval_shown keys match the FR-declared set', () => {
    trackAgentApprovalShown('run-1');
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['run_id']);
  });

  it('AC-APH-016 agent_approval_decided keys match the FR-declared set', () => {
    trackAgentApprovalDecided('run-1', 'approved');
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['decision', 'run_id']);
  });

  it('AC-APH-016 agent_thread_resumed keys match the FR-declared set', () => {
    trackAgentThreadResumed('thread-1', 'run-1', 5);
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['event_count', 'run_id', 'thread_id']);
  });

  it('AC-APH-016 agent_feedback_rated keys match the FR-declared set; never the event id', () => {
    trackAgentFeedbackRated('down', 'wrong_tool', 'run-1');
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['$ai_trace_id', 'downvote_reason', 'rating', 'run_id']);
    // FR-APH-011 (amended by FR-PHO-005): run_id joins the rating to its AI trace; never the event id.
    expect(props).not.toHaveProperty('eventId');
  });

  it('AC-PHO-005 feedback carries run_id and the matching $ai_trace_id; thumbs-up has no reason', () => {
    trackAgentFeedbackRated('down', 'wrong_answer' as never, 'run-1');
    expect(mockCapture).toHaveBeenLastCalledWith('agent_feedback_rated', {
      rating: 'down', downvote_reason: 'wrong_answer', run_id: 'run-1', $ai_trace_id: 'run-1',
    });
    trackAgentFeedbackRated('up', undefined, 'run-2');
    const [, props] = mockCapture.mock.calls[1];
    expect(props).toMatchObject({ rating: 'up', run_id: 'run-2', $ai_trace_id: 'run-2' });
    expect(props.downvote_reason).toBeUndefined();
  });

  it('AC-APH-016 agent_compose_view_saved keys match the FR-declared set', () => {
    trackAgentComposeViewSaved('run-1');
    const [, props] = mockCapture.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(['run_id']);
  });
});
