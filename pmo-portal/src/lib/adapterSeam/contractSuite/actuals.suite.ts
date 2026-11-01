/**
 * actuals.read (v1) — PMO sums the ERP ledger and never invents a figure (ADR-0048). Money is attributed to a PMO
 * project only through an unambiguous link; anything else stays visibly unattributed, never folded into a project.
 */
import { describe, expect, it } from 'vitest';
import type { ActualsLine, ErpHarness } from './harness.ts';

const PROJ_A = '11111111-1111-4111-8111-111111111111';
const PROJ_B = '22222222-2222-4222-8222-222222222222';
const line = (over: Partial<{ project: string | null; account: string; fiscalYear: string; debit: number; credit: number; costCentre: string | null }>) =>
  ({ project: 'PROJ-0001', costCentre: null, account: '5100', fiscalYear: '2026', debit: 0, credit: 0, ...over });
const byProject = (lines: ActualsLine[]) => Object.fromEntries(lines.map((l) => [String(l.pmoProjectId), l]));

export function actualsReadSuite(h: ErpHarness): void {
  describe(`actuals.read (${h.tier})`, () => {
    it('AC-ENA-060 sums ledger lines per cost centre, account and fiscal year; net is debit minus credit', async () => {
      const centre = 'Main - PSC';
      const lines = await h.readActuals({
        projectLinks: {},
        ledger: [
          line({ project: null, costCentre: centre, account: 'Creditors - PSC', credit: 50000 }),
          line({ project: null, costCentre: centre, account: 'Stock Received But Not Billed - PSC', debit: 50000 }),
          // a second row in the SAME group adds into the group sum
          line({ project: null, costCentre: centre, account: 'Creditors - PSC', credit: 25000 }),
          // a different fiscal year is its own group
          line({ project: null, costCentre: centre, account: 'Creditors - PSC', fiscalYear: '2025', debit: 1000 }),
        ],
      });
      const key = (l: ActualsLine) => `${l.costCentre}|${l.account}|${l.fiscalYear}`;
      const grouped = Object.fromEntries(lines.map((l) => [key(l), l]));
      expect(lines).toHaveLength(3);
      expect(grouped['Main - PSC|Creditors - PSC|2026']).toMatchObject({ debit: 0, credit: 75000, net: -75000 });
      expect(grouped['Main - PSC|Stock Received But Not Billed - PSC|2026']).toMatchObject({ debit: 50000, credit: 0, net: 50000 });
      expect(grouped['Main - PSC|Creditors - PSC|2025']).toMatchObject({ debit: 1000, credit: 0, net: 1000 });
    });

    it('NEW-1 attributes a line to the PMO project linked to its ERP project', async () => {
      const lines = await h.readActuals({ projectLinks: { [PROJ_A]: 'PROJ-0001' }, ledger: [line({ account: '5100 - Direct Costs - PSC', debit: 600000 })] });
      expect(lines).toEqual([expect.objectContaining({ pmoProjectId: PROJ_A, account: '5100 - Direct Costs - PSC', fiscalYear: '2026', net: 600000 })]);
    });

    it('NEW-1 sums per project: two projects on the same account and year never merge', async () => {
      const lines = await h.readActuals({
        projectLinks: { [PROJ_A]: 'PROJ-0001', [PROJ_B]: 'PROJ-0002' },
        ledger: [line({ debit: 100 }), line({ project: 'PROJ-0002', debit: 40 }), line({ debit: 25 })],
      });
      expect(lines).toHaveLength(2);
      expect(byProject(lines)[PROJ_A]).toMatchObject({ net: 125 });
      expect(byProject(lines)[PROJ_B]).toMatchObject({ net: 40 });
    });

    it('NEW-1 a line stating no project is unattributed, never folded into a linked project', async () => {
      const lines = await h.readActuals({ projectLinks: { [PROJ_A]: 'PROJ-0001' }, ledger: [line({ debit: 100 }), line({ project: null, debit: 999 })] });
      expect(lines).toHaveLength(2);
      expect(byProject(lines)[PROJ_A]).toMatchObject({ net: 100 });
      expect(byProject(lines)['null']).toMatchObject({ net: 999 });
    });

    it('NEW-1 a project no PMO project is linked to stays unattributed, never given to another project', async () => {
      const lines = await h.readActuals({ projectLinks: { [PROJ_A]: 'PROJ-0001' }, ledger: [line({ project: 'PROJ-9999', debit: 500 })] });
      expect(lines).toEqual([expect.objectContaining({ pmoProjectId: null, net: 500 })]);
    });

    it('NEW-1 an ambiguous link (two PMO projects claim one ERP project) attributes to neither', async () => {
      const lines = await h.readActuals({ projectLinks: { [PROJ_A]: 'PROJ-0001', [PROJ_B]: 'PROJ-0001' }, ledger: [line({ debit: 700 })] });
      expect(lines).toEqual([expect.objectContaining({ pmoProjectId: null, net: 700 })]);
    });
  });
}
