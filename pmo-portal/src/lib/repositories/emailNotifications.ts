import { getEmailSettings, getMyEmailOptOut, setEmailEvent, setEmailLocale, setMyEmailOptOut } from '@/src/lib/db/emailNotifications';
import { wrap } from './repositoryErrors';
import type { EmailNotificationsRepository } from './contracts/emailNotifications';

export const emailNotificationsRepository: EmailNotificationsRepository = {
  getSettings: () => wrap(() => getEmailSettings()),
  setEvent: (event, enabled, extraRoles) => wrap(() => setEmailEvent(event, enabled, extraRoles)),
  setLocale: (locale) => wrap(() => setEmailLocale(locale)),
  getMyOptOut: () => wrap(() => getMyEmailOptOut()),
  setMyOptOut: (optedOut) => wrap(() => setMyEmailOptOut(optedOut)),
};
