/**
 * Email text per event and language (English, Bahasa Indonesia). Generic wording only: no organisation or client names.
 * The notification's own title and body are the parameters; they are escaped for the HTML part.
 */
export type EmailLocale = 'en' | 'id';
export type EmailEvent = 'approval_request' | 'billing_step' | 'overdue_item' | 'document_expiry';

const LEAD: Record<EmailLocale, Record<EmailEvent, string>> = {
  en: {
    approval_request: 'Something is waiting for your approval.',
    billing_step: 'A billing step is waiting for you.',
    overdue_item: 'An item is overdue.',
    document_expiry: 'A document is about to expire.',
  },
  id: {
    approval_request: 'Ada yang menunggu persetujuan Anda.',
    billing_step: 'Ada langkah penagihan yang menunggu Anda.',
    overdue_item: 'Ada item yang terlambat.',
    document_expiry: 'Ada dokumen yang akan segera kedaluwarsa.',
  },
};
const FOOT: Record<EmailLocale, string> = {
  en: 'Open PMO to act on it. You can turn these emails off in your profile.',
  id: 'Buka PMO untuk menindaklanjuti. Anda dapat mematikan email ini di profil Anda.',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderEmail(event: string, locale: string, title: string, body: string | null) {
  const loc: EmailLocale = locale === 'id' ? 'id' : 'en';
  const lead = LEAD[loc][event as EmailEvent] ?? LEAD[loc].approval_request;
  const text = [title, '', ...(body ? [body, ''] : []), lead, FOOT[loc]].join('\n');
  const html = `<p><strong>${escapeHtml(title)}</strong></p>${body ? `<p>${escapeHtml(body)}</p>` : ''}<p>${escapeHtml(lead)}</p><p>${escapeHtml(FOOT[loc])}</p>`;
  return { subject: title, text, html };
}
