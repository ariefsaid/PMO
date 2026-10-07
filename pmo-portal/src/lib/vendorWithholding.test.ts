import { describe, expect, it } from 'vitest';
import { withholdingFigures } from './vendorWithholding';

describe('withholdingFigures (#876, DD-VWH-6)', () => {
  it('AC-VWH-010 net payable is the gross bill minus the tax withheld, in exact cents', () => {
    expect(withholdingFigures(1110000, 110000, 20000)).toEqual({ vat: 110000, withheld: 20000, netPayable: 1090000 });
    expect(withholdingFigures(1234567.89, 135802.47, 24691.36)).toEqual({ vat: 135802.47, withheld: 24691.36, netPayable: 1209876.53 });
  });

  it('AC-VWH-010 no figures when nothing was withheld or a figure is unknown', () => {
    expect(withholdingFigures(1110000, 110000, 0)).toBeNull();
    expect(withholdingFigures(1110000, 110000, null)).toBeNull();
    expect(withholdingFigures(1110000, 110000, undefined)).toBeNull();
    expect(withholdingFigures(null, 110000, 20000)).toBeNull();
    expect(withholdingFigures(1110000, null, 20000)).toBeNull();
    expect(withholdingFigures(1110000, 110000, Number.NaN)).toBeNull();
  });

  it('AC-VWH-010 a return (negative bill) keeps its sign', () => {
    expect(withholdingFigures(-1110000, -110000, -20000)).toEqual({ vat: -110000, withheld: -20000, netPayable: -1090000 });
  });
});
