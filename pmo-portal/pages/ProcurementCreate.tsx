import React, { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackBar } from '@/src/components/shell';
import { Button, Combobox, ConfirmDialog, FormGrid, SelectField, TextField, useToast } from '@/src/components/ui';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import { useCreateProcurement, useCreateProcurementItem } from '@/src/hooks/useProcurementCrud';
import type { NewProcurementInput, ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import { LineItemsSection } from './procurement/LineItemsSection';
import { BUDGET_CATEGORY_OPTIONS, BUDGET_CATEGORY_HELPER } from './procurement/budgetCategoryOptions';
import type { BudgetCategory } from '@/src/lib/budget/categoryAccountMap';

interface DraftLine {
  id: string;
  name: string;
  quantity: number;
  rate: number;
  amount: number | null;
  description: string | null;
}

export default function ProcurementCreate() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const create = useCreateProcurement();
  const createItem = useCreateProcurementItem();
  const projectId = new URLSearchParams(location.search).get('project');
  const { data: projects = [] } = useProjectOptions();
  const { data: vendors = [] } = useVendorOptions();
  const [title, setTitle] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(projectId);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [budgetCategory, setBudgetCategory] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errors, setErrors] = useState<{ title?: string; save?: string }>({});
  const [saving, setSaving] = useState(false);

  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const dirty = !saving && (title !== '' || vendorId !== null || budgetCategory !== '' || lines.length > 0 || selectedProject !== projectId);
  const holdLeave = useCallback((leave: () => void) => setPendingLeave(() => leave), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: holdLeave });

  const projectOption = useMemo(
    () => projects.find((option) => option.value === selectedProject) ?? null,
    [projects, selectedProject],
  );

  const addLine = async (line: { name: string; quantity: number; rate: number }) => {
    const amount = itemsNetTotal([{ quantity: line.quantity, rate: line.rate }]);
    setLines((current) => [
      ...current,
      {
        ...line,
        id: `draft-${crypto.randomUUID()}`,
        amount,
        description: null,
      },
    ]);
  };
  const updateLine = async (id: string, patch: { name: string; quantity: number; rate: number }) => {
    setLines((current) => current.map((line) => line.id === id
      ? { ...line, ...patch, amount: itemsNetTotal([{ quantity: patch.quantity, rate: patch.rate }]) }
      : line));
  };
  const removeLine = async (id: string) => setLines((current) => current.filter((line) => line.id !== id));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setErrors({ title: t('procurement:create.titleRequired', 'A request title is required.') });
      return;
    }
    setErrors({});
    setSaving(true);

    let savedId: string;
    try {
      const input: NewProcurementInput = {
        title: title.trim(),
        projectId: selectedProject,
        vendorId,
        ...(budgetCategory ? { budgetCategory: budgetCategory as BudgetCategory } : {}),
      };
      const request = await create.mutateAsync(input);
      savedId = request.id;
    } catch (error) {
      const classified = classifyMutationError(error);
      setErrors({ save: classified.detail });
      toast(classified.headline, classified.detail, 'warning');
      setSaving(false);
      return;
    }

    const failedLines: Array<{ headline: string; detail: string }> = [];
    for (const line of lines) {
      try {
        await createItem.mutateAsync({
          procurementId: savedId,
          input: { name: line.name, quantity: line.quantity, rate: line.rate },
        });
      } catch (error) {
        const classified = classifyMutationError(error);
        failedLines.push({ headline: classified.headline, detail: classified.detail });
      }
    }
    if (failedLines.length > 0) {
      toast(failedLines[0].headline, failedLines.map((failure) => failure.detail).join(' · '), 'warning');
    }
    navigate(`/procurement/${savedId}`, { replace: true });
  };

  if (!may('create', 'procurement')) {
    return <main className="p-6"><h1>{t('procurement:create.denied', 'You do not have permission to create purchase requests.')}</h1></main>;
  }

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <BackBar label={t('shell.nav.procurement', 'Procurement')} onBack={() => guardLeave(() => navigate('/procurement'))} />
      <form onSubmit={submit} noValidate>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('procurement:create.heading', 'New purchase request')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('procurement:create.draftNote', 'This request remains a draft until you submit it.')}</p>
          </div>
          <Button type="submit" variant="primary" loading={saving || create.isPending || createItem.isPending}>
            {t('common.save', 'Save')}
          </Button>
        </header>
        <section className="mb-6 border-b border-border pb-6" aria-label={t('procurement:create.requestDetails', 'Request details')}>
          <h2 className="mb-4 font-semibold">{t('procurement:create.requestDetails', 'Request details')}</h2>
          <FormGrid>
            <TextField
              id="procurement-create-title"
              label={t('procurement:create.titleField', 'Title')}
              required
              value={title}
              onChange={(value) => { setTitle(value); setErrors((current) => ({ ...current, title: undefined })); }}
              error={errors.title}
              fullWidth
            />
            <Combobox
              label={t('procurement:create.project', 'Project')}
              noun="project"
              placeholder={t('procurement:create.selectProject', 'Select a project…')}
              value={selectedProject}
              selectedOption={projectOption}
              onChange={setSelectedProject}
              loadOptions={async () => projects}
            />
            <Combobox
              label={t('procurement:create.vendor', 'Vendor')}
              noun="vendor"
              placeholder={t('procurement:create.selectVendor', 'Optional — select a vendor…')}
              value={vendorId}
              selectedOption={vendors.find((option) => option.value === vendorId) ?? null}
              onChange={setVendorId}
              loadOptions={async () => vendors}
            />
            <SelectField
              id="procurement-create-budget-category"
              label={t('procurement:create.budgetCategory', 'Budget category')}
              value={budgetCategory}
              onChange={setBudgetCategory}
              options={BUDGET_CATEGORY_OPTIONS}
              helper={BUDGET_CATEGORY_HELPER}
            />
          </FormGrid>
        </section>
        {errors.save && <p role="alert" className="mb-4 text-sm text-destructive-text">{errors.save}</p>}
        <LineItemsSection
          items={lines as unknown as ProcurementItemRow[]}
          editable
          onAdd={addLine}
          onUpdate={updateLine}
          onDelete={removeLine}
          onError={(error) => { const classified = classifyMutationError(error); toast(classified.headline, classified.detail, 'warning'); }}
          currency="USD"
        />
      </form>
      <ConfirmDialog
        open={pendingLeave !== null}
        tone="default"
        title={t('procurement:create.unsaved.title', 'Unsaved request')}
        description={t('procurement:create.unsaved.description', 'This request has not been saved. Leave this page and discard it?')}
        confirmLabel={t('procurement:create.unsaved.leave', 'Leave')}
        cancelLabel={t('procurement:create.unsaved.stay', 'Stay')}
        onConfirm={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }}
        onCancel={() => setPendingLeave(null)}
      />
    </main>
  );
}
