/**
 * PromptBar — the message input area for the AssistantPanel: one rounded field, the text on top
 * and one action row under it (attach left, Send or Stop right).
 * Explicit label for a11y (NFR-AP-A11Y-003).
 * Enter-to-send, Shift+Enter for newline (FR-AP-009).
 * Single button slot: Send or Stop (FR-AP-010/011/012).
 *
 * Focus (#2047 accessibility audit): the textarea stays in the tab order through a run (read-only,
 * not disabled) and focus returns to it when the run starts or ends, so a keyboard user never
 * lands on <body> after sending. Only the hard out-of-credits state disables it.
 * Adapted from MIT-licensed sources; notice in ./THIRD_PARTY_NOTICE.md.
 */
import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { FileInput, TextArea } from '@/src/components/ui/FormFields';
import type { ClassifiedUploadError } from '@/src/lib/uploadTransport';
import {
  AGENT_ATTACHMENT_ACCEPT,
  classifyAttachmentError,
  getAgentAttachmentContentType,
} from '@/src/lib/agent/attachmentMime';
import { transcodeImage } from '@/src/lib/agent/transcodeImage';

export interface PromptBarProps {
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
  /** Optional Tier-2 attachment hook seam. When absent, the composer stays text-only. */
  onAttachFile?: (file: File) => void | Promise<void>;
  onAttachmentError?: (error: ClassifiedUploadError) => void;
  /** True while an attachment is uploading: Send/Enter wait so the file goes with the message. */
  uploading?: boolean;
}

