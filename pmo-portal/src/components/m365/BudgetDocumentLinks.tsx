import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Icon, ListState } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { budgetReference } from '@/src/lib/m365/reference';
import { useBudgetDocumentLinks } from '@/src/hooks/useBudgetDocumentLinks';
import { useMicrosoftDocuments } from '@/src/hooks/useMicrosoftDocuments';
import { useDocumentLinkPermissions } from './DocumentLinkPermissions';
import { LinkedDocumentCell } from './LinkedDocumentCell';
import { MicrosoftDocumentPicker } from './MicrosoftDocumentPicker';

export interface BudgetDocumentLinksProps {
  versionId: string;
  status: string;
}

/**
 * Microsoft evidence for the SELECTED budget version (AC-M365DOC-052/058/059/060/062). Evidence is
 * metadata only and sits beside, never inside, the financial editor: it reads and writes only the
 * typed evidence relation, so amounts, status and editor history are untouched. Linking is a
 * Draft-only affordance on the real role; Active/Archived versions keep reading and opening links.
 * The panel has its own loading/error state so a failed evidence read never blanks the amounts.
 */
export function BudgetDocumentLinks({ versionId, status }: BudgetDocumentLinksProps) {
  const { t } = useTranslation();
  const permissions = useDocumentLinkPermissions();
  const { query, add, remove } = useBudgetDocumentLinks(versionId);
  const { connection } = useMicrosoftDocuments();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const mayMutate = permissions.budgetEdit(status);
  const connected = connection?.connected === true && connection.status === 'active';
  const rows = query.data ?? [];

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      setRemoveError(null);
    } catch (error) {
      setRemoveError(classifyMutationError(error, undefined, { module: 'unknown', operation: 'delete' }).headline);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section aria-labelledby={`budget-evidence-${versionId}`} className="mt-4 min-w-0 border-t border-border pt-4" data-testid="budget-document-links">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 id={`budget-evidence-${versionId}`} className="min-w-0 text-[14px] font-semibold text-foreground">
          {t('m365Documents.budget.heading', 'Evidence documents')}
        </h3>
        {mayMutate && (
          <Button variant="outline" size="sm" disabled={!connected} onClick={() => setPickerOpen(true)}>
            <Icon name="doc" />
            {t('m365Documents.budget.link', 'Link from Microsoft 365')}
          </Button>
        )}
      </div>
      {!mayMutate && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('m365Documents.budget.readOnly', 'Evidence is read-only on this version.')}
        </p>
      )}
      {mayMutate && !connected && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('m365Documents.budget.connectHint', 'Connect Microsoft 365 in My integrations to link documents.')}
        </p>
      )}

      <div className="mt-3">
        {query.isPending ? (
          <ListState variant="loading" rows={2} />
        ) : query.isError ? (
          <ListState
            variant="error"
            title={t('m365Documents.budget.loadError', 'Evidence documents could not be loaded')}
            sub={t('m365Documents.budget.loadErrorSub', 'The budget figures are not affected. Try again.')}
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('m365Documents.budget.empty', 'No evidence documents are linked to this version.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const reference = budgetReference(row);
              return (
                <li key={row.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    {reference ? (
                      <LinkedDocumentCell reference={reference} owner={{ kind: 'budget', id: row.id }} />
                    ) : (
                      <span className="text-[12px] text-muted-foreground">{t('m365Documents.budget.unavailable', 'This link is unavailable.')}</span>
                    )}
                  </div>
                  {mayMutate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('m365Documents.budget.removeNamed', 'Remove link to {{name}}', { name: row.ms_item_name })}
                      onClick={() => setRemoving({ id: row.id, name: row.ms_item_name })}
                    >
                      {t('m365Documents.budget.remove', 'Remove')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {removeError && <p role="alert" className="mt-2 text-[12px] text-destructive-text">{removeError}</p>}
      </div>

      {mayMutate && (
        <MicrosoftDocumentPicker
          open={pickerOpen}
          context={{ kind: 'budget' }}
          onClose={() => setPickerOpen(false)}
          onSelect={async (ref) => { await add.mutateAsync(ref); }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('m365Documents.budget.removeTitle', 'Remove this link?')}
        description={t('m365Documents.budget.removeDescription', 'The link to {{name}} is removed from this version. The Microsoft file is not changed.', { name: removing?.name ?? '' })}
        confirmLabel={t('m365Documents.budget.remove', 'Remove')}
        tone="destructive"
        loading={remove.isPending}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
