import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ListState, PageHeader, SelectField, TextField } from '@/src/components/ui';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { useSafetySummary, useSafetySummaryDetail } from '@/src/hooks/useSafetyDays';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { deriveSafetySummaryView, formatSafetyMinutes, toClientExport, type SafetyFigure, type SafetyFigureKey } from '@/src/lib/safetyDay';
import { formatDay } from '@/src/lib/format';
import type { SafetyDetailKind } from '@/src/lib/db/safetyDays';

const DETAIL_KIND: Partial<Record<SafetyFigureKey, SafetyDetailKind>> = {
  lostTimeIncidents: 'lost_time_incidents',
  recordableIncidents: 'recordable_incidents',
  nearMisses: 'near_misses',
  toolboxTalks: 'toolbox_talks',
  completeDays: 'complete_days',
  daysWithoutRecord: 'days_without_record',
};

const FIGURE_LABEL: Record<SafetyFigureKey, string> = {
  workedMinutes: 'Worked hours', safeMinutes: 'Safe hours', lostTimeIncidents: 'Lost-time incidents', recordableIncidents: 'Recordable incidents',
  nearMisses: 'Near misses', toolboxTalks: 'Toolbox talks held', completeDays: 'Complete days', daysWithoutRecord: 'Days worked without a safety record',
};

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/**
 * `/safety` (#2596, FR-DSF-011..014): the monthly safety summary, per project or for the organisation. One database read;
 * every count opens the rows behind it; a figure that cannot be computed is hidden with its reason, never shown as 0.
 * `?view=client` is the read-only page for the client: figures only, no names, no photos, no project.
 */
const SafetySummary: React.FC = () => {
  const { t } = useTranslation('safety');
  const enabled = useOrgSwitch('safetyRecords');
  const [params, setParams] = useSearchParams();
  const client = params.get('view') === 'client';
  const [month, setMonth] = useState(thisMonth());
  const [project, setProject] = useState('');
  const [open, setOpen] = useState<SafetyFigureKey | null>(null);
  const projects = useProjectPickerOptions();
  const monthDate = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
  const summary = useSafetySummary(project || null, monthDate);
  const detail = useSafetySummaryDetail(open ? DETAIL_KIND[open] ?? null : null, project || null, monthDate);

  if (enabled.isPending) return <ListState variant="loading" rows={4} />;
  if (!enabled.data) return <ListState variant="empty" icon="reports" title={t('summary.off', 'Safety records are turned off for this organisation. An Admin can turn them on under Modules.')} />;

  const figures = summary.data ? deriveSafetySummaryView(summary.data) : [];
  const label = (f: SafetyFigure) => t(`summary.figure.${f.key}`, FIGURE_LABEL[f.key]);
  const value = (f: SafetyFigure) => (f.value === null ? '—' : f.unit === 'minutes' ? formatSafetyMinutes(f.value) : String(f.value));
  const hidden = figures.filter((f) => f.hidden);

  return (
    <div className="space-y-6">
      <PageHeader title={t('summary.title', 'Safety summary')}
        action={client
          ? <Button variant="outline" onClick={() => window.print()}>{t('summary.print', 'Print')}</Button>
          : <Button variant="outline" onClick={() => setParams({ view: 'client' })} data-testid="safety-client-view">{t('summary.clientView', 'Client view')}</Button>} />
      <p className="-mt-3 text-control text-muted-foreground">{client ? t('summary.clientSubtitle', 'Figures for the month') : t('summary.subtitle', 'Hours, incidents and safety records for a month.')}</p>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <TextField label={t('summary.month', 'Month')} type="month" value={month} onChange={(v) => { setMonth(v); setOpen(null); }} />
        {!client && (
          <SelectField label={t('summary.project', 'Project')} value={project} onChange={(v) => { setProject(v); setOpen(null); }}
            options={[{ value: '', label: t('summary.allProjects', 'All projects') }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        )}
        {client && <Button variant="ghost" onClick={() => setParams({})}>{t('summary.backToFull', 'Back to the full summary')}</Button>}
      </div>

      {summary.isPending ? <ListState variant="loading" rows={4} />
        : summary.isError ? <ListState variant="error" title={t('summary.error', "Couldn't load the summary")} onRetry={() => void summary.refetch()} />
        : (
          <>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="safety-figures">
              {(client ? deriveSafetySummaryView({ ...summary.data, ...toClientExport(summary.data), timezone: '', projectId: null, hidden: summary.data.hidden }) : figures).map((f) => {
                const kind = DETAIL_KIND[f.key];
                const drill = !client && kind && f.value !== null && f.value > 0;
                return (
                  <li key={f.key} className="flex">
                    <Card className="flex-1">
                      <div className="p-4">
                        <div className="text-control text-muted-foreground">{label(f)}</div>
                        <div className="mt-1 flex min-h-11 items-center justify-between gap-2">
                          <div className="min-w-0 break-words text-metric font-semibold tabular-nums [overflow-wrap:anywhere]" data-testid={`safety-figure-${f.key}`}>{value(f)}</div>
                          {drill && (
                            <button type="button" className="min-h-11 text-right text-control text-primary-text hover:underline" aria-expanded={open === f.key} data-testid={`safety-drill-${f.key}`}
                              onClick={() => setOpen(open === f.key ? null : f.key)}>{t('summary.showRows', 'Show the rows')}</button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
            {hidden.length > 0 && (
              <p className="text-control text-muted-foreground" data-testid="safety-hidden">
                {hidden.map((f) => `${label(f)}: ${f.reason ?? t('summary.hiddenDefault', 'cannot be computed for this period')}`).join(' · ')}
              </p>
            )}
            {open && (
              <Card>
                <div className="p-4" data-testid="safety-detail">
                  <h2 className="text-group font-semibold">{t(`summary.figure.${open}`, FIGURE_LABEL[open])}</h2>
                  {detail.isPending ? <ListState variant="loading" rows={2} />
                    : detail.isError ? <ListState variant="error" title={t('summary.detailError', "Couldn't load the rows")} onRetry={() => void detail.refetch()} />
                    : (
                      <div className="relative mt-4 overflow-x-auto" role="region" aria-label={t(`summary.figure.${open}`, FIGURE_LABEL[open])} tabIndex={0}>
                        <table className="w-full text-control">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th scope="col" className="py-2 pr-4 font-medium">{t('day.date', 'Date')}</th>
                              <th scope="col" className="py-2 pr-4 font-medium">{t('summary.record', 'Record')}</th>
                              <th scope="col" className="py-2 font-medium">{t('summary.workOrder', 'Work order')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {detail.data.map((r, i) => (
                              <tr key={`${r.ref_id ?? r.date}-${i}`} data-testid="safety-detail-row">
                                <td className="py-2 pr-4 tabular-nums">{formatDay(r.date)}</td>
                                <td className="py-2 pr-4">{r.label}</td>
                                <td className="py-2">{r.work_order_id && <Link to={`/work-orders/${r.work_order_id}`} className="text-primary-text hover:underline">{t('summary.workOrder', 'Work order')}</Link>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>
              </Card>
            )}
          </>
        )}
    </div>
  );
};
export default SafetySummary;
