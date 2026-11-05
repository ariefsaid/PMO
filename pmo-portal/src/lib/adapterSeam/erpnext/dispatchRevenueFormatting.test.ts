import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatTimeMaterialsDescription } from './dispatchRevenueFormatting.ts';

describe('time-materials invoice description formatting', () => {
  afterEach(() => resetActiveLocale());

  it('formats IDR and USD descriptions by invoice currency regardless of the UI locale', () => {
    const formatDescriptions = () => ({
      idr: formatTimeMaterialsDescription('Site engineer', 'hour', 0.25, 1000.02, '250.01', 'IDR'),
      usd: formatTimeMaterialsDescription('Site engineer', 'hour', 0.25, 1000.02, '250.01', 'USD'),
    });

    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    const idUiDescriptions = formatDescriptions();
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const enUiDescriptions = formatDescriptions();

    expect(idUiDescriptions).toEqual(enUiDescriptions);
    expect(idUiDescriptions.idr).toBe('Site engineer (hour): 0,25 x 1.000,02, rounded to Rp\u00a0250,01');
    expect(idUiDescriptions.usd).toBe('Site engineer (hour): 0.25 x 1,000.02, rounded to $250.01');
  });

  it('labels standby equipment lines in the invoice currency locale', () => {
    expect(formatTimeMaterialsDescription('Excavator', 'hour', 2, 200000, '400000.00', 'IDR', 'standby'))
      .toBe('Excavator (siaga) (hour): 2 x 200.000, rounded to Rp\u00a0400.000,00');
    expect(formatTimeMaterialsDescription('Excavator', 'hour', 2, 200000, '400000.00', 'USD', 'standby'))
      .toBe('Excavator (standby) (hour): 2 x 200,000, rounded to $400,000.00');
  });

});
