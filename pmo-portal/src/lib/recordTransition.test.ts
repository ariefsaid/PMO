// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyReturnedRecordTitle,
  claimRecordTitle,
  recordIdFromPath,
  recordTransitionAllowed,
  recordTransitionName,
  resetRecordTransition,
  supportsViewTransitions,
} from './recordTransition';

const withMotionPreference = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));

const named = () => [...document.querySelectorAll<HTMLElement>('[data-record-title]')].filter((el) => el.style.getPropertyValue('view-transition-name') !== '');

beforeEach(() => {
  document.body.innerHTML = '';
  resetRecordTransition();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).startViewTransition;
});

describe('record transition (#2148)', () => {
  it('names a record from its id, safely', () => {
    expect(recordTransitionName('a1-B_2')).toBe('record-a1-B_2');
    expect(recordTransitionName('x y;{}')).toBe('record-xy');
    expect(recordIdFromPath('/projects/abc-1')).toBe('abc-1');
    expect(recordIdFromPath('/projects/abc-1/finance')).toBeUndefined();
    expect(recordIdFromPath('/projects')).toBeUndefined();
  });

  it('AC-4 without View Transitions the transition is never allowed (navigation stays as before)', () => {
    withMotionPreference(false);
    expect(supportsViewTransitions()).toBe(false);
    expect(recordTransitionAllowed()).toBe(false);
  });

  it('AC-3 under reduced motion the transition is never allowed, even where the API exists', () => {
    (document as unknown as Record<string, unknown>).startViewTransition = () => ({});
    withMotionPreference(true);
    expect(supportsViewTransitions()).toBe(true);
    expect(recordTransitionAllowed()).toBe(false);
  });

  it('allows the transition when the API exists and motion is allowed', () => {
    (document as unknown as Record<string, unknown>).startViewTransition = () => ({});
    withMotionPreference(false);
    expect(recordTransitionAllowed()).toBe(true);
  });

  it('AC-5 in a list of several hundred rows only the clicked row carries a name, and a second click moves it', () => {
    document.body.innerHTML = Array.from({ length: 400 }, (_, i) => `<button data-record-title="id-${i}">row ${i}</button>`).join('');
    claimRecordTitle('id-5', 'in');
    expect(named().map((el) => el.getAttribute('data-record-title'))).toEqual(['id-5']);
    claimRecordTitle('id-7', 'in');
    expect(named().map((el) => el.getAttribute('data-record-title'))).toEqual(['id-7']);
    expect(named()[0].style.getPropertyValue('view-transition-name')).toBe('record-id-7');
  });

  it('marks the direction for the stylesheet, so leaving a record runs shorter', () => {
    claimRecordTitle('id-1', 'out');
    expect(document.documentElement.getAttribute('data-record-transition')).toBe('out');
  });

  it('AC-2 a list that mounts after an explicit return re-claims only the row it was opened from', () => {
    claimRecordTitle('id-2', 'out');
    document.body.innerHTML = '<button data-record-title="id-1">1</button><button data-record-title="id-2">2</button>';
    document.querySelectorAll<HTMLElement>('[data-record-title]').forEach((el) => applyReturnedRecordTitle(el.getAttribute('data-record-title')!, el));
    expect(named().map((el) => el.getAttribute('data-record-title'))).toEqual(['id-2']);
  });
});
