import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, ConfirmDialog, DataTable, EntityFormModal, FormGrid, Icon, StatusPill, TextField, useEntityForm,
  type Column, type SubmitError,
} from '@/src/components/ui';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { MicrosoftDocumentPicker } from '@/src/components/m365/MicrosoftDocumentPicker';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { matchingReferencePairs, useProcurementMicrosoftReferences } from '@/src/hooks/useProcurementMicrosoftReferences';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { refreshMicrosoftReferences } from '@/src/lib/m365/graphClient';
import { procurementReference, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import type { ProcurementDocumentRow } from '@/src/lib/db/procurementCrud';

export interface ProcurementMicrosoftReferencesProps {
  procurementId: string;
  /** The case's purchase-request number (`procurements.pr_number`); only a picker search hint. */
  requestNumber: string | null;
  createdAt: string;
}

const STATUS_VARIANT = {
  Draft: 'draft', Issued: 'open', Approved: 'won', Rejected: 'lost', Closed: 'superseded', Superseded: 'superseded',
} as const;

/** A legacy plain link is opened as an ordinary external link only when it is a plain http(s) URL. */
function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? value : null;
  } catch {
    return null;
  }
}

type Target = { kind: 'new' } | { kind: 'row'; id: string };
type Confirm = { kind: 'unlink' | 'clear'; row: ProcurementDocumentRow };

/**
 * Case-level Microsoft references on the procurement Documents tab (AC-M365DOC-058/059/060/062/063),
 * beside — never inside — the financial ledger. Works for overhead cases with no project and at any
 * stage. It never changes a money transition or a ledger total.
 */
