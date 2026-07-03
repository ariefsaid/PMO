/**
 * TranscriptItem — renders one AgentEvent entry in the transcript.
 * Switches on event.type to choose the right visual treatment.
 * FR-AP-013/014/017; D-A2-7 (tool label); D-A2-8 (plain text).
 * A3: status{needs-approval} → <ApprovalChip>; system{write_resolved} → inline notice.
 */
import React from 'react';
import type { AgentEvent, NeedsApprovalPayload, WriteResolvedPayload, QuestionPayload } from '@/src/lib/agent/runtime/port';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { ChatBubble } from './ChatBubble';
import { ToolCallCard } from './ToolCallCard';
import { ApprovalChip } from './ApprovalChip';
import { ArtifactSlot } from './ArtifactSlot';
import type { ArtifactSlotPayload } from './ArtifactSlot';
import { FeedbackControl } from './FeedbackControl';
import { WidgetSlot } from './widgets/WidgetSlot';
import { QuestionChips } from './QuestionChips';
import type { TranscriptEntry, ChipStateMap } from '@/src/hooks/useAssistantPanel';
import { isFeatureEnabled } from '@/src/lib/features';

interface TranscriptItemProps {
  entry: TranscriptEntry;
  /**
   * A3: chip state keyed by pendingId (Blocker-8: not a single global).
   * Each needs-approval chip looks up its own state by pendingId.
   */
  chipStateMap?: ChipStateMap;
  /** A3: called when user clicks Approve. */
  onApprove?: () => void;
  /** A3: called when user clicks Deny. */
  onDeny?: () => void;
  /**
   * ADR-0045 §2: called with (questionId, optionId?, freeText?) when the user
   * resolves a pending ask-user question via QuestionChips.
   */
  onAnswer?: (questionId: string, optionId?: string, freeText?: string) => void;
  /**
   * ADR-0043 (FR-AGP-024/025): called with (eventId, rating, reason?) when the
   * user rates an assistant event. Thumbs render only when this is provided.
   */
  onRate?: (eventId: string, rating: 'up' | 'down', reason?: DownvoteReason) => void;
}

export const TranscriptItem: React.FC<TranscriptItemProps> = ({
  entry,
  chipStateMap = {},
  onApprove,
  onDeny,
  onAnswer,
  onRate,
}) => {
  const { event } = entry;

  switch (event.type) {
    case 'user':
      return <ChatBubble text={event.text ?? ''} />;

    case 'assistant':
      return (
        <div data-transcript-item className="max-w-[90%]">
          <div data-testid="assistant-bubble" className="text-sm text-foreground">
            <span className="sr-only">Assistant: </span>
            {event.text}
          </div>
          {onRate && <FeedbackControl eventId={event.id} onRate={onRate} />}
        </div>
      );

    case 'tool':
      return <ToolCallCard payload={event.payload} />;

    case 'status': {
      const payload = event.payload as { status?: string; error?: string; kind?: string } | undefined;
      if (!payload) return null;

      if (payload.kind === 'question') {
        // ADR-0045 §2: render the ask-user chips for this pending question.
        // Flag guard (FR-ATC-020): silently skip if agentAssistant is off.
        if (!isFeatureEnabled('agentAssistant')) return null;
        const q = event.payload as QuestionPayload;
        return (
          <QuestionChips
            prompt={q.prompt}
            options={q.options}
            allowFreeText={q.allowFreeText}
            onAnswer={({ optionId, freeText }) => onAnswer?.(q.questionId, optionId, freeText)}
          />
        );
      }

      if (payload.status === 'completed') {
        // Terminal completion is signalled by the composer re-enabling; no extra line.
        return null;
      }

      if (payload.status === 'needs-approval') {
        // A3: render the approve/deny chip for this pending write action.
        // Look up chip state by pendingId so each chip has independent state (Blocker-8).
        const naPayload = event.payload as NeedsApprovalPayload;
        const chipState = chipStateMap[naPayload.pendingId] ?? 'pending';
        return (
          <ApprovalChip
            humanSummary={naPayload.humanSummary}
            state={chipState}
            onApprove={onApprove ?? (() => {})}
            onDeny={onDeny ?? (() => {})}
          />
        );
      }

      if (payload.status === 'errored' && payload.error === 'TURN_CAP') {
        // Step-limit notice — informational, not an error card (FR-AP-016 / AC-AP-014).
        return (
          <div
            role="status"
            className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
          >
            I&apos;ve reached my step limit for this question — you can follow up to continue.
          </div>
        );
      }

      if (payload.status === 'errored') {
        // Other errors are rendered by the panel's error-state UI (phase='error').
        // A bare status item here would duplicate the error card — return null.
        return null;
      }

      return null;
    }

    case 'system': {
      // A3: write_resolved system events render as inline notices (FR-AW-013).
      const sysPayload = event.payload as WriteResolvedPayload | undefined;
      if (sysPayload?.event === 'write_resolved') {
        const label =
          sysPayload.decision === 'approved' ? 'Write approved ✓' : 'Write denied';
        return (
          <div className="text-center text-xs text-muted-foreground">{label}</div>
        );
      }
      return (
        <div className="text-center text-xs text-muted-foreground">{event.text}</div>
      );
    }

    case 'artifact': {
      const artifactPayload = event.payload as { kind?: string; widget?: unknown } | undefined;

      if (artifactPayload?.kind === 'widget') {
        // ADR-0045 §1: route validated widget results to WidgetSlot (FR-ATC-002).
        // Flag guard (FR-ATC-020): silently skip if agentAssistant is off.
        if (!isFeatureEnabled('agentAssistant')) return null;
        return <WidgetSlot widget={artifactPayload.widget} />;
      }

      // A4: route compose_view artifacts to ArtifactSlot (FR-CV-013/025) — unchanged (OBS-ATC-001).
      if (artifactPayload?.kind !== 'compose_view') return null;
      // Flag guard (FR-CV-025): both flags must be on; silently skip if either is off.
      if (!isFeatureEnabled('agentAssistant') || !isFeatureEnabled('aiComposer')) return null;
      return <ArtifactSlot payload={event.payload as ArtifactSlotPayload} runId={event.runId} />;
    }

    default:
      return null;
  }
};

export type { AgentEvent };
