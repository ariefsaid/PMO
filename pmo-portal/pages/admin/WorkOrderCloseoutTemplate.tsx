import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, useToast } from '@/src/components/ui';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { TextField } from '@/src/components/ui/FormFields';
import { usePermission } from '@/src/auth/usePermission';
import { useRefusalText } from '@/src/lib/refusals';
import { parseTargetDays } from '@/src/lib/checklistDue';
import { useCloseoutTemplate, useSaveCloseoutTemplate } from '@/src/hooks/useCloseoutChecklist';

/** At most this many items (the table's check). */
const MAX_ITEMS = 20;

interface Row { key: number; name: string; required: boolean; targetDays: string }

/**
 * The organisation's work-order close-out checklist (#2593, FR-WCO-001): an ordered list of items, each flagged required or
 * not, replaced whole. The items are the organisation's own words (acceptance letters, completion certificates, a material
 * count): PMO ships none. Admin only; the database refuses anyone else. Work orders already issued keep the list they were
 * issued with.
 * Each item can carry an optional target in days (#2800, FR-CTD-001): its due day on a work order is that work order's issue
 * day + the target, worked out by the database. Blank means no target, and a list saved before targets existed reads and
 * saves exactly as it did.
 */
export default function WorkOrderCloseoutTemplate() {
  const { t } = useTranslation('closeout');
  const refusal = useRefusalText();
  const may = usePermission();
  const { toast } = useToast();
  const query = useCloseoutTemplate();
  const save = useSaveCloseoutTemplate();
  const nextKey = useRef(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [missing, setMissing] = useState(false);
  const [badTarget, setBadTarget] = useState<number | null>(null);
  const canEdit = may('edit', 'closeoutChecklist');

  useEffect(() => {
    if (rows !== null || !query.data) return;
    setRows(query.data.map((i) => ({
      key: nextKey.current++, name: i.name, required: i.required, targetDays: i.targetDays === null ? '' : String(i.targetDays),
    })));
  }, [query.data, rows]);

  const title = t('admin.title', 'Close-out checklist');
  if (query.isError) {
    return <section aria-label={title} className="max-w-2xl">
      <ListState variant="error" title={t('admin.loadError', "Couldn't load the close-out checklist")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void query.refetch()} />
    </section>;
  }
  if (rows === null) return <ListState variant="loading" rows={2} />;

  const edit = (next: Row[]) => { setRows(next); setDirty(true); setBadTarget(null); };
  const update = (key: number, patch: Partial<Row>) => edit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number) => { const a = [...rows]; [a[index - 1], a[index]] = [a[index], a[index - 1]]; edit(a); };
  const remove = (key: number) => edit(rows.filter((r) => r.key !== key));
  const add = () => edit([...rows, { key: nextKey.current++, name: '', required: true, targetDays: '' }]);

  const submit = async () => {
    const blank = rows.some((r) => r.name.trim() === '');
    setMissing(blank);
    const invalid = rows.find((r) => parseTargetDays(r.targetDays) === undefined);
    setBadTarget(invalid?.key ?? null);
    if (blank || invalid) return;
    try {
      await save.mutateAsync(rows.map((r) => ({ name: r.name.trim(), required: r.required, targetDays: parseTargetDays(r.targetDays) ?? null })));
      setDirty(false);
      toast(t('admin.saved', 'Close-out checklist saved'), t('admin.savedSub', 'Work orders issued from now on use this list.'), 'success');
    } catch (err) {
      const { headline, detail } = refusal(err);
      toast(headline, detail, 'warning');
    }
  };

  return <section aria-label={title} className="max-w-2xl space-y-4">
    <h3 className="text-group font-semibold">{title}</h3>
    <p className="text-sm text-muted-foreground">{t('admin.help', 'The items every work order must complete, in order, before it can be closed. Each item needs an attached document. Work orders already issued keep the list they were issued with.')}</p>
    {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin.empty', 'No items. Work orders issued now close without a checklist.')}</p>}
    <ol className="space-y-3">
      {rows.map((row, index) => <li key={row.key}>
        <fieldset aria-label={t('admin.itemN', 'Item {{n}}', { n: index + 1 })} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <TextField label={t('admin.name', 'Item name')} value={row.name} disabled={!canEdit} onChange={(v) => update(row.key, { name: v })}
              error={missing && row.name.trim() === '' ? t('admin.nameMissing', 'Name the item.') : undefined} />
            <TextField label={t('admin.targetDays', 'Target (days)')} value={row.targetDays} disabled={!canEdit} inputMode="numeric"
              helper={t('admin.targetDaysHelp', 'Optional. Counted from the day the work order is issued. Leave blank for no target.')}
              onChange={(v) => update(row.key, { targetDays: v })}
              error={badTarget === row.key ? t('admin.targetDaysInvalid', 'Use a whole number of days from 1 to 365, or leave it blank.') : undefined} />
            <Checkbox checked={row.required} disabled={!canEdit} onChange={(v) => update(row.key, { required: v })}
              label={t('admin.required', 'Required before closing')}>
              {t('admin.required', 'Required before closing')}
            </Checkbox>
            {canEdit && <span className="ml-auto flex gap-2">
              {index > 0 && <Button type="button" variant="outline" size="sm" onClick={() => move(index)}
                aria-label={t('admin.moveUp', 'Move {{item}} up', { item: row.name || index + 1 })}>{t('admin.up', 'Up')}</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => remove(row.key)}
                aria-label={t('admin.removeNamed', 'Remove {{item}}', { item: row.name || index + 1 })}>{t('admin.remove', 'Remove')}</Button>
            </span>}
          </div>
        </fieldset>
      </li>)}
    </ol>
    {canEdit
      ? <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={add} disabled={rows.length >= MAX_ITEMS}>{t('admin.add', 'Add item')}</Button>
          <Button type="button" variant="primary" onClick={() => void submit()} disabled={save.isPending || !dirty}>{t('admin.save', 'Save checklist')}</Button>
          {rows.length >= MAX_ITEMS && <span className="text-sm text-muted-foreground">{t('admin.limit', 'At most 20 items.')}</span>}
        </div>
      : <p className="text-sm text-muted-foreground">{t('admin.readOnlyNote', 'Only an Admin can change the checklist.')}</p>}
  </section>;
}
