import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, ListState, StatusPill, TaxBasisLabel } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { usePermission } from '@/src/auth/usePermission';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { formatNumberMax2, formatNumberWhole } from '@/src/lib/format';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

export type CascadeView = 'orders' | 'lines';

const whole = (n: number) => formatNumberWhole(n);
const qty = (n: number) => formatNumberMax2(n);

/**
 * Contract → customer order → delivered (BAST) → invoiced → paid, built from the contract lines.
 * Quantities trickle down per line; paid is money (payments are not quantities).
 */
export const ContractCascade: React.FC<{ project: ProjectWithRefs; view: CascadeView }> = ({ project, view }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const orders = useProjectWorkOrders(project.id);
  const money = useWorkOrderBilling(project.id, may('view', 'salesInvoice'));

  if (boq.isPending || billing.isPending || orders.isPending) return <ListState variant="loading" rows={6} />;
  if (boq.isError || billing.isError || orders.isError || !billing.data) {
    return <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={() => { void boq.refetch(); void billing.refetch(); void orders.refetch(); }} />;
  }
  const items = boq.data ?? [];
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.empty', 'No contract lines yet. Load the contract’s line items to track orders, delivery and billing by line.')}</p>;
  }
  const facts = new Map(billing.data.contractLines.map((l) => [l.boqItemId, l]));
  const wos = (orders.data ?? []).filter((w) => w.status !== 'Cancelled' && w.status !== 'Draft')
    .sort((a, b) => (a.wo_number ?? '').localeCompare(b.wo_number ?? ''));
  const woMoney = new Map((money.data ?? []).map((m) => [m.workOrderId, m]));
  const rate = new Map(items.map((i) => [i.id, Number(i.rate)]));
  const allocs = billing.data.contractLines.flatMap((l) => l.allocations);

  const contract = items.reduce((s, i) => s + Number(i.quantity) * Number(i.rate), 0);
  const ordered = allocs.reduce((s, a) => s + a.quantity * (rate.get(a.boqItemId) ?? 0), 0);
  const delivered = allocs.reduce((s, a) => s + (a.acceptedQuantity ?? 0) * (rate.get(a.boqItemId) ?? 0), 0);
  const invoiced = (money.data ?? []).reduce((s, m) => s + m.invoiced, 0);
  const paid = (money.data ?? []).reduce((s, m) => s + m.paid, 0);
  const showMoney = may('view', 'salesInvoice');

  const step = (label: string, value: number) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums leading-tight text-foreground">{whole(value)}</dd>
    </div>
  );
  const arrow = <Icon name="chev" className="mt-6 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;

  return (
    <div className="flex min-w-0 flex-col gap-12">
      <section aria-labelledby="pd-cascade" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
          <h2 id="pd-cascade" className="text-sm font-semibold text-foreground">{t('projectDetail.cascade.title', 'Contract')}</h2>
          <span className="text-xs text-muted-foreground">{project.currency}
            {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-xs text-muted-foreground" /></>}
          </span>
        </div>
        <dl className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {step(t('projectDetail.cascade.contract', 'Contract'), contract)}{arrow}
          {step(t('projectDetail.cascade.ordered', 'Ordered'), ordered)}{arrow}
          {step(t('projectDetail.cascade.delivered', 'Delivered'), delivered)}
          {showMoney && <>{arrow}{step(t('projectDetail.cascade.invoiced', 'Invoiced'), invoiced)}{arrow}{step(t('projectDetail.cascade.paid', 'Paid'), paid)}</>}
        </dl>
        <p className="mt-3 text-xs tabular-nums text-muted-foreground">
          {t('projectDetail.cascade.notOrdered', 'Not yet ordered')} <span className="font-semibold text-foreground">{whole(contract - ordered)}</span>
          {showMoney && <> · {t('projectDetail.cascade.deliveredNotInvoiced', 'Delivered, not invoiced')} <span className="font-semibold text-foreground">{whole(Math.max(0, delivered - invoiced))}</span>
            {' · '}{t('projectDetail.cascade.unpaid', 'Unpaid')} <span className="font-semibold text-foreground">{whole(invoiced - paid)}</span></>}
        </p>
      </section>

      {view === 'orders' ? (
        <>
          {wos.map((w) => {
            const m = woMoney.get(w.id);
            const lines = allocs.filter((a) => a.workOrderId === w.id);
            return (
              <section key={w.id} aria-labelledby={`pd-wo-${w.id}`} className="min-w-0">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 id={`pd-wo-${w.id}`} className="text-sm font-semibold text-foreground">{w.wo_number ?? w.title}</h3>
                  <span className="text-sm text-foreground">{w.title}</span>
                  <StatusPill variant={w.status === 'Closed' ? 'won' : 'progress'}>{w.status === 'Closed' ? t('projectDetail.cascade.delivered', 'Delivered') : t('projectDetail.cascade.inProgress', 'In progress')}</StatusPill>
                  {w.client_po_number && <span className="text-xs text-muted-foreground">{t('projectDetail.cascade.po', 'PO {{po}}', { po: w.client_po_number })}</span>}
                  {showMoney && m && (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {t('projectDetail.cascade.invoicedOf', 'Invoiced')} <span className="font-semibold text-foreground">{whole(m.invoiced)}</span>
                      {' · '}{t('projectDetail.cascade.paid', 'Paid')} <span className="font-semibold text-foreground">{whole(m.paid)}</span>
                      {m.invoiced - m.paid > 0 && <> · <span className="font-semibold text-destructive-text">{t('projectDetail.cascade.unpaidAmt', '{{amount}} unpaid', { amount: whole(m.invoiced - m.paid) })}</span></>}
                    </span>
                  )}
                </div>
                <LineTable
                  head={[t('projectDetail.cascade.colOrdered', 'Ordered'), t('projectDetail.cascade.colDelivered', 'Delivered'), t('projectDetail.cascade.colInvoiced', 'Invoiced'), t('projectDetail.cascade.colCanInvoice', 'Can invoice')]}
                  rows={lines.map((a) => {
                    const item = items.find((i) => i.id === a.boqItemId)!;
                    const acc = a.acceptedQuantity;
                    const can = acc === null ? 0 : Math.max(0, acc - a.claimedQuantity);
                    return {
                      key: a.boqItemId, code: item.item_code, name: item.description, unit: item.unit,
                      cells: [
                        qty(a.quantity),
                        acc === null ? <span className="text-muted-foreground">0</span>
                          : <span className={cn(acc < a.quantity && a.final && 'text-warning-foreground')}>{qty(acc)}{acc < a.quantity && a.final && <span className="ml-1 text-xs">{t('projectDetail.cascade.short', '({{n}} short)', { n: qty(a.quantity - acc) })}</span>}</span>,
                        qty(a.claimedQuantity),
                        can > 0 ? <span className="font-semibold text-primary-text">{qty(can)}</span> : <span className="text-muted-foreground">0</span>,
                      ],
                    };
                  })}
                />
              </section>
            );
          })}
          {(() => {
            const open = items.filter((i) => (facts.get(i.id)?.contractBalance ?? 0) > 0);
            if (!open.length) return null;
            return (
              <section aria-labelledby="pd-not-ordered" className="min-w-0">
                <h3 id="pd-not-ordered" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.cascade.notOrderedTitle', 'Not yet ordered')}</h3>
                <LineTable
                  head={[t('projectDetail.cascade.colContract', 'Contract'), t('projectDetail.cascade.colLeft', 'Left to order')]}
                  rows={open.map((i) => {
                    const f = facts.get(i.id)!;
                    // A closed order hands back what it didn't deliver, so "left" can exceed contract − ordered.
                    return { key: i.id, code: i.item_code, name: i.description, unit: i.unit, cells: [qty(Number(i.quantity)), <span key="l" className="font-semibold">{qty(f.contractBalance)}</span>] };
                  })}
                />
              </section>
            );
          })()}
        </>
      ) : (
        <section aria-labelledby="pd-lines" className="min-w-0">
          <h3 id="pd-lines" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.cascade.linesTitle', 'Contract lines')}</h3>
          <LineTable
            head={[t('projectDetail.cascade.colContract', 'Contract'), t('projectDetail.cascade.colOrdered', 'Ordered'), t('projectDetail.cascade.colDelivered', 'Delivered'), t('projectDetail.cascade.colInvoiced', 'Invoiced'), t('projectDetail.cascade.colLeft', 'Left to order')]}
            rows={items.flatMap((i) => {
              const f = facts.get(i.id);
              const lineAllocs = f?.allocations ?? [];
              const main = {
                key: i.id, code: i.item_code, name: i.description, unit: i.unit,
                cells: [qty(Number(i.quantity)), qty(f?.orderedQuantity ?? 0), qty(f?.acceptedQuantity ?? 0), qty(lineAllocs.reduce((s, a) => s + a.claimedQuantity, 0)),
                  (f?.contractBalance ?? 0) > 0 ? <span key="l" className="font-semibold">{qty(f!.contractBalance)}</span> : <span key="l" className="text-muted-foreground">0</span>],
              };
              const subs = lineAllocs.map((a) => {
                const w = wos.find((x) => x.id === a.workOrderId);
                return {
                  key: `${i.id}-${a.workOrderId}`, sub: true, code: '', name: w?.wo_number ?? '', unit: '',
                  cells: ['', qty(a.quantity), qty(a.acceptedQuantity ?? 0), qty(a.claimedQuantity), ''],
                };
              });
              return [main, ...(subs.length > 1 ? subs : [])];
            })}
          />
        </section>
      )}
    </div>
  );
};

interface Row { key: string; code: string; name: string; unit: string; cells: React.ReactNode[]; sub?: boolean }

const LineTable: React.FC<{ head: string[]; rows: Row[] }> = ({ head, rows }) => {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">{t('projectDetail.cascade.colItem', 'Item')}</th>
            <th scope="col" className="w-16 py-2 pr-4 font-medium">{t('projectDetail.cascade.colUnit', 'Unit')}</th>
            {head.map((h) => <th key={h} scope="col" className="w-28 py-2 pl-4 text-right font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn(r.sub ? 'text-xs text-muted-foreground' : 'border-t border-border/70')}>
              <td className={cn('py-2 pr-4', r.sub && 'py-1 pl-8')}>
                {r.code && <span className="mr-2 text-xs tabular-nums text-muted-foreground">{r.code}</span>}
                <span className={cn(!r.sub && 'text-foreground')}>{r.name}</span>
              </td>
              <td className={cn('py-2 pr-4 text-muted-foreground', r.sub && 'py-1')}>{r.unit}</td>
              {r.cells.map((c, idx) => <td key={idx} className={cn('py-2 pl-4 text-right tabular-nums', r.sub && 'py-1')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
