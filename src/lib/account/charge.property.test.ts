// Feature: face-auth-onsen-entry, Property 3: 残高減算の原子性
// Validates: Requirements 5.2, 5.9
//
// For any 残高と支払い金額について、成功時のみちょうど金額分減算＋取引1件が記録され、
// 失敗時（残高不足）は残高不変・取引0件となる。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { chargeAtomic } from "./charge";
import { parseTransactions } from "./serde";
import { computeIdempotencyKey } from "./idempotency";
import { BALANCE_MAX } from "./constants";
import { createTestDb, clearAll, type TestDb } from "./testdb";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.dispose();
});

beforeEach(async () => {
  await clearAll(db.client);
});

describe("Property 3: 残高減算の原子性", () => {
  it("成功時のみちょうど金額分減算＋取引1件、失敗時は残高不変・取引0件", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: BALANCE_MAX }),
        fc.integer({ min: 1, max: 100_000 }),
        async (balance, amount) => {
          await clearAll(db.client);
          const account = await db.client.account.create({
            data: { balance },
          });
          const session = await db.client.session.create({
            data: { accountId: account.id, state: "ACTIVE" },
          });
          const idempotencyKey = computeIdempotencyKey({
            terminal: "t1",
            amount,
            sessionId: session.id,
            clientRef: "prop3",
          });

          const result = await chargeAtomic(
            {
              accountId: account.id,
              sessionId: session.id,
              amount,
              terminal: "t1",
              idempotencyKey,
            },
            db.client,
          );

          const after = await db.client.account.findUniqueOrThrow({
            where: { id: account.id },
          });
          const afterSession = await db.client.session.findUniqueOrThrow({
            where: { id: session.id },
          });
          const records = parseTransactions(afterSession.transactions);

          if (balance >= amount) {
            expect(result.outcome).toBe("paid");
            expect(after.balance).toBe(balance - amount);
            expect(records).toHaveLength(1);
            expect(records[0].amount).toBe(amount);
            expect(records[0].balanceAfter).toBe(balance - amount);
          } else {
            expect(result.outcome).toBe("insufficient");
            expect(after.balance).toBe(balance);
            expect(records).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 【T8】並行性テスト（敵対的監査の教訓）
//
// 既存の Property 3/4/5/10 は「逐次実行」でしか検証しておらず、
// そのため lost update と二重減算という致命的欠陥を見逃した。
// テストが緑であることは並行安全性の証明にはならない。
// ここでは Promise.all で同時発火し、金銭の正しさを実測で守る。
// このテストは恒久資産として維持すること（削除禁止）。
// ---------------------------------------------------------------------------
describe("並行性: 同時リクエストでも金銭が壊れない", () => {
  it("同一冪等キーの支払いを同時2件発火しても正味減算は1回・取引1件", async () => {
    await clearAll(db.client);
    const account = await db.client.account.create({ data: { balance: 1000 } });
    const session = await db.client.session.create({
      data: { accountId: account.id, state: "ACTIVE" },
    });
    const idempotencyKey = computeIdempotencyKey({
      terminal: "t1",
      amount: 500,
      sessionId: session.id,
      clientRef: "same-ref",
    });
    const input = {
      accountId: account.id,
      sessionId: session.id,
      amount: 500,
      terminal: "t1",
      idempotencyKey,
    };

    const settled = await Promise.allSettled([
      chargeAtomic(input, db.client),
      chargeAtomic(input, db.client),
    ]);

    const after = await db.client.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    const afterSession = await db.client.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    const records = parseTransactions(afterSession.transactions).filter(
      (r) => r.kind === "pay",
    );

    // 二重減算していないこと（1000 - 500 = 500）
    expect(after.balance).toBe(500);
    // 取引記録も1件のみ
    expect(records).toHaveLength(1);
    // 両方の呼び出しが例外で終わっていない（少なくとも1件は解決している）
    expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
  });

  it("残高ちょうどの支払いを異なるキーで同時2件発火しても残高は負にならない", async () => {
    await clearAll(db.client);
    const account = await db.client.account.create({ data: { balance: 500 } });
    const session = await db.client.session.create({
      data: { accountId: account.id, state: "ACTIVE" },
    });
    const mk = (ref: string) => ({
      accountId: account.id,
      sessionId: session.id,
      amount: 500,
      terminal: "t1",
      idempotencyKey: computeIdempotencyKey({
        terminal: "t1",
        amount: 500,
        sessionId: session.id,
        clientRef: ref,
      }),
    });

    const settled = await Promise.allSettled([
      chargeAtomic(mk("ref-A"), db.client),
      chargeAtomic(mk("ref-B"), db.client),
    ]);

    const after = await db.client.account.findUniqueOrThrow({
      where: { id: account.id },
    });

    // 残高は絶対に負にならない（条件付き原子減算の保証）
    expect(after.balance).toBeGreaterThanOrEqual(0);
    // 500円しかないので、支払い成立は最大1件
    const paidCount = settled.filter(
      (s) => s.status === "fulfilled" && s.value.outcome === "paid",
    ).length;
    expect(paidCount).toBeLessThanOrEqual(1);
    // 成立した場合は残高0、成立しなければ500のまま
    expect([0, 500]).toContain(after.balance);
  });

  it("同時に複数の支払いが走っても残高と取引記録の合計が矛盾しない", async () => {
    await clearAll(db.client);
    const initial = 10_000;
    const account = await db.client.account.create({ data: { balance: initial } });
    const session = await db.client.session.create({
      data: { accountId: account.id, state: "ACTIVE" },
    });
    const amount = 1000;
    const parallel = 5;

    const inputs = Array.from({ length: parallel }, (_, i) => ({
      accountId: account.id,
      sessionId: session.id,
      amount,
      terminal: "t1",
      idempotencyKey: computeIdempotencyKey({
        terminal: "t1",
        amount,
        sessionId: session.id,
        clientRef: `ref-${i}`,
      }),
    }));

    await Promise.allSettled(inputs.map((i) => chargeAtomic(i, db.client)));

    const after = await db.client.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    const afterSession = await db.client.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    const paidRecords = parseTransactions(afterSession.transactions).filter(
      (r) => r.kind === "pay",
    );

    // 残高は 0 以上、かつ初期残高以下
    expect(after.balance).toBeGreaterThanOrEqual(0);
    expect(after.balance).toBeLessThanOrEqual(initial);
    // 記録された支払い件数と残高減少が一致する（取りこぼし・二重計上がない）
    expect(initial - after.balance).toBe(paidRecords.length * amount);
  });
});
