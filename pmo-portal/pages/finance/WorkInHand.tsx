import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, PageHeader, ViewToggle } from '@/src/components/ui';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { useFigureReport, type HiddenFigure } from '@/src/components/ui/useFigureScope';
import { AccessDenied } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useWorkInHand } from '@/src/hooks/useWorkInHand';
import { WorkInHandSummary } from '@/src/components/workInHand/WorkInHandSummary';
import { formatExactCents } from '@/src/lib/exactDecimal';
import { formatDay, formatExactMoney, formatMonthYearShort } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import {
  formatBacklogTenths, hiddenFigures, rankWorkInHand,
  type WipContractGroup, type WipCurrencyGroup, type WipOrder, type WipRow, type WipTotals,
} from '@/src/lib/workInHand';

/**
 * Work in hand (#2575, spec docs/specs/work-in-hand-backlog.spec.md): per contract and work order, how much is still to be
 * billed and how many months that is at the pace now billed. Read-only; the figures are derived in `src/lib/workInHand.ts`
 * from the database inputs. Order on screen (docs/ux/screen-rules.md): what is off, then position, then the table.
 */
const ATTENTION_ROWS = 5;

function useMoney() {
  const locale = getNumberLocale();
  return React.useCallback((cents: bigint, currency: string) => formatExactMoney(formatExactCents(cents), currency, locale, { wholeUnits: true }) ?? `${currency} ${formatExactCents(cents)}`, [locale]);
}

const linkFor = (row: WipRow) => (row.kind === 'contract' ? `/projects/${row.id}` : `/work-orders/${row.id}`);
const labelFor = (row: WipRow) => (row.code ? `${row.code} ${row.name}` : row.name);

/** Why a row has no billing rate, in words. */
function useNoRateCause() {
  const { t } = useTranslation('workInHand');
  return (row: WipRow) => (row.rate?.state === 'none' && row.rate.cause === 'began-this-month'
    ? t('row.noRateThisMonth', 'Billing began this month')
    : t('row.noRateNothing', 'Nothing billed in 6 months'));
}

/** Registers what could not be shown with the page's one hidden-figures line (NFR-WIH-004). */
const HiddenReport: React.FC<{ figures: HiddenFigure[] }> = ({ figures }) => {
  useFigureReport(figures);
  return null;
};

const Totals: React.FC<{ group: WipCurrencyGroup }> = ({ group }) => {
  const { t } = useTranslation('workInHand');
  const money = useMoney();
  const tot: WipTotals = group.totals;
  const ratePresent = tot.ratePerMonthCents > 0n;
  return (
    <KPIRow aria-label={group.currency} className="grid-cols-1 min-[640px]:grid-cols-2">
      <KPITile
        icon="grid" tone="blue" label={t('tile.left', 'Left to bill')}
        value={money(tot.leftToBillCents, group.currency)}
      />
      <KPITile
        icon="grid" tone="blue" label={t('tile.rate', 'Billing rate per month')}
        value={ratePresent ? money(tot.ratePerMonthCents, group.currency) : null}
        unavailableReason={ratePresent ? undefined : t('tile.rateUnknown', 'no row has a billing rate')}
      />
    </KPIRow>
  );
};

const MonthsTable: React.FC<{ row: WipRow; currency: string }> = ({ row, currency }) => {
  const { t } = useTranslation('workInHand');
  const money = useMoney();
  return (
    <table className="w-full max-w-md text-sm" data-testid={`wih-months-${row.id}`}>
      <caption className="sr-only">{t('col.months', 'Months')}</caption>
      <tbody>
        {row.months.map((m) => (
          <tr key={m.month}>
            <th scope="row" className="py-0.5 pr-4 text-left font-normal text-muted-foreground">{formatMonthYearShort(`${m.month}-01`)}</th>
            <td className="py-0.5 text-right tabular-nums">{money(m.billedCents, currency)}</td>
          </tr>
        ))}
        {row.rate?.state === 'rate' && (
          <tr><td colSpan={2} className="pt-1 text-muted-foreground">{t('row.monthsCounted', { count: row.rate.monthsCounted, defaultValue_one: '{{count}} month counted', defaultValue_other: '{{count}} months counted' })}</td></tr>
        )}
      </tbody>
    </table>
  );
};

