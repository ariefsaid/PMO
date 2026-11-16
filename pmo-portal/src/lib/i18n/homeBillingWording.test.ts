import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const load = (lng: string, ns: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../public/locales/${lng}/${ns}.json`), 'utf8'));

describe('#2431: Home and the report say the billing words the same way', () => {
  for (const lng of ['en', 'id']) {
    it(`${lng}: "Left to bill" reads one way on the Home tile, the Home card and the report`, () => {
      const dash = load(lng, 'dashboard');
      const hub = load(lng, 'financeHub');
      const label = dash.figures.leftToBill;
      expect(dash.home.leftToBill).toBe(label);
      expect(hub.managementPack.figures.leftToBill).toBe(label);
      expect(dash.home.leftToBillByProject.startsWith(label)).toBe(true);
    });
  }

  it('id: Home names the invoiced figure "Ditagih", the report’s word, never "Ditagihkan"', () => {
    const dash = load('id', 'dashboard');
    expect(JSON.stringify([dash.home, dash.figures])).not.toMatch(/Ditagihkan/);
    expect(load('id', 'dashboard').home.invoiced).toBe('Ditagih');
  });
});
