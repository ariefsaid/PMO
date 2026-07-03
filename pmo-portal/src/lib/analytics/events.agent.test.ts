import { describe, expect, it } from 'vitest';
import {
  buildAgentPanelOpenedEvent,
  buildAgentRunStartedEvent,
  buildAgentRunCompletedEvent,
  buildAgentRunErroredEvent,
  buildAgentApprovalShownEvent,
  buildAgentApprovalDecidedEvent,
  buildAgentThreadResumedEvent,
  buildAgentFeedbackRatedEvent,
  buildAgentComposeViewSavedEvent,
} from './events';

describe('agent event builders', () => {
  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_panel_opened', () => {
    const built = buildAgentPanelOpenedEvent(false);
    expect(built.event).toBe('agent_panel_opened');
    expect(Object.keys(built.properties).sort()).toEqual(['has_scope']);
  });

  it('AC-APH-002 agent_panel_opened has_scope true when scoped', () => {
    expect(buildAgentPanelOpenedEvent(true).properties).toEqual({ has_scope: true });
    expect(buildAgentPanelOpenedEvent(false).properties).toEqual({ has_scope: false });
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_run_started', () => {
    const built = buildAgentRunStartedEvent('run-1', false);
    expect(built.event).toBe('agent_run_started');
    expect(Object.keys(built.properties).sort()).toEqual(['is_retry', 'run_id']);
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_run_completed', () => {
    const built = buildAgentRunCompletedEvent('run-1', 4200, 2);
    expect(built.event).toBe('agent_run_completed');
    expect(Object.keys(built.properties).sort()).toEqual(['duration_ms', 'run_id', 'tool_round_count']);
  });

  it('NFR-APH-REL-002 agent_run_completed omits duration_ms when start unknown', () => {
    const built = buildAgentRunCompletedEvent('run-1', undefined, 0);
    expect(built.properties.duration_ms).toBeUndefined();
    expect(Object.keys(built.properties).sort()).toEqual(['duration_ms', 'run_id', 'tool_round_count']);
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_run_errored', () => {
    const built = buildAgentRunErroredEvent('run-1', 4200, 2, 'PROVIDER_ERROR');
    expect(built.event).toBe('agent_run_errored');
    expect(Object.keys(built.properties).sort()).toEqual(['duration_ms', 'error_code', 'run_id', 'tool_round_count']);
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_approval_shown', () => {
    const built = buildAgentApprovalShownEvent('run-1');
    expect(built.event).toBe('agent_approval_shown');
    expect(Object.keys(built.properties).sort()).toEqual(['run_id']);
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_approval_decided', () => {
    const built = buildAgentApprovalDecidedEvent('run-1', 'approved');
    expect(built.event).toBe('agent_approval_decided');
    expect(Object.keys(built.properties).sort()).toEqual(['decision', 'run_id']);
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_thread_resumed', () => {
    const built = buildAgentThreadResumedEvent('thread-1', 'run-1', 5);
    expect(built.event).toBe('agent_thread_resumed');
    expect(Object.keys(built.properties).sort()).toEqual(['event_count', 'run_id', 'thread_id']);
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_feedback_rated', () => {
    const built = buildAgentFeedbackRatedEvent('down', 'wrong_tool');
    expect(built.event).toBe('agent_feedback_rated');
    expect(Object.keys(built.properties).sort()).toEqual(['downvote_reason', 'rating']);
    // FR-APH-011: no eventId/run_id property present.
    expect(built.properties).not.toHaveProperty('eventId');
    expect(built.properties).not.toHaveProperty('run_id');
  });

  it('AC-APH-016 trackAgent* property keys match FR-declared set: agent_compose_view_saved', () => {
    const built = buildAgentComposeViewSavedEvent('run-1');
    expect(built.event).toBe('agent_compose_view_saved');
    expect(Object.keys(built.properties).sort()).toEqual(['run_id']);
  });
});
