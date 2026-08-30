// Test helper: create an isolated SQLite DB per test file using the committed
// migrations, and return a PrismaClient bound to it. Used by DB-backed property
// and integration tests.
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestDb {
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
}

/**
 * Spin up a fresh SQLite database file, apply migrations, and hand back a
 * client. Each caller gets its own file so tests don't interfere.
 */
export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "onsen-test-"));
  const dbPath = join(dir, "test.db");
  const url = `file:${dbPath}`;

  // Apply the existing migrations to the fresh file.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
