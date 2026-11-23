import React from 'react';
import ProgressClaimModal, { type ProgressClaimModalProps } from './ProgressClaimModal';
import { useClaimOverCap } from '@/src/hooks/useClaimOverCap';

/** The claim form with the organisation's claim-quantity setting (survey-cap-stop) read where the form opens. Unreadable reads as `warn`. */
const ProgressClaimModalForOrg: React.FC<Omit<ProgressClaimModalProps, 'overCapMode'>> = (props) => {
  const setting = useClaimOverCap();
  return <ProgressClaimModal {...props} overCapMode={setting.data ?? 'warn'} />;
};

export default ProgressClaimModalForOrg;
