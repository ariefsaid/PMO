import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, Combobox, DataTable, Icon, EntityFormModal, FormGrid, ListPage, ListState, TextField, useEntityForm, useToast,
  type Column, type SubmitError,
} from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { useImprestFloats, useImprestPosition, useEstablishFloat } from '@/src/hooks/useImprest';
import { useProjects } from '@/src/hooks/useProjects';
import { useUsers } from '@/src/hooks/useUsers';
import { LIST_LIMIT, type ImprestFloatRow } from '@/src/lib/db/imprest';
import { toCents } from '@/src/lib/imprest/imprestRules';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyAuto, parseMoneyInputAtScale } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';

type FloatListRow = ImprestFloatRow & { project: { name: string } | null; custodian: { full_name: string } | null };
type Figure = 'cash_book' | 'advances_out' | 'receipts_waiting' | 'gap';

/** One figure of one float's position. A failed or pending read shows text, never a zero (money-path primer). */
const PositionFigure: React.FC<{ floatId: string; currency: string; figure: Figure }> = ({ floatId, currency, figure }) => {
  const { t } = useTranslation();
  const { data, isPending, isError } = useImprestPosition(floatId);
  if (isPending) return <span className="text-muted-foreground">…</span>;
  if (isError || !data) return <span className="text-muted-foreground">{t('imprest:list.positionUnavailable', 'Unavailable')}</span>;
  const value = data[figure];
  if (figure === 'gap' && toCents(value) !== 0) {
    return <span className="whitespace-nowrap font-medium text-destructive-text" role="status">
      {t('imprest:position.gapFlag', 'Books do not balance')} <span className="tabular-nums">({formatCurrencyAuto(Number(value), currency)})</span>
    </span>;
  }
  return <span className="tabular-nums">{formatCurrencyAuto(Number(value), currency)}</span>;
};

