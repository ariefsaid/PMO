/**
 * Composer — the message input area for the AssistantPanel.
 * Explicit label for a11y (NFR-AP-A11Y-003).
 * Enter-to-send, Shift+Enter for newline (FR-AP-009).
 * Single button slot: Send or Stop (FR-AP-010/011/012).
 * Styled after AIComposerModal for consistency.
 */
import React, { useRef, useEffect } from 'react';
import { cn } from '@/src/components/ui/cn';

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** True while a run is in flight (FR-AP-010). */
  running: boolean;
  /**
   * True when the panel is in needs-approval phase (A3).
   * Adds aria-disabled="true" to the textarea so screen readers can distinguish
   * "blocked awaiting decision" from "blocked streaming" (NFR-AW-A11Y-003).
   */
  needsApproval?: boolean;
  /** Ref passed in so the parent can focus the textarea on open (NFR-AP-A11Y-002). */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * FR-AUC-016: hard-disables the textarea + Send button regardless of `running` — the
   * out-of-credits state, distinct from `running` (which shows Stop in place of Send).
   * Additive: existing `running`-only callers (no `disabled` passed) are unaffected.
   */
  disabled?: boolean;
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSend,
  onStop,
  running,
  needsApproval = false,
  textareaRef,
  disabled = false,
}) => {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const resolvedRef = textareaRef ?? internalRef;

  // Auto-grow the textarea up to a reasonable max
  useEffect(() => {
    const el = resolvedRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, resolvedRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!running && !disabled && value.trim().length > 0) {
        e.preventDefault();
        onSend();
      }
    }
  };

  const composerId = 'assistant-composer-textarea';

  return (
    <div className="border-t border-border p-3">
      <label htmlFor={composerId} className="sr-only">
        Ask a question
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={composerId}
          ref={resolvedRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running || disabled}
          // NFR-AW-A11Y-003: explicit aria-disabled in needs-approval phase so screen
          // readers can distinguish "awaiting decision" from "streaming" (Blocker-7).
          aria-disabled={needsApproval ? 'true' : undefined}
          maxLength={2000}
          rows={1}
          placeholder="Ask a question…"
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Ask a question"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={value.trim().length === 0 || disabled}
            aria-label="Send message"
            // F1 (Discover finding): the disabled Send button must NOT remain brand-blue at
            // opacity-50 (`disabled` here is the FR-AUC-016 out-of-credits hard-disable — the
            // repo's `cn` is clsx-only, no tailwind-merge, so `bg-primary` is conditionally
            // OMITTED rather than relying on later-cascade `disabled:*` classes to win).
            className={cn(
              'shrink-0 rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed',
              disabled
                ? 'bg-secondary text-muted-foreground'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
            )}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
