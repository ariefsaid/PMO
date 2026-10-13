import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, Icon, ReceiptPreview, useToast } from '@/src/components/ui';
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
    <Card variant="bare" className="mb-4">
      <CardHead>
        <span>{t('expenses.receipts.title', 'Receipts')}</span>
        {canWrite && (
          <span className="ml-auto">
            <input ref={inputRef} type="file" accept={RECEIPT_INPUT_ACCEPT} className="sr-only" tabIndex={-1}
              aria-label={t('expenses.receipts.attachAria', 'Choose a receipt file')} onChange={onPick} />
            <Button variant="outline" size="sm" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" />
              {progress !== null
                ? t('expenses.receipts.uploading', 'Uploading {{percent}}%', { percent: progress })
                : t('expenses.receipts.attach', 'Attach receipt')}
            </Button>
          </span>
        )}
      </CardHead>
      <CardPad>
        {list.isPending ? (
          <p className="text-sm text-muted-foreground">{t('expenses.receipts.loading', 'Loading receipts…')}</p>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-destructive">{t('expenses.receipts.error', "Couldn't load receipts.")}</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('expenses.receipts.empty', 'No receipts attached.')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => {
              const name = fileName(f.file_path);
              return (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <Icon name="file" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={name}>{name}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <ReceiptPreview
                      fileName={name}
                      getPreviewUrl={() => download(f.file_path)}
                      onDownload={() => open(f)}
                    />
                    <Button variant="ghost" size="sm" onClick={() => void open(f)}
                      aria-label={t('expenses.receipts.download', 'Download {{name}}', { name })}>
                      <Icon name="download" />
                    </Button>
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={() => setPendingRemove(f)}
                        aria-label={t('expenses.receipts.remove', 'Remove {{name}}', { name })}>
                        <Icon name="x" />
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {uploadError && <p role="alert" className="mt-2 text-sm text-destructive">{uploadError.message}</p>}
      </CardPad>
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
    </Card>
  );
};
