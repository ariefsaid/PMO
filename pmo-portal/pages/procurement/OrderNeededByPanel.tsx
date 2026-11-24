import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, FieldError, ListState, TextField } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { usePoNeededByRequired, useProcurementNeededBy } from '@/src/hooks/usePoNeededBy';
import { repositories } from '@/src/lib/repositories';

type Line = { id: string; name: string; needed_by?: string | null };

const NeededByReadState: React.FC<{ loading: boolean; title?: string; onRetry?: () => void }> = ({ loading, title, onRetry }) => (
  <ReadStateCard loading={loading} title={title} onRetry={onRetry} />
);

const ReadStateCard: React.FC<{ loading: boolean; title?: string; onRetry?: () => void }> = ({ loading, title, onRetry }) => {
  const { t } = useTranslation('procurement');
  return (
    <Card data-testid="order-needed-by-panel">
      <CardHead>{t('orderNeededBy.heading', 'Needed by')}</CardHead>
      <CardPad>
        {loading
          ? <ListState variant="loading" rows={1} />
          : <ListState variant="error" quiet title={title} onRetry={onRetry ?? (() => undefined)} />}
      </CardPad>
    </Card>
  );
};

/**
 * 1124d — the order's "needed by" date: one date on the order header that fills every line, with an optional own date per line.
 * Renders nothing only after the organisation setting has loaded and confirmed it is off. Editable until the order is sent to the supplier;
 * the database decides who may write and refuses to send the order without the date.
 */
export const OrderNeededByPanel: React.FC<{ procurementId: string; items: Line[]; editable: boolean; onSaved?: () => void }> = ({ procurementId, items, editable, onSaved }) => {
  const { t } = useTranslation('procurement');
  const required = usePoNeededByRequired();
  const header = useProcurementNeededBy(procurementId, required.data === true);
  const [date, setDate] = useState('');
  const [own, setOwn] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const signature = items.map((i) => `${i.id}:${i.needed_by ?? ''}`).join('|');
  useEffect(() => {
    if (header.data === undefined) return;
    setDate(header.data ?? '');
    setOwn(Object.fromEntries(items.map((i) => [i.id, i.needed_by ?? ''])));
  }, [header.data, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  if (required.data === undefined && required.isPending) return <NeededByReadState loading />;
  if (required.data === undefined && required.isError) {
    return <NeededByReadState loading={false} title={t('orderNeededBy.loadError', "Couldn't load this setting")} onRetry={() => void required.refetch()} />;
  }
  if (required.data !== true) return null;

  if (header.data === undefined && header.isPending) return <NeededByReadState loading />;
  if (header.data === undefined && header.isError) {
    return <NeededByReadState loading={false} title={t('orderNeededBy.valueLoadError', "Couldn't load this order's needed-by date")} onRetry={() => void header.refetch()} />;
  }

  const save = async () => {
    setSaving(true); setSaved(false); setFailure(null);
    try {
      const lines = items.flatMap((i) => {
        const value = own[i.id] ?? '';
        const current = i.needed_by ?? '';
        const headerChangedToLineDate = date !== (header.data ?? '') && value !== '' && value === date;
        if (value === current && !headerChangedToLineDate) return [];
        return [{ itemId: i.id, neededBy: value === '' || value === date ? null : value }];
      });
      await repositories.procurement.setNeededBy(procurementId, date || null, lines);
      setSaved(true); void header.refetch(); onSaved?.();
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
          <p className="text-control" data-testid="order-needed-by-value">{header.data ?? t('orderNeededBy.none', '—')}</p>
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
