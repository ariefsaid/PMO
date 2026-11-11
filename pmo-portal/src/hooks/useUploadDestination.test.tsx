import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadDestination, useUploadFailureText } from './useUploadDestination';

const h = vi.hoisted(() => ({
  feature: true,
  docs: { defaultLibrary: null as unknown, isPending: false, defaultError: null as unknown },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.feature }));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => h.docs }));

beforeEach(() => {
  h.feature = true;
  h.docs = { defaultLibrary: null, isPending: false, defaultError: null };
});

describe('document-preview AC-008 useUploadDestination', () => {
  it('uses SharePoint when the org has a default library', () => {
    h.docs.defaultLibrary = { drive_id: 'd', site_id: 's' };
    expect(renderHook(() => useUploadDestination()).result.current).toEqual({ kind: 'microsoft' });
  });

  it('uses private storage when there is no default library or the module is off', () => {
    expect(renderHook(() => useUploadDestination()).result.current).toEqual({ kind: 'private' });
    h.docs.defaultLibrary = { drive_id: 'd' };
    h.feature = false;
    expect(renderHook(() => useUploadDestination()).result.current).toEqual({ kind: 'private' });
  });

  it('is unknown while settings load and when the settings read fails: never "no library"', () => {
    h.docs.isPending = true;
    expect(renderHook(() => useUploadDestination()).result.current).toEqual({ kind: 'unknown' });
    h.docs = { defaultLibrary: null, isPending: false, defaultError: new Error('boom') };
    expect(renderHook(() => useUploadDestination()).result.current).toEqual({ kind: 'unknown' });
  });
});

describe('document-preview AC-008 recovery copy', () => {
  it.each([
    ['folder', /no SharePoint folder yet.*Nothing was saved/],
    ['consent', /one more permission.*Nothing was saved/],
    ['connection', /Connect your Microsoft account.*Nothing was saved/],
    ['access', /refused the upload.*Nothing was saved/],
    ['entitlement', /isn't set up for Microsoft documents.*Nothing was saved/],
    ['unavailable', /could not store the file.*Nothing was saved/],
    ['invalid', /too large or.*type.*Nothing was saved/],
  ] as const)('%s says nothing was saved', (kind, pattern) => {
    expect(renderHook(() => useUploadFailureText()).result.current(kind)).toMatch(pattern);
  });

  it('an attach failure on a purchase file does not point at a picker that purchase files do not have', () => {
    const text = renderHook(() => useUploadFailureText()).result.current;
    expect(text('attach')).toMatch(/Microsoft picker/);
    const purchase = text('attach', { purchase: true });
    expect(purchase).toMatch(/in SharePoint but was not recorded here/);
    expect(purchase).not.toMatch(/picker/);
  });
});
