import { formatCalendarDayInTimeZone } from '../../src/lib/format';
import { addDays } from '../../src/lib/reports/months';
import { need, ORG_ID, serviceClient } from './jobFixtures';

let timezone: Promise<string> | undefined;

async function readTimezone(): Promise<string> {
  const db = serviceClient('organisation day fixture');
  const org = need('read organisation timezone', await db.from('organizations')
    .select('default_timezone').eq('id', ORG_ID).single());
  if (!org.default_timezone) throw new Error('The fixture organisation must have a timezone');
  return org.default_timezone;
}

/** Cache the timezone in each Playwright worker. Read the current instant for every call. */
export async function orgDay(offsetDays = 0): Promise<string> {
  timezone ??= readTimezone().catch((error: unknown) => {
    timezone = undefined;
    throw error;
  });
  const zone = await timezone;
  return addDays(formatCalendarDayInTimeZone(new Date(), zone), offsetDays);
}
