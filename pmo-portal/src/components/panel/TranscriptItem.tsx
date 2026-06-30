/**
 * TranscriptItem — renders one AgentEvent entry in the transcript.
 * Switches on event.type to choose the right visual treatment.
 * FR-AP-013/014/017; D-A2-7 (tool label); D-A2-8 (plain text).
 * A3: status{needs-approval} → <ApprovalChip>; system{write_resolved} → inline notice.
 */
import React from 'react';
import type { AgentEvent, NeedsApprovalPayload, WriteResolvedPayload } from '@/src/lib/agent/runtime/port';
import { ChatBubble } from './ChatBubble';
import { ToolCallCard } from './ToolCallCard';
import { ApprovalChip } from './ApprovalChip';
import type { TranscriptEntry, ApprovalChipState } from '@/src/hooks/useAssistantPanel';

interface TranscriptItemProps {
  entry: TranscriptEntry;
  /** A3: chip state for needs-approval events (pending/approving/approved/denied). */
  approvalChipState?: ApprovalChipState;
  /** A3: called when user clicks Approve. */
  onApprove?: () => void;
  /** A3: called when user clicks Deny. */
  onDeny?: () => void;
}

export const TranscriptItem: React.FC<TranscriptItemProps> = ({
  entry,
  approvalChipState = 'pending',
  onApprove,
  onDeny,
}) => {
  const { event } = entry;

  switch (event.type) {
    case 'user':
      return <ChatBubble text={event.text ?? ''} />;

    case 'assistant':
      return (
        <div data-testid="assistant-bubble" className="max-w-[90%] text-sm text-foreground">
          <span className="sr-only">Assistant: </span>
          {event.text}
        </div>
      );

    case 'tool':
      return <ToolCallCard payload={event.payload} />;

    case 'status': {
      const payload = event.payload as { status?: string; error?: string } | undefined;
      if (!payload) return null;

      if (payload.status === 'completed') {
        // Terminal completion is signalled by the composer re-enabling; no extra line.
        return null;
      }

      if (payload.status === 'needs-approval') {
        // A3: render the approve/deny chip for this pending write action.
        const naPayload = event.payload as NeedsApprovalPayload;
        return (
          <ApprovalChip
            humanSummary={naPayload.humanSummary}
            state={approvalChipState}
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

    case 'artifact':
      // A4 reserved: defensive stub, never crash.
      return (
        <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          A view is ready
        </div>
      );

    default:
      return null;
  }
};

export type { AgentEvent };
