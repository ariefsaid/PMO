import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ConfirmDialog, EntityFormModal, FormGrid, ListState, SelectField, StatusPill, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { useDocumentTypes } from '@/src/hooks/useDocumentExpiry';
import { CanWrite } from '@/src/auth/usePermission';
import { usePeople } from '@/src/hooks/usePeople';
import {
  useClearanceDue, useClearanceEnabled, useClearanceItemMutations, useClearanceItems, useClearanceSummary,
} from '@/src/hooks/useClearance';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useRefusalText } from '@/src/lib/refusals';
import { parseTargetDays, clearanceOverdueByPerson } from '@/src/lib/checklistDue';
import type { ClearanceItemRow } from '@/src/lib/repositories/clearance';

/** Add or edit one checklist item. The organisation names its own items; PMO ships none. */
const ItemForm: React.FC<{ item?: ClearanceItemRow; nextOrder: number; onClose: () => void }> = ({ item, nextOrder, onClose }) => {
  const { t } = useTranslation('administration');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const { create, update } = useClearanceItemMutations();
  const [name, setName] = useState(item?.name ?? '');
  const [required, setRequired] = useState(item?.is_required ?? true);
  const [docType, setDocType] = useState(item?.document_type_id ?? '');
  const [targetDays, setTargetDays] = useState(item?.target_days ? String(item.target_days) : '');
  const docTypes = useDocumentTypes('person');
  const [nameError, setNameError] = useState<string>();
  const [targetError, setTargetError] = useState<string>();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setTargetError(undefined);
    if (!name.trim()) { setNameError(t('clearance.items.errName', 'Enter the item name')); return; }
    // The database checks 1..365 again (the column's check); this keeps a bad draft from ever leaving the form.
    const target = parseTargetDays(targetDays);
    if (target === undefined) { setTargetError(t('clearance.items.errTarget', 'Use a whole number of days from 1 to 365, or leave it blank.')); return; }
    setSaving(true);
    const run = item
      ? update.mutateAsync({ id: item.id, patch: { name, is_required: required, document_type_id: docType || null, target_days: target } })
      : create.mutateAsync({ name, is_required: required, sort_order: nextOrder, document_type_id: docType || null, target_days: target });
    run.then(() => { toast(t('clearance.items.saved', 'Item saved'), undefined, 'success'); onClose(); })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('clearance_items_name_live')) setNameError(t('clearance.items.dupName', 'An item with that name already exists'));
        else { const c = refusal(err); setSubmitError({ headline: c.headline, detail: c.detail }); }
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal open title={item ? t('clearance.items.editTitle', 'Edit item') : t('clearance.items.addTitle', 'Add item')}
      submitLabel={t('clearance.items.save', 'Save item')} onSubmit={submit} onClose={onClose} loading={saving} dirty submitError={submitError}>
      <FormGrid>
        <TextField id="clearance-item-name" label={t('clearance.items.name', 'Item name')} required value={name} error={nameError}
          onChange={(v) => { setName(v); setNameError(undefined); }} />
        <TextField id="clearance-item-target" label={t('clearance.items.target', 'Target (days)')} value={targetDays} inputMode="numeric" error={targetError}
          helper={t('clearance.items.targetHelp', 'Optional. Counted from the day a person is added. Leave blank for no target.')}
          onChange={(v) => { setTargetDays(v); setTargetError(undefined); }} />
        <SelectField label={t('clearance.items.documentType', 'Takes its dates from this document')} value={docType} onChange={setDocType}
          options={[{ value: '', label: t('clearance.items.noDocumentType', 'None: record the date on the checklist') },
            ...(docTypes.data ?? []).filter((x) => !x.is_medical).map((x) => ({ value: x.id, label: x.name }))]}
          helper={t('clearance.items.documentTypeHelp', 'Pick the document type, such as a licence. The expiry is then kept once, on the person’s document, and also appears on the expiring list.')} />
        <Checkbox checked={required} onChange={setRequired} label={t('clearance.items.required', 'Required to be cleared')}>
          {t('clearance.items.required', 'Required to be cleared')}
        </Checkbox>
      </FormGrid>
    </EntityFormModal>
  );
};

