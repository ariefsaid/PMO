import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, StatusPill } from '@/src/components/ui';
import { useDailySiteReportMutations } from '@/src/hooks/useDailySiteReports';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import type { DsrPhoto, DsrReport } from '@/src/lib/db/dailySiteReports';

/**
 * FR-DSR-008: the paper form's photo (required to validate, not to save) and other site photos, in the private
 * bucket. On a phone the picker opens the camera. A failed upload keeps the draft and offers Retry.
 */
export const SiteReportPhotos: React.FC<{ report: DsrReport; photos: DsrPhoto[]; canWrite: boolean }> = ({ report, photos, canWrite }) => {
  const { t } = useTranslation('siteReport');
  const { uploadPhoto } = useDailySiteReportMutations();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DsrPhoto['kind']>('paper_form');
  const [failed, setFailed] = useState<{ file: File; message: string; retryable: boolean } | null>(null);

  // #2897: photos are accepted only while the report is editable (the server's rule, dsr_photo_writable),
  // so the section offers the upload — buttons AND the file input — only in that state, whatever the
  // caller passes; a refusal read on a submitted report says the rule instead of a generic failure.
  const writable = canWrite && (report.status === 'draft' || report.status === 'returned');
  const submittedNote = () => t('photos.submittedOnly', 'Photos can be added only before the report is submitted.');

  const send = async (file: File) => {
    if (!writable) {
      setFailed({ file, message: submittedNote(), retryable: false });
      return;
    }
    setFailed(null);
    try {
      await uploadPhoto.mutateAsync({ report, file, kind });
    } catch (err) {
      // 42501 on this path is the database's submitted-report rule (see uploadPhoto); the mapped
      // sentence replaces the generic permission headline, and a retry cannot change it.
      const { headline, classification } = classifyMutationError(err, { '42501': submittedNote() });
      setFailed({ file, message: headline, retryable: classification !== 'override' });
    }
  };
  const open = async (path: string) => {
    const url = await repositories.dailySiteReport.photoUrl(path);
    window.open(url, '_blank', 'noopener');
  };
  const pick = (k: DsrPhoto['kind']) => { setKind(k); input.current?.click(); };

  return (
    <RecordSection title={t('photos.title', 'Photos')} data-testid="dsr-photos"
      actions={writable ? (
        <span className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => pick('paper_form')} loading={uploadPhoto.isPending && kind === 'paper_form'}>{t('photos.addForm', 'Photo of paper form')}</Button>
          <Button variant="ghost" onClick={() => pick('other')} loading={uploadPhoto.isPending && kind === 'other'}>{t('photos.addOther', 'Other photo')}</Button>
        </span>
      ) : undefined}>
      {writable && <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label={t('photos.file', 'Photo file')}
        data-testid="dsr-photo-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send(f); }} />}
      {failed && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-foreground">
          {failed.message}
          {failed.retryable && <Button variant="outline" size="sm" onClick={() => void send(failed.file)}>{t('photos.retry', 'Retry')}</Button>}
        </p>
      )}
      {photos.length === 0 ? (
        <p className="text-muted-foreground">{t('photos.none', 'No photos yet')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {photos.map((p) => (
            <li key={p.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <button type="button" className="text-left text-primary-text hover:underline" onClick={() => void open(p.file_path)}>
                {p.file_path.split('/').pop()}
              </button>
              <span className="flex items-center gap-2">
                {p.kind === 'paper_form' && <StatusPill variant="neutral">{t('photos.paperForm', 'Paper form')}</StatusPill>}
                <span className="tabular-nums text-muted-foreground">{formatDay(p.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );
};
