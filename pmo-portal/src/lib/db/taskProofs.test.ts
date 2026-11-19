import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ from: vi.fn(), storage: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: { from: h.storage } } }));

import { proofRefusal, buildProofPath, addTaskProof, PROOF_MAX_BYTES } from './taskProofs';

const file = (over: Partial<{ size: number; type: string; name: string }> = {}) =>
  ({ size: 1000, type: 'image/jpeg', name: 'Site Photo.JPG', ...over }) as File;

describe('AC-TWOP-012 proof file limits', () => {
  it('accepts a photo, a PDF and an Office document under the cap', () => {
    expect(proofRefusal(file(), 0)).toBeNull();
    expect(proofRefusal(file({ type: 'application/pdf' }), 9)).toBeNull();
    expect(proofRefusal(file({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 0)).toBeNull();
  });
  it('refuses the 11th attachment', () => expect(proofRefusal(file(), 10)).toBe('count'));
  it('refuses a file over 15 MB, and accepts exactly 15 MB', () => {
    expect(proofRefusal(file({ size: PROOF_MAX_BYTES + 1 }), 0)).toBe('size');
    expect(proofRefusal(file({ size: PROOF_MAX_BYTES }), 0)).toBeNull();
  });
  it('refuses a disallowed type', () => {
    expect(proofRefusal(file({ type: 'application/x-msdownload' }), 0)).toBe('type');
    expect(proofRefusal(file({ type: 'text/html' }), 0)).toBe('type');
  });
  it('addTaskProof refuses before any network call', async () => {
    await expect(addTaskProof('t1', file({ type: 'text/html' }), 0)).rejects.toMatchObject({ code: 'proof-type' });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.storage).not.toHaveBeenCalled();
  });
});

describe('proof storage path', () => {
  it('is {org}/{task}/{proof}/{sanitised filename}: four segments, no traversal', () => {
    const p = buildProofPath('org', 'task', 'proof', '../Site Photo.JPG');
    expect(p).toBe('org/task/proof/site-photo.jpg');
    expect(p.split('/')).toHaveLength(4);
  });
});
