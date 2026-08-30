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
            now: 1_000_000,
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
