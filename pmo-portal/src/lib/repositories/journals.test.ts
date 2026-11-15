import { describe, vi } from 'vitest';
import * as dal from '@/src/lib/db/journals';
import { journalRepository } from './journals';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/journals');

describe('journalRepository (#895)', () => {
  itDelegates(journalRepository as never, dal, [
    ['submit', 'submitJournal', ['j1']],
    ['list', 'listJournals', ['2026-11-01', '2026-11-30']],
    ['get', 'getJournal', ['j1']],
    ['ledgerSetup', 'getLedgerSetup', []],
    ['saveDraft', 'saveJournalDraft', [{ id: null, kind: 'fee', date: '2026-11-15', memo: 'Bank fee', lines: [] }]],
    ['approve', 'approveJournal', ['j1']],
    ['returnToMaker', 'returnJournal', ['j1', 'wrong account']],
    ['requestReversal', 'requestJournalReversal', ['j1', '2026-11-20', 'posted twice']],
    ['setDeskJournal', 'setDeskJournal', ['7']],
  ]);
});

import { expect, it } from 'vitest';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn(async () => ({ externalRecordId: 'account.move:1', canonical: {} })) }));

describe('journalRepository.post (#895 FR-ACD-022)', () => {
  it('sends only the journal id to the accounting dispatch: the server re-reads the approved journal and builds the body', async () => {
    await journalRepository.post('89500000-0000-0000-0000-0000000000A1');
    expect(dispatchDomainCommand).toHaveBeenCalledWith(
      'accounting', 'create',
      { id: '89500000-0000-0000-0000-0000000000a1', erp_doc_kind: 'manual-journal' },
      { idempotencyKey: 'journal:89500000-0000-0000-0000-0000000000a1' },
    );
  });
});
