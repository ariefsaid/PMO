import { describe, it, expect } from 'vitest';
import { floatChoiceOptions } from './floatDisplay';

const base = { float_id: 'f1', custodian_name: 'Cass Custodian', remaining: 10, currency: 'IDR', project_name: '' };

describe('#1635 float picker labels', () => {
  it('labels a float by project with the custodian as secondary text', () => {
    expect(floatChoiceOptions([{ ...base, project_name: 'Harbour Upgrade' }])).toEqual([{ value: 'f1', label: 'Harbour Upgrade · Cass Custodian' }]);
  });
  it('falls back to the custodian when the project is unknown', () => {
    expect(floatChoiceOptions([base])).toEqual([{ value: 'f1', label: 'Cass Custodian' }]);
  });
  it('two floats of one custodian stay distinguishable even on one project', () => {
    const out = floatChoiceOptions([
      { ...base, project_name: 'Harbour', currency: 'IDR' },
      { ...base, float_id: 'f2', project_name: 'Harbour', currency: 'USD' },
    ]);
    expect(out[0].label).not.toBe(out[1].label);
    expect(out[1].label).toContain('Harbour · Cass Custodian');
  });
  it('identical floats get a neutral numbered suffix, never the amount', () => {
    const out = floatChoiceOptions([{ ...base, project_name: 'Harbour' }, { ...base, float_id: 'f2', project_name: 'Harbour' }]);
    expect(out.map((o) => o.label)).toEqual(['Harbour · Cass Custodian (IDR) · float 1', 'Harbour · Cass Custodian (IDR) · float 2']);
  });
});
