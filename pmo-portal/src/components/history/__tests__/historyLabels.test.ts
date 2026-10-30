import { describe, expect, it } from 'vitest';
import { fieldLabels } from '../historyLabels';
import en from '../../../../public/locales/en/common.json';
import id from '../../../../public/locales/id/common.json';

describe('SP-7 supplier history labels', () => {
  it('calls vendor_id Supplier in English and Pemasok in Indonesian', () => {
    const translate = (key: string, options: { defaultValue?: string } | string) =>
      typeof options === 'string' ? options : options.defaultValue ?? key;
    const labels = fieldLabels(translate as never);
    expect(labels.vendor_id).toBe('Supplier');
    expect(en.history.field.vendor_id).toBe('Supplier');
    expect(id.history.field.vendor_id).toBe('Pemasok');
  });
});
