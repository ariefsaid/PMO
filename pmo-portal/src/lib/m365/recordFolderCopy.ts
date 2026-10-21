// recordFolderCopy.ts — the ONE mapping from a record-folder outcome or failure to reviewed copy
// (#1020 lane L6, AC-M365DOC-071/072). It returns translation KEYS and a remedy enum, never an
// error's own message: a raw Graph/server string must not reach the DOM (NFR-M365-101).
//
// Copy lives in the `recordFolders` namespace (public/locales/{en,id}/recordFolders.json). Every
// t() call below uses a LITERAL key so the key is greppable, with the reviewed English as default.
import type { TFunction } from 'i18next';
import type { RecordFolderOutcome } from './recordFolders';

export type RecordFolderCopyKey =
  | 'status.linked'
  | 'error.additionalConsent'
  | 'error.notConnected'
  | 'error.access'
  | 'error.defaultUnset'
  | 'error.missingIdentifier'
  | 'error.ambiguous'
  | 'error.generic';

/** What the user can do next. `none` = nothing to offer (success). */
export type RecordFolderRemedy = 'none' | 'reconnect' | 'chooseExisting' | 'retry' | 'contactAdmin';

export interface RecordFolderCopy {
  key: RecordFolderCopyKey;
  remedy: RecordFolderRemedy;
  /** True for a linked/created/already-linked result; false for every "saved, not linked" state. */
  ok: boolean;
}

const GENERIC: RecordFolderCopy = { key: 'error.generic', remedy: 'retry', ok: false };

/** Stable wire codes (m365-token-custody `ERROR_STATUS`) + the transport's `external-unreachable`. */
export function recordFolderErrorCopy(error: unknown): RecordFolderCopy {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'SCOPE_INSUFFICIENT':
      return { key: 'error.additionalConsent', remedy: 'reconnect', ok: false };
    case 'NOT_CONNECTED':
    case 'CONNECTION_STALE':
    case 'CONNECTION_REVOKED':
      return { key: 'error.notConnected', remedy: 'reconnect', ok: false };
    case 'FORBIDDEN':
    case 'NOT_ENTITLED':
    case 'ORG_APPROVAL_REQUIRED':
    case 'DISABLED_MEMBER':
    case 'BANNED_MEMBER':
      return { key: 'error.access', remedy: 'contactAdmin', ok: false };
    default:
      // Includes GRAPH_ERROR / INTERNAL_ERROR / BAD_REQUEST / external-unreachable / unknown / no code:
      // opaque upstream failures keep the generic copy and never invent a licence/not-found diagnosis.
      return GENERIC;
  }
}

export function recordFolderOutcomeCopy(outcome: RecordFolderOutcome): RecordFolderCopy {
  switch (outcome?.state) {
    case 'linked':
    case 'created':
    case 'already_linked':
      return { key: 'status.linked', remedy: 'none', ok: true };
    case 'needs_choice':
      return { key: 'error.ambiguous', remedy: 'chooseExisting', ok: false };
    case 'default_unset':
      return { key: 'error.defaultUnset', remedy: 'contactAdmin', ok: false };
    case 'missing_identifier':
      return { key: 'error.missingIdentifier', remedy: 'retry', ok: false };
    default:
      // `not_found` is internal to the match-only sweep, and an unknown state is a contract drift.
      return GENERIC;
  }
}

/** Resolve a copy key to localized text. English defaults are the reviewed source strings. */
export function recordFolderText(t: TFunction<'recordFolders'>, key: RecordFolderCopyKey): string {
  switch (key) {
    case 'status.linked':
      return t('status.linked', 'Folder linked');
    case 'error.additionalConsent':
      return t('error.additionalConsent', 'Creating folders needs one more permission from Microsoft. Allow it, then try again.');
    case 'error.notConnected':
      return t('error.notConnected', 'Connect your Microsoft account, then try again.');
    case 'error.access':
      return t('error.access', 'Access depends on your Microsoft permissions. Ask your Microsoft admin to check folder creation access.');
    case 'error.defaultUnset':
      return t('error.defaultUnset', 'Ask an Admin to choose the default document library.');
    case 'error.missingIdentifier':
      return t('error.missingIdentifier', "Add the record's code, then try again.");
    case 'error.ambiguous':
      return t('error.ambiguous', 'More than one folder matches. Choose the existing folder.');
    default:
      return t('error.generic', 'Microsoft could not create or link this folder. Please try again.');
  }
}
