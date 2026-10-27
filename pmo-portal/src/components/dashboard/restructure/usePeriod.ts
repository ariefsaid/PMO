import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { formatMonthShort } from '@/src/lib/format';

export type PeriodKey = 'month' | 'quarter' | 'ytd' | '12m' | 'custom';

export interface DashboardPeriod {
  key: PeriodKey;
  /** Inclusive first month in YYYY-MM form. Null while the organization day is resolving. */
  from: string | null;
  /** Inclusive last month in YYYY-MM form. Null while the organization day is resolving. */
  to: string | null;
  label: string;
}

type Translate = (key: string, defaultValue: string) => string;

const VALID_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const isMonth = (value: string | null): value is string => value !== null && VALID_MONTH.test(value);

function monthIndex(month: string): number {
  const [year, number] = month.split('-').map(Number);
  return year * 12 + number - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthText(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return formatMonthShort(new Date(year, number - 1, 1));
}

function rangeText(from: string, to: string): string {
  const [fromYear] = from.split('-').map(Number);
  const [toYear] = to.split('-').map(Number);
  return fromYear === toYear
    ? `${monthText(from)}–${monthText(to)} ${toYear}`
    : `${monthText(from)} ${fromYear}–${monthText(to)} ${toYear}`;
}

function presetRange(key: Exclude<PeriodKey, 'custom'>, today: string): [string, string] {
  const to = today.slice(0, 7);
  const current = monthIndex(to);
  if (key === 'month') return [to, to];
  if (key === 'quarter') return [monthFromIndex(current - ((Number(to.slice(5, 7)) - 1) % 3)), to];
  if (key === '12m') return [monthFromIndex(current - 11), to];
  return [`${to.slice(0, 4)}-01`, to];
}

/** Resolve a URL period against a day in the organization's timezone. */
export function resolvePeriod(
  params: URLSearchParams,
  organizationToday: string | null,
  t: Translate,
): DashboardPeriod {
  const rawKey = params.get('period');
  const key: PeriodKey = rawKey === 'month' || rawKey === 'quarter' || rawKey === 'ytd' || rawKey === '12m' || rawKey === 'custom'
    ? rawKey
    : 'ytd';

  if (key === 'custom') {
    const currentMonth = organizationToday?.slice(0, 7) ?? null;
    let from = params.get('from');
    let to = params.get('to');
    if (!isMonth(from)) from = currentMonth;
    if (!isMonth(to)) to = currentMonth;
    if (!from || !to) return { key, from, to, label: t('period.custom', 'Pick months') };
    if (monthIndex(from) > monthIndex(to)) [from, to] = [to, from];
    return {
      key,
      from,
      to,
      label: `${t('period.custom', 'Pick months')} · ${rangeText(from, to)}`,
    };
  }

  if (!organizationToday) {
    return { key, from: null, to: null, label: t(`period.${key}`, key === '12m' ? 'Last 12 months' : 'Year to date') };
  }

  const [from, to] = presetRange(key, organizationToday);
  const names: Record<Exclude<PeriodKey, 'custom'>, string> = {
    month: t('period.month', 'This month'),
    quarter: t('period.quarter', 'This quarter'),
    ytd: t('period.ytd', 'Year to date'),
    '12m': t('period.12m', 'Last 12 months'),
  };
  return { key, from, to, label: `${names[key]} · ${rangeText(from, to)}` };
}

/** Preserve dashboard layout/tab state while writing the period selection to the URL. */
export function updatePeriodParams(params: URLSearchParams, next: Pick<DashboardPeriod, 'key' | 'from' | 'to'>): URLSearchParams {
  const updated = new URLSearchParams(params);
  updated.set('period', next.key);
  if (next.key === 'custom') {
    if (next.from) updated.set('from', next.from);
    else updated.delete('from');
    if (next.to) updated.set('to', next.to);
    else updated.delete('to');
  } else {
    updated.delete('from');
    updated.delete('to');
  }
  return updated;
}

/** Convert inclusive month bounds to local dates for get_win_rate's inclusive date range. */
export function periodDateRange(period: DashboardPeriod): { from?: Date; to?: Date } {
  if (!period.from || !period.to) return {};
  const [fromYear, fromMonth] = period.from.split('-').map(Number);
  const [toYear, toMonth] = period.to.split('-').map(Number);
  return {
    from: new Date(fromYear, fromMonth - 1, 1),
    to: new Date(toYear, toMonth, 0),
  };
}

export function usePeriod() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('dashboard');
  const orgDay = useFxOrgDay(true);
  const period = useMemo(
    () => resolvePeriod(searchParams, orgDay.day, t),
    [orgDay.day, searchParams, t],
  );

  const selectPeriod = (key: PeriodKey) => {
    const month = orgDay.day?.slice(0, 7) ?? period.to;
    const [from, to] = key === 'custom'
      ? [period.from ?? month, period.to ?? month]
      : key === 'month' && month
        ? [month, month]
        : period.from && period.to
          ? [period.from, period.to]
          : [null, null];
    setSearchParams(updatePeriodParams(searchParams, { key, from, to }), { preventScrollReset: true });
  };

  const setCustomMonth = (edge: 'from' | 'to', value: string) => {
    const next = { key: 'custom' as const, from: period.from, to: period.to, [edge]: value || null };
    setSearchParams(updatePeriodParams(searchParams, next), { preventScrollReset: true });
  };

  return {
    period,
    organizationToday: orgDay.day,
    isPending: orgDay.isPending,
    isError: orgDay.isError,
    retry: orgDay.retry,
    selectPeriod,
    setCustomMonth,
  };
}
