// 担当C — Consent_Service record. Requirements 1.2, 1.4, 11.1.
// Enrollment consent and payment consent are two INDEPENDENT items: one's value
// never affects the other's recorded value (要件1.4).

export interface ConsentState {
  consentEnrollment: boolean;
  consentPayment: boolean;
  consentTs: Date;
  consentVersion: string;
}

/**
 * Build the consent record from the two independent choices. Pure: the output's
 * enrollment flag equals the enrollment input and the payment flag equals the
 * payment input, with no cross-influence (要件1.4).
 */
export function buildConsentRecord(
  consentEnrollment: boolean,
  consentPayment: boolean,
  consentVersion: string,
  at = new Date(),
): ConsentState {
  return {
    consentEnrollment,
    consentPayment,
    consentTs: at,
    consentVersion,
  };
}
