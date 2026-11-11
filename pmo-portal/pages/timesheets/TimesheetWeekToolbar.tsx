import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Icon, Toolbar } from '@/src/components/ui';
import { formatMonthDay } from '@/src/lib/format';

type Props = {
  weekRangeLabel: string;
  isApprover: boolean;
  pendingCount: number;
  weekStartDate: Date;
  busy: boolean;
  stepWeek: (delta: number) => void;
  pendingWeekDelta: number | null;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
};

export function TimesheetWeekToolbar({ weekRangeLabel, isApprover, pendingCount, weekStartDate, busy, stepWeek, pendingWeekDelta, onCancelDiscard, onConfirmDiscard }: Props) {
  const { t } = useTranslation(['common', 'timesheets']);
  // ── Page head + toolbar (shared by both views) ──────────────────────────────
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">
            {t('timesheets.title', 'Timesheets')}
          </h1>
          <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">
            {t(
              'timesheets.subtitle',
              'Week of {{range}}. Enter hours per project per day, then submit the whole week for your line manager to approve.',
              { range: weekRangeLabel },
            )}
          </p>
        </div>
      </div>

      <Toolbar standalone>
        {/* CW-6: the approvals queue has ONE home at /approvals. Approvers get a cross-link
            there (scoped to timesheets) instead of an in-page queue tab — so this page no longer
            competes as a second approvals surface. Non-approvers (Engineer) see no link at all. */}
        {/* UX-062: two named jobs. My time is this page; Team review is the canonical Approvals
            inbox (scoped to timesheets), one click away. Engineers get no switch (no review job). */}
        {isApprover && (
          <nav
            aria-label={t('uxs28.nav.label', 'Timesheet views')}
            className="inline-flex items-center gap-1"
          >
            <span
              aria-current="page"
              className="inline-flex h-8 items-center rounded-md bg-accent px-2.5 text-[13px] font-semibold text-foreground"
            >
              {t('uxs28.nav.myTime', 'My time')}
            </span>
            <Link
              to="/approvals?scope=timesheets"
              className="touch-target inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              {pendingCount > 0
                ? t('uxs28.nav.teamReviewAwaiting', 'Team review · {{n}} awaiting', { n: String(pendingCount) })
                : t('uxs28.nav.teamReview', 'Team review')}
              <Icon name="chev" aria-hidden />
            </Link>
          </nav>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('timesheets.previousWeek', 'Previous week')}
            disabled={busy}
            onClick={() => stepWeek(-1)}
          >
            <Icon name="back" />
          </Button>
          <span className="px-2 text-[13px] font-medium tabular text-muted-foreground">
            {t('timesheets.weekOf', 'Week of')} {formatMonthDay(weekStartDate)}
          </span>
          <Button variant="outline" size="icon" aria-label={t('timesheets.nextWeek', 'Next week')} disabled={busy} onClick={() => stepWeek(1)}>
            <Icon name="chev" />
          </Button>
        </span>
      </Toolbar>
      {pendingWeekDelta !== null && (
        <ConfirmDialog
          open tone="destructive"
          title={t('timesheets:discardWeek.title', 'Discard unsaved changes?')}
          description={t('timesheets:discardWeek.description', 'Your unsaved hours for this week will be discarded.')}
          confirmLabel={t('timesheets:discardWeek.confirm', 'Discard changes')}
          onCancel={onCancelDiscard}
          onConfirm={onConfirmDiscard}
        />
      )}
    </>
  );

}
