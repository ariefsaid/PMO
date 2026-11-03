const FALLBACK_NUMBER_LOCALE = 'en-US';

let activeNumberLocale = FALLBACK_NUMBER_LOCALE;

/** Shared with Deno-safe adapter code that needs number formatting without importing UI modules. */
export function getSharedNumberLocale(): string {
  return activeNumberLocale;
}

export function setSharedNumberLocale(locale: string): void {
  activeNumberLocale = locale || FALLBACK_NUMBER_LOCALE;
}

export function resetSharedNumberLocale(): void {
  activeNumberLocale = FALLBACK_NUMBER_LOCALE;
}
