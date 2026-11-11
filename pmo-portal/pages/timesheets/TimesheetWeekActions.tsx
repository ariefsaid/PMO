import { useTranslation } from 'react-i18next';
import { Button, FormFooter, Icon, MobileActionStrip } from '@/src/components/ui';

type Props = {
  mode: 'desktop' | 'mobile';
  total: number;
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

export function TimesheetWeekActions({ mode, total, dirty, editValid, canSubmit, hasHours, hasEntries, saving, submitting, deleting, isReconciling, onSave, onSubmit }: Props) {
  const { t } = useTranslation(['common', 'timesheets']);
  if (mode === 'mobile') return (
    <MobileActionStrip
      total={total}
      canSave={dirty && editValid && !saving && !deleting && !isReconciling}
      canSubmit={canSubmit && !submitting && !deleting && !isReconciling}
      showSubmitHint={!hasHours && !hasEntries}
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
      hint={!canSubmit ? t('timesheets.enterHoursToSubmit', 'Enter hours to submit') : undefined}
    >
      <Button variant="outline" onClick={onSave} disabled={!dirty || !editValid || saving || deleting || isReconciling} loading={saving}>
        <Icon name="check" />{t('timesheets.save', 'Save')}
      </Button>
      <Button variant="primary" onClick={onSubmit} disabled={!canSubmit || submitting || deleting || isReconciling} loading={submitting}>
        <Icon name="check" />{t('timesheets.submit', 'Submit timesheet')}
      </Button>
    </FormFooter>
  );
}
