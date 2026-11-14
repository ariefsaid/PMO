import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { LegalPageLayout, LegalSection } from '@/src/components/legal/LegalPageLayout';
import { LEGAL_ENTITY_NAME, DOMAIN, CONTACT_EMAIL } from '@/src/lib/legalConfig';

/**
 * Public Terms of Service page (FR-LEG-001/003/008/011-014, AC-LEG-001/006/009-012).
 * Bare public page for everyone — no AppShell (FR-LEG-003). Template-grade section
 * outlines with the spec's required clauses as real prose stubs; counsel refines
 * the actual language later (spec §8 deviation 1). Config values are interpolated
 * so no bracket placeholder ever renders (FR-LEG-008).
 *
 * C4: every visible word comes from the `legal` catalogue (en + id). The entity name,
 * domain, e-mail and hosting location stay CONFIG (`legalConfig`), interpolated into
 * the sentences, so a per-deployment value never has to be translated.
 */
const Terms: React.FC = () => {
  const { t } = useTranslation('legal');
  const values = { entity: LEGAL_ENTITY_NAME, domain: DOMAIN };
  const sections = {
    acceptance: {
      id: 'acceptance-of-terms',
      title: t('terms.acceptance.title', 'Acceptance of Terms'),
    },
    services: { id: 'services', title: t('terms.services.title', 'Services') },
    responsibilities: {
      id: 'user-responsibilities',
      title: t('terms.responsibilities.title', 'User Responsibilities'),
    },
    ownership: { id: 'data-ownership', title: t('terms.ownership.title', 'Data Ownership') },
    confidentiality: {
      id: 'confidentiality',
      title: t('terms.confidentiality.title', 'Confidentiality'),
    },
    liability: {
      id: 'limitation-of-liability',
      title: t('terms.liability.title', 'Limitation of Liability'),
    },
    term: { id: 'term-and-termination', title: t('terms.term.title', 'Term and Termination') },
    governing: { id: 'governing-law', title: t('terms.governing.title', 'Governing Law') },
  };

  return (
    <LegalPageLayout title={t('terms.title', 'Terms of Service')} variant="terms">
      <div className="space-y-2">
        <p className="font-medium text-foreground">{t('terms.contents.title', 'Contents')}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {Object.values(sections).map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="text-primary-text hover:underline">
                {title}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <LegalSection id={sections.acceptance.id} title={sections.acceptance.title}>
        <p className="text-muted-foreground">
          {t(
            'terms.acceptance.body',
            'By accessing or using {{entity}} ({{domain}}), you agree to be bound by these Terms of Service. If you do not agree, do not access or use the service.',
            values,
          )}
        </p>
      </LegalSection>

      <LegalSection id={sections.services.id} title={sections.services.title}>
        <p className="text-muted-foreground">
          {t(
            'terms.services.body',
            '{{entity}} provides a contract- and project-management platform for project-based organizations. Your use of the service is governed by the master subscription agreement (MSA) between you and {{entity}}, which is the controlling commercial contract; these Terms address use of the platform itself.',
            values,
          )}
        </p>
        <p className="text-muted-foreground">
          {/* One sentence with its link inside it (<Trans>), never "contact" + link + "." fragments:
              a language that orders the clause differently needs the whole sentence. */}
          <Trans
            i18nKey="legal:terms.services.contact"
            t={t}
            defaults="For questions about your subscription, contact <1>{{email}}</1>."
            values={{ email: CONTACT_EMAIL }}
            components={{ 1: <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-text hover:underline" /> }}
          />
        </p>
      </LegalSection>

      <LegalSection id={sections.responsibilities.id} title={sections.responsibilities.title}>
        <p className="text-muted-foreground">
          {t(
            'terms.responsibilities.body',
            'You are responsible for the accuracy of the data you enter, for keeping your credentials secure, and for using the service in compliance with applicable law and these Terms.',
          )}
        </p>
      </LegalSection>

      <LegalSection id={sections.ownership.id} title={sections.ownership.title}>
        <p className="text-muted-foreground">
          {t(
            'terms.ownership.body',
            'You (the client) own all data you submit to the service. You grant {{entity}} only the license necessary to operate and provide the service to you. {{entity}} does not claim ownership of your data.',
            values,
          )}
        </p>
      </LegalSection>

      <LegalSection id={sections.confidentiality.id} title={sections.confidentiality.title}>
        <p className="text-muted-foreground">
          {t(
            'terms.confidentiality.body',
            'Each party agrees to keep the other party’s confidential information confidential and to use it solely to perform under these Terms and the MSA.',
          )}
        </p>
      </LegalSection>

      <LegalSection id={sections.liability.id} title={sections.liability.title}>
        <p className="text-muted-foreground">
          {t(
            'terms.liability.body',
            'To the maximum extent permitted by law, {{entity}}’s liability under these Terms is limited to the fees paid for the service in the twelve (12) months preceding the claim. Neither party is liable for indirect or consequential damages.',
            values,
          )}
        </p>
      </LegalSection>

      <LegalSection id={sections.term.id} title={sections.term.title}>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong>{t('terms.term.initialLabel', 'Initial term')}:</strong>{' '}
            {t('terms.term.initialBody', 'the subscription term set out in the MSA.')}
          </li>
          <li>
            <strong>{t('terms.term.renewLabel', 'Auto-renewal')}:</strong>{' '}
            {t(
              'terms.term.renewBody',
              'the term renews automatically for successive periods unless either party gives notice of non-renewal.',
            )}
          </li>
          <li>
            <strong>{t('terms.term.convenienceLabel', 'Termination for convenience')}:</strong>{' '}
            {t(
              'terms.term.convenienceBody',
              'either party may terminate on the notice period set out in the MSA.',
            )}
          </li>
          <li>
            <strong>{t('terms.term.causeLabel', 'Termination for cause')}:</strong>{' '}
            {t(
              'terms.term.causeBody',
              'either party may terminate immediately on material breach by the other party, subject to any cure period in the MSA.',
            )}
          </li>
        </ul>
      </LegalSection>

      {/* Governing Law is HEADING-ONLY (FR-LEG-011, M12): the governing-law clause
          (Indonesia vs BANI arbitration vs district court) is a live counsel question
          (docs/legal/2026-07-04-msa-brief.md §8). The line below is a deferral marker,
          NOT a legal clause — clause text lands via counsel, not in code. */}
      <LegalSection id={sections.governing.id} title={sections.governing.title}>
        <p className="text-muted-foreground italic">
          {t('terms.governing.body', 'Governing law and dispute-resolution terms to be confirmed.')}
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
};

export default Terms;
