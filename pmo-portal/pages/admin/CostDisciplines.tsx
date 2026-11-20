import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, EntityFormModal, FormGrid, ListState, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import {
  workOrderCostRepository, DISCIPLINE_CODE_MAX, DISCIPLINE_NAME_MAX, type CostDiscipline, type CostDisciplineInput,
} from '@/src/lib/repositories/workOrderCosts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * #2623 (FR-WCA-010/011, AC-WCA-017): the organisation's cost disciplines — the list every cost form's discipline picker
 * offers. An Admin adds, renames and archives one; everyone else reads it. RLS (0950) is the authority; `can()` is UX.
 * Archive is a soft-archive (ADR-0018): a cost line that already names the discipline keeps it.
 */
type FormTarget = { mode: 'create' } | { mode: 'edit'; row: CostDiscipline };

export default function CostDisciplines() {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useCostDisciplines();
  const [form, setForm] = useState<FormTarget | null>(null);
  const [archiveFor, setArchiveFor] = useState<CostDiscipline | null>(null);
  const canCreate = may('create', 'costDiscipline');
  const canEdit = may('edit', 'costDiscipline');
  const canArchive = may('archive', 'costDiscipline');

  const refusals = {
    '23505': t('costDisciplines.duplicateCode', 'Another live discipline already uses this code.'),
    '42501': t('costDisciplines.adminOnly', 'Only an Admin can change the discipline list.'),
  };
  // Every cached discipline list (keyed by org, useCostDisciplines) refreshes: the pickers drop an archived one.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cost-disciplines'] });
  const save = useMutation({
    mutationFn: async ({ target, input }: { target: FormTarget; input: CostDisciplineInput }) => {
      if (target.mode === 'create') await workOrderCostRepository.createDiscipline(input);
      else await workOrderCostRepository.updateDiscipline(target.row.id, input);
    },
    onSuccess: invalidate,
  });
  const archive = useMutation({ mutationFn: (id: string) => workOrderCostRepository.archiveDiscipline(id), onSuccess: invalidate });

  const title = t('costDisciplines.title', 'Cost disciplines');
  const rows = query.data ?? [];

  const runArchive = async () => {
    if (!archiveFor) return;
    try {
      await archive.mutateAsync(archiveFor.id);
      toast(t('costDisciplines.archived', 'Discipline archived'), archiveFor.name, 'success');
      setArchiveFor(null);
    } catch (error) {
      const { headline, detail } = classifyMutationError(error, refusals);
      toast(headline, detail, 'warning');
    }
  };

  return <section aria-label={title} className="max-w-2xl space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {canCreate && rows.length > 0 && <Button variant="outline" size="sm" onClick={() => setForm({ mode: 'create' })}>{t('costDisciplines.add', 'Add discipline')}</Button>}
    </div>
    {query.isError ? (
      <ListState variant="error" title={t('costDisciplines.loadError', "Couldn't load the disciplines")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void query.refetch()} />
    ) : !query.data ? (
      <ListState variant="loading" rows={2} />
    ) : rows.length === 0 ? (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{t('costDisciplines.empty', 'No disciplines yet')}</span>
        {canCreate && <Button variant="outline" size="sm" onClick={() => setForm({ mode: 'create' })}>{t('costDisciplines.add', 'Add discipline')}</Button>}
      </div>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-normal">{t('costDisciplines.code', 'Code')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('costDisciplines.name', 'Name')}</th>
            {(canEdit || canArchive) && <th scope="col" className="py-2 font-normal"><span className="sr-only">{t('costDisciplines.actions', 'Actions')}</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 pr-4 font-medium">{row.code}</td>
              <td className="py-2 pr-4">{row.name}</td>
              {(canEdit || canArchive) && <td className="py-2 text-right">
                <div className="flex justify-end gap-1.5">
                  {canEdit && <Button variant="ghost" size="sm" aria-label={t('costDisciplines.editLabel', 'Edit {{name}}', { name: row.name })} onClick={() => setForm({ mode: 'edit', row })}>{t('costDisciplines.edit', 'Edit')}</Button>}
                  {canArchive && <Button variant="ghost" size="sm" aria-label={t('costDisciplines.archiveLabel', 'Archive {{name}}', { name: row.name })} onClick={() => setArchiveFor(row)}>{t('costDisciplines.archive', 'Archive')}</Button>}
                </div>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {!canCreate && <p className="text-sm text-muted-foreground">{t('costDisciplines.adminOnly', 'Only an Admin can change the discipline list.')}</p>}
    {form && <DisciplineForm target={form} pending={save.isPending} refusals={refusals}
      onClose={() => setForm(null)}
      onSave={async (input) => {
        await save.mutateAsync({ target: form, input });
        toast(t('costDisciplines.saved', 'Discipline saved'), input.name, 'success');
        setForm(null);
      }} />}
    <ConfirmDialog open={Boolean(archiveFor)} tone="default"
      title={t('costDisciplines.confirmArchiveTitle', 'Archive {{name}}?', { name: archiveFor?.name ?? '' })}
      description={t('costDisciplines.confirmArchiveDescription', 'It leaves the discipline pickers. Cost lines that already name it keep it.')}
      confirmLabel={t('costDisciplines.confirmArchive', 'Archive discipline')}
      loading={archive.isPending} onConfirm={() => void runArchive()} onCancel={() => setArchiveFor(null)} />
  </section>;
}

const DisciplineForm: React.FC<{
  target: FormTarget;
  pending: boolean;
  refusals: Record<string, string>;
  onClose: () => void;
  onSave: (input: CostDisciplineInput) => Promise<void>;
}> = ({ target, pending, refusals, onClose, onSave }) => {
  const { t } = useTranslation();
  const initial = target.mode === 'edit' ? target.row : { code: '', name: '' };
  const [code, setCode] = useState(initial.code);
  const [name, setName] = useState(initial.name);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const input = { code: code.trim(), name: name.trim() };
  const codeError = input.code.length > DISCIPLINE_CODE_MAX ? t('costDisciplines.tooLong', 'Use {{max}} characters or fewer.', { max: DISCIPLINE_CODE_MAX }) : undefined;
  const nameError = input.name.length > DISCIPLINE_NAME_MAX ? t('costDisciplines.tooLong', 'Use {{max}} characters or fewer.', { max: DISCIPLINE_NAME_MAX }) : undefined;
  const unchanged = target.mode === 'edit' && input.code === target.row.code && input.name === target.row.name;
  const invalid = !input.code || !input.name || Boolean(codeError || nameError) || unchanged;
  const submitLabel = target.mode === 'create' ? t('costDisciplines.add', 'Add discipline') : t('costDisciplines.save', 'Save discipline');
  return <EntityFormModal open
    title={target.mode === 'create' ? t('costDisciplines.addTitle', 'Add a discipline') : t('costDisciplines.editTitle', 'Edit discipline')}
    submitLabel={submitLabel} submitDisabled={invalid || pending} loading={pending}
    dirty={input.code !== initial.code || input.name !== initial.name} submitError={submitError}
    onClose={onClose}
    onSubmit={(e) => {
      e.preventDefault();
      if (invalid) return;
      setSubmitError(null);
      onSave(input).catch((error: unknown) => setSubmitError(classifyMutationError(error, refusals)));
    }}>
    <FormGrid>
      <TextField id="cost-discipline-code" label={t('costDisciplines.code', 'Code')} value={code} onChange={setCode} required error={codeError} autoComplete="off" />
      <TextField id="cost-discipline-name" label={t('costDisciplines.name', 'Name')} value={name} onChange={setName} required error={nameError} autoComplete="off" />
    </FormGrid>
  </EntityFormModal>;
};
