import { describe, expect, it } from 'vitest';
import { normalizePartyName } from './partyAdopt.ts';

describe('#1600 normalizePartyName — the one name key for setup and the feed (FR-ECA-011)', () => {
  it('folds case, drops legal-form punctuation and collapses spaces', () => {
    expect(normalizePartyName('PT. ACME  Indonesia, Tbk.')).toBe(normalizePartyName('pt acme indonesia tbk'));
    expect(normalizePartyName('PT Acme')).toBe(normalizePartyName('PT. ACME'));
  });
  it('keeps names that differ by a word apart', () => {
    expect(normalizePartyName('PT Acme Indonesia')).not.toBe(normalizePartyName('PT Acme Logistics'));
  });
});
