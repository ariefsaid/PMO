/**
 * TranscriptItem — renders one AgentEvent entry in the transcript.
 * Switches on event.type to choose the right visual treatment.
 * FR-AP-013/014/017; assistant text → safe <Markdown> (ADR-0054, supersedes D-A2-8).
 * A3: status{needs-approval} → <ApprovalChip>; system{write_resolved} → inline notice.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NeedsApprovalPayload, WriteResolvedPayload, QuestionPayload } from '@/src/lib/agent/runtime/port';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { StreamingText } from './StreamingText';
import { ApprovalChip } from './ApprovalChip';
import { ArtifactSlot } from './ArtifactSlot';
import type { ArtifactSlotPayload } from './ArtifactSlot';
import { FeedbackControl } from './FeedbackControl';
import { WidgetSlot } from './widgets/WidgetSlot';
import { QuestionChips } from './QuestionChips';
import type { TranscriptEntry, ChipStateMap, AnsweredMap, RunPhase } from '@/src/hooks/useAssistantPanel';
import { isFeatureEnabled } from '@/src/lib/features';

// Module-level empty defaults: a fresh `{}` per render would defeat the memo below.
const NO_CHIPS: ChipStateMap = {};
const NO_ANSWERS: AnsweredMap = {};

interface TranscriptItemProps {
  entry: TranscriptEntry;
  /** True for the assistant row whose answer is still arriving (shows the caret). */
  streaming?: boolean;
  /**
   * A3: chip state keyed by pendingId (Blocker-8: not a single global).
   * Each needs-approval chip looks up its own state by pendingId.
   */
  chipStateMap?: ChipStateMap;
  /**
   * Review-remediation item 3 (F3): resolved ask-user answers keyed by questionId.
   * A question whose id is present renders its chips disabled with the chosen
   * option/free-text indicated, instead of looking perpetually re-clickable.
   */
  answeredMap?: AnsweredMap;
  /**
   * Review-remediation item 3 (F3): the panel's run phase. When 'out-of-credits'
   * a pending question's chips are hard-disabled (mirrors the composer's
   * disabled state) — the run can't continue, so the control must not look live.
   */
  phase?: RunPhase;
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

/** Memoised (#2047 performance audit): a streamed frame re-renders only the row that changed. */
export const TranscriptItem: React.FC<TranscriptItemProps> = React.memo(({
  entry,
  streaming = false,
  chipStateMap = NO_CHIPS,
  answeredMap = NO_ANSWERS,
  phase,
  onApprove,
  onDeny,
  onAnswer,
  onRate,
}) => {
  const { t } = useTranslation('assistantPanel');
  const { event } = entry;

  switch (event.type) {
    case 'user':
      // The user's own message: plain text, never markdown-parsed (ADR-0054 §3, D-A2-8; NOT
      // primary blue, One-Blue rule). break-words so a long unbroken string wraps, not overflows.
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] break-words rounded-2xl bg-secondary px-3.5 py-2 text-sm text-secondary-foreground">
            <span className="sr-only">{t('youSaid', 'You said: ')}</span>
            {event.text ?? ''}
          </div>
        </div>
      );

    case 'assistant':
      return (
        <div data-transcript-item className="max-w-[90%]">
          <div data-testid="assistant-bubble" className="text-sm text-foreground">
            <span className="sr-only">{t('assistantSaid', 'Assistant: ')}</span>
            <StreamingText text={event.text ?? ''} streaming={streaming} />
          </div>
          {onRate && <FeedbackControl eventId={event.id} runId={event.runId} onRate={onRate} />}
        </div>
      );

    case 'status': {
      const payload = event.payload as { status?: string; error?: string; kind?: string } | undefined;
      if (!payload) return null;

      if (payload.kind === 'question') {
        // ADR-0045 §2: render the ask-user chips for this pending question.
        // Flag guard (FR-ATC-020): silently skip if agentAssistant is off.
        if (!isFeatureEnabled('agentAssistant')) return null;
        const q = event.payload as QuestionPayload;
        // Item 3 (F3): a resolved question (already in answeredMap) renders its
        // chips disabled with the chosen option/free-text indicated. A LIVE
        // question is hard-disabled while phase==='out-of-credits' — the run
        // can't continue, so the chip must not look re-clickable (dishonest
        // dead-end fix). Item 6: labeled "Answer needed" header, DESIGN.md
        // overline voice, matching ApprovalChip's "Decision required" header.
        const answered = answeredMap[q.questionId];
        return (
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
              {t('answerNeeded', 'Answer needed')}
            </p>
            <QuestionChips
              prompt={q.prompt}
              options={q.options}
              allowFreeText={q.allowFreeText}
              onAnswer={({ optionId, freeText }) => onAnswer?.(q.questionId, optionId, freeText)}
              disabled={phase === 'out-of-credits'}
              selectedOptionId={answered?.optionId}
              resolvedText={answered?.freeText}
            />
          </div>
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
            className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
          >
            {t('stepLimit', "I've reached my step limit for this question — you can follow up to continue.")}
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
          sysPayload.decision === 'approved' ? t('writeApproved', 'Write approved ✓') : t('writeDenied', 'Write denied');
        return (
          <div className="text-center text-sm text-muted-foreground">{label}</div>
        );
      }
      return (
        <div className="text-center text-sm text-muted-foreground">{event.text}</div>
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
      // 'tool' events render as ToolChips runs in Chat, not here.
      return null;
  }
});
TranscriptItem.displayName = 'TranscriptItem';