/** Establish a float: Admin/Finance. The RPC re-checks the custodian's eligibility; the picker only narrows the choice (UX). */
const EstablishFloatModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const establish = useEstablishFloat();
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm({
    initialValues: { projectId: '', custodianId: '', amount: '' },
    idPrefix: 'imprest-establish',
    requiredFields: ['projectId', 'custodianId', 'amount'],
    module: 'imprest',
    validate: (v) => {
      const errors: Partial<Record<'projectId' | 'custodianId' | 'amount', string>> = {};
      const amount = parseMoneyInputAtScale(v.amount, 2);
      if (amount === null || !(amount > 0)) errors.amount = t('imprest:establish.errors.amount', 'Enter an amount greater than zero.');
      return errors;
    },
  });
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);
  // Finance members, plus the chosen project's manager (the server's eligibility rule, DD-IMP-7).
  const managerId = (projects ?? []).find((p) => p.id === form.values.projectId)?.project_manager_id ?? null;
  const custodianOptions = useMemo(
    () => (users ?? []).filter((u) => u.role === 'Finance' || (managerId !== null && u.id === managerId)).map((u) => ({ value: u.id, label: u.full_name })),
    [users, managerId],
  );
  const projectField = form.fieldProps('projectId');
  const custodianField = form.fieldProps('custodianId');
  const amountField = form.fieldProps('amount');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        const floatId = await establish.mutateAsync({ projectId: v.projectId, custodianId: v.custodianId, amount: parseMoneyInputAtScale(v.amount, 2) ?? 0 });
        toast(t('imprest:establish.toast', 'Float established'), undefined, 'success');
        onClose();
        navigate(`/imprest/${floatId}`);
      } catch (err) {
        setSubmitError(classifyMutationError(err));
      }
    });
  };
  return (
    <EntityFormModal open title={t('imprest:establish.title', 'Establish site float')}
      subtitle={t('imprest:establish.subtitle', 'A float is cash held on site by one custodian for one project.')}
      submitLabel={t('imprest:establish.submit', 'Establish float')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete} submitError={submitError}>
      <FormGrid>
        <Combobox id={projectField.id} label={t('imprest:establish.project', 'Project')} required noun={t('imprest:establish.projectNoun', 'project')}
          value={projectField.value || null} selectedOption={projectOptions.find((o) => o.value === projectField.value) ?? null}
          loadOptions={() => Promise.resolve(projectOptions)}
          onChange={(value) => { form.setValues({ projectId: value, custodianId: '' }); }} error={projectField.error} />
        <Combobox id={custodianField.id} label={t('imprest:establish.custodian', 'Custodian')} required noun={t('imprest:establish.custodianNoun', 'custodian')}
          value={custodianField.value || null} selectedOption={custodianOptions.find((o) => o.value === custodianField.value) ?? null}
          disabled={!form.values.projectId} loadOptions={() => Promise.resolve(custodianOptions)}
          onChange={(value) => form.setValue('custodianId', value)} error={custodianField.error} />
        <TextField label={t('imprest:establish.amount', 'Float amount')} required inputMode="decimal" {...amountField} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** Site cash — one row per float with its derived position (FR-IMP-070). Reads are RLS-scoped; the list is bounded. */
const ImprestFloatsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useImprestFloats();
  const [establishOpen, setEstablishOpen] = useState(false);
  const rows = data?.rows ?? [];
  const columns: Column<FloatListRow>[] = [
    { key: 'project', header: t('imprest:list.columns.project', 'Project'), cell: (r) => <span className="font-medium">{r.project?.name ?? '—'}</span>,
      exportValue: (r) => r.project?.name ?? '' },
    { key: 'custodian', header: t('imprest:list.columns.custodian', 'Custodian'), cell: (r) => r.custodian?.full_name ?? '—',
      exportValue: (r) => r.custodian?.full_name ?? '' },
    { key: 'float', header: t('imprest:position.float', 'Float'), align: 'num',
      cell: (r) => <span className="tabular-nums">{formatCurrencyAuto(Number(r.float_amount), r.currency)}</span>, exportValue: (r) => Number(r.float_amount) },
    { key: 'cash', header: t('imprest:position.cash', 'Cash in hand'), align: 'num', cell: (r) => <PositionFigure floatId={r.id} currency={r.currency} figure="cash_book" /> },
    { key: 'advances', header: t('imprest:position.advancesOut', 'Advances out'), align: 'num', cell: (r) => <PositionFigure floatId={r.id} currency={r.currency} figure="advances_out" /> },
    { key: 'receipts', header: t('imprest:position.receiptsWaiting', 'Receipts waiting'), align: 'num', cell: (r) => <PositionFigure floatId={r.id} currency={r.currency} figure="receipts_waiting" /> },
    { key: 'gap', header: t('imprest:position.gap', 'Gap'), align: 'num', cell: (r) => <PositionFigure floatId={r.id} currency={r.currency} figure="gap" /> },
  ];
  return (
    <ListPage
      title={t('imprest:list.title', 'Site cash')}
      description={t('imprest:list.description', 'Cash held on site, by float: what is in hand, what is out as advances and what is waiting to be replenished.')}
      primaryAction={<CanWrite entity="imprestFloat" action="create">
        <Button variant="primary" onClick={() => setEstablishOpen(true)}>
          <Icon name="plus" />
          {t('imprest:establish.submit', 'Establish float')}
        </Button>
      </CanWrite>}
    >
      {isPending && <ListState variant="loading" rows={4} />}
      {!isPending && (isError || !data) && (
        <ListState variant="error" title={t('imprest:list.error', "Couldn't load site cash floats")}
          sub={t('imprest:list.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void refetch()} />
      )}
      {!isPending && !isError && data && (
        <>
          {data.truncated && <p role="status" className="mb-2 text-sm text-muted-foreground">
            {t('imprest:list.truncated', 'Showing the latest {{count}}. Archive floats you no longer use to see older ones.', { count: LIST_LIMIT })}
          </p>}
          <DataTable<FloatListRow> rows={rows} columns={columns} rowKey={(r) => r.id}
            onActivate={(r) => navigate(`/imprest/${r.id}`)}
            rowLabel={(r) => t('imprest:list.rowLabel', 'Open {{project}}', { project: r.project?.name ?? '' })}
            state={rows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('imprest:list.empty', 'No site floats yet')}
            emptySub={t('imprest:list.emptySub', 'Finance or an Admin establishes a float for a project and names its custodian.')}
            tableId="imprest-floats-table" />
        </>
      )}
      {establishOpen && <EstablishFloatModal onClose={() => setEstablishOpen(false)} />}
    </ListPage>
  );
};
export default ImprestFloatsPage;
