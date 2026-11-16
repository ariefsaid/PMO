/** The journal was approved, but sending it to the ledger failed. The approval stands; only the send is retried. */
export class ApprovedSendFailure extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The journal was approved but could not be sent to the ledger');
    this.name = 'ApprovedSendFailure';
    this.cause = cause;
  }
}
