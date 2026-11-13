import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { LegalPageLayout, LegalSection } from '@/src/components/legal/LegalPageLayout';
import { AnalyticsOptOutToggle } from '@/src/components/legal/AnalyticsOptOutToggle';
import {
  LEGAL_ENTITY_NAME,
  DOMAIN,
  CONTACT_EMAIL,
  HOSTING_LOCATION,
  HELP_URL,
} from '@/src/lib/legalConfig';

/**
 * Public Privacy Policy page (FR-LEG-002/003/009/015-022, AC-LEG-002/007/013-020).
 * Bare public page for everyone — no AppShell. Template-grade; counsel refines.
 *
 * C4: every visible word comes from the `legal` catalogue (en + id). Deployment values
 * (entity, domain, contact e-mail, hosting location, support link) stay CONFIG and are
 * interpolated into the sentences.
 */
const Privacy: React.FC = () => {
  const { t } = useTranslation('legal');
  const values = { entity: LEGAL_ENTITY_NAME, domain: DOMAIN };
  const helpLinkProps = {
    href: HELP_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': t('layout.helpAria', 'Contact support via WhatsApp'),
    className: 'text-primary-text hover:underline',
  } as const;
  return (
    <LegalPageLayout title={t('privacy.title', 'Privacy Policy')} variant="privacy">
      <LegalSection title={t('privacy.collect.title', 'Data We Collect')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.collect.body',
            '{{entity}} ({{domain}}) collects the data you enter to operate the service — account and profile information, and the business records (projects, companies, contacts, financial and operational data) you choose to store.',
            values,
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.ownership.title', 'Data Ownership')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.ownership.body',
            'You (the client) own your data. {{entity}} receives only the license necessary to operate and provide the service to you, and does not claim ownership of your data.',
            values,
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.use.title', 'How We Use Your Data')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.use.body',
            'We use your data to provide, maintain and improve the service, to communicate with you about your account, and to provide the features you enable. We do not sell your data.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.ai.title', 'AI Processing Disclosure')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.ai.body',
            'When you use the Assistant, your prompts and the minimum necessary data context are sent to third-party large-language-model providers via OpenRouter to generate a response. Your client data is not used to train models. {{entity}} staff do not read the contents of Assistant conversations; only aggregates are processed for support and reliability.',
            values,
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.analytics.title', 'Analytics and Cookies')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.analytics.usage',
            'We collect product-usage analytics to understand which parts of the product are used and where people get stuck. This is processed on our behalf by PostHog. We record page and feature navigation, click/heatmap coordinates (not their content), page-performance measurements, and error diagnostics. The analytics events we construct never carry your record contents — no names, no financial values, no free text, no search terms; a fixed denylist strips those keys before anything leaves your browser, and identifiers are internal account IDs, never your email address.',
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            'privacy.analytics.demo',
            'On our public product-demonstration site — using illustrative sample data, never a live client’s records — we additionally record on-screen session replay, including rendered page text, so prospective clients can see the product in action. This never applies to your live account.',
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            'privacy.analytics.telemetry',
            'Separately from browser analytics, our servers send operational telemetry about how the service runs: error codes, job run results, push outcomes to connected accounting systems, and Assistant usage counts (model, tokens, cost, timings, and whether a tool call or an automated quality check passed). It contains no record contents, prompts, replies or names, and is not linked to your name or email. It is not affected by the analytics opt-out below. When analytics is on for you, the Assistant usage counts are also tagged with an internal account ID (not your name or email) so we can see usage per person; turning analytics off removes that tag. The automated quality check is an AI model that reads an Assistant question and answer inside our service; only its pass or fail result and its cost are recorded.',
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            'privacy.analytics.assistantReplay',
            'In our demonstration organisation (sample data) only, and only while analytics is on for you, the Assistant’s prompts and replies are additionally recorded with the session replay, to review how the Assistant performs on sample data. This never applies to a live client account.',
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            'privacy.analytics.feedback',
            'The product has a Feedback button, and occasionally asks a short question (at most one every 30 days, never in your first week and never while you are filling in a form). Your answer is sent to PostHog with the area of the product you were in. Free-text answers are the one place you type something that is sent, so please leave out customer names and amounts; we strip obvious email addresses and access keys automatically. Your organisation’s administrator can switch this off, and the opt-out below stops it for you.',
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            'privacy.analytics.optOut',
            'We honour your browser’s Do Not Track setting. You can also opt out here at any time:',
          )}
        </p>
        <AnalyticsOptOutToggle />
      </LegalSection>

      <LegalSection title={t('privacy.location.title', 'Data Location')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.location.body',
            'Your data is hosted on a per-client Supabase Cloud Pro environment. The hosting location for this deployment is {{hosting}} (configurable per client per ADR-0047).',
            { hosting: HOSTING_LOCATION },
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.export.title', 'Data Export')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.export.body',
            'You can export your data at any time using the in-product CSV/XLSX export. On termination of the service, you may request a full export of your data, which we will provide within 30 days.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.retention.title', 'Data Retention and Deletion')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.retention.body',
            'After termination, client data is deleted within 60–90 days. You may request earlier deletion of specific data at any time.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.security.title', 'Confidentiality and Security')}>
        <p className="text-muted-foreground">
          {t(
            'privacy.security.body',
            'Each party maintains mutual confidentiality of the other’s non-public information. We protect your data with daily backups and per-client environment isolation.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={t('privacy.contact.title', 'Contact Us')}>
        <p className="text-muted-foreground">
          <Trans
            i18nKey="legal:privacy.contact.privacyEmail"
            t={t}
            defaults="For privacy questions, email <1>{{email}}</1>."
            values={{ email: CONTACT_EMAIL }}
            components={{ 1: <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-text hover:underline" /> }}
          />
        </p>
        {HELP_URL && (
          <p className="text-muted-foreground">
            <Trans
              i18nKey="legal:privacy.contact.support"
              t={t}
              defaults="For support, <1>contact us on WhatsApp</1>."
              components={{ 1: <a {...helpLinkProps} /> }}
            />
          </p>
        )}
      </LegalSection>
    </LegalPageLayout>
  );
};

export default Privacy;
