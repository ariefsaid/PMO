import { useEffect, useRef, useState } from 'react';
import { EntityFormModal, TextField, Button, useEntityForm } from '@/src/components/ui';
import { useMicrosoftDocuments } from '@/src/hooks/useMicrosoftDocuments';
import { browseOneDrive, getPersonalDrive, listChildren, listDrives, listSites, searchDrive, type GraphDrive, type GraphItem, type GraphReadRequest, type GraphSite } from '@/src/lib/m365/graphClient';
import { suggestFolders } from '@/src/lib/m365/folderSuggestions';
import { M365BrowseNotice } from './M365BrowseNotice';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';

export type PickerContext = { kind: 'project'; code: string | null } | { kind: 'procurement'; request_number: string | null; created_at: string } | { kind: 'budget' };
interface Props { open: boolean; context: PickerContext; onClose: () => void; onSelect: (ref: MicrosoftReferenceInput) => Promise<void> }
type Location = { kind: 'chooser' } | { kind: 'sites' } | { kind: 'libraries'; site: GraphSite } | { kind: 'items'; drive: GraphDrive; folder: GraphItem | null };
export function MicrosoftDocumentPicker({ open, context, onClose, onSelect }: Props) {
  const { connection, defaultLibrary, isPending, defaultError } = useMicrosoftDocuments();
  const [location, setLocation] = useState<Location>({ kind: 'chooser' });
  const [sites, setSites] = useState<GraphSite[]>([]); const [drives, setDrives] = useState<GraphDrive[]>([]);
  const [items, setItems] = useState<GraphItem[]>([]); const [selected, setSelected] = useState<GraphItem | null>(null); const [pathStack, setPathStack] = useState<GraphItem[]>([]);
  const [next, setNext] = useState<GraphReadRequest | null>(null); const [unsupportedCount, setUnsupportedCount] = useState(0); const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false); const [search, setSearch] = useState(''); const [suggestions, setSuggestions] = useState<GraphItem[]>([]);
  const generation = useRef(0); const defaultStarted = useRef(false); const previousSearch = useRef(''); const form = useEntityForm<{ selected: string }>({ initialValues: { selected: '' }, requiredFields: ['selected'] });
  const resetForm = form.reset;
  const invalidateRequests = () => { generation.current += 1; };
  const [isSubmitting, setIsSubmitting] = useState(false); const [submitError, setSubmitError] = useState<{ headline: string; detail?: string } | null>(null);
  const canBrowse = connection?.connected === true && connection.status === 'active';
  const drive = location.kind === 'items' ? location.drive : null;
  const folder = location.kind === 'items' ? location.folder : null;
  async function load(d: GraphDrive, f: GraphItem | null, append = false, cursor?: GraphReadRequest | null) {
    const seq = generation.current;
    setBusy(true); setProblem(null);
    try { const page = cursor ? await browseOneDrive(cursor) : await listChildren(d.id, f?.item_id); if (seq !== generation.current) return; setItems(old => append ? [...old, ...page.value.filter(x => !old.some(y => y.drive_id === x.drive_id && y.item_id === x.item_id))] : page.value); setNext(page.next); setUnsupportedCount(count => append ? count + (page.unsupported_count ?? 0) : (page.unsupported_count ?? 0)); }
    catch (e) { if (seq === generation.current) setProblem(e); } finally { if (seq === generation.current) setBusy(false); }
  }
  function openItems(d: GraphDrive, f: GraphItem | null = null) { generation.current++; setLocation({ kind: 'items', drive: d, folder: f }); setPathStack(f ? [f] : []); setSelected(null); form.setValue('selected', ''); setSearch(''); void load(d, f); }
  function enterFolder(item: GraphItem) { if (!drive) return; generation.current++; const nextPath = [...pathStack, item]; setPathStack(nextPath); setLocation({ kind: 'items', drive, folder: item }); setSelected(null); form.setValue('selected', ''); setSearch(''); void load(drive, item); }
  function goToBreadcrumb(index: number) { if (!drive) return; const nextPath = pathStack.slice(0, index + 1); const target = nextPath.at(-1) ?? null; setPathStack(nextPath); setLocation({ kind: 'items', drive, folder: target }); setSelected(null); form.setValue('selected', ''); setSearch(''); void load(drive, target); }
  useEffect(() => { if (!open) { defaultStarted.current = false; return; } setLocation({ kind: 'chooser' }); setSelected(null); resetForm({ selected: '' }); setProblem(null); setSuggestions([]); }, [open, resetForm]);
  // chooseDefault is intentionally excluded: the ref guard makes this open-scoped, while its
  // inline identity changes each render. Inputs that can change the operation are listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open || !canBrowse || !defaultLibrary || defaultStarted.current) return; defaultStarted.current = true; void chooseDefault(); }, [open, canBrowse, defaultLibrary]);
  useEffect(() => { if (!open || !drive) return; if (!search.trim()) { if (previousSearch.current) void load(drive, folder); previousSearch.current = ''; return; } previousSearch.current = search; if (search.trim().length < 2) return; const seq = ++generation.current; setBusy(true); setProblem(null); const timer = window.setTimeout(async () => { try { const page = await searchDrive(drive.id, search.trim()); if (seq === generation.current) { setItems(page.value); setNext(page.next); setUnsupportedCount(page.unsupported_count ?? 0); } } catch (e) { if (seq === generation.current) setProblem(e); } finally { if (seq === generation.current) setBusy(false); } }, 300); return () => { window.clearTimeout(timer); invalidateRequests(); }; }, [open, drive, folder, search]);
  async function chooseDefault() { if (!defaultLibrary) return; const d = { id: defaultLibrary.drive_id, name: defaultLibrary.drive_name, web_url: '' }; try { const found = await suggestFolders(defaultLibrary, context); if (found.length) setSuggestions(found); else openItems(d); } catch { openItems(d); } }
  async function chooseSite(site: GraphSite) { setBusy(true); try { const page = await listDrives(site.id); setDrives(page.value); setLocation({ kind: 'libraries', site }); } catch (e) { setProblem(e); } finally { setBusy(false); } }
  async function chooseOneDrive() { setBusy(true); try { const d = await getPersonalDrive(); openItems(d); } catch (e) { setProblem(e); setBusy(false); } }
  async function doSubmit(e: React.FormEvent) { e.preventDefault(); if (!selected || isSubmitting) return; setIsSubmitting(true); setSubmitError(null); try { await onSelect(selected); onClose(); } catch { setSubmitError({ headline: 'Could not link this Microsoft item.', detail: 'Your selection is retained. Try again.' }); } finally { setIsSubmitting(false); } }
  return <EntityFormModal open={open} title="Choose a Microsoft document" submitLabel="Link from Microsoft 365" onSubmit={doSubmit} onClose={onClose} submitDisabled={!form.isComplete || !selected} loading={isSubmitting} submitError={submitError} width="lg">
    <div className="space-y-4 min-w-0">
      {(!connection?.connected || connection.status !== 'active') && <M365BrowseNotice code={connection?.status === 'stale' ? 'CONNECTION_STALE' : 'NOT_CONNECTED'} />}
      {isPending && <p role="status">Loading Microsoft connection…</p>}
      {defaultError && <p role="status">Default library settings could not be read. Choose a location manually.</p>}
      {defaultLibrary && <p className="text-sm text-muted-foreground">Default library: {defaultLibrary.site_name} / {defaultLibrary.drive_name}</p>}
      {location.kind !== 'chooser' && <Button variant="ghost" onClick={() => { setLocation({ kind: 'chooser' }); setSelected(null); }}>Change location</Button>}
      {location.kind === 'chooser' && <div className="flex gap-2"><Button variant="ghost" disabled={!canBrowse || busy} onClick={async () => { setBusy(true); try { const p = await listSites(); setSites(p.value); setLocation({ kind: 'sites' }); } catch (e) { setProblem(e); } finally { setBusy(false); } }}>SharePoint sites</Button><Button variant="ghost" disabled={!canBrowse || busy} onClick={chooseOneDrive}>My OneDrive</Button>{defaultLibrary && <Button variant="outline" disabled={!canBrowse || busy} onClick={chooseDefault}>Browse default library</Button>}</div>}
      {location.kind === 'sites' && <div role="list">{sites.map(site => <Button key={site.id} variant="ghost" onClick={() => void chooseSite(site)}>{site.name}</Button>)}</div>}
      {location.kind === 'libraries' && <div role="list">{drives.map(d => <Button key={d.id} variant="ghost" onClick={() => openItems(d)}>{d.name}</Button>)}</div>}
      {drive && <><nav aria-label="Microsoft location"><ol className="flex gap-2"><li><Button variant="ghost" onClick={() => { setPathStack([]); openItems(drive, null); }}>{drive.name}</Button></li>{pathStack.map((part, index) => <li key={part.item_id}><Button variant="ghost" onClick={() => goToBreadcrumb(index)}>{part.name}</Button></li>)}</ol></nav><TextField label="Search this location" value={search} onChange={value => setSearch(value)} /><div role="list" className="max-h-72 overflow-auto">{items.map(item => <div role="listitem" key={`${item.drive_id}:${item.item_id}`} className={`flex flex-wrap items-center gap-2 border-b border-border p-2 min-w-0 ${selected?.item_id === item.item_id ? 'bg-secondary' : ''}`}><Button variant="ghost" onClick={() => { setSelected(item); form.setValue('selected', item.item_id); }} aria-pressed={selected?.item_id === item.item_id}>{item.name} ({item.item_kind})</Button>{item.item_kind === 'folder' && <Button variant="ghost" aria-label={`Browse ${item.name}`} onClick={() => enterFolder(item)}>Browse {item.name}</Button>}<Button variant="outline" onClick={() => { setSelected(item); form.setValue('selected', item.item_id); }}>Select {item.item_kind} {item.name}</Button></div>)}</div>{unsupportedCount > 0 && <p className="text-sm text-muted-foreground">Some items cannot be selected.</p>}{busy && <p role="status" aria-live="polite">Loading…</p>}{!busy && !items.length && <p>No items found. Choose another location or search.</p>}{next && <Button variant="outline" disabled={busy} onClick={() => void load(drive, folder, true, next)}>Load more</Button>}</>}
      {suggestions.length > 0 && <section><p>Suggested folders</p>{suggestions.map(s => <div key={s.item_id} className="flex flex-wrap items-center gap-2"><span className="min-w-0 text-sm text-muted-foreground">{s.parent_path ?? 'Default library'} / {s.name}</span><Button variant="ghost" onClick={() => openItems({ id: s.drive_id, name: 'Default library', web_url: '' }, s)}>Browse {s.name}</Button><Button variant="outline" onClick={() => { setSelected(s); form.setValue('selected', s.item_id); }}>Link this folder</Button></div>)}</section>}
      {problem !== null && <M365BrowseNotice code={(problem as { code?: string })?.code} onRetry={() => drive && void load(drive, folder)} />}
      {selected && <p aria-live="polite">Selected {selected.item_kind}: {selected.name}</p>}
    </div>
  </EntityFormModal>;
}
