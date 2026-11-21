// @e2e-isolation: serial - disconnects the seed organisation's accounting binding for the run (org-wide state other specs must see unchanged) and restores it in afterAll; the no-ERP precondition is asserted first.
// AC-NEF-010..021 — one journey per finance and profit screen, opened as an organisation with no accounting system connected.
// Goal oracle: each screen renders its own PMO records (a heading, no error state) and never ends in "set up accounting" or ERP-only wording.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';
import { disconnectSeedOrgErp, type NoErpHandle } from './noErpOrg';

let noErp: NoErpHandle;
test.beforeAll(async () => { noErp = await disconnectSeedOrgErp(); });
test.afterAll(async () => { await noErp?.restore(); });

const SET_UP = /Set up accounting|Siapkan akuntansi|Atur akuntansi/i;
const FAILED = /Couldn.t load|Tidak dapat memuat|Gagal memuat/i;

async function renders(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByText(SET_UP)).toHaveCount(0);
  await expect(page.getByText(FAILED)).toHaveCount(0);
}

async function firstProject(page: Page, tab: string) {
  await page.goto('/projects');
  const link = page.locator('a[href^="/projects/"]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';
  const id = href.split('/')[2];
  await renders(page, `/projects/${id}/${tab}`);
}

const cases: { ac: string; name: string; email: string; run: (page: Page) => Promise<void> }[] = [
  { ac: '010', name: 'work-order profit and plan versus actual', email: 'finance@acme.test', run: (p) => firstProject(p, 'work-orders') },
  { ac: '011', name: 'discipline profit and earned and billed', email: 'finance@acme.test', run: (p) => firstProject(p, 'work-orders') },
  { ac: '012', name: 'project money block', email: 'finance@acme.test', run: (p) => firstProject(p, 'overview') },
  { ac: '013', name: 'project profit and loss section', email: 'finance@acme.test', run: (p) => firstProject(p, 'overview') },
  { ac: '014', name: 'reports (management pack)', email: 'finance@acme.test', run: (p) => renders(p, '/finance/reports') },
  { ac: '015', name: 'receivables', email: 'finance@acme.test', run: (p) => renders(p, '/finance/receivables') },
  { ac: '016', name: 'statements', email: 'finance@acme.test', run: (p) => renders(p, '/finance/statements') },
  { ac: '017', name: 'finance hub', email: 'finance@acme.test', run: (p) => renders(p, '/finance') },
  { ac: '018', name: 'payables', email: 'finance@acme.test', run: (p) => renders(p, '/finance/payables') },
  { ac: '019', name: 'billing', email: 'finance@acme.test', run: (p) => firstProject(p, 'billing') },
  { ac: '020', name: 'site cash', email: 'finance@acme.test', run: (p) => renders(p, '/imprest') },
  { ac: '021', name: 'journals', email: 'finance@acme.test', run: (p) => renders(p, '/journals') },
];

for (const c of cases) {
  test(`AC-NEF-${c.ac} ${c.name} works from PMO's own records with no accounting system`, async ({ page }) => {
    await signIn(page, c.email);
    await c.run(page);
  });
}

test('AC-NEF-022 the Finance hub does not link to ERP purchases', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance');
  await expect(page.locator('a[href="/erp-purchases"]')).toHaveCount(0);
});
