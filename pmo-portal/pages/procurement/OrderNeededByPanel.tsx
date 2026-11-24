import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, FieldError, TextField } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { usePoNeededByRequired, useProcurementNeededBy } from '@/src/hooks/usePoNeededBy';
import { setProcurementNeededBy } from '@/src/lib/db/procurementNeededBy';

type Line = { id: string; name: string; needed_by?: string | null };

/**
 * 1124d — the order's "needed by" date: one date on the order header that fills every line, with an optional own date per line.
 * Renders nothing while the organisation's rule is off. Editable until the order is sent to the supplier; the database decides who may write
 * and refuses to send the order without the date.
 */
export const OrderNeededByPanel: React.FC<{ procurementId: string; items: Line[]; editable: boolean; onSaved?: () => void }> = ({ procurementId, items, editable, onSaved }) => {
  const { t } = useTranslation('procurement');
  const required = usePoNeededByRequired();
  const header = useProcurementNeededBy(procurementId, required);
  const [date, setDate] = useState('');
  const [own, setOwn] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const signature = items.map((i) => `${i.id}:${i.needed_by ?? ''}`).join('|');
  useEffect(() => { setDate(header.value ?? ''); setOwn(Object.fromEntries(items.map((i) => [i.id, i.needed_by ?? '']))); }, [header.value, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!required) return null;
  const save = async () => {
    setSaving(true); setSaved(false); setFailure(null);
    try {
      // A line is sent only when its date differs from what the header will give it, so the others keep following the header.
      const lines = items.filter((i) => (own[i.id] ?? '') !== '' && own[i.id] !== (i.needed_by ?? '') && own[i.id] !== date)
        .map((i) => ({ itemId: i.id, neededBy: own[i.id] }));
      await setProcurementNeededBy(procurementId, date || null, lines);
      setSaved(true); header.reload(); onSaved?.();
    } catch (e) { setFailure(e); } finally { setSaving(false); }
  };
  const error = failure ? classifyMutationError(failure) : null;
  return (
    <Card data-testid="order-needed-by-panel">
      <CardHead>{t('orderNeededBy.heading', 'Needed by')}</CardHead>
      <CardPad>
        <p className="mb-3 text-control text-muted-foreground">{t('orderNeededBy.help', 'Required before the order is sent to the supplier. It fills every line; a line can carry its own date.')}</p>
        {editable ? (
          <TextField label={t('orderNeededBy.orderDate', 'Order needed by')} type="date" value={date} onChange={(v) => { setSaved(false); setDate(v); }} disabled={saving} />
        ) : (
          <p className="text-control" data-testid="order-needed-by-value">{header.value ?? t('orderNeededBy.none', '—')}</p>
        )}
        {items.length > 0 && (
          <ul className="mt-4 space-y-3">
            {items.map((i) => (
              <li key={i.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)] sm:items-end">
                <p className="min-w-0 break-words text-control font-medium">{i.name}</p>
                {editable
                  ? <TextField label={t('orderNeededBy.lineDate', 'Line needed by')} type="date" value={own[i.id] ?? ''} onChange={(v) => { setSaved(false); setOwn((o) => ({ ...o, [i.id]: v })); }} disabled={saving} fullWidth />
                  : <p className="text-control">{i.needed_by ?? t('orderNeededBy.none', '—')}</p>}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <div className="mt-4 flex items-center gap-3">
            <Button variant="outline" size="sm" loading={saving} onClick={() => void save()}>{t('orderNeededBy.save', 'Save')}</Button>
            <p role="status" className="text-control text-muted-foreground">{saved ? t('orderNeededBy.saved', 'Saved') : ''}</p>
          </div>
        )}
        {error && <FieldError>{error.detail || error.headline}</FieldError>}
      </CardPad>
    </Card>
  );
};
