import { useTranslation } from 'react-i18next';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import React, { useCallback, useEffect } from 'react';
import {
  Card,
  CardHead,
  CardPad,
  TextField,
  Combobox,
  FormGrid,
  FormActions,
  SelectField,
  useEntityForm,
  type ComboboxOption,
} from '@/src/components/ui';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import type { ProcurementHeaderPatch } from '@/src/lib/db/procurementCrud';
import type { BudgetCategory } from '@/src/lib/budget/categoryAccountMap';
import { BUDGET_CATEGORY_OPTIONS, BUDGET_CATEGORY_HELPER } from './budgetCategoryOptions';

// ---------------------------------------------------------------------------
// ProcurementHeaderEdit — the Draft-header edit panel (crud-components §3 inline
// detail-header edit, §9.3 "edit while Draft/Rejected"). CW-3a: the Edit affordance
// now lives in the canonical RecordHeader action zone; this panel is CONTROLLED by
// the host (`onClose`) and renders the editable header fields (title + project +
// vendor) directly with Save/Cancel. Inline rather than a giant modal-over-page.
//
// Backed by `useEntityForm`: one controlled-form
// helper owns values / dirty / submit / per-field validation, so the title-required
// rule and the disabled-Save state are the shared form contract, not ad-hoc state.
// Token-pure (Card / form primitives).
// ---------------------------------------------------------------------------

interface FormValues {
  title: string;
  projectId: string | null;
  vendorId: string | null;
  budgetCategory: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim()) errors.title = 'A request title is required.';
  return errors;
};

export interface ProcurementHeaderEditProps {
  title: string;
  projectId: string | null;
  projectName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** #803: the request's budget line (decides approval routing). */
  budgetCategory?: BudgetCategory | null;
  onSave: (patch: ProcurementHeaderPatch) => Promise<unknown>;
  onError: (err: unknown) => void;
  /** Host-controlled close (the panel is opened from the RecordHeader Edit action). */
  onClose: () => void;
  busy?: boolean;
}

export const ProcurementHeaderEdit: React.FC<ProcurementHeaderEditProps> = ({
  title,
  projectId,
  projectName,
  vendorId,
  vendorName,
  budgetCategory = null,
  onSave,
  onError,
  onClose,
  busy,
}) => {
  const { t } = useTranslation(['common', 'procurement', 'finance']);
  const form = useEntityForm<FormValues>({
    initialValues: { title, projectId, vendorId, budgetCategory: budgetCategory ?? '' },
    validate,
    idPrefix: 'pr-header-edit',
    module: 'procurement',
  });

  const { reset } = form;
  // Re-seed the form from the live props when the panel mounts (it is mounted only
  // while the header Edit action holds it open).
  useEffect(() => {
    reset({ title, projectId, vendorId, budgetCategory: budgetCategory ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount from props
  }, []);

  const titleField = form.fieldProps('title');

  const { data: projectOptions } = useProjectOptions();
  const { data: vendorOptions } = useVendorOptions();
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => projectOptions ?? [],
    [projectOptions],
  );
  const loadVendors = useCallback(
    async (): Promise<ComboboxOption[]> => vendorOptions ?? [],
    [vendorOptions],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          title: values.title.trim(),
          projectId: values.projectId,
          vendorId: values.vendorId,
          // Sent only when changed, so an untouched form saves exactly what it did before #803.
          ...(values.budgetCategory !== (budgetCategory ?? '')
            ? { budgetCategory: (values.budgetCategory || null) as BudgetCategory | null }
            : {}),
        });
        onClose();
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <Card className="mb-4" data-testid="header-edit-card">
      <CardHead><span className="text-xl font-bold">{t('procurement:headerEdit.heading', 'Edit request details')}</span></CardHead>
      <form onSubmit={handleSubmit} className="max-[767px]:[&_input]:min-h-11 max-[767px]:[&_select]:min-h-11 max-[767px]:[&_button]:min-h-11">
        <CardPad className="flex flex-col gap-4">
          <FormGrid>
            <TextField
              id={titleField.id}
              label={t('procurement:create.titleField', 'Title')}
              required
              value={titleField.value}
              onChange={titleField.onChange}
              onBlur={titleField.onBlur}
              error={titleField.error ? t('procurement:headerEdit.titleRequired', titleField.error) : undefined}
              fullWidth
              placeholder={t('procurement:headerEdit.titlePlaceholder', 'Request title')}
            />
            <Combobox
              label={t('procurement:create.project', 'Project')}
              noun={t('procurement:create.project', 'Project')}
              placeholder={projectName ?? t('procurement:create.selectProject', 'Select a project…')}
              value={form.values.projectId}
              selectedOption={
                form.values.projectId
                  ? projectOptions?.find((option) => option.value === form.values.projectId) ??
                    (projectName ? { value: form.values.projectId, label: projectName } : undefined)
                  : undefined
              }
              onChange={(v) => form.setValue('projectId', v)}
              loadOptions={loadProjects}
            />
            <Combobox
              label={t('procurement:create.vendor', 'Vendor')}
              noun={t('procurement:create.vendor', 'Vendor')}
              placeholder={vendorName ?? t('procurement:create.selectVendor', 'Optional — select a vendor…')}
              value={form.values.vendorId}
              selectedOption={
                form.values.vendorId && vendorName
                  ? { value: form.values.vendorId, label: vendorName }
                  : undefined
              }
              onChange={(v) => form.setValue('vendorId', v)}
              loadOptions={loadVendors}
            />
            <SelectField
              id="pr-header-edit-budget-category"
              label={t('procurement:create.budgetCategory', 'Budget category')}
              value={form.values.budgetCategory}
              onChange={(v) => form.setValue('budgetCategory', v)}
              options={BUDGET_CATEGORY_OPTIONS.map((option) => ({ ...option, label: option.value ? budgetCategoryLabel(option.value, t) : t('expenses.form.category.none', 'No category') }))}
              helper={t('expenses.form.category.helper', BUDGET_CATEGORY_HELPER)}
            />
          </FormGrid>
          <FormActions
            submitLabel={t('procurement:headerEdit.saveRequest', 'Save request')}
            onCancel={onClose}
            disabled={!form.canSubmit}
            loading={busy || form.isSubmitting}
          />
        </CardPad>
      </form>
    </Card>
  );
};

ProcurementHeaderEdit.displayName = 'ProcurementHeaderEdit';
