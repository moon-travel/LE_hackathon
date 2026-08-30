// Feature: face-auth-onsen-entry, Property 11: 退場によるセッション遷移
//
// *For any* ACTIVE セッションについて、退場を適用すると CLOSED になり退場時刻が記録される。
//
// **Validates: Requirements 8.1**
//
// 併せて要件8-2 の保管期限算定（expireAt = 退場時刻 + retentionDays）と、その単調性も検証する。

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyExit, newSession, toSecondPrecision } from "./session";
import type { PassageEntry, SessionLike } from "./session";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RetentionDaysOutOfRangeError,
  computeExpireAt,
} from "@/lib/retention/computeExpireAt";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** うるう年・月末・年境界を含む広めの時刻範囲。 */
const dateArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2032, 11, 31) })
  .map((ms) => new Date(ms));

/** 顧客指定保管期間 1〜90日（要件10-2）。 */
const retentionDaysArb = fc.integer({ min: MIN_RETENTION_DAYS, max: MAX_RETENTION_DAYS });

/** ACTIVE セッション。通過履歴の長さは0〜20件（件数上限なし、要件4-3）。 */
const activeSessionArb = fc
  .record({
    enteredAt: dateArb,
    passageCount: fc.integer({ min: 0, max: 20 }),
  })
  .map(({ enteredAt, passageCount }): SessionLike => {
    const passHistory: PassageEntry[] = [];
    for (let i = 0; i < passageCount; i += 1) {
      passHistory.push({
        gate: i % 2 === 0 ? "ENTRY" : "EXIT",
        at: new Date(enteredAt.getTime() + i * 60_000).toISOString(),
      });
    }
    return { state: "ACTIVE", enteredAt, exitedAt: null, passHistory };
  });

describe("Property 11: 退場によるセッション遷移", () => {
  it("ACTIVE に退場を適用すると必ず CLOSED になり退場時刻が秒精度で記録される", () => {
    fc.assert(
      fc.property(activeSessionArb, dateArb, (session, at) => {
        const closed = applyExit(session, at);

        // 要件8-1: 状態は必ず CLOSED。
        expect(closed.state).toBe("CLOSED");
        // 退場時刻が記録される。秒精度（ミリ秒は落とす）。
        expect(closed.exitedAt).not.toBeNull();
        expect(closed.exitedAt?.getTime()).toBe(toSecondPrecision(at).getTime());
        expect((closed.exitedAt?.getTime() ?? 1) % 1000).toBe(0);
        // 入場時刻は書き換えない。
        expect(closed.enteredAt.getTime()).toBe(session.enteredAt.getTime());
        // 要件4-3: 通過履歴に EXIT が1件だけ増え、昇順が保たれる。
        expect(closed.passHistory.length).toBe(session.passHistory.length + 1);
        const times = closed.passHistory.map((p) => p.at);
        expect([...times].sort((a, b) => a.localeCompare(b))).toEqual(times);
      }),
      { numRuns: 100 },
    );
  });

  it("退場は冪等ではないが、CLOSED への遷移結果は適用回数に依らず CLOSED を保つ", () => {
    fc.assert(
      fc.property(activeSessionArb, dateArb, (session, at) => {
        const once = applyExit(session, at);
        const twice = applyExit(once, at);
        expect(twice.state).toBe("CLOSED");
        expect(twice.exitedAt?.getTime()).toBe(once.exitedAt?.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it("保管期限は 退場時刻 + retentionDays に厳密一致する（要件8-2 / 10-1 / 10-2）", () => {
    fc.assert(
      fc.property(activeSessionArb, dateArb, retentionDaysArb, (session, at, days) => {
        const closed = applyExit(session, at);
        const exitedAt = closed.exitedAt;
        expect(exitedAt).not.toBeNull();
        if (exitedAt === null) return;

        const expireAt = computeExpireAt(exitedAt, days);
        // 誤差なし（ミリ秒単位で一致）。
        expect(expireAt.getTime()).toBe(exitedAt.getTime() + days * MS_PER_DAY);
        // 保管期限は必ず退場時刻より後。
        expect(expireAt.getTime()).toBeGreaterThan(exitedAt.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it("保管期間設定が大きいほど保管期限は後になる（単調性）", () => {
    fc.assert(
      fc.property(dateArb, retentionDaysArb, retentionDaysArb, (exitedAt, d1, d2) => {
        fc.pre(d1 !== d2);
        const [small, large] = d1 < d2 ? [d1, d2] : [d2, d1];
        expect(computeExpireAt(exitedAt, small).getTime()).toBeLessThan(
          computeExpireAt(exitedAt, large).getTime(),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("保管期限は (退場時刻, 保管期間) だけで決まる — 呼び出し時刻や順序に依存しない（要件8-8）", () => {
    // CLOSED 経路（/api/exit）と FORCE_CLOSED 経路（要件8-8）は同じ computeExpireAt を共有する。
    // 両者が一致することは「算定が引数のみの関数であり、外部状態に依存しない」ことに等しいので、
    // それを検証する。入力を与える順序を変えても、間に別の算定を挟んでも結果が変わらないこと。
    fc.assert(
      fc.property(dateArb, retentionDaysArb, dateArb, retentionDaysArb, (t1, d1, t2, d2) => {
        const first = computeExpireAt(t1, d1).getTime();
        // 別の入力で算定を挟む（内部に持ち越し状態がないことの確認）。
        computeExpireAt(t2, d2);
        const again = computeExpireAt(t1, d1).getTime();
        expect(again).toBe(first);
        // 差分が保管期間そのものであること（現在時刻を参照していない）。
        expect(first - t1.getTime()).toBe(d1 * MS_PER_DAY);
      }),
      { numRuns: 100 },
    );
  });

  it("保管期間設定が 1〜90 日の範囲外なら算定を拒否する（要件10-3）", () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.oneof(
          fc.integer({ min: -365, max: MIN_RETENTION_DAYS - 1 }),
          fc.integer({ min: MAX_RETENTION_DAYS + 1, max: 1000 }),
        ),
        (exitedAt, days) => {
          expect(() => computeExpireAt(exitedAt, days)).toThrow(RetentionDaysOutOfRangeError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("新規セッションは ACTIVE・退場時刻なし・ENTRY 1件で始まる（要件3-4）", () => {
    const at = new Date("2026-08-30T12:34:56.789Z");
    const s = newSession(at);
    expect(s.state).toBe("ACTIVE");
    expect(s.exitedAt).toBeNull();
    expect(s.enteredAt.getTime() % 1000).toBe(0);
    expect(s.passHistory).toHaveLength(1);
    expect(s.passHistory[0].gate).toBe("ENTRY");
  });

  it("基本保管期間の既定値は7日（要件Glossary）", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(7);
  });
});
