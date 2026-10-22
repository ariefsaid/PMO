import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import { procurementDocumentsKey } from '@/src/hooks/recordFolderState';
import { useAuth } from '@/src/auth/useAuth';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { repositories } from '@/src/lib/repositories';
import type { RecordFolderBackfillPage, RecordFolderCursor } from '@/src/lib/m365/recordFolders';
import { recordFolderErrorCopy, recordFolderText, type RecordFolderCopyKey } from '@/src/lib/m365/recordFolderCopy';

export interface LinkExistingRecordFoldersProps {
  /** The org default library is chosen (the sweep matches folders inside it). */
  defaultAvailable: boolean;
  /** Set by the host while the default library is being changed or cleared. */
  disabled?: boolean;
}

interface Counts { scanned: number; linked: number; needsChoice: number; missing: number; failed: number; skipped: number }
const ZERO: Counts = { scanned: 0, linked: 0, needsChoice: 0, missing: 0, failed: 0, skipped: 0 };

type Phase =
  | { name: 'idle' }
  | { name: 'running' }
  | { name: 'stopping' }
  | { name: 'done' }
  /** Stopped by the user; Continue resumes from `cursor`. */
  | { name: 'stopped'; cursor: RecordFolderCursor | null }
  /** A page failed, or the server stopped early. Counts so far are kept; Continue is explicit. */
  | { name: 'interrupted'; cursor: RecordFolderCursor | null; error: RecordFolderCopyKey | null };

const addPage = (c: Counts, p: RecordFolderBackfillPage): Counts => ({
  scanned: c.scanned + p.scanned,
  linked: c.linked + p.linked,
  needsChoice: c.needsChoice + p.needs_choice,
  missing: c.missing + p.missing,
  failed: c.failed + p.failed,
  skipped: c.skipped + p.skipped,
});

/**
 * Admin "Link existing folders" (AC-M365DOC-072): a finite, foreground, match-only sweep that
 * attaches folders which already exist in the default library to records that have none. It never
 * creates a folder, never changes the default library, never auto-runs, never retries by itself and
 * stops scheduling the moment it is stopped, the host disables it, the identity changes or it unmounts.
 */
