/**
 * QuestionChips — ask-user question UI: tappable option chips + optional free-text.
 *
 * Mirrors ApprovalChip.tsx conventions (DESIGN.md tokens; 32px h-8 buttons; focus ring).
 * FR-ATC-009; NFR-ATC-A11Y-002.
 */
import React, { useId, useState } from 'react';

export interface QuestionChipsProps {
  prompt: string;
  options: { id: string; label: string }[];
  allowFreeText?: boolean;
  onAnswer: (a: { optionId?: string; freeText?: string }) => void;
  disabled?: boolean;
}

export const QuestionChips: React.FC<QuestionChipsProps> = ({
  prompt,
  options,
  allowFreeText,
  onAnswer,
  disabled,
}) => {
  const [freeText, setFreeText] = useState('');
  const inputId = useId();

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
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer({ optionId: opt.id })}
              className={[
                // h-8 = 32px: DESIGN.md §5 Buttons "32px tall" rule.
                'h-8 rounded-md border border-border px-3 py-0 text-xs font-medium',
                'text-foreground',
                'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
            disabled={disabled}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFreeText();
            }}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Type an answer…"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={submitFreeText}
            aria-label="Submit"
            className="h-8 rounded-md border border-transparent bg-primary px-3 py-0 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
};
