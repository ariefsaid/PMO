import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, useToast } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { IncidentFileRow, IncidentRow } from '@/src/lib/db/incidents';
import { useIncidentEvidenceMutations } from '@/src/hooks/useIncidents';

/**
 * The photos and documents on one issue (#2521, FR-SIL-010): the raise photos and the close proof, each opened through a
 * short-lived signed link. Whoever may add evidence (reporter, assignee, manager — the database decides) gets an
 * "Add photo" button that opens the phone camera. Up to 10 raise files and 5 close files, 15 MB each.
 */
export const IncidentEvidence: React.FC<{
  incident: Pick<IncidentRow, 'id' | 'org_id'>;
  files: IncidentFileRow[];
  canAdd: boolean;
}> = ({ incident, files, canAdd }) => {
  const { t } = useTranslation('incidents');
  const { toast } = useToast();
  const { upload } = useIncidentEvidenceMutations();
  const input = useRef<HTMLInputElement>(null);
  const remainingRaiseSlots = Math.max(0, 10 - files.filter((f) => f.kind === 'at_raise').length);

  const open = async (file: IncidentFileRow) => {
    try {
      const url = await repositories.incident.fileUrl(file.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const add = async (picked: File[]) => {
    for (const file of picked) {
      try {
        await upload.mutateAsync({ incident, kind: 'at_raise', file });
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
        return;
      }
    }
  };

  return (
    <div data-testid="incident-evidence">
      {files.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('evidence.none', 'No photos yet.')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-control">
              <button type="button" className="truncate text-left text-primary underline-offset-2 hover:underline" onClick={() => void open(f)}>
                {f.title ?? f.file_path.split('/').pop()}
              </button>
              <span className="shrink-0 text-muted-foreground">
                {f.kind === 'at_close' ? t('evidence.atClose', 'Close proof') : t('evidence.atRaise', 'At raise')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canAdd && remainingRaiseSlots > 0 && (
        <div className="mt-3">
          <FileInput
            ref={input}
            accept="image/*"
            capture="environment"
            multiple
            hidden
            data-testid="incident-evidence-input"
            aria-label={t('form.addPhoto', 'Add photo')}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              void add(picked.slice(0, remainingRaiseSlots));
            }}
          />
          <Button type="button" variant="outline" size="sm" loading={upload.isPending} onClick={() => input.current?.click()}>
            <Icon name="plus" />
            {t('form.addPhoto', 'Add photo')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default IncidentEvidence;
