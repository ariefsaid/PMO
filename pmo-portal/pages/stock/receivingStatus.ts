/** One pill per receiving state of an order line: done is green, everything else neutral. */
export const RECEIVING_VARIANT = { not_received: 'neutral', partly_received: 'neutral', fully_received: 'won' } as const;
