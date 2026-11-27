import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { useProjectPlanVsActual } from '@/src/hooks/useWorkOrderPlanVsActual';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { useDisciplineRevenue } from '@/src/hooks/useDisciplineProfit';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { useWorkOrderEarnedBilled } from '@/src/hooks/useEarnedBilled';
import { earnedBilledProfit, projectClaimedRevenue, type Figure } from '@/src/lib/earnedBilledProfit';
import { disciplineProfit, type ProfitFigure } from '@/src/lib/disciplineProfit';
import { moneyText as moneyText2, moneyUnits, type ExactMoney } from '@/src/lib/projectFinances';
import { EarnedBilledTable, type EbCell, type EbTableRow } from '@/src/components/finance/EarnedBilledTable';

/** How long the panel waits before re-asking a refused read once (#2896). */
const RESTRICTED_RE_ASK_MS = 1_000;

/**
 * Earned and billed revenue side by side (#2733, docs/specs/earned-billed-revenue.spec.md): per work order with a project
 * total, and per discipline. Renders only what `earnedBilledProfit` / `disciplineProfit` joined; nothing is re-summed here.
 * Nothing renders while the organisation setting is off or the role may not read work-order money.
 */
const EarnedBilledProfit: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('workOrderPva');
  const may = usePermission();
  const canView = may('view', 'workOrderPlan');
  const setting = useOrgSwitch('disciplineProfit', canView);
  const on = canView && setting.data === true;
  // #2895 review: the rollup reads stay gated on the switch being ON (the sibling DisciplineProfit's
  // rule, and the hooks' own contracts). The switch read is session-cached, so a warm mount of an
  // on-organisation resolves it from cache and the reads still start at once; an off-organisation
  // pays none of them for a panel it will never see.
  const pva = useProjectPlanVsActual(projectId, on);
  const eb = useWorkOrderEarnedBilled(projectId, on);
  const revenue = useDisciplineRevenue(projectId, on);
  const disciplines = useCostDisciplines(on);

  const disciplineName = useMemo(() => {
    const m = new Map((disciplines.data ?? []).map((d) => [d.id, d.name]));
    return (id: string | null) => (id === null ? t('profit.noDiscipline', 'No discipline') : m.get(id) ?? t('profit.archivedDiscipline', 'Archived discipline'));
  }, [disciplines.data, t]);

  // #2896: a refused money read comes back as the VALUE "restricted" (a 42501 never becomes an error), so
  // react-query caches it as a success and nothing re-asks — one transient refusal pinned the panel closed
  // until a reload. The panel re-asks the refused read once, a beat later; a viewer genuinely refused stays
  // restricted after that one re-ask, so the recovery never loops.
  const ebRestricted = eb.data === 'restricted';
  const pvaRestricted = pva.data?.rollup.restricted === true;
  const reAsked = React.useRef(false);
  React.useEffect(() => {
    if ((!ebRestricted && !pvaRestricted) || reAsked.current || eb.isFetching || pva.isFetching) return;
    reAsked.current = true;
    const timer = setTimeout(() => {
      if (ebRestricted) void eb.refetch();
      if (pvaRestricted) void pva.refetch();
    }, RESTRICTED_RE_ASK_MS);
    return () => clearTimeout(timer);
  }, [ebRestricted, pvaRestricted, eb, pva]);

  if (!on) return null;
  const title = t('earnedBilled.title', 'Earned and billed revenue');
  const failed = pva.isError || eb.isError || revenue.isError || disciplines.isError;
  if (pva.isPending || eb.isPending || revenue.isPending || disciplines.isPending || failed || !pva.data || eb.data === undefined || revenue.data === undefined) {
    return (
      <Card className="min-w-0" data-testid="earned-billed">
        <CardHead level={2} className="text-base">{title}</CardHead>
        <CardPad className="pt-0">
          {failed
            ? <ListState variant="error" title={t('earnedBilled.loadError', 'Couldn\'t load earned and billed revenue')} retryLabel={t('profit.retry', 'Try again')} onRetry={() => { void pva.refetch(); void eb.refetch(); void revenue.refetch(); void disciplines.refetch(); }} />
            : <ListState variant="loading" rows={3} />}
        </CardPad>
      </Card>
    );
  }

  const money = (value: ExactMoney | null, currency: string) =>
    value === null ? t('profit.unknown', 'Unknown') : formatExactMoney(value, currency, getNumberLocale()) ?? t('profit.unknown', 'Unknown');
  const amountText = (amount: ExactMoney, currency: string, loss: boolean) => {
    const units = moneyUnits(amount);
    return loss && units !== null && units < 0n ? t('profit.loss', 'Loss of {{amount}}', { amount: money(amount.replace('-', ''), currency) }) : money(amount, currency);
  };
  const reasonText = (reason: Figure['reason'] | ProfitFigure['reason']) => {
    switch (reason) {
      case 'restricted': return t('profit.restricted', 'Restricted');
      case 'not-available': return t('earnedBilled.notAvailable', 'Not available');
      case 'incomplete': return t('profit.incomplete', 'Incomplete: validated work without a rate');
      case 'not-comparable': return t('profit.notComparable', 'Not comparable (other currency)');
      case 'cost-unknown': return t('profit.costUnknown', 'Cost unknown');
      default: return '';
    }
  };
  const cell = (f: Figure | ProfitFigure, currency: string, loss = false): EbCell => ({
    text: f.amount !== null ? amountText(f.amount, currency, loss) : reasonText(f.reason), words: f.amount === null,
  });

  const woName = new Map(pva.data.workOrders.map((w) => [w.id, w.woNumber ? `${w.woNumber} · ${w.title}` : w.title]));
  const profit = earnedBilledProfit(pva.data.rollup, eb.data);

  const columns = [
    { key: 'earned', label: t('earnedBilled.col.earned', 'Earned') },
    { key: 'billed', label: t('earnedBilled.col.billed', 'Billed') },
    { key: 'gap', label: t('earnedBilled.col.gap', 'Earned, not yet billed') },
    { key: 'marginEarned', label: t('earnedBilled.col.marginEarned', 'Margin on earned') },
    { key: 'marginBilled', label: t('earnedBilled.col.marginBilled', 'Margin on billed') },
  ];

  const body = profit.restricted
    ? <p role="status" className="text-sm text-muted-foreground">{t('profit.restricted', 'Restricted')}</p>
    : profit.currencies.every((c) => c.rows.length === 0)
      ? <p role="status" className="text-sm text-muted-foreground">{t('earnedBilled.empty', 'No Issued or Closed work orders yet.')}</p>
      : profit.currencies.map((c) => {
        const projectCell = (figure: Figure, loss = false) => figure.reason === 'incomplete' && c.total.withoutProgress > 0
          ? { text: t('earnedBilled.missingProgress', 'Incomplete: some work orders have no validated progress'), words: true }
          : cell(figure, c.currency, loss);
        const projectBilled: EbCell = {
          text: `${t('earnedBilled.invoicedLabel', 'Invoiced')}: ${cell(c.total.billed, c.currency).text} · ${t('earnedBilled.claimedLabel', 'Claimed')}: ${money(projectClaimedRevenue(revenue.data, c.currency), c.currency)}`,
          words: false,
        };
        const rows: EbTableRow[] = [
          ...c.rows.map((r) => ({
            key: r.key, testId: `earned-billed-row-${r.workOrderId}`, label: woName.get(r.workOrderId ?? '') ?? '',
            cells: [cell(r.earned, c.currency), cell(r.billed, c.currency), cell(r.gap, c.currency), cell(r.marginEarned, c.currency, true), cell(r.marginBilled, c.currency, true)],
          })),
          {
            key: c.total.key, testId: 'earned-billed-row-total', total: true, label: t('profit.total', 'Project total'),
            cells: [projectCell(c.total.earned), projectBilled, projectCell(c.total.gap), projectCell(c.total.marginEarned, true), cell(c.total.marginBilled, c.currency, true)],
          },
        ];
        return (
          <div key={c.currency} data-testid={`earned-billed-${c.currency}`}>
            <EarnedBilledTable caption={`${c.currency} · ${t('earnedBilled.byWorkOrder', 'By work order')}`} firstColumn={t('earnedBilled.col.workOrder', 'Work order')} columns={columns} rows={rows} />
            {c.total.withoutProgress > 0 && (
              <p role="status" className="mt-1 text-sm text-muted-foreground" data-testid="earned-billed-without-progress">
                {t('earnedBilled.withoutProgress', '{{count}} of {{total}} work orders have no validated progress yet.', { count: c.total.withoutProgress, total: c.total.workOrders })}
              </p>
            )}
          </div>
        );
      });

  // Per discipline: the same cost roll-up joined to each revenue basis; billed work no claim line itemises is its own row.
  const earnedD = disciplineProfit(pva.data.rollup, revenue.data, 'validated_progress');
  const billedD = disciplineProfit(pva.data.rollup, revenue.data, 'billed_claims');
  const unitemised = revenue.data === 'restricted' ? [] : revenue.data.filter((r) => r.basis === 'billed_unitemised');
  const currenciesD = [...new Set([...earnedD.currencies, ...billedD.currencies].map((c) => c.currency))].sort();
  const disciplineBody = earnedD.restricted || billedD.restricted || currenciesD.length === 0 ? null : currenciesD.map((currency) => {
    const e = earnedD.currencies.find((c) => c.currency === currency);
    const b = billedD.currencies.find((c) => c.currency === currency);
    const ids = [...new Set([...(e?.rows ?? []), ...(b?.rows ?? [])].filter((r) => r.kind === 'discipline').map((r) => r.disciplineId))]
      .sort((x, y) => (x === null ? 1 : y === null ? -1 : x.localeCompare(y)));
    const rows: EbTableRow[] = ids.map((id) => {
      const er = e?.rows.find((r) => r.kind === 'discipline' && r.disciplineId === id);
      const br = b?.rows.find((r) => r.kind === 'discipline' && r.disciplineId === id);
      const ev = moneyUnits(er?.revenue ?? null) ?? 0n; const bv = moneyUnits(br?.revenue ?? null) ?? 0n;
      // No validated progress on this discipline: earned is not available, never 0.00.
      const earnedCell: EbCell = !er ? { text: reasonText('not-available'), words: true } : er.incomplete ? { text: reasonText('incomplete'), words: true } : { text: money(er.revenue, currency), words: false };
      return {
        key: `${currency}|${id ?? 'none'}`, testId: `earned-billed-discipline-${id ?? 'none'}`, label: disciplineName(id),
        cells: [earnedCell, { text: money(br?.revenue ?? '0.00', currency), words: false },
          !er || er.incomplete ? earnedCell : { text: money(moneyText2(ev - bv), currency), words: false },
          er ? cell(er.marginAfter, currency, true) : earnedCell, br ? cell(br.marginAfter, currency, true) : { text: '', words: false }],
      };
    });
    unitemised.filter((u) => u.currency === currency).forEach((u) => rows.push({
      key: `${currency}|unitemised`, testId: 'earned-billed-discipline-unitemised', label: t('earnedBilled.notItemised', 'Not itemised'),
      cells: [{ text: '', words: false }, { text: money(u.revenue, currency), words: false }, { text: '', words: false }, { text: '', words: false }, { text: '', words: false }],
    }));
    return rows.length === 0 ? null : (
      <div key={currency} data-testid={`earned-billed-disciplines-${currency}`}>
        <EarnedBilledTable caption={`${currency} · ${t('earnedBilled.byDiscipline', 'By discipline')}`} firstColumn={t('profit.col.discipline', 'Discipline')} columns={columns} rows={rows} />
      </div>
    );
  });

  return (
    <Card className="min-w-0" data-testid="earned-billed">
      <CardHead level={2} className="text-base">{title}</CardHead>
      <CardPad className="pt-0">
        <p className="mb-2 text-sm text-muted-foreground">{t('earnedBilled.note', 'Earned is validated daily progress at the contract rate. Billed is claims and invoices, excluding tax.')}</p>
        {body}
        {!profit.restricted && disciplineBody}
      </CardPad>
    </Card>
  );
};

export default EarnedBilledProfit;
