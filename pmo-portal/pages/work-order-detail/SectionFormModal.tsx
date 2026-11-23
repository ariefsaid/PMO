import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, FormGrid, TextField, useEntityForm, useToast, type SubmitError } from '@/src/components/ui';
import { useTerms } from '@/src/lib/i18n/terms';
import { useOrgProfilesLoader } from '@/src/hooks/useOrgProfilesLoader';
import { useSaveSection } from '@/src/hooks/useWorkOrderSections';
import { useSectionRefusal } from './useSectionRefusal';
import type { SectionRollupRow } from '@/src/lib/repositories/workOrderSections';

interface Values { code: string; name: string; note: string; foreman: string; order: string }

interface Props {
  workOrderId: string;
  /** null = add. */
  section: SectionRollupRow | null;
  /** The next sort order offered on add. */
  nextOrder: number;
  foremanNames: Map<string, string>;
  onClose: () => void;
}

/** Add or edit one section (FR-WOS-001..003): code, name, location or scope note, optional foreman, order. */
export const SectionFormModal: React.FC<Props> = ({ workOrderId, section, nextOrder, foremanNames, onClose }) => {
  const { t } = useTranslation('workOrderSections');
  const terms = useTerms();
  const sectionRefusal = useSectionRefusal();
  const { toast } = useToast();
  const save = useSaveSection(workOrderId);
  const loadProfiles = useOrgProfilesLoader();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm<Values>({
    initialValues: {
      code: section?.code ?? '', name: section?.name ?? '', note: section?.locationNote ?? '',
      foreman: section?.foremanId ?? '', order: String(section?.sortOrder ?? nextOrder),
    },
    idPrefix: 'wos-section', requiredFields: ['code', 'name'], module: 'workOrderSections',
    validate: (v) => {
      const e: Partial<Record<keyof Values, string>> = {};
      if (!v.code.trim()) e.code = t('code', 'Code');
      else if (v.code.trim().length > 20) e.code = t('code', 'Code');
      if (!v.name.trim()) e.name = t('name', 'Name');
      if (!/^\d{1,6}$/.test(v.order.trim())) e.order = t('order', 'Order');
      return e;
    },
  });
  const loadOptions = useMemo(() => async () => (await loadProfiles()).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.full_name })), [loadProfiles]);
  const vars = { section: terms.section.toLowerCase() };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        await save.mutateAsync({
          id: section?.sectionId ?? null,
          input: { code: v.code, name: v.name, locationNote: v.note || null, foremanId: v.foreman || null, sortOrder: Number(v.order) },
        });
        toast(t('saved', 'Saved'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError(sectionRefusal(err));
      }
    });
  };

  const foreman = form.values.foreman;
  return (
    <EntityFormModal open title={section ? t('editTitle', 'Edit {{section}}', vars) : t('addTitle', 'Add {{section}}', vars)}
      submitLabel={t('save', 'Save {{section}}', vars)} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty} submitError={submitError}
      errorSummary={form.hasAttemptedSubmit ? Object.entries(form.errors).map(([k, m]) => ({ fieldId: form.fieldProps(k as keyof Values).id, message: String(m) })) : undefined}>
      <FormGrid>
        <TextField label={t('code', 'Code')} required spellCheck={false} maxLength={20} {...form.fieldProps('code')} />
        <TextField label={t('name', 'Name')} required maxLength={120} {...form.fieldProps('name')} />
        <TextField label={t('note', 'Location or scope')} maxLength={500} {...form.fieldProps('note')} />
        <Combobox label={t('foreman', 'Foreman')} value={foreman || null} clearable
          selectedOption={foreman ? { value: foreman, label: foremanNames.get(foreman) ?? foreman } : null}
          loadOptions={loadOptions} placeholder={t('foremanPlaceholder', 'No foreman')}
          searchPlaceholder={t('foremanSearch', 'Search users')} onChange={(value) => form.setValue('foreman', value)}
          onClear={() => form.setValue('foreman', '')} />
        <TextField label={t('order', 'Order')} inputMode="numeric" {...form.fieldProps('order')} />
      </FormGrid>
    </EntityFormModal>
  );
};
