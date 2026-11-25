import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/src/components/ui';
import { ReceiptQualityFields } from '@/src/components/stock/ReceiptQualityFields';
import type { QualityProblem, QualityValue } from '@/src/lib/receiptQuality';
import { isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import type { ReceivingLine } from '@/src/lib/db/orderReceiving';

export function OrderReceivingLines({ lines, quantities, onChange, checks, onCheck, problems = {}, disabled = false }: {
  lines: ReceivingLine[]; quantities: Record<string, string>; onChange: (id: string, value: string) => void;
  /** D4: the quality check of each counted line whose item is flagged for one. */
  checks: Record<string, QualityValue>; onCheck: (id: string, value: QualityValue) => void; problems?: Record<string, QualityProblem | null>; disabled?: boolean;
}) {
  const { t } = useTranslation('stock');
  return <div className="space-y-4">{lines.map((line) => <div key={line.id} className="border-b border-border pb-4">
    {line.stock_item_id
      ? <div className="space-y-3">
        <TextField id={`count-${line.id}`} label={`${t('receiving.counted')} · ${line.stock_name ?? line.name} (${line.unit ?? ''})`}
          value={quantities[line.id] ?? ''} onChange={(value) => onChange(line.id, value)} inputMode="decimal" disabled={disabled} />
        {line.needs_quality_check && isPositiveDecimal(normalizeDecimal(quantities[line.id] ?? '')) && (
          <ReceiptQualityFields idPrefix={`check-${line.id}`} value={checks[line.id] ?? { passed: '', rejected: '', reason: '' }}
            onChange={(value) => onCheck(line.id, value)} problem={problems[line.id]} />)}
      </div>
      : <><p className="text-control font-medium">{line.name}</p><p className="text-control text-muted-foreground">{t('receiving.unmapped')}</p></>}
  </div>)}</div>;
}
