/** Returns true only for the first row in a list that is already sorted most urgent first. */
export function isMostUrgentLateRow<T>(rows: readonly T[], row: T): boolean {
  return rows.length > 0 && rows[0] === row;
}
