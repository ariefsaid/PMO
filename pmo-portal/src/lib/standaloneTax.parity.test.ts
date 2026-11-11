import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateStandaloneTax } from './taxTreatment';
import { suggestVat } from './vendorWithholding';

/**
 * Cross-runtime parity for the standalone tax figures: the SAME vector set embedded in the
 * pgTAP file drives both the SQL authority (calculate_standalone_tax_amount and the stored
 * trigger result, asserted there) and the TypeScript calculator here, including inclusive and
 * exclusive bases, the 11/12 reduced base, half-cent midpoints and the domain bounds.
 */
const sql = readFileSync('../supabase/tests/standalone_tax_parity.test.sql', 'utf8');
interface TaxVector {
  name: string; amount: number; treatment: 'inclusive' | 'exclusive'; rate: number;
  numerator: number; denominator: number; tax: number; net: number; gross: number;
}
const vectors: TaxVector[] = JSON.parse(sql.split('$vectors$')[1]);

describe('shared standalone-tax vectors', () => {
  it('loads the vector set shared with the SQL parity test', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
  });

  for (const vector of vectors) {
    it(`${vector.name}: the calculator matches the SQL answer`, () => {
      expect(calculateStandaloneTax(vector.amount, vector.treatment, vector.rate, {
        numerator: vector.numerator, denominator: vector.denominator,
      })).toEqual({ netAmount: vector.net, taxAmount: vector.tax, grossAmount: vector.gross });
    });
    if (vector.numerator === 1 && vector.denominator === 1) {
      it(`${vector.name}: the vendor suggestion is the standalone answer`, () => {
        expect(suggestVat(vector.amount, vector.treatment, vector.rate)).toBe(vector.tax);
      });
    }
  }
});
