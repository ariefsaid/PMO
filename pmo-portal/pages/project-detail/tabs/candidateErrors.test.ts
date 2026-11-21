import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { candidateErrorText } from './candidateErrors';

const t = ((_key: string, fallback: string, opts?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? ''))) as TFunction;

describe('candidateErrors', () => {
  it('AC-CWO-002 names the unmet checks when a candidate cannot be approved', () => {
    expect(candidateErrorText(new Error('CWO_NOT_READY: not ready: medical, badge'), t)).toBe('These required checks are not ready: medical, badge');
  });

  it('AC-CWO-004 says when the candidate was already decided', () => {
    expect(candidateErrorText(new Error('CWO_DECIDED: gone'), t)).toBe('This candidate has already been decided.');
  });

  it('AC-CWO-003 demands a note to mark a check not applicable', () => {
    expect(candidateErrorText(new Error('CWO_NA_NOTE: need note'), t)).toBe('Add a note to mark this not applicable.');
  });

  it('AC-CWO-005 bounds the rejection reason', () => {
    expect(candidateErrorText(new Error('CWO_REASON: too long'), t)).toBe('Give a reason of 1 to 500 characters.');
  });

  it('AC-CWO-007 refuses to replace anything but a rejected candidate of the same project', () => {
    expect(candidateErrorText(new Error('CWO_REPLACES: wrong project'), t)).toBe('Only a rejected candidate of this project can be replaced.');
  });

  it('falls back to the shared classifier for anything else', () => {
    expect(candidateErrorText(new Error('boom'), t)).toContain('Update failed');
  });
});
