/** Days of an inclusive loan range on which the host crew is on no work order (the lent person would show on no roster). */
export interface ScheduleSpan { valid_from: string; valid_to: string | null }

const ONE_DAY = 86_400_000;
const addDay = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + ONE_DAY).toISOString().slice(0, 10);

export function uncoveredLoanDays(from: string, to: string, schedule: ScheduleSpan[]): string[] {
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  for (let d = from, n = 0; d <= to && n < 400; d = addDay(d), n += 1) {
    if (!schedule.some((s) => s.valid_from <= d && (s.valid_to === null || s.valid_to >= d))) out.push(d);
  }
  return out;
}
