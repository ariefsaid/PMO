import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enViewer from '@/public/locales/en/documentViewer.json';
import idViewer from '@/public/locales/id/documentViewer.json';
import { DocumentViewerProvider } from './DocumentViewerProvider';
import { deferred, target } from './testkit';
import { Harness } from './Harness';
import { useDocumentViewer } from './viewerContext';
import { useState } from 'react';
import { PreviewFailure, type DocumentViewTarget, type PreviewResult } from './types';

async function i18nFor(lng: 'en' | 'id') {
  const i18n = createInstance();
  await i18n.init({
    lng,
    fallbackLng: false,
    defaultNS: 'common',
    resources: { en: { common: {}, documentViewer: enViewer }, id: { common: {}, documentViewer: idViewer } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

async function mount(lng: 'en' | 'id', targets: DocumentViewTarget[]) {
  const i18n = await i18nFor(lng);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter><DocumentViewerProvider><Harness targets={targets} /></DocumentViewerProvider></MemoryRouter>
    </I18nextProvider>,
  );
}

const state = (name: string, load: DocumentViewTarget['load']) =>
  target({ name, key: name, sourceLabel: 'SharePoint', download: vi.fn(), openInSource: { url: 'https://tenant.sharepoint.com/sites/x/a.docx' }, load });
const result = (r: PreviewResult) => async () => r;
const never = () => deferred<PreviewResult>().promise;

const STATES: Array<[string, () => DocumentViewTarget]> = [
  ['loading', () => state('Loading.pdf', never)],
  ['ready (embed)', () => state('Embed.docx', result({ mode: 'embed', provider: 'microsoft', url: 'https://tenant.sharepoint.com/embed' }))],
  ['ready (image)', () => state('Image.png', result({ mode: 'image', url: 'https://signed.test/a.png' }))],
  ['denied', () => state('Denied.docx', async () => { throw new PreviewFailure('access_denied'); })],
  ['unsupported', () => state('Plan.dwg', result({ mode: 'unsupported' }))],
];

describe('document-preview AC-013 accessibility', () => {
  describe.each(['en', 'id'] as const)('%s', (lng) => {
    it.each(STATES)('%s has no axe violations, a named dialog, and titled content', async (_label, make) => {
      const t = make();
      await mount(lng, [t]);
      await userEvent.click(screen.getByRole('button', { name: `${lng === 'en' ? 'Preview' : 'Preview'} ${t.name}` }));
      const dialog = await screen.findByRole('dialog', { name: t.name });
      await waitFor(() => expect(within(dialog).queryByRole('status') ?? within(dialog).queryByRole('alert') ?? dialog.querySelector('iframe, img')).toBeTruthy());
      // jsdom cannot cross into an embedded frame; the frame's own accessible name is asserted below.
      expect(await axe(document.body, { iframes: false })).toHaveNoViolations();
      dialog.querySelectorAll('iframe').forEach((frame) => expect(frame).toHaveAttribute('title', t.name));
      dialog.querySelectorAll('img').forEach((img) => expect(img).toHaveAttribute('alt', t.name));
    });
  });

  it('announces loading politely and failures as alerts, in Indonesian too', async () => {
    const pending = state('Loading.pdf', never);
    await mount('id', [pending]);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Loading.pdf' }));
    expect(await screen.findByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Memuat pratinjau…');
  });

  it('Tab cycles inside the panel, Shift+Tab wraps, Escape closes and focus returns to the opener', async () => {
    const t = state('Image.png', result({ mode: 'image', url: 'https://signed.test/a.png' }));
    await mount('en', [t]);
    const opener = screen.getByRole('button', { name: 'Preview Image.png' });
    opener.focus();
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Image.png' });
    await screen.findByRole('img');
    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    last.focus();
    // The library parks focus on a guard for a tick, then moves it back inside the panel.
    await userEvent.tab();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.tab({ shift: true });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closing when the opener no longer exists leaves focus safely on the page', async () => {
    const t = state('Image.png', result({ mode: 'image', url: 'https://signed.test/a.png' }));
    function Vanishing() {
      const viewer = useDocumentViewer();
      const [gone, setGone] = useState(false);
      return gone ? null : <button onClick={(e) => { viewer.open(t, e.currentTarget); setGone(true); }}>Preview vanishing</button>;
    }
    const i18n = await i18nFor('en');
    render(<I18nextProvider i18n={i18n}><MemoryRouter><DocumentViewerProvider><Vanishing /></DocumentViewerProvider></MemoryRouter></I18nextProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Preview vanishing' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.contains(document.activeElement)).toBe(true);
  });

  it('the title is one truncated line with the full title available, the facts line is its description, and a backdrop press closes it', async () => {
    const long = 'A very long document title that will not fit on a single line of the viewer header.pdf';
    const t = target({ name: long, key: long, sourceLabel: 'SharePoint', detail: 'Rev B · Approved', load: result({ mode: 'image', url: 'https://signed.test/a.png' }) });
    await mount('en', [t]);
    const opener = screen.getByRole('button', { name: `Preview ${long}` });
    opener.focus();
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: long });
    expect(within(dialog).getByRole('heading', { name: long })).toHaveAttribute('title', long);
    expect(dialog).toHaveAccessibleDescription('Rev B · Approved · Source: SharePoint');
    await userEvent.click(screen.getByTestId('viewer-scrim'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  describe('on a phone', () => {
    const matchMedia = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    });
    afterEach(() => { window.matchMedia = matchMedia; });

    it('Close stays in the header and Download and Open in source sit below the document', async () => {
      const t = state('Image.png', result({ mode: 'image', url: 'https://signed.test/a.png' }));
      await mount('en', [t]);
      await userEvent.click(screen.getByRole('button', { name: 'Preview Image.png' }));
      const dialog = await screen.findByRole('dialog', { name: 'Image.png' });
      const image = await within(dialog).findByRole('img');
      const follows = (el: HTMLElement) => Boolean(image.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(within(dialog).getByRole('button', { name: 'Download' }))).toBe(true);
      expect(follows(within(dialog).getByRole('button', { name: 'Open in SharePoint' }))).toBe(true);
      expect(follows(within(dialog).getByRole('button', { name: 'Close' }))).toBe(false);
    });
  });

  it('on a desktop every action sits in the header, above the document', async () => {
    const t = state('Image.png', result({ mode: 'image', url: 'https://signed.test/a.png' }));
    await mount('en', [t]);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Image.png' }));
    const dialog = await screen.findByRole('dialog', { name: 'Image.png' });
    const image = await within(dialog).findByRole('img');
    for (const name of ['Download', 'Open in SharePoint', 'Close']) {
      expect(Boolean(image.compareDocumentPosition(within(dialog).getByRole('button', { name })) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true);
    }
  });
});
