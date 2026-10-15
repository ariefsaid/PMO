import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptForTest, deps, mockClient } from './m365MockDeps';
import type { ConnectionRow } from '../../../../../supabase/functions/m365-token-custody/types';

const { handleCheckDocuments } = await import('../../../../../supabase/functions/m365-token-custody/documentVerification');

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

async function setup(claimed: unknown[] = [claimedDocument], entitled = true) {
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
    new Response(JSON.stringify({ responses: [{
      id: '1', status: 200, body: {
        id: 'synthetic-item', name: 'Synthetic file', webUrl: 'https://example.invalid/item',
        parentReference: { driveId: 'synthetic-drive' }, file: {}, cTag: 'content-1',
      },
    }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const handlerDeps = deps({ service, caller, userId: '10200000-0000-0000-0000-000000000101' });
  return { service, caller, fetch, handlerDeps };
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
