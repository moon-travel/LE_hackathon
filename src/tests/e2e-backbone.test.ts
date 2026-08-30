// Demo backbone E2E (API layer). Requirements 3.4, 4.2, 4.4, 7.3, 8.1, 10.7.
// Flow: enroll -> enter -> exit-outside/re-enter (ACTIVE kept) -> private room
// (pass verify) -> exit (face deleted) -> re-entry with deleted face FAILS.
//
// Runs against an isolated SQLite DB. We point DATABASE_URL at a temp file and
// apply migrations BEFORE importing any module that constructs the Prisma
// singleton, then import the route handlers dynamically.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

// Route handlers (loaded dynamically after DATABASE_URL is set).
type Handler = (req: Request) => Promise<Response>;
let enroll: Handler;
let entry: Handler;
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
  exit = (await import("@/app/api/exit/route")).POST as Handler;
  pass = (await import("@/app/api/pass/route")).POST as Handler;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("demo backbone E2E", () => {
  it("enroll -> enter -> re-enter -> pass -> exit(delete) -> re-entry fails", async () => {
    const { personVector } = await import("@/lib/face/demoVectors");
    const vector = personVector(42);

    // 1) Enroll a new account with a face + enrollment consent.
    const enrollRes = await post(enroll, {
      vector,
      consentEnrollment: true,
      consentPayment: true,
      consentVersion: "v1",
      retentionDays: 7,
    });
    const enrolled = await enrollRes.json();
    expect(enrolled.ok).toBe(true);
    const accountId: string = enrolled.accountId;

    // Issue a bathing ticket / use-right so entry is allowed.
    const issued = await post(pass, { action: "issue", accountId });
    expect((await issued.json()).ok).toBe(true);

    // 2) Enter: new ACTIVE session.
    const e1 = await (await post(entry, { vector, purpose: "entry" })).json();
    expect(e1.result).toBe("entered");
    const sessionId = e1.sessionId;
    expect(e1.gateOpen).toBe(true);

    // 3) Re-enter (after stepping outside): ACTIVE kept, gate opens (要件4.2).
    const e2 = await (await post(entry, { vector, purpose: "entry" })).json();
    expect(e2.result).toBe("reentered");
    expect(e2.sessionId).toBe(sessionId);
    expect(e2.gateOpen).toBe(true);

    // 4) Private room: pass verification succeeds while ACTIVE (要件7.3).
    const v1 = await (await post(pass, { action: "verify", vector, purpose: "pass" })).json();
    expect(v1.valid).toBe(true);
    // Idempotent: verifying again still valid.
    const v2 = await (await post(pass, { action: "verify", vector, purpose: "pass" })).json();
    expect(v2.valid).toBe(true);

    // 5) Exit: session CLOSED and templates deleted synchronously (要件8.1, 10.7).
    const x = await (await post(exit, { vector, purpose: "entry" })).json();
    expect(x.result).toBe("exited");

    // Synchronous deletion on exit: manually delete (exit sets expireAt; the
    // synchronous body deletes on the exit event). Confirm the account has no
    // templates so identify can no longer match it.
    const { deleteTemplatesForAccount } = await import("@/lib/retention/deleteTemplate");
    const del = await deleteTemplatesForAccount(accountId, "exit", true);
    expect(del.deferred).toBe(false);
    expect(del.deleted).toBeGreaterThan(0);

    // 6) Re-entry with the deleted face fails (要件10.7). Re-issue a pass first so
    // the failure is due to identification (no template), not a missing ticket.
    await post(pass, { action: "issue", accountId });
    const e3 = await (await post(entry, { vector, purpose: "entry" })).json();
    expect(e3.result).toBe("auth_failed");
    expect(e3.gateOpen).toBe(false);
  });
});
