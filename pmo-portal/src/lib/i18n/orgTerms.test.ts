import { describe, it, expect } from 'vitest';
import { applyOrgTerms, matchCase, rowsToOrgTerms } from './orgTerms';

const wo = (singular: string, plural: string) => ({ en: { workOrder: { singular, plural } } });

describe('AC-TERM-002 applyOrgTerms', () => {
  it('renames singular and plural, keeping case shape', () => {
    const t = wo('job card', 'job cards');
    expect(applyOrgTerms('Work order saved', 'en', t)).toBe('Job card saved');
    expect(applyOrgTerms('3 work orders open', 'en', t)).toBe('3 job cards open');
    expect(applyOrgTerms('WORK ORDERS', 'en', t)).toBe('JOB CARDS');
    expect(applyOrgTerms('Open Work Orders', 'en', t)).toBe('Open Job Cards');
  });
  it('leaves text alone with no override, other locale, or partial words', () => {
    expect(applyOrgTerms('Work order', 'en', {})).toBe('Work order');
    expect(applyOrgTerms('Work order', 'id', wo('x', 'xs'))).toBe('Work order');
    expect(applyOrgTerms('projected', 'en', { en: { project: { singular: 'job', plural: 'jobs' } } })).toBe('projected');
  });
  it('renames in Bahasa Indonesia', () => {
    const t = { id: { project: { singular: 'pekerjaan', plural: 'pekerjaan' } } };
    expect(applyOrgTerms('Semua proyek', 'id', t)).toBe('Semua pekerjaan');
    expect(applyOrgTerms('Proyek baru', 'id-ID', t)).toBe('Pekerjaan baru');
  });
  it('does not rewrite the replacement as another term', () => {
    const terms = { en: { workOrder: { singular: 'project', plural: 'projects' }, project: { singular: 'job', plural: 'jobs' } } };
    expect(applyOrgTerms('Work order and project', 'en', terms)).toBe('Project and job');
  });
  it('renames the multi-word terms', () => {
    const t = { en: { clientSuppliedStock: { singular: 'free-issue stock', plural: 'free-issue stock' } } };
    expect(applyOrgTerms('Client-supplied stock', 'en', t)).toBe('Free-issue stock');
  });
  it('matchCase', () => {
    expect(matchCase('Project', 'job')).toBe('Job');
    expect(matchCase('project', 'Job')).toBe('job');
  });
  it('rowsToOrgTerms drops unknown keys and locales', () => {
    const m = rowsToOrgTerms([
      { term_key: 'workOrder', locale: 'en', singular: 'a', plural: 'as' },
      { term_key: 'invoice', locale: 'en', singular: 'b', plural: 'bs' },
      { term_key: 'project', locale: 'fr', singular: 'c', plural: 'cs' },
    ]);
    expect(m).toEqual({ en: { workOrder: { singular: 'a', plural: 'as' } } });
  });
});
