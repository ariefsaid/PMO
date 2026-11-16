/**
 * #895 — Odoo's `journal()` harness for the shared journal suites: the SHIPPED Odoo journal adapter and recovery over the
 * in-memory JSON-2 fake (fakeOdoo + journal/fakeJournal.ts), answered in PMO terms. It runs the ADR-0058 sequence the
 * dispatch runs: the anchor probe first, a write only on a miss, and a retry after a lost answer is a recovery that follows
 * the tier's reissue policy (Odoo: hold, OBS-ACD-002).
 */
import { AppError } from '../../appError.ts';
import { AdapterError, type CommandResult } from '../contract.ts';
import type { JournalHarness } from '../contractSuite/harness.ts';
import type { LedgerJournal } from '../ledgerJournal.ts';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { ACCOUNTING_DOMAIN, createOdooJournalAdapter, ODOO_JOURNAL_REISSUE_ON_INCONCLUSIVE_ABSENCE, recoverOdooJournal } from './journal/adapter.ts';
import { DESK_JOURNAL_CONFIG_KEY } from './journal/body.ts';
import { parseOdooExternalRef } from './purchase/anchors.ts';

const TODAY = '2026-11-15';
const UUID = /([0-9a-f]{8})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{12})$/i;

/** The PMO key an anchor name was made from (`externalIdentifier` maps every non-alphanumeric to `_`). */
function keyOf(name: string): string {
  const m = UUID.exec(name);
  if (!m) return '';
  const id = m.slice(1).join('-');
  return name.startsWith('journal_rev_') ? `journal-rev:${id}` : name.startsWith('journal_') ? `journal:${id}` : '';
}

const money = (v: unknown) => Number(v ?? 0).toFixed(2);

export function createOdooJournalHarness(): JournalHarness {
  const fake = createFakeOdoo({ key: 'k', today: TODAY });
  fake.seed('res.company', [{ id: 1, name: 'Co' }]);
  fake.seed('account.journal', [{ id: 9, name: 'Miscellaneous', code: 'MISC', type: 'general' }]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const adapter = createOdooJournalAdapter({ call, bindingConfig: { [DESK_JOURNAL_CONFIG_KEY]: 9 }, today: () => TODAY });
  const inDoubt = new Set<string>();
  let armed = false;
  const answer = (r: CommandResult) => ({
    externalId: r.externalRecordId, status: r.canonical.status as 'posted' | 'scheduled', postedDate: (r.canonical.posted_date as string | null) ?? null,
  });
  return {
    today: TODAY,
    async post(j: LedgerJournal) {
      const found = await recoverOdooJournal(call, j, TODAY);
      if (found) { inDoubt.delete(j.key); return answer(found); }
      if (inDoubt.has(j.key) && !ODOO_JOURNAL_REISSUE_ON_INCONCLUSIVE_ABSENCE) {
        throw new AppError('journal held: the ledger may hold it without its anchor', 'command-held');
      }
      if (armed) { armed = false; fake.failAt('after-create'); }
      const id = j.key.slice(j.key.indexOf(':') + 1);
      try {
        return answer(await adapter.commit({ domain: ACCOUNTING_DOMAIN, operation: 'create', idempotencyKey: j.key, record: { id, erp_doc_kind: 'manual-journal', journal: j } }));
      } catch (e) {
        if (e instanceof AdapterError && e.code === 'external-unreachable') inDoubt.add(j.key);
        throw e;
      }
    },
    documents() {
      const anchors = fake.rows('ir.model.data').filter((r) => r.model === 'account.move');
      return fake.rows('account.move').map((m) => ({ externalId: `account.move:${m.id}`, key: keyOf(String(anchors.find((a) => a.res_id === m.id)?.name ?? '')) }));
    },
    lines(externalId) {
      const id = parseOdooExternalRef('account.move', externalId);
      return fake.rows('account.move.line').filter((l) => l.move_id === id).map((l) => ({ account: String(l.account_id), debit: money(l.debit), credit: money(l.credit) }));
    },
    writes: () => fake.calls.filter((c) => ['create', 'write', 'action_post', 'refund_moves', 'unlink'].includes(c.method)).length,
    failNextWrite: () => { armed = true; },
  };
}
