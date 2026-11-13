import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { BackBar } from '@/src/components/shell';
import { Button, Combobox, FormFooter, FormGrid, Icon, ListState, SelectField, TextField, UnsavedChangesDialog, useToast } from '@/src/components/ui';
import type { IconName } from '@/src/components/ui/icons';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgFxContext } from '@/src/hooks/useOrgFxContext';
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

function isDefinitiveRefusal(code: unknown): boolean {
  return typeof code === 'string' && code !== '23505' && /^(22|23|42|P0)[0-9A-Z]{3}$/.test(code);
}

function parseHave(value: string | null): ProcurementHave | null {
  return HAVE_VALUES.includes(value as ProcurementHave) ? value as ProcurementHave : null;
}

function ProcurementIntake({
  choices,
  onChoose,
  lockedChoice = null,
}: {
  choices: IntakeChoice[];
  onChoose: (choice: IntakeChoice['value']) => void;
  lockedChoice?: ProcurementHave | null;
}) {
  const { t } = useTranslation('procurementCreate');

  return (
    <section aria-labelledby="procurement-create-question" className="max-w-3xl">
      <h1 id="procurement-create-question" className="text-page font-bold tracking-[-0.02em]">
        {t('question', 'What do you have?')}
      </h1>
      {lockedChoice && (
        <p role="status" className="mt-4 text-control text-muted-foreground">
          {t('continueAttempt', 'The save may have completed. Continue with the same choice to retry.')}
        </p>
      )}
      <div className="mt-6 divide-y divide-border">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            disabled={lockedChoice !== null && choice.value !== lockedChoice}
            onClick={() => onChoose(choice.value)}
            className="group flex min-h-[68px] w-full items-center gap-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name={choice.icon} className="size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-control font-medium text-foreground">{choice.title}</span>
              <span className="mt-0.5 block text-control text-muted-foreground">{choice.description}</span>
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
  const orgFxContext = useOrgFxContext();
  const currencyKnown = orgFxContext.data !== undefined && !orgFxContext.isPlaceholderData && !orgFxContext.isError;
  const orgCurrency = orgFxContext.data?.currency ?? 'USD';
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
  const [errors, setErrors] = useState<{ title?: string; save?: { headline: string; detail: string }; conflict?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [attempt, setAttempt] = useState<{ input: AtomicProcurementInput; have: ProcurementHave } | null>(null);

  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const saveNeedsAttention = saving || attempt !== null;
  const leaveTitle = saveNeedsAttention ? t('unsaved.title', 'Unsaved procurement') : undefined;
  const leaveDescription = saveNeedsAttention
    ? saving
      ? t('unsaved.saving', 'Saving is in progress. Please wait until it finishes.')
      : t('unsaved.uncertain', 'The save may have completed. Leave this page?')
    : undefined;
  const leaveLabel = saveNeedsAttention ? t('unsaved.leave', 'Leave') : undefined;
  const stayLabel = saveNeedsAttention ? t('unsaved.stay', 'Stay') : undefined;
  const dirty = saving || attempt !== null || (
    title !== '' || supplierId !== null || budgetCategory !== '' || lines.length > 0 || selectedProject !== projectId
  );
  const holdLeave = useCallback((leave: () => void) => setPendingLeave(() => leave), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, guardHistory: true, onBlocked: holdLeave });

  const projectOption = projects.find((option) => option.value === selectedProject) ?? null;

  const choices = useMemo<IntakeChoice[]>(() => {
    const standardChoices: IntakeChoice[] = [
      {
        value: 'need',
        icon: 'plus',
        title: t('choices.need.title', 'A new need'),
        description: t('choices.need.description', 'Raise a purchase request'),
      },
    ];
    if (!canCaptureDocuments) return standardChoices;
    standardChoices.push(
      {
        value: 'order',
        icon: 'cart',
        title: t('choices.order.title', 'An order'),
        description: t('choices.order.description', 'Record an order you already have'),
      },
      {
        value: 'invoice',
        icon: 'invoices',
        title: t('choices.invoice.title', 'A supplier invoice'),
        description: t('choices.invoice.description', 'Track a supplier invoice'),
      },
      {
        value: 'payment',
        icon: 'payments',
        title: t('choices.payment.title', 'A scheduled payment'),
        description: t('choices.payment.description', 'Schedule a supplier payment'),
      },
    );

    if (realRole === 'Admin' || realRole === 'Finance') {
      standardChoices.push({
        value: 'accounting',
        icon: 'file',
        title: t('choices.accounting.title', 'A document already in the accounting system'),
        description: t('choices.accounting.description', 'Find documents outside a procurement'),
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

    const input: AtomicProcurementInput = attempt?.input ?? {
      id: crypto.randomUUID(),
      header: {
        title: title.trim(), projectId: selectedProject, vendorId: supplierId,
        ...(have === 'need' && budgetCategory ? { budgetCategory: budgetCategory as BudgetCategory } : {}),
      },
      lines: have === 'need' ? lines.map(({ id, name, quantity, rate, description }) => ({ id, name, quantity, rate, description })) : [],
    };
    const attemptHave = attempt?.have ?? have;
    setAttempt({ input, have: attemptHave });
    try {
      const procurement = await create.mutateAsync(input);
      if (attemptHave !== 'need') {
        navigate(`/procurement/${procurement.id}/timeline?record=${RECORD_KIND[attemptHave]}`, { replace: true });
      } else {
        navigate(`/procurement/${procurement.id}`, { replace: true });
      }
    } catch (error) {
      const classified = classifyMutationError(error);
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      const conflict = code === '23505';
      const definitive = !attempt && isDefinitiveRefusal(code);
      if (definitive) setAttempt(null);
      const detail = conflict
        ? t('reconcile', 'Open the saved request to reconcile it before retrying.')
        : definitive ? classified.detail : `${classified.detail} ${t('uncertainSave', 'The save may have completed. Check its status before starting a new request; retrying here uses the same request.')}`;
      const saveDetail = code === '42501' && detail === 'Request refused' ? '' : detail;
      setErrors({ save: { headline: classified.headline, detail: saveDetail }, conflict });
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!may('create', 'procurement')) {
    return <div className="p-6"><h1>{t('denied', 'You do not have permission to create procurements.')}</h1></div>;
  }

  if (!have) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 pb-6 md:p-6">
        <BackBar label={t('backToProcurement', 'Procurement')} onBack={() => guardLeave(() => navigate('/procurement'))} />
        <ProcurementIntake
          choices={choices}
          onChoose={choose}
          lockedChoice={attempt?.have ?? null}
        />
        <UnsavedChangesDialog
          open={pendingLeave !== null}
          title={leaveTitle}
          description={leaveDescription}
          discardDisabled={saving}
          discardLabel={leaveLabel}
          keepEditingLabel={stayLabel}
          onDiscard={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }}
          onKeepEditing={() => setPendingLeave(null)}
        />
      </div>
    );
  }

  const needForm = have === 'need';
  // The consequence of saving sits on the button: a request saves as a draft, a document goes on to record it.
  const submitLabels: Record<ProcurementHave, string> = {
    need: t('saveLabel.need', 'Save draft'),
    order: t('saveLabel.order', 'Save and record order'),
    invoice: t('saveLabel.invoice', 'Save and record invoice'),
    payment: t('saveLabel.payment', 'Save and record payment'),
  };
  const submitLabel = submitLabels[have];
  const submitBusy = saving || create.isPending;
  // Footer Cancel mirrors the top BackBar's guarded exit (choices screen for document capture,
  // the list otherwise); the unsaved-changes guard stays the same behaviour.
  const cancelCreate = canCaptureDocuments
    ? () => (saving ? guardLeave(() => setHave(null)) : setHave(null))
    : () => guardLeave(() => navigate('/procurement'));

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      {canCaptureDocuments
        ? <BackBar label={t('backToChoices', 'choose type')} onBack={() => saving ? guardLeave(() => setHave(null)) : setHave(null)} />
        : <BackBar label={t('backToProcurement', 'Procurement')} onBack={() => guardLeave(() => navigate('/procurement'))} />}
      <form id="procurement-create-form" onSubmit={submit} noValidate>
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="text-page font-bold tracking-[-0.02em]">{t('heading', 'New procurement')}</h1>
        </header>
        {errors.save && (
          <div role="alert" className="mb-4 rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive-text">
            <p className="font-semibold">{errors.save.headline}</p>
            {errors.save.detail && <p>{errors.save.detail}</p>}
          </div>
        )}
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
                emptyMessage={(query) => query ? undefined : t('references.noProjects', 'No projects available. You can continue without a project or ask an administrator to add one.')}
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
                emptyMessage={(query) => query ? undefined : t('references.noSuppliers', 'No suppliers available. A supplier is optional; ask an administrator to add one if needed.')}
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
        {attempt && errors.save && <Button type="button" variant="outline" onClick={() => guardLeave(() => navigate(`/procurement/${attempt.input.id}`))}>{errors.conflict ? t('openSavedRequest', 'Open saved request') : t('checkSaveStatus', 'Check request status')}</Button>}
        {needForm && (
          <>
          {orgFxContext.isError
            ? <ListState variant="error" title={t('currencyError', "Couldn't load your organisation's currency.")} onRetry={() => void orgFxContext.refetch()} />
            : !currencyKnown && <p role="status" className="text-sm text-muted-foreground">{t('currencyLoading', 'Loading organisation currency…')}</p>}
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
              currencyKnown={currencyKnown}
            />
          </fieldset>
          </>
        )}
        {/* The ONE place for the primary action: form footer, Cancel left of the primary. */}
        <FormFooter
          submitLabel={submitLabel}
          cancelLabel={t('actions.cancel', 'Cancel')}
          onCancel={cancelCreate}
          loading={submitBusy}
        />
      </form>
      <UnsavedChangesDialog
        open={pendingLeave !== null}
        title={leaveTitle}
        description={leaveDescription}
        discardDisabled={saving}
        discardLabel={leaveLabel}
        keepEditingLabel={stayLabel}
        onDiscard={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }}
        onKeepEditing={() => setPendingLeave(null)}
      />
    </div>
  );
}
