import { describe, expect, it } from 'vitest';
import { matchesProjectClassification, parseClassificationOptions } from './projectClassification';

const project = {
  service_line: 'Engineering', sector: 'Energy', location: 'West Java',
  award_type: 'tender', bidding_entity: 'consortium',
};

describe('AC-TAG-002 classification filter intersection', () => {
  it('keeps all historical unclassified projects when no classification filter is chosen', () => {
    expect(matchesProjectClassification({}, {})).toBe(true);
  });
  it('matches every selected classification and location text without changing the project', () => {
    expect(matchesProjectClassification(project, {
      serviceLine: 'Engineering', sector: 'Energy', location: 'JAVA',
      awardType: 'tender', biddingEntity: 'consortium',
    })).toBe(true);
    expect(project.location).toBe('West Java');
  });
  it.each([
    { serviceLine: 'Consulting' }, { sector: 'Transport' }, { location: 'Sumatra' },
    { awardType: 'direct' }, { biddingEntity: 'alone' },
  ])('excludes a project when one selected classification disagrees: %j', (filter) => {
    expect(matchesProjectClassification(project, filter)).toBe(false);
  });
  it('does not make an unclassified project match an authored classification', () => {
    expect(matchesProjectClassification({}, { serviceLine: 'Engineering' })).toBe(false);
  });
  it('retains a retired option as an exact filter rather than replacing it with a current option', () => {
    expect(matchesProjectClassification({ service_line: 'Legacy practice' }, { serviceLine: 'Legacy practice' })).toBe(true);
    expect(matchesProjectClassification(project, { serviceLine: 'Legacy practice' })).toBe(false);
  });
});

describe('AC-TAG-001 org option-list input', () => {
  it('trims option lines, discards blank lines and keeps Unicode labels', () => {
    expect(parseClassificationOptions(' Engineering \n\n Énergie\r\nTransport ')).toEqual(['Engineering', 'Énergie', 'Transport']);
  });
  it('deduplicates exact labels while preserving the first occurrence and declared order', () => {
    expect(parseClassificationOptions('Energy\nEnergy\nenergy')).toEqual(['Energy', 'energy']);
  });
  it('lets an Admin deliberately empty an org-defined list', () => {
    expect(parseClassificationOptions(' \n ')).toEqual([]);
  });
});