export const PromptBar: React.FC<PromptBarProps> = ({
  value,
  onChange,
  onSend,
  onStop,
  running,
  needsApproval = false,
  textareaRef,
  disabled = false,
  onAttachFile,
  onAttachmentError,
  uploading = false,
}) => {
  const { t } = useTranslation('assistantPanel');
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resolvedRef = textareaRef ?? internalRef;
  const rootRef = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(running);

  // Send and Stop swap in the same slot, so the pressed button unmounts and focus would drop to
  // <body>. When a run starts or ends, put focus back in the textarea unless the user has moved
  // it somewhere else on purpose.
  useEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    const el = resolvedRef.current;
    if (!el || disabled) return;
    const active = document.activeElement;
    if (!active || active === document.body || rootRef.current?.contains(active)) el.focus();
  }, [running, disabled, resolvedRef]);

  // Auto-grow the textarea up to a reasonable max
  useEffect(() => {
    const el = resolvedRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, running, resolvedRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!running && !disabled && !uploading && value.trim().length > 0) {
        e.preventDefault();
        onSend();
      }
    }
  };

  const composerId = 'assistant-composer-textarea';
  const attachmentsEnabled = Boolean(onAttachFile);
  const inputDisabled = running || disabled;

  // IMPORTANT-3 (review, FR-AT2-ATT-009): useAgentAttachments is the SOLE owner of upload-error
  // classification (classifyUploadError → timeout/cancel/network/server). acceptFile classifies
  // only the PromptBar-owned pre-upload steps (oversize/disallowed MIME + transcode failure) and
  // then hands the file to onAttachFile; an upload failure is already recorded as a classified
  // error inside the hook BEFORE it rejects, so we deliberately do NOT translate/override it here
  // (translating would collapse timeout/cancel/network guidance to a generic 'server' message).
  const acceptFile = useCallback(
    async (selected: File) => {
      if (!onAttachFile || inputDisabled) return;

      const classified = classifyAttachmentError(selected);
      if (classified) {
        onAttachmentError?.(classified);
        return;
      }

      const contentType = getAgentAttachmentContentType(selected);
      let fileToUpload: File = selected;
      if (contentType?.startsWith('image/')) {
        try {
          fileToUpload = await transcodeImage(selected);
        } catch {
          // Transcode failure is PromptBar-owned (the file could not be turned into an uploadable
          // image) — surface a transcode-specific error, distinct from the upload path.
          onAttachmentError?.({
            type: 'type',
            message: 'Could not process this image. Try a different file.',
          });
          return;
        }
      }

      // Upload path: the hook owns classification. A rejection already set the hook's classified
      // error; do not override it. (onAttachFile may return void or a Promise — wrap so a void
      // return does not throw.)
      Promise.resolve(onAttachFile(fileToUpload)).catch(() => {
        /* classified error already recorded by useAgentAttachments */
      });
    },
    [onAttachFile, onAttachmentError, inputDisabled],
  );

  const handleAttachChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (selected) void acceptFile(selected);
  };

  // IMPORTANT-9 (FR-AT2-ATT-001): the composer is a drag-drop target. Dropped files route through
  // the SAME acceptFile path the attach button uses (classify → transcode → onAttachFile), so a
  // drop and a click produce identical upload behavior. Progress/errors are announced via the
  // existing AssistantPanel attachment live region (reads useAgentAttachments state).
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!attachmentsEnabled || inputDisabled) return;
    // preventDefault is required to allow a subsequent drop.
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!attachmentsEnabled || inputDisabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) void acceptFile(file);
  };

  const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  // One field. Phone: attach, text and Send share one row (a 69px footer, not 126). From 640px:
  // the text on top, attach and Send in a row under it.
  return (
    <div
      ref={rootRef}
      className="border-t border-border p-4"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-1 rounded-lg border border-input px-2 pb-1.5 focus-within:ring-2 sm:pb-2',
          running ? 'bg-muted focus-within:ring-ring/40' : 'bg-background focus-within:ring-ring',
        )}
      >
        <TextArea
          id={composerId}
          ref={resolvedRef}
          label="Ask a question"
          hideLabel
          wrapperClassName="col-start-2 row-start-1 min-w-0 sm:col-span-3 sm:col-start-1"
          unstyled
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          // The textarea stays focusable during a run: read-only, not disabled (#2047). The
          // placeholder says why keys do nothing.
          readOnly={running}
          // NFR-AW-A11Y-003: explicit aria-disabled in needs-approval phase so screen
          // readers can distinguish "awaiting decision" from "streaming" (Blocker-7).
          aria-disabled={needsApproval ? 'true' : undefined}
          maxLength={2000}
          // Two rows while the run-locked placeholder shows, so its second line is not clipped.
          rows={running && value.length === 0 ? 2 : 1}
          placeholder={
            running
              ? t('promptBar.running', 'Working on your answer… Stop to ask something else')
              : 'Ask a question…'
          }
          className="block max-h-40 min-h-0 w-full resize-none bg-transparent px-2 pb-1 pt-2.5 text-sm text-foreground placeholder:text-muted-foreground read-only:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:pt-3"
          aria-label="Ask a question"
        />
        {attachmentsEnabled && (
          <>
            <FileInput
              ref={fileInputRef}
              accept={AGENT_ATTACHMENT_ACCEPT}
              // IMPORTANT-4: the visible button is the SOLE accessible "Attach file" control.
              // The hidden input stays functional (programmatic click + Playwright setInputFiles)
              // but is removed from the a11y + tab tree so it does not double the accessible name
              // (Chromium otherwise exposes a file input as role=button, creating two same-named
              // controls). Keep it out of the tab order; the button focuses+activates it.
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              disabled={inputDisabled}
              onChange={handleAttachChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={inputDisabled}
              aria-label="Attach file"
              title="Attach file"
              className={cn(
                'touch-target col-start-1 row-start-1 grid size-8 shrink-0 place-items-center self-end rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:row-start-2 [&_svg]:size-4',
                focusRing,
              )}
            >
              <Icon name="upload" />
            </button>
          </>
        )}
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className={cn(
              'col-start-3 row-start-1 shrink-0 self-end rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent sm:row-start-2',
              focusRing,
            )}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={value.trim().length === 0 || disabled || uploading}
            aria-label="Send message"
            // F1 (Discover finding): the disabled Send button must NOT remain brand-blue at
            // opacity-50 (`disabled` here is the FR-AUC-016 out-of-credits hard-disable — the
            // repo's `cn` is clsx-only, no tailwind-merge, so `bg-primary` is conditionally
            // OMITTED rather than relying on later-cascade `disabled:*` classes to win).
            className={cn(
              'col-start-3 row-start-1 shrink-0 self-end rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed sm:row-start-2',
              focusRing,
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
