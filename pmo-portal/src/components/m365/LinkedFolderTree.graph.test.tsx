// @vitest-environment jsdom
/**
 * #2806 / #1124 — the linked-folder tree replayed against Microsoft Graph /children answers shaped as
 * Microsoft documents them, through the SHIPPED path end to end: LinkedFolderTree → graphClient.listChildren
 * → (the invoke seam) → the real custody handleGraphProxy (scope gate, allowlist, token decrypt, transport,
 * metadata projection) → a fake `graph.microsoft.com` that returns real `Response` objects.
 * Only Graph and the database are fakes. Shapes: learn.microsoft.com/graph/api/driveitem-list-children,
 * /graph/paging, /graph/errors, /graph/throttling. Names and ids are synthetic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const seam = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => seam.invoke(...a) } } }));

import { LinkedFolderTree } from './LinkedFolderTree';
import { listChildren } from '@/src/lib/m365/graphClient';
import { handleGraphProxy } from '../../../../supabase/functions/m365-token-custody/proxy';
import { scopeCoversPath } from '../../../../supabase/functions/m365-token-custody/graphRead';
import { mockClient, deps, encryptForTest } from '@/src/lib/m365/__tests__/m365MockDeps';
import type { ConnectionRow, GraphProxyRequest } from '../../../../supabase/functions/m365-token-custody/types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token';
// Real-looking opaque ids: a SharePoint library drive (b! + base64url) and a OneDrive-for-work item id.
const DRIVE = 'b!Zr3q-Synthetic_Drive0123456789AbCdEfGhIjKlMnOpQrStUvWxYz';
const ROOT = '01SYNTHETICROOTFOLDERID234567';
const SCOPES = ['Files.Read', 'Files.Read.All', 'Sites.Read.All', 'offline_access'];

const web = (name: string) => `https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/${encodeURIComponent(name)}`;
const entry = (id: string, name: string, kind: 'file' | 'folder' | 'package', extra: Record<string, unknown> = {}) => ({
  ...(kind === 'file' ? { '@microsoft.graph.downloadUrl': 'https://contoso.sharepoint.com/_layouts/15/download.aspx?UniqueId=secret' } : {}),
  createdBy: { user: { displayName: 'Synthetic Person', email: 'synthetic@example.invalid' } },
  createdDateTime: '2026-10-01T08:00:00Z',
  eTag: '"{ETAG},2"', cTag: '"c:{CTAG},2"',
  id, name, webUrl: web(name), lastModifiedDateTime: '2026-11-18T09:30:15Z',
  parentReference: { driveType: 'documentLibrary', driveId: DRIVE, id: ROOT, name: 'Project', path: '/drives/x/root:/Project' },
  ...(kind === 'folder' ? { folder: { childCount: 3 }, size: 41_900_000 } : {}),
  ...(kind === 'file' ? { file: { mimeType: 'application/pdf', hashes: { quickXorHash: 'x' } }, size: 284_330 } : {}),
  ...(kind === 'package' ? { package: { type: 'oneNote' }, size: 1024 } : {}),
  ...extra,
});
const page = (value: unknown[], nextLink?: string) => ({
  '@odata.context': `${GRAPH}/$metadata#drives('${DRIVE}')/items('${ROOT}')/children`,
  ...(nextLink ? { '@odata.nextLink': nextLink } : {}),
  value,
});
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: 200, ...init, headers: { 'Content-Type': 'application/json;odata.metadata=minimal', ...(init.headers ?? {}) },
});
const graphError = (status: number, code: string, headers: Record<string, string> = {}) => json(
  { error: { code, message: 'Synthetic Graph message that must never reach the page', innerError: { 'request-id': 'req-1', date: '2026-11-24T00:00:00' } } },
  { status, headers },
);

async function connection(overrides: Partial<ConnectionRow> = {}): Promise<ConnectionRow> {
  return {
    id: 'conn-1', org_id: 'org-1', user_id: 'user-1', entra_tenant_id: 'test-tenant-id', entra_user_object_id: null,
    scopes: SCOPES,
    refresh_token_ciphertext: await encryptForTest('REFRESH-TOKEN'),
    access_token_ciphertext: await encryptForTest('ACCESS-TOKEN'),
    access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_token_expires_at: null, key_id: 'kek-v1', status: 'active',
    connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const graphFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const callerClient = () => mockClient({
  profiles: [{ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }],
  org_features: [{ data: { enabled: true }, error: null }],
});
const failure = (result: { status: number; body?: unknown }) => ({
  data: null,
  error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } }),
  }),
});

/** The invoke seam: what supabase.functions.invoke does against the served function, minus HTTP. */
function serve(graph: (url: URL) => Response, rows: () => Promise<unknown[]> = async () => [{ data: await connection(), error: null }]) {
  graphFetch.mockImplementation(async (url) => graph(new URL(url)));
  seam.invoke.mockImplementation(async (_name: string, options: { body: GraphProxyRequest }) => {
    const service = mockClient({ ms_graph_connections: await rows() });
    const result = await handleGraphProxy(options.body, deps({ service, caller: callerClient(), userId: 'user-1', fetch: graphFetch as unknown as typeof fetch }));
    return result.status >= 400 ? failure(result) : { data: result.body, error: null };
  });
}

