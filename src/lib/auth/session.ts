// Session_Service: 滞在セッションの状態遷移と通過履歴（純粋関数）。
// _Requirements: 3.4, 3.9, 4.1, 4.2, 4.3, 4.4, 8.1_
//
// DB に依存しない形で切り出してあるため、Property 11（退場によるセッション遷移）を
// プロパティテストで検証できる。

import type { SessionState } from "@/types/session";

/** 通過履歴の1件。`Session.passHistory`（JSON文字列）に格納する。 */
export interface PassageEntry {
  gate: "ENTRY" | "EXIT";
  /** 通過時刻（ISO文字列、秒精度）。 */
  at: string;
}

/** 状態遷移の対象となるセッションの最小形。 */
export interface SessionLike {
  state: SessionState;
  enteredAt: Date;
  exitedAt: Date | null;
  passHistory: PassageEntry[];
}

/**
 * 秒精度に丸める。要件3-4 / 8-1 が「秒精度で記録」と規定しているため、
 * ミリ秒を落として記録の粒度を要件に合わせる。
 */
export function toSecondPrecision(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/** 通過履歴を時刻昇順で追記する。件数に上限を設けない（要件4-3）。 */
export function appendPassage(
  history: readonly PassageEntry[],
  gate: PassageEntry["gate"],
  at: Date,
): PassageEntry[] {
  const entry: PassageEntry = { gate, at: toSecondPrecision(at).toISOString() };
  return [...history, entry].sort((a, b) => a.at.localeCompare(b.at));
}

/** JSON文字列の通過履歴を復元する。壊れていれば空配列（SQLite は Json 非対応で String 保存）。 */
export function parsePassHistory(raw: string): PassageEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PassageEntry =>
        typeof e === "object" &&
        e !== null &&
        (e as PassageEntry).gate !== undefined &&
        typeof (e as PassageEntry).at === "string",
    );
  } catch {
    return [];
  }
}

/**
 * 退場を適用する（要件8-1）。
 *
 * ACTIVE セッションに退場を適用すると状態は必ず CLOSED になり、識別時刻が秒精度の退場時刻として
 * 記録される。通過履歴には EXIT が1件追記される（要件4-3）。
 *
 * Property 11「退場によるセッション遷移」が検証する対象。
 */
export function applyExit(session: SessionLike, at: Date): SessionLike {
  const exitedAt = toSecondPrecision(at);
  return {
    state: "CLOSED",
    enteredAt: session.enteredAt,
    exitedAt,
    passHistory: appendPassage(session.passHistory, "EXIT", at),
  };
}

/**
 * 入場を適用する。
 *
 * 既存 ACTIVE セッションがある場合は**新規生成せず ACTIVE のまま維持**し、通過履歴だけを
 * 追記する（要件3-9 / 4-1 / 4-2）。要件4-1 は通過回数に上限を設けず、1回目か2回目以降かに
 * 依らず同一の許可判定結果を返すことを求めているため、戻り値の形は初回と再入場で変わらない。
 */
export function applyEntry(session: SessionLike, at: Date): SessionLike {
  return {
    state: "ACTIVE",
    enteredAt: session.enteredAt,
    exitedAt: session.exitedAt,
    passHistory: appendPassage(session.passHistory, "ENTRY", at),
  };
}

/** 新規セッションの初期状態（初回入場 / CLOSED・FORCE_CLOSED後の再入場、要件3-4 / 4-4）。 */
export function newSession(at: Date): SessionLike {
  const enteredAt = toSecondPrecision(at);
  return {
    state: "ACTIVE",
    enteredAt,
    exitedAt: null,
    passHistory: appendPassage([], "ENTRY", at),
  };
}
