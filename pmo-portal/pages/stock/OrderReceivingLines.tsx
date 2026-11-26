import React from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, StatusPill, TextField, type Column, type RowMenuItem } from '@/src/components/ui';
import { ReceiptQualityFields } from '@/src/components/stock/ReceiptQualityFields';
import type { QualityProblem, QualityValue } from '@/src/lib/receiptQuality';
import { formatQuantity, isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ReceivingLine } from '@/src/lib/db/orderReceiving';
import { RECEIVING_VARIANT } from './receivingStatus';


/**
 * The order's lines as ONE table: a row per line, the counted quantity in its own right-aligned column.
 * Purchasing (`purchaser`) also reads ordered / received / outstanding and the stock-item mapping; a receiver
 * counts blind and never sees those columns. Lines whose counted item needs a quality check get their
 * passed / rejected fields in a block under the table.
 */
export function OrderReceivingLines({ lines, quantities, onChange, checks, onCheck, problems = {}, disabled = false, purchaser = false, mapping, rowMenu }: {
  lines: ReceivingLine[]; quantities: Record<string, string>; onChange: (id: string, value: string) => void;
  /** D4: the quality check of each counted line whose item is flagged for one. */
  checks: Record<string, QualityValue>; onCheck: (id: string, value: QualityValue) => void; problems?: Record<string, QualityProblem | null>; disabled?: boolean;
  /** Purchasing reads the order's position per line. */
  purchaser?: boolean;
  /** Purchasing's stock-item cell (the mapping control, or the mapped item's name). */
  mapping?: (line: ReceivingLine) => React.ReactNode;
  /** Per-line secondary actions (purchasing: send the line to the service or direct-use path). */
  rowMenu?: (line: ReceivingLine) => RowMenuItem[] | undefined;
}) {
  const { t } = useTranslation('stock');
  const loc = getNumberLocale();
  const qty = (value: string | undefined) => value === undefined ? '—' : formatQuantity(value, loc);
  const unit = (line: ReceivingLine) => line.unit ? <span className="text-muted-foreground"> {line.unit}</span> : null;
  const figure = (value: string | undefined, line: ReceivingLine) => <span className="tabular-nums whitespace-nowrap">{qty(value)}{unit(line)}</span>;
  const columns: Column<ReceivingLine>[] = [
    {
      key: 'line', header: t('receiving.line'), rowHeader: true, size: purchaser ? 248 : 320,
      cell: (line) => <div className="min-w-0 space-y-2">
        <span className="block break-words font-semibold text-foreground">{purchaser ? line.name : (line.stock_name ?? line.name)}</span>
        {!line.stock_item_id && <span className="block break-words text-control font-normal text-muted-foreground">{t('receiving.unmapped')}</span>}
        {purchaser && mapping && <div className="max-w-60 font-normal">{mapping(line)}</div>}
      </div>,
    },
    ...(purchaser ? [
      { key: 'ordered', header: t('receiving.ordered'), align: 'num' as const, size: 96, cell: (line: ReceivingLine) => figure(line.ordered, line) },
      { key: 'received', header: t('receiving.received'), align: 'num' as const, size: 96, cell: (line: ReceivingLine) => figure(line.received, line) },
      { key: 'outstanding', header: t('receiving.outstanding'), align: 'num' as const, size: 96, cell: (line: ReceivingLine) => figure(line.outstanding, line) },
      { key: 'status', header: t('receiving.status'), kind: 'status' as const, size: 176, colClassName: 'hidden xl:table-cell', cell: (line: ReceivingLine) => line.status ? <StatusPill variant={RECEIVING_VARIANT[line.status]}>{t(`receiving.${line.status}`)}</StatusPill> : null },
    ] : []),
    {
      key: 'counted', header: t('receiving.countedColumn'), align: 'num', keepWhenBlank: true, size: 168,
      cell: (line) => line.stock_item_id
        ? <div className="flex items-center justify-end gap-2">
          <TextField id={`count-${line.id}`} hideLabel label={`${t('receiving.counted')} · ${line.stock_name ?? line.name} (${line.unit ?? ''})`}
            value={quantities[line.id] ?? ''} onChange={(value) => onChange(line.id, value)} inputMode="decimal" disabled={disabled}
            wrapperClassName="w-24" className="text-right tabular-nums" />
          <span className="w-8 text-left text-control text-muted-foreground">{line.unit}</span>
        </div>
        : <div className="flex items-center justify-end gap-2"><span className="w-24 text-right text-muted-foreground">—</span><span className="w-8" aria-hidden="true" /></div>,
    },
  ];
  const checked = lines.filter((line) => line.stock_item_id && line.needs_quality_check && isPositiveDecimal(normalizeDecimal(quantities[line.id] ?? '')));
  return <div className="space-y-6">
    <DataTable<ReceivingLine> rows={lines} columns={columns} rowKey={(line) => line.id} tableId="order-receiving-lines" accessibleName={t('receiving.lines')} embedded cardValuesEnd rowMenu={rowMenu} />
    {checked.length > 0 && <section className="space-y-4" aria-label={t('receiving.qualityTitle')}>
      <h2 className="text-base font-semibold">{t('receiving.qualityTitle')}</h2>
      {checked.map((line) => <div key={line.id} className="space-y-2">
        <h3 className="text-control font-medium">{line.stock_name ?? line.name} · {qty(normalizeDecimal(quantities[line.id] ?? ''))} {line.unit}</h3>
        <ReceiptQualityFields idPrefix={`check-${line.id}`} value={checks[line.id] ?? { passed: '', rejected: '', reason: '' }}
          onChange={(value) => onCheck(line.id, value)} problem={problems[line.id]} />
      </div>)}
    </section>}
  </div>;
}
