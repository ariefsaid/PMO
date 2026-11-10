import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';
import { TextArea } from './FormFields';

export type ReasonKind = 'return' | 'reject';

export interface ReasonDialogProps {
  open: boolean;
  /** `return` = send back for correction (primary confirm); `reject` = final refusal (destructive confirm). Same layout either way. */
  kind: ReasonKind;
  /** What is being returned or rejected, as a short noun ("timesheet", "purchase request"); fills the default title. */
  subject?: string;
  /** Override the default "Return {subject}" / "Reject {subject}" title. */
  title?: string;
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
  kind,
  subject = '',
  title,
  context,
  confirmLabel,
  loading = false,
  error,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
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

  const trimmed = reason.trim();
  const missing = trimmed === '';
  return (
    <ConfirmDialog
      open={open}
      tone={kind === 'reject' ? 'destructive' : 'default'}
      title={title ?? t(`reasonDialog.${kind}.title`, kind === 'reject' ? 'Reject {{subject}}' : 'Return {{subject}}', { subject }).trim()}
      confirmLabel={confirmLabel ?? t(`reasonDialog.${kind}.confirm`, kind === 'reject' ? 'Reject' : 'Return')}
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
          {context != null && <div className="text-support text-muted-foreground">{context}</div>}
          <TextArea
            id={fieldId}
            label={t(`reasonDialog.${kind}.reasonLabel`, kind === 'reject' ? 'Reason for rejecting' : 'Reason for returning')}
            helper={t(`reasonDialog.${kind}.reasonHelp`, kind === 'reject' ? 'The person who submitted it sees this.' : 'The person who gets it back sees this.')}
            required
            fullWidth
            rows={3}
            maxLength={1000}
            value={reason}
            disabled={loading}
            onChange={(next) => setReason(next)}
            onBlur={() => setTouched(true)}
            error={touched && missing ? t('reasonDialog.reasonRequired', 'Enter a reason.') : undefined}
          />
          {error != null && <div role="alert" className="text-support text-destructive-text">{error}</div>}
        </div>
      )}
    />
  );
};

ReasonDialog.displayName = 'ReasonDialog';
