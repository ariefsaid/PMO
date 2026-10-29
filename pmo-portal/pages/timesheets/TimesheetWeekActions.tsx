import { useTranslation } from 'react-i18next';
import { Button, Icon, MobileActionStrip } from '@/src/components/ui';

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
  return (
    <div data-testid="timesheets-footer" className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3.5 py-2.5">
      {!canSubmit && <span className="mr-auto text-[13px] text-muted-foreground">{t('timesheets.enterHoursToSubmit', 'Enter hours to submit')}</span>}
      <Button variant="outline" onClick={onSave} disabled={!dirty || !editValid || saving || deleting || isReconciling} loading={saving}>
        <Icon name="check" />{t('timesheets.save', 'Save')}
      </Button>
      <Button variant="primary" onClick={onSubmit} disabled={!canSubmit || submitting || deleting || isReconciling} loading={submitting}>
        <Icon name="check" />{t('timesheets.submit', 'Submit timesheet')}
      </Button>
    </div>
  );
}
