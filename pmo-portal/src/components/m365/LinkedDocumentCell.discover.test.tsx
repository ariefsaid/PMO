import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listVersions } from '@/src/lib/m365/graphClient';
import type { MicrosoftReference, ReferenceOwner } from '@/src/lib/m365/reference';
import { LinkedDocumentCell } from './LinkedDocumentCell';
import { DocumentDriftBadge } from './DocumentDriftBadge';

vi.mock('@/src/lib/m365/graphClient', () => ({ getItem: vi.fn(), listVersions: vi.fn() }));

const SP_URL = 'https://tenant.sharepoint.com/sites/synthetic/Shared%20Documents/Plan.docx';
const ref: MicrosoftReference = {
  drive_id: 'drive-1', item_id: 'item-1', web_url: SP_URL, name: 'Plan.docx', item_kind: 'file',
  linked_by: 'user-1', linked_at: '2026-10-01T09:00:00Z', last_verified_at: null,
};
const owner = (over: Partial<Extract<ReferenceOwner, { kind: 'project' }>> = {}): ReferenceOwner => ({
  kind: 'project', id: 'doc-1', status: 'Approved', content_tag_at_issue: 'tag-1', version_id_at_issue: '2.0',
  drift_state: 'drifted', last_verified_at: '2026-10-10T08:00:00Z', ...over,
});
const ACCESS = /Access depends on your Microsoft permissions/;

beforeEach(() => {
  vi.mocked(listVersions).mockResolvedValue({ value: [{ id: '2.0', modified_at: '2026-09-01T10:00:00Z' }], next: null, unsupported_count: 0 } as never);
});

const loadCatalogue = (lng: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/common.json`), 'utf8')) as Record<string, unknown>;
async function inLocale(lng: 'en' | 'id', ui: React.ReactElement) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: 'en', defaultNS: 'common', resources: { en: { common: loadCatalogue('en') }, id: { common: loadCatalogue('id') } } });
  return render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>);
}

describe('F1: compact register cell', () => {
  it('F1: shows icon + file label, ONE pill and ONE Open action — no access sentence, versions or history per row', () => {
    render(<MemoryRouter><LinkedDocumentCell compact reference={ref} owner={owner()} title="Plan" /></MemoryRouter>);
    expect(screen.getByText('SharePoint file')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open latest in SharePoint: Plan' })).toHaveTextContent(/^Open$/);
    expect(screen.queryByText(ACCESS)).not.toBeInTheDocument();
    // The as-of date stays (AC-M365DOC-035) but only on a changed file.
    expect(screen.getByText(/^Checked /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Versions of|approved version history/i })).not.toBeInTheDocument();
    expect(screen.getByText('Changed')).toBeInTheDocument();
    // The full meaning stays available to assistive tech.
    expect(screen.getByText('since approval')).toHaveClass('sr-only');
  });

  it('F1: the full (Drawer) cell still states the access sentence once and keeps Versions', () => {
    render(<MemoryRouter><LinkedDocumentCell reference={ref} owner={owner()} title="Plan" /></MemoryRouter>);
    expect(screen.getAllByText(ACCESS)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Versions of Plan' })).toBeInTheDocument();
  });
});

describe('F2: narrow containers', () => {
  it('F2: the compact cell and its drift pill can shrink and wrap instead of clipping', () => {
    const { container } = render(<MemoryRouter><LinkedDocumentCell compact reference={ref} owner={owner()} title="Plan" /></MemoryRouter>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('min-w-0');
    expect(screen.getByText('Changed').closest('div')).toHaveClass('flex-wrap', 'min-w-0');
    expect(screen.getByRole('button')).toHaveClass('whitespace-normal!');
  });
});

describe('F3: Bahasa Indonesia', () => {
  it('F3: cell, drift pill and Versions modal render in Indonesian with no English leftovers', async () => {
    await inLocale('id', <LinkedDocumentCell reference={ref} owner={owner()} title="Plan" />);
    expect(screen.getByText('File SharePoint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Buka versi terbaru di SharePoint/ })).toBeInTheDocument();
    expect(screen.getByText('Berubah sejak disetujui')).toBeInTheDocument();
    expect(screen.getByText(/Akses bergantung pada izin Microsoft Anda/)).toBeInTheDocument();
    await act(async () => { await userEvent.click(screen.getByRole('button', { name: 'Versi dari Plan' })); });
    expect(await screen.findByRole('dialog', { name: 'Versi Plan.docx' })).toBeInTheDocument();
    expect(await screen.findByText('Versi 2.0')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Tutup' }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Versions|Open in|Unchanged|Loading|Done\b|Close\b/);
  });

  it('F3: the drift badge covers clean / not-verified in Indonesian', async () => {
    const view = await inLocale('id', <DocumentDriftBadge status="Approved" driftState="clean" lastVerifiedAt="2026-10-10T08:00:00Z" />);
    expect(view.container.textContent).toMatch(/Tidak berubah sejak disetujui/);
    view.unmount();
    await inLocale('id', <DocumentDriftBadge status="Issued" driftState={null} lastVerifiedAt={null} />);
    expect(screen.getByText('Belum diverifikasi')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Not verified/);
  });
});

