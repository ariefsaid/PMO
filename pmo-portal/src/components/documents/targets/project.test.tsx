import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicrosoftReference, ReferenceOwner } from '@/src/lib/m365/reference';
import { PreviewFailure } from '../types';
import { Harness } from '../Harness';
import { renderViewer } from '../testkit';
import { projectDocumentTarget } from './project';

const previewMicrosoftDocument = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/previewClient', () => ({ previewMicrosoftDocument }));
vi.mock('@/src/lib/m365/graphClient', () => ({ getItem: vi.fn(), listChildren: vi.fn(), listVersions: vi.fn() }));
const writes = vi.hoisted(() => ({ transition: vi.fn(), update: vi.fn(), confirm: vi.fn(), setDrift: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: writes } }));

const SP = 'https://tenant.sharepoint.com/sites/x/Plan.docx';
const reference: MicrosoftReference = { drive_id: 'd', item_id: 'i', web_url: SP, name: 'Plan.docx', item_kind: 'file', linked_by: 'u', linked_at: '2026-10-01T00:00:00Z', last_verified_at: null };
type Owner = Extract<ReferenceOwner, { kind: 'project' }>;
const owner = (over: Partial<Owner> = {}): Owner => ({
  kind: 'project', id: 'doc-1', status: 'Approved', content_tag_at_issue: 'tag', version_id_at_issue: '2.0', drift_state: 'drifted', last_verified_at: '2026-10-10T08:00:00Z', ...over,
});

beforeEach(() => {
  previewMicrosoftDocument.mockReset();
  Object.values(writes).forEach((fn) => fn.mockReset());
});

async function open(o: Owner) {
  const t = projectDocumentTarget({ reference, owner: o, title: 'Plan' });
  renderViewer(<Harness targets={[t]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Preview Plan' }));
  await screen.findByRole('dialog', { name: 'Plan' });
}

describe('document-preview AC-012 controlled documents', () => {
  it('a Draft opens with no latest-source notice and no controlled block', async () => {
    previewMicrosoftDocument.mockResolvedValue({ mode: 'embed', provider: 'microsoft', url: 'https://tenant.sharepoint.com/e' });
    await open(owner({ status: 'Draft', drift_state: null, version_id_at_issue: null }));
    await screen.findByTitle('Plan');
    expect(screen.queryByText(/not the approved version/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Approved version/)).not.toBeInTheDocument();
  });

  it('an Approved document labels the latest source explicitly and keeps its pin, drift state and history', async () => {
    previewMicrosoftDocument.mockResolvedValue({ mode: 'embed', provider: 'microsoft', url: 'https://tenant.sharepoint.com/e' });
    await open(owner());
    await screen.findByTitle('Plan');
    expect(screen.getByText('Latest in SharePoint. This is not the approved version.')).toBeInTheDocument();
    expect(screen.getByText('Approved version 2.0')).toBeInTheDocument();
    expect(screen.getByText('File content differs from its issue-time baseline.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View approved version history/ })).toBeInTheDocument();
  });

  it('an Issued document gets the notice and drift state but no approved-version history', async () => {
    previewMicrosoftDocument.mockResolvedValue({ mode: 'embed', provider: 'microsoft', url: 'https://tenant.sharepoint.com/e' });
    await open(owner({ status: 'Issued' }));
    await screen.findByTitle('Plan');
    expect(screen.getByText('Issued version 2.0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View approved version history/ })).not.toBeInTheDocument();
  });

  it.each(['unsupported', 'unavailable', 'access_denied'] as const)('when the preview is %s the recovery stays and latest bytes are never relabelled as approved', async (kind) => {
    previewMicrosoftDocument.mockRejectedValue(new PreviewFailure(kind));
    await open(owner());
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /View approved version history/ })).toBeInTheDocument();
    expect(screen.getByText('Latest in SharePoint. This is not the approved version.')).toBeInTheDocument();
    expect(screen.getByText('Approved version 2.0')).toBeInTheDocument(); // the pin comes from the row, not recomputed
  });

  it('opening and closing writes nothing: no status, approval, drift or document call', async () => {
    previewMicrosoftDocument.mockResolvedValue({ mode: 'embed', provider: 'microsoft', url: 'https://tenant.sharepoint.com/e' });
    await open(owner());
    await screen.findByTitle('Plan');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  });
});
