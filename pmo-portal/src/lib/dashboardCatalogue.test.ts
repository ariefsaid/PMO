import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('dashboard money catalogue copy', () => {
  it('AC-UX-S03-I1: English help avoids overstating margin or portfolio spend scope', () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/dashboard.json'), 'utf8'));
    const id = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/dashboard.json'), 'utf8'));
    const marginHelp = en.exec.marginDefinition as string;
    const spendHelp = en.exec.actualDefinition as string;
    expect(marginHelp.toLowerCase()).not.toMatch(/revenue remaining after actual costs/);
    expect(marginHelp.toLowerCase()).toMatch(/billed[ -]work/);
    expect(spendHelp.toLowerCase()).not.toContain('top projects');
    expect(spendHelp.toLowerCase()).not.toContain('deferred follow-up');
    expect(spendHelp.toLowerCase()).toContain('erp-ledger actual');
    for (const catalogue of [en, id]) {
      expect(catalogue.finance.contractValue).toBeTruthy();
    }
  });
});
