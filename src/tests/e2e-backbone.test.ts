// デモ背骨 E2E（API 層）。_Requirements: 3.4, 4.2, 4.4, 7.3, 8.1, 10.7_
//
// 流れ: 登録 → 入場 → 一時外出して再入場（ACTIVE 維持）→ 別室（利用権検証）
//       → 退場 → 顔データ削除 → 削除済みの顔では再入場できない
//
// 応答の解釈は凍結契約 src/types/api.ts に従う（admitted / released / valid / paid）。
//
// 隔離した SQLite で走らせる。Prisma シングルトンを構築するモジュールを import する前に
// DATABASE_URL を一時ファイルへ向けてマイグレーションを当て、その後に route を動的 import する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

// Route handlers（DATABASE_URL 設定後に動的ロード）。
type Handler = (req: Request) => Promise<Response>;
let enroll: Handler;
let entry: Handler;
let ticket: Handler;
let exit: Handler;
let pass: Handler;

function post(handler: Handler, body: unknown): Promise<Response> {
  return handler(
    new Request("http://test.local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "onsen-e2e-"));
  const url = `file:${join(dir, "e2e.db")}`;
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });

  enroll = (await import("@/app/api/enroll/route")).POST as Handler;
  entry = (await import("@/app/api/entry/route")).POST as Handler;
  ticket = (await import("@/app/api/entry/ticket/route")).POST as Handler;
  exit = (await import("@/app/api/exit/route")).POST as Handler;
  pass = (await import("@/app/api/pass/route")).POST as Handler;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("demo backbone E2E", () => {
  it("enroll -> enter -> re-enter -> pass -> exit -> delete -> re-entry fails", async () => {
    const { personVector } = await import("@/lib/face/demoVectors");
    const vector = personVector(42);

    // 1) 顔登録同意つきで新規アカウントを登録する。
    const enrollRes = await post(enroll, {
      vector,
      modelVersion: "unused", // サーバー側で CURRENT_MODEL_VERSION を採番する
      consentEnrollment: true,
      consentPayment: true,
      consentVersion: "v1",
      retentionDays: 7,
    });
    expect(enrollRes.status).toBe(200);
    const enrolled = await enrollRes.json();
    const accountId: string = enrolled.accountId;
    expect(typeof accountId).toBe("string");
    expect(enrolled.templateCount).toBe(1);

    // 入浴券を発行しないと入場できない（要件3-8 / 4-7）。
    const issuedTicket = await post(ticket, { accountId });
    expect(issuedTicket.status).toBe(200);

    // 2) 入場: ACTIVE セッションが新規生成される。
    const e1 = await (await post(entry, { vector, purpose: "entry" })).json();
    expect(e1.admitted).toBe(true);
    expect(e1.sessionState).toBe("ACTIVE");
    const sessionId: string = e1.sessionId;
    expect(typeof sessionId).toBe("string");

    // 3) 一時外出後の再入場: ACTIVE を維持したまま開放する（要件4-2）。
    const e2 = await (await post(entry, { vector, purpose: "entry" })).json();
    expect(e2.admitted).toBe(true);
    expect(e2.sessionId).toBe(sessionId);
    expect(e2.sessionState).toBe("ACTIVE");

    // 4) 別室: 利用権を発行し、回数無制限で検証できる（要件7-3）。
    const issuedPass = await (await post(pass, { action: "issue", accountId })).json();
    expect(issuedPass.valid).toBe(true);
    const v1 = await (await post(pass, { action: "verify", accountId })).json();
    expect(v1.valid).toBe(true);
    const v2 = await (await post(pass, { action: "verify", accountId })).json();
    expect(v2.valid).toBe(true);

    // 5) 退場: セッションが CLOSED になる（要件8-1）。
    //    退場は削除の契機ではなく保管期限の設定契機（要件8-2 / 10-1）。
    const x = await (await post(exit, { vector, purpose: "entry" })).json();
    expect(x.released).toBe(true);
    expect(x.sessionState).toBe("CLOSED");
    expect(typeof x.exitedAt).toBe("string");

    // 6) 利用者の削除要求で顔データを同期削除する（要件10-7）。
    //    セッションは CLOSED なので延期されない（要件10-8）。
    const { deleteTemplatesForAccount } = await import("@/lib/retention/deleteTemplate");
    const del = await deleteTemplatesForAccount(accountId, "USER_REQUEST");
    expect(del.deferred).toBe(false);
    expect(del.deletedCount).toBeGreaterThan(0);

    // 7) 削除済みの顔では再入場できない（要件10-7）。入浴券を再発行して、
    //    失敗理由が券の不足ではなく識別不成立であることを明確にする。
    await post(ticket, { accountId });
    const e3 = await (await post(entry, { vector, purpose: "entry" })).json();
    expect(e3.admitted).toBe(false);
    expect(e3.reason).toBe("none");
  });
});
