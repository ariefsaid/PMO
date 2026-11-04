function invoiceNumberLocale(currency: string | undefined): string {
  return currency === 'IDR' ? 'id-ID' : 'en-US';
}

export function formatTimeMaterialsNumber(value: number, currency: string | undefined): string {
  const locale = invoiceNumberLocale(currency);
  const fractionDigits = /\.(\d+)$/.exec(String(value))?.[1].length ?? 0;
  // eslint-disable-next-line no-restricted-syntax -- this adapter is edge-bundled and cannot import the FE formatter.
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.min(fractionDigits, 20),
  }).format(value);
}

export function formatTimeMaterialsAmount(
  amount: number | string,
  currency: string | undefined,
): string {
  const locale = invoiceNumberLocale(currency);
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(String(amount));
  if (!currency || !/^[A-Z]{3}$/.test(currency) || !match) {
    return formatTimeMaterialsNumber(Number(amount), currency);
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
    return formatTimeMaterialsNumber(Number(amount), currency);
  }
}

export function formatTimeMaterialsLabel(label: string, basis: string | undefined, currency: string | undefined): string {
  if (basis !== 'standby') return label;
  return `${label} (${currency === 'IDR' ? 'siaga' : 'standby'})`;
}

export function formatTimeMaterialsDescription(
  label: string,
  unit: string,
  quantity: number,
  signedRate: number,
  amount: number | string,
  currency: string | undefined,
  basis?: string,
): string {
  const namedLabel = formatTimeMaterialsLabel(label, basis, currency);
  return `${namedLabel} (${unit}): ${formatTimeMaterialsNumber(quantity, currency)} x ${formatTimeMaterialsNumber(signedRate, currency)}, rounded to ${formatTimeMaterialsAmount(amount, currency)}`;
}
