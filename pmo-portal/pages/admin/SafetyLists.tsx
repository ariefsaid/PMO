import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, Switch, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useSafetyEnabled, useSafetyList, useSafetyMutations } from '@/src/hooks/useSafetyDays';
import type { SafetyListKind } from '@/src/lib/db/safetyDays';

function ListEditor({ kind, title }: { kind: SafetyListKind; title: string }) {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const query = useSafetyList(kind, true);
  const m = useSafetyMutations();
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string>();

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setError(undefined);
    try { await work(); after?.(); toast(t('admin.saved', 'List saved'), undefined, 'success'); }
    catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail?.includes('duplicate') || headline.toLowerCase().includes('already') ? t('admin.duplicate', 'That entry is already in the list') : (detail || headline));
    }
  };
  return (
    <div className="space-y-3" data-testid={`safety-list-${kind}`}>
      <h3 className="text-base font-semibold">{title}</h3>
      {error && <FieldError id={`safety-list-error-${kind}`}>{error}</FieldError>}
      {query.isError && !query.data ? <ListState variant="error" title={t('admin.loadError', "Couldn't load the list")} onRetry={() => void query.refetch()} />
        : !query.data ? <ListState variant="loading" rows={2} />
        : query.data.length === 0 ? <p className="text-control text-muted-foreground">{t('admin.empty', 'Nothing listed yet')}</p>
        : (
          <ul className="divide-y divide-border">
            {query.data.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                {editing?.id === item.id ? (
                  <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => m.renameItem.mutateAsync({ id: item.id, label: editing.label }), () => setEditing(null)); }}>
                    <TextField label={t('admin.renameFor', { defaultValue: 'Name for {{name}}', name: item.label })} hideLabel value={editing.label} onChange={(v) => setEditing({ id: item.id, label: v })} />
                    <Button type="submit" variant="primary" disabled={!editing.label.trim() || m.renameItem.isPending}>{t('admin.save', 'Save')}</Button>
                    <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('admin.cancel', 'Cancel')}</Button>
                  </form>
                ) : (
                  <>
                    <span className={item.archived_at ? 'text-muted-foreground' : 'text-foreground'}>{item.label}{item.archived_at ? ` · ${t('admin.archived', 'Archived')}` : ''}</span>
                    <span className="flex gap-2">
                      <Button variant="outline" size="sm" aria-label={`${t('admin.rename', 'Rename')} ${item.label}`} onClick={() => setEditing({ id: item.id, label: item.label })}>{t('admin.rename', 'Rename')}</Button>
                      <Button variant="outline" size="sm" disabled={m.archiveItem.isPending} aria-label={`${item.archived_at ? t('admin.restore', 'Restore') : t('admin.archive', 'Archive')} ${item.label}`}
                        onClick={() => void run(() => m.archiveItem.mutateAsync({ id: item.id, archived: !item.archived_at }))}>
                        {item.archived_at ? t('admin.restore', 'Restore') : t('admin.archive', 'Archive')}
                      </Button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => m.addItem.mutateAsync({ kind, label: newLabel }), () => setNewLabel('')); }}>
        <TextField label={t('admin.addLabel', { defaultValue: 'New {{list}} entry', list: title.toLowerCase() })} value={newLabel} onChange={setNewLabel} />
        <Button type="submit" variant="primary" disabled={!newLabel.trim() || m.addItem.isPending}>{t('admin.add', 'Add')}</Button>
      </form>
    </div>
  );
}

/**
 * Administration › Projects › Safety records (#2596, FR-DSF-018, OD-SCOPE-2): the switch, and the three lists the client
 * keeps: fitness-check types, permit types and pre-work checklist items. Nothing is preset. Admin-only (UX); the Admin-only
 * row rules and set_safety_records_enabled are the authority (ADR-0016).
 */
const SafetyLists: React.FC = () => {
  const { t } = useTranslation('safety');
  const may = usePermission();
  const enabled = useSafetyEnabled();
  const m = useSafetyMutations();
  const { toast } = useToast();
  if (!may('manage', 'safetyLists')) return null;
  return (
    <section id="safety-records" tabIndex={-1} className="scroll-mt-4" aria-labelledby="safety-records-heading">
      <h2 id="safety-records-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.title', 'Safety records')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.helper', 'Daily safety records per work order. The check types, permit types and checklist items are yours: add what your sites use. Archiving hides an entry from new days; days that already use it keep it.')}</p>
      <div className="mt-4 flex items-center gap-3">
        <Switch checked={enabled.data === true} disabled={enabled.isPending || m.setEnabled.isPending} label={t('admin.enable', 'Record daily safety on work orders')}
          onChange={(v) => void m.setEnabled.mutateAsync(v).catch((err) => { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); })} />
        <span className="text-control">{t('admin.enable', 'Record daily safety on work orders')}</span>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <ListEditor kind="check_type" title={t('admin.checkTypes', 'Fitness check types')} />
        <ListEditor kind="permit_type" title={t('admin.permitTypes', 'Permit types')} />
        <ListEditor kind="checklist_item" title={t('admin.checklist', 'Pre-work checklist')} />
      </div>
    </section>
  );
};
export default SafetyLists;
