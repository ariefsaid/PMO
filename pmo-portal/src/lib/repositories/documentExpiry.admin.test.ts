import { describe, vi } from 'vitest';
import * as dal from '@/src/lib/db/documentExpiry';
import { documentExpiryRepository } from './documentExpiry';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/documentExpiry');

describe('documentExpiryRepository admin methods (#2614)', () => {
  itDelegates(documentExpiryRepository as never, dal, [
    ['listAdminTypes', 'listAdminDocumentTypes', []],
    ['createType', 'createDocumentType', [{ name: 'A', applies_to: 'person', is_medical: false, notify_roles: [] }]],
    ['updateType', 'updateDocumentType', ['t1', { name: 'B', notify_roles: [] }]],
    ['archiveType', 'archiveDocumentType', ['t1']],
    ['getWarningDays', 'getDocumentWarningDays', []],
    ['setWarningDays', 'setDocumentWarningDays', [[30, 7]]],
  ]);
});
