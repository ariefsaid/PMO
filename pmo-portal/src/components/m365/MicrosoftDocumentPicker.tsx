import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EntityFormModal, Icon, ListState, TextField, useEntityForm, type SubmitError } from '@/src/components/ui';
import { useMicrosoftDocuments } from '@/src/hooks/useMicrosoftDocuments';
import {
  browseDrives, browseOneDrive, browseSites, getPersonalDrive, listChildren, listDrives, listSites, searchDrive,
  type GraphDrive, type GraphItem, type GraphReadRequest, type GraphSite,
} from '@/src/lib/m365/graphClient';
import { suggestFolders, type PickerContext } from '@/src/lib/m365/folderSuggestions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { M365BrowseNotice } from './M365BrowseNotice';

export type { PickerContext } from '@/src/lib/m365/folderSuggestions';
export interface MicrosoftDocumentPickerProps {
  open: boolean;
  context: PickerContext;
  onClose: () => void;
  onSelect: (ref: MicrosoftReferenceInput) => Promise<void>;
}

type Location =
  | { kind: 'chooser' }
  | { kind: 'sites' }
  | { kind: 'onedrive' }
  | { kind: 'libraries'; site: GraphSite }
  | { kind: 'suggestions' }
  | { kind: 'items'; drive: GraphDrive; path: GraphItem[]; origin: 'default' | 'manual' };

interface Listing { key: string; items: GraphItem[]; next: GraphReadRequest | null; unsupported: number; error: unknown }

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;
/** Codes that mean "the connection is the problem", not "this default library is unreachable". */
const NOT_A_LIBRARY_PROBLEM = new Set([
  'CONNECTION_STALE', 'CONNECTION_REVOKED', 'NOT_CONNECTED', 'SCOPE_INSUFFICIENT', 'UNAUTHORIZED', 'NOT_ENTITLED',
  'ORG_APPROVAL_REQUIRED', 'DISABLED_MEMBER', 'BANNED_MEMBER', 'FORBIDDEN', 'external-unreachable',
]);
/** `overflow-wrap:anywhere` (not `break-words`) so a long unbroken name also shrinks its flex row instead of overflowing it. */
const WRAP = '[overflow-wrap:anywhere]';
const ROW_BUTTON = `touch-target h-auto min-h-8 min-w-0 justify-start whitespace-normal! ${WRAP} py-1 text-left`;

const codeOf = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;
const itemKey = (item: GraphItem) => `${item.drive_id}\u0000${item.item_id}`;

/** Only the reference fields leave the picker: never the Graph content tag, parent path or SharePoint ids. */
function toReference(item: GraphItem): MicrosoftReferenceInput {
  return { drive_id: item.drive_id, item_id: item.item_id, web_url: item.web_url, name: item.name, item_kind: item.item_kind };
}

/** `/drive/root:/Procurement/2027` or `/drives/<id>/root:/Projects` -> `Procurement / 2027`. */
function conventionPath(parentPath: string | null): string {
  const rest = (parentPath ?? '').replace(/^\/drives?\/(?:[^/]+\/)?root:/, '');
  return rest.split('/').filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } }).join(' / ');
}

function contextLabel(context: PickerContext): string | null {
  if (context.kind === 'project') return context.code?.trim() || null;
  if (context.kind === 'procurement') return context.request_number?.trim() || null;
  return null;
}

function connectionNoticeCode(connection: { connected: boolean; status: string | null } | undefined): string {
  if (!connection || !connection.connected) return 'NOT_CONNECTED';
  return connection.status === 'revoked' ? 'CONNECTION_REVOKED' : 'CONNECTION_STALE';
}

/**
 * Shared Microsoft 365 metadata picker (AC-M365DOC-054/056/057/067). Browses sites, libraries and
 * OneDrive through the CALLER's own connection, GET-only, and commits a reference only on the final
 * explicit "Link from Microsoft 365". Mounted only while open so every open starts fresh: nothing is
 * remembered between opens, and unmounting invalidates any response still in flight.
 */
export function MicrosoftDocumentPicker(props: MicrosoftDocumentPickerProps) {
  if (!props.open) return null;
  return <PickerSession {...props} />;
}

