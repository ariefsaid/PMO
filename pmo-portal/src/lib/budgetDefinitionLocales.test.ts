import { describe, expect, it } from 'vitest';
import enProject from '../../public/locales/en/project.json';
import idProject from '../../public/locales/id/project.json';
import enFinance from '../../public/locales/en/finance.json';
import idFinance from '../../public/locales/id/finance.json';
import enDashboard from '../../public/locales/en/dashboard.json';
import idDashboard from '../../public/locales/id/dashboard.json';

describe('budget definition translations', () => {
  it('keeps the category over-budget status short in both languages', () => {
    expect(enProject.projectDetail.budget.overBudget).toBe('Over budget');
    expect(idProject.projectDetail.budget.overBudget).toBe('Melebihi anggaran');
  });
  it('defines used as spending against the active budget in English and Indonesian', () => {
    const definitions = [
      [enProject.projectDetail.cost.summaryTooltip, idProject.projectDetail.cost.summaryTooltip],
      [enProject.projectDetail.cost.summaryTooltipLedger, idProject.projectDetail.cost.summaryTooltipLedger],
      [enProject.projectDetail.budget.canonicalUtilizationFormula, idProject.projectDetail.budget.canonicalUtilizationFormula],
      [enFinance.projectDetail.budget.canonicalUtilizationFormula, idFinance.projectDetail.budget.canonicalUtilizationFormula],
      [enDashboard.home.budgetUsedHelp, idDashboard.home.budgetUsedHelp],
      [enDashboard.home.pm.help, idDashboard.home.pm.help],
    ];
    const relatedDefinitions = [
      [enProject.projectDetail.cost.committedTooltip, idProject.projectDetail.cost.committedTooltip],
      [enProject.projectDetail.budget.leftFormula, idProject.projectDetail.budget.leftFormula],
      [enFinance.projectDetail.budget.leftFormula, idFinance.projectDetail.budget.leftFormula],
      [enFinance.projectDetail.budget.committedSource, idFinance.projectDetail.budget.committedSource],
    ];
    for (const [en, id] of [...definitions, ...relatedDefinitions]) {
      expect(en).toBeTruthy();
      expect(id).toBeTruthy();
      expect(id).not.toMatch(/konsumsi|pengeluaran\s*(?:ditambah|\+)\s*pesanan/i);
    }
    for (const [en, id] of definitions) {
      expect(en).toMatch(/spen(?:t|ding).*budget/i);
      expect(id).toMatch(/pengeluaran.*anggaran aktif/i);
      expect(id).not.toMatch(/konsumsi|anggaran yang dipilih|pengeluaran\s*(?:ditambah|\+)\s*pesanan/i);
    }
  });
});
