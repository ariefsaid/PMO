import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, Combobox, ConfirmDialog, Drawer, EntityFormModal, FieldError, FormGrid,
  ListState, SelectField, StatusPill, TextArea, TextField, useToast, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import {
  useAssembleTmClaim, useConfirmTmSignoff, useEndTmRateAssignee, useEndTmRateLine, usePrepareTmSignoff, useSaveTmRateLine,
  useSetTmRateAssignee, useTmClaimPreview, useTmClaimSources, useTmClaims, useTmRateAssignees,
  useTmRateLines, useWithdrawTmSignoff,
} from '@/src/hooks/useTimeAndMaterials';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { LIST_LIMIT, type ContractRateLineInput, type ContractRateLineRow, type TmClaimPreviewRow, type TmClaimSummary } from '@/src/lib/db/timeAndMaterials';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDateOnly, formatNumberExact } from '@/src/lib/format';
import { localToday } from '@/src/lib/efaktur';
import type { ComboboxOption } from '@/src/components/ui/Combobox';

interface TimeAndMaterialsProps {
  projectId: string;
  projectManagerId: string | null;
  currency: string;
  /** Removes the outer card when embedded in the Contract summary card. */
  embedded?: boolean;
  /** Opens the established Billing-tab invoice confirmation for this claim. */
  onCreateInvoice: (claimId: string) => void;
  /** True only while the existing progress-claim invoice path is available for this signed-off claim. */
  canCreateInvoice?: (claimId: string) => boolean;
  /** The invoice number a signed-off claim already has, when it has one. */
  invoiceNumberFor?: (claimId: string) => string | null;
}

type RateValues = { label: string; unit: 'hour' | 'day'; rate: string; effectiveFrom: string };

const today = localToday;
const firstOfMonth = (): string => `${today().slice(0, 7)}-01`;
const canBeEvidence = (document: ProjectDocumentRow): boolean =>
  (document.status === 'Issued' || document.status === 'Approved') && Boolean(document.file_path);
const EMPTY_RATE_LINES: ContractRateLineRow[] = [];

function normalizedItemName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function proposeSalesItem(label: string, items: readonly ComboboxOption[]): ComboboxOption | null {
  const exact = items.filter((item) => item.sub?.trim() === label.trim());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const normalizedLabel = normalizedItemName(label);
  if (!normalizedLabel) return null;
  const normalized = items.filter((item) => item.sub && normalizedItemName(item.sub) === normalizedLabel);
  return normalized.length === 1 ? normalized[0] : null;
}

