import { useTranslation } from 'react-i18next';
import { Button, FormFooter, Icon, MobileActionStrip } from '@/src/components/ui';

type Props = {
  mode: 'desktop' | 'mobile';
  dirty: boolean;
  editValid: boolean;
  canSubmit: boolean;
  hasHours: boolean;
  hasEntries: boolean;
  saving: boolean;
  submitting: boolean;
  deleting: boolean;
  isReconciling: boolean;
  onSave: () => void;
  onSubmit: () => void;
};

export function TimesheetWeekActions({ mode, dirty, editValid, canSubmit, hasHours, hasEntries, saving, submitting, deleting, isReconciling, onSave, onSubmit }: Props) {
  const { t } = useTranslation(['common', 'timesheets']);
  const fixHint = t('timesheets:footer.fixHoursToSubmit', 'Fix the hours marked in red to submit');
  if (mode === 'mobile') return (
    <MobileActionStrip
      canSave={dirty && editValid && !saving && !deleting && !isReconciling}
      canSubmit={canSubmit && !submitting && !deleting && !isReconciling}
      hint={!editValid ? fixHint : !hasHours && !hasEntries ? t('timesheets.enterHoursToSubmit', 'Enter hours to submit') : undefined}
      saving={saving}
      submitting={submitting}
      onSave={onSave}
      onSubmit={onSubmit}
    />
  );
  // Desktop: the shared sticky form footer (R2-c2c) — the ONE place for the week's actions,
  // pinned to the viewport bottom for long weeks. Save is secondary, Submit the primary (rightmost).
  return (
    <FormFooter
      testId="timesheets-footer"
      className="px-3.5"
      hint={!editValid
        ? fixHint
        : !canSubmit ? t('timesheets.enterHoursToSubmit', 'Enter hours to submit') : undefined}
    >
      <Button variant="outline" onClick={onSave} disabled={!dirty || !editValid || saving || deleting || isReconciling} loading={saving}>
        <Icon name="check" aria-hidden />{t('timesheets.saveDraft', 'Save draft')}
      </Button>
      <Button variant="primary" onClick={onSubmit} disabled={!canSubmit || submitting || deleting || isReconciling} loading={submitting}>
        <Icon name="check" aria-hidden />{t('timesheets.submitWeek', 'Submit week')}
      </Button>
    </FormFooter>
  );
}
