/** Email channel settings (#2711). The database decides who is emailed; this seam only carries what a person sets. */
import type { EmailEvent, EmailLocale, EmailSettings } from '@/src/lib/db/emailNotifications';

export interface EmailNotificationsRepository {
  getSettings(): Promise<EmailSettings>;
  setEvent(event: EmailEvent, enabled: boolean, extraRoles: string[]): Promise<void>;
  setLocale(locale: EmailLocale): Promise<void>;
  getMyOptOut(): Promise<boolean>;
  setMyOptOut(optedOut: boolean): Promise<void>;
}
