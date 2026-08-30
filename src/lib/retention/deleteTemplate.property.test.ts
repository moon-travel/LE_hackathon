// Feature: face-auth-onsen-entry, Property 12: 削除後の照合不成立
//
// *For any* 同期削除後のアカウントについて、削除で用いたベクトルで identify しても
// 当該アカウントに一致しない。
//
// **Validates: Requirements 10.4, 10.7**
//
// 併せて要件10-8（ACTIVE 中は削除を延期）と要件10-9（付随データは削除対象に含めない）を検証する。

import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { VECTOR_DIM } from "@/types/vector";
import type { FaceVector } from "@/types/vector";
import { decideIdentity } from "@/lib/auth/identify";
import type { PopulationTemplate } from "@/lib/auth/identify";
import { AuditEvent } from "@/lib/auth/audit";
import { deleteTemplatesForAccount } from "./deleteTemplate";
import { resetRetryState, runRetentionScan } from "./scanner";
import { createMemoryState, createMemoryStore } from "./memoryStore";
import type { MemoryState, MemoryTemplate } from "./memoryStore";

/**
 * アカウント i の顔ベクトルを「第 i 要素だけ 1」の one-hot にする。
 * 自分自身との距離は 0（閾値0.5未満 → 一致）、他アカウントとの距離は sqrt(2) ≈ 1.414
 * （閾値以上 → 不一致）になるので、「誰の顔か」を距離だけで一意に決められる。
 */
function vectorFor(index: number): FaceVector {
  const v = new Array(VECTOR_DIM).fill(0);
  v[index] = 1;
  return v;
}

/** 母集団を現在のストア状態から組み立てる（本番の buildPopulation 相当を純粋に再現）。 */
function populationOf(state: MemoryState): PopulationTemplate[] {
  return state.templates.map((t) => ({
    accountId: t.accountId,
    vector: JSON.parse(t.vector) as FaceVector,
  }));
}

interface Scenario {
  accountCount: number;
  /** 各アカウントのテンプレート件数（1〜5件、要件9-3の上限）。 */
  templateCounts: number[];
  /** 削除対象アカウントの添字。 */
  targetIndex: number;
  /** 削除対象が ACTIVE セッション保持中か（要件10-8）。 */
  targetActive: boolean;
  trigger: "EXPIRED" | "USER_REQUEST";
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    accountCount: fc.integer({ min: 1, max: 10 }),
    templateCounts: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 10, maxLength: 10 }),
    targetOffset: fc.integer({ min: 0, max: 9 }),
    targetActive: fc.boolean(),
    trigger: fc.constantFrom<"EXPIRED" | "USER_REQUEST">("EXPIRED", "USER_REQUEST"),
  })
  .map(({ accountCount, templateCounts, targetOffset, targetActive, trigger }) => ({
    accountCount,
    templateCounts: templateCounts.slice(0, accountCount),
    targetIndex: targetOffset % accountCount,
    targetActive,
    trigger,
  }));

function buildState(s: Scenario): MemoryState {
  const templates: MemoryTemplate[] = [];
  const ancillary = new Map<string, { balance: number; cardToken: string | null; passIds: string[]; transactionIds: string[] }>();

  for (let i = 0; i < s.accountCount; i += 1) {
    const accountId = `acc-${i}`;
    for (let k = 0; k < s.templateCounts[i]; k += 1) {
      templates.push({
        id: `tpl-${i}-${k}`,
        accountId,
        vector: JSON.stringify(vectorFor(i)),
        expireAt: null,
      });
    }
    ancillary.set(accountId, {
      balance: 1000 + i,
      cardToken: i % 2 === 0 ? `tok-${i}` : null,
      passIds: [`pass-${i}`],
      transactionIds: [`tx-${i}`],
    });
  }

  const activeAccounts = new Set<string>();
  if (s.targetActive) activeAccounts.add(`acc-${s.targetIndex}`);

  return createMemoryState({ templates, activeAccounts, ancillary });
}

