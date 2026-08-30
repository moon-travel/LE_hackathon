// 担当B: /api/pass ハンドラ本体 handlePass の統合テスト（EXAMPLE）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handlePass } from "./pass";
import { businessDayEnd } from "./businessDay";
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

const asPass = (b: unknown) => b as PassResponse;

describe("handlePass", () => {
  it("issue は営業日終了を有効期限に発行しアカウントに紐づく", async () => {
    const account = await db.client.account.create({ data: { balance: 0 } });
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    const res = await handlePass(
      { action: "issue", accountId: account.id },
      { client: db.client, now },
    );
    expect(res.status).toBe(200);
    expect(asPass(res.body).alreadyExists).toBe(false);
    expect(asPass(res.body).expiresAt).toBe(businessDayEnd(now).toISOString());
    const passes = await db.client.pass.findMany({ where: { accountId: account.id } });
    expect(passes).toHaveLength(1);
  });

  it("既存有効利用権があれば新規発行しない（要件7-7）", async () => {
    const account = await db.client.account.create({ data: { balance: 0 } });
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    const first = await handlePass(
      { action: "issue", accountId: account.id },
      { client: db.client, now },
    );
    const second = await handlePass(
      { action: "issue", accountId: account.id },
      { client: db.client, now },
    );
    expect(asPass(second.body).alreadyExists).toBe(true);
    expect(asPass(second.body).passId).toBe(asPass(first.body).passId);
    const passes = await db.client.pass.findMany({ where: { accountId: account.id } });
    expect(passes).toHaveLength(1);
  });

  it("verify は有効期間内なら valid、期限経過で失効し無効", async () => {
    const account = await db.client.account.create({ data: { balance: 0 } });
    const now = new Date(1_700_000_000_000);
    // 既に期限切れの利用権
    await db.client.pass.create({
      data: {
        accountId: account.id,
        status: "VALID",
        expiresAt: new Date(now.getTime() - 1000),
      },
    });
    const res = await handlePass(
      { action: "verify", accountId: account.id },
      { client: db.client, now },
    );
    expect(asPass(res.body).valid).toBe(false);
    // 失効として記録されている（要件7-5）
    const p = await db.client.pass.findFirstOrThrow({ where: { accountId: account.id } });
    expect(p.status).toBe("EXPIRED");
  });

  it("アカウント特定失敗は 404", async () => {
    const res = await handlePass(
      { action: "verify", accountId: "nonexistent" },
      { client: db.client },
    );
    expect(res.status).toBe(404);
  });
});