export function ProcurementMicrosoftReferences({ procurementId, requestNumber, createdAt }: ProcurementMicrosoftReferencesProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const permissions = useDocumentLinkPermissions();
  const { query, create, link, unlink, clearLegacy } = useProcurementMicrosoftReferences(procurementId);
  const rows = query.data ?? [];
  const canCreate = permissions.procurementCreate();
  const canEdit = permissions.procurementEdit();

  const [pickerTarget, setPickerTarget] = useState<Target | null>(null);
  const [pendingRef, setPendingRef] = useState<MicrosoftReferenceInput | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<SubmitError | null>(null);
  const pickerOpener = useRef<HTMLElement | null>(null);

  const form = useEntityForm<{ referenceNumber: string; date: string }>({
    initialValues: { referenceNumber: '', date: '' },
    idPrefix: 'proc-ms-ref',
    module: 'procurement',
  });

  /** Matching browse refresh: only for rows the picker itself surfaced, never for absent results. */
  async function refreshMatches(selected: MicrosoftReferenceInput) {
    const pairs = matchingReferencePairs([selected], rows);
    if (pairs.length === 0) return;
    try {
      await refreshMicrosoftReferences({ procurement_id: procurementId, items: pairs });
      await qc.invalidateQueries({ queryKey: ['procurement-documents', orgId, procurementId] });
    } catch {
      // A failed metadata read keeps the reference exactly as stored.
    }
  }

  async function onPickerSelect(selected: MicrosoftReferenceInput) {
    if (!pickerTarget) return;
    if (pickerTarget.kind === 'row') {
      await link.mutateAsync({ id: pickerTarget.id, reference: selected });
    } else {
      await refreshMatches(selected);
      setPendingRef(selected);
    }
  }

  function openPicker(target: Target, opener?: HTMLElement | null) {
    pickerOpener.current = opener ?? null;
    setPickerTarget(target);
  }

  function closePicker() {
    setPickerTarget(null);
    pickerOpener.current?.focus?.();
  }

  function closeDetails() {
    setPendingRef(null);
    setDetailsError(null);
    form.reset({ referenceNumber: '', date: '' });
    pickerOpener.current?.focus?.();
  }

  function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingRef) return;
    void form.handleSubmit(async (values) => {
      setDetailsError(null);
      try {
        await create.mutateAsync({
          reference: pendingRef,
          metadata: { referenceNumber: values.referenceNumber.trim() || null, date: values.date || null },
        });
        closeDetails();
      } catch (error) {
        const classified = classifyMutationError(error, undefined, { module: 'procurement', operation: 'create' });
        setDetailsError({ headline: t('m365Documents.procurement.createFailed', 'Could not add this reference.'), detail: classified.detail });
      }
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmError(null);
    try {
      if (confirm.kind === 'unlink') await unlink.mutateAsync(confirm.row.id);
      else await clearLegacy.mutateAsync(confirm.row.id);
      setConfirm(null);
    } catch {
      setConfirmError(t('m365Documents.procurement.changeFailed', 'The reference was not changed. Check your permissions and try again.'));
    }
  }

  const columns: Column<ProcurementDocumentRow>[] = [
    {
      key: 'type', header: t('m365Documents.procurement.colType', 'Type'), kind: 'primary', rowHeader: true,
      cell: (row) => <span className="min-w-0 break-words">{row.type}</span>,
      secondaryCell: (row) => (row.reference_number ? <span className="break-words">{row.reference_number}</span> : null),
    },
    {
      key: 'reference', header: t('m365Documents.procurement.colReference', 'Reference'), kind: 'text',
      cell: (row) => {
        const reference = procurementReference(row);
        if (reference) {
          return <LinkedDocumentCell reference={reference} title={row.type} owner={{ kind: 'procurement', id: row.id }} />;
        }
        const href = safeExternalUrl(row.link);
        if (row.link) {
          return (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[12px] text-muted-foreground">{t('m365Documents.procurement.legacyNote', 'Plain link, not from Microsoft 365')}</span>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 break-all text-[13px] text-primary hover:underline">
                  <Icon name="eye" className="shrink-0" />
                  {t('m365Documents.procurement.openLegacy', 'Open linked document')}
                </a>
              ) : (
                <span className="text-[12px] text-muted-foreground">{t('m365Documents.procurement.legacyUnsafe', 'This link cannot be opened.')}</span>
              )}
            </div>
          );
        }
        return <span className="text-[13px] text-muted-foreground">{t('m365Documents.procurement.noFile', 'No file linked')}</span>;
      },
    },
    {
      key: 'date', header: t('m365Documents.procurement.colDate', 'Date'), kind: 'date', colClassName: 'hidden md:table-cell',
      cell: (row) => <span className="text-[13px]">{row.date ?? '—'}</span>,
    },
    {
      key: 'status', header: t('m365Documents.procurement.colStatus', 'Status'), kind: 'status',
      cell: (row) => <StatusPill variant={STATUS_VARIANT[row.status] ?? 'neutral'}>{row.status}</StatusPill>,
    },
    {
      key: 'actions', header: <span className="sr-only">{t('m365Documents.procurement.colActions', 'Actions')}</span>, kind: 'actions',
      cell: (row) => {
        if (!canEdit) return null;
        const reference = procurementReference(row);
        return (
          <div className="flex flex-wrap justify-end gap-1">
            {reference && (
              <Button variant="ghost" size="sm" className="touch-target" aria-label={t('m365Documents.procurement.unlinkAria', 'Unlink {{name}}', { name: reference.name })}
                onClick={() => { setConfirmError(null); setConfirm({ kind: 'unlink', row }); }}>
                {t('m365Documents.procurement.unlink', 'Unlink')}
              </Button>
            )}
            {!reference && row.link && (
              <Button variant="ghost" size="sm" className="touch-target" aria-label={t('m365Documents.procurement.clearAria', 'Clear link on {{type}}', { type: row.type })}
                onClick={() => { setConfirmError(null); setConfirm({ kind: 'clear', row }); }}>
                {t('m365Documents.procurement.clearLegacy', 'Clear link')}
              </Button>
            )}
            {!reference && !row.link && !row.source && (
              <Button variant="outline" size="sm" className="touch-target" aria-label={t('m365Documents.procurement.linkRowAria', 'Link {{type}} from Microsoft 365', { type: row.type })}
                onClick={(e) => openPicker({ kind: 'row', id: row.id }, e.currentTarget)}>
                {t('m365Documents.procurement.linkRow', 'Link from Microsoft 365')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const pickerContext = { kind: 'procurement', request_number: requestNumber, created_at: createdAt } as const;

  return (
    <section aria-labelledby="proc-case-references-heading" className="mt-6 border-t border-border pt-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
        <h3 id="proc-case-references-heading" className="min-w-0 break-words text-[14px] font-semibold text-foreground">
          {t('m365Documents.procurement.heading', 'Case references')}
        </h3>
        {canCreate && (
          <Button variant="outline" size="sm" className="touch-target" onClick={(e) => openPicker({ kind: 'new' }, e.currentTarget)}>
            <Icon name="plug" />
            {t('m365Documents.procurement.link', 'Link from Microsoft 365')}
          </Button>
        )}
      </div>
      <p className="mt-1 px-1 text-[12px] text-muted-foreground">
        {t('m365Documents.procurement.intro', 'SharePoint and OneDrive files and folders linked to this case. PMO stores the link, not the file.')}
      </p>
      <div className="mt-2">
        <DataTable
          tableId="procurement-case-references"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          accessibleName={t('m365Documents.procurement.heading', 'Case references')}
          state={query.isPending ? 'loading' : query.isError ? 'error' : rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('m365Documents.procurement.emptyTitle', 'No references yet')}
          emptySub={canCreate ? t('m365Documents.procurement.emptySub', 'Link a SharePoint or OneDrive file or folder to this case.') : t('m365Documents.procurement.emptySubReadOnly', 'Nothing has been linked to this case.')}
          errorTitle={t('m365Documents.procurement.errorTitle', 'Case references could not be loaded')}
          errorSub={t('m365Documents.procurement.errorSub', 'Check your connection and try again.')}
          onRetry={() => void query.refetch()}
        />
      </div>

      <MicrosoftDocumentPicker
        open={pickerTarget !== null && pendingRef === null}
        context={pickerContext}
        onClose={closePicker}
        onSelect={onPickerSelect}
      />

      {pendingRef && (
        <EntityFormModal
          open
          title={t('m365Documents.procurement.detailsTitle', 'Add case reference')}
          subtitle={pendingRef.name}
          submitLabel={t('m365Documents.procurement.detailsSubmit', 'Link reference')}
          onSubmit={submitDetails}
          onClose={closeDetails}
          dirty={form.isDirty}
          loading={create.isPending}
          submitError={detailsError}
        >
          <FormGrid>
            <TextField
              label={t('m365Documents.procurement.refNumber', 'Reference number (optional)')}
              maxLength={100}
              {...form.fieldProps('referenceNumber')}
            />
            <TextField
              label={t('m365Documents.procurement.refDate', 'Date (optional)')}
              type="date"
              {...form.fieldProps('date')}
            />
          </FormGrid>
        </EntityFormModal>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'unlink' ? t('m365Documents.procurement.unlinkTitle', 'Unlink this reference') : t('m365Documents.procurement.clearTitle', 'Clear this link')}
        description={(
          <>
            {confirm?.kind === 'unlink'
              ? t('m365Documents.procurement.unlinkBody', 'This removes only the PMO reference. The item stored in Microsoft 365 is not changed or deleted, and the row keeps its type, status, reference number and date.')
              : t('m365Documents.procurement.clearBody', 'This removes the saved web address from this row. The row keeps its type, status, reference number and date.')}
            {confirmError && <span role="alert" className="mt-2 block text-destructive-text">{confirmError}</span>}
          </>
        )}
        confirmLabel={confirm?.kind === 'unlink' ? t('m365Documents.procurement.unlink', 'Unlink') : t('m365Documents.procurement.clearLegacy', 'Clear link')}
        tone="destructive"
        loading={unlink.isPending || clearLegacy.isPending}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
