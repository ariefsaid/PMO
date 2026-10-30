import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { BackBar } from '@/src/components/shell';
import { Button, Combobox, ConfirmDialog, FormGrid, Icon, SelectField, TextField, useToast } from '@/src/components/ui';
import type { IconName } from '@/src/components/ui/icons';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import { useCreateProcurementWithItems } from '@/src/hooks/useProcurementCrud';
import type { AtomicProcurementInput, ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import { LineItemsSection } from './procurement/LineItemsSection';
import { BUDGET_CATEGORY_OPTIONS, BUDGET_CATEGORY_HELPER } from './procurement/budgetCategoryOptions';
import type { BudgetCategory } from '@/src/lib/budget/categoryAccountMap';

type ProcurementHave = 'need' | 'order' | 'invoice' | 'payment';

interface DraftLine {
  id: string;
  name: string;
  quantity: number;
  rate: number;
  amount: number | null;
  description: string | null;
}

interface IntakeChoice {
  value: ProcurementHave | 'accounting';
  icon: IconName;
  title: string;
  description: string;
}

const HAVE_VALUES: ProcurementHave[] = ['need', 'order', 'invoice', 'payment'];
const RECORD_KIND: Record<Exclude<ProcurementHave, 'need'>, 'po' | 'invoice' | 'payment'> = {
  order: 'po',
  invoice: 'invoice',
  payment: 'payment',
};

function parseHave(value: string | null): ProcurementHave | null {
  return HAVE_VALUES.includes(value as ProcurementHave) ? value as ProcurementHave : null;
}

function ProcurementIntake({
  choices,
  description,
  onChoose,
  lockToNeed = false,
}: {
  choices: IntakeChoice[];
  description: string;
  onChoose: (choice: IntakeChoice['value']) => void;
  lockToNeed?: boolean;
}) {
  const { t } = useTranslation('procurementCreate');

  return (
    <section aria-labelledby="procurement-create-question" className="max-w-3xl">
      <h1 id="procurement-create-question" className="text-2xl font-semibold">
        {t('question', 'What do you have?')}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {description}
      </p>
      {lockToNeed && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t('continueNeed', 'A purchase request is saved with lines still to finish. Continue with the same need.')}
        </p>
      )}
      <div className="mt-6 divide-y divide-border">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            disabled={lockToNeed && choice.value !== 'need'}
            onClick={() => onChoose(choice.value)}
            className="group flex min-h-[68px] w-full items-center gap-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name={choice.icon} className="size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{choice.title}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{choice.description}</span>
            </span>
            <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </section>
  );
}

