import { describe, expect, it } from 'vitest';
import { proposeMatches } from '../connect/match.ts';
import { createOdooHarness } from '../odoo/contract.harness.ts';
import { assertMatchContractOracle, MATCH_FIXTURES } from './match.suite.ts';

describe('account match contract oracle', () => {
  it('rejects a dropped duplicate account candidate when an unrelated row preserves the total count', async () => {
    const fixture = MATCH_FIXTURES.account!;
    // Keep the remaining candidate on the account name-review path so the old output-derived oracle accepts one review ID.
    const oracleFixture = {
      ...fixture,
      pmo: fixture.pmo.map((row) => row.id === 'Labor' ? { ...row, code: 'PMO-LABOR' } : row),
    };
    const connect = createOdooHarness().connect?.();
    const calls = connect?.calls;
    if (!connect?.load || !calls) throw new Error('Odoo matching harness has no connect fixture');
    connect.load('account', fixture.erp);
    const page = await connect.adapter.listMasters('account', null);
    const candidates = page.rows.filter((row) => fixture.review[0].rows.some((selector) => row.code === selector.code && row.name === selector.name));
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((row) => row.externalId)).size).toBe(2);

    const dropped = page.rows.filter((row) => row.externalId !== candidates[1].externalId);
    const unmatchedErp = fixture.unmatchedErp;
    if (!unmatchedErp) throw new Error('Odoo matching fixture has no unmatched-account selector');
    const unrelated = dropped.find((row) => row.code === unmatchedErp.code && row.name === unmatchedErp.name);
    if (!unrelated) throw new Error('Odoo matching fixture has no unrelated account row');
    const corrupted = [...dropped, { ...unrelated, externalId: `${unrelated.externalId}-duplicate` }];
    expect(corrupted).toHaveLength(page.rows.length);
    expect(corrupted.filter((row) => row.name === unrelated.name && row.code === unrelated.code)).toHaveLength(2);

    const out = proposeMatches('account', oracleFixture.pmo, corrupted);
    const reviews = out.filter((row) => row.outcome === 'review');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].externalIds).toHaveLength(1);
    expect(() => assertMatchContractOracle('account', oracleFixture, {
      all: corrupted,
      out,
      pages: 1,
      extraRows: 0,
      writes: calls().writes,
    })).toThrow(/account review selector 0 candidate multiplicity/);
  });
});
