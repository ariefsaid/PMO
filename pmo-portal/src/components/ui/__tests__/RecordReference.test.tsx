import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordReference } from '../RecordReference';

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));

function renderIdReference() {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { id: { common: idCatalogue }, en: { common: enCatalogue } },
    initImmediate: false,
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <RecordReference ids={['8f2c1a44-2b3d-4e5f-9a01-6c7d8e9f0a1b']} />
    </I18nextProvider>,
  );
}

describe('RecordReference (plain-words C20-3b/3c)', () => {
  it('C20-3b: keeps a raw record id behind a closed disclosure labelled Reference', () => {
    render(<RecordReference ids={['8f2c1a44-2b3d-4e5f-9a01-6c7d8e9f0a1b']} />);

    const reference = screen.getByTestId('record-reference');
    expect(reference.tagName).toBe('DETAILS');
    expect((reference as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(reference).toHaveTextContent('8f2c1a44-2b3d-4e5f-9a01-6c7d8e9f0a1b');
  });

  it('C20-3b: the disclosure label is translated — an Indonesian session reads Referensi, not English', () => {
    renderIdReference();

    expect(screen.getByText('Referensi')).toBeInTheDocument();
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
  });

  it('C20-3b: lists several ids and drops the empty ones instead of printing a bare separator', () => {
    render(<RecordReference ids={['first-id', null, '  ', 'second-id']} />);

    expect(screen.getByTestId('record-reference')).toHaveTextContent('first-id, second-id');
  });

  it('C20-3b: renders nothing when there is no id to show', () => {
    const { container } = render(<RecordReference ids={[null, undefined, '']} className="mt-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
