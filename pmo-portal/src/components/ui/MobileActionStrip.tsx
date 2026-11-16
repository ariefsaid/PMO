import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Icon } from './icons';
import { MobileActionBar } from './MobileActionBar';

export interface MobileActionStripProps {
  canSave: boolean;
  canSubmit: boolean;
  /** Why Submit is held, shown above the buttons (e.g. "Enter hours to submit"). */
  hint?: string;
  saving?: boolean;
  submitting?: boolean;
  onSave: () => void;
  onSubmit: () => void;
}

/** Phone-only timesheet completion controls, kept clear of the device safe area. The week total
 *  lives in the day view's pinned head (#2440), so it stays in view while the keyboard is up. */
export const MobileActionStrip: React.FC<MobileActionStripProps> = ({
  canSave,
  canSubmit,
  hint,
  saving = false,
  submitting = false,
  onSave,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const appEnv = (import.meta.env.VITE_APP_ENV ?? '').trim().toLowerCase();
  const hasEnvironmentBadge = appEnv !== '' && appEnv !== 'prod' && appEnv !== 'production';

  return (
    <MobileActionBar
      data-testid="timesheets-mobile-action-strip"
      className="fixed inset-x-0 z-20 border-t border-border bg-background px-3 pt-2 md:hidden"
      style={{
        // #2061: sit above the phone bottom bar (the token is 0px above the phone breakpoint).
        bottom: 'var(--phone-nav-height)',
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${hasEnvironmentBadge ? '2.75rem' : '0.5rem'})`,
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        {hint && <p className="text-center text-control text-muted-foreground">{hint}</p>}
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
