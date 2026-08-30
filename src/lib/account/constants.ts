// 担当B所有: 金額・残高に関する定数。金額は常に整数円（Int）。浮動小数を持ち込まない（判断5）。

/** 残高の下限（含む）。要件6-5。 */
export const BALANCE_MIN = 0;

/** 残高の上限（含む）。要件2-4/6-5/6-7。 */
export const BALANCE_MAX = 50000;

/** チャージ1回あたりの下限金額（含む）。要件2-2/6-1/6-2。 */
export const CHARGE_MIN = 1000;

/** チャージ1回あたりの上限金額（含む）。要件2-2/6-1/6-2。 */
export const CHARGE_MAX = 30000;

/** 支払い金額の下限（含む）。要件5-1。 */
export const PAY_MIN = 1;

/** 支払い金額の上限（含む）。要件5-1。 */
export const PAY_MAX = 100000;

/** 残高不足時に提示するチャージ選択肢（要件6-1）。 */
export const CHARGE_OPTIONS: readonly number[] = [1000, 3000, 5000, 10000, 30000];
