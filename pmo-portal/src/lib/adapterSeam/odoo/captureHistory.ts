/** Odoo capture remains unavailable until its source evidence is represented by the shared contract. */
export function purchaseCaptureCapability(): { supported: false; missing: string[] } {
  return { supported: false, missing: ['purchase capture source evidence'] };
}
