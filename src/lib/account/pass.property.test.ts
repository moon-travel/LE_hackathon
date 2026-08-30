// Feature: face-auth-onsen-entry, Property 10: 利用権判定の冪等
// Validates: Requirements 7.3
//
// For any 有効期間内の利用権について、任意回数判定しても全て許可される。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { handlePass } from "./pass";
import { createTestDb, clearAll, type TestDb } from "./testdb";
import type { PassResponse } from "@/types/api";

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

describe("Property 10: 利用権判定の冪等", () => {
  it("有効期間内の利用権は任意回数 verify しても全て valid=true", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 現在から未来までの残り有効ミリ秒（1分〜24時間）
        fc.integer({ min: 60_000, max: 24 * 60 * 60 * 1000 }),
        // verify 回数
        fc.integer({ min: 1, max: 12 }),
        async (remainMs, repeats) => {
          await clearAll(db.client);
          const now = new Date(1_700_000_000_000);
          const account = await db.client.account.create({ data: { balance: 0 } });
          await db.client.pass.create({
            data: {
              accountId: account.id,
              status: "VALID",
              expiresAt: new Date(now.getTime() + remainMs),
            },
          });

          for (let i = 0; i < repeats; i++) {
            const res = await handlePass(
              { action: "verify", accountId: account.id },
              { client: db.client, now },
            );
            const body = res.body as PassResponse;
            expect(body.valid).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
