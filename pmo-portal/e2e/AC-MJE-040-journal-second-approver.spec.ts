// @e2e-isolation: self-isolated — writes one uniquely-named manual journal per run as the seed Finance user and approves it as the seed Executive; no shared seed row is read or changed.
/**
 * AC-MJE-040 — #895, the one cross-stack journey for a manual journal: Finance drafts a balanced journal and submits it,
 * a DIFFERENT member (the Executive) approves it, and it goes to the ledger. The second approver is the rule under test:
 * the maker never sees Approve on their own journal. The send to the ledger needs a connected ledger; where the lane has
 * none the approval still stands and the drawer says the send failed (the journal is not approved twice).
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { openAppPath, requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const SUPABASE_URL = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
const SERVICE_KEY = requireServiceRoleKey();
const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3';
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1';

test('AC-MJE-040 Finance drafts and submits a journal; the Executive approves it; the maker is never offered Approve', async ({ page }) => {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('AC-MJE-040 needs the local Supabase URL and the service-role key from scripts/e2e-local.sh.');
  const memo = `Bank fee ${crypto.randomUUID().slice(0, 8)}`;

  // Finance: draft → submit.
  await signIn(page, 'finance@acme.test');
  await openAppPath(page, '/journals');
  await page.getByTestId('list-page-header').getByRole('button', { name: 'New journal' }).click();
  const form = page.getByRole('dialog', { name: 'New journal' });
  await form.getByLabel(/Memo/).fill(memo);
  await form.getByRole('group', { name: 'Line 1' }).getByLabel('Account').fill('6100');
  await form.getByRole('group', { name: 'Line 1' }).getByLabel(/^Debit/).fill('10');
  await form.getByRole('group', { name: 'Line 2' }).getByLabel('Account').fill('1010');
  await form.getByRole('group', { name: 'Line 2' }).getByLabel(/^Credit/).fill('10');
  await form.getByRole('button', { name: 'Submit' }).click();
  const own = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: memo }) });
  await expect(own.getByText('Submitted')).toBeVisible();
  // The maker may not approve their own journal (the organisation has more than one member).
  await expect(own.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // Executive: approve.
  await signIn(page, 'exec@acme.test');
  await openAppPath(page, '/journals');
  await page.getByRole('button', { name: new RegExp(`Open ${memo}`) }).click();
  const drawer = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: memo }) });
  await drawer.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog', { name: 'Approve this journal?' }).getByRole('button', { name: 'Approve' }).click();

  // The approval is the second person's, whatever the ledger answers afterwards. The lane has no connected ledger, so the
  // journal rests at exactly 'approved'; 'posted' belongs to AC-MJE-003 (the ledger's answer), not to this journey.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await expect.poll(async () => {
    const { data } = await admin.from('journal_entries').select('status, approver_id, maker_id').eq('memo', memo).maybeSingle();
    return data ? { approver: data.approver_id, maker: data.maker_id, status: data.status } : null;
  }, { timeout: 30_000 }).toEqual({ approver: EXEC_ID, maker: FINANCE_ID, status: 'approved' });
});
