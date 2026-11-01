import { beforeEach, describe, expect, it, vi } from 'vitest';
import { microsoftTarget } from './microsoft';

const previewMicrosoftDocument = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/previewClient', () => ({ previewMicrosoftDocument }));

beforeEach(() => previewMicrosoftDocument.mockReset());

const make = (over = {}) => microsoftTarget({ request: { kind: 'project_document', id: 'doc-1' }, name: 'Plan.pdf', webUrl: 'https://tenant.sharepoint.com/sites/x/Plan.pdf', ...over });

describe('document-preview AC-003 microsoftTarget', () => {
  it('labels the source from the stored URL and offers the validated Open in source', () => {
    const t = make();
    expect(t.sourceLabel).toBe('SharePoint');
    expect(t.openInSource).toEqual({ url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf' });
    expect(t.download).toBeUndefined(); // Microsoft downloads are the source's own, not ours
  });

  it('drops Open in source for a non-https stored URL', () => {
    expect(make({ webUrl: 'http://tenant.sharepoint.com/a' }).openInSource).toBeUndefined();
    expect(make({ webUrl: 'javascript:alert(1)' }).openInSource).toBeUndefined();
  });

  it('forwards the typed request and the abort signal, and loads nothing until asked', async () => {
    previewMicrosoftDocument.mockResolvedValue({ mode: 'embed', provider: 'microsoft', url: 'https://x.sharepoint.com/e' });
    const t = make();
    expect(previewMicrosoftDocument).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    await t.load(signal);
    expect(previewMicrosoftDocument).toHaveBeenCalledWith({ kind: 'project_document', id: 'doc-1' }, signal);
  });

  it('the key never carries a Graph drive/item id, a URL or the child id; children of one folder differ', () => {
    const a = make({ request: { kind: 'project_document', id: 'doc-1', child_item_id: 'graph-child-AAAA' } });
    const b = make({ request: { kind: 'project_document', id: 'doc-1', child_item_id: 'graph-child-BBBB' } });
    expect(a.key).not.toBe(b.key);
    for (const key of [a.key, b.key, make().key]) {
      expect(key).not.toContain('graph-child');
      expect(key).not.toContain('sharepoint');
      expect(key).not.toContain('http');
    }
    expect(make({ request: { kind: 'procurement_file', phase: 'receipt', id: 'f-1' } }).key).toBe('ms:procurement_file:receipt:f-1');
  });
});
