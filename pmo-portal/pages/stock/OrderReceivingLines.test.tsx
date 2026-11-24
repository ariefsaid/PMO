import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '@/public/locales/en/stock.json';
import id from '@/public/locales/id/stock.json';
import { OrderReceivingLines } from './OrderReceivingLines';

describe('order receiving counted lines', () => {
  for (const language of ['en', 'id']) {
    it(`AC-RGO-012 explains unmapped lines and never asks receivers for stock items or price (${language})`, async () => {
      const instance = i18next.createInstance();
      await instance.init({ lng: language, resources: { en: { stock: en }, id: { stock: id } }, defaultNS: 'stock' });
      render(<I18nextProvider i18n={instance}><OrderReceivingLines lines={[
        { id: 'a', name: 'Goods', stock_item_id: 'stock', stock_name: 'Goods', unit: 'pc' },
        { id: 'b', name: 'Service', stock_item_id: null, stock_name: null, unit: null },
      ]} quantities={{}} onChange={() => {}} /></I18nextProvider>);
      expect(screen.getByText(language === 'en' ? 'Service or direct use: use the existing receipt path.' : 'Jasa atau pemakaian langsung: gunakan penerimaan yang sudah ada.')).toBeInTheDocument();
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveAccessibleName(language === 'en' ? 'Counted quantity · Goods (pc)' : 'Jumlah dihitung · Goods (pc)');
    });
  }
});
