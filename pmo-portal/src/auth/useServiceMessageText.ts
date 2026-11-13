import { useTranslation } from 'react-i18next';
import { serviceMessageKind } from './serviceMessage';

/**
 * Turn a Supabase Auth message into a sentence the reader can act on, in their language.
 *
 * Every key is a literal `t()` call so the catalogue gates see it; the KIND comes from a closed set
 * (`serviceMessage.ts`), the WORDING from the `auth` catalogue. A screen that has a closer remedy of
 * its own (the reset page: "we could not send the link") passes `unknownText` for the leftovers.
 */
export function useServiceMessageText(): (message: string, unknownText?: string) => string {
  const { t } = useTranslation('auth');
  return (message: string, unknownText?: string): string => {
    switch (serviceMessageKind(message)) {
      case 'invalid_credentials':
        return t('error.invalidCredentials', 'The email or password is not right. Check both and try again.');
      case 'email_not_confirmed':
        return t('error.emailNotConfirmed', 'Confirm your email before signing in. We can send the link again.');
      case 'rate_limited':
        return t('error.rateLimited', 'Too many attempts. Wait a minute, then try again.');
      case 'provider_unavailable':
        return t('error.providerUnavailable', 'Microsoft sign-in is not set up for this workspace. Use your email and password, or ask an Admin to turn it on.');
      case 'weak_password':
        return t('error.weakPassword', 'Choose a stronger password. It must meet the password rules shown on this screen.');
      case 'expired_link':
        return t('error.expiredLink', 'This link is no longer valid. Request a new one.');
      case 'unknown':
        return unknownText ?? t('error.unknown', 'Sign-in did not complete. Check your connection and try again.');
    }
  };
}