export default function ProcurementCreate() {
  const { t } = useTranslation('procurementCreate');
  const location = useLocation();
  const navigate = useNavigate();
  const may = usePermission();
  const realRole = useOptionalRealRole();
  const { toast } = useToast();
  const create = useCreateProcurementWithItems();
  const orgCurrency = useOrgCurrency();
  const params = new URLSearchParams(location.search);
  const [projectId] = useState(() => params.get('project'));
  const projectQuery = useProjectOptions();
  const supplierQuery = useVendorOptions();
  const { data: projects = [] } = projectQuery;
  const { data: suppliers = [] } = supplierQuery;
  const supplierOptions = useMemo(
    () => suppliers.map((option) => option.sub === 'Vendor' ? { ...option, sub: t('supplier', 'Supplier') } : option),
    [suppliers, t],
  );
  // Recording an existing order, supplier invoice or payment is for roles that may capture those documents;
  // everyone else raises a plain request.
  const canCaptureDocuments = may('create', 'procDoc');
  const [haveChoice, setHave] = useState<ProcurementHave | null>(() => parseHave(params.get('have')));
  // B3: a role that can only raise a need has one choice, so it starts straight on that form.
  const have: ProcurementHave | null = canCaptureDocuments ? haveChoice : 'need';
  const [title, setTitle] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(projectId);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [budgetCategory, setBudgetCategory] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errors, setErrors] = useState<{ title?: string; save?: string; conflict?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [attempt, setAttempt] = useState<AtomicProcurementInput | null>(null);

  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const dirty = saving || attempt !== null || (
    title !== '' || supplierId !== null || budgetCategory !== '' || lines.length > 0 || selectedProject !== projectId
  );
  const holdLeave = useCallback((leave: () => void) => setPendingLeave(() => leave), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: holdLeave });

  const projectOption = useMemo(
    () => projects.find((option) => option.value === selectedProject) ?? null,
    [projects, selectedProject],
  );

  const choices = useMemo<IntakeChoice[]>(() => {
    const standardChoices: IntakeChoice[] = [
      {
        value: 'need',
        icon: 'plus',
        title: t('choices.need.title', 'A new need'),
        description: t('choices.need.description', 'Raise a purchase request.'),
      },
    ];
    if (!canCaptureDocuments) return standardChoices;
    standardChoices.push(
      {
        value: 'order',
        icon: 'cart',
        title: t('choices.order.title', 'An order'),
        description: t('choices.order.description', 'Record a purchase order you already have.'),
      },
      {
        value: 'invoice',
        icon: 'invoices',
        title: t('choices.invoice.title', 'A supplier invoice'),
        description: t('choices.invoice.description', 'Record an invoice that needs tracking.'),
      },
      {
        value: 'payment',
        icon: 'payments',
        title: t('choices.payment.title', 'A scheduled payment'),
        description: t('choices.payment.description', 'Record a payment to a supplier. Finance marks it paid.'),
      },
    );

    if (realRole === 'Admin' || realRole === 'Finance') {
      standardChoices.push({
        value: 'accounting',
        icon: 'file',
        title: t('choices.accounting.title', 'A document already in the accounting system'),
        description: t('choices.accounting.description', 'Find documents that are not in a procurement.'),
      });
    }
    return standardChoices;
  }, [canCaptureDocuments, realRole, t]);

  const addLine = async (line: { name: string; quantity: number; rate: number }) => {
    const amount = itemsNetTotal([{ quantity: line.quantity, rate: line.rate }]);
    setLines((current) => [
      ...current,
      {
        ...line,
        id: crypto.randomUUID(),
        amount,
        description: null,
      },
    ]);
  };
  const updateLine = async (id: string, patch: { name: string; quantity?: number; rate?: number; description?: string }) => {
    setLines((current) => current.map((line) => {
      if (line.id !== id) return line;
      const updated = { ...line, ...patch, quantity: patch.quantity ?? line.quantity, rate: patch.rate ?? line.rate };
      return { ...updated, amount: itemsNetTotal([{ quantity: updated.quantity, rate: updated.rate }]) };
    }));
  };
  const removeLine = async (id: string) => setLines((current) => current.filter((line) => line.id !== id));

  const choose = (choice: IntakeChoice['value']) => {
    if (choice === 'accounting') {
      navigate('/procurement?tab=orphans');
      return;
    }
    setHave(choice);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!have || savingRef.current) return;
    if (!title.trim()) {
      setErrors({ title: t('titleRequired', 'A procurement title is required.') });
      return;
    }
    setErrors({});
    savingRef.current = true;
    setSaving(true);

    const input: AtomicProcurementInput = attempt ?? {
      id: crypto.randomUUID(),
      header: {
        title: title.trim(), projectId: selectedProject, vendorId: supplierId,
        ...(have === 'need' && budgetCategory ? { budgetCategory: budgetCategory as BudgetCategory } : {}),
      },
      lines: have === 'need' ? lines.map(({ id, name, quantity, rate, description }) => ({ id, name, quantity, rate, description })) : [],
    };
    setAttempt(input);
    try {
      const procurement = await create.mutateAsync(input);
      if (have !== 'need') {
        navigate(`/procurement/${procurement.id}/timeline?record=${RECORD_KIND[have]}`, { replace: true });
      } else {
        navigate(`/procurement/${procurement.id}`, { replace: true });
      }
    } catch (error) {
      const classified = classifyMutationError(error);
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      const conflict = code === '23505';
      if (code === '22023' || code === '23503' || code === '23514') setAttempt(null);
      const detail = conflict
        ? t('reconcile', 'Open the saved request to reconcile it before retrying.')
        : classified.detail;
      setErrors({ save: detail, conflict });
      toast(classified.headline, detail, 'warning');
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!may('create', 'procurement')) {
    return <main className="p-6"><h1>{t('denied', 'You do not have permission to create procurements.')}</h1></main>;
  }

  if (!have) {
    return (
      <main className="mx-auto w-full max-w-7xl p-4 pb-6 md:p-6">
        <BackBar label={t('backToProcurement', 'Procurement')} onBack={() => guardLeave(() => navigate('/procurement'))} />
        <ProcurementIntake
          choices={choices}
          description={canCaptureDocuments
            ? t('questionDescription', 'Start with a new need or a document already in hand.')
            : t('choices.need.description', 'Raise a purchase request.')}
          onChoose={choose}
          lockToNeed={Boolean(attempt)}
        />
        <ConfirmDialog
          open={pendingLeave !== null}
          tone="default"
          title={t('unsaved.title', 'Unsaved procurement')}
          description={saving ? t('unsaved.saving', 'Saving is in progress. Please wait until it finishes.') : attempt ? t('unsaved.uncertain', 'The save may have completed. Leave this page?') : t('unsaved.description', 'This procurement has not been saved. Leave this page and discard it?')}
          confirmDisabled={saving}
        confirmLabel={t('unsaved.leave', 'Leave')}
          cancelLabel={t('unsaved.stay', 'Stay')}
          onConfirm={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }}
          onCancel={() => setPendingLeave(null)}
        />
      </main>
    );
  }

  const needForm = have === 'need';
  const draftNotes: Record<ProcurementHave, string> = {
    need: t('draftNote.need', 'This purchase request remains a draft until you submit it.'),
    order: t('draftNote.order', 'Add the procurement details, then record the purchase order.'),
    invoice: t('draftNote.invoice', 'Add the procurement details, then record the supplier invoice.'),
    payment: t('draftNote.payment', 'Add the procurement details, then record the payment.'),
  };
  const draftNote = draftNotes[have];
  const submitLabel = t('save', 'Save');
  const submitBusy = saving || create.isPending;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 pb-24 md:p-6">
      {canCaptureDocuments
        ? <BackBar label={t('backToChoices', 'What do you have?')} onBack={() => saving ? guardLeave(() => setHave(null)) : setHave(null)} />
        : <BackBar label={t('backToProcurement', 'Procurement')} onBack={() => guardLeave(() => navigate('/procurement'))} />}
      <form id="procurement-create-form" onSubmit={submit} noValidate>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('heading', 'New procurement')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{draftNote}</p>
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:static md:ml-auto md:border-0 md:bg-transparent md:p-0">
            <Button type="submit" variant="primary" loading={submitBusy} className="w-full md:w-auto">
              {submitLabel}
            </Button>
          </div>
        </header>
        <section className="mb-6 border-b border-border pb-6" aria-label={t('details', 'Procurement details')}>
          <h2 className="mb-4 font-semibold">{t('details', 'Procurement details')}</h2>
          <fieldset disabled={Boolean(attempt) || saving}>
            <FormGrid>
              <TextField
                id="procurement-create-title"
                label={t('titleField', 'Title')}
                required
                value={title}
                onChange={(value) => { setTitle(value); setErrors((current) => ({ ...current, title: undefined })); }}
                error={errors.title}
                fullWidth
              />
              <Combobox
                label={t('project', 'Project')}
                noun="project"
                placeholder={t('selectProject', 'Select a project…')}
                value={selectedProject}
                selectedOption={projectOption}
                onChange={setSelectedProject}
                loadOptions={async () => projects}
                disabled={saving || Boolean(attempt) || projectQuery.isPending || projectQuery.isError || projectQuery.data === undefined}
              />
              <Combobox
                label={t('supplier', 'Supplier')}
                noun="supplier"
                placeholder={t('selectSupplier', 'Optional: select a supplier…')}
                value={supplierId}
                selectedOption={supplierOptions.find((option) => option.value === supplierId) ?? null}
                onChange={setSupplierId}
                loadOptions={async () => supplierOptions}
                disabled={saving || Boolean(attempt) || supplierQuery.isPending || supplierQuery.isError || supplierQuery.data === undefined}
              />
              {(projectQuery.isPending || projectQuery.isError || projectQuery.data === undefined) && <div role="status">{projectQuery.isPending ? t('references.loadingProjects', 'Loading projects…') : <>{t('references.projectsError', "Couldn't load projects.")} <Button type="button" variant="outline" onClick={() => void projectQuery.refetch()}>{t('references.retryProjects', 'Retry projects')}</Button></>}</div>}
              {(supplierQuery.isPending || supplierQuery.isError || supplierQuery.data === undefined) && <div role="status">{supplierQuery.isPending ? t('references.loadingSuppliers', 'Loading suppliers…') : <>{t('references.suppliersError', "Couldn't load suppliers.")} <Button type="button" variant="outline" onClick={() => void supplierQuery.refetch()}>{t('references.retrySuppliers', 'Retry suppliers')}</Button></>}</div>}
              {needForm && (
                <SelectField
                  id="procurement-create-budget-category"
                  label={t('budgetCategory', 'Budget category')}
                  value={budgetCategory}
                  onChange={setBudgetCategory}
                  options={BUDGET_CATEGORY_OPTIONS}
                  helper={BUDGET_CATEGORY_HELPER}
                />
              )}
            </FormGrid>
          </fieldset>
        </section>
        {errors.save && <p role="alert" className="mb-4 text-sm text-destructive-text">{errors.save}</p>}
        {errors.conflict && attempt && <Button type="button" variant="outline" onClick={() => guardLeave(() => navigate(`/procurement/${attempt.id}`))}>{t('openSavedRequest', 'Open saved request')}</Button>}
        {needForm && (
          <fieldset disabled={saving || Boolean(attempt)} className="contents">
            <LineItemsSection
              items={lines as unknown as ProcurementItemRow[]}
              editable
              busy={saving || Boolean(attempt)}
              onAdd={addLine}
              onUpdate={updateLine}
              onDelete={removeLine}
              onError={(error) => { const classified = classifyMutationError(error); toast(classified.headline, classified.detail, 'warning'); }}
              currency={orgCurrency}
            />
          </fieldset>
        )}
      </form>
      <ConfirmDialog
        open={pendingLeave !== null}
        tone="default"
        title={t('unsaved.title', 'Unsaved procurement')}
        description={saving ? t('unsaved.saving', 'Saving is in progress. Please wait until it finishes.') : attempt ? t('unsaved.uncertain', 'The save may have completed. Leave this page?') : t('unsaved.description', 'This procurement has not been saved. Leave this page and discard it?')}
        confirmDisabled={saving}
        confirmLabel={t('unsaved.leave', 'Leave')}
        cancelLabel={t('unsaved.stay', 'Stay')}
        onConfirm={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }}
        onCancel={() => setPendingLeave(null)}
      />
    </main>
  );
}