describe("Property 12: 削除後の照合不成立", () => {
  beforeEach(() => {
    resetRetryState();
  });

  it("同期削除の完了後、削除に用いた顔で identify しても当該アカウントに一致しない", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const state = buildState(s);
        const store = createMemoryStore(state);
        const targetId = `acc-${s.targetIndex}`;
        const probe = vectorFor(s.targetIndex);

        // 前提: 削除前は当該アカウントに一致する。
        const before = decideIdentity(populationOf(state), probe);
        expect(before.result).toBe("matched");
        expect(before.accountId).toBe(targetId);

        const result = await deleteTemplatesForAccount(targetId, s.trigger, store);

        if (s.targetActive) {
          // 要件10-8: ACTIVE 中は削除せず延期。テンプレートは残るので依然一致する。
          expect(result.deferred).toBe(true);
          expect(result.deletedCount).toBe(0);
          const during = decideIdentity(populationOf(state), probe);
          expect(during.accountId).toBe(targetId);

          // セッション終了後の走査で削除される（延期時に expireAt=now を書いているため拾われる）。
          state.activeAccounts.delete(targetId);
          const scan = await runRetentionScan(store, new Date(Date.now() + 60_000));
          expect(scan.deletedCount).toBeGreaterThan(0);
        } else {
          expect(result.deferred).toBe(false);
          expect(result.deletedCount).toBe(s.templateCounts[s.targetIndex]);
        }

        // 要件10-4 / 10-7: 削除完了後は当該アカウントに一致しない（母集団から外れている）。
        const after = decideIdentity(populationOf(state), probe);
        expect(after.accountId).not.toBe(targetId);
        expect(state.templates.some((t) => t.accountId === targetId)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("削除は他アカウントのテンプレートに影響しない", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        fc.pre(!s.targetActive && s.accountCount >= 2);
        const state = buildState(s);
        const store = createMemoryStore(state);
        const targetId = `acc-${s.targetIndex}`;

        const othersBefore = state.templates
          .filter((t) => t.accountId !== targetId)
          .map((t) => t.id)
          .sort();

        await deleteTemplatesForAccount(targetId, s.trigger, store);

        const othersAfter = state.templates.map((t) => t.id).sort();
        expect(othersAfter).toEqual(othersBefore);

        // 他アカウントは引き続き自分の顔で一致する。
        for (let i = 0; i < s.accountCount; i += 1) {
          if (i === s.targetIndex) continue;
          const d = decideIdentity(populationOf(state), vectorFor(i));
          expect(d.result).toBe("matched");
          expect(d.accountId).toBe(`acc-${i}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("削除後も残高・カードトークン・利用権・取引記録は削除前と一致する（要件10-9）", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        fc.pre(!s.targetActive);
        const state = buildState(s);
        const store = createMemoryStore(state);
        const targetId = `acc-${s.targetIndex}`;
        const snapshot = JSON.stringify([...state.ancillary.entries()]);

        await deleteTemplatesForAccount(targetId, s.trigger, store);

        expect(JSON.stringify([...state.ancillary.entries()])).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("削除は監査記録され、記録内容にベクトル値を含まない（要件10-6 / 11-10 / 14-4）", async () => {
    const s: Scenario = {
      accountCount: 2,
      templateCounts: [3, 2],
      targetIndex: 0,
      targetActive: false,
      trigger: "USER_REQUEST",
    };
    const state = buildState(s);
    const store = createMemoryStore(state);

    await deleteTemplatesForAccount("acc-0", "USER_REQUEST", store);

    const deleted = state.audits.filter((a) => a.eventType === AuditEvent.TEMPLATE_DELETED);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].accountId).toBe("acc-0");
    expect(deleted[0].detail.trigger).toBe("USER_REQUEST");
    expect(deleted[0].detail.deletedCount).toBe(3);
    // ベクトル値が混入していない。
    expect(JSON.stringify(deleted[0].detail)).not.toContain("[0,");
    expect(JSON.stringify(deleted[0].detail)).not.toMatch(/\[(?:0|1)(?:,(?:0|1)){10,}/);
  });

  it("削除失敗は最大3回までリトライし、超過分は削除待ちのまま管理者へ通知する（要件10-10）", async () => {
    const state = createMemoryState({
      templates: [
        { id: "t1", accountId: "acc-0", vector: JSON.stringify(vectorFor(0)), expireAt: new Date(0) },
      ],
      failDeletes: true,
    });
    const store = createMemoryStore(state);
    const now = new Date(1_000_000);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const r = await runRetentionScan(store, now);
      expect(r.deletedCount).toBe(0);
      expect(state.templates).toHaveLength(1); // 削除待ちのまま維持
    }

    const failures = state.audits.filter(
      (a) => a.eventType === AuditEvent.TEMPLATE_DELETE_FAILED,
    );
    expect(failures).toHaveLength(3);
    expect(failures[2].detail.retriesExhausted).toBe(true);
    expect(failures[2].detail.notifyAdministrator).toBe(true);

    // 4回目以降は上限到達によりリトライせず、削除待ちとして数えられる。
    const after = await runRetentionScan(store, now);
    expect(after.pendingCount).toBe(1);
    expect(
      state.audits.filter((a) => a.eventType === AuditEvent.TEMPLATE_DELETE_FAILED),
    ).toHaveLength(3);
  });

  it("走査は ACTIVE セッション保持アカウントをスキップして延期する（要件10-8）", async () => {
    const state = createMemoryState({
      templates: [
        { id: "t1", accountId: "acc-0", vector: JSON.stringify(vectorFor(0)), expireAt: new Date(0) },
        { id: "t2", accountId: "acc-1", vector: JSON.stringify(vectorFor(1)), expireAt: new Date(0) },
      ],
      activeAccounts: new Set(["acc-0"]),
    });
    const store = createMemoryStore(state);

    const r = await runRetentionScan(store, new Date(1_000_000));
    expect(r.deferredCount).toBe(1);
    expect(r.deletedCount).toBe(1);
    expect(state.templates.map((t) => t.id)).toEqual(["t1"]);
  });
});