const Cells: React.FC<{ row: WipRow; nested: boolean; open: boolean; onToggle: () => void }> = ({ row, nested, open, onToggle }) => {
  const { t } = useTranslation('workInHand');
  const money = useMoney();
  const noRateCause = useNoRateCause();
  const name = labelFor(row);
  const rate = row.rate;
  return (
    <tr className="border-t border-border align-top" data-testid={`wih-row-${row.id}`} data-kind={row.kind}>
      <th scope="row" className={`py-2 pr-4 text-left font-normal ${nested ? 'pl-6' : ''}`}>
        <Link to={linkFor(row)} className="text-primary-text underline-offset-4 hover:underline" aria-label={t('row.open', { name, defaultValue: 'Open {{name}}' })}>{name}</Link>
        <div className="text-muted-foreground">{nested ? t('row.workOrder', 'Work order') : t(`status.${row.status}`, row.status)}</div>
      </th>
      <td className="py-2 pr-4 text-right tabular-nums">{money(row.valueCents ?? 0n, row.currency)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{money(row.billedCents ?? 0n, row.currency)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {money(row.leftToBillCents ?? 0n, row.currency)}
        {row.overBilled && <div className="text-destructive-text">{t('row.over', 'Billed over value')}</div>}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {rate?.state === 'rate' ? money(rate.perMonthCents, row.currency) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {row.backlogTenths !== null ? formatBacklogTenths(row.backlogTenths) : (
          <><span className="font-medium text-warning-text">{t('row.noRate', 'No billing rate')}</span><div className="text-muted-foreground">{noRateCause(row)}</div></>
        )}
      </td>
      <td className="py-2 text-right">
        <button
          type="button" aria-expanded={open} data-testid={`wih-toggle-${row.id}`}
          aria-label={open ? t('row.hideMonths', { name, defaultValue: 'Hide months for {{name}}' }) : t('row.showMonths', { name, defaultValue: 'Show months for {{name}}' })}
          onClick={onToggle}
          className="min-h-11 min-w-11 rounded-md px-2 text-primary-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >{t('col.months', 'Months')}</button>
      </td>
    </tr>
  );
};

const GroupTable: React.FC<{ group: WipCurrencyGroup }> = ({ group }) => {
  const { t } = useTranslation('workInHand');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const renderRow = (row: WipRow, nested: boolean) => (
    <React.Fragment key={row.id}>
      <Cells row={row} nested={nested} open={openId === row.id} onToggle={() => toggle(row.id)} />
      {openId === row.id && (
        <tr><td colSpan={7} className="pb-3 pl-6"><MonthsTable row={row} currency={row.currency} /></td></tr>
      )}
    </React.Fragment>
  );
  return (
    <div className="overflow-x-auto" data-testid={`wih-table-${group.currency}`}>
      <table className="w-full min-w-[760px] text-sm">
        <caption className="sr-only">{group.currency}</caption>
        <thead>
          <tr className="text-right text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-normal">{t('col.item', 'Contract or work order')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('col.value', 'Value')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('col.billed', 'Billed to date')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('col.left', 'Left to bill')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('col.rate', 'Billing rate per month')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('col.backlog', 'Months of backlog')}</th>
            <th scope="col" className="py-2 font-normal"><span className="sr-only">{t('col.months', 'Months')}</span></th>
          </tr>
        </thead>
        <tbody>
          {group.contracts.map((g: WipContractGroup) => (
            <React.Fragment key={g.contract.id}>
              {renderRow(g.contract, false)}
              {g.workOrders.map((w) => renderRow(w, true))}
            </React.Fragment>
          ))}
          {group.unparentedWorkOrders.map((w) => renderRow(w, false))}
        </tbody>
      </table>
    </div>
  );
};

const WorkInHand: React.FC = () => {
  const { t } = useTranslation('workInHand');
  const navigate = useNavigate();
  const may = usePermission();
  const canView = may('view', 'workInHand');
  const isProjectManager = may('viewAssigned', 'workInHand');
  const query = useWorkInHand(canView);
  const [order, setOrder] = React.useState<WipOrder>('leftToBill');
  const noRateCause = useNoRateCause();

  const facts = query.facts;
  const rows = query.rows;
  const groups = React.useMemo(() => (facts ? rankWorkInHand(rows, order, facts.orgCurrency) : []), [facts, rows, order]);
  const incompleteRows = React.useMemo(() => rows.filter((r) => r.state === 'incomplete'), [rows]);
  const hidden = React.useMemo(() => (facts ? hiddenFigures(rows, { noValueContractCount: facts.noValueContractCount, undatedInvoiceCount: facts.undatedInvoiceCount, truncated: facts.truncated }) : null), [facts, rows]);

  if (!canView) return <AccessDenied title={t('title', 'Work in hand')} sub={t('access.denied', 'Work in hand is available to Finance, Executive, Admin, and Project Managers for their assigned projects.')} onBack={() => navigate('/')} />;

  const hiddenFigureList: HiddenFigure[] = [];
  if (hidden && facts) {
    if (hidden.noValue > 0) {
      const only = facts.noValue.length === 1 ? facts.noValue[0] : null;
      hiddenFigureList.push({
        label: t('hidden.noValue', 'No contract value'),
        reason: t('hidden.noValueReason', { count: hidden.noValue, defaultValue_one: '{{count}} contract has no value set', defaultValue_other: '{{count}} contracts have no value set' }),
        link: { to: only ? `/projects/${only.projectId}` : '/projects', label: t('hidden.noValueFix', 'Set value') },
      });
    }
    if (hidden.incomplete > 0) {
      hiddenFigureList.push({
        label: t('hidden.incomplete', 'Left to bill'),
        reason: t('hidden.incompleteReason', { count: hidden.incomplete, defaultValue_one: '{{count}} row has invoices that cannot be totalled', defaultValue_other: '{{count}} rows have invoices that cannot be totalled' }),
      });
    }
    if (hidden.undatedInvoices > 0) {
      hiddenFigureList.push({
        label: t('hidden.undated', 'Undated invoices'),
        reason: t('hidden.undatedReason', { count: hidden.undatedInvoices, defaultValue_one: '{{count}} invoice has no date and is not counted', defaultValue_other: '{{count}} invoices have no date and are not counted' }),
        link: { to: '/finance/receivables', label: t('hidden.undatedFix', 'Open invoices') },
      });
    }
    if (hidden.truncated) {
      hiddenFigureList.push({ label: t('hidden.truncated', 'Rows beyond the limit'), reason: t('hidden.truncatedReason', 'the list is cut at 500 contracts and 3,000 work orders') });
    }
  }

  const attention = rows.filter((r) => r.state === 'figures' && (r.overBilled || (r.rate?.state === 'none' && (r.leftToBillCents ?? 0n) > 0n)));

  const header = (
    <PageHeader
      title={isProjectManager ? t('titleManaged', 'My work in hand') : t('title', 'Work in hand')}
      count={facts ? <span data-testid="wih-as-of">{t('asOf', { date: formatDay(facts.asOf), defaultValue: 'As of {{date}}' })}</span> : undefined}
      help={<>
        <p>{t('help.leftToBill', 'Left to bill is the value not yet invoiced: the contract or work-order value less invoiced work, before tax. Draft and cancelled invoices do not count.')}</p>
        <p>{t('help.rate', 'Billing rate per month is invoiced work in the last 6 complete months, divided by the months since billing began (at most 6).')}</p>
        <p>{t('help.backlog', "Months of backlog per row is Left to bill divided by the row's billing rate. Months of work in hand divides organisation-currency work in hand by the Admin's monthly capacity; other currencies are not converted or included.")}</p>
      </>}
      helpSubject={t('title', 'Work in hand')}
    />
  );

  if (query.isLoading) {
    return <div className="min-w-0">{header}{isProjectManager && <p className="mb-3 text-control text-muted-foreground">{t('managedScope', 'These figures cover only projects assigned to you.')}</p>}<ListState variant="loading" shape="table" rows={5} loadingLabel={t('loading', 'Loading work in hand')} /></div>;
  }
  if (query.isError || !facts || !hidden) {
    return (
      <div className="min-w-0">
        {header}
        {isProjectManager && <p className="mb-3 text-control text-muted-foreground">{t('managedScope', 'These figures cover only projects assigned to you.')}</p>}
        <ListState variant="error" title={t('error.title', "Couldn't load work in hand")} retryLabel={t('error.retry', 'Try again')} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const nothingRanked = groups.length === 0 && incompleteRows.length === 0;

  return (
    <FigureScope>
      <div className="min-w-0">
        {header}
        {isProjectManager && <p className="mb-3 text-control text-muted-foreground">{t('managedScope', 'These figures cover only projects assigned to you.')}</p>}
        <HiddenReport figures={hiddenFigureList} />
        <div className="mb-3"><FigureHiddenLine compact /></div>
        {nothingRanked ? (
          <ListState variant="empty" title={t('empty.title', 'No contract is in work in hand')} action={{ label: t('empty.action', 'Open projects'), onClick: () => navigate('/projects') }} />
        ) : (
          <div className="space-y-[var(--space-panel-gap)]">
            <WorkInHandSummary showLink={false} showHeader={false} testId="wih-capacity-summary" />
            {attention.length > 0 && (
              <Card role="region" aria-labelledby="wih-attention">
                <CardHead id="wih-attention">{t('attention.title', 'Needs a look')}</CardHead>
                <CardPad>
                  <ul className="space-y-1" data-testid="wih-attention-list">
                    {attention.slice(0, ATTENTION_ROWS).map((r) => (
                      <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <Link to={linkFor(r)} className="min-h-11 text-primary-text underline-offset-4 hover:underline">{labelFor(r)}</Link>
                        <span className={r.overBilled ? 'text-destructive-text' : 'text-warning-text'}>
                          {r.overBilled ? t('attention.over', 'Billed over value') : `${t('attention.noRate', 'No billing rate')}: ${noRateCause(r)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardPad>
              </Card>
            )}
            <div className="flex justify-end">
              <ViewToggle<WipOrder>
                ariaLabel={t('sort.label', 'Order by')} semantics="toggle" value={order} onChange={setOrder}
                options={[
                  { value: 'leftToBill', label: t('sort.leftToBill', 'Left to bill'), testId: 'wih-sort-left' },
                  { value: 'backlog', label: t('sort.backlog', 'Months of backlog'), testId: 'wih-sort-backlog' },
                ]}
              />
            </div>
            {groups.map((group) => (
              <Card key={group.currency} role="region" aria-labelledby={`wih-${group.currency}`} data-testid={`wih-group-${group.currency}`}>
                <CardHead id={`wih-${group.currency}`}>{group.currency}</CardHead>
                <CardPad className="space-y-[var(--space-panel-gap)]">
                  <Totals group={group} />
                  <GroupTable group={group} />
                </CardPad>
              </Card>
            ))}
            {incompleteRows.length > 0 && (
              <Card role="region" aria-labelledby="wih-incomplete">
                <CardHead id="wih-incomplete">{t('incomplete.title', 'Figures incomplete')}</CardHead>
                <CardPad>
                  <ul className="space-y-1" data-testid="wih-incomplete-list">
                    {incompleteRows.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <Link to={linkFor(r)} className="min-h-11 text-primary-text underline-offset-4 hover:underline">{labelFor(r)}</Link>
                        <span className="text-muted-foreground">
                          {[
                            r.foreignCurrencyInvoiceCount > 0 ? t('incomplete.foreign', { count: r.foreignCurrencyInvoiceCount, defaultValue_one: '{{count}} invoice in another currency', defaultValue_other: '{{count}} invoices in another currency' }) : null,
                            r.unpricedInvoiceCount > 0 ? t('incomplete.unpriced', { count: r.unpricedInvoiceCount, defaultValue_one: '{{count}} invoice with no amount', defaultValue_other: '{{count}} invoices with no amount' }) : null,
                          ].filter(Boolean).join(' · ') || t('incomplete.unknown', 'Some invoices cannot be totalled')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardPad>
              </Card>
            )}
          </div>
        )}
      </div>
    </FigureScope>
  );
};

export default WorkInHand;
