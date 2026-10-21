import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
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
    try {
      for (;;) {
        const page = await repositories.m365RecordFolders.linkExisting(cursor ?? undefined);
        if (generation.current !== mine) return; // orphaned: ignore the response, schedule nothing
        acc = addPage(acc, page);
        setCounts(acc);
        if (page.linked > 0) {
          void qc.invalidateQueries({ queryKey: ['project-documents', orgId] });
          void qc.invalidateQueries({ queryKey: ['procurement-docs', orgId] });
        }
        const next = page.next;
        if (next && cursor && next.kind === cursor.kind && next.after === cursor.after) {
          running.current = false;
          setPhase({ name: 'interrupted', cursor, error: 'error.generic' }); // a non-progress cursor would loop
          return;
        }
        cursor = next;
        if (page.stopped) {
          running.current = false;
          setPhase({ name: 'interrupted', cursor, error: null });
          return;
        }
        if (!cursor) {
          running.current = false;
          setPhase({ name: 'done' });
          return;
        }
        if (stopRequested.current) {
          running.current = false;
          setPhase({ name: 'stopped', cursor });
          return;
        }
      }
    } catch (error) {
      if (generation.current !== mine) return;
      running.current = false;
      setPhase({ name: 'interrupted', cursor, error: recordFolderErrorCopy(error).key });
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
            {phase.error ? `${recordFolderText(t, phase.error)} ` : ''}
            {t('backfill.interrupted', 'Stopped early. Counts so far are kept; continue to check the rest.')}
          </p>
        )}
        {showSummary && !busy && (
          <p className="tabular-nums">
            {t('backfill.summary', {
              linked: counts.linked,
              needsChoice: counts.needsChoice,
              missing: counts.missing,
              failed: counts.failed,
              skipped: counts.skipped,
              defaultValue: 'Linked {{linked}} · Need a choice {{needsChoice}} · No match/code {{missing}} · Failed {{failed}} · Already linked {{skipped}}',
            })}
          </p>
        )}
      </div>
    </div>
  );
}
