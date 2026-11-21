import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, PageHeader } from '@/src/components/ui';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { Combobox, type ComboboxOption } from '@/src/components/ui/Combobox';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { BillingPlanSettingsModal } from '@/src/components/finance/BillingPlanSettingsModal';
import { useBillingPlanCandidates, useBillingPlanSettings } from '@/src/hooks/useBillingPlan';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { addMonths, groupByProject, monthOf, overClaimWarning, planTotals, resolveTarget, type PlanCandidate } from '@/src/lib/billingPlan';
import { PLAN_LIMIT } from '@/src/lib/db/billingPlan';
import { formatCurrency, formatMonthYearShort, formatNumberExact } from '@/src/lib/format';

/**
 * #2682 — the monthly billing plan (docs/specs/monthly-billing-plan.spec.md): accepted-not-yet-claimed work as a pick list against the
 * month's target. Candidates only: ticks are view state (nothing is stored), nothing here raises a claim or an invoice, and over-claim
 * is a warning, never a block. The age cell of each line is the place #2675 adds "done, not yet claimed: N days".
 */

const LineRow: React.FC<{ c: PlanCandidate; picked: boolean; onToggle: () => void }> = ({ c, picked, onToggle }) => {
  const { t } = useTranslation('finance');
  const title = c.kind === 'line' ? `${c.itemCode ?? ''} ${c.description ?? ''}`.trim() : (c.description ?? '');
  const warn = picked && overClaimWarning(c);
  return (
    <li data-testid="billing-plan-line" className="flex min-h-11 items-start gap-3 border-b border-border py-2 last:border-b-0">
      <Checkbox checked={picked} onChange={onToggle} label={t('billingPlan.pick', { defaultValue: 'Pick {{item}}', item: title })} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-control font-medium">{title}</span>
        <span className="block text-control text-muted-foreground">
          {c.woNumber ? t('billingPlan.workOrder', { defaultValue: 'Work order {{number}}', number: c.woNumber }) : t('billingPlan.noWorkOrderNumber', 'Work order')}
          {c.kind === 'order' && ` · ${t('billingPlan.moneyOnly', 'No contract lines')}`}
          {c.kind === 'line' && c.unclaimedQuantity !== null && ` · ${t('billingPlan.unclaimedQty', { defaultValue: '{{qty}} {{unit}} accepted, not claimed', qty: formatNumberExact(c.unclaimedQuantity), unit: c.unit ?? '' })}`}
        </span>
        {warn && (
          <StatusPill variant="overdue" data-testid="billing-plan-overclaim">
            {t('billingPlan.overClaimed', 'Over-claimed: this would pass the contract quantity')}
          </StatusPill>
        )}
      </div>
      {/* #2675: the age of "done, not yet claimed" goes in this cell. */}
      <span data-testid="billing-plan-age-slot" className="hidden" />
      <span className="tabular-nums text-control font-medium">{formatCurrency(c.value, c.currency)}</span>
    </li>
  );
};

