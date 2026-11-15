import React from 'react';
import AdministrationExchangeRates from '../AdministrationExchangeRates';
import type { AdministrationPanelProps } from './types';

const ExchangeRatesPanel: React.FC<AdministrationPanelProps> = () => (
  <div data-testid="administration-panel-exchange-rates" className="min-w-0">
    <AdministrationExchangeRates />
  </div>
);

export default ExchangeRatesPanel;
