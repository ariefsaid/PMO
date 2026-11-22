import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { waitingForText } from './waitingFor';

const t = i18next.createInstance();
await t.init({
  lng: 'en', resources: { en: { translation: {} }, id: { translation: {
    approvals: { waitingFor: { named: 'Menunggu {{who}}', or: ' atau ', plain: 'Menunggu persetujuan', withStep: 'Menunggu {{who}} (langkah {{n}} dari {{of}})' } } } } },
  interpolation: { escapeValue: false },
});

describe('fix-waiting item 3: a waiting record names who it waits for', () => {
  it('AC-WAIT-031 names the person, their role and the step', () => {
    expect(waitingForText({ names: ['Ani'], role: 'Finance', step: { n: 1, of: 2 } }, t.t)).toBe('Waiting for Ani, Finance (step 1 of 2)');
  });
  it('AC-WAIT-032 several people who can decide are joined with "or"', () => {
    expect(waitingForText({ names: ['Ani', 'Budi'], role: 'Finance' }, t.t)).toBe('Waiting for Ani or Budi, Finance');
  });
  it('AC-WAIT-033 a role with nobody named, and a single decision, omit what is not known', () => {
    expect(waitingForText({ names: [], role: 'Project Manager', step: { n: 1, of: 1 } }, t.t)).toBe('Waiting for Project Manager');
  });
  it('AC-WAIT-034 nothing known falls back to the plain sentence', () => {
    expect(waitingForText({ names: [] }, t.t)).toBe('Waiting for approval');
    expect(waitingForText({ names: ['  '] }, t.t)).toBe('Waiting for approval');
  });
  it('AC-WAIT-035 the same sentence is worded in Bahasa Indonesia', async () => {
    await t.changeLanguage('id');
    expect(waitingForText({ names: ['Ani'], role: 'Finance', step: { n: 1, of: 2 } }, t.t)).toBe('Menunggu Ani, Finance (langkah 1 dari 2)');
    expect(waitingForText({ names: [] }, t.t)).toBe('Menunggu persetujuan');
  });
});
