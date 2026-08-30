// 担当B: /api/account ハンドラ本体 handleAccount の統合テスト（EXAMPLE）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleAccount } from "./account";
import { createMockGateway } from "@/lib/payment-mock/gateway";
import { createTestDb, clearAll, type TestDb } from "./testdb";
import type { AccountResponse } from "@/types/api";

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

function asAccount(body: unknown): AccountResponse {
  return body as AccountResponse;
}

describe("handleAccount", () => {
  it("create は残高0で生成", async () => {
    const res = await handleAccount({ action: "create" }, { client: db.client });
    expect(res.status).toBe(200);
    expect(asAccount(res.body).balance).toBe(0);
    expect(asAccount(res.body).hasCard).toBe(false);
  });

  it("charge は範囲内で加算、上限超過は拒否", async () => {
    const created = await db.client.account.create({ data: { balance: 0 } });
    const ok = await handleAccount(
      { action: "charge", accountId: created.id, amount: 3000 },
      { client: db.client },
    );
    expect(asAccount(ok.body).balance).toBe(3000);

    // 範囲外（下限未満）
    const low = await handleAccount(
      { action: "charge", accountId: created.id, amount: 500 },
      { client: db.client },
    );
    expect(low.status).toBe(400);

    // 上限超過: 現在3000 + 30000 = 33000 OK だが、48000 + 30000 は超過
    await db.client.account.update({ where: { id: created.id }, data: { balance: 48000 } });
    const over = await handleAccount(
      { action: "charge", accountId: created.id, amount: 30000 },
      { client: db.client },
    );
    expect(over.status).toBe(400);
    const a = await db.client.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(a.balance).toBe(48000); // 不変
  });

  it("registerCard は認証成功でトークン保存", async () => {
    const created = await db.client.account.create({ data: { balance: 0 } });
    const res = await handleAccount(
      { action: "registerCard", accountId: created.id, cardToken: "raw_ref" },
      { client: db.client, gateway: createMockGateway({ cardAuth: "success" }) },
    );
    expect(res.status).toBe(200);
    expect(asAccount(res.body).hasCard).toBe(true);
    const a = await db.client.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(a.cardToken).toBeTruthy();
    expect(a.cardToken).not.toBe("raw_ref"); // 事業者発行トークンで置換
  });

  it("registerCard は認証失敗で既存トークン不変", async () => {
    const created = await db.client.account.create({
      data: { balance: 0, cardToken: "existing" },
    });
    const res = await handleAccount(
      { action: "registerCard", accountId: created.id, cardToken: "raw_ref" },
      { client: db.client, gateway: createMockGateway({ cardAuth: "declined" }) },
    );
    expect(res.status).toBe(402);
    const a = await db.client.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(a.cardToken).toBe("existing");
  });

  it("withdraw 現金は減算成立", async () => {
    const created = await db.client.account.create({ data: { balance: 5000 } });
    const res = await handleAccount(
      { action: "withdraw", accountId: created.id, amount: 2000, withdrawMethod: "cash" },
      { client: db.client },
    );
    expect(res.status).toBe(200);
    expect(asAccount(res.body).balance).toBe(3000);
  });

  it("withdraw カード返金失敗なら残高を復元（補償）", async () => {
    const created = await db.client.account.create({
      data: { balance: 5000, cardToken: "tok" },
    });
    const res = await handleAccount(
      { action: "withdraw", accountId: created.id, amount: 2000, withdrawMethod: "card" },
      { client: db.client, gateway: createMockGateway({ refund: "refund_failed" }) },
    );
    expect(res.status).toBe(402);
    const a = await db.client.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(a.balance).toBe(5000); // 復元
  });

  it("withdraw 残高超過は拒否・残高不変", async () => {
    const created = await db.client.account.create({ data: { balance: 1000 } });
    const res = await handleAccount(
      { action: "withdraw", accountId: created.id, amount: 2000 },
      { client: db.client },
    );
    expect(res.status).toBe(400);
    const a = await db.client.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(a.balance).toBe(1000);
  });

  it("残高0の withdraw は拒否", async () => {
    const created = await db.client.account.create({ data: { balance: 0 } });
    const res = await handleAccount(
      { action: "withdraw", accountId: created.id, amount: 1 },
      { client: db.client },
    );
    expect(res.status).toBe(400);
  });
});