function PickerSession({ context, onClose, onSelect }: MicrosoftDocumentPickerProps) {
  const { t } = useTranslation();
  const kindLabel = (kind: GraphItem['item_kind']) => (kind === 'folder' ? t('m365Documents:picker.kindFolder', 'folder') : t('m365Documents:picker.kindFile', 'file'));
  const { connection, defaultLibrary, isPending, connectionError, defaultError, refetch } = useMicrosoftDocuments();
  const canBrowse = connection?.connected === true && connection.status === 'active';
  const form = useEntityForm<{ selected: string }>({ initialValues: { selected: '' }, requiredFields: ['selected'] });
  const setSelectedValue = form.setValue;

  const [location, setLocation] = useState<Location>({ kind: 'chooser' });
  const [selected, setSelected] = useState<GraphItem | null>(null);
  const [sites, setSites] = useState<{ status: 'loading' | 'ready' | 'error'; value: GraphSite[]; next: GraphReadRequest | null; error: unknown }>({ status: 'loading', value: [], next: null, error: null });
  const [libraries, setLibraries] = useState<{ status: 'loading' | 'ready' | 'error'; value: GraphDrive[]; next: GraphReadRequest | null; error: unknown }>({ status: 'loading', value: [], next: null, error: null });
  const [locationMoreBusy, setLocationMoreBusy] = useState(false);
  const [oneDrive, setOneDrive] = useState<{ status: 'loading' | 'error'; error: unknown }>({ status: 'loading', error: null });
  const [search, setSearch] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [nonce, setNonce] = useState(0);
  const [moreBusyKey, setMoreBusyKey] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<{ key: string; error: unknown } | null>(null);
  const [suggestions, setSuggestions] = useState<GraphItem[]>([]);
  const [suggestionHint, setSuggestionHint] = useState(false);
  const [startDone, setStartDone] = useState(false);
  const [defaultUnavailable, setDefaultUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const generation = useRef(0);
  const navGeneration = useRef(0);
  const startGeneration = useRef(0);
  const startClaimed = useRef(false);
  const focusAfterNavigation = useRef(false);
  const focusFromIndex = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const locationCursors = useRef(new Set<string>());

  const drive = location.kind === 'items' ? location.drive : null;
  const path = location.kind === 'items' ? location.path : null;
  const origin = location.kind === 'items' ? location.origin : null;
  const folder = path?.at(-1) ?? null;
  const term = search.trim().length >= MIN_SEARCH_LENGTH ? search.trim() : '';
  const wantKey = drive ? [drive.id, folder?.item_id ?? '', term, nonce].join('\u0000') : null;
  const loading = wantKey !== null && listing?.key !== wantKey;
  const current = !loading && listing ? listing : null;
  const moreBusy = !!current && moreBusyKey === current.key;
  const moreFailure = current && moreError?.key === current.key ? moreError.error : null;

  // Nothing in flight may touch state once the picker is gone.
  // The start claim is released too: under StrictMode (and any remount) the effect runs again after this
  // cleanup, and a claim left behind would strand the picker on "Loading…" with its start already invalidated.
  useEffect(() => () => {
    generation.current += 1; navGeneration.current += 1; startGeneration.current += 1; startClaimed.current = false;
  }, []);

  // One effect owns the location listing AND the debounced search, so a request is only ever started
  // for the location the user is looking at, and every earlier request is invalidated by a new generation.
  useEffect(() => {
    if (!drive || !wantKey) return;
    const seq = ++generation.current;
    const run = async () => {
      try {
        const result = term ? await searchDrive(drive.id, term) : await listChildren(drive.id, folder?.item_id);
        if (seq !== generation.current) return;
        setListing({ key: wantKey, items: result.value, next: result.next, unsupported: result.unsupported_count ?? 0, error: null });
      } catch (error) {
        if (seq !== generation.current) return;
        const code = codeOf(error);
        if (origin === 'default' && !folder && !term && !(code && NOT_A_LIBRARY_PROBLEM.has(code))) {
          setDefaultUnavailable(true);
          setLocation({ kind: 'chooser' });
          return;
        }
        setListing({ key: wantKey, items: [], next: null, unsupported: 0, error });
      }
    };
    let timer: number | undefined;
    if (term) timer = window.setTimeout(() => void run(), SEARCH_DEBOUNCE_MS);
    else void run();
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [drive, folder, origin, term, wantKey]);

  // Open at the org default: contextual suggestions first (never for budgets), else its root.
  useEffect(() => {
    if (startClaimed.current || isPending || !canBrowse || !defaultLibrary) return;
    startClaimed.current = true;
    const seq = ++startGeneration.current;
    const root: GraphDrive = { id: defaultLibrary.drive_id, name: defaultLibrary.drive_name, web_url: '' };
    void (async () => {
      let found: GraphItem[] = [];
      if (context.kind !== 'budget') {
        try { found = await suggestFolders(defaultLibrary, context); } catch { found = []; }
      }
      if (seq !== startGeneration.current) return;
      if (found.length) {
        setSuggestions(found);
        setLocation({ kind: 'suggestions' });
      } else {
        setSuggestionHint(context.kind !== 'budget' && !!contextLabel(context));
        setLocation({ kind: 'items', drive: root, path: [], origin: 'default' });
      }
      setStartDone(true);
    })();
  }, [isPending, canBrowse, defaultLibrary, context]);

  const locationKey = location.kind === 'items' ? `items:${location.drive.id}:${location.path.map((p) => p.item_id).join('/')}`
    : location.kind === 'libraries' ? `libraries:${location.site.id}` : location.kind;
  useEffect(() => {
    if (!focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    headingRef.current?.focus();
  }, [locationKey]);

  useEffect(() => {
    const index = focusFromIndex.current;
    if (index === null || !current || index >= current.items.length) return;
    focusFromIndex.current = null;
    listRef.current?.querySelectorAll('li')[index]?.querySelector('button')?.focus();
  }, [current]);
  useEffect(() => { if (moreFailure) loadMoreRef.current?.focus(); }, [moreFailure]);

  /** A manual choice beats, and cancels, an in-progress default start. */
  const navigate = useCallback((next: Location) => {
    startClaimed.current = true;
    startGeneration.current += 1;
    navGeneration.current += 1;
    setLocationMoreBusy(false);
    focusAfterNavigation.current = true;
    setStartDone(true);
    setSearch('');
    // Item locations are keyed (drive/folder/term) and refetch themselves; clearing here would strand a same-key re-entry.
    if (next.kind !== 'items') setListing(null);
    setLocation(next);
  }, []);

  function select(item: GraphItem) {
    setSelected(item);
    setSelectedValue('selected', item.item_id);
  }

  function openItems(target: GraphDrive, nextPath: GraphItem[], nextOrigin: 'default' | 'manual' = 'manual') {
    navigate({ kind: 'items', drive: target, path: nextPath, origin: nextOrigin });
  }

  async function showSites() {
    navigate({ kind: 'sites' });
    const seq = navGeneration.current;
    locationCursors.current.clear();
    setSites({ status: 'loading', value: [], next: null, error: null });
    try {
      const result = await listSites();
      if (seq === navGeneration.current) setSites({ status: 'ready', value: result.value, next: result.next, error: null });
    } catch (error) {
      if (seq === navGeneration.current) setSites({ status: 'error', value: [], next: null, error });
    }
  }

  async function showLibraries(site: GraphSite) {
    navigate({ kind: 'libraries', site });
    const seq = navGeneration.current;
    locationCursors.current.clear();
    setLibraries({ status: 'loading', value: [], next: null, error: null });
    try {
      const result = await listDrives(site.id);
      if (seq === navGeneration.current) setLibraries({ status: 'ready', value: result.value, next: result.next, error: null });
    } catch (error) {
      if (seq === navGeneration.current) setLibraries({ status: 'error', value: [], next: null, error });
    }
  }

  async function loadLocationMore() {
    if (locationMoreBusy) return;
    const seq = navGeneration.current;
    setLocationMoreBusy(true);
    try {
      if (location.kind === 'sites' && sites.next) {
        const cursor = JSON.stringify(sites.next);
        if (locationCursors.current.has(cursor) || locationCursors.current.size >= 100) {
          setSites((state) => ({ ...state, next: null }));
          return;
        }
        const result = await browseSites(undefined, sites.next);
        if (seq !== navGeneration.current) return;
        locationCursors.current.add(cursor);
        const existing = new Set(sites.value.map((entry) => entry.id));
        const additions = result.value.filter((entry) => !existing.has(entry.id) && !!existing.add(entry.id));
        setSites({ status: 'ready', value: [...sites.value, ...additions], next: JSON.stringify(result.next) === cursor ? null : result.next, error: null });
      } else if (location.kind === 'libraries' && libraries.next) {
        const cursor = JSON.stringify(libraries.next);
        if (locationCursors.current.has(cursor) || locationCursors.current.size >= 100) {
          setLibraries((state) => ({ ...state, next: null }));
          return;
        }
        const result = await browseDrives(location.site.id, libraries.next);
        if (seq !== navGeneration.current) return;
        locationCursors.current.add(cursor);
        const existing = new Set(libraries.value.map((entry) => entry.id));
        const additions = result.value.filter((entry) => !existing.has(entry.id) && !!existing.add(entry.id));
        setLibraries({ status: 'ready', value: [...libraries.value, ...additions], next: JSON.stringify(result.next) === cursor ? null : result.next, error: null });
      }
    } catch (error) {
      if (seq === navGeneration.current) {
        if (location.kind === 'sites') setSites((state) => ({ ...state, error }));
        if (location.kind === 'libraries') setLibraries((state) => ({ ...state, error }));
      }
    } finally { if (seq === navGeneration.current) setLocationMoreBusy(false); }
  }

  async function showOneDrive() {
    navigate({ kind: 'onedrive' });
    const seq = navGeneration.current;
    setOneDrive({ status: 'loading', error: null });
    try {
      const personal = await getPersonalDrive();
      if (seq !== navGeneration.current) return;
      focusAfterNavigation.current = true;
      setLocation({ kind: 'items', drive: personal, path: [], origin: 'manual' });
    } catch (error) {
      if (seq === navGeneration.current) setOneDrive({ status: 'error', error });
    }
  }

  async function loadMore() {
    if (!current?.next || moreBusy) return;
    const { key, next, items } = current;
    const seq = generation.current;
    setMoreBusyKey(key); setMoreError(null);
    try {
      const result = await browseOneDrive(next);
      if (seq !== generation.current) return;
      const known = new Set(items.map(itemKey));
      focusFromIndex.current = items.length;
      setListing((old) => old && old.key === key
        ? { ...old, items: [...old.items, ...result.value.filter((item) => !known.has(itemKey(item)))], next: result.next, unsupported: old.unsupported + (result.unsupported_count ?? 0) }
        : old);
    } catch (error) {
      if (seq === generation.current) setMoreError({ key, error });
    } finally {
      setMoreBusyKey((busy) => (busy === key ? null : busy));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true); setSubmitError(null);
    try {
      await onSelect(toReference(selected));
      onClose();
    } catch (error) {
      const code = codeOf(error);
      const classified = classifyMutationError(error, undefined, { module: 'unknown', operation: 'create' });
      setSubmitError({
        headline: t('m365Documents:picker.linkFailed', 'Could not link this Microsoft item.'),
        // Only database-authored families have vetted product copy; anything else stays generic.
        detail: code === '23514' || code === '42501' ? classified.detail : t('m365Documents:picker.retained', 'Your selection is retained. Try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const starting = canBrowse && !!defaultLibrary && !startDone && !isPending;
  const defaultDrive: GraphDrive | null = defaultLibrary ? { id: defaultLibrary.drive_id, name: defaultLibrary.drive_name, web_url: '' } : null;
  const label = contextLabel(context);
  const heading = (text: string) => (
    <h3 ref={headingRef} tabIndex={-1} className={`min-w-0 flex-1 ${WRAP} text-[13px] font-semibold text-foreground`}>{text}</h3>
  );
  const changeLocation = (
    <Button variant="ghost" className="touch-target shrink-0" onClick={() => navigate({ kind: 'chooser' })}>{t('m365Documents:picker.changeLocation', 'Change location')}</Button>
  );
  const itemProblem = moreFailure ?? current?.error ?? null;

  return (
    <EntityFormModal
      open
      title={t('m365Documents:picker.title', 'Choose a Microsoft document')}
      submitLabel={t('m365Documents:picker.submit', 'Link from Microsoft 365')}
      disabledReason={t('m365Documents:picker.disabledReason', 'Select a file or folder to link.')}
      onSubmit={(e) => void submit(e)}
      onClose={onClose}
      submitDisabled={!form.isComplete || !selected}
      loading={saving}
      submitError={submitError}
      width="lg"
    >
      <div className="min-w-0 space-y-3">
        {isPending && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loadingConnection', 'Loading Microsoft connection…')}</p>}
        {!isPending && connectionError != null && <M365BrowseNotice connection={connection} code={codeOf(connectionError)} onRetry={() => void refetch()} />}
        {!isPending && connectionError == null && !canBrowse && <M365BrowseNotice connection={connection} code={connectionNoticeCode(connection)} />}
        {defaultError != null && (
          <ListState variant="error" title={t('m365Documents:picker.defaultReadError', 'Default library settings could not be read')} sub={t('m365Documents:picker.defaultReadErrorSub', 'You can still choose a location manually.')} onRetry={() => void refetch()} />
        )}
        {defaultLibrary && (location.kind === 'suggestions' || origin === 'default') && (
          <p className={`min-w-0 ${WRAP} text-[13px] text-muted-foreground`}>
            {t('m365Documents:picker.defaultLibrary', 'Default library: {{site}} / {{library}}', { site: defaultLibrary.site_name, library: defaultLibrary.drive_name })}
          </p>
        )}
        {defaultUnavailable && (
          <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.defaultUnavailable', 'Default library is unavailable; choose another accessible location. An Admin can change the default.')}</p>
        )}
        {starting && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loading', 'Loading…')}</p>}

        {!starting && location.kind === 'chooser' && (
          <section className="space-y-2">
            {heading(t('m365Documents:picker.chooseLocation', 'Choose a location'))}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="touch-target" disabled={!canBrowse} onClick={() => void showSites()}><Icon name="folder" />{t('m365Documents:picker.sites', 'SharePoint sites')}</Button>
              <Button variant="ghost" className="touch-target" disabled={!canBrowse} onClick={() => void showOneDrive()}><Icon name="folder" />{t('m365Documents:picker.oneDrive', 'My OneDrive')}</Button>
              {defaultDrive && !defaultUnavailable && (
                <Button variant="outline" className="touch-target" disabled={!canBrowse} onClick={() => openItems(defaultDrive, [], 'default')}>{t('m365Documents:picker.browseDefault', 'Browse default library')}</Button>
              )}
            </div>
          </section>
        )}

        {location.kind === 'sites' && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">{heading(t('m365Documents:picker.sites', 'SharePoint sites'))}{changeLocation}</div>
            {sites.status === 'loading' && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loading', 'Loading…')}</p>}
            {sites.status === 'error' && <M365BrowseNotice connection={connection} code={codeOf(sites.error)} onRetry={() => void showSites()} />}
            {sites.status === 'ready' && sites.error != null && <M365BrowseNotice connection={connection} code={codeOf(sites.error)} onRetry={() => void loadLocationMore()} />}
            {sites.status === 'ready' && !sites.value.length && <ListState variant="empty" title={t('m365Documents:picker.noSites', 'No sites found')} sub={t('m365Documents:picker.chooseAnother', 'Choose another location.')} className="py-6" />}
            {sites.status === 'ready' && sites.value.length > 0 && (
              <ul aria-label={t('m365Documents:picker.sites', 'SharePoint sites')} className="max-h-72 overflow-auto">
                {sites.value.map((site) => (
                  <li key={site.id} className="border-b border-border last:border-b-0">
                    <Button variant="ghost" className={`${ROW_BUTTON} w-full`} onClick={() => void showLibraries(site)}><Icon name="folder" />{site.name}</Button>
                  </li>
                ))}
              </ul>
            )}
            {sites.next && <Button variant="outline" className="touch-target" disabled={locationMoreBusy} onClick={() => void loadLocationMore()}>{t('m365Documents:picker.loadMore', 'Load more')}</Button>}
          </section>
        )}

        {location.kind === 'onedrive' && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">{heading(t('m365Documents:picker.oneDrive', 'My OneDrive'))}{changeLocation}</div>
            {oneDrive.status === 'loading' && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loading', 'Loading…')}</p>}
            {oneDrive.status === 'error' && <M365BrowseNotice connection={connection} code={codeOf(oneDrive.error)} onRetry={() => void showOneDrive()} />}
          </section>
        )}

        {location.kind === 'libraries' && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">{heading(t('m365Documents:picker.librariesIn', 'Libraries in {{site}}', { site: location.site.name }))}{changeLocation}</div>
            {libraries.status === 'loading' && <p role="status" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loading', 'Loading…')}</p>}
            {libraries.status === 'error' && <M365BrowseNotice connection={connection} code={codeOf(libraries.error)} onRetry={() => void showLibraries(location.site)} />}
            {libraries.status === 'ready' && libraries.error != null && <M365BrowseNotice connection={connection} code={codeOf(libraries.error)} onRetry={() => void loadLocationMore()} />}
            {libraries.status === 'ready' && !libraries.value.length && <ListState variant="empty" title={t('m365Documents:picker.noLibraries', 'No libraries found')} sub={t('m365Documents:picker.chooseAnother', 'Choose another location.')} className="py-6" />}
            {libraries.status === 'ready' && libraries.value.length > 0 && (
              <ul aria-label={t('m365Documents:picker.libraries', 'Libraries')} className="max-h-72 overflow-auto">
                {libraries.value.map((lib) => (
                  <li key={lib.id} className="border-b border-border last:border-b-0">
                    <Button variant="ghost" className={`${ROW_BUTTON} w-full`} onClick={() => openItems(lib, [])}><Icon name="folder" />{lib.name}</Button>
                  </li>
                ))}
              </ul>
            )}
            {libraries.next && <Button variant="outline" className="touch-target" disabled={locationMoreBusy} onClick={() => void loadLocationMore()}>{t('m365Documents:picker.loadMore', 'Load more')}</Button>}
          </section>
        )}

        {location.kind === 'suggestions' && defaultDrive && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">{heading(label ? t('m365Documents:picker.suggestedFor', 'Suggested folders for {{label}}', { label }) : t('m365Documents:picker.suggested', 'Suggested folders'))}{changeLocation}</div>
            <ul aria-label={t('m365Documents:picker.suggested', 'Suggested folders')} className="max-h-72 overflow-auto">
              {suggestions.map((folderItem) => (
                <li key={itemKey(folderItem)} className={`flex min-w-0 flex-col gap-1.5 border-b border-border px-2 py-1.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-2 ${selected && itemKey(selected) === itemKey(folderItem) ? 'bg-secondary' : ''}`}>
                  <span className={`min-w-0 flex-1 ${WRAP} text-[13.5px] text-foreground`} title={folderItem.name}>
                    <Icon name="folder" className="mr-1.5 inline" />{folderItem.name}
                    <span className="block text-[12px] text-muted-foreground">{conventionPath(folderItem.parent_path)}</span>
                  </span>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button variant="ghost" className="touch-target" aria-label={t('m365Documents:picker.browseNamed', 'Browse {{name}}', { name: folderItem.name })}
                      onClick={() => openItems({ id: folderItem.drive_id, name: defaultDrive.name, web_url: '' }, [folderItem])}>{t('m365Documents:picker.browse', 'Browse')}</Button>
                    <Button variant="outline" className="touch-target" aria-label={t('m365Documents:picker.linkFolderNamed', 'Link this folder {{name}}', { name: folderItem.name })}
                      aria-pressed={!!selected && itemKey(selected) === itemKey(folderItem)} onClick={() => select(folderItem)}>{t('m365Documents:picker.linkFolder', 'Link this folder')}</Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="ghost" className="touch-target" onClick={() => openItems(defaultDrive, [], 'default')}>{t('m365Documents:picker.browseRoot', 'Browse the library root instead')}</Button>
          </section>
        )}

        {drive && path && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">{heading(t('m365Documents:picker.chooseItem', 'Choose a file or folder'))}{changeLocation}</div>
            <nav aria-label={t('m365Documents:picker.locationNav', 'Microsoft location')}>
              <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
                <li className="flex items-center gap-1">
                  <Button variant="ghost" className={ROW_BUTTON} title={drive.name} onClick={() => openItems(drive, [], origin ?? 'manual')}>{drive.name}</Button>
                </li>
                {path.map((part, index) => (
                  <li key={part.item_id} className="flex items-center gap-1">
                    <Icon name="chev" className="text-muted-foreground" />
                    <Button variant="ghost" className={ROW_BUTTON} title={part.name} onClick={() => openItems(drive, path.slice(0, index + 1))}>{part.name}</Button>
                  </li>
                ))}
              </ol>
            </nav>
            <TextField
              label={t('m365Documents:picker.search', 'Search this location')}
              value={search}
              onChange={setSearch}
              helper={t('m365Documents:picker.searchHelper', 'Type at least 2 characters. Results update after you stop typing.')}
              fullWidth
            />
            {suggestionHint && !path.length && !term && label && (
              <p className="text-[12.5px] text-muted-foreground">{t('m365Documents:picker.noSuggestion', 'No folder suggestion for {{label}}. Browse this library or choose another location.', { label })}</p>
            )}
            {loading && <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loading', 'Loading…')}</p>}
            {current && itemProblem != null && (
              <M365BrowseNotice connection={connection} code={codeOf(itemProblem)} onRetry={moreFailure ? () => void loadMore() : () => setNonce((n) => n + 1)} />
            )}
            {current && !current.error && current.items.length === 0 && (
              <ListState variant="empty" title={t('m365Documents:picker.noItems', 'No items found')} sub={t('m365Documents:picker.noItemsSub', 'Choose another location or search.')} className="py-6" />
            )}
            {current && current.items.length > 0 && (
              <ul ref={listRef} aria-label={t('m365Documents:picker.itemsAria', 'Items in this location')} className="max-h-72 overflow-auto rounded-md border border-border">
                {current.items.map((item) => {
                  const isSelected = !!selected && itemKey(selected) === itemKey(item);
                  return (
                    <li key={itemKey(item)} className={`flex min-w-0 items-start gap-2 border-b border-border px-2 py-1 last:border-b-0 ${isSelected ? 'bg-secondary' : ''}`}>
                      <div className="min-w-0 flex-1">
                        {item.item_kind === 'folder' ? (
                          <Button variant="ghost" className={ROW_BUTTON} title={item.name} aria-label={t('m365Documents:picker.browseNamed', 'Browse {{name}}', { name: item.name })} onClick={() => openItems(drive, [...path, item])}>
                            <Icon name="folder" className="shrink-0" />{item.name}
                          </Button>
                        ) : (
                          <span title={item.name} className={`flex min-w-0 items-start gap-1.5 ${WRAP} px-3 py-1 text-[13.5px] text-foreground`}><Icon name="doc" className="mt-0.5 shrink-0" />{item.name}</span>
                        )}
                        {isSelected && <span className="ml-3 inline-flex items-center gap-1 text-[12px] font-semibold text-foreground"><Icon name="check" />{t('m365Documents:picker.selected', 'Selected')}</span>}
                      </div>
                      <Button variant="outline" className="touch-target shrink-0" aria-pressed={isSelected} aria-label={t('m365Documents:picker.selectNamed', 'Select {{kind}} {{name}}', { kind: kindLabel(item.item_kind), name: item.name })} onClick={() => select(item)}>{t('m365Documents:picker.select', 'Select')}</Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {current && current.unsupported > 0 && (
              <p className="text-[12.5px] text-muted-foreground">{t('m365Documents.picker.unsupported', { count: current.unsupported, defaultValue_one: "{{count}} item can't be linked (not a file or folder).", defaultValue_other: "{{count}} items can't be linked (not a file or folder)." })}</p>
            )}
            {moreBusy && <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground">{t('m365Documents:picker.loading', 'Loading…')}</p>}
            {current?.next && (
              <Button ref={loadMoreRef} variant="outline" className="touch-target" disabled={moreBusy} onClick={() => void loadMore()}>{t('m365Documents:picker.loadMore', 'Load more')}</Button>
            )}
          </section>
        )}

        <p aria-live="polite" className={`min-w-0 ${WRAP} text-[13px] text-foreground`}>
          {selected ? t('m365Documents:picker.selectedSummary', 'Selected {{kind}}: {{name}}', { kind: kindLabel(selected.item_kind), name: selected.name }) : ''}
        </p>
      </div>
    </EntityFormModal>
  );
}
