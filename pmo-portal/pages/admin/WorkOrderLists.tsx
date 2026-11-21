import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, EntityFormModal, FormGrid, ListState, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useWorkOrderListEntries, WORK_ORDER_LISTS_KEY } from '@/src/hooks/useWorkOrderLists';
import {
  workOrderListRepository, LIST_CODE_MAX, LIST_NAME_MAX, type WorkOrderListEntry, type WorkOrderListInput, type WorkOrderListKind,
} from '@/src/lib/repositories/workOrderLists';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * #2668 (FR-WAG-001/002): the organisation's own work-order areas and groups. An Admin adds, renames and archives an
 * entry; everyone else reads. RLS (1382) is the authority; `can()` is UX. Archive is a soft-archive (ADR-0018): a work
 * order that already names the entry keeps it. Nothing is coded: the entries are the client's data.
 */
type FormTarget = { mode: 'create' } | { mode: 'edit'; row: WorkOrderListEntry };

const ListSection: React.FC<{ kind: WorkOrderListKind }> = ({ kind }) => {
  const { t } = useTranslation(['workOrders']);
  const may = usePermission();
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useWorkOrderListEntries(kind);
  const [form, setForm] = useState<FormTarget | null>(null);
  const [archiveFor, setArchiveFor] = useState<WorkOrderListEntry | null>(null);
  const canCreate = may('create', 'workOrderList');
  const canEdit = may('edit', 'workOrderList');
  const canArchive = may('archive', 'workOrderList');

  const refusals = {
    '23505': t('workOrders:lists.duplicateCode', 'Another live entry already uses this code.'),
    '42501': t('workOrders:lists.adminOnly', 'Only an Admin can change this list.'),
  };
  const invalidate = () => qc.invalidateQueries({ queryKey: [WORK_ORDER_LISTS_KEY] });
  const save = useMutation({
    mutationFn: async ({ target, input }: { target: FormTarget; input: WorkOrderListInput }) => {
      if (target.mode === 'create') await workOrderListRepository.create(kind, input);
      else await workOrderListRepository.update(kind, target.row.id, input);
    },
    onSuccess: invalidate,
  });
  const archive = useMutation({ mutationFn: (id: string) => workOrderListRepository.archive(kind, id), onSuccess: invalidate });

  const title = kind === 'area' ? t('workOrders:lists.areaTitle', 'Work order areas') : t('workOrders:lists.groupTitle', 'Work order groups');
  const rows = (query.data ?? []).filter((row) => !row.archived_at);
  const addButton = canCreate && <Button variant="outline" size="sm" onClick={() => setForm({ mode: 'create' })}>{t('workOrders:lists.add', 'Add')}</Button>;

  const runArchive = async () => {
    if (!archiveFor) return;
    try {
      await archive.mutateAsync(archiveFor.id);
      toast(t('workOrders:lists.archived', 'Archived'), archiveFor.name, 'success');
      setArchiveFor(null);
    } catch (error) {
      const { headline, detail } = classifyMutationError(error, refusals);
      toast(headline, detail, 'warning');
    }
  };

  return <section aria-label={title} data-testid={`wo-list-${kind}`} className="max-w-2xl space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {rows.length > 0 && addButton}
    </div>
    {query.isError ? (
      <ListState variant="error" title={t('workOrders:lists.loadError', "Couldn't load the list")} onRetry={() => void query.refetch()} />
    ) : !query.data ? (
      <ListState variant="loading" rows={2} />
    ) : rows.length === 0 ? (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{t('workOrders:lists.empty', 'None yet')}</span>
        {addButton}
      </div>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-normal">{t('workOrders:lists.code', 'Code')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('workOrders:lists.name', 'Name')}</th>
            {(canEdit || canArchive) && <th scope="col" className="py-2 font-normal"><span className="sr-only">{t('workOrders:lists.actions', 'Actions')}</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 pr-4 font-medium">{row.code}</td>
              <td className="py-2 pr-4">{row.name}</td>
              {(canEdit || canArchive) && <td className="py-2 text-right">
                <div className="flex justify-end gap-1.5">
                  {canEdit && <Button variant="ghost" size="sm" aria-label={t('workOrders:lists.editLabel', 'Edit {{name}}', { name: row.name })} onClick={() => setForm({ mode: 'edit', row })}>{t('workOrders:lists.edit', 'Edit')}</Button>}
                  {canArchive && <Button variant="ghost" size="sm" aria-label={t('workOrders:lists.archiveLabel', 'Archive {{name}}', { name: row.name })} onClick={() => setArchiveFor(row)}>{t('workOrders:lists.archive', 'Archive')}</Button>}
                </div>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {form && <EntryForm target={form} pending={save.isPending} refusals={refusals}
      onClose={() => setForm(null)}
      onSave={async (input) => {
        await save.mutateAsync({ target: form, input });
        toast(t('workOrders:lists.saved', 'Saved'), input.name, 'success');
        setForm(null);
      }} />}
    <ConfirmDialog open={Boolean(archiveFor)} tone="default"
      title={t('workOrders:lists.confirmArchiveTitle', 'Archive {{name}}?', { name: archiveFor?.name ?? '' })}
      description={t('workOrders:lists.confirmArchiveDescription', 'It leaves the pickers. Work orders that already name it keep it.')}
      confirmLabel={t('workOrders:lists.confirmArchive', 'Archive')}
      loading={archive.isPending} onConfirm={() => void runArchive()} onCancel={() => setArchiveFor(null)} />
  </section>;
};

const EntryForm: React.FC<{
  target: FormTarget;
  pending: boolean;
  refusals: Record<string, string>;
  onClose: () => void;
  onSave: (input: WorkOrderListInput) => Promise<void>;
}> = ({ target, pending, refusals, onClose, onSave }) => {
  const { t } = useTranslation(['workOrders']);
  const initial = target.mode === 'edit' ? target.row : { code: '', name: '' };
  const [code, setCode] = useState(initial.code);
  const [name, setName] = useState(initial.name);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const input = { code: code.trim(), name: name.trim() };
  const codeError = input.code.length > LIST_CODE_MAX ? t('workOrders:lists.tooLong', 'Use {{max}} characters or fewer.', { max: LIST_CODE_MAX }) : undefined;
  const nameError = input.name.length > LIST_NAME_MAX ? t('workOrders:lists.tooLong', 'Use {{max}} characters or fewer.', { max: LIST_NAME_MAX }) : undefined;
  const unchanged = target.mode === 'edit' && input.code === target.row.code && input.name === target.row.name;
  const invalid = !input.code || !input.name || Boolean(codeError || nameError) || unchanged;
  return <EntityFormModal open
    title={target.mode === 'create' ? t('workOrders:lists.addTitle', 'Add an entry') : t('workOrders:lists.editTitle', 'Edit entry')}
    submitLabel={target.mode === 'create' ? t('workOrders:lists.add', 'Add') : t('workOrders:lists.save', 'Save')}
    submitDisabled={invalid || pending} loading={pending}
    dirty={input.code !== initial.code || input.name !== initial.name} submitError={submitError}
    onClose={onClose}
    onSubmit={(e) => {
      e.preventDefault();
      if (invalid) return;
      setSubmitError(null);
      onSave(input).catch((error: unknown) => setSubmitError(classifyMutationError(error, refusals)));
    }}>
    <FormGrid>
      <TextField id="wo-list-code" label={t('workOrders:lists.code', 'Code')} value={code} onChange={setCode} required error={codeError} autoComplete="off" />
      <TextField id="wo-list-name" label={t('workOrders:lists.name', 'Name')} value={name} onChange={setName} required error={nameError} autoComplete="off" />
    </FormGrid>
  </EntityFormModal>;
};

export default function WorkOrderLists() {
  const { t } = useTranslation(['workOrders']);
  return <div className="space-y-6">
    <p className="max-w-2xl text-sm text-muted-foreground">{t('workOrders:lists.hint', 'Your organisation’s own list. Work orders can name one; the work-order list can be grouped by it.')}</p>
    <ListSection kind="area" />
    <ListSection kind="group" />
  </div>;
}
