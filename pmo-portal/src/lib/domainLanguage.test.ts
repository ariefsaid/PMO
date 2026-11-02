// @vitest-environment node
/**
 * T-36 (#1568) domain-language guards: `docs/GLOSSARY.md` is the binding domain vocabulary
 * (its header: "when everyday usage conflicts with a definition below, the definition wins").
 * These guards pin the financial/purchasing language decisions at their lowest sufficient layer
 * so a future edit cannot silently reintroduce the contradictions the 2026-10-29 audit found:
 *  - Committed spend is per-currency open commitment (ledger orgs net out held amounts),
 *    not a full Σ of case totals (XD1-001 / XD2-001, THEME-CROSS-42).
 *  - Actual / Recorded spending follows the one-figure rule: mapped ledger cost when the org
 *    reads its ledger, otherwise the committed-purchase proxy — never "same number, same basis".
 *  - Active contract value is unearned contract value of Ongoing projects, per currency —
 *    distinct from earned revenue, with no "Revenue on hand" tile left to compare to
 *    (XD1-002 / XD1-009, THEME-CROSS-43).
 *  - A procurement case is optionally project-linked, and the purchase/supplier UI aliases are
 *    recorded while "procurement record" stays reserved for typed child documents
 *    (XD2-002 / XD2-003 / XD4-001, THEME-CROSS-50).
 *  - External reference (outside document) and Group reference (the group's own number) are
 *    separate, and no universal "every record carries both" claim remains
 *    (XD2-004, THEME-CROSS-51).
 *  - The canonical budget/attribution, progress-billing and expense/vendor-tax terms exist
 *    (XD4-002 / XD4-003 / XD4-005, THEME-CROSS-57/58/60).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const GLOSSARY = readFileSync(join(ROOT, 'docs', 'GLOSSARY.md'), 'utf8');

/**
 * One glossary entry: from its `**Term**` heading (at line start — mid-line mentions in other
 * entries don't count) to the next blank line (entries are paragraphs). Headings that START with
 * the term match, so "Actual" finds "**Actual (Recorded spending)**".
 */
function entry(term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = GLOSSARY.match(new RegExp(`\\n\\*\\*${escaped}[^*]*\\*\\*[^\\n]*[\\s\\S]*?(?=\\n\\n)`));
  expect(match, `glossary entry starting "**${term}**" must exist`).not.toBeNull();
  return match![0];
}

describe('T-36 committed spend and actuals language (THEME-CROSS-42)', () => {
  it('Committed spend is per-currency open commitment, not a full sum of case totals', () => {
    const committed = entry('Committed spend');
    expect(committed).toMatch(/open commitment/i);
    expect(committed).not.toMatch(/Σ `total_value` of all procurement records/);
    expect(committed).toMatch(/currenc/i);
    // Ledger orgs net out amounts the ledger already holds; the full total is the proxy basis.
    expect(committed).toMatch(/already holds/);
    expect(committed).toMatch(/proxy/i);
  });

  it('Actual / Recorded spending is the one figure with a stated basis, never "same number, same basis"', () => {
    const actual = entry('Actual');
    expect(actual).not.toMatch(/same number, same basis/i);
    expect(actual).not.toMatch(/a UI label for \*\*Committed spend\*\*/);
    expect(actual).toMatch(/Recorded spending/);
    expect(actual).toMatch(/ledger cost/i);
    expect(actual).toMatch(/proxy/i);
  });
});

describe('T-36 portfolio contract-value language (THEME-CROSS-43)', () => {
  it('Active contract value is contract value on hand, not earned revenue, and defines its own status filter', () => {
    const active = entry('Active contract value');
    expect(active).toMatch(/Ongoing/);
    expect(active).toMatch(/earned revenue/i);
    expect(active).toMatch(/currenc/i);
    expect(active).not.toMatch(/Revenue on hand/);
    expect(active).toMatch(/Contract on hand/);
  });

  it('the glossary no longer compares against the retired "Revenue on hand" tile', () => {
    expect(GLOSSARY).not.toMatch(/Revenue on hand/);
  });
});

describe('T-36 procurement case and record language (THEME-CROSS-50)', () => {
  it('the case is optionally project-linked', () => {
    expect(entry('Procurement (case)')).toMatch(/optional project/);
  });

  it('the purchase and supplier UI aliases are recorded and "record" stays reserved for documents', () => {
    const procCase = entry('Procurement (case)');
    expect(procCase).toMatch(/purchase/i);
    expect(procCase).toMatch(/supplier/i);
    expect(entry('Vendor invoice')).toMatch(/Supplier invoice/);
  });

  it('each procure-to-pay child document and the case item have their own canonical entry', () => {
    for (const term of [
      'Purchase request',
      'Quotation',
      'Purchase order',
      'Goods receipt',
      'Vendor invoice',
      'Procurement payment',
      'Procurement item',
    ]) {
      expect(entry(term), `"${term}" must be defined`).toBeTruthy();
    }
  });
});

describe('T-36 external and group references (THEME-CROSS-51)', () => {
  it('Group reference is defined separately from the outside document reference', () => {
    const group = entry('Group reference');
    expect(group).toMatch(/Group ref/);
    expect(group).toMatch(/External reference number/);
    const external = entry('External reference number');
    expect(external).toMatch(/optional/i);
    expect(external).toMatch(/External ref/);
  });

  it('no universal claim that every record carries the references remains', () => {
    expect(GLOSSARY).not.toMatch(/every (Procurement )?record carries both/i);
  });
});

describe('T-36 canonical budget, billing and expense terms (THEME-CROSS-57/58/60)', () => {
  it('budget and cost attribution terms are defined alongside Committed spend', () => {
    for (const term of ['Budget version', 'Budget line item', 'Budget projection', 'Cost attribution rule']) {
      expect(entry(term), `"${term}" must be defined`).toBeTruthy();
    }
  });

  it('progress and billing terms are defined', () => {
    for (const term of [
      'Bill of quantities item',
      'Project progress entry',
      'Progress assessment quantity',
      'Progress claim',
      'Progress claim line',
      'Claim evidence',
      'Sales invoice',
      'Incoming payment',
    ]) {
      expect(entry(term), `"${term}" must be defined`).toBeTruthy();
    }
  });

  it('expense and vendor tax terms are defined', () => {
    for (const term of [
      'Expense claim',
      'Cash advance',
      'Expense claim line',
      'Advance return',
      'Expense claim evidence',
      'Vendor withholding slip',
    ]) {
      expect(entry(term), `"${term}" must be defined`).toBeTruthy();
    }
  });
});
