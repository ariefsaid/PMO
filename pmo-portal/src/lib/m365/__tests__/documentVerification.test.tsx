import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptForTest, deps, mockClient } from './m365MockDeps';
import type { ConnectionRow } from '../../../../../supabase/functions/m365-token-custody/types';

const { handleCheckDocuments, handleIssueMicrosoftDocument, handleRefreshReferences } = await import('../../../../../supabase/functions/m365-token-custody/documentVerification');

afterEach(() => {
  vi.unstubAllGlobals();
});

const documentId = '10200000-0000-0000-0000-000000000301';
const claimedDocument = {
  id: documentId,
  org_id: '10200000-0000-0000-0000-000000000001',
  source: 'onedrive',
  status: 'Issued',
  ms_item_kind: 'file',
  ms_drive_id: 'synthetic-drive',
  ms_item_id: 'synthetic-item',
  ms_content_tag_at_issue: 'content-1',
  ms_check_claim: '10200000-0000-0000-0000-000000000901',
};

async function setup(
  claimed: unknown[] = [claimedDocument],
  entitled = true,
  graphPayload?: unknown,
  graphStatus = 200,
) {
  const service = mockClient({
    ms_graph_connections: [{ data: await connection(), error: null }],
  });
  service.rpc.mockImplementation((fn, args) => {
    if (fn === 'm365_membership_state') {
      return Promise.resolve({ data: { state: 'active', org_id: '10200000-0000-0000-0000-000000000001', role: 'Admin' }, error: null });
    }
    if (fn === 'm365_claim_document_checks') {
      return Promise.resolve({ data: claimed, error: null });
    }
    if (fn === 'm365_commit_document_check') {
      return Promise.resolve({ data: true, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  const caller = mockClient({
    org_features: [
      { data: { enabled: entitled }, error: null },
      { data: { enabled: entitled }, error: null },
    ],
  });
  const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(graphPayload ?? { responses: [{
      id: '1', status: 200, body: {
        id: 'synthetic-item', name: 'Synthetic file', webUrl: 'https://example.invalid/item',
        parentReference: { driveId: 'synthetic-drive' }, file: {}, cTag: 'content-1',
      },
    }] }), { status: graphStatus, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const handlerDeps = deps({ service, caller, userId: '10200000-0000-0000-0000-000000000101' });
  return { service, caller, fetch, handlerDeps };
}

async function setupIssue(input: {
  tags: Array<string | null>;
  versions: unknown[];
  issueError?: { code: string; details: string };
}) {
  const projectDocument = {
    id: documentId,
    org_id: '10200000-0000-0000-0000-000000000001',
    project_id: '10200000-0000-0000-0000-000000000201',
    author_id: '10200000-0000-0000-0000-000000000102',
    status: 'Draft', source: 'onedrive', ms_item_kind: 'file',
    ms_drive_id: 'synthetic-drive', ms_item_id: 'synthetic-item',
    ms_web_url: 'https://example.invalid/item', ms_item_name: 'Synthetic file',
    ms_content_tag_at_issue: null, ms_version_id_at_issue: null,
  };
  const service = mockClient({ ms_graph_connections: [{ data: await connection(), error: null }] });
  service.rpc.mockImplementation((fn) => {
    if (fn === 'm365_membership_state') {
      return Promise.resolve({ data: { state: 'active', org_id: projectDocument.org_id, role: 'Admin' }, error: null });
    }
    if (fn === 'm365_issue_document') return Promise.resolve({ data: null, error: input.issueError ?? null });
    return Promise.resolve({ data: null, error: null });
  });
  const caller = mockClient({
    org_features: [{ data: { enabled: true }, error: null }, { data: { enabled: true }, error: null }],
    project_documents: [{ data: projectDocument, error: null }],
  });
  let metadataRead = 0;
  const fetch = vi.fn(async (inputUrl: string | URL | Request) => {
    const url = String(inputUrl);
    let body: unknown;
    if (url.includes('/versions')) {
      body = { value: input.versions };
    } else {
      const cTag = input.tags[metadataRead++];
      body = {
        id: 'synthetic-item', name: 'Synthetic file', webUrl: 'https://example.invalid/item',
        parentReference: { driveId: 'synthetic-drive' }, file: {},
        ...(cTag === null ? {} : { cTag }),
      };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    service, caller, fetch,
    handlerDeps: deps({ service, caller, userId: '10200000-0000-0000-0000-000000000101' }),
  };
}

async function setupRefresh(controlled = false) {
  const parentId = '10200000-0000-0000-0000-000000000201';
  const orgId = '10200000-0000-0000-0000-000000000001';
  const rows = [
    {
      id: '10200000-0000-0000-0000-000000000301', org_id: orgId, project_id: parentId,
      author_id: '10200000-0000-0000-0000-000000000101', status: controlled ? 'Issued' : 'Draft', source: 'onedrive',
      ms_item_kind: 'file', ms_drive_id: 'synthetic-drive-a', ms_item_id: 'shared-item',
    },
    {
      id: '10200000-0000-0000-0000-000000000302', org_id: orgId, project_id: parentId,
      author_id: '10200000-0000-0000-0000-000000000101', status: 'Draft', source: 'onedrive',
      ms_item_kind: 'file', ms_drive_id: 'synthetic-drive-b', ms_item_id: 'shared-item',
    },
  ];
  const service = mockClient({ ms_graph_connections: [{ data: await connection(), error: null }] });
  service.rpc.mockImplementation((fn) => {
    if (fn === 'm365_membership_state') return Promise.resolve({ data: { state: 'active', org_id: orgId, role: 'Admin' }, error: null });
    if (fn === 'm365_refresh_reference') return Promise.resolve({ data: true, error: null });
    if (fn === 'm365_claim_document_checks') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  });
  const caller = mockClient({
    org_features: [{ data: { enabled: true }, error: null }, { data: { enabled: true }, error: null }],
    project_documents: [{ data: rows, error: null }],
  });
  const fetch = vi.fn(async (inputUrl: string | URL | Request) => {
    const requestedDrive = String(inputUrl).includes('/drives/synthetic-drive-a/')
      ? 'synthetic-drive-a'
      : 'synthetic-drive-wrong';
    return new Response(JSON.stringify({
      id: 'shared-item', name: 'Updated name', webUrl: 'https://example.invalid/item',
      parentReference: { driveId: requestedDrive }, file: {}, cTag: 'metadata-tag',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    service, caller, fetch,
    handlerDeps: deps({ service, caller, userId: '10200000-0000-0000-0000-000000000101' }),
  };
}

async function connection(): Promise<ConnectionRow> {
  return {
    id: 'synthetic-connection', org_id: '10200000-0000-0000-0000-000000000001',
    user_id: '10200000-0000-0000-0000-000000000101', entra_tenant_id: 'synthetic-tenant',
    entra_user_object_id: null, scopes: ['Files.Read'],
    refresh_token_ciphertext: await encryptForTest('synthetic-refresh-token'),
    access_token_ciphertext: await encryptForTest('synthetic-access-token'),
    access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    refresh_token_expires_at: null, key_id: 'kek-v1', status: 'active',
    connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
  };
}

describe('M365 controlled document checks', () => {
  it('AC-M365DOC-062 refreshes only rows matching both drive and item identity', async () => {
    const { service, caller, fetch, handlerDeps } = await setupRefresh();
    const result = await handleRefreshReferences({
      project_id: '10200000-0000-0000-0000-000000000201',
      items: [
        { drive_id: 'synthetic-drive-a', item_id: 'shared-item' },
        { drive_id: 'synthetic-drive-b', item_id: 'shared-item' },
      ],
    }, handlerDeps);
    expect(result).toMatchObject({ status: 200, body: { refreshed: 1 } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      expect.stringContaining('/drives/synthetic-drive-a/items/shared-item'),
      expect.stringContaining('/drives/synthetic-drive-b/items/shared-item'),
    ]));
    expect(service.rpc).toHaveBeenCalledWith('m365_refresh_reference', expect.objectContaining({
      p_project_document_id: '10200000-0000-0000-0000-000000000301',
      p_drive_id: 'synthetic-drive-a', p_item_id: 'shared-item',
    }));
    expect(service.rpc).not.toHaveBeenCalledWith('m365_refresh_reference', expect.objectContaining({
      p_project_document_id: '10200000-0000-0000-0000-000000000302',
    }));
    expect(caller.selects.some((read) => read.table === 'project_documents')).toBe(true);
  });

  it('AC-M365DOC-064 routes controlled project files through check_documents, never metadata refresh', async () => {
    const { service, fetch, handlerDeps } = await setupRefresh(true);
    const result = await handleRefreshReferences({
      project_id: '10200000-0000-0000-0000-000000000201',
      items: [{ drive_id: 'synthetic-drive-a', item_id: 'shared-item' }],
    }, handlerDeps);
    expect(result).toMatchObject({ status: 200, body: { refreshed: 0, checked: 0 } });
    expect(service.rpc).toHaveBeenCalledWith('m365_claim_document_checks', expect.objectContaining({
      p_ids: ['10200000-0000-0000-0000-000000000301'],
    }));
    expect(service.rpc).not.toHaveBeenCalledWith('m365_refresh_reference', expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-062 refuses ambiguous parent selection and more than twenty identities', async () => {
    const { service, fetch, handlerDeps } = await setupRefresh();
    const ambiguous = await handleRefreshReferences({ items: [] }, handlerDeps);
    const overLimit = await handleRefreshReferences({
      project_id: '10200000-0000-0000-0000-000000000201',
      items: Array.from({ length: 21 }, (_, index) => ({ drive_id: `d${index}`, item_id: `i${index}` })),
    }, handlerDeps);
    expect(ambiguous.status).toBe(400);
    expect(overLimit.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(service.rpc).not.toHaveBeenCalledWith('m365_refresh_reference', expect.anything());
  });

  it('AC-M365DOC-068 freezes Issue only after stable metadata reads and pins the newest parsed version', async () => {
    const { service, fetch, handlerDeps } = await setupIssue({
      tags: ['content-at-issue', 'content-at-issue'],
      versions: [
        { id: '10.0', lastModifiedDateTime: '2025-02-01T00:00:00Z' },
        { id: '2.0', lastModifiedDateTime: '2025-03-01T00:00:00Z' },
      ],
    });
    const result = await handleIssueMicrosoftDocument({ document_id: documentId }, handlerDeps);
    expect(result).toMatchObject({ status: 200, body: { issued: true } });
    const issue = service.rpc.mock.calls.find(([fn]) => fn === 'm365_issue_document')?.[1];
    expect(issue).toMatchObject({ p_content_tag: 'content-at-issue', p_version_id: '2.0' });
    expect(issue).not.toHaveProperty('p_to');
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('/drives/synthetic-drive/items/synthetic-item')).length).toBe(3);
  });

  it('AC-M365DOC-068 refuses Issue when cTag changes between metadata reads', async () => {
    const { service, fetch, handlerDeps } = await setupIssue({
      tags: ['before-tag', 'after-tag'], versions: [{ id: '1.0', lastModifiedDateTime: '2025-01-01T00:00:00Z' }],
    });
    const result = await handleIssueMicrosoftDocument({ document_id: documentId }, handlerDeps);
    expect(result).toMatchObject({ status: 409, body: { error: 'SOURCE_CHANGED' } });
    expect(service.rpc).not.toHaveBeenCalledWith('m365_issue_document', expect.anything());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('AC-M365DOC-068 fences a source/status/actor change observed by the final database commit', async () => {
    const { service, handlerDeps } = await setupIssue({
      tags: ['content-at-issue', 'content-at-issue'],
      versions: [{ id: '1.0', lastModifiedDateTime: '2025-01-01T00:00:00Z' }],
      issueError: { code: '23514', details: 'm365-source-changed' },
    });
    const result = await handleIssueMicrosoftDocument({ document_id: documentId }, handlerDeps);
    expect(result).toMatchObject({ status: 409, body: { error: 'SOURCE_CHANGED' } });
    expect(JSON.stringify(result)).not.toContain('m365-source-changed');
    expect(service.rpc).toHaveBeenCalledWith('m365_issue_document', expect.objectContaining({
      p_actor_id: '10200000-0000-0000-0000-000000000101', p_doc_id: documentId,
    }));
  });

  it('AC-M365DOC-068 permits honest unavailable metadata as not_verified with no pin', async () => {
    const { service, handlerDeps } = await setupIssue({ tags: [null, null], versions: [] });
    const result = await handleIssueMicrosoftDocument({ document_id: documentId }, handlerDeps);
    expect(result).toMatchObject({ status: 200, body: { issued: true, verification: 'unavailable' } });
    const issue = service.rpc.mock.calls.find(([fn]) => fn === 'm365_issue_document')?.[1];
    expect(issue).toMatchObject({ p_content_tag: null, p_version_id: null });
  });

  it('AC-M365DOC-064 batches only claimed controlled files and commits the server-derived result', async () => {
    const { service, fetch, handlerDeps } = await setup();
    const result = await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    expect(result).toMatchObject({ status: 200, body: { checked: 1 } });
    const graphCall = fetch.mock.calls.find(([input]) => String(input).includes('/$batch'));
    expect(graphCall).toBeDefined();
    const payload = JSON.parse(String(graphCall?.[1]?.body));
    expect(payload.requests).toEqual([expect.objectContaining({
      id: '1', method: 'GET',
      url: '/drives/synthetic-drive/items/synthetic-item?$select=id,name,webUrl,parentReference,file,folder,cTag,sharepointIds',
    })]);
    expect(payload.requests[0]).not.toHaveProperty('body');
    expect(payload.requests[0]).not.toHaveProperty('headers');
    expect(payload.requests[0]).not.toHaveProperty('dependsOn');
    expect(service.rpc).toHaveBeenCalledWith('m365_claim_document_checks', {
      p_actor_id: '10200000-0000-0000-0000-000000000101', p_ids: [documentId],
    });
    expect(service.rpc).toHaveBeenCalledWith('m365_commit_document_check', expect.objectContaining({
      p_actor_id: '10200000-0000-0000-0000-000000000101',
      p_doc_id: documentId,
      p_drive_id: 'synthetic-drive', p_item_id: 'synthetic-item',
    }));
    const connectionRead = service.selects.find((read) => read.table === 'ms_graph_connections');
    expect(connectionRead?.eqs).toContainEqual(['user_id', '10200000-0000-0000-0000-000000000101']);
  });

  it('AC-M365DOC-064 rejects over-limit and malformed IDs before claiming or calling Graph', async () => {
    const { service, fetch, handlerDeps } = await setup([]);
    const tooMany = Array.from({ length: 21 }, (_, index) => `10200000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`);
    const oversized = await handleCheckDocuments({ document_ids: tooMany }, handlerDeps);
    const malformed = await handleCheckDocuments({ document_ids: ['not-a-uuid'] }, handlerDeps);
    expect(oversized.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(service.rpc).not.toHaveBeenCalledWith('m365_claim_document_checks', expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-064 eTag-only rename commits the same cTag and never treats eTag as content evidence', async () => {
    const { service, handlerDeps } = await setup([claimedDocument], true, { responses: [{
      id: '1', status: 200, body: {
        id: 'synthetic-item', name: 'Renamed file', webUrl: 'https://example.invalid/renamed',
        parentReference: { driveId: 'synthetic-drive' }, file: {}, cTag: 'content-1', eTag: 'etag-renamed',
      },
    }] });
    await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    const commit = service.rpc.mock.calls.find(([fn]) => fn === 'm365_commit_document_check')?.[1];
    expect(commit).toMatchObject({ p_success: true, p_content_tag: 'content-1', p_name: 'Renamed file' });
    expect(commit).not.toHaveProperty('etag');
  });

  it('AC-M365DOC-064 changed cTag is passed as the server-derived comparison value', async () => {
    const { service, handlerDeps } = await setup([claimedDocument], true, { responses: [{
      id: '1', status: 200, body: {
        id: 'synthetic-item', name: 'Synthetic file', webUrl: 'https://example.invalid/item',
        parentReference: { driveId: 'synthetic-drive' }, file: {}, cTag: 'content-2',
      },
    }] });
    await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    const commit = service.rpc.mock.calls.find(([fn]) => fn === 'm365_commit_document_check')?.[1];
    expect(commit).toMatchObject({ p_success: true, p_content_tag: 'content-2', p_baseline: 'content-1' });
  });

  it('AC-M365DOC-064 treats missing tags, changed identity, and item failures as unverified', async () => {
    const badCases = [
      { id: 'synthetic-item', name: 'Synthetic file', webUrl: 'https://example.invalid/item', parentReference: { driveId: 'synthetic-drive' }, file: {} },
      { id: 'synthetic-item', name: 'Synthetic file', webUrl: 'https://example.invalid/item', parentReference: { driveId: 'other-drive' }, file: {}, cTag: 'content-2' },
    ];
    for (const item of badCases) {
      const { service, handlerDeps } = await setup([claimedDocument], true, { responses: [{ id: '1', status: 200, body: item }] });
      await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
      const commit = service.rpc.mock.calls.find(([fn]) => fn === 'm365_commit_document_check')?.[1];
      expect(commit).toMatchObject({ p_success: false, p_name: '', p_url: '', p_content_tag: '' });
    }
    for (const status of [404, 429, 503]) {
      const { service, handlerDeps } = await setup([claimedDocument], true, { responses: [{ id: '1', status, body: { error: 'opaque' } }] });
      await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
      const commit = service.rpc.mock.calls.find(([fn]) => fn === 'm365_commit_document_check')?.[1];
      expect(commit).toMatchObject({ p_success: false, p_content_tag: '' });
      expect(commit).not.toHaveProperty('error');
    }
  });

  it('AC-M365DOC-064 releases owned claims and reports an opaque batch transport failure', async () => {
    const { service, fetch, handlerDeps } = await setup();
    fetch.mockRejectedValue(new Error('synthetic upstream detail'));
    const result = await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    expect(result).toMatchObject({ status: 502, body: { error: 'GRAPH_ERROR' } });
    const commit = service.rpc.mock.calls.find(([fn]) => fn === 'm365_commit_document_check')?.[1];
    expect(commit).toMatchObject({ p_success: false, p_claim: claimedDocument.ms_check_claim });
    expect(JSON.stringify(result)).not.toContain('synthetic upstream detail');
  });

  it('AC-M365DOC-064 denies an inactive/non-member caller before claiming rows', async () => {
    const { service, fetch, handlerDeps } = await setup();
    service.rpc.mockImplementation((fn) => fn === 'm365_membership_state'
      ? Promise.resolve({ data: { state: 'missing', org_id: null, role: null }, error: null })
      : Promise.resolve({ data: null, error: null }));
    const result = await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    expect(result.status).toBe(400);
    expect(service.rpc).not.toHaveBeenCalledWith('m365_claim_document_checks', expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-064 denies a caller without the organization entitlement before claiming rows', async () => {
    const { service, fetch, handlerDeps } = await setup([], false);
    const result = await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    expect(result.status).toBe(403);
    expect(service.rpc).not.toHaveBeenCalledWith('m365_claim_document_checks', expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-064 skips Drafts and folders because only claim-RPC results enter the Graph batch', async () => {
    const { fetch, handlerDeps } = await setup([]);
    const result = await handleCheckDocuments({ document_ids: [documentId] }, handlerDeps);
    expect(result).toMatchObject({ status: 200, body: { checked: 0 } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
