/**
 * Email text per event and language (English, Bahasa Indonesia). Generic wording only: no organisation or client names.
 * The notification's own title and body are the parameters; they are escaped for the HTML part.
 */
import { applyOrgTerms, type OrgTerms } from '../../../pmo-portal/src/lib/i18n/orgTerms.ts';

/** What `org_naming(org)` returns (migration 1904): the organisation's term overrides and role names, both languages. */
export interface OrgNaming {
  terms?: OrgTerms;
  roles?: Partial<Record<'en' | 'id', Record<string, string>>>;
  /** The catalogue's own role names, as the stored English text spells them (`role_defaults`, English). */
  role_defaults?: Partial<Record<'en' | 'id', Record<string, string>>>;
}

export type EmailLocale = 'en' | 'id';
export type EmailEvent = 'approval_request' | 'billing_step' | 'overdue_item' | 'document_expiry' | 'scheduled_report';

const LEAD: Record<EmailLocale, Record<EmailEvent, string>> = {
  en: {
    approval_request: 'Something is waiting for your approval.',
    billing_step: 'A billing step is waiting for you.',
    overdue_item: 'An item is overdue.',
    document_expiry: 'A document is about to expire.',
    scheduled_report: 'This is a scheduled report from PMO.',
  },
  id: {
    approval_request: 'Ada yang menunggu persetujuan Anda.',
    billing_step: 'Ada langkah penagihan yang menunggu Anda.',
    overdue_item: 'Ada item yang terlambat.',
    document_expiry: 'Ada dokumen yang akan segera kedaluwarsa.',
    scheduled_report: 'Ini adalah laporan terjadwal dari PMO.',
  },
};
const FOOT: Record<EmailLocale, string> = {
  en: 'Open PMO to act on it. You can turn these emails off in your profile.',
  id: 'Buka PMO untuk menindaklanjuti. Anda dapat mematikan email ini di profil Anda.',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The stored text is English (the database writes it once, for everyone). It is renamed, not translated: each shipped English
 * term becomes the organisation's word in the email's language (the shared rewriter, `applyOrgTerms`), and each built-in role's
 * English name becomes the organisation's name for it in that language.
 */
export function renameStoredText(text: string, loc: EmailLocale, naming: OrgNaming | undefined): string {
  if (!text || !naming) return text;
  // Roles first, parked behind placeholders, so a term inside a role's name ("Project Manager") is not renamed as a term and
  // the Admin's own role wording is not rewritten a second time.
  const parked: string[] = [];
  let out = text;
  const names = naming.roles?.[loc];
  if (names) {
    const defaults = naming.role_defaults?.en ?? {};
    const renamed = Object.keys(defaults).filter((k) => names[k] && names[k] !== defaults[k]).sort((a, b) => defaults[b].length - defaults[a].length);
    if (renamed.length) {
      const byDefault = new Map(renamed.map((k) => [defaults[k], names[k]]));
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${renamed.map((k) => escapeRe(defaults[k])).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
      out = out.replace(re, (m) => `\u0001${parked.push(byDefault.get(m) ?? m) - 1}\u0001`);
    }
  }
  if (naming.terms?.[loc]) out = applyOrgTerms(out, 'en', { en: naming.terms[loc] });
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => parked[Number(i)]);
}

export function renderEmail(event: string, locale: string, rawTitle: string, rawBody: string | null, naming?: OrgNaming) {
  const loc: EmailLocale = locale === 'id' ? 'id' : 'en';
  const title = renameStoredText(rawTitle, loc, naming);
  const body = rawBody === null ? null : renameStoredText(rawBody, loc, naming);
  const lead = LEAD[loc][event as EmailEvent] ?? LEAD[loc].approval_request;
  const text = [title, '', ...(body ? [body, ''] : []), lead, FOOT[loc]].join('\n');
  const html = `<p><strong>${escapeHtml(title)}</strong></p>${body ? `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : ''}<p>${escapeHtml(lead)}</p><p>${escapeHtml(FOOT[loc])}</p>`;
  return { subject: title, text, html };
}
