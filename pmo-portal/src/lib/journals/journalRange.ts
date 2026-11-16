/** The calendar month holding an organisation day ('YYYY-MM-DD', from `useOrgToday`), as an inclusive date range. Pure calendar arithmetic: no time zone. */
export function monthOf(day: string): { from: string; to: string } {
  const [year, month] = day.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}
