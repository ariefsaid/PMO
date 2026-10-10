import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumberExact } from '@/src/lib/format';
import { Button } from './Button';
import { Icon } from './icons';
import { MobileActionBar } from './MobileActionBar';

export interface MobileActionStripProps {
  total: number;
  canSave: boolean;
  canSubmit: boolean;
  showSubmitHint?: boolean;
  saving?: boolean;
  submitting?: boolean;
  onSave: () => void;
  onSubmit: () => void;
}

/** Phone-only timesheet completion controls, kept clear of the device safe area. */
export const MobileActionStrip: React.FC<MobileActionStripProps> = ({
  total,
  canSave,
  canSubmit,
  showSubmitHint = false,
  saving = false,
  submitting = false,
  onSave,
  onSubmit,
}) => {
  const { t } = useTranslation();

  return (
    <MobileActionBar
      data-testid="timesheets-mobile-action-strip"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-3 pt-2 md:hidden"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <p className="text-center text-[13px] font-semibold tabular text-foreground">
          {t('timesheets.hoursThisWeek', '{{hours}} hours this week', {
            hours: formatNumberExact(total),
          })}
        </p>
        {showSubmitHint && (
          <p className="text-center text-[12px] text-muted-foreground">
            {t('timesheets.enterHoursToSubmit', 'Enter hours to submit')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="touch-target w-full"
            onClick={onSave}
            disabled={!canSave || saving || submitting}
            loading={saving}
          >
            <Icon name="check" aria-hidden />
            {t('timesheets.saveDraft', 'Save draft')}
          </Button>
          <Button
            variant="primary"
            className="touch-target w-full"
            onClick={onSubmit}
            disabled={!canSubmit || saving || submitting}
            loading={submitting}
          >
            <Icon name="check" aria-hidden />
            {t('timesheets.submitWeek', 'Submit week')}
          </Button>
        </div>
      </div>
    </MobileActionBar>
  );
};
