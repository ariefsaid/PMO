/**
 * A message from the auth service is not a message for the person reading it.
 *
 * Supabase Auth (GoTrue) answers with a string written for a developer: "Invalid login credentials",
 * "Email rate limit exceeded", "For security purposes, you can only request this once every 60
 * seconds". It names a cause, never a remedy, and it is English only. The screens that show it are
 * the FIRST screens of the app, so a raw service string is the first thing a client reads.
 *
 * This module classifies that string into one of a small, closed set of kinds. Each screen turns the
 * kind into its own sentence in the reader's language (`useServiceMessageText`), so the raw message
 * never reaches the page and the wording lives in the catalogues.
 *
 * The raw message is still what the app classifies on (FR-AUTHF-043: the GoTrue string is the only
 * signal) and what analytics records, so classification stays here, not in the display.
 */
export type ServiceMessageKind =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'weak_password'
  | 'expired_link'
  | 'unknown';

/** Which kind of service message this is; anything unrecognised is `unknown`. */
export function serviceMessageKind(message: string): ServiceMessageKind {
  const m = message.toLowerCase();
  if (/invalid login credentials|invalid credentials|bad credentials|incorrect/.test(m)) {
    return 'invalid_credentials';
  }
  if (/email not confirmed|not confirmed/.test(m)) return 'email_not_confirmed';
  if (/for security purposes|rate limit|once every|too many requests/.test(m)) return 'rate_limited';
  // A provider the project never enabled (Entra/Microsoft sign-in) reads as a broken sign-in unless
  // the sentence names the actual remedy: use the password, or ask an Admin to turn the provider on.
  if (/provider is not enabled|unsupported provider|provider .*not enabled/.test(m)) return 'provider_unavailable';
  if (/weak|at least \d+ characters|password should be|too short/.test(m)) return 'weak_password';
  if (/expired|invalid.*(token|link)|(token|link).*invalid/.test(m)) return 'expired_link';
  return 'unknown';
}
