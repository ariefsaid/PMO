import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@/src/lib/appError';
import type { DsrReport } from '@/src/lib/db/dailySiteReports';

const h = vi.hoisted(() => ({
  m: { uploadPhoto: { mutateAsync: vi.fn(), isPending: false } },
}));
vi.mock('@/src/hooks/useDailySiteReports', () => ({
  useDailySiteReportMutations: () => h.m,
}));

import { SiteReportPhotos } from './SiteReportPhotos';

const load = (lng: 'en' | 'id', ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));
function makeI18n(lng: 'en' | 'id') {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng,
    fallbackLng: 'en',
    fallbackNS: 'common',
    ns: ['common', 'siteReport'],
    defaultNS: 'siteReport',
    resources: { en: { common: load('en', 'common'), siteReport: load('en', 'siteReport') }, id: { common: load('id', 'common'), siteReport: load('id', 'siteReport') } },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

const report = (status: DsrReport['status']): DsrReport => ({
  id: 'r1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', work_date: '2026-11-20', status,
  version: 1, supersedes_id: null, superseded_at: null, correction_reason: null, author_id: 'u1',
  submitted_at: null, validated_by: null, validated_at: null, returned_reason: null, variant_id: null,
  start_time: null, end_time: null, total_minutes: null, weather_id: null, weather_note: null,
  note: null, crew_id: null, person_id: null,
});

function renderPhotos(report: DsrReport) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={makeI18n('en')}>
        <SiteReportPhotos report={report} photos={[]} canWrite />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.m.uploadPhoto.mutateAsync.mockReset();
  h.m.uploadPhoto.isPending = false;
});

describe('#2897 photos on a submitted site report', () => {
  it('a submitted report offers no upload control on any path, even if the caller passes canWrite', () => {
    renderPhotos(report('submitted'));
    expect(screen.queryByRole('button', { name: 'Photo of paper form' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Other photo' })).not.toBeInTheDocument();
    // The hidden file input carries an aria-label, so it stays reachable while the buttons are
    // hidden — the upload path itself must go with the buttons.
    expect(document.querySelector('[data-testid="dsr-photo-input"]')).toBeNull();
  });

  it('a draft report still offers both upload controls', () => {
    renderPhotos(report('draft'));
    expect(screen.getByRole('button', { name: 'Photo of paper form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other photo' })).toBeInTheDocument();
  });

  it.each([
    ['en', 'Photos can be added only before the report is submitted.'],
    ['id', 'Foto hanya dapat ditambahkan sebelum laporan dikirim.'],
  ] as const)('%s: the server refusal on a submitted report reads as the plain sentence, with no Retry', async (lng, sentence) => {
    h.m.uploadPhoto.mutateAsync.mockRejectedValueOnce(
      new AppError('new row violates row-level security policy for table "dsr_photos"', '42501'),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={makeI18n(lng)}>
          <SiteReportPhotos report={report('draft')} photos={[]} canWrite />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByTestId('dsr-photo-input'), file);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent('Update failed');
    expect(alert).not.toHaveTextContent("You don't have permission to do that.");
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