const ItemsSection: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const q = useClearanceItems();
  const { update } = useClearanceItemMutations();
  const [editing, setEditing] = useState<ClearanceItemRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<ClearanceItemRow | null>(null);
  const nextOrder = useMemo(() => (q.data?.reduce((m, i) => Math.max(m, i.sort_order), 0) ?? 0) + 1, [q.data]);
  return (
    <section aria-labelledby="clearance-items-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="clearance-items-heading" className="text-group font-semibold">{t('clearance.items.heading', 'Checklist items')}</h2>
        <CanWrite action="manage" entity="clearanceItem">
          <Button variant="primary" onClick={() => setEditing('new')}>{t('clearance.items.add', 'Add item')}</Button>
        </CanWrite>
      </div>
      <div className="mt-3">
        {q.isError ? <ListState variant="error" title={t('clearance.items.loadError', 'Couldn’t load the checklist items')} onRetry={() => void q.refetch()} />
          : q.isPending ? <ListState variant="loading" rows={3} />
          : q.data.length === 0 ? (
            <ListState variant="empty" title={t('clearance.items.emptyTitle', 'No checklist items yet')}
              sub={t('clearance.items.emptySub', 'List what a person needs before going to site. An Admin adds each item once; every person then gets the same checklist.')} />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {q.data.map((item) => (
                <li key={item.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 break-words font-medium">{item.name}</span>
                  <span className="flex items-center gap-2">
                    {item.target_days !== null && (
                      <span className="text-control text-muted-foreground">{t('clearance.items.targetValue', '{{count}} days', { count: item.target_days })}</span>
                    )}
                    <StatusPill variant={item.is_required ? 'open' : 'neutral'}>{item.is_required ? t('clearance.items.requiredTag', 'Required') : t('clearance.items.optionalTag', 'Optional')}</StatusPill>
                    <CanWrite action="manage" entity="clearanceItem">
                      <Button variant="ghost" size="sm" aria-label={t('clearance.items.editLabel', 'Edit {{name}}', { name: item.name })} onClick={() => setEditing(item)}>{t('clearance.items.edit', 'Edit')}</Button>
                      <Button variant="ghost" size="sm" aria-label={t('clearance.items.archiveLabel', 'Archive {{name}}', { name: item.name })} onClick={() => setArchiving(item)}>{t('clearance.items.archive', 'Archive')}</Button>
                    </CanWrite>
                  </span>
                </li>
              ))}
            </ul>
          )}
      </div>
      {editing && <ItemForm item={editing === 'new' ? undefined : editing} nextOrder={nextOrder} onClose={() => setEditing(null)} />}
      {archiving && (
        <ConfirmDialog open title={t('clearance.items.archiveTitle', 'Archive this item?')}
          description={t('clearance.items.archiveBody', 'It leaves every checklist and no longer counts toward being cleared. Dates already recorded are kept.')}
          confirmLabel={t('clearance.items.archive', 'Archive')} cancelLabel={t('clearance.cancel', 'Cancel')}
          onCancel={() => setArchiving(null)}
          onConfirm={() => {
            update.mutateAsync({ id: archiving.id, patch: { archived_at: new Date().toISOString() } })
              .then(() => toast(t('clearance.items.archived', 'Item archived'), undefined, 'success'))
              .catch((err: unknown) => toast(classifyMutationError(err).headline, undefined, 'error'))
              .finally(() => setArchiving(null));
          }} />
      )}
    </section>
  );
};

const PeopleSection: React.FC = () => {
  const { t } = useTranslation('administration');
  const people = usePeople();
  const summary = useClearanceSummary();
  const due = useClearanceDue();
  const byPerson = useMemo(() => new Map((summary.data ?? []).map((s) => [s.person_id, s])), [summary.data]);
  // One batch read from `person_clearance_due`: the database's own overdue answer per (person, item) (#2800).
  const overdueByPerson = useMemo(() => clearanceOverdueByPerson(due.data ?? []), [due.data]);
  const failed = people.isError || summary.isError || due.isError;
  return (
    <section aria-labelledby="clearance-people-heading" className="mt-6 border-t border-border pt-6">
      <h2 id="clearance-people-heading" className="text-group font-semibold">{t('clearance.people.heading', 'Who is cleared')}</h2>
      <div className="mt-3">
        {failed ? <ListState variant="error" title={t('clearance.people.loadError', 'Couldn’t load the people')} onRetry={() => { void people.refetch(); void summary.refetch(); void due.refetch(); }} />
          : people.isPending || summary.isPending || due.isPending ? <ListState variant="loading" rows={4} />
          : people.data.length === 0 ? (
            <ListState variant="empty" title={t('clearance.people.emptyTitle', 'No people in the register')} sub={t('clearance.people.emptySub', 'Add people under People first; then their checklist appears here.')} />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {people.data.map((p) => {
                const s = byPerson.get(p.id);
                const overdue = overdueByPerson.get(p.id) ?? 0;
                return (
                  <li key={p.id}>
                    <Link to={`/administration/clearance/${p.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="min-w-0 break-words"><span className="font-medium">{p.name}</span> <span className="record-id">{p.code}</span></span>
                      <span className="flex items-center gap-2 text-control text-muted-foreground">
                        {s && s.required_count > 0 && <span>{t('clearance.people.progress', '{{done}} of {{total}} required', { done: s.satisfied_count, total: s.required_count })}</span>}
                        {overdue > 0 && (
                          <span data-testid={`clearance-person-overdue-${p.id}`} className="tabular-nums text-warning-foreground">
                            {t('clearance.people.overdue', 'Overdue: {{count}}', { count: overdue })}
                          </span>
                        )}
                        <StatusPill variant={s?.cleared ? 'won' : 'warn'}>{s?.cleared ? t('clearance.cleared', 'Cleared') : t('clearance.notCleared', 'Not cleared')}</StatusPill>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </section>
  );
};

/** The Administration "Clearance" section (#2707): items, then who is cleared. A not-enabled state while the setting is off. */
export default function Clearance() {
  const { t } = useTranslation('administration');
  const enabled = useOrgSwitch('clearance');
  if (enabled.isError) return <ListState variant="error" title={t('clearance.setting.loadError', 'Couldn’t load this setting')} onRetry={() => void enabled.refetch()} />;
  if (enabled.isPending) return <ListState variant="loading" rows={3} />;
  if (!enabled.data) {
    return (
      <ListState variant="empty" title={t('clearance.off.title', 'The clearance checklist is not turned on')}
        sub={t('clearance.off.sub', 'An Admin can turn it on under Modules, in People and crews.')} />
    );
  }
  return (
    <div className="min-w-0">
      <ItemsSection />
      <PeopleSection />
    </div>
  );
}
