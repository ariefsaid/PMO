/** #2290: the ledger's posting date when it differs from the entered one, else null. Compares calendar days (an entered value may carry a time). */
export function movedLedgerDate(entered: string | null | undefined, posted: string | null | undefined): string | null {
  if (!posted || !entered) return null;
  return posted.slice(0, 10) === entered.slice(0, 10) ? null : posted;
}

/** Keeps a formatted date whole: no-break spaces, so a line may wrap between words but never inside "11 Oct". */
export const wholeDate = (formatted: string): string => formatted.replace(/ /g, '\u00a0');
