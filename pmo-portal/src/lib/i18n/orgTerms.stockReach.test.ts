/** AC-TR-004 (#2799 slice B1): the stock transfer, stock return and checkpoint screens' own catalogue
 *  copy carries a form the rewriter knows, so an organisation's rename reaches the screen in both
 *  languages. The tests bind the shipped catalogues on disk and the shipped rewriter/plugin, and pin
 *  the two boundaries this slice must not cross: a namespace-scoped common word stays out of stock
 *  copy, and neither a work-order transfer nor an Odoo posting sentence is rewritten.
 *  The canonical AC-TR-004 journey remains `orgTerms.i18next.test.ts`; this file is the slice's reach proof. */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { applyOrgTerms, setOrgTerms, SHIPPED_FORMS, shippedTerm, type OrgTerms } from './orgTerms';

const ROOT = resolve(__dirname, '../../../..');

/** A shipped catalogue exactly as the guard reads it (public/locales/<lang>/<ns>.json). */
function catalogue(lang: 'en' | 'id', ns: string): Record<string, string | object> {
  return JSON.parse(readFileSync(resolve(ROOT, `pmo-portal/public/locales/${lang}/${ns}.json`), 'utf8')) as Record<string, string | object>;
}

/** An i18next instance over the real catalogue, with the same terminology plugin the app installs. */
async function screen(lang: 'en' | 'id', ns: string) {
  const inst = i18next.createInstance();
  await inst.use(orgTermsPlugin).init({
    lng: lang,
    fallbackLng: 'en',
    ns: [ns],
    defaultNS: ns,
    resources: { en: { [ns]: catalogue('en', ns) }, id: { [ns]: catalogue('id', ns) } },
  });
  return inst;
}

