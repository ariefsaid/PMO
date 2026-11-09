/**
 * AIComposerModal — accessible dialog for AI-powered view composition.
 *
 * Base UI Dialog (same engine as ConfirmDialog/EntityFormModal) owns portal, focus trap,
 * initial focus (the prompt textarea), focus return, Escape + scrim dismissal (blocked while
 * generating). NFR-AS-A11Y-001..003: labelled by the heading, aria-live="polite" status region.
 *
 * On compose success: calls onComposed(spec) + onClose.
 * On compose failure (null): shows the hook's error in the live region.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import {
  overlayBackdropClassName,
  overlayBackdropStyle,
} from '@/src/components/ui/OverlaySurface';
import { acquireBackgroundInert } from '@/src/components/ui/backgroundInert';
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
  const { t } = useTranslation();
  const titleId = useId();
  const errorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState('');

  const { compose, status, error: hookError } = useAIComposer();

  const isLoading = status === 'loading';

  // AC-A11Y-MODAL-001 / CMP-009: background inert while open.
  useEffect(() => {
    if (!open) return;
    return acquireBackgroundInert();
  }, [open]);

  const handleGenerate = async () => {
    // compose() clears the hook's own error at start and sets it on failure — the
    // live region renders hookError directly (no mirrored local copy).
    const spec = await compose(prompt);
    if (spec !== null) {
      onComposed(spec);
      onClose();
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH));
  };

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPrompt('');
    }
  }, [open]);

  const displayError = hookError;

  const textareaLabelId = `${titleId}-label`;

  return (
    <Dialog.Root
      open={open}
      modal="trap-focus"
      onOpenChange={(next, details) => {
        if (next) return;
        details.cancel();
        if (!isLoading) onClose();
      }}
    >
      <Dialog.Portal>
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
          <Dialog.Backdrop className={overlayBackdropClassName} style={overlayBackdropStyle} />
          <Dialog.Popup
            initialFocus={textareaRef}
            aria-modal="true"
            aria-describedby={displayError ? errorId : undefined}
            className="relative z-[810] w-full max-w-[520px] rounded-lg border border-border bg-popover p-5 shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]"
          >
        {/* Heading */}
        <Dialog.Title
          id={titleId}
          className="mb-4 text-[18px] font-semibold leading-[1.3] text-popover-foreground"
        >
          {t('viewBuilder.composeAiTitle', 'Compose with AI')}
        </Dialog.Title>

        {/* Textarea */}
        <div className="mb-1 flex flex-col gap-1">
          <label
            id={textareaLabelId}
            htmlFor={`${titleId}-textarea`}
            className="text-[13px] font-medium text-foreground"
          >
            {t('viewBuilder.describeView', 'Describe the view you want')}
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
            placeholder={t('viewBuilder.describeViewPlaceholder', "e.g. show me at-risk projects and this quarter's contract value")}
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
            <span className="text-muted-foreground">{t('viewBuilder.generatingView', 'Generating your view…')}</span>
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
            {t('viewBuilder.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={isLoading || prompt.trim().length === 0}
            onClick={handleGenerate}
            aria-busy={isLoading}
          >
            {isLoading ? t('viewBuilder.generating', 'Generating…') : t('viewBuilder.generate', 'Generate')}
          </Button>
        </div>
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

AIComposerModal.displayName = 'AIComposerModal';

export default AIComposerModal;
