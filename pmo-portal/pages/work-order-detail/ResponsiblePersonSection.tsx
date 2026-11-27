import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection, SelectField } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useResponsibleCandidates, useSetResponsiblePerson, useWorkOrderResponsiblePerson } from '@/src/hooks/useWorkOrderResponsible';
import { useRefusalLine } from '@/src/lib/refusals';

/**
 * The work order's responsible person: the site engineer the usage warning goes to (usage-warning spec FR-UW-010..012).
 * Whoever may edit a work order can change it; everyone else reads it. Empty means the warning goes to the project manager.
 */
export const ResponsiblePersonSection: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('workOrders');
  const may = usePermission();
  const canEdit = may('create', 'workOrder');
  const current = useWorkOrderResponsiblePerson(workOrderId);
  const people = useResponsibleCandidates(true);
  const set = useSetResponsiblePerson(workOrderId);
  const refusal = useRefusalLine();
  if (current.isError || people.isError) return <RecordSection title={t('responsible.title', 'Responsible person')}><ListState variant="error" title={t('common:readError')} onRetry={() => { if (current.isError) void current.refetch(); if (people.isError) void people.refetch(); }} /></RecordSection>;
  if (current.data === undefined) return null;
  const options = people.data ?? [];
  const name = options.find((o) => o.id === current.data)?.name;
  return (
    <RecordSection title={t('responsible.title', 'Responsible person')} data-testid="wo-responsible-person">
      {canEdit ? (
        <SelectField label={t('responsible.label', 'Site engineer for this work order')} value={current.data ?? ''} disabled={set.isPending}
          onChange={(v) => set.mutate(v || null)}
          options={[{ value: '', label: t('responsible.none', 'Not set') }, ...options.map((o) => ({ value: o.id, label: o.name }))]}
          helper={t('responsible.help', 'Material usage warnings for this work order go to this person. While it is not set they go to the project manager.')} />
      ) : (
        <p className="text-foreground">{name ?? t('responsible.noneReadOnly', 'Not set. Ask a project manager to name the site engineer.')}</p>
      )}
      {set.isError && <p role="alert" className="text-destructive">{refusal(set.error)}</p>}
    </RecordSection>
  );
};
