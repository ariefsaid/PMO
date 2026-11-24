import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/src/components/ui';
import type { ReceivingLine } from '@/src/lib/db/orderReceiving';

export function OrderReceivingLines({ lines, quantities, onChange, disabled = false }: {
  lines: ReceivingLine[]; quantities: Record<string, string>; onChange: (id: string, value: string) => void; disabled?: boolean;
}) {
  const { t } = useTranslation('stock');
  return <div className="space-y-4">{lines.map((line) => <div key={line.id} className="border-b border-border pb-4">
    {line.stock_item_id
      ? <TextField id={`count-${line.id}`} label={`${t('receiving.counted')} · ${line.stock_name ?? line.name} (${line.unit ?? ''})`}
        value={quantities[line.id] ?? ''} onChange={(value) => onChange(line.id, value)} inputMode="decimal" disabled={disabled} />
      : <><p className="text-control font-medium">{line.name}</p><p className="text-control text-muted-foreground">{t('receiving.unmapped')}</p></>}
  </div>)}</div>;
}
