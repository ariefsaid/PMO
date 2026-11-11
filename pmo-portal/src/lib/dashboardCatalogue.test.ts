import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('company dashboard money catalogue copy', () => {
  it('AC-UX-S03-I1: English and Indonesian explain billed margin and currency scope honestly', () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/dashboard.json'), 'utf8'));
    const id = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/dashboard.json'), 'utf8'));
    const marginHelp = en.hub.company.help.margin as string;
    const contractHelp = en.hub.company.help.contract as string;
    expect(marginHelp.toLowerCase()).toContain('billed-work revenue');
    expect(marginHelp.toLowerCase()).toContain('not cash received');
    expect(marginHelp.toLowerCase()).toContain('percentage is unavailable');
    expect(contractHelp.toLowerCase()).toContain('each project currency');
    expect(contractHelp.toLowerCase()).toContain('complete recorded actuals');
    expect(id.hub.company.help.margin).toContain('bukan kas');
    expect(id.hub.company.help.contract).toContain('mata uang masing-masing proyek');
    for (const catalogue of [en, id]) {
      expect(catalogue.finance.contractValue).toBeTruthy();
    }
  });
});
