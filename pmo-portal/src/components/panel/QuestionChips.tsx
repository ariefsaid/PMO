/**
 * QuestionChips — ask-user question UI: tappable option chips + optional free-text.
 *
 * Mirrors ApprovalChip.tsx conventions (DESIGN.md tokens; 32px h-8 buttons; focus ring).
 * FR-ATC-009; NFR-ATC-A11Y-002.
 *
 * Review-remediation item 3 (F3, Discover finding): a pending question chip must
 * honestly reflect two distinct "can't answer anymore" states, mirroring
 * ApprovalChip's state machine:
 *   - `disabled` (e.g. phase==='out-of-credits'): the run can't continue — every
 *     control is disabled, no dead-end illusion of a live control.
 *   - `selectedOptionId` / `resolvedText`: the question has ALREADY been answered
 *     (a later re-render of the same transcript entry, mirroring ApprovalChip's
 *     'approved'/'denied' resolved states) — controls disable AND the chosen
 *     answer is indicated in place, so the user isn't left staring at chips that
 *     look re-clickable for a question that's done.
 */
import React, { useId, useState } from 'react';

export interface QuestionChipsProps {
  prompt: string;
  options: { id: string; label: string }[];
  allowFreeText?: boolean;
  onAnswer: (a: { optionId?: string; freeText?: string }) => void;
  /** Hard-disables every control without indicating a resolution (e.g. out-of-credits). */
  disabled?: boolean;
  /** The option id the user already chose — disables all chips + marks it selected. */
  selectedOptionId?: string;
  /** The free-text answer the user already submitted — renders as a resolved notice. */
  resolvedText?: string;
}

export const QuestionChips: React.FC<QuestionChipsProps> = ({
  prompt,
  options,
  allowFreeText,
  onAnswer,
  disabled,
  selectedOptionId,
  resolvedText,
}) => {
  const [freeText, setFreeText] = useState('');
  const inputId = useId();

  const isResolved = selectedOptionId !== undefined || resolvedText !== undefined;
  const controlsDisabled = disabled || isResolved;

  const submitFreeText = () => {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    onAnswer({ freeText: trimmed });
  };

  return (
    <div
      role="group"
      aria-label={prompt}
      aria-live="polite"
      className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
    >
      <p className="mb-2 text-xs text-foreground">{prompt}</p>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const isSelected = opt.id === selectedOptionId;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={controlsDisabled}
                aria-pressed={isResolved ? isSelected : undefined}
                onClick={() => onAnswer({ optionId: opt.id })}
                className={[
                  // h-8 = 32px: DESIGN.md §5 Buttons "32px tall" rule.
                  'h-8 rounded-md border px-3 py-0 text-xs font-medium',
                  isSelected
                    ? 'border-primary text-primary-text'
                    : 'border-border text-foreground',
                  'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                ].join(' ')}
              >
                {opt.label}
                {isSelected && (
                  <span aria-hidden className="ml-1">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {resolvedText !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">
          You answered: <span className="font-medium text-foreground">{resolvedText}</span>
        </p>
      )}

      {allowFreeText && (
        <div className="mt-2 flex gap-2">
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            id={inputId}
            type="text"
            value={freeText}
            disabled={controlsDisabled}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFreeText();
            }}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Type an answer…"
          />
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={submitFreeText}
            aria-label="Submit"
            className="h-8 rounded-md border border-border px-3 py-0 text-xs font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
};