const BillingPlan: React.FC = () => {
  const { t } = useTranslation('finance');
  const may = usePermission();
  const orgCurrency = useOrgCurrency();
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const all = useBillingPlanCandidates(null);
  const settingsQuery = useBillingPlanSettings();
  const wantedProject = params.get('project');
  const projectOptions: ComboboxOption[] = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of all.data?.rows ?? []) seen.set(r.projectId, r.projectName);
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all.data]);
  const projectId = wantedProject && projectOptions.some((o) => o.value === wantedProject) ? wantedProject : null;
  const filtered = useBillingPlanCandidates(projectId, projectId !== null);
  const query = projectId ? filtered : all;
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const groups = useMemo(() => groupByProject(rows), [rows]);

  // The month on screen starts at the organisation's today (from the server), never the device clock.
  const today = all.data?.rows[0]?.today ?? null;
  const [offset, setOffset] = useState(0);
  const month = today ? addMonths(monthOf(today), offset) : null;
  const settings = settingsQuery.data ?? null;
  const target = month && settings ? resolveTarget(settings, settings.monthTargets, month) : null;
  const totals = useMemo(() => planTotals(rows, picked, target), [rows, picked, target]);
  const monthLabel = month ? formatMonthYearShort(month) : '';

  const setProject = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set('project', value); else next.delete('project');
    setParams(next, { replace: true });
  };
  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const setMany = (keys: string[], on: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    return next;
  });
  const fmt = (n: number, cur: string | null) => formatCurrency(n, cur ?? orgCurrency);

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('billingPlan.title', 'Billing plan')}
        count={query.isSuccess ? rows.length : undefined}
        action={may('edit', 'billingStage') && settings
          ? <Button variant="outline" onClick={() => setEditing(true)} data-testid="billing-plan-settings-button">{t('billingPlan.settings.open', 'Plan settings')}</Button>
          : undefined}
      />
      <p data-testid="billing-plan-statement" className="mb-4 text-control text-muted-foreground">
        {t('billingPlan.statement', 'Candidates only. Nothing here raises a claim or an invoice.')} {t('billingPlan.ticksNote', 'Your picks are not saved; they reset when you leave this page.')}
      </p>

      <section aria-label={t('billingPlan.summary', 'Month summary')} data-testid="billing-plan-summary" className="sticky top-0 z-10 mb-4 rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setOffset((o) => o - 1)} aria-label={t('billingPlan.prevMonth', 'Previous month')}>‹</Button>
            <h2 className="min-w-28 text-center text-[14px] font-semibold" data-testid="billing-plan-month">{monthLabel}</h2>
            <Button variant="ghost" size="sm" onClick={() => setOffset((o) => o + 1)} aria-label={t('billingPlan.nextMonth', 'Next month')}>›</Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>{t('billingPlan.clear', 'Clear picks')}</Button>
        </div>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-control sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t('billingPlan.target', 'Target')}</dt>
            <dd data-testid="billing-plan-target" className="tabular-nums font-medium">
              {target ? fmt(target.amount, target.currency) : t('billingPlan.noTarget', 'No target set')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('billingPlan.pickedTotal', { defaultValue: 'Picked ({{count}})', count: totals.pickedCount })}</dt>
            <dd data-testid="billing-plan-picked" className="tabular-nums font-medium">{fmt(totals.counted, totals.countedCurrency)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{totals.aboveTarget ? t('billingPlan.aboveTarget', 'Above target by') : t('billingPlan.leftToTarget', 'Left to target')}</dt>
            <dd data-testid="billing-plan-remaining" className="tabular-nums font-medium">
              {totals.remaining === null ? '—' : fmt(Math.abs(totals.remaining), totals.countedCurrency)}
            </dd>
          </div>
        </dl>
        {totals.otherCurrencies.map((o) => (
          <p key={o.currency} data-testid="billing-plan-other-currency" className="mt-2 text-control text-muted-foreground">
            {t('billingPlan.otherCurrency', { defaultValue: '{{amount}} picked in {{currency}}, not counted toward the target.', amount: formatCurrency(o.total, o.currency), currency: o.currency })}
          </p>
        ))}
      </section>

      <div className="mb-4 max-w-sm">
        <Combobox
          label={t('billingPlan.filterProject', 'Project')}
          value={projectId}
          selectedOption={projectOptions.find((o) => o.value === projectId) ?? null}
          onChange={(v) => setProject(v)}
          loadOptions={() => Promise.resolve(projectOptions)}
          placeholder={t('billingPlan.allProjects', 'All projects')}
          noun={t('billingPlan.projectNoun', 'project')}
          clearable
          onClear={() => setProject(null)}
        />
      </div>

      {query.isPending && <ListState variant="loading" shape="cards" rows={3} />}
      {query.isError && <ListState variant="error" onRetry={() => { void query.refetch(); }} title={t('billingPlan.error', 'The billing plan could not be loaded')} />}
      {query.isSuccess && rows.length === 0 && (
        <ListState variant="empty" title={t('billingPlan.empty', 'No candidates to show')} sub={t('billingPlan.emptySub', 'Work appears here once it is accepted and not yet claimed.')} />
      )}
      {query.isSuccess && query.data.truncated && (
        <p role="status" data-testid="billing-plan-truncated" className="mb-3 text-control text-muted-foreground">
          {t('billingPlan.truncated', { defaultValue: 'Showing the {{count}} largest. Filter by project to see the rest.', count: PLAN_LIMIT })}
        </p>
      )}
      {query.isSuccess && groups.map((g) => {
        const keys = g.candidates.map((c) => c.key);
        const allPicked = keys.every((k) => picked.has(k));
        return (
          <section key={g.projectId} aria-label={g.projectName} data-testid="billing-plan-group" className="mb-6">
            <h2 className="mb-1 flex items-baseline justify-between gap-2 text-[14px] font-semibold">
              <span className="truncate">{g.projectName}</span>
              <Button variant="ghost" size="sm" onClick={() => setMany(keys, !allPicked)}>
                {allPicked ? t('billingPlan.unpickProject', 'Clear project') : t('billingPlan.pickProject', 'Pick all')}
              </Button>
            </h2>
            <ul>{g.candidates.map((c) => <LineRow key={c.key} c={c} picked={picked.has(c.key)} onToggle={() => toggle(c.key)} />)}</ul>
          </section>
        );
      })}
      {editing && settings && month && (
        <BillingPlanSettingsModal settings={settings} month={month} defaultCurrency={orgCurrency} onClose={() => setEditing(false)} />
      )}
    </div>
  );
};

export default BillingPlan;
