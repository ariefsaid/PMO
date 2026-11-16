import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Icon, RecordMenu, RecordSection, useToast } from '@/src/components/ui';
import { ReceiptPreviewButton } from '@/src/components/documents/targets/ReceiptPreviewButton';
import { useExpenseReceipts } from '@/src/hooks/useExpenseReceipts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { RECEIPT_INPUT_ACCEPT, type ExpenseReceiptRow } from '@/src/lib/db/expenseReceipts';

/** Receipts on a claim or advance (FR-EXP-005/063). Storage RLS (0247 §5) is the authority; `canWrite` is UX. */
export interface ExpenseReceiptsCardProps {
  claimId: string;
  canWrite: boolean;
}

const fileName = (path: string | null): string => (path ? path.split('/').pop() || 'receipt' : 'receipt');

export const ExpenseReceiptsCard: React.FC<ExpenseReceiptsCardProps> = ({ claimId, canWrite }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { list, upload, archive, download, progress, uploadError, clearUploadError } = useExpenseReceipts(claimId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingRemove, setPendingRemove] = useState<ExpenseReceiptRow | null>(null);
  const files = list.data ?? [];

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    clearUploadError();
    upload.mutate(file, {
      onSuccess: () => toast(t('expenses.receipts.attached', 'Receipt attached'), file.name, 'success'),
    });
  };

  const open = async (f: ExpenseReceiptRow) => {
    try {
      window.open(await download(f.file_path, { download: true }), '_blank', 'noopener,noreferrer');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const confirmRemove = () => {
    if (!pendingRemove) return;
    const target = pendingRemove;
    setPendingRemove(null);
    archive.mutate(target.id, {
      onSuccess: () => toast(t('expenses.receipts.removed', 'Receipt removed'), undefined, 'success'),
      onError: (err: unknown) => {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
      },
    });
  };

  return (
    <RecordSection
      title={t('expenses.receipts.title', 'Receipts')}
      actions={
        canWrite && (
          <>
            <input ref={inputRef} type="file" accept={RECEIPT_INPUT_ACCEPT} className="sr-only" tabIndex={-1}
              aria-label={t('expenses.receipts.attachAria', 'Choose a receipt file')} onChange={onPick} />
            <Button variant="outline" size="sm" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" />
              {progress !== null
                ? t('expenses.receipts.uploading', 'Uploading {{percent}}%', { percent: progress })
                : t('expenses.receipts.attach', 'Attach receipt')}
            </Button>
          </>
        )
      }
    >
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">{t('expenses.receipts.loading', 'Loading receipts…')}</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">{t('expenses.receipts.error', "Couldn't load receipts.")}</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('expenses.receipts.empty', 'No receipts attached.')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {files.map((f) => {
            const name = fileName(f.file_path);
            return (
              // One settled file row: icon, name on one line, a labelled Preview, then one menu for the rest
              // (Download, Remove → confirm), so no two small targets sit side by side.
              <li key={f.id} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                <Icon name="file" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                <ReceiptPreviewButton
                  id={f.id}
                  fileName={name}
                  filePath={f.file_path}
                  getSignedUrl={download}
                  onDownload={() => open(f)}
                  label={t('expenseClaims:receipts.previewShort', 'Preview')}
                />
                <RecordMenu
                  ariaLabel={t('expenseClaims:receipts.menuAria', 'Receipt actions: {{name}}', { name })}
                  triggerClassName="border-transparent bg-transparent"
                  items={[
                    { key: 'download', label: t('expenseClaims:receipts.downloadShort', 'Download'), onSelect: () => void open(f) },
                    ...(canWrite ? [{ key: 'remove', label: t('expenseClaims:receipts.removeShort', 'Remove'), danger: true, onSelect: () => setPendingRemove(f) }] : []),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
      {uploadError && <p role="alert" className="mt-2 text-sm text-destructive">{uploadError.message}</p>}
      <ConfirmDialog
        open={pendingRemove !== null}
        tone="destructive"
        title={t('expenses.receipts.removeTitle', 'Remove this receipt?')}
        description={t('expenses.receipts.removeDescription', 'It is removed from this claim. You can attach it again.')}
        confirmLabel={t('expenses.receipts.removeConfirm', 'Remove')}
        loading={archive.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </RecordSection>
  );
};
