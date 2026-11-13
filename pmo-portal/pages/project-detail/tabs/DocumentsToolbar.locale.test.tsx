/**
 * C4 (untranslated text) — the status family, rendered.
 *
 * `src/lib/status/statusMap.ts` already holds the one status vocabulary and `StatusPill` reads it,
 * but a screen can still print the STORED state (a database enum) instead of the shared name. The
 * document register's status filter did exactly that: `{status}` for each `<option>`, so an
 * Indonesian reader filtered by "Draft", "Issued", "Approved" above a translated register.
 *
 * The test renders the real toolbar under an `id` i18n instance built from the SHIPPED catalogues
 * (never a hand-copied fixture) and asserts what a person reads in the filter: the Bahasa names.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import DocumentsToolbar from './DocumentsToolbar';

const catalogue = (lng: 'en' | 'id', namespace: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'public/locales', lng, `${namespace}.json`), 'utf8'));

const namespaces = ['common', 'project', 'status'] as const;

function renderToolbar() {
  const i18n = i18next.createInstance();
  // Synchronous init (no async gap) mirrors test/setup.ts's own instance.
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      id: Object.fromEntries(namespaces.map((namespace) => [namespace, catalogue('id', namespace)])),
      en: Object.fromEntries(namespaces.map((namespace) => [namespace, catalogue('en', namespace)])),
    },
    initImmediate: false,
  });
  const noop = () => {};
  return render(
    <I18nextProvider i18n={i18n}>
      <DocumentsToolbar
        registerSize={3}
        search=""
        setSearch={noop}
        categories={['Technical']}
        categoryFilter=""
        setCategoryFilter={noop}
        statusFilter=""
        setStatusFilter={noop}
        sourceFilter=""
        setSourceFilter={noop}
        documentsView="register"
        setDocumentsView={noop}
        canCreateMicrosoftReference={false}
        canCreate={false}
        onLinkMicrosoft={noop}
        onAddDocument={noop}
      />
    </I18nextProvider>,
  );
}

describe('C4 — the document status filter reads Bahasa, not the stored enum', () => {
  it('offers every document state under its Indonesian name', () => {
    renderToolbar();
    for (const label of ['Draf', 'Diterbitkan', 'Disetujui', 'Ditolak', 'Ditutup', 'Digantikan']) {
      expect(screen.getByRole('option', { name: label }), label).toBeInTheDocument();
    }
  });

  it('never offers the stored English state as the label', () => {
    renderToolbar();
    for (const label of ['Draft', 'Issued', 'Approved', 'Rejected', 'Closed', 'Superseded']) {
      expect(screen.queryByRole('option', { name: label }), label).toBeNull();
    }
  });
});
