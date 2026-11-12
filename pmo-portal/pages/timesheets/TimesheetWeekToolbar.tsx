import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Icon, PageHeader, Toolbar } from '@/src/components/ui';

type Props = {
  weekRangeLabel: string;
  isApprover: boolean;
  /** Known count of sheets awaiting approval; null while the read has not landed (no count shown). */
  pendingCount: number | null;
  busy: boolean;
  stepWeek: (delta: number) => void;
  pendingWeekDelta: number | null;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
};

export function TimesheetWeekToolbar({ weekRangeLabel, isApprover, pendingCount, busy, stepWeek, pendingWeekDelta, onCancelDiscard, onConfirmDiscard }: Props) {
  const { t } = useTranslation(['common', 'timesheets']);
  // ── Page head + toolbar (shared by both views) ──────────────────────────────
  const stepper = (
        <span className="ml-auto inline-flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('timesheets.previousWeek', 'Previous week')}
            disabled={busy}
            onClick={() => stepWeek(-1)}
          >
            {/* E30: matched chevrons — previous was an arrow ("back") while next was a chevron. */}
            <Icon name="chev" className="rotate-180" />
          </Button>
          <span className="px-2 text-control font-medium tabular text-foreground">{weekRangeLabel}</span>
          <Button variant="outline" size="icon" aria-label={t('timesheets.nextWeek', 'Next week')} disabled={busy} onClick={() => stepWeek(1)}>
            <Icon name="chev" />
          </Button>
        </span>
  );
  return (
    <>
      <PageHeader title={t('timesheets.title', 'Timesheets')} />

      {isApprover ? (
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
              className="inline-flex h-8 items-center rounded-md bg-accent px-2.5 text-control font-semibold text-foreground"
            >
              {t('uxs28.nav.myTime', 'My time')}
            </span>
            <Link
              to="/approvals?scope=timesheets"
              className="touch-target inline-flex h-8 items-center rounded-md px-2.5 text-control font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {pendingCount !== null && pendingCount > 0
                ? t('uxs28.nav.teamReviewAwaiting', 'Team review · {{n}} awaiting', { n: String(pendingCount) })
                : t('uxs28.nav.teamReview', 'Team review')}
            </Link>
          </nav>
        )}
        {stepper}
      </Toolbar>
      ) : <div className="mb-3 flex justify-end">{stepper}</div>}
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
