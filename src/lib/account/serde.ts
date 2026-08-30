// 担当B所有: JSON文字列列（Session.transactions / Session.passHistory）の serde 集約（判断4）。
// SQLite 制約で String 列に JSON を格納するため、parse/stringify をここに集約する。
// 論理型は本ファイルで定義し（src/types/ は API 契約のみのため）、DB 表現との境界を一元化する。

/** 施設内取引の1レコード（Session.transactions の要素）。要件5-2。 */
export interface TransactionRecord {
  /** 取引識別子。 */
  transactionId: string;
  /** 種別: 支払い / チャージ / 払い出し / 払い出し取消(補償)。 */
  kind: "pay" | "charge" | "withdraw" | "withdrawReverted";
  /** 金額（整数円、常に正）。 */
  amount: number;
  /** 取引日時（ISO文字列）。 */
  ts: string;
  /** 設置窓口識別子（pay 時）。 */
  terminal?: string;
  /** 冪等キー（pay 時）。重複検出に用いる（要件5-6）。 */
  idempotencyKey?: string;
  /** 取引後残高。 */
  balanceAfter: number;
}

/** 通過履歴の1レコード（Session.passHistory の要素）。担当A所有領域の論理型に対応。 */
export interface PassageRecord {
  ts: string;
  gate: "entry" | "exit";
}

/** transactions(JSON文字列) をパースする。不正・空は空配列。 */
export function parseTransactions(raw: string | null | undefined): TransactionRecord[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as TransactionRecord[]) : [];
  } catch {
    return [];
  }
}

/** transactions を JSON文字列へ。 */
export function stringifyTransactions(records: TransactionRecord[]): string {
  return JSON.stringify(records);
}

/** passHistory(JSON文字列) をパースする。不正・空は空配列。 */
export function parsePassHistory(raw: string | null | undefined): PassageRecord[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as PassageRecord[]) : [];
  } catch {
    return [];
  }
}

/** passHistory を JSON文字列へ。 */
export function stringifyPassHistory(records: PassageRecord[]): string {
  return JSON.stringify(records);
}
