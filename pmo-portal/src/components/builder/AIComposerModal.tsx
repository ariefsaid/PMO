/**
 * AIComposerModal — accessible dialog for AI-powered view composition.
 *
 * Mirrors ConfirmDialog's a11y contract (NFR-AS-A11Y-001..003):
 *   - createPortal, role="dialog", aria-modal, aria-labelledby (heading), aria-describedby (error/status)
 *   - Escape → onClose; focus trap on Tab/Shift+Tab; focus restore on close
 *   - aria-live="polite" for loading/error region
 *
 * On compose success: calls onComposed(spec) + onClose.
 * On compose failure (null): shows the hook's error in the live region.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/src/components/ui/Button';
import { useAIComposer } from '@/src/hooks/useAIComposer';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const MAX_PROMPT_LENGTH = 2000;

export interface AIComposerModalProps {
  open: boolean;
  onClose: () => void;
  onComposed: (spec: CompositionSpec) => void;
}

const AIComposerModal: React.FC<AIComposerModalProps> = ({
  open,
  onClose,
  onComposed,
}) => {
  const titleId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // Incrementing this forces a re-render so the live hookError value is picked up
  // after compose() resolves null (hookError is read fresh on each render cycle).
  const [, setErrorTick] = useState(0);

  const { compose, status, error: hookError } = useAIComposer();

  const isLoading = status === 'loading';

  // Display hook error in local state for the live region
  useEffect(() => {
    if (hookError) {
      setLocalError(hookError);
    }
  }, [hookError]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, isLoading, onClose]);

  // Focus management: move focus in on open; restore on close
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Focus textarea (the primary interactive element) synchronously so jsdom tests see it
      textareaRef.current?.focus();
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Focus trap: cycle Tab/Shift+Tab within the dialog
  const onTrapKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleGenerate = async () => {
    setLocalError(null);
    const spec = await compose(prompt);
    if (spec !== null) {
      onComposed(spec);
      onClose();
    } else {
      // Trigger a re-render so the live hookError value (set by the hook during compose)
      // is picked up by the displayError = localError ?? hookError expression.
      // The useEffect(hookError) will then sync it into localError for subsequent renders.
      setErrorTick((t) => t + 1);
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH));
    setLocalError(null);
  };

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPrompt('');
      setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const displayError = localError ?? hookError;

  const textareaLabelId = `${titleId}-label`;

  return createPortal(
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center p-4"
    >
      {/* Scrim */}
      <div
        aria-hidden
        onClick={() => {
          if (!isLoading) onClose();
        }}
        className="absolute inset-0 bg-foreground/40"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={displayError ? errorId : undefined}
        onKeyDown={onTrapKeyDown}
        className="relative z-[810] w-full max-w-[520px] rounded-lg border border-border bg-popover p-5 shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]"
      >
        {/* Heading */}
        <h2
          id={titleId}
          className="mb-4 text-[18px] font-semibold leading-[1.3] text-popover-foreground"
        >
          Compose with AI
        </h2>

        {/* Textarea */}
        <div className="mb-1 flex flex-col gap-1">
          <label
            id={textareaLabelId}
            htmlFor={`${titleId}-textarea`}
            className="text-[13px] font-medium text-foreground"
          >
            Describe the view you want
          </label>
          <textarea
            ref={textareaRef}
            id={`${titleId}-textarea`}
            aria-labelledby={textareaLabelId}
            value={prompt}
            onChange={handlePromptChange}
            rows={4}
            maxLength={MAX_PROMPT_LENGTH}
            disabled={isLoading}
            placeholder="e.g. show me at-risk projects and this quarter's contract value"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          {/* Character counter */}
          <p className="text-right text-[12px] text-muted-foreground" aria-live="off">
            {prompt.length} / {MAX_PROMPT_LENGTH}
          </p>
        </div>

        {/* Live region for loading/error (NFR-AS-A11Y-002/003) */}
        <div
          id={errorId}
          aria-live="polite"
          aria-atomic="true"
          className="min-h-[1.5rem] text-[13px]"
        >
          {isLoading && (
            <span className="text-muted-foreground">Generating your view…</span>
          )}
          {displayError && !isLoading && (
            <span className="text-destructive">{displayError}</span>
          )}
        </div>

        {/* Action row */}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={isLoading}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={isLoading || prompt.trim().length === 0}
            onClick={handleGenerate}
            aria-busy={isLoading}
          >
            {isLoading ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

AIComposerModal.displayName = 'AIComposerModal';

export default AIComposerModal;
