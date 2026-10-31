// @e2e-isolation: self-isolated — read-only: the Microsoft connection, Graph reads, the folder step and the project-documents / profile reads are page.route-mocked or rewritten with synthetic rows; nothing is written to the database or to Microsoft.
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import {
  DRAFT_TITLE,
  enableM365Feature,
  forceBahasa,
  mockCustody,
  openDocuments,
  registerRow,
  seedLinkedRows,
} from './support/m365-documents-mocks';

/**
 * #1020 Discover findings F3/F5/F6 — the DOWN lane's remaining rows (wiring + localization), moved
 * to shared mocks in e2e/support/m365-documents-mocks.ts. The geometry rows (F1, F2/F4, F10) live
 * in the /projects/:id layout sweep (e2e/layout/project-detail.layout.spec.ts).
 *
 *   F5  a "needs a choice" folder outcome offers a working "Choose existing folder";
 *   F6  the not-connected setup link goes to the page every role can open (/integrations);
 *   F3  in Bahasa the Microsoft strings are Indonesian.
 */

test.setTimeout(120_000);

test.describe('#1020 Discover wiring and localization (mocked Microsoft)', () => {
  test('F5: a folder step that needs a choice offers "Choose existing folder", which opens the picker', async ({ page }) => {
    await mockCustody(page, { connected: true, ensure: { state: 'needs_choice' } });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    await page.getByRole('button', { name: 'Create folder in SharePoint' }).click();
    const choose = page.getByRole('button', { name: 'Choose existing folder' });
    await expect(choose).toBeVisible();
    await choose.click();
    await expect(page.getByRole('dialog', { name: /Choose a Microsoft document/ })).toBeVisible();
  });

  test('F6: the not-connected notice links to the page every role can open (/integrations)', async ({ page }) => {
    await mockCustody(page, { connected: false });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    await page.getByRole('button', { name: 'Link from Microsoft 365', exact: true }).click();
    const gate = page.getByTestId('m365-connection-gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('link')).toHaveAttribute('href', '/integrations');
  });

  test('F3: in Bahasa the Microsoft cell, picker and unlink confirmation are Indonesian', async ({ page }) => {
    await mockCustody(page, { connected: true });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await forceBahasa(page);
    await login(page, 'admin@acme.test');
    await openDocuments(page, 'Dokumen');

    const row = registerRow(page, DRAFT_TITLE);
    await expect(row).toBeVisible();
    await expect(row.getByText('File SharePoint')).toBeVisible();
    await expect(row.getByText('SharePoint file')).toHaveCount(0);

    // Unlink confirmation (opened, then dismissed: nothing is written).
    await row.hover();
    await row.getByRole('button', { name: 'Tindakan baris' }).click();
    await page.getByRole('menuitem', { name: 'Lepas tautan item Microsoft' }).click();
    await expect(page.getByText(`Lepas tautan ${DRAFT_TITLE}?`)).toBeVisible();
    await expect(page.getByText('Hanya referensi PMO yang dihapus. Item Microsoft tidak berubah.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(`Lepas tautan ${DRAFT_TITLE}?`)).toHaveCount(0);

    // Picker.
    await page.getByRole('button', { name: 'Tautkan dari Microsoft 365', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Pilih dokumen Microsoft' });
    await expect(picker).toBeVisible();
    await expect(picker.getByText('Pilih lokasi')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'OneDrive saya' })).toBeVisible();
    await expect(picker.getByText('Choose a location')).toHaveCount(0);
  });
});
