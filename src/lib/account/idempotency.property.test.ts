// Feature: face-auth-onsen-entry, Property 4: 支払いの冪等性
// Validates: Requirements 5.6
//
// For any 同一冪等キーの支払い要求を任意回数受けても、正味減算は1回・取引は1件で、
// 2回目以降は最初の結果を返す。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { chargeAtomic } from "./charge";
import { parseTransactions } from "./serde";
import { computeIdempotencyKey } from "./idempotency";
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

describe("Property 4: 支払いの冪等性", () => {
  it("同一冪等キーを任意回数受けても正味減算1回・取引1件・2回目以降は最初の結果", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 残高は必ず支払える範囲にして「本来なら減算される」状況を作る
        fc.integer({ min: 1, max: 30_000 }), // amount
        fc.integer({ min: 2, max: 8 }), // 繰り返し回数
        async (amount, repeats) => {
          await clearAll(db.client);
          const balance = 50_000;
          const account = await db.client.account.create({ data: { balance } });
          const session = await db.client.session.create({
            data: { accountId: account.id, state: "ACTIVE" },
          });
          const idempotencyKey = computeIdempotencyKey({
            terminal: "t1",
            amount,
            sessionId: session.id,
            now: 2_000_000,
          });

          const results = [];
          for (let i = 0; i < repeats; i++) {
            results.push(
              await chargeAtomic(
                {
                  accountId: account.id,
                  sessionId: session.id,
                  amount,
                  terminal: "t1",
                  idempotencyKey,
                },
                db.client,
              ),
            );
          }

          const after = await db.client.account.findUniqueOrThrow({
            where: { id: account.id },
          });
          const afterSession = await db.client.session.findUniqueOrThrow({
            where: { id: session.id },
          });
          const records = parseTransactions(afterSession.transactions);

          // 正味減算はちょうど1回分
          expect(after.balance).toBe(balance - amount);
          // 取引は1件のみ
          expect(records).toHaveLength(1);
          // 1回目は paid、2回目以降は duplicate かつ最初の transactionId を返す
          expect(results[0].outcome).toBe("paid");
          const firstTxId = results[0].transactionId;
          for (let i = 1; i < repeats; i++) {
            expect(results[i].outcome).toBe("duplicate");
            expect(results[i].transactionId).toBe(firstTxId);
            expect(results[i].balance).toBe(balance - amount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
