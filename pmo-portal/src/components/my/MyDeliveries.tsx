import React from 'react';
import { useMyDeliveries } from '@/src/hooks/useMyHome';
import { DeliveriesSection } from './DeliveriesSection';

/** "A delivery for you": the transfers sent to the signed-in person, wherever the home is drawn. Renders nothing when there is none or the read fails. */
export const MyDeliveries: React.FC = () => <DeliveriesSection deliveries={useMyDeliveries().data ?? []} />;
