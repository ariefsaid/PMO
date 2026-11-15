import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextArea } from '@/src/components/ui';

export interface InlineReturnProps {
  /** What is returned, as a short noun ("purchase request"); fills the shared "Return {subject}" title. */
  subject: string;
  /** The evidence the decision rests on (what · how much), shown above the reason. */
  context?: React.ReactNode;
  /** Return in flight. */
  loading?: boolean;
  /** A failed write, shown under the reason. The typed reason stays. */
  error?: React.ReactNode;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  /** Drawn inside a bar that already frames it (the phone sheet): no box of its own. */
  bare?: boolean;
}

/**
 * Return, asked in place: the same reason field, quiet Cancel and filled Return as the one Return dialog
 * (`ReasonDialog`, same words), drawn where the decision already is so the evidence stays in view.
 * The reason lives here until the caller unmounts it (another item, a success); a failed write keeps it.
 */
export const InlineReturn: React.FC<InlineReturnProps> = ({ subject, context, loading = false, error, onConfirm, onCancel, bare = false }) => {
  const { t } = useTranslation(['status', 'common']);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const fieldId = useId();
  const titleId = useId();
  const wrapRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    wrapRef.current?.querySelector('textarea')?.focus();
  }, []);

  const trimmed = reason.trim();
  const missing = trimmed === '';
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (missing) {
      setTouched(true);
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <form
      ref={wrapRef}
      role="group"
      aria-labelledby={titleId}
      data-testid="inline-return"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !loading) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={bare ? 'space-y-3' : 'space-y-3 rounded-lg border border-border bg-card p-3'}
    >
      <h3 id={titleId} className="text-base font-semibold">
        {t('reasonDialog.returnTitle', 'Return {{subject}}', { subject }).trim()}
      </h3>
      {context != null && <p className="text-control text-muted-foreground">{context}</p>}
      <TextArea
        id={fieldId}
        label={t('reasonDialog.returnReasonLabel', 'Reason for returning')}
        helper={t('reasonDialog.returnReasonHelp', 'The person who gets it back sees this.')}
        required
        fullWidth
        rows={3}
        maxLength={1000}
        value={reason}
        disabled={loading}
        onChange={(next) => setReason(next)}
        onBlur={() => setTouched(true)}
        error={touched && missing ? t('reasonDialog.reasonRequired', 'Enter a reason.') : undefined}
        className="max-lg:text-[16px]"
      />
      {error != null && error !== '' && (
        <p role="alert" className="text-control text-destructive-text">{error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" className="max-lg:min-h-11" onClick={onCancel} disabled={loading}>
          {t('common:entityForm.cancel', 'Cancel')}
        </Button>
        <Button type="submit" variant="primary" className="max-lg:min-h-11" loading={loading} disabled={missing}>
          {t('reasonDialog.returnConfirm', 'Return')}
        </Button>
      </div>
    </form>
  );
};
