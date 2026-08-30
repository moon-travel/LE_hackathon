// Feature: face-auth-onsen-entry, Property 2: 1:N識別の件数判定整合
//
// *For any* 母集団と入力ベクトルについて、閾値未満の件数と none / matched / ambiguous の判定が
// 厳密に対応する。
//
// **Validates: Requirements 3.4, 3.6, 3.7, 5.5, 5.7**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { VECTOR_DIM } from "@/types/vector";
import type { FaceVector } from "@/types/vector";
import { MATCH_THRESHOLD, distanceToScore, euclideanDistance } from "./distance";
import { decideIdentity } from "./identify";
import type { PopulationTemplate } from "./identify";

/**
 * 探査ベクトルは零ベクトルに固定する。こうすると「第0要素が d、残りが0」のベクトルは
 * 探査ベクトルからの距離がちょうど |d| になり、距離を厳密に制御できる。
 * d = 0.5 の場合 0.5*0.5 = 0.25、sqrt(0.25) = 0.5 がいずれも2の冪で誤差なく表現されるため、
 * 境界値ちょうどのケースを確実に作れる。
 */
const PROBE: FaceVector = new Array(VECTOR_DIM).fill(0);

function vectorAtDistance(d: number): FaceVector {
  const v = new Array(VECTOR_DIM).fill(0);
  v[0] = d;
  return v;
}

/** 一致側・境界ちょうど・不一致側をすべて踏むような距離。 */
const distanceArb = fc.oneof(
  // 境界値ちょうど（不一致側に落ちなければならない）
  { weight: 1, arbitrary: fc.constant(MATCH_THRESHOLD) },
  // 一致側
  { weight: 4, arbitrary: fc.double({ min: 0, max: 0.49, noNaN: true, noDefaultInfinity: true }) },
  // 不一致側
  { weight: 4, arbitrary: fc.double({ min: 0.51, max: 2, noNaN: true, noDefaultInfinity: true }) },
);

/** 1アカウント = 1〜5件のテンプレート（要件9-3の上限）。 */
const accountArb = fc.record({
  accountId: fc.string({ minLength: 1, maxLength: 8 }),
  distances: fc.array(distanceArb, { minLength: 1, maxLength: 5 }),
});

/** 母集団。accountId は重複しないようにする。件数は0〜30（上限500は別途検証）。 */
const populationArb = fc
  .uniqueArray(accountArb, {
    minLength: 0,
    maxLength: 30,
    selector: (a) => a.accountId,
  })
  .map((accounts) => {
    const templates: PopulationTemplate[] = [];
    for (const a of accounts) {
      for (const d of a.distances) {
        templates.push({ accountId: a.accountId, vector: vectorAtDistance(d) });
      }
    }
    return { accounts, templates };
  });

describe("Property 2: 1:N識別の件数判定整合", () => {
  it("閾値未満のアカウント件数と none/matched/ambiguous が厳密に対応する", () => {
    fc.assert(
      fc.property(populationArb, ({ templates }) => {
        // 期待値は判定ロジックではなく距離関数から独立に組み立てる。
        const minByAccount = new Map<string, number>();
        for (const t of templates) {
          const d = euclideanDistance(t.vector, PROBE);
          const cur = minByAccount.get(t.accountId);
          if (cur === undefined || d < cur) minByAccount.set(t.accountId, d);
        }
        const matchedAccounts = [...minByAccount.entries()].filter(
          ([, d]) => d < MATCH_THRESHOLD,
        );

        const decision = decideIdentity(templates, PROBE);

        // 母集団サイズはアカウント数（テンプレート件数ではない）。
        expect(decision.populationSize).toBe(minByAccount.size);
        // 閾値未満件数が一致する。
        expect(decision.matchedCount).toBe(matchedAccounts.length);

        // 件数と判定の厳密な対応（要件3-4 / 3-6 / 3-7 / 5-5 / 5-7）。
        if (matchedAccounts.length === 0) {
          expect(decision.result).toBe("none");
          expect(decision.accountId).toBeUndefined();
        } else if (matchedAccounts.length === 1) {
          expect(decision.result).toBe("matched");
          expect(decision.accountId).toBe(matchedAccounts[0][0]);
        } else {
          expect(decision.result).toBe("ambiguous");
          expect(decision.accountId).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("matched のとき採用距離は当該アカウントの最小距離（要件9-5 の最高スコア採用）", () => {
    fc.assert(
      fc.property(populationArb, ({ templates }) => {
        const decision = decideIdentity(templates, PROBE);
        fc.pre(decision.result === "matched");

        const own = templates
          .filter((t) => t.accountId === decision.accountId)
          .map((t) => euclideanDistance(t.vector, PROBE));
        const expected = Math.min(...own);

        expect(decision.distance).toBe(expected);
        expect(decision.score).toBe(distanceToScore(expected));
      }),
      { numRuns: 100 },
    );
  });

  it("境界値 0.5 ちょうどは不一致（閾値は未満であり以下ではない）", () => {
    const decision = decideIdentity(
      [{ accountId: "boundary", vector: vectorAtDistance(MATCH_THRESHOLD) }],
      PROBE,
    );
    expect(decision.result).toBe("none");
    expect(decision.matchedCount).toBe(0);
  });

  it("同一アカウントの複数テンプレートは母集団サイズを増やさない（要件9-3/9-5）", () => {
    const decision = decideIdentity(
      [
        { accountId: "acc", vector: vectorAtDistance(0.9) },
        { accountId: "acc", vector: vectorAtDistance(0.1) },
        { accountId: "acc", vector: vectorAtDistance(0.7) },
      ],
      PROBE,
    );
    expect(decision.populationSize).toBe(1);
    expect(decision.result).toBe("matched");
    expect(decision.distance).toBeCloseTo(0.1, 10);
  });
});
