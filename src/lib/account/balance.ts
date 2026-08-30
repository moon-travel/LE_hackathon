// 担当B — balance range invariants. Requirements 6.5, 6.7.
export const BALANCE_MIN = 0;
export const BALANCE_MAX = 50000;

export const CHARGE_MIN = 1000;
export const CHARGE_MAX = 30000;

export const PAY_MIN = 1;
export const PAY_MAX = 100000;

/** True if a balance value is within the allowed range (要件6.5). */
export function isValidBalance(balance: number): boolean {
  return Number.isInteger(balance) && balance >= BALANCE_MIN && balance <= BALANCE_MAX;
}

/** True if a charge amount is in [1000, 30000] (要件2.4, 6.1). */
export function isValidChargeAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= CHARGE_MIN && amount <= CHARGE_MAX;
}

/**
 * Whether adding `amount` to `balance` stays within the cap (要件6.7).
 * Returns the max addable amount when it would exceed the cap.
 */
export function chargeFits(balance: number, amount: number): { ok: boolean; maxAddable: number } {
  const maxAddable = BALANCE_MAX - balance;
  return { ok: amount <= maxAddable, maxAddable };
}

/** Whether a payment of `amount` can be deducted from `balance` (要件6.5). */
export function canDeduct(balance: number, amount: number): boolean {
  return amount > 0 && balance - amount >= BALANCE_MIN;
}
