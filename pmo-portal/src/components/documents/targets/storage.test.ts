import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';
import { PreviewFailure } from '../types';
import { storageTarget, TEXT_PREVIEW_BYTES } from './storage';

afterEach(() => vi.restoreAllMocks());
const signal = new AbortController().signal;
const make = (name: string, getSignedUrl = vi.fn().mockResolvedValue('https://signed.test/x'), over = {}) =>
  ({ getSignedUrl, target: storageTarget({ key: 'k', name, filePath: 'org/p/file', getSignedUrl, sourceLabel: 'PMO', ...over }) });

describe('document-preview AC-005 storageTarget', () => {
  it.each([
    ['a.pdf', 'pdf'],
    ['a.png', 'image'],
    ['a.WEBP', 'image'],
  ] as const)('%s previews natively from one signed URL', async (name, mode) => {
    const { target, getSignedUrl } = make(name);
    expect(await target.load(signal)).toEqual({ mode, url: 'https://signed.test/x' });
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    expect(getSignedUrl).toHaveBeenCalledWith('org/p/file');
  });

  it.each(['a.docx', 'a.xlsx', 'a.pptx', 'a.doc'])('%s goes through the public Office viewer with a fresh signed URL', async (name) => {
    const { target, getSignedUrl } = make(name);
    const result = await target.load(signal);
    expect(result).toEqual({ mode: 'embed', provider: 'office-online', url: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent('https://signed.test/x')}` });
    await target.load(signal);
    expect(getSignedUrl).toHaveBeenCalledTimes(2); // every open / retry signs again
    // Microsoft's public viewer fetches the file once on open, so the link it receives is short-lived.
    expect(getSignedUrl).toHaveBeenCalledWith('org/p/file', { expiresIn: 300 });
  });

  it.each(['a.dwg', 'a.zip', 'readme'])('%s is unsupported and never signs a URL', async (name) => {
    const { target, getSignedUrl } = make(name);
    expect(await target.load(signal)).toEqual({ mode: 'unsupported' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  describe('#1588 plain text and DXF drawings', () => {
    const fetched = (body: BodyInit, init: ResponseInit = {}) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init));

    it.each(['notes.txt', 'rates.CSV'])('%s is read from one fresh signed URL and shown as text', async (name) => {
      const fetchSpy = fetched('line one\nline two');
      const { target, getSignedUrl } = make(name);
      expect(await target.load(signal)).toEqual({ mode: 'text', text: 'line one\nline two', truncated: false });
      expect(getSignedUrl).toHaveBeenCalledWith('org/p/file');
      expect(fetchSpy).toHaveBeenCalledWith('https://signed.test/x', expect.objectContaining({ signal }));
    });

    it('a long text file shows its start and says it was cut', async () => {
      fetched('x'.repeat(TEXT_PREVIEW_BYTES + 10));
      const result = await make('big.txt').target.load(signal);
      expect(result).toMatchObject({ mode: 'text', truncated: true });
      expect(result.mode === 'text' && result.text.length).toBe(TEXT_PREVIEW_BYTES);
    });

    it('a DXF drawing is parsed into a drawing', async () => {
      fetched(['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '0', '20', '0', '11', '10', '21', '5', '0', 'ENDSEC', '0', 'EOF'].join('\n'));
      const result = await make('site.dxf').target.load(signal);
      expect(result).toMatchObject({ mode: 'drawing', drawing: { path: 'M0 0L10 -5', truncated: false } });
    });

    it('a DXF with nothing drawable is unsupported, never an empty picture', async () => {
      fetched('0\nEOF');
      expect(await make('empty.dxf').target.load(signal)).toEqual({ mode: 'unsupported' });
    });

    it('a failed or refused read is an unavailable preview', async () => {
      fetched('denied', { status: 403 });
      await expect(make('a.txt').target.load(signal)).rejects.toMatchObject({ kind: 'unavailable' });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
      await expect(make('a.dxf').target.load(signal)).rejects.toMatchObject({ kind: 'unavailable' });
    });
  });

  it('no stored file is "no file attached", never a fabricated preview or dead Download', async () => {
    const { target, getSignedUrl } = make('a.pdf', undefined, { filePath: null });
    await expect(target.load(signal)).rejects.toMatchObject({ kind: 'no_file' });
    expect(target.download).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('a rejected signing is an unavailable preview', async () => {
    const { target } = make('a.pdf', vi.fn().mockRejectedValue(new Error('storage down')));
    const error = await target.load(signal).catch((e) => e);
    expect(error).toBeInstanceOf(PreviewFailure);
    expect(error.kind).toBe('unavailable');
  });

  it('the dialog is only keyed and named by the PMO file, never by the signed URL', () => {
    const { target } = make('Plan.pdf');
    expect(target.key).toBe('k');
    expect(target.name).toBe('Plan.pdf');
    expect(JSON.stringify({ key: target.key, name: target.name })).not.toContain('signed');
  });

  it('Download signs for download, clicks an anchor and states a classified denial', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { target, getSignedUrl } = make('a.pdf');
    await target.download!();
    expect(getSignedUrl).toHaveBeenCalledWith('org/p/file', { download: true });
    expect(click).toHaveBeenCalledOnce();

    const denied = make('a.pdf', vi.fn().mockRejectedValue(new AppError('permission denied for table objects', '42501')));
    const error = await denied.target.download!().catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Your role does not allow this change. Ask an administrator if you think it should.');
  });

  it('a supplied download accessor replaces the default (receipts)', async () => {
    const download = vi.fn().mockResolvedValue(undefined);
    const { target, getSignedUrl } = make('a.png', undefined, { download });
    await target.download!();
    expect(download).toHaveBeenCalledOnce();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
