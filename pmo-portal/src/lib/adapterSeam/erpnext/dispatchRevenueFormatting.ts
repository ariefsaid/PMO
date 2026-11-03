export function formatTimeMaterialsNumber(value: number, locale: string): string {
  const fractionDigits = /\.(\d+)$/.exec(String(value))?.[1].length ?? 0;
  // eslint-disable-next-line no-restricted-syntax -- this adapter is edge-bundled and cannot import the FE formatter.
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.min(fractionDigits, 20),
  }).format(value);
}

export function formatTimeMaterialsAmount(
  amount: number | string,
  currency: string | undefined,
  locale: string,
): string {
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(String(amount));
  if (!currency || !/^[A-Z]{3}$/.test(currency) || !match) {
    return formatTimeMaterialsNumber(Number(amount), locale);
  }

  const [, sign, wholeText, fraction = ''] = match;
  try {
    const whole = BigInt(wholeText);
    const cents = BigInt(fraction.padEnd(2, '0'));
    // eslint-disable-next-line no-restricted-syntax -- format exact signed invoice cents without importing FE code.
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).formatToParts(whole);
    const body = parts.map((part) => part.type === 'fraction' ? String(cents).padStart(2, '0') : part.value).join('');
    return sign ? `−${body}` : body;
  } catch {
    return formatTimeMaterialsNumber(Number(amount), locale);
  }
}
