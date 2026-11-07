import React, { type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { financeTestI18n } from './financeI18nTestInstance';

export function FinanceI18nTestProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={financeTestI18n}>{children}</I18nextProvider>;
}