const TimeAndMaterials: React.FC<TimeAndMaterialsProps> = ({ projectId, projectManagerId, currency, embedded = false, onCreateInvoice, canCreateInvoice, invoiceNumberFor }) => {
  const { t } = useTranslation('timeAndMaterials');
  const may = usePermission();
  const { currentUser } = useAuth();
  const { realRole, effectiveRole } = useEffectiveRole();
  const { toast, clear: clearToasts } = useToast();
  const viewOnly = realRole !== effectiveRole;
  const userId = currentUser?.id ?? '';

  const rateLines = useTmRateLines(projectId);
  const assignments = useTmRateAssignees(projectId);
  const claims = useTmClaims(projectId);
  const people = useAssignableProfiles();
  const documents = useDocuments(projectId);
  const erpItems = useErpItemOptions('sales');
  const erpItemsConnected = erpItems.connected;
  const loadErpItemOptions = erpItems.loadOptions;
  const saveRateItem = useSaveTmRateLine();
  const assignPerson = useSetTmRateAssignee();
  const endAssignee = useEndTmRateAssignee();
  const endRate = useEndTmRateLine();
  const assemble = useAssembleTmClaim();
  const prepare = usePrepareTmSignoff();
  const confirm = useConfirmTmSignoff();
  const withdraw = useWithdrawTmSignoff();

  const [periodFrom, setPeriodFrom] = useState(firstOfMonth);
  const [periodTo, setPeriodTo] = useState(today);
  const [rateFormFor, setRateFormFor] = useState<ContractRateLineRow | null | undefined>(undefined);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<TmClaimSummary | null>(null);
  const [prepareFor, setPrepareFor] = useState<TmClaimSummary | null>(null);
  const [confirmFor, setConfirmFor] = useState<TmClaimSummary | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<TmClaimSummary | null>(null);
  const [removeFor, setRemoveFor] = useState<{ id: string; person: string; line: string } | null>(null);
  const [endRateFor, setEndRateFor] = useState<ContractRateLineRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proposalItems, setProposalItems] = useState<ComboboxOption[]>([]);
  const [proposalCatalogState, setProposalCatalogState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [proposalRetry, setProposalRetry] = useState(0);

  const rateRows = rateLines.data?.rows ?? EMPTY_RATE_LINES;
  const unmappedRateRows = useMemo(() => rateRows.filter((line) => !line.sales_item_code), [rateRows]);
  const assignmentRows = assignments.data?.rows;
  const claimRows = claims.data?.rows ?? [];
  const activeProfiles = (people.data ?? []).filter((profile) => profile.status === 'active');
  const profilesById = useMemo(() => new Map((people.data ?? []).map((profile) => [profile.id, profile])), [people.data]);
  const assignmentsByLine = useMemo(() => {
    const current = (assignmentRows ?? []).filter((row) => row.effective_to === null);
    const grouped = new Map<string, typeof current>();
    for (const assignment of current) {
      const rows = grouped.get(assignment.line_key) ?? [];
      rows.push(assignment);
      grouped.set(assignment.line_key, rows);
    }
    return grouped;
  }, [assignmentRows]);
  const eligibleDocuments = (documents.data ?? []).filter(canBeEvidence);
  const previewRangeValid = Boolean(periodFrom && periodTo && periodTo >= periodFrom);
  const preview = useTmClaimPreview({ projectId, from: periodFrom, to: periodTo });
  const claimSources = useTmClaimSources(selectedClaim?.id ?? '');
  const sourceRows = claimSources.data?.rows ?? [];

  const canManageRates = may('manage', 'tmRate', { record: { viewOnly } });
  const canPrepareClaims = may('prepare', 'tmClaim', {
    currentUserId: userId,
    record: { project_manager_id: projectManagerId, viewOnly },
  });
  const soleActiveMember = activeProfiles.length === 1 && activeProfiles[0]?.id === userId;
  const mayConfirm = (claim: TmClaimSummary) => may('confirm', 'tmSignoff', {
    currentUserId: userId,
    record: {
      prepared_by: claim.prepared_by,
      signoff_prepared_by: claim.signoff_prepared_by,
      sole_active_member: soleActiveMember,
      viewOnly,
    },
  });
  useEffect(() => {
    let active = true;
    if (!canManageRates || !erpItemsConnected || unmappedRateRows.length === 0) {
      setProposalItems([]);
      setProposalCatalogState('idle');
      return () => { active = false; };
    }
    setProposalCatalogState('loading');
    void loadErpItemOptions().then((items) => {
      if (!active) return;
      setProposalItems(items);
      setProposalCatalogState('ready');
    }).catch(() => {
      if (!active) return;
      setProposalItems([]);
      setProposalCatalogState('error');
    });
    return () => { active = false; };
  }, [canManageRates, erpItemsConnected, loadErpItemOptions, proposalRetry, unmappedRateRows.length]);
  const proposedRateRows = useMemo(() => unmappedRateRows.flatMap((line) => {
    const option = proposeSalesItem(line.label, proposalItems);
    return option ? [{ line, option }] : [];
  }), [unmappedRateRows, proposalItems]);
  const currentAssigneesFor = (lineKey: string) => (assignmentsByLine.get(lineKey) ?? []).map((assignment) => ({
    id: assignment.id,
    name: profilesById.get(assignment.user_id)?.full_name ?? t('preview.personUnavailable', 'Person no longer active'),
  }));

  const reportActionError = (error: unknown) => {
    const classified = classifyMutationError(error, undefined, { suppressCapture: true });
    setActionError([classified.headline, classified.detail].filter(Boolean).join(' '));
    toast(classified.headline, classified.detail, 'warning');
  };

  const rateItemInput = (line: ContractRateLineRow, salesItemCode: string | null): ContractRateLineInput => ({
    project_id: line.project_id,
    line_key: line.line_key,
    expected_version: line.version,
    kind: 'labour',
    label: line.label,
    unit: line.unit === 'day' ? 'day' : 'hour',
    rate: Number(line.rate),
    currency,
    effective_from: line.effective_from,
    effective_to: line.effective_to,
    sales_item_code: salesItemCode,
    expected_sales_item_code: line.sales_item_code,
  });

  const saveSalesItemMappings = async (inputs: ContractRateLineInput[]) => {
    if (!canManageRates || inputs.length === 0) return;
    setActionError(null);
    try {
      await saveRateItem.mutateAsync(inputs);
      toast(t('rateCard.salesItemsSaved', 'Sales item mapping saved'), undefined, 'success');
    } catch (error) {
      reportActionError(error);
    }
  };

  const acceptProposedSalesItems = () => {
    void saveSalesItemMappings(proposedRateRows.map(({ line, option }) => rateItemInput(line, option.value)));
  };

  const openClaimDetail = (claim: TmClaimSummary) => {
    clearToasts();
    setSelectedClaim(claim);
  };

  const runRemove = async () => {
    if (!removeFor) return;
    setActionError(null);
    try {
      await endAssignee.mutateAsync({ projectId, assigneeId: removeFor.id, effectiveTo: today() });
      setRemoveFor(null);
      toast(t('rateCard.removed', 'Assignment removed'), undefined, 'success');
    } catch (error) {
      setRemoveFor(null);
      reportActionError(error);
    }
  };

  const runEndRate = async () => {
    if (!endRateFor) return;
    setActionError(null);
    try {
      await endRate.mutateAsync({ projectId, lineKey: endRateFor.line_key, effectiveTo: today(), expectedVersion: endRateFor.version });
      setEndRateFor(null);
      toast(t('rateCard.ended', 'Rate ended'), undefined, 'success');
    } catch (error) {
      setEndRateFor(null);
      reportActionError(error);
    }
  };

  const handleAssemble = async () => {
    setActionError(null);
    try {
      await assemble.mutateAsync({ projectId, from: periodFrom, to: periodTo });
      toast(t('assembly.toastCreated', 'Claim assembled'), undefined, 'success');
    } catch (error) {
      reportActionError(error);
    }
  };

  const runPrepare = async (claim: TmClaimSummary, documentId: string, note: string) => {
    setActionError(null);
    try {
      await prepare.mutateAsync({ claimId: claim.id, documentId, note: note.trim() || null });
      setPrepareFor(null);
      toast(t('signoff.prepared', 'Client sign-off prepared'), undefined, 'success');
    } catch (error) {
      reportActionError(error);
      throw error;
    }
  };

  const runConfirm = async () => {
    if (!confirmFor) return;
    setActionError(null);
    try {
      await confirm.mutateAsync(confirmFor.id);
      setConfirmFor(null);
      toast(t('signoff.confirmed', 'Client sign-off confirmed'), undefined, 'success');
    } catch (error) {
      reportActionError(error);
    }
  };

  const runWithdraw = async () => {
    if (!withdrawFor) return;
    setActionError(null);
    try {
      await withdraw.mutateAsync(withdrawFor.id);
      setWithdrawFor(null);
      setSelectedClaim(null);
      toast(t('signoff.withdrawn', 'Client sign-off withdrawn'), undefined, 'success');
    } catch (error) {
      reportActionError(error);
    }
  };

  const unitCount = (units: number | string, unit: string | null) => t(unit === 'day' ? 'unitCount.day' : 'unitCount.hour', {
    count: Number(units), amount: formatNumberExact(Number(units)),
  });
  const statusPill = (claim: TmClaimSummary) => {
    if (claim.status === 'SignedOff') return <StatusPill variant="won">{t('claims.statusSignedOff', 'Signed off')}</StatusPill>;
    if (claim.status === 'Withdrawn') return <StatusPill variant="lost">{t('claims.statusWithdrawn', 'Withdrawn')}</StatusPill>;
    if (claim.signoff_prepared_by) return <StatusPill variant="warn">{t('claims.statusAwaiting', 'Awaiting confirmation')}</StatusPill>;
    return <StatusPill variant="neutral">{t('claims.statusDraft', 'Draft')}</StatusPill>;
  };

  const reasonFor = (row: TmClaimPreviewRow) => {
    if (row.unrated_reason === 'no_assignee') return t('preview.noAssignee', 'No person is assigned to a rate line');
    if (row.unrated_reason === 'no_rate') return t('preview.noRate', 'No rate applies to this period');
    if (row.unrated_reason === 'unit_not_supported') return t('preview.unitUnsupported', 'The rate unit cannot be used for these hours');
    return t('preview.notRated', 'This time cannot be priced yet');
  };
  const personFor = (userId: string | null) => userId
    ? profilesById.get(userId)?.full_name ?? t('preview.personUnavailable', 'Person no longer active')
    : t('preview.personUnknown', 'Person not identified');
  const compactError = 'rounded-none border-0 bg-transparent p-0';

  const rateList = rateLines.isPending ? <ListState variant="loading" rows={2} />
    : rateLines.isError ? <ListState variant="error" title={t('rateCard.loadError', "Couldn't load the rate card")} onRetry={() => void rateLines.refetch()} className={compactError} />
      : rateRows.length === 0 ? <ListState variant="empty" title={t('rateCard.emptyTitle', 'No labour rates yet')} sub={t('rateCard.empty', 'Add a rate before assembling a claim.')} className="items-start justify-start gap-2 px-0 py-3 text-left" />
        : <ul className="divide-y divide-border" aria-label={t('rateCard.title', 'Rate card')}>
          {rateRows.map((line) => {
            const assignedPeople = currentAssigneesFor(line.line_key);
            const ended = line.effective_to !== null && line.effective_to <= today();
            const selectedSalesItem = line.sales_item_code
              ? proposalItems.find((item) => item.value === line.sales_item_code) ?? { value: line.sales_item_code, label: line.sales_item_code }
              : null;
            return <li key={line.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{line.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground tabular">
                  {formatCurrency(Number(line.rate), currency)} <span aria-hidden>/</span> {line.unit === 'day' ? t('unit.day', 'day') : t('unit.hour', 'hour')}
                  {ended && <><span className="px-2" aria-hidden>·</span>{t('rateCard.endedOn', 'Ended {{date}}', { date: formatDateOnly(line.effective_to) })}</>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted-foreground">
                  {assignedPeople.length === 0 ? <span>{t('rateCard.unassigned', 'Not assigned yet')}</span> : <span>{t('rateCard.assignedLabel', 'Assigned to')}</span>}
                  {assignedPeople.map((assignee, index) => <span key={assignee.id} className="inline-flex items-center gap-1">
                    <span className="text-foreground">{assignee.name}</span>
                    {canManageRates && !ended && <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10"
                      aria-label={t('rateCard.removeFrom', 'Remove {{person}} from {{line}}', { person: assignee.name, line: line.label })}
                      onClick={() => setRemoveFor({ id: assignee.id, person: assignee.name, line: line.label })}>{t('rateCard.remove', 'Remove')}</Button>}
                    {index < assignedPeople.length - 1 && <span aria-hidden>,</span>}
                  </span>)}
                </p>
                {erpItemsConnected && <div className="mt-2 max-w-md">
                  {!line.sales_item_code && <p role="status" className="mb-1 text-sm text-muted-foreground">
                    {t('rateCard.notMapped', 'Not mapped')}
                  </p>}
                  {canManageRates
                    ? <Combobox
                      label={t('rateCard.salesItemFor', 'Sales item for {{label}}', { label: line.label })}
                      value={line.sales_item_code}
                      selectedOption={selectedSalesItem}
                      onChange={(value) => void saveSalesItemMappings([rateItemInput(line, value)])}
                      loadOptions={erpItems.loadOptions}
                      placeholder={t('rateCard.chooseSalesItem', 'Choose a sales item')}
                      searchPlaceholder={t('rateCard.searchSalesItems', 'Search sales items')}
                      noun={t('rateCard.salesItemNoun', 'sales item')}
                      clearable
                      onClear={() => void saveSalesItemMappings([rateItemInput(line, null)])}
                      disabled={saveRateItem.isPending}
                      formControl
                    />
                    : line.sales_item_code && <p className="text-sm text-muted-foreground">
                      <span>{t('rateCard.salesItem', 'ERP sales item')}: </span><span className="font-medium text-foreground">{line.sales_item_code}</span>
                    </p>}
                </div>}
              </div>
              {canManageRates && !ended && <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setRateFormFor(line)}>{t('rateCard.edit', 'Edit rate')}</Button>
                <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10" onClick={() => setEndRateFor(line)}>{t('rateCard.end', 'End rate')}</Button>
              </div>}
            </li>;
          })}
        </ul>;

  const previewRows = preview.data?.rows ?? [];
  const pricedRows = previewRows.filter((row) => row.amount !== null);
  const unratedRows = previewRows.filter((row) => row.amount === null);
  const previewTotal = Math.round(pricedRows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;

  const claimOpenLabel = (claim: TmClaimSummary) => t('claims.open', 'Open claim for {{date}}', {
    date: formatDateOnly(claim.period_from),
  });

  const rowActions = (claim: TmClaimSummary) => {
    if (claim.status === 'SignedOff' || claim.status === 'Withdrawn') return null;
    const prepared = Boolean(claim.signoff_prepared_by);
    return <div className="flex flex-wrap items-center gap-2">
      {!prepared && canPrepareClaims && <Button variant="outline" size="sm" onClick={() => setPrepareFor(claim)}>{t('signoff.prepare', 'Prepare sign-off')}</Button>}
      {prepared && mayConfirm(claim) && <Button variant="primary" size="sm" onClick={() => setConfirmFor(claim)}>{t('signoff.confirm', 'Confirm sign-off')}</Button>}
      {prepared && canPrepareClaims && <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10" onClick={() => setWithdrawFor(claim)}>{t('signoff.withdraw', 'Withdraw sign-off')}</Button>}
    </div>;
  };

  const nothingToShow = !canManageRates && !rateLines.isPending && !rateLines.isError && !claims.isPending && !claims.isError && rateRows.length === 0 && claimRows.length === 0;
  if (nothingToShow) return null;

  return (
    <>
      <Card variant={embedded ? 'bare' : 'framed'} className={embedded ? 'border-t border-border pt-4' : undefined}>
        <CardHead level={2} className="text-base" actions={canManageRates ? <Button variant="primary" size="sm" onClick={() => setRateFormFor(null)}>{t('rateCard.add', 'Add rate')}</Button> : undefined}>
          {t('title', 'Time and materials')}
        </CardHead>
        <CardPad className="pt-0">
          <section aria-labelledby="tm-rate-card-heading">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="tm-rate-card-heading" className="text-group font-semibold text-foreground">{t('rateCard.title', 'Rate card')}</h3>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('rateCard.description', 'Set the customer rate for each labour role and assign the people whose approved hours it covers.')}</p>
              </div>
              {canManageRates && <Button variant="outline" size="sm" disabled={rateRows.length === 0 || rateLines.data?.truncated === true || assignments.isPending || assignments.isError || people.isPending || people.isError} onClick={() => setAssignOpen(true)}>{t('rateCard.assign', 'Assign person')}</Button>}
            </div>
            {rateList}
            {canManageRates && erpItemsConnected && unmappedRateRows.length > 0
              && (proposalCatalogState === 'loading' || proposalCatalogState === 'error' || (proposalCatalogState === 'ready' && proposedRateRows.length > 0))
              && <div className="mt-3 rounded-md border border-border bg-secondary/40 p-3">
              {proposalCatalogState === 'loading' && <p role="status" className="text-sm text-muted-foreground">{t('rateCard.proposalsLoading', 'Checking ERP sales items for possible matches…')}</p>}
              {proposalCatalogState === 'error' && <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="text-sm text-destructive-text">{t('rateCard.proposalsError', "Couldn't load ERP sales items. Retry to check for matches.")}</p>
                <Button variant="outline" size="sm" onClick={() => setProposalRetry((value) => value + 1)}>{t('rateCard.retrySalesItems', 'Retry')}</Button>
              </div>}
              {proposalCatalogState === 'ready' && proposedRateRows.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{t('rateCard.proposalsReady', 'Some unmapped rate lines have a clear sales item match.')}</p>
                <Button variant="primary" size="sm" disabled={saveRateItem.isPending} loading={saveRateItem.isPending} onClick={acceptProposedSalesItems}>
                  {t('rateCard.acceptProposed', 'Accept proposed ({{count}})', { count: proposedRateRows.length })}
                </Button>
              </div>}
            </div>}
            {rateLines.data?.truncated && <p role="status" className="mt-2 text-sm text-muted-foreground">{t('rateCard.truncated', 'More than {{limit}} rate lines exist; this list is incomplete.', { limit: LIST_LIMIT })}</p>}
            {assignments.data?.truncated && <p role="status" className="mt-2 text-sm text-muted-foreground">{t('rateCard.assignmentsTruncated', 'Some rate assignments may not be shown.', { limit: LIST_LIMIT })}</p>}
            {assignments.isError && !rateLines.isError && <ListState variant="error" title={t('rateCard.assignmentError', "Couldn't load rate assignments")} onRetry={() => void assignments.refetch()} className={compactError} />}
            {people.isError && <p role="alert" className="mt-2 text-sm text-destructive-text">{t('rateCard.peopleError', "Couldn't load people. Retry before assigning a rate.")}</p>}
          </section>

          <section aria-labelledby="tm-assemble-heading" className="mt-6 border-t border-border pt-5">
            <h3 id="tm-assemble-heading" className="text-group font-semibold text-foreground">{t('assembly.title', 'Assemble a claim')}</h3>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('assembly.description', 'Preview approved hours for a period. Hours without an applicable rate stay outside the claim.')}</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <TextField type="date" label={t('assembly.from', 'From')} value={periodFrom} onChange={setPeriodFrom} />
              <TextField type="date" label={t('assembly.to', 'To')} value={periodTo} onChange={setPeriodTo} />
              {canPrepareClaims && <Button variant="primary" className="touch-target min-h-11" disabled={!previewRangeValid || preview.isPending || pricedRows.length === 0 || preview.data?.truncated === true || assemble.isPending} loading={assemble.isPending} onClick={() => void handleAssemble()}>{t('assembly.assemble', 'Assemble claim')}</Button>}
            </div>
            {!previewRangeValid && <p className="mt-2 text-sm text-destructive-text" role="alert">{t('assembly.invalidRange', 'Choose an end date on or after the start date.')}</p>}
            <div className="mt-4">
              {preview.isPending && <ListState variant="loading" rows={2} />}
              {preview.isError && <ListState variant="error" title={t('preview.error', "Couldn't preview approved hours")} onRetry={() => void preview.refetch()} className={compactError} />}
              {preview.data?.truncated && <p role="status" className="mb-3 text-sm text-muted-foreground">{t('preview.truncated', 'More than {{limit}} groups of hours match. Narrow the period to assemble a claim.', { limit: LIST_LIMIT })}</p>}
              {!preview.isPending && !preview.isError && previewRangeValid && previewRows.length === 0 && (
                <ListState variant="empty" title={t('preview.empty', 'No approved hours in this period.')} className="items-start justify-start gap-2 px-0 py-3 text-left" />
              )}
              {pricedRows.length > 0 && <div className="overflow-x-auto">
                <h4 className="mb-2 text-sm font-semibold">{t('preview.priced', 'Ready to claim')}</h4>
                <ul className="divide-y divide-border">
                  {pricedRows.map((row, index) => <li key={`${row.line_key ?? row.label}-${row.user_id}-${index}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 font-medium">{row.label ?? t('preview.labour', 'Labour')}</span>
                    <span className="tabular text-muted-foreground">{personFor(row.user_id)} · {unitCount(row.units, row.unit)} × {formatCurrency(Number(row.rate), currency)} = {formatCurrency(Number(row.amount), currency)}</span>
                  </li>)}
                </ul>
                <p className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm font-semibold"><span>{t('claims.total', 'Claim total')}</span><span className="tabular">{formatCurrency(previewTotal, currency)}</span></p>
              </div>}
              {unratedRows.length > 0 && <div className="mt-4" aria-labelledby="tm-unrated-heading">
                <h4 id="tm-unrated-heading" className="mb-2 text-sm font-semibold">{t('preview.unratedHeading', 'Unrated hours')}</h4>
                <ul className="divide-y divide-border">
                  {unratedRows.map((row, index) => <li key={`${row.unrated_reason}-${row.user_id}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{reasonFor(row)} · {personFor(row.user_id)}</span>
                    <span className="tabular text-muted-foreground">{unitCount(row.units, row.unit)} · {t('preview.sourceCount', '{{count}} approved entries', { count: row.source_count })}</span>
                  </li>)}
                </ul>
              </div>}
            </div>
          </section>

          <section aria-labelledby="tm-claims-heading" className="mt-6 border-t border-border pt-5">
            <h3 id="tm-claims-heading" className="text-group font-semibold text-foreground">{t('claims.title', 'Time-and-materials claims')}</h3>
            {actionError && <p role="alert" className="mt-3 text-sm text-destructive-text">{actionError}</p>}
            <div className="mt-3">
              {claims.isPending && <ListState variant="loading" rows={2} />}
              {claims.isError && <ListState variant="error" title={t('claims.error', "Couldn't load time-and-materials claims")} onRetry={() => void claims.refetch()} className={compactError} />}
              {!claims.isPending && !claims.isError && claimRows.length === 0 && <ListState variant="empty" title={t('claims.empty', 'No time-and-materials claims yet.')} className="items-start justify-start gap-2 px-0 py-3 text-left" />}
              {claimRows.length > 0 && <ul className="divide-y divide-border">
                {claimRows.map((claim) => <li key={claim.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" className="min-w-0 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={claimOpenLabel(claim)} onClick={() => openClaimDetail(claim)}>
                    <span className="block font-medium text-foreground">{formatDateOnly(claim.period_from)} – {formatDateOnly(claim.period_to)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {statusPill(claim)}
                      <span className="tabular">{formatCurrency(Number(claim.gross_amount), claim.currency)}</span>
                      <span>{t('claims.lineCount', '{{count}} lines', { count: claim.lines.length })}</span>
                    </span>
                    {claim.status === 'SignedOff' && invoiceNumberFor?.(claim.id) && <span className="mt-1 block text-sm text-muted-foreground">{t('claims.invoiced', 'Invoiced · {{number}}', { number: invoiceNumberFor(claim.id) })}</span>}
                    {claim.status === 'Draft' && claim.signoff_prepared_by && !mayConfirm(claim) && <span className="mt-1 block text-sm text-muted-foreground">{t('signoff.preparerHint', 'A different user must confirm this sign-off.')}</span>}
                  </button>
                  {claim.status === 'SignedOff' && canCreateInvoice?.(claim.id) && <Button variant="outline" size="sm" onClick={() => onCreateInvoice(claim.id)}>{t('claims.createInvoice', 'Create invoice')}</Button>}
                  {rowActions(claim)}
                </li>)}
              </ul>}
              {claims.data?.truncated && <p role="status" className="mt-2 text-sm text-muted-foreground">{t('claims.truncated', 'More than {{limit}} claims exist; this list shows only the latest.', { limit: LIST_LIMIT })}</p>}
            </div>
          </section>
        </CardPad>
      </Card>

      {rateFormFor !== undefined && <RateLineModal projectId={projectId} currency={currency} line={rateFormFor} onClose={() => setRateFormFor(undefined)} onSaved={() => {
        setRateFormFor(undefined);
        toast(t('rateCard.saved', 'Rate saved'), undefined, 'success');
      }} />}
      {assignOpen && <AssignPersonModal projectId={projectId} rates={rateRows} profiles={activeProfiles} profilesPending={people.isPending} onClose={() => setAssignOpen(false)} onAssign={async (lineKey, personId, from) => {
        setActionError(null);
        await assignPerson.mutateAsync({ projectId, lineKey, userId: personId, from, to: null });
        setAssignOpen(false);
        toast(t('rateCard.assigned', 'Person assigned to rate'), undefined, 'success');
      }} onError={reportActionError} />}
      {prepareFor && <PrepareSignoffModal claim={prepareFor} documents={eligibleDocuments} documentsPending={documents.isPending} documentsError={documents.isError} onRetry={() => void documents.refetch()} loading={prepare.isPending} onClose={() => setPrepareFor(null)} onPrepare={runPrepare} />}
      {selectedClaim && <ClaimDetail claim={selectedClaim} sources={sourceRows} sourcesTotal={claimSources.data?.totalCount ?? sourceRows.length} sourcesPending={claimSources.isPending} sourcesError={claimSources.isError} sourcesTruncated={claimSources.data?.truncated === true} statusPill={statusPill(selectedClaim)} unitCount={unitCount} awaitingHint={selectedClaim.status === 'Draft' && Boolean(selectedClaim.signoff_prepared_by) && !mayConfirm(selectedClaim)} onRetry={() => void claimSources.refetch()} onClose={() => setSelectedClaim(null)}
        prepareAction={canPrepareClaims && selectedClaim.status === 'Draft' && !selectedClaim.signoff_prepared_by ? () => setPrepareFor(selectedClaim) : undefined}
        confirmAction={selectedClaim.status === 'Draft' && selectedClaim.signoff_prepared_by && mayConfirm(selectedClaim) ? () => setConfirmFor(selectedClaim) : undefined}
        withdrawAction={selectedClaim.status === 'Draft' && selectedClaim.signoff_prepared_by && canPrepareClaims ? () => setWithdrawFor(selectedClaim) : undefined}
        invoiceAction={selectedClaim.status === 'SignedOff' && canCreateInvoice?.(selectedClaim.id) ? () => onCreateInvoice(selectedClaim.id) : undefined} />}
      {confirmFor && <ConfirmDialog open title={t('signoff.confirmTitle', 'Confirm client sign-off?')}
        description={t('signoff.confirmDescription', 'Confirming marks this claim as signed off by the client and lets Finance raise its invoice.')}
        confirmLabel={t('signoff.confirm', 'Confirm sign-off')} loading={confirm.isPending} onConfirm={() => void runConfirm()} onCancel={() => setConfirmFor(null)} />}
      {removeFor && <ConfirmDialog open tone="destructive" title={t('rateCard.removeTitle', 'Remove this assignment?')}
        description={t('rateCard.removeDescription', "{{person}}'s hours after today will no longer be priced with {{line}}. Claims already assembled keep their rate.", { person: removeFor.person, line: removeFor.line })}
        confirmLabel={t('rateCard.remove', 'Remove')} loading={endAssignee.isPending} onConfirm={() => void runRemove()} onCancel={() => setRemoveFor(null)} />}
      {endRateFor && <ConfirmDialog open tone="destructive" title={t('rateCard.endTitle', 'End this rate?')}
        description={t('rateCard.endDescription', 'No new hours after today will be priced with {{line}}. Claims already assembled keep their rate.', { line: endRateFor.label })}
        confirmLabel={t('rateCard.end', 'End rate')} loading={endRate.isPending} onConfirm={() => void runEndRate()} onCancel={() => setEndRateFor(null)} />}
      {withdrawFor && <ConfirmDialog open tone="destructive" title={t('signoff.withdrawTitle', 'Withdraw client sign-off?')}
        description={t('signoff.withdrawDescription', 'This claim can no longer be invoiced. Its approved hours go back to unclaimed and can be assembled into a later claim.')}
        confirmLabel={t('signoff.withdraw', 'Withdraw sign-off')} loading={withdraw.isPending} onConfirm={() => void runWithdraw()} onCancel={() => setWithdrawFor(null)} />}
    </>
  );
};

interface RateLineModalProps {
  projectId: string;
  currency: string;
  line: ContractRateLineRow | null;
  onClose: () => void;
  onSaved: () => void;
}

const RateLineModal: React.FC<RateLineModalProps> = ({ projectId, currency, line, onClose, onSaved }) => {
  const { t } = useTranslation('timeAndMaterials');
  const save = useSaveTmRateLine();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm<RateValues>({
    initialValues: {
      label: line?.label ?? '',
      unit: line?.unit === 'day' ? 'day' : 'hour',
      rate: line ? String(line.rate) : '',
      effectiveFrom: line?.effective_from ?? today(),
    },
    requiredFields: ['label', 'rate', 'effectiveFrom'],
    module: 'time_and_materials',
    validate: (values) => {
      const errors: Partial<Record<keyof RateValues, string>> = {};
      if (!values.label.trim()) errors.label = t('rateCard.validation.label', 'Enter a role or work description.');
      const amount = Number(values.rate.trim().replace(',', '.'));
      if (!values.rate.trim() || !Number.isFinite(amount) || amount <= 0) errors.rate = t('rateCard.validation.rate', 'Enter a rate greater than zero.');
      if (!values.effectiveFrom) errors.effectiveFrom = t('rateCard.validation.date', 'Choose when this rate starts.');
      return errors;
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (values) => {
      const input: ContractRateLineInput = {
        project_id: projectId,
        ...(line ? { line_key: line.line_key, expected_version: line.version } : {}),
        kind: 'labour',
        label: values.label.trim(),
        unit: values.unit,
        rate: Number(values.rate.trim().replace(',', '.')),
        currency,
        effective_from: values.effectiveFrom,
      };
      try {
        await save.mutateAsync(input);
        onSaved();
      } catch (error) {
        const classified = classifyMutationError(error, undefined, { suppressCapture: true });
        setSubmitError({ headline: classified.headline, detail: classified.detail });
      }
    });
  };

  const fieldErrors = form.hasAttemptedSubmit ? Object.entries(form.errors).map(([field, message]) => ({
    fieldId: form.fieldProps(field as keyof RateValues).id,
    message: String(message),
  })) : undefined;

  return <EntityFormModal open title={line ? t('rateCard.editTitle', 'Edit labour rate') : t('rateCard.addTitle', 'Add labour rate')}
    subtitle={t('rateCard.modalDescription', 'The currency comes from this project. Saving a changed rate creates a new version for future claims.')}
    submitLabel={t('rateCard.save', 'Save rate')} onSubmit={onSubmit} onClose={onClose} loading={form.isSubmitting || save.isPending}
    dirty={form.isDirty} submitDisabled={!form.isComplete || save.isPending} errorSummary={fieldErrors} submitError={submitError}>
    <FormGrid>
      <TextField label={t('rateCard.label', 'Role or work description')} required {...form.fieldProps('label')} />
      <SelectField label={t('rateCard.unit', 'Rate unit')} value={form.values.unit} onChange={(value) => form.setValue('unit', value as RateValues['unit'])}
        options={[{ value: 'hour', label: t('unit.hour', 'hour') }, { value: 'day', label: t('unit.day', 'day') }]} />
      <TextField label={t('rateCard.rate', 'Rate per {{unit}}', { unit: form.values.unit === 'hour' ? t('unit.hour', 'hour') : t('unit.day', 'day') })}
        inputMode="decimal" value={form.values.rate} onChange={(value) => form.setValue('rate', value)} onBlur={() => form.handleBlur('rate')} error={form.errors.rate} required />
      <TextField type="date" label={t('rateCard.effectiveFrom', 'Effective from')} required {...form.fieldProps('effectiveFrom')} />
    </FormGrid>
  </EntityFormModal>;
};

interface AssignPersonModalProps {
  projectId: string;
  rates: ContractRateLineRow[];
  profiles: ProfileRow[];
  profilesPending: boolean;
  onClose: () => void;
  onAssign: (lineKey: string, personId: string, from: string) => Promise<void>;
  onError: (error: unknown) => void;
}

const AssignPersonModal: React.FC<AssignPersonModalProps> = ({ rates, profiles, profilesPending, onClose, onAssign, onError }) => {
  const { t } = useTranslation('timeAndMaterials');
  const [lineKey, setLineKey] = useState('');
  const [personId, setPersonId] = useState('');
  const [from, setFrom] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lineOptions = rates.map((line) => ({ value: line.line_key, label: `${line.label} · ${line.unit === 'day' ? t('unit.day', 'day') : t('unit.hour', 'hour')}` }));
  const personOptions = profiles.map((profile) => ({ value: profile.id, label: profile.full_name }));
  const selectedPerson = profiles.find((profile) => profile.id === personId);
  const personOption = selectedPerson ? { value: selectedPerson.id, label: selectedPerson.full_name } : null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!lineKey || !personId || !from) {
      setError(t('rateCard.validation.assignment', 'Choose a rate, a person, and a start date.'));
      return;
    }
    setLoading(true);
    setError(null);
    void onAssign(lineKey, personId, from).catch((err: unknown) => {
      const classified = classifyMutationError(err, undefined, { suppressCapture: true });
      setError([classified.headline, classified.detail].filter(Boolean).join(' '));
      onError(err);
    }).finally(() => setLoading(false));
  };

  return <EntityFormModal open title={t('rateCard.assignTitle', 'Assign a person to a rate')} subtitle={t('rateCard.assignDescription', 'Only active people in this organisation can be assigned.')}
    submitLabel={t('rateCard.assign', 'Assign person')} onSubmit={handleSubmit} onClose={onClose} loading={loading} dirty={Boolean(lineKey || personId)} submitDisabled={profilesPending || !lineKey || !personId || !from}>
    <FormGrid>
      <SelectField label={t('rateCard.line', 'Rate line')} value={lineKey} onChange={setLineKey} options={lineOptions} placeholder={t('rateCard.chooseLine', 'Choose a rate line')} required />
      <Combobox label={t('rateCard.person', 'Person')} value={personId || null} selectedOption={personOption} onChange={(value) => setPersonId(value)}
        loadOptions={async () => personOptions} noun={t('rateCard.personNoun', 'person')} placeholder={t('rateCard.choosePerson', 'Choose an active person')} disabled={profilesPending} formControl />
      <TextField type="date" label={t('rateCard.effectiveFrom', 'Effective from')} value={from} onChange={setFrom} required />
      <FieldError>{error}</FieldError>
    </FormGrid>
  </EntityFormModal>;
};

interface PrepareSignoffModalProps {
  claim: TmClaimSummary;
  documents: ProjectDocumentRow[];
  documentsPending: boolean;
  documentsError: boolean;
  loading: boolean;
  onRetry: () => void;
  onClose: () => void;
  onPrepare: (claim: TmClaimSummary, documentId: string, note: string) => Promise<void>;
}

const PrepareSignoffModal: React.FC<PrepareSignoffModalProps> = ({ claim, documents, documentsPending, documentsError, loading, onRetry, onClose, onPrepare }) => {
  const { t } = useTranslation('timeAndMaterials');
  const [documentId, setDocumentId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<SubmitError | null>(null);
  const options = documents.map((document) => ({
    value: document.id,
    label: `${document.code ? `${document.code} · ` : ''}${document.title} (${document.status}${document.revision ? `, ${t('signoff.revision', 'rev {{revision}}', { revision: document.revision })}` : ''})`,
  }));
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!documentId) return;
    setError(null);
    void onPrepare(claim, documentId, note).catch((err: unknown) => {
      const classified = classifyMutationError(err, undefined, { suppressCapture: true });
      setError({ headline: classified.headline, detail: classified.detail });
    });
  };
  const sourceError = documentsError ? t('signoff.documentsError', "Couldn't load evidence documents") : null;

  return <EntityFormModal open title={t('signoff.prepareTitle', 'Prepare client sign-off')}
    subtitle={t('signoff.prepareDescription', 'Choose an issued or approved project document with a file. A different user must confirm this sign-off.')}
    submitLabel={t('signoff.prepare', 'Prepare sign-off')} onSubmit={handleSubmit} onClose={onClose} loading={loading}
    dirty={Boolean(documentId || note)} submitDisabled={!documentId || loading || documentsPending || Boolean(sourceError)} submitError={error}>
    {sourceError ? <ListState variant="error" title={sourceError} onRetry={onRetry} />
      : documentsPending ? <ListState variant="loading" rows={2} />
        : documents.length === 0 ? <p className="text-sm text-muted-foreground">{t('signoff.noDocuments', 'No issued or approved document with a file is available on this project.')}</p>
          : <FormGrid>
            <SelectField label={t('signoff.document', 'Evidence document')} value={documentId} onChange={setDocumentId} options={options}
              placeholder={t('signoff.chooseDocument', 'Choose a document')} required />
            <TextArea label={t('signoff.note', 'Note for the client')} value={note} onChange={setNote} rows={3} fullWidth />
          </FormGrid>}
  </EntityFormModal>;
};

interface ClaimDetailProps {
  claim: TmClaimSummary;
  sources: Array<{ id: string; claim_id: string; claim_line_id: string; source_kind: string; source_id: string; units: number }>;
  sourcesTotal: number;
  sourcesPending: boolean;
  sourcesError: boolean;
  sourcesTruncated: boolean;
  statusPill: React.ReactNode;
  awaitingHint: boolean;
  unitCount: (units: number | string, unit: string | null) => string;
  onRetry: () => void;
  onClose: () => void;
  prepareAction?: () => void;
  confirmAction?: () => void;
  withdrawAction?: () => void;
  invoiceAction?: () => void;
}

const ClaimDetail: React.FC<ClaimDetailProps> = ({ claim, sources, sourcesTotal, sourcesPending, sourcesError, sourcesTruncated, statusPill, awaitingHint, unitCount, onRetry, onClose, prepareAction, confirmAction, withdrawAction, invoiceAction }) => {
  const { t } = useTranslation('timeAndMaterials');
  return <Drawer open title={t('claims.detailTitle', 'Time-and-materials claim')} subtitle={`${formatDateOnly(claim.period_from)} – ${formatDateOnly(claim.period_to)}`}
    status={statusPill}
    onClose={onClose} headerActions={<div className="flex flex-wrap items-center gap-2">
      {prepareAction && <Button variant="outline" size="sm" onClick={prepareAction}>{t('signoff.prepare', 'Prepare sign-off')}</Button>}
      {confirmAction && <Button variant="primary" size="sm" onClick={confirmAction}>{t('signoff.confirm', 'Confirm sign-off')}</Button>}
      {withdrawAction && <Button variant="ghost" size="sm" onClick={withdrawAction}>{t('signoff.withdraw', 'Withdraw sign-off')}</Button>}
      {invoiceAction && <Button variant="primary" size="sm" onClick={invoiceAction}>{t('claims.createInvoice', 'Create invoice')}</Button>}
    </div>}>
    <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
      <div><dt className="text-muted-foreground">{t('claims.period', 'Period')}</dt><dd className="mt-1 font-medium">{formatDateOnly(claim.period_from)} – {formatDateOnly(claim.period_to)}</dd></div>
      <div><dt className="text-muted-foreground">{t('claims.total', 'Claim total')}</dt><dd className="mt-1 font-semibold tabular">{formatCurrency(Number(claim.gross_amount), claim.currency)}</dd></div>
    </dl>
    {awaitingHint && <p className="px-4 pb-3 text-sm text-muted-foreground">{t('signoff.preparerHint', 'A different user must confirm this sign-off.')}</p>}
    <section className="border-t border-border px-4 py-3" aria-labelledby="tm-claim-lines-heading">
      <h2 id="tm-claim-lines-heading" className="text-sm font-semibold">{t('detail.lines', 'Claim lines')}</h2>
      {claim.lines.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('detail.noLines', 'This claim has no billable lines.')}</p> : <ul className="mt-2 divide-y divide-border">
        {claim.lines.map((line, index) => <li key={`${line.lineKey}-${index}`} className="py-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="font-medium">{line.label}</span>
            <span className="tabular font-medium">{formatCurrency(Number(line.amount), claim.currency)}</span>
          </div>
          <p className="mt-1 text-muted-foreground tabular">{unitCount(line.units, line.unit)} × {formatCurrency(Number(line.rate), claim.currency)}</p>
        </li>)}
      </ul>}
    </section>
    <section className="border-t border-border px-4 py-3" aria-labelledby="tm-claim-sources-heading">
      <h2 id="tm-claim-sources-heading" className="text-sm font-semibold">{t('detail.sources', 'Approved source entries')}</h2>
      {sourcesTruncated && <p role="status" className="mt-2 text-sm text-muted-foreground">{t('detail.sourcesTruncated', 'Showing {{shown}} of {{total}} source entries.', { shown: sources.length, total: sourcesTotal })}</p>}
      {sourcesPending ? <ListState variant="loading" rows={2} />
        : sourcesError ? <ListState variant="error" title={t('detail.sourcesError', "Couldn't load source entries")} onRetry={onRetry} />
          : sources.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('detail.noSources', 'No source entries are available for this claim.')}</p>
            : <ul className="mt-2 divide-y divide-border text-sm">
              {sources.map((source) => <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{source.source_kind === 'timesheet_entry' ? t('detail.timeEntry', 'Approved time entry') : t('detail.equipmentEntry', 'Approved usage entry')}</span>
                <span className="tabular text-muted-foreground">{unitCount(source.units, 'hour')}</span>
              </li>)}
            </ul>}
    </section>
  </Drawer>;
};

export default TimeAndMaterials;
