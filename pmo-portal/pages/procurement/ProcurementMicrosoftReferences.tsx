import { RecordFolderAction } from '@/src/components/m365/RecordFolderAction';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, Icon, ListState } from '@/src/components/ui';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { MicrosoftDocumentPicker } from '@/src/components/m365/MicrosoftDocumentPicker';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { matchingReferencePairs, useProcurementMicrosoftReferences } from '@/src/hooks/useProcurementMicrosoftReferences';
import { useAuth } from '@/src/auth/useAuth';
import { formatInstantDate } from '@/src/lib/format';
import { refreshMicrosoftReferences } from '@/src/lib/m365/graphClient';
import { procurementReference, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import type { ProcurementDocumentRow } from '@/src/lib/db/procurementCrud';

export interface ProcurementMicrosoftReferencesProps {
  procurementId: string;
  /** The case's purchase-request number (`procurements.pr_number`); only a picker search hint. */
  requestNumber: string | null;
  createdAt: string;
}

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

type Confirm = { kind: 'unlink' | 'clear'; row: ProcurementDocumentRow };

/**
 * SharePoint links for a case on the procurement Documents tab (AC-M365DOC-058/059/060/062/063): a
 * plain list of links (name, when linked, open, unlink), beside — never inside — the financial
 * ledger. The ledger owns every record's type, status and reference number, so a record that has no
 * link is not repeated here. Works for overhead cases with no project and at any stage. It never
 * changes a money transition or a ledger total.
 */
export function ProcurementMicrosoftReferences({ procurementId, requestNumber, createdAt }: ProcurementMicrosoftReferencesProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const permissions = useDocumentLinkPermissions();
  const { query, create, unlink, clearLegacy } = useProcurementMicrosoftReferences(procurementId);
  const canCreate = permissions.procurementCreate();
  const canEdit = permissions.procurementEdit();
  // Only rows that carry a link belong in a list of links.
  const allRows = query.data ?? [];
  const rows = allRows.filter((row) => procurementReference(row) !== null || !!row.link);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const pickerOpener = useRef<HTMLElement | null>(null);

  /** Matching browse refresh: only for rows the picker itself surfaced, never for absent results. */
  async function refreshMatches(selected: MicrosoftReferenceInput) {
    const pairs = matchingReferencePairs([selected], allRows);
    if (pairs.length === 0) return;
    try {
      await refreshMicrosoftReferences({ procurement_id: procurementId, items: pairs });
      await qc.invalidateQueries({ queryKey: ['procurement-documents', orgId, procurementId] });
    } catch {
      // A failed metadata read keeps the reference exactly as stored.
    }
  }

  /** A failed create rejects out of here, so the picker keeps the selection and reports it. */
  async function onPickerSelect(selected: MicrosoftReferenceInput) {
    await refreshMatches(selected);
    await create.mutateAsync({ reference: selected });
  }

  function openPicker(opener?: HTMLElement | null) {
    pickerOpener.current = opener ?? null;
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    pickerOpener.current?.focus?.();
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

  function renderLink(row: ProcurementDocumentRow) {
    const reference = procurementReference(row);
    if (reference) {
      return (
        <>
          <LinkedDocumentCell reference={reference} owner={{ kind: 'procurement', id: row.id }} />
          {row.ms_linked_at && (
            <span className="text-[12px] text-muted-foreground">
              {t('m365Documents.procurement.linkedOn', 'Linked {{date}}', { date: formatInstantDate(row.ms_linked_at) })}
            </span>
          )}
        </>
      );
    }
    const href = safeExternalUrl(row.link);
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="break-words text-[13px] font-medium text-foreground">{row.type}</span>
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

  const listName = t('m365Documents.procurement.heading', 'SharePoint links for this case');
  const pickerContext = { kind: 'procurement', request_number: requestNumber, created_at: createdAt } as const;

  return (
    <section aria-labelledby="proc-case-references-heading" className="mt-6 border-t border-border pt-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
        <h3 id="proc-case-references-heading" className="min-w-0 break-words text-[14px] font-semibold text-foreground">
          {listName}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <RecordFolderAction
            target={{ kind: 'procurement', id: procurementId }}
            hasFolder={allRows.some((r) => r.source === 'onedrive' && r.ms_item_kind === 'folder')}
            onChooseExisting={canCreate ? () => openPicker() : undefined}
          />
          {canCreate && (
            <Button variant="outline" size="sm" className="touch-target" onClick={(e) => openPicker(e.currentTarget)}>
              <Icon name="doc" />
              {t('m365Documents.procurement.link', 'Link from Microsoft 365')}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 px-1 text-[12px] text-muted-foreground">
        {t('m365Documents.procurement.intro', 'SharePoint and OneDrive files and folders linked to this case. PMO stores the link, not the file.')}
      </p>
      <div className="mt-2">
        {query.isPending ? (
          <ListState variant="loading" rows={2} />
        ) : query.isError ? (
          <ListState
            variant="error"
            title={t('m365Documents.procurement.errorTitle', 'SharePoint links could not be loaded')}
            sub={t('m365Documents.procurement.errorSub', 'Check your connection and try again.')}
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <ListState
            variant="empty"
            title={t('m365Documents.procurement.emptyTitle', 'No links yet')}
            sub={canCreate ? t('m365Documents.procurement.emptySub', 'Link a SharePoint or OneDrive file or folder to this case.') : t('m365Documents.procurement.emptySubReadOnly', 'Nothing has been linked to this case.')}
            className="py-6"
          />
        ) : (
          <ul aria-label={listName} className="divide-y divide-border">
            {rows.map((row) => {
              const reference = procurementReference(row);
              return (
                <li key={row.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-1 py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">{renderLink(row)}</div>
                  {canEdit && (
                    <Button
                      variant="ghost" size="sm" className="touch-target shrink-0"
                      aria-label={reference
                        ? t('m365Documents.procurement.unlinkAria', 'Unlink {{name}}', { name: reference.name })
                        : t('m365Documents.procurement.clearAria', 'Clear link on {{type}}', { type: row.type })}
                      onClick={() => { setConfirmError(null); setConfirm({ kind: reference ? 'unlink' : 'clear', row }); }}
                    >
                      {reference ? t('m365Documents.procurement.unlink', 'Unlink') : t('m365Documents.procurement.clearLegacy', 'Clear link')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MicrosoftDocumentPicker
        open={pickerOpen}
        context={pickerContext}
        onClose={closePicker}
        onSelect={onPickerSelect}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'unlink' ? t('m365Documents.procurement.unlinkTitle', 'Unlink this reference') : t('m365Documents.procurement.clearTitle', 'Clear this link')}
        description={(
          <>
            {confirm?.kind === 'unlink'
              ? t('m365Documents.procurement.unlinkBody', 'This removes only the PMO reference. The item stored in Microsoft 365 is not changed or deleted.')
              : t('m365Documents.procurement.clearBody', 'This removes the saved web address from this record. The record itself is not changed.')}
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
