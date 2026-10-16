import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmDialog,
  DataTable,
  ListState,
  SectionHeader,
  useToast,
  type Column,
  type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useFxRates, useFxRateMutations } from '@/src/hooks/useFxRates';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDateOnly, formatNumberExact } from '@/src/lib/format';
import { repositories } from '@/src/lib/repositories';
import type { FxCommitCounts, FxRateInput, FxRateRow } from '@/src/lib/repositories/types';
import FxRateForm from '@/src/components/fx/FxRateForm';
import FxRateUpload from '@/src/components/fx/FxRateUpload';

interface FormTarget {
  row?: FxRateRow;
  draft?: FxRateInput;
}

const AdministrationExchangeRates: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const orgDay = useFxOrgDay(true);
  const { toast } = useToast();
  const mutations = useFxRateMutations();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const cursor = cursorStack.at(-1);
  const rates = useFxRates(cursor);
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualError, setManualError] = useState<SubmitError | null>(null);
  const [manualChecking, setManualChecking] = useState(false);
  const [pendingManual, setPendingManual] = useState<FxRateInput | null>(null);
  const [pendingManualRow, setPendingManualRow] = useState<FxRateRow | null>(null);
  const [overwriteRate, setOverwriteRate] = useState<number | null>(null);
  const canUpload = may('upload', 'fxRate', { record: { viewOnly } });
  const canCreate = may('create', 'fxRate', { record: { viewOnly } });
  const canEdit = may('edit', 'fxRate', { record: { viewOnly } });
  const busy = orgDay.isPending || orgDay.isError || !orgDay.day;
  // S-38 (RF-054): an empty reference-rate history must offer its setup path where the user
  // is looking. When the list is empty the Upload action moves into the empty state (one
  // primary action), so the header stands down instead of duplicating it.
  const listEmpty = rates.isSuccess && (rates.data?.rows.length ?? 0) === 0;

  const openUpload = () => {
    if (!may('upload', 'fxRate', { record: { viewOnly } }) || busy) return;
    setFormTarget(null);
    setUploadOpen(true);
  };

  const announceSaved = (counts: FxCommitCounts) => {
    toast(
      t(
        'fx.saved',
        'Rates saved: {{new}} new, {{changed}} changed, {{unchanged}} unchanged.',
        counts,
      ),
      '',
      'success',
    );
    setCursorStack([]);
    setFormTarget(null);
    setUploadOpen(false);
    setManualError(null);
    setPendingManual(null);
    setPendingManualRow(null);
    setOverwriteRate(null);
  };

  const commitManual = async (input: FxRateInput, target: FormTarget) => {
    const permitted = target.row ? canEdit : canCreate;
    if (!permitted) return;
    setManualError(null);
    try {
      const counts = await mutations.upsert.mutateAsync([input]);
      announceSaved(counts);
    } catch (error) {
      const classified = classifyMutationError(error);
      setManualError({ headline: classified.headline, detail: classified.detail });
      setFormTarget({ ...target, draft: input });
      setPendingManual(null);
      setPendingManualRow(null);
      setOverwriteRate(null);
    }
  };

  const submitManual = async (input: FxRateInput) => {
    const target = formTarget ?? {};
    if (target.row ? !canEdit : !canCreate) return;
    setManualChecking(true);
    setManualError(null);
    try {
      const existing = await repositories.fxRates.existing([input.rate_date]);
      const current = existing.find((rate) => rate.rate_date === input.rate_date);
      if (current && current.rate !== input.rate) {
        setPendingManual(input);
        setPendingManualRow(target.row ?? null);
        setOverwriteRate(current.rate);
        setFormTarget(null);
      } else {
        await commitManual(input, target);
      }
    } catch (error) {
      const classified = classifyMutationError(error);
      setManualError({ headline: classified.headline, detail: classified.detail });
      setFormTarget({ ...target, draft: input });
    } finally {
      setManualChecking(false);
    }
  };

  const cancelOverwrite = () => {
    if (!pendingManual) return;
    setFormTarget({ ...(pendingManualRow ? { row: pendingManualRow } : {}), draft: pendingManual });
    setPendingManual(null);
    setPendingManualRow(null);
    setOverwriteRate(null);
  };

  const confirmOverwrite = () => {
    if (!pendingManual || mutations.upsert.isPending) return;
    const target: FormTarget = pendingManualRow ? { row: pendingManualRow } : {};
    if (target.row ? !canEdit : !canCreate) {
      setPendingManual(null);
      setPendingManualRow(null);
      setOverwriteRate(null);
      return;
    }
    void commitManual(pendingManual, target);
  };

  const columns: Column<FxRateRow>[] = [
    {
      key: 'rate_date',
      header: t('fx.date', 'Publication date'),
      cell: (row) => formatDateOnly(row.rate_date),
      exportValue: (row) => row.rate_date,
    },
    {
      key: 'rate',
      header: t('fx.rate', 'IDR per USD'),
      align: 'num',
      cell: (row) => <span className="tabular-nums">{formatNumberExact(row.rate)}</span>,
      exportValue: (row) => row.rate,
    },
    {
      key: 'source',
      header: t('fx.source', 'Source'),
      cell: (row) => row.source,
      exportValue: (row) => row.source,
    },
  ];

  return (
    <section aria-labelledby="fx-rates-heading" className="min-w-0">
      <SectionHeader
        title={<span id="fx-rates-heading">{t('admin.nav.exchangeRates', 'Exchange rates')}</span>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canUpload && !listEmpty && (
              <Button disabled={busy} onClick={openUpload}>
                {t('fx.upload', 'Upload rates')}
              </Button>
            )}
            {canCreate && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (!may('create', 'fxRate', { record: { viewOnly } })) return;
                  setManualError(null);
                  setFormTarget({});
                }}
              >
                {t('fx.newRate', 'New rate')}
              </Button>
            )}
          </div>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {t('fx.description', 'USD → IDR · JISDOR · display equivalents only')}
      </p>

      {orgDay.isPending ? (
        <ListState variant="loading" rows={1} testId="fx-org-day-loading" />
      ) : orgDay.isError || !orgDay.day ? (
        <ListState
          variant="error"
          title={t('fx.orgCurrencyError', 'Could not resolve the organization currency.')}
          sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          retryLabel={t('fx.retry', 'Retry')}
          onRetry={orgDay.retry}
        />
      ) : rates.isPending ? (
        <ListState variant="loading" rows={5} testId="fx-rates-loading" />
      ) : rates.isError ? (
        <ListState
          variant="error"
          title={t('fx.loadError', 'Could not load exchange rates')}
          sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          retryLabel={t('fx.retry', 'Retry')}
          onRetry={() => void rates.refetch()}
        />
      ) : !rates.data?.rows.length ? (
        <ListState
          variant="empty"
          icon="upload"
          title={t('fx.empty', 'No JISDOR rates yet')}
          sub={
            canUpload
              ? `${t('fx.emptyBody', "Upload BI's JISDOR history to show rupiah equivalents.")} ${t(
                  'uxs38.emptyScope',
                  'Reference rates affect displayed rupiah equivalents only — accounting records are never changed.',
                )}`
              : `${t('fx.emptyBody', "Upload BI's JISDOR history to show rupiah equivalents.")} ${t(
                  'uxs38.emptyScope',
                  'Reference rates affect displayed rupiah equivalents only — accounting records are never changed.',
                )} ${t(
                  'uxs38.emptyNeedRole',
                  'An Admin or Finance member can upload them from this page.',
                )}`
          }
          stateId="fx-rates-empty"
          role={realRole ?? undefined}
          module="administration"
          action={
            canUpload
              ? { label: t('fx.upload', 'Upload rates'), onClick: openUpload }
              : undefined
          }
        />
      ) : (
        <>
          <p data-testid="fx-page-summary" className="mb-2 text-sm text-muted-foreground">
            {t('uxs38.pageSummary', 'Rates shown: {{count}} · dates {{first}} to {{last}}', {
              first: formatDateOnly(rates.data.rows[rates.data.rows.length - 1].rate_date),
              last: formatDateOnly(rates.data.rows[0].rate_date),
              count: rates.data.rows.length,
            })}
            {rates.data.nextCursor && (
              <>
                {' · '}
                {t('uxs38.moreEarlier', 'earlier rates on the next pages')}
              </>
            )}
          </p>
          <DataTable<FxRateRow>
            rows={rates.data.rows}
            columns={columns}
            rowKey={(row) => row.id}
            rowMenu={
              canEdit
                ? (row) => [
                    {
                      label: t('fx.editRate', 'Edit rate'),
                      onClick: () => {
                        if (!may('edit', 'fxRate', { record: { viewOnly } })) return;
                        setManualError(null);
                        setFormTarget({ row });
                      },
                    },
                  ]
                : undefined
            }
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={cursorStack.length === 0}
              onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
            >
              {t('fx.previous', 'Previous')}
            </Button>
            <Button
              variant="outline"
              disabled={!rates.data.nextCursor}
              onClick={() => {
                if (rates.data?.nextCursor)
                  setCursorStack((stack) => [...stack, rates.data!.nextCursor!]);
              }}
            >
              {t('fx.next', 'Next')}
            </Button>
          </div>
        </>
      )}

      {uploadOpen && orgDay.day && (
        <FxRateUpload
          today={orgDay.day}
          canUpload={canUpload}
          onClose={() => setUploadOpen(false)}
          onCommitted={announceSaved}
        />
      )}
      {formTarget && orgDay.day && (
        <FxRateForm
          key={`${formTarget.row?.id ?? 'new'}:${formTarget.draft?.rate_date ?? ''}:${formTarget.draft?.rate ?? ''}`}
          row={formTarget.row}
          draft={formTarget.draft}
          today={orgDay.day}
          loading={manualChecking || mutations.upsert.isPending}
          submitError={manualError}
          onClose={() => setFormTarget(null)}
          onSubmit={(input) => void submitManual(input)}
        />
      )}
      <ConfirmDialog
        open={pendingManual !== null}
        title={t('fx.overwrite', 'Replace the rate for {{date}}?', {
          date: pendingManual ? formatDateOnly(pendingManual.rate_date) : '',
        })}
        description={
          <div className="space-y-1">
            <p>{pendingManual ? formatDateOnly(pendingManual.rate_date) : ''}</p>
            <p>
              {t('fx.overwriteValues', '{{old}} → {{new}} IDR per USD', {
                old: formatNumberExact(overwriteRate ?? 0),
                new: formatNumberExact(pendingManual?.rate ?? 0),
              })}
            </p>
          </div>
        }
        confirmLabel={t('fx.saveRates', 'Save rates')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={mutations.upsert.isPending}
        onConfirm={confirmOverwrite}
        onCancel={cancelOverwrite}
      />
    </section>
  );
};

export default AdministrationExchangeRates;
