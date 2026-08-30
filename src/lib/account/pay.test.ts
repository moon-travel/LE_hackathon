// 担当B: /api/pay ハンドラ本体 handlePay の統合テスト（EXAMPLE）。
// IdentifyPort をスタブ注入し、matched/none/ambiguous/insufficient/autoCharge/冪等を検証。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handlePay } from "./pay";
import { createStubIdentifyPort, createStubAuditPort } from "./ports";
import { createMockGateway } from "@/lib/payment-mock/gateway";
import { parseTransactions } from "./serde";
import { createTestDb, clearAll, type TestDb } from "./testdb";
import type { PayRequest } from "@/types/api";

let db: TestDb;
const vector = Array.from({ length: 128 }, () => 0.1);

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.dispose();
});
beforeEach(async () => {
  await clearAll(db.client);
});

async function seedActive(balance: number, extra: Record<string, unknown> = {}) {
  const account = await db.client.account.create({
    data: { balance, ...extra },
  });
  const session = await db.client.session.create({
    data: { accountId: account.id, state: "ACTIVE" },
  });
  return { account, session };
}

function payReq(accountId: string, amount: number, sessionId?: string): PayRequest {
  return { vector, purpose: "payment", amount, terminal: "t1", sessionId };
}

describe("handlePay", () => {
  it("matched かつ残高十分なら減算・取引記録して paid", async () => {
    const { account, session } = await seedActive(5000);
    const res = await handlePay(payReq(account.id, 1200, session.id), {
      identifyPort: createStubIdentifyPort({ result: "matched", accountId: account.id }),
      client: db.client,
    });
    expect(res.body.paid).toBe(true);
    expect(res.body.balance).toBe(3800);
    const s = await db.client.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(parseTransactions(s.transactions)).toHaveLength(1);
  });

  it("none は paid:false reason none、残高不変", async () => {
    const { account } = await seedActive(5000);
    const res = await handlePay(payReq(account.id, 1000), {
      identifyPort: createStubIdentifyPort({ result: "none" }),
      client: db.client,
    });
    expect(res.body.paid).toBe(false);
    // reason は凍結契約値を維持し、再登録案内は reenrollRequired で併記する
    expect(res.body.reason).toBe("none");
    expect((res.body as { reenrollRequired?: boolean }).reenrollRequired).toBe(true);
  });

  it("ambiguous は paid:false reason ambiguous", async () => {
    const res = await handlePay(payReq("x", 1000), {
      identifyPort: createStubIdentifyPort({ result: "ambiguous" }),
      client: db.client,
    });
    expect(res.body.paid).toBe(false);
    // reason は凍結契約値を維持し、再登録案内は reenrollRequired で併記する
    expect(res.body.reason).toBe("ambiguous");
    expect((res.body as { reenrollRequired?: boolean }).reenrollRequired).toBe(true);
  });

  it("残高不足はチャージ選択肢を提示し残高不変", async () => {
    const { account, session } = await seedActive(500);
    const audit = createStubAuditPort();
    const res = await handlePay(payReq(account.id, 1000, session.id), {
      identifyPort: createStubIdentifyPort({ result: "matched", accountId: account.id }),
      auditPort: audit,
      client: db.client,
    });
    expect(res.body.paid).toBe(false);
    expect(res.body.reason).toBe("insufficient");
    expect(res.body.chargeOptions).toBeDefined();
    const a = await db.client.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(a.balance).toBe(500);
    expect(audit.events.some((e) => e.eventType === "payment_insufficient")).toBe(true);
  });

  it("オートチャージ有効なら不足時にチャージして支払い継続", async () => {
    const { account, session } = await seedActive(500, {
      autoChargeEnabled: true,
      autoChargeAmount: 3000,
      cardToken: "tok_1",
    });
    const res = await handlePay(payReq(account.id, 1000, session.id), {
      identifyPort: createStubIdentifyPort({ result: "matched", accountId: account.id }),
      gateway: createMockGateway({ charge: "success" }),
      client: db.client,
    });
    expect(res.body.paid).toBe(true);
    // 500 + 3000 - 1000 = 2500
    expect(res.body.balance).toBe(2500);
  });

  it("オートチャージ決済拒否なら残高不変で不足のまま", async () => {
    const { account, session } = await seedActive(500, {
      autoChargeEnabled: true,
      autoChargeAmount: 3000,
      cardToken: "tok_1",
    });
    const res = await handlePay(payReq(account.id, 1000, session.id), {
      identifyPort: createStubIdentifyPort({ result: "matched", accountId: account.id }),
      gateway: createMockGateway({ charge: "declined" }),
      client: db.client,
    });
    expect(res.body.paid).toBe(false);
    expect(res.body.reason).toBe("insufficient");
    const a = await db.client.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(a.balance).toBe(500);
  });

  it("同一冪等キーの重複要求で二重減算しない", async () => {
    const { account, session } = await seedActive(5000);
    const deps = {
      identifyPort: createStubIdentifyPort({ result: "matched" as const, accountId: account.id }),
      now: new Date(1_700_000_000_000),
      client: db.client,
    };
    const r1 = await handlePay(payReq(account.id, 1000, session.id), deps);
    const r2 = await handlePay(payReq(account.id, 1000, session.id), deps);
    expect(r1.body.paid).toBe(true);
    expect(r2.body.paid).toBe(true);
    expect(r2.body.transactionId).toBe(r1.body.transactionId);
    const a = await db.client.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(a.balance).toBe(4000);
  });

  it("invalid amount は 400", async () => {
    const res = await handlePay(
      { vector, purpose: "payment", amount: 0, terminal: "t1" },
      { identifyPort: createStubIdentifyPort({ result: "none" }) },
    );
    expect(res.status).toBe(400);
  });
});
