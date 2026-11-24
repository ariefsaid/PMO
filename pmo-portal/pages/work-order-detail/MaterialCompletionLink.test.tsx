import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ on: true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.on }));
import { MaterialCompletionLink } from './MaterialCompletionLink';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { h.on = true; });
const renderIt = () => render(<MemoryRouter><MaterialCompletionLink workOrderId="wo1" /></MemoryRouter>);

describe('MaterialCompletionLink (1124d)', () => {
  it('AC-WMC-007 the Close-out group links to the work order material completion', () => {
    renderIt();
    expect(screen.getByTestId('material-completion-link')).toHaveAttribute('href', '/work-orders/wo1/material-completion');
  });
  it('AC-WMC-007 an organisation without the stock module is offered no link', () => {
    h.on = false;
    renderIt();
    expect(screen.queryByTestId('material-completion-link')).not.toBeInTheDocument();
  });
});