/** Every leaf string of a catalogue, so a test can prove how much of one screen a rename reaches. */
function leaves(node: unknown, prefix = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === 'string') out.push([prefix, node]);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) leaves(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

afterEach(() => setOrgTerms({}));

describe('AC-TR-004 the checkpoint key ships the word the Bahasa screens already use', () => {
  it('keeps "checkpoint" as the shown default and adds "titik pemeriksaan" for the rewriter', () => {
    expect(shippedTerm('id', 'checkpoint')).toEqual({ singular: 'checkpoint', plural: 'checkpoint' });
    expect(SHIPPED_FORMS.id.checkpoint.singular).toContain('titik pemeriksaan');
    expect(SHIPPED_FORMS.id.checkpoint.plural).toContain('titik pemeriksaan');
  });

  it('renames the checkpoint titles the administration and site-report screens already render', async () => {
    const admin = await screen('id', 'administration');
    const report = await screen('id', 'siteReport');
    setOrgTerms({ id: { checkpoint: { singular: 'titik kontrol', plural: 'titik kontrol' } } });
    expect(admin.t('admin.siteCheckpoints.title')).toBe('Titik kontrol harian');
    expect(admin.t('admin.siteCheckpoints.add')).toBe('Tambah titik kontrol');
    expect(report.t('checkpoints.title')).toBe('Titik kontrol');
    expect(report.t('checkpoints.flag')).toBe('Titik kontrol terlambat hari ini');
  });
});

describe('AC-TR-004 a renamed stock transfer reaches the stock screens in English', () => {
  const renamed = (): OrgTerms => ({ en: { stockTransfer: { singular: 'yard move', plural: 'yard moves' } } });

  it('rewrites the page title, navigation, action, kind label and status phrases', async () => {
    const stock = await screen('en', 'stock');
    setOrgTerms(renamed());
    expect(stock.t('transfers.title')).toBe('Yard moves');
    expect(stock.t('tabs.transfers')).toBe('Yard moves');
    expect(stock.t('transfers.detailTitle')).toBe('Yard move');
    expect(stock.t('transfers.send')).toBe('Send yard move');
    expect(stock.t('kinds.transfer')).toBe('Yard move');
    expect(stock.t('transfers.notFound')).toBe('Yard move not found');
    expect(stock.t('transfers.sentToast')).toBe('Yard move sent');
    expect(stock.t('transfers.back')).toBe('Back to yard moves');
    expect(stock.t('transferSettings.mode')).toBe('How yard moves are made');
    expect(stock.t('transferSettings.inTransit', { count: 2 })).toBe(
      '2 yard moves are in transit. Switch back to one step after they are received or recalled.',
    );
  });

  it('rewrites the return kind, posting action and posting confirmation', async () => {
    const stock = await screen('en', 'stock');
    setOrgTerms({ en: { stockReturn: { singular: 'reversal', plural: 'reversals' } } });
    expect(stock.t('kinds.return')).toBe('Reversal from project');
    expect(stock.t('form.submit.return')).toBe('Post reversal');
    expect(stock.t('form.confirmPost.title.return')).toBe('Post this reversal?');
  });
});

describe('AC-TR-004 the same rename reaches the Bahasa stock screens', () => {
  it('rewrites the stock-transfer and stock-return surfaces with the organisation word', async () => {
    const stock = await screen('id', 'stock');
    setOrgTerms({
      id: {
        stockTransfer: { singular: 'pindah gudang', plural: 'pindah gudang' },
        stockReturn: { singular: 'pulang gudang', plural: 'pulang gudang' },
      },
    });
    expect(stock.t('transfers.title')).toBe('Pindah gudang');
    expect(stock.t('tabs.transfers')).toBe('Pindah gudang');
    expect(stock.t('transfers.send')).toBe('Kirim pindah gudang');
    expect(stock.t('transfers.notFound')).toBe('Pindah gudang tidak ditemukan');
    expect(stock.t('kinds.transfer')).toBe('Pindah gudang');
    expect(stock.t('kinds.return')).toBe('Pulang gudang dari proyek');
    expect(stock.t('form.submit.return')).toBe('Posting pulang gudang');
  });
});

describe('AC-TR-004 a rename respects namespaces and other transfer concepts', () => {
  it('leaves the scoped common word "issue" alone in stock copy, and renames it where it is scoped', async () => {
    const stock = await screen('en', 'stock');
    const incidents = await screen('en', 'incidents');
    setOrgTerms({
      en: {
        issue: { singular: 'concern', plural: 'concerns' },
        stockTransfer: { singular: 'yard move', plural: 'yard moves' },
      },
    });
    expect(stock.t('form.submit.issue')).toBe('Post issue');
    expect(stock.t('kinds.transfer')).toBe('Yard move');
    expect(incidents.t('detail.taskLinked')).toBe('A task was created for this concern.');
  });

  it('leaves work-order transfers and Odoo posting copy untouched', async () => {
    const stock = await screen('en', 'stock');
    setOrgTerms({
      en: {
        stockTransfer: { singular: 'yard move', plural: 'yard moves' },
        stockReturn: { singular: 'reversal', plural: 'reversals' },
      },
    });
    expect(stock.t('workOrderTransfer.detailTitle')).toBe('Work-order transfer');
    expect(stock.t('workOrderTransfer.returnHalf')).toBe('Return from the first work order');
    expect(stock.t('detail.erp.heldNoReason')).toBe('Odoo needs a person to look at this transfer.');
  });
});

describe('FR-TR-004 the aligned copy reaches many stock strings, not one token', () => {
  const changedCount = (values: string[], terms: OrgTerms) =>
    values.filter((value) => applyOrgTerms(value, 'en', terms) !== value).length;

  it('a stock-transfer rename changes at least eight English strings', () => {
    const values = leaves(catalogue('en', 'stock')).map(([, value]) => value);
    expect(changedCount(values, { en: { stockTransfer: { singular: 'yard move', plural: 'yard moves' } } })).toBeGreaterThanOrEqual(8);
  });

  it('a stock-return rename changes at least three English strings', () => {
    const values = leaves(catalogue('en', 'stock')).map(([, value]) => value);
    expect(changedCount(values, { en: { stockReturn: { singular: 'reversal', plural: 'reversals' } } })).toBeGreaterThanOrEqual(3);
  });
});

describe('FR-TR-012 the resolved allowances are retired and the unbuilt concepts stay excused', () => {
  const allowlist = JSON.parse(readFileSync(resolve(ROOT, 'scripts/locale-terms-allowlist.json'), 'utf8')) as Array<{
    file: string;
    key: string;
    rule: string;
    term: string;
    reason: string;
  }>;

  it('keeps only the two pre-seeded concepts, each with a reason', () => {
    expect(allowlist.map((entry) => entry.key).sort()).toEqual([
      'serviceRequest',
      'serviceRequest',
      'surveyQuantity',
      'surveyQuantity',
    ]);
    expect(allowlist.every((entry) => entry.rule === 'R2' && entry.reason.trim().length > 0)).toBe(true);
  });

  it('no stock-transfer, stock-return or checkpoint allowance remains', () => {
    for (const retired of ['stockTransfer', 'stockReturn', 'checkpoint']) {
      expect(allowlist.some((entry) => entry.key === retired), retired).toBe(false);
    }
  });
});