export function LinkExistingRecordFolders({ defaultAvailable, disabled = false }: LinkExistingRecordFoldersProps) {
  const { t } = useTranslation('recordFolders');
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const permissions = useDocumentLinkPermissions();
  const allowed = permissions.manageDefault();

  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [counts, setCounts] = useState<Counts>(ZERO);

  // Generation token: bumping it orphans any in-flight run (its late response is ignored and it
  // schedules nothing further). `stopRef` is the softer user Stop: the running page still settles.
  const generation = useRef(0);
  const stopRequested = useRef(false);
  const running = useRef(false);
  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;

  const cancelAll = useCallback(() => {
    generation.current += 1;
    stopRequested.current = false;
    running.current = false;
  }, []);

  // Unmount, identity change, host disable or default removal all orphan the run and clear the view:
  // counts for another account or library must never be presented (or continued) as current.
  const fingerprint = `${orgId}|${userId}|${defaultAvailable}|${disabled}|${allowed}`;
  useEffect(() => {
    return () => {
      cancelAll();
      setPhase((p) => (p.name === 'idle' ? p : { name: 'idle' }));
      setCounts(ZERO);
    };
  }, [fingerprint, cancelAll]);

  const run = useCallback(async (start: RecordFolderCursor | null, base: Counts) => {
    if (running.current) return; // a double activation is a single run
    running.current = true;
    stopRequested.current = false;
    const mine = ++generation.current;
    setPhase({ name: 'running' });
    let cursor = start;
    let acc = base;
    setCounts(acc);
    // Pages that only fail, and errors the server marks retryable, are paced and capped: two in a row stop the run.
    let fails = 0;
    const pause = (ms: number) => new Promise<void>((res) => { setTimeout(res, ms); });
    const finish = (next: Phase) => { running.current = false; setPhase(next); };
    for (;;) {
      try {
        const page = await repositories.m365RecordFolders.linkExisting(cursor ?? undefined);
        if (generation.current !== mine) return; // orphaned: ignore the response, schedule nothing
        acc = addPage(acc, page);
        setCounts(acc);
        if (page.linked > 0) {
          void qc.invalidateQueries({ queryKey: ['project-documents', orgId] });
          void qc.invalidateQueries({ queryKey: procurementDocumentsKey(orgId) });
        }
        const next = page.next;
        if (next && cursor && next.kind === cursor.kind && next.after === cursor.after) {
          return finish({ name: 'interrupted', cursor, error: 'error.generic' }); // a non-progress cursor would loop
        }
        cursor = next;
        if (page.stopped) return finish({ name: 'interrupted', cursor, error: null });
        if (!cursor) return finish({ name: 'done' });
        const onlyFailed = page.failed > 0 && page.linked + page.needs_choice + page.missing + page.skipped === 0;
        fails = onlyFailed ? fails + 1 : 0;
        if (fails >= 2) return finish({ name: 'interrupted', cursor, error: 'error.generic' });
        if (fails > 0) await pause(1000 * 2 ** (fails - 1));
        if (generation.current !== mine) return;
        if (stopRequested.current) return finish({ name: 'stopped', cursor });
      } catch (error) {
        if (generation.current !== mine) return;
        const hint = (error as { retryAfter?: unknown } | null)?.retryAfter;
        fails += 1;
        if (typeof hint === 'number' && hint > 0 && fails < 2 && !stopRequested.current) {
          await pause(Math.min(hint, 60) * 1000);
          if (generation.current !== mine) return;
          continue;
        }
        return finish({ name: 'interrupted', cursor, error: recordFolderErrorCopy(error).key });
      }
    }
  }, [qc, orgId]);

  if (!allowed) return null;

  const busy = phase.name === 'running' || phase.name === 'stopping';
  const canStart = defaultAvailable && !disabled;
  const resume = phase.name === 'stopped' || phase.name === 'interrupted' ? phase.cursor : null;
  const showSummary = phase.name !== 'idle';

  function stop() {
    stopRequested.current = true;
    setPhase({ name: 'stopping' });
  }

  return (
    <div className="min-w-0 space-y-2" data-testid="link-existing-folders">
      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <Button variant="outline" size="sm" onClick={stop} disabled={phase.name === 'stopping'}>
            {t('backfill.stop', 'Stop')}
          </Button>
        ) : phase.name === 'stopped' || phase.name === 'interrupted' ? (
          <Button variant="outline" size="sm" disabled={!canStart} onClick={() => { void run(resume, counts); }}>
            <Icon name="refresh" />
            {t('backfill.continue', 'Continue')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={!canStart} onClick={() => { void run(null, ZERO); }}>
            <Icon name="folder" />
            {t('backfill.start', 'Link existing folders')}
          </Button>
        )}
      </div>
      {!defaultAvailable && (
        <p className="text-[12.5px] text-muted-foreground">{t('backfill.needsDefault', 'Choose a default document library first.')}</p>
      )}
      <div role="status" className="min-w-0 space-y-1 text-[12.5px] text-muted-foreground">
        {busy && (
          <p>
            {t('backfill.progress', { count: counts.scanned, defaultValue: 'Checked {{count}} so far…' })}{' '}
            {phase.name === 'stopping'
              ? t('backfill.stopping', 'Stopping after the current batch…')
              : t('backfill.uncertain', 'The current batch is still running, so the counts may change.')}
          </p>
        )}
        {phase.name === 'stopped' && <p>{t('backfill.stopped', { count: counts.scanned, defaultValue: 'Stopped. {{count}} checked.' })}</p>}
        {phase.name === 'interrupted' && (
          <p>
            <InterruptedReason error={phase.error} />
            {t('backfill.interrupted', 'Stopped early. Counts so far are kept; continue to check the rest.')}
          </p>
        )}
        {showSummary && !busy && <SweepResult done={phase.name === 'done'} counts={counts} />}
      </div>
    </div>
  );
}

/**
 * Why the sweep stopped early. Reviewed remedies (connection, access) are kept; only the shared
 * catch-all "could not create or link this folder" is replaced, because this sweep never creates folders.
 */
function InterruptedReason({ error }: { error: RecordFolderCopyKey | null }) {
  const { t } = useTranslation();
  const { t: tf } = useTranslation('recordFolders');
  if (!error) return null;
  if (error === 'error.generic') return <>{`${t('m365Documents.backfill.failed', 'Could not finish checking existing folders.')} `}</>;
  return <>{`${recordFolderText(tf, error)} `}</>;
}

/** The sweep's plain-language result: counts, an explicit Done, and where to resolve what is left. */
function SweepResult({ done, counts }: { done: boolean; counts: Counts }) {
  const { t } = useTranslation();
  return (
    <>
      {done && <p className="font-medium text-foreground">{t('m365Documents.backfill.done', 'Done. Every record has been checked.')}</p>}
      <p className="tabular-nums">
        {t('m365Documents.backfill.summary', {
          linked: counts.linked,
          needsChoice: counts.needsChoice,
          missing: counts.missing,
          failed: counts.failed,
          skipped: counts.skipped,
          defaultValue: 'Linked: {{linked}} · Need your choice: {{needsChoice}} · No matching folder or no code: {{missing}} · Failed: {{failed}} · Already linked: {{skipped}}',
        })}
      </p>
      {counts.needsChoice + counts.missing > 0 && (
        <p>{t('m365Documents.backfill.resolve', 'To finish these, open the project or case, then use "Choose existing folder" or "Create folder in SharePoint".')}</p>
      )}
    </>
  );
}
