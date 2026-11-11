import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';
import { TextArea } from './FormFields';

export type ReasonKind = 'return' | 'reject';

export interface ReasonDialogProps {
  open: boolean;
  maxLength?: number;
  /** `return` = send back for correction (primary confirm); `reject` = final refusal (destructive confirm). Same layout either way. */
  kind: ReasonKind;
  /** What is being returned or rejected, as a short noun ("timesheet", "purchase request"); fills the default title. */
  subject?: string;
  /** Override the default "Return {subject}" / "Reject {subject}" title. */
  title?: string;
  /** Override the default "Reason for returning" / "Reason for rejecting" field label. */
  label?: string;
  /** The evidence the decision rests on (who, what, how much), shown above the reason box. */
  context?: React.ReactNode;
  confirmLabel?: string;
  /** Confirm in flight: spinner, no close. */
  loading?: boolean;
  /** A failed write, shown under the reason box. */
  error?: React.ReactNode;
  /** Called with the trimmed, non-empty reason. */
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * The ONE Return / Reject dialog: a required reason, a quiet Cancel and a filled confirm, identical for
 * both verbs (screen rule "One name, one look"). Built on ConfirmDialog, so focus trap, Escape, scrim and
 * the phone bottom-sheet come from it. UI only: the caller owns the write and decides where the reason goes.
 */
export const ReasonDialog: React.FC<ReasonDialogProps> = ({
  open,
  maxLength = 1000,
  kind,
  subject = '',
  title,
  label,
  context,
  confirmLabel,
  loading = false,
  error,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('status');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const fieldId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Every open starts empty: a reason typed for one record must never ride along to the next.
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  // Static keys (the i18n guard greps for them): one set of strings per verb.
  const words = kind === 'reject'
    ? {
        title: t('reasonDialog.rejectTitle', 'Reject {{subject}}', { subject }).trim(),
        confirm: t('reasonDialog.rejectConfirm', 'Reject'),
        label: t('reasonDialog.rejectReasonLabel', 'Reason for rejecting'),
        help: t('reasonDialog.rejectReasonHelp', 'The person who submitted it sees this.'),
      }
    : {
        title: t('reasonDialog.returnTitle', 'Return {{subject}}', { subject }).trim(),
        confirm: t('reasonDialog.returnConfirm', 'Return'),
        label: t('reasonDialog.returnReasonLabel', 'Reason for returning'),
        help: t('reasonDialog.returnReasonHelp', 'The person who gets it back sees this.'),
      };
  const trimmed = reason.trim();
  const missing = trimmed === '';
  return (
    <ConfirmDialog
      open={open}
      tone={kind === 'reject' ? 'destructive' : 'default'}
      title={title ?? words.title}
      confirmLabel={confirmLabel ?? words.confirm}
      loading={loading}
      confirmDisabled={missing}
      initialFocus={() => wrapRef.current?.querySelector('textarea') ?? null}
      onConfirm={() => {
        if (missing) {
          setTouched(true);
          return;
        }
        onConfirm(trimmed);
      }}
      onCancel={onCancel}
      description={(
        <div ref={wrapRef} className="space-y-3">
          {context != null && <div className="text-control text-muted-foreground">{context}</div>}
          <TextArea
            id={fieldId}
            label={label ?? words.label}
            helper={words.help}
            required
            fullWidth
            rows={3}
            maxLength={maxLength}
            value={reason}
            disabled={loading}
            onChange={(next) => setReason(next)}
            onBlur={() => setTouched(true)}
            error={touched && missing ? t('reasonDialog.reasonRequired', 'Enter a reason.') : undefined}
          />
        </div>
      )}
      error={error}
    />
  );
};

ReasonDialog.displayName = 'ReasonDialog';
