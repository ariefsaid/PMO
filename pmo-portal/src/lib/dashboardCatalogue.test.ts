import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('dashboard money catalogue copy', () => {
  it('AC-UX-S03-I1: English help avoids overstating margin or portfolio spend scope', () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
    const id = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));
    const marginHelp = en.dashboard.kpi.revenueOnHand.help as string;
    const spendHelp = en.dashboard.kpi.totalSpend.help as string;
    expect(marginHelp.toLowerCase()).not.toMatch(/revenue remaining after actual costs/);
    expect(marginHelp.toLowerCase()).toContain('billed work');
    expect(spendHelp.toLowerCase()).not.toContain('top projects');
    expect(spendHelp.toLowerCase()).not.toContain('deferred follow-up');
    expect(spendHelp.toLowerCase()).toContain('on-hand portfolio actual');
    for (const catalogue of [en, id]) {
      expect(catalogue.uxs03.contractValueOnHand).toBeTruthy();
      expect(catalogue.uxs03.contractValueInProgress).toBeTruthy();
    }
  });
});
