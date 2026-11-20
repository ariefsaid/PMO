/**
 * Proof of completion for one task (#2531, FR-TWOP-011/012/015/016). Lists the attachments, lets the assignee or a
 * manager add a photo (phone camera input) or a document, and owns the one "Mark done" control for a proof-required
 * task: disabled, with the reason, until a proof exists. The database refuses Done without proof regardless
 * (migration 0991), so this is the explanation, not the enforcement.
 */
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { useTaskProofs, useTaskProofMutations } from '@/src/hooks/useTaskProofs';
import { proofRefusal, PROOF_ALLOWED_MIME, PROOF_MAX_COUNT } from '@/src/lib/db/taskProofs';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { TaskStatus } from '@/src/lib/db/tasks';

interface TaskProofPanelProps {
  taskId: string;
  status: TaskStatus;
  proofRequired: boolean;
  /** May the viewer attach / remove proof (assignee or a manager). */
  canAttach: boolean;
  /** May the viewer set this task's status. */
  canSetStatus: boolean;
  onMarkDone: () => Promise<void> | void;
}

export const TaskProofPanel: React.FC<TaskProofPanelProps> = ({
  taskId, status, proofRequired, canAttach, canSetStatus, onMarkDone,
}) => {
  const { t } = useTranslation('tasks');
  const { data: proofs = [], isPending, isError } = useTaskProofs(taskId);
  const { add, remove } = useTaskProofMutations(taskId);
  const [message, setMessage] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const done = status === 'Done';
  const locked = done && proofRequired; // append-only once Done (FR-TWOP-013)

  if (!proofRequired && proofs.length === 0 && !canAttach) return null;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const refusal = proofRefusal(file, proofs.length);
    if (refusal) {
      setMessage(t(`proof.refused.${refusal}`));
      return;
    }
    setMessage(null);
    add.mutate({ file, liveCount: proofs.length }, {
      onError: (err) => setMessage(classifyMutationError(err, undefined, { suppressCapture: true }).detail),
    });
  };

  const missing = proofRequired && !done && proofs.length === 0;

  return (
    <section aria-label={t('proof.title')} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('proof.title')}</h3>
      <p className="text-sm text-muted-foreground">
        {proofRequired
          ? proofs.length > 0 ? t('proof.attached', { count: proofs.length }) : t('proof.missing')
          : t('proof.optional')}
      </p>
      {isPending && <p className="text-sm text-muted-foreground">{t('proof.loading')}</p>}
      {isError && <p role="alert" className="text-sm text-destructive">{t('proof.loadFailed')}</p>}
      <ul className="flex flex-col gap-1">
        {proofs.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <button type="button" className="min-w-0 flex-1 truncate text-left underline" onClick={() => {
              const tab = window.open('', '_blank');
              if (!tab) return;
              tab.opener = null;
              void repositories.taskProof.url(p.file_path).then((url) => { tab.location.href = url; })
                .catch((err: unknown) => { tab.close(); setMessage(classifyMutationError(err, undefined, { suppressCapture: true }).detail); });
            }}>{p.file_name ?? p.file_path.split('/').pop()}</button>
            {canAttach && !locked && (
              <Button type="button" variant="ghost" size="sm" disabled={remove.isPending}
                onClick={() => remove.mutate(p.id, {
                  onError: (err) => setMessage(classifyMutationError(err, undefined, { suppressCapture: true }).detail),
                })}>
                {t('proof.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canAttach && !locked && proofs.length < PROOF_MAX_COUNT && (
        <div className="flex flex-wrap gap-2">
          {/* The camera input: on a phone, accept=image/* + capture opens the camera directly. */}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only"
            aria-label={t('proof.photoInput')} data-testid="proof-photo-input" onChange={onPick} />
          <input ref={docRef} type="file" accept={PROOF_ALLOWED_MIME.join(',')} className="sr-only"
            aria-label={t('proof.documentInput')} data-testid="proof-document-input" onChange={onPick} />
          <Button type="button" size="sm" variant="outline" disabled={add.isPending} onClick={() => photoRef.current?.click()}>
            {t('proof.addPhoto')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={add.isPending} onClick={() => docRef.current?.click()}>
            {t('proof.addDocument')}
          </Button>
        </div>
      )}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {proofRequired && !done && canSetStatus && (
        <div className="flex flex-col gap-1">
          <Button type="button" size="sm" disabled={missing || add.isPending} aria-describedby={missing ? 'proof-why' : undefined}
            onClick={() => void onMarkDone()}>
            {t('proof.markDone')}
          </Button>
          {missing && <p id="proof-why" className="text-sm text-muted-foreground">{t('proof.doneBlocked')}</p>}
        </div>
      )}
    </section>
  );
};
