import { describe, expect, it } from 'vitest';
import { activeClassificationCount, classificationValueLabel, matchesProjectClassification, parseClassificationOptions, pickClassification } from './projectClassification';
import type { ProjectClassificationFilters } from './projectClassification';
import type { TFunction } from 'i18next';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

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
  it.each<ProjectClassificationFilters>([
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

describe('classification helpers (#830)', () => {
  it.each([['tender', 'Tender'], ['direct', 'Direct award'], ['alone', 'Alone'], ['consortium', 'Consortium']])(
    'AC-TAG-002 labels %s as its own label', (value, label) => expect(classificationValueLabel(t, value)).toBe(label));
  it('AC-TAG-002 shows an unknown stored value as stored instead of collapsing it to Direct award', () => {
    expect(classificationValueLabel(t, 'negotiated')).toBe('negotiated');
  });
  it('AC-TAG-002 counts only the set classification filters', () => {
    expect(activeClassificationCount({})).toBe(0);
    expect(activeClassificationCount({ sector: 'Energy', awardType: 'direct', location: '' })).toBe(2);
  });
  it('AC-TAG-002 picks only the five classification fields from a full row', () => {
    expect(pickClassification({ ...project, name: 'x' } as typeof project)).toEqual(project);
  });
});