const files = (count: number) => Array.from({ length: count }, (_, i) => entry(`01FILE${String(i).padStart(4, '0')}`, `Item ${String(i).padStart(3, '0')}.pdf`, 'file'));
/** A folder of `count` files that Graph pages by the caller's $top with an opaque $skiptoken. */
function pagedFolder(count: number, nextLink: (url: URL, skip: number) => string) {
  const all = files(count);
  return (url: URL) => {
    const top = Number(url.searchParams.get('$top') ?? 200);
    const skip = Number(/skip=(\d+)/.exec(url.searchParams.get('$skiptoken') ?? '')?.[1] ?? 0);
    return json(page(all.slice(skip, skip + top), skip + top < count ? nextLink(url, skip + top) : undefined));
  };
}

let client: QueryClient;
const roots = [{ key: 'doc-1', title: 'Project folder', drive_id: DRIVE, item_id: ROOT, web_url: web('Project') }];
const mount = () => render(<QueryClientProvider client={client}><MemoryRouter><LinkedFolderTree roots={roots} /></MemoryRouter></QueryClientProvider>);
const tree = () => screen.getByRole('list', { name: 'Project folder' });

beforeEach(() => { seam.invoke.mockReset(); graphFetch.mockReset(); client = new QueryClient(); });

describe('#1124 the folder tree against documented Graph /children answers (shipped client + real custody handler)', () => {
  it('lists folders then files with modified date and size; download links and people never reach the page', async () => {
    serve(() => json(page([
      entry('01B', 'Site photos.jpg', 'file', { size: 8_734_112 }),
      entry('01A', 'Drawings', 'folder'),
      entry('01C', 'No size reported.docx', 'file', { size: undefined }),
    ])));
    const { container } = mount();
    const drawings = await screen.findByRole('button', { name: /^Drawings/ });
    const names = within(tree()).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(names.findIndex((t) => t.startsWith('Drawings'))).toBeLessThan(names.findIndex((t) => t.startsWith('Site photos.jpg')));
    expect(drawings).toHaveAttribute('aria-expanded', 'false');
    const photo = within(screen.getByText('Site photos.jpg').closest('li')!);
    expect(photo.getAllByText(/18 Nov/).length).toBeGreaterThan(0);
    expect(photo.getAllByText(/8[.,]73 MB/).length).toBeGreaterThan(0);
    // An item Microsoft reports without a size shows its date and no size, and is still listed and openable.
    const noSize = screen.getByText('No size reported.docx').closest('li')!;
    expect(within(noSize).getByRole('link', { name: 'Open No size reported.docx in SharePoint' })).toBeInTheDocument();
    expect(noSize.textContent).not.toMatch(/\d\s?(B|kB|MB|GB)\b/);
    expect(container.innerHTML).not.toMatch(/download\.aspx|secret|Synthetic Person|example\.invalid|createdBy/);
    // The request the custody function sent to Graph: GET, bearer, drive + folder path, page size 100, nothing else.
    const [url, init] = graphFetch.mock.calls[0]!;
    const sent = new URL(url);
    expect(sent.origin + sent.pathname).toBe(`${GRAPH}/drives/${encodeURIComponent(DRIVE)}/items/${ROOT}/children`);
    expect([...sent.searchParams.entries()]).toEqual([['$top', '100']]);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ACCESS-TOKEN');
    expect(init.method).toBe('GET');
  });

  it('keeps names with spaces, #, %, &, apostrophes, accents, emoji and non-Latin scripts intact and linkable', async () => {
    const odd = ['R&D plan #3 (final) 100%.xlsx', "O'Brien – Bølling façade ✓.pdf", 'Tab nbsp  double  space.docx', 'résumé 日本語 файл.txt'];
    serve(() => json(page(odd.map((n, i) => entry(`01ODD${i}`, n, 'file')))));
    mount();
    await screen.findByRole('link', { name: 'Open R&D plan #3 (final) 100%.xlsx in SharePoint' });
    // Matched by address: a screen reader's accessible name collapses runs of spaces, the link target must not.
    const hrefs = within(tree()).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(odd.map(web));
    const text = within(tree()).getAllByRole('link').map((a) => a.querySelector('span.break-words')?.textContent);
    expect(text).toEqual(odd);
  });

  it('a very long name wraps instead of widening the row', async () => {
    const long = `${'Revised structural calculation for the northern retaining wall '.repeat(5)}final.pdf`;
    serve(() => json(page([entry('01LONG', long, 'file')])));
    mount();
    expect((await screen.findByText(long)).className).toMatch(/break-words/);
  });

  it('250 children arrive as three pages through Show more, none repeated or lost', async () => {
    serve(pagedFolder(250, (url, skip) => `${url.origin}${url.pathname}?$top=${url.searchParams.get('$top')}&$skiptoken=${encodeURIComponent(`skip=${skip}`)}`));
    mount();
    await screen.findByText('Item 000.pdf');
    expect(within(tree()).getAllByRole('link')).toHaveLength(100);
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('Item 100.pdf');
    expect(within(tree()).getAllByRole('link')).toHaveLength(200);
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('Item 249.pdf');
    expect(within(tree()).getAllByRole('link')).toHaveLength(250);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    expect(graphFetch.mock.calls.map(([u]) => new URL(u).searchParams.get('$skiptoken'))).toEqual([null, 'skip=100', 'skip=200']);
  });

  it.each([
    ['a literal $ and a 2 kB opaque token', (u: URL) => `${u.origin}${u.pathname}?$skiptoken=skip=100${'UGFnZWQ9VFJVRSZw'.repeat(130)}`],
    ['percent-encoded $ in the keys', (u: URL) => `${u.origin}${u.pathname}?%24top=100&%24skiptoken=skip%3D100`],
    ['percent-encoded ! in the drive id', (u: URL) => `${u.origin}${u.pathname.replace('b!', 'b%21')}?$top=100&$skiptoken=skip%3D100`],
  ])('continues on a nextLink with %s', async (_label, nextLink) => {
    serve((url) => url.searchParams.get('$skiptoken')
      ? json(page([entry('01P2', 'Second page.pdf', 'file')]))
      : json(page([entry('01P1', 'First page.pdf', 'file')], nextLink(url))));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Second page.pdf')).toBeInTheDocument();
    expect(screen.getByText('First page.pdf')).toBeInTheDocument();
  });

  it('a nextLink that points at another resource is refused, never requested', async () => {
    serve(() => json(page([entry('01P1', 'First page.pdf', 'file')], `${GRAPH}/me/messages?$skiptoken=x`)));
    mount();
    await screen.findByRole('alert');
    expect(graphFetch.mock.calls.every(([u]) => !u.includes('/me/messages'))).toBe(true);
  });

  it('an empty folder is empty', async () => {
    serve(() => json(page([])));
    mount();
    expect(await screen.findByText('Empty folder')).toBeInTheDocument();
  });

  it('an item that is neither file nor folder (a OneNote notebook) is never reported as "Empty folder": the level says some items are not shown', async () => {
    serve(() => json(page([entry('01NOTE', 'Site notebook', 'package')])));
    mount();
    expect(await screen.findByText("Some items in this folder can't be shown here.")).toBeInTheDocument();
    expect(screen.queryByText('Empty folder')).not.toBeInTheDocument();
  });

  it('beside listed files, a notebook is flagged once and the files stay', async () => {
    serve(() => json(page([entry('01A', 'Plan.pdf', 'file'), entry('01NOTE', 'Site notebook', 'package')])));
    mount();
    expect(await screen.findByRole('link', { name: 'Open Plan.pdf in SharePoint' })).toBeInTheDocument();
    expect(screen.getAllByText("Some items in this folder can't be shown here.")).toHaveLength(1);
  });

  it('nested levels: a subfolder is read on its own Graph path from ids Graph itself returned; one screen = one request per opened level', async () => {
    const SUB = '01SUBFOLDERID0123456789ABCDEFG';
    serve((url) => url.pathname.endsWith(`/items/${SUB}/children`)
      ? json(page([entry('01DEEP', 'Deep file.pdf', 'file')]))
      : json(page([entry(SUB, 'Drawings', 'folder')])));
    mount();
    const drawings = await screen.findByRole('button', { name: /^Drawings/ });
    expect(graphFetch).toHaveBeenCalledTimes(1); // opening the screen reads the linked folder only
    await userEvent.click(drawings);
    await screen.findByText('Deep file.pdf');
    expect(graphFetch).toHaveBeenCalledTimes(2); // one more request for the one level opened
    const nested = new URL(graphFetch.mock.calls[1]![0]);
    expect(nested.origin + nested.pathname).toBe(`${GRAPH}/drives/${encodeURIComponent(DRIVE)}/items/${SUB}/children`);
    // Closing and reopening re-reads that level once (cached rows show at once); nothing else is requested.
    await userEvent.click(drawings);
    await userEvent.click(drawings);
    await screen.findByText('Deep file.pdf');
    expect(graphFetch).toHaveBeenCalledTimes(3);
  });

  it('a later page that fails leaves the pages already shown and Show more still there to try again', async () => {
    let second = 'fail';
    serve((url) => !url.searchParams.get('$skiptoken')
      ? json(page(files(100), `${url.origin}${url.pathname}?$top=100&$skiptoken=skip%3D100`))
      : second === 'fail' ? graphError(429, 'activityLimitReached', { 'Retry-After': '3' }) : json(page([entry('01L', 'Last file.pdf', 'file')])));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(graphFetch).toHaveBeenCalledTimes(2));
    expect(within(tree()).getAllByRole('link')).toHaveLength(100);
    second = 'ok';
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Last file.pdf')).toBeInTheDocument();
  });

  describe('failure answers (custody turns every Graph failure into one opaque GRAPH_ERROR)', () => {
    it('403 accessDenied: the access sentence; no Graph text, code or request id reaches the page', async () => {
      serve(() => graphError(403, 'accessDenied'));
      mount();
      await screen.findByRole('alert');
      expect(document.body.textContent).toMatch(/Check access and SharePoint availability/);
      expect(document.body.textContent).not.toMatch(/Synthetic Graph message|req-1|accessDenied|403/);
    });

    it('404 itemNotFound (linked folder moved or deleted): the same level error, with a retry that re-reads', async () => {
      serve(() => graphError(404, 'itemNotFound'));
      mount();
      await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/itemNotFound|Synthetic Graph message/);
    });

    it('429 with Retry-After: a retry is offered, and retrying once Microsoft recovers lists the folder', async () => {
      let throttled = true;
      serve(() => throttled ? graphError(429, 'activityLimitReached', { 'Retry-After': '7' }) : json(page([entry('01A', 'Back again.pdf', 'file')])));
      mount();
      await screen.findByRole('alert');
      throttled = false;
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Back again.pdf')).toBeInTheDocument();
    });

    it('503 serviceNotAvailable: retryable, no leaked detail', async () => {
      serve(() => graphError(503, 'serviceNotAvailable', { 'Retry-After': '120' }));
      mount();
      await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('Graph 401 InvalidAuthenticationToken on a locally unexpired token: an error line, no raw token text', async () => {
      serve(() => graphError(401, 'InvalidAuthenticationToken'));
      mount();
      await screen.findByRole('alert');
      expect(document.body.textContent).not.toMatch(/InvalidAuthenticationToken|ACCESS-TOKEN/);
    });

    it('an expired access token whose refresh Microsoft rejects (invalid_grant) shows the reconnect line and a Reconnect action', async () => {
      graphFetch.mockImplementation(async (url) => url === TOKEN_URL
        ? json({ error: 'invalid_grant', error_description: 'AADSTS70008 refresh token expired' }, { status: 400 })
        : json(page([])));
      seam.invoke.mockImplementation(async (_name: string, options: { body: GraphProxyRequest }) => {
        const service = mockClient({ ms_graph_connections: [
          { data: await connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() }), error: null },
          { data: { id: 'conn-1' }, error: null }, { data: { status: 'stale' }, error: null },
        ] });
        return failure(await handleGraphProxy(options.body, deps({ service, caller: callerClient(), userId: 'user-1', fetch: graphFetch as unknown as typeof fetch })));
      });
      mount();
      expect(await screen.findByText(/connection expired\. Reconnect to see this folder/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reconnect/i })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/AADSTS|invalid_grant/);
    });

    it('a person with no stored connection sees the not-connected line and a link to My integrations', async () => {
      serve(() => json(page([])), async () => [{ data: null, error: null }]);
      mount();
      expect(await screen.findByText('Connect Microsoft 365 first to browse documents.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open My integrations' })).toHaveAttribute('href', '/integrations');
    });
  });

  describe('the custody allowlist accepts every request the tree makes', () => {
    const idShapes = [
      { drive: DRIVE, item: ROOT },
      { drive: 'b!-RIj2DuyvEyV1T4NlOaMHk8XkS_I8MdFlUCq1BlcjgmhRfAj3-XXQrt0123456789', item: '01AZJL5PN6Y2GOVW7725BZO354PWSELRRZ' },
      { drive: 'b!a1b2c3', item: 'D3F5A1B2C3D4E5F6!123' }, // a consumer-style item id carries `!`
    ];

    it.each(idShapes)('drive-root, folder and next-page requests for drive $drive are covered; a write or a content path is not', async ({ drive, item }) => {
      seam.invoke.mockResolvedValue({ data: { value: [] }, error: null });
      await listChildren(drive);
      await listChildren(drive, item);
      const nextLink = `${GRAPH}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item)}/children?$top=100&$skiptoken=${'A'.repeat(1500)}`;
      seam.invoke.mockResolvedValueOnce({ data: { value: [], '@odata.nextLink': nextLink }, error: null });
      const first = await listChildren(drive, item);
      expect(first.next).not.toBeNull();
      await listChildren(drive, item, first.next!);
      const sent = (seam.invoke.mock.calls as Array<[string, { body: GraphProxyRequest }]>).map(([, o]) => o.body);
      expect(sent).toHaveLength(4);
      for (const body of sent) {
        expect(scopeCoversPath(SCOPES, 'GET', body.path), body.path).toBe(true);
        expect(scopeCoversPath(SCOPES, 'POST', body.path)).toBe(false);
        expect(scopeCoversPath(SCOPES, 'GET', `${body.path}/content`)).toBe(false);
      }
    });

    it.each(idShapes)('the real handler lets the first and the continuation request through to Graph for drive $drive', async ({ drive, item }) => {
      const all = files(150);
      serve((url) => {
        const skipped = url.searchParams.get('$skiptoken');
        return skipped
          ? json(page(all.slice(100)))
          : json(page(all.slice(0, 100), `${url.origin}${url.pathname}?$top=100&$skiptoken=skip%3D100`));
      });
      const firstPage = await listChildren(drive, item);
      expect(firstPage.value).toHaveLength(100);
      const secondPage = await listChildren(drive, item, firstPage.next!);
      expect(secondPage.value).toHaveLength(50);
      const urls = graphFetch.mock.calls.map(([u]) => new URL(u));
      expect(urls).toHaveLength(2);
      for (const u of urls) {
        expect(u.origin + u.pathname).toBe(`${GRAPH}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item)}/children`);
        expect([...u.searchParams.keys()].every((k) => k === '$top' || k === '$skiptoken')).toBe(true);
      }
    });
  });
});
