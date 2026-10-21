import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readPair } from './check-m365-record-folder-reversal.mjs';

test('0335 rollback is limited to its four RPCs and three indexes', () => {
  const { up, down } = readPair();
  for (const name of ['m365_link_record_folder','m365_record_folder_created','m365_record_folder_candidates','m365_record_folder_default_matches']) {
    assert.match(up, new RegExp(`function public\\.${name}\\(`));
    assert.match(down, new RegExp(`drop function if exists public\\.${name}\\(`));
  }
  for (const name of ['project_documents_folder_parent_idx','procurement_documents_folder_parent_idx','m365_folder_created_identity_idx']) {
    assert.match(up, new RegExp(`index ${name}`));
    assert.match(down, new RegExp(`drop index if exists public\\.${name}`));
  }
  assert.doesNotMatch(down, /drop table|drop policy|delete from|truncate/i);
  assert.doesNotMatch(up, /grant update[^;]*org_m365_document_settings/is);
  assert.equal(fs.readFileSync(new URL('../supabase/migrations/0292_m365_document_linking.sql', import.meta.url), 'utf8').includes('m365_record_folder'), false);
});
