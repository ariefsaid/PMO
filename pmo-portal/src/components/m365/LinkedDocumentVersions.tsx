import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, EntityFormModal, ListState } from '@/src/components/ui';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { getItem, listVersions, type GraphReadRequest, type GraphVersion } from '@/src/lib/m365/graphClient';
import { buildVersionHistoryUrl, toReferenceInput, type MicrosoftReference } from '@/src/lib/m365/reference';
import { formatInstantDate } from '@/src/lib/format';
import { M365BrowseNotice } from './M365BrowseNotice';

const codeOf = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;

interface VersionsModalProps {
  reference: MicrosoftReference;
  /** The version label recorded at issue, marked in the list when present. */
  pinned?: { id: string; label: string } | null;
  onClose: () => void;
}

/**
 * Read-only version list (metadata only, AC-M365DOC-065). Choosing nothing here links nothing and
 * persists nothing; Done and Close both just dismiss it. Mounted only while open, so it reads on open.
 */
export function LinkedDocumentVersionsModal({ reference, pinned, onClose }: VersionsModalProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ versions: GraphVersion[]; next: GraphReadRequest | null; loading: boolean; error: unknown }>(
    { versions: [], next: null, loading: true, error: null },
  );
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  const { drive_id, item_id, web_url, name, item_kind } = reference;

  useEffect(() => {
    const seq = ++generation.current;
    listVersions({ drive_id, item_id, web_url, name, item_kind })
      .then((page) => { if (seq === generation.current) setState({ versions: page.value, next: page.next, loading: false, error: null }); })
      .catch((error: unknown) => { if (seq === generation.current) setState({ versions: [], next: null, loading: false, error }); });
    return () => { generation.current += 1; };
  }, [drive_id, item_id, web_url, name, item_kind, attempt]);

  function retry() {
    setState({ versions: [], next: null, loading: true, error: null });
    setAttempt((n) => n + 1);
  }

  async function loadMore() {
    if (!state.next || more) return;
    const seq = generation.current;
    setMore(true);
    try {
      const page = await listVersions(toReferenceInput(reference), state.next);
      if (seq === generation.current) setState((old) => ({ ...old, versions: [...old.versions, ...page.value], next: page.next, error: null }));
    } catch (error) {
      if (seq === generation.current) setState((old) => ({ ...old, error }));
    } finally {
      setMore(false);
    }
  }

  return (
    <EntityFormModal
      open
      title={t('m365Documents.versions.title', 'Versions of {{name}}', { name: reference.name })}
      submitLabel={t('m365Documents.versions.done', 'Done')}
      cancelLabel={t('m365Documents.versions.close', 'Close')}
      onSubmit={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
      width="sm"
    >
      <div className="min-w-0 space-y-3">
        {state.loading && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents.versions.loading', 'Loading…')}</p>}
        {!state.loading && state.error != null && (
          <M365BrowseNotice code={codeOf(state.error)} onRetry={state.versions.length ? () => void loadMore() : retry} />
        )}
        {!state.loading && state.error == null && state.versions.length === 0 && (
          <ListState variant="empty" title={t('m365Documents.versions.emptyTitle', 'No versions listed')} sub={t('m365Documents.versions.emptySub', 'Microsoft lists no earlier versions of this file.')} className="py-6" />
        )}
        {state.versions.length > 0 && (
          <ul aria-label={t('m365Documents.versions.list', 'Versions')} className="max-h-72 overflow-auto rounded-md border border-border">
            {state.versions.map((version) => (
              <li key={version.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
                <span className="font-medium text-foreground">{t('m365Documents.versions.version', 'Version {{id}}', { id: version.id })}</span>
                {version.modified_at && <span className="tabular text-[12px] text-muted-foreground">{formatInstantDate(version.modified_at)}</span>}
                {pinned && pinned.id === version.id && <span className="text-[12px] font-semibold text-foreground">{pinned.label}</span>}
              </li>
            ))}
          </ul>
        )}
        {more && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents.versions.loading', 'Loading…')}</p>}
        {state.next && !state.loading && <Button variant="outline" className="touch-target" disabled={more} onClick={() => void loadMore()}>{t('m365Documents.versions.loadMore', 'Load more')}</Button>}
      </div>
    </EntityFormModal>
  );
}

type Reason = 'noSharepointIds' | 'notRecorded' | 'pruned' | 'noVersioning' | 'needsConnection' | 'needsReconnect' | 'needsScope' | 'generic';

function readFailureReason(code: string | undefined): Reason {
  switch (code) {
    case 'NOT_CONNECTED': return 'needsConnection';
    case 'CONNECTION_STALE':
    case 'CONNECTION_REVOKED': return 'needsReconnect';
    case 'SCOPE_INSUFFICIENT': return 'needsScope';
    default: return 'generic';
  }
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ready'; url: string }
  | { kind: 'partial'; url: string; next: GraphReadRequest }
  | { kind: 'reason'; reason: Reason };

/**
 * "View approved version history": opens the file's SharePoint version-history PAGE (OQ-M365DOC-002),
 * never the latest content passed off as approved. The page is only offered once Microsoft has
 * supplied usable SharePoint ids AND the pinned version is still listed; every other outcome is a
 * stated reason, and the separate "Open latest" action is never touched.
 */
export function ApprovedVersionHistory({ reference, pinnedVersionId }: { reference: MicrosoftReference; pinnedVersionId: string | null }) {
  const { t } = useTranslation(['common', 'project']);
  const identity = JSON.stringify([
    reference.drive_id, reference.item_id, reference.web_url, reference.name, reference.item_kind, pinnedVersionId,
  ]);
  const [savedOutcome, setSavedOutcome] = useState<{ identity: string; outcome: Outcome }>({ identity: '', outcome: { kind: 'idle' } });
  const outcome = savedOutcome.identity === identity ? savedOutcome.outcome : { kind: 'idle' as const };
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; };
  }, [identity]);
  const saveOutcome = (next: Outcome) => setSavedOutcome({ identity, outcome: next });

  async function check(resume?: { url: string; next: GraphReadRequest }) {
    if (!pinnedVersionId) { saveOutcome({ kind: 'reason', reason: 'notRecorded' }); return; }
    const seq = ++generation.current;
    saveOutcome({ kind: 'checking' });
    try {
      const input = toReferenceInput(reference);
      let url = resume?.url ?? null;
      if (!url) {
        url = buildVersionHistoryUrl(await getItem(input));
        if (seq !== generation.current) return;
        if (!url) { saveOutcome({ kind: 'reason', reason: 'noSharepointIds' }); return; }
      }
      const page = await listVersions(input, resume?.next);
      if (seq !== generation.current) return;
      if (page.value.some((version) => version.id === pinnedVersionId)) {
        saveOutcome({ kind: 'ready', url });
      } else if (page.next) {
        saveOutcome({ kind: 'partial', url, next: page.next });
      } else {
        saveOutcome({ kind: 'reason', reason: page.value.length === 0 && !resume ? 'noVersioning' : 'pruned' });
      }
    } catch (error) {
      if (seq === generation.current) saveOutcome({ kind: 'reason', reason: readFailureReason(codeOf(error)) });
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="min-w-0"
        loading={outcome.kind === 'checking'}
        aria-label={t('m365Documents.history.viewAria', 'View approved version history: {{name}}', { name: reference.name })}
        onClick={() => void check()}
      >
        {t('m365Documents.history.view', 'View approved version history')}
      </Button>
      {outcome.kind === 'ready' && (
        <a
          href={outcome.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses('outline', 'sm')}
        >
          {t('project:m365Documents.history.openVerified', 'Open verified version history')}
        </a>
      )}
      {outcome.kind === 'partial' && (
        <>
          <p role="status" className="text-[12px] text-muted-foreground">{t('m365Documents.history.partial', 'Approved version not found in loaded history.')}</p>
          <Button variant="outline" size="sm" onClick={() => void check({ url: outcome.url, next: outcome.next })}>{t('m365Documents.history.loadMore', 'Load more history')}</Button>
        </>
      )}
      {outcome.kind === 'reason' && <p role="alert" className="break-words text-[12px] text-muted-foreground">{reasonText(t, outcome.reason)}</p>}
    </div>
  );
}

function reasonText(t: TFunction, reason: Reason): string {
  switch (reason) {
    case 'noSharepointIds': return t('m365Documents.history.noSharepointIds', 'Version history unavailable: Microsoft did not provide SharePoint identifiers.');
    case 'notRecorded': return t('m365Documents.history.notRecorded', 'Approved version unavailable: no version was recorded when this file was issued.');
    case 'pruned': return t('m365Documents.history.pruned', 'Approved version unavailable: Microsoft no longer lists it, so it may have been pruned. The latest version is still available.');
    case 'noVersioning': return t('m365Documents.history.noVersioning', 'Approved version unavailable: Microsoft lists no versions for this file (version history may be turned off). The latest version is still available.');
    case 'needsConnection': return t('m365Documents.history.needsConnection', 'Approved version history needs a Microsoft 365 connection.');
    case 'needsReconnect': return t('m365Documents.history.needsReconnect', 'Approved version history needs you to reconnect Microsoft 365.');
    case 'needsScope': return t('m365Documents.history.needsScope', 'Approved version history needs additional Microsoft permissions.');
    default: return t('m365Documents.history.generic', 'Microsoft could not load version history. Retry, or open the latest version.');
  }
}
