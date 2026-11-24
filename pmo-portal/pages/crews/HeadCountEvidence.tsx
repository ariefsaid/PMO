import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField, useToast } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { useViewableCategories } from '@/src/hooks/useDocumentCategories';
import { useHeadcountEvidenceMutations } from '@/src/hooks/useHeadcount';
import { repositories } from '@/src/lib/repositories';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
import type { HeadcountEvidence } from '@/src/lib/repositories/headcount';
import { refusalLine, useRefusalText } from '@/src/lib/refusals';

interface Props {
  headcountId: string;
  workOrderId: string;
  files: HeadcountEvidence[];
  /** The recorder may attach and detach while the line is not approved; everyone who reads the line may open a file. */
  canAttach: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * The files on one head count line (docs/specs/headcount-evidence.spec.md). Photos and documents are project documents of the
 * work order's project, so the organisation's own document rules decide who may file one; the database decides who may cite it on
 * the line (the recorder only, never after approval). The approver reads the same list before approving.
 */
export const HeadCountEvidence: React.FC<Props> = ({ headcountId, workOrderId, files, canAttach, isPending, isFetching, isError, onRetry }) => {
  const { t } = useTranslation('crews');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const categories = useViewableCategories();
  const { attachFile, detach } = useHeadcountEvidenceMutations();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const chosenCategory = categoryId || categories[0]?.id || '';

  const openFile = async (f: HeadcountEvidence) => {
    setProblem(null);
    if (!f.filePath) return;
    try { window.open(await repositories.document.getSignedUrl(f.filePath), '_blank', 'noopener'); } catch (err) { setProblem(refusalLine(refusal(err))); }
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file || !chosenCategory) return;
    setProblem(null);
    try {
      await attachFile.mutateAsync({ headcountId, workOrderId, file, categoryId: chosenCategory });
      setOpen(false);
      toast(t('headCount.evidence.attached', 'File attached'), undefined, 'success');
    } catch (err) { setProblem(refusalLine(refusal(err))); }
  };
  const remove = async (f: HeadcountEvidence) => {
    setProblem(null);
    try { await detach.mutateAsync(f.id); } catch (err) { setProblem(refusalLine(refusal(err))); }
  };

  return (
    <div className="mt-2 text-control" data-testid={`headcount-evidence-${headcountId}`}>
      {isPending && <p role="status" className="text-muted-foreground">{t('headCount.evidence.loading', 'Loading head count evidence…')}</p>}
      {isFetching && !isPending && !isError && <p role="status" className="text-muted-foreground">{t('headCount.evidence.refreshing', 'Updating head count evidence…')}</p>}
      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-destructive-text">
          <span>{t('headCount.evidence.error', "Couldn't load head count evidence.")}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>{t('headCount.evidence.retry', 'Retry')}</Button>
        </div>
      )}
      {files.length === 0 && !isPending && !isFetching && !isError
        ? <p className="text-muted-foreground">{t('headCount.evidence.none', 'No photo or document attached.')}</p>
        : files.length > 0 && (
          <ul className="space-y-1" aria-label={t('headCount.evidence.list', 'Attached files')}>
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void openFile(f)} disabled={!f.filePath}>{f.title || t('headCount.evidence.untitled', 'File')}</Button>
                {canAttach && (
                  <Button variant="ghost" size="sm" onClick={() => void remove(f)} disabled={detach.isPending}
                    aria-label={t('headCount.evidence.remove', 'Remove {{name}}', { name: f.title })}>{t('headCount.evidence.removeShort', 'Remove')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      {problem && <p role="alert" className="mt-1 text-sm text-destructive-text">{problem}</p>}
      {canAttach && !open && (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setOpen(true)}>{t('headCount.evidence.attach', 'Attach a photo or document')}</Button>
      )}
      {canAttach && open && (
        <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <SelectField label={t('headCount.evidence.category', 'Document category')} value={chosenCategory} onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))} disabled={attachFile.isPending} />
          <FileInput accept={FILE_INPUT_ACCEPT} aria-label={t('headCount.evidence.choose', 'Choose a photo or document')} onChange={(e) => void onFile(e)}
            disabled={attachFile.isPending || !chosenCategory} />
        </div>
      )}
    </div>
  );
};
