import { describe, expect, it } from 'vitest';
import { receiverCandidates } from './stockReceivers';

const profiles = [
  { id: 'sender', is_active: true, built_in_role: 'engineer' },
  { id: 'keeper', is_active: true, built_in_role: 'engineer' },
  { id: 'otherKeeper', is_active: true, built_in_role: 'engineer' },
  { id: 'foreman', is_active: true, built_in_role: 'foreman' },
  { id: 'gone', is_active: false, built_in_role: 'foreman' },
  { id: 'stranger', is_active: true, built_in_role: 'engineer' },
];
const keepers = [{ user_id: 'keeper', warehouse_id: 'dest' }, { user_id: 'sender', warehouse_id: 'dest' }, { user_id: 'otherKeeper', warehouse_id: 'src' }];

describe('receiverCandidates (#1122 item 1)', () => {
  it('offers keepers of the destination and field accounts, never the sender, an inactive person or an unrelated person', () => {
    expect(receiverCandidates(profiles, keepers, 'dest', 'sender').map((p) => p.id)).toEqual(['keeper', 'foreman']);
  });
  it('offers only field accounts until a destination is chosen', () => {
    expect(receiverCandidates(profiles, keepers, '', 'sender').map((p) => p.id)).toEqual(['foreman']);
  });
});
