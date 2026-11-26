import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardPad, Combobox, ListState, type ComboboxOption } from '@/src/components/ui';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useWorkOrderEffectiveHours } from '@/src/hooks/useIssueClosingReport';
import { formatDay } from '@/src/lib/format';

/** Hours with one decimal from minutes; null stays null (never 0). */
const hours = (minutes: number | null): string | null => (minutes === null ? null : (minutes / 60).toFixed(1));

const MAX_RANGE_DAYS = 366;

function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Effective working hours of one work order per day, shown beside the closing-time table (issue-closing-measure,
 * FR-ICM-013): the validated daily site report's site day minus its stopped time. It follows the closing report's own
 * gate (it renders only inside the enabled report) and the report's date range. Read-only; nothing is entered here.
 */
export const EffectiveHoursPanel: React.FC<{ from?: string; to?: string }> = ({ from, to }) => {
  const { t } = useTranslation('incidents');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);

  const { data: projectOptions } = useProjectOptions();
  const loadProjects = useCallback(async (): Promise<ComboboxOption[]> => projectOptions ?? [], [projectOptions]);
  const workOrders = useProjectWorkOrders(projectId ?? '');
  const workOrderOptions = useMemo<ComboboxOption[]>(
    () => (workOrders.data ?? []).filter((wo) => wo.status !== 'Cancelled')
      .map((wo) => ({ value: wo.id, label: wo.wo_number ?? wo.title, sub: wo.wo_number ? wo.title : undefined })),
    [workOrders.data],
  );
  const loadWorkOrders = useCallback(async () => workOrderOptions, [workOrderOptions]);

  const rangeOk = Boolean(from && to && to >= from && rangeDays(from, to) <= MAX_RANGE_DAYS);
  const query = useWorkOrderEffectiveHours(workOrderId ?? undefined, rangeOk ? from : undefined, rangeOk ? to : undefined);
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const totals = useMemo(() => rows.reduce((a, r) => ({
    worked: a.worked + (r.worked_minutes ?? 0),
    stopped: a.stopped + r.stopped_minutes,
    effective: a.effective + (r.effective_minutes ?? 0),
  }), { worked: 0, stopped: 0, effective: 0 }), [rows]);

  return (
    <Card>
      <CardPad className="space-y-4" data-testid="effective-hours-panel">
        <div>
          <h2 className="text-group font-semibold tracking-[-0.01em]">{t('effectiveHours.title', 'Effective working hours')}</h2>
          <p className="mt-3 max-w-prose text-control text-muted-foreground">
            {t('effectiveHours.basis', 'Per day for one work order: the site day from the validated daily report, minus the stopped time recorded on it.')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Combobox
            label={t('effectiveHours.project', 'Project')}
            noun={t('effectiveHours.projectNoun', 'project')}
            placeholder={t('effectiveHours.projectPlaceholder', 'Choose a project…')}
            value={projectId}
            selectedOption={(projectOptions ?? []).find((o) => o.value === projectId) ?? null}
            onChange={(v) => { setProjectId(v || null); setWorkOrderId(null); }}
            loadOptions={loadProjects}
          />
          <Combobox
            label={t('effectiveHours.workOrder', 'Work order')}
            noun={t('effectiveHours.workOrderNoun', 'work order')}
            placeholder={projectId ? t('effectiveHours.workOrderPlaceholder', 'Choose a work order…') : t('effectiveHours.workOrderNeedsProject', 'Choose a project first')}
            value={workOrderId}
            selectedOption={workOrderOptions.find((o) => o.value === workOrderId) ?? null}
            onChange={(v) => setWorkOrderId(v || null)}
            loadOptions={loadWorkOrders}
            disabled={!projectId}
          />
        </div>

        {!workOrderId ? (
          <p className="text-control text-muted-foreground" data-testid="effective-hours-hint">
            {t('effectiveHours.pickHint', 'Choose a project and a work order to see its effective hours for the date range above.')}
          </p>
        ) : !rangeOk ? (
          <p className="text-control text-muted-foreground" data-testid="effective-hours-range">
            {t('effectiveHours.rangeHint', 'Choose a date range of at most 366 days above (not "All time") to see effective hours.')}
          </p>
        ) : query.isPending ? (
          <ListState variant="loading" shape="table" rows={3} />
        ) : query.isError ? (
          <ListState
            variant="error"
            title={t('error.title', "Couldn't load report")}
            sub={t('error.sub', 'The request failed. Check your connection and try again.')}
            onRetry={() => query.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-control text-muted-foreground" data-testid="effective-hours-empty">
            {t('effectiveHours.empty', 'No validated daily report for this work order in this range.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-control" data-testid="effective-hours-table">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('effectiveHours.col.day', 'Day')}</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">{t('effectiveHours.col.worked', 'Worked (hrs)')}</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">{t('effectiveHours.col.stopped', 'Stopped (hrs)')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('effectiveHours.col.effective', 'Effective (hrs)')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.work_date}>
                    <th scope="row" className="py-2 pr-4 text-left font-medium">{formatDay(r.work_date)}</th>
                    {r.has_times ? (
                      <>
                        <td className="tabular py-2 pr-4 text-right">{hours(r.worked_minutes)}</td>
                        <td className="tabular py-2 pr-4 text-right">{hours(r.stopped_minutes)}</td>
                        <td className="tabular py-2 text-right font-medium">{hours(r.effective_minutes)}</td>
                      </>
                    ) : (
                      <>
                        <td colSpan={2} className="py-2 pr-4 text-right text-muted-foreground">{t('effectiveHours.noTimes', 'Times not entered')}</td>
                        <td className="tabular py-2 text-right text-muted-foreground">{t('effectiveHours.stoppedOnly', '{{hours}} stopped', { hours: hours(r.stopped_minutes) })}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <th scope="row" className="py-2 pr-4 text-left">{t('effectiveHours.total', 'Total')}</th>
                  <td className="tabular py-2 pr-4 text-right">{hours(totals.worked)}</td>
                  <td className="tabular py-2 pr-4 text-right">{hours(totals.stopped)}</td>
                  <td className="tabular py-2 text-right">{hours(totals.effective)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardPad>
    </Card>
  );
};

export default EffectiveHoursPanel;
