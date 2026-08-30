// 担当B所有: テスト用の一時 SQLite DB ヘルパー。
// 本番 prisma/dev.db を汚さないため、テストごとに tmp の専用 .db を作成しスキーマを適用する。
// PrismaClient の datasource URL を実行時に上書きして分離する。
//
// 注意: 本ファイルはテスト専用ユーティリティ（route/ライブラリ本体からは import しない）。
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** schema.prisma / migration.sql と対応する DDL（テスト用に inline 保持）。 */
const SCHEMA_SQL = [
  `CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "cardToken" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 7,
    "consentEnrollment" BOOLEAN NOT NULL DEFAULT false,
    "consentPayment" BOOLEAN NOT NULL DEFAULT false,
    "consentTs" DATETIME,
    "consentVersion" TEXT,
    "autoChargeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoChargeAmount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE "FaceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireAt" DATETIME,
    CONSTRAINT "FaceTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "enteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" DATETIME,
    "passHistory" TEXT NOT NULL DEFAULT '[]',
    "transactions" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE "Pass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pass_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "accountId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '{}'
  )`,
];

export interface TestDb {
  client: PrismaClient;
  dispose: () => Promise<void>;
}

/**
 * 一時 SQLite DB を作成し、スキーマを適用した PrismaClient を返す。
 * テスト側で beforeAll などで生成し、afterAll で dispose する。
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "le-account-test-"));
  const dbPath = join(dir, "test.db");
  const client = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  for (const ddl of SCHEMA_SQL) {
    await client.$executeRawUnsafe(ddl);
  }
  return {
    client,
    dispose: async () => {
      await client.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 全テーブルを空にする（テスト間の状態汚染防止）。 */
export async function clearAll(client: PrismaClient): Promise<void> {
  await client.pass.deleteMany();
  await client.session.deleteMany();
  await client.faceTemplate.deleteMany();
  await client.auditLog.deleteMany();
  await client.account.deleteMany();
}
