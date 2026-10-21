import { useEffect, useRef, useState } from 'react';
import { Button, EntityFormModal, ListState } from '@/src/components/ui';
import { getItem, listVersions, type GraphReadRequest, type GraphVersion } from '@/src/lib/m365/graphClient';
import { buildVersionHistoryUrl, type MicrosoftReference, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { formatInstantDate } from '@/src/lib/format';
import { M365BrowseNotice } from './M365BrowseNotice';

const codeOf = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;

/** The five fields Graph reads need; the stored name/URL are never sent as a claim of verification. */
export function toReferenceInput(reference: MicrosoftReference): MicrosoftReferenceInput {
  return { drive_id: reference.drive_id, item_id: reference.item_id, web_url: reference.web_url, name: reference.name, item_kind: reference.item_kind };
}

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
      title={`Versions of ${reference.name}`}
      submitLabel="Done"
      cancelLabel="Close"
      onSubmit={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
      width="sm"
    >
      <div className="min-w-0 space-y-3">
        {state.loading && <p role="status" className="text-[13px] text-muted-foreground">Loading…</p>}
        {!state.loading && state.error != null && (
          <M365BrowseNotice code={codeOf(state.error)} onRetry={state.versions.length ? () => void loadMore() : retry} />
        )}
        {!state.loading && state.error == null && state.versions.length === 0 && (
          <ListState variant="empty" title="No versions listed" sub="Microsoft lists no earlier versions of this file." className="py-6" />
        )}
        {state.versions.length > 0 && (
          <ul aria-label="Versions" className="max-h-72 overflow-auto rounded-md border border-border">
            {state.versions.map((version) => (
              <li key={version.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
                <span className="font-medium text-foreground">{`Version ${version.id}`}</span>
                {version.modified_at && <span className="tabular text-[12px] text-muted-foreground">{formatInstantDate(version.modified_at)}</span>}
                {pinned && pinned.id === version.id && <span className="text-[12px] font-semibold text-foreground">{pinned.label}</span>}
              </li>
            ))}
          </ul>
        )}
        {more && <p role="status" className="text-[13px] text-muted-foreground">Loading…</p>}
        {state.next && !state.loading && <Button variant="outline" className="touch-target" disabled={more} onClick={() => void loadMore()}>Load more</Button>}
      </div>
    </EntityFormModal>
  );
}

const NO_SHAREPOINT_IDS = 'Version history unavailable: Microsoft did not provide SharePoint identifiers.';
const NOT_RECORDED = 'Approved version unavailable: no version was recorded when this file was issued.';
const PRUNED = 'Approved version unavailable: Microsoft no longer lists it, so it may have been pruned. The latest version is still available.';
const NO_VERSIONING = 'Approved version unavailable: Microsoft lists no versions for this file (version history may be turned off). The latest version is still available.';

function readFailureReason(code: string | undefined): string {
  switch (code) {
    case 'NOT_CONNECTED': return 'Approved version history needs a Microsoft 365 connection.';
    case 'CONNECTION_STALE':
    case 'CONNECTION_REVOKED': return 'Approved version history needs you to reconnect Microsoft 365.';
    case 'SCOPE_INSUFFICIENT': return 'Approved version history needs additional Microsoft permissions.';
    default: return 'Microsoft could not load version history. Retry, or open the latest version.';
  }
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'partial'; url: string; next: GraphReadRequest }
  | { kind: 'reason'; text: string };

/**
 * "View approved version history": opens the file's SharePoint version-history PAGE (OQ-M365DOC-002),
 * never the latest content passed off as approved. The page is only offered once Microsoft has
 * supplied usable SharePoint ids AND the pinned version is still listed; every other outcome is a
 * stated reason, and the separate "Open latest" action is never touched.
 */
export function ApprovedVersionHistory({ reference, pinnedVersionId }: { reference: MicrosoftReference; pinnedVersionId: string | null }) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function check(resume?: { url: string; next: GraphReadRequest }) {
    if (!pinnedVersionId) { setOutcome({ kind: 'reason', text: NOT_RECORDED }); return; }
    const seq = ++generation.current;
    setOutcome({ kind: 'checking' });
    try {
      const input = toReferenceInput(reference);
      let url = resume?.url ?? null;
      if (!url) {
        url = buildVersionHistoryUrl(await getItem(input));
        if (seq !== generation.current) return;
        if (!url) { setOutcome({ kind: 'reason', text: NO_SHAREPOINT_IDS }); return; }
      }
      const page = await listVersions(input, resume?.next);
      if (seq !== generation.current) return;
      if (page.value.some((version) => version.id === pinnedVersionId)) {
        window.open(url, '_blank', 'noopener,noreferrer');
        setOutcome({ kind: 'idle' });
      } else if (page.next) {
        setOutcome({ kind: 'partial', url, next: page.next });
      } else {
        setOutcome({ kind: 'reason', text: page.value.length === 0 && !resume ? NO_VERSIONING : PRUNED });
      }
    } catch (error) {
      if (seq === generation.current) setOutcome({ kind: 'reason', text: readFailureReason(codeOf(error)) });
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="min-w-0"
        loading={outcome.kind === 'checking'}
        aria-label={`View approved version history: ${reference.name}`}
        onClick={() => void check()}
      >
        View approved version history
      </Button>
      {outcome.kind === 'partial' && (
        <>
          <p role="status" className="text-[12px] text-muted-foreground">Approved version not found in loaded history.</p>
          <Button variant="outline" size="sm" onClick={() => void check({ url: outcome.url, next: outcome.next })}>Load more history</Button>
        </>
      )}
      {outcome.kind === 'reason' && <p role="alert" className="break-words text-[12px] text-muted-foreground">{outcome.text}</p>}
    </div>
  );
}
