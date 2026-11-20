/**
 * A cell written to a downloaded spreadsheet (#2530, FR-IMT-006): text that starts with `=`, `+`, `-`, `@`, tab or
 * carriage return is read as a formula by Excel and Sheets, so it gets a leading apostrophe and stays text.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function safeCellText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}
